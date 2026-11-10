import LineChart from "./LineChart";
import type { AthleteData } from "../lib/athleteData";
import { shortDate, type Family } from "../lib/program";

// Training maxes plus one card per tracked lift with results in the cycle.
// Used by the athlete's Progress page and the coach's athlete page.

const FAMILIES: Family[] = ["squat", "bench", "deadlift"];

export default function ProgressView({
  data: { tracked, logs, maxes },
  emptyText,
}: {
  data: Pick<AthleteData, "tracked" | "logs" | "maxes">;
  emptyText: string;
}) {
  const lifts = tracked
    .map((e) => {
      const entries = logs
        .filter((l) => l.exercise_id === e.id)
        .sort((a, b) => a.performed_on.localeCompare(b.performed_on));
      return { e, entries };
    })
    .filter((x) => x.entries.length > 0);

  const latestMax = (f: Family) =>
    maxes.filter((m) => m.family === f).sort((a, b) => b.set_on.localeCompare(a.set_on))[0] ?? null;

  return (
    <>
      <section className="card">
        <h3>Training maxes</h3>
        <div className="maxes">
          {FAMILIES.map((f) => {
            const m = latestMax(f);
            return (
              <div key={f} className="stat">
                <span className="muted small">{f}</span>
                <strong>{m ? `${m.value}` : "—"}</strong>
                <small className="muted">{m ? `lb · ${shortDate(m.set_on)}` : "not set"}</small>
              </div>
            );
          })}
        </div>
      </section>

      {lifts.length === 0 ? (
        <p className="notice">{emptyText}</p>
      ) : (
        lifts.map(({ e, entries }) => {
          const values = entries.map((x) => x.value);
          const first = values[0];
          const best = e.higher_is_better ? Math.max(...values) : Math.min(...values);
          const change = best - first;
          const pct = first ? Math.round((change / first) * 100) : 0;
          return (
            <section key={e.id} className="card">
              <div className="spread">
                <h3>{e.name}</h3>
                <span className="muted small">{entries.length} result{entries.length === 1 ? "" : "s"}</span>
              </div>
              <div className="maxes">
                <div className="stat">
                  <span className="muted small">first</span>
                  <strong>{first}</strong>
                  <small className="muted">{e.unit}</small>
                </div>
                <div className="stat">
                  <span className="muted small">best</span>
                  <strong>{best}</strong>
                  <small className="muted">{e.unit}</small>
                </div>
                <div className="stat">
                  <span className="muted small">change</span>
                  <strong className={change > 0 === e.higher_is_better && change !== 0 ? "ok" : undefined}>
                    {change > 0 ? "+" : ""}
                    {Math.round(change * 10) / 10}
                  </strong>
                  <small className="muted">{entries.length > 1 ? `${pct > 0 ? "+" : ""}${pct}%` : "log more"}</small>
                </div>
              </div>
              <LineChart points={entries.map((x) => ({ date: x.performed_on, value: x.value }))} unit={e.unit} label={e.name} />
              <details>
                <summary className="small">All results</summary>
                <table className="plain">
                  <tbody>
                    {[...entries].reverse().map((x) => (
                      <tr key={x.performed_on}>
                        <td>{shortDate(x.performed_on)}</td>
                        <td className="num">
                          {x.value} {e.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>
          );
        })
      )}
    </>
  );
}
