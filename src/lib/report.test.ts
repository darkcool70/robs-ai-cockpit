import { describe, expect, it } from "vitest";
import type { UsageSummary } from "./api";
import { buildReport } from "./report";

const totals = (total: number) => ({ input: total / 2, output: total / 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, total, records: 1 });

describe("usage report", () => {
  it("summarises tokens, agents and tasks as Markdown tables", () => {
    const summary = {
      range: "7d", fromMs: 0, totals: totals(2_000_000), cacheHitRatio: 0.9,
      byAccount: [{ key: "a", label: "Claude B", provider: "claude", totals: totals(1_500_000), apiValueUsd: null }],
      byProvider: [], byModel: [{ key: "m", label: "claude-opus", provider: "claude", totals: totals(2_000_000), apiValueUsd: 12.5 }],
      byProject: [], bySession: [], byDay: [{ key: "2026-09-27", total: 2_000_000, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }],
      byWeek: [], byHour: [], apiValue: { valueUsd: 12.5, pricedTokens: 2_000_000, unpricedModels: [] },
    } as unknown as UsageSummary;
    const md = buildReport({
      title: "Wochenbericht",
      from: new Date(2026, 8, 21),
      to: new Date(2026, 8, 27),
      summary,
      stats: [{ sessionId: "s", sessionName: "Claude B #1", turns: 4, workingMs: 3_600_000, waitingMs: 600_000, files: 7, inputs: 1, limits: 0 }],
      tasks: [
        { id: "t", title: "Parser fixen", text: "", status: "done", sessionId: "s", result: "ok", sort: 1, createdAt: "", updatedAt: "", startedAt: new Date(2026, 8, 25).getTime(), finishedAt: new Date(2026, 8, 25, 1).getTime() },
        { id: "u", title: "Doku", text: "", status: "open", sessionId: null, result: null, sort: 2, createdAt: "", updatedAt: "", startedAt: null, finishedAt: null },
      ],
    });
    expect(md).toContain("# Wochenbericht");
    expect(md).toContain("| Tokens gesamt | 2M");
    expect(md).toContain("| Claude B | 1.5M | 75% |");
    expect(md).toContain("| Claude B #1 | 4 | 1h 0m | 10m 0s | 7 | 1 |");
    expect(md).toContain("- Parser fixen (1h 0m)");
    expect(md).toContain("- Doku — open");
    expect(md).toContain("$12.50");
  });
});
