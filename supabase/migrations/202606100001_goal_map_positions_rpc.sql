create or replace function public.set_goal_map_positions(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_map_context_id text,
  p_positions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context_id text := btrim(coalesce(p_map_context_id, ''));
  v_goal_ids text[];
  v_missing_id text;
  v_entity_id uuid;
  v_updated_count integer := 0;
begin
  if v_context_id = '' then
    raise exception 'Map context is required';
  end if;
  if jsonb_typeof(p_positions) is distinct from 'array' then
    raise exception 'Goal positions are required';
  end if;

  drop table if exists pg_temp.tmp_goal_map_position_updates;
  create temporary table tmp_goal_map_position_updates (
    legacy_id text primary key,
    position jsonb not null
  ) on commit drop;

  insert into tmp_goal_map_position_updates (legacy_id, position)
  select legacy_id, position
  from (
    select distinct on (legacy_id)
      legacy_id,
      jsonb_build_object(
        'x', ((item -> 'position' ->> 'x')::double precision),
        'y', ((item -> 'position' ->> 'y')::double precision)
      ) as position,
      ord
    from (
      select
        btrim(item ->> 'id') as legacy_id,
        item,
        ord
      from jsonb_array_elements(p_positions) with ordinality as entries(item, ord)
      where btrim(coalesce(item ->> 'id', '')) <> ''
    ) raw
    order by legacy_id, ord desc
  ) latest;

  select array_agg(legacy_id order by legacy_id)
  into v_goal_ids
  from tmp_goal_map_position_updates;

  if coalesce(array_length(v_goal_ids, 1), 0) = 0 then
    raise exception 'Goal positions are required';
  end if;

  select updates.legacy_id
  into v_missing_id
  from tmp_goal_map_position_updates updates
  where not exists (
    select 1
    from public.goals goals
    where goals.workspace_id = p_workspace_id
      and goals.legacy_id = updates.legacy_id
  )
  order by updates.legacy_id
  limit 1;

  if v_missing_id is not null then
    raise exception 'Goal not found: %', v_missing_id;
  end if;

  drop table if exists pg_temp.tmp_goal_map_position_updated_ids;
  create temporary table tmp_goal_map_position_updated_ids (
    id uuid primary key
  ) on commit drop;

  with updated as (
    update public.goals goals
    set
      map_positions = jsonb_set(coalesce(goals.map_positions, '{}'::jsonb), array[v_context_id], updates.position, true),
      updated_at = now()
    from tmp_goal_map_position_updates updates
    where goals.workspace_id = p_workspace_id
      and goals.legacy_id = updates.legacy_id
    returning goals.id
  )
  insert into tmp_goal_map_position_updated_ids (id)
  select id from updated;

  select count(*) into v_updated_count from tmp_goal_map_position_updated_ids;
  select id into v_entity_id from tmp_goal_map_position_updated_ids limit 1;

  if v_updated_count > 0 then
    insert into public.audit_events (
      workspace_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      payload
    )
    values (
      p_workspace_id,
      p_actor_user_id,
      'goal.map_positions.set',
      'goal',
      v_entity_id::text,
      jsonb_build_object(
        'ids', to_jsonb(v_goal_ids),
        'mapContextId', v_context_id,
        'updatedCount', v_updated_count
      )
    );

    insert into public.sync_jobs (
      workspace_id,
      kind,
      status,
      payload
    )
    values (
      p_workspace_id,
      'github_export_pending',
      'pending',
      jsonb_build_object(
        'reason', 'goal.map_positions.set',
        'entityId', v_entity_id::text
      )
    );
  end if;

  return jsonb_build_object('updatedCount', v_updated_count);
end;
$$;

revoke all on function public.set_goal_map_positions(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_goal_map_positions(uuid, uuid, text, jsonb) to service_role;

create or replace function public.clear_goal_map_positions(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_map_context_id text,
  p_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context_id text := btrim(coalesce(p_map_context_id, ''));
  v_goal_ids text[];
  v_missing_id text;
  v_entity_id uuid;
  v_updated_count integer := 0;
begin
  if v_context_id = '' then
    raise exception 'Map context is required';
  end if;
  if jsonb_typeof(p_ids) is distinct from 'array' then
    raise exception 'Goal ids are required';
  end if;

  drop table if exists pg_temp.tmp_goal_map_position_ids;
  create temporary table tmp_goal_map_position_ids (
    legacy_id text primary key
  ) on commit drop;

  insert into tmp_goal_map_position_ids (legacy_id)
  select distinct btrim(value)
  from jsonb_array_elements_text(p_ids) as entries(value)
  where btrim(value) <> '';

  select array_agg(legacy_id order by legacy_id)
  into v_goal_ids
  from tmp_goal_map_position_ids;

  if coalesce(array_length(v_goal_ids, 1), 0) = 0 then
    raise exception 'Goal ids are required';
  end if;

  select ids.legacy_id
  into v_missing_id
  from tmp_goal_map_position_ids ids
  where not exists (
    select 1
    from public.goals goals
    where goals.workspace_id = p_workspace_id
      and goals.legacy_id = ids.legacy_id
  )
  order by ids.legacy_id
  limit 1;

  if v_missing_id is not null then
    raise exception 'Goal not found: %', v_missing_id;
  end if;

  drop table if exists pg_temp.tmp_goal_map_position_cleared_ids;
  create temporary table tmp_goal_map_position_cleared_ids (
    id uuid primary key
  ) on commit drop;

  with updated as (
    update public.goals goals
    set
      map_positions = nullif(coalesce(goals.map_positions, '{}'::jsonb) - v_context_id, '{}'::jsonb),
      map_x = case when v_context_id = 'root' then null::double precision else goals.map_x end,
      map_y = case when v_context_id = 'root' then null::double precision else goals.map_y end,
      updated_at = now()
    from tmp_goal_map_position_ids ids
    where goals.workspace_id = p_workspace_id
      and goals.legacy_id = ids.legacy_id
      and (
        coalesce(goals.map_positions, '{}'::jsonb) ? v_context_id
        or (v_context_id = 'root' and (goals.map_x is not null or goals.map_y is not null))
      )
    returning goals.id
  )
  insert into tmp_goal_map_position_cleared_ids (id)
  select id from updated;

  select count(*) into v_updated_count from tmp_goal_map_position_cleared_ids;
  select id into v_entity_id from tmp_goal_map_position_cleared_ids limit 1;

  if v_updated_count > 0 then
    insert into public.audit_events (
      workspace_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      payload
    )
    values (
      p_workspace_id,
      p_actor_user_id,
      'goal.map_positions.clear',
      'goal',
      v_entity_id::text,
      jsonb_build_object(
        'ids', to_jsonb(v_goal_ids),
        'mapContextId', v_context_id,
        'updatedCount', v_updated_count
      )
    );

    insert into public.sync_jobs (
      workspace_id,
      kind,
      status,
      payload
    )
    values (
      p_workspace_id,
      'github_export_pending',
      'pending',
      jsonb_build_object(
        'reason', 'goal.map_positions.clear',
        'entityId', v_entity_id::text
      )
    );
  end if;

  return jsonb_build_object('updatedCount', v_updated_count);
end;
$$;

revoke all on function public.clear_goal_map_positions(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.clear_goal_map_positions(uuid, uuid, text, jsonb) to service_role;
