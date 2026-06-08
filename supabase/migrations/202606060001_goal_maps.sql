create table if not exists public.goal_maps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.goals
  add column if not exists goal_map_id uuid references public.goal_maps(id) on delete cascade;

with workspaces_with_goals as (
  select distinct workspace_id
  from public.goals
)
insert into public.goal_maps (workspace_id, name, sort_order)
select workspace_id, '目标网络', 0
from workspaces_with_goals source
where not exists (
  select 1
  from public.goal_maps existing
  where existing.workspace_id = source.workspace_id
    and existing.name = '目标网络'
);

update public.goals goals
set goal_map_id = maps.id
from public.goal_maps maps
where goals.workspace_id = maps.workspace_id
  and maps.name = '目标网络'
  and goals.goal_map_id is null;

alter table public.goals
  alter column goal_map_id set not null;

create index if not exists goal_maps_workspace_sort_idx on public.goal_maps(workspace_id, sort_order, created_at);
create index if not exists goals_workspace_goal_map_idx on public.goals(workspace_id, goal_map_id);

alter table public.goal_maps enable row level security;

grant select, insert, update, delete on public.goal_maps to authenticated;

create policy "members can read goal maps" on public.goal_maps
  for select to authenticated
  using (app_private.current_user_workspace_role(workspace_id) is not null);

create policy "writers can insert goal maps" on public.goal_maps
  for insert to authenticated
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can update goal maps" on public.goal_maps
  for update to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'))
  with check (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

create policy "writers can delete goal maps" on public.goal_maps
  for delete to authenticated
  using (app_private.current_user_workspace_role(workspace_id) in ('owner', 'admin', 'member'));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'goal_maps'
  ) then
    alter publication supabase_realtime add table public.goal_maps;
  end if;
end $$;

select pg_notification_queue_usage();
