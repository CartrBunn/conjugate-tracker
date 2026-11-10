-- Global exercise catalog (team_id null). Safe to re-run.
insert into public.exercises (team_id, name, family, unit, higher_is_better) values
  -- max-effort squat variations
  (null, 'Box Squat', 'squat', 'lb', true),
  (null, 'Box Squat vs Bands', 'squat', 'lb', true),
  (null, 'Back Squat', 'squat', 'lb', true),
  (null, 'Front Squat', 'squat', 'lb', true),
  -- max-effort bench variations
  (null, 'Bench Press', 'bench', 'lb', true),
  (null, 'Bench Press vs Bands', 'bench', 'lb', true),
  (null, 'Close Grip Bench Press', 'bench', 'lb', true),
  (null, 'Pause Bench Press', 'bench', 'lb', true),
  (null, 'Wide Grip Bench Press', 'bench', 'lb', true),
  (null, 'Larsen Press', 'bench', 'lb', true),
  (null, 'Floor Press', 'bench', 'lb', true),
  -- max-effort deadlift variations
  (null, 'Trap Bar Deadlift', 'deadlift', 'lb', true),
  (null, 'Sumo Deadlift', 'deadlift', 'lb', true),
  (null, 'Conventional Deadlift', 'deadlift', 'lb', true),
  -- dynamic-effort lifts (bar weight used)
  (null, 'Speed Box Squat', 'squat', 'lb', true),
  (null, 'Speed Bench Press', 'bench', 'lb', true),
  (null, 'Speed Deadlift', 'deadlift', 'lb', true),
  -- jump and throw tests
  (null, 'Broad Jump', 'jump', 'in', true),
  (null, 'Vertical Jump', 'jump', 'in', true),
  (null, 'MB Chest Pass', 'throw', 'ft', true),
  (null, 'MB Overhead Backward Throw', 'throw', 'ft', true)
on conflict do nothing;
