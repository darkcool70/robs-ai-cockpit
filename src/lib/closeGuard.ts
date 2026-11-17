import type { Session } from "./api";

/** An agent counts as "working" only while it is mid-turn; open or idle sessions do not hold up closing. */
export function workingAgentNames(sessions: Record<string, Session>): string[] {
  return Object.values(sessions)
    .filter((s) => s.kind === "agent" && s.runtime?.running && s.runtime.status === "working")
    .map((s) => s.name);
}

/** A repeated close click after this long means "I really want out" (escape hatch if the dialog cannot be answered). */
export const FORCE_CLOSE_AFTER_MS = 3000;

/** What to do with a close request: nothing pending -> ask; dialog already open -> ignore a quick repeat, close on a deliberate one. */
export function closeDecision(working: number, askedAt: number | null, now: number): "close" | "ask" | "ignore" {
  if (working === 0) return "close";
  if (askedAt === null) return "ask";
  return now - askedAt >= FORCE_CLOSE_AFTER_MS ? "close" : "ignore";
}

export function closeTexts(names: string[], en: boolean) {
  const list = names.join(", ");
  const n = names.length;
  return en
    ? {
        title: "Agents are still working",
        body: `${n === 1 ? "1 agent is" : `${n} agents are`} still working: ${list}. Closing the cockpit ends ${n === 1 ? "its" : "their"} session.`,
        close: "Close anyway",
        keep: "Keep running",
      }
    : {
        title: "Agenten arbeiten noch",
        body: `${n === 1 ? "1 Agent arbeitet" : `${n} Agenten arbeiten`} noch: ${list}. Beim Schließen wird ${n === 1 ? "seine Sitzung" : "ihre Sitzung"} beendet.`,
        close: "Trotzdem schließen",
        keep: "Offen lassen",
      };
}
