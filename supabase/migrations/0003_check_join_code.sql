-- Lets the join screen tell "wrong code" apart from "right code, but no athletes yet".
-- Returns null when no group has this code, otherwise the number of active athletes in it.
-- Safe to re-run.

create or replace function public.check_join_code(p_code text) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from athletes a where a.group_id = g.id and a.active)
  from groups g
  where auth.uid() is not null and g.join_code = normalize_code(p_code);
$$;

revoke all on function public.check_join_code(text) from public, anon;
grant execute on function public.check_join_code(text) to authenticated;
