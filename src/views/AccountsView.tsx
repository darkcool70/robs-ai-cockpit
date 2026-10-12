import { useEffect, useMemo, useState } from "react";
import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";
import { FolderOpen, KeyRound, LogIn, Plus, RefreshCw, Terminal, Trash2, Wand2 } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type Account, type Provider, type QuotaWindow, type UsageSummary } from "../lib/api";
import { ago, compact, currentWindows, resetLabel, windowLabel } from "../lib/format";
import { Badge, Button, Card, Field, FreeBadge, IconButton, Input, Meter, Modal, ProviderMark, SectionTitle, cx } from "../components/ui";
import { AGENT_PROVIDERS, PROVIDERS, isFreeTier, providerInfo } from "../lib/providers";
import { AccountHealth } from "./AccountHealth";

const AUTH: Record<string, { label: string; tone: "ok" | "warn" | "err" | "neutral" }> = {
  connected: { label: "Connected", tone: "ok" },
  "connected-api": { label: "API login", tone: "warn" },
  "logged-out": { label: "Logged out", tone: "err" },
  expired: { label: "Login expired", tone: "err" },
  error: { label: "Error", tone: "err" },
  unknown: { label: "Not checked", tone: "neutral" },
};

export function AccountsView() {
  const accounts = useApp((s) => s.accounts);
  const clis = useApp((s) => s.clis);
  const quota = useApp((s) => s.quota);
  const usageVersion = useApp((s) => s.usageVersion);
  const refreshAccounts = useApp((s) => s.refreshAccounts);
  const toast = useApp((s) => s.toast);
  const [adding, setAdding] = useState<Provider | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    api.usageSummary("all").then(setUsage).catch(() => {});
  }, [usageVersion, accounts.length]);

  function countOf(p: Provider) {
    return accounts.filter((a) => a.provider === p).length;
  }
  function missingText() {
    const parts: string[] = [];
    const c = countOf("claude");
    if (c < 2) parts.push(`${2 - c}× Claude`);
    if (countOf("codex") < 1) parts.push("1× Codex");
    return `add ${parts.join(" + ")}`;
  }
  const quickSetup = async () => {
    setSettingUp(true);
    try {
      const letters = "ABCDEFGH";
      let c = countOf("claude");
      const names = new Set(accounts.map((a) => a.name.toLowerCase()));
      const fresh = (base: string) => {
        let n = base;
        for (let i = 2; names.has(n.toLowerCase()); i++) n = `${base} ${i}`;
        names.add(n.toLowerCase());
        return n;
      };
      while (c < 2) {
        await api.accountAdd({ provider: "claude", name: fresh(`Claude ${letters[c] ?? c + 1}`), mode: "managed" });
        c++;
      }
      if (countOf("codex") < 1) await api.accountAdd({ provider: "codex", name: fresh("Codex"), mode: "managed" });
      await refreshAccounts();
      toast("Profiles created. Log in to each one with its login button.", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setSettingUp(false);
    }
  };

  // Check login state of every profile when the page opens.
  useEffect(() => {
    void Promise.all(accounts.map((a) => api.accountCheckAuth(a.id).catch(() => null))).then(() => refreshAccounts());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1180px] space-y-6 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[16px] font-semibold">AI accounts</h1>
            <p className="text-[12px] text-muted">
              Logins are handled by the official CLIs. The cockpit stores only a nickname, the config directory and the login email the CLI reports — never passwords or tokens.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {clis.map((c) => (
            <Card key={c.provider} className="flex items-center gap-3 px-3 py-2">
              <ProviderMark provider={c.provider} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium">{providerInfo(c.provider)?.label ?? c.provider} CLI <FreeBadge provider={c.provider} /></div>
                <div className="truncate text-[11px] text-faint" title={c.path ?? providerInfo(c.provider)?.install ?? ""}>
                  {c.path
                    ? `${c.version ?? "unknown version"} · ${c.source} · ${c.path}`
                    : isFreeTier(c.provider)
                      ? `Optional — install: ${providerInfo(c.provider)?.install}`
                      : "Not found — install it or set the path in Settings"}
                </div>
              </div>
              <Badge tone={c.path ? "ok" : isFreeTier(c.provider) ? "neutral" : "err"}>{c.path ? "detected" : isFreeTier(c.provider) ? "not installed" : "missing"}</Badge>
            </Card>
          ))}
        </div>

        {(countOf("claude") < 2 || countOf("codex") < 1) && (
          <Card className="flex items-center gap-3 border-accent/30 px-3 py-2.5">
            <Wand2 size={16} className="text-accent" />
            <div className="flex-1 text-[12.5px]">
              <b>Quick setup:</b> {missingText()} — each account gets its own isolated profile, so all of them can log in with different
              subscriptions and run in parallel.
            </div>
            <Button variant="primary" disabled={settingUp} onClick={() => void quickSetup()}>{settingUp ? "Creating…" : "Create profiles"}</Button>
          </Card>
        )}

        {AGENT_PROVIDERS.map((prov) => {
          const list = accounts.filter((a) => a.provider === prov);
          const info = PROVIDERS[prov];
          const full = !!info.singleProfile && list.length > 0;
          return (
            <section key={prov} className="space-y-2">
              <SectionTitle
                right={full ? undefined : <Button size="sm" onClick={() => setAdding(prov)}><Plus size={12} /> Add {info.label} account</Button>}
              >
                <span className="flex items-center gap-2">
                  <ProviderMark provider={prov} /> {prov === "codex" ? "Codex accounts (ChatGPT)" : `${info.label} accounts`} · {list.length} <FreeBadge provider={prov} />
                </span>
              </SectionTitle>
              {list.length === 0 ? (
                <Card className="p-4 text-[12.5px] text-muted">
                  No {info.label} account yet.{" "}
                  <button className="text-accent hover:underline" onClick={() => setAdding(prov)}>Add one</button>
                  {prov === "codex" && " — Codex runs side by side with your Claude sessions."}
                  {info.tier === "free" && (
                    <span className="mt-1 block text-[11.5px] text-faint">
                      {info.plan}. The cockpit gives it research crews and simple tasks first, so your subscriptions last longer.
                      {!clis.find((c) => c.provider === prov)?.path && <> Install first: <code>{info.install}</code></>}
                    </span>
                  )}
                </Card>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-3">
                  {list.map((a) => (
                    <AccountCard key={a.id} account={a} quota={currentWindows(quota[a.id])} tokens={usage?.byAccount.find((g) => g.key === a.id)?.totals.total ?? 0} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <CustomClis />

        <Card className="p-3 text-[12px] text-muted">
          <SectionTitle>How quota data is obtained</SectionTitle>
          <ul className="list-disc space-y-1 pl-4">
            <li><b className="text-fg">Claude:</b> the documented statusLine JSON (<code>rate_limits.five_hour / seven_day</code>) delivered to the cockpit while a session runs. Only available for claude.ai subscribers and after the first response of a session.</li>
            <li><b className="text-fg">Codex:</b> the <code>rate_limits</code> recorded by Codex itself in its local session logs (primary/secondary windows).</li>
            <li><b className="text-fg">Copilot / Antigravity (free tiers):</b> neither CLI writes its remaining allowance anywhere the cockpit may read — type <code>/usage</code> in the CLI. When a free allowance runs out, the session turns “rate-limited” and the work can move to another account.</li>
            <li>No private web endpoints are called. If no reliable value exists, the card says so — open the official <code>/status</code> (or <code>/usage</code>) view instead.</li>
          </ul>
        </Card>
      </div>
      {adding && <AddAccountDialog initialProvider={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

const LOGIN_NOTE: Partial<Record<Provider, (name: string) => string>> = {
  claude: (name) => `Login opens a fresh private browser window so you can choose the account for ${name}.`,
  codex: () => `Codex opens your default browser. If it is signed in to the wrong ChatGPT account, use "Open login in private window" in the login pane, or the device code login.`,
  copilot: () => `Copilot shows a one-time code and github.com/login/device — open it (or "Open login in private window") and sign in with your GitHub account. Copilot Free is included in every GitHub account.`,
  antigravity: () => `On its first start agy asks how to sign in: choose Google sign-in, log in in the browser, paste the code back, then accept its terms and the folder trust question.`,
};

function AccountCard({ account: a, quota, tokens }: { account: Account; quota: QuotaWindow[]; tokens: number }) {
  const { openUtility, refreshAccounts, toast, createSession, activeProjectId } = useApp.getState();
  const [checking, setChecking] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const login = async (deviceAuth = false) => {
    if (loggingIn) return;
    setLoggingIn(true);
    try { await openUtility(deviceAuth ? "login-device" : "login", a.id); }
    finally { setLoggingIn(false); }
  };
  const auth = AUTH[a.authStatus] ?? AUTH.unknown;
  const info = providerInfo(a.provider);
  const free = isFreeTier(a.provider);
  const check = async () => {
    setChecking(true);
    try {
      await api.accountCheckAuth(a.id, true);
      await refreshAccounts();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setChecking(false);
    }
  };
  const remove = async () => {
    const detach = await ask(
      `Remove profile "${a.name}" from the cockpit?\n\nThe config directory is kept:\n${a.configDir}`,
      { title: "Remove profile", kind: "warning", okLabel: "Remove profile", cancelLabel: "Cancel" },
    );
    if (!detach) return;
    let deleteFiles = false;
    if (a.managed) {
      deleteFiles = await ask(
        `Also delete the managed directory (including the CLI's login for this profile)?\n\n${a.configDir}`,
        { title: "Delete local profile data?", kind: "warning", okLabel: "Delete directory", cancelLabel: "Keep directory" },
      );
    }
    try {
      await api.accountRemove(a.id, deleteFiles);
      await refreshAccounts();
      toast(deleteFiles ? "Profile and its directory removed" : "Profile removed (directory kept)", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const ordered = [...quota].sort((x, y) => (x.windowMinutes ?? 0) - (y.windowMinutes ?? 0));
  const stale = ordered.length > 0 && Date.now() - Math.max(...ordered.map((q) => q.capturedAt)) > 6 * 3600_000;

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color ?? info?.color ?? "var(--color-codex)" }} />
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold">{a.name}</span>
          {a.authEmail && <span className="block truncate text-[11px] text-muted" title={a.authOrg ?? undefined}>{a.authEmail}</span>}
        </span>
        <ProviderMark provider={a.provider} />
        <FreeBadge provider={a.provider} />
        <Badge tone={auth.tone} title={a.authDetail ?? ""}>● {auth.label}</Badge>
        <div className="ml-auto flex">
          <IconButton title="Re-check login status" onClick={check} disabled={checking}>
            <RefreshCw size={12} className={cx(checking && "animate-spin")} />
          </IconButton>
          <IconButton title="Open config directory" onClick={() => void api.openKnownDir("account", a.id)}><FolderOpen size={13} /></IconButton>
          <IconButton title="Remove local profile" onClick={remove}><Trash2 size={12} /></IconButton>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        <AccountHealth account={a} />
        {ordered.length === 0 ? (
          <div className="rounded border border-dashed border-line-strong px-2 py-2 text-[12px] text-muted">
            {free ? <>Free allowance: type <code>/usage</code> in the CLI</> : <>Quota details available in <code>/status</code></>}
            {a.provider === "claude" && <span className="text-faint"> — exact values appear here after the first reply of a cockpit session.</span>}
            {free && <span className="text-faint"> — the CLI does not report it to the cockpit; a used-up allowance shows as “rate-limited”.</span>}
          </div>
        ) : (
          ordered.map((q) => (
            <div key={q.window}>
              <div className="mb-1 flex items-baseline justify-between text-[12px]">
                <span className="text-muted">{windowLabel(q.window, q.windowMinutes)}</span>
                <span className="tabular">
                  <b className="text-fg">{q.usedPercent.toFixed(0)}%</b> used
                  {q.resetsAt ? <span className="text-faint"> · resets {resetLabel(q.resetsAt)}</span> : null}
                </span>
              </div>
              <Meter value={q.usedPercent} />
            </div>
          ))
        )}
        {ordered.length > 0 && (
          <p className="text-[10.5px] text-faint">
            Source: {ordered[0].source === "claude-statusline" ? "Claude Code statusLine" : "Codex session log"} · captured {ago(Math.max(...ordered.map((q) => q.capturedAt)))}
            {stale && " · may be outdated"}
          </p>
        )}
        <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[11.5px]">
          <dt className="text-faint">Tokens (all time)</dt><dd className="tabular">{compact(tokens)} <span className="text-faint">measured</span></dd>
          <dt className="text-faint">Login</dt><dd className="truncate">{a.authDetail ?? "not checked"}</dd>
          {a.provider !== "custom" && (
            <>
              <dt className="text-faint">Signed in as</dt>
              <dd className="truncate" title={a.authOrg ?? undefined}>
                {a.authEmail ? (
                  <>{a.authEmail}{a.authOrg && <span className="text-faint"> · {a.authOrg}</span>}</>
                ) : (
                  <span className="text-faint">
                    {a.provider === "codex" || a.provider === "antigravity" ? `not reported by the ${info?.label ?? "CLI"}` : a.authStatus === "logged-out" ? "not logged in" : "re-check the login to show it"}
                  </span>
                )}
              </dd>
            </>
          )}
          <dt className="text-faint">Config dir</dt><dd className="truncate font-mono text-[10.5px]" title={a.configDir}>{a.configDir}</dd>
          <dt className="text-faint">Profile</dt><dd>{a.managed ? "Isolated cockpit profile" : "Existing CLI profile (shared with external terminals)"}</dd>
          <dt className="text-faint">Last used</dt><dd>{ago(a.lastUsedAt)}</dd>
        </dl>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
        <Button size="sm" disabled={loggingIn} variant={a.authStatus === "connected" ? "default" : "primary"} onClick={() => void login()}>
          <LogIn size={12} /> {loggingIn ? "Opening login…" : a.authStatus === "connected" ? (a.provider === "antigravity" ? "Open agy (sign-in)" : "Log in again / switch account") : info?.loginLabel ?? "Log in"}
        </Button>
        {a.provider === "codex" && (
          <Button size="sm" disabled={loggingIn} onClick={() => void login(true)} title="Shows a short code; open the link in any browser window (e.g. a private one) and sign in with the account you want">
            <KeyRound size={12} /> Device code login
          </Button>
        )}
        <Button size="sm" onClick={() => void openUtility("status", a.id)} title={info?.quotaHint}>
          <Terminal size={12} /> {free ? "Open /usage" : "Open /status"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void createSession({ accountId: a.id, projectId: activeProjectId })}>
          <Plus size={12} /> New session
        </Button>
      </div>
      <p className="px-3 pb-3 text-[11px] text-muted">
        {LOGIN_NOTE[a.provider]?.(a.name)}{" "}
        {a.provider === "antigravity"
          ? "agy keeps one Google login per Windows user (in the system keyring) — terminals outside the cockpit share it."
          : <>Other profiles keep their own login.{a.managed ? "" : " This profile is the CLI's global one — external terminals share its login."}</>}
      </p>
    </Card>
  );
}

function AddAccountDialog({ onClose, initialProvider }: { onClose: () => void; initialProvider: Provider }) {
  const { refreshAccounts, toast, openUtility } = useApp.getState();
  const accounts = useApp((s) => s.accounts);
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"managed" | "existing">("managed");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const info = PROVIDERS[provider as keyof typeof PROVIDERS];
  const single = !!info?.singleProfile;
  const suggested = provider === "claude"
    ? `Claude ${"ABCDEFGH"[accounts.filter((a) => a.provider === "claude").length] ?? ""}`.trim()
    : provider === "codex"
      ? accounts.some((a) => a.provider === "codex") ? "Codex 2" : "Codex"
      : provider === "copilot" ? "Copilot Free" : provider === "antigravity" ? "Antigravity" : "Agent";
  const taken = (p: Provider) => !!PROVIDERS[p as keyof typeof PROVIDERS]?.singleProfile && accounts.some((a) => a.provider === p);

  const submit = async (login: boolean) => {
    setBusy(true);
    try {
      const acc = await api.accountAdd({ provider, name: name.trim() || suggested, mode, configDir: mode === "existing" ? dir || undefined : undefined });
      await refreshAccounts();
      onClose();
      if (login) await openUtility("login", acc.id);
      else {
        await api.accountCheckAuth(acc.id).catch(() => {});
        await refreshAccounts();
      }
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add account profile"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit(false)} disabled={busy}>Add only</Button>
          <Button variant="primary" onClick={() => submit(true)} disabled={busy}>
            <LogIn size={12} /> Add &amp; {provider === "codex" ? "Login with ChatGPT / Codex" : info?.loginLabel ?? "Log in"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Provider">
          <div className="grid grid-cols-2 gap-2">
            {AGENT_PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={taken(p)}
                title={taken(p) ? "This CLI keeps one login per Windows user — its profile already exists" : undefined}
                onClick={() => setProvider(p)}
                className={cx(
                  "flex items-center gap-2 rounded border px-3 py-2 text-left disabled:opacity-40",
                  provider === p ? "border-accent bg-accent/10" : "border-line-strong hover:bg-hover",
                )}
              >
                <ProviderMark provider={p} />
                <span>
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">{PROVIDERS[p].label} <FreeBadge provider={p} /></span>
                  <span className="block text-[11px] text-faint">{PROVIDERS[p].plan}</span>
                </span>
              </button>
            ))}
          </div>
          {isFreeTier(provider) && (
            <p className="text-[11px] text-faint">
              One account per person, as the provider intends. Free work (research crews, simple tasks) goes here first; reviews and hard coding stay on your subscriptions.
            </p>
          )}
        </Field>
        <Field label="Nickname">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} autoFocus />
        </Field>
        {single ? (
          <Field label="Configuration directory">
            <p className="text-[11.5px] text-faint">
              {info?.defaultDir} — {info?.label} keeps its login in the system keyring, so there is one profile per Windows user (no isolated copy).
            </p>
          </Field>
        ) : <Field label="Configuration directory">
          <div className="grid gap-1.5">
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="radio" checked={mode === "managed"} onChange={() => setMode("managed")} className="mt-0.5" />
              <span>
                New isolated profile <span className="text-faint">(recommended)</span>
                <span className="block text-[11px] text-faint">
                  ~/.ai-cockpit/profiles/{provider}/&lt;nickname&gt; — used as {info?.configEnv}. You log in once with the official CLI.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} className="mt-0.5" />
              <span>
                Use an existing directory
                <span className="block text-[11px] text-faint">
                  Leave empty for the CLI default ({info?.defaultDir}) — reuses the login you already have. Never deleted by the cockpit.
                </span>
              </span>
            </label>
            {mode === "existing" && (
              <div className="flex gap-1.5 pl-5">
                <Input className="flex-1 font-mono" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={`%USERPROFILE%${(info?.defaultDir ?? "~/.codex").slice(1).replace(/\//g, "\\")}`} />
                <Button
                  onClick={async () => {
                    const d = await openDialog({ directory: true, title: "Choose config directory" });
                    if (typeof d === "string") setDir(d);
                  }}
                >
                  Browse…
                </Button>
              </div>
            )}
          </div>
        </Field>}
      </div>
    </Modal>
  );
}


const CLI_PRESETS: { name: string; command: string; hint: string }[] = [
  // Their free Google / Qwen logins ended in 2026 (docs/PROVIDERS.md): they need an API key now.
  { name: "Gemini CLI", command: "gemini", hint: "npm i -g @google/gemini-cli — free Google login ended 18 Jun 2026: needs a Gemini API key (use Antigravity above for the free tier)" },
  { name: "Qwen Code", command: "qwen", hint: "npm i -g @qwen-code/qwen-code — free Qwen OAuth ended 15 Apr 2026: point it at an API key, e.g. OpenRouter's free models" },
  { name: "Aider", command: "aider", hint: "pip install aider-chat" },
  { name: "OpenCode", command: "opencode", hint: "npm i -g opencode-ai" },
  { name: "Ollama (local)", command: "ollama run qwen3", hint: "ollama.com — runs offline" },
];

/** Any other terminal CLI as an agent: started by its command line, status from its output. */
function CustomClis() {
  // Select the stable array, filter here: a filtering selector returns a new array on every
  // store read, which makes zustand re-render endlessly.
  const all = useApp((s) => s.accounts);
  const accounts = useMemo(() => all.filter((a) => a.provider === "custom"), [all]);
  const { refreshAccounts, toast, createSession, activeProjectId } = useApp.getState();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const acc = await api.accountAdd({ provider: "custom", name: name.trim() || command.trim().split(/\s+/)[0], mode: "managed", command: command.trim() });
      await api.accountCheckAuth(acc.id, true).catch(() => {});
      await refreshAccounts();
      setName("");
      setCommand("");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const check = async (id: string) => {
    await api.accountCheckAuth(id, true).catch((e) => toast(errMsg(e), "error"));
    await refreshAccounts();
  };
  const remove = async (a: Account) => {
    if (!window.confirm(`Remove "${a.name}" from the cockpit? The tool itself stays installed.`)) return;
    try {
      await api.accountRemove(a.id, true);
      await refreshAccounts();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <section className="space-y-2">
      <SectionTitle>
        <span className="flex items-center gap-2"><ProviderMark provider="custom" /> Other CLIs · {accounts.length}</span>
      </SectionTitle>
      <Card className="space-y-2 p-3 text-[12.5px]">
        <p className="text-[11.5px] text-muted">
          Run any other terminal AI tool as an agent next to Claude and Codex — e.g. Gemini CLI, Qwen Code, Aider or a local model via Ollama. The cockpit starts
          the command in the project folder; logins and API keys stay inside the tool. Status comes from its output, so there is no quota or token data for these.
        </p>
        <div className="flex flex-wrap gap-1">
          {CLI_PRESETS.map((p) => (
            <button key={p.name} title={p.hint} onClick={() => { setName(p.name); setCommand(p.command); }} className="rounded border border-line-strong px-2 py-0.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg">
              {p.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[180px_1fr_auto] gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Gemini)" />
          <Input className="font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command line, e.g. gemini or ollama run qwen3" onKeyDown={(e) => { if (e.key === "Enter" && command.trim()) void add(); }} />
          <Button variant="primary" disabled={!command.trim() || busy} onClick={() => void add()}><Plus size={12} /> Add</Button>
        </div>
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded border border-line px-2 py-1.5">
            <ProviderMark provider="custom" />
            <b className="min-w-0 truncate">{a.name}</b>
            <code className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{a.command}</code>
            <span className={cx("shrink-0 text-[11px]", a.authStatus === "connected" ? "text-ok" : a.authStatus === "unknown" ? "text-faint" : "text-err")} title={a.authDetail ?? ""}>
              {a.authStatus === "connected" ? "installed" : a.authStatus === "unknown" ? "not checked" : "not found"}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void check(a.id)}>Check</Button>
            <Button size="sm" onClick={() => void createSession({ accountId: a.id, projectId: activeProjectId })}><Plus size={12} /> Session</Button>
            <IconButton title="Remove" onClick={() => void remove(a)}><Trash2 size={12} /></IconButton>
          </div>
        ))}
      </Card>
    </section>
  );
}
