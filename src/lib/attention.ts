// Attention-aware timing: interruptions cost least at a breakpoint in your work (Iqbal & Bailey).
// Spoken reports that are not part of a conversation wait until you stop typing for a moment —
// in any program — and are delivered then (or after a maximum wait).
import { api } from "./api";

/** Quiet time after the last keystroke or click that counts as a breakpoint. */
export const BREAKPOINT_MS = 3000;

/** True when no key or mouse input happened for `ms` (system wide). */
export async function atBreakpoint(ms = BREAKPOINT_MS): Promise<boolean> {
  const idle = await api.userIdleMs().catch(() => Number.MAX_SAFE_INTEGER);
  return idle >= ms;
}

/** M16: the pause needed before speaking up, after a reaction (dismissed: +1 s, listened: −0.25 s), 2–10 s. */
export function nextBreakpointMs(current: number, dismissed: boolean): number {
  const cur = Number.isFinite(current) ? current : BREAKPOINT_MS;
  return Math.round(Math.min(10_000, Math.max(2_000, dismissed ? cur + 1000 : cur - 250)));
}

/**
 * Run `fn` at the next breakpoint, at the latest after `maxWaitMs`. Returns a cancel function.
 * Pure timing helper; `isFree` is injectable for tests.
 */
export function whenFree(fn: () => void, maxWaitMs = 45_000, isFree: () => Promise<boolean> = () => atBreakpoint(), pollMs = 500): () => void {
  let done = false;
  const t0 = Date.now();
  const tick = async () => {
    if (done) return;
    if (Date.now() - t0 >= maxWaitMs || (await isFree())) {
      if (done) return;
      done = true;
      fn();
      return;
    }
    window.setTimeout(() => void tick(), pollMs);
  };
  void tick();
  return () => {
    done = true;
  };
}
