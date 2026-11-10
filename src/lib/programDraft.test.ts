import { describe, expect, it } from "vitest";
import seed from "../../supabase/seed/example-program.json";
import { parseProgram, type Week } from "./program";
import { blankDay, blankWeek, changedLockedDays, draftErrors, fromDraft, joinRx, lockedDays, splitRx, toDraft } from "./programDraft";

describe("rx sets/reps", () => {
  it.each([
    ["8 x 2", "8", "2"],
    ["3 x 30 sec", "3", "30 sec"],
    ["x5", "", "5"],
    ["30 sec", "", "30 sec"],
    ["Work up to a 3RM", "", "Work up to a 3RM"],
  ])("round-trips %s", (rx, sets, reps) => {
    expect(splitRx(rx)).toEqual({ sets, reps });
    expect(joinRx(sets, reps)).toBe(rx);
  });
  it("handles sets without reps", () => expect(joinRx("4", "")).toBe("4 sets"));
});

describe("draft", () => {
  const file = parseProgram(seed);

  it("round-trips the example program unchanged", () => {
    expect(fromDraft(toDraft(file))).toEqual(file);
  });

  it("drops videos for moves no longer in the program", () => {
    const d = toDraft(file);
    d.videos["Not In Program"] = "https://x";
    expect(fromDraft(d).videos["Not In Program"]).toBeUndefined();
  });

  it("flags missing names and duplicate days", () => {
    const w = blankWeek();
    w.days.push(blankDay(w)!);
    w.days.push({ ...blankDay({ ...w, days: [] })!, day: "Mon" });
    const errs = draftErrors({ name: "", weeks: [w], videos: {} });
    expect(errs).toContain("Give the program a name.");
    expect(errs.some((e) => e.includes("listed twice"))).toBe(true);
    expect(errs.some((e) => e.includes("main lift needs a name"))).toBe(true);
  });
});

describe("locks", () => {
  const weeks = seed.weeks as Week[];
  it("locks only days whose date has a log", () => {
    const locked = lockedDays(weeks, [
      { start_date: "2026-11-16", performed_on: "2026-11-19" }, // week 1 Thu
      { start_date: "2026-11-16", performed_on: "2026-11-18" }, // Wed: off day
    ]);
    expect([...locked]).toEqual(["1:Thu"]);
  });
  it("reports edits to locked days only", () => {
    const after = structuredClone(weeks);
    after[0].days.find((d) => d.day === "Thu")!.main.rx = "changed";
    after[0].days.find((d) => d.day === "Mon")!.main.rx = "changed";
    expect(changedLockedDays(weeks, after, new Set(["1:Thu"]))).toEqual(["1:Thu"]);
    expect(changedLockedDays(weeks, weeks, new Set(["1:Thu"]))).toEqual([]);
  });
});
