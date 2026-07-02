# The First Ranker — GEO Tool

A self-updating web app that turns the **GEO Master SOP** into software: automatic
AI-visibility audits, prompt/topic research, GEO-optimised content, social
repurposing, and citation tracking across ChatGPT, Perplexity, Gemini, and Google
AI Overviews.

Users **bring their own API keys** (SEMrush, GSC, PageSpeed, SERP tools, AI
models, CMSs, CRMs, webhooks). Every key is encrypted at rest and used only on the
server. Sign-in is Google, so each user's data lives in their own account.

---

## Tech stack

| Layer        | Choice                                                   |
| ------------ | -------------------------------------------------------- |
| Framework    | Next.js (App Router) + React 19 + TypeScript             |
| Styling      | Tailwind CSS v4                                          |
| Auth + DB    | Supabase (Postgres, Google OAuth, Row-Level Security)    |
| Secrets      | AES-256-GCM encryption of user API keys (`lib/crypto.ts`)|
| Default AI   | Claude (`@anthropic-ai/sdk`), user key overrides it      |
| Email        | Resend (daily best-action digest)                        |

The app is **local-first**: it boots and shows a setup screen until you add
credentials. Nothing crashes when an API is missing — the related feature simply
stays locked.

---

## Quick start (5 steps)

### 1. Install & run

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you'll see the setup screen until step 5 is done.

### 2. Create a Supabase project

- Go to https://supabase.com → **New project**.
- **Project Settings → API**: copy the **Project URL**, **anon key**, and
  **service_role key**.

### 3. Run the database migration

- Supabase → **SQL Editor** → paste the contents of
  [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.
- This creates all tables, the auto-profile trigger, and Row-Level Security so a
  user can only ever read their own data (community tables are shared).

### 4. Enable Google sign-in

- Supabase → **Authentication → Providers → Google** → enable.
- In Google Cloud Console create an **OAuth 2.0 Client ID** (Web). Add the
  redirect URL that Supabase shows you (looks like
  `https://YOUR-PROJECT.supabase.co/auth/v1/callback`).
- Paste the Google client ID/secret into Supabase.
- Add `http://localhost:3000/auth/callback` as an allowed redirect in Supabase
  **Authentication → URL Configuration**.

### 5. Fill `.env.local`

```bash
cp .env.example .env.local
```

Then set:

| Variable                        | Where it comes from                              |
| ------------------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → API                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API                                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → API (secret)                          |
| `ENCRYPTION_KEY`                | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ANTHROPIC_API_KEY`             | https://console.anthropic.com (default AI model) |
| `RESEND_API_KEY` *(optional)*   | https://resend.com (daily email)                 |
| `CRON_SECRET` *(optional)*      | any random string (protects the digest endpoint) |

Restart `npm run dev`. The setup screen disappears and you can sign in.

---

## How the product maps to the SOP

| App section            | SOP source                                                    |
| ---------------------- | ------------------------------------------------------------- |
| **Website Audit**      | Parts 3, 4, 6 — crawler access, llms.txt, schema, SSR, answer-first, statistics, comparison tables, year signals. Runs with **no API keys**. |
| **Topics & Prompts**   | Part 5 — prioritise by value/winnability, win condition per prompt, tracking set. |
| **Blog Writer**        | Part 3 — answer-first, statistics, citations, comparison table, FAQ; no fluff. |
| **Design Studio**      | Part 4 — machine-consumable page design, schema-ready blocks. |
| **Social Repurposing** | Part 7 — distribution across third-party surfaces.            |
| **Performance**        | Part 9 — mention rate, citation rate, share of voice, sentiment, drift. |
| **Daily digest**       | Part 8.1 — the morning "best action today" email.             |
| **Community**          | Free for any signed-in user.                                  |

## The audit engine (works offline of any API)

`lib/audit-engine.ts` fetches the page, `robots.txt`, and `llms.txt`, then scores
the durable GEO gates. Every finding returns a **problem + the exact fix + the SOP
reference**. Connecting PageSpeed / GSC later enriches it with field data.

## Onboarding

- Hero CTA captures the URL → Google sign-in → onboarding pre-filled.
- 5 steps with a **progress bar** and a **Skip** on every connection step.
- Skipped APIs leave the matching feature locked (with a clear "connect to unlock"
  notice), exactly as requested.

## Daily digest (cron)

Schedule a daily `GET /api/cron/daily` with header
`Authorization: Bearer <CRON_SECRET>` (Vercel Cron, GitHub Action, etc.). It
records each opted-in user's best action and emails it if Resend is set.

---

## Scripts

```bash
npm run dev        # local dev
npm run build      # production build
npm run start      # run the production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## Security notes

- Row-Level Security on every table; the service-role key is server-only.
- User API keys are AES-256-GCM encrypted; the browser only ever sees a masked
  preview and "connected" status.
- Security headers set in `next.config.mjs`; the cron endpoint requires a secret.
- `.env.local` is git-ignored — never commit secrets.

## What's wired vs. next

**Fully working now:** auth, onboarding (skip + progress), encrypted connection
vault, the crawl-based audit, AI topic research / blog writing / social
repurposing (Claude), community, daily-digest job, all RLS.

**Next to deepen:** live data pulls from each connected SEO/SERP/analytics API
into Topics & Performance, the generative Design Studio builder, OAuth flows for
GSC/GA4/social, and the Part 13 self-updating watchlist that revises tactics as
engines change.
```
