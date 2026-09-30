// Decides when an agent deserves your attention and sends it to the heads-up window
// (bottom-right, always on top). Also handles the actions clicked there.
import { emitTo, listen } from "@tauri-apps/api/event";
import { api, type HudNote, type Session } from "./api";
import { useApp } from "../store";
import { toggleDictation, voiceChoices } from "./voice";
import { duration } from "./format";

const lastStatus: Record<string, string | undefined> = {};
const lastNotice: Record<string, string | null | undefined> = {};
const lastLoopState: Record<string, string | undefined> = {};
const lastSent: Record<string, number> = {};
let started = false;
/** Last decisions, for diagnostics (window.__notifyLog in DevTools). */
const log: string[] = [];
function trace(msg: string) {
  log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (log.length > 50) log.shift();
  (window as unknown as { __notifyLog: string[] }).__notifyLog = log;
}

function hasFocus(): boolean {
  try {
    return document.hasFocus() && !document.hidden;
  } catch {
    return true;
  }
}

/** Popup only when it adds something: app in the background, or the session is off-screen. */
export function shouldPopup(s: Pick<Session, "id">, st: { settings: Record<string, unknown>; panes: (string | null)[]; view: string }, focused: boolean): boolean {
  if (st.settings.notifyPopup === false) return false;
  if (st.settings.notifyWhen === "always") return true;
  const visible = focused && st.view === "workspace" && st.panes.includes(s.id);
  return !visible;
}

function subtitleOf(s: Session): string {
  const st = useApp.getState();
  const acc = st.accounts.find((a) => a.id === s.accountId)?.name;
  const proj = st.projects.find((p) => p.id === s.projectId)?.name;
  const rt = s.runtime;
  const took = rt?.turnStartedAt && rt?.turnEndedAt && rt.turnEndedAt > rt.turnStartedAt ? duration(rt.turnEndedAt - rt.turnStartedAt) : null;
  const files = rt?.turnFiles ? `${rt.turnFiles} file${rt.turnFiles === 1 ? "" : "s"} changed` : null;
  return [acc, proj, took && `took ${took}`, files].filter(Boolean).join(" · ");
}

async function send(s: Session, kind: HudNote["kind"], message: string) {
  const st = useApp.getState();
  const key = `${s.id}:${kind}`;
  if (Date.now() - (lastSent[key] ?? 0) < 4000) return;
  lastSent[key] = Date.now();
  const note: HudNote = {
    id: `${key}:${Date.now()}`,
    sessionId: s.id,
    kind,
    title: s.name,
    subtitle: subtitleOf(s),
    message,
    provider: s.provider,
    at: Date.now(),
  };
  const focused = hasFocus();
  trace(`${kind} ${s.name} focused=${focused} popup=${shouldPopup(s, st, focused)}`);
  pushEvent(s, kind, message);
  if (shouldPopup(s, st, focused)) {
    const timeout = typeof st.settings.notifyTimeoutSec === "number" ? st.settings.notifyTimeoutSec : 20;
    await emitTo("hud", "hud-notify", { ...note, sound: st.settings.notifySound !== false, timeoutSec: timeout }).catch((e) => trace(`emit failed: ${String(e)}`));
    if (!focused) void requestAttention();
  } else if (st.settings.notifyPopup === false && st.settings.notifyOnWaiting !== false && !(st.panes.includes(s.id) && st.view === "workspace")) {
    st.toast(`${s.name}: ${label(kind)}`, "info", { label: "Show", run: () => useApp.getState().showSession(s.id) });
  }
}

// ---------------------------------------------------------------------------
// Phone push (ntfy or similar): agent waits longer than N minutes, limit reached, failure.
// ---------------------------------------------------------------------------

const pushedTurn: Record<string, number> = {};

function pushUrl(): string | null {
  const u = useApp.getState().settings.pushUrl;
  return typeof u === "string" && u.trim().startsWith("https://") ? u.trim() : null;
}

export async function pushNow(title: string, message: string, priority?: string) {
  const url = pushUrl();
  if (!url) return;
  await api.pushSend(url, title, message.slice(0, 1500), priority).catch((e) => trace(`push failed: ${String(e)}`));
}

function pushEvent(s: Session, kind: HudNote["kind"], message: string) {
  const st = useApp.getState();
  if (kind === "limit" && st.settings.pushOnLimit !== false) void pushNow(`${s.name}: usage limit`, message, "high");
  if (kind === "failed" && st.settings.pushOnFailed !== false) void pushNow(`${s.name}: ended with an error`, message || "Session failed", "high");
}

/** Agents that have been waiting for you for a while — only when you are not at the cockpit. */
function checkWaitingForPush() {
  const st = useApp.getState();
  const after = Number(st.settings.pushAfterMin ?? 5);
  if (!pushUrl() || !after || hasFocus()) return;
  for (const s of Object.values(st.sessions)) {
    const rt = s.runtime;
    if (s.kind !== "agent" || !rt?.running || rt.status !== "waiting-for-input" || !rt.turnEndedAt) continue;
    if (Date.now() - rt.turnEndedAt < after * 60_000 || pushedTurn[s.id] === rt.turnEndedAt) continue;
    pushedTurn[s.id] = rt.turnEndedAt;
    void pushNow(`${s.name} is waiting for you (${Math.round((Date.now() - rt.turnEndedAt) / 60_000)} min)`, rt.notice ?? rt.lastMessage ?? "Ready for the next command");
  }
}

export function label(kind: HudNote["kind"]): string {
  return {
    done: "ready for your next command",
    input: "needs your input",
    limit: "usage limit reached",
    loop: "loop finished",
    failed: "ended with an error",
  }[kind];
}

async function requestAttention() {
  try {
    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
  } catch {
    /* not in Tauri */
  }
}

function onSessions() {
  const st = useApp.getState();
  for (const s of Object.values(st.sessions)) {
    if (s.kind !== "agent") continue;
    const rt = s.runtime;
    const cur = rt?.status ?? s.status;
    const before = lastStatus[s.id];
    lastStatus[s.id] = cur;
    if (before !== cur) trace(`${s.name}: ${before} -> ${cur}`);
    if (before === undefined) {
      lastNotice[s.id] = rt?.notice;
      lastLoopState[s.id] = rt?.automation?.state;
      continue;
    }
    if (before === "working" && cur === "waiting-for-input") {
      void send(s, rt?.notice ? "input" : "done", rt?.notice ?? rt?.lastMessage ?? "");
    } else if (cur === "rate-limited" && before !== "rate-limited") {
      const when = rt?.autoContinueAt ? ` Continues automatically.` : "";
      void send(s, "limit", `${rt?.attention ?? "Usage limit reached."}${when}`);
    } else if (cur === "failed" && ["working", "waiting-for-input", "idle", "starting"].includes(before)) {
      void send(s, "failed", s.exitCode != null ? `Exit code ${s.exitCode}` : "");
    }
    if (rt?.notice && rt.notice !== lastNotice[s.id] && cur !== "working") {
      void send(s, "input", rt.notice);
    }
    lastNotice[s.id] = rt?.notice;
    const loopState = rt?.automation?.state;
    if (loopState === "done" && lastLoopState[s.id] === "running") {
      void send(s, "loop", `${rt?.automation?.name}: ${rt?.automation?.note ?? "finished"}`);
    }
    lastLoopState[s.id] = loopState;
  }
}

export async function initNotify() {
  if (started) return;
  started = true;
  trace("init");
  await listen<{ action: "show" | "reply" | "dictate"; sessionId: string; text?: string }>("hud-action", async (ev) => {
    const { action, sessionId, text } = ev.payload;
    const st = useApp.getState();
    if (action === "show") {
      await api.focusMain().catch(() => {});
      st.showSession(sessionId);
    } else if (action === "reply" && text?.trim()) {
      if (await st.queueInput(sessionId, text)) {
        await emitTo("hud", "hud-sent", { sessionId }).catch(() => {});
      }
    } else if (action === "dictate") {
      await toggleDictation(sessionId);
    }
  });
  useApp.subscribe((st, prev) => {
    if (st.sessions !== prev.sessions) onSessions();
    if (st.voice !== prev.voice) {
      const name = st.voice.target ? st.sessions[st.voice.target]?.name : null;
      const picking = st.voice.state === "recording" && st.settings.voicePickWhileRecording !== false;
      const choices = picking ? voiceChoices().map((c) => ({ n: c.n, name: c.name, active: c.id === st.voice.target })) : [];
      void emitTo("hud", "hud-voice", { state: st.voice.state, name, level: st.voice.level, show: !hasFocus(), choices }).catch(() => {});
    }
  });
  onSessions();
  window.setInterval(checkWaitingForPush, 30_000);
}
