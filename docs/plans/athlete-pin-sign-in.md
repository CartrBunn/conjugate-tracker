# Athlete Sign-In (Join Code + Athlete Number + PIN) — Spec

Status: agreed design, 2026-11-10; revised the same day to **athlete numbers instead of names**.
Part of [conjugate-tracker-app.md](conjugate-tracker-app.md). Implemented by migrations
`0001_init.sql` → `0002_grants.sql` → `0003_check_join_code.sql` → `0004_athlete_numbers.sql`.

## Problem

Athletes need to log their own lifts from their phones without email accounts.
The app must hold **no athlete personal data**: no names, emails or grad years. Each athlete
is a **number** (unique within the team); the coach keeps the number → kid list outside the
app. A lost phone or a forgotten PIN must be easy for the coach to fix.

## Technical Plan

1. The browser calls `supabase.auth.signInAnonymously()`. This gives a real Supabase session
   (role `authenticated`, JWT claim `is_anonymous = true`) with no email.
2. The athlete enters the group **join code**. RPC `check_join_code(code)` returns null when
   the code is wrong, `0` when the group has no athletes yet, and otherwise the number of
   athletes. It returns no identities.
3. The athlete enters their **athlete number** and **PIN**. RPC
   `claim_athlete(code, number, pin)` checks the PIN against a bcrypt hash and, on success,
   writes `athlete_devices(user_id = auth.uid(), athlete_id)`.
4. From then on, RLS uses `my_athlete()` (the lookup through `athlete_devices`) to scope
   everything. The session persists in the browser's storage, so the athlete stays signed in.

All PIN logic lives in Postgres `security definer` functions using `pgcrypto`. There are no
Edge Functions.

## Alternatives considered

- **Pick your name from a list:** this was the first design. Rejected because it requires
  storing names, and it shows the roster to anyone who has the join code.
- **One Supabase email/password user per athlete with a fake email:** Supabase requires
  passwords of at least 6 characters, PIN reset needs the admin API (a server), and it fills
  `auth.users` with fake emails. Rejected.
- **Custom JWT minted by an Edge Function:** more moving parts, and it needs JWT signing
  secrets to be handled. Rejected.
- **Number + PIN with no join code:** the join code scopes guessing to one group and lets
  the coach shut off new sign-ins by rotating it.

## Detailed Implementation

### Athlete numbers

- `athletes.number int not null`, 1–9999, unique per team (`athletes_team_number`).
- `add_athlete(group, number default null)`: a null number means the next free number,
  `max(number) + 1` within the team, taken under a per-team advisory lock. An explicit number
  that's already taken raises `unique_violation` with a readable message.
- The coach can change a number with a normal update on `athletes` (RLS: coach of team).
- Numbers are team-wide, so moving an athlete to another group keeps their number and logs.

### Join codes

- 8 characters from the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), generated
  by `gen_join_code()` using `gen_random_bytes`. Stored without separators.
- Shown as `XXXX-XXXX`. Input is normalized client-side **and** in SQL:
  `upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))`.
- The coach rotates a code with `rotate_join_code(group_id)`, from the group page or from
  each group row on the coach home page ("↻ New code"). Already-claimed devices keep working
  after a rotation; only new sign-ins need the new code.

### PINs

- 4 digits, generated server-side. `reset_athlete_pin(athlete_id) → text` returns the plain
  PIN **once** and stores `crypt(pin, gen_salt('bf'))`. The coach UI shows it immediately.
- PINs cannot be read back. "Print PIN sheet" therefore means "reset all PINs in this group
  and print the new ones", and the UI must say so. `reset_group_pins(group_id)` returns
  `(athlete_id, number, pin)` ordered by number. The sheet prints the join code once, then
  one "Athlete #N · PIN" slip per athlete.
- `add_athlete` returns `(athlete_id, number, pin)`.

### Lockout

In `athlete_pins`: after **5** consecutive wrong PINs, set `locked_until = now() + 15 min` and
reset `failed_attempts` to 0. While locked, `claim_athlete` returns `locked` without checking
the PIN. A correct PIN resets `failed_attempts`. Coach `reset_athlete_pin` clears the lock.

`claim_athlete` **returns a status string instead of raising an error**, so the
failed-attempt update commits.

Knowing whether a number exists in a group (`not_found` vs `bad_pin`) reveals nothing
personal, because numbers carry no identity.

### Functions (all `security definer`, `set search_path = public, extensions`)

| Function | Caller | Behavior |
|---|---|---|
| `check_join_code(p_code text) → int` | any authenticated | null = no such code; otherwise the count of active athletes in the group. |
| `claim_athlete(p_code text, p_number int, p_pin text) → text` | any authenticated | Returns `ok`, `bad_pin`, `locked` or `not_found` (no active athlete with that number in that code's group). On `ok`: upsert `athlete_devices` on `user_id`, so one device = one athlete and re-claiming switches athletes. |
| `release_device() → void` | athlete | Deletes own `athlete_devices` row ("Switch athlete"). The client then calls `signOut()`. |
| `add_athlete(p_group uuid, p_number int default null) → table(athlete_id uuid, number int, pin text)` | coach of team | Insert athlete + PIN. |
| `reset_athlete_pin(p_athlete uuid) → text` | coach of team | New PIN, clear lockout. |
| `reset_group_pins(p_group uuid) → table(athlete_id uuid, number int, pin text)` | coach of team | Resets every active athlete in the group. |
| `revoke_athlete_devices(p_athlete uuid) → int` | coach of team | Deletes the athlete's device rows and returns how many. |
| `rotate_join_code(p_group uuid) → text` | coach of team | New code. |

Coach-only functions raise `insufficient_privilege` when `is_coach_of(team)` is false.
`group_roster` (name list) existed in 0001 and was dropped in 0004.

### Client flow (`/#/join`)

1. Step **Code**: input with placeholder `XXXX-XXXX`. On submit: if there's no session, call
   `signInAnonymously()`, then `check_join_code`.
   - null → "Code not found… it may have been changed."
   - 0 → "That code is right, but your coach hasn't added any athletes to this group yet."
   - otherwise → step 2.
2. Step **Athlete**: athlete number + 4-digit PIN on one screen (both `inputmode="numeric"`,
   `autocomplete="off"`).
   - `ok` → go to `/#/me`.
   - `bad_pin` → "Wrong PIN".
   - `locked` → "Too many tries. Wait 15 minutes or ask your coach."
   - `not_found` → "No athlete with that number in this group."
3. Signed-in athlete: the page title is "Athlete #N". A **Switch athlete** control calls
   `release_device()` then `signOut()`.

Role detection (`src/lib/auth.tsx`): no session → `none`. Session with
`is_anonymous = false` → `coach`. Anonymous session with an `athlete_devices` row →
`athlete`. Anonymous without one → `none` (mid-join).

### Abuse and cleanup (later phase)

- Enable a CAPTCHA (Cloudflare Turnstile) for anonymous sign-ins in Supabase Auth settings.
- Daily `pg_cron` job: delete `auth.users` where `is_anonymous` and `created_at <
  now() - interval '1 day'` and there's no `athlete_devices` row.

### Acceptance checks (all verified in a local Supabase Postgres, 2026-11-10)

- A coach of team A cannot read team B's athletes, logs or groups, or add athletes to them.
- An anonymous user who hasn't claimed a device reads nothing; `check_join_code` reveals
  only a count.
- After claiming, an athlete sees only their own athlete row and can log only for
  themselves.
- `athlete_pins` is not readable by any API role.
- After 5 wrong PINs, even the correct PIN returns `locked` until the lock expires or the
  coach resets it.
- Duplicate athlete numbers within a team are rejected; auto-numbering continues from the
  highest number.
- `athletes` has no `display_name` or `grad_year` column.
