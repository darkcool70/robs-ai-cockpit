// Which notifications are new (pure; unit tested in notifyDedup.test.ts). A status that flips back
// and forth inside one turn, or a transcript re-read after a start / resume / handoff, must not
// bring the same or an old answer up again.

export interface SentNote {
  /** normalised message */
  message: string;
  /** when it was shown (epoch ms) */
  at: number;
  /** end of the turn it belonged to (epoch ms), when known */
  turn: number | null;
}

/** Keyed by `${sessionId}:${kind}`. */
export type SentLog = Record<string, SentNote>;

/** A turn that ended longer ago than this is a replay (resume, restart, re-read), not news. */
export const STALE_TURN_MS = 5 * 60_000;
/** The same text for the same session and kind is not shown again within this time. */
export const REPEAT_MS = 30 * 60_000;
/** Anything for the same session and kind right after the previous one is a burst. */
const BURST_MS = 4000;

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * True when this notification is new. `turnEndedAt` identifies the turn of a "done" note: one
 * note per turn, and none for a turn that ended long ago. Records the note in `log` when true.
 */
export function shouldNotify(log: SentLog, key: string, message: string, turnEndedAt: number | null | undefined, now = Date.now()): boolean {
  const turn = turnEndedAt ?? null;
  if (turn != null && now - turn > STALE_TURN_MS) return false;
  const msg = norm(message);
  const prev = log[key];
  if (prev) {
    if (now - prev.at < BURST_MS) return false;
    if (turn != null && prev.turn === turn) return false;
    if (msg && prev.message === msg && now - prev.at < REPEAT_MS) return false;
  }
  log[key] = { message: msg, at: now, turn };
  return true;
}
