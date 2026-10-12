# Board 2.0 – Design-Brief

> Ein Board ist ein Whiteboard, an dem ein Projektleiter arbeitet: Er pinnt Dinge **an ihren Platz**,
> nicht irgendwohin. Jede Karte hat einen Grund, wo sie steht. Wer das Board sieht, liest es wie eine
> Seite: von links nach rechts, von oben nach unten.

## 1. Was wir uns angesehen haben (und was wir übernehmen)

| Quelle | Was dort funktioniert | Was das Board daraus macht |
|---|---|---|
| Miro-Workshop-Boards ([Miro: 7 Wege, ein Board zu ordnen](https://miro.com/blog/organize-your-miro-board-for-productive-workshops/)) | Ein Frame je Thema/Phase, **von links nach rechts in der Reihenfolge, in der man sie braucht**; Frames klar benannt („Probleme“, „Ideen“, „Nächste Schritte“); der Moderator strukturiert vor, statt frei abzuladen | Abschnitte als Spalten mit Kopf, feste Reihenfolge, Atlas legt in Abschnitte statt auf Koordinaten |
| FigJam-Sections / Affinity-Mapping ([Figma: Affinity Diagram](https://www.figma.com/templates/affinity-diagram-example/)) | Eine Idee pro Sticky; Cluster mit Überschrift; Sections sind ruhige, getönte Flächen mit Titel | Abschnitt = ruhige Fläche mit Titel und Anzahl; Karten im Abschnitt einheitlich breit, gestapelt |
| Now/Next/Later, Kanban ([Aha!](https://www.aha.io/roadmapping/guide/templates/create/now-next-later-roadmap), [Miro-Vorlage](https://miro.com/templates/now-next-later/)) | Wenige Spalten, ehrliche Reihenfolge, Karten mit Problem/Status/Priorität; Farbe nur als Status | Status nur als kleiner Punkt; „Nächste Schritte“ immer ganz rechts im Standardteil |
| PM-Entscheidungsvorlagen (Kontext → Optionen → Entscheidung → Next Steps) | Die Logik eines Entscheidungsdokuments | Die Reihenfolge der Standard-Abschnitte (s. u.) |
| Apple Freeform ([Apple Support](https://support.apple.com/en-la/guide/freeform/frfm1e6c3d3e/2.0/mac/14.0)) | Große Text-Labels als Abschnittsköpfe, Verwandtes nah beieinander, Verbinder bleiben beim Verschieben verbunden, Raster/Ausrichtungshilfen | Abschnittsköpfe in Titelgröße, Verbinder hängen an Kartenkanten und weichen Karten aus |
| Apple HIG (Typografie, Abstände, Materialien) | System-Schrift (SF Pro), klare Typo-Stufen, großzügige Abstände in 8er-Schritten, Materialien statt harter Ränder, Zurückhaltung bei Farbe | Typo-Skala, 8-pt-Raster, weiche mehrlagige Schatten, eine Akzentfarbe |

## 2. Die Grammatik des Boards – Abschnitte und warum

Ein Board besteht aus **Abschnitten** („Kapiteln“), die als Spalten **von links nach rechts** stehen.
Die Standard-Abschnitte folgen der Logik einer Entscheidung, so wie ein Projektleiter sie führt:

| # | Abschnitt (Schlüssel) | Was hineingehört | Warum hier |
|---|---|---|---|
| 1 | **Ziel & Kontext** (`ziel`) | Ziel, Auftrag, Rahmen, Beteiligte (Entitäten), Text-Überschriften, Themen-Karten | Wer liest, muss zuerst wissen, worum es geht |
| 2 | **Quellen** (`quellen`) | Webseiten, Videos, Dateien, Websuche, angedockte Browser-Fenster, Karten, Bilder | Belege stehen vor dem, was aus ihnen folgt (Pfeile laufen nach rechts) |
| 3 | **Zahlen** (`zahlen`) | Kennzahlen, Diagramme, Tabellen, Daten, Rechner – nur wenn es ≥ 3 davon gibt, sonst unter Erkenntnisse | Ein Dashboard bekommt eine eigene Zahlen-Spalte, eine einzelne Zahl ist eine Erkenntnis |
| 4 | **Erkenntnisse** (`erkenntnisse`) | Notizen, Ideen, Befunde | Was wir aus den Quellen gelernt haben |
| 5 | **Optionen** (`optionen`) | Hypothesen, Auswahl-Karten, Alternativen | Erst wenn die Lage klar ist, werden Wege verglichen |
| 6 | **Offene Fragen** (`fragen`) | Fragen | Was die Entscheidung noch blockiert |
| 7 | **Entscheidung** (`entscheidung`) | Entscheidungen | Das Ergebnis der Kette |
| 8 | **Nächste Schritte** (`schritte`) | Aufgaben, Prompts, Code, Agenten, Änderungen, Wächter | Was daraus folgt – ganz rechts, weil es zuletzt kommt |

Leere Abschnitte werden nicht gezeichnet. Ein Board mit nur Aufgaben ist also nur „Nächste Schritte“.

**Eigene Abschnitte (Kapitel).** Atlas kann einen Abschnitt mit eigenem Namen öffnen („neues Kapitel
rechts: ‚Umsetzung‘“). Eigene Abschnitte stehen **rechts** neben den Standard-Abschnitten, in der
Reihenfolge, in der sie geöffnet wurden. Rahmen von Atlas sind ebenfalls Kapitel: Sie stehen rechts,
und ihre Karten sind innen nach derselben Grammatik in Spalten geordnet.

## 3. Die Wachstumsregel

1. **Nichts wird zufällig platziert.** Jede neue Karte bekommt einen Abschnitt – ausdrücklich
   (`"zone":"erkenntnisse"`) oder aus ihrer Art abgeleitet.
2. **Innerhalb eines Abschnitts** wird von oben nach unten gestapelt: Ketten in Pfeilreihenfolge
   (was eine Karte erklärt, hängt direkt unter ihr), sonst in der Reihenfolge der verlinkten Karten
   links davon (weniger Kreuzungen), dann nach Zeit.
3. **Wird eine Spalte zu hoch** (> 1000 px), bricht sie wie eine Zeitungsspalte in eine zweite
   Unterspalte um – lesen bleibt: runter, dann rechts.
4. **Ein neues Thema / eine neue Phase** öffnet einen neuen Abschnitt **rechts**. Das Board wächst
   nach rechts, nicht wild in alle Richtungen.
5. **Große Karten** (angedockte Webseiten, Datenraster, Karten, Bilder) stehen in ihrem Abschnitt in
   voller Abschnittsbreite – nicht schwebend.
6. **Was du selbst hinstellst, bleibt stehen.** Karten von dir und Karten, die du verschoben hast,
   rührt die Grammatik nicht an; neue Karten weichen ihnen aus. „Ordnen“ in der Werkzeugleiste ordnet
   auf Wunsch alles neu.

## 4. Kartentypen und ihr Aussehen

- **Einheitliche Breite je Abschnitt** (Standard 280–400 px, im 8er-Raster): eine Spalte wirkt ruhig,
  wenn alle Karten gleich breit sind.
- **Kopf:** kleines Symbol (12 px, Farbe der Art, gedämpft) · Titel (13 px, semibold, eine Zeile,
  „…“ mit Tooltip) · Art als leises Wort rechts (10 px, Großbuchstaben, 45 % Deckkraft).
- **Text:** 12,5 px / 1,45, Silbentrennung (`lang="de"`, `hyphens:auto`, `overflow-wrap:anywhere`);
  die Karte wächst mit ihrem Text bis zu einer Höchsthöhe, danach **„mehr ›“** – Text verlässt nie
  seine Karte, auch nicht im exportierten Bild.
- **Status** (Aufgabe, Prompt): ein Punkt – grau offen, blau läuft, grün erledigt. Keine farbigen Ränder.
- **Zahl:** die Zahl groß (32 px, tabellarische Ziffern), darunter eine Zeile Kontext.
- **Hypothese:** Titel, eine Zeile Begründung, schmaler Konfidenzbalken.
- **Entität:** kompakt – Initialen-Kreis, Name, Typ.

## 5. Verbinder

- **Wenige und bedeutsam:** ein Pfeil nur, wenn er eine Aussage trägt (Beleg für, widerspricht,
  führt zu). Höchstens etwa so viele Pfeile wie Karten.
- **Geführt, nicht quer:** Pfeile verlassen die Karte an der Seite zum Ziel, laufen orthogonal mit
  weich gerundeten Ecken (Radius 12) durch die Gassen zwischen den Spalten und **um Karten herum**.
- **Beschriftung nur mit Mehrwert:** eigene, kurze Beschriftungen (≤ 24 Zeichen) werden gezeigt;
  Standard-Beziehungen erkennt man an Linienart und Farbe (gestrichelt = widerspricht/hängt ab von),
  ihr Wort erscheint beim Darüberfahren.
- 1,5 px Linie, 55 % Deckkraft, kleine gefüllte Spitze; keine Leuchteffekte, keine Funken.

## 6. Das visuelle System

- **Schrift:** System-Schrift (`-apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui`).
  Skala: Abschnittskopf 20/600 · Kartentitel 13/600 · Text 12,5/400 · Meta 10,5/500 · Label 10/600 Großbuchstaben.
- **Raster:** 8 pt. Kartenpolsterung 12–16, Abstand zwischen Karten 24, zwischen Abschnitten 64, Kopf über einer Spalte 56.
- **Radien:** Karten 14, Abschnittsflächen 22, Knöpfe/Chips 8 bzw. ganz rund.
- **Material & Tiefe:** Karten als leicht erhabene Fläche (dunkel: `#1c1f26`, hell: `#ffffff`) mit
  1 px Haarlinie (`rgba(255,255,255,.07)` / `rgba(0,0,0,.08)`) und zwei weichen Schatten
  (eng 0 1 2, weit 0 8 24). Werkzeugleisten und Reiter: durchscheinendes Material (`backdrop-filter: blur(20px) saturate(1.6)`).
- **Farbe:** neutrale Flächen, **eine Akzentfarbe** (Systemblau `#0a84ff` dunkel / `#007aff` hell) für
  Auswahl, Fokus, Links. Semantische Farben **nur für Status** (Grün erledigt, Orange offen/Frage,
  Rot widerspricht/Fehler) und nur als kleiner Punkt oder Linie. Die Art einer Karte zeigt ein
  gedämpftes Symbol, kein farbiger Rand, kein Verlauf, kein Neon-Glühen.
- **Hintergrund:** ruhiges Punktraster (dunkel `#121418`, hell `#f5f5f7`).
- **Bewegung:** sanft und kurz (200–350 ms, `cubic-bezier(.2,.8,.2,1)`), Karten erscheinen mit einer
  leichten Überblendung; `prefers-reduced-motion` schaltet Bewegung ab.
- **Lesbar von 50 bis 120 % Zoom:** darunter zeigt das Board nur Titel (semantischer Zoom).

## 7. Prüfsteine

- Jede Karte steht in einem Abschnitt; keine überlappt eine andere; Leserichtung links → rechts.
- Kein Text ragt aus einer Karte (Bild-Export inklusive), lange deutsche Wörter werden getrennt.
- Pfeile laufen nicht durch Karten.
- Vorher/Nachher-Bilder: `scratchpad/board/out/v2-before-*.png` und `v2-after-*.png`.
