// What the cockpit knows about an account, condensed for the pane header and the account cards
// (pure; unit tested in accountInfo.test.ts). Only values the CLIs report themselves: the plan from
// `auth status`, quota windows from statusLine / rollout logs. Subscription renewal dates are not
// reported anywhere the cockpit may read, so they are deliberately absent.
import type { Account, QuotaWindow } from "./api";
import { currentWindows, resetLabel, windowLabel } from "./format";
import { paceOf, untilLabel, type Pace } from "./quota";

const PLAN_NAMES: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", plus: "Plus", free: "Free" };

/** "Max" from "Claude subscription (max)"; null when the CLI did not say. */
export function planOf(a: Pick<Account, "authDetail">): string | null {
  const m = /subscription \(([^)]+)\)/i.exec(a.authDetail ?? "");
  if (!m) return null;
  const raw = m[1].trim();
  return PLAN_NAMES[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** "5h" / "Week" / "3d": the short name of a quota window for tight spots. */
export function shortWindow(w: string, minutes: number | null): string {
  if (w === "five_hour" || minutes === 300) return "5h";
  if (w === "seven_day" || minutes === 10080) return "Week";
  if (minutes) return minutes % 1440 === 0 ? `${minutes / 1440}d` : `${Math.round(minutes / 60)}h`;
  return w;
}

export interface WindowInfo {
  key: string;
  label: string;
  short: string;
  used: number;
  resetsAt: number | null;
  /** "in 2h 5m", empty without a reset time. */
  until: string;
  pace: Pace;
  /** At the current pace the window is full before it resets. */
  runsOut: boolean;
}

/** Current (not yet reset) windows, shortest first, with countdown and pace. */
export function windowInfos(windows: QuotaWindow[] | undefined, history: QuotaWindow[] = [], now = Date.now()): WindowInfo[] {
  return currentWindows(windows, now)
    .slice()
    .sort((x, y) => (x.windowMinutes ?? 0) - (y.windowMinutes ?? 0))
    .map((w) => {
      const pace = paceOf(history, w, now);
      return {
        key: w.window,
        label: windowLabel(w.window, w.windowMinutes),
        short: shortWindow(w.window, w.windowMinutes),
        used: w.usedPercent,
        resetsAt: w.resetsAt,
        until: untilLabel(w.resetsAt, now),
        pace,
        runsOut: pace.beforeReset && w.usedPercent < 100,
      };
    });
}

/** The fullest current window: what limits the account first. */
export function tightest(infos: WindowInfo[]): WindowInfo | null {
  return infos.reduce<WindowInfo | null>((m, w) => (!m || w.used > m.used ? w : m), null);
}

const AUTH_TEXT: Record<string, string> = {
  connected: "connected",
  "connected-api": "API login (not a subscription)",
  "logged-out": "logged out",
  expired: "login expired",
  error: "login error",
  unknown: "login not checked",
};

/** Multi-line hover text for the account chip. */
export function accountSummary(a: Account, infos: WindowInfo[], now = Date.now()): string {
  const plan = planOf(a);
  const lines = [[a.name, plan, AUTH_TEXT[a.authStatus] ?? a.authStatus].filter(Boolean).join(" · ")];
  if (a.authEmail) lines.push(a.authOrg ? `${a.authEmail} · ${a.authOrg}` : a.authEmail);
  for (const w of infos) {
    const reset = w.resetsAt ? ` · resets ${resetLabel(w.resetsAt, new Date(now))} (${w.until})` : "";
    lines.push(`${w.label}: ${w.used.toFixed(0)}% used${reset}${w.runsOut ? " · runs out before reset at this pace" : ""}`);
  }
  if (!infos.length && a.provider !== "custom") lines.push("No quota data yet (appears after the first reply)");
  lines.push("Click for details and to switch account");
  return lines.join("\n");
}

/** Other profiles of the same provider signed in with the same login: they share one subscription and quota. */
export function sameLogin<T extends Pick<Account, "id" | "provider" | "authEmail" | "authStatus">>(all: T[], a: T): T[] {
  const email = a.authEmail?.trim().toLowerCase();
  if (!email || a.authStatus === "logged-out") return [];
  return all.filter((o) => o.id !== a.id && o.provider === a.provider && o.authStatus !== "logged-out" && o.authEmail?.trim().toLowerCase() === email);
}
