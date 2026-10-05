// Read agent answers aloud (Windows voices through the WebView's speech synthesis — offline).
import { useApp } from "../store";
import { lastDictatedTarget, startDictation } from "./voice";
import { turnJustEnded } from "./workflow";

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

export function voices(): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis?.getVoices() ?? [];
  } catch {
    return [];
  }
}

export interface SpeakOptions {
  /** Shown in the voice overlay while speaking. */
  sessionId?: string | null;
  name?: string;
  /** Called when the text has been read completely (not when interrupted). */
  onEnd?: () => void;
}

let utterance = 0;

export function speak(text: string, opts: SpeakOptions = {}) {
  const st = useApp.getState();
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text.trim()) return;
    synth.cancel();
    const id = ++utterance;
    const u = new SpeechSynthesisUtterance(text);
    if (opts.name) useApp.setState({ speaking: { sessionId: opts.sessionId ?? null, name: opts.name } });
    u.onend = () => {
      if (id !== utterance) return; // replaced by a newer one
      useApp.setState({ speaking: null });
      opts.onEnd?.();
    };
    u.onerror = () => {
      if (id === utterance) useApp.setState({ speaking: null });
    };
    const lang = st.settings.voiceLanguage === "en" ? "en" : "de";
    const wanted = typeof st.settings.ttsVoice === "string" ? st.settings.ttsVoice : "";
    const v = voices().find((x) => x.name === wanted) ?? voices().find((x) => x.lang.toLowerCase().startsWith(lang));
    if (v) u.voice = v;
    u.lang = v?.lang ?? (lang === "en" ? "en-US" : "de-DE");
    u.rate = Number(st.settings.ttsRate ?? 1.05) || 1;
    synth.speak(u);
  } catch {
    /* no speech synthesis available */
  }
}

export function stopSpeaking() {
  utterance++;
  useApp.setState({ speaking: null });
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

/** Spoken version of an answer in a conversation: longer than a notification, still no code. */
export function forSpeech(text: string, en = false): string {
  const tasks = en ? " (I proposed some tasks, have a look.) " : " (Ich habe Aufgaben vorgeschlagen, schau sie dir an.) ";
  return summarize(text.replace(/```cockpit-tasks[\s\S]*?```/g, tasks), 900);
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
  void startDictation(sessionId);
}

export function stopTalk() {
  useApp.setState({ talkSession: null });
  stopSpeaking();
}

let started = false;
/** Speak finished answers: always, or only for the session you last talked to by voice. */
export function initTts() {
  if (started) return;
  started = true;
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
    const en = st.settings.voiceLanguage === "en";
    speak(forSpeech(text, en) || (en ? "Done." : "Fertig."), {
      sessionId: id,
      name: s.name,
      onEnd: () => {
        const now = useApp.getState();
        if (now.talkSession === id && !notice && now.voice.state === "idle") void startDictation(id);
      },
    });
  });
  useApp.subscribe((st, prev) => {
    if (st.talkSession || st.settings.ttsEnabled !== true || st.sessions === prev.sessions) return;
    for (const s of Object.values(st.sessions)) {
      if (s.kind !== "agent" || !turnJustEnded(s, prev.sessions[s.id])) continue;
      if (st.settings.ttsWhen !== "always" && lastDictatedTarget() !== s.id) continue;
      if (st.voice.state !== "idle") continue; // never talk over your own dictation
      const text = s.runtime?.notice ?? s.runtime?.lastMessage;
      if (text) speak(`${s.name}: ${summarize(text)}`, { sessionId: s.id, name: s.name });
    }
  });
  // Start dictating → stop reading.
  useApp.subscribe((st, prev) => {
    if (st.voice.state === "recording" && prev.voice.state !== "recording") stopSpeaking();
  });
}
