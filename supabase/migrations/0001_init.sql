-- Conjugate Tracker: initial schema, RLS and functions.
-- Spec: docs/plans/conjugate-tracker-app.md, docs/plans/athlete-pin-sign-in.md
-- Run in Supabase → SQL Editor (or `supabase db push`).

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── tables ─────────────────────────

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.team_coaches (
  team_id uuid not null references public.teams on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'coach' check (role in ('owner', 'coach')),
  primary key (team_id, user_id)
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  name text not null check (length(trim(name)) > 0),
  join_code text not null unique,
  created_at timestamptz not null default now(),
  unique (id, team_id) -- lets children prove they belong to the same team
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  group_id uuid not null,
  display_name text not null check (length(trim(display_name)) > 0),
  grad_year int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (group_id, team_id) references public.groups (id, team_id) on delete cascade
);
create index on public.athletes (group_id);

-- Secrets: RLS on, no policies. Reachable only through security definer functions.
create table public.athlete_pins (
  athlete_id uuid primary key references public.athletes on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz
);

create table public.athlete_devices (
  user_id uuid primary key references auth.users on delete cascade,
  athlete_id uuid not null references public.athletes on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index on public.athlete_devices (athlete_id);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  name text not null,
  weeks jsonb not null,
  videos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, team_id)
);

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams on delete cascade,
  group_id uuid not null,
  program_id uuid not null,
  name text not null,
  start_date date not null check (extract(isodow from start_date) = 1), -- Monday
  status text not null default 'planned' check (status in ('planned', 'active', 'closed')),
  created_at timestamptz not null default now(),
  foreign key (group_id, team_id) references public.groups (id, team_id) on delete cascade,
  foreign key (program_id, team_id) references public.programs (id, team_id) on delete restrict
);
create index on public.cycles (group_id);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams on delete cascade, -- null = global catalog
  name text not null,
  family text not null check (family in ('squat', 'bench', 'deadlift', 'jump', 'throw', 'other')),
  unit text not null check (unit in ('lb', 'in', 'ft', 'sec', 'reps')),
  higher_is_better boolean not null default true
);
create unique index exercises_team_name on public.exercises (coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

create table public.tracked_lifts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles on delete cascade,
  exercise_id uuid not null references public.exercises on delete cascade,
  sort int not null default 0,
  unique (cycle_id, exercise_id)
);

create table public.training_maxes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes on delete cascade,
  family text not null check (family in ('squat', 'bench', 'deadlift')),
  value numeric not null check (value > 0),
  set_on date not null default current_date,
  source text not null default 'coach' check (source in ('coach', 'me_single'))
);
create index on public.training_maxes (athlete_id, family, set_on desc);

create table public.logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes on delete cascade,
  cycle_id uuid not null references public.cycles on delete cascade,
  exercise_id uuid not null references public.exercises on delete restrict,
  performed_on date not null,
  value numeric not null check (value >= 0),
  reps int not null default 1 check (reps > 0),
  rpe numeric check (rpe between 1 and 10),
  note text,
  entered_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index on public.logs (cycle_id, athlete_id);

create table public.reviews (
  cycle_id uuid not null references public.cycles on delete cascade,
  athlete_id uuid not null references public.athletes on delete cascade,
  coach_note text,
  next_goal text,
  updated_at timestamptz not null default now(),
  primary key (cycle_id, athlete_id)
);

-- ───────────────────────── helpers ─────────────────────────

create function public.is_coach_of(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_coaches where team_id = p_team and user_id = auth.uid());
$$;

create function public.my_athlete() returns uuid
language sql stable security definer set search_path = public as $$
  select athlete_id from athlete_devices where user_id = auth.uid();
$$;

create function public.my_group() returns uuid
language sql stable security definer set search_path = public as $$
  select a.group_id from athlete_devices d join athletes a on a.id = d.athlete_id
  where d.user_id = auth.uid() and a.active;
$$;

create function public.team_of_cycle(p_cycle uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from cycles where id = p_cycle;
$$;

create function public.team_of_athlete(p_athlete uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from athletes where id = p_athlete;
$$;

create function public.normalize_code(p_code text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create function public.gen_join_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  code text;
begin
  loop
    bytes := gen_random_bytes(8);
    code := '';
    for i in 0..7 loop
      code := code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from groups where join_code = code);
  end loop;
  return code;
end;
$$;

create function public.gen_pin() returns text
language sql volatile set search_path = public, extensions as $$
  select lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int & 2147483647) % 10000)::text, 4, '0');
$$;

-- New groups get a join code automatically.
-- BEFORE triggers run before the NOT NULL check, so inserts may omit join_code.
create function public.groups_set_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.join_code is null or new.join_code = '' then
    new.join_code := gen_join_code();
  end if;
  return new;
end;
$$;
create trigger groups_set_code before insert on public.groups
  for each row execute function public.groups_set_code();

-- ───────────────────────── RLS ─────────────────────────

alter table public.teams enable row level security;
alter table public.team_coaches enable row level security;
alter table public.groups enable row level security;
alter table public.athletes enable row level security;
alter table public.athlete_pins enable row level security;
alter table public.athlete_devices enable row level security;
alter table public.programs enable row level security;
alter table public.cycles enable row level security;
alter table public.exercises enable row level security;
alter table public.tracked_lifts enable row level security;
alter table public.training_maxes enable row level security;
alter table public.logs enable row level security;
alter table public.reviews enable row level security;

-- teams / team_coaches: read-only for coaches; writes through create_team().
create policy "coach reads team" on public.teams for select using (is_coach_of(id));
create policy "coach updates team" on public.teams for update using (is_coach_of(id));
create policy "coach reads coaches" on public.team_coaches for select using (is_coach_of(team_id));

-- groups
create policy "coach all groups" on public.groups for all
  using (is_coach_of(team_id)) with check (is_coach_of(team_id));
create policy "athlete reads own group" on public.groups for select using (id = my_group());

-- athletes (writes for new athletes go through add_athlete() so a PIN is created)
create policy "coach all athletes" on public.athletes for all
  using (is_coach_of(team_id)) with check (is_coach_of(team_id));
create policy "athlete reads self" on public.athletes for select using (id = my_athlete());

-- athlete_devices
create policy "coach reads devices" on public.athlete_devices for select
  using (is_coach_of(team_of_athlete(athlete_id)));
create policy "coach deletes devices" on public.athlete_devices for delete
  using (is_coach_of(team_of_athlete(athlete_id)));
create policy "athlete reads own device" on public.athlete_devices for select using (user_id = auth.uid());

-- programs
create policy "coach all programs" on public.programs for all
  using (is_coach_of(team_id)) with check (is_coach_of(team_id));
create policy "athlete reads programs of own cycles" on public.programs for select
  using (exists (select 1 from cycles c where c.program_id = programs.id and c.group_id = my_group()));

-- cycles
create policy "coach all cycles" on public.cycles for all
  using (is_coach_of(team_id)) with check (is_coach_of(team_id));
create policy "athlete reads own cycles" on public.cycles for select using (group_id = my_group());

-- exercises
create policy "read global exercises" on public.exercises for select
  using (team_id is null and auth.uid() is not null);
create policy "coach all team exercises" on public.exercises for all
  using (team_id is not null and is_coach_of(team_id))
  with check (team_id is not null and is_coach_of(team_id));
create policy "athlete reads team exercises" on public.exercises for select
  using (team_id is not null and team_id = team_of_athlete(my_athlete()));

-- tracked_lifts
create policy "coach all tracked" on public.tracked_lifts for all
  using (is_coach_of(team_of_cycle(cycle_id))) with check (is_coach_of(team_of_cycle(cycle_id)));
create policy "athlete reads tracked" on public.tracked_lifts for select
  using (exists (select 1 from cycles c where c.id = cycle_id and c.group_id = my_group()));

-- training_maxes
create policy "coach all maxes" on public.training_maxes for all
  using (is_coach_of(team_of_athlete(athlete_id))) with check (is_coach_of(team_of_athlete(athlete_id)));
create policy "athlete reads own maxes" on public.training_maxes for select using (athlete_id = my_athlete());

-- logs
create policy "coach all logs" on public.logs for all
  using (is_coach_of(team_of_cycle(cycle_id)))
  with check (is_coach_of(team_of_cycle(cycle_id)) and team_of_athlete(athlete_id) = team_of_cycle(cycle_id));
create policy "athlete own logs" on public.logs for all
  using (athlete_id = my_athlete())
  with check (
    athlete_id = my_athlete()
    and exists (select 1 from cycles c where c.id = cycle_id and c.group_id = my_group())
  );

-- reviews: coach only
create policy "coach all reviews" on public.reviews for all
  using (is_coach_of(team_of_cycle(cycle_id))) with check (is_coach_of(team_of_cycle(cycle_id)));

-- athlete_pins: intentionally no policies.

-- ───────────────────────── coach functions ─────────────────────────

create function public.assert_coach(p_team uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_team is null or not is_coach_of(p_team) then
    raise exception 'not a coach of this team' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create function public.create_team(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'coaches must sign in with email' using errcode = 'insufficient_privilege';
  end if;
  insert into teams (name) values (trim(p_name)) returning id into t;
  insert into team_coaches (team_id, user_id, role) values (t, auth.uid(), 'owner');
  return t;
end;
$$;

create function public.set_pin(p_athlete uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  pin text := gen_pin();
begin
  insert into athlete_pins (athlete_id, pin_hash, failed_attempts, locked_until)
  values (p_athlete, crypt(pin, gen_salt('bf')), 0, null)
  on conflict (athlete_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
  return pin;
end;
$$;
revoke all on function public.set_pin(uuid) from public, anon, authenticated;

create function public.add_athlete(p_group uuid, p_name text, p_grad_year int default null)
returns table (athlete_id uuid, pin text)
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  a uuid;
begin
  select team_id into t from groups where id = p_group;
  perform assert_coach(t);
  insert into athletes (team_id, group_id, display_name, grad_year)
  values (t, p_group, trim(p_name), p_grad_year) returning id into a;
  return query select a, set_pin(a);
end;
$$;

create function public.reset_athlete_pin(p_athlete uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  perform assert_coach(team_of_athlete(p_athlete));
  return set_pin(p_athlete);
end;
$$;

create function public.reset_group_pins(p_group uuid)
returns table (athlete_id uuid, display_name text, pin text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_coach((select team_id from groups where id = p_group));
  return query
    select a.id, a.display_name, set_pin(a.id)
    from athletes a where a.group_id = p_group and a.active
    order by a.display_name;
end;
$$;

create function public.revoke_athlete_devices(p_athlete uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  perform assert_coach(team_of_athlete(p_athlete));
  delete from athlete_devices where athlete_id = p_athlete;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function public.rotate_join_code(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text := gen_join_code();
begin
  perform assert_coach((select team_id from groups where id = p_group));
  update groups set join_code = c where id = p_group;
  return c;
end;
$$;

-- ───────────────────────── athlete sign-in functions ─────────────────────────

create function public.group_roster(p_code text)
returns table (athlete_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select a.id, a.display_name
  from groups g join athletes a on a.group_id = g.id
  where auth.uid() is not null
    and g.join_code = normalize_code(p_code)
    and a.active
  order by a.display_name;
$$;

create function public.claim_athlete(p_code text, p_athlete uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  rec athlete_pins%rowtype;
begin
  if auth.uid() is null then
    return 'not_found';
  end if;

  if not exists (
    select 1 from athletes a join groups g on g.id = a.group_id
    where a.id = p_athlete and a.active and g.join_code = normalize_code(p_code)
  ) then
    return 'not_found';
  end if;

  select * into rec from athlete_pins where athlete_id = p_athlete for update;
  if not found then
    return 'not_found';
  end if;

  if rec.locked_until is not null and rec.locked_until > now() then
    return 'locked';
  end if;

  if rec.pin_hash <> crypt(coalesce(p_pin, ''), rec.pin_hash) then
    if rec.failed_attempts + 1 >= 5 then
      update athlete_pins set failed_attempts = 0, locked_until = now() + interval '15 minutes'
        where athlete_id = p_athlete;
      return 'locked';
    end if;
    update athlete_pins set failed_attempts = rec.failed_attempts + 1, locked_until = null
      where athlete_id = p_athlete;
    return 'bad_pin';
  end if;

  update athlete_pins set failed_attempts = 0, locked_until = null where athlete_id = p_athlete;
  insert into athlete_devices (user_id, athlete_id) values (auth.uid(), p_athlete)
  on conflict (user_id) do update set athlete_id = excluded.athlete_id, last_seen_at = now();
  return 'ok';
end;
$$;

create function public.release_device() returns void
language sql security definer set search_path = public as $$
  delete from athlete_devices where user_id = auth.uid();
$$;

-- Internal helpers are not callable from the API.
revoke all on function public.gen_join_code() from public, anon, authenticated;
revoke all on function public.gen_pin() from public, anon, authenticated;
revoke all on function public.assert_coach(uuid) from public, anon, authenticated;

-- Everything the app calls requires a session (anonymous athletes count as authenticated).
revoke all on function
  public.create_team(text), public.add_athlete(uuid, text, int), public.reset_athlete_pin(uuid),
  public.reset_group_pins(uuid), public.revoke_athlete_devices(uuid), public.rotate_join_code(uuid),
  public.group_roster(text), public.claim_athlete(text, uuid, text), public.release_device()
from public, anon;
grant execute on function
  public.create_team(text), public.add_athlete(uuid, text, int), public.reset_athlete_pin(uuid),
  public.reset_group_pins(uuid), public.revoke_athlete_devices(uuid), public.rotate_join_code(uuid),
  public.group_roster(text), public.claim_athlete(text, uuid, text), public.release_device()
to authenticated;
