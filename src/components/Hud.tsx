import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, CornerDownLeft, ExternalLink, Loader2, Mic, Repeat, Send, Sparkles, Volume2, X, XCircle } from "lucide-react";
import { api, type HudNote } from "../lib/api";
import type { OrbState } from "../lib/notify";
import { cx, ProviderMark } from "./ui";
import { AssistantAvatar, type Mood } from "./Avatar";

type Note = HudNote & { sound?: boolean; timeoutSec?: number; expires: number; sent?: boolean };
interface VoiceState {
  state: "idle" | "recording" | "transcribing" | "sending" | "speaking";
  /** "sending": the recognised text. */
  text?: string | null;
  name: string | null;
  level: number;
  show: boolean;
  choices?: { n: number; name: string; active: boolean }[];
}

const KIND = {
  done: { icon: CheckCircle2, tone: "text-ok", bar: "bg-ok", label: "Ready for your next command" },
  input: { icon: AlertTriangle, tone: "text-warn", bar: "bg-warn", label: "Needs your input" },
  limit: { icon: AlertTriangle, tone: "text-warn", bar: "bg-warn", label: "Usage limit reached" },
  loop: { icon: Repeat, tone: "text-accent", bar: "bg-accent", label: "Loop finished" },
  failed: { icon: XCircle, tone: "text-err", bar: "bg-err", label: "Session ended with an error" },
  goal: { icon: Sparkles, tone: "text-ok", bar: "bg-ok", label: "Goal reached" },
} as const;

function chime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    for (const [i, f] of [660, 880].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.3);
    }
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* no audio */
  }
}

/** The heads-up window's whole UI (rendered when the page is opened as #hud). */
export function Hud() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [voice, setVoice] = useState<VoiceState>({ state: "idle", name: null, level: 0, show: false });
  const [hover, setHover] = useState(false);
  const [orb, setOrb] = useState<OrbState | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offs = [
      listen<Note>("hud-notify", (e) => {
        const n = e.payload;
        if (n.sound) chime();
        setNotes((cur) => [...cur.filter((x) => x.sessionId !== n.sessionId), { ...n, expires: Date.now() + (n.timeoutSec ?? 20) * 1000 }].slice(-4));
      }),
      listen<{ sessionId: string }>("hud-sent", (e) => {
        setNotes((cur) => cur.map((n) => (n.sessionId === e.payload.sessionId ? { ...n, sent: true, expires: Date.now() + 1500 } : n)));
      }),
      listen<VoiceState>("hud-voice", (e) => setVoice(e.payload)),
      listen<OrbState>("hud-orb", (e) => setOrb(e.payload)),
      listen<{ level: number }>("stt-level", (e) => setVoice((v) => ({ ...v, level: e.payload.level }))),
    ];
    return () => offs.forEach((p) => void p.then((f) => f()));
  }, []);

  // Expire notes (paused while the pointer is over the window).
  useEffect(() => {
    if (hover || !notes.length) return;
    const t = window.setInterval(() => setNotes((cur) => cur.filter((n) => n.expires > Date.now())), 500);
    return () => window.clearInterval(t);
  }, [hover, notes.length]);
  useEffect(() => {
    if (!hover) setNotes((cur) => cur.map((n) => ({ ...n, expires: Math.max(n.expires, Date.now() + 4000) })));
  }, [hover]);

  const showVoice = voice.show && voice.state !== "idle";
  const showOrb = !!orb?.show;
  useLayoutEffect(() => {
    const any = notes.length || showVoice || showOrb;
    const h = any ? Math.ceil(box.current?.getBoundingClientRect().height ?? 0) + 4 : 0;
    // the orb alone is small: the window shrinks to it (no invisible strip over other programs)
    const w = !notes.length && !showVoice && showOrb ? (hover ? 300 : 64) : undefined;
    void api.hudLayout(h, w).catch(() => {});
  }, [notes, showVoice, voice.state, voice.choices, showOrb, orb, hover]);

  const act = (action: "show" | "reply" | "dictate", sessionId: string, text?: string) => void emit("hud-action", { action, sessionId, text });
  const dismiss = (id: string) => setNotes((cur) => cur.filter((n) => n.id !== id));

  return (
    <div ref={box} className="flex flex-col items-end gap-2 p-0.5" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {notes.map((n) => {
        const k = KIND[n.kind];
        const Icon = k.icon;
        return (
          <div key={n.id} className="relative w-full overflow-hidden rounded-lg border border-line-strong bg-panel text-[12.5px] shadow-2xl">
            <span className={cx("absolute inset-y-0 left-0 w-1", k.bar)} />
            <div className="flex items-start gap-2 px-3 pt-2.5 pl-4">
              {n.avatar ? (
                <AssistantAvatar avatar={n.avatar} color={n.color} mood={(n.mood as Mood) ?? "idle"} size={34} className="mt-0.5" />
              ) : (
                <Icon size={15} className={cx("mt-0.5 shrink-0", k.tone)} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {!n.avatar && <ProviderMark provider={n.provider} />}
                  <b className="truncate">{n.title}</b>
                  <span className={cx("shrink-0 text-[11px]", k.tone)}>{k.label}</span>
                </div>
                {n.subtitle && <div className="truncate text-[11px] text-faint">{n.subtitle}</div>}
              </div>
              <button className="text-faint hover:text-fg" title="Dismiss" onClick={() => dismiss(n.id)}><X size={14} /></button>
            </div>
            {n.message && <p className="line-clamp-6 px-4 pt-1.5 whitespace-pre-wrap text-muted">{n.message}</p>}
            {n.sent ? (
              <div className="flex items-center gap-1.5 px-4 py-2.5 text-ok"><CheckCircle2 size={13} /> Sent</div>
            ) : (
              <ReplyRow onReply={(t) => act("reply", n.sessionId, t)} onMic={() => act("dictate", n.sessionId)} onShow={() => { act("show", n.sessionId); dismiss(n.id); }} />
            )}
          </div>
        );
      })}
      {showVoice && voice.state === "recording" && (voice.choices?.length ?? 0) > 1 && (
        <div className="w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[11.5px] shadow-2xl">
          <div className="flex flex-wrap gap-1">
            {voice.choices!.map((c) => (
              <span key={c.n} className={cx("inline-flex max-w-[170px] items-center gap-1 rounded border px-1.5 py-0.5", c.active ? "border-err/70 bg-err/15 text-fg" : "border-line text-muted")}>
                <b className="font-mono">{c.n}</b><span className="truncate">{c.name}</span>
              </span>
            ))}
          </div>
          <div className="mt-1 text-[10.5px] text-faint">1–8 / ← → switch · Enter sends · Esc cancels</div>
        </div>
      )}
      {showVoice && (
        <div className="flex w-full items-center gap-2.5 rounded-full border border-line-strong bg-panel px-4 py-2 text-[12.5px] shadow-2xl">
          {voice.state === "recording" ? (
            <>
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-err opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-err" />
              </span>
              <span className="min-w-0 flex-1 truncate">Listening → <b>{voice.name ?? "session"}</b></span>
              <span className="flex h-3 w-16 items-end gap-px">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className={cx("w-full rounded-sm", i / 8 < Math.min(1, voice.level * 12) ? "bg-ok" : "bg-hover")} style={{ height: `${35 + i * 8}%` }} />
                ))}
              </span>
            </>
          ) : voice.state === "sending" ? (
            <>
              <Send size={14} className="shrink-0 text-warn" />
              <span className="min-w-0 flex-1 truncate">→ <b>{voice.name ?? "session"}</b>: “{voice.text}” <span className="text-faint">· Esc keeps it</span></span>
            </>
          ) : voice.state === "speaking" ? (
            <>
              <Volume2 size={14} className="shrink-0 animate-pulse text-ok" />
              <span className="truncate"><b>{voice.name ?? "Assistant"}</b> is speaking…</span>
            </>
          ) : (
            <>
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="truncate">Transcribing for <b>{voice.name ?? "session"}</b>…</span>
            </>
          )}
        </div>
      )}
      {showOrb && orb && (
        <button
          className="flex items-center gap-2"
          title="Open the cockpit"
          onClick={() => void emit("hud-action", { action: "open", sessionId: "" })}
        >
          {hover && (
            <span className="max-w-[230px] rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-left text-[11.5px] shadow-2xl">
              {orb.agents.map((a) => (
                <span key={a.name} className="flex gap-1.5 truncate"><b className="truncate">{a.name}</b><span className="truncate text-faint">{a.status}</span></span>
              ))}
            </span>
          )}
          <span className={cx("hud-orb relative grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full", `hud-orb-${orb.mood}`)}>
            <span className="text-[13px] font-bold text-white drop-shadow">{orb.waiting || orb.working || orb.total}</span>
          </span>
        </button>
      )}
    </div>
  );
}

function ReplyRow({ onReply, onMic, onShow }: { onReply: (t: string) => void; onMic: () => void; onShow: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex items-center gap-1.5 px-3 py-2.5 pl-4">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            onReply(text.trim());
            setText("");
          }
        }}
        placeholder="Reply… (Enter sends)"
        className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
      />
      {text.trim() && (
        <button className="inline-flex h-7 w-7 items-center justify-center rounded border border-accent/60 bg-accent/15 text-accent" title="Send" onClick={() => { onReply(text.trim()); setText(""); }}>
          <CornerDownLeft size={13} />
        </button>
      )}
      <button className="inline-flex h-7 w-7 items-center justify-center rounded border border-line-strong hover:bg-hover" title="Dictate a reply" onClick={onMic}>
        <Mic size={13} />
      </button>
      <button className="inline-flex h-7 items-center gap-1 rounded border border-line-strong px-2 hover:bg-hover" title="Open this session in Robs AI Cockpit" onClick={onShow}>
        <ExternalLink size={12} /> Open
      </button>
    </div>
  );
}
