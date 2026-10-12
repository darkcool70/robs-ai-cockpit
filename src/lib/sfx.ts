// Interface sounds, synthesised with WebAudio (no sound files): a sci-fi set (chirps, a soft
// whoosh when something is sent, glassy chimes) and the classic two-tone beeps.
import { useApp } from "../store";

export type Sfx = "start" | "stop" | "switch" | "error" | "send" | "done" | "attention" | "standby" | "confirm" | "backchannel";
export type SfxStyle = "scifi" | "classic" | "off";

let ctx: AudioContext | null = null;
/** One AudioContext for sounds and speech (browsers limit how many may exist). */
export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

export function sfxStyle(settings: Record<string, unknown>): SfxStyle {
  if (settings.voiceSounds === false) return "off";
  return settings.voiceSoundStyle === "classic" ? "classic" : "scifi";
}

interface Tone {
  at: number;
  f: number;
  /** End frequency (glide). */
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function tones(c: AudioContext, list: Tone[], out: AudioNode) {
  const t0 = c.currentTime + 0.01;
  for (const t of list) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = t.type ?? "sine";
    o.frequency.setValueAtTime(t.f, t0 + t.at);
    if (t.to) o.frequency.exponentialRampToValueAtTime(t.to, t0 + t.at + t.dur);
    const peak = t.gain ?? 0.08;
    g.gain.setValueAtTime(0.0001, t0 + t.at);
    g.gain.exponentialRampToValueAtTime(peak, t0 + t.at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t.at + t.dur);
    o.connect(g).connect(out);
    o.start(t0 + t.at);
    o.stop(t0 + t.at + t.dur + 0.05);
  }
}

/** Band-passed noise sweeping up: the "whoosh" of a message leaving. */
function whoosh(c: AudioContext, out: AudioNode, dur = 0.22, gain = 0.09) {
  const t0 = c.currentTime + 0.01;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(500, t0);
  bp.frequency.exponentialRampToValueAtTime(4200, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
}

const SCIFI: Record<Sfx, Tone[]> = {
  start: [{ at: 0, f: 520, to: 1250, dur: 0.11, type: "sine", gain: 0.07 }, { at: 0.09, f: 1560, dur: 0.09, type: "triangle", gain: 0.05 }],
  stop: [{ at: 0, f: 1150, to: 480, dur: 0.12, type: "sine", gain: 0.07 }],
  switch: [{ at: 0, f: 1900, dur: 0.05, type: "triangle", gain: 0.05 }],
  error: [{ at: 0, f: 190, dur: 0.16, type: "sawtooth", gain: 0.05 }, { at: 0.18, f: 150, dur: 0.2, type: "sawtooth", gain: 0.05 }],
  send: [{ at: 0.12, f: 1760, dur: 0.12, type: "triangle", gain: 0.045 }],
  done: [{ at: 0, f: 880, dur: 0.22, type: "triangle", gain: 0.06 }, { at: 0.09, f: 1318.5, dur: 0.32, type: "triangle", gain: 0.055 }],
  attention: [0, 0.16, 0.32].map((at) => ({ at, f: 1046.5, dur: 0.1, type: "sine" as const, gain: 0.06 })),
  standby: [{ at: 0, f: 988, dur: 0.12, gain: 0.05 }, { at: 0.12, f: 740, dur: 0.12, gain: 0.05 }, { at: 0.24, f: 494, dur: 0.22, gain: 0.05 }],
  confirm: [{ at: 0, f: 660, dur: 0.08, type: "triangle", gain: 0.06 }, { at: 0.08, f: 990, dur: 0.14, type: "triangle", gain: 0.06 }],
  // a soft, low "mhm": two hummed notes, quiet enough not to disturb the recording
  backchannel: [{ at: 0, f: 196, dur: 0.16, type: "sine", gain: 0.025 }, { at: 0.17, f: 220, dur: 0.22, type: "sine", gain: 0.022 }],
};

const CLASSIC: Record<Sfx, number[]> = {
  start: [520, 780],
  stop: [700, 470],
  switch: [880],
  error: [300, 300],
  send: [880, 1175],
  done: [660, 880],
  attention: [880, 880, 880],
  standby: [600, 400],
  confirm: [700, 1050],
  backchannel: [220],
};

// ---------------------------------------------------------------------------
// The board's sounds: soft and short, under a voice, never in the way.
// ---------------------------------------------------------------------------

export type BoardSfx = "land" | "pen" | "spot" | "turn";

/** Cards landing: a soft wooden "pop" per card, rising a little, one after another. */
function pops(c: AudioContext, out: AudioNode, count: number, gap: number) {
  const n = Math.min(count, 6);
  tones(c, Array.from({ length: n }, (_, i) => ({ at: i * gap, f: 420 + i * 55, to: 260 + i * 40, dur: 0.09, type: "sine" as const, gain: 0.05 })), out);
}

/** A pen on a whiteboard: short scratchy noise. */
function scratch(c: AudioContext, out: AudioNode) {
  const t0 = c.currentTime + 0.01;
  const dur = 0.5;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 900));
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.025, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(hp).connect(g).connect(out);
  src.start(t0);
}

/** Sounds of the board (the Voice tab's sound style; off with "Board sounds"). */
export function playBoardSfx(kind: BoardSfx, count = 1) {
  const st = useApp.getState().settings;
  if (sfxStyle(st) === "off" || st.boardSounds === false) return;
  try {
    const c = audioContext();
    const out = c.destination;
    if (kind === "land") pops(c, out, count, 0.14);
    else if (kind === "pen") scratch(c, out);
    else if (kind === "turn") whoosh(c, out, 0.16, 0.035);
    else tones(c, [{ at: 0, f: 1568, dur: 0.5, type: "sine", gain: 0.025 }, { at: 0.06, f: 2093, dur: 0.6, type: "sine", gain: 0.02 }, { at: 0.12, f: 2637, dur: 0.7, type: "sine", gain: 0.015 }], out);
  } catch {
    /* no audio device */
  }
}

/** Play an interface sound in the style chosen in the Voice tab. */
export function playSfx(kind: Sfx, style: SfxStyle = sfxStyle(useApp.getState().settings)) {
  if (style === "off") return;
  try {
    const c = audioContext();
    const out = c.destination;
    if (style === "classic") {
      tones(c, CLASSIC[kind].map((f, i) => ({ at: i * 0.07, f, dur: 0.12, gain: 0.09 })), out);
      return;
    }
    if (kind === "send") whoosh(c, out);
    tones(c, SCIFI[kind], out);
  } catch {
    /* no audio device */
  }
}
