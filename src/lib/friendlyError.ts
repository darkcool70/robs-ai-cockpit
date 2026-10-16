// Error messages from the backend are written for developers ("no logged-in account", "Session is
// not running"). In a notice they should read like a person helping: what happened, in the room's
// language, and what to do. Unknown messages stay as they are. Pure (unit tested).

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const DE: Rule[] = [
  [/^no logged-in account( for the crew)?\.?$/i, () => "Kein angemeldetes Konto frei – melde unter „Accounts“ ein Claude- oder Codex-Konto an."],
  [/^(bad provider|unknown provider)$/i, () => "Dieses Konto hat einen unbekannten Anbieter – bitte unter „Accounts“ prüfen."],
  [/^session has no account( \(profile was removed\))?$/i, () => "Zu dieser Sitzung gibt es kein Konto mehr – wähle unter „Accounts“ ein anderes."],
  [/^session is not running\.?$/i, () => "Die Sitzung läuft gerade nicht – starte sie zuerst."],
  [/^session has no terminal\.?$/i, () => "Diese Sitzung hat noch kein Terminal – starte sie zuerst."],
  [/^session is already running\.?$/i, () => "Die Sitzung läuft schon."],
  [/still stopping/i, () => "Die Sitzung hält gerade noch an – versuch es gleich noch einmal."],
  [/^previous process has not stopped yet/i, () => "Der vorige Prozess läuft noch – versuch es gleich noch einmal."],
  [/^nothing to send\.?$/i, () => "Nichts zu senden."],
  [/^the board is too big(?: to share)?(?: \(max (\d+) MB\))?\.?$/i, (m) => `Das Board ist zu groß${m[1] ? ` (höchstens ${m[1]} MB)` : ""}.`],
  [/^the board picture is too big\.?$/i, () => "Das Bild des Boards ist zu groß."],
  [/^the slides are too big\.?$/i, () => "Die Folien sind zu groß."],
  [/^invalid board\.?$/i, () => "Dieses Board ließ sich nicht lesen."],
  [/^the official `([^`]+)` CLI was not found/i, (m) => `Die offizielle ${m[1]}-CLI wurde nicht gefunden. Installiere sie oder trage ihren Pfad in den Einstellungen ein.`],
  [/^`([^`]+)` was not found\. Install it/i, (m) => `„${m[1]}“ wurde nicht gefunden. Installiere es oder trage den vollen Pfad in der Befehlszeile des Profils ein.`],
  [/^working directory (.+?) (?:no longer exists|does not exist)\.?$/i, (m) => `Der Arbeitsordner ${m[1]} existiert nicht (mehr).`],
  [/^project path must be an existing directory\.?$/i, () => "Der Projektpfad muss ein vorhandener Ordner sein."],
  [/^project not found\.?$/i, () => "Das Projekt wurde nicht gefunden."],
  [/^stop this account's (?:running )?sessions/i, () => "Beende zuerst die laufenden Sitzungen dieses Kontos – andere Konten können weiterlaufen."],
  [/^stop the agent working in this worktree first\.?$/i, () => "Beende zuerst den Agenten, der in diesem Arbeitsbaum arbeitet."],
  [/^speech recognition is not installed yet/i, () => "Die Spracherkennung ist noch nicht installiert (Reiter „Voice“)."],
  [/^a download is already running\.?$/i, () => "Ein Download läuft bereits."],
  [/^not a web address/i, () => "Das ist keine gültige Webadresse."],
  [/^the file no longer exists\.?$/i, () => "Die Datei gibt es nicht mehr."],
  [/^not a (?:png )?picture\.?$/i, () => "Das ist kein Bild."],
  [/^not a pdf\.?$/i, () => "Das ist keine PDF-Datei."],
  [/^text is too long\.?$/i, () => "Der Text ist zu lang."],
  [/^this session has no conversation yet\.?$/i, () => "Diese Sitzung hat noch kein Gespräch – schick zuerst eine Nachricht."],
  [/^this task has no project\.?$/i, () => "Diese Aufgabe gehört zu keinem Projekt."],
  [/^this task has no own worktree\.?$/i, () => "Diese Aufgabe hat keinen eigenen Arbeitsbaum."],
  [/^your pro trial has ended/i, () => "Die Pro-Testphase ist vorbei. Mit Robs AI Cockpit Pro (Einstellungen → Pro) arbeiten Assistenten und Ziele weiter."],
  [/^choose an account for (.+?)\.?$/i, (m) => `Wähle zuerst ein Konto für ${m[1]}.`],
  [/^give (.+?) a goal first\.?$/i, (m) => `Gib ${m[1]} zuerst ein Ziel.`],
  [/^(.+?) has no session\.?$/i, (m) => `${m[1]} hat noch keine Sitzung.`],
  [/^the board is empty\.?$/i, () => "Das Board ist leer."],
  [/^too few cards for a film\.?$/i, () => "Zu wenige Karten für einen Film."],
  [/^(?:failed to fetch|networkerror)/i, () => "Keine Verbindung – bitte das Netzwerk prüfen."],
  [/^git not available/i, () => "Git ist nicht verfügbar – ist es installiert?"],
];

/** The message as a person would say it (German unless `en`); unknown ones unchanged. */
export function friendlyError(text: string, en = false): string {
  const t = text.trim().replace(/^Error:\s*/i, "");
  if (en) return t;
  for (const [re, say] of DE) {
    const m = t.match(re);
    if (m) return say(m);
  }
  return t;
}
