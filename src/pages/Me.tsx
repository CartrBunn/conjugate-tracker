import { Link } from "react-router-dom";
import TodayView from "../components/TodayView";
import { useAthleteData } from "../lib/athleteData";
import { useAuth } from "../lib/auth";

// Athlete "Today" screen. Spec: docs/plans/conjugate-tracker-app.md → "Athlete app".

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

export default function Me() {
  const { athlete } = useAuth();
  const data = useAthleteData();

  if (data.loading) return <p className="muted">Loading…</p>;

  const header = (
    <div className="spread">
      <h1>Athlete #{athlete?.number}</h1>
      <AthleteTabs active="today" />
    </div>
  );

  return (
    <>
      {header}
      {data.error ? (
        <p className="err">{data.error}</p>
      ) : !data.cycle || !data.weeks.length ? (
        <p className="notice">Your coach hasn't started a training cycle for your group yet. Check back soon.</p>
      ) : (
        <TodayView data={data} athleteId={athlete!.id} />
      )}
    </>
  );
}
