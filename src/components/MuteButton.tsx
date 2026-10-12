import { Volume2, VolumeX } from "lucide-react";
import { useApp } from "../store";
import { toggleMute } from "../lib/mute";
import { cx } from "./ui";

/** Tooltip: muted means the output only — say so. */
export function muteTitle(muted: boolean, en: boolean): string {
  if (en) {
    return muted
      ? "Muted: nothing is spoken — answers stay as text. The microphone, “Talk” and the wake word still work. Click, Ctrl+Shift+M or say “speak again”."
      : "Mute the voice (Ctrl+Shift+M or say “be quiet”): answers, fillers and announcements stay as text only. The microphone keeps working.";
  }
  return muted
    ? "Stumm: es wird nichts gesprochen — Antworten kommen als Text. Mikrofon, „Sprechen“ und das Weckwort funktionieren weiter. Klick, Strg+Umschalt+M oder sag „sprich wieder“."
    : "Stimme stummschalten (Strg+Umschalt+M oder sag „sei still“): Antworten, Zwischenrufe und Ansagen nur noch als Text. Das Mikrofon hört weiter zu.";
}

/**
 * One-click mute in the voice pill at the bottom. (The assistant room has the full Stumm · Kurz · Normal ·
 * Alles control instead — VoiceLevelControl.)
 */
export function MuteButton({ className }: { className?: string }) {
  const muted = useApp((s) => s.settings.voiceMuted === true);
  const en = useApp((s) => s.settings.voiceLanguage === "en");
  const title = muteTitle(muted, en);
  return (
    <button
      className={cx("voice-btn-ghost", muted && "text-amber-300", className)}
      title={title}
      aria-label={title}
      aria-pressed={muted}
      onClick={() => void toggleMute()}
    >
      {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
    </button>
  );
}
