import { describe, expect, it, vi } from "vitest";

// pickCycle is pure; stub the client so importing its module doesn't open a connection.
vi.mock("./supabase", () => ({ supabase: {}, isConfigured: false }));
import seed from "../../supabase/seed/fennimore-winter.json";
import { buildSequence } from "../components/CircuitTimer";
import { pickCycle, type AthleteCycle } from "./athleteData";
import type { Week } from "./program";

const weeks = seed.weeks as Week[];
const programs = new Map([["p", weeks]]);
const cyc = (id: string, start_date: string, status: AthleteCycle["status"]): AthleteCycle => ({
  id,
  name: id,
  start_date,
  status,
  program_id: "p",
});

describe("pickCycle", () => {
  it("prefers the cycle running today, active first", () => {
    const list = [cyc("old", "2026-01-05", "closed"), cyc("planned", "2026-11-16", "planned"), cyc("run", "2026-11-16", "active")];
    expect(pickCycle(list, programs, "2026-12-01")?.id).toBe("run");
  });

  it("falls back to the next one to start", () => {
    const list = [cyc("old", "2025-11-17", "closed"), cyc("next", "2026-11-16", "planned")];
    expect(pickCycle(list, programs, "2026-11-10")?.id).toBe("next");
  });

  it("returns the most recent when nothing is running or upcoming", () => {
    const list = [cyc("a", "2025-01-06", "closed"), cyc("b", "2025-11-17", "closed")];
    expect(pickCycle(list, programs, "2026-11-10")?.id).toBe("b");
    expect(pickCycle([], programs, "2026-11-10")).toBeNull();
  });
});

describe("circuit timer sequence", () => {
  it("matches the original: 2 rounds of 4 × 30 s, 15 s changes, 60 s between rounds", () => {
    const seq = buildSequence(weeks[0].days[0].circuit);
    expect(seq.filter((s) => s.kind === "work")).toHaveLength(8);
    expect(seq.filter((s) => s.seconds === 15)).toHaveLength(6);
    expect(seq.filter((s) => s.seconds === 60)).toHaveLength(1);
    expect(seq.reduce((a, s) => a + s.seconds, 0)).toBe(8 * 30 + 6 * 15 + 60);
  });
});
