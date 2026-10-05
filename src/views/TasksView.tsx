import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, CornerDownLeft, FlaskConical, GitBranch, GitMerge, Moon, Plus, RotateCcw, Send, Trash2, UserRoundCheck, Zap,
} from "lucide-react";
import { useApp } from "../store";
import { api, errMsg, type Session, type Task, type TaskStatus } from "../lib/api";
import { duration } from "../lib/format";
import { dispatchAgents, finishNightShift, nightShift, startNightShift } from "../lib/workflow";
import { Badge, Button, Card, cx, IconButton, ProviderMark, Select, StatusDot } from "../components/ui";

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: "open", label: "Open", hint: "Drag onto an agent on the right, or “Give to…”" },
  { status: "running", label: "Running", hint: "The agent is working on it" },
  { status: "review", label: "Review", hint: "The agent finished — check the answer" },
  { status: "done", label: "Done", hint: "" },
];

/** Kanban for agent work: a task goes to an agent, its answer comes back for review. */
export function TasksView() {
  const tasks = useApp((s) => s.tasks);
  const sessions = useApp((s) => s.sessions);
  const order = useApp((s) => s.order);
  const projects = useApp((s) => s.projects);
  const settings = useApp((s) => s.settings);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const night = nightShift(settings);
  const [until, setUntil] = useState(night.until);
  const auto = settings.autoDispatch === true;
  const takers = dispatchAgents(settings);

  useEffect(() => {
    void useApp.getState().refreshTasks();
  }, []);

  const agents = useMemo(
    () =>
      order
        .map((id) => sessions[id])
        .filter((s): s is Session => !!s && s.kind === "agent")
        .sort((a, b) => rank(a) - rank(b)),
    [order, sessions],
  );

  const add = async () => {
    if (!title.trim()) return;
    const t = await useApp.getState().saveTask({ title: title.trim(), text, projectId: projectId || null });
    if (t) {
      setTitle("");
      setText("");
      setExpanded(false);
    }
  };
  const toggleTaker = (id: string) => {
    const next = takers.includes(id) ? takers.filter((x) => x !== id) : [...takers, id];
    void useApp.getState().setSetting("dispatchAgents", next);
  };

  // Pointer drag of a task card onto an agent ([data-agent]).
  const startDrag = (taskId: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button,textarea,input,select")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    const over = (x: number, y: number) =>
      (document.elementsFromPoint(x, y).map((el) => (el as HTMLElement).closest?.("[data-agent]") as HTMLElement | null).find(Boolean)?.dataset.agent) ?? null;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      active = true;
      document.body.style.userSelect = "none";
      setDragging({ id: taskId, x: ev.clientX, y: ev.clientY, over: over(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      document.body.style.userSelect = "";
      setDragging(null);
      if (!active) return;
      const agent = over(ev.clientX, ev.clientY);
      if (agent) void useApp.getState().assignTask(taskId, agent);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-[16px] font-semibold">Tasks</h1>
            <p className="text-[12px] text-muted">Collect work, hand it to an agent, get the answer back here for review.</p>
          </div>
          <Button
            variant={auto ? "primary" : "default"}
            onClick={() => void useApp.getState().setSetting("autoDispatch", !auto)}
            title="Free agents marked ⚡ on the right take the next open task by themselves (top first)"
          >
            <Zap size={13} /> Auto-dispatch {auto ? "on" : "off"}
          </Button>
          {night.on ? (
            <Button variant="primary" onClick={() => void finishNightShift("manual")} title="End the night shift now and write the report">
              <Moon size={13} /> Night shift until {night.until} · end now
            </Button>
          ) : (
            <span className="flex items-center gap-1">
              <input type="time" value={until} onChange={(e) => setUntil(e.target.value)} className="h-7 rounded border border-line-strong bg-bg px-1 text-[12px]" title="Night shift ends at" />
              <Button onClick={() => void startNightShift(until)} title="The ⚡ agents work through all open tasks until this time; limits are waited out automatically; a report + push at the end">
                <Moon size={13} /> Start night shift
              </Button>
            </span>
          )}
        </div>
        <Card className="mb-3 p-2">
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !expanded) void add(); }}
              placeholder="New task… (Enter adds, ▾ for details)"
              className="h-8 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 text-[13px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} title="Only agents working in this project take the task" className="max-w-[180px]">
              <option value="">any project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <IconButton title="Details" onClick={() => setExpanded((x) => !x)}><ChevronDown size={14} className={cx(expanded && "rotate-180")} /></IconButton>
            <Button variant="primary" disabled={!title.trim()} onClick={() => void add()}><Plus size={13} /> Add</Button>
          </div>
          {expanded && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="What exactly should be done? Acceptance criteria, files, hints…"
              className="mt-2 w-full rounded border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
          )}
        </Card>
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-3">
          {COLUMNS.map((col) => {
            const list = tasks.filter((t) => t.status === col.status).sort((a, b) => a.sort - b.sort);
            return (
              <div key={col.status} className="flex min-h-0 flex-col rounded-md border border-line bg-panel/50">
                <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
                  <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{col.label}</span>
                  <span className="text-[11px] text-faint tabular">{list.length}</span>
                  {col.status === "done" && list.length > 0 && (
                    <button className="ml-auto text-[11px] text-faint hover:text-fg" onClick={() => { if (window.confirm(`Delete ${list.length} done task(s)?`)) void clearDone(list); }}>clear</button>
                  )}
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
                  {list.length === 0 && col.hint && <p className="px-1 text-[11.5px] text-faint">{col.hint}</p>}
                  {list.map((t, i) => (
                    <TaskCard
                      key={t.id}
                      t={t}
                      agents={agents}
                      onPointerDown={t.status === "open" || t.status === "review" ? startDrag(t.id) : undefined}
                      dragging={dragging?.id === t.id}
                      move={col.status === "open" ? (dir) => void swapSort(list, i, dir) : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="flex w-[270px] shrink-0 flex-col border-l border-line bg-panel">
        <div className="border-b border-line px-3 py-2.5">
          <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Agents</div>
          <div className="text-[11px] text-faint">Drop a task on an agent · ⚡ = takes tasks by itself</div>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
          {agents.length === 0 && <p className="px-1 text-[12px] text-faint">No agent sessions yet.</p>}
          {agents.map((s) => {
            const busy = tasks.filter((t) => t.status === "running" && t.sessionId === s.id).length;
            const status = s.runtime?.status ?? s.status;
            const taker = takers.includes(s.id);
            return (
              <div
                key={s.id}
                data-agent={s.id}
                className={cx(
                  "rounded border px-2 py-1.5 text-[12px]",
                  dragging?.over === s.id ? "border-accent bg-accent/15" : dragging ? "border-accent/40 border-dashed" : "border-line",
                  !s.runtime?.running && "opacity-60",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <ProviderMark provider={s.provider} />
                  <b className="min-w-0 flex-1 truncate">{s.name}</b>
                  <button
                    title={taker ? "Takes tasks automatically — click to stop" : "Let this agent take open tasks automatically (auto-dispatch / night shift)"}
                    onClick={() => toggleTaker(s.id)}
                    className={cx("rounded px-1", taker ? "text-warn" : "text-line-strong hover:text-muted")}
                  >
                    <Zap size={13} />
                  </button>
                  <StatusDot status={status} />
                </div>
                <div className="text-[11px] text-faint">
                  {!s.runtime?.running ? "not running" : status === "waiting-for-input" || status === "idle" ? "free" : status === "working" ? "working" : status}
                  {busy ? ` · ${busy} task${busy === 1 ? "" : "s"}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </aside>
      {dragging && (
        <div className="pointer-events-none fixed z-[80] rounded border border-accent/60 bg-panel/95 px-2 py-1 text-[12px] shadow-xl" style={{ left: dragging.x + 12, top: dragging.y + 10 }}>
          {tasks.find((t) => t.id === dragging.id)?.title}
          <span className="text-accent"> → {dragging.over ? sessions[dragging.over]?.name : "drop on an agent"}</span>
        </div>
      )}
    </div>
  );
}

/** Free agents first (waiting for input), then working, then stopped. */
function rank(s: Session): number {
  const st = s.runtime?.status ?? s.status;
  if (!s.runtime?.running) return 3;
  return st === "waiting-for-input" || st === "idle" ? 0 : st === "working" ? 1 : 2;
}

async function clearDone(list: Task[]) {
  for (const t of list) await api.taskDelete(t.id).catch(() => {});
  await useApp.getState().refreshTasks();
}

/** Priority: swap with the neighbour above / below (board order = dispatch order). */
async function swapSort(list: Task[], i: number, dir: -1 | 1) {
  const other = list[i + dir];
  const me = list[i];
  if (!other) return;
  const st = useApp.getState();
  const a = me.sort === other.sort ? other.sort + dir : other.sort;
  await st.saveTask({ ...me, sort: a });
  await st.saveTask({ ...other, sort: me.sort });
}

/** New agent in its own git worktree for this task (no conflicts with other agents). */
export async function startInWorktree(t: Task, accountId: string) {
  const st = useApp.getState();
  const projectId = t.projectId ?? st.activeProjectId;
  const project = st.projects.find((p) => p.id === projectId);
  if (!project) {
    st.toast("Pick a project for this task first (or select one in the sidebar)", "warn");
    return;
  }
  try {
    const slug = t.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "task";
    const wt = await api.gitWorktreeAdd(project.id, `task-${slug}-${Math.random().toString(36).slice(2, 6)}`);
    const acc = st.accounts.find((a) => a.id === accountId);
    const s = await st.createSession({
      accountId,
      projectId: project.id,
      cwd: wt.path,
      name: `${t.title.slice(0, 24)} · ${acc?.name ?? "agent"}`,
      options: { initialPrompt: [t.title, t.text.trim()].filter(Boolean).join("\n\n") },
      autoContinue: true,
    });
    if (!s) return;
    await st.saveTask({ ...t, status: "running", sessionId: s.id, projectId: project.id, worktree: wt.path, branch: wt.branch ?? null });
    st.toast(`"${t.title}" runs in its own worktree (${wt.branch})`, "ok");
  } catch (e) {
    st.toast(errMsg(e), "error");
  }
}

async function mergeTask(t: Task) {
  const st = useApp.getState();
  if (!window.confirm(`Merge the work of "${t.title}" (${t.branch}) into the project?\n\nUncommitted changes in the worktree are committed first; on conflicts nothing is changed.`)) return;
  try {
    const r = await api.taskMerge(t.id);
    if (r.merged) {
      await st.saveTask({ ...t, status: "done", worktree: null });
      st.toast(`Merged ${t.branch} (${r.head}) — ${r.message}`, "ok");
    } else if (r.conflicts.length) {
      st.toast(`Merge conflicts in ${r.conflicts.join(", ")} — nothing changed. Ask the agent to rebase onto the current branch.`, "error");
    } else {
      st.toast(r.message, "info");
    }
  } catch (e) {
    st.toast(errMsg(e), "error");
  }
}

function TaskCard({ t, agents, onPointerDown, dragging, move }: { t: Task; agents: Session[]; onPointerDown?: (e: ReactPointerEvent) => void; dragging: boolean; move?: (dir: -1 | 1) => void }) {
  const agent = useApp((s) => (t.sessionId ? s.sessions[t.sessionId] : undefined));
  const accounts = useApp((s) => s.accounts);
  const project = useApp((s) => s.projects.find((p) => p.id === t.projectId));
  const [open, setOpen] = useState(t.status === "review");
  const [feedback, setFeedback] = useState("");
  const [menu, setMenu] = useState<"give" | "review" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [menu]);
  const st = useApp.getState();
  const running = agents.filter((a) => a.runtime?.running);
  const took = t.startedAt ? duration((t.finishedAt ?? (t.status === "running" ? Date.now() : new Date(t.updatedAt).getTime())) - t.startedAt) : null;
  const setStatus = (status: TaskStatus) => void st.saveTask({ ...t, status });
  const reviewMessage = (from: string) =>
    `Bitte prüfe das Ergebnis von ${from} zur Aufgabe „${t.title}“. Suche nach Fehlern und Lücken und behebe eindeutige Probleme direkt.\n\nAufgabe:\n${t.text || t.title}\n\nErgebnis von ${from}:\n${t.result ?? ""}`;

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className={cx("relative rounded border border-line-strong bg-raised p-2 text-[12px]", onPointerDown && "cursor-grab", dragging && "opacity-40")}
    >
      <div className="flex items-start gap-1">
        <button className="min-w-0 flex-1 text-left font-medium" onClick={() => setOpen((o) => !o)}>{t.title}</button>
        {move && (
          <>
            <IconButton title="Higher priority" onClick={() => move(-1)}><ArrowUp size={11} /></IconButton>
            <IconButton title="Lower priority" onClick={() => move(1)}><ArrowDown size={11} /></IconButton>
          </>
        )}
        <IconButton title="Delete" onClick={() => { if (window.confirm(`Delete "${t.title}"?`)) void api.taskDelete(t.id).then(() => st.refreshTasks()); }}>
          <Trash2 size={11} />
        </IconButton>
      </div>
      {t.text && <p className={cx("mt-0.5 whitespace-pre-wrap text-muted", !open && "line-clamp-2")}>{t.text}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {project && <Badge title="Only agents in this project take it">{project.name}</Badge>}
        {agent && <Badge tone={t.status === "running" ? "accent" : "neutral"}><ProviderMark provider={agent.provider} /><span className="ml-1">{agent.name}</span></Badge>}
        {t.branch && <Badge title={t.worktree ?? ""}><GitBranch size={10} className="mr-1" />{t.branch}</Badge>}
        {t.tests && <Badge tone={t.tests === "ok" ? "ok" : "err"} title="Automatic test run after the agent's last turn"><FlaskConical size={10} className="mr-1" />tests {t.tests === "ok" ? "green" : "red"}</Badge>}
        {took && <span className="text-[10.5px] text-faint">{took}</span>}
      </div>
      {t.result && open && (
        <div className="mt-1.5 max-h-60 overflow-auto rounded border border-line bg-bg p-1.5 text-[11.5px] whitespace-pre-wrap text-fg/90">{t.result}</div>
      )}
      {t.status === "open" && (
        <div className="mt-1.5">
          <Button size="sm" onClick={() => setMenu(menu === "give" ? null : "give")}><Send size={11} /> Give to…</Button>
        </div>
      )}
      {t.status === "running" && (
        <div className="mt-1.5 flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => agent && st.showSession(agent.id)}>Show agent</Button>
          <Button size="sm" variant="ghost" onClick={() => setStatus("review")} title="Mark as finished if the automatic detection missed it">Finished</Button>
        </div>
      )}
      {t.status === "review" && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {t.worktree ? (
              <Button size="sm" variant="primary" onClick={() => void mergeTask(t)} title="Commit the worktree and merge its branch into the project"><GitMerge size={11} /> Merge & done</Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => setStatus("done")}><Check size={11} /> Done</Button>
            )}
            <Button size="sm" onClick={() => setMenu(menu === "review" ? null : "review")} title="Another agent checks this result"><UserRoundCheck size={11} /> Review by…</Button>
            {agent && <Button size="sm" variant="ghost" onClick={() => st.showSession(agent.id)}>Show agent</Button>}
          </div>
          {agent && (
            <div className="flex gap-1">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && feedback.trim()) { void st.assignTask(t.id, agent.id, feedback); setFeedback(""); } }}
                placeholder={`Feedback to ${agent.name}… (Enter)`}
                className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-bg px-1.5 text-[11.5px] placeholder:text-faint focus:border-accent focus:outline-none"
              />
              {feedback.trim() && <IconButton title="Send feedback" onClick={() => { void st.assignTask(t.id, agent.id, feedback); setFeedback(""); }}><CornerDownLeft size={12} /></IconButton>}
            </div>
          )}
        </div>
      )}
      {t.status === "done" && (
        <div className="mt-1.5 flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setStatus("open")}><RotateCcw size={11} /> Reopen</Button>
          {t.worktree && <Button size="sm" variant="ghost" onClick={() => void mergeTask(t)}><GitMerge size={11} /> Merge</Button>}
        </div>
      )}
      {menu && (
        <div className="absolute top-full left-0 z-30 mt-1 w-64 rounded-md border border-line-strong bg-panel p-1 shadow-xl">
          <div className="px-2 py-1 text-[10.5px] text-faint uppercase">{menu === "give" ? "Give to" : "Review by"}</div>
          {running.filter((a) => menu === "give" || a.id !== t.sessionId).map((a) => (
            <button
              key={a.id}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-hover"
              onClick={() => {
                setMenu(null);
                void st.assignTask(t.id, a.id, menu === "review" ? reviewMessage(agent?.name ?? "einem anderen Agenten") : undefined);
              }}
            >
              <ProviderMark provider={a.provider} />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <StatusDot status={a.runtime?.status ?? a.status} />
            </button>
          ))}
          {running.length === 0 && <p className="px-2 py-1.5 text-[11.5px] text-faint">No agent is running.</p>}
          {menu === "give" && (
            <>
              <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[10.5px] text-faint uppercase">New agent in its own worktree</div>
              {accounts.filter((a) => a.authStatus === "connected" || a.provider === "custom").map((a) => (
                <button
                  key={a.id}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-hover"
                  title="Creates .worktrees/task-… on a new branch and starts a fresh agent there with this task"
                  onClick={() => { setMenu(null); void startInWorktree(t, a.id); }}
                >
                  <GitBranch size={12} className="text-faint" />
                  <ProviderMark provider={a.provider} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
