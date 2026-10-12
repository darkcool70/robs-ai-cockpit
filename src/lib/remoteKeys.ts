// Phone remote keys: a lifetime per key (8 h / 24 h / 7 days), a fresh random key on request and
// an optional second, view-only key for colleagues. The server enforces expiry and view-only
// (remote.rs); this only decides what to hand it and how to say it. Pure (unit-tested).

/** The lifetimes Settings offers, in hours. */
export const KEY_TTL_HOURS = [8, 24, 168] as const;
export const DEFAULT_TTL_HOURS = 24;
const HOUR = 3_600_000;

/** The chosen lifetime in hours (only the offered ones; default 24 h). */
export function ttlHours(settings: Record<string, unknown>): number {
  const h = Number(settings.remoteKeyTtl);
  return (KEY_TTL_HOURS as readonly number[]).includes(h) ? h : DEFAULT_TTL_HOURS;
}

/** 32 characters from an alphabet without look-alikes (≈ 186 bits). */
export function randomKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export interface RemoteKeys {
  key: string;
  /** ms */
  expires: number;
  viewKey: string | null;
  viewExpires: number;
}

const validKey = (k: unknown): k is string => typeof k === "string" && k.length >= 24 && /^[A-Za-z0-9]+$/.test(k);

/**
 * The saved keys. A key saved before keys expired gets the chosen lifetime from now; `fix` holds
 * those settings to save. No valid key: null (a new one is made when the remote is turned on).
 */
export function savedKeys(settings: Record<string, unknown>, now = Date.now()): { keys: RemoteKeys | null; fix: Record<string, number> } {
  const fix: Record<string, number> = {};
  if (!validKey(settings.remoteKey)) return { keys: null, fix };
  const life = ttlHours(settings) * HOUR;
  let expires = Number(settings.remoteKeyExpires);
  if (!(expires > 0)) expires = fix.remoteKeyExpires = now + life;
  let viewKey: string | null = validKey(settings.remoteViewKey) && settings.remoteViewKey !== settings.remoteKey ? settings.remoteViewKey : null;
  let viewExpires = Number(settings.remoteViewExpires);
  if (viewKey && !(viewExpires > 0)) viewExpires = fix.remoteViewExpires = now + life;
  if (!viewKey) viewExpires = 0;
  return { keys: { key: settings.remoteKey, expires, viewKey, viewExpires }, fix };
}

/** A new key with the chosen lifetime. */
export function freshKey(settings: Record<string, unknown>, now = Date.now()): { key: string; expires: number } {
  return { key: randomKey(), expires: now + ttlHours(settings) * HOUR };
}

/** "in 5 h", "in 40 min", "in 3 days", "expired" (Settings wording). */
export function untilLabel(expires: number, now = Date.now()): string {
  const ms = expires - now;
  if (ms <= 0) return "expired";
  if (ms < HOUR) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 48 * HOUR) return `in ${Math.round(ms / HOUR)} h`;
  return `in ${Math.round(ms / (24 * HOUR))} days`;
}

/** "Fri 18:30" — when the key stops working. */
export function expiryClock(expires: number): string {
  return new Date(expires).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export const ttlLabel = (h: number) => (h >= 48 ? `${h / 24} days` : `${h} hours`);
