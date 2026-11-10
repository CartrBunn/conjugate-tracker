import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ProgressView from "../components/ProgressView";
import TodayView from "../components/TodayView";
import { useAthleteData } from "../lib/athleteData";
import { shortDate } from "../lib/program";
import { supabase } from "../lib/supabase";

// Coach's view of one athlete: the same Workout (/me) and Progress (/me/progress) screens
// the athlete sees, for any cycle in their group. `?c=<cycleId>` picks the cycle and
// `?d=<date>` the workout day.

interface Athlete {
  id: string;
  number: number;
  group_id: string;
  active: boolean;
}

export default function CoachAthlete({ view }: { view: "workout" | "progress" }) {
  const { athleteId } = useParams();
  const [params, setParams] = useSearchParams();
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [groupName, setGroupName] = useState("");
  const [roster, setRoster] = useState<{ id: string; number: number }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      setLoadError(null);
      const a = await supabase.from("athletes").select("id, number, group_id, active").eq("id", athleteId).single();
      if (stale) return;
      if (a.error) return setLoadError(a.error.message);
      setAthlete(a.data);
      const [g, r] = await Promise.all([
        supabase.from("groups").select("name").eq("id", a.data.group_id).single(),
        supabase.from("athletes").select("id, number").eq("group_id", a.data.group_id).eq("active", true).order("number"),
      ]);
      if (stale) return;
      if (g.error || r.error) return setLoadError((g.error ?? r.error)!.message);
      setGroupName(g.data.name);
      setRoster(r.data);
    })();
    return () => {
      stale = true;
    };
  }, [athleteId]);

  const target = useMemo(() => (athlete ? { id: athlete.id, group_id: athlete.group_id } : null), [athlete]);
  const cycleParam = params.get("c");
  const data = useAthleteData(target, cycleParam);
  const { cycles, cycle } = data;

  if (loadError) return <p className="err">{loadError}</p>;
  if (!athlete || data.loading) return <p className="muted">Loading…</p>;

  const idx = roster.findIndex((r) => r.id === athlete.id);
  const prev = idx > 0 ? roster[idx - 1] : null;
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : null;
  // Keep the chosen cycle when stepping between athletes in the same group.
  const qs = cycleParam ? `?c=${cycleParam}` : "";
  const base = (id: string) => `/coach/athletes/${id}`;
  const athleteLink = (id: string) => `${base(id)}${view === "progress" ? "/progress" : ""}${qs}`;

  return (
    <>
      <Link to={`/coach/groups/${athlete.group_id}`} className="small">
        ← {groupName || "Group"}
      </Link>
      <div className="spread">
        <h1>
          Athlete #{athlete.number}
          {!athlete.active && <span className="muted small"> · inactive</span>}
        </h1>
        {roster.length > 1 && (
          <nav className="row" aria-label="Other athletes in this group">
            {prev ? (
              <Link className="btn ghost small" to={athleteLink(prev.id)} aria-label={`Athlete #${prev.number}`}>
                ← #{prev.number}
              </Link>
            ) : null}
            {next ? (
              <Link className="btn ghost small" to={athleteLink(next.id)} aria-label={`Athlete #${next.number}`}>
                #{next.number} →
              </Link>
            ) : null}
          </nav>
        )}
      </div>

      <nav className="tabs" aria-label="Athlete views" style={{ alignSelf: "flex-start" }}>
        <Link to={`${base(athlete.id)}${qs}`} aria-current={view === "workout" ? "page" : undefined}>
          Workout
        </Link>
        <Link to={`${base(athlete.id)}/progress${qs}`} aria-current={view === "progress" ? "page" : undefined}>
          Progress
        </Link>
      </nav>

      {data.error && <p className="err">{data.error}</p>}

      {cycles.length === 0 ? (
        <p className="notice">
          This group has no training cycles yet. Start one on the <Link to={`/coach/groups/${athlete.group_id}`}>group page</Link>.
        </p>
      ) : (
        <>
          <div className="row">
            <label style={{ flex: 1 }}>
              Cycle
              <select
                value={cycle?.id ?? ""}
                onChange={(e) => setParams({ c: e.target.value }, { replace: true })}
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {shortDate(c.start_date)} · {c.status}
                  </option>
                ))}
              </select>
            </label>
            {cycle && (
              <Link className="btn" to={`/coach/cycles/${cycle.id}`} style={{ alignSelf: "flex-end" }}>
                Open cycle
              </Link>
            )}
          </div>
          {view === "workout" ? (
            <TodayView data={data} athleteId={athlete.id} coach />
          ) : (
            <ProgressView data={data} emptyText="No results logged for this athlete in this cycle yet." />
          )}
        </>
      )}
    </>
  );
}
