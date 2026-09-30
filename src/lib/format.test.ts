import { describe, expect, it } from "vitest";
import { ago, compact, duration, pct, resetLabel, windowLabel } from "./format";
import { splitArgs } from "../components/NewSessionDialog";
import { score } from "../components/CommandPalette";

describe("format", () => {
  it("compacts token counts", () => {
    expect(compact(482_700_000)).toBe("482.7M");
    expect(compact(227_400_000)).toBe("227.4M");
    expect(compact(1_000_000)).toBe("1M");
    expect(compact(3_100_000_000)).toBe("3.1B");
    expect(compact(950)).toBe("950");
    expect(compact(null)).toBe("–");
  });
  it("formats durations and percentages", () => {
    expect(duration(59_000)).toBe("59s");
    expect(duration(3_720_000)).toBe("1h 2m");
    expect(duration(-1)).toBe("–");
    expect(pct(0.984)).toBe("98%");
    expect(pct(null)).toBe("–");
  });
  it("relative time", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(ago("2026-09-26T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-09-26T10:00:00Z", now)).toBe("2h ago");
    expect(ago(null, now)).toBe("never");
  });
  it("labels quota windows", () => {
    expect(windowLabel("five_hour", 300)).toBe("5-hour window");
    expect(windowLabel("seven_day", 10080)).toBe("Weekly");
    expect(windowLabel("x", 1440)).toBe("1-day window");
    expect(resetLabel(null)).toBe("");
  });
});

describe("splitArgs", () => {
  it("splits with quotes", () => {
    expect(splitArgs('--permission-mode plan --append-system-prompt "be brief"')).toEqual([
      "--permission-mode",
      "plan",
      "--append-system-prompt",
      "be brief",
    ]);
    expect(splitArgs("  ")).toEqual([]);
    expect(splitArgs("a ''")).toEqual(["a", ""]);
  });
});

describe("palette score", () => {
  it("prefers contiguous matches and rejects non-matches", () => {
    expect(score("claude a #1", "cla")).toBeGreaterThan(score("c l a", "cla"));
    expect(score("codex", "xyz")).toBe(0);
  });
});

import { currentWindows } from "./format";
describe("currentWindows", () => {
  it("drops windows that already reset", () => {
    const now = 1_000_000_000_000;
    const w = [{ resetsAt: now / 1000 - 10 }, { resetsAt: now / 1000 + 10 }, { resetsAt: null }];
    expect(currentWindows(w, now)).toEqual([w[1], w[2]]);
    expect(currentWindows(undefined, now)).toEqual([]);
  });
});
