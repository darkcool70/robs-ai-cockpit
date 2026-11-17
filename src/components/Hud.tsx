import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, CornerDownLeft, Loader2, Mic, MessageSquare, Repeat, Send, Sparkles, Volume2, X, XCircle } from "lucide-react";
import { api, type HudNote } from "../lib/api";
import type { OrbState } from "../lib/notify";
import {
  AFTER_HOVER_MS,
  LEAVE_MS,
  ORB_SIZE,
  addNote,
  autoDismissMs,
  detailLine,
  fullText,
  orbSignature,
  resolveTheme,
  stackHeight,
  visibleNotes,
  windowHeight,
  windowWidth,
} from "../lib/hudModel";
import { cx } from "./ui";
import { AssistantAvatar, type Mood } from "./Avatar";

type Note = HudNote & { sound?: boolean; timeoutSec?: number; expires: number; sent?: boolean; leaving?: boolean };
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
  done: { icon: CheckCircle2, tone: "text-ok", bar: "bg-ok", label: "Done" },
  input: { icon: AlertTriangle, tone: "text-warn", bar: "bg-warn", label: "Needs you" },
  limit: { icon: AlertTriangle, tone: "text-warn", bar: "bg-warn", label: "Limit reached" },
  loop: { icon: Repeat, tone: "text-accent", bar: "bg-accent", label: "Loop done" },
  failed: { icon: XCircle, tone: "text-err", bar: "bg-err", label: "Failed" },
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
  /** Signature of the orb state the user closed: it stays away until something changes. */
  const [orbClosed, setOrbClosed] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [themeSetting, setThemeSetting] = useState<unknown>("dark");
  const [tick, setTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // The hud is its own webview: read the theme from the persisted settings (also on every event,
  // which is cheap and picks up a change made in Settings).
  const loadTheme = useCallback(() => void api.settingsGet().then((s) => setThemeSetting(s.theme)).catch(() => {}), []);
  useEffect(() => {
    loadTheme();
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(themeSetting, !!mq?.matches); };
    apply();
    mq?.addEventListener?.("change", apply);
    return () => mq?.removeEventListener?.("change", apply);
  }, [themeSetting, loadTheme]);

  /** Fade the notes out, then remove them for real. */
  const leave = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setNotes((cur) => cur.map((n) => (ids.includes(n.id) ? { ...n, leaving: true } : n)));
    window.setTimeout(() => setNotes((cur) => cur.filter((n) => !ids.includes(n.id))), LEAVE_MS);
  }, []);

  useEffect(() => {
    const offs = [
      listen<Note>("hud-notify", (e) => {
        const n = e.payload;
        if (n.sound) chime();
        loadTheme();
        setNotes((cur) => addNote(cur, { ...n, leaving: false, expires: Date.now() + autoDismissMs(n.kind, n.timeoutSec) }));
      }),
      listen<{ sessionId: string }>("hud-sent", (e) => {
        setReplyFor(null);
        setNotes((cur) => cur.map((n) => (n.sessionId === e.payload.sessionId ? { ...n, sent: true, expires: Date.now() + 1500 } : n)));
      }),
      listen<VoiceState>("hud-voice", (e) => setVoice(e.payload)),
      listen<OrbState>("hud-orb", (e) => { setOrb(e.payload); loadTheme(); }),
      listen<{ level: number }>("stt-level", (e) => setVoice((v) => ({ ...v, level: e.payload.level }))),
    ];
    return () => offs.forEach((p) => void p.then((f) => f()));
  }, [loadTheme]);

  // Every note goes away by itself (paused while the pointer is over the window or a reply is being typed).
  useEffect(() => {
    if (hover || !notes.length) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      leave(notes.filter((n) => !n.leaving && n.expires <= now && n.id !== replyFor).map((n) => n.id));
    }, 500);
    return () => window.clearInterval(t);
  }, [hover, notes, replyFor, leave]);
  useEffect(() => {
    if (!hover) setNotes((cur) => cur.map((n) => ({ ...n, expires: Math.max(n.expires, Date.now() + AFTER_HOVER_MS) })));
  }, [hover]);

  const { visible, more } = visibleNotes(notes);
  const showVoice = voice.show && voice.state !== "idle";
  // The orb is the calm default: it steps aside while real notifications or the voice pill are up.
  const orbSig = orb ? orbSignature(orb) : null;
  const showOrb = !!orb?.show && orbSig !== orbClosed && !notes.length && !showVoice;

  // Re-measure when the content changes size by itself (avatar loads, text wraps).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The window is exactly as big as what is visible: no invisible strip over other programs.
  useLayoutEffect(() => {
    const any = notes.length > 0 || showVoice || showOrb;
    const measured = box.current?.getBoundingClientRect().height ?? 0;
    const h = any ? windowHeight(measured > 0 ? measured : stackHeight(visible.length, more)) : 0;
    const w = windowWidth({ cards: notes.length > 0, voice: showVoice, orbHover: hover });
    void api.hudLayout(h, w).catch(() => {});
  }, [notes, visible.length, more, showVoice, voice.state, voice.choices, showOrb, orb, hover, replyFor, tick]);

  const act = (action: "show" | "reply" | "dictate", sessionId: string, text?: string) => void emit("hud-action", { action, sessionId, text });
  const live = notes.filter((n) => !n.leaving);

  return (
    <div ref={box} className="flex flex-col items-end gap-1.5 p-2" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {(more > 0 || live.length > 1) && (
        <div className="hud-in flex h-[18px] w-full items-center justify-between px-1 text-[10.5px] text-faint">
          <span>{more > 0 ? `+${more} more` : ""}</span>
          <button className="rounded px-1 hover:bg-hover hover:text-fg" title="Dismiss all notifications" onClick={() => leave(notes.map((n) => n.id))}>
            Clear all
          </button>
        </div>
      )}
      {visible.map((n) => {
        const k = KIND[n.kind];
        const Icon = k.icon;
        const open = () => { act("show", n.sessionId); leave([n.id]); };
        return (
          <div
            key={n.id}
            role="button"
            tabIndex={0}
            title={fullText(n)}
            onClick={open}
            onKeyDown={(e) => { if (e.key === "Enter") open(); else if (e.key === "Escape") leave([n.id]); }}
            className={cx("hud-card group relative w-full cursor-pointer overflow-hidden text-[12px]", n.leaving ? "hud-out" : "hud-in")}
          >
            <span className={cx("absolute inset-y-0 left-0 w-[3px]", k.bar)} />
            <div className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              {n.avatar ? (
                <AssistantAvatar avatar={n.avatar} color={n.color} mood={(n.mood as Mood) ?? "idle"} size={26} />
              ) : (
                <Icon size={14} className={cx("shrink-0", k.tone)} />
              )}
              <div className="min-w-0 flex-1 leading-[1.25]">
                <div className="flex items-baseline gap-1.5">
                  <b className="truncate">{n.title}</b>
                  <span className={cx("shrink-0 text-[10.5px]", k.tone)}>{k.label}</span>
                </div>
                <div className={cx("truncate text-[11px]", n.sent ? "text-ok" : "text-muted")}>{n.sent ? "Sent" : detailLine(n)}</div>
              </div>
              <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                {!n.sent && (
                  <>
                    <button className="hud-btn opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title="Reply" onClick={() => setReplyFor(replyFor === n.id ? null : n.id)}>
                      <MessageSquare size={12} />
                    </button>
                    <button className="hud-btn opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title="Dictate a reply" onClick={() => act("dictate", n.sessionId)}>
                      <Mic size={12} />
                    </button>
                  </>
                )}
                <button className="hud-btn" title="Dismiss" aria-label="Dismiss" onClick={() => leave([n.id])}>
                  <X size={13} />
                </button>
              </div>
            </div>
            {replyFor === n.id && !n.sent && (
              <ReplyRow onReply={(t) => act("reply", n.sessionId, t)} onClose={() => setReplyFor(null)} />
            )}
          </div>
        );
      })}
      {showVoice && voice.state === "recording" && (voice.choices?.length ?? 0) > 1 && (
        <div className="hud-card hud-in w-full px-2.5 py-1.5 text-[11px]">
          <div className="flex flex-wrap gap-1">
            {voice.choices!.map((c) => (
              <span key={c.n} className={cx("inline-flex max-w-[150px] items-center gap-1 rounded border px-1.5 py-px", c.active ? "border-err/70 bg-err/15 text-fg" : "border-line text-muted")}>
                <b className="font-mono">{c.n}</b><span className="truncate">{c.name}</span>
              </span>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-faint">1–8 / ← → switch · Enter sends · Esc cancels</div>
        </div>
      )}
      {showVoice && (
        <div className="hud-card hud-in flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-[12px]">
          {voice.state === "recording" ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-err opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-err" />
              </span>
              <span className="min-w-0 flex-1 truncate">Listening → <b>{voice.name ?? "session"}</b></span>
              <span className="flex h-3 w-12 items-end gap-px">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className={cx("w-full rounded-sm", i / 8 < Math.min(1, voice.level * 12) ? "bg-ok" : "bg-hover")} style={{ height: `${35 + i * 8}%` }} />
                ))}
              </span>
            </>
          ) : voice.state === "sending" ? (
            <>
              <Send size={13} className="shrink-0 text-warn" />
              <span className="min-w-0 flex-1 truncate">→ <b>{voice.name ?? "session"}</b>: “{voice.text}” <span className="text-faint">· Esc keeps it</span></span>
            </>
          ) : voice.state === "speaking" ? (
            <>
              <Volume2 size={13} className="shrink-0 animate-pulse text-ok" />
              <span className="truncate"><b>{voice.name ?? "Assistant"}</b> is speaking…</span>
            </>
          ) : (
            <>
              <Loader2 size={13} className="animate-spin text-accent" />
              <span className="truncate">Transcribing for <b>{voice.name ?? "session"}</b>…</span>
            </>
          )}
        </div>
      )}
      {showOrb && orb && (
        <div className="group relative flex items-center gap-2">
          {hover && (
            <span className="hud-card max-w-[200px] px-2 py-1 text-left text-[11px]">
              {orb.agents.map((a) => (
                <span key={a.name} className="flex gap-1.5 truncate"><b className="truncate">{a.name}</b><span className="truncate text-faint">{a.status}</span></span>
              ))}
            </span>
          )}
          <button title="Open the cockpit" onClick={() => void emit("hud-action", { action: "open", sessionId: "" })}>
            <span className={cx("hud-orb relative grid shrink-0 place-items-center rounded-full", `hud-orb-${orb.mood}`)} style={{ width: ORB_SIZE, height: ORB_SIZE }}>
              <span className="text-[12px] font-bold text-white drop-shadow">{orb.waiting || orb.working || orb.total}</span>
            </span>
          </button>
          <button
            className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center rounded-full border border-line-strong bg-panel text-muted hover:text-fg group-hover:grid"
            title="Hide until something changes (turn off in Settings → Voice)"
            aria-label="Hide"
            onClick={() => setOrbClosed(orbSig)}
          >
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

function ReplyRow({ onReply, onClose }: { onReply: (t: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim()) return;
    onReply(text.trim());
    setText("");
  };
  return (
    <div className="flex items-center gap-1 px-2 pb-1.5 pl-3" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
          else if (e.key === "Escape") onClose();
        }}
        placeholder="Reply… (Enter sends)"
        className="h-6 min-w-0 flex-1 rounded border border-line-strong bg-bg px-2 text-[11.5px] placeholder:text-faint focus:border-accent focus:outline-none"
      />
      {text.trim() && (
        <button className="inline-flex h-6 w-6 items-center justify-center rounded border border-accent/60 bg-accent/15 text-accent" title="Send" onClick={send}>
          <CornerDownLeft size={12} />
        </button>
      )}
    </div>
  );
}
