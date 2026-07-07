delete from public.goal_relations
where relation_type <> 'parent';

alter table public.goal_relations
  drop constraint if exists goal_relations_relation_type_check;

alter table public.goal_relations
  add constraint goal_relations_relation_type_check
  check (relation_type = 'parent');
