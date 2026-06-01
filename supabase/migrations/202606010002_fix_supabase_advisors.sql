create index if not exists workspaces_owner_user_id_idx on public.workspaces(owner_user_id);
create index if not exists goal_relations_target_idx on public.goal_relations(target_goal_id, relation_type);
create index if not exists sync_jobs_workspace_id_idx on public.sync_jobs(workspace_id);
create index if not exists audit_events_actor_user_id_idx on public.audit_events(actor_user_id);

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

drop policy if exists "users can create owned workspaces" on public.workspaces;
create policy "users can create owned workspaces" on public.workspaces
  for insert to authenticated
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "owners can manage memberships" on public.memberships;
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

drop policy if exists "writers can mutate goals" on public.goals;
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

drop policy if exists "writers can mutate goal relations" on public.goal_relations;
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

drop policy if exists "writers can mutate weekly actions" on public.weekly_actions;
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

drop policy if exists "writers can mutate records" on public.records;
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
