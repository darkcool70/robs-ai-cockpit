// Animated faces for assistants. Built-in characters are inline SVG (crisp at any size, themed
// by the assistant's colour); an own picture is shown in the same animated frame.
import type { ReactNode } from "react";
import { cx } from "./ui";

/** What the assistant is doing — drives the animation. */
export type Mood = "idle" | "working" | "thinking" | "waiting" | "done" | "blocked" | "offline";

export interface Preset {
  id: string;
  label: string;
  color: string;
}

export const PRESETS: Preset[] = [
  { id: "robot", label: "Robot", color: "#6ea8fe" },
  { id: "fox", label: "Fox", color: "#f08a4b" },
  { id: "owl", label: "Owl", color: "#a78bfa" },
  { id: "cat", label: "Cat", color: "#56c087" },
  { id: "dragon", label: "Dragon", color: "#e5534b" },
  { id: "astro", label: "Astronaut", color: "#38bdf8" },
  { id: "knight", label: "Knight", color: "#e3b341" },
  { id: "ghost", label: "Ghost", color: "#c7d2fe" },
];

export const presetOf = (avatar: string | null | undefined): Preset | undefined =>
  avatar?.startsWith("preset:") ? PRESETS.find((p) => p.id === avatar.slice(7)) : undefined;

const MOUTH: Record<Mood, string> = {
  idle: "M42 66 Q50 72 58 66",
  working: "M44 67 Q50 70 56 67",
  thinking: "M45 68 L55 66",
  waiting: "M42 65 Q50 74 58 65",
  done: "M39 63 Q50 78 61 63",
  blocked: "M43 70 Q50 64 57 70",
  offline: "M45 68 L55 68",
};

/** Eyes: two pupils with highlights; blink + look around come from CSS. */
function Eyes({ y = 52, gap = 12, r = 6.5, fill = "#11151a", mood }: { y?: number; gap?: number; r?: number; fill?: string; mood: Mood }) {
  const closed = mood === "offline";
  return (
    <g className="av-eyes" style={{ transformOrigin: `50px ${y}px` }}>
      {[-gap, gap].map((dx) =>
        closed ? (
          <path key={dx} d={`M${50 + dx - r} ${y} Q${50 + dx} ${y + r * 0.7} ${50 + dx + r} ${y}`} stroke={fill} strokeWidth="2.6" fill="none" strokeLinecap="round" />
        ) : (
          <g key={dx} className="av-pupil">
            <circle cx={50 + dx} cy={y} r={r} fill={fill} />
            <circle cx={50 + dx + r * 0.35} cy={y - r * 0.4} r={r * 0.32} fill="#fff" />
          </g>
        ),
      )}
    </g>
  );
}

function Mouth({ mood, color = "#11151a" }: { mood: Mood; color?: string }) {
  return <path d={MOUTH[mood]} stroke={color} strokeWidth="2.8" fill="none" strokeLinecap="round" />;
}

function Cheeks({ y = 62 }: { y?: number }) {
  return (
    <g opacity="0.35">
      <ellipse cx="31" cy={y} rx="5" ry="3" fill="#ff7b9c" />
      <ellipse cx="69" cy={y} rx="5" ry="3" fill="#ff7b9c" />
    </g>
  );
}

function Character({ id, color, mood }: { id: string; color: string; mood: Mood }): ReactNode {
  const dark = "#11151a";
  switch (id) {
    case "robot":
      return (
        <>
          <line x1="50" y1="14" x2="50" y2="26" stroke={dark} strokeWidth="3" />
          <circle className="av-antenna" cx="50" cy="12" r="5" fill={mood === "blocked" ? "#f07178" : "#ffe066"} />
          <rect x="18" y="26" width="64" height="58" rx="18" fill={color} />
          <rect x="12" y="46" width="8" height="18" rx="3" fill={color} opacity="0.8" />
          <rect x="80" y="46" width="8" height="18" rx="3" fill={color} opacity="0.8" />
          <rect x="26" y="38" width="48" height="28" rx="12" fill="#0d1014" />
          <Eyes y={52} gap={11} r={5.5} fill="#7cf0c4" mood={mood} />
          <Mouth mood={mood} color={dark} />
        </>
      );
    case "fox":
      return (
        <>
          <path d="M20 40 L26 10 L44 30 Z" fill={color} />
          <path d="M80 40 L74 10 L56 30 Z" fill={color} />
          <path d="M24 34 L28 18 L38 30 Z" fill="#fff3e6" />
          <path d="M76 34 L72 18 L62 30 Z" fill="#fff3e6" />
          <ellipse cx="50" cy="56" rx="34" ry="30" fill={color} />
          <path d="M18 58 Q34 86 50 84 Q66 86 82 58 Q66 70 50 70 Q34 70 18 58 Z" fill="#fff3e6" />
          <Eyes y={50} gap={13} mood={mood} />
          <ellipse cx="50" cy="63" rx="4" ry="3" fill={dark} />
          <Mouth mood={mood} />
        </>
      );
    case "owl":
      return (
        <>
          <path d="M22 30 L30 12 L40 26 Z" fill={color} />
          <path d="M78 30 L70 12 L60 26 Z" fill={color} />
          <ellipse cx="50" cy="56" rx="34" ry="32" fill={color} />
          <circle cx="37" cy="50" r="13" fill="#fff" />
          <circle cx="63" cy="50" r="13" fill="#fff" />
          <Eyes y={50} gap={13} r={7} mood={mood} />
          <path d="M46 60 L50 68 L54 60 Z" fill="#e3b341" />
          <path d="M30 76 Q40 70 50 76 Q60 70 70 76" stroke={dark} strokeOpacity="0.25" strokeWidth="2" fill="none" />
        </>
      );
    case "cat":
      return (
        <>
          <path d="M20 42 L24 12 L44 30 Z" fill={color} />
          <path d="M80 42 L76 12 L56 30 Z" fill={color} />
          <path d="M25 34 L27 20 L37 29 Z" fill="#ffb3c7" />
          <path d="M75 34 L73 20 L63 29 Z" fill="#ffb3c7" />
          <ellipse cx="50" cy="56" rx="34" ry="30" fill={color} />
          <Eyes y={52} gap={13} mood={mood} />
          <path d="M47 61 L53 61 L50 64 Z" fill="#ff7b9c" />
          <g stroke={dark} strokeOpacity="0.45" strokeWidth="1.6">
            <line x1="20" y1="62" x2="36" y2="64" />
            <line x1="20" y1="68" x2="36" y2="67" />
            <line x1="80" y1="62" x2="64" y2="64" />
            <line x1="80" y1="68" x2="64" y2="67" />
          </g>
          <Mouth mood={mood} />
          <Cheeks y={64} />
        </>
      );
    case "dragon":
      return (
        <>
          <path d="M30 30 L22 8 L40 24 Z" fill="#ffe066" />
          <path d="M70 30 L78 8 L60 24 Z" fill="#ffe066" />
          <path d="M44 22 L50 10 L56 22 Z" fill={color} opacity="0.85" />
          <ellipse cx="50" cy="54" rx="34" ry="32" fill={color} />
          <ellipse cx="50" cy="70" rx="20" ry="12" fill="#ffd9a8" />
          <circle cx="44" cy="66" r="2" fill={dark} />
          <circle cx="56" cy="66" r="2" fill={dark} />
          <Eyes y={48} gap={14} mood={mood} />
          <Mouth mood={mood} />
          {mood === "done" && <path className="av-flame" d="M50 86 Q44 94 50 99 Q56 94 50 86 Z" fill="#ff9f43" />}
        </>
      );
    case "astro":
      return (
        <>
          <circle cx="50" cy="52" r="38" fill="#e8edf3" />
          <circle cx="50" cy="52" r="38" fill="none" stroke={color} strokeWidth="5" />
          <rect x="22" y="32" width="56" height="42" rx="20" fill="#1b2a3a" />
          <ellipse cx="50" cy="55" rx="22" ry="18" fill="#ffd9b8" />
          <Eyes y={52} gap={9} r={4.5} mood={mood} />
          <Mouth mood={mood} />
          <path d="M28 40 Q36 34 44 36" stroke="#fff" strokeOpacity="0.6" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="50" cy="12" r="4" fill={color} />
          <Cheeks y={60} />
        </>
      );
    case "knight":
      return (
        <>
          <path className="av-plume" d="M50 16 Q66 2 78 14 Q64 12 56 22 Z" fill="#f07178" />
          <path d="M18 54 Q18 20 50 18 Q82 20 82 54 L82 74 Q82 88 50 88 Q18 88 18 74 Z" fill="#b8c2cf" />
          <rect x="47" y="18" width="6" height="66" fill={color} opacity="0.9" />
          <rect x="26" y="44" width="48" height="18" rx="6" fill="#0d1014" />
          <Eyes y={53} gap={12} r={4.5} fill="#ffe066" mood={mood} />
          <path d="M30 70 L70 70" stroke={dark} strokeOpacity="0.35" strokeWidth="3" />
          <path d="M34 76 L66 76" stroke={dark} strokeOpacity="0.25" strokeWidth="3" />
        </>
      );
    case "ghost":
    default:
      return (
        <>
          <path d="M18 54 Q18 16 50 16 Q82 16 82 54 L82 88 L72 80 L62 88 L50 80 L38 88 L28 80 L18 88 Z" fill={color} />
          <Eyes y={48} gap={12} r={6} mood={mood} />
          <Mouth mood={mood} />
          <Cheeks y={58} />
        </>
      );
  }
}

const RING: Record<Mood, string> = {
  idle: "ring-line-strong",
  working: "ring-accent",
  thinking: "ring-accent",
  waiting: "ring-warn",
  done: "ring-ok",
  blocked: "ring-err",
  offline: "ring-line",
};

/** An assistant's face: animated by `mood`. `size` in px. */
export function AssistantAvatar({
  avatar,
  color,
  mood = "idle",
  size = 48,
  className,
  title,
}: {
  avatar: string | null | undefined;
  color?: string | null;
  mood?: Mood;
  size?: number;
  className?: string;
  title?: string;
}) {
  const preset = presetOf(avatar);
  const c = color || preset?.color || "#6ea8fe";
  return (
    <span
      className={cx("av relative inline-flex shrink-0 items-center justify-center", `av-${mood}`, className)}
      style={{ width: size, height: size, ["--av-color" as string]: c }}
      title={title}
    >
      <span className={cx("av-ring absolute inset-0 rounded-full ring-2", RING[mood])} />
      {(mood === "thinking" || mood === "working") && (
        <span className="av-orbit absolute inset-[-6%]" aria-hidden>
          <i /><i /><i />
        </span>
      )}
      {mood === "done" && (
        <span className="av-sparkles absolute inset-[-10%]" aria-hidden>
          <i /><i /><i /><i />
        </span>
      )}
      <span className="av-body relative h-full w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${c} 18%, var(--color-panel))` }}>
        {avatar?.startsWith("data:image/") ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <Character id={preset?.id ?? "ghost"} color={c} mood={mood} />
          </svg>
        )}
      </span>
      {mood === "waiting" && <span className="av-badge absolute -top-0.5 -right-0.5 h-[28%] w-[28%] rounded-full border-2 border-panel bg-warn" />}
      {mood === "blocked" && <span className="av-badge absolute -top-0.5 -right-0.5 h-[28%] w-[28%] rounded-full border-2 border-panel bg-err" />}
    </span>
  );
}
