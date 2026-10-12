// Speech output: agent answers read aloud, short spoken callouts ("Gesendet", "Codex ist fertig")
// and the voice conversation loop. Engines:
//  * neural: local Piper voices (Voice tab → download), the natural local Supertonic voices, or —
//    opt-in with your own key — Azure cloud voices; streamed sentence by sentence through WebAudio,
//    with optional effects (Jarvis room, robot). Supertonic/Azure trouble → that sentence in Piper;
//  * windows: the WebView's speech synthesis with the installed Windows voices (last fallback).
import { api, errMsg, type TtsStatus } from "./api";
import { useApp } from "../store";
import { startDictation, startMonitor, stopMonitor } from "./voice";
import { turnJustEnded } from "./workflow";
import { assistantOf } from "./assistants";
import { voiceHooks } from "./hooks";
import { audioContext, playSfx } from "./sfx";
import { BREAKPOINT_MS, atBreakpoint, nextBreakpointMs, whenFree } from "./attention";
import { type FillerLang, initFillers, startFillers, stopFillers } from "./fillers";
import { type SpeechLang, detectLang, missingGermanVoice, voiceForLang } from "./speechLang";
import { listenAfter, speechDecision, spokenText } from "./speakPolicy";
import { briefSpeech } from "./speechControl";
import { saidOnce, speakMode, turnKind } from "./speakTurn";

export type VoiceFx = "natural" | "jarvis" | "robot";
export const DEFAULT_NEURAL: Record<"de" | "en", string> = { de: "de_DE-thorsten-medium", en: "en_GB-alan-medium" };

const MARKER = /\[\[([\w-]{1,40})\]\]/g;
/** `[[p1]]` markers point at board cards while a sentence is spoken; they are never read aloud. */
export function markersOf(text: string): string[] {
  return [...text.matchAll(MARKER)].map((m) => m[1]);
}
export function withoutMarkers(text: string): string {
  return text.replace(/\s*\[\[[\w-]{1,40}\]\]/g, "");
}

/** Speakable short version of an answer: no code, no markdown, the first sentences. */
export function summarize(text: string, max = 280): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, " (Code) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s;
  }
  return (out.trim() || `${clean.slice(0, max).replace(/\s+\S*$/, "")} …`).trim();
}

/**
 * Pieces to synthesise one after another, so the first sentence plays while the next is made:
 * sentences, very short ones joined to the next, long ones cut at a comma.
 */
export function splitSentences(text: string, max = 220): string[] {
  // a sentence ends at . ! ? … followed by a space — not inside ".wasm", "v1.2" or "z.B." — and a
  // `[[id]]` marker belongs to the sentence it stands in
  const flat = text.replace(/\s+/g, " ").trim();
  const raw = flat ? flat.split(/(?<=[.!?…]["»“”')\]]*)\s+/) : [];
  const out: string[] = [];
  let carry = "";
  for (const r of raw.map((s) => s.trim()).filter(Boolean)) {
    let s = carry ? `${carry} ${r}` : r;
    carry = "";
    if (s.length < 25) {
      carry = s;
      continue;
    }
    while (s.length > max) {
      const cut = Math.max(s.lastIndexOf(", ", max), s.lastIndexOf("; ", max), s.lastIndexOf(" – ", max));
      const at = cut > 40 ? cut + 1 : s.lastIndexOf(" ", max) > 40 ? s.lastIndexOf(" ", max) : max;
      out.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    if (s) out.push(s);
  }
  if (carry) {
    if (out.length && carry.length < 12) out[out.length - 1] += ` ${carry}`;
    else out.push(carry);
  }
  return out;
}

export function voices(): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis?.getVoices() ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

let neural: TtsStatus | null = null;
/** Re-read which neural voices are installed (after a download). */
export async function refreshNeural(): Promise<TtsStatus | null> {
  neural = await api.ttsStatus().catch(() => null);
  return neural;
}
export function neuralStatus(): TtsStatus | null {
  return neural;
}

function lang(): "de" | "en" {
  return useApp.getState().settings.voiceLanguage === "en" ? "en" : "de";
}

/** Engine of a voice id (older backends knew only Piper). */
export function engineOf(voice: string | null | undefined): "piper" | "supertonic" | "azure" {
  const v = neural?.voices.find((x) => x.id === voice);
  return v?.engine ?? (voice?.startsWith("st-") ? "supertonic" : voice?.startsWith("az-") ? "azure" : "piper");
}

/** Installed neural voice to use (the chosen one, else the default for the language), or null. */
export function neuralVoice(preferred?: string | null): string | null {
  const st = useApp.getState().settings;
  if (st.ttsEngine === "windows" || !neural?.engineInstalled) return null;
  const installed = (id: string | null | undefined) => !!id && !!neural?.voices.find((v) => v.id === id && v.installed);
  for (const id of [preferred, st.ttsNeuralVoice as string | undefined, DEFAULT_NEURAL[lang()]]) if (installed(id)) return id!;
  // a cloud voice only speaks when it was chosen by name: never as a silent stand-in
  const local = neural.voices.filter((v) => v.installed && (v.engine ?? "piper") !== "azure");
  return local.find((v) => v.lang === lang())?.id ?? local[0]?.id ?? null;
}

/** An installed Piper voice for this language: the offline stand-in when another engine fails. */
export function piperFallback(l: SpeechLang = lang()): string | null {
  const piper = (neural?.voices ?? []).filter((v) => v.installed && (v.engine ?? "piper") === "piper");
  return piper.find((v) => v.id === DEFAULT_NEURAL[l])?.id ?? piper.find((v) => v.lang === l)?.id ?? piper[0]?.id ?? null;
}

let fallbackNoticeAt = 0;
/**
 * Text → audio in any engine. When Supertonic or the cloud fails (offline, quota, a wrong key), the
 * sentence is said by a local Piper voice instead — a short notice says so, at most once a minute.
 */
export async function synth(text: string, voice: string, speed: number, style: string | undefined, l: SpeechLang): Promise<ArrayBuffer> {
  try {
    return await api.ttsSpeak(text, voice, speed, style, l);
  } catch (e) {
    const engine = engineOf(voice);
    const alt = engine !== "piper" ? piperFallback(l) : null;
    if (!alt) throw e;
    if (Date.now() - fallbackNoticeAt > 60_000) {
      fallbackNoticeAt = Date.now();
      const name = engine === "azure" ? "Azure" : "Supertonic";
      useApp.getState().toast(`${name}: ${errMsg(e).slice(0, 120)} — spreche mit der lokalen Stimme weiter`, "warn");
    }
    return api.ttsSpeak(text, alt, speed, undefined, l);
  }
}

/**
 * The voice that says this text: German text spoken by an English voice (Amy) goes to a German voice
 * that sounds close to it, with a pitch factor to match. `fallback` decides text without a clear hint.
 */
export function voiceForText(voice: string, text: string, fallback: SpeechLang = lang()): { voice: string; pitch: number } {
  return voiceForLang(voice, detectLang(withoutMarkers(text)) ?? fallback, neural?.voices ?? [], useApp.getState().settings);
}

/** Moods a voice with styles is used in ("Thorsten Emotional"). */
export type Mood = "neutral" | "success" | "quiet";

/** Which style a voice speaks in: the chosen one, or "auto" — whispering at night, friendly for good news. */
export function styleFor(voice: string | null, mood: Mood = "neutral", hour = new Date().getHours()): string | undefined {
  const v = neural?.voices.find((x) => x.id === voice);
  if (!v?.styles?.length) return undefined;
  const chosen = String(useApp.getState().settings.ttsStyle ?? "auto");
  if (chosen !== "auto" && v.styles.includes(chosen)) return chosen;
  // each engine names its moods differently (Piper Thorsten Emotional, Azure express-as styles)
  const pick = (names: string[]) => names.find((n) => v.styles!.includes(n));
  if (mood === "quiet" || hour >= 22 || hour < 7) return pick(["whisper", "whispering", "softvoice"]) ?? pick(["neutral"]);
  if (mood === "success") return pick(["amused", "cheerful", "happy"]) ?? pick(["neutral"]);
  return pick(["neutral"]);
}

/** Good news sounds friendly ("Fertig.", "Geschafft!", "Done."). */
export function moodOf(text: string): Mood {
  return /\b(fertig|erledigt|geschafft|gelöst|grün|bestanden|done|finished|passed|success|great|super|perfekt)\b/i.test(text) ? "success" : "neutral";
}

function rate(): number {
  return Number(useApp.getState().settings.ttsRate ?? 1.05) || 1;
}

/** Room / robot effects between the voice and the speakers; everything ends in the level meter. */
let analyser: AnalyserNode | null = null;
function output(c: AudioContext): AudioNode {
  if (!analyser) {
    analyser = c.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(c.destination);
  }
  return analyser;
}

let impulse: AudioBuffer | null = null;
function roomImpulse(c: AudioContext): AudioBuffer {
  if (impulse) return impulse;
  const len = Math.floor(c.sampleRate * 0.7);
  impulse = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return impulse;
}

/** Build an effect chain; returns its input and a cleanup for oscillators. */
function fxChain(c: AudioContext, fx: VoiceFx): { input: AudioNode; stop: () => void } {
  const out = output(c);
  const input = c.createGain();
  if (fx === "natural") {
    input.connect(out);
    return { input, stop: () => {} };
  }
  if (fx === "jarvis") {
    // Crisp presence plus a little room: an AI speaking from the walls.
    const shelf = c.createBiquadFilter();
    shelf.type = "highshelf";
    shelf.frequency.value = 3200;
    shelf.gain.value = 4;
    const conv = c.createConvolver();
    conv.buffer = roomImpulse(c);
    const wet = c.createGain();
    wet.gain.value = 0.16;
    input.connect(shelf).connect(out);
    shelf.connect(conv).connect(wet).connect(out);
    return { input, stop: () => {} };
  }
  // Robot: ring modulation (the classic sci-fi voice), band-limited, with a metallic comb echo.
  const dry = c.createGain();
  dry.gain.value = 0.3;
  const ring = c.createGain();
  ring.gain.value = 0;
  const osc = c.createOscillator();
  osc.frequency.value = 62;
  osc.connect(ring.gain);
  osc.start();
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1500;
  bp.Q.value = 0.55;
  const comb = c.createDelay();
  comb.delayTime.value = 0.011;
  const fb = c.createGain();
  fb.gain.value = 0.45;
  const boost = c.createGain();
  boost.gain.value = 1.6;
  input.connect(dry).connect(bp);
  input.connect(ring).connect(bp);
  bp.connect(boost).connect(out);
  boost.connect(comb).connect(fb).connect(comb);
  fb.connect(out);
  return { input, stop: () => { try { osc.stop(); } catch { /* already stopped */ } } };
}

let playing: AudioBufferSourceNode | null = null;
/**
 * Pitch without changing the tempo: Piper speaks `pitch` times slower, and the sound is played
 * `pitch` times faster — higher (or lower) and exactly as quick as before. Kept within ±20 %, where
 * the voice still sounds like itself.
 */
export function clampPitch(p: unknown): number {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? Math.min(1.2, Math.max(0.8, n)) : 1;
}

function playBuffer(c: AudioContext, buf: AudioBuffer, fx: VoiceFx, gen: () => boolean, pitch = 1): Promise<void> {
  return new Promise((resolve) => {
    if (!gen()) return resolve();
    const chain = fxChain(c, fx);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    src.connect(chain.input);
    playing = src;
    src.onended = () => {
      chain.stop();
      if (playing === src) playing = null;
      // Let the echo ring out a moment before the next sentence.
      window.setTimeout(resolve, fx === "natural" ? 0 : 60);
    };
    src.start();
  });
}

/** Output level 0…1 of the voice right now (the orb pulses with it). */
let fakeLevelUntil = 0;
export function outputLevel(): number {
  if (performance.now() < fakeLevelUntil) return 0.25 + 0.2 * Math.sin(performance.now() / 70) ** 2;
  if (!analyser || !playing) return 0;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const x of data) sum += x * x;
  return Math.min(1, Math.sqrt(sum / data.length) * 4);
}

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

export interface SpeakOptions {
  /** Shown in the voice overlay while speaking. */
  sessionId?: string | null;
  name?: string;
  /** Called when the text has been read completely (not when interrupted). */
  onEnd?: () => void;
  /** Neural voice id (else the session's assistant voice, else the default). */
  voice?: string | null;
  fx?: VoiceFx;
  /** Not part of a conversation: wait for a pause in your typing (a breakpoint) before speaking. */
  polite?: boolean;
  /** Something is already being said (e.g. the first sentence, spoken early): say this right after it. */
  append?: boolean;
  /** Pitch (0.8–1.2, else the session's / the default). */
  pitch?: number;
  /** internal: already waited for the agent's own interim sentence to finish */
  afterOwn?: boolean;
}

/** Speech queued behind the current one (append). */
let after: { text: string; opts: SpeakOptions }[] = [];
/** The polite speech playing now, to learn from how you react to it (M16). */
let politeStarted = 0;

/** Polite speech waiting for a breakpoint (a newer one replaces it). */
let waitingSpeech: (() => void) | null = null;

/** Voice and effect for a session: its assistant's own voice when one is set. */
function voiceOf(sessionId: string | null | undefined): { voice: string | null; fx: VoiceFx; pitch: number } {
  const st = useApp.getState();
  const fx = (st.settings.ttsFx as VoiceFx) || "natural";
  const a = assistantOf(st.assistants, sessionId ?? null);
  const own = a ? (st.settings.assistantVoices as Record<string, { voice?: string; fx?: VoiceFx; pitch?: number }> | undefined)?.[a.id] : undefined;
  return { voice: own?.voice ?? null, fx: own?.fx ?? fx, pitch: clampPitch(own?.pitch ?? st.settings.ttsPitch ?? 1) };
}

let utterance = 0;

/** What is being said right now and which piece of it is playing (to continue after "warte"). */
let current: { id: number; opts: SpeakOptions; parts: string[]; index: number } | null = null;
/** An answer interrupted by you, kept to continue on "weiter" (for ten minutes). */
let held: { text: string; opts: SpeakOptions; at: number } | null = null;
const HOLD_MS = 10 * 60_000;

/** Keep the rest of what is being said — from the sentence it was in — to continue later. */
function holdSpeech() {
  const c = current;
  if (!c || c.id !== utterance) return;
  const rest = [...c.parts.slice(c.index), ...after.map((a) => a.text)].join(" ").trim();
  held = withoutMarkers(rest).trim() ? { text: rest, opts: { ...c.opts, append: false, afterOwn: true, polite: false }, at: Date.now() } : null;
}

export function hasHeldSpeech(): boolean {
  return !!held && Date.now() - held.at < HOLD_MS;
}

/** Continue the answer you interrupted with "warte" (from the sentence it stopped in). */
export function resumeSpeech(): boolean {
  if (!hasHeldSpeech()) return false;
  const h = held!;
  held = null;
  speak(h.text, h.opts);
  return true;
}

export function dropHeldSpeech() {
  held = null;
}

/** Muted (`voiceMuted`): nothing is spoken — the text is still shown, the microphone still works. */
export function outputMuted(): boolean {
  return useApp.getState().settings.voiceMuted === true;
}

export function speak(text: string, opts: SpeakOptions = {}) {
  if (outputMuted()) {
    // silent, but whoever waits for the end (a conversation that listens again, a presentation) goes on
    if (opts.onEnd) window.setTimeout(opts.onEnd, 60);
    return;
  }
  if (opts.append && useApp.getState().speaking) {
    after.push({ text, opts: { ...opts, append: false } });
    return;
  }
  waitingSpeech?.();
  waitingSpeech = null;
  if (opts.polite && useApp.getState().settings.voicePolite !== false) {
    // Interruptions cost least at a breakpoint: say it when you pause, at the latest in 45 s.
    // How long a pause must be is learned from how you react (see learnFromReaction).
    const ms = Number(useApp.getState().settings.voiceBreakpointMs ?? BREAKPOINT_MS);
    waitingSpeech = whenFree(() => {
      waitingSpeech = null;
      if (useApp.getState().voice.state !== "idle") return;
      speak(text, { ...opts, polite: false });
      politeStarted = Date.now();
    }, 45_000, () => atBreakpoint(ms));
    return;
  }
  if (filler?.own && !opts.afterOwn) {
    // its own sentence ("Ich recherchiere kurz…") is still playing: the answer follows it
    const waitFor = utterance;
    void Promise.race([filler.ended, new Promise((ok) => window.setTimeout(ok, 9000))]).then(() => {
      if (utterance === waitFor) speak(text, { ...opts, afterOwn: true });
    });
    return;
  }
  after = [];
  const id = ++utterance;
  stopAudio();
  fadeFiller();
  const t = text.trim();
  if (!withoutMarkers(t).trim()) return;
  const mine = voiceOf(opts.sessionId);
  const voice = neuralVoice(opts.voice ?? mine.voice);
  const fx = opts.fx ?? mine.fx;
  current = { id, opts, parts: [t], index: 0 };
  useApp.setState({ speaking: { sessionId: opts.sessionId ?? null, name: opts.name ?? "Assistant" } });
  const finish = (complete: boolean) => {
    if (id !== utterance) return;
    if (complete && politeStarted) learnFromReaction(false);
    const next = complete ? after.shift() : undefined;
    if (next) {
      // the queued rest follows seamlessly (the speaking state stays)
      opts.onEnd?.();
      speak(next.text, next.opts);
      return;
    }
    after = [];
    useApp.setState({ speaking: null });
    if (complete) opts.onEnd?.();
  };
  const mark = (part: string) => {
    voiceHooks.onSpeechPart?.(opts.sessionId ?? null, withoutMarkers(part));
    const ids = markersOf(part);
    if (ids.length) voiceHooks.onSpeechMarkers?.(opts.sessionId ?? null, ids);
  };
  if (voice) {
    void speakNeural(t, voice, fx, id, mark, opts.pitch != null ? clampPitch(opts.pitch) : mine.pitch, (parts, i) => {
      if (current?.id === id) {
        current.parts = parts;
        current.index = i;
      }
    }).then(finish, () => {
      // Engine trouble: say it with the Windows voice instead of staying silent.
      if (id === utterance) speakWindows(withoutMarkers(t), id, finish);
    });
  } else {
    mark(t);
    speakWindows(withoutMarkers(t), id, finish);
  }
}

async function speakNeural(text: string, voice: string, fx: VoiceFx, id: number, mark: (part: string) => void = () => {}, pitch = 1, at: (parts: string[], i: number) => void = () => {}): Promise<boolean> {
  const c = audioContext();
  await c.resume().catch(() => {});
  const parts = splitSentences(text).filter((p) => withoutMarkers(p).trim());
  const mood = moodOf(text);
  // each sentence in its language: a sentence without a clear hint follows the whole answer
  const base = detectLang(withoutMarkers(text)) ?? lang();
  const plan = parts.map((p) => {
    const l = detectLang(withoutMarkers(p)) ?? base;
    const v = voiceForLang(voice, l, neural?.voices ?? [], useApp.getState().settings);
    return { voice: v.voice, pitch: clampPitch(pitch * v.pitch), lang: l };
  });
  const make = (i: number) => synth(withoutMarkers(parts[i]), plan[i].voice, rate() / plan[i].pitch, styleFor(plan[i].voice, mood), plan[i].lang).then((ab) => c.decodeAudioData(ab));
  let next: Promise<AudioBuffer> | null = parts.length ? make(0) : null;
  for (let i = 0; i < parts.length && next; i++) {
    const buf = await next;
    if (id !== utterance) return false;
    next = i + 1 < parts.length ? make(i + 1) : null;
    next?.catch(() => {}); // a stopped answer must not leave an unhandled rejection
    mark(parts[i]);
    at(parts, i);
    await playBuffer(c, buf, fx, () => id === utterance, plan[i].pitch);
    if (id !== utterance) return false;
  }
  return true;
}

function speakWindows(text: string, id: number, finish: (complete: boolean) => void) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return finish(false);
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.onstart = () => { fakeLevelUntil = performance.now() + 60_000; };
    u.onend = () => {
      fakeLevelUntil = 0;
      finish(id === utterance);
    };
    u.onerror = () => {
      fakeLevelUntil = 0;
      finish(false);
    };
    const st = useApp.getState();
    const wanted = typeof st.settings.ttsVoice === "string" ? st.settings.ttsVoice : "";
    const v = voices().find((x) => x.name === wanted) ?? voices().find((x) => x.lang.toLowerCase().startsWith(lang()));
    if (v) u.voice = v;
    u.lang = v?.lang ?? (lang() === "en" ? "en-US" : "de-DE");
    u.rate = rate();
    synth.speak(u);
  } catch {
    finish(false);
  }
}

function stopAudio() {
  fakeLevelUntil = 0;
  try {
    playing?.stop();
  } catch {
    /* not started */
  }
  playing = null;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * M16 — learning when not to interrupt: cutting a report short within 3 s means it came at a bad
 * moment, so the next one waits for a longer pause; listening to the end makes it bolder again.
 */
function learnFromReaction(dismissed: boolean) {
  const st = useApp.getState();
  const cur = Number(st.settings.voiceBreakpointMs ?? BREAKPOINT_MS);
  const next = nextBreakpointMs(cur, dismissed);
  politeStarted = 0;
  if (next !== cur) void st.setSetting("voiceBreakpointMs", next);
}

/** `hold`: you interrupted it — keep the rest, so "weiter" continues where it stopped. */
export function stopSpeaking(hold = false) {
  if (hold && useApp.getState().speaking) holdSpeech();
  if (politeStarted && Date.now() - politeStarted < 3000) learnFromReaction(true);
  politeStarted = 0;
  after = [];
  waitingSpeech?.();
  waitingSpeech = null;
  utterance++;
  stopAudio();
  fadeFiller();
  useApp.setState({ speaking: null });
}

// ---------------------------------------------------------------------------
// Callouts: very short status phrases in the callout voice ("Gesendet.", "Codex ist fertig.")
// ---------------------------------------------------------------------------

const PHRASES = {
  sent: { de: "Gesendet.", en: "Sent." },
  cancelled: { de: "Abgebrochen.", en: "Cancelled." },
  standby: { de: "Standby.", en: "Standing by." },
  online: { de: "Sprachsteuerung bereit.", en: "Voice control online." },
  muted: { de: "Antworten stumm.", en: "Answers muted." },
  unmuted: { de: "Antworten laut.", en: "Answers on." },
  done: { de: "Erledigt.", en: "Done." },
  welcome: { de: "Willkommen zurück.", en: "Welcome back." },
} as const;

export type Phrase = keyof typeof PHRASES;

export function phrase(key: Phrase): string {
  return PHRASES[key][lang()];
}

const calloutCache = new Map<string, AudioBuffer>();

/**
 * Speak a short status phrase in the callout voice (robot by default). Never interrupts an answer
 * that is being read; skipped when callouts are off. Resolves when the phrase has been played (at
 * the latest after 3 s), so the microphone can open after it instead of hearing it.
 */
export async function callout(text: string, force = false): Promise<void> {
  const st = useApp.getState().settings;
  if (!force && st.voiceCallouts === false) return;
  if (useApp.getState().speaking || outputMuted()) return;
  const fx = (st.voiceCalloutFx as VoiceFx) || "robot";
  const main = neuralVoice((st.voiceCalloutVoice as string) || null);
  const voice = main ? voiceForText(main, text).voice : null;
  let ended = () => {};
  const played = Promise.race([new Promise<void>((ok) => { ended = ok; }), new Promise<void>((ok) => window.setTimeout(ok, 3000))]);
  if (!voice) {
    // Windows voice: lower and a bit faster sounds at least a little like a machine.
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang() === "en" ? "en-US" : "de-DE";
      u.pitch = fx === "robot" ? 0.4 : 1;
      u.rate = 1.15;
      u.onend = () => ended();
      u.onerror = () => ended();
      window.speechSynthesis?.speak(u);
    } catch {
      return;
    }
    return played;
  }
  try {
    const c = audioContext();
    const style = styleFor(voice, moodOf(text));
    const key = `${voice}|${style}|${text}`;
    let buf = calloutCache.get(key);
    if (!buf) {
      buf = await c.decodeAudioData(await synth(text, voice, 1.12, style, detectLang(text) ?? lang()));
      if (calloutCache.size > 60) calloutCache.clear();
      calloutCache.set(key, buf);
    }
    const chain = fxChain(c, fx);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(chain.input);
    src.onended = () => {
      chain.stop();
      ended();
    };
    src.start();
    return played;
  } catch {
    /* engine not ready: the sound alone has to do */
  }
}

// ---------------------------------------------------------------------------
// Fillers ("Okay.", "Moment.", "Hm, ich schau kurz.") — in the voice that will answer, not the
// callout voice: same speaker, same effect, a touch quicker and softer, like someone thinking aloud.
// ---------------------------------------------------------------------------

/** Language of the voice that speaks for this session (an English voice says English fillers). */
export function fillerLang(sessionId: string | null): FillerLang {
  const voice = neuralVoice(voiceOf(sessionId).voice);
  // an English voice that also speaks German (see voiceForText) says German fillers when you speak German
  if (voice && lang() === "de" && voiceForLang(voice, "de", neural?.voices ?? [], useApp.getState().settings).voice !== voice) return "de";
  const v = voice ? neural?.voices.find((x) => x.id === voice) : null;
  // a multilingual voice (Supertonic, Azure multilingual) speaks the language you speak
  if (v?.multilingual) return lang();
  const l = v?.lang;
  return l === "en" || l === "de" ? l : lang();
}

let filler: { src: AudioBufferSourceNode; gain: GainNode; own: boolean; ended: Promise<void> } | null = null;
function fadeFiller() {
  if (!filler) return;
  const { src, gain } = filler;
  filler = null;
  try {
    const c = audioContext();
    gain.gain.setTargetAtTime(0, c.currentTime, 0.03);
    src.stop(c.currentTime + 0.12);
  } catch {
    /* already over */
  }
}

const fillerCache = new Map<string, AudioBuffer>();
/** Pitch steps offered in the settings (label, value). */
export const PITCHES: [string, number][] = [["Deeper", 0.88], ["A bit deeper", 0.94], ["Natural", 1], ["A bit higher", 1.06], ["Higher", 1.12]];

export async function sayFiller(text: string, sessionId: string | null, own = false) {
  if (useApp.getState().speaking || outputMuted()) return;
  // the agent's own words wait for a filler that is still playing; a filler never talks over anything
  if (filler && own) await Promise.race([filler.ended, new Promise((ok) => window.setTimeout(ok, 4000))]);
  if (filler || useApp.getState().speaking) return;
  const { voice: assistantVoice, fx, pitch: ownPitch } = voiceOf(sessionId);
  const main = neuralVoice(assistantVoice);
  const routed = main ? voiceForText(main, text, fillerLang(sessionId)) : null;
  const voice = routed?.voice ?? null;
  const pitch = clampPitch(ownPitch * (routed?.pitch ?? 1));
  if (!voice) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const st = useApp.getState().settings;
      const v = voices().find((x) => x.name === st.ttsVoice) ?? voices().find((x) => x.lang.toLowerCase().startsWith(fillerLang(sessionId)));
      if (v) u.voice = v;
      u.lang = v?.lang ?? (fillerLang(sessionId) === "en" ? "en-US" : "de-DE");
      u.rate = own ? rate() : rate() * 1.05;
      u.volume = 0.85;
      window.speechSynthesis?.speak(u);
    } catch {
      /* no speech */
    }
    return;
  }
  try {
    const c = audioContext();
    await c.resume().catch(() => {});
    const style = styleFor(voice);
    const key = `${voice}|${rate()}|${pitch}|${style}|${text}`;
    let buf = own ? undefined : fillerCache.get(key);
    if (!buf) {
      buf = await c.decodeAudioData(await synth(withoutMarkers(text), voice, (own ? rate() : rate() * 1.06) / pitch, style, detectLang(withoutMarkers(text)) ?? fillerLang(sessionId)));
      if (!own) {
        if (fillerCache.size > 120) fillerCache.clear();
        fillerCache.set(key, buf);
      }
    }
    if (useApp.getState().speaking || filler) return; // the answer came first
    const chain = fxChain(c, fx);
    const gain = c.createGain();
    gain.gain.value = own ? 1 : 0.82;
    gain.connect(chain.input);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    src.connect(gain);
    let done = () => {};
    const mine = { src, gain, own, ended: new Promise<void>((ok) => { done = ok; }) };
    filler = mine;
    src.onended = () => {
      chain.stop();
      if (filler === mine) filler = null;
      done();
    };
    src.start();
  } catch {
    /* engine not ready: the send sound alone has to do */
  }
}

/** A spoken message went out: acknowledge it and fill the wait until the answer. */
export function acknowledge(sessionId: string, text: string, followUps: boolean) {
  if (outputMuted()) return;
  startFillers(sessionId, text, fillerLang(sessionId), (t, id, own) => void sayFiller(t, id, own), followUps);
}

/** Short sound plus spoken phrase for an event. */
export function signal(sound: Parameters<typeof playSfx>[0], text?: string) {
  playSfx(sound);
  if (text) window.setTimeout(() => void callout(text), 140);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** Spoken version of an answer in a conversation: longer than a notification, still no code. */
export function forSpeech(text: string, en = false): string {
  const tasks = en ? " (I proposed some tasks, have a look.) " : " (Ich habe Aufgaben vorgeschlagen, schau sie dir an.) ";
  // A block cut off at the end (very long answers) is dropped as well.
  return summarize(withoutReport(text.replace(/```cockpit-tasks[\s\S]*?(```|$)/g, tasks).replace(/```cockpit-actions[\s\S]*?(```|$)/g, " ")), 900);
}

/** The closing report lines ("Done: … / Verified: … / Next: …") are for reading: spoken, only the next step stays. */
export function withoutReport(text: string): string {
  return text
    .replace(/^[ \t>*_-]*(Done|Verified|Erledigt|Geprüft|Verifiziert)[*_]*\s*[:·—-].*$/gim, "")
    .replace(/^[ \t>*_-]*(Next|Als Nächstes|Nächster Schritt)[*_]*\s*[:·—-]\s*/gim, "");
}

/** Talk with a session: dictation is sent at once, its answer is read aloud, then the mic opens again. */
export function startTalk(sessionId: string) {
  const st = useApp.getState();
  if (!st.sessions[sessionId]?.runtime?.running) {
    st.toast("Start the session first", "warn");
    return;
  }
  useApp.setState({ talkSession: sessionId });
  stopSpeaking();
  void startDictation(sessionId, { conversation: true });
}

export function stopTalk() {
  stopFillers();
  useApp.setState({ talkSession: null });
  stopSpeaking();
  void stopMonitor();
}

/** Text of a finished turn as it is read aloud ("" = nothing to say). */
function speechFor(id: string, text: string): string {
  const custom = voiceHooks.speechOf?.(id, text);
  if (custom != null) return custom;
  return forSpeech(text, lang() === "en");
}

/** Mic on again for the next sentence of the conversation (unless the agent will answer again by itself). */
function listenAgain(id: string) {
  const now = useApp.getState();
  if (now.talkSession !== id || now.voice.state !== "idle") return;
  if (voiceHooks.holdListening?.(id)) return;
  void startDictation(id, { conversation: true });
}

let started = false;
/** Speak finished answers: in conversations, for sessions you talk to, or for every agent. */
export function initTts() {
  if (started) return;
  started = true;
  initFillers();
  void refreshNeural().then(async (s) => {
    const v = neuralVoice();
    if (!s || !v || useApp.getState().settings.ttsEnabled === false) return;
    void api.ttsWarmup(v, rate()).catch(() => {});
    if (lang() !== "de") return;
    // an English voice (Amy) speaks German through a German voice: fetch it once if none is there
    const missing = missingGermanVoice(v, s.voices, useApp.getState().settings);
    if (missing) await api.ttsInstall(missing).then(refreshNeural).catch(() => {});
    const de = voiceForText(v, "", "de");
    if (de.voice !== v) void api.ttsWarmup(de.voice, rate() / clampPitch(clampPitch(useApp.getState().settings.ttsPitch ?? 1) * de.pitch)).catch(() => {});
  });
  // Conversation: read the answer, then listen again (a permission question is read, not answered by voice).
  useApp.subscribe((st, prev) => {
    const id = st.talkSession;
    if (!id || st.sessions === prev.sessions) return;
    const s = st.sessions[id];
    if (!s?.runtime?.running) {
      useApp.setState({ talkSession: null });
      return;
    }
    if (!turnJustEnded(s, prev.sessions[id]) || st.voice.state !== "idle") return;
    const notice = s.runtime?.notice;
    const text = notice ?? s.runtime?.lastMessage ?? "";
    // Who asked for this turn decides whether it is spoken (speakPolicy): your words are answered
    // aloud, news nobody asked for stays text in „Nur wenn ich frage“.
    const kind = notice ? "needsYou" : turnKind(s);
    let say = spokenText(kind, speakMode(st.settings), notice ? summarize(notice) : speechFor(id, text));
    if (say && notice && !saidOnce.first(`${id}|${notice}`)) say = "";
    // „sprich weniger“: two sentences at most
    if (say && st.settings.voiceBrief === true) say = briefSpeech(say);
    const listen = !notice && listenAfter(kind);
    // muted: the answer stays text, the conversation still listens for your next sentence
    if (say && outputMuted()) say = "";
    if (!say) {
      // Nothing to say (e.g. only actions): give the other listeners this update first.
      if (listen) window.setTimeout(() => listenAgain(id), 60);
      return;
    }
    speak(say, { sessionId: id, name: s.name, append: true, onEnd: () => { if (listen) listenAgain(id); else void stopMonitor(); } });
    // full duplex: listen while it speaks, so you can interrupt
    if (listen) void startMonitor(id);
  });
  // Outside a conversation: answers of the sessions you talked to (or of every agent), and short
  // callouts for the others.
  useApp.subscribe((st, prev) => {
    if (st.sessions === prev.sessions) return;
    for (const s of Object.values(st.sessions)) {
      if (s.kind !== "agent" || s.id === st.talkSession || !turnJustEnded(s, prev.sessions[s.id])) continue;
      if (voiceHooks.speaksItself?.(s.id)) continue;
      if (st.voice.state !== "idle") continue; // never talk over your own dictation
      const set = st.settings;
      const mode = speakMode(set);
      const notice = s.runtime?.notice ?? null;
      const en = lang() === "en";
      if (notice) {
        // It needs you: once per question. With an operator running, the operator tells you about the
        // agents it watches — the chime here only when you switched the announcements on.
        if (set.ttsEnabled === false || speechDecision("needsYou", mode) === "silent") continue;
        if (voiceHooks.operatorSession?.() && set.voiceAnnounce !== true) continue;
        if (!saidOnce.first(`${s.id}|${notice}`)) continue;
        if (speechDecision("needsYou", mode) === "full") speak(`${s.name}: ${summarize(notice)}`, { sessionId: s.id, name: s.name, polite: true });
        else if (!st.speaking) signal("attention", en ? `${s.name} needs you.` : `${s.name} braucht dich.`);
        continue;
      }
      // Its answer: aloud when you asked it by voice (or „Alles vorlesen“) — an old dictation no longer
      // makes every later answer of that agent talk.
      const text = s.runtime?.lastMessage;
      let say = set.ttsEnabled !== false && text ? spokenText(turnKind(s), mode, speechFor(s.id, text)) : "";
      if (say && set.voiceBrief === true) say = briefSpeech(say);
      if (say) speak(`${s.name}: ${say}`, { sessionId: s.id, name: s.name, polite: true });
      else if (set.voiceAnnounce === true && !st.speaking) signal("done", en ? `${s.name} is done.` : `${s.name} ist fertig.`);
    }
  });
  // Start dictating → stop reading.
  useApp.subscribe((st, prev) => {
    if (st.voice.state === "recording" && prev.voice.state !== "recording") stopSpeaking(true);
  });
  // Muted (button, Ctrl+Shift+M, „sei still“, the Voice tab): silent at once.
  useApp.subscribe((st, prev) => {
    if (st.settings.voiceMuted === true && prev.settings.voiceMuted !== true) {
      stopFillers();
      if (st.speaking) stopSpeaking(true);
    }
  });
}
