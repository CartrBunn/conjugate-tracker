-- Athletes are identified by number only. No names or other personal data are stored;
-- the coach keeps the number → athlete list outside the app.
-- Spec: docs/plans/athlete-pin-sign-in.md
-- Run once, after 0001–0003.

-- 1. Number column. Existing (test) athletes get 1, 2, 3… per team, oldest first.
alter table public.athletes add column number int;
update public.athletes a
set number = s.rn
from (select id, row_number() over (partition by team_id order by created_at, id) as rn from public.athletes) s
where a.id = s.id;
alter table public.athletes alter column number set not null;
alter table public.athletes add constraint athletes_number_range check (number between 1 and 9999);
alter table public.athletes add constraint athletes_team_number unique (team_id, number);

-- 2. Drop personal data. Functions that return names must go first.
drop function if exists public.group_roster(text);
drop function if exists public.add_athlete(uuid, text, int);
drop function if exists public.reset_group_pins(uuid);
drop function if exists public.claim_athlete(text, uuid, text);
alter table public.athletes drop column display_name;
alter table public.athletes drop column grad_year;

-- 3. Coach: add an athlete. Number defaults to the team's next free number.
create function public.add_athlete(p_group uuid, p_number int default null)
returns table (athlete_id uuid, number int, pin text)
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  n int;
  a uuid;
begin
  select g.team_id into t from groups g where g.id = p_group;
  perform assert_coach(t);
  -- Serialize number assignment per team.
  perform pg_advisory_xact_lock(hashtext(t::text));
  n := coalesce(p_number, (select coalesce(max(x.number), 0) + 1 from athletes x where x.team_id = t));
  if exists (select 1 from athletes x where x.team_id = t and x.number = n) then
    raise exception 'Athlete number % is already used on this team', n using errcode = 'unique_violation';
  end if;
  insert into athletes (team_id, group_id, number) values (t, p_group, n) returning id into a;
  return query select a, n, set_pin(a);
end;
$$;

-- 4. Coach: reset every PIN in a group (for the printed sheet).
create function public.reset_group_pins(p_group uuid)
returns table (athlete_id uuid, number int, pin text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_coach((select g.team_id from groups g where g.id = p_group));
  return query
    select a.id, a.number, set_pin(a.id)
    from athletes a where a.group_id = p_group and a.active
    order by a.number;
end;
$$;

-- 5. Athlete: claim this device with join code + athlete number + PIN.
--    Returns 'ok' | 'bad_pin' | 'locked' | 'not_found'. Never raises, so lockout updates commit.
create function public.claim_athlete(p_code text, p_number int, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  ath uuid;
  rec athlete_pins%rowtype;
begin
  if auth.uid() is null then
    return 'not_found';
  end if;

  select a.id into ath
  from athletes a join groups g on g.id = a.group_id
  where g.join_code = normalize_code(p_code) and a.number = p_number and a.active;
  if ath is null then
    return 'not_found';
  end if;

  select * into rec from athlete_pins where athlete_id = ath for update;
  if not found then
    return 'not_found';
  end if;

  if rec.locked_until is not null and rec.locked_until > now() then
    return 'locked';
  end if;

  if rec.pin_hash <> crypt(coalesce(p_pin, ''), rec.pin_hash) then
    if rec.failed_attempts + 1 >= 5 then
      update athlete_pins set failed_attempts = 0, locked_until = now() + interval '15 minutes'
        where athlete_id = ath;
      return 'locked';
    end if;
    update athlete_pins set failed_attempts = rec.failed_attempts + 1, locked_until = null
      where athlete_id = ath;
    return 'bad_pin';
  end if;

  update athlete_pins set failed_attempts = 0, locked_until = null where athlete_id = ath;
  insert into athlete_devices (user_id, athlete_id) values (auth.uid(), ath)
  on conflict (user_id) do update set athlete_id = excluded.athlete_id, last_seen_at = now();
  return 'ok';
end;
$$;

-- 6. Privileges: signed-in users only.
revoke all on function
  public.add_athlete(uuid, int), public.reset_group_pins(uuid), public.claim_athlete(text, int, text)
from public, anon;
grant execute on function
  public.add_athlete(uuid, int), public.reset_group_pins(uuid), public.claim_athlete(text, int, text)
to authenticated;
