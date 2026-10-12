// Language of what is spoken: a Piper voice only knows its own language (Amy reads German with
// English sounds). German text is handed to a German voice that sounds close to the chosen one —
// for a female English voice like Amy that is the natural Supertonic voice when installed, else
// Kerstin, a little higher to match Amy's pitch. Supertonic and the multilingual Azure voices
// speak both languages themselves (the sentence's language is passed to the engine).

export type SpeechLang = "de" | "en";

// Common words that only one of the two languages has ("was", "will", "die", "in", "so", "am" … are
// left out: they are words in both).
const DE = new Set(
  ("der das und ist nicht ich du er sie wir ihr ein eine einen einem einer mit auf für zu den dem des sich auch noch wie bei aus " +
    "oder aber wenn dass jetzt schon bin sind hat habe haben kann können wird werden wurde mir mich dich dir uns nur mal kein keine " +
    "bitte danke ja nein gut alles hier heute gerade erledigt fertig gesendet abgebrochen bereit hallo sehr viel mehr über nach von " +
    "vom zum zur im ins ob weil denn doch etwas dann gleich kurz schau mache machen läuft neue neuen ganz soll sollen muss müssen " +
    "willkommen zurück spreche sprechen deutsch grün geprüft nächste nächster schritt fehler aufgabe aufgaben tschüss genau").split(" "),
);
const EN = new Set(
  ("the and is are of to you your it its this that with for not be been have has had can could would should we they he she my " +
    "me on at from by or but if there what which who how just now done here let sent cancelled ready welcome back yes no " +
    "i'm it's don't can't won't i've i'll you're that's there's let's about into all some any one two three passed failed " +
    "finished working check checking please thanks hello hi standing english").split(" "),
);

/** "de", "en" or null when the text gives no clear hint ("Standby.", "Okay."). */
export function detectLang(text: string): SpeechLang | null {
  const words = text.toLowerCase().replace(/[’`]/g, "'").match(/[\p{L}']+/gu) ?? [];
  let de = /[äöüß]/i.test(text) ? 2 : 0;
  let en = 0;
  for (const w of words) {
    if (DE.has(w)) de++;
    else if (EN.has(w)) en++;
  }
  return de > en ? "de" : en > de ? "en" : null;
}

/** What the speech code needs to know about a voice. */
export interface VoiceInfo {
  id: string;
  lang: string;
  hint: string;
  installed: boolean;
  /** "piper" (default), "supertonic" or "azure" — a cloud voice is only used when chosen by name */
  engine?: string;
}

export interface LangSettings {
  /** Old switch „Amy · Deutsch mit Akzent“ (off = Amy read German herself). Retired: German text is always spoken by a German voice. */
  ttsAutoLanguage?: unknown;
  /** The German voice for that ("" / unset = automatic). */
  ttsGermanVoice?: unknown;
  /** Pitch of the German voice relative to the main one ("auto" / unset = matched to it). */
  ttsGermanPitch?: unknown;
}

export const GERMAN_FEMALE = "de_DE-kerstin-low";
export const GERMAN_MALE = "de_DE-thorsten-medium";
/** The natural local voices (Supertonic) come first when they are installed. */
export const NATURAL_FEMALE = "st-F1";
export const NATURAL_MALE = "st-M4";
/** Kerstin speaks ~160 Hz, Amy and the other English women ~200 Hz: 1.12 brings her close without a chipmunk sound. */
// Eva speaks ~182 Hz (measured): a small step brings her there too. Ramona is already at ~198 Hz.
const MATCH_PITCH: Record<string, number> = { [GERMAN_FEMALE]: 1.12, "de_DE-eva_k-x_low": 1.06 };

const female = (v: VoiceInfo | undefined) => !!v && /\bfemale\b/i.test(v.hint);

/**
 * The voice (and pitch factor) that says text in `lang` instead of `voice`. Unchanged when the voice
 * already speaks that language, when switching is off, or when no fitting voice is installed. Only
 * German text is moved: English stays with the chosen voice, as before.
 */
export function voiceForLang(voice: string, lang: SpeechLang, voices: VoiceInfo[], settings: LangSettings): { voice: string; pitch: number } {
  const same = { voice, pitch: 1 };
  if (lang !== "de") return same;
  const src = voices.find((v) => v.id === voice);
  if (!src || src.lang === "de") return same;
  const chosen = typeof settings.ttsGermanVoice === "string" ? settings.ttsGermanVoice : "";
  const installed = (id: string) => voices.some((v) => v.id === id && v.installed && v.lang === "de");
  const order = female(src) ? [chosen, NATURAL_FEMALE, GERMAN_FEMALE] : [chosen, NATURAL_MALE, GERMAN_MALE];
  // never pick a cloud voice by itself: the text would leave the PC without being asked for
  const others = voices
    .filter((v) => v.installed && v.lang === "de" && v.engine !== "azure")
    .sort((a, b) => Number(female(b) === female(src)) - Number(female(a) === female(src)));
  const target = order.find((id) => id && installed(id)) ?? others[0]?.id;
  if (!target) return same;
  const p = Number(settings.ttsGermanPitch);
  const pitch = settings.ttsGermanPitch != null && settings.ttsGermanPitch !== "auto" && Number.isFinite(p) && p > 0 ? p : female(src) ? (MATCH_PITCH[target] ?? 1) : 1;
  return { voice: target, pitch };
}

/**
 * German voice to download when an English voice should also speak German and none is there — a
 * small Piper voice only (the big natural model is downloaded when you ask for it in the Voice tab).
 */
export function missingGermanVoice(voice: string, voices: VoiceInfo[], settings: LangSettings): string | null {
  const src = voices.find((v) => v.id === voice);
  if (!src || src.lang === "de" || voices.some((v) => v.installed && v.lang === "de" && v.engine !== "azure")) return null;
  const piper = (id: unknown) => voices.some((v) => v.id === id && (v.engine ?? "piper") === "piper");
  const chosen = typeof settings.ttsGermanVoice === "string" && piper(settings.ttsGermanVoice) ? settings.ttsGermanVoice : "";
  return chosen || (female(src) ? GERMAN_FEMALE : GERMAN_MALE);
}
