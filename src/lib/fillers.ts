// The acknowledgement stays neutral ("Okay.", "Gute Frage.") — the agent's own first sentence
// ("Ich schau kurz im Netz nach.") follows a few seconds later and says what it does.
//
// Fillers: what a person says while thinking — "Okay.", "Moment.", "Hm, ich schau kurz." — so a
// spoken conversation never falls silent while the agent works. The first one comes the moment the
// message goes out; when the answer takes longer, more follow ("Ich bin noch dran."), further apart
// each time, never the same twice in a row, worded for what you asked (a question or a task), for how
// long this agent usually takes, and in the language of the voice that speaks them.
//
// Only sounds the neural voices really pronounce are used: Piper says "Hm" and "Öhm" as sounds
// (həm, øːm) but spells out "Hmm", "Mhm" and "Mmh" letter by letter, and its "Ähm" comes out as
// "Im" (checked phoneme by phoneme and by listening back with Whisper).
import { useApp } from "../store";
import { turnJustEnded } from "./workflow";
import { activityLines, nextProgressLine, progressGap, siteName } from "./progress";

export type FillerLang = "de" | "en";
export type FillerKind = "question" | "task";

const POOLS = {
  de: {
    quick: ["Okay.", "Alles klar.", "Hm, okay.", "Gut.", "Moment.", "Ja, Moment."],
    question: ["Moment.", "Gute Frage.", "Okay, Moment.", "Öhm, Moment.", "Sekunde.", "Hm, okay."],
    task: ["Mach ich.", "Bin dran.", "Alles klar.", "Okay, mach ich.", "Gut, ich kümmere mich drum.", "Verstanden."],
    long: ["Okay, ich schau mir das an, einen Moment.", "Alles klar, das dauert einen kleinen Augenblick.", "Gut, ich bin dran, das braucht kurz.", "Okay, lass mich das in Ruhe anschauen."],
    wait1: ["Moment.", "Ich schau kurz.", "Hm, einen Augenblick.", "Sekunde.", "Ich bin dran.", "Öhm, gleich."],
    wait2: ["Dauert noch einen kleinen Moment.", "Ich bin noch dran.", "Gleich hab ich's.", "Einen Augenblick noch.", "Hm, fast."],
    wait3: ["Das ist etwas mehr, ich bin gleich so weit.", "Noch einen Augenblick, ich sortiere noch.", "Ich bin noch dran, gleich.", "Öhm, dauert ein bisschen, aber gleich."],
    prefix: ["Hm, ", "Öhm, ", "So, "],
  },
  en: {
    quick: ["Okay.", "Sure.", "Right.", "Hm, okay.", "One sec.", "Alright."],
    question: ["One moment.", "Good question.", "Okay, one sec.", "Um, one moment.", "Hm, okay."],
    task: ["On it.", "Sure, doing it.", "Right away.", "Okay, on it.", "Got it.", "Alright, I'll take care of it."],
    long: ["Okay, let me look into that, one moment.", "Alright, this will take a little moment.", "Sure, I'm on it, give me a second.", "Okay, let me go through that properly."],
    wait1: ["One moment.", "Let me check.", "Hm, just a second.", "Still on it.", "Um, nearly."],
    wait2: ["Just a little longer.", "Still working on it.", "Almost there.", "Bear with me a moment.", "Hm, nearly."],
    wait3: ["This one is a bit bigger, nearly done.", "Still on it, sorting things out.", "Give me a moment more.", "Um, taking a little longer, but nearly there."],
    prefix: ["Hm, ", "Um, ", "So, "],
  },
} as const;

const QUESTION = {
  de: /^(wer|wie|was|wann|wo|woher|wohin|warum|wieso|weshalb|welche[rsnm]?|kannst du|könntest du|gibt es|gibt's|ist|sind|hast du|hat|haben|weißt du|wei[ßs]t du|stimmt|erklär|zeig)\b/i,
  en: /^(who|how|what|when|where|why|which|can you|could you|is|are|do|does|did|have you|has|explain|show)\b/i,
};

export function fillerKind(text: string, lang: FillerLang): FillerKind {
  const t = text.replace(/^🎙\s*/, "").trim();
  return /\?\s*$/.test(t) || QUESTION[lang].test(t) ? "question" : "task";
}

/**
 * When to say the fillers, in ms after sending: the acknowledgement at once, then after ~6 s,
 * ~15 s, and then every ~20 s — at most five, a little irregular so it never sounds like a timer.
 */
export function fillerTimes(rnd: () => number = Math.random, max = 5): number[] {
  const out = [120 + Math.round(rnd() * 180)];
  let at = 5200 + rnd() * 1600;
  for (let i = 1; i < max; i++) {
    out.push(Math.round(at));
    at += i === 1 ? 8500 + rnd() * 2500 : 17000 + rnd() * 7000;
  }
  return out;
}

/** The pool for the n-th filler (0 = acknowledgement), given what was asked and the usual wait. */
export function fillerPool(n: number, kind: FillerKind, expectMs: number | null, lang: FillerLang): readonly string[] {
  const p = POOLS[lang];
  if (n === 0) {
    if (expectMs != null && expectMs < 4500) return p.quick;
    if (expectMs != null && expectMs > 20000) return p.long;
    return kind === "question" ? p.question : p.task;
  }
  return n === 1 ? p.wait1 : n === 2 ? p.wait2 : p.wait3;
}

/**
 * Choose a phrase from the pool that was not said recently (it rotates through all of them); now
 * and then a follow-up gets a small "Hm," in front, unless it already starts with a sound.
 */
export function pickFiller(pool: readonly string[], recent: string[], lang: FillerLang, followUp: boolean, rnd: () => number = Math.random): { text: string; base: string } {
  const fresh = pool.filter((x) => !recent.includes(x));
  const from = fresh.length ? fresh : pool;
  const base = from[Math.floor(rnd() * from.length) % from.length];
  if (!followUp || /^(hm|ähm|öhm|um|so)[ ,.]/i.test(base) || rnd() >= 0.3) return { text: base, base };
  const pre = POOLS[lang].prefix[Math.floor(rnd() * POOLS[lang].prefix.length) % POOLS[lang].prefix.length];
  // "Hm, ich schau kurz." — but English "I" keeps its capital
  const rest = lang === "en" && /^I[ ']/.test(base) ? base : base.charAt(0).toLowerCase() + base.slice(1);
  return { text: pre + rest, base };
}

/** How long a session usually takes to answer (moving average of the last turns). */
const usual = new Map<string, number>();
export function expectedMs(sessionId: string): number | null {
  return usual.get(sessionId) ?? null;
}
export function learnDuration(sessionId: string, ms: number) {
  const prev = usual.get(sessionId);
  usual.set(sessionId, prev == null ? ms : Math.round(prev * 0.6 + ms * 0.4));
}


// ---------------------------------------------------------------------------
// What it is doing: "Ich lese gerade bei MDN nach." instead of another "Moment." (see progress.ts)
// ---------------------------------------------------------------------------

export { siteName };

/**
 * The live activity of an agent ("Fetching https://…", "Web search: …", "Editing a.ts") as a short
 * spoken sentence, or null when there is nothing worth saying ("Thinking…", the todo list).
 */
export function activityPhrase(activity: string | null | undefined, lang: FillerLang): string | null {
  return activityLines(activity, lang)[0] ?? null;
}

/** The agent's own interim sentence, ready to speak: no markers, code or markdown, at most two sentences. */
export function interimSpeech(text: string | null | undefined): string | null {
  const clean = (text ?? "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/\s*\[\[[\w-]{1,40}\]\]/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  const sentences = clean.match(/[^.!?…]+[.!?…]+/g) ?? [clean];
  let out = "";
  for (const x of sentences.slice(0, 2)) {
    if ((out + x).length > 240 && out) break;
    out += x;
  }
  return out.trim().slice(0, 260) || null;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** Says it in the session's own voice. `own` = the agent's own words (finish them, don't cache). */
export type Say = (text: string, sessionId: string, own?: boolean) => void;

interface Run {
  sessionId: string;
  started: number;
  timers: ReturnType<typeof setTimeout>[];
  tick: ReturnType<typeof setInterval> | null;
  say: Say;
  lang: FillerLang;
  /** when anything was last said (acknowledgement, its own words, a progress line) */
  lastSaid: number;
  /** progress lines said in this wait, and everything said (never twice) */
  count: number;
  said: string[];
  gap: number;
  /** the latest real activity and when it came */
  activity: string | null;
  activityAt: number;
  interim: string | null;
}
let run: Run | null = null;
const recent: string[] = [];
const MAX_RUN_MS = 5 * 60_000;
/** An activity older than this is no news any more (a filler fits better). */
const STALE_ACTIVITY_MS = 20_000;

export function stopFillers(answered = false) {
  if (!run) return;
  for (const t of run.timers) clearTimeout(t);
  if (run.tick) clearInterval(run.tick);
  if (answered) learnDuration(run.sessionId, Date.now() - run.started);
  run = null;
}

export function fillersRunning(sessionId?: string): boolean {
  return !!run && (!sessionId || run.sessionId === sessionId);
}

function settingsNow(): Record<string, unknown> {
  return (useApp.getState().settings ?? {}) as Record<string, unknown>;
}

function quiet(): boolean {
  const st = useApp.getState();
  // never over an answer or over you — and never when it is muted
  return !st.speaking && st.voice.state !== "recording" && st.voice.state !== "transcribing" && settingsNow().voiceMuted !== true;
}

/** One step of the wait: say what it is doing (or, with nothing to report, a light filler). */
function progressTick(mine: Run) {
  if (run !== mine || !quiet()) return;
  const now = Date.now();
  const live = useApp.getState().sessions[mine.sessionId]?.runtime?.currentActivity ?? null;
  if (live && live !== mine.activity && activityLines(live, mine.lang).length) {
    mine.activity = live;
    mine.activityAt = now;
  }
  const activity = mine.activity && now - mine.activityAt < STALE_ACTIVITY_MS ? mine.activity : null;
  const brief = settingsNow().voiceBrief === true;
  const line = nextProgressLine({ elapsedMs: now - mine.started, sinceSpokeMs: now - mine.lastSaid, gapMs: mine.gap, count: mine.count, activity, said: mine.said, lang: mine.lang, brief });
  if (!line) return;
  mine.said.push(line.text);
  mine.count++;
  mine.lastSaid = now;
  mine.gap = progressGap(now - mine.started, Math.random, brief);
  mine.say(line.text, mine.sessionId);
}

/**
 * The message went out: acknowledge it and keep the silence alive until the answer comes — with
 * what it is doing right now (progress.ts), a filler only when there is nothing to report.
 * `followUps` false = only the acknowledgement (a single dictation, no spoken answer expected).
 */
export function startFillers(sessionId: string, text: string, lang: FillerLang, say: Say, followUps = true) {
  stopFillers();
  const kind = fillerKind(text, lang);
  const expect = expectedMs(sessionId);
  const [ackAt] = fillerTimes();
  const prevInterim = useApp.getState().sessions[sessionId]?.runtime?.interim ?? null;
  const now = Date.now();
  const mine: Run = {
    sessionId, started: now, timers: [], tick: null, say, lang, lastSaid: now, count: 0, said: [], gap: progressGap(0),
    activity: null, activityAt: 0, interim: prevInterim,
  };
  run = mine;
  mine.timers.push(
    setTimeout(() => {
      if (run !== mine || !quiet()) return;
      const { text: phrase, base } = pickFiller(fillerPool(0, kind, expect, lang), recent, lang, false);
      recent.push(base);
      while (recent.length > 6) recent.shift();
      mine.lastSaid = Date.now();
      mine.said.push(base);
      say(phrase, sessionId);
    }, ackAt),
  );
  if (!followUps) return;
  mine.tick = setInterval(() => progressTick(mine), 400);
  mine.timers.push(setTimeout(() => { if (run === mine) stopFillers(); }, MAX_RUN_MS));
}

/** New activity or an interim sentence of the session the fillers are running for. */
export function fillerUpdate(sessionId: string, activity: string | null | undefined, interim: string | null | undefined) {
  const r = run;
  if (!r || r.sessionId !== sessionId) return;
  const now = Date.now();
  // a short tool step may be over before the next tick: remember it
  if (activity && activity !== r.activity && activityLines(activity, r.lang).length) {
    r.activity = activity;
    r.activityAt = now;
  }
  if (!quiet()) return;
  // M17: its own words first — they are the most natural thing to hear
  if (interim && interim !== r.interim) {
    r.interim = interim;
    const said = interimSpeech(interim);
    if (said) {
      r.lastSaid = now;
      r.said.push(said);
      r.say(said, sessionId, true);
      return;
    }
  }
  progressTick(r);
}

let wired = false;
/** Stop the fillers when the answer arrives, when you speak, or when the conversation ends. */
export function initFillers() {
  if (wired) return;
  wired = true;
  useApp.subscribe((st, prev) => {
    if (!run) return;
    const id = run.sessionId;
    const s = st.sessions[id];
    if (!s?.runtime?.running) return stopFillers();
    if (st.sessions !== prev.sessions && turnJustEnded(s, prev.sessions[id])) return stopFillers(true);
    if (st.speaking && !prev.speaking) return stopFillers(true);
    if (st.voice.state === "recording" && prev.voice.state !== "recording") return stopFillers();
    const was = prev.sessions[id]?.runtime;
    if (s.runtime.currentActivity !== was?.currentActivity || s.runtime.interim !== was?.interim) fillerUpdate(id, s.runtime.currentActivity, s.runtime.interim);
  });
}
