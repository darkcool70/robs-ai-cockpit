// When the cockpit (and the operator) speaks up — one policy for every path that can talk.
// Pure (unit tested): the callers classify what they want to say, this decides full / short / silent.
//
//  * "asked"     (default, „Nur wenn ich frage“): answers to turns you started by voice; things that
//                truly need you (an agent asks for a decision, a failure, a question waiting) as one
//                short sentence, once. Everything else stays silent text.
//  * "important" („Wichtiges auch melden“): also results of the agents (finished, reviews, crew done)
//                and „Als Nächstes“ in one short sentence, and the welcome-back briefing.
//  * "all"       („Alles vorlesen“): everything in full, as before.

export type SpeakMode = "asked" | "important" | "all";
export const SPEAK_MODES: SpeakMode[] = ["asked", "important", "all"];

/** What is about to be said. */
export type SpeechKind =
  /** the answer to a turn you started by voice (Talk, wake word, dictation) — and its follow-up rounds */
  | "answer"
  /** the answer to a turn you typed */
  | "typedAnswer"
  /** news nobody asked for: an agent finished, a review verdict, the crew is done */
  | "event"
  /** something that needs you: a decision waiting, a failure, a question, a watch you set */
  | "needsYou"
  /** „Als Nächstes: …“ said by itself */
  | "look"
  /** the welcome-back / away briefing */
  | "digest";

export type SpeechDecision = "full" | "short" | "silent";

/** The mode in the settings (`voiceSpeakWhen`); the old „every agent“ choice means „all“. */
export function speakModeOf(settings: { voiceSpeakWhen?: unknown; ttsWhen?: unknown }): SpeakMode {
  const m = settings.voiceSpeakWhen;
  if (m === "asked" || m === "important" || m === "all") return m;
  return settings.ttsWhen === "always" ? "all" : "asked";
}

const TABLE: Record<SpeakMode, Record<SpeechKind, SpeechDecision>> = {
  asked: { answer: "full", typedAnswer: "silent", event: "silent", needsYou: "short", look: "silent", digest: "silent" },
  // the welcome-back briefing is a few short sentences already: a first sentence alone would only say „Willkommen zurück.“
  important: { answer: "full", typedAnswer: "silent", event: "short", needsYou: "short", look: "short", digest: "full" },
  all: { answer: "full", typedAnswer: "full", event: "full", needsYou: "full", look: "full", digest: "full" },
};

export function speechDecision(kind: SpeechKind, mode: SpeakMode): SpeechDecision {
  return TABLE[mode][kind];
}

/** One short sentence of a spoken text (the first one, at most ~160 characters). */
export function shortSpeech(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const first = flat.match(/^.+?[.!?…](?=\s|$)/)?.[0] ?? flat;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const at = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(" – "));
  return `${(at > 40 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, "")).trim()} …`;
}

/** What to say for a kind in a mode: the text, its short form, or "" (silent). */
export function spokenText(kind: SpeechKind, mode: SpeakMode, text: string): string {
  const d = speechDecision(kind, mode);
  return d === "silent" ? "" : d === "short" ? shortSpeech(text) : text;
}

/** Who started a turn: your voice, your keyboard, or the cockpit (an event for the operator). */
export type TurnCause = "voice" | "typed" | "event" | "urgent";

const norm = (s: string) => s.replace(/^\s*🎙\s*/u, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The cause of a finished turn from the prompt that started it: "📡 Results" continues the turn
 * before it (the answer to your spoken question may need a second round), "📡 Event" is the cockpit
 * telling the operator something (urgent when it needs you), 🎙 or a text you just dictated is
 * your voice, anything else was typed.
 */
export function causeOfTurn(prompt: string | null | undefined, previous: TurnCause | null, spoken: string[], eventUrgent = false): TurnCause {
  const p = (prompt ?? "").trim();
  if (p.startsWith("📡 Results")) return previous === "urgent" || previous === "event" ? "event" : previous ?? "typed";
  if (p.startsWith("📡 Event")) return eventUrgent ? "urgent" : "event";
  if (/^🎙/u.test(p)) return "voice";
  const head = norm(p).slice(0, 40);
  if (head && spoken.some((s) => { const h = norm(s).slice(0, 40); return !!h && (head.startsWith(h) || h.startsWith(head)); })) return "voice";
  return "typed";
}

export function kindOfCause(cause: TurnCause): SpeechKind {
  return cause === "voice" ? "answer" : cause === "urgent" ? "needsYou" : cause === "event" ? "event" : "typedAnswer";
}

/** Things said once: a key remembered for a while (an agent asking the same thing again stays quiet). */
export class Once {
  private seen = new Map<string, number>();
  constructor(private keepMs = 30 * 60_000) {}
  /** true the first time (within keepMs) a key comes up. */
  first(key: string, now = Date.now()): boolean {
    for (const [k, at] of this.seen) if (now - at > this.keepMs) this.seen.delete(k);
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    return true;
  }
}

/**
 * Wake word paused? Only while the cockpit itself has the microphone or speaks — not just because a
 * conversation is open: between turns (it thinks, it waits for results) the name must still work.
 */
export function wakePaused(voiceState: string, speaking: boolean): boolean {
  return voiceState !== "idle" || speaking;
}

/**
 * After something was said in a voice conversation: open the microphone again? Only for answers to
 * what you said and for a question to you — not after news nobody asked for.
 */
export function listenAfter(kind: SpeechKind): boolean {
  return kind === "answer" || kind === "needsYou";
}
