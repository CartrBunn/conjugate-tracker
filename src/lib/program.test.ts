import { describe, expect, it } from "vitest";
import seed from "../../supabase/seed/example-program.json";
import {
  dayDate,
  dayOn,
  exercisesForDay,
  formatCode,
  isMonday,
  localToday,
  mondayOnOrAfter,
  namesOnDay,
  normalizeCode,
  parseProgram,
  programDays,
  speedWeight,
  trainingMaxOn,
  type Week,
} from "./program";

const weeks = seed.weeks as Week[];

describe("program dates", () => {
  it("maps week/day to dates when started 2026-11-16", () => {
    expect(dayDate("2026-11-16", 1, "Mon")).toBe("2026-11-16");
    expect(dayDate("2026-11-16", 1, "Thu")).toBe("2026-11-19");
    expect(dayDate("2026-11-16", 7, "Fri")).toBe("2027-01-01");
    expect(dayDate("2026-11-16", 15, "Fri")).toBe("2027-02-26");
  });

  it("finds the day for a date and returns null on off days", () => {
    const hit = dayOn(weeks, "2026-11-16", "2026-11-26");
    expect(hit?.week.week).toBe(2);
    expect(hit?.day.type).toBe("ML");
    expect(hit?.day.main.name).toBe("Box Squat");
    expect(dayOn(weeks, "2026-11-16", "2026-11-18")).toBeNull(); // Wednesday
  });

  it("checks Mondays", () => {
    expect(isMonday("2026-11-16")).toBe(true);
    expect(isMonday("2026-11-17")).toBe(false);
  });
});

describe("speed weight", () => {
  it("rounds to the nearest 5 lb", () => {
    expect(speedWeight(225, 45)).toBe(100); // 101.25
    expect(speedWeight(300, 55)).toBe(165);
    expect(speedWeight(187, 60)).toBe(110); // 112.2
  });
});

describe("seed program", () => {
  it("has weeks of 4 days with a family on every main lift", () => {
    expect(weeks).toHaveLength(2);
    for (const w of weeks) {
      expect(w.days).toHaveLength(4);
      for (const d of w.days) {
        expect(["squat", "bench", "deadlift"]).toContain(d.main.key);
        expect(d.main.pct === null).toBe(d.type === "ML" || d.type === "MU");
      }
    }
  });

  it("lists names on a day", () => {
    const names = namesOnDay(weeks[0].days[0]);
    expect(names.has("Speed Box Squat")).toBe(true);
    expect(names.has("Pogo Hops")).toBe(true);
  });
});

describe("cycle helpers", () => {
  it("lists 8 program days in date order", () => {
    const days = programDays(weeks, "2026-11-16");
    expect(days).toHaveLength(8);
    expect(days[0].date).toBe("2026-11-16");
    expect(days[1].date).toBe("2026-11-17");
    expect(days.at(-1)!.date).toBe("2026-11-27");
  });

  it("finds the Monday on or after a date", () => {
    expect(mondayOnOrAfter("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(mondayOnOrAfter("2026-11-10")).toBe("2026-11-16"); // Tuesday
    expect(mondayOnOrAfter("2026-11-15")).toBe("2026-11-16"); // Sunday
  });

  it("formats local today", () => {
    expect(localToday(new Date(2026, 10, 9))).toBe("2026-11-09");
  });

  it("picks grid columns for a day", () => {
    const tracked = [
      { id: "1", name: "Box Squat", family: "squat" as const },
      { id: "2", name: "Bench Press", family: "bench" as const },
      { id: "3", name: "Broad Jump", family: "jump" as const },
    ];
    const meLower = dayOn(weeks, "2026-11-16", "2026-11-26")!.day; // Box Squat ME day
    expect(exercisesForDay(tracked, meLower).map((e) => e.name)).toEqual(["Box Squat", "Broad Jump"]);
  });

  it("uses the latest training max on or before a date", () => {
    const rows = [
      { athlete_id: "a", family: "squat" as const, value: 200, set_on: "2026-11-16" },
      { athlete_id: "a", family: "squat" as const, value: 225, set_on: "2026-12-07" },
      { athlete_id: "b", family: "squat" as const, value: 300, set_on: "2026-11-16" },
    ];
    expect(trainingMaxOn(rows, "a", "squat", "2026-11-20")).toBe(200);
    expect(trainingMaxOn(rows, "a", "squat", "2026-12-07")).toBe(225);
    expect(trainingMaxOn(rows, "a", "bench", "2026-12-07")).toBeNull();
    expect(trainingMaxOn(rows, "a", "squat", "2026-11-01")).toBeNull();
  });
});

describe("join codes", () => {
  it("normalizes and formats", () => {
    expect(normalizeCode(" ftf7-k2qm ")).toBe("FTF7K2QM");
    expect(formatCode("ftf7k2qm")).toBe("FTF7-K2QM");
  });
});

describe("parseProgram", () => {
  it("accepts the example program file", () => {
    const p = parseProgram(seed);
    expect(p.name).toBe(seed.name);
    expect(p.weeks).toHaveLength(seed.weeks.length);
    expect(Object.keys(p.videos).length).toBeGreaterThan(0);
  });

  it("rejects bad files with a readable message", () => {
    expect(() => parseProgram([])).toThrow(/JSON object/);
    expect(() => parseProgram({ name: "X", weeks: [] })).toThrow(/weeks/);
    const bad = structuredClone(seed) as { weeks: { days: { type: string }[] }[] };
    bad.weeks[0].days[0].type = "ZZ";
    expect(() => parseProgram(bad)).toThrow(/Week 1 day 1/);
  });
});
