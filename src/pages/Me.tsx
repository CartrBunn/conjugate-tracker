import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import CircuitTimer from "../components/CircuitTimer";
import NumberCell from "../components/NumberCell";
import { useAthleteData } from "../lib/athleteData";
import { useAuth } from "../lib/auth";
import {
  DAY_TYPE_LABEL,
  exercisesForDay,
  localToday,
  programDays,
  shortDate,
  speedWeight,
  trainingMaxOn,
  type Family,
} from "../lib/program";
import { supabase } from "../lib/supabase";

// Athlete "Today" screen. Spec: docs/plans/conjugate-tracker-app.md → "Athlete app".
// Layout: circuit → main lift → your results → GPP.

const FULL_DAY = { Mon: "Monday", Tue: "Tuesday", Thu: "Thursday", Fri: "Friday" } as const;
const BIG3: Family[] = ["squat", "bench", "deadlift"];

export function AthleteTabs({ active }: { active: "today" | "progress" }) {
  return (
    <nav className="tabs" aria-label="Athlete pages">
      <Link to="/me" aria-current={active === "today" ? "page" : undefined}>
        Today
      </Link>
      <Link to="/me/progress" aria-current={active === "progress" ? "page" : undefined}>
        Progress
      </Link>
    </nav>
  );
}

function Watch({ url, name }: { url?: string; name: string }) {
  if (!url) return null;
  return (
    <a className="act" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Watch ${name}`}>
      Watch
    </a>
  );
}

export default function Me() {
  const { athlete } = useAuth();
  const data = useAthleteData();
  const { cycle, weeks, videos, tracked, logs, maxes, setLogs, reload } = data;
  const [params, setParams] = useSearchParams();
  const [raise, setRaise] = useState<{ family: Family; value: number; from: number | null } | null>(null);
  const [raiseMsg, setRaiseMsg] = useState<string | null>(null);
  const today = localToday();

  const days = useMemo(() => (cycle ? programDays(weeks, cycle.start_date) : []), [weeks, cycle]);
  const defaultDate = days.find((d) => d.date >= today)?.date ?? days.at(-1)?.date ?? today;
  const date = params.get("d") ?? defaultDate;
  const idx = days.findIndex((d) => d.date === date);
  const cur = idx >= 0 ? days[idx] : null;
  const prev = days.filter((d) => d.date < date).at(-1);
  const next = days.find((d) => d.date > date);
  const go = (d: string) => {
    setRaise(null);
    setRaiseMsg(null);
    setParams(d === defaultDate ? {} : { d }, { replace: true });
  };

  if (data.loading) return <p className="muted">Loading…</p>;

  const header = (
    <div className="spread">
      <h1>Athlete #{athlete?.number}</h1>
      <AthleteTabs active="today" />
    </div>
  );

  if (data.error)
    return (
      <>
        {header}
        <p className="err">{data.error}</p>
      </>
    );

  if (!cycle || !days.length)
    return (
      <>
        {header}
        <p className="notice">Your coach hasn't started a training cycle for your group yet. Check back soon.</p>
      </>
    );

  const day = cur?.day;
  const main = day?.main;
  const canLog = date <= today;
  const columns = day ? exercisesForDay(tracked, day) : [];
  const valueOf = (exerciseId: string) => logs.find((l) => l.exercise_id === exerciseId && l.performed_on === date)?.value ?? null;
  const tm = main ? trainingMaxOn(maxes, athlete!.id, main.key, date) : null;

  async function save(exerciseId: string, family: string, value: number | null): Promise<string | null> {
    if (!cycle || !athlete) return "Not signed in";
    const key = { athlete_id: athlete.id, exercise_id: exerciseId, performed_on: date };
    const { error } =
      value === null
        ? await supabase.from("logs").delete().match(key)
        : await supabase
            .from("logs")
            .upsert({ ...key, cycle_id: cycle.id, value, reps: 1 }, { onConflict: "athlete_id,exercise_id,performed_on" });
    if (error) return error.message;
    setLogs((cur) => {
      const rest = cur.filter((l) => !(l.exercise_id === exerciseId && l.performed_on === date));
      return value === null ? rest : [...rest, { exercise_id: exerciseId, performed_on: date, value }];
    });
    // A max-effort result above the current training max → offer to raise it.
    if (value !== null && main && main.pct === null && (BIG3 as string[]).includes(family)) {
      const fam = family as Family;
      const current = trainingMaxOn(maxes, athlete.id, fam, today);
      if (current === null || value > current) setRaise({ family: fam, value, from: current });
    }
    return null;
  }

  async function confirmRaise() {
    if (!raise) return;
    const { data: status, error } = await supabase.rpc("raise_training_max", { p_family: raise.family, p_value: raise.value });
    if (error) return setRaiseMsg(error.message);
    if (status === "ok") {
      setRaiseMsg(`Your ${raise.family} max is now ${raise.value} lb. Speed days will use it.`);
      setRaise(null);
      reload();
    } else {
      setRaiseMsg(status === "not_higher" ? "That's not higher than your current max." : "Couldn't update your max.");
      setRaise(null);
    }
  }

  return (
    <>
      {header}

      <div className="daynav">
        <button className="btn ghost" disabled={!prev} onClick={() => prev && go(prev.date)} aria-label="Previous training day">
          ←
        </button>
        <div className="daynav-mid">
          <strong>{cur ? `${FULL_DAY[cur.day.day]}, ${shortDate(date).replace(/^\w+ /, "")}` : shortDate(date)}</strong>
          <span className="muted small">
            {cur ? `Week ${cur.week.week} of ${weeks.length} · ${cur.week.block}` : "No training this day"}
          </span>
        </div>
        <button className="btn ghost" disabled={!next} onClick={() => next && go(next.date)} aria-label="Next training day">
          →
        </button>
      </div>
      {date !== defaultDate && (
        <button className="btn ghost small" style={{ alignSelf: "center" }} onClick={() => go(defaultDate)}>
          Back to {defaultDate === today ? "today" : "next session"}
        </button>
      )}
      {cycle.start_date > today && (
        <p className="notice small">
          {cycle.name} starts {shortDate(cycle.start_date)}. Here's a preview.
        </p>
      )}

      {!day || !main ? (
        <p className="notice">No training on this day.</p>
      ) : (
        <>
          <div className="dayhead">
            <span className={`badge${main.pct === null ? " max" : ""}`}>{DAY_TYPE_LABEL[day.type]}</span>
          </div>

          <section className="sess">
            <div className="sechead">
              <h3>Plyo circuit</h3>
              <span>4 × 30 sec · 2 rounds</span>
            </div>
            <CircuitTimer circuit={day.circuit} />
            <ol className="moves">
              {day.circuit.map((c, i) => (
                <li key={c.name + i} className="mv">
                  <span className="num">{i + 1}</span>
                  <div>
                    <div className="name">{c.name}</div>
                    <div className="rx">{c.rx}</div>
                  </div>
                  <Watch url={videos[c.name]} name={c.name} />
                </li>
              ))}
            </ol>
          </section>

          <section className="sess">
            <div className="sechead">
              <h3>Main lift</h3>
              <span>{main.pct === null ? "Max effort" : "Dynamic effort"}</span>
            </div>
            <div className="lift">
              <div className="ln">{main.name}</div>
              <div className="rxbig">{main.pct === null ? `${main.rx} · work up to max` : `${main.rx} @ ${main.pct}%`}</div>
              <div className="note">{main.note}</div>
              <Watch url={videos[main.name]} name={main.name} />
            </div>
            <div className="calc">
              {main.pct !== null ? (
                tm ? (
                  <div className="out">
                    {speedWeight(tm, main.pct)} lb
                    <small>
                      Bar weight · {main.pct}% of your {main.key} max ({tm}), rounded to 5
                    </small>
                  </div>
                ) : (
                  <p className="muted small">Your coach hasn't set your {main.key} max yet, so there's no bar weight. Ask them.</p>
                )
              ) : (
                <p className="muted small">
                  {tm ? `Your ${main.key} max is ${tm} lb. ` : ""}Work up to a heavy single and log your best below.
                </p>
              )}
            </div>
          </section>

          {columns.length > 0 && (
            <section className="sess">
              <div className="sechead">
                <h3>Your results</h3>
                <span>{canLog ? "saves automatically" : `opens ${shortDate(date)}`}</span>
              </div>
              <ul className="results">
                {columns.map((e, r) => (
                  <li key={e.id}>
                    <div className="what">
                      <span className="name">{e.name}</span>
                      <small className="muted">
                        {e.family === "jump" || e.family === "throw"
                          ? `best ${e.family}, ${e.unit}`
                          : e.name === main.name && main.pct === null
                            ? "heaviest single, lb"
                            : e.name === main.name
                              ? "bar weight used, lb"
                              : e.unit}
                      </small>
                    </div>
                    <NumberCell
                      grid="me"
                      row={r}
                      col={0}
                      label={`${e.name} result`}
                      value={valueOf(e.id)}
                      disabled={!canLog}
                      placeholder={canLog ? "" : "—"}
                      onSave={(v) => save(e.id, e.family, v)}
                    />
                  </li>
                ))}
              </ul>
              {raise && (
                <div className="raise">
                  <p>
                    <strong>New best!</strong>{" "}
                    {raise.from === null
                      ? `Set your ${raise.family} max to ${raise.value} lb?`
                      : `Raise your ${raise.family} max from ${raise.from} to ${raise.value} lb?`}
                  </p>
                  <div className="row">
                    <button className="btn solid" onClick={confirmRaise}>
                      Yes, update it
                    </button>
                    <button className="btn ghost" onClick={() => setRaise(null)}>
                      Not now
                    </button>
                  </div>
                </div>
              )}
              {raiseMsg && <p className="notice small">{raiseMsg}</p>}
            </section>
          )}

          <section className="sess">
            <div className="sechead">
              <h3>GPP</h3>
              <span>3 rounds</span>
            </div>
            <ul className="moves">
              {day.gpp.map((g, i) => (
                <li key={g.name + i} className="mv">
                  <span />
                  <div>
                    <div className={`cat${g.cat === "Power" ? " power" : ""}`}>
                      {g.cat}
                      {g.cat === "Power" ? " · explosive, full rest" : ""}
                    </div>
                    <div className="name">{g.name}</div>
                    <div className="rx">{g.rx}</div>
                  </div>
                  <Watch url={videos[g.name]} name={g.name} />
                </li>
              ))}
            </ul>
          </section>

          <p className="key">
            MU max upper · ML max lower · DU dynamic upper · DL dynamic lower · MB med ball · DB dumbbell · RFESS rear foot
            elevated split squat · ea each side. Plyo circuit: about 15 sec to change stations, 60 sec between rounds.
          </p>
        </>
      )}
    </>
  );
}
