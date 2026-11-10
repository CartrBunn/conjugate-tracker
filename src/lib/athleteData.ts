import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { localToday, programDays, type ExerciseFamily, type TrainingMaxRow, type Week } from "./program";
import { supabase } from "./supabase";

// Everything the athlete screens need. Athletes load their own data (scoped by RLS);
// coaches pass a target athlete to see the same screens for anyone on their team.
// Spec: docs/plans/conjugate-tracker-app.md → "Athlete app".

export interface AthleteCycle {
  id: string;
  name: string;
  start_date: string;
  status: "planned" | "active" | "closed";
  program_id: string;
}
export interface AthleteExercise {
  id: string;
  name: string;
  family: ExerciseFamily;
  unit: string;
  higher_is_better: boolean;
}
export interface AthleteLog {
  exercise_id: string;
  performed_on: string;
  value: number;
}

export interface AthleteData {
  loading: boolean;
  error: string | null;
  /** Every cycle for the athlete's group, newest first. */
  cycles: AthleteCycle[];
  cycle: AthleteCycle | null;
  weeks: Week[];
  videos: Record<string, string>;
  tracked: AthleteExercise[];
  logs: AthleteLog[];
  maxes: TrainingMaxRow[];
  reload: () => Promise<void>;
  setLogs: React.Dispatch<React.SetStateAction<AthleteLog[]>>;
}

interface ProgramRow {
  id: string;
  weeks: Week[];
  videos: Record<string, string> | null;
}

/**
 * Which cycle to show: one running today (active preferred), else the next one to start,
 * else the most recent that isn't closed, else the most recent.
 */
export function pickCycle(cycles: AthleteCycle[], programs: Map<string, Week[]>, today: string): AthleteCycle | null {
  const range = (c: AthleteCycle) => {
    const days = programDays(programs.get(c.program_id) ?? [], c.start_date);
    return { first: days[0]?.date ?? c.start_date, last: days.at(-1)?.date ?? c.start_date };
  };
  const open = cycles.filter((c) => c.status !== "closed");
  const running = open.filter((c) => {
    const r = range(c);
    return r.first <= today && today <= r.last;
  });
  if (running.length) return running.find((c) => c.status === "active") ?? running[0];
  const upcoming = open.filter((c) => c.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (upcoming.length) return upcoming[0];
  const byRecent = [...cycles].sort((a, b) => b.start_date.localeCompare(a.start_date));
  return byRecent.find((c) => c.status !== "closed") ?? byRecent[0] ?? null;
}

export interface AthleteTarget {
  id: string;
  group_id: string;
}

/**
 * Load one athlete's cycle, program, tracked lifts, logs and maxes.
 * `target` defaults to the signed-in athlete. `cycleId` picks a cycle; otherwise `pickCycle` does.
 */
export function useAthleteData(target?: AthleteTarget | null, cycleId?: string | null): AthleteData {
  const { athlete: self } = useAuth();
  const athlete = target === undefined ? self : target;
  const athleteId = athlete?.id;
  const groupId = athlete?.group_id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<AthleteCycle[]>([]);
  const [cycle, setCycle] = useState<AthleteCycle | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [videos, setVideos] = useState<Record<string, string>>({});
  const [tracked, setTracked] = useState<AthleteExercise[]>([]);
  const [logs, setLogs] = useState<AthleteLog[]>([]);
  const [maxes, setMaxes] = useState<TrainingMaxRow[]>([]);

  const reload = useCallback(async () => {
    if (!athleteId || !groupId) return;
    setError(null);
    const c = await supabase
      .from("cycles")
      .select("id, name, start_date, status, program_id")
      .eq("group_id", groupId)
      .order("start_date", { ascending: false });
    if (c.error) {
      setLoading(false);
      return setError(c.error.message);
    }
    const programIds = [...new Set(c.data.map((x) => x.program_id))];
    const p = programIds.length
      ? await supabase.from("programs").select("id, weeks, videos").in("id", programIds)
      : { data: [] as ProgramRow[], error: null };
    if (p.error) {
      setLoading(false);
      return setError(p.error.message);
    }
    const programs = new Map((p.data as ProgramRow[]).map((r) => [r.id, r]));
    const all = c.data as AthleteCycle[];
    const chosen =
      all.find((x) => x.id === cycleId) ??
      pickCycle(all, new Map([...programs].map(([id, r]) => [id, r.weeks])), localToday());
    setCycles(all);
    setCycle(chosen);
    if (!chosen) {
      setLoading(false);
      return;
    }
    const prog = programs.get(chosen.program_id);
    setWeeks(prog?.weeks ?? []);
    setVideos(prog?.videos ?? {});
    const [t, l, m] = await Promise.all([
      supabase
        .from("tracked_lifts")
        .select("sort, exercises(id, name, family, unit, higher_is_better)")
        .eq("cycle_id", chosen.id)
        .order("sort"),
      supabase.from("logs").select("exercise_id, performed_on, value").eq("cycle_id", chosen.id).eq("athlete_id", athleteId),
      supabase.from("training_maxes").select("athlete_id, family, value, set_on").eq("athlete_id", athleteId),
    ]);
    const firstError = [t, l, m].find((r) => r.error)?.error;
    if (firstError) {
      setLoading(false);
      return setError(firstError.message);
    }
    setTracked(
      (t.data ?? []).map((r) => r.exercises as unknown as AthleteExercise | null).filter((e): e is AthleteExercise => !!e),
    );
    setLogs((l.data ?? []).map((r) => ({ ...r, value: Number(r.value) })));
    setMaxes((m.data ?? []).map((r) => ({ ...r, value: Number(r.value) })) as TrainingMaxRow[]);
    setLoading(false);
  }, [athleteId, groupId, cycleId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { loading, error, cycles, cycle, weeks, videos, tracked, logs, maxes, reload, setLogs };
}
