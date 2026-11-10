import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

// Email + password, so Supabase's default email templates work without custom SMTP.
// See docs/plans/conjugate-tracker-app.md → "Coach auth".
type Mode = "signin" | "signup";

export default function CoachLogin() {
  const { role, refresh } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (role === "coach") return <Navigate to="/coach" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    // An athlete session on this device must not turn into a coach session.
    const { data: s } = await supabase.auth.getSession();
    if (s.session?.user.is_anonymous) await supabase.auth.signOut();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (error) return setError(error.message);
      await refresh();
      return;
    }

    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(error.message);
    if (data.session) {
      await refresh(); // "Confirm email" is off in Supabase: signed in immediately.
      return;
    }
    setMode("signin");
    setPassword("");
    setInfo(`Check ${email.trim()} for a confirmation link, then come back and sign in.`);
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>{mode === "signin" ? "Coach sign in" : "Create coach account"}</h1>
      <label>
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="btn solid" disabled={busy}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setInfo(null);
        }}
      >
        {mode === "signin" ? "New coach? Create an account" : "Have an account? Sign in"}
      </button>
      {info && <p className="notice">{info}</p>}
      {error && <p className="err">{error}</p>}
    </form>
  );
}
