import type { Provider } from "./api";

/**
 * What the cockpit knows about each agent CLI: names, login wording, where its profile lives and
 * whether it runs on a free tier (docs/PROVIDERS.md has the research behind it). One place, so
 * the Accounts page, the new-session dialog and the account choice agree.
 */
export interface ProviderInfo {
  id: Provider;
  /** Product name. */
  label: string;
  /** Two letters for the provider mark. */
  short: string;
  /** What the login is ("Claude Pro / Max subscription"). */
  plan: string;
  /** Text of the login button. */
  loginLabel: string;
  /** CSS colour of the mark. */
  color: string;
  /** Env var of an isolated profile ("" = the CLI's default folder only). */
  configEnv: string;
  /** The CLI's default folder (shown in the add dialog). */
  defaultDir: string;
  /** How to install it (shown when it is missing). */
  install: string;
  /** "free": a free tier exists (small quota, weaker or automatic model); "strong": a paid subscription. */
  tier: "free" | "strong";
  /** One login per Windows user (the CLI keeps it in the OS keyring): no extra profiles. */
  singleProfile?: boolean;
  /** Where the user sees the remaining quota. */
  quotaHint: string;
}

export const PROVIDERS: Record<Exclude<Provider, "custom">, ProviderInfo> = {
  claude: {
    id: "claude", label: "Claude Code", short: "CC", plan: "Claude Pro / Max subscription", loginLabel: "Log in with Claude",
    color: "var(--color-claude)", configEnv: "CLAUDE_CONFIG_DIR", defaultDir: "~/.claude", install: "npm i -g @anthropic-ai/claude-code",
    tier: "strong", quotaHint: "Opens Claude Code; type /status or /usage",
  },
  codex: {
    id: "codex", label: "Codex", short: "CX", plan: "ChatGPT Plus / Pro subscription", loginLabel: "Log in with ChatGPT",
    color: "var(--color-codex)", configEnv: "CODEX_HOME", defaultDir: "~/.codex", install: "npm i -g @openai/codex",
    tier: "strong", quotaHint: "Opens Codex; type /status",
  },
  copilot: {
    id: "copilot", label: "GitHub Copilot CLI", short: "GH", plan: "GitHub account — Copilot Free included", loginLabel: "Log in with GitHub",
    color: "#8b5cf6", configEnv: "COPILOT_HOME", defaultDir: "~/.copilot", install: "npm i -g @github/copilot  (or: winget install GitHub.Copilot)",
    tier: "free", quotaHint: "Opens Copilot; type /usage",
  },
  antigravity: {
    id: "antigravity", label: "Antigravity CLI", short: "AG", plan: "Google account — small free quota", loginLabel: "Sign in with Google",
    color: "#3b82f6", configEnv: "", defaultDir: "~/.gemini/antigravity-cli", install: "irm https://antigravity.google/cli/install.ps1 | iex",
    tier: "free", singleProfile: true, quotaHint: "Opens agy; type /usage",
  },
};

/** The agent CLIs in display order (the custom CLIs have their own section). */
export const AGENT_PROVIDERS = ["claude", "codex", "copilot", "antigravity"] as const satisfies readonly Provider[];
/** Providers with a free tier — cheap work goes there first. */
export const FREE_PROVIDERS = AGENT_PROVIDERS.filter((p) => PROVIDERS[p].tier === "free");
/** Providers with a strong (paid) model. */
export const STRONG_PROVIDERS = AGENT_PROVIDERS.filter((p) => PROVIDERS[p].tier === "strong");

export function providerInfo(p: Provider | null | undefined): ProviderInfo | null {
  return p && p !== "custom" ? PROVIDERS[p] ?? null : null;
}

export function isFreeTier(p: Provider | string | null | undefined): boolean {
  return FREE_PROVIDERS.includes(p as (typeof FREE_PROVIDERS)[number]);
}

/** A provider other than `p` for a second opinion (reviews): the other strong one first. */
export function otherProvider(p: string | null | undefined): Provider | undefined {
  if (p === "claude") return "codex";
  if (p === "codex") return "claude";
  // work done on a free account is reviewed by a strong model
  return p ? "claude" : undefined;
}
