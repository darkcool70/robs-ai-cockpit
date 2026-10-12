// Mute and „how much it talks“ at runtime: the button (operator room, voice bar), Ctrl+Shift+M, and
// the spoken or typed controls of speechControl.ts. Muted means the OUTPUT only: nothing is spoken
// (answers, fillers, callouts, briefings) — everything still arrives as text, and the microphone,
// „Sprechen“ and the wake word keep working, so „sprich wieder“ can be said.
import { useApp } from "../store";
import { voiceHooks } from "./hooks";
import { playSfx } from "./sfx";
import { stopFillers } from "./fillers";
import { speak, stopSpeaking } from "./tts";
import { controlEffect, speechControl, type SpeechControl } from "./speechControl";
import { controlOfLevel, levelChanges, voiceLevelOf, type VoiceLevel } from "./voiceLevel";

export function isMuted(): boolean {
  return useApp.getState().settings.voiceMuted === true;
}

/** Names the operator answers to, so „Atlas, sei still“ counts. */
function names(): string[] {
  const op = useApp.getState().assistants.find((a) => a.power === "operator")?.name;
  return ["atlas", ...(op ? [op] : [])];
}

/** Carry out a control: settings, a soft sound or a single „Okay.“, a toast. `then` listens again in a conversation. */
export async function applySpeechControl(cmd: SpeechControl, opts: { sessionId?: string | null; then?: () => void; quiet?: boolean } = {}): Promise<void> {
  const st = useApp.getState();
  const en = st.settings.voiceLanguage === "en";
  const eff = controlEffect(cmd, en);
  for (const [k, v] of Object.entries(eff.settings)) {
    if (st.settings[k] !== v) await useApp.getState().setSetting(k, v);
  }
  useApp.getState().toast(eff.toast, "ok");
  if (eff.settings.voiceMuted) {
    stopFillers();
    stopSpeaking();
    playSfx("standby");
    if (opts.then) window.setTimeout(opts.then, 300);
    return;
  }
  const sessionId = opts.sessionId ?? voiceHooks.operatorSession?.() ?? null;
  if (eff.say && !opts.quiet) {
    const name = (sessionId && useApp.getState().sessions[sessionId]?.name) || "Atlas";
    speak(eff.say, { sessionId, name, onEnd: opts.then });
  } else if (opts.then) window.setTimeout(opts.then, 300);
}

/** The button and the shortcut. */
export function toggleMute(): Promise<void> {
  return applySpeechControl(isMuted() ? "unmute" : "mute");
}

/**
 * A segment of the room's voice control (Stumm · Kurz · Normal · Alles): the same settings and toast as
 * the spoken control, but no spoken „Okay.“ — the pressed segment is the answer. Clicking „Stumm“ while
 * muted unmutes (back to the level before).
 */
export async function setVoiceLevel(level: VoiceLevel): Promise<void> {
  const st = useApp.getState();
  if (level === "mute" && voiceLevelOf(st.settings) === "mute") {
    await applySpeechControl("unmute", { quiet: true });
    if (st.settings.ttsEnabled === false) await useApp.getState().setSetting("ttsEnabled", true);
    return;
  }
  const changes = levelChanges(st.settings, level);
  if (Object.keys(changes).length === 0) return;
  for (const [k, v] of Object.entries(changes)) await useApp.getState().setSetting(k, v);
  useApp.getState().toast(controlEffect(controlOfLevel(level), st.settings.voiceLanguage === "en").toast, "ok");
  if (level === "mute") {
    stopFillers();
    stopSpeaking();
    playSfx("standby");
  }
}

/** A short typed sentence in a chat („sei still“, „sprich weniger“): true when it was such a control. */
export function typedSpeechControl(text: string, sessionId?: string | null): boolean {
  const cmd = speechControl(text, names());
  if (!cmd) return false;
  void applySpeechControl(cmd, { sessionId });
  return true;
}

/** A whole spoken utterance (dictation, conversation, wake word): the control, or null. */
export function spokenSpeechControl(text: string): SpeechControl | null {
  return speechControl(text, names());
}
