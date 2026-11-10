import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { formatCode, normalizeCode } from "../lib/program";
import { supabase } from "../lib/supabase";

// Flow: docs/plans/athlete-pin-sign-in.md → "Client flow". Athletes are numbers only; no names.
type Step = "code" | "athlete";

const MESSAGES: Record<string, string> = {
  bad_pin: "Wrong PIN. Try again.",
  locked: "Too many tries. Wait 15 minutes or ask your coach.",
  not_found: "No athlete with that number in this group. Check your number with your coach.",
};

export default function Join() {
  const { role, refresh } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role === "athlete") return <Navigate to="/me" replace />;
  if (role === "coach")
    return <p className="notice">You're signed in as a coach. Sign out first to join as an athlete.</p>;

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    // null = no group has this code; 0 = right code but no athletes yet.
    const { data: count, error } = await supabase.rpc("check_join_code", { p_code: normalizeCode(code) });
    setBusy(false);
    if (error) return setError(error.message);
    if (count === null) return setError("Code not found. Check it with your coach — it may have been changed.");
    if (count === 0) return setError("That code is right, but your coach hasn't added any athletes to this group yet.");
    setStep("athlete");
  }

  async function submitAthlete(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("claim_athlete", {
      p_code: normalizeCode(code),
      p_number: Number(number),
      p_pin: pin,
    });
    setBusy(false);
    setPin("");
    if (error) return setError(error.message);
    if (data === "ok") {
      await refresh();
      navigate("/me", { replace: true });
      return;
    }
    setError(MESSAGES[data as string] ?? "Something went wrong.");
  }

  return (
    <div className="card">
      {step === "code" && (
        <form className="stack" onSubmit={submitCode}>
          <h1>Join your group</h1>
          <label>
            Group code from your coach
            <input
              type="text"
              className="code"
              placeholder="XXXX-XXXX"
              autoCapitalize="characters"
              autoComplete="off"
              value={formatCode(code)}
              onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, 8))}
            />
          </label>
          <button className="btn solid" disabled={busy || normalizeCode(code).length !== 8}>
            Next
          </button>
        </form>
      )}

      {step === "athlete" && (
        <form className="stack" onSubmit={submitAthlete}>
          <h1>Sign in</h1>
          <p className="muted small">
            Group <span className="code" style={{ fontSize: 18 }}>{formatCode(code)}</span>
          </p>
          <label>
            Your athlete number
            <input
              inputMode="numeric"
              autoComplete="off"
              className="pin"
              maxLength={4}
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <label>
            Your 4-digit PIN
            <input
              inputMode="numeric"
              autoComplete="off"
              className="pin"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <div className="row">
            <button className="btn solid" disabled={busy || !number || pin.length !== 4}>
              Sign in
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setStep("code");
                setError(null);
              }}
            >
              Different group
            </button>
          </div>
        </form>
      )}

      {error && <p className="err">{error}</p>}
    </div>
  );
}
