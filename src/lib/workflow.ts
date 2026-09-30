// Background workflow: auto-dispatch of tasks, night shift, tests after each turn, hang
// detection and daily token budgets. Decisions are pure functions (workflow.test.ts);
// `initWorkflow` wires them to the store.
import { api, errMsg, type Session, type Task } from "./api";
import { reconcileTasks, useApp } from "../store";
import { pushNow } from "./notify";
import { buildReport } from "./report";
import { duration } from "./format";

// ---------------------------------------------------------------------------
// Settings shapes
// ---------------------------------------------------------------------------

export interface NightShift {
  on: boolean;
  /** "07:00" — local time the shift ends. */
  until: string;
  startedAt?: number;
}
export interface Budgets {
  /** Daily token budget per project path (millions). */
  limits: Record<string, number>;
  /** Stop handing out tasks for a project over its budget. */
  block?: boolean;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function dispatchAgents(settings: Record<string, unknown>): string[] {
  return Array.isArray(settings.dispatchAgents) ? (settings.dispatchAgents as string[]) : [];
}
export function nightShift(settings: Record<string, unknown>): NightShift {
  const n = settings.nightShift as NightShift | undefined;
  return { on: !!n?.on, until: typeof n?.until === "string" ? n.until : "07:00", startedAt: n?.startedAt };
}
export function budgets(settings: Record<string, unknown>): Budgets {
  const b = settings.budgets as Budgets | undefined;
  return { limits: b?.limits && typeof b.limits === "object" ? b.limits : {}, block: !!b?.block };
}

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/** Is this agent free for the next task? Running, idle or waiting, nothing queued, no task. */
export function agentFree(s: Session, tasks: Task[]): boolean {
  const rt = s.runtime;
  if (s.kind !== "agent" || !rt?.running || rt.pendingInput) return false;
  if (rt.status !== "waiting-for-input" && rt.status !== "idle") return false;
  return !tasks.some((t) => t.status === "running" && t.sessionId === s.id);
}

/**
 * Next task for a free agent: open tasks in board order; a task bound to a project only goes to
 * agents working in that project; a task with its own worktree only to the agent created for it.
 */
export function nextTaskFor(s: Session, tasks: Task[], blockedProjects: Set<string> = new Set()): Task | null {
  const open = tasks.filter((t) => t.status === "open").sort((a, b) => a.sort - b.sort);
  for (const t of open) {
    if (t.worktree) continue; // started together with its own agent
    if (t.projectId && t.projectId !== s.projectId) continue;
    if (s.projectId && blockedProjects.has(s.projectId)) continue;
    return t;
  }
  return null;
}

/** When does a night shift that started at `startedAt` end ("07:00" the next morning)? */
export function shiftEnd(until: string, startedAt: number): number {
  const [h, m] = until.split(":").map((x) => Number(x));
  const end = new Date(startedAt);
  end.setHours(Number.isFinite(h) ? h : 7, Number.isFinite(m) ? m : 0, 0, 0);
  if (end.getTime() <= startedAt) end.setDate(end.getDate() + 1);
  return end.getTime();
}

/** Working without any sign of progress for longer than `minutes`? */
export function isHanging(s: Session, lastActivityTs: number | undefined, minutes: number, now = Date.now()): boolean {
  const rt = s.runtime;
  if (!minutes || !rt?.running || rt.status !== "working") return false;
  const since = Math.max(rt.turnStartedAt ?? 0, lastActivityTs ?? 0);
  return since > 0 && now - since > minutes * 60_000;
}

/** Test command for a session: the one configured for the project folder it works in. */
export function testCommandFor(cwd: string, commands: Record<string, string>): { dir: string; command: string } | null {
  const c = norm(cwd);
  let best: { dir: string; command: string } | null = null;
  for (const [dir, command] of Object.entries(commands)) {
    const d = norm(dir);
    if (!command?.trim()) continue;
    if (c === d || c.startsWith(`${d}/`)) {
      if (!best || d.length > norm(best.dir).length) best = { dir, command };
    }
  }
  // Worktrees live in <project>/.worktrees/<name>: run the tests there, where the agent works.
  return best ? { dir: cwd, command: best.command } : null;
}

/** A turn ended since the previous state (works for fast CLIs that never look "working"). */
export function turnJustEnded(now: Session, before: Session | undefined): boolean {
  const end = now.runtime?.turnEndedAt;
  return !!end && now.runtime?.status === "waiting-for-input" && end !== before?.runtime?.turnEndedAt;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

let started = false;
const assigning = new Set<string>();
const hangWarned: Record<string, number> = {};
const budgetWarned: Record<string, string> = {};
let overBudget = new Set<string>(); // project ids
const testsBusy = new Set<string>();

export function projectsOverBudget(): Set<string> {
  return overBudget;
}

async function dispatchTick() {
  const st = useApp.getState();
  const night = nightShift(st.settings);
  if (st.settings.autoDispatch !== true && !night.on) return;
  const ids = dispatchAgents(st.settings);
  const blocked = budgets(st.settings).block ? overBudget : new Set<string>();
  for (const id of ids) {
    const s = st.sessions[id];
    if (!s || assigning.has(id) || !agentFree(s, useApp.getState().tasks)) continue;
    const t = nextTaskFor(s, useApp.getState().tasks, blocked);
    if (!t) continue;
    assigning.add(id);
    try {
      await useApp.getState().assignTask(t.id, id);
    } finally {
      assigning.delete(id);
    }
  }
}

async function nightShiftTick() {
  const st = useApp.getState();
  const night = nightShift(st.settings);
  if (!night.on || !night.startedAt) return;
  const tasks = st.tasks;
  const busy = tasks.some((t) => t.status === "running");
  const open = tasks.some((t) => t.status === "open" && !t.worktree);
  const timeUp = Date.now() >= shiftEnd(night.until, night.startedAt);
  if (!timeUp && (busy || open)) return;
  await finishNightShift(timeUp ? "time" : "empty");
}

export async function startNightShift(until: string) {
  const st = useApp.getState();
  const agents = dispatchAgents(st.settings).filter((id) => st.sessions[id]?.runtime?.running);
  if (!agents.length) {
    st.toast("Choose at least one running agent for the night shift (Tasks → agents on the right)", "warn");
    return;
  }
  // Limits must not end the night: continue automatically after resets.
  for (const id of agents) if (!st.sessions[id]?.autoContinue) await st.setAutoContinue(id, true);
  await st.setSetting("nightShift", { on: true, until, startedAt: Date.now() } satisfies NightShift);
  st.toast(`Night shift started — ${agents.length} agent(s) work through the open tasks until ${until}`, "ok");
  void dispatchTick();
}

export async function finishNightShift(reason: "time" | "empty" | "manual") {
  const st = useApp.getState();
  const night = nightShift(st.settings);
  if (!night.on) return;
  await st.setSetting("nightShift", { ...night, on: false } satisfies NightShift);
  const from = new Date(night.startedAt ?? Date.now() - 8 * 3600_000);
  try {
    const summary = await api.usageSummary("today");
    const stats = await api.activityStats(from.getTime());
    const done = st.tasks.filter((t) => (t.status === "review" || t.status === "done") && (t.startedAt ?? 0) >= from.getTime());
    let md = buildReport({ title: "Nachtschicht", from, to: new Date(), summary, stats, tasks: st.tasks });
    if (done.length) {
      md += "\n\n## Ergebnisse der Nacht\n";
      for (const t of done) md += `\n### ${t.title}\n\n${(t.result ?? "").slice(0, 3000)}\n`;
    }
    const path = await api.reportSave(`Nachtschicht-${new Date().toISOString().slice(0, 10)}`, md);
    const why = reason === "time" ? "Zeit abgelaufen" : reason === "empty" ? "alle Aufgaben abgearbeitet" : "beendet";
    const text = `${done.length} Aufgabe(n) bearbeitet in ${duration(Date.now() - from.getTime())} (${why}). Bericht: ${path}`;
    st.toast(`🌙 Night shift finished: ${text}`, "ok", { label: "Open tasks", run: () => useApp.getState().setView("tasks") });
    void pushNow("Nachtschicht beendet", text);
  } catch (e) {
    st.toast(`Night shift finished (report failed: ${errMsg(e)})`, "warn");
  }
}

async function runTestsFor(s: Session) {
  const st = useApp.getState();
  if (st.settings.autoTests !== true) return;
  const commands = (st.settings.testCommands as Record<string, string> | undefined) ?? {};
  const target = testCommandFor(s.worktreePath ?? s.cwd, commands);
  if (!target || testsBusy.has(s.id)) return;
  testsBusy.add(s.id);
  st.setTestResult(s.id, { state: "running", at: Date.now() });
  try {
    const r = await api.testsRun(target.dir, target.command);
    useApp.getState().setTestResult(s.id, { state: r.ok ? "ok" : "fail", tail: r.tail, at: Date.now(), durationMs: r.durationMs });
    for (const t of useApp.getState().tasks.filter((x) => x.sessionId === s.id && (x.status === "running" || x.status === "review"))) {
      void useApp.getState().saveTask({ ...t, tests: r.ok ? "ok" : "fail" });
    }
    if (!r.ok) {
      useApp.getState().toast(`${s.name}: tests failed${r.timedOut ? " (timeout)" : ""}`, "error", {
        label: "Send failures to the agent",
        run: () => void useApp.getState().queueInput(s.id, `Die Tests schlagen fehl (\`${target.command}\`). Ausgabe:\n\n${r.tail.slice(-4000)}\n\nBitte finde die Ursache und behebe sie.`),
      });
    }
  } catch (e) {
    useApp.getState().setTestResult(s.id, { state: "fail", tail: errMsg(e), at: Date.now() });
  } finally {
    testsBusy.delete(s.id);
  }
}

function hangTick() {
  const st = useApp.getState();
  const minutes = Number(st.settings.hangMinutes ?? 15);
  for (const s of Object.values(st.sessions)) {
    const last = st.activity[s.id]?.slice(-1)[0]?.ts;
    if (!isHanging(s, last, minutes)) continue;
    const turn = s.runtime?.turnStartedAt ?? 0;
    if (hangWarned[s.id] === turn) continue;
    hangWarned[s.id] = turn;
    st.toast(`${s.name} has shown no progress for ${minutes} min — it may hang.`, "warn", {
      label: "Interrupt (Esc)",
      run: () => void api.ptyWrite(s.id, "\u001b").catch(() => {}),
    });
    void pushNow(`${s.name}: keine Fortschritte seit ${minutes} min`, s.runtime?.currentActivity ?? "Agent hängt eventuell");
  }
}

async function budgetTick() {
  const st = useApp.getState();
  const b = budgets(st.settings);
  const entries = Object.entries(b.limits).filter(([, m]) => m > 0);
  if (!entries.length) {
    overBudget = new Set();
    return;
  }
  const today = await api.usageSummary("today").catch(() => null);
  if (!today) return;
  const day = new Date().toDateString();
  const next = new Set<string>();
  for (const [path, millions] of entries) {
    const used = today.byProject.filter((g) => norm(g.key) === norm(path) || norm(g.key).startsWith(`${norm(path)}/`)).reduce((a, g) => a + g.totals.total, 0);
    const ratio = used / (millions * 1e6);
    const project = st.projects.find((p) => norm(p.path) === norm(path));
    if (ratio >= 1 && project) next.add(project.id);
    const level = ratio >= 1 ? "100" : ratio >= 0.8 ? "80" : "";
    const key = `${path}|${day}`;
    if (level && budgetWarned[key] !== level && !(level === "80" && budgetWarned[key] === "100")) {
      budgetWarned[key] = level;
      const name = project?.name ?? path.split(/[\\/]/).pop();
      const text = `${name}: ${Math.round(ratio * 100)}% of today's budget (${millions}M tokens)${level === "100" && b.block ? " — no new tasks for this project today" : ""}`;
      st.toast(text, level === "100" ? "error" : "warn");
      void pushNow("Token-Budget", text);
    }
  }
  overBudget = next;
}

export function initWorkflow() {
  if (started) return;
  started = true;
  useApp.subscribe((st, prev) => {
    if (st.sessions === prev.sessions && st.tasks === prev.tasks && st.settings === prev.settings) return;
    if (st.tasks !== prev.tasks || st.sessions !== prev.sessions) reconcileTasks();
    void dispatchTick();
    for (const s of Object.values(st.sessions)) {
      if (s.kind === "agent" && turnJustEnded(s, prev.sessions[s.id])) void runTestsFor(s);
    }
  });
  window.setInterval(() => {
    reconcileTasks();
    void dispatchTick();
  }, 15_000);
  window.setInterval(() => void nightShiftTick(), 60_000);
  window.setInterval(hangTick, 60_000);
  window.setInterval(() => void budgetTick(), 5 * 60_000);
  void budgetTick();
}
