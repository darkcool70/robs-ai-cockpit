# Glossar — die Wörter des Cockpits

Ein Begriff, überall dasselbe Wort: in der Oberfläche, in Atlas' Antworten, in Meldungen und in
der Doku. Neue Texte nehmen diese Wörter (Board-3.0-Plan, Abschnitt 8 „Sprache und Texte“).
Englisch gilt für den englischen Modus.

## Das Board

| Deutsch | Englisch | Bedeutung | Nicht |
|---|---|---|---|
| **Board** | Board | Ein Arbeitsraum zu einer Frage, mit Titel, „Kurz gesagt“, Abschnitten und Verlauf | Leinwand, Whiteboard (nur in Erklärungen) |
| **Art des Boards** (Aufbau) | Shape | Wofür das Board ist: Entscheiden, Vergleichen, Fehlersuche, Planen, Ideen sammeln, Recherche, Verstehen. Sie bestimmt die Abschnitte | Stil (eine **Vorlage** ist etwas anderes, siehe unten) |
| **Abschnitt** | Section | Eine Spalte des Boards in Leserichtung (Ziel & Kontext, Quellen, Zahlen …) | Lane, Spalte, Zone (nur im Code) |
| **Kapitel** | Chapter | Ein eigener Abschnitt nach dem Inhalt („Umsetzung“), auch ein Rahmen von Atlas | Gruppe |
| **Rahmen** | Frame | Ein Kasten um Karten; zugeklappt eine kompakte Karte | Gruppe, Container |
| **Karte** | Card | Ein Ding auf dem Board: Familie, Inhalt, Herkunft, Zustand | Node, Element, Kachel |
| **Pfeil** | Arrow | Eine Verbindung mit Bedeutung („stützt“, „verursacht“ …) | Kante, Edge, Link |
| **Beleg** | Evidence | Was eine Aussage stützt oder ihr widerspricht (Quelle, Zahl, Messung) | Nachweis |
| **Quelle** | Source | Woher etwas kommt: Webseite, Datei, Agentenergebnis | Referenz |
| **Hypothese** | Hypothesis | Eine offene Vermutung mit Konfidenz; ab zwei Belegen „bestätigt“ oder „verworfen“ | These (nur in der Art „Recherche“) |
| **Kurz gesagt** | In short | Das Ergebnis des Boards in einem Satz, oben im Titelblock | Fazit, Zusammenfassung |
| **Rezept** | Recipe | Was ein gutes Board seiner Art enthalten muss; in „Info“ als Checkliste | Pflichtfelder |
| **Große Ansicht** | Large view | Eine Karte groß mit ihren Belegen ringsum (Leertaste) | Zoom, Lupe, Detailansicht |
| **Übersicht** | Overview | Alle Boards eines Bereichs als Kacheln | Dashboard |
| **Verlauf** | History | Die Schritte eines Boards zum Zurückspulen; „Wiederherstellen“ | Historie, Versionen |
| **Vorlage** | Template | Fragekarten für ein neues Board seiner Art („Was entscheiden wir?“, „Option A“), zum Ausfüllen; „Mit Vorlage beginnen“ | Muster, Gerüst |
| **Folie** | Slide | Ein Abschnitt (oder Kapitel) beim Präsentieren; seine Karten fliegen hinein | Seite, Slide |
| **Referentenansicht** | Presenter view | Das zweite Fenster beim Präsentieren: was du sagst, die nächste Folie, die Zeit | Sprecheransicht, Moderatorenansicht |
| **Ebenen** | Layers | Nur Belege, Aussagen, Offenes … zeigen, der Rest tritt zurück (L) | Filter |
| **Röntgenblick** | X-ray | Alt halten: woher jede Karte kommt | Debug-Ansicht |
| **Bereich** | Workspace | Eine benannte Gruppe von Boards („Marketing“) | Projekt (das ist der Ordner) |

## Atlas und die Crew

| Deutsch | Englisch | Bedeutung | Nicht |
|---|---|---|---|
| **Atlas** | Atlas | Der Operator: arbeitet mit dir am Board, steuert Agenten (eigener Name möglich) | Bot, KI, Assistent (nur allgemein) |
| **Runde** | Round | Eine Antwort von Atlas mit allem, was er dabei tut; ein Rückgängig-Schritt, ein Schritt im Verlauf | Turn |
| **Plan** (in der Kapsel) | Plan | Atlas' 2–5 Schritte für eine größere Aufgabe | To-do |
| **Vorschlag** | Suggestion | Eine Änderung von Atlas an deiner Karte, die auf dein ✓ wartet; auch die Geisterkarte | Empfehlung (das ist eine Entscheidungskarte) |
| **Agent** | Agent | Eine Coding-Sitzung (Claude Code, Codex …), die eine Aufgabe erledigt | Worker, Bot |
| **Crew** | Crew | Mehrere Agenten an einer Frage, sichtbar im Rahmen „Crew“ | Team, Schwarm |
| **Übernehmen** | Take over | Geprüfte Änderungen eines Agenten in das Projekt holen | Mergen (nur in Git-Texten) |
| **Konto** | Account | Ein angemeldetes Claude-, Codex-, Copilot- oder Antigravity-Profil | Profil (nur technisch) |
| **Kontingent** | Quota | Was ein Konto im Zeitfenster noch darf | Limit, Budget |

## Meldungen

- Jede Meldung sagt in Klartext, was los ist, und den nächsten Schritt („Kein Konto angemeldet –
  unter *Konten* anmelden“), nie eine rohe Fehlermeldung (`src/lib/friendlyError.ts`).
- Zustand statt Technik: „Atlas braucht dich – rechts im Chat“ statt „needs permission“.
- Zahlen mit Bedeutung: „noch 16 % übrig“ statt „bei 16 %“.
