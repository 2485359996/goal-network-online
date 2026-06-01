create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  github_installation_id bigint,
  github_repository_full_name text,
  github_branch text default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text not null,
  title text not null,
  file_path text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'done', 'archived')),
  horizon text not null default 'medium',
  domain_title text not null,
  priority integer not null default 50 check (priority between 0 and 100),
  clarity integer not null default 1 check (clarity between 1 and 5),
  progress integer check (progress between 0 and 100),
  color text not null default '',
  map_x double precision,
  map_y double precision,
  map_positions jsonb,
  sections jsonb not null default '{}'::jsonb,
  tags text[] not null default array['goal-network'],
  last_reviewed text not null default '',
  last_progress text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, legacy_id),
  unique (workspace_id, title)
);

create table if not exists public.goal_relations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_goal_id uuid not null references public.goals(id) on delete cascade,
  target_goal_id uuid not null references public.goals(id) on delete cascade,
  relation_type text not null check (relation_type in ('parent', 'supports', 'depends_on', 'conflicts_with')),
  created_at timestamptz not null default now(),
  unique (source_goal_id, target_goal_id, relation_type)
);

create table if not exists public.weekly_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_id text not null,
  week text not null,
  description text not null,
  goal_title text not null,
  due text,
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, action_id)
);

create table if not exists public.records (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null check (type in ('plan', 'review', 'weekly-review', 'progress-log')),
  title text not null,
  file_path text not null,
  date text,
  created text,
  week text,
  status text not null default '',
  goals text[] not null default '{}',
  source text not null default '',
  review_scope text not null default '',
  progress_state text not null default '',
  horizon text not null default '',
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('github_export_pending', 'github_import_pending')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists memberships_user_id_idx on public.memberships(user_id);
create index if not exists workspaces_owner_user_id_idx on public.workspaces(owner_user_id);
create index if not exists goals_workspace_id_idx on public.goals(workspace_id);
create index if not exists goal_relations_workspace_id_idx on public.goal_relations(workspace_id);
create index if not exists goal_relations_source_idx on public.goal_relations(source_goal_id, relation_type);
create index if not exists goal_relations_target_idx on public.goal_relations(target_goal_id, relation_type);
create index if not exists weekly_actions_workspace_week_idx on public.weekly_actions(workspace_id, week, sort_order);
create index if not exists records_workspace_created_idx on public.records(workspace_id, created_at desc);
create index if not exists sync_jobs_workspace_id_idx on public.sync_jobs(workspace_id);
create index if not exists sync_jobs_pending_idx on public.sync_jobs(status, created_at) where status = 'pending';
create index if not exists audit_events_workspace_created_idx on public.audit_events(workspace_id, created_at desc);
create index if not exists audit_events_actor_user_id_idx on public.audit_events(actor_user_id);

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.goals enable row level security;
alter table public.goal_relations enable row level security;
alter table public.weekly_actions enable row level security;
alter table public.records enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.audit_events enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.goal_relations to authenticated;
grant select, insert, update, delete on public.weekly_actions to authenticated;
grant select, insert, update, delete on public.records to authenticated;
grant select on public.sync_jobs to authenticated;
grant select on public.audit_events to authenticated;

create schema if not exists app_private;
grant usage on schema app_private to authenticated;

create or replace function app_private.current_user_workspace_role(target_workspace_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select m.role
  from public.memberships m
  where m.workspace_id = target_workspace_id
    and m.user_id = auth.uid()
  limit 1
$$;

revoke all on function app_private.current_user_workspace_role(uuid) from public;
grant execute on function app_private.current_user_workspace_role(uuid) to authenticated;

create or replace function app_private.storage_workspace_id(object_name text)
returns uuid
language sql
immutable
set search_path = storage
as $$
  select case
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(object_name))[1])::uuid
    else null
  end
$$;

revoke all on function app_private.storage_workspace_id(text) from public;
grant execute on function app_private.storage_workspace_id(text) to authenticated;

create policy "members can read workspaces" on public.workspaces
  for select to authenticated
  using (app_private.current_user_workspace_role(id) is not null);

create policy "users can create owned workspaces" on public.workspaces
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()));

create policy "admins can update workspaces" on public.workspaces
  for update to authenticated
  using (app_private.current_user_workspace_role(id) in ('owner', 'admin'))
  with check (app_private.current_user_workspace_role(id) in ('owner', 'admin'));

create policy "members can read memberships" on public.memberships
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

create policy "owners can insert memberships" on public.memberships
  for insert to authenticated
  with check (app_private.current_user_workspace_role(workspace_id) = 'owner');

create policy "owners can update memberships" on public.memberships
  for update to authenticated
  using (app_private.current_user_workspace_role(workspace_id) = 'owner')
  with check (app_private.current_user_workspace_role(workspace_id) = 'owner');

create policy "owners can delete memberships" on public.memberships
  for delete to authenticated
  using (app_private.current_user_workspace_role(workspace_id) = 'owner');

create policy "members can read goals" on public.goals
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

create policy "writers can insert goals" on public.goals
  for insert to authenticated
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can update goals" on public.goals
  for update to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'))
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can delete goals" on public.goals
  for delete to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "members can read goal relations" on public.goal_relations
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

create policy "writers can insert goal relations" on public.goal_relations
  for insert to authenticated
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can update goal relations" on public.goal_relations
  for update to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'))
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can delete goal relations" on public.goal_relations
  for delete to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "members can read weekly actions" on public.weekly_actions
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

create policy "writers can insert weekly actions" on public.weekly_actions
  for insert to authenticated
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can update weekly actions" on public.weekly_actions
  for update to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'))
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can delete weekly actions" on public.weekly_actions
  for delete to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "members can read records" on public.records
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

create policy "writers can insert records" on public.records
  for insert to authenticated
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can update records" on public.records
  for update to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'))
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can delete records" on public.records
  for delete to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "members can read audit events" on public.audit_events
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

create policy "members can read sync jobs" on public.sync_jobs
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

insert into storage.buckets (id, name, public)
values ('imports', 'imports', false), ('exports', 'exports', false)
on conflict (id) do nothing;

create policy "members can read workspace storage" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('imports', 'exports')
    and app_private.current_user_workspace_role(app_private.storage_workspace_id(name)) is not null
  );

create policy "writers can insert workspace storage" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('imports', 'exports')
    and app_private.current_user_workspace_role(app_private.storage_workspace_id(name)) in ('owner', 'admin', 'member')
  );

create policy "writers can update workspace storage" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('imports', 'exports')
    and app_private.current_user_workspace_role(app_private.storage_workspace_id(name)) in ('owner', 'admin', 'member')
  )
  with check (
    bucket_id in ('imports', 'exports')
    and app_private.current_user_workspace_role(app_private.storage_workspace_id(name)) in ('owner', 'admin', 'member')
  );

create policy "writers can delete workspace storage" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('imports', 'exports')
    and app_private.current_user_workspace_role(app_private.storage_workspace_id(name)) in ('owner', 'admin', 'member')
  );

alter publication supabase_realtime add table public.goals;
alter publication supabase_realtime add table public.goal_relations;
alter publication supabase_realtime add table public.weekly_actions;
alter publication supabase_realtime add table public.records;
