// Account health: the last turn on an account that failed because the account cannot use the
// configured model or its login failed. Remembered (setting "accountHealth") so that new agents and
// reviewers do not keep landing on an account that fails every turn the same way; cleared when a
// later turn on that account succeeds, or by the user ("Try again"). Pure (unit tested); the store
// writes it, failover.ts / the operator read it.
import type { ModelInfo, RuntimeView } from "./api";

export interface AccountIssue {
  kind: "model" | "auth";
  /** what the CLI said ("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account. (400)") */
  message: string;
  /** when the failure happened (epoch ms) */
  at: number;
  /** the model that failed, when known (from the message or the session) */
  model?: string | null;
}

export type AccountIssues = Record<string, AccountIssue>;

/** How long a failure keeps an account out of the automatic choice (when another one works). */
export const ISSUE_FRESH_MS = 6 * 3600_000;
/** Older entries are dropped when the map is written. */
const ISSUE_KEEP_MS = 7 * 24 * 3600_000;

const NONE: AccountIssues = Object.freeze({}) as AccountIssues;
const NO_MODELS: Record<string, string> = Object.freeze({}) as Record<string, string>;

/** The remembered issues (setting "accountHealth"); a stable empty object when there are none. */
export function readIssues(settings: Record<string, unknown>): AccountIssues {
  const v = settings.accountHealth;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AccountIssues) : NONE;
}

/** The account's issue while it is fresh (< 6 h), else null. */
export function freshIssue(issues: AccountIssues, accountId: string | null | undefined, now = Date.now()): AccountIssue | null {
  const i = accountId ? issues[accountId] : undefined;
  return i && now - i.at < ISSUE_FRESH_MS ? i : null;
}

/** Accounts with a fresh issue — the automatic choice skips them while another account works. */
export function troubledAccounts(issues: AccountIssues, now = Date.now()): Set<string> {
  return new Set(Object.keys(issues).filter((id) => freshIssue(issues, id, now)));
}

/** The model named in an error text: "The 'gpt-6.1-sol' model is …", "model: claude-opus-9 not found". */
export function failingModel(message: string): string | null {
  const m =
    /['"`‘’“”]([\w.:/-]+)['"`‘’“”]\s+model\b/i.exec(message) ??
    /\bmodel[:\s]+['"`]?([\w.:/-]*\d[\w.:/-]*)['"`]?/i.exec(message);
  return m?.[1] ?? null;
}

/**
 * The new issue map after a runtime update of a session on `accountId`, or null when nothing
 * changes. A turn that failed on the model or the login is remembered; a turn that started after
 * the failure and ended with an answer clears it.
 */
export function healthUpdate(
  issues: AccountIssues,
  accountId: string | null | undefined,
  rt: Pick<RuntimeView, "status" | "error" | "turnStartedAt" | "lastMessage" | "model">,
  requestedModel: string | null = null,
  now = Date.now(),
): AccountIssues | null {
  if (!accountId) return null;
  const have = issues[accountId];
  const e = rt.error;
  if (rt.status === "error" && e && (e.kind === "model" || e.kind === "auth")) {
    const at = e.at || now;
    if (have && have.at === at && have.kind === e.kind) return null;
    const model = e.kind === "model" ? failingModel(e.message) ?? requestedModel ?? rt.model ?? null : null;
    return prune({ ...issues, [accountId]: { kind: e.kind, message: e.message.slice(0, 300), at, model } }, now);
  }
  const answered = (rt.status === "idle" || rt.status === "waiting-for-input") && !e && !!(rt.lastMessage ?? "").trim();
  if (have && answered && (rt.turnStartedAt ?? 0) > have.at) return clearIssue(issues, accountId);
  return null;
}

/** The map without the account's issue (the same map when it had none). */
export function clearIssue(issues: AccountIssues, accountId: string): AccountIssues {
  if (!(accountId in issues)) return issues;
  const next = { ...issues };
  delete next[accountId];
  return next;
}

function prune(issues: AccountIssues, now: number): AccountIssues {
  const out: AccountIssues = {};
  for (const [id, i] of Object.entries(issues)) if (now - i.at < ISSUE_KEEP_MS) out[id] = i;
  return out;
}

// ---------------------------------------------------------------------------
// The cockpit's own model per account (setting "accountModels"): when the configured model fails,
// the user can let the cockpit start its agents on that account with another model. The CLI's own
// config files are never touched.
// ---------------------------------------------------------------------------

export function readAccountModels(settings: Record<string, unknown>): Record<string, string> {
  const v = settings.accountModels;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : NO_MODELS;
}

/** The model the cockpit uses for new sessions on the account ("" / undefined: the CLI's default). */
export function accountModel(settings: Record<string, unknown>, accountId: string | null | undefined): string | undefined {
  const m = accountId ? readAccountModels(settings)[accountId] : undefined;
  return typeof m === "string" && m.trim() ? m.trim() : undefined;
}

/** A session input with the account's cockpit model when none was chosen explicitly. */
export function withAccountModel<T extends { accountId: string; model?: string }>(input: T, settings: Record<string, unknown>): T {
  if (input.model?.trim()) return input;
  const model = accountModel(settings, input.accountId);
  return model ? ({ ...input, model } as T) : input;
}

/** The model to propose instead of the failing one: the first other model of the account's catalog. */
export function suggestModel(catalog: ModelInfo[], failing: string | null | undefined, current?: string | null): string | null {
  const bad = new Set([failing, current].filter(Boolean).map((x) => x!.toLowerCase()));
  return catalog.find((m) => !bad.has(m.id.toLowerCase()))?.id ?? null;
}

/** What fixes the issue, in one or two sentences (English, like the Accounts page). */
export function issueFix(i: AccountIssue, provider: string, configDir: string): string {
  if (i.kind === "auth") return "Log in again with the button below; the cockpit tries this account again after the next successful turn.";
  const sep = configDir.includes("\\") ? "\\" : "/";
  // Copilot keeps its default model in config.json; Claude and Antigravity in settings.json
  const file = `${configDir}${sep}${provider === "codex" ? "config.toml" : provider === "copilot" ? "config.json" : "settings.json"}`;
  const what = provider === "codex" ? `model = "…"` : `"model": "…"`;
  return `This account cannot use ${i.model ? `“${i.model}”` : "the configured model"}. Set another model in ${file} (${what}), or let the cockpit use another model for its agents here.`;
}
