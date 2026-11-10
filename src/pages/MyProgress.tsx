import ProgressView from "../components/ProgressView";
import { useAthleteData } from "../lib/athleteData";
import { useAuth } from "../lib/auth";
import { AthleteTabs } from "./Me";

// Athlete "Progress" screen: one card per tracked lift with results this cycle.

export default function MyProgress() {
  const { athlete } = useAuth();
  const data = useAthleteData();
  const { loading, error, cycle } = data;

  const header = (
    <div className="spread">
      <h1>Athlete #{athlete?.number}</h1>
      <AthleteTabs active="progress" />
    </div>
  );
  if (loading) return <p className="muted">Loading…</p>;
  if (error)
    return (
      <>
        {header}
        <p className="err">{error}</p>
      </>
    );

  return (
    <>
      {header}
      {cycle && <p className="muted small">{cycle.name}</p>}
      <ProgressView data={data} emptyText="No results yet this cycle. Log your lifts on the Today page and they'll show up here." />
    </>
  );
}
