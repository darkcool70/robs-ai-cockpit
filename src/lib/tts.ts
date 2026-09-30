// Read agent answers aloud (Windows voices through the WebView's speech synthesis — offline).
import { useApp } from "../store";
import { lastDictatedTarget } from "./voice";
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

export function speak(text: string) {
  const st = useApp.getState();
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text.trim()) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
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
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

let started = false;
/** Speak finished answers: always, or only for the session you last talked to by voice. */
export function initTts() {
  if (started) return;
  started = true;
  useApp.subscribe((st, prev) => {
    if (st.settings.ttsEnabled !== true || st.sessions === prev.sessions) return;
    for (const s of Object.values(st.sessions)) {
      if (s.kind !== "agent" || !turnJustEnded(s, prev.sessions[s.id])) continue;
      if (st.settings.ttsWhen !== "always" && lastDictatedTarget() !== s.id) continue;
      if (st.voice.state !== "idle") continue; // never talk over your own dictation
      const text = s.runtime?.notice ?? s.runtime?.lastMessage;
      if (text) speak(`${s.name}: ${summarize(text)}`);
    }
  });
  // Start dictating → stop reading.
  useApp.subscribe((st, prev) => {
    if (st.voice.state === "recording" && prev.voice.state !== "recording") stopSpeaking();
  });
}
