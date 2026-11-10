// Editable form of a program, used by the program editor. Sets and reps are kept as separate
// fields while editing and folded back into the stored "rx" text on save.
import {
  dayOn,
  type Day,
  type DayName,
  type DayType,
  type Family,
  type ProgramFile,
  type Week,
} from "./program";

let seq = 0;
const uid = () => `d${++seq}`;

export interface DraftMove {
  id: string;
  name: string;
  sets: string;
  reps: string;
  cat: string; // GPP only
}
export interface DraftMain {
  name: string;
  sets: string;
  reps: string;
  key: Family;
  pct: string; // "" = no percentage (max-effort day)
  note: string;
}
export interface DraftDay {
  id: string;
  day: DayName;
  type: DayType;
  circuit: DraftMove[];
  main: DraftMain;
  gpp: DraftMove[];
}
export interface DraftWeek {
  id: string;
  block: string;
  max: "Upper" | "Lower";
  pct: string;
  days: DraftDay[];
}
export interface Draft {
  name: string;
  weeks: DraftWeek[];
  videos: Record<string, string>;
}

/** Split stored rx text into sets and reps: "8 x 2" → 8 / 2, "x5" → "" / 5, "30 sec" → "" / "30 sec". */
export function splitRx(rx: string): { sets: string; reps: string } {
  const m = /^\s*(\d+)?\s*[x×]\s*(.+?)\s*$/i.exec(rx);
  if (m) return { sets: m[1] ?? "", reps: m[2] };
  return { sets: "", reps: rx.trim() };
}

/** Inverse of splitRx. */
export function joinRx(sets: string, reps: string): string {
  const s = sets.trim();
  const r = reps.trim();
  if (s && r) return `${s} x ${r}`;
  if (s) return `${s} sets`;
  if (/^\d+$/.test(r)) return `x${r}`;
  return r;
}

export function blankMove(cat = ""): DraftMove {
  return { id: uid(), name: "", sets: "", reps: "", cat };
}

const NEXT_DAY: DayName[] = ["Mon", "Tue", "Thu", "Fri"];
const DEFAULT_TYPE: Record<DayName, DayType> = { Mon: "DL", Tue: "MU", Thu: "ML", Fri: "DU" };
const DEFAULT_KEY: Record<DayType, Family> = { DL: "squat", ML: "squat", DU: "bench", MU: "bench" };

/** A new empty day on the first weekday the week doesn't use yet (null if all four are used). */
export function blankDay(week: DraftWeek): DraftDay | null {
  const day = NEXT_DAY.find((d) => !week.days.some((x) => x.day === d));
  if (!day) return null;
  const type = DEFAULT_TYPE[day];
  return {
    id: uid(),
    day,
    type,
    circuit: [],
    main: { name: "", sets: "", reps: "", key: DEFAULT_KEY[type], pct: "", note: "" },
    gpp: [],
  };
}

export function blankWeek(): DraftWeek {
  return { id: uid(), block: "Block 1", max: "Upper", pct: "50", days: [] };
}

/** Deep copy with fresh ids, for "duplicate week". */
export function copyWeek(w: DraftWeek): DraftWeek {
  return {
    ...w,
    id: uid(),
    days: w.days.map((d) => ({
      ...d,
      id: uid(),
      main: { ...d.main },
      circuit: d.circuit.map((m) => ({ ...m, id: uid() })),
      gpp: d.gpp.map((m) => ({ ...m, id: uid() })),
    })),
  };
}

const moveToDraft = (m: { name: string; rx: string; cat?: string }): DraftMove => ({
  id: uid(),
  name: m.name,
  ...splitRx(m.rx),
  cat: m.cat ?? "",
});

export function toDraft(p: ProgramFile): Draft {
  return {
    name: p.name,
    videos: { ...p.videos },
    weeks: [...p.weeks]
      .sort((a, b) => a.week - b.week)
      .map((w) => ({
        id: uid(),
        block: w.block,
        max: w.max,
        pct: String(w.pct),
        days: w.days.map((d) => ({
          id: uid(),
          day: d.day,
          type: d.type,
          circuit: d.circuit.map(moveToDraft),
          gpp: d.gpp.map(moveToDraft),
          main: {
            name: d.main.name,
            ...splitRx(d.main.rx),
            key: d.main.key,
            pct: d.main.pct === null ? "" : String(d.main.pct),
            note: d.main.note ?? "",
          },
        })),
      })),
  };
}

const ORDER: Record<DayName, number> = { Mon: 0, Tue: 1, Thu: 2, Fri: 3 };

/** Problems that would stop a save, as readable sentences. Empty when the draft is good. */
export function draftErrors(d: Draft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("Give the program a name.");
  if (d.weeks.length === 0) out.push("Add at least one week.");
  d.weeks.forEach((w, wi) => {
    const at = `Week ${wi + 1}`;
    if (w.pct.trim() === "" || isNaN(Number(w.pct))) out.push(`${at}: speed % must be a number.`);
    const seen = new Set<string>();
    w.days.forEach((day) => {
      const dat = `${at} ${day.day}`;
      if (seen.has(day.day)) out.push(`${at}: ${day.day} is listed twice.`);
      seen.add(day.day);
      if (!day.main.name.trim()) out.push(`${dat}: main lift needs a name.`);
      if (day.main.pct.trim() !== "" && isNaN(Number(day.main.pct))) out.push(`${dat}: main lift % must be a number or blank.`);
      [...day.circuit, ...day.gpp].forEach((m, i) => {
        if (!m.name.trim()) out.push(`${dat}: exercise ${i + 1} needs a name.`);
      });
    });
  });
  return out;
}

const moveOut = (m: DraftMove) => ({ name: m.name.trim(), rx: joinRx(m.sets, m.reps) });

/** Back to the stored shape. Weeks are numbered by position; days are sorted Mon→Fri. Call draftErrors first. */
export function fromDraft(d: Draft): ProgramFile {
  const weeks: Week[] = d.weeks.map((w, wi) => ({
    week: wi + 1,
    block: w.block.trim(),
    max: w.max,
    pct: Number(w.pct),
    days: [...w.days]
      .sort((a, b) => ORDER[a.day] - ORDER[b.day])
      .map(
        (day): Day => ({
          day: day.day,
          type: day.type,
          circuit: day.circuit.map(moveOut),
          main: {
            name: day.main.name.trim(),
            rx: joinRx(day.main.sets, day.main.reps),
            key: day.main.key,
            pct: day.main.pct.trim() === "" ? null : Number(day.main.pct),
            note: day.main.note.trim(),
          },
          gpp: day.gpp.map((m) => ({ ...moveOut(m), cat: m.cat.trim() })),
        }),
      ),
  }));
  const names = new Set(weeks.flatMap((w) => w.days.flatMap((day) => [day.main.name, ...day.circuit.map((m) => m.name), ...day.gpp.map((m) => m.name)])));
  // Keep only videos for moves still in the program, and drop blanks.
  const videos = Object.fromEntries(Object.entries(d.videos).filter(([k, v]) => names.has(k) && v.trim()).map(([k, v]) => [k, v.trim()]));
  return { name: d.name.trim(), weeks, videos };
}

/**
 * Program days that already have logged results in some cycle, as "week:Day" keys (e.g. "3:Thu").
 * A log only counts when its date falls on a program day of that cycle.
 */
export function lockedDays(weeks: Week[], logs: { start_date: string; performed_on: string }[]): Set<string> {
  const out = new Set<string>();
  for (const l of logs) {
    const hit = dayOn(weeks, l.start_date, l.performed_on);
    if (hit) out.add(`${hit.week.week}:${hit.day.day}`);
  }
  return out;
}

/** Locked days ("week:Day") whose content differs between two versions of a program, or that were removed. */
export function changedLockedDays(before: Week[], after: Week[], locked: Set<string>): string[] {
  const find = (weeks: Week[], key: string) => {
    const [wk, day] = key.split(":");
    return weeks.find((w) => w.week === Number(wk))?.days.find((d) => d.day === day);
  };
  return [...locked].filter((k) => JSON.stringify(find(before, k)) !== JSON.stringify(find(after, k)));
}
