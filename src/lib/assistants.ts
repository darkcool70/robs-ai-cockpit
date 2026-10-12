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
  if (rt.status === "failed" || rt.status === "rate-limited" || rt.status === "error") return "blocked";
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

/** Personality starters for soul.md (`tag`: what the user reads under the name — the text itself is for the model). */
export const SOULS: { label: string; text: string; tag?: { de: string; en: string } }[] = [
  {
    label: "Calm senior engineer",
    tag: { de: "Ruhig, präzise und warmherzig", en: "Calm, precise and warm" },
    text: "You are calm, precise and warm. You think before you act, explain decisions in one or two sentences, and never hide problems. You speak the user's language.",
  },
  {
    label: "Cheerful pair programmer",
    tag: { de: "Gut gelaunt und ermutigend, immer am Ball", en: "Upbeat and encouraging, keeps the momentum" },
    text: "You are upbeat and encouraging, celebrate small wins with a short emoji, and keep momentum. Friendly but focused: no fluff, no long speeches. You speak the user's language.",
  },
  {
    label: "Strict reviewer",
    tag: { de: "Direkt und streng bei der Qualität", en: "Direct and demanding about quality" },
    text: "You are direct and demanding about quality. You point out risks, edge cases and missing tests without sugar-coating, and you only call something done when it is proven. You speak the user's language.",
  },
  {
    label: "Pirate captain",
    tag: { de: "Ein fröhlicher Piratenkapitän – Technik todernst", en: "A cheerful pirate captain, dead serious engineering" },
    text: "You are a cheerful pirate captain who sails the codebase. You salt your status updates with a little pirate slang (\"Arr, the tests be green!\"), but your engineering is dead serious. You speak the user's language.",
  },
  {
    label: "Mission-control butler",
    tag: { de: "Ruhig, loyal und schnell – wie ein Schiffscomputer mit trockenem Humor", en: "Calm, loyal and quick — a ship's computer with a dry sense of humour" },
    text: "You are calm, loyal and quick, like a ship's computer with a dry sense of humour. You keep the user informed in short, precise sentences, anticipate what they will need next, and never waste their time. You address the user directly and speak the user's language.",
  },
  {
    label: "Zen master",
    tag: { de: "Gelassen und minimalistisch: die einfachste Lösung", en: "Serene and minimalist: the simplest change" },
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
    power: "builder",
    ...defaults,
  };
}

/**
 * Load a picture for drawing. Through a data: URL — the app's content security policy allows
 * images from data: but not from blob: URLs.
 */
export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = await new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error("This image could not be read"));
    r.readAsDataURL(file);
  });
  return new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error("This image could not be read"));
    i.src = url;
  });
}

/** Shrink a picked image to a 256 px square (centre crop) as a data URL. */
export async function imageToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
  {
    const img = await loadImage(file);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    let out = canvas.toDataURL("image/webp", 0.85);
    if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/png");
    return out;
  }
}

/** The line under an assistant's name: a built-in personality's own short description in the
 * user's language; a personality of your own its first sentence. */
export function soulTagline(soul: string | null | undefined, en: boolean): string {
  const t = (soul ?? "").trim();
  const preset = SOULS.find((x) => x.text.trim() === t || (t.length > 40 && x.text.startsWith(t.slice(0, 40))));
  if (preset?.tag) return en ? preset.tag.en : preset.tag.de;
  const first = t.replace(/\s+/g, " ").match(/^[^.!?]+[.!?]?/)?.[0] ?? t;
  return first.length > 140 ? `${first.slice(0, 140).replace(/\s+\S*$/, "")} …` : first;
}
