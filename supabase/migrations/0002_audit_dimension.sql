-- Add dimension column to audit_findings (citability | structural | multimodal | authority | technical)
alter table public.audit_findings
  add column if not exists dimension text;
