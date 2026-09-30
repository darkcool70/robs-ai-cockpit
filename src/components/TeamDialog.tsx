import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useApp, type LayoutMode } from "../store";
import { api, errMsg, type Autonomy, type Worktree } from "../lib/api";
import { AUTONOMY } from "../lib/models";
import { allRoles } from "../lib/roles";
import { Button, Field, Modal, ProviderMark, Select, cx } from "./ui";

/**
 * Start several agents at once — typically 2× Claude + 1× Codex on different accounts —
 * in one project, each in its own pane (optionally its own git worktree).
 */
const MAX_TEAM = 8;

export function TeamDialog() {
  const open = useApp((s) => s.teamOpen);
  const setOpen = useApp((s) => s.setTeamOpen);
  const accounts = useApp((s) => s.accounts);
  const projects = useApp((s) => s.projects);
  const activeProjectId = useApp((s) => s.activeProjectId);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);

  const [projectId, setProjectId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [autonomy, setAutonomy] = useState<Autonomy>("");
  const [task, setTask] = useState("");
  const [autoContinue, setAutoContinue] = useState(true);
  const [worktrees, setWorktrees] = useState(false);
  const [isRepo, setIsRepo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [roleOf, setRoleOf] = useState<Record<string, string>>({});
  const roles = allRoles(settings);

  useEffect(() => {
    if (!open) return;
    setProjectId(activeProjectId ?? projects[0]?.id ?? "");
    // Default: every logged-in account, at most eight (one per pane).
    setPicked(accounts.filter((a) => a.authStatus === "connected").slice(0, MAX_TEAM).map((a) => a.id));
    setRoleOf({});
    setAutonomy(((settings.defaultAutonomy as Autonomy) ?? "") as Autonomy);
    setAutoContinue(settings.autoContinueDefault !== false);
    setTask("");
    setWorktrees(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const project = projects.find((p) => p.id === projectId);
  useEffect(() => {
    setIsRepo(false);
    if (!project) return;
    api.gitWorktrees(project.path).then((w: Worktree[]) => setIsRepo(w.length > 0)).catch(() => setIsRepo(false));
  }, [project?.path]);

  if (!open) return null;
  const close = () => setOpen(false);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TEAM ? p : [...p, id]));

  const browse = async () => {
    const dir = await openDialog({ directory: true, title: "Project folder for the team" });
    if (typeof dir !== "string") return;
    try {
      const p = await api.projectAdd(dir);
      await useApp.getState().refreshProjects();
      setProjectId(p.id);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const start = async () => {
    if (!project || !picked.length || busy) return;
    if (autonomy === "full" && !window.confirm("Full access skips every permission check and sandbox for ALL agents. Start anyway?")) return;
    setBusy(true);
    try {
      const st = useApp.getState();
      const n = picked.length;
      st.setMode((n === 1 ? "1" : String(n)) as LayoutMode);
      st.selectProject(project.id);
      const stamp = new Date().toTimeString().slice(0, 5).replace(":", "");
      for (let i = 0; i < n; i++) {
        const acc = accounts.find((a) => a.id === picked[i])!;
        const role = roles.find((r) => r.id === roleOf[acc.id]);
        let cwd: string | null = project.path;
        if (worktrees && isRepo) {
          const slug = acc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || acc.provider;
          const wt = await api.gitWorktreeAdd(project.id, `team-${stamp}-${slug}`);
          cwd = wt.path;
        }
        await st.createSession(
          {
            accountId: acc.id,
            projectId: project.id,
            cwd,
            name: role ? `${acc.name} · ${role.label}` : `${acc.name} · ${project.name}`,
            options: {
              ...(role?.autonomy || autonomy ? { autonomy: role?.autonomy || autonomy } : {}),
              ...(role?.instructions ? { appendSystemPrompt: role.instructions } : {}),
              ...(task.trim() || role?.startTask ? { initialPrompt: task.trim() || role?.startTask } : {}),
            },
            autoContinue,
          },
          i,
        );
      }
      close();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const connected = (s: string) => s === "connected";
  return (
    <Modal
      title="Start agent team"
      onClose={close}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!project || !picked.length || busy} onClick={start}>
            {busy ? "Starting…" : `Start ${picked.length} agent${picked.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Project folder">
          <div className="flex gap-1.5">
            <Select className="min-w-0 flex-1" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {!projects.length && <option value="">Choose a folder…</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.path}</option>)}
            </Select>
            <Button type="button" onClick={browse} title="Choose any folder"><FolderOpen size={13} /></Button>
          </div>
        </Field>
        <Field label={`Agents (${picked.length}/${MAX_TEAM} — one pane each; role optional)`}>
          <div className="grid grid-cols-2 gap-1.5">
            {accounts.map((a) => (
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => toggle(a.id)}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(a.id); } }}
                className={cx(
                  "flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-left text-[12.5px]",
                  picked.includes(a.id) ? "border-accent bg-accent/10" : "border-line-strong hover:bg-hover",
                  !connected(a.authStatus) && "opacity-70",
                )}
              >
                <input type="checkbox" readOnly checked={picked.includes(a.id)} className="pointer-events-none" />
                <ProviderMark provider={a.provider} />
                <span className="flex-1 truncate">{a.name}</span>
                {!connected(a.authStatus) && <span className="text-[10.5px] text-warn">{a.authStatus}</span>}
                {picked.includes(a.id) && (
                  <select
                    value={roleOf[a.id] ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRoleOf((r) => ({ ...r, [a.id]: e.target.value }))}
                    className="h-6 max-w-[96px] rounded border border-line-strong bg-bg px-1 text-[11px]"
                    title="Role for this agent"
                  >
                    <option value="">no role</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
        </Field>
        <Field label="Autonomy for all agents">
          <Select value={autonomy} onChange={(e) => setAutonomy(e.target.value as Autonomy)}>
            {AUTONOMY.map((a) => <option key={a.value || "d"} value={a.value}>{a.label} — {a.hint.claude}</option>)}
          </Select>
        </Field>
        <Field label="Common task (optional)" hint="Sent to every agent once it is ready. Leave empty to brief each one yourself.">
          <textarea
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g. Review src/ for bugs and list the three most important ones."
            className="rounded border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={autoContinue} onChange={(e) => setAutoContinue(e.target.checked)} />
          Continue automatically after usage limits
        </label>
        <label className={cx("flex items-center gap-2 text-[12.5px]", !isRepo && "opacity-50")}>
          <input type="checkbox" disabled={!isRepo} checked={worktrees && isRepo} onChange={(e) => setWorktrees(e.target.checked)} />
          Separate git worktree per agent {isRepo ? "(no edit conflicts between agents)" : "(project is not a git repository)"}
        </label>
      </div>
    </Modal>
  );
}
