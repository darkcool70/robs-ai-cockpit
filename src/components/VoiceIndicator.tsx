import { Loader2, Mic, X } from "lucide-react";
import { useApp } from "../store";
import { cancelDictation, stopDictation, voiceChoices } from "../lib/voice";
import { cx } from "./ui";

/** Floating pill while dictating: target, input level, how to finish, and which sessions you can switch to. */
export function VoiceIndicator() {
  const v = useApp((s) => s.voice);
  const name = useApp((s) => (v.target ? s.sessions[v.target]?.name : null));
  const picking = useApp((s) => s.settings.voicePickWhileRecording !== false);
  // Re-read on every render: panes / sessions may change while recording.
  useApp((s) => s.panes);
  if (v.state === "idle") return null;
  const level = Math.min(1, v.level * 12);
  const choices = v.state === "recording" && picking ? voiceChoices() : [];
  return (
    <div className="fixed bottom-9 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {choices.length > 1 && (
        <div className="flex max-w-[80vw] flex-wrap justify-center gap-1 rounded-lg border border-line-strong bg-panel/95 px-2 py-1.5 text-[11.5px] shadow-2xl">
          {choices.map((c) => (
            <button
              key={c.id}
              onClick={() => useApp.getState().setVoice({ ...useApp.getState().voice, target: c.id })}
              className={cx("inline-flex max-w-[180px] items-center gap-1 rounded border px-1.5 py-0.5", c.id === v.target ? "border-err/70 bg-err/15 text-fg" : "border-line text-muted hover:text-fg")}
            >
              <b className="font-mono">{c.n}</b><span className="truncate">{c.name}</span>
            </button>
          ))}
          <span className="self-center px-1 text-[10.5px] text-faint">1–8 / ← → switch · Enter sends</span>
        </div>
      )}
      <div className="flex items-center gap-3 rounded-full border border-line-strong bg-panel/95 px-4 py-2 text-[12.5px] shadow-2xl">
        {v.state === "recording" ? (
          <>
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-err opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-err" />
            </span>
            <span>
              Listening → <b>{name ?? "session"}</b>
            </span>
            <span className="flex h-3 w-24 items-end gap-px" aria-hidden>
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className={`w-full rounded-sm ${i / 12 < level ? "bg-ok" : "bg-hover"}`} style={{ height: `${30 + i * 6}%` }} />
              ))}
            </span>
            <span className="text-[11px] text-faint">release / tap again to finish · Esc cancels</span>
            <button className="rounded-full bg-err/15 px-2 py-0.5 text-[11.5px] text-err hover:bg-err/25" onClick={() => void stopDictation()}>
              <Mic size={11} className="mr-1 inline" />Done
            </button>
            <button className="text-faint hover:text-fg" title="Cancel" onClick={() => void cancelDictation()}><X size={13} /></button>
          </>
        ) : (
          <>
            <Loader2 size={14} className="animate-spin text-accent" />
            <span>Transcribing for <b>{name ?? "session"}</b>…</span>
          </>
        )}
      </div>
    </div>
  );
}
