import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import NumberCell from "../components/NumberCell";
import {
  DAY_TYPE_LABEL,
  localToday,
  programDays,
  shortDate,
  type ExerciseFamily,
  type Family,
  type TrainingMaxRow,
  type Week,
} from "../lib/program";
import { supabase } from "../lib/supabase";

// Spec: docs/plans/conjugate-tracker-app.md → Screens → /#/coach/cycles/:id
interface Cycle {
  id: string;
  name: string;
  start_date: string;
  status: "planned" | "active" | "closed";
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

const FAMILIES: Family[] = ["squat", "bench", "deadlift"];
const FAMILY_ORDER: ExerciseFamily[] = ["squat", "bench", "deadlift", "jump", "throw", "other"];

export default function CyclePage() {
  const { cycleId } = useParams();
  const navigate = useNavigate();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [groupName, setGroupName] = useState("");
  const [programName, setProgramName] = useState("");
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [maxes, setMaxes] = useState<TrainingMaxRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await supabase
      .from("cycles")
      .select("id, name, start_date, status, group_id, program_id")
      .eq("id", cycleId)
      .single();
    if (c.error) return setError(c.error.message);
    setCycle(c.data);
    const [g, p, a, ex, t] = await Promise.all([
      supabase.from("groups").select("name").eq("id", c.data.group_id).single(),
      supabase.from("programs").select("name, weeks").eq("id", c.data.program_id).single(),
      supabase.from("athletes").select("id, number").eq("group_id", c.data.group_id).eq("active", true).order("number"),
      supabase.from("exercises").select("id, name, family, unit").order("name"),
      supabase.from("tracked_lifts").select("exercise_id").eq("cycle_id", cycleId),
    ]);
    const firstError = [g, p, a, ex, t].find((r) => r.error)?.error;
    if (firstError) return setError(firstError.message);
    setGroupName(g.data!.name);
    setProgramName(p.data!.name);
    setWeeks(p.data!.weeks as Week[]);
    setAthletes(a.data!);
    setExercises(ex.data as Exercise[]);
    setTracked(new Set(t.data!.map((r) => r.exercise_id)));
    const ids = a.data!.map((x) => x.id);
    if (ids.length) {
      const m = await supabase.from("training_maxes").select("athlete_id, family, value, set_on").in("athlete_id", ids);
      if (m.error) return setError(m.error.message);
      setMaxes(m.data as TrainingMaxRow[]);
    }
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => (cycle ? programDays(weeks, cycle.start_date) : []), [weeks, cycle]);
  const today = localToday();

  // How many program days each exercise appears on, by exact name.
  const appearances = useMemo(() => {
    const n = new Map<string, number>();
    for (const { day } of days) {
      for (const name of new Set([day.main.name, ...day.circuit.map((m) => m.name), ...day.gpp.map((m) => m.name)]))
        n.set(name, (n.get(name) ?? 0) + 1);
    }
    return n;
  }, [days]);

  const meLiftNames = useMemo(
    () => new Set(days.filter(({ day }) => day.main.pct === null).map(({ day }) => day.main.name)),
    [days],
  );

  async function setTrackedFor(ids: string[], on: boolean) {
    if (!cycle || ids.length === 0) return;
    const { error } = on
      ? await supabase.from("tracked_lifts").upsert(
          ids.map((exercise_id) => ({ cycle_id: cycle.id, exercise_id })),
          { onConflict: "cycle_id,exercise_id", ignoreDuplicates: true },
        )
      : await supabase.from("tracked_lifts").delete().eq("cycle_id", cycle.id).in("exercise_id", ids);
    if (error) return setError(error.message);
    setTracked((cur) => {
      const next = new Set(cur);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  async function setStatus(status: Cycle["status"]) {
    if (!cycle) return;
    const { error } = await supabase.from("cycles").update({ status }).eq("id", cycle.id);
    if (error) return setError(error.message);
    setCycle({ ...cycle, status });
  }

  async function deleteCycle() {
    if (!cycle) return;
    const { count, error: countError } = await supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("cycle_id", cycle.id);
    if (countError) return setError(countError.message);
    const logged = count ?? 0;
    const warning =
      logged > 0
        ? `Delete "${cycle.name}"? This permanently deletes its ${logged} logged result${logged === 1 ? "" : "s"} and its tracked-lift list. This can't be undone.`
        : `Delete "${cycle.name}"? It has no logged results. This can't be undone.`;
    if (!confirm(warning)) return;
    // tracked_lifts, logs and reviews are removed by ON DELETE CASCADE.
    const { error } = await supabase.from("cycles").delete().eq("id", cycle.id);
    if (error) return setError(error.message);
    navigate(`/coach/groups/${cycle.group_id}`, { replace: true });
  }

  async function saveMax(athleteId: string, family: Family, value: number | null): Promise<string | null> {
    if (!cycle) return "No cycle";
    const set_on = cycle.start_date;
    const { error } =
      value === null
        ? await supabase.from("training_maxes").delete().match({ athlete_id: athleteId, family, set_on })
        : await supabase
            .from("training_maxes")
            .upsert({ athlete_id: athleteId, family, value, set_on, source: "coach" }, { onConflict: "athlete_id,family,set_on" });
    if (error) return error.message;
    setMaxes((cur) => {
      const rest = cur.filter((r) => !(r.athlete_id === athleteId && r.family === family && r.set_on === set_on));
      return value === null ? rest : [...rest, { athlete_id: athleteId, family, value, set_on }];
    });
    return null;
  }

  if (!cycle) return error ? <p className="err">{error}</p> : <p className="muted">Loading…</p>;

  const startMax = (athleteId: string, family: Family) =>
    maxes.find((r) => r.athlete_id === athleteId && r.family === family && r.set_on === cycle.start_date)?.value ?? null;
  const todayDay = days.find((d) => d.date === today);
  const meIds = exercises.filter((e) => meLiftNames.has(e.name)).map((e) => e.id);
  const byWeek = weeks.map((w) => ({ week: w, days: days.filter((d) => d.week.week === w.week) }));

  return (
    <>
      <Link to={`/coach/groups/${cycle.group_id}`} className="small">
        ← {groupName}
      </Link>
      <div className="spread">
        <div>
          <h1>{cycle.name}</h1>
          <p className="muted small">
            {programName} · {days.length ? `${shortDate(days[0].date)} → ${shortDate(days.at(-1)!.date)}` : "no days"}
          </p>
        </div>
        <select value={cycle.status} onChange={(e) => setStatus(e.target.value as Cycle["status"])} style={{ width: "auto" }}>
          <option value="planned">Planned</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      {error && <p className="err">{error}</p>}

      <section className="card">
        <div className="spread">
          <h3>Log a day</h3>
          {todayDay && (
            <Link className="btn solid" to={`/coach/cycles/${cycle.id}/log/${today}`}>
              Log today
            </Link>
          )}
        </div>
        {tracked.size === 0 && <p className="notice small">Pick tracked lifts below first — they become the grid's columns.</p>}
        <div className="weeks-grid">
          {byWeek.map(({ week, days: wd }) => (
            <div key={week.week} className="week-row">
              <span className="wk-label">
                Wk {week.week}
                <small>{week.block.replace(/^Block \d+ · /, "")}</small>
              </span>
              {wd.map(({ date, day }) => (
                <Link
                  key={date}
                  to={`/coach/cycles/${cycle.id}/log/${date}`}
                  className="day-chip"
                  data-today={date === today || undefined}
                  data-past={date < today || undefined}
                  title={`${shortDate(date)} · ${DAY_TYPE_LABEL[day.type]} · ${day.main.name}`}
                >
                  <b>{day.day}</b>
                  <span>{day.type}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="spread">
          <h3>Tracked lifts ({tracked.size})</h3>
          {meIds.some((id) => !tracked.has(id)) && (
            <button className="btn" onClick={() => setTrackedFor(meIds, true)}>
              + All max-effort lifts in this program
            </button>
          )}
        </div>
        <p className="muted small">
          These become columns in the logging grid on the days they're in the session. Jumps and throws show every day.
        </p>
        {FAMILY_ORDER.map((fam) => {
          const list = exercises.filter((e) => e.family === fam);
          if (!list.length) return null;
          return (
            <fieldset key={fam} className="fam">
              <legend>{fam}</legend>
              {list.map((e) => (
                <label key={e.id} className="check">
                  <input type="checkbox" checked={tracked.has(e.id)} onChange={(ev) => setTrackedFor([e.id], ev.target.checked)} />
                  <span>{e.name}</span>
                  <small className="muted">
                    {appearances.get(e.name) ? `${appearances.get(e.name)} day${appearances.get(e.name) === 1 ? "" : "s"}` : e.family === "jump" || e.family === "throw" ? "any day" : "not in program"}
                  </small>
                </label>
              ))}
            </fieldset>
          );
        })}
      </section>

      <section className="card">
        <h3>Starting training maxes (lb)</h3>
        <p className="muted small">
          Set on {shortDate(cycle.start_date)}. Speed-day bar weights use these. Press Enter to move down.
        </p>
        {athletes.length === 0 ? (
          <p className="muted">No active athletes in this group.</p>
        ) : (
          <div className="grid-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>#</th>
                  {FAMILIES.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {athletes.map((a, r) => (
                  <tr key={a.id}>
                    <th>#{a.number}</th>
                    {FAMILIES.map((f, c) => (
                      <td key={f}>
                        <NumberCell
                          grid="tm"
                          row={r}
                          col={c}
                          label={`Athlete ${a.number} ${f} training max`}
                          value={startMax(a.id, f)}
                          onSave={(v) => saveMax(a.id, f, v)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card danger">
        <h3>Delete cycle</h3>
        <p className="muted small">
          Removes this cycle, its tracked lifts and every result logged in it. Athletes, starting training maxes and the
          program stay. You can't undo this.
        </p>
        <button className="btn danger" onClick={deleteCycle}>
          Delete this cycle
        </button>
      </section>
    </>
  );
}
