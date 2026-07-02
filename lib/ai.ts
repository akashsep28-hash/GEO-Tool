/**
 * AI provider abstraction. Resolution order (first available wins):
 *   1. User's connected Local LLM (Ollama / LM Studio / any OpenAI-compatible)
 *   2. User's connected OpenAI key
 *   3. User's connected Anthropic (Claude) key
 *   4. Platform Claude key (ANTHROPIC_API_KEY)
 *
 * Local + OpenAI use the OpenAI-compatible /chat/completions shape via fetch
 * (no SDK needed). Anthropic uses its SDK. This lets users run everything for
 * free on their own machine, or bring a hosted key, or fall back to the default.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { getCredentials } from "@/lib/connections";
import { env } from "@/lib/env";

const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";

/**
 * Per-call model override (concurrency-safe via AsyncLocalStorage). Lets a caller
 * retry a generation on a different model — e.g. a smaller local fallback when the
 * configured model OOM-crashes — WITHOUT changing the globally-resolved provider.
 * Only affects openai_compat (local / OpenAI) providers; a no-op otherwise. Code
 * that does not opt in (e.g. the Page Gap pipeline) is completely unaffected.
 */
const modelOverrideStore = new AsyncLocalStorage<string>();

export function runWithModelOverride<T>(model: string, fn: () => Promise<T>): Promise<T> {
	return modelOverrideStore.run(model, fn);
}

type Provider =
	| { kind: "anthropic"; key: string; label: string }
	| {
			kind: "openai_compat";
			baseUrl: string;
			key: string;
			model: string;
			label: string;
	  };

export type AiAvailability = {
	available: boolean;
	source: "local" | "user" | "platform" | "none";
	label?: string;
};

function normaliseBaseUrl(raw: string): string {
	let u = raw.trim().replace(/\/+$/, "");
	// Allow users to paste either ".../v1" or the bare host; ensure /v1.
	if (!/\/v\d+$/.test(u)) u = `${u}/v1`;
	return u;
}

/**
 * Ollama detection. Ollama's OpenAI-compatible /v1 route IGNORES the `think`
 * flag, so "reasoning" fine-tunes spend the whole token budget thinking and
 * return empty `content`. Its native /api/chat route honours `think:false`,
 * which is also a safe no-op on non-reasoning models. We route Ollama there.
 */
function isOllama(baseUrl: string): boolean {
	return /:11434(\/|$)/.test(baseUrl) || /\bollama\b/i.test(baseUrl);
}

/**
 * NVIDIA NIM (integrate.api.nvidia.com). Reasoning models (e.g. Nemotron) think
 * before answering: the chain-of-thought lands in `reasoning_content` (which we
 * ignore) while the real answer is in `content`. Thinking + a big structured
 * prompt is slow and token-hungry, so for NVIDIA we keep thinking on but give it
 * a long timeout and a large token budget so neither the reasoning nor the
 * delimited output gets truncated.
 */
function isNvidia(baseUrl: string): boolean {
	return /(^|\.)integrate\.api\.nvidia\.com/i.test(baseUrl);
}

/** Pull `delta.content` out of one OpenAI-style SSE line (ignores reasoning). */
function extractSseDelta(line: string): string {
	if (!line.startsWith("data:")) return "";
	const data = line.slice(5).trim();
	if (!data || data === "[DONE]") return "";
	try {
		const obj = JSON.parse(data) as {
			choices?: { delta?: { content?: string } }[];
		};
		return obj.choices?.[0]?.delta?.content ?? "";
	} catch {
		return "";
	}
}

/**
 * Accumulate the assistant text from an OpenAI-style SSE stream. Streaming is
 * required for slow hosted reasoning models (NVIDIA NIM) — a non-streamed call
 * sits idle while the model "thinks" and the provider gateway returns 504.
 */
async function readSseContent(res: Response): Promise<string> {
	if (!res.body) {
		// Runtime buffered the whole body — parse it line-by-line instead.
		return (await res.text())
			.split(/\r?\n/)
			.map(l => extractSseDelta(l.trim()))
			.join("");
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let out = "";
	const drain = (chunk: string) => {
		buffer += chunk;
		let idx: number;
		while ((idx = buffer.indexOf("\n")) !== -1) {
			out += extractSseDelta(buffer.slice(0, idx).trim());
			buffer = buffer.slice(idx + 1);
		}
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		drain(decoder.decode(value, { stream: true }));
	}
	drain(decoder.decode());
	if (buffer.trim()) out += extractSseDelta(buffer.trim());
	return out;
}

async function resolveProvider(): Promise<Provider | null> {
	// 1. Local LLM (explicit opt-in → highest priority)
	try {
		const local = await getCredentials("local_llm");
		if (local?.base_url && local?.model) {
			return {
				kind: "openai_compat",
				baseUrl: normaliseBaseUrl(local.base_url),
				key: local.api_key || "",
				model: local.model,
				label: `Local: ${local.model}`,
			};
		}
	} catch {
		/* not connected */
	}

	// 2. User OpenAI key
	try {
		const oa = await getCredentials("openai");
		if (oa?.api_key) {
			return {
				kind: "openai_compat",
				baseUrl: "https://api.openai.com/v1",
				key: oa.api_key,
				model: oa.model || "gpt-4o-mini",
				label: `OpenAI: ${oa.model || "gpt-4o-mini"}`,
			};
		}
	} catch {
		/* not connected */
	}

	// 3. User Anthropic key
	try {
		const a = await getCredentials("anthropic");
		if (a?.api_key?.startsWith("sk-ant-")) {
			return { kind: "anthropic", key: a.api_key, label: "Claude (your key)" };
		}
	} catch {
		/* not connected */
	}

	// 4. Env-level local LLM (works in guest mode + as the default, no account needed)
	if (env.localLlmBaseUrl && env.localLlmModel) {
		return {
			kind: "openai_compat",
			baseUrl: normaliseBaseUrl(env.localLlmBaseUrl),
			key: env.localLlmApiKey || "",
			model: env.localLlmModel,
			label: `Local: ${env.localLlmModel}`,
		};
	}

	// 5. Platform Claude
	if (env.anthropicKey.startsWith("sk-ant-")) {
		return {
			kind: "anthropic",
			key: env.anthropicKey,
			label: "Claude (platform)",
		};
	}

	return null;
}

export async function aiAvailability(): Promise<AiAvailability> {
	const p = await resolveProvider();
	if (!p) return { available: false, source: "none" };
	if (p.kind === "openai_compat" && p.baseUrl.includes("localhost"))
		return { available: true, source: "local", label: p.label };
	if (p.label.includes("platform")) return { available: true, source: "platform", label: p.label };
	return { available: true, source: "user", label: p.label };
}

/** Single-shot text generation across whichever provider is configured. */
export async function generateText(opts: {
	system?: string;
	prompt: string;
	maxTokens?: number;
	/** Override the request timeout (ms). Local models generating HTML need more. */
	timeoutMs?: number;
}): Promise<string> {
	const provider = await resolveProvider();
	if (!provider) {
		throw new Error(
			"No AI model is connected. Connect a Local LLM (Ollama/LM Studio), OpenAI, or Anthropic key in Settings — or set ANTHROPIC_API_KEY.",
		);
	}

	// Apply an opt-in per-call model override (e.g. the fallback-model retry). Only
	// meaningful for openai_compat providers, where the model is part of the request.
	const override = modelOverrideStore.getStore();
	if (override && provider.kind === "openai_compat" && provider.model !== override) {
		provider.model = override;
		provider.label = `Local: ${override}`;
	}

	if (provider.kind === "anthropic") {
		const client = new Anthropic({ apiKey: provider.key });
		const msg = await client.messages.create({
			model: DEFAULT_CLAUDE_MODEL,
			max_tokens: opts.maxTokens ?? 2000,
			system: opts.system,
			messages: [{ role: "user", content: opts.prompt }],
		});
		return msg.content
			.filter((b): b is Anthropic.TextBlock => b.type === "text")
			.map(b => b.text)
			.join("\n");
	}

	// OpenAI-compatible (local LLM or OpenAI)
	const messages = [
		...(opts.system ? [{ role: "system", content: opts.system }] : []),
		{ role: "user", content: opts.prompt },
	];
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
	const nvidia = isNvidia(provider.baseUrl);
	// NVIDIA reasoning models need headroom for thinking + the full output, and
	// they are slow, so floor the budget and timeout well above the generic call.
	const maxTokens = nvidia ? Math.max(opts.maxTokens ?? 2000, 16384) : (opts.maxTokens ?? 2000);
	// Local/hosted reasoning models can be slow; give them time.
	const timeoutMs = nvidia ? Math.max(opts.timeoutMs ?? 120000, 600000) : (opts.timeoutMs ?? 120000);
	const signal = AbortSignal.timeout(timeoutMs);

	// Ollama: use the native /api/chat route so we can disable "thinking".
	if (isOllama(provider.baseUrl)) {
		const root = provider.baseUrl.replace(/\/v\d+$/, "");
		const res = await fetch(`${root}/api/chat`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: provider.model,
				messages,
				stream: false,
				think: false, // reasoning fine-tunes otherwise burn the budget thinking
				options: { num_predict: maxTokens },
			}),
			signal,
		});
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			throw new Error(`AI request to ${provider.label} failed (${res.status}). ${detail.slice(0, 300)}`);
		}
		const data = (await res.json()) as {
			message?: { content?: string };
			error?: string;
		};
		if (data.error) {
			throw new Error(`${provider.label} error: ${data.error.slice(0, 300)}`);
		}
		const text = data.message?.content?.trim();
		if (!text) {
			throw new Error(`${provider.label} returned an empty response.`);
		}
		return text;
	}

	const body: Record<string, unknown> = {
		model: provider.model,
		max_tokens: maxTokens,
		messages,
		// NVIDIA: stream so the connection stays alive while the model reasons,
		// otherwise the provider gateway times out (504) on long thinking.
		stream: nvidia,
	};
	if (nvidia) {
		// Reasoning controls (sent as top-level fields, the OpenAI SDK's extra_body).
		body.temperature = 0.6;
		body.top_p = 0.95;
		body.chat_template_kwargs = { enable_thinking: true };
		body.reasoning_budget = 16384;
		headers.Accept = "text/event-stream";
	}

	const res = await fetch(`${provider.baseUrl}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal,
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`AI request to ${provider.label} failed (${res.status}). ${detail.slice(0, 300)}`);
	}

	if (nvidia) {
		const streamed = await readSseContent(res);
		if (!streamed.trim()) {
			throw new Error(`${provider.label} returned an empty response.`);
		}
		return streamed;
	}

	const data = (await res.json()) as {
		choices?: { message?: { content?: string } }[];
	};
	const text = data.choices?.[0]?.message?.content;
	if (!text) {
		throw new Error(`${provider.label} returned an empty response.`);
	}
	return text;
}
