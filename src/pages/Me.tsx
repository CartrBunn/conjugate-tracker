import { useAuth } from "../lib/auth";

// Phase 2 fills this in: today's session, logging, speed-weight calculator, progress.
export default function Me() {
  const { athlete } = useAuth();
  return (
    <div className="card">
      <h1>Athlete #{athlete?.number}</h1>
      <p className="muted">You're signed in. Today's session and logging come next.</p>
    </div>
  );
}
