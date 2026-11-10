import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until .env.local (or the GitHub Actions variables) are filled in. */
export const isConfigured = Boolean(url && key);

export const supabase: SupabaseClient = createClient(
  url ?? "http://localhost:54321",
  key ?? "missing-key",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);
