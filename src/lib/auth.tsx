import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isConfigured, supabase } from "./supabase";

// Role rules: docs/plans/athlete-pin-sign-in.md → "Role detection".
export type Role = "loading" | "none" | "coach" | "athlete";

export interface AthleteSelf {
  id: string;
  number: number;
  group_id: string;
}

interface AuthState {
  role: Role;
  session: Session | null;
  athlete: AthleteSelf | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function resolve(session: Session | null): Promise<{ role: Role; athlete: AthleteSelf | null }> {
  if (!session) return { role: "none", athlete: null };
  if (!session.user.is_anonymous) return { role: "coach", athlete: null };
  const { data: device } = await supabase
    .from("athlete_devices")
    .select("athlete_id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!device) return { role: "none", athlete: null };
  const { data: athlete } = await supabase
    .from("athletes")
    .select("id, number, group_id")
    .eq("id", device.athlete_id)
    .maybeSingle();
  return athlete ? { role: "athlete", athlete } : { role: "none", athlete: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(isConfigured ? "loading" : "none");
  const [athlete, setAthlete] = useState<AthleteSelf | null>(null);

  const apply = useCallback(async (s: Session | null) => {
    setSession(s);
    const r = await resolve(s);
    setRole(r.role);
    setAthlete(r.athlete);
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Defer: supabase-js warns against awaiting queries inside this callback.
      if (event !== "INITIAL_SESSION") setTimeout(() => apply(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [apply]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await apply(data.session);
  }, [apply]);

  const signOut = useCallback(async () => {
    if (role === "athlete") await supabase.rpc("release_device");
    await supabase.auth.signOut();
    await apply(null);
  }, [role, apply]);

  return (
    <AuthContext.Provider value={{ role, session, athlete, refresh, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
