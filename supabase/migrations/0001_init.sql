-- ============================================================================
-- The First Ranker — GEO Tool · Initial schema
-- Run this in the Supabase SQL editor (or `supabase db push`).
-- Every table is row-level-secured so a user can only ever see their own data,
-- except the community tables which are readable by any signed-in user.
-- ============================================================================

-- Helpful extension for UUIDs (Supabase has this by default, but be explicit).
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles : 1:1 with auth.users, holds onboarding progress
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  onboarding_step int not null default 0,
  onboarding_complete boolean not null default false,
  daily_digest_optin boolean not null default true,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects : a website the user is optimising for GEO
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  website_url text not null,
  industry text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects(user_id);

-- ---------------------------------------------------------------------------
-- connections : encrypted third-party API credentials (BYO-API vault)
-- The actual secret values live in `encrypted_credentials` as AES-256-GCM
-- ciphertext produced by the server (lib/crypto.ts). The DB never sees plaintext.
-- ---------------------------------------------------------------------------
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  category text not null,
  label text,
  encrypted_credentials text not null,
  masked_preview text,
  status text not null default 'connected',
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_id)
);
create index if not exists connections_user_idx on public.connections(user_id);

-- ---------------------------------------------------------------------------
-- audits + findings : the automatic GEO/technical audit
-- ---------------------------------------------------------------------------
create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued',
  score int,
  summary jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audits_project_idx on public.audits(project_id);

create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  severity text not null,            -- critical | high | medium | low | pass
  category text not null,            -- crawler_access | schema | llms_txt | ...
  title text not null,
  problem text not null,
  fix text not null,
  evidence text,
  sop_ref text
);
create index if not exists findings_audit_idx on public.audit_findings(audit_id);

-- ---------------------------------------------------------------------------
-- prompts : the tracking set (SOP Appendix A)
-- ---------------------------------------------------------------------------
create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  prompt_text text not null,
  journey_stage text,                -- awareness | exploration | consideration | decision | post_purchase
  prompt_type text,                  -- branded | unbranded | comparison
  win_condition text,                -- mention | citation
  triggers_web_search boolean,
  priority_engines text[],
  baseline_mention boolean,
  baseline_citation boolean,
  position int,
  sentiment text,
  created_at timestamptz not null default now()
);
create index if not exists prompts_project_idx on public.prompts(project_id);

-- ---------------------------------------------------------------------------
-- topics : output of the topic-clustering & demand engine
-- ---------------------------------------------------------------------------
create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  cluster text,
  rationale text,
  score int,
  win_condition text,
  recommended_date date,
  status text not null default 'suggested', -- suggested | queued | drafted | published
  created_at timestamptz not null default now()
);
create index if not exists topics_project_idx on public.topics(project_id);

-- ---------------------------------------------------------------------------
-- content_pieces : blog writer output + social repurposing
-- ---------------------------------------------------------------------------
create table if not exists public.content_pieces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null,
  body text,
  meta jsonb,
  status text not null default 'draft', -- draft | review | published
  created_at timestamptz not null default now()
);
create index if not exists content_project_idx on public.content_pieces(project_id);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_piece_id uuid references public.content_pieces(id) on delete cascade,
  platform text not null,
  body text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- daily_actions : the "best topic / best action today" digest queue (SOP 8.1)
-- ---------------------------------------------------------------------------
create table if not exists public.daily_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  for_date date not null default current_date,
  action_type text not null,
  title text not null,
  detail text,
  emailed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists daily_actions_user_idx on public.daily_actions(user_id, for_date);

-- ---------------------------------------------------------------------------
-- community : free for any signed-in user
-- ---------------------------------------------------------------------------
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);

-- ===========================================================================
-- ROW-LEVEL SECURITY
-- ===========================================================================
alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.connections       enable row level security;
alter table public.audits            enable row level security;
alter table public.audit_findings    enable row level security;
alter table public.prompts           enable row level security;
alter table public.topics            enable row level security;
alter table public.content_pieces    enable row level security;
alter table public.social_posts      enable row level security;
alter table public.daily_actions     enable row level security;
alter table public.community_posts   enable row level security;
alter table public.community_comments enable row level security;

-- Owner-only tables: a single policy template applied per table.
create policy "own profile (select)" on public.profiles for select using (auth.uid() = id);
create policy "own profile (update)" on public.profiles for update using (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array[
    'projects','connections','audits','audit_findings','prompts','topics',
    'content_pieces','social_posts','daily_actions'
  ]
  loop
    execute format($f$
      create policy "owner all" on public.%I
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    $f$, t);
  end loop;
end $$;

-- Community: any signed-in user can read; only the author can write/edit/delete.
create policy "community posts readable" on public.community_posts
  for select using (auth.role() = 'authenticated');
create policy "community posts owner write" on public.community_posts
  for insert with check (auth.uid() = user_id);
create policy "community posts owner modify" on public.community_posts
  for update using (auth.uid() = user_id);
create policy "community posts owner delete" on public.community_posts
  for delete using (auth.uid() = user_id);

create policy "community comments readable" on public.community_comments
  for select using (auth.role() = 'authenticated');
create policy "community comments owner write" on public.community_comments
  for insert with check (auth.uid() = user_id);
create policy "community comments owner modify" on public.community_comments
  for update using (auth.uid() = user_id);
create policy "community comments owner delete" on public.community_comments
  for delete using (auth.uid() = user_id);
