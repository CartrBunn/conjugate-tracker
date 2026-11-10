import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import TodayView from "../components/TodayView";
import type { AthleteCycle } from "../lib/athleteData";
import type { Week } from "../lib/program";
import { supabase } from "../lib/supabase";

// Group workout screen: the day's session for a whole group, for the coach to put up on a
// TV or projector. Same layout as the athlete's Today screen without bar weights or results.
// `?d=<date>` picks the day; it defaults to today or the next program day.

const noop = () => {};
const noopAsync = async () => {};

export default function WorkoutBoard() {
  const { cycleId } = useParams();
  const [cycle, setCycle] = useState<(AthleteCycle & { group_id: string }) | null>(null);
  const [groupName, setGroupName] = useState("");
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [videos, setVideos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      const c = await supabase
        .from("cycles")
        .select("id, name, start_date, status, program_id, group_id")
        .eq("id", cycleId)
        .single();
      if (stale) return;
      if (c.error) return setError(c.error.message);
      const [g, p] = await Promise.all([
        supabase.from("groups").select("name").eq("id", c.data.group_id).single(),
        supabase.from("programs").select("weeks, videos").eq("id", c.data.program_id).single(),
      ]);
      if (stale) return;
      if (g.error || p.error) return setError((g.error ?? p.error)!.message);
      setGroupName(g.data.name);
      setWeeks(p.data.weeks as Week[]);
      setVideos((p.data.videos as Record<string, string> | null) ?? {});
      setCycle(c.data as AthleteCycle & { group_id: string });
    })();
    return () => {
      stale = true;
    };
  }, [cycleId]);

  if (error) return <p className="err">{error}</p>;
  if (!cycle) return <p className="muted">Loading…</p>;

  const fullScreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else boardRef.current?.requestFullscreen?.();
  };

  return (
    <>
      <div className="spread noprint">
        <Link to={`/coach/cycles/${cycle.id}`} className="small">
          ← {cycle.name}
        </Link>
        {document.fullscreenEnabled && (
          <button className="btn" onClick={fullScreen}>
            Full screen
          </button>
        )}
      </div>
      <div ref={boardRef} className="board stack">
        <h1>{groupName}</h1>
        {weeks.length === 0 ? (
          <p className="notice">This cycle's program has no training days.</p>
        ) : (
          <TodayView
            data={{ cycle, weeks, videos, tracked: [], logs: [], maxes: [], setLogs: noop, reload: noopAsync }}
          />
        )}
      </div>
    </>
  );
}
