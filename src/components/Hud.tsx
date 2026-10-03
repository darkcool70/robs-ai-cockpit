import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, CornerDownLeft, ExternalLink, Loader2, Mic, Repeat, Sparkles, X, XCircle } from "lucide-react";
import { api, type HudNote } from "../lib/api";
import { cx, ProviderMark } from "./ui";
import { AssistantAvatar, type Mood } from "./Avatar";

type Note = HudNote & { sound?: boolean; timeoutSec?: number; expires: number; sent?: boolean };
interface VoiceState {
  state: "idle" | "recording" | "transcribing";
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
  useLayoutEffect(() => {
    const h = notes.length || showVoice ? Math.ceil(box.current?.getBoundingClientRect().height ?? 0) + 4 : 0;
    void api.hudLayout(h).catch(() => {});
  }, [notes, showVoice, voice.state, voice.choices]);

  const act = (action: "show" | "reply" | "dictate", sessionId: string, text?: string) => void emit("hud-action", { action, sessionId, text });
  const dismiss = (id: string) => setNotes((cur) => cur.filter((n) => n.id !== id));

  return (
    <div ref={box} className="flex flex-col gap-2 p-0.5" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {notes.map((n) => {
        const k = KIND[n.kind];
        const Icon = k.icon;
        return (
          <div key={n.id} className="relative overflow-hidden rounded-lg border border-line-strong bg-panel text-[12.5px] shadow-2xl">
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
        <div className="rounded-lg border border-line-strong bg-panel px-3 py-2 text-[11.5px] shadow-2xl">
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
        <div className="flex items-center gap-2.5 rounded-full border border-line-strong bg-panel px-4 py-2 text-[12.5px] shadow-2xl">
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
          ) : (
            <>
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="truncate">Transcribing for <b>{voice.name ?? "session"}</b>…</span>
            </>
          )}
        </div>
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
