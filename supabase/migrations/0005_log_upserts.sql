-- The coach logging grid edits one cell per athlete × lift × day, and cycle setup edits one
-- starting training max per athlete × family × date. These unique indexes make that a rule
-- and let the app upsert (PostgREST on_conflict).
-- Spec: docs/plans/conjugate-tracker-app.md → "Logging grid".
-- Run once, after 0001–0004.

create unique index if not exists logs_one_per_day
  on public.logs (athlete_id, exercise_id, performed_on);

create unique index if not exists training_maxes_one_per_day
  on public.training_maxes (athlete_id, family, set_on);
