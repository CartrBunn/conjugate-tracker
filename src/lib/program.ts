// Program shape and pure math. Spec: docs/plans/conjugate-tracker-app.md

export type DayType = "DL" | "DU" | "ML" | "MU";
export type Family = "squat" | "bench" | "deadlift";
export type DayName = "Mon" | "Tue" | "Thu" | "Fri";

export interface Move {
  name: string;
  rx: string;
}
export interface GppMove extends Move {
  cat: string;
}
export interface MainLift {
  name: string;
  rx: string;
  key: Family;
  pct: number | null;
  note: string;
}
export interface Day {
  day: DayName;
  type: DayType;
  circuit: Move[];
  main: MainLift;
  gpp: GppMove[];
}
export interface Week {
  week: number;
  block: string;
  max: "Upper" | "Lower";
  pct: number;
  days: Day[];
}

export const DAY_OFFSET: Record<DayName, number> = { Mon: 0, Tue: 1, Thu: 3, Fri: 4 };

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  DL: "Dynamic Effort · Lower",
  DU: "Dynamic Effort · Upper",
  ML: "Max Effort · Lower",
  MU: "Max Effort · Upper",
};

/** Parse "YYYY-MM-DD" as a UTC date so day math never shifts with time zones. */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** Date of a program day, given the cycle's start Monday. */
export function dayDate(cycleStart: string, week: number, day: DayName): string {
  return addDays(cycleStart, 7 * (week - 1) + DAY_OFFSET[day]);
}

/** Find the program day falling on a date, or null on an off day / outside the cycle. */
export function dayOn(
  weeks: Week[],
  cycleStart: string,
  date: string,
): { week: Week; day: Day } | null {
  for (const week of weeks) {
    for (const day of week.days) {
      if (dayDate(cycleStart, week.week, day.day) === date) return { week, day };
    }
  }
  return null;
}

export function isMonday(iso: string): boolean {
  return parseISO(iso).getUTCDay() === 1;
}

export interface ProgramDay {
  date: string;
  week: Week;
  day: Day;
}

/** Every training day of a cycle, in date order. */
export function programDays(weeks: Week[], cycleStart: string): ProgramDay[] {
  return weeks
    .flatMap((week) => week.days.map((day) => ({ date: dayDate(cycleStart, week.week, day.day), week, day })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Today's date in the viewer's own time zone, as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The Monday on or after a date. */
export function mondayOnOrAfter(iso: string): string {
  const dow = parseISO(iso).getUTCDay(); // 0 = Sun
  return addDays(iso, (8 - dow) % 7);
}

/** Readable short date, e.g. "Mon Nov 16". */
export function shortDate(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export type ExerciseFamily = Family | "jump" | "throw" | "other";

export interface ExerciseLite {
  id: string;
  name: string;
  family: ExerciseFamily;
}

/**
 * Columns for the logging grid on a given day: tracked exercises that appear in that day's
 * session (exact name match), plus jump/throw tests, which can be tested any day.
 */
export function exercisesForDay<T extends ExerciseLite>(tracked: T[], day: Day): T[] {
  const names = namesOnDay(day);
  return tracked.filter((e) => names.has(e.name) || e.family === "jump" || e.family === "throw");
}

export interface TrainingMaxRow {
  athlete_id: string;
  family: Family;
  value: number;
  set_on: string;
}

/** The athlete's training max for a family in effect on a date (latest set_on ≤ date). */
export function trainingMaxOn(rows: TrainingMaxRow[], athleteId: string, family: Family, date: string): number | null {
  let best: TrainingMaxRow | null = null;
  for (const r of rows) {
    if (r.athlete_id !== athleteId || r.family !== family || r.set_on > date) continue;
    if (!best || r.set_on > best.set_on) best = r;
  }
  return best ? Number(best.value) : null;
}

export const round5 = (x: number): number => Math.round(x / 5) * 5;

/** Dynamic-effort bar weight from a training max. */
export function speedWeight(trainingMax: number, pct: number): number {
  return round5((trainingMax * pct) / 100);
}

/** Every exercise name that appears on a day (main lift, circuit, GPP). */
export function namesOnDay(day: Day): Set<string> {
  return new Set([day.main.name, ...day.circuit.map((m) => m.name), ...day.gpp.map((m) => m.name)]);
}

// Join codes: stored as 8 chars, shown as XXXX-XXXX.
export function normalizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatCode(code: string): string {
  const c = normalizeCode(code);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export interface ProgramFile {
  name: string;
  weeks: Week[];
  videos: Record<string, string>;
}

const DAY_TYPES = new Set(["DL", "DU", "ML", "MU"]);
const FAMILIES = new Set(["squat", "bench", "deadlift"]);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";

function checkMoves(list: unknown, where: string, withCat = false): void {
  if (!Array.isArray(list)) throw new Error(`${where} must be a list`);
  list.forEach((m, i) => {
    if (!isObj(m) || !isStr(m.name) || !isStr(m.rx)) throw new Error(`${where} item ${i + 1} needs "name" and "rx"`);
    if (withCat && !isStr(m.cat)) throw new Error(`${where} item ${i + 1} needs "cat"`);
  });
}

/** Validate an uploaded program JSON file. Throws an Error with a readable message on bad input. */
export function parseProgram(raw: unknown): ProgramFile {
  if (!isObj(raw)) throw new Error("File must be a JSON object");
  const name = isStr(raw.name) ? raw.name.trim() : "";
  if (!name) throw new Error('Missing "name"');
  if (!Array.isArray(raw.weeks) || raw.weeks.length === 0) throw new Error('"weeks" must be a non-empty list');
  raw.weeks.forEach((w, wi) => {
    const at = `Week ${wi + 1}`;
    if (!isObj(w)) throw new Error(`${at} must be an object`);
    if (typeof w.week !== "number") throw new Error(`${at}: "week" must be a number`);
    if (!isStr(w.block)) throw new Error(`${at}: "block" must be text`);
    if (w.max !== "Upper" && w.max !== "Lower") throw new Error(`${at}: "max" must be "Upper" or "Lower"`);
    if (typeof w.pct !== "number") throw new Error(`${at}: "pct" must be a number`);
    if (!Array.isArray(w.days)) throw new Error(`${at}: "days" must be a list`);
    w.days.forEach((d, di) => {
      const dat = `${at} day ${di + 1}`;
      if (!isObj(d)) throw new Error(`${dat} must be an object`);
      if (!isStr(d.day) || !(d.day in DAY_OFFSET)) throw new Error(`${dat}: "day" must be Mon, Tue, Thu or Fri`);
      if (!isStr(d.type) || !DAY_TYPES.has(d.type)) throw new Error(`${dat}: "type" must be DL, DU, ML or MU`);
      const m = d.main;
      if (!isObj(m) || !isStr(m.name) || !isStr(m.rx)) throw new Error(`${dat}: "main" needs "name" and "rx"`);
      if (!isStr(m.key) || !FAMILIES.has(m.key)) throw new Error(`${dat}: main "key" must be squat, bench or deadlift`);
      if (m.pct !== null && m.pct !== undefined && typeof m.pct !== "number") throw new Error(`${dat}: main "pct" must be a number or null`);
      checkMoves(d.circuit, `${dat} circuit`);
      checkMoves(d.gpp, `${dat} gpp`, true);
    });
  });
  const videos: Record<string, string> = {};
  if (raw.videos !== undefined) {
    if (!isObj(raw.videos)) throw new Error('"videos" must be an object of { moveName: url }');
    for (const [k, v] of Object.entries(raw.videos)) {
      if (!isStr(v)) throw new Error(`Video for "${k}" must be a URL string`);
      videos[k] = v;
    }
  }
  const weeks = (raw.weeks as Week[]).map((w) => ({
    ...w,
    days: w.days.map((d) => ({ ...d, main: { ...d.main, pct: d.main.pct ?? null, note: d.main.note ?? "" } })),
  }));
  return { name, weeks, videos };
}
