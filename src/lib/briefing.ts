// "Welcome back": when you return to the cockpit after a while and something happened, a short
// spoken briefing tells you what — which agents finished, who needs you, what waits for review.
// Local, no AI involved.
import { useApp } from "../store";
import { turnJustEnded } from "./workflow";
import { phrase, speak } from "./tts";
import { speakModeOf, spokenText } from "./speakPolicy";

export interface AwayLog {
  finished: string[];
  asking: string[];
  limited: string[];
}

/** The spoken briefing for what happened while you were away ("" when nothing did). */
export function briefingText(log: AwayLog, reviews: number, en: boolean): string {
  const uniq = (l: string[]) => [...new Set(l)];
  const and = (l: string[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} ${en ? "and" : "und"} ${l[l.length - 1]}`);
  const finished = uniq(log.finished).filter((n) => !log.asking.includes(n));
  const asking = uniq(log.asking);
  const limited = uniq(log.limited);
  const parts: string[] = [];
  if (finished.length) parts.push(en ? `${and(finished)} ${finished.length === 1 ? "has" : "have"} finished.` : `${and(finished)} ${finished.length === 1 ? "ist" : "sind"} fertig geworden.`);
  if (asking.length) parts.push(en ? `${and(asking)} ${asking.length === 1 ? "needs" : "need"} your decision.` : `${and(asking)} ${asking.length === 1 ? "braucht" : "brauchen"} deine Entscheidung.`);
  if (limited.length) parts.push(en ? `${and(limited)} hit a usage limit.` : `${and(limited)} ${limited.length === 1 ? "hat" : "haben"} ein Limit erreicht.`);
  if (reviews) parts.push(en ? `${reviews} task${reviews === 1 ? " is" : "s are"} ready for review.` : `${reviews} ${reviews === 1 ? "Aufgabe wartet" : "Aufgaben warten"} auf dein Review.`);
  if (!parts.length) return "";
  return `${phrase("welcome")} ${en ? "While you were away:" : "Während du weg warst:"} ${parts.join(" ")}`;
}

let started = false;
export function initBriefing() {
  if (started) return;
  started = true;
  let awaySince: number | null = document.hasFocus() ? null : Date.now();
  let log: AwayLog = { finished: [], asking: [], limited: [] };
  const reviewsAtLeave = { n: 0 };

  window.addEventListener("blur", () => {
    awaySince = Date.now();
    log = { finished: [], asking: [], limited: [] };
    reviewsAtLeave.n = useApp.getState().tasks.filter((t) => t.status === "review").length;
  });
  window.addEventListener("focus", () => {
    const since = awaySince;
    awaySince = null;
    const st = useApp.getState();
    const minutes = Number(st.settings.voiceWelcomeMin ?? 10);
    if (!since || st.settings.voiceWelcome === false || st.settings.ttsEnabled === false || Date.now() - since < minutes * 60_000) return;
    if (st.voice.state !== "idle" || st.speaking) return;
    const reviews = Math.max(0, st.tasks.filter((t) => t.status === "review").length - reviewsAtLeave.n);
    // nobody asked for it: spoken only in „Wichtiges auch melden“ / „Alles vorlesen“ (speakPolicy)
    const text = spokenText("digest", speakModeOf(st.settings), briefingText(log, reviews, st.settings.voiceLanguage === "en"));
    if (text) window.setTimeout(() => speak(text, { name: st.settings.voiceLanguage === "en" ? "Briefing" : "Lagebericht" }), 700);
  });
  useApp.subscribe((st, prev) => {
    if (awaySince === null || st.sessions === prev.sessions) return;
    for (const s of Object.values(st.sessions)) {
      if (s.kind !== "agent") continue;
      const before = prev.sessions[s.id];
      if (s.runtime?.notice && s.runtime.notice !== before?.runtime?.notice) log.asking.push(s.name);
      else if (turnJustEnded(s, before)) log.finished.push(s.name);
      if (s.runtime?.status === "rate-limited" && before?.runtime?.status !== "rate-limited") log.limited.push(s.name);
    }
  });
}
