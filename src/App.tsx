import type { ReactNode } from "react";
import { createHashRouter, Link, Navigate, Outlet, RouterProvider } from "react-router-dom";
import { useAuth, type Role } from "./lib/auth";
import { isConfigured } from "./lib/supabase";
import CoachHome from "./pages/CoachHome";
import CoachLogin from "./pages/CoachLogin";
import CyclePage from "./pages/CyclePage";
import GroupPage from "./pages/GroupPage";
import LogPage from "./pages/LogPage";
import Home from "./pages/Home";
import Join from "./pages/Join";
import Me from "./pages/Me";
import MyProgress from "./pages/MyProgress";

function Shell() {
  const { role, signOut } = useAuth();
  return (
    <>
      <header className="band">
        <div className="col">
          <Link to="/" className="brand">
            Conjugate <span>Tracker</span>
          </Link>
          {(role === "coach" || role === "athlete") && (
            <button className="btn" onClick={signOut}>
              {role === "athlete" ? "Switch athlete" : "Sign out"}
            </button>
          )}
        </div>
      </header>
      <main className="col">
        {!isConfigured && (
          <p className="notice">
            Supabase isn't configured. Copy <code>.env.example</code> to <code>.env.local</code> and fill in your
            project URL and anon key.
          </p>
        )}
        <Outlet />
      </main>
    </>
  );
}

/** Only render children for the given role; otherwise send the user somewhere sensible. */
function Only({ role: want, children }: { role: Role; children: ReactNode }) {
  const { role } = useAuth();
  if (role === "loading") return <p className="muted">Loading…</p>;
  if (role === want) return <>{children}</>;
  if (role === "coach") return <Navigate to="/coach" replace />;
  if (role === "athlete") return <Navigate to="/me" replace />;
  return <Navigate to={want === "coach" ? "/coach/login" : "/join"} replace />;
}

const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/coach/login", element: <CoachLogin /> },
      { path: "/coach", element: <Only role="coach"><CoachHome /></Only> },
      { path: "/coach/groups/:groupId", element: <Only role="coach"><GroupPage /></Only> },
      { path: "/coach/cycles/:cycleId", element: <Only role="coach"><CyclePage /></Only> },
      { path: "/coach/cycles/:cycleId/log/:date", element: <Only role="coach"><LogPage /></Only> },
      { path: "/join", element: <Join /> },
      { path: "/me", element: <Only role="athlete"><Me /></Only> },
      { path: "/me/progress", element: <Only role="athlete"><MyProgress /></Only> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
