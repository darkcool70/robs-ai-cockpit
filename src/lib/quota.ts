// Quota pace and forecasts from the snapshot history (pure; unit tested in quota.test.ts).
import type { QuotaWindow } from "./api";

/** "in 2h 5m" / "in 12m" / "now" for an epoch-seconds reset time. */
export function untilLabel(epochSec: number | null | undefined, now = Date.now()): string {
  if (!epochSec) return "";
  const min = Math.round((epochSec * 1000 - now) / 60_000);
  if (min <= 0) return "now";
  if (min < 60) return `in ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `in ${h}h ${min % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export interface Pace {
  /** Percentage points per hour over the recent past, null without enough data. */
  perHour: number | null;
  /** When 100 % is reached at this pace (epoch ms), null if not rising. */
  fullAt: number | null;
  /** True when that happens before the window resets. */
  beforeReset: boolean;
}

/**
 * Pace of one window over the last `lookbackMin` minutes up to now (snapshots of the same window
 * period). Snapshots only arrive while a CLI is used, so quiet time counts as no usage: a burst an
 * hour ago no longer predicts anything.
 */
export function paceOf(history: QuotaWindow[], current: QuotaWindow | undefined, now = Date.now(), lookbackMin = 60): Pace {
  const none: Pace = { perHour: null, fullAt: null, beforeReset: false };
  if (!current) return none;
  const since = now - lookbackMin * 60_000;
  const samePeriod = (w: QuotaWindow) =>
    w.window === current.window && (current.resetsAt == null || w.resetsAt == null || Math.abs(w.resetsAt - current.resetsAt) <= 120);
  const pts = history.filter((w) => samePeriod(w) && w.capturedAt >= since).sort((a, b) => a.capturedAt - b.capturedAt);
  if (current.capturedAt >= since && !pts.some((p) => p.capturedAt === current.capturedAt)) pts.push(current);
  if (pts.length < 2) return none;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const hours = (now - first.capturedAt) / 3_600_000;
  if (hours < 5 / 60) return none;
  const perHour = Math.max(0, (last.usedPercent - first.usedPercent) / hours);
  if (perHour < 0.5 || last.usedPercent >= 100) return { perHour, fullAt: null, beforeReset: false };
  const fullAt = now + ((100 - last.usedPercent) / perHour) * 3_600_000;
  const beforeReset = current.resetsAt != null && fullAt < current.resetsAt * 1000;
  return { perHour, fullAt, beforeReset };
}
