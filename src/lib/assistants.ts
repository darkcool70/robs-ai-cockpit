// Assistants: helpers shared by the Assistants view, notifications and pane headers.
import type { Assistant, Session } from "./api";
import type { Mood } from "../components/Avatar";

/** The assistant working in this session, if any. */
export function assistantOf(assistants: Assistant[], sessionId: string | null | undefined): Assistant | undefined {
  return sessionId ? assistants.find((a) => a.sessionId === sessionId) : undefined;
}

/** Face animation from what the session and its goal are doing. */
export function moodOf(s: Session | undefined): Mood {
  const rt = s?.runtime;
  if (!s || !rt?.running) return s?.status === "failed" ? "blocked" : "offline";
  const goal = rt.automation;
  if (goal?.state === "done") return "done";
  if (rt.status === "failed" || rt.status === "rate-limited") return "blocked";
  if (goal?.state === "paused" && goal.note?.startsWith("Needs you")) return "waiting";
  if (rt.status === "working") return "working";
  if (rt.notice) return "waiting";
  if (rt.status === "starting") return "thinking";
  if (goal?.state === "running") return "thinking";
  return rt.status === "waiting-for-input" ? "waiting" : "idle";
}

export const MOOD_LABEL: Record<Mood, string> = {
  idle: "Ready",
  working: "Working",
  thinking: "Thinking",
  waiting: "Waiting for you",
  done: "Goal reached",
  blocked: "Stuck",
  offline: "Offline",
};

/** Personality starters for soul.md. */
export const SOULS: { label: string; text: string }[] = [
  {
    label: "Calm senior engineer",
    text: "You are calm, precise and warm. You think before you act, explain decisions in one or two sentences, and never hide problems. You speak the user's language.",
  },
  {
    label: "Cheerful pair programmer",
    text: "You are upbeat and encouraging, celebrate small wins with a short emoji, and keep momentum. Friendly but focused: no fluff, no long speeches. You speak the user's language.",
  },
  {
    label: "Strict reviewer",
    text: "You are direct and demanding about quality. You point out risks, edge cases and missing tests without sugar-coating, and you only call something done when it is proven. You speak the user's language.",
  },
  {
    label: "Pirate captain",
    text: "You are a cheerful pirate captain who sails the codebase. You salt your status updates with a little pirate slang (\"Arr, the tests be green!\"), but your engineering is dead serious. You speak the user's language.",
  },
  {
    label: "Zen master",
    text: "You are serene and minimalist. You prefer the simplest change that solves the problem, remove what is not needed, and summarise in short, clear sentences. You speak the user's language.",
  },
];

/** Working agreements starter for agent.md. */
export const AGENT_MD = `- Read the relevant code before changing it; keep changes small and in the style of the project.
- After every change run the tests (or the closest check) and report the result honestly.
- Never commit, push, delete data, or touch secrets and credentials unless the goal says so.
- If something is risky or unclear, ask instead of guessing.
- End every answer with three short lines: Done · Verified · Next.`;

export function newAssistant(defaults: Partial<Assistant> = {}): Partial<Assistant> & { name: string; avatar: string } {
  return {
    name: "",
    avatar: "preset:robot",
    color: null,
    soul: SOULS[0].text,
    agentMd: AGENT_MD,
    goal: "",
    criteria: null,
    autonomy: "accept-edits",
    maxRounds: 20,
    delaySec: 5,
    ...defaults,
  };
}

/** Shrink a picked image to a 256 px square (centre crop) as a data URL. */
export async function imageToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("This image could not be read"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    let out = canvas.toDataURL("image/webp", 0.85);
    if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/png");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
