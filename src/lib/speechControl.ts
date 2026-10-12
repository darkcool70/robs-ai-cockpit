// How much Atlas talks, by voice or typed: „sprich erstmal nicht“ / „psst“ → muted, „sprich wieder“ →
// unmuted, „sprich weniger“ / „nur das Wichtigste“ → „Nur wenn ich frage“ and short answers,
// „sag mir alles“ → „Wichtiges auch melden“, „lies alles vor“ → „Alles vorlesen“.
// Pure (unit tested). Only a whole short utterance counts — „sprich mit dem Agenten über …“ is a
// normal message and goes to the agent.
import type { SpeakMode } from "./speakPolicy";

export type SpeechControl = "mute" | "unmute" | "less" | "more" | "all";

/** Lower case, no punctuation, without polite or filler words and a leading name („Atlas, …“). */
function norm(text: string, names: string[]): string {
  let t = text
    .toLowerCase()
    .replace(/^\s*🎙\s*/u, "")
    .replace(/[.,!?;:…"„“”«»()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const n of ["hey", "hallo", "ok", "okay", ...names.map((x) => x.toLowerCase())]) {
    if (t.startsWith(`${n} `)) t = t.slice(n.length + 1);
  }
  return t
    .replace(/\b(bitte|mal|erstmal|erst mal|jetzt|gerade|einfach|doch|please|for now|for a while|for a bit|now)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MUTE = [
  // German
  /^(?:sprich|rede|red|sag) (?:nichts|nicht)(?: mehr)?$/,
  /^(?:sprich|rede|red) (?:nichts|nicht) mehr laut$/,
  /^(?:nicht|nichts) (?:mehr )?(?:sprechen|reden|sagen)$/,
  /^(?:sei|bleib) (?:still|ruhig|leise|stumm)$/,
  /^(?:ps+t+|psch+t*|sch+|ruhe|still|stille|leise|stumm|stummschalten|stumm schalten|ton aus|sprache aus|klappe|halt die klappe)$/,
  /^(?:schalt|schalte|mach) dich (?:stumm|leise)$/,
  /^du (?:sollst|musst) (?:nicht|nichts) (?:sprechen|reden|sagen)$/,
  /^(?:ich will|ich möchte|ich moechte) (?:nichts|nicht) (?:hören|hoeren)$/,
  // English
  /^(?:mute|mute yourself|mute it|be quiet|quiet|silence|hush|shh+|stop talking|don't talk|dont talk|do not talk|no talking|shut up|stay quiet|keep quiet)$/,
];

const UNMUTE = [
  /^du (?:darfst|kannst|sollst) wieder (?:sprechen|reden|laut sein)$/,
  /^(?:sprich|rede|red) wieder(?: laut| mit mir)?$/,
  /^(?:wieder sprechen|wieder reden|ton an|ton wieder an|sprache an|stumm aus|laut|wieder laut|stummschaltung aus|stummschaltung aufheben)$/,
  /^(?:unmute|unmute yourself|you can (?:talk|speak) again|(?:talk|speak) again|sound on|voice on)$/,
];

const LESS = [
  /^(?:sprich|rede|red|sag) weniger$/,
  /^weniger (?:sprechen|reden|quatschen|erzählen|erzaehlen)$/,
  /^(?:nur|nur noch|sag nur|sag mir nur) (?:das wichtigste|wichtiges|das nötigste|das noetigste)$/,
  /^(?:fass dich kürzer|fass dich kuerzer|fass dich kurz|kürzere antworten|kuerzere antworten|nicht so viel reden|red nicht so viel|rede nicht so viel)$/,
  /^(?:talk less|speak less|say less|less talking|only the important stuff|only what matters|just the essentials|keep it short|shorter answers)$/,
];

const MORE = [
  /^(?:sag|erzähl|erzaehl) mir alles$/,
  /^(?:sprich|rede|red) mehr$/,
  /^mehr (?:sprechen|reden)$/,
  /^(?:halt|halte) mich auf dem laufenden$/,
  /^(?:melde|meld) (?:dich bei )?wichtiges(?: auch)?$/,
  /^(?:tell me everything|talk more|speak more|keep me posted|keep me in the loop)$/,
];

const ALL = [
  /^(?:lies|lese) (?:mir )?alles vor$/,
  /^alles (?:vorlesen|laut vorlesen)$/,
  /^(?:lies|lese) (?:mir )?alles laut vor$/,
  /^(?:read everything|read everything aloud|read it all|read all|read me everything)$/,
];

/** The control in a short sentence, or null (a normal message). `names`: the assistant's name(s) in front. */
export function speechControl(text: string, names: string[] = ["atlas"]): SpeechControl | null {
  const t = norm(text, names);
  if (!t || t.split(" ").length > 7) return null;
  if (MUTE.some((re) => re.test(t))) return "mute";
  if (UNMUTE.some((re) => re.test(t))) return "unmute";
  if (LESS.some((re) => re.test(t))) return "less";
  if (MORE.some((re) => re.test(t))) return "more";
  if (ALL.some((re) => re.test(t))) return "all";
  return null;
}

/** What a control changes and how it confirms: the settings, the toast and the single word it says. */
export interface ControlEffect {
  settings: { voiceMuted: boolean; voiceSpeakWhen?: SpeakMode; voiceBrief?: boolean; ttsEnabled?: boolean };
  toast: string;
  /** spoken after the change ("" = only the soft sound) */
  say: string;
}

export function controlEffect(cmd: SpeechControl, en = false): ControlEffect {
  switch (cmd) {
    case "mute":
      return {
        settings: { voiceMuted: true },
        toast: en ? "🔇 Muted — answers stay as text. Say “speak again” or press Ctrl+Shift+M." : "🔇 Stumm — Antworten kommen als Text. „Sprich wieder“ oder Strg+Umschalt+M hebt das auf.",
        say: "",
      };
    case "unmute":
      return { settings: { voiceMuted: false }, toast: en ? "🔊 Speaking again" : "🔊 Spricht wieder", say: "Okay." };
    case "less":
      return {
        settings: { voiceMuted: false, voiceSpeakWhen: "asked", voiceBrief: true },
        toast: en ? "🔉 Talks less: only when you ask, short answers" : "🔉 Spricht weniger: nur wenn du fragst, kurze Antworten",
        say: "Okay.",
      };
    case "more":
      return {
        settings: { voiceMuted: false, voiceSpeakWhen: "important", voiceBrief: false, ttsEnabled: true },
        toast: en ? "🔊 Also reports what matters" : "🔊 Meldet jetzt auch Wichtiges",
        say: "Okay.",
      };
    case "all":
      return {
        settings: { voiceMuted: false, voiceSpeakWhen: "all", voiceBrief: false, ttsEnabled: true },
        toast: en ? "🔊 Reads everything aloud" : "🔊 Liest jetzt alles vor",
        say: "Okay.",
      };
  }
}

/** Is all spoken output off? (`voiceMuted`) */
export function isMutedIn(settings: Record<string, unknown>): boolean {
  return settings.voiceMuted === true;
}

/**
 * „Sprich weniger“: an answer kept to its first two sentences (at most ~240 characters). `[[id]]`
 * markers stay with their sentence.
 */
export function briefSpeech(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const sentences = flat.split(/(?<=[.!?…])\s+/);
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    if (out && (out + " " + s).length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  out = out.trim();
  if (out.length <= max + 20) return out;
  return `${out.slice(0, max).replace(/\s+\S*$/, "")} …`;
}
