// The assistant cannot answer right now (its account hit the usage limit, its login expired, the
// provider is down): what it says — once, plainly — and for how long nothing more is sent to it.
// Pure (unit tested).
//
// Rob, 14.11.2026: „das Guthaben war alle und er ist immer weiter in einer Schleife gelaufen und
// hat gesagt ‚warte noch kurz, ich gebe dir gleich Bescheid‘ — anstatt dass er sagt, dass das
// Guthaben leer ist.“ A limit ends no turn the usual way, so the fillers („Moment.“, „Ich bin noch
// dran.“) ran on, and every new sentence started them again.
import type { Session } from "./api";

export type Trouble = "limit" | "auth" | "model" | "server" | "network" | "request" | "unknown";

export interface CantAnswer {
  kind: Trouble;
  message: string;
  /** when it happened (ms) — one failure is told once */
  at: number;
}

/** The session's turn failed or it is rate-limited: why it cannot answer, else null. */
export function cantAnswer(s: Pick<Session, "runtime"> | undefined | null): CantAnswer | null {
  const rt = s?.runtime;
  if (!rt) return null;
  const message = rt.error?.message ?? rt.attention ?? "";
  const at = rt.error?.at ?? rt.turnEndedAt ?? 0;
  if (rt.status === "rate-limited") return { kind: "limit", message, at };
  if (rt.status === "error") return { kind: (rt.error?.kind as Trouble) ?? "unknown", message, at };
  return null;
}

/**
 * When a limit resets, from the CLI's own words („resets 2:20am (Europe/Berlin)“, „resets 11am“,
 * „resets at 14:30“): the next time the clock shows that after `at`. Null when it does not say.
 */
export function limitResetAt(message: string, at: number): number | null {
  const m = message.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const base = new Date(at || Date.now());
  const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min, 0, 0).getTime();
  return t > base.getTime() ? t : t + 24 * 3600_000;
}

const clock = (ms: number, en: boolean) => {
  const d = new Date(ms);
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (!en) return `${d.getHours()}:${mm} Uhr`;
  const h = d.getHours() % 12 || 12;
  return `${h}:${mm} ${d.getHours() < 12 ? "am" : "pm"}`;
};

/** One plain sentence (two at most) for the ear: what is wrong and what helps. No waiting phrases. */
export function cantAnswerSpeech(c: CantAnswer, en = false): string {
  switch (c.kind) {
    case "limit": {
      const reset = limitResetAt(c.message, c.at);
      if (en) return reset ? `My usage limit is used up. I can go on at ${clock(reset, true)}.` : "My usage limit is used up, so I cannot answer right now.";
      return reset ? `Mein Kontingent ist aufgebraucht. Ab ${clock(reset, false)} kann ich weitermachen.` : "Mein Kontingent ist aufgebraucht, ich kann gerade nicht antworten.";
    }
    case "auth":
      return en ? "I am not logged in any more. Please log my account in again under Accounts." : "Ich bin nicht mehr angemeldet. Bitte melde mein Konto unter Accounts neu an.";
    case "model":
      return en ? "My account cannot use the model that is set. Please choose another model for me." : "Mein Konto darf das eingestellte Modell nicht nutzen. Bitte wähl ein anderes Modell für mich.";
    case "server":
      return en ? "The provider is overloaded right now. Please try again in a minute." : "Der Anbieter ist gerade überlastet. Versuch es bitte in einer Minute noch einmal.";
    case "network":
      return en ? "I have no connection right now. Please try again when the network is back." : "Ich habe gerade keine Verbindung. Versuch es bitte noch einmal, wenn das Netz wieder da ist.";
    case "request":
      return en ? "The provider rejected that request. A fresh chat usually helps." : "Der Anbieter hat die Anfrage abgelehnt. Ein neuer Chat hilft meistens.";
    default:
      return en ? "Something went wrong, I cannot answer right now." : "Da ist etwas schiefgegangen, ich kann gerade nicht antworten.";
  }
}

/**
 * Hold a new spoken message back? Only while a limit is in force — it would wait in the queue and
 * be carried out hours later, when nobody expects it. Other failures are often over a minute
 * later: the message goes out and the answer shows whether it works again.
 */
export function holdsMessages(c: CantAnswer | null, now = Date.now()): boolean {
  if (!c || c.kind !== "limit") return false;
  const reset = limitResetAt(c.message, c.at);
  return reset == null || now < reset;
}
