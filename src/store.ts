import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  errMsg,
  type Account,
  type Activity,
  type AppInfo,
  type CliInfo,
  type Project,
  type QuotaWindow,
  type RuntimeView,
  type Session,
  type Task,
  type TaskInput,
} from "./lib/api";
import * as terms from "./lib/terminals";
import { pickFailoverAccount } from "./lib/failover";
import type { Voice } from "./lib/voice";

/** Tray/taskbar attention; unavailable in tests and plain browsers. */
async function requestAttention() {
  try {
    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
  } catch {
    /* not in a Tauri window */
  }
}

function appHasFocus(): boolean {
  try {
    return typeof document !== "undefined" && !document.hidden && document.hasFocus();
  } catch {
    return true;
  }
}

/** Tasks being moved to "review" right now (reconcile must not do it twice). */
const completing = new Set<string>();
/** Tasks handed to an agent: done once the agent worked and waits again. */
const taskWatch: Record<string, { sessionId: string; sawWorking: boolean }> = {};
/** Sessions already warned about a full context window (until it drops again). */
const contextWarned: Record<string, boolean> = {};
/** Last edit per file (lower-case path) — two agents on one file get a warning. */
const lastEdit: Record<string, { id: string; ts: number }> = {};
const conflictWarned: Record<string, number> = {};
const CONFLICT_WINDOW_MS = 15 * 60_000;

/** When a session was last started from the UI (to explain CLIs that exit immediately). */
const startedAt: Record<string, number> = {};

/** Last automatic account switch per session (avoid ping-pong between exhausted accounts). */
const failoverAt: Record<string, number> = {};

export type View = "overview" | "workspace" | "tasks" | "review" | "pins" | "loops" | "accounts" | "history" | "usage" | "security" | "settings";
export type LayoutMode = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "tabs";

export const MAX_PANES = 8;
export const SLOTS: Record<LayoutMode, number> = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, tabs: 1 };

export function isLayoutMode(m: unknown): m is LayoutMode {
  return typeof m === "string" && Object.prototype.hasOwnProperty.call(SLOTS, m);
}

/** Layout with `n` panes (1–8). */
export function modeFor(n: number): LayoutMode {
  return String(Math.max(1, Math.min(MAX_PANES, Math.round(n)))) as LayoutMode;
}

/** Most panes the workspace grows to on its own (Settings → Workspace). */
export function maxPanes(settings: Record<string, unknown>): number {
  const n = Number(settings.maxPanes);
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_PANES, Math.round(n)) : MAX_PANES;
}

/** A session being dragged onto a pane (sidebar, dock or pane header). */
export interface DragState {
  id: string;
  x: number;
  y: number;
  /** Pane under the pointer, "new" for the add-pane drop zone. */
  over: number | "new" | null;
}

export interface TestResult {
  state: "running" | "ok" | "fail";
  tail?: string;
  at: number;
  durationMs?: number;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "warn" | "ok";
  text: string;
  action?: { label: string; run: () => void };
}

interface State {
  ready: boolean;
  initError: string | null;
  launching: Record<string, boolean>;
  info: AppInfo | null;
  clis: CliInfo[];
  projects: Project[];
  accounts: Account[];
  sessions: Record<string, Session>;
  order: string[];
  activeProjectId: string | null;
  view: View;
  mode: LayoutMode;
  panes: (string | null)[];
  focused: number;
  quota: Record<string, QuotaWindow[]>;
  usageVersion: number;
  toasts: Toast[];
  newSessionFor: { pane: number | null } | null;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  pendingStart: Record<string, true>;
  settings: Record<string, unknown>;
  teamOpen: boolean;
  broadcastOpen: boolean;
  voice: Voice;
  hotkeyFor: string | null;
  /** Latest activity per session (newest last), fed live by the backend. */
  activity: Record<string, Activity[]>;
  /** Bumped whenever a file was touched (Overview refreshes its recent files). */
  filesVersion: number;
  /** Bumped when loops change (Loops view refreshes). */
  loopsVersion: number;
  /** Session that needs a pane while all panes are taken (asks which one makes room). */
  placeFor: string | null;
  drag: DragState | null;
  /** Pane shown alone (focus mode); the others keep running. */
  zoomed: number | null;
  tasks: Task[];
  cheatsheetOpen: boolean;
  tourOpen: boolean;
  setTourOpen: (open: boolean) => void;
  /** Last automatic test run per session (Settings → Tests after each turn). */
  testResults: Record<string, TestResult>;
  setTestResult: (id: string, r: TestResult) => void;

  init: () => Promise<void>;
  setZoom: (pane: number | null) => void;
  setCheatsheet: (open: boolean) => void;
  refreshTasks: () => Promise<void>;
  saveTask: (input: TaskInput) => Promise<Task | null>;
  /** Give a task to an agent: typed in when the agent is ready; the result comes back to the board. */
  assignTask: (taskId: string, sessionId: string, extra?: string) => Promise<void>;
  setVoice: (v: Voice) => void;
  setHotkeyFor: (id: string | null) => void;
  setSessionHotkey: (id: string, hotkey: string | null) => Promise<boolean>;
  refreshSettings: () => Promise<void>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  setAutoContinue: (id: string, on: boolean) => Promise<void>;
  queueInput: (id: string, text: string) => Promise<boolean>;
  handoffSession: (id: string, accountId: string, message?: string) => Promise<void>;
  setTeamOpen: (open: boolean) => void;
  setBroadcastOpen: (open: boolean) => void;
  openLoginPrivately: (id: string) => Promise<void>;
  checkAllAccounts: () => Promise<void>;
  setView: (v: View) => void;
  toast: (text: string, kind?: Toast["kind"], action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
  refreshProjects: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshQuota: () => Promise<void>;
  refreshClis: () => Promise<void>;
  addProject: (path: string) => Promise<void>;
  selectProject: (id: string | null) => void;
  openNewSession: (pane?: number | null) => void;
  closeNewSession: () => void;
  createSession: (input: Parameters<typeof api.sessionCreate>[0], pane?: number | null) => Promise<Session | null>;
  showSession: (id: string, pane?: number | null) => void;
  upsertSession: (s: Session) => void;
  startSession: (id: string) => Promise<void>;
  stopSession: (id: string) => Promise<void>;
  restartSession: (id: string) => Promise<void>;
  duplicateSession: (id: string) => Promise<void>;
  renameSession: (id: string, name: string) => Promise<void>;
  closeSession: (id: string) => Promise<void>;
  openUtility: (kind: "login" | "login-device" | "status", accountId: string) => Promise<void>;
  setMode: (m: LayoutMode) => void;
  /** Put a session into a pane; if it is shown elsewhere the two swap places. */
  placeSession: (id: string, pane: number) => void;
  addPane: (id?: string | null) => void;
  removePane: (i: number) => void;
  setPlaceFor: (id: string | null) => void;
  applyLayout: (mode: LayoutMode, panes: (string | null)[]) => void;
  setDrag: (d: DragState | null) => void;
  focusPane: (i: number) => void;
  clearPane: (i: number) => void;
  setPalette: (open: boolean) => void;
  toggleInspector: () => void;
  markStarted: (id: string) => void;
}

let toastId = 1;
let initStarted = false;
let saveTimer: number | undefined;

function persistLayout(mode: LayoutMode, panes: (string | null)[]) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    api.layoutSave(mode, panes).catch(() => {});
  }, 400);
}

function fitPanes(panes: (string | null)[], mode: LayoutMode): (string | null)[] {
  const n = SLOTS[mode];
  const out = panes.slice(0, n);
  while (out.length < n) out.push(null);
  return out;
}

/** A task's agent finished its turn → the task goes to "review" with the agent's answer. */
function onTaskProgress(sessionId: string, prev: string | undefined, rt: RuntimeView) {
  const st = useApp.getState();
  for (const t of st.tasks) {
    if (t.status !== "running" || t.sessionId !== sessionId) continue;
    const w = (taskWatch[t.id] ??= { sessionId, sawWorking: prev === "working" });
    if (rt.status === "working") w.sawWorking = true;
    // Finished: the agent worked (seen live) or reports a turn that ended after the hand-over.
    const turnDone = (rt.turnEndedAt ?? 0) > (t.startedAt ?? Number.MAX_SAFE_INTEGER);
    if ((w.sawWorking || turnDone) && rt.status === "waiting-for-input" && !rt.pendingInput) {
      if (completing.has(t.id)) continue;
      completing.add(t.id);
      delete taskWatch[t.id];
      const s = st.sessions[sessionId];
      // Custom CLIs report no "last answer": take the end of what is on screen.
      const result = rt.lastMessage
        ? Promise.resolve(rt.lastMessage)
        : s?.provider === "custom"
          ? api.ptyScreen(sessionId).then((scr) => scr.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-15).join("\n")).catch(() => "")
          : Promise.resolve(t.result ?? "");
      void result
        .then((r) => useApp.getState().saveTask({ ...t, status: "review", result: r }))
        .finally(() => completing.delete(t.id));
      st.toast(`Task "${t.title}" is ready for review`, "ok", { label: "Open tasks", run: () => useApp.getState().setView("tasks") });
    }
  }
}

/**
 * Re-check running tasks against the agents' current state. The runtime event that ends a turn
 * can arrive before the task was saved as "running" — without this it would never complete.
 */
export function reconcileTasks() {
  const st = useApp.getState();
  for (const t of st.tasks) {
    if (t.status !== "running" || !t.sessionId) continue;
    const rt = st.sessions[t.sessionId]?.runtime;
    if (rt) onTaskProgress(t.sessionId, undefined, rt);
  }
}

/** Nearly full context window: suggest /compact once (again after it dropped). */
function onContext(s: Session, rt: RuntimeView) {
  const st = useApp.getState();
  const limit = Number(st.settings.contextWarnPercent ?? 85);
  const pct = rt.contextPercent;
  if (pct == null || !limit) return;
  if (pct < limit - 10) {
    delete contextWarned[s.id];
    return;
  }
  if (pct < limit || contextWarned[s.id]) return;
  contextWarned[s.id] = true;
  st.toast(
    `${s.name}: context ${pct.toFixed(0)}% full — compacting now keeps the answers sharp.`,
    "warn",
    { label: "Compact (/compact)", run: () => void useApp.getState().queueInput(s.id, "/compact") },
  );
}

/** Two agents editing the same file within a few minutes: warn (they overwrite each other). */
function onFileEdit(sessionId: string, file: string, ts: number) {
  const st = useApp.getState();
  if (st.settings.conflictWarn === false) return;
  const key = file.replace(/\\/g, "/").toLowerCase();
  const prev = lastEdit[key];
  lastEdit[key] = { id: sessionId, ts };
  if (!prev || prev.id === sessionId || ts - prev.ts > CONFLICT_WINDOW_MS) return;
  const pair = `${key}|${[prev.id, sessionId].sort().join("|")}`;
  if (Date.now() - (conflictWarned[pair] ?? 0) < CONFLICT_WINDOW_MS) return;
  conflictWarned[pair] = Date.now();
  const a = st.sessions[prev.id]?.name ?? "another session";
  const b = st.sessions[sessionId]?.name ?? "a session";
  st.toast(`⚠ ${a} and ${b} both edited ${file.split(/[\\/]/).pop()} — they may overwrite each other (use separate worktrees).`, "warn");
}

export const useApp = create<State>((set, get) => ({
  ready: false,
  initError: null,
  launching: {},
  info: null,
  clis: [],
  projects: [],
  accounts: [],
  sessions: {},
  order: [],
  activeProjectId: null,
  view: "workspace",
  mode: "2",
  panes: [null, null],
  focused: 0,
  quota: {},
  usageVersion: 0,
  toasts: [],
  newSessionFor: null,
  paletteOpen: false,
  inspectorOpen: false,
  pendingStart: {},
  settings: {},
  teamOpen: false,
  broadcastOpen: false,
  voice: { state: "idle", target: null, level: 0 },
  hotkeyFor: null,
  activity: {},
  filesVersion: 0,
  loopsVersion: 0,
  placeFor: null,
  drag: null,
  zoomed: null,
  tasks: [],
  cheatsheetOpen: false,
  tourOpen: false,
  setTourOpen: (tourOpen) => set({ tourOpen, cheatsheetOpen: false }),
  testResults: {},
  setTestResult: (id, r) => set((st) => ({ testResults: { ...st.testResults, [id]: r } })),

  setZoom: (zoomed) => set({ zoomed, view: "workspace" }),
  setCheatsheet: (cheatsheetOpen) => set({ cheatsheetOpen }),
  refreshTasks: async () => {
    try {
      set({ tasks: await api.tasksList() });
    } catch {
      /* keep */
    }
  },
  saveTask: async (input) => {
    try {
      const t = await api.taskSave(input);
      set((st) => ({ tasks: st.tasks.some((x) => x.id === t.id) ? st.tasks.map((x) => (x.id === t.id ? t : x)) : [...st.tasks, t] }));
      return t;
    } catch (e) {
      get().toast(errMsg(e), "error");
      return null;
    }
  },
  assignTask: async (taskId, sessionId, extra) => {
    const st = get();
    const t = st.tasks.find((x) => x.id === taskId);
    const s = st.sessions[sessionId];
    if (!t || !s) return;
    if (!s.runtime?.running) {
      st.toast(`"${s.name}" is not running — start it first`, "warn");
      return;
    }
    // `extra`: the exact message (feedback, review request); default is the task itself.
    const text = extra?.trim() || [t.title, t.text.trim()].filter(Boolean).join("\n\n");
    if (!(await st.queueInput(sessionId, text))) return;
    taskWatch[taskId] = { sessionId, sawWorking: s.runtime?.status === "working" && !!s.runtime.pendingInput };
    await st.saveTask({ ...t, status: "running", sessionId, result: t.result });
    st.toast(`Task "${t.title}" → ${s.name}`, "ok");
  },

  init: async () => {
    // React StrictMode runs effects twice in dev; listeners must be registered once.
    if (initStarted) return;
    initStarted = true;
    set({ initError: null });
    const unlisten: (() => void)[] = [];
    try {
    const [info, clis, projects, accounts, open, layout, quota, settings] = await Promise.all([
      api.appInfo(),
      api.detectClis(),
      api.projectsList(),
      api.accountsList(),
      api.sessionsOpen(),
      api.layoutGet(),
      api.quotaOverview(),
      api.settingsGet().catch((): Record<string, unknown> => ({})),
    ]);
    const sessions: Record<string, Session> = {};
    for (const s of open) sessions[s.id] = s;
    const order = open.map((s) => s.id);
    let mode: LayoutMode = "2";
    let panes: (string | null)[] = [];
    if (layout) {
      mode = isLayoutMode(layout.mode) ? layout.mode : "2";
      panes = Array.isArray(layout.panes) ? (layout.panes as (string | null)[]) : [];
    }
    panes = fitPanes(panes.map((p) => (p && sessions[p] ? p : null)), mode);
    // Fill empty slots with open sessions not yet shown.
    for (const id of order) {
      if (panes.includes(id)) continue;
      const free = panes.indexOf(null);
      if (free < 0) break;
      panes[free] = id;
    }
    const preferred = typeof settings.defaultProjectId === "string" && projects.some((p) => p.id === settings.defaultProjectId) ? settings.defaultProjectId : null;
    set({ info, clis, projects, accounts, sessions, order, mode, panes, quota, settings, activeProjectId: preferred ?? projects[0]?.id ?? null });

    unlisten.push(await listen<RuntimeView>("session-runtime", (ev) => {
      const s = get().sessions[ev.payload.id];
      if (!s) return;
      const prev = s.runtime?.status;
      get().upsertSession({
        ...s,
        runtime: ev.payload,
        status: ev.payload.status,
        model: ev.payload.model ?? s.model,
        providerSessionId: ev.payload.providerSessionId ?? s.providerSessionId,
      });
      const st = get();
      if (ev.payload.status === "rate-limited" && prev !== "rate-limited" && s.kind === "agent") {
        const acc = st.accounts.find((a) => a.id === s.accountId);
        const alt = pickFailoverAccount(s, st.accounts, st.quota, Object.values(st.sessions));
        const canMove = !!alt && !!(ev.payload.providerSessionId ?? s.providerSessionId);
        const recent = Date.now() - (failoverAt[s.id] ?? 0) < 10 * 60_000;
        if (canMove && ev.payload.autoContinue && st.settings.autoFailover === true && !recent) {
          failoverAt[s.id] = Date.now();
          const msg = typeof st.settings.autoContinueMessage === "string" && st.settings.autoContinueMessage.trim() ? st.settings.autoContinueMessage : "continue";
          st.toast(`${acc?.name ?? "Account"} hit its limit — continuing "${s.name}" on ${alt!.name}.`, "warn");
          void st.handoffSession(s.id, alt!.id, msg);
        } else {
          const when = ev.payload.autoContinue ? " It will continue automatically after the reset." : "";
          st.toast(
            `${acc?.name ?? "Account"} has reached its current limit.${when}${canMove ? ` Or continue this conversation on ${alt!.name}.` : ""}`,
            "warn",
            canMove
              ? { label: `Continue on ${alt!.name}`, run: () => void get().handoffSession(s.id, alt!.id, "continue") }
              : undefined,
          );
        }
        if (!appHasFocus()) void requestAttention();
      }
      onTaskProgress(s.id, prev, ev.payload);
      onContext(s, ev.payload);
      // "Ready / needs input" notifications: see lib/notify.ts (heads-up window).
      if (ev.payload.status !== prev && ["stopped", "failed"].includes(ev.payload.status)) {
        void get().refreshQuota();
      }
    }));
    unlisten.push(await listen<{ id: string; code: number | null; status: string }>("pty-exit", (ev) => {
      const s = get().sessions[ev.payload.id];
      if (!s) return;
      get().upsertSession({
        ...s,
        status: ev.payload.status as Session["status"],
        exitCode: ev.payload.code,
        runtime: s.runtime ? { ...s.runtime, running: false, status: ev.payload.status as Session["status"] } : s.runtime,
      });
      // A CLI that ends right after starting looks like "Start does nothing": say why.
      const started = startedAt[s.id];
      if (s.kind === "agent" && ev.payload.code !== 0 && started && Date.now() - started < 20_000) {
        void api.ptyScreen(s.id).catch(() => "").then((screen) => {
          const last = screen.split("\n").map((l) => l.trim()).filter(Boolean).slice(-3).join(" · ");
          get().toast(
            `${s.name} ended right after starting (exit ${ev.payload.code ?? "?"})${last ? `: ${last.slice(0, 220)}` : ""}`,
            "error",
            { label: "Try again", run: () => void get().startSession(s.id) },
          );
        });
      }
      if (s.kind === "login" && s.accountId) {
        void api.accountCheckAuth(s.accountId, true).catch(() => {}).then(() => get().refreshAccounts()).catch(() => {});
      } else if (s.kind !== "agent") {
        void get().refreshAccounts();
      }
    }));
    unlisten.push(await listen("accounts-changed", () => void get().refreshAccounts()));
    unlisten.push(await listen<{ id: string; activity: Activity }>("session-activity", (ev) => {
      const { id, activity } = ev.payload;
      if (activity.kind === "file" && activity.file) onFileEdit(id, activity.file, activity.ts);
      set((st) => ({
        activity: { ...st.activity, [id]: [...(st.activity[id] ?? []), activity].slice(-80) },
        filesVersion: activity.kind === "file" ? st.filesVersion + 1 : st.filesVersion,
      }));
    }));
    unlisten.push(await listen("automation-changed", () => set((st) => ({ loopsVersion: st.loopsVersion + 1 }))));
    unlisten.push(await listen<{ id: string; message: string }>("session-auto-resume", (ev) => {
      // The limit has reset but the process is gone: resume the conversation, then continue.
      const { id, message } = ev.payload;
      if (!get().sessions[id]) return;
      void (async () => {
        await get().startSession(id);
        if (get().sessions[id]?.runtime?.running) await get().queueInput(id, message);
      })();
    }));
    unlisten.push(await listen("usage-updated", () => {
      set((st) => ({ usageVersion: st.usageVersion + 1 }));
      void get().refreshQuota();
    }));
    // Poll quota occasionally (statusLine/rollout snapshots are written by the backend).
    window.setInterval(() => void get().refreshQuota(), 20_000);
    set({ ready: true });
    void get().refreshTasks();
    // Login state in the background, so the status bar is right without opening Accounts.
    void get().checkAllAccounts();
    window.setInterval(() => void get().checkAllAccounts(), 15 * 60_000);
    } catch (e) {
      for (const stop of unlisten) stop();
      initStarted = false;
      set({ ready: false, initError: errMsg(e) });
    }
  },

  setView: (v) => set({ view: v }),
  setVoice: (voice) => set({ voice }),
  setHotkeyFor: (id) => set({ hotkeyFor: id }),
  setSessionHotkey: async (id, hotkey) => {
    try {
      const saved = await api.sessionSetVoiceHotkey(id, hotkey);
      const s = get().sessions[id];
      if (s) get().upsertSession({ ...s, voiceHotkey: saved });
      return true;
    } catch (e) {
      get().toast(errMsg(e), "error");
      return false;
    }
  },

  refreshSettings: async () => {
    try {
      set({ settings: await api.settingsGet() });
    } catch {
      /* keep previous */
    }
  },
  setSetting: async (key, value) => {
    try {
      await api.settingsSet(key, value);
      set((st) => ({ settings: { ...st.settings, [key]: value } }));
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  setAutoContinue: async (id, on) => {
    try {
      await api.sessionSetAutoContinue(id, on);
      const s = get().sessions[id];
      if (s) get().upsertSession({ ...s, autoContinue: on, runtime: s.runtime ? { ...s.runtime, autoContinue: on, autoContinueAt: on ? s.runtime.autoContinueAt : null } : s.runtime });
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  queueInput: async (id, text) => {
    try {
      await api.sessionQueueInput(id, text);
      return true;
    } catch (e) {
      get().toast(`${get().sessions[id]?.name ?? "Session"}: ${errMsg(e)}`, "error");
      return false;
    }
  },
  handoffSession: async (id, accountId, message) => {
    const old = get().sessions[id];
    try {
      const s = await api.sessionHandoff(id, accountId, message);
      terms.dispose(id);
      set((st) => {
        const sessions = { ...st.sessions, [s.id]: s };
        delete sessions[id];
        const inPane = st.panes.indexOf(id);
        const panes = st.panes.map((p) => (p === id ? s.id : p));
        const order = st.order.map((x) => (x === id ? s.id : x));
        persistLayout(st.mode, panes);
        return { sessions, panes, order, pendingStart: { ...st.pendingStart, [s.id]: true }, focused: inPane >= 0 ? inPane : st.focused };
      });
      if (!get().panes.includes(s.id)) get().showSession(s.id);
      const acc = get().accounts.find((a) => a.id === accountId);
      get().toast(`"${old?.name ?? "Session"}" continues on ${acc?.name ?? "the other account"}`, "ok");
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  setTeamOpen: (open) => set({ teamOpen: open, view: open ? "workspace" : get().view }),
  setBroadcastOpen: (open) => set({ broadcastOpen: open }),
  openLoginPrivately: async (id) => {
    try {
      await api.loginOpenPrivate(id);
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  checkAllAccounts: async () => {
    const running = new Set(Object.values(get().sessions).filter((s) => s.kind === "login" && s.runtime?.running).map((s) => s.accountId));
    await Promise.all(get().accounts.filter((a) => !running.has(a.id)).map((a) => api.accountCheckAuth(a.id).catch(() => null)));
    await get().refreshAccounts().catch(() => {});
  },

  toast: (text, kind = "info", action) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text, action }] }));
    window.setTimeout(() => get().dismissToast(id), action ? 15000 : kind === "error" ? 8000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  refreshProjects: async () => set({ projects: await api.projectsList() }),
  refreshAccounts: async () => set({ accounts: await api.accountsList() }),
  refreshQuota: async () => {
    try {
      set({ quota: await api.quotaOverview() });
    } catch {
      /* ignore */
    }
  },
  refreshClis: async () => set({ clis: await api.detectClis() }),

  addProject: async (path) => {
    try {
      const p = await api.projectAdd(path);
      await get().refreshProjects();
      set({ activeProjectId: p.id });
      get().toast(`Project ${p.name} added`, "ok");
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  selectProject: (id) => {
    set({ activeProjectId: id });
    if (id) api.projectOpen(id).catch(() => {});
  },

  openNewSession: (pane = null) => set({ newSessionFor: { pane }, view: "workspace" }),
  closeNewSession: () => set({ newSessionFor: null }),

  createSession: async (input, pane = null) => {
    try {
      const s = await api.sessionCreate(input);
      get().upsertSession(s);
      set((st) => ({ order: [...st.order, s.id], pendingStart: { ...st.pendingStart, [s.id]: true } }));
      get().showSession(s.id, pane);
      return s;
    } catch (e) {
      get().toast(errMsg(e), "error");
      return null;
    }
  },

  showSession: (id, pane = null) => {
    const st = get();
    let { mode } = st;
    let panes = [...st.panes];
    const existing = panes.indexOf(id);
    if (existing >= 0) {
      set({ focused: existing, view: "workspace" });
      return;
    }
    if (mode === "tabs") {
      panes = [id];
      set({ panes, focused: 0, view: "workspace" });
      persistLayout(mode, panes);
      return;
    }
    let target = pane ?? -1;
    if (target < 0 || target >= panes.length) {
      target = panes[st.focused] == null ? st.focused : panes.indexOf(null);
    }
    if (target < 0) {
      if (SLOTS[mode] < maxPanes(st.settings)) {
        // Room for one more: grow the grid instead of pushing a session out.
        mode = modeFor(SLOTS[mode] + 1);
        panes = fitPanes(panes, mode);
        target = panes.indexOf(null);
      } else if (st.settings.whenFull === "replace") {
        target = st.focused;
      } else {
        // All panes taken: the user picks which session makes room (or keeps this one in the background).
        set({ placeFor: id, view: "workspace" });
        return;
      }
    }
    panes[target] = id;
    set({ mode, panes, focused: target, view: "workspace" });
    persistLayout(mode, panes);
  },

  placeSession: (id, pane) => {
    const st = get();
    if (!st.sessions[id]) return;
    let { mode } = st;
    let panes = [...st.panes];
    if (mode === "tabs") pane = 0;
    if (pane >= panes.length) {
      mode = modeFor(pane + 1);
      panes = fitPanes(panes, mode);
    }
    const from = panes.indexOf(id);
    if (from !== pane) {
      if (from >= 0) panes[from] = panes[pane] ?? null; // swap places
      panes[pane] = id;
    }
    set({ mode, panes, focused: pane, placeFor: null, view: "workspace" });
    persistLayout(mode, panes);
    window.setTimeout(() => terms.focus(id), 50);
  },
  addPane: (id = null) => {
    const st = get();
    const n = st.mode === "tabs" ? 1 : SLOTS[st.mode];
    if (n >= MAX_PANES) {
      st.toast(`At most ${MAX_PANES} panes — drop the session onto one of them instead`, "info");
      return;
    }
    const mode = modeFor(n + 1);
    const panes = fitPanes(st.mode === "tabs" ? [st.panes[0] ?? null] : st.panes, mode);
    const at = panes.indexOf(null);
    if (id) {
      const from = panes.indexOf(id);
      if (from >= 0) panes[from] = null;
      panes[at] = id;
    }
    set({ mode, panes, focused: at, placeFor: null, view: "workspace" });
    persistLayout(mode, panes);
  },
  removePane: (i) => {
    const st = get();
    if (st.mode === "tabs" || SLOTS[st.mode] <= 1) return;
    const panes = st.panes.filter((_, j) => j !== i);
    const mode = modeFor(panes.length);
    set({ mode, panes, focused: Math.min(st.focused, panes.length - 1) });
    persistLayout(mode, panes);
  },
  applyLayout: (mode, panes) => {
    const st = get();
    const shown = fitPanes(panes.map((p) => (p && st.sessions[p] ? p : null)), mode);
    set({ mode, panes: shown, focused: 0, zoomed: null, view: "workspace" });
    persistLayout(mode, shown);
  },
  setPlaceFor: (id) => set({ placeFor: id }),
  setDrag: (drag) => set({ drag }),

  upsertSession: (s) => set((st) => ({ sessions: { ...st.sessions, [s.id]: { ...st.sessions[s.id], ...s } } })),

  markStarted: (id) =>
    set((st) => {
      const p = { ...st.pendingStart };
      delete p[id];
      return { pendingStart: p };
    }),

  startSession: async (id) => {
    if (get().launching[id]) return;
    if (get().sessions[id]?.runtime?.running) {
      terms.focus(id);
      return;
    }
    set((s) => ({ launching: { ...s.launching, [id]: true } }));
    get().markStarted(id);
    startedAt[id] = Date.now();
    try {
      await terms.attach(id);
      terms.prepareForStart(id);
      const { cols, rows } = terms.size(id);
      const s = await api.sessionStart(id, cols, rows);
      get().upsertSession(s);
      terms.focus(id);
    } catch (e) {
      get().toast(errMsg(e), "error");
      const s = get().sessions[id];
      if (s) get().upsertSession({ ...s, status: "failed", runtime: null });
    } finally {
      set((s) => ({ launching: { ...s.launching, [id]: false } }));
    }
  },
  stopSession: async (id) => {
    delete startedAt[id]; // an exit we asked for is not a failed start
    try {
      await api.sessionStop(id);
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  restartSession: async (id) => {
    if (get().launching[id]) return;
    delete startedAt[id];
    set((s) => ({ launching: { ...s.launching, [id]: true } }));
    try {
      await terms.attach(id);
      terms.prepareForStart(id);
      const { cols, rows } = terms.size(id);
      get().upsertSession(await api.sessionRestart(id, cols, rows));
      terms.focus(id);
    } catch (e) {
      get().toast(errMsg(e), "error");
    } finally {
      set((s) => ({ launching: { ...s.launching, [id]: false } }));
    }
  },
  duplicateSession: async (id) => {
    try {
      const s = await api.sessionDuplicate(id);
      get().upsertSession(s);
      set((st) => ({ order: [...st.order, s.id], pendingStart: { ...st.pendingStart, [s.id]: true } }));
      get().showSession(s.id);
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  renameSession: async (id, name) => {
    try {
      await api.sessionRename(id, name);
      const s = get().sessions[id];
      if (s) get().upsertSession({ ...s, name });
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },
  closeSession: async (id) => {
    delete startedAt[id];
    try {
      await api.sessionClose(id);
    } catch (e) {
      get().toast(errMsg(e), "error");
      return;
    }
    terms.dispose(id);
    set((st) => {
      const sessions = { ...st.sessions };
      delete sessions[id];
      const panes = st.panes.map((p) => (p === id ? null : p));
      const order = st.order.filter((x) => x !== id);
      if (st.mode === "tabs" && panes[0] == null && order.length) panes[0] = order[order.length - 1];
      persistLayout(st.mode, panes);
      return { sessions, panes, order };
    });
  },

  openUtility: async (kind, accountId) => {
    // Utility terminals need a size before the pane exists; use a sensible default,
    // the pane resizes the PTY once mounted.
    try {
      const s = kind === "status"
        ? await api.accountStatusTerminal(accountId, 110, 30)
        : await api.accountLogin(accountId, 110, 30, kind === "login-device");
      get().upsertSession(s);
      set((st) => ({ order: [...st.order, s.id] }));
      get().showSession(s.id);
    } catch (e) {
      get().toast(errMsg(e), "error");
    }
  },

  setMode: (m) => {
    const st = get();
    let panes = st.panes;
    if (m === "tabs") {
      panes = [st.panes[st.focused] ?? st.order[st.order.length - 1] ?? null];
    } else {
      // Keep currently visible sessions, then fill with other open sessions.
      const visible = st.mode === "tabs" ? [st.panes[0]] : st.panes;
      panes = fitPanes(visible.filter(Boolean), m);
      for (const id of st.order) {
        if (panes.includes(id)) continue;
        const free = panes.indexOf(null);
        if (free < 0) break;
        panes[free] = id;
      }
    }
    set({ mode: m, panes, focused: Math.min(st.focused, panes.length - 1), zoomed: null });
    persistLayout(m, panes);
  },
  focusPane: (i) => {
    const st = get();
    if (i < 0 || i >= st.panes.length) return;
    set({ focused: i, view: "workspace" });
    const id = st.panes[i];
    if (id) window.setTimeout(() => terms.focus(id), 0);
  },
  clearPane: (i) =>
    set((st) => {
      const panes = [...st.panes];
      panes[i] = null;
      persistLayout(st.mode, panes);
      return { panes };
    }),
  setPalette: (open) => set({ paletteOpen: open }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
}));
