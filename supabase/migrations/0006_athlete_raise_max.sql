-- Athletes can't write training_maxes directly (coach-only table). This lets a signed-in
-- athlete raise their own training max for a family, but only up to a result they actually
-- logged for a lift in that family, and only upward.
-- Spec: docs/plans/conjugate-tracker-app.md → "Athlete app".
-- Run once, after 0001–0005.

create or replace function public.raise_training_max(p_family text, p_value numeric) returns text
language plpgsql security definer set search_path = public as $$
declare
  ath uuid := my_athlete();
  cur numeric;
begin
  if ath is null then
    return 'not_athlete';
  end if;
  if p_family not in ('squat', 'bench', 'deadlift') or p_value is null or p_value <= 0 then
    return 'invalid';
  end if;

  -- Must be backed by one of the athlete's own logged results in that family.
  if not exists (
    select 1 from logs l join exercises e on e.id = l.exercise_id
    where l.athlete_id = ath and e.family = p_family and l.value >= p_value
  ) then
    return 'no_result';
  end if;

  select value into cur from training_maxes
  where athlete_id = ath and family = p_family and set_on <= current_date
  order by set_on desc limit 1;
  if cur is not null and p_value <= cur then
    return 'not_higher';
  end if;

  insert into training_maxes (athlete_id, family, value, set_on, source)
  values (ath, p_family, p_value, current_date, 'me_single')
  on conflict (athlete_id, family, set_on)
    do update set value = greatest(training_maxes.value, excluded.value), source = 'me_single';
  return 'ok';
end;
$$;

revoke all on function public.raise_training_max(text, numeric) from public, anon;
grant execute on function public.raise_training_max(text, numeric) to authenticated;
