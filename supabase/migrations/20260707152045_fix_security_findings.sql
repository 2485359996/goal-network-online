revoke insert, update, delete on public.memberships from authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.memberships to service_role;

drop policy if exists "owners can manage memberships" on public.memberships;
drop policy if exists "owners can insert memberships" on public.memberships;
drop policy if exists "owners can update memberships" on public.memberships;
drop policy if exists "owners can delete memberships" on public.memberships;

delete from public.goal_relations
where relation_type = 'parent'
  and source_goal_id = target_goal_id;

alter table public.goal_relations
  drop constraint if exists goal_relations_no_self_parent;

alter table public.goal_relations
  add constraint goal_relations_no_self_parent
  check (relation_type <> 'parent' or source_goal_id <> target_goal_id);

create or replace function app_private.prevent_goal_parent_cycle()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  ignored_relation_id uuid := null;
begin
  if tg_op = 'UPDATE' then
    ignored_relation_id := old.id;
  end if;

  if new.relation_type <> 'parent' then
    return new;
  end if;

  if new.source_goal_id = new.target_goal_id then
    raise exception 'Goal parent relation cannot target itself';
  end if;

  if exists (
    with recursive parent_chain(goal_id) as (
      select new.target_goal_id
      union
      select relation.target_goal_id
      from public.goal_relations relation
      join parent_chain chain on relation.source_goal_id = chain.goal_id
      where relation.workspace_id = new.workspace_id
        and relation.relation_type = 'parent'
        and (ignored_relation_id is null or relation.id <> ignored_relation_id)
    )
    select 1
    from parent_chain
    where goal_id = new.source_goal_id
  ) then
    raise exception 'Goal parent relation cannot create a cycle';
  end if;

  return new;
end;
$$;

revoke all on function app_private.prevent_goal_parent_cycle() from public;

drop trigger if exists prevent_goal_parent_cycle on public.goal_relations;
create trigger prevent_goal_parent_cycle
  before insert or update of source_goal_id, target_goal_id, relation_type, workspace_id
  on public.goal_relations
  for each row
  execute function app_private.prevent_goal_parent_cycle();
