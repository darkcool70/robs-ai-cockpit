import { describe, expect, it } from "vitest";
import type { Account, QuotaWindow } from "./api";
import { pickFailoverAccount } from "./failover";

const acc = (id: string, provider: "claude" | "codex", authStatus: Account["authStatus"] = "connected"): Account => ({
  id, provider, name: id, configDir: `/p/${id}`, managed: true, color: null, authStatus, authDetail: null,
  authCheckedAt: null, lastUsedAt: null, createdAt: "t", sort: 0,
});
const q = (usedPercent: number, resetsAt: number | null = null): QuotaWindow => ({
  window: "five_hour", usedPercent, windowMinutes: 300, resetsAt, source: "x", capturedAt: 0,
});

describe("pickFailoverAccount", () => {
  const now = 1_000_000_000_000;
  const s = { provider: "claude" as const, accountId: "a" };

  it("picks a logged-in account of the same provider with the most quota left", () => {
    const accounts = [acc("a", "claude"), acc("b", "claude"), acc("c", "claude"), acc("x", "codex")];
    const quota = { b: [q(80)], c: [q(10)] };
    expect(pickFailoverAccount(s, accounts, quota, [], now)?.id).toBe("c");
  });

  it("skips logged-out, exhausted and currently limited accounts", () => {
    const accounts = [acc("a", "claude"), acc("b", "claude", "logged-out"), acc("c", "claude"), acc("d", "claude")];
    const quota = { c: [q(99)] };
    const sessions = [{ accountId: "d", status: "rate-limited" as const, runtime: null }];
    expect(pickFailoverAccount(s, accounts, quota, sessions, now)).toBeNull();
  });

  it("ignores quota windows that already reset", () => {
    const accounts = [acc("a", "claude"), acc("b", "claude")];
    const quota = { b: [q(100, now / 1000 - 60)] };
    expect(pickFailoverAccount(s, accounts, quota, [], now)?.id).toBe("b");
  });
});

describe("recommended account for new work", () => {
  it("picks the connected account with most quota left per provider", async () => {
    const { bestAccounts } = await import("./failover");
    const acc = (id: string, provider: "claude" | "codex", authStatus = "connected") =>
      ({ id, provider, authStatus, name: id }) as unknown as import("./api").Account;
    const q = (used: number) => [{ window: "five_hour", usedPercent: used, windowMinutes: 300, resetsAt: null, source: "t", capturedAt: 0 }];
    const best = bestAccounts([acc("a", "claude"), acc("b", "claude"), acc("c", "claude", "logged-out"), acc("x", "codex")], { a: q(80), b: q(20), c: q(0), x: q(99) }, []);
    expect(best.claude).toEqual({ id: "b", usedPercent: 20 });
    expect(best.codex).toBeUndefined(); // 99 % is too close to the limit
  });
});
