// The four voice levels of the assistant's control bar — one click instead of three settings.
// Pure (unit tested): segment ↔ settings (voiceMuted / voiceSpeakWhen / voiceBrief / ttsEnabled), the
// talk phase shown on the primary button, and the exact tooltip texts.
//
//   Stumm  — nothing is spoken (voiceMuted); answers stay text, the microphone keeps working
//   Kurz   — only when you ask, kept short („sprich weniger“)
//   Normal — also reports what matters („sag mir alles“)
//   Alles  — reads everything aloud („lies alles vor“)
import { speakModeOf } from "./speakPolicy";
import type { SpeechControl } from "./speechControl";

export type VoiceLevel = "mute" | "short" | "normal" | "all";
export const VOICE_LEVELS: VoiceLevel[] = ["mute", "short", "normal", "all"];

/** The segment the settings show. „Nur wenn ich frage“ without „Kurz fassen“ is still the quiet one: Kurz. */
export function voiceLevelOf(settings: Record<string, unknown>): VoiceLevel {
  if (settings.voiceMuted === true || settings.ttsEnabled === false) return "mute";
  const mode = speakModeOf(settings);
  return mode === "all" ? "all" : mode === "important" ? "normal" : "short";
}

/** The settings a segment writes. Leaving „Stumm“ also switches the voice output itself on again. */
export function settingsForLevel(level: VoiceLevel): Record<string, unknown> {
  switch (level) {
    case "mute":
      return { voiceMuted: true };
    case "short":
      return { voiceMuted: false, voiceSpeakWhen: "asked", voiceBrief: true, ttsEnabled: true };
    case "normal":
      return { voiceMuted: false, voiceSpeakWhen: "important", voiceBrief: false, ttsEnabled: true };
    case "all":
      return { voiceMuted: false, voiceSpeakWhen: "all", voiceBrief: false, ttsEnabled: true };
  }
}

/** Only the settings that change (empty: the segment is already exactly set). */
export function levelChanges(settings: Record<string, unknown>, level: VoiceLevel): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settingsForLevel(level))) if (settings[k] !== v) out[k] = v;
  return out;
}

/** The spoken / typed control that means the same segment (same toast, same effect). */
export function controlOfLevel(level: VoiceLevel): SpeechControl {
  return level === "mute" ? "mute" : level === "short" ? "less" : level === "normal" ? "more" : "all";
}

/** A spoken / typed control → the segment it lands on („unmute“ goes back to the level before). */
export function levelOfControl(cmd: SpeechControl, settings: Record<string, unknown>): VoiceLevel {
  if (cmd === "unmute") return voiceLevelOf({ ...settings, voiceMuted: false, ttsEnabled: true });
  return cmd === "mute" ? "mute" : cmd === "less" ? "short" : cmd === "more" ? "normal" : "all";
}

export function levelLabel(level: VoiceLevel, en: boolean): string {
  const de = { mute: "Stumm", short: "Kurz", normal: "Normal", all: "Alles" } as const;
  const eng = { mute: "Mute", short: "Brief", normal: "Normal", all: "All" } as const;
  return (en ? eng : de)[level];
}

/** Exactly what a segment does — the tooltip and the accessible name. */
export function levelTitle(level: VoiceLevel, en: boolean, active = false): string {
  if (en) {
    switch (level) {
      case "mute":
        return active
          ? "Muted: nothing is spoken, answers stay as text. The microphone, Talk and the wake word keep working. Click again, Ctrl+Shift+M or say “speak again” to unmute."
          : "Mute (Ctrl+Shift+M or “be quiet”): nothing is spoken — answers, fillers and announcements stay as text. The microphone keeps working.";
      case "short":
        return "Brief: speaks only when you ask by voice, at most two sentences. Agent news stays as text. (“talk less”)";
      case "normal":
        return "Normal: answers you asked for in full, plus one short sentence when an agent finishes or something needs you. (“tell me everything”)";
      case "all":
        return "All: reads everything aloud in full — typed answers and every agent’s news too. (“read everything”)";
    }
  }
  switch (level) {
    case "mute":
      return active
        ? "Stumm: es wird nichts gesprochen, Antworten kommen als Text. Mikrofon, „Sprechen“ und das Weckwort funktionieren weiter. Nochmal klicken, Strg+Umschalt+M oder „sprich wieder“ hebt das auf."
        : "Stumm (Strg+Umschalt+M oder „sei still“): nichts wird gesprochen – Antworten, Zwischenrufe und Ansagen nur als Text. Das Mikrofon hört weiter zu.";
    case "short":
      return "Kurz: spricht nur, wenn du per Stimme fragst, höchstens zwei Sätze. Meldungen der Agenten bleiben Text. („sprich weniger“)";
    case "normal":
      return "Normal: was du fragst, vollständig – dazu ein kurzer Satz, wenn ein Agent fertig ist oder etwas dich braucht. („sag mir alles“)";
    case "all":
      return "Alles: liest alles vollständig vor – auch getippte Antworten und jede Meldung der Agenten. („lies alles vor“)";
  }
}

/** What a voice conversation with this assistant is doing right now (null: no conversation, nothing going on). */
export type TalkPhase = "listening" | "understanding" | "thinking" | "speaking" | "waiting";

export interface TalkInputs {
  sessionId: string | null | undefined;
  talkSession: string | null;
  voiceState: string;
  voiceTarget: string | null;
  speakingSession: string | null | undefined;
  /** the session runs a turn or has input queued */
  busy: boolean;
}

/** The same phases the voice pill at the bottom shows, for one assistant. */
export function talkPhaseOf(i: TalkInputs): TalkPhase | null {
  if (!i.sessionId) return null;
  const mine = i.voiceTarget === i.sessionId;
  if (mine && i.voiceState === "recording") return "listening";
  if (mine && (i.voiceState === "transcribing" || i.voiceState === "sending")) return "understanding";
  if (i.speakingSession === i.sessionId) return "speaking";
  if (i.talkSession !== i.sessionId) return null;
  return i.busy ? "thinking" : "waiting";
}

export function phaseLabel(phase: TalkPhase, en: boolean): string {
  const de = { listening: "Hört zu", understanding: "Versteht", thinking: "Denkt nach", speaking: "Spricht", waiting: "Gespräch läuft" } as const;
  const eng = { listening: "Listening", understanding: "Understanding", thinking: "Thinking", speaking: "Speaking", waiting: "In conversation" } as const;
  return (en ? eng : de)[phase];
}
