import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Home() {
  const { role } = useAuth();
  if (role === "coach") return <Navigate to="/coach" replace />;
  if (role === "athlete") return <Navigate to="/me" replace />;
  return (
    <div className="stack">
      <h1>Who's lifting?</h1>
      <Link className="btn big solid" to="/join">
        I'm an athlete
      </Link>
      <Link className="btn big" to="/coach/login">
        I'm a coach
      </Link>
    </div>
  );
}
