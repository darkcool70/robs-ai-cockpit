// How a voice conversation ends and when the microphone opens again. Pure (unit tested).
//
// Rob, 14.11.2026: „wenn ich sag ‚ne, das passt so‘ oder ‚fertig‘, schickt er die Anfrage wieder
// los und lässt mich wieder sprechen — es endet nicht.“ So: a closing remark is not a request (it
// ends the conversation, nothing is sent), and after an answer that asks nothing the microphone
// stays open only for a short follow-up — then it is quiet until the name is said again.

/** Lower case, no punctuation, without the assistant's name and polite filler. */
function norm(text: string, names: string[]): string {
  let t = text
    .toLowerCase()
    .replace(/^\s*🎙\s*/u, "")
    .replace(/[.,!?;:…"„“”«»()'’-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ns = names.map((n) => n.toLowerCase().trim()).filter(Boolean);
  for (const n of ns) {
    if (t === n) return "";
    if (t.startsWith(`${n} `)) t = t.slice(n.length + 1);
    if (t.endsWith(` ${n}`)) t = t.slice(0, -n.length - 1);
  }
  return t
    .replace(/\b(bitte|erstmal|erst mal|jetzt|dann|schon|echt|wirklich|please|for now|then)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// the small words a closing remark is built from
const NO = "(?:ne|nee|nö|nein|no|nope|nah)";
const OK = "(?:ok|okay|oke|gut|super|prima|perfekt|top|klasse|alles klar|schön|fein|cool|great|perfect|fine|good|alright|all right)";
const THANKS = "(?:danke|danke dir|danke schön|dankeschön|vielen dank|dank dir|merci|thanks|thank you|thanks a lot|cheers)";
const FITS = "(?:das |es |so |that |it )?(?:passt|reicht|genügt|stimmt|langt)(?: (?:mir|schon))?(?: (?:so|schon|erstmal|für jetzt|für heute|jetzt))*";
const DONE = "(?:fertig|das wars|das war s|das war es|das wärs|das wär s|das wäre es|das wärs dann|das ist alles|mehr nicht|sonst nichts|nichts mehr|nix mehr|alles gut|alles bestens|alles erledigt|bin fertig|ich bin fertig|wir sind fertig|erledigt|lass gut sein|schon gut|gut so|so ist gut|so ist es gut|kannst so lassen|kannst du so lassen|lass es so|lass das so|so lassen|bleibt so|das bleibt so|that s all|that is all|thats all|that s it|thats it|i m done|im done|we re done|all good|all done|nothing else|never mind|leave it|leave it like that|keep it|keep it like that|good as is)";
const BYE = "(?:tschüss|tschüs|tschau|ciao|bis später|bis dann|bis gleich|gute nacht|bye|goodbye|see you|später|ende|schluss|feierabend|gespräch beenden|over and out)";
const PART = `(?:${NO}|${OK}|${THANKS}|${FITS}|${DONE}|${BYE})`;
const CLOSING = new RegExp(`^${PART}(?: ${PART}){0,3}$`);
/** „ja“, „ok“, „gut“ alone answer a question — they close nothing. */
const ONLY_OK = new RegExp(`^(?:ja|jo|jep|yes|${OK})(?: (?:ja|${OK}))*$`);
/** „nein“ alone answers a question too (the operator's pending yes / no). */
const ONLY_NO = new RegExp(`^${NO}$`);

/**
 * „Ne, das passt so“, „fertig“, „danke, das war's“, „alles gut“, „passt“, „tschüss“ — the user is
 * done: nothing to carry out, the conversation ends. Only a whole short utterance counts; „passt
 * das so mit dem Titel?“ or „mach das fertig“ are normal messages.
 */
export function closingRemark(text: string, names: string[] = []): boolean {
  const t = norm(text, names);
  if (!t || t.split(" ").length > 8) return false;
  if (ONLY_OK.test(t) || ONLY_NO.test(t)) return false;
  return CLOSING.test(t);
}

/**
 * Does what was just said wait for the user's answer? A question at its end („Soll ich …?“), or a
 * request to choose / say something. After anything else the user owes nothing.
 */
export function expectsReply(spoken: string): boolean {
  const t = spoken.replace(/\[\[[^\]]*\]\]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  // the last two sentences decide (an answer may end „… Soll ich das so lassen? Sag einfach Bescheid.“)
  const parts = t.match(/[^.!?…]+[.!?…]*/g) ?? [t];
  return parts.slice(-2).some((p) => /\?\s*$/.test(p.trim()));
}

/** How long the microphone stays open for a follow-up after an answer that asked nothing (ms; 0 = not at all). */
export const FOLLOW_UP_MS = 5000;

/** The setting „voiceFollowUpMs“ as a number: the default when unset, 0 when switched off. */
export function followUpMs(setting: unknown): number {
  const n = Number(setting);
  return setting === undefined || setting === null || setting === "" || !Number.isFinite(n) ? FOLLOW_UP_MS : Math.max(0, Math.min(30_000, n));
}
