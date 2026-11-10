-- Explicit privileges. Newer Supabase projects don't give the API roles access to new tables
-- and functions automatically, so 0001 alone leaves signed-in users with "permission denied".
-- RLS (in 0001) still decides which rows each user sees; these grants only open the doors.
-- Safe to re-run.

-- Signed-out visitors (anon) get nothing. Everyone who uses the app is `authenticated`:
-- coaches (email) and athletes (anonymous sign-in).
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.teams, public.team_coaches, public.groups, public.athletes, public.athlete_devices,
  public.programs, public.cycles, public.exercises, public.tracked_lifts,
  public.training_maxes, public.logs, public.reviews
to authenticated;

-- PIN hashes: no direct access for anyone; only security definer functions touch this table.
revoke all on public.athlete_pins from anon, authenticated;

-- Helpers that RLS policies call run as the querying user, so they need execute.
grant execute on function
  public.is_coach_of(uuid), public.my_athlete(), public.my_group(),
  public.team_of_cycle(uuid), public.team_of_athlete(uuid), public.normalize_code(text)
to authenticated;

-- App RPCs (repeated from 0001 so this file stands alone).
grant execute on function
  public.create_team(text), public.add_athlete(uuid, text, int), public.reset_athlete_pin(uuid),
  public.reset_group_pins(uuid), public.revoke_athlete_devices(uuid), public.rotate_join_code(uuid),
  public.group_roster(text), public.claim_athlete(text, uuid, text), public.release_device()
to authenticated;
