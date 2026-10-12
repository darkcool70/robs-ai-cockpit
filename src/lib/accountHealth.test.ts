import { describe, expect, it } from "vitest";
import type { Account, RuntimeView } from "./api";
import {
  ISSUE_FRESH_MS, accountModel, clearIssue, failingModel, freshIssue, healthUpdate, issueFix, readIssues,
  suggestModel, troubledAccounts, withAccountModel, type AccountIssues,
} from "./accountHealth";
import { bestAccounts, pickFailoverAccount } from "./failover";

const MSG = "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account. (400)";
const now = 1_000_000_000_000;
type Rt = Pick<RuntimeView, "status" | "error" | "turnStartedAt" | "lastMessage" | "model">;
const rt = (x: Partial<Rt>): Rt => ({ status: "idle", error: null, turnStartedAt: null, lastMessage: null, model: null, ...x });
const failed = (at = now - 1000, kind: "model" | "auth" = "model") => rt({ status: "error", error: { kind, message: MSG, at }, turnStartedAt: at - 500 });
const acc = (id: string, provider: "claude" | "codex"): Account => ({
  id, provider, name: id, configDir: `/p/${id}`, managed: true, color: null, authStatus: "connected", authDetail: null,
  authCheckedAt: null, lastUsedAt: null, createdAt: "t", sort: 0,
});

describe("account health", () => {
  it("remembers a turn that failed on the model or the login — once per failure", () => {
    const next = healthUpdate({}, "cx1", failed(), null, now)!;
    expect(next.cx1).toEqual({ kind: "model", message: MSG, at: now - 1000, model: "gpt-6.1-sol" });
    expect(healthUpdate(next, "cx1", failed(), null, now)).toBeNull();
    expect(healthUpdate({}, "cl1", failed(now - 10, "auth"), null, now)?.cl1.kind).toBe("auth");
    // other failures (overloaded, network, limit) say nothing about the account itself
    expect(healthUpdate({}, "cx1", rt({ status: "error", error: { kind: "server", message: "529", at: now } }), null, now)).toBeNull();
    expect(healthUpdate({}, "cx1", rt({ status: "rate-limited", error: { kind: "limit", message: "x", at: now } }), null, now)).toBeNull();
    expect(healthUpdate({}, null, failed(), null, now)).toBeNull();
  });

  it("forgets it when a later turn on the account answered", () => {
    const issues: AccountIssues = { cx1: { kind: "model", message: MSG, at: now - 1000 } };
    expect(healthUpdate(issues, "cx1", rt({ status: "waiting-for-input", turnStartedAt: now - 500, lastMessage: "Fertig." }), null, now)).toEqual({});
    // the failed turn itself, a turn that started before the failure, or no answer: kept
    expect(healthUpdate(issues, "cx1", rt({ status: "idle", turnStartedAt: now - 2000, lastMessage: "alt" }), null, now)).toBeNull();
    expect(healthUpdate(issues, "cx1", rt({ status: "idle", turnStartedAt: now - 500, lastMessage: "" }), null, now)).toBeNull();
    expect(healthUpdate(issues, "cx1", rt({ status: "working", turnStartedAt: now - 500, lastMessage: "…" }), null, now)).toBeNull();
    expect(clearIssue(issues, "cx1")).toEqual({});
    expect(clearIssue(issues, "zz")).toBe(issues);
  });

  it("is fresh for 6 hours; old entries are dropped when written", () => {
    const issues: AccountIssues = { a: { kind: "model", message: "", at: now - ISSUE_FRESH_MS + 1 }, b: { kind: "auth", message: "", at: now - ISSUE_FRESH_MS - 1 } };
    expect(freshIssue(issues, "a", now)).not.toBeNull();
    expect(freshIssue(issues, "b", now)).toBeNull();
    expect([...troubledAccounts(issues, now)]).toEqual(["a"]);
    const old: AccountIssues = { z: { kind: "model", message: "", at: now - 8 * 24 * 3600_000 } };
    expect(Object.keys(healthUpdate(old, "cx1", failed(), null, now)!)).toEqual(["cx1"]);
    expect(readIssues({})).toBe(readIssues({ accountHealth: null }));
    expect(readIssues({ accountHealth: issues })).toBe(issues);
  });

  it("reads the failing model from the message, else from the session", () => {
    expect(failingModel(MSG)).toBe("gpt-6.1-sol");
    expect(failingModel("API Error: 404 model: claude-opus-9 not found")).toBe("claude-opus-9");
    expect(failingModel("model is not supported")).toBeNull();
    const e = rt({ status: "error", error: { kind: "model", message: "model not available", at: now } });
    expect(healthUpdate({}, "x", e, "gpt-5.9", now)?.x.model).toBe("gpt-5.9");
  });

  it("the automatic choice skips a troubled account while another one works", () => {
    const accounts = [acc("cx1", "codex"), acc("cx2", "codex"), acc("cl1", "claude")];
    const avoid = new Set(["cx1"]);
    const quota = { cx2: [{ window: "five_hour", usedPercent: 60, windowMinutes: 300, resetsAt: null, source: "x", capturedAt: 0 }] };
    expect(pickFailoverAccount({ provider: "codex", accountId: null }, accounts, quota, [], now)?.id).toBe("cx1");
    expect(pickFailoverAccount({ provider: "codex", accountId: null }, accounts, quota, [], now, avoid)?.id).toBe("cx2");
    expect(bestAccounts(accounts, quota, [], now, avoid).codex?.id).toBe("cx2");
    // the only Codex account is still recommended (never no choice)
    expect(bestAccounts([acc("cx1", "codex")], {}, [], now, avoid).codex?.id).toBe("cx1");
  });

  it("the cockpit's model per account: applied only when the session chose none; a suggestion", () => {
    const settings = { accountModels: { cx1: "gpt-5.5" } };
    expect(accountModel(settings, "cx1")).toBe("gpt-5.5");
    expect(accountModel(settings, "cl1")).toBeUndefined();
    expect(withAccountModel({ accountId: "cx1" }, settings)).toEqual({ accountId: "cx1", model: "gpt-5.5" });
    expect(withAccountModel({ accountId: "cx1", model: "o9" }, settings).model).toBe("o9");
    const plain = { accountId: "cl1" };
    expect(withAccountModel(plain, settings)).toBe(plain);
    const catalog = [{ id: "gpt-6.1-sol", label: "Sol", efforts: [] }, { id: "gpt-5.5", label: "5.5", efforts: [] }];
    expect(suggestModel(catalog, "gpt-6.1-sol")).toBe("gpt-5.5");
    expect(suggestModel(catalog, "gpt-6.1-sol", "gpt-5.5")).toBeNull();
    expect(suggestModel([], null)).toBeNull();
  });

  it("says the fix in the profile's own config file", () => {
    const i = { kind: "model" as const, message: MSG, at: now, model: "gpt-6.1-sol" };
    expect(issueFix(i, "codex", "C:\\Users\\r\\.codex")).toContain("C:\\Users\\r\\.codex\\config.toml (model = \"…\")");
    expect(issueFix(i, "claude", "/home/r/.claude")).toContain("/home/r/.claude/settings.json");
    expect(issueFix({ ...i, kind: "auth" }, "codex", "/x")).toMatch(/Log in again/);
  });
});
