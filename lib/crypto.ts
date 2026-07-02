/**
 * AES-256-GCM encryption for user-supplied third-party API keys.
 *
 * Every secret a user pastes into Settings (SEMrush, GSC, OpenAI, etc.) is
 * encrypted with the server-only ENCRYPTION_KEY before it is written to the
 * database, and decrypted only in server code at the moment of use. The plain
 * value is never sent back to the browser — the UI only ever shows a masked
 * preview and "connected" status.
 */
import crypto from "crypto";
import { env } from "./env";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
	const key = Buffer.from(env.encryptionKey, "base64");
	if (key.length !== 32) {
		throw new Error(
			"ENCRYPTION_KEY must be a base64-encoded 32-byte value. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
		);
	}
	return key;
}

/** Returns a single opaque string: base64(iv).base64(authTag).base64(ciphertext) */
export function encryptSecret(plaintext: string): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
	const [ivB64, tagB64, dataB64] = payload.split(".");
	if (!ivB64 || !tagB64 || !dataB64) {
		throw new Error("Malformed encrypted secret.");
	}
	const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
	decipher.setAuthTag(Buffer.from(tagB64, "base64"));
	const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
	return plaintext.toString("utf8");
}

/** A non-reversible masked preview to show in the UI, e.g. "sk-a••••••3f9". */
export function maskSecret(plaintext: string): string {
	if (plaintext.length <= 8) return "••••••••";
	return `${plaintext.slice(0, 4)}••••••${plaintext.slice(-3)}`;
}
