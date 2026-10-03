import { open } from "@tauri-apps/plugin-dialog";
import { BarChart3, FolderPlus, History, LayoutGrid, Settings, Shield, Users, FolderOpen, Trash2, Gauge, Repeat, KanbanSquare, GitPullRequestDraft, Pin, Sparkles } from "lucide-react";
import { useApp, type View } from "../store";
import { api } from "../lib/api";
import { sessionDrag } from "../lib/drag";
import { cx, IconButton, ProviderMark, StatusDot } from "./ui";
import { AssistantAvatar } from "./Avatar";
import { assistantOf, moodOf } from "../lib/assistants";
import logo from "../logo.png";

const NAV: { view: View; label: string; icon: typeof LayoutGrid }[] = [
  { view: "overview", label: "Overview", icon: Gauge },
  { view: "workspace", label: "Workspace", icon: LayoutGrid },
  { view: "assistants", label: "Assistants", icon: Sparkles },
  { view: "tasks", label: "Tasks", icon: KanbanSquare },
  { view: "review", label: "Review & commit", icon: GitPullRequestDraft },
  { view: "pins", label: "Pins", icon: Pin },
  { view: "loops", label: "Loops & templates", icon: Repeat },
  { view: "accounts", label: "Accounts", icon: Users },
  { view: "usage", label: "Usage", icon: BarChart3 },
  { view: "history", label: "History", icon: History },
  { view: "security", label: "Security", icon: Shield },
  { view: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const projects = useApp((s) => s.projects);
  const active = useApp((s) => s.activeProjectId);
  const selectProject = useApp((s) => s.selectProject);
  const addProject = useApp((s) => s.addProject);
  const order = useApp((s) => s.order);
  const sessions = useApp((s) => s.sessions);
  const accounts = useApp((s) => s.accounts);
  const panes = useApp((s) => s.panes);
  const showSession = useApp((s) => s.showSession);
  const refreshProjects = useApp((s) => s.refreshProjects);
  const waiting = useApp((s) => Object.values(s.sessions).filter((x) => x.kind === "agent" && x.runtime?.running && x.runtime.status === "waiting-for-input").length);
  const loopsRunning = useApp((s) => Object.values(s.sessions).filter((x) => x.runtime?.automation?.state === "running").length);
  const toReview = useApp((s) => s.tasks.filter((t) => t.status === "review").length);
  const assistants = useApp((s) => s.assistants);
  const assistantsBusy = useApp((s) => s.assistants.filter((a) => a.sessionId && s.sessions[a.sessionId]?.runtime?.automation?.state === "running").length);
  const assistantsNeedYou = useApp((s) => s.assistants.filter((a) => a.sessionId && s.sessions[a.sessionId]?.runtime?.automation?.note?.startsWith("Needs you")).length);

  const pick = async () => {
    const dir = await open({ directory: true, multiple: false, title: "Add project directory" });
    if (typeof dir === "string") await addProject(dir);
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <img src={logo} alt="" className="h-7 w-7" draggable={false} />
        <span className="text-[13px] font-semibold tracking-tight">Robs AI Cockpit</span>
      </div>
      <nav className="flex flex-col gap-px border-b border-line p-1.5">
        {NAV.map(({ view: v, label, icon: Icon }) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cx(
              "flex h-7 items-center gap-2 rounded px-2 text-[12.5px]",
              view === v ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
            )}
          >
            <Icon size={14} />
            {label}
            {v === "overview" && waiting > 0 && (
              <span className="ml-auto rounded-full bg-ok/20 px-1.5 text-[10.5px] font-semibold text-ok" title="Agents waiting for you">{waiting}</span>
            )}
            {v === "assistants" && !__PRO__ && (
              <span className="ml-auto rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold text-accent" title="Part of Robs AI Cockpit Pro">PRO</span>
            )}
            {v === "assistants" && (assistantsNeedYou > 0 || assistantsBusy > 0) && (
              <span
                className={cx("ml-auto rounded-full px-1.5 text-[10.5px] font-semibold", assistantsNeedYou > 0 ? "bg-warn/20 text-warn" : "bg-accent/20 text-accent")}
                title={assistantsNeedYou > 0 ? "Assistants waiting for you" : "Assistants working on a goal"}
              >
                {assistantsNeedYou || assistantsBusy}
              </span>
            )}
            {v === "tasks" && toReview > 0 && (
              <span className="ml-auto rounded-full bg-ok/20 px-1.5 text-[10.5px] font-semibold text-ok" title="Tasks ready for review">{toReview}</span>
            )}
            {v === "loops" && loopsRunning > 0 && (
              <span className="ml-auto rounded-full bg-accent/20 px-1.5 text-[10.5px] font-semibold text-accent" title="Loops running">{loopsRunning}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[10.5px] font-semibold tracking-wider text-faint uppercase">Projects</span>
        <IconButton title="Add project directory" onClick={pick}>
          <FolderPlus size={13} />
        </IconButton>
      </div>
      <div className="max-h-[38%] overflow-auto px-1.5">
        {projects.length === 0 && (
          <button onClick={pick} className="w-full rounded px-2 py-2 text-left text-[12px] text-faint hover:bg-hover hover:text-muted">
            Add a local project directory…
          </button>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            onClick={() => selectProject(p.id)}
            title={p.path}
            className={cx(
              "group flex h-7 items-center gap-2 rounded px-2 text-[12.5px]",
              active === p.id ? "bg-accent/10 text-fg" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <span className={cx("h-1.5 w-1.5 rounded-full", active === p.id ? "bg-accent" : "bg-line-strong")} />
            <span className="flex-1 truncate">{p.name}</span>
            <span className="hidden gap-0.5 group-hover:flex">
              <IconButton title="Open folder" onClick={(e) => { e.stopPropagation(); void api.openKnownDir("project", p.id); }}>
                <FolderOpen size={12} />
              </IconButton>
              <IconButton
                title="Remove from cockpit (files are not touched)"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.projectRemove(p.id);
                  if (active === p.id) selectProject(null);
                  await refreshProjects();
                }}
              >
                <Trash2 size={12} />
              </IconButton>
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[10.5px] font-semibold tracking-wider text-faint uppercase">Sessions</span>
        <span className="text-[10.5px] text-faint tabular">{order.length}</span>
      </div>
      <div className="flex-1 overflow-auto px-1.5 pb-2">
        {order.map((id) => {
          const s = sessions[id];
          if (!s) return null;
          const acc = accounts.find((a) => a.id === s.accountId);
          const visible = panes.includes(id);
          return (
            <button
              key={id}
              {...sessionDrag(id)}
              onClick={() => showSession(id)}
              title={visible ? `Shown in pane ${panes.indexOf(id) + 1}` : "Not on screen — click to show, or drag onto a pane"}
              className={cx(
                "flex min-h-8 w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px]",
                visible ? "text-fg" : "text-muted hover:text-fg",
                "hover:bg-hover",
              )}
            >
              <StatusDot status={s.runtime?.status ?? s.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate leading-tight">{s.name}</span>
                <span className="block truncate text-[10.5px] leading-tight text-faint">
                  {s.runtime?.status === "working" && s.runtime.currentActivity
                    ? s.runtime.currentActivity
                    : <>{s.kind !== "agent" ? s.kind : acc?.name ?? "—"}{s.runtime?.model ? ` · ${s.runtime.model}` : ""}</>}
                </span>
              </span>
              {assistantOf(assistants, s.id) ? (
                <AssistantAvatar avatar={assistantOf(assistants, s.id)!.avatar} color={assistantOf(assistants, s.id)!.color} mood={moodOf(s)} size={20} />
              ) : (
                <ProviderMark provider={s.provider} />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
