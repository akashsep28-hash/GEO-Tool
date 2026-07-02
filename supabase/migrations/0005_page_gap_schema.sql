-- ============================================================================
-- Page Gap Analyzer — Schema generator sub-module.
-- Stores the generated Schema.org JSON-LD for a run's target page, generated
-- on demand from the same deterministic inputs (benchmark + target signals)
-- and enriched by the connected LLM. Mirrors the llm_* columns.
-- ============================================================================

alter table public.page_gap_runs
  add column if not exists schema_jsonld jsonb,          -- full SchemaResult (null until generated)
  add column if not exists schema_status text not null default 'pending', -- pending | running | done | error
  add column if not exists schema_model text,
  add column if not exists schema_error text;
