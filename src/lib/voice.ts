// Dictation: global shortcuts (one per session + "focused pane") → record → local Whisper →
// text typed into the target session. Tap = start/stop, hold = push-to-talk.
import { register, unregister, unregisterAll, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { listen } from "@tauri-apps/api/event";
import { api, errMsg } from "./api";
import { useApp } from "../store";

// Ctrl+Alt+Space is often taken (IMEs, overlays); Alt+Shift+Space is free and clashes with no editor.
export const DEFAULT_FOCUSED_HOTKEY = "Alt+Shift+Space";
/** Modifiers for "dictate into pane N" (N = 1…8); same as the main shortcut so one hand does both. */
export const DEFAULT_PANE_MODIFIER = "Alt+Shift";
export const PANE_MODIFIERS: { value: string; label: string }[] = [
  { value: "Alt+Shift", label: "Alt + Shift + 1…8" },
  { value: "Control+Shift", label: "Ctrl + Shift + 1…8" },
  { value: "Control+Alt+Shift", label: "Ctrl + Alt + Shift + 1…8" },
  { value: "", label: "Off" },
];
export type VoiceTargetDefault = "focused" | "waiting" | "last";

/** On German (and many other) layouts Ctrl+Alt+key is AltGr+key: stealing it breaks typing. */
const ALTGR_CHARS: Record<string, string> = {
  Digit2: "²", Digit3: "³", Digit7: "{", Digit8: "[", Digit9: "]", Digit0: "}", KeyQ: "@", KeyE: "€", KeyM: "µ",
  Minus: "\\", BracketRight: "~", IntlBackslash: "|",
};
export function altGrConflict(h: string | null | undefined): string | null {
  if (!h) return null;
  const parts = h.split("+");
  if (!parts.includes("Control") || !parts.includes("Alt") || parts.includes("Shift")) return null;
  return ALTGR_CHARS[parts[parts.length - 1]] ?? null;
}
const TAP_MS = 350;

/** Keys a system-wide shortcut would take away from every program (typing, copy/paste…). */
const EDITING_KEYS = new Set(["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyY", "KeyS", "KeyF", "KeyN", "KeyT", "KeyW", "KeyP", "KeyO", "KeyR"]);

/** Why a shortcut is a bad idea, or null. Voice shortcuts work system-wide, in every program. */
export function hotkeyProblem(h: string | null | undefined): string | null {
  if (!h) return null;
  const parts = h.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const pretty = prettyHotkey(h);
  const ch = altGrConflict(h);
  if (ch) return `${pretty} is AltGr+${pretty.split(" + ").pop()} on a German keyboard ("${ch}"): you could no longer type it. Choose another.`;
  const typing = /^(Key[A-Z]|Digit\d|Minus|Equal|Bracket\w+|Semicolon|Quote|Backquote|Backslash|Comma|Period|Slash|IntlBackslash|Space)$/.test(key);
  if (typing && mods.every((m) => m === "Shift")) return `${pretty} would stop you from typing "${pretty.split(" + ").pop()}" in every program. Add Ctrl or Alt.`;
  if (mods.length === 1 && mods[0] === "Control" && EDITING_KEYS.has(key)) {
    return `${pretty} is a standard shortcut (select all, copy, paste, save…) and would stop working in every program. Try Alt + Shift + Space or Ctrl + Alt + Space.`;
  }
  return null;
}

/**
 * Notices the end of speech from the level meter (one RMS value every ~80 ms): learns the room's
 * noise floor, waits until you have spoken, then reports true after `silenceMs` of quiet.
 */
export function silenceDetector(silenceMs = 1500, frameMs = 80) {
  let frames = 0;
  let floor = Infinity;
  let spoken = 0;
  let quiet = 0;
  return (level: number): boolean => {
    frames++;
    if (frames <= 5) floor = Math.min(floor, level); // first ~0.4 s: background noise
    const threshold = Math.max(0.012, (Number.isFinite(floor) ? floor : 0) * 3);
    if (level >= threshold) {
      spoken++;
      quiet = 0;
    } else if (spoken >= 3) {
      quiet++;
    }
    return spoken >= 3 && quiet * frameMs >= silenceMs;
  };
}

export type VoiceState = "idle" | "recording" | "transcribing";
export interface Voice {
  state: VoiceState;
  target: string | null;
  level: number;
}

/** A session you can switch the dictation to while recording (number = pane number). */
export interface VoiceChoice {
  n: number;
  id: string;
  name: string;
  status: string;
}

let current = ""; // serialised shortcut → target map that is registered right now
let paused = false;
let pressedAt = 0;
let listening = false;
let lastTarget: string | null = null;
/** Session that received the last dictation (read-aloud "only for the session I talk to"). */
export function lastDictatedTarget(): string | null {
  return lastTarget;
}
let hotkeysDirty = false;

/** How Whisper tends to write spoken names and numbers. */
const WORD_VARIANTS: Record<string, string> = {
  claude: "claude|cloud|clod|klod|claud|klaud|clode",
  codex: "codex|kodex|codecs|kodecs|co-dex",
  pane: "pane|fenster|terminal|session",
  "1": "1|eins|one",
  "2": "2|zwei|two",
  "3": "3|drei|three",
  "4": "4|vier|four",
  "5": "5|fünf|fuenf|five",
  "6": "6|sechs|six",
  "7": "7|sieben|seven",
  "8": "8|acht|eight",
  a: "a|ah",
  b: "b|be|bee",
  c: "c|ce|see",
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RouteCandidate {
  id: string;
  names: string[];
}

/** Regex that matches a name as spoken at the start of the text, followed by , : ; . ! or a dash. */
function namePattern(name: string): RegExp | null {
  const words = name.toLowerCase().replace(/[#·()]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.join("").length < 2) return null;
  const body = words.map((w) => `(?:${WORD_VARIANTS[w] ?? escapeRe(w)})`).join("[\\s-]+");
  return new RegExp(`^\\s*(?:(?:an|für|fur|to|hey|ok)\\s+)?${body}\\s*[,:;.!\\u2013-]+\\s*`, "iu");
}

/**
 * "Claude B, run the tests" → send "Run the tests" to the session called "Claude B".
 * Only a name at the very start followed by punctuation counts, so sentences that merely
 * mention a name are never rerouted. Longer names win ("Claude B #2" before "Claude B").
 */
export function routeSpoken(text: string, candidates: RouteCandidate[]): { id: string; text: string } | null {
  const options = candidates
    .flatMap((c) => c.names.map((n) => ({ id: c.id, name: n })))
    .sort((a, b) => b.name.length - a.name.length);
  for (const o of options) {
    const re = namePattern(o.name);
    const m = re ? text.match(re) : null;
    if (!m) continue;
    const rest = text.slice(m[0].length).trim();
    if (!rest) return null;
    return { id: o.id, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
  }
  return null;
}

/** Name candidates for spoken routing: session names, unique account names, "pane N". */
export function routeCandidates(): RouteCandidate[] {
  const st = useApp.getState();
  const running = Object.values(st.sessions).filter((s) => s.kind === "agent" && s.runtime?.running);
  const accountCount = new Map<string, number>();
  for (const s of running) if (s.accountId) accountCount.set(s.accountId, (accountCount.get(s.accountId) ?? 0) + 1);
  return running.map((s) => {
    const names = [s.name];
    const acc = st.accounts.find((a) => a.id === s.accountId);
    if (acc && accountCount.get(acc.id) === 1) names.push(acc.name);
    const pane = st.panes.indexOf(s.id);
    if (pane >= 0) names.push(`pane ${pane + 1}`);
    return { id: s.id, names };
  });
}

export type ControlCommand =
  | { action: "stop" | "zoom" | "focus"; pane: number }
  | { action: "view"; view: "overview" | "tasks" | "workspace" | "review" }
  | { action: "continue-all" }
  | { action: "show-all" };

const NUMBER_WORDS: Record<string, number> = {
  eins: 1, ein: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4,
  "fünf": 5, fuenf: 5, five: 5, sechs: 6, six: 6, sieben: 7, seven: 7, acht: 8, eight: 8,
};
function paneNumber(w: string): number | null {
  const n = /^[1-8]$/.test(w) ? Number(w) : NUMBER_WORDS[w];
  return n ?? null;
}

/**
 * Short spoken commands that steer the cockpit instead of being typed: "Fenster 3 stopp",
 * "Fenster zwei groß", "zeig Fenster 4", "zeig die Übersicht", "alle weiter", "alle Fenster".
 * Only whole, short utterances count — a sentence that merely contains the words is typed.
 */
export function parseControl(text: string): ControlCommand | null {
  const t = text.toLowerCase().replace(/[.,!?;:]+/g, " ").replace(/\bbitte\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 5) return null;
  const pane = "(?:fenster|pane|session|terminal)";
  const num = "([1-8]|eins|ein|one|zwei|two|drei|three|vier|four|fünf|fuenf|five|sechs|six|sieben|seven|acht|eight)";
  let m = t.match(new RegExp(`^${pane} ${num} (stopp|stop|stoppen|anhalten|beenden)$`));
  if (m) return { action: "stop", pane: paneNumber(m[1])! };
  m = t.match(new RegExp(`^${pane} ${num} (groß|gross|maximieren|maximiert|fokus|zoom|vollbild)$`));
  if (m) return { action: "zoom", pane: paneNumber(m[1])! };
  m = t.match(new RegExp(`^(?:zeig|zeige|öffne|oeffne|show|open|gehe zu|go to) ${pane} ${num}$`));
  if (m) return { action: "focus", pane: paneNumber(m[1])! };
  if (/^(?:zeig|zeige|öffne|oeffne|show|open) (?:die |the )?(?:übersicht|uebersicht|overview)$/.test(t)) return { action: "view", view: "overview" };
  if (/^(?:zeig|zeige|öffne|oeffne|show|open) (?:die |the )?(?:aufgaben|tasks|task board)$/.test(t)) return { action: "view", view: "tasks" };
  if (/^(?:zeig|zeige|öffne|oeffne|show|open) (?:das |den |the )?(?:review|änderungen|aenderungen|changes)$/.test(t)) return { action: "view", view: "review" };
  if (/^(?:alle|all|everyone) (?:weiter|weitermachen|fortsetzen|continue)$/.test(t)) return { action: "continue-all" };
  if (/^(?:alle fenster|alle zeigen|alle anzeigen|show all|all panes)$/.test(t)) return { action: "show-all" };
  return null;
}

/** Carry out a spoken control command; returns a short confirmation. */
export async function runControl(cmd: ControlCommand): Promise<string> {
  const st = useApp.getState();
  const idAt = (n: number) => voiceChoices().find((c) => c.n === n)?.id ?? null;
  switch (cmd.action) {
    case "stop": {
      const id = idAt(cmd.pane);
      if (!id) return `Pane ${cmd.pane} is empty`;
      await st.stopSession(id);
      return `Stopped ${st.sessions[id]?.name ?? `pane ${cmd.pane}`}`;
    }
    case "zoom":
      if (!st.panes[cmd.pane - 1]) return `Pane ${cmd.pane} is empty`;
      st.setZoom(cmd.pane - 1);
      return `Pane ${cmd.pane} in focus`;
    case "focus":
      st.focusPane(cmd.pane - 1);
      return `Pane ${cmd.pane}`;
    case "view":
      st.setView(cmd.view);
      return cmd.view;
    case "show-all":
      st.setZoom(null);
      return "All panes";
    case "continue-all": {
      const msg = typeof st.settings.autoContinueMessage === "string" && st.settings.autoContinueMessage.trim() ? st.settings.autoContinueMessage : "weiter";
      const waiting = Object.values(st.sessions).filter((s) => s.kind === "agent" && s.runtime?.running && s.runtime.status === "waiting-for-input");
      for (const s of waiting) await st.queueInput(s.id, msg);
      return waiting.length ? `"${msg}" → ${waiting.map((s) => s.name).join(", ")}` : "No agent is waiting";
    }
  }
}

let audioCtx: AudioContext | null = null;
/** Short tone: rising when recording starts, falling when it stops. */
export function cue(kind: "start" | "stop" | "error" | "switch") {
  if (useApp.getState().settings.voiceSounds === false) return;
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const t = ctx.currentTime;
    const freqs = kind === "start" ? [520, 780] : kind === "stop" ? [700, 470] : kind === "switch" ? [880] : [300, 300];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.07 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.15);
    });
  } catch {
    /* no audio device */
  }
}

/** "Control+Alt+Digit1" → "Ctrl + Alt + 1" */
export function prettyHotkey(h: string | null | undefined): string {
  if (!h) return "";
  return h
    .split("+")
    .map((p) =>
      p === "Control" ? "Ctrl" : p === "Super" ? "Win" : p.replace(/^Digit/, "").replace(/^Key/, "").replace(/^Numpad/, "Num "),
    )
    .join(" + ");
}

/** Accelerator from a keydown, or null while only modifiers are held. */
export function hotkeyFromEvent(e: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code">): string | null {
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(e.code) || !e.code) return null;
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  const fkey = /^F\d{1,2}$/.test(e.code);
  if (!mods.length && !fkey) return null;
  return [...mods, e.code].join("+");
}

function desired(): Map<string, string> {
  const st = useApp.getState();
  const map = new Map<string, string>();
  if (st.settings.voiceEnabled === false) return map;
  const focused = typeof st.settings.voiceHotkeyFocused === "string" ? st.settings.voiceHotkeyFocused : DEFAULT_FOCUSED_HOTKEY;
  if (focused) map.set(focused, "focused");
  const mod = paneModifier(st.settings);
  if (mod) for (let n = 1; n <= 8; n++) map.set(`${mod}+Digit${n}`, `pane:${n}`);
  for (const id of st.order) {
    const s = st.sessions[id];
    if (s?.voiceHotkey && !map.has(s.voiceHotkey)) map.set(s.voiceHotkey, id);
  }
  return map;
}

/** Register exactly the shortcuts that are configured. Cheap when nothing changed. */
export async function syncHotkeys(force = false) {
  if (paused) return;
  // Re-registering while a shortcut is held would lose its "released" event (push-to-talk).
  if (useApp.getState().voice.state !== "idle") {
    hotkeysDirty = true;
    return;
  }
  hotkeysDirty = false;
  const want = desired();
  const key = JSON.stringify([...want.entries()].sort());
  if (key === current && !force) return;
  current = key;
  try {
    await unregisterAll();
  } catch {
    /* plugin unavailable (tests) */
    return;
  }
  const failed: string[] = [];
  for (const [shortcut, target] of want) {
    try {
      await register(shortcut, (ev: ShortcutEvent) => void onShortcut(target, ev));
    } catch {
      failed.push(prettyHotkey(shortcut));
    }
  }
  if (failed.length) {
    useApp.getState().toast(`Shortcut not available (used by another program?): ${failed.join(", ")}`, "warn");
  }
}

/** While a hotkey is being recorded in a dialog, the old ones must not fire. */
export async function pauseHotkeys() {
  paused = true;
  current = "";
  try {
    await unregisterAll();
  } catch {
    /* ignore */
  }
}
export async function resumeHotkeys() {
  paused = false;
  await syncHotkeys(true);
}

export function paneModifier(settings: Record<string, unknown>): string {
  return typeof settings.voicePaneModifier === "string" ? settings.voicePaneModifier : DEFAULT_PANE_MODIFIER;
}

/** Sessions numbered like the panes (tabs layout: running agents in order). */
export function voiceChoices(): VoiceChoice[] {
  const st = useApp.getState();
  const ids: (string | null)[] = st.mode === "tabs"
    ? st.order.filter((id) => st.sessions[id]?.kind === "agent" && st.sessions[id]?.runtime?.running)
    : st.panes;
  const out: VoiceChoice[] = [];
  ids.forEach((id, i) => {
    const s = id ? st.sessions[id] : undefined;
    if (s && i < 8) out.push({ n: i + 1, id: s.id, name: s.name, status: s.runtime?.status ?? s.status });
  });
  return out;
}

/** Dictation into a text field of the cockpit (task, chat, search…) instead of a terminal. */
export const FIELD_TARGET = "field";
let field: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;

/** A text field the user is typing in (not the terminal's hidden input). */
export function editableField(el: Element | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!el) return null;
  if (el instanceof HTMLTextAreaElement) return el.classList.contains("xterm-helper-textarea") || el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) return ["text", "search", "url", "email", ""].includes(el.type) && !el.readOnly && !el.disabled ? el : null;
  return el instanceof HTMLElement && el.isContentEditable ? el : null;
}

/** Type text into the field at the cursor, the way React sees it (undo works too). */
function typeIntoField(el: HTMLElement, text: string): boolean {
  el.focus();
  const before = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent;
  const sep = before && !/\s$/.test(before) ? " " : "";
  if (document.execCommand("insertText", false, sep + text)) return true;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, el.value + sep + text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  return false;
}

function resolveTarget(target: string): string | null {
  const st = useApp.getState();
  // Main shortcut while you are typing in a field of the cockpit: dictate into that field.
  if (target === "focused" && document.hasFocus()) {
    const el = editableField(document.activeElement);
    if (el) {
      field = el;
      return FIELD_TARGET;
    }
  }
  if (target.startsWith("pane:")) {
    const n = Number(target.slice(5));
    return voiceChoices().find((c) => c.n === n)?.id ?? null;
  }
  if (target !== "focused") return st.sessions[target] ? target : null;
  const fallback = st.panes[st.focused] ?? voiceChoices()[0]?.id ?? null;
  const pref = st.settings.voiceTargetDefault as VoiceTargetDefault | undefined;
  if (pref === "last" && lastTarget && st.sessions[lastTarget]?.runtime?.running) return lastTarget;
  if (pref === "waiting") {
    // The agent that finished most recently is usually the one you want to answer.
    const waiting = Object.values(st.sessions)
      .filter((s) => s.kind === "agent" && s.runtime?.running && s.runtime.status === "waiting-for-input")
      .sort((a, b) => (b.runtime?.turnEndedAt ?? 0) - (a.runtime?.turnEndedAt ?? 0));
    if (waiting[0]) return waiting[0].id;
  }
  return fallback;
}

/** While recording: switch the target to pane `n`. */
export function retarget(n: number) {
  const st = useApp.getState();
  if (st.voice.state !== "recording") return;
  const c = voiceChoices().find((x) => x.n === n);
  if (!c || c.id === st.voice.target) return;
  st.setVoice({ ...st.voice, target: c.id });
  cue("switch");
}

/** While recording: next / previous session (arrow keys). */
export function cycleTarget(dir: 1 | -1) {
  const st = useApp.getState();
  if (st.voice.state !== "recording") return;
  const list = voiceChoices();
  if (list.length < 2) return;
  const i = list.findIndex((c) => c.id === st.voice.target);
  const next = list[(i + dir + list.length) % list.length];
  st.setVoice({ ...st.voice, target: next.id });
  cue("switch");
}

// Keys that exist only while recording: 1–8 / arrows switch the target, Enter sends, Esc cancels.
let pickerKeys: string[] = [];
let pickerGen = 0;
let pickerArming: Promise<void> = Promise.resolve();

export function pickerBindings(settings: Record<string, unknown>): [string, () => void][] {
  const main = typeof settings.voiceHotkeyFocused === "string" ? settings.voiceHotkeyFocused : DEFAULT_FOCUSED_HOTKEY;
  const mainMods = main ? main.split("+").slice(0, -1).join("+") : "";
  const paneMod = paneModifier(settings);
  const out: [string, () => void][] = [];
  // Bare keys (tap mode) and, for push-to-talk, the same keys with the held modifiers.
  const prefixes = ["", ...(mainMods ? [`${mainMods}+`] : [])];
  for (const pre of prefixes) {
    if (!(pre && mainMods === paneMod)) {
      // (with the pane modifier these digits are the pane shortcuts already)
      for (let n = 1; n <= 8; n++) out.push([`${pre}Digit${n}`, () => retarget(n)]);
    }
    if (!pre) for (let n = 1; n <= 8; n++) out.push([`Numpad${n}`, () => retarget(n)]);
    out.push([`${pre}ArrowRight`, () => cycleTarget(1)]);
    out.push([`${pre}ArrowLeft`, () => cycleTarget(-1)]);
  }
  out.push(["Enter", () => void stopDictation(true)]);
  out.push(["Escape", () => void cancelDictation()]);
  return out;
}

function armPicker() {
  const settings = useApp.getState().settings;
  if (settings.voicePickWhileRecording === false) return;
  const gen = ++pickerGen;
  pickerArming = (async () => {
    for (const [key, run] of pickerBindings(settings)) {
      if (gen !== pickerGen) return;
      try {
        await register(key, (ev: ShortcutEvent) => { if (ev.state === "Pressed") run(); });
      } catch {
        continue; // taken by another program: that key just doesn't switch
      }
      if (gen !== pickerGen) {
        await unregister(key).catch(() => {});
        return;
      }
      pickerKeys.push(key);
    }
  })();
}

async function disarmPicker() {
  pickerGen++;
  await pickerArming.catch(() => {});
  const keys = pickerKeys;
  pickerKeys = [];
  if (keys.length) await unregister(keys).catch(() => {});
}

async function onShortcut(target: string, ev: ShortcutEvent) {
  const v = useApp.getState().voice;
  // A pane shortcut while recording switches the target instead of stopping.
  if (target.startsWith("pane:") && v.state === "recording") {
    if (ev.state === "Pressed") retarget(Number(target.slice(5)));
    return;
  }
  if (ev.state === "Pressed") {
    if (v.state === "recording") {
      // Second press after a tap: stop.
      if (Date.now() - pressedAt > TAP_MS) await stopDictation();
      return;
    }
    if (v.state === "transcribing") return;
    pressedAt = Date.now();
    const id = resolveTarget(target);
    if (!id) {
      useApp.getState().toast(
        target === "focused" ? "No session in the focused pane" : target.startsWith("pane:") ? `Pane ${target.slice(5)} is empty` : "That session is closed",
        "warn",
      );
      return;
    }
    await startDictation(id);
  } else if (ev.state === "Released") {
    // Held longer than a tap: push-to-talk, release sends.
    if (v.state === "recording" && Date.now() - pressedAt > TAP_MS) await stopDictation();
  }
}

let endOfSpeech: ((level: number) => boolean) | null = null;

export async function startDictation(id: string) {
  const st = useApp.getState();
  if (st.voice.state !== "idle") return;
  const silence = Number(st.settings.voiceSilenceMs ?? 1500);
  const talking = st.talkSession === id; // a conversation always ends a turn on silence
  endOfSpeech = st.settings.voiceStopOnSilence === false && !talking ? null : silenceDetector(silence > 0 ? silence : 1500);
  st.setVoice({ state: "recording", target: id, level: 0 });
  try {
    await api.sttStart(id);
    cue("start");
    armPicker();
  } catch (e) {
    cue("error");
    st.setVoice({ state: "idle", target: null, level: 0 });
    const msg = errMsg(e);
    st.toast(msg, "error", /not installed/i.test(msg) ? { label: "Open voice settings", run: () => useApp.getState().setView("settings") } : undefined);
  }
}

export async function toggleDictation(id: string) {
  const v = useApp.getState().voice;
  if (v.state === "recording") await stopDictation();
  else if (v.state === "idle") {
    pressedAt = 0;
    await startDictation(id);
  }
}

export async function cancelDictation() {
  const st = useApp.getState();
  if (st.voice.state !== "recording") return;
  await api.sttCancel().catch(() => {});
  st.setVoice({ state: "idle", target: null, level: 0 });
  if (st.talkSession) useApp.setState({ talkSession: null }); // Esc ends a voice conversation
  await disarmPicker();
  if (hotkeysDirty) void syncHotkeys();
}

let transcription = 0; // id of the transcription in progress; Esc sets `discarded` to it
let discarded = -1;

/** Esc while transcribing: drop the result, nothing is typed. */
export function discardTranscription() {
  const st = useApp.getState();
  if (st.voice.state !== "transcribing") return;
  discarded = transcription;
  st.setVoice({ state: "idle", target: null, level: 0 });
  if (st.talkSession) useApp.setState({ talkSession: null });
  st.toast("🎤 Dictation discarded", "info");
  void unregister("Escape").catch(() => {});
  if (hotkeysDirty) void syncHotkeys();
}

/** `send`: press Enter afterwards (Enter pressed while recording). */
export async function stopDictation(send = false) {
  const st = useApp.getState();
  if (st.voice.state !== "recording") return;
  const job = ++transcription;
  // The target may have been switched while recording (1–8 / arrows).
  const chosen = st.voice.target;
  st.setVoice({ ...st.voice, state: "transcribing", level: 0 });
  cue("stop");
  // Esc stays armed while Whisper works, so you can still take it back (also from other programs).
  await disarmPicker();
  await register("Escape", (ev: ShortcutEvent) => { if (ev.state === "Pressed") discardTranscription(); }).catch(() => {});
  try {
    const r = await api.sttStop();
    if (discarded === job) return;
    if (chosen === FIELD_TARGET) {
      const el = field;
      field = null;
      if (!r.text) useApp.getState().toast("Didn't catch that — nothing was typed", "info");
      else if (!el || !el.isConnected || !typeIntoField(el, r.text)) {
        await navigator.clipboard?.writeText(r.text).catch(() => {});
        useApp.getState().toast("The text field is gone — text copied to the clipboard", "warn");
      }
      return;
    }
    const target = chosen && useApp.getState().sessions[chosen] ? chosen : r.target;
    const control = r.text && useApp.getState().settings.voiceCommands !== false ? parseControl(r.text) : null;
    if (control) {
      const done = await runControl(control);
      useApp.getState().toast(`🎤 Command: ${done}`, "ok");
      return;
    }
    const routed = r.text ? routeSpoken(r.text, routeCandidates()) : null;
    if (routed && routed.id !== target) {
      await deliver(routed.id, routed.text, r.send || send);
    } else {
      await deliver(target, routed?.text ?? r.text, r.send || send);
    }
  } catch (e) {
    useApp.getState().toast(`Dictation failed: ${errMsg(e)}`, "error");
  } finally {
    await unregister("Escape").catch(() => {});
    if (discarded !== job) {
      useApp.getState().setVoice({ state: "idle", target: null, level: 0 });
      if (hotkeysDirty) void syncHotkeys();
    }
  }
}

/** Type the text into the session; Enter if said ("…, absenden") or auto-send is on. */
export async function deliver(id: string, text: string, send: boolean) {
  const st = useApp.getState();
  const s = st.sessions[id];
  if (!text) {
    st.toast("Didn't catch that — nothing was typed", "info");
    return;
  }
  if (s) lastTarget = id;
  if (!s?.runtime?.running) {
    await navigator.clipboard?.writeText(text).catch(() => {});
    st.toast(`"${s?.name ?? "Session"}" is not running — text copied to the clipboard`, "warn");
    return;
  }
  // In a voice conversation the message goes out at once, marked as spoken (short spoken answers).
  const talking = st.talkSession === id;
  await api.ptyWrite(id, talking ? `🎙 ${text}` : text);
  if (send || talking || st.settings.voiceAutoSend === true) {
    await new Promise((r) => setTimeout(r, 150));
    await api.ptyWrite(id, "\r");
  }
  st.toast(`🎤 ${s.name}: ${text.length > 90 ? text.slice(0, 90) + "…" : text}${send || st.settings.voiceAutoSend === true ? " ⏎" : ""}`, "ok");
}

/** Wire events once: level meter, Esc to cancel, keep shortcuts in sync with sessions/settings. */
export async function initVoice() {
  if (listening) return;
  listening = true;
  await listen<{ level: number }>("stt-level", (ev) => {
    const v = useApp.getState().voice;
    if (v.state !== "recording") return;
    useApp.getState().setVoice({ ...v, level: ev.payload.level });
    // Finished speaking: stop by itself (and send, if "Press Enter after every dictation" is on).
    if (endOfSpeech?.(ev.payload.level)) {
      endOfSpeech = null;
      void stopDictation();
    }
  });
  window.addEventListener("keydown", (e) => {
    const state = useApp.getState().voice.state;
    if (e.key === "Escape" && state === "recording") {
      e.preventDefault();
      void cancelDictation();
    } else if (e.key === "Escape" && state === "transcribing") {
      e.preventDefault();
      discardTranscription();
    }
  }, true);
  useApp.subscribe((st, prev) => {
    if (st.settings !== prev.settings || st.order !== prev.order || st.sessions !== prev.sessions) void syncHotkeys();
  });
  await syncHotkeys(true);
  // Load the model in the background when voice is set up, so the first command is quick.
  const status = await api.sttStatus().catch(() => null);
  const model = (useApp.getState().settings.voiceModel as string) || "small";
  if (status?.serverInstalled && status.models.find((m) => m.id === model)?.installed && useApp.getState().settings.voiceEnabled !== false) {
    void api.sttWarmup().catch(() => {});
  }
}
