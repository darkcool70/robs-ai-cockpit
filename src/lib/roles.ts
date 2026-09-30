// Role presets for new sessions and teams: autonomy + standing instructions (+ a start task).
import type { Autonomy } from "./api";

export interface Role {
  id: string;
  label: string;
  autonomy: Autonomy;
  instructions: string;
  startTask?: string;
  custom?: boolean;
}

export const BUILTIN_ROLES: Role[] = [
  {
    id: "coder",
    label: "Coder",
    autonomy: "accept-edits",
    instructions: "Du setzt Aufgaben vollständig um. Halte dich an den Stil des bestehenden Codes, teste deine Änderungen und fasse am Ende kurz zusammen, was du geändert hast.",
  },
  {
    id: "tester",
    label: "Tester",
    autonomy: "accept-edits",
    instructions: "Du bist für Tests zuständig: schreibe fehlende Tests, führe die Testsuite aus und behebe fehlschlagende Tests an der Ursache, nicht durch Abschwächen der Tests.",
    startTask: "Führe die Tests aus und berichte, was fehlschlägt oder nicht abgedeckt ist.",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    autonomy: "plan",
    instructions: "Du reviewst Änderungen: suche nach Bugs, Randfällen, Sicherheitsproblemen und unnötiger Komplexität. Ändere nichts ohne Rückfrage; liste Befunde nach Schwere mit Datei und Zeile.",
    startTask: "Reviewe die aktuellen, nicht committeten Änderungen (git diff).",
  },
  {
    id: "docs",
    label: "Doku",
    autonomy: "accept-edits",
    instructions: "Du pflegst die Dokumentation (README, Kommentare, Changelog) passend zum aktuellen Code. Kurz, konkret, keine Marketing-Sprache.",
  },
  {
    id: "planner",
    label: "Planer",
    autonomy: "plan",
    instructions: "Du planst, bevor gebaut wird: analysiere den Code, stelle Rückfragen, schlage einen schrittweisen Plan mit Risiken vor. Keine Änderungen am Code.",
  },
];

/** Built-in roles plus the ones saved in Settings (`rolePresets`). */
export function allRoles(settings: Record<string, unknown>): Role[] {
  const custom = Array.isArray(settings.rolePresets) ? (settings.rolePresets as Role[]).filter((r) => r && r.id && r.label) : [];
  return [...BUILTIN_ROLES, ...custom.map((r) => ({ ...r, custom: true }))];
}
