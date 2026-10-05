import { useRef, type CSSProperties } from "react";
import { Mic, PhoneOff, Volume2, X } from "lucide-react";
import { useApp } from "../store";
import { FIELD_TARGET, cancelDictation, stopDictation, voiceChoices } from "../lib/voice";
import { stopSpeaking, stopTalk } from "../lib/tts";
import { assistantOf } from "../lib/assistants";
import { AssistantAvatar } from "./Avatar";
import { cx } from "./ui";

const BARS = 40;
type Phase = "listening" | "transcribing" | "speaking";
const PALETTE: Record<Phase, { a: string; b: string; label: string }> = {
  listening: { a: "#38bdf8", b: "#a78bfa", label: "Listening" },
  transcribing: { a: "#a78bfa", b: "#f472b6", label: "Understanding" },
  speaking: { a: "#34d399", b: "#38bdf8", label: "Speaking" },
};

/**
 * Voice overlay: a glowing orb that reacts to your voice while you dictate, swirls while Whisper
 * transcribes and pulses while an answer is read aloud. Lower third of the screen, above the dock.
 */
export function VoiceIndicator() {
  const v = useApp((s) => s.voice);
  const speaking = useApp((s) => s.speaking);
  const talk = useApp((s) => s.talkSession);
  const sessions = useApp((s) => s.sessions);
  const assistants = useApp((s) => s.assistants);
  const picking = useApp((s) => s.settings.voicePickWhileRecording !== false);
  useApp((s) => s.panes); // re-read the pane numbers while recording
  const history = useRef<number[]>(Array(BARS).fill(0));

  const phase: Phase | null = v.state === "recording" ? "listening" : v.state === "transcribing" ? "transcribing" : speaking ? "speaking" : null;
  if (!phase) {
    history.current = Array(BARS).fill(0);
    return null;
  }
  const level = phase === "listening" ? Math.min(1, v.level * 12) : 0;
  if (phase === "listening") history.current = [...history.current.slice(1), level];

  const targetId = phase === "speaking" ? speaking?.sessionId ?? null : v.target;
  const isField = targetId === FIELD_TARGET;
  const name = isField ? "text field" : phase === "speaking" ? speaking?.name : targetId ? sessions[targetId]?.name : null;
  const assistant = targetId && !isField ? assistantOf(assistants, targetId) : null;
  const choices = phase === "listening" && picking && !isField && !talk ? voiceChoices() : [];
  const c = PALETTE[phase];
  const talking = !!talk && (talk === targetId || phase === "speaking");

  return (
    <div className="pointer-events-none fixed bottom-[13vh] left-1/2 z-[70] flex w-[min(560px,92vw)] -translate-x-1/2 flex-col items-center">
      <div
        className="voice-panel pointer-events-auto relative w-full rounded-[28px] px-6 pt-[86px] pb-4 text-center"
        style={{ "--va": c.a, "--vb": c.b } as CSSProperties}
      >
        {/* Orb */}
        <div className="absolute top-0 left-1/2 h-[150px] w-[150px] -translate-x-1/2 -translate-y-1/2">
          <div className="voice-glow absolute inset-[-40%] rounded-full" style={{ transform: `scale(${1 + level * 0.55})` }} />
          <div className="voice-wave absolute inset-0 rounded-full" />
          <div className="voice-wave voice-wave-2 absolute inset-0 rounded-full" />
          <div className={cx("voice-ring absolute inset-0 rounded-full", phase === "transcribing" && "voice-ring-fast")} />
          <div className="voice-core absolute inset-[14px] grid place-items-center overflow-hidden rounded-full" style={{ transform: `scale(${1 + level * 0.12})` }}>
            {assistant ? (
              <AssistantAvatar avatar={assistant.avatar} color={assistant.color} mood={phase === "speaking" ? "working" : phase === "transcribing" ? "thinking" : "waiting"} size={86} />
            ) : (
              phase === "speaking" ? <Volume2 size={34} className="text-white/90 drop-shadow" /> : <Mic size={34} className="text-white/90 drop-shadow" />
            )}
          </div>
        </div>

        <div className="text-[10.5px] font-semibold tracking-[0.32em] uppercase" style={{ color: c.a }}>
          {c.label}
          {talking && " · conversation"}
        </div>
        <div className="mt-1 truncate text-[17px] font-semibold text-white">
          {phase === "speaking" ? name ?? "Assistant" : <>→ {name ?? "session"}</>}
        </div>

        {/* Waveform */}
        <div className="mx-auto mt-3 flex h-12 max-w-[440px] items-center justify-center gap-[3px]" aria-hidden>
          {Array.from({ length: BARS }, (_, i) => {
            // Newest level in the middle, older ones flowing outwards on both sides.
            const d = Math.floor(Math.abs(i - (BARS - 1) / 2));
            const h = phase === "listening" ? 8 + (history.current[BARS - 1 - d * 2] ?? 0) * 92 : undefined;
            return (
              <span
                key={i}
                className={cx("voice-bar w-[5px] rounded-full", phase !== "listening" && "voice-bar-idle")}
                style={{ height: h !== undefined ? `${Math.max(8, h)}%` : undefined, animationDelay: `${(i % 10) * 0.09}s` }}
              />
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 text-[11.5px]">
          {phase === "listening" && (
            <>
              <span className="text-white/45">{talking ? "Just talk: pause to send" : "Pause, tap again or release to finish"} · Esc cancels</span>
              <button className="voice-btn" onClick={() => void stopDictation()}><Mic size={11} /> Done</button>
              <button className="voice-btn-ghost" title="Cancel" onClick={() => void cancelDictation()}><X size={13} /></button>
            </>
          )}
          {phase === "transcribing" && <span className="text-white/45">Turning your words into text… · Esc discards</span>}
          {phase === "speaking" && (
            <>
              <span className="text-white/45">{talking ? "I'll listen again when I'm done" : "Reading the answer aloud"}</span>
              <button className="voice-btn-ghost" onClick={() => stopSpeaking()}>Skip</button>
            </>
          )}
          {talking && (
            <button className="voice-btn-ghost text-rose-300" onClick={() => { stopTalk(); void cancelDictation(); }}>
              <PhoneOff size={12} /> End
            </button>
          )}
        </div>
      </div>
      {choices.length > 1 && (
        <div className="pointer-events-auto mt-3 flex max-w-full flex-wrap justify-center gap-1 rounded-xl border border-white/10 bg-[#070b12]/85 px-2 py-1.5 text-[11.5px] shadow-2xl backdrop-blur-md">
          {choices.map((ch) => (
            <button
              key={ch.id}
              onClick={() => useApp.getState().setVoice({ ...useApp.getState().voice, target: ch.id })}
              className={cx(
                "inline-flex max-w-[180px] items-center gap-1 rounded border px-1.5 py-0.5",
                ch.id === v.target ? "border-sky-400/70 bg-sky-400/15 text-fg" : "border-white/10 text-muted hover:text-fg",
              )}
            >
              <b className="font-mono">{ch.n}</b>
              <span className="truncate">{ch.name}</span>
            </button>
          ))}
          <span className="self-center px-1 text-[10.5px] text-faint">1–8 / ← → switch · Enter sends</span>
        </div>
      )}

    </div>
  );
}
