// xterm.js instances live outside React: one per session, cached and re-parented when the
// pane layout changes. Output arrives through a single global `pty-output` listener and is
// de-duplicated against the backend replay snapshot via per-session sequence numbers.
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";

export const terminalTheme: ITheme = {
  background: "#0b0e12",
  foreground: "#d4dbe3",
  cursor: "#d4dbe3",
  cursorAccent: "#0b0e12",
  selectionBackground: "#2b3a52",
  black: "#1b2027",
  red: "#f07178",
  green: "#8fd694",
  yellow: "#e6c07b",
  blue: "#6ea8fe",
  magenta: "#c792ea",
  cyan: "#6fd3e8",
  white: "#c8d0da",
  brightBlack: "#5c6773",
  brightRed: "#ff8b92",
  brightGreen: "#a5e6a9",
  brightYellow: "#f2d49b",
  brightBlue: "#8dbbff",
  brightMagenta: "#d7a9f5",
  brightCyan: "#8ee2f2",
  brightWhite: "#eef2f6",
};

export const lightTerminalTheme: ITheme = {
  background: "#fbfcfd",
  foreground: "#1f2630",
  cursor: "#1f2630",
  cursorAccent: "#fbfcfd",
  selectionBackground: "#cfe0fb",
  black: "#1f2630",
  red: "#c4323c",
  green: "#1b8a4f",
  yellow: "#9a6f00",
  blue: "#2a62c9",
  magenta: "#8e44ad",
  cyan: "#137f92",
  white: "#6b7684",
  brightBlack: "#5d6875",
  brightRed: "#d9434d",
  brightGreen: "#239d5c",
  brightYellow: "#b07f00",
  brightBlue: "#3b74dd",
  brightMagenta: "#a052c4",
  brightCyan: "#1995aa",
  brightWhite: "#2b333d",
};
let light = false;

/** Switch every terminal between the dark and the light palette. */
export function setTerminalLight(on: boolean) {
  light = on;
  for (const e of entries.values()) e.term.options.theme = on ? lightTerminalTheme : terminalTheme;
}

// Font size per session (Ctrl + mouse wheel over a terminal), remembered in this profile.
const FONT_KEY = "paneFonts";
function paneFonts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FONT_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
export function zoomTerminal(id: string, delta: number | "reset") {
  const e = entries.get(id);
  if (!e) return;
  const map = paneFonts();
  const next = delta === "reset" ? fontSize : Math.max(8, Math.min(28, (e.term.options.fontSize ?? fontSize) + delta));
  if (delta === "reset") delete map[id];
  else map[id] = next;
  try {
    localStorage.setItem(FONT_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
  e.term.options.fontSize = next;
  fitNow(id);
}

interface Entry {
  id: string;
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  seq: number;
  ready: boolean;
  pending: { seq: number; data: string }[];
  observer?: ResizeObserver;
  lastSize: string;
}

const entries = new Map<string, Entry>();
let fontSize = 13;
let fontFamily = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

let globalListener: Promise<unknown> | undefined;
async function ensureGlobalListener() {
  if (globalListener) return globalListener;
  globalListener = listen<{ id: string; seq: number; data: string }>("pty-output", (ev) => {
    const e = entries.get(ev.payload.id);
    if (!e) return;
    if (!e.ready) {
      e.pending.push({ seq: ev.payload.seq, data: ev.payload.data });
      return;
    }
    if (ev.payload.seq <= e.seq) return;
    e.seq = ev.payload.seq;
    e.term.write(ev.payload.data);
  }).catch((e) => { globalListener = undefined; throw e; });
  return globalListener;
}

// Shortcuts the app handles; xterm must not swallow them.
export function isAppShortcut(ev: KeyboardEvent): boolean {
  if (ev.key === "F1" && !ev.ctrlKey && !ev.altKey) return true;
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return false;
  const k = ev.key.toLowerCase();
  if (ev.shiftKey && (k === "n" || k === "f")) return true;
  if (!ev.shiftKey && (k === "n" || k === "p" || k === "w")) return true;
  if (!ev.shiftKey && /^[0-9]$/.test(k)) return true;
  return false;
}

function create(id: string): Entry {
  const el = document.createElement("div");
  el.className = "xterm-host";
  const term = new Terminal({
    fontFamily,
    fontSize: paneFonts()[id] ?? fontSize,
    lineHeight: 1.15,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 10000,
    theme: light ? lightTerminalTheme : terminalTheme,
    macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(el);
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // DOM renderer fallback.
  }
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type === "keydown" && isAppShortcut(ev)) return false;
    // Ctrl+Shift+C / Ctrl+Shift+V copy/paste, Windows-terminal style.
    // preventDefault: otherwise the WebView also fires its native (plain-text) paste,
    // which xterm handles too, and the text lands twice.
    if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "c") {
      ev.preventDefault();
      const sel = term.getSelection();
      if (sel) void navigator.clipboard.writeText(sel);
      return false;
    }
    if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "v") {
      ev.preventDefault();
      void navigator.clipboard.readText().then((t) => t && term.paste(t));
      return false;
    }
    return true;
  });
  const entry: Entry = { id, term, fit, el, seq: 0, ready: false, pending: [], lastSize: "" };
  term.onData((d) => {
    api.ptyWrite(id, d).catch(() => {
      /* not running */
    });
  });
  term.onResize(({ cols, rows }) => {
    api.ptyResize(id, cols, rows).catch(() => {});
  });
  entries.set(id, entry);
  return entry;
}

/** Load the backend replay snapshot into a freshly created terminal. No-op once attached. */
export async function attach(id: string): Promise<void> {
  await ensureGlobalListener();
  const e = entries.get(id) ?? create(id);
  if (e.ready) return;
  const snap = await api.ptyAttach(id);
  if (e.ready) return; // a start raced us; live output is flowing already
  if (snap.seq > 0 || snap.data) {
    e.term.reset();
    e.term.write(snap.data);
  }
  e.seq = snap.seq;
  for (const p of e.pending) {
    if (p.seq > e.seq) {
      e.seq = p.seq;
      e.term.write(p.data);
    }
  }
  e.pending = [];
  e.ready = true;
}

/** Called right before a new process starts for this terminal: clear state, keep instance. */
export function prepareForStart(id: string) {
  const e = entries.get(id) ?? create(id);
  e.seq = 0;
  e.pending = [];
  e.ready = true;
  e.term.reset();
}

export function mount(id: string, host: HTMLElement): Entry {
  const e = entries.get(id) ?? create(id);
  if (e.el.parentElement !== host) host.appendChild(e.el);
  e.observer?.disconnect();
  e.observer = new ResizeObserver(() => fitNow(id));
  e.observer.observe(host);
  requestAnimationFrame(() => fitNow(id));
  return e;
}

export function unmount(id: string, host: HTMLElement) {
  const e = entries.get(id);
  if (!e) return;
  e.observer?.disconnect();
  e.observer = undefined;
  if (e.el.parentElement === host) host.removeChild(e.el);
}

export function fitNow(id: string) {
  const e = entries.get(id);
  if (!e || !e.el.isConnected || e.el.clientWidth < 20 || e.el.clientHeight < 20) return;
  try {
    e.fit.fit();
  } catch {
    /* not visible */
  }
}

export function size(id: string): { cols: number; rows: number } {
  const e = entries.get(id);
  if (!e) return { cols: 120, rows: 32 };
  fitNow(id);
  return { cols: e.term.cols, rows: e.term.rows };
}

export function focus(id: string) {
  entries.get(id)?.term.focus();
}

export function dispose(id: string) {
  const e = entries.get(id);
  if (!e) return;
  e.observer?.disconnect();
  e.term.dispose();
  e.el.remove();
  entries.delete(id);
}

export function setFont(size: number, family?: string) {
  fontSize = size;
  if (family) fontFamily = family;
  const own = paneFonts();
  for (const e of entries.values()) {
    e.term.options.fontSize = own[e.id] ?? fontSize;
    e.term.options.fontFamily = fontFamily;
    fitNow(e.id);
  }
}

/** Type text into a session (used for "/status" helpers). */
export function sendText(id: string, text: string) {
  return api.ptyWrite(id, text);
}
