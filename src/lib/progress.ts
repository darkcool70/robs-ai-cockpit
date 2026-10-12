// Never feel a wait: while the agent works on what you said, it tells you what it is doing right now
// („Ich suche kurz im Netz.“, „Ich lese gerade bei MDN nach.“, „Ich baue die Karten auf.“) — from its
// real activity (the tool it uses, see monitor.rs), at most one line every ~6–8 s, never the same line
// twice in one wait. Only when there is nothing to report does it fall back to a light filler
// („Ich bin noch dran.“). Pure (unit tested); the timing loop lives in fillers.ts.

export type ProgressLang = "de" | "en";

const SITES: [RegExp, string][] = [
  [/(^|\.)developer\.mozilla\.org$/, "MDN"], [/(^|\.)github\.com$/, "GitHub"], [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)wikipedia\.org$/, "Wikipedia"], [/(^|\.)stackoverflow\.com$/, "Stack Overflow"], [/(^|\.)npmjs\.com$/, "npm"],
  [/(^|\.)docs\.rs$/, "docs.rs"], [/(^|\.)reddit\.com$/, "Reddit"], [/(^|\.)anthropic\.com$/, "Anthropic"], [/(^|\.)openai\.com$/, "OpenAI"],
];

/** A site as one would say it: "MDN", "GitHub", else its name without www ("webassembly.org"). */
export function siteName(url: string): string | null {
  const host = url.replace(/^[a-z]+:\/\//i, "").split(/[/?#:]/)[0].toLowerCase().replace(/^www\./, "");
  if (!host || !host.includes(".")) return null;
  return SITES.find(([re]) => re.test(host))?.[1] ?? host;
}

type Lines = { de: string[]; en: string[] };

const LINES: Record<string, Lines> = {
  fetch: {
    de: ["Ich lese gerade die Quelle.", "Ich schau mir die Seite an.", "Ich lese mich da gerade ein."],
    en: ["Reading a page.", "Looking at the source.", "Reading up on it."],
  },
  search: {
    de: ["Ich suche kurz im Netz.", "Ich schau mal, was es dazu im Netz gibt.", "Ich suche noch nach guten Quellen."],
    en: ["Searching the web.", "Looking around online.", "Still looking for good sources."],
  },
  readDoc: {
    de: ["Ich lese gerade die Unterlagen.", "Ich schau mir die Datei an.", "Ich lese noch ein Stück weiter."],
    en: ["Reading the notes.", "Looking at the file.", "Reading a bit further."],
  },
  readCode: {
    de: ["Ich schau mir den Code an.", "Ich lese mich gerade in den Code ein.", "Ich schau noch in eine andere Datei."],
    en: ["Looking at the code.", "Reading into the code.", "Checking another file."],
  },
  find: {
    de: ["Ich suche die richtige Stelle.", "Ich such mir die passenden Stellen raus."],
    en: ["Finding the right spot.", "Looking for the right places."],
  },
  edit: {
    de: ["Ich schreib gerade am Code.", "Ich trage die Änderung ein.", "Ich bin gerade beim Umbauen."],
    en: ["Writing the code now.", "Putting the change in.", "Reworking it right now."],
  },
  board: {
    de: ["Ich baue die Karten auf.", "Ich leg das gerade aufs Board.", "Ich sortiere die Karten noch."],
    en: ["Setting up the cards.", "Putting it on the board.", "Arranging the cards."],
  },
  tests: {
    de: ["Ich lass kurz die Tests laufen.", "Die Tests laufen noch."],
    en: ["Running the tests.", "The tests are still running."],
  },
  build: {
    de: ["Ich bau das kurz.", "Der Build läuft noch."],
    en: ["Building it.", "Still building."],
  },
  helper: {
    de: ["Ich hab einen Helfer losgeschickt.", "Mein Helfer ist noch unterwegs."],
    en: ["I sent a helper off.", "My helper is still on it."],
  },
  run: {
    de: ["Ich lass kurz was laufen.", "Das läuft noch kurz."],
    en: ["Running something quickly.", "That's still running."],
  },
};

/** Light lines when there is nothing to report — by how long it has been. */
const IDLE: { de: string[][]; en: string[][] } = {
  de: [
    ["Moment.", "Ich schau kurz.", "Sekunde.", "Ich bin dran."],
    ["Ich bin noch dran.", "Gleich hab ich's.", "Einen Augenblick noch.", "Dauert noch einen kleinen Moment."],
    ["Das ist etwas mehr, ich bin gleich so weit.", "Ich will's richtig machen, gleich.", "Noch einen Augenblick, ich sortiere noch.", "Gute Frage übrigens, gleich hast du's."],
  ],
  en: [
    ["One moment.", "Let me check.", "Just a second.", "On it."],
    ["Still on it.", "Almost there.", "Just a little longer.", "Bear with me a moment."],
    ["This one is a bit bigger, nearly done.", "I want to get it right, one moment.", "Still sorting things out.", "Good question, by the way, nearly there."],
  ],
};

const DOC = /\.(md|mdx|txt|pdf|csv|tsv|json|ya?ml|html?|docx?|xlsx?|log)\b/i;

/** What kind of thing the agent is doing, from its live activity ("Fetching https://…", "Editing a.ts" …). */
export function activityKind(activity: string | null | undefined): string | null {
  const a = (activity ?? "").trim();
  if (!a || /^(Thinking|Updating the todo list)/.test(a)) return null;
  if (/^Fetching /.test(a)) return "fetch";
  if (/^Web search:/.test(a)) return "search";
  if (/^Reading /.test(a)) return /\b(board|karte|cards?)\b/i.test(a) ? "board" : DOC.test(a) ? "readDoc" : "readCode";
  if (/^Searching /.test(a)) return "find";
  if (/^(Editing|Writing) /.test(a)) return /\bboard/i.test(a) ? "board" : "edit";
  if (/^Subagent:/.test(a)) return "helper";
  if (/^Tool /.test(a)) return /board|card|karte/i.test(a) ? "board" : null;
  if (/\b(board|karten|cards?|frames?)\b/i.test(a)) return "board";
  if (/\b(tests?|vitest|jest|pytest|cargo test|spec)\b/i.test(a)) return "tests";
  if (/\b(build|bauen|compile|kompilier\w*|tsc|cargo check)\b/i.test(a)) return "build";
  // a Bash description ("Run the linter") or "Running …": say that it runs, not the English words
  return "run";
}

/** The lines for an activity, the site named first when it is a page („Ich lese gerade bei MDN nach.“). */
export function activityLines(activity: string | null | undefined, lang: ProgressLang): string[] {
  const kind = activityKind(activity);
  if (!kind) return [];
  const lines = [...LINES[kind][lang]];
  if (kind === "fetch") {
    const site = siteName((activity ?? "").trim().replace(/^Fetching /, "").split(/\s/)[0] ?? "");
    if (site) lines.unshift(lang === "de" ? `Ich lese gerade bei ${site} nach.` : `Reading up on ${site}.`);
  }
  return lines;
}

/** Wait between two lines: ~6–8 s, calmer after a long wait (~11–14 s after 45 s), calmer still when it should talk less. */
export function progressGap(elapsedMs: number, rnd: () => number = Math.random, brief = false): number {
  const base = elapsedMs > 45_000 ? 11_000 + rnd() * 3000 : 6000 + rnd() * 2000;
  return Math.round(brief ? base * 1.5 : base);
}

export interface ProgressInput {
  /** since the message went out */
  elapsedMs: number;
  /** since anything was last said (the acknowledgement, its own words, a line) */
  sinceSpokeMs: number;
  /** the wait before the next line (progressGap) */
  gapMs: number;
  /** how many progress lines were said in this wait */
  count: number;
  activity: string | null | undefined;
  /** everything said in this wait (never twice) */
  said: readonly string[];
  lang: ProgressLang;
  /** „sprich weniger“: only real progress, no fillers */
  brief?: boolean;
}

/**
 * The next line to say while it works, or null (not yet / nothing new). Real activity first — the
 * first one ~2 s after the acknowledgement — then a filler only when there is nothing to report.
 */
export function nextProgressLine(o: ProgressInput, rnd: () => number = Math.random): { text: string; source: "activity" | "filler" } | null {
  if (o.elapsedMs < 2500) return null;
  const fresh = activityLines(o.activity, o.lang).find((x) => !o.said.includes(x));
  if (fresh) return o.sinceSpokeMs >= (o.count === 0 ? 1800 : o.gapMs) ? { text: fresh, source: "activity" } : null;
  if (o.brief || o.elapsedMs < 5500 || o.sinceSpokeMs < Math.max(o.count === 0 ? 5000 : o.gapMs, 5000)) return null;
  const tiers = IDLE[o.lang];
  const tier = o.elapsedMs < 12_000 ? 0 : o.elapsedMs < 25_000 ? 1 : 2;
  for (let t = tier; t < tiers.length; t++) {
    const free = tiers[t].filter((x) => !o.said.includes(x));
    if (free.length) return { text: free[Math.floor(rnd() * free.length) % free.length], source: "filler" };
  }
  return null;
}
