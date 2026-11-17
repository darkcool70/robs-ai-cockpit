import type { Account, AuthStatus, Provider } from "./api";

/** State of the login process (the utility terminal session) as the dialog sees it. */
export type ProcState = "starting" | "running" | "exited";

/** What the dialog knew about the account before the login started. */
export interface Baseline {
  status: AuthStatus;
  email: string | null;
}

export type StepState = "pending" | "active" | "done" | "failed";

export interface FlowView {
  /** The three steps: browser opens, sign in, done. */
  steps: [StepState, StepState, StepState];
  phase: "working" | "success" | "failed";
  headline: string;
}

export function baselineOf(a: Pick<Account, "authStatus" | "authEmail">): Baseline {
  return { status: a.authStatus, email: a.authEmail ?? null };
}

/** Process state from what the store knows about the login session. */
export function procState(
  s: { status?: string; endedAt?: string | null; runtime?: { running: boolean } | null } | null | undefined,
): ProcState {
  if (!s) return "starting";
  if (s.runtime) return s.runtime.running ? "running" : "exited";
  if (s.endedAt || s.status === "stopped" || s.status === "failed") return "exited";
  return "running";
}

/**
 * Has the login really happened? "connected" alone is not enough when the account was already
 * connected before (switching account): then the CLI has to finish (exit 0) or report another login.
 */
export function isLoggedIn(opts: {
  baseline: Baseline;
  status: AuthStatus;
  email: string | null;
  proc: ProcState;
  exitCode: number | null;
}): boolean {
  if (opts.status !== "connected") return false;
  if (opts.baseline.status !== "connected") return true;
  const changed = !!opts.email && opts.email !== opts.baseline.email;
  return changed || (opts.proc === "exited" && (opts.exitCode ?? 0) === 0);
}

export function flowView(opts: {
  loggedIn: boolean;
  proc: ProcState;
  hasLoginUrl: boolean;
  /** ms since the process started */
  elapsedMs: number;
  /** the final status check after the process exit has finished */
  finalChecked: boolean;
  startError: boolean;
}): FlowView {
  if (opts.loggedIn) return { steps: ["done", "done", "done"], phase: "success", headline: "Logged in" };
  if (opts.startError) return { steps: ["failed", "pending", "pending"], phase: "failed", headline: "The login could not be started" };
  if (opts.proc === "exited") {
    if (!opts.finalChecked) return { steps: ["done", "active", "pending"], phase: "working", headline: "Checking the login…" };
    return { steps: ["done", "failed", "pending"], phase: "failed", headline: "The login ended without a connected account" };
  }
  // The browser step lasts until the CLI printed its link, or a few seconds passed.
  const browserOpen = opts.proc === "starting" || (!opts.hasLoginUrl && opts.elapsedMs < 6000);
  return browserOpen
    ? { steps: ["active", "pending", "pending"], phase: "working", headline: "Waiting for the CLI to open the sign-in page…" }
    : { steps: ["done", "active", "pending"], phase: "working", headline: "Sign in, then come back — this window notices it by itself" };
}

export const STEP_LABELS = ["Browser opens", "Sign in", "Done"] as const;

/** One line: what will happen for this provider. */
export function loginInstruction(provider: Provider, name: string, device = false): string {
  if (device) {
    return `A short code appears below. Open the link in any browser window (a private one is fine), enter the code and sign in with the account you want for ${name}.`;
  }
  switch (provider) {
    case "claude":
      return `A fresh private browser window opens so you can choose the account for ${name}. Sign in there — the cockpit notices it.`;
    case "codex":
      return `Codex opens your default browser. If it is signed in to the wrong ChatGPT account, use "Open login in private window" or the device code login.`;
    case "copilot":
      return `Copilot shows a one-time code and github.com/login/device — open it (or use "Open login in private window") and sign in with your GitHub account.`;
    case "antigravity":
      return `agy asks how to sign in: choose Google sign-in, log in in the browser, paste the code back here, then accept its terms and the folder trust question.`;
    default:
      return `Follow the prompts of the CLI below to sign in to ${name}.`;
  }
}

/** Providers whose login CLI offers a device-code variant. */
export function hasDeviceLogin(provider: Provider): boolean {
  return provider === "codex";
}
