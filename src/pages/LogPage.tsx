import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import NumberCell from "../components/NumberCell";
import {
  DAY_TYPE_LABEL,
  dayOn,
  exercisesForDay,
  programDays,
  shortDate,
  speedWeight,
  trainingMaxOn,
  type ExerciseFamily,
  type TrainingMaxRow,
  type Week,
} from "../lib/program";
import { supabase } from "../lib/supabase";

// Spec: docs/plans/conjugate-tracker-app.md → "Logging grid".
interface Cycle {
  id: string;
  name: string;
  start_date: string;
  group_id: string;
  program_id: string;
}
interface Exercise {
  id: string;
  name: string;
  family: ExerciseFamily;
  unit: string;
}
interface Athlete {
  id: string;
  number: number;
}
interface LogRow {
  athlete_id: string;
  exercise_id: string;
  value: number;
}

export default function LogPage() {
  const { cycleId, date = "" } = useParams();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [tracked, setTracked] = useState<Exercise[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [maxes, setMaxes] = useState<TrainingMaxRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await supabase.from("cycles").select("id, name, start_date, group_id, program_id").eq("id", cycleId).single();
    if (c.error) return setError(c.error.message);
    setCycle(c.data);
    const [p, a, t] = await Promise.all([
      supabase.from("programs").select("weeks").eq("id", c.data.program_id).single(),
      supabase.from("athletes").select("id, number").eq("group_id", c.data.group_id).eq("active", true).order("number"),
      supabase.from("tracked_lifts").select("sort, exercises(id, name, family, unit)").eq("cycle_id", cycleId).order("sort"),
    ]);
    const firstError = [p, a, t].find((r) => r.error)?.error;
    if (firstError) return setError(firstError.message);
    setWeeks(p.data!.weeks as Week[]);
    setAthletes(a.data!);
    const ex = (t.data ?? [])
      .map((r) => r.exercises as unknown as Exercise | null)
      .filter((e): e is Exercise => !!e);
    setTracked(ex);
    const ids = a.data!.map((x) => x.id);
    if (ids.length) {
      const [l, m] = await Promise.all([
        supabase.from("logs").select("athlete_id, exercise_id, value").eq("cycle_id", cycleId).eq("performed_on", date),
        supabase.from("training_maxes").select("athlete_id, family, value, set_on").in("athlete_id", ids).lte("set_on", date),
      ]);
      if (l.error || m.error) return setError((l.error ?? m.error)!.message);
      setLogs(l.data as LogRow[]);
      setMaxes(m.data as TrainingMaxRow[]);
    } else {
      setLogs([]);
      setMaxes([]);
    }
  }, [cycleId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => (cycle ? programDays(weeks, cycle.start_date) : []), [weeks, cycle]);
  const idx = days.findIndex((d) => d.date === date);
  const prev = idx > 0 ? days[idx - 1] : days.filter((d) => d.date < date).at(-1);
  const next = idx >= 0 ? days[idx + 1] : days.find((d) => d.date > date);

  async function save(athleteId: string, exerciseId: string, value: number | null): Promise<string | null> {
    if (!cycle) return "No cycle";
    const key = { athlete_id: athleteId, exercise_id: exerciseId, performed_on: date };
    const { error } =
      value === null
        ? await supabase.from("logs").delete().match(key)
        : await supabase
            .from("logs")
            .upsert({ ...key, cycle_id: cycle.id, value, reps: 1 }, { onConflict: "athlete_id,exercise_id,performed_on" });
    if (error) return error.message;
    setLogs((cur) => {
      const rest = cur.filter((r) => !(r.athlete_id === athleteId && r.exercise_id === exerciseId));
      return value === null ? rest : [...rest, { athlete_id: athleteId, exercise_id: exerciseId, value }];
    });
    return null;
  }

  if (!cycle) return error ? <p className="err">{error}</p> : <p className="muted">Loading…</p>;

  const hit = weeks.length ? dayOn(weeks, cycle.start_date, date) : null;
  const columns = hit ? (showAll ? tracked : exercisesForDay(tracked, hit.day)) : tracked;
  const main = hit?.day.main;
  const speedPct = main?.pct ?? null;
  const valueOf = (a: string, e: string) => logs.find((l) => l.athlete_id === a && l.exercise_id === e)?.value ?? null;
  const loggedCount = new Set(logs.map((l) => l.athlete_id)).size;

  return (
    <>
      <Link to={`/coach/cycles/${cycle.id}`} className="small">
        ← {cycle.name}
      </Link>

      <div className="spread">
        {prev ? (
          <Link className="btn ghost" to={`/coach/cycles/${cycle.id}/log/${prev.date}`} aria-label="Previous training day">
            ← {shortDate(prev.date)}
          </Link>
        ) : (
          <span />
        )}
        <h1 style={{ textAlign: "center" }}>{date ? shortDate(date) : ""}</h1>
        {next ? (
          <Link className="btn ghost" to={`/coach/cycles/${cycle.id}/log/${next.date}`} aria-label="Next training day">
            {shortDate(next.date)} →
          </Link>
        ) : (
          <span />
        )}
      </div>

      {error && <p className="err">{error}</p>}

      {!hit ? (
        <p className="notice">No training on this day in this cycle.</p>
      ) : (
        <section className="lift-band">
          <span className="muted-ink small">
            Week {hit.week.week} · {hit.week.block} · {DAY_TYPE_LABEL[hit.day.type]}
          </span>
          <strong className="ln">{main!.name}</strong>
          <span className="rx">
            {main!.rx}
            {speedPct !== null && ` @ ${speedPct}%`}
          </span>
        </section>
      )}

      {hit && (
        <section className="card">
          <div className="spread">
            <h3>
              Results <span className="muted small">({loggedCount}/{athletes.length} athletes)</span>
            </h3>
            <label className="check" style={{ flex: "0 0 auto" }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              <span>Show all tracked lifts</span>
            </label>
          </div>

          {tracked.length === 0 ? (
            <p className="notice">
              No tracked lifts yet. <Link to={`/coach/cycles/${cycle.id}`}>Pick them on the cycle page.</Link>
            </p>
          ) : columns.length === 0 && speedPct === null ? (
            <p className="notice">
              None of this cycle's tracked lifts are in today's session. Tick “Show all tracked lifts” to log one anyway.
            </p>
          ) : athletes.length === 0 ? (
            <p className="muted">No active athletes in this group.</p>
          ) : (
            <>
              <div className="grid-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>#</th>
                      {speedPct !== null && <th title={`${speedPct}% of ${main!.key} training max`}>Bar ({main!.key})</th>}
                      {columns.map((e) => (
                        <th key={e.id}>
                          {e.name}
                          <small> {e.unit}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {athletes.map((a, r) => {
                      const tm = speedPct !== null ? trainingMaxOn(maxes, a.id, main!.key, date) : null;
                      return (
                        <tr key={a.id}>
                          <th>#{a.number}</th>
                          {speedPct !== null && (
                            <td className="bar">{tm ? `${speedWeight(tm, speedPct)} lb` : <span className="muted small">no TM</span>}</td>
                          )}
                          {columns.map((e, c) => (
                            <td key={e.id}>
                              <NumberCell
                                grid="log"
                                row={r}
                                col={c}
                                label={`Athlete ${a.number} ${e.name}`}
                                value={valueOf(a.id, e.id)}
                                onSave={(v) => save(a.id, e.id, v)}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted small">Saves when you leave a cell. Enter moves down. Clear a cell to delete it.</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
