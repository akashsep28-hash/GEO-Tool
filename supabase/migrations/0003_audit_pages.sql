-- ============================================================================
-- Per-page audit storage for the AI auditor agent.
-- Stores the full parsed HTML + parsed signals + rule verdicts for every page
-- crawled, plus the AI agent's analysis and corrected version (generated on
-- demand). One row per page per audit.
-- ============================================================================

create table if not exists public.audit_pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  requested_url text,
  status int,
  ok boolean,
  title text,
  meta_description text,
  word_count int,
  html_bytes int,
  html text,                -- full parsed/stored HTML (truncated to ~300KB)
  page_text text,           -- cleaned, readable text
  signals jsonb,            -- parsed structural/content signals
  rule_issues jsonb,        -- deterministic per-page rule issues
  working jsonb,            -- rule-derived "what's working"
  not_working jsonb,        -- rule-derived "what's not working"
  ai_analysis jsonb,        -- { working, notWorking, gaps, suggestedFixes, correctedHtml }
  ai_status text not null default 'pending',  -- pending | running | done | error
  ai_model text,
  ai_error text,
  created_at timestamptz not null default now()
);

create index if not exists audit_pages_audit_idx on public.audit_pages(audit_id);
create index if not exists audit_pages_user_idx on public.audit_pages(user_id);

alter table public.audit_pages enable row level security;

create policy "owner all" on public.audit_pages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
