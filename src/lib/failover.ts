import type { Account, QuotaWindow, Session } from "./api";

/**
 * Best other account to continue a rate-limited conversation on: same provider, logged in,
 * not limited right now, lowest known 5-hour usage. Pure (unit tested).
 */
export function pickFailoverAccount(
  s: Pick<Session, "provider" | "accountId">,
  accounts: Account[],
  quota: Record<string, QuotaWindow[]>,
  sessions: Pick<Session, "accountId" | "runtime" | "status">[],
  now = Date.now(),
): Account | null {
  const limitedNow = new Set(sessions.filter((x) => (x.runtime?.status ?? x.status) === "rate-limited").map((x) => x.accountId));
  const usage = (a: Account) => {
    const windows = (quota[a.id] ?? []).filter((w) => !w.resetsAt || w.resetsAt * 1000 > now);
    return windows.length ? Math.max(...windows.map((w) => w.usedPercent)) : null;
  };
  const candidates = accounts
    .filter((a) => a.provider === s.provider && a.id !== s.accountId && a.authStatus === "connected" && !limitedNow.has(a.id))
    .map((a) => ({ a, u: usage(a) }))
    .filter((x) => x.u == null || x.u < 95);
  candidates.sort((x, y) => (x.u ?? 50) - (y.u ?? 50));
  return candidates[0]?.a ?? null;
}

/**
 * Account with the most quota left per provider (logged in, not limited now). Used to
 * preselect / recommend an account for new work. Pure (unit tested).
 */
export function bestAccounts(
  accounts: Account[],
  quota: Record<string, QuotaWindow[]>,
  sessions: Pick<Session, "accountId" | "runtime" | "status">[],
  now = Date.now(),
): Partial<Record<Account["provider"], { id: string; usedPercent: number | null }>> {
  const out: Partial<Record<Account["provider"], { id: string; usedPercent: number | null }>> = {};
  for (const provider of ["claude", "codex"] as const) {
    const pick = pickFailoverAccount({ provider, accountId: null }, accounts, quota, sessions, now);
    if (!pick) continue;
    const windows = (quota[pick.id] ?? []).filter((w) => !w.resetsAt || w.resetsAt * 1000 > now);
    out[provider] = { id: pick.id, usedPercent: windows.length ? Math.max(...windows.map((w) => w.usedPercent)) : null };
  }
  return out;
}
