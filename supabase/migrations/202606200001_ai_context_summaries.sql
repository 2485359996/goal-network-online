create table if not exists public.ai_context_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  goal_id text not null,
  scope text not null check (scope in ('branch')),
  summary_version integer not null,
  source_hash text not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, goal_id, scope, summary_version)
);

create index if not exists ai_context_summaries_workspace_goal_idx
  on public.ai_context_summaries(workspace_id, goal_id, scope, summary_version);

alter table public.ai_context_summaries enable row level security;

revoke all on public.ai_context_summaries from anon;
revoke all on public.ai_context_summaries from authenticated;
grant select, insert, update, delete on public.ai_context_summaries to service_role;
