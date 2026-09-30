import { describe, expect, it } from "vitest";
import type { QuotaWindow } from "./api";
import { paceOf, untilLabel } from "./quota";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const w = (minAgo: number, used: number, resetsAt = NOW / 1000 + 3 * 3600): QuotaWindow => ({
  window: "five_hour", usedPercent: used, windowMinutes: 300, resetsAt, source: "statusline", capturedAt: NOW - minAgo * 60_000,
});

describe("quota pace", () => {
  it("forecasts when a rising window is full, and whether that is before the reset", () => {
    const hist = [w(60, 40), w(30, 55), w(0, 70)];
    const p = paceOf(hist, hist[2], NOW);
    expect(p.perHour).toBeCloseTo(30);
    expect(p.fullAt).toBe(NOW + 3_600_000); // 30 points left at 30/h
    expect(p.beforeReset).toBe(true);
  });
  it("counts quiet time since the last snapshot as no usage", () => {
    const hist = [w(50, 60), w(40, 98)];
    const p = paceOf(hist, hist[1], NOW);
    expect(p.perHour).toBeCloseTo(38 / (50 / 60));
    const stale = [w(80, 60), w(70, 98)];
    expect(paceOf(stale, stale[1], NOW).perHour).toBeNull();
  });
  it("needs two points over at least five minutes", () => {
    expect(paceOf([w(0, 50)], w(0, 50), NOW).perHour).toBeNull();
    expect(paceOf([w(2, 49), w(0, 50)], w(0, 50), NOW).perHour).toBeNull();
  });
  it("ignores the previous window period and flat usage", () => {
    const old = w(80, 95, NOW / 1000 - 600); // before the last reset
    const hist = [old, w(40, 10), w(0, 10)];
    const p = paceOf(hist, hist[2], NOW);
    expect(p.perHour).toBe(0);
    expect(p.fullAt).toBeNull();
  });
  it("labels the time until a reset", () => {
    expect(untilLabel(NOW / 1000 + 125 * 60, NOW)).toBe("in 2h 5m");
    expect(untilLabel(NOW / 1000 + 12 * 60, NOW)).toBe("in 12m");
    expect(untilLabel(NOW / 1000 - 60, NOW)).toBe("now");
    expect(untilLabel(null, NOW)).toBe("");
  });
});
