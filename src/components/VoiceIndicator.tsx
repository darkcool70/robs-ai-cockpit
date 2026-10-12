import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Mic, PhoneOff, Send, Volume2, X } from "lucide-react";
import { useApp } from "../store";
import { FIELD_TARGET, cancelDictation, holdSending, sendNow, stopDictation, voiceChoices } from "../lib/voice";
import { outputLevel, stopSpeaking, stopTalk } from "../lib/tts";
import { assistantOf } from "../lib/assistants";
import { useWake } from "../lib/wake";
import { AssistantAvatar } from "./Avatar";
import { MuteButton } from "./MuteButton";
import { cx } from "./ui";

const BARS = 40;
type Phase = "listening" | "transcribing" | "sending" | "speaking" | "thinking";
const PALETTE: Record<Phase, { a: string; b: string; label: string }> = {
  listening: { a: "#38bdf8", b: "#a78bfa", label: "Listening" },
  transcribing: { a: "#a78bfa", b: "#f472b6", label: "Understanding" },
  sending: { a: "#fbbf24", b: "#38bdf8", label: "Sending" },
  speaking: { a: "#34d399", b: "#38bdf8", label: "Speaking" },
  thinking: { a: "#a78bfa", b: "#38bdf8", label: "Thinking" },
};

/** Level of the voice that is speaking, sampled every animation frame while it speaks. */
function useOutputLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 33) {
        last = t;
        setLevel(outputLevel());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return level;
}

/**
 * Voice overlay: a glowing orb that reacts to your voice while you dictate, swirls while Whisper
 * transcribes, counts down before sending and pulses with the voice while an answer is read aloud.
 * Lower third of the screen, above the dock.
 */
export function VoiceIndicator() {
  const v = useApp((s) => s.voice);
  const speaking = useApp((s) => s.speaking);
  const talk = useApp((s) => s.talkSession);
  const sessions = useApp((s) => s.sessions);
  const assistants = useApp((s) => s.assistants);
  const picking = useApp((s) => s.settings.voicePickWhileRecording !== false);
  useApp((s) => s.panes); // re-read the pane numbers while recording
  const wakeHeard = useWake((s) => s.heard);
  const history = useRef<number[]>(Array(BARS).fill(0));

  // In a conversation, the time between your sentence and the answer is visible: it is thinking.
  const talkRt = talk ? sessions[talk]?.runtime : undefined;
  // (not while it works on news nobody asked about — that answer stays silent text)
  const thinking = !!talk && v.state === "idle" && !speaking && !!talkRt?.running && (talkRt.status === "working" || !!talkRt.pendingInput) && !/^\s*📡 Event/u.test(talkRt.lastPrompt ?? "");
  const phase: Phase | null =
    v.state === "recording" ? "listening" : v.state === "transcribing" ? "transcribing" : v.state === "sending" ? "sending" : speaking ? "speaking" : thinking ? "thinking" : null;
  const out = useOutputLevel(phase === "speaking");
  // The wake word was heard: the backend keeps listening to the rest of the sentence.
  if (!phase && wakeHeard && Date.now() - wakeHeard < 25_000) {
    const op = assistants.find((x) => x.power === "operator");
    return (
      <div className="pointer-events-none fixed bottom-9 left-1/2 z-[70] -translate-x-1/2">
        <div className="voice-panel flex items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5" style={{ "--va": "#38bdf8", "--vb": "#a78bfa" } as CSSProperties}>
          <div className="relative h-11 w-11 shrink-0">
            <div className="voice-glow voice-breathe absolute inset-[-45%] rounded-full" />
            <div className="voice-wave absolute inset-0 rounded-full" />
            <div className="voice-core absolute inset-[4px] grid place-items-center overflow-hidden rounded-full">
              {op ? <AssistantAvatar avatar={op.avatar} color={op.color} mood="waiting" size={32} /> : <Mic size={16} className="text-white/90" />}
            </div>
          </div>
          <span className="text-[12.5px] font-semibold text-white">{op?.name ?? "Listening"}</span>
          <span className="text-[11.5px] text-white/55">I'm listening — finish your sentence</span>
        </div>
      </div>
    );
  }
  if (!phase) {
    history.current = Array(BARS).fill(0);
    return null;
  }
  const level = phase === "listening" ? Math.min(1, v.level * 12) : phase === "speaking" ? out : 0;
  if (phase === "listening" || phase === "speaking") history.current = [...history.current.slice(1), level];

  const targetId = phase === "speaking" ? speaking?.sessionId ?? null : v.target;
  const isField = targetId === FIELD_TARGET;
  const name = isField ? "text field" : phase === "speaking" ? speaking?.name : targetId ? sessions[targetId]?.name : null;
  const assistant = targetId && !isField ? assistantOf(assistants, targetId) : null;
  const choices = phase === "listening" && picking && !isField && !talk ? voiceChoices() : [];
  const c = PALETTE[phase];
  const talking = !!talk && (talk === targetId || phase === "speaking");
  const live = phase === "listening" || phase === "speaking";

  // Thinking: slim bar, breathing orb, what it is doing right now.
  if (phase === "thinking") {
    const who = talk ? sessions[talk] : undefined;
    const a = talk ? assistantOf(assistants, talk) : undefined;
    return (
      <div className="pointer-events-none fixed bottom-9 left-1/2 z-[70] -translate-x-1/2">
        <div className="voice-panel pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pr-3 pl-1.5" style={{ "--va": c.a, "--vb": c.b } as CSSProperties}>
          <div className="relative h-11 w-11 shrink-0">
            <div className="voice-glow voice-breathe absolute inset-[-45%] rounded-full" />
            <div className="voice-ring voice-ring-fast absolute inset-0 rounded-full" />
            <div className="voice-core absolute inset-[4px] grid place-items-center overflow-hidden rounded-full">
              {a ? <AssistantAvatar avatar={a.avatar} color={a.color} mood="thinking" size={32} /> : <Mic size={16} className="text-white/90" />}
            </div>
          </div>
          <span className="max-w-[160px] truncate text-[12.5px] font-semibold text-white">{who?.name ?? "Assistant"}</span>
          <span className="typing-dots text-violet-300"><i /><i /><i /></span>
          <span className="max-w-[260px] truncate text-[11.5px] text-white/55">{who?.runtime?.currentActivity ?? "thinking…"}</span>
          <MuteButton />
          <button className="voice-btn-ghost text-rose-300" title="End the conversation" onClick={() => { stopTalk(); void cancelDictation(); }}>
            <PhoneOff size={12} />
          </button>
        </div>
      </div>
    );
  }

  // Reading aloud: a slim bar at the bottom, so the work on screen (board, terminals) stays visible.
  if (phase === "speaking") {
    return (
      <div className="pointer-events-none fixed bottom-9 left-1/2 z-[70] -translate-x-1/2">
        <div
          className="voice-panel pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pr-2 pl-1.5"
          style={{ "--va": c.a, "--vb": c.b } as CSSProperties}
        >
          <div className="relative h-11 w-11 shrink-0">
            <div className="voice-glow absolute inset-[-45%] rounded-full" style={{ transform: `scale(${1 + level * 0.6})` }} />
            <div className="voice-ring absolute inset-0 rounded-full" />
            <div className="voice-core absolute inset-[4px] grid place-items-center overflow-hidden rounded-full" style={{ transform: `scale(${1 + level * 0.1})` }}>
              {assistant ? <AssistantAvatar avatar={assistant.avatar} color={assistant.color} mood="working" size={32} /> : <Volume2 size={16} className="text-white/90" />}
            </div>
          </div>
          <span className="max-w-[180px] truncate text-[12.5px] font-semibold text-white">{name ?? "Assistant"}</span>
          <div className="flex h-7 items-center gap-[2px]" aria-hidden>
            {Array.from({ length: 18 }, (_, i) => {
              const d = Math.floor(Math.abs(i - 8.5));
              return <span key={i} className="voice-bar w-[3px] rounded-full" style={{ height: `${Math.max(14, 14 + (history.current[BARS - 1 - d * 2] ?? 0) * 86)}%` }} />;
            })}
          </div>
          {talking && <span className="text-[10.5px] tracking-wider text-white/40 uppercase">conversation</span>}
          <button className="voice-btn-ghost" onClick={() => stopSpeaking()}>Skip</button>
          <MuteButton />
          {talking && (
            <button className="voice-btn-ghost text-rose-300" title="End the conversation" onClick={() => { stopTalk(); void cancelDictation(); }}>
              <PhoneOff size={12} />
            </button>
          )}
        </div>
      </div>
    );
  }

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
          <div className={cx("voice-ring absolute inset-0 rounded-full", (phase === "transcribing" || phase === "sending") && "voice-ring-fast")} />
          <div className="voice-core absolute inset-[14px] grid place-items-center overflow-hidden rounded-full" style={{ transform: `scale(${1 + level * 0.12})` }}>
            {assistant ? (
              <AssistantAvatar avatar={assistant.avatar} color={assistant.color} mood={phase === "transcribing" ? "thinking" : "waiting"} size={86} />
            ) : phase === "sending" ? (
              <Send size={32} className="text-white/90 drop-shadow" />
            ) : (
              <Mic size={34} className="text-white/90 drop-shadow" />
            )}
          </div>
        </div>

        <div className="text-[10.5px] font-semibold tracking-[0.32em] uppercase" style={{ color: c.a }}>
          {c.label}
          {talking && " · conversation"}
        </div>
        <div className="mt-1 truncate text-[17px] font-semibold text-white">
          → {name ?? "session"}
        </div>

        {phase === "sending" ? (
          <div className="mx-auto mt-3 max-w-[460px]">
            <p className="line-clamp-3 text-[13.5px] leading-snug text-white/90">“{v.text}”</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                key={v.until}
                className="voice-countdown h-full rounded-full"
                style={{ animationDuration: `${Math.max(0, (v.until ?? 0) - Date.now())}ms` }}
              />
            </div>
          </div>
        ) : (
          /* Waveform */
          <div className="mx-auto mt-3 flex h-12 max-w-[440px] items-center justify-center gap-[3px]" aria-hidden>
            {Array.from({ length: BARS }, (_, i) => {
              // Newest level in the middle, older ones flowing outwards on both sides.
              const d = Math.floor(Math.abs(i - (BARS - 1) / 2));
              const h = live ? 8 + (history.current[BARS - 1 - d * 2] ?? 0) * 92 : undefined;
              return (
                <span
                  key={i}
                  className={cx("voice-bar w-[5px] rounded-full", !live && "voice-bar-idle")}
                  style={{ height: h !== undefined ? `${Math.max(8, h)}%` : undefined, animationDelay: `${(i % 10) * 0.09}s` }}
                />
              );
            })}
          </div>
        )}

        <div className="mt-3 flex items-center justify-center gap-2 text-[11.5px]">
          {phase === "listening" && (
            <>
              <span className="text-white/45">{talking ? "Just talk: pause to send" : "Pause, tap again or release to finish"} · Esc cancels</span>
              <button className="voice-btn" onClick={() => void stopDictation()}><Mic size={11} /> Done</button>
              <button className="voice-btn-ghost" title="Cancel" onClick={() => void cancelDictation()}><X size={13} /></button>
            </>
          )}
          {phase === "transcribing" && <span className="text-white/45">Turning your words into text… · Esc discards</span>}
          {phase === "sending" && (
            <>
              <button className="voice-btn" onClick={() => sendNow()}><Send size={11} /> Send now · Enter</button>
              <button className="voice-btn-ghost" onClick={() => holdSending()}>Keep, don't send · Esc</button>
            </>
          )}
          {talking && <MuteButton />}
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
