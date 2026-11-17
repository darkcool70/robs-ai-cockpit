// Pure logic of the heads-up window (components/Hud.tsx): which notifications are visible,
// how long each kind stays, how big the native window must be. No React, no Tauri.

export type HudKind = "done" | "input" | "limit" | "loop" | "failed" | "goal";

/** At most this many cards at once; the rest collapses into "+N more". */
export const MAX_VISIBLE = 3;
/** Older notes beyond this are dropped silently (nobody reads a stack of twelve). */
export const MAX_STORED = 12;
export const CARD_WIDTH = 320;
/** Transparent margin around the cards so their shadow is not clipped by the window edge. */
export const WINDOW_PAD = 8;
export const ORB_SIZE = 36;
/** How long the leave animation runs before the note is really removed. */
export const LEAVE_MS = 180;

const INFO_SEC = 8;
const NEEDS_YOU_SEC = 30;
const MAX_SEC = 120;
/** After the pointer leaves, a note gets at least this long again (it was paused while hovered). */
export const AFTER_HOVER_MS = 4000;

/** Kinds that only inform: they fade quickly. The others wait for a decision, but never forever. */
export function needsUser(kind: HudKind): boolean {
  return kind === "input" || kind === "limit" || kind === "failed";
}

/**
 * Milliseconds until a note goes away by itself. `userSec` is the "Hide after" setting: it can
 * shorten info notes but never make them linger, and can lengthen the ones that need the user.
 */
export function autoDismissMs(kind: HudKind, userSec?: number): number {
  const u = typeof userSec === "number" && userSec > 0 ? Math.min(userSec, MAX_SEC) : undefined;
  const sec = needsUser(kind) ? Math.max(NEEDS_YOU_SEC, u ?? 0) : Math.min(INFO_SEC, u ?? INFO_SEC);
  return Math.round(sec * 1000);
}

/** Newest notes stay visible; older ones collapse into "+N more". */
export function visibleNotes<T>(notes: T[], max = MAX_VISIBLE): { visible: T[]; more: number } {
  const more = Math.max(0, notes.length - max);
  return { visible: more ? notes.slice(more) : notes, more };
}

/** A new note replaces an older one of the same session (one card per session) and caps the stack. */
export function addNote<T extends { sessionId: string }>(cur: T[], n: T): T[] {
  return [...cur.filter((x) => x.sessionId !== n.sessionId), n].slice(-MAX_STORED);
}

/** The one line under the title: the message's first non-empty line, else the subtitle. */
export function detailLine(n: { message?: string; subtitle?: string }): string {
  const first = (n.message ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return (first ?? n.subtitle ?? "").replace(/\s+/g, " ").trim();
}

/** Full text for the tooltip of a truncated card. */
export function fullText(n: { title: string; message?: string; subtitle?: string }): string {
  return [n.title, n.subtitle, n.message].filter((s) => s && s.trim()).join("\n");
}

/** Window width: cards and the voice pill share one column; the orb alone shrinks to itself. */
export function windowWidth(o: { cards: boolean; voice: boolean; orbHover?: boolean }): number {
  if (o.cards || o.voice) return CARD_WIDTH + 2 * WINDOW_PAD;
  return o.orbHover ? 270 : ORB_SIZE + 2 * WINDOW_PAD;
}

/** Window height for the measured content (0 = hide the window, so nothing invisible blocks clicks). */
export function windowHeight(contentPx: number, max = 900): number {
  if (!(contentPx > 0)) return 0;
  return Math.min(max, Math.ceil(contentPx));
}

/** Height of a stack of fixed-height cards: the window's size before the first measurement. */
export function stackHeight(count: number, more: number, cardPx = 44, gapPx = 6, moreRowPx = 18): number {
  if (count <= 0) return 0;
  const rows = count + (more > 0 || count > 1 ? 1 : 0);
  return count * cardPx + (rows - 1) * gapPx + (more > 0 || count > 1 ? moreRowPx : 0) + 2 * WINDOW_PAD;
}

/** Changes whenever the orb has something new to say (mood or number of agents waiting). */
export function orbSignature(o: { mood: string; waiting: number; total: number }): string {
  return `${o.mood}:${o.waiting}:${o.total}`;
}

export function resolveTheme(theme: unknown, systemLight: boolean): "light" | "dark" {
  return theme === "light" || (theme === "system" && systemLight) ? "light" : "dark";
}
