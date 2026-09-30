import { useEffect, useMemo, useState } from "react";
import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";
import { FolderOpen, KeyRound, LogIn, Plus, RefreshCw, Terminal, Trash2, Wand2 } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type Account, type Provider, type QuotaWindow, type UsageSummary } from "../lib/api";
import { ago, compact, currentWindows, resetLabel, windowLabel } from "../lib/format";
import { Badge, Button, Card, Field, IconButton, Input, Meter, Modal, ProviderMark, SectionTitle, cx } from "../components/ui";

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
              Logins are handled by the official CLIs. The cockpit stores only a nickname and the config directory — never passwords or tokens.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {clis.map((c) => (
            <Card key={c.provider} className="flex items-center gap-3 px-3 py-2">
              <ProviderMark provider={c.provider} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{c.provider === "claude" ? "Claude Code CLI" : "Codex CLI"}</div>
                <div className="truncate text-[11px] text-faint" title={c.path ?? ""}>
                  {c.path ? `${c.version ?? "unknown version"} · ${c.source} · ${c.path}` : "Not found — install it or set the path in Settings"}
                </div>
              </div>
              <Badge tone={c.path ? "ok" : "err"}>{c.path ? "detected" : "missing"}</Badge>
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

        {(["claude", "codex"] as const).map((prov) => {
          const list = accounts.filter((a) => a.provider === prov);
          return (
            <section key={prov} className="space-y-2">
              <SectionTitle
                right={<Button size="sm" onClick={() => setAdding(prov)}><Plus size={12} /> Add {prov === "claude" ? "Claude" : "Codex"} account</Button>}
              >
                <span className="flex items-center gap-2"><ProviderMark provider={prov} /> {prov === "claude" ? "Claude Code accounts" : "Codex accounts (ChatGPT)"} · {list.length}</span>
              </SectionTitle>
              {list.length === 0 ? (
                <Card className="p-4 text-[12.5px] text-muted">
                  No {prov === "claude" ? "Claude" : "Codex"} account yet.{" "}
                  <button className="text-accent hover:underline" onClick={() => setAdding(prov)}>Add one</button>
                  {prov === "codex" && " — Codex runs side by side with your Claude sessions."}
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
            <li>No private web endpoints are called. If no reliable value exists, the card says so — open the official <code>/status</code> (or <code>/usage</code>) view instead.</li>
          </ul>
        </Card>
      </div>
      {adding && <AddAccountDialog initialProvider={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

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
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color ?? (a.provider === "claude" ? "var(--color-claude)" : "var(--color-codex)") }} />
        <span className="text-[13.5px] font-semibold">{a.name}</span>
        <ProviderMark provider={a.provider} />
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
        {ordered.length === 0 ? (
          <div className="rounded border border-dashed border-line-strong px-2 py-2 text-[12px] text-muted">
            Quota details available in <code>/status</code>
            {a.provider === "claude" && <span className="text-faint"> — exact values appear here after the first reply of a cockpit session.</span>}
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
          <dt className="text-faint">Config dir</dt><dd className="truncate font-mono text-[10.5px]" title={a.configDir}>{a.configDir}</dd>
          <dt className="text-faint">Profile</dt><dd>{a.managed ? "Isolated cockpit profile" : "Existing CLI profile (shared with external terminals)"}</dd>
          <dt className="text-faint">Last used</dt><dd>{ago(a.lastUsedAt)}</dd>
        </dl>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
        <Button size="sm" disabled={loggingIn} variant={a.authStatus === "connected" ? "default" : "primary"} onClick={() => void login()}>
          <LogIn size={12} /> {loggingIn ? "Opening login…" : a.authStatus === "connected" ? "Log in again / switch account" : a.provider === "claude" ? "Log in with Claude" : "Log in with ChatGPT"}
        </Button>
        {a.provider === "codex" && (
          <Button size="sm" disabled={loggingIn} onClick={() => void login(true)} title="Shows a short code; open the link in any browser window (e.g. a private one) and sign in with the account you want">
            <KeyRound size={12} /> Device code login
          </Button>
        )}
        <Button size="sm" onClick={() => void openUtility("status", a.id)} title={a.provider === "claude" ? "Opens Claude Code; type /status or /usage" : "Opens Codex; type /status"}>
          <Terminal size={12} /> Open /status
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void createSession({ accountId: a.id, projectId: activeProjectId })}>
          <Plus size={12} /> New session
        </Button>
      </div>
      <p className="px-3 pb-3 text-[11px] text-muted">
        {a.provider === "claude"
          ? `Login opens a fresh private browser window so you can choose the account for ${a.name}.`
          : `Codex opens your default browser. If it is signed in to the wrong ChatGPT account, use "Open login in private window" in the login pane, or the device code login.`}{" "}
        Other profiles keep their own login.{a.managed ? "" : " This profile is the CLI's global one — external terminals share its login."}
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
  const suggested = provider === "claude" ? `Claude ${"ABCDEFGH"[accounts.filter((a) => a.provider === "claude").length] ?? ""}`.trim() : accounts.some((a) => a.provider === "codex") ? "Codex 2" : "Codex";

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
            <LogIn size={12} /> Add &amp; {provider === "claude" ? "Login with Claude" : "Login with ChatGPT / Codex"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Provider">
          <div className="grid grid-cols-2 gap-2">
            {(["claude", "codex"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={cx(
                  "flex items-center gap-2 rounded border px-3 py-2 text-left",
                  provider === p ? "border-accent bg-accent/10" : "border-line-strong hover:bg-hover",
                )}
              >
                <ProviderMark provider={p} />
                <span>
                  <span className="block text-[12.5px] font-medium">{p === "claude" ? "Claude Code" : "Codex"}</span>
                  <span className="block text-[11px] text-faint">{p === "claude" ? "Claude Pro / Max subscription" : "ChatGPT Plus / Pro subscription"}</span>
                </span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nickname">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} autoFocus />
        </Field>
        <Field label="Configuration directory">
          <div className="grid gap-1.5">
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="radio" checked={mode === "managed"} onChange={() => setMode("managed")} className="mt-0.5" />
              <span>
                New isolated profile <span className="text-faint">(recommended)</span>
                <span className="block text-[11px] text-faint">
                  ~/.ai-cockpit/profiles/{provider}/&lt;nickname&gt; — used as {provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"}. You log in once with the official CLI.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} className="mt-0.5" />
              <span>
                Use an existing directory
                <span className="block text-[11px] text-faint">
                  Leave empty for the CLI default ({provider === "claude" ? "~/.claude" : "~/.codex"}) — reuses the login you already have. Never deleted by the cockpit.
                </span>
              </span>
            </label>
            {mode === "existing" && (
              <div className="flex gap-1.5 pl-5">
                <Input className="flex-1 font-mono" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={provider === "claude" ? "%USERPROFILE%\\.claude" : "%USERPROFILE%\\.codex"} />
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
        </Field>
      </div>
    </Modal>
  );
}


const CLI_PRESETS: { name: string; command: string; hint: string }[] = [
  { name: "Gemini CLI", command: "gemini", hint: "npm i -g @google/gemini-cli" },
  { name: "Qwen Code", command: "qwen", hint: "npm i -g @qwen-code/qwen-code" },
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
