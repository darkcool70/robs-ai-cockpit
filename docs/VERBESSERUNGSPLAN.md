# Verbesserungsplan

Stand: 17.11.2026. Ziel: Die App fühlt sich fertig an. Das Board bedient sich wie ein echtes
Whiteboard, das Gespräch mit dem Assistenten läuft ohne Reibung, und Alltägliches (Konten,
Anmelden, Schließen und Öffnen, Fenster) funktioniert einfach.

Die Punkte stammen aus Robs Rückmeldungen vom 13./14.11., aus dem Protokoll von Janas Sitzungen
und aus einer Durchsicht des Codes. Größe: S = Stunden, M = ein Tag, L = mehrere Tage.

Status: ✅ erledigt und geprüft · 🟡 gebaut, noch nicht am Bildschirm oder mit Mikrofon geprüft ·
⬜ offen.

## 1. Erledigt in dieser Runde

| Status | Was | Hinweis |
|---|---|---|
| ✅ | Atlas findet Bilder selbst (`find`), neues leeres Board per Wort | in Testinstanz geprüft |
| ✅ | App lässt sich nach dem Schließen wieder öffnen | Ursache: das unsichtbare Benachrichtigungsfenster hielt den Prozess am Leben; `lib.rs` beendet die App jetzt mit dem Hauptfenster |
| 🟡 | Gespräch endet bei „passt so“, „fertig“, „danke“ – nichts wird gesendet | `src/lib/talkFlow.ts`; mit Mikrofon prüfen |
| 🟡 | Nach einer Antwort ohne Frage bleibt das Mikro nur 5 s offen, dann Ruhe ohne „Standby.“ | Einstellung `voiceFollowUpMs` hat noch keine Oberfläche (siehe 3.4) |
| 🟡 | Atlas antwortet in einem Satz, fragt nicht aus Höflichkeit, schweigt bei Störgeräuschen | Anweisungen in `pro/src-tauri/assistants.rs`; hängt vom Modell ab |
| 🟡 | Weckwort zählt nach Klang („Yana“, „Janna“, „Hey Jana“, „Okay, Jana“) und reagiert schneller | `src-tauri/src/wake.rs`; mit Mikrofon prüfen |
| 🟡 | „Mach die Karte kleiner / größer / ganz groß“ | `card_update` mit `size` |
| 🟡 | Karten und Rahmen per Ziehen in der Größe ändern | `pro/src/resize.ts`, Griffe an Ecken und Kanten |
| 🟡 | Anmelden direkt bei Accounts in einem Dialog, ohne Wechsel in den Workspace | `src/components/LoginDialog.tsx` |
| ✅ | Karten und Rahmen per Ziehen in der Größe ändern | in Testinstanz gezogen und gemessen |
| ✅ | Anmelde-Dialog bei Accounts öffnet mit eingebettetem Terminal, kein Wechsel in den Workspace | in Testinstanz geöffnet; echte Anmeldung je Anbieter noch offen (4.3) |
| ✅ | Strg+A, Alt+Pfeile schubsen, Strg+D duplizieren, Strg+Z | in Testinstanz geprüft |
| 🟡 | Mehrere Karten gemeinsam verschieben, Auswahlrahmen (Umschalt + Ziehen), Strg+C / V, Schwenken mit mittlerer Maustaste | `pro/src/boardSelect.ts`; mit der Maus noch nicht geprüft |
| ✅ | Bilder, die aufeinander folgen, stehen nebeneinander (bis drei pro Reihe) | in Testinstanz geprüft |
| ✅ | Zwei Bildkarten mit demselben Suchwort zeigen zwei verschiedene Bilder | in Testinstanz geprüft |
| ✅ | Schnellauswahl auf dem Board: kurze Chips, der Assistent wählt nach ein paar Sekunden selbst, die Karte schrumpft dann auf eine blasse Zeile, beim Darüberfahren kommt sie zurück, ein Klick stellt um | `pro/src/quickChoice.ts`; Nachricht an den Assistenten nur bei abweichender Wahl |
| 🟡 | Benachrichtigungs-Blase: kleine Karten mit ×, „Alle schließen“, verschwinden von selbst, Kugel mit × ausblendbar, Fenster nur so groß wie der Inhalt, helles Design | `src/components/Hud.tsx`; am Bildschirm noch nicht geprüft |
| 🟡 | Kein Vertrösten mehr, wenn nichts kommen kann: bei leerem Kontingent, abgelaufener Anmeldung oder Ausfall sagt der Assistent einmal klar, was los ist (mit Uhrzeit, ab wann es weitergeht), und das Gespräch endet; neue Sätze werden bis dahin nicht gesendet | `src/lib/cantAnswer.ts` |
| ✅ | Fenstergröße und -position werden gemerkt; Schließen beendet die App sauber | in Testinstanz geprüft |
| 🟡 | Schließen fragt nach, wenn Agenten noch arbeiten | `src/components/CloseGuard.tsx`; ohne laufende Agenten nicht prüfbar |

## 2. Whiteboard – was ein Anwender ohne Nachdenken erwartet

| Nr. | Was | Größe |
|---|---|---|
| 2.1 | Ausrichten und Verteilen (links, mittig, gleiche Abstände) für eine Auswahl | M |
| 2.2 | Hilfslinien und Einrasten beim Ziehen (an Kanten und Mitten der Nachbarn) | M |
| 2.3 | Kartenfarbe in der Oberfläche wählbar (das Feld `color` gibt es, kein Menü setzt es) | S |
| 2.4 | Pfeile von jeder Kartenkante ziehen, nicht nur von rechts | S |
| 2.5 | Text und Links per Ziehen aufs Board fallen lassen (Dateien und Bilder gehen schon) | S |
| 2.6 | Kartenmenü: sperren, nach vorn holen | S |
| 2.7 | Doppelklick bearbeitet jede Karte direkt (lesbare Karten öffnen heute die Leseansicht) – entscheiden | S |
| 2.8 | Zoom-Klippe bei 42 %: darunter zeigen Karten nur Titel; „Alles zeigen“ landet oft darunter | M |
| 2.9 | Mausrad: heute schwenkt es, Strg+Rad zoomt. Wie in Miro wäre Rad = Zoom. Als Einstellung anbieten | S |
| 2.10 | Abschnitte per Ziehen umsortieren und in der Oberfläche umbenennen | M |
| 2.11 | Größe ändern für mehrere gewählte Karten zugleich; Rahmen kleiner als sein Inhalt | S |
| 2.12 | Helle Ansicht: Wissensgraph, Demo-Bühne und Teile der Crew-Ansicht sind noch dunkel | S–M |
| 2.13 | Abschnittsrahmen wächst nicht mit, wenn eine Karte darin größer gezogen wird | S |
| 2.14 | Rückgängig fasst eigene Änderungen mit Atlas' laufender Runde zusammen, wenn man mitten in seiner Runde etwas ändert | S |

## 3. Sprache und Assistent

| Nr. | Was | Größe |
|---|---|---|
| 3.1 | Live-Test mit Mikrofon: Gesprächsende, Folgefenster, Weckwort, Unterbrechen (Barge-in), Schwellen | S (nur Test) |
| 3.2 | Störgeräusche früher abfangen, bevor ein Modell-Zug entsteht (z. B. Mindestlänge, Sprecher-Nähe über Pegel) | M |
| 3.3 | Bildsuche kennt nur Wikimedia Commons: „grünes Schwein“ findet ein Schwein auf einer Wiese. Zweite Quelle oder erzeugte Bilder als Wahl | M |
| 3.4 | Einstellungen ohne Oberfläche: `voiceFollowUpMs` (Folgefenster), `voiceWelcomeMin` | S |
| 3.5 | Doppelte Einstellungen im Sprach-Tab („Language“, „Main shortcut“ je zweimal) | S |
| 3.6 | „Automatic“ als Sprache wirkt nicht: die Oberfläche prüft nur auf „en“ | S |
| 3.7 | Weckwort-Rückfall ist „Computer“, der Hinweis sagt „Name des Operators“ | S |
| 3.8 | Stumm-Taste gilt nur im Fenster; ein globales „Stopp / Stumm“ fehlt | M |
| 3.9 | Atlas startet auf dem schnellen, schwächeren Modell; für Board-Arbeit prüfen, ob das mittlere besser passt | S (Entscheidung) |
| 3.10 | Seite lesen las im alten Stand das falsche Browserfenster – im neuen Stand nachprüfen | S |
| 3.11 | Bei leerem Kontingent automatisch auf ein anderes Konto wechseln und das ansagen („Ich mache mit dem Codex-Konto weiter“) statt nur abzubrechen | M |
| 3.13 | Bildsuche liefert oft schwache Motive („Katzenbaby“ ergab Schweine bzw. Straßenkatzen): Treffer nach Qualität sortieren, auf Wikimedia „Quality images“ bevorzugen, zweite Quelle | M |
| 3.14 | Schnellauswahl: Abschnittsrahmen schrumpft nicht mit, wenn die Karte zurücktritt | S |
| 3.12 | Atlas ruft Werkzeuge beim ersten Mal mit falschen Argumenten auf (Schema wird nachgeladen) – kostet eine Runde; Werkzeugliste beim Start vorladen | S |

## 4. Konten und App-Rahmen

| Nr. | Was | Größe |
|---|---|---|
| 4.3 | Anmelde-Dialog live prüfen: jeder Anbieter einmal, „erneut anmelden“, Gerätecode | S (nur Test) |
| 4.4 | Anmelden, während Sitzungen des Kontos laufen, wird mit einer rohen englischen Meldung abgelehnt – im Dialog anbieten, sie zu beenden | S |
| 4.5 | Sitzungen nach einem Neustart der App wieder aufnehmen (heute von Hand) | M |
| 4.6 | Autostart und Symbol im Infobereich (im Hintergrund weiterlaufen, wenn gewünscht) | M |
| 4.7 | Update-Weg für installierte Versionen (heute nur aus dem Quellcode) | M |
| 4.8 | Lokale Installation: `scripts/install-local.ps1` zielt auf einen anderen Ordner als die installierte App und baut ohne Pro und ohne Lizenz-Adresse – ein Befehl, der die laufende Installation richtig ersetzt | S |

## 5. Sprache der Oberfläche und Feinschliff

| Nr. | Was | Größe |
|---|---|---|
| 5.1 | Eigene Einstellung für die Sprache der Oberfläche (heute bestimmt die Sprach-Einstellung der Stimme die ganze Oberfläche) | M |
| 5.2 | Grund-App ist englisch, das Board deutsch: Sprach-Tab, Einstellungen, Accounts, Bestätigungsfragen, Meldungen einheitlich übersetzen | M–L |
| 5.3 | Rohe Fehlermeldungen aus dem Backend freundlich und in der gewählten Sprache (auch bei Warnungen und Hinweisen, nicht nur bei Fehlern) | S |
| 5.4 | Startfehler-Seite: verständlich, mit „Erneut versuchen“ in der gewählten Sprache | S |
| 5.5 | Alte Sicherungsdateien entfernen (`*.bak`, Test-WAV, Test-Screenshot) | S |

## 6. Reihenfolge

1. **Prüfen, was gebaut ist** (3.1, 4.3 und alles mit 🟡): eine halbe Stunde mit Mikrofon und Maus,
   Auffälligkeiten als Liste zurück.
2. **Alltag** (4.4, 4.8): schließen, öffnen, anmelden, installieren ohne Stolpern.
3. **Whiteboard-Grundlagen** (2.1 bis 2.6): damit fühlt sich das Board vollständig an.
4. **Sprache der Oberfläche** (5.1 bis 5.4): ein Guss statt Deutsch und Englisch gemischt.
5. **Größere Brocken** (2.8, 3.2, 3.3, 4.5 bis 4.7) einzeln, jeweils mit Entscheidung von Rob vorab.

## 7. Arbeitsweise mit Unteragenten

Kleinere, klar umrissene Punkte gehen an günstigere Modelle. Damit das sicher bleibt:

- Jeder Agent bekommt einen Auftrag mit festem Dateibereich; zwei Agenten schreiben nie in dieselben
  Dateien. `pro/src/BoardView.tsx` bearbeitet immer nur einer zur Zeit.
- Reine Logik kommt in ein eigenes kleines Modul mit Tests; die Agenten lassen Typprüfung und Tests
  laufen und melden die Zahlen.
- Agenten sehen die Oberfläche nicht. Was sie bauen, gilt als 🟡, bis es in einer Testinstanz
  (`AI_COCKPIT_HOME`, siehe `docs/DEVELOPMENT.md`) oder von Rob geprüft ist.
- Agenten committen nicht und bauen keine Releases. Das macht die Hauptsitzung nach der Prüfung.
