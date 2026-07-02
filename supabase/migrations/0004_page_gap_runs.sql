-- ============================================================================
-- Page Gap Analyzer — SERP-sourced page audit runs.
-- One row per analysis run (keyword + target URL). The full structured report
-- (intent verdict, SERP, benchmark, sourced gaps, scores) is stored in `report`
-- as jsonb, mirroring how `audits.summary` holds the whole audit payload. The
-- once-per-run LLM narrative is stored separately and generated on demand.
-- ============================================================================

create table if not exists public.page_gap_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  keyword text not null,
  target_url text not null,
  country text,
  device text,
  score int,
  verdict text,                 -- service_page | informational | hybrid_required
  mismatch boolean,             -- intent mismatch flagged?
  report jsonb,                 -- full deterministic PageGapResult
  llm_analysis jsonb,           -- PageGapLlm narrative (null until generated)
  llm_status text not null default 'pending',  -- pending | running | done | error
  llm_model text,
  llm_error text,
  created_at timestamptz not null default now()
);

create index if not exists page_gap_runs_user_idx on public.page_gap_runs(user_id);
create index if not exists page_gap_runs_project_idx on public.page_gap_runs(project_id);

alter table public.page_gap_runs enable row level security;

create policy "owner all" on public.page_gap_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
