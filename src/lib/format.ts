// Formatting helpers. Pure functions (unit tested in format.test.ts).

/** 482_700_000 -> "482.7M" */
export function compact(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "–";
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [v, s] of units) {
    if (abs >= v) {
      const x = n / v;
      return `${x.toFixed(1).replace(/\.0$/, "")}${s}`;
    }
  }
  return String(Math.round(n));
}

export function usd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return "$0";
  return `$${n.toFixed(4)}`;
}

export function pct(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null || !isFinite(ratio)) return "–";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null || ms < 0 || !isFinite(ms)) return "–";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function ago(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return "never";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!isFinite(t)) return "–";
  const d = Math.max(0, now - t);
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Reset time in epoch seconds -> "21:14" today, "Tue 08:00" this week, else date. */
export function resetLabel(epochSec: number | null | undefined, now = new Date()): string {
  if (!epochSec) return "";
  const d = new Date(epochSec * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  if (days < 6.5 && days > -1) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function windowLabel(w: string, minutes: number | null): string {
  if (w === "five_hour" || minutes === 300) return "5-hour window";
  if (w === "seven_day" || minutes === 10080) return "Weekly";
  if (minutes) return minutes % 1440 === 0 ? `${minutes / 1440}-day window` : `${Math.round(minutes / 60)}-hour window`;
  return w;
}

export function shortPath(p: string, max = 42): string {
  if (p.length <= max) return p;
  const parts = p.split(/[\\/]/);
  const tail = parts.slice(-2).join("\\");
  return `…\\${tail}`.slice(-max);
}

export function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Quota windows that have not reset yet (a stale 98 % from before the reset is misleading). */
export function currentWindows<T extends { resetsAt: number | null }>(windows: T[] | undefined, now = Date.now()): T[] {
  return (windows ?? []).filter((w) => !w.resetsAt || w.resetsAt * 1000 > now);
}
