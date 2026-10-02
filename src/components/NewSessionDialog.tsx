import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, GitBranch } from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type Account, type Autonomy, type Provider, type Worktree } from "../lib/api";
import { Button, Field, Input, Modal, ProviderMark, Select, cx } from "./ui";
import { AutonomyPicker, ModelAndAdvanced, cleanOptions, type OptionsState } from "./SessionOptionsFields";
import { bestAccounts } from "../lib/failover";
import { allRoles, type Role } from "../lib/roles";

export function NewSessionDialog() {
  const target = useApp((s) => s.newSessionFor);
  const close = useApp((s) => s.closeNewSession);
  const accounts = useApp((s) => s.accounts);
  const projects = useApp((s) => s.projects);
  const activeProjectId = useApp((s) => s.activeProjectId);
  const settings = useApp((s) => s.settings);
  const createSession = useApp((s) => s.createSession);
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);

  const [accountId, setAccountId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>(activeProjectId ?? "");
  const [name, setName] = useState("");
  const [opts, setOpts] = useState<OptionsState>({ model: "", options: {}, autoContinue: true });
  const [extra, setExtra] = useState("");
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [newWt, setNewWt] = useState("");
  const [saveDefault, setSaveDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [roleId, setRoleId] = useState("");
  const quota = useApp((s) => s.quota);
  const sessions = useApp((s) => s.sessions);
  // Limit planner: the account with the most quota left per provider.
  const best = useMemo(() => bestAccounts(accounts, quota, Object.values(sessions)), [accounts, quota, sessions]);
  const usedOf = (id: string) => {
    const w = (quota[id] ?? []).filter((x) => !x.resetsAt || x.resetsAt * 1000 > Date.now());
    return w.length ? Math.max(...w.map((x) => x.usedPercent)) : null;
  };
  const roles = allRoles(settings);
  const applyRole = (r: Role | undefined) => {
    setRoleId(r?.id ?? "");
    if (!r) return;
    setOpts((o) => ({ ...o, options: { ...o.options, autonomy: r.autonomy, appendSystemPrompt: r.instructions, initialPrompt: o.options.initialPrompt || r.startTask || "" } }));
    setName((n) => n || r.label);
  };
  const saveRole = async () => {
    const label = window.prompt("Name for this role (autonomy + extra instructions + start task are saved):");
    if (!label?.trim()) return;
    const role: Role = { id: `custom-${Date.now()}`, label: label.trim(), autonomy: (opts.options.autonomy ?? "") as Autonomy, instructions: opts.options.appendSystemPrompt ?? "", startTask: opts.options.initialPrompt ?? undefined };
    const list = Array.isArray(settings.rolePresets) ? (settings.rolePresets as Role[]) : [];
    await useApp.getState().setSetting("rolePresets", [...list, role]);
    setRoleId(role.id);
    toast(`Role "${role.label}" saved`, "ok");
  };

  const project = projects.find((p) => p.id === projectId);
  const account = accounts.find((a) => a.id === accountId);

  // Prefill whenever the dialog opens or the project changes: project defaults first,
  // then the global defaults from Settings.
  const applyDefaults = (pid: string) => {
    const p = projects.find((x) => x.id === pid);
    const d = p?.defaults ?? {};
    const preferred = d.accountId && accounts.some((a) => a.id === d.accountId) ? d.accountId : null;
    const connected = accounts.find((a) => a.authStatus === "connected");
    const planned = best.claude?.id ?? best.codex?.id ?? null;
    setAccountId((cur) => preferred ?? (cur && accounts.some((a) => a.id === cur) ? cur : planned ?? (connected ?? accounts[0])?.id ?? ""));
    setRoleId("");
    setOpts({
      model: d.model ?? "",
      options: { ...(d.options ?? {}), autonomy: (d.options?.autonomy ?? (settings.defaultAutonomy as Autonomy) ?? "") as Autonomy, initialPrompt: "" },
      autoContinue: d.autoContinue ?? settings.autoContinueDefault !== false,
    });
    setSaveDefault(false);
  };

  useEffect(() => {
    if (target) {
      const pid = activeProjectId ?? "";
      setProjectId(pid);
      setCwd("");
      setNewWt("");
      setName("");
      setExtra("");
      applyDefaults(pid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    setCwd("");
    setWorktrees([]);
    if (!project) return;
    api.gitWorktrees(project.path).then(setWorktrees).catch(() => setWorktrees([]));
  }, [project?.path]);

  const extraArgs = useMemo(() => splitArgs(extra), [extra]);

  const chooseAccount = (a: Account) => {
    if (account && a.provider !== account.provider) {
      // Models and efforts are provider-specific.
      setOpts((o) => ({ ...o, model: "", options: { ...o.options, effort: null } }));
    }
    setAccountId(a.id);
  };

  const browse = async () => {
    const dir = await openDialog({ directory: true, title: "Project folder for this session" });
    if (typeof dir !== "string") return;
    try {
      const p = await api.projectAdd(dir);
      await useApp.getState().refreshProjects();
      setProjectId(p.id);
      applyDefaults(p.id);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const submit = async () => {
    if (!account || busy) return;
    if (opts.options.autonomy === "full" && !window.confirm("Full access skips every permission check and sandbox. Only use it in a disposable environment. Start anyway?")) return;
    setBusy(true);
    try {
      let dir = cwd || project?.path || null;
      if (newWt.trim() && project) {
        const wt = await api.gitWorktreeAdd(project.id, newWt.trim());
        dir = wt.path;
        toast(`Worktree ${wt.branch} created`, "ok");
      }
      const options = cleanOptions(opts.options);
      if (saveDefault && project) {
        const { initialPrompt: _task, ...keep } = options;
        await api.projectSetDefaults(project.id, { accountId: account.id, model: opts.model || undefined, autoContinue: opts.autoContinue, options: keep });
        await useApp.getState().refreshProjects();
      }
      const s = await createSession(
        {
          accountId: account.id,
          projectId: project?.id ?? null,
          cwd: dir,
          name: name.trim() || undefined,
          model: opts.model.trim() || undefined,
          extraArgs,
          options,
          autoContinue: opts.autoContinue,
        },
        target?.pane ?? null,
      );
      if (s) close();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!target) return null;
  const groups: [Provider, string][] = [["claude", "Claude Code"], ["codex", "Codex"], ["custom", "Other CLIs"]];
  return (
    <Modal
      title="New agent session"
      onClose={close}
      width={640}
      footer={
        <>
          {project && (
            <label className="mr-auto flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
              Save as default for {project.name}
            </label>
          )}
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!account || busy} onClick={submit}>{busy ? "Starting…" : "Start session"}</Button>
        </>
      }
    >
      {accounts.length === 0 ? (
        <div className="space-y-3 text-[12.5px] text-muted">
          <p>No account profiles yet. Add your Claude and Codex accounts and log in with the official CLI first.</p>
          <Button variant="primary" onClick={() => { close(); setView("accounts"); }}>Open Accounts</Button>
        </div>
      ) : (
        <div
          className="grid gap-3"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") void submit();
          }}
        >
          <Field label="Account">
            <div className="grid gap-1.5">
              {groups.map(([prov, label]) => {
                const list = accounts.filter((a) => a.provider === prov);
                if (!list.length) return null;
                return (
                  <div key={prov} className="grid grid-cols-[70px_1fr] items-start gap-2">
                    <span className="pt-1.5 text-[11px] text-faint">{label}</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {list.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => chooseAccount(a)}
                          className={cx(
                            "flex items-center gap-2 rounded border px-2 py-1.5 text-left text-[12.5px]",
                            a.id === accountId ? "border-accent bg-accent/10" : "border-line-strong hover:bg-hover",
                          )}
                        >
                          <ProviderMark provider={a.provider} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{a.name}</span>
                            {a.authEmail && <span className="block truncate text-[10.5px] text-faint">{a.authEmail}</span>}
                          </span>
                          {best[a.provider]?.id === a.id && <span className="shrink-0 rounded bg-ok/15 px-1 text-[10px] text-ok" title="Most quota left of this provider — recommended for new work">most left</span>}
                          {usedOf(a.id) != null && <span className={cx("shrink-0 text-[10.5px] tabular", usedOf(a.id)! >= 90 ? "text-err" : usedOf(a.id)! >= 70 ? "text-warn" : "text-faint")} title="Highest usage of the current quota windows">{usedOf(a.id)!.toFixed(0)}%</span>}
                          <span
                            className={cx("h-1.5 w-1.5 rounded-full", a.authStatus === "connected" ? "bg-ok" : a.authStatus === "unknown" ? "bg-faint" : "bg-err")}
                            title={a.authDetail ?? a.authStatus}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project folder" hint={project ? project.path : "No project: starts in your home folder (not recommended)"}>
              <div className="flex gap-1.5">
                <Select className="min-w-0 flex-1" value={projectId} onChange={(e) => { setProjectId(e.target.value); applyDefaults(e.target.value); }}>
                  <option value="">(none — home directory)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
                <Button type="button" onClick={browse} title="Choose any folder (it is added to Projects)"><FolderOpen size={13} /></Button>
              </div>
            </Field>
            <Field label="Session name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={account ? `${account.name} #…` : ""} autoFocus />
            </Field>
          </div>
          {project && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Working directory">
                <Select value={cwd} onChange={(e) => { setCwd(e.target.value); setNewWt(""); }} disabled={!!newWt}>
                  <option value="">{project.path}</option>
                  {worktrees.filter((w) => !w.isMain).map((w) => (
                    <option key={w.path} value={w.path}>worktree: {w.branch ?? w.path}</option>
                  ))}
                </Select>
              </Field>
              <Field label="…or an isolated git worktree" hint={worktrees.length ? `.worktrees/<name> on a new branch` : "Project is not a git repository"}>
                <div className="flex items-center gap-1.5">
                  <GitBranch size={13} className="text-faint" />
                  <Input className="flex-1" value={newWt} onChange={(e) => setNewWt(e.target.value.replace(/[^A-Za-z0-9._-]/g, "-"))} placeholder="e.g. claude-feature" disabled={!worktrees.length} />
                </div>
              </Field>
            </div>
          )}
          {account && (
            <>
              <Field label="Role (optional)" hint="Fills autonomy, extra instructions and a start task — change anything afterwards.">
                <div className="flex gap-1.5">
                  <Select className="min-w-0 flex-1" value={roleId} onChange={(e) => applyRole(roles.find((r) => r.id === e.target.value))}>
                    <option value="">— none —</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.label}{r.custom ? " (own)" : ""}</option>)}
                  </Select>
                  <Button type="button" onClick={() => void saveRole()} title="Save the current autonomy / instructions / start task as a role">Save as role</Button>
                </div>
              </Field>
              <Field label="Autonomy">
                <AutonomyPicker provider={account.provider} value={(opts.options.autonomy ?? "") as Autonomy} onChange={(a) => setOpts((o) => ({ ...o, options: { ...o.options, autonomy: a } }))} />
              </Field>
              <ModelAndAdvanced
                provider={account.provider}
                account={account}
                state={opts}
                onChange={(patch) => setOpts((o) => ({ ...o, ...patch }))}
              />
              <Field label="Extra CLI arguments (optional)" hint="Passed verbatim to the official CLI, after the options above.">
                <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={account.provider === "claude" ? "--verbose" : "--no-alt-screen"} className="font-mono" />
              </Field>
            </>
          )}
          {account && account.authStatus !== "connected" && (
            <p className="rounded border border-warn/30 bg-warn/5 px-2 py-1.5 text-[12px] text-warn">
              {account.authStatus === "unknown"
                ? "Login state of this profile has not been checked yet."
                : `This profile reports: ${account.authDetail ?? account.authStatus}.`}{" "}
              The CLI will prompt for login if needed.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Minimal shell-like argument splitting with quotes. */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}
