import { AudioLines, Volume1, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { useApp } from "../store";
import { setVoiceLevel } from "../lib/mute";
import { VOICE_LEVELS, levelLabel, levelTitle, voiceLevelOf, type VoiceLevel } from "../lib/voiceLevel";
import { cx } from "./ui";

const ICON: Record<VoiceLevel, LucideIcon> = { mute: VolumeX, short: Volume1, normal: Volume2, all: AudioLines };

/**
 * How much the assistant talks, one click: Stumm · Kurz · Normal · Alles. The same state as Ctrl+Shift+M,
 * „sei still“ / „sprich weniger“ / „sag mir alles“ / „lies alles vor“ and the Voice tab. Labels give way to
 * icons in a narrow room (the parent sets `@container`); the tooltips say exactly what each one does.
 */
export function VoiceLevelControl({ className }: { className?: string }) {
  // primitive selector: the segment, a string
  const level = useApp((s) => voiceLevelOf(s.settings));
  const en = useApp((s) => s.settings.voiceLanguage === "en");
  return (
    <div
      role="group"
      aria-label={en ? "How much it talks" : "Wie viel gesprochen wird"}
      data-testid="voice-level"
      className={cx("inline-flex h-7 shrink-0 items-stretch rounded-md border border-line-strong bg-bg/60 p-0.5", className)}
    >
      {VOICE_LEVELS.map((l) => {
        const on = l === level;
        const Icon = ICON[l];
        const title = levelTitle(l, en, on);
        return (
          <button
            key={l}
            type="button"
            data-level={l}
            title={title}
            aria-label={title}
            aria-pressed={on}
            onClick={() => void setVoiceLevel(l)}
            className={cx(
              "inline-flex items-center gap-1 rounded-[5px] px-2 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              on
                ? l === "mute"
                  ? "bg-warn/15 text-warn shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-warn)_45%,transparent)]"
                  : "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            <Icon size={12} aria-hidden />
            <span className="@max-[760px]:hidden">{levelLabel(l, en)}</span>
          </button>
        );
      })}
    </div>
  );
}
