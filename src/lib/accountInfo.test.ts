import { describe, expect, it } from "vitest";
import type { Account, QuotaWindow } from "./api";
import { accountSummary, planOf, sameLogin, shortWindow, tightest, windowInfos } from "./accountInfo";

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const win = (window: string, minutes: number, used: number, resetInMin: number | null, minAgo = 0): QuotaWindow => ({
  window, usedPercent: used, windowMinutes: minutes, resetsAt: resetInMin == null ? null : NOW / 1000 + resetInMin * 60,
  source: "claude-statusline", capturedAt: NOW - minAgo * 60_000,
});
const acc = (over: Partial<Account> = {}): Account => ({
  id: "a1", provider: "claude", name: "Claude A", configDir: "C:\\p", managed: true, color: null,
  authStatus: "connected", authDetail: "Claude subscription (max)", authCheckedAt: null, lastUsedAt: null,
  createdAt: "", sort: 0, authEmail: "rob@example.com", authOrg: null, ...over,
});

describe("planOf", () => {
  it("reads the plan the CLI reported", () => {
    expect(planOf(acc())).toBe("Max");
    expect(planOf(acc({ authDetail: "Claude subscription (pro)" }))).toBe("Pro");
    expect(planOf(acc({ authDetail: "Claude subscription (max_20x)" }))).toBe("Max_20x");
  });
  it("is null when no plan was reported", () => {
    expect(planOf(acc({ authDetail: "ChatGPT subscription" }))).toBeNull();
    expect(planOf(acc({ authDetail: null }))).toBeNull();
  });
});

describe("windowInfos", () => {
  it("drops windows that already reset and sorts the shortest first", () => {
    const infos = windowInfos([win("seven_day", 10080, 30, 3000), win("five_hour", 300, 40, 125)], [], NOW);
    expect(infos.map((w) => w.short)).toEqual(["5h", "Week"]);
    expect(infos[0].until).toBe("in 2h 5m");
    expect(windowInfos([win("five_hour", 300, 99, -5)], [], NOW)).toEqual([]);
  });
  it("flags a window that runs out before its reset at the current pace", () => {
    const hist = [win("five_hour", 300, 40, 180, 60), win("five_hour", 300, 70, 180, 0)];
    const [w] = windowInfos([hist[1]], hist, NOW);
    expect(w.runsOut).toBe(true);
    const [slow] = windowInfos([win("five_hour", 300, 70, 30)], [win("five_hour", 300, 69, 30, 60)], NOW);
    expect(slow.runsOut).toBe(false);
  });
  it("picks the fullest window as the tightest", () => {
    const infos = windowInfos([win("five_hour", 300, 20, 60), win("seven_day", 10080, 85, 3000)], [], NOW);
    expect(tightest(infos)?.short).toBe("Week");
    expect(tightest([])).toBeNull();
  });
});

describe("shortWindow / accountSummary", () => {
  it("names unusual windows by their length", () => {
    expect(shortWindow("x", 4320)).toBe("3d");
    expect(shortWindow("x", 120)).toBe("2h");
  });
  it("summarises login, plan and quota for the hover text", () => {
    const text = accountSummary(acc(), windowInfos([win("five_hour", 300, 42, 65)], [], NOW), NOW);
    expect(text).toContain("Claude A · Max · connected");
    expect(text).toContain("rob@example.com");
    expect(text).toMatch(/5-hour window: 42% used · resets .+ \(in 1h 5m\)/);
    expect(accountSummary(acc({ authEmail: null }), [], NOW)).toContain("No quota data yet");
  });
});

describe("sameLogin", () => {
  it("finds other profiles of the same provider signed in with the same email", () => {
    const a = acc({ id: "a", authEmail: "Rob@Example.com" });
    const b = acc({ id: "b", name: "Claude B", authEmail: "rob@example.com", authStatus: "expired" });
    const other = acc({ id: "c", authEmail: "someone@example.com" });
    const codex = acc({ id: "d", provider: "codex", authEmail: "rob@example.com" });
    const out = acc({ id: "e", authEmail: "rob@example.com", authStatus: "logged-out" });
    expect(sameLogin([a, b, other, codex, out], a).map((x) => x.id)).toEqual(["b"]);
    expect(sameLogin([a, b], acc({ id: "z", authEmail: null }))).toEqual([]);
  });
});
