// Which finished turn was asked for by voice: dictated texts are remembered per session, and a
// turn is classified once (by its prompt) when it ends — see speakPolicy for the rules.
import type { Session } from "./api";
import { voiceHooks } from "./hooks";
import { type SpeechKind, type TurnCause, Once, causeOfTurn, kindOfCause, speakModeOf, type SpeakMode } from "./speakPolicy";

const spokenTo = new Map<string, string[]>();
const causes = new Map<string, TurnCause>();
const memo = new Map<string, { at: number | null | undefined; prompt: string; kind: SpeechKind }>();

/** Something you said went to this session (dictation, Talk, wake word). */
export function noteVoiceTurn(sessionId: string, text: string) {
  const list = spokenTo.get(sessionId) ?? [];
  list.push(text);
  while (list.length > 4) list.shift();
  spokenTo.set(sessionId, list);
}

/** The kind of the turn that just ended (asked once per turn; later calls give the same answer). */
export function turnKind(s: Pick<Session, "id"> & { runtime?: { lastPrompt?: string | null; turnEndedAt?: number | null } | null }): SpeechKind {
  const prompt = s.runtime?.lastPrompt ?? "";
  const at = s.runtime?.turnEndedAt;
  const m = memo.get(s.id);
  if (m && m.at === at && m.prompt === prompt) return m.kind;
  const list = spokenTo.get(s.id) ?? [];
  const urgent = prompt.trim().startsWith("📡 Event") ? !!voiceHooks.eventUrgent?.(s.id) : false;
  const cause = causeOfTurn(prompt, causes.get(s.id) ?? null, list, urgent);
  if (cause === "voice") spokenTo.set(s.id, []); // answered: an old dictation must not mark a later typed turn
  causes.set(s.id, cause);
  const kind = kindOfCause(cause);
  memo.set(s.id, { at, prompt, kind });
  return kind;
}

/** Is the running turn of this session one you started by voice? (for words spoken while it works) */
export function runningTurnIsVoice(prompt: string | null | undefined): boolean {
  return /^\s*🎙/u.test(prompt ?? "");
}

export function speakMode(settings: Record<string, unknown>): SpeakMode {
  return speakModeOf(settings);
}

/** Needs-you messages are said once. */
export const saidOnce = new Once();
