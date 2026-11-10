# Conjugate Tracker — App Spec

Status: agreed design, 2026-11-10. Athlete sign-in is specified separately in
[athlete-pin-sign-in.md](athlete-pin-sign-in.md).

## Problem

A strength coach runs a conjugate
program. Today the program is a static web page: athletes can see the day's session but
nothing is recorded. The coach wants to:

1. Organize athletes into **groups** (e.g. "Sprinters", "Throwers").
2. Choose, per training cycle, **which lifts/tests each group tracks**.
3. Have results logged (by athletes on their phones, or by the coach).
4. **Review each cycle**: who improved, by how much, who stalled, who showed up.

Constraints: hosting must be free or nearly free. Athletes are minors, so the app stores
**no athlete personal data at all**: each athlete is only a **number**, unique within the
team. The coach keeps the number → athlete list outside the app. Performance data is
therefore de-identified. (Decided 2026-11-10; replaces "first name + last initial".)

## Domain background (read this if you don't know conjugate training)

- A **program** is a list of **weeks**, grouped into **blocks** ("Block 1 · Build",
  "Block 2 · Load", "Block 3 · Sharpen"). The example program has 2 weeks; real programs are typically 12–15.
- Each week has 4 training **days**: Mon, Tue, Thu, Fri. Each day has a **type**:
  - `DL` dynamic-effort lower, `DU` dynamic-effort upper: speed work at a % of training max.
  - `ML` max-effort lower, `MU` max-effort upper: work up to a heavy single (`5–7 x 1`).
- Every day runs in order: **circuit** (4 plyo moves, 30 s each) → **main lift** → **GPP**
  (5 accessory moves, each with a category such as `Power`, `Post. Chain`, `Push/Tri`).
- The main lift has a **family** key: `squat`, `bench` or `deadlift`. On DE days `pct` is a
  number (45–60) and bar weight = training max × pct. On ME days `pct` is `null`.
- ME days rotate **variations** (box/back/front squat; bench, close-grip, pause, wide, Larsen,
  floor press; trap bar/sumo/conventional deadlift). Most variations appear **once per
  cycle**. Consequence for progress tracking:
  - **Within a cycle**, compare by **family**: each ME single as a % of that athlete's family
    training max at cycle start.
  - **Across cycles**, compare the **exact variation** (box squat this winter vs. last winter).

## Technical Plan

- **Frontend:** Vite + React 18 + TypeScript single-page app, `react-router-dom` with a
  **hash router** (`/#/coach/...`). GitHub Pages has no SPA fallback, so a path router would
  404 on refresh.
- **Hosting:** GitHub Pages, deployed by a GitHub Actions workflow on push to `main`.
- **Backend:** Supabase (free tier): Postgres + Auth + Row Level Security (RLS). There is no
  custom server. The browser uses the public anon key, and RLS plus `security definer`
  functions enforce every permission. No Edge Functions are needed.
- **Coach auth:** **email + password** (`signUp` / `signInWithPassword`), minimum 8
  characters. This works with Supabase's **default** email templates and built-in sender, so
  no custom SMTP is needed. With "Confirm email" on (the default), signup sends Supabase's
  stock confirmation link. Supabase verifies the address on its own server, then redirects
  to the Site URL; the app ignores any tokens in that redirect and the coach signs in with
  their password. Password reset is deferred (see Phases).
  - Changed 2026-11-10 from a 6-digit email code: showing a code needs `{{ .Token }}` in the
    email template, and Supabase only allows editing templates with custom SMTP.
- **Athlete auth:** Supabase anonymous sign-in + group join code + 4-digit PIN. See the
  sign-in spec.

### Free-tier caveat

Supabase pauses free projects after ~7 days with no activity. In the off-season the coach
must un-pause it from the dashboard, or a scheduled GitHub Action can ping the API weekly.
That ping is optional and not part of the MVP.

## Alternatives considered

| Option | Why not |
|---|---|
| Firebase | Document store fits relational data (athletes × cycles × lifts) poorly, and reviews need aggregate queries. |
| PocketBase / own server | Needs a host that is always on, which is not free. |
| localStorage only | Can't share data between athlete phones and the coach. |
| Coach email code (OTP) | Needs a custom email template, which needs custom SMTP. |
| Coach magic link | Its tokens arrive in the URL hash and clash with the hash router, and institutional mail scanners pre-click links, which uses them up. |
| Athlete email accounts | Kids don't reliably check email, and it means storing minors' emails. Rejected in favor of join code + PIN. |
| Athlete names (first + last initial) | Still personal data about minors. Replaced by athlete numbers so the app holds nothing that identifies a student. |
| Coach-only logging | Simpler and more private, but too slow with a full weight room. It still exists as a fallback: coaches can log for anyone. |

## Detailed Implementation

### Repository layout

```
docs/plans/                     specs (this file)
supabase/migrations/000N_*.sql   schema, RLS, functions; run in order (0001 → 0006)
supabase/seed/example-program.json example program (weeks + video links)
supabase/seed/exercises.sql         global exercise catalog
src/lib/supabase.ts             client (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
src/lib/program.ts              program types, date math, speed-weight math (unit tested)
src/lib/auth.tsx                session + role context ("coach" | "athlete" | "none")
src/pages/...                   screens
.github/workflows/deploy.yml    Pages deploy
```

### Data model (Postgres, schema `public`)

All ids are `uuid default gen_random_uuid()`. All tables have RLS enabled.

| Table | Columns | Notes |
|---|---|---|
| `teams` | id, name, created_at | |
| `team_coaches` | team_id → teams, user_id → auth.users, role (`owner`\|`coach`), PK(team_id,user_id) | Only non-anonymous users. |
| `groups` | id, team_id, name, join_code (unique, 8 chars), created_at | |
| `athletes` | id, team_id, group_id, number int (1–9999), active bool default true, created_at | Unique (team_id, number). **No name or other personal data.** No PIN columns here. (group_id, team_id) → groups(id, team_id) so an athlete can't point at another team's group. |
| `athlete_pins` | athlete_id PK, pin_hash, failed_attempts, locked_until | RLS on, **no policies**: only reachable through definer functions. |
| `athlete_devices` | user_id PK → auth.users (cascade), athlete_id, created_at, last_seen_at | Links an anonymous session to an athlete. |
| `programs` | id, team_id, name, weeks jsonb, videos jsonb, created_at | `weeks` = seed shape below. |
| `cycles` | id, team_id, group_id, program_id, name, start_date (a Monday), status (`planned`\|`active`\|`closed`) | |
| `exercises` | id, team_id null (null = global), name, family (`squat`\|`bench`\|`deadlift`\|`jump`\|`throw`\|`other`), unit (`lb`\|`in`\|`ft`\|`sec`\|`reps`), higher_is_better bool default true | Unique (team_id, name). |
| `tracked_lifts` | id, cycle_id, exercise_id, sort int | Unique (cycle_id, exercise_id). Chosen by the coach. |
| `training_maxes` | id, athlete_id, family, value numeric, set_on date, source (`coach`\|`me_single`) | Latest `set_on` wins. |
| `logs` | id, athlete_id, cycle_id, exercise_id, performed_on date, value numeric, reps int default 1, rpe numeric null, note text null, entered_by uuid default auth.uid(), created_at | |
| `reviews` | cycle_id, athlete_id, coach_note, next_goal, updated_at, PK(cycle_id, athlete_id) | Coach-only. |

`team_id` is copied onto child tables (athletes, cycles, programs) so RLS checks stay one
lookup.

### Program JSON shape (`programs.weeks`)

```ts
type DayType = "DL" | "DU" | "ML" | "MU";
type Family = "squat" | "bench" | "deadlift";
interface Move { name: string; rx: string }
interface GppMove extends Move { cat: string }
interface Day {
  day: "Mon" | "Tue" | "Thu" | "Fri";
  type: DayType;
  circuit: Move[];                    // 4 items
  main: { name: string; rx: string; key: Family; pct: number | null; note: string };
  gpp: GppMove[];                     // 5 items
}
interface Week { week: number; block: string; max: "Upper" | "Lower"; pct: number; days: Day[] }
```

Dates are **not** stored in the program. A day's date is computed from the cycle:
`date = cycle.start_date + 7*(week-1) + offset[day]`, offset Mon 0, Tue 1, Thu 3, Fri 4.
`programs.videos` is `{ [moveName]: url }`.

### Permissions (RLS summary)

Helper SQL functions (`security definer`, `stable`):
- `is_coach_of(team uuid) → bool`: a row exists in team_coaches for `auth.uid()`.
- `my_athlete() → uuid`: `athlete_devices.athlete_id` for `auth.uid()`, else null.
- `my_group() → uuid`: the group of `my_athlete()`.

| Table | Coach (of that team) | Athlete (claimed device) |
|---|---|---|
| teams | select | — |
| team_coaches | select | — |
| groups, athletes, programs, cycles, tracked_lifts, training_maxes, reviews | all | select **own** athlete row, own group, cycles of own group, programs of those cycles, tracked_lifts of those cycles, own training_maxes |
| exercises | all on own team's; select global | select global + own team's |
| logs | all | select/insert/update/delete where `athlete_id = my_athlete()` and the cycle belongs to `my_group()` |
| athlete_pins | none (functions only) | none |
| athlete_devices | select/delete for own team's athletes | select own |

Teams are created only through `create_team(name)`, which rejects anonymous users and makes
the caller `owner`.

### Screens

| Route | Who | MVP? | Content |
|---|---|---|---|
| `/#/` | anyone | ✅ | Two buttons: **I'm a coach**, **I'm an athlete**. Signed-in users are redirected to their home. |
| `/#/coach/login` | anyone | ✅ | Email + password; toggle to "Create account". |
| `/#/coach` | coach | ✅ | Teams; create team; groups list with join codes. |
| `/#/coach/groups/:id` | coach | ✅ | Roster by athlete number: add (auto or chosen number), deactivate, reset PIN, sign out phones, print number + PIN slips, rotate join code. |
| `/#/coach/groups/:id` (Cycles card) | coach | ✅ | List the group's cycles; start one from a program + start Monday (defaults to the next Monday). Status is `active` if it starts today or earlier, else `planned`. |
| `/#/coach/cycles/:id` | coach | ✅ | Status select; week × day chips linking to each day's grid (today highlighted, past dimmed) and a "Log today" button; tracked-lift picker grouped by family, showing how many program days each lift appears on, plus "+ All max-effort lifts in this program"; starting training maxes grid (athlete × squat/bench/deadlift, `set_on` = cycle start); **Delete cycle**, which confirms with the number of logged results, then deletes the cycle and, by cascade, its tracked lifts, logs and reviews. Training maxes and the program are kept. |
| `/#/coach/cycles/:id/log/:date` | coach | ✅ | **Logging grid** (below). |
| `/#/coach/cycles/:id/review` | coach | Phase 3 | Cycle review (below). |
| `/#/join` | anyone | ✅ | Athlete sign-in (see the sign-in spec). |
| `/#/me` | athlete | ✅ Phase 2 | **Today** (see "Athlete app" below). `?d=YYYY-MM-DD` selects another program day. |
| `/#/me/progress` | athlete | ✅ Phase 2 | **Progress**: current training maxes; one card per tracked lift with results showing first / best / change, a line chart and the full list. |

### Logic

- **Speed weight:** `round5(tm * pct / 100)`, where `round5(x) = Math.round(x / 5) * 5`, in lb.
  Uses the athlete's latest training max for `main.key` on or before the day's date.
- **What can be logged on a day:** tracked lifts whose exercise appears that day (main lift
  name or any GPP/circuit move name, exact match), plus any tracked `jump`/`throw` test on any
  day.
- **One value per cell:** `logs` is unique on (athlete_id, exercise_id, performed_on), and
  `training_maxes` on (athlete_id, family, set_on) (migration `0005_log_upserts.sql`). The
  value logged is the athlete's result for that lift that day: the top single on ME days,
  the bar weight used on DE days, or the best jump/throw.

### Logging grid (`/#/coach/cycles/:id/log/:date`)

- Header: previous/next **program day** links (they skip off days) and the date. Banner:
  week, block, day type, main lift, and its prescription, plus `@ pct%` on DE days.
- Rows: the group's active athletes by number. The first column stays put while the grid
  scrolls sideways inside its card; the page itself never scrolls sideways.
- Columns: `exercisesForDay(tracked, day)`. A **Show all tracked lifts** checkbox shows every
  tracked lift. On DE days a read-only **Bar** column shows `speedWeight(TM, pct)` for the
  main lift's family, or "no TM".
- Cells (`src/components/NumberCell.tsx`): numeric, save on blur. A value upserts on the
  unique key; an empty cell deletes the row. The border shows saving (gold), saved (green)
  or error (red, message in the tooltip). Enter moves to the same column in the next row.
- Count of athletes with at least one entry that day, e.g. "12/18 athletes".
- A date that isn't a program day shows "No training on this day in this cycle".

- **Training max update:** see "Athlete app" below.

### Athlete app (`/#/me`, `/#/me/progress`)

- **Which cycle** (`pickCycle` in `src/lib/athleteData.ts`): the group's cycle running today
  (active preferred), else the next one to start (shown as a preview), else the most recent
  that isn't closed, else the most recent. With no cycles: "Your coach hasn't started a
  training cycle".
- **Default day:** today if it's a program day, else the next program day, else the last.
  Previous/next arrows step through program days.
- **Today screen**, in lifting order and from the original static program page:
  1. **Plyo circuit:** a timer (`CircuitTimer`) running 2 rounds of 4 × 30 s work with 15 s
     changes and 60 s between rounds; it beeps at each change and keeps the screen awake
     while running. Each move has a Watch link from `programs.videos`.
  2. **Main lift** card: name, prescription (`@ pct%` on DE days, "work up to max" on ME
     days) and note. Calculator: on DE days the bar weight is `speedWeight(TM, pct)` using
     the athlete's training max from the database (no longer stored on the phone); with no
     TM it tells them to ask the coach.
  3. **Your results:** `exercisesForDay(tracked, day)` as numeric inputs that save on blur
     (upsert / delete on clear, the same key as the coach grid, so coach and athlete edit
     the same values). Disabled for future dates.
  4. **GPP** list with categories and Watch links, then the abbreviation key.
- **Raising a training max:** after saving a result on an ME day for a squat/bench/deadlift
  lift that beats the current TM, show "New best! Raise your <family> max from X to Y?".
  Confirming calls RPC `raise_training_max(family, value)` (migration `0006`). That function
  is security definer and only succeeds if the athlete has a logged result in that family
  ≥ value and value > the current TM. It inserts `training_maxes` with
  `set_on = current_date`, `source = 'me_single'`. Return values: `ok`, `not_higher`,
  `no_result`, `invalid`, `not_athlete`. Athletes still cannot write `training_maxes`
  directly.
- **Progress chart** (`LineChart`): one series, so no legend; 2px line, 8px markers with
  a surface ring, recessive grid, hover/tap tooltip with date and value, plus an
  "All results" table as the non-visual view.

### Cycle review (Phase 3)

For a cycle and each athlete × tracked lift, using `logs` in that cycle:
- `first` = value of earliest log; `best` = max value (min if `higher_is_better=false`);
  `change` = best − first; `change_pct` = change / first.
- **Family view:** for each family, best ME single in the cycle ÷ TM at cycle start.
- **Attendance:** distinct `performed_on` with ≥1 log ÷ program days from start_date through
  `min(today, last program day)`.
- **Flags:** `stalled` = ≥2 logs and best = first; `regressed` = latest log worse than first
  by >5%.
- Output: a sortable table per group, per-athlete coach note + next goal (`reviews`), print
  stylesheet, CSV export.

### Phases

1. **MVP:** schema and RLS, coach OTP login, teams/groups/athletes, program import from the
   seed JSON, cycles, tracked lifts, training maxes, coach logging grid, athlete sign-in.
2. **Athlete app:** ✅ done (2026-11-10).
3. **Cycle review.**
4. **Later:** program editor, copy cycle to another group, cross-cycle variation
   comparison, coach invites by email, anonymous-user cleanup job, inactivity ping, coach
   password reset (needs a reset-password screen; until then a coach can be reset from the
   Supabase dashboard → Authentication → Users).

### Configuration

- `.env.local` (not committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- GitHub repo → Settings → Secrets and variables → Actions → **Variables**: the same two
  names. The anon key is public by design.
- Vite `base` = `/<repo-name>/` (default `/conjugate-training/`, override with env
  `BASE_PATH`).
- Supabase dashboard: Auth → enable **Anonymous sign-ins**. Leave the Email provider and the
  email templates at their defaults. Set Auth → URL Configuration → **Site URL** to the
  deployed site (or `http://localhost:5180/conjugate-training/` while developing) so confirmation links land on
  the app.
