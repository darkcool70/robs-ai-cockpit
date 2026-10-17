# Board 3.0 – Atlas und das Board als ein Produkt

> Plan vom 14.10.2026. Auftrag (Rob): Das Board soll schöner werden und mehr Sinn ergeben, vor
> allem aber soll die Zusammenarbeit zwischen Atlas und Board mächtiger, moderner und
> professioneller werden – „als wäre es ein Produkt von Apple“.
>
> Grundlage: Code-Stand 0.4.1, ein Live-Durchgang in einer Testinstanz (Szene „Nordlicht Shop“,
> Fenster 1442×920 und 1600×1000, hell und dunkel, Zoom von 17 bis 125 %) und die bisherigen
> Dokumente [BOARD_DESIGN.md](BOARD_DESIGN.md), [BOARD_ROADMAP.md](BOARD_ROADMAP.md),
> [ERLEBNIS_ANALYSE.md](ERLEBNIS_ANALYSE.md) und [VISION.md](VISION.md).

## Kurzfassung

Das Board kann heute fast alles: 29 Kartenarten, Abschnitte von links nach rechts, Pfeile mit
Bedeutung, Hypothesen, live arbeitende Agenten, Präsentationen und Sprache. Was fehlt, ist keine
weitere Funktion, sondern das, was ein Apple-Produkt ausmacht: **ein klares Grundmodell, Ruhe,
Handwerk im Detail – und das Gefühl, dass Atlas mit dir am Board arbeitet, während er denkt.**
Heute erscheinen seine Karten erst, wenn seine Antwort fertig ist.

Fünf große Schritte:

1. **Atlas arbeitet live am Board.** Er bekommt Werkzeuge statt JSON im Text: einen lokalen
   MCP-Server des Cockpits. Karten erscheinen, während Atlas recherchiert. Jede Änderung wird
   geprüft, und Atlas erfährt sofort, ob sie geklappt hat. Heute bleibt das Board 10 bis 40
   Sekunden still, dann kommt alles auf einmal.
2. **Inhalt zuerst, die Bedienung tritt zurück.** Aus heute sieben dauerhaft sichtbaren
   Bedienflächen werden drei: eine Kopfzeile, ein Dock und die Leiste rechts.
3. **Ein Kartensystem statt 29 Einzelstücke.** Es gibt sieben Kartenfamilien mit einer
   gemeinsamen Anatomie, drei Größen und vier Zoomstufen ohne Absturz. Auch die Gesamtansicht
   zeigt dann Seitenbild, Terminal, Zahl und Diagramm und nicht nur leere Kästen.
4. **Zusammenarbeit wie mit einem Menschen.** Gemeinsame Aufmerksamkeit: Atlas sieht, wohin du
   schaust, und du siehst, woran Atlas arbeitet. Dazu kommen Vorschläge statt Überschreiben, die
   Herkunft jeder Karte und ein Verlauf zum Zurückspulen.
5. **Handwerk.** Bewegung mit Federn, nahtlose Übergänge von der Karte zur großen Ansicht,
   Typografie und Material nach festen Regeln, volle Tastaturbedienung, flüssiges Bild bei
   300 Karten und Bildvergleichs-Tests für jede Karte.

Reihenfolge: Fundament → **Atlas live** → Ruhe → Kartensystem → Zusammenarbeit → Bewegung und
Präsentation → Rezepte → Feinschliff (Abschnitt 9).

---

## 0. So soll es sich anfühlen

> Du sagst: „Atlas, warum brechen so viele im Checkout ab?“
>
> Nach einer Sekunde steht oben im Board der Titel „Checkout-Abbrüche“. Oben in der Mitte
> erscheint eine kleine Kapsel: *Atlas · Plan: Zahlen lesen → Quellen suchen → Ursachen prüfen*.
> Atlas' Zeiger gleitet zu „Zahlen“. Dort wachsen drei Kennzahlen aus dem Abschnitt, und das
> Funnel-Diagramm baut sich auf. Der Balken „Adresse“ ist hervorgehoben, weil Atlas gerade über
> ihn spricht.
>
> Du ziehst eine Karte zur Seite. Atlas merkt es und legt die nächste daneben, nicht darüber.
> Nach 25 Sekunden steht oben im Board: **„Kurz gesagt: Der Adressschritt kostet die meisten
> Kunden. Empfehlung: Formular auf fünf Felder kürzen.“**
>
> Du drückst die Leertaste auf der Hypothese. Sie wächst zur großen Ansicht, ringsum stehen die
> Belege dafür und dagegen. Leertaste, und sie schrumpft zurück an ihren Platz.
>
> „Ja, mach das.“ Zwei Agenten starten in ihrem Rahmen. Ihre Terminals laufen live, ihre
> Zwischenergebnisse erscheinen als Karten, und wenn beide fertig und geprüft sind, steht dort
> ein Knopf: **Übernehmen**.

---

## 1. Wo wir stehen – ehrliche Bestandsaufnahme

### Was schon auf Spitzenniveau ist

- **Die Grammatik in Abschnitten** (Ziel → Quellen → Zahlen → Erkenntnisse → Optionen → Fragen
  → Entscheidung → Schritte), die automatische Anordnung und Pfeile mit Bedeutung.
- **Live-Agenten auf dem Board:** Terminal, Änderungen, Review und „Alle übernehmen“.
- **Präsentieren** Abschnitt für Abschnitt, wobei die Folien der Rede folgen. Dazu Sprache in
  beide Richtungen und eine Demo, die kein Kontingent verbraucht.
- **Wissensnetz** über alle Boards, Rückverweise, Recall und Hypothesen mit Konfidenz.

Diese Substanz bleibt. Der Plan baut darauf auf und wirft nichts weg.

### Was einem Apple-Anspruch noch nicht genügt (beobachtet am 14.10.)

| # | Beobachtung | Warum es zählt |
|---|---|---|
| 1 | **Zoom-Klippe.** Unter 42 % Zoom (`FAR_K` in BoardView.tsx) zeigen Karten nur noch Symbol und Titel. „Alles zeigen“ landet auf deinem Bildschirm bei 33 %, bei 1600×1000 bei 41 %. Genau dann, wenn man das Ganze sieht, verschwinden Seitenbild, Terminals, Zahlen und Diagramm. | Der erste Eindruck jedes Boards ist der leerste. |
| 2 | **Zu viel Bedienung um den Inhalt.** Atlas-Kopf, Sprechleiste, Menüband, Reiterleiste, „Was du siehst“-Tafel mit Legende, Zoomleiste und die Leiste rechts sind dauerhaft da (7). Dazu kommen situativ die Statuspille und die Karten-Schwebeleiste. | Apple: Der Inhalt ist der Held, die Bedienung tritt zurück. |
| 3 | **Die Schwebeleiste an der Karte hat acht Knöpfe** (Atlas, Agent, Fokus, Lupe, Vergrößern, Tiefer, Bearbeiten, Löschen). Sie liegt über der Karte darüber. Beim Darüberfahren schiebt sich „HYPOTHESE h1“ in den Titel und kürzt ihn („…brems HYPOTHESE h1“). | Unruhe genau dort, wo man hinschaut. |
| 4 | **Überschriften verschwinden beim Hineinzoomen** unter Menüband und Reiterleiste. Die „Was du siehst“-Tafel verdeckt unten links Karten, bei 125 % zum Beispiel das Diagramm. | Die Orientierung geht verloren. |
| 5 | **Größen passen nicht zum Inhalt.** Eine Kennzahl-Karte ist 360 px breit für eine einzige Zahl, die Änderungs-Karte ist halb leer. In „Hineinzoomen“ ist die Mittelkarte zu zwei Dritteln leer, der Text ist 11 px klein. | Es wirkt unfertig. |
| 6 | **29 Kartenarten, 3 Board-Stile, 3D, Wand, Cluster, Film, Folien, Demo.** Jedes für sich ist gut, zusammen fehlt ein Grundmodell. Menüs schalten Aktionen mit Schiebeschaltern („Präsentation“, „Film“). | Apple sagt öfter Nein als Ja. |
| 7 | **Atlas arbeitet gebündelt.** Er schreibt am Ende seiner Antwort einen ```` ```cockpit-actions ```` -Block. Ausgeführt wird er erst, wenn die Runde vorbei ist (operator.ts, `turnJustEnded`). Während 10 bis 40 Sekunden Recherche steht nur der Platzhalter „Atlas bereitet vor“. | Das Gefühl „wir arbeiten zusammen“ fehlt genau während der Arbeit. |
| 8 | **Atlas sieht das Board nur als Textauszug** von höchstens 2.200 Zeichen, angehängt an jede Nachricht (`describeBoard`). Große Boards werden abgeschnitten („… 40 items in total“). Ob seine Änderungen geklappt haben, erfährt er erst in der nächsten Runde. Ein Fehler im JSON verpufft still. | Kein Rückkanal, keine Selbstkorrektur, unnötige Tokens. |
| 9 | **Rohe Meldungen**, zum Beispiel „no logged-in account“ als Fehlertoast in einem deutschen Raum. | Kleinigkeiten kosten Vertrauen. |
| 10 | **Code:** BoardView.tsx hat 2.106 Zeilen, operator.ts 2.132 und board.ts 1.736. Es gibt keinen Bildvergleichstest pro Kartenart. | Feinschliff braucht Module und ein Sicherheitsnetz. |

---

## 2. Leitbild – wie Apple es bauen würde

| Prinzip | Was es für uns heißt |
|---|---|
| **Inhalt zuerst** | Das Board ist die Bühne. Bedienelemente sind wie Glas, das zurücktritt, und erscheinen, wenn man sie braucht. Höchstens drei dauerhafte Bedienflächen. |
| **Ein Grundmodell** | Vier Begriffe genügen: **Board, Abschnitt, Karte, Atlas.** Alles andere ist eine Ansicht davon: Übersicht, große Ansicht, Präsentation, Verlauf. |
| **Direkt und verzeihend** | Alles ist anfassbar. Jede Wirkung ist in unter 100 ms sichtbar. Alles lässt sich rückgängig machen, auch Atlas' Arbeit. |
| **Kontinuität** | Nichts springt. Eine Karte wird zur großen Ansicht, indem sie wächst. Atlas' Karten wachsen aus ihrem Platzhalter, die Kamera fliegt mit Federn. |
| **Hierarchie und Rhythmus** | Feste Schriftstufen, ein 8-pt-Raster, ineinanderliegende (konzentrische) Radien und eine einzige Akzentfarbe. Farbe bedeutet Zustand, nie Dekoration. |
| **Ehrlich** | Jede Karte sagt, von wem sie ist, woher sie kommt und wie sicher sie ist. |
| **Ruhig, bis es zählt** | Bewegung, Ton und Hervorhebung gibt es nur, wenn sie etwas bedeuten. Es „atmet“ immer höchstens eine Sache. |
| **Für alle** | Voll bedienbar mit Tastatur und Screenreader, mit „Bewegung reduzieren“ und hohem Kontrast. Hell genauso schön wie dunkel. |
| **Schnell ist ein Feature** | 60 fps beim Schieben und Zoomen mit 300 Karten. Die erste Karte von Atlas erscheint in unter 1,5 s. |

**Vorbilder** (abschauen, nicht kopieren):

| Vorbild | Was wir übernehmen |
|---|---|
| Freeform (Mac) | Ruhige Leinwand, Verbinder, die an Karten hängen, wenige Werkzeuge |
| Keynote | Inspektor rechts; „Zaubereffekt“ zwischen Folien → Übergang zwischen Abschnitten in der Präsentation |
| Quick Look (Finder) | Leertaste = groß ansehen, Leertaste = zurück |
| Safari | Tab-Gruppen → Board-Umschalter; Seiten mit Favicon, Adresse und Live-Zustand |
| Liquid Glass (macOS 26) | Bedienelemente als lichtdurchlässiges Glas über dem Inhalt, konzentrische Formen |
| Live-Aktivitäten | Atlas' laufende Arbeit als kompakte Kapsel mit Fortschritt |
| Figma | Sichtbare Zeiger anderer („Atlas ist hier“) und „Folgen“ |

Das Cockpit läuft unter Windows mit der Systemschrift Segoe UI Variable. Das Apple-Gefühl
entsteht aus Disziplin, nicht aus einer bestimmten Schrift.

---

## 3. Das neue Grundmodell

### Vier Begriffe

- **Board:** ein Arbeitsraum zu einer Frage („Warum brechen Kunden ab?“). Es hat einen Titel,
  einen „Kurz gesagt“-Satz, Abschnitte und einen Verlauf.
- **Abschnitt:** eine Stufe des Denkens (die acht Standard-Abschnitte) oder ein eigenes Kapitel.
- **Karte:** ein Ding mit Familie, Inhalt, Herkunft und Zustand.
- **Atlas:** ein Mitarbeiter mit sichtbarer Präsenz auf dem Board.

Ansichten statt Modi: **Board** (arbeiten), **Übersicht** (alle Boards), **Große Ansicht**
(eine Karte mit ihren Belegen), **Präsentation**, **Verlauf**, **Wissensnetz**.

### Board-Rezepte statt freier Stile

Ein Rezept legt fest, welche Abschnitte ein Board braucht und was darin auf jeden Fall stehen
muss. Atlas wählt das Rezept, nennt es („Ich lege ein Entscheidungs-Board an“) und prüft vor dem
Ende seiner Runde, ob die Pflichtteile da sind.

| Rezept | Wofür | Abschnitte | Pflicht (wird geprüft) |
|---|---|---|---|
| **Entscheidung** | „Sollen wir …?“ | Ziel · Quellen · Optionen · Fragen/Risiken · Entscheidung · Schritte | Empfehlung als erste Aussage; mindestens zwei Optionen, jede mit Beleg |
| **Recherche** | „Was weiß man über …?“ | Ziel · Quellen · Erkenntnisse · Hypothesen · Fragen | Jede Erkenntnis hat eine Quelle; Hypothesen haben eine Konfidenz |
| **Dashboard** | „Wie stehen wir?“ | Kennzahlen · Verläufe · Daten | Jede Kennzahl hat einen Vergleich (Ziel oder Vorperiode) |
| **Umsetzung** | „Bau das.“ | Ziel · Plan · Crew · Änderungen · Prüfung · Übernahme | Jede Änderung hat einen Test- und Review-Status |
| **Code-Karte** | „Erklär mir das Repo.“ | Module · Abhängigkeiten · Einstiege · Risiken | Ein „Hier fängst du an“ |
| **Freie Leinwand** | Skizzieren, Sammeln | nur die Grammatik | keine |

Ermittlungswand, Storyboard und 3D bleiben erhalten, wandern aber unter „Darstellung“. Sie sind
nie der Standard.

---

## 4. Das Kartensystem 3.0

### Sieben Familien statt 29 Einzelarten

Das Datenmodell behält alle 29 Arten, damit alte Boards unverändert laden. Die Familie bestimmt
Aussehen und Verhalten.

| Familie | Heutige Arten | Gesicht (was man auf einen Blick sieht) |
|---|---|---|
| **Gedanke** | note, idea, question, text, topic | Titel und ein bis drei Zeilen; Fragen mit „?“-Marke |
| **Beleg** | web, browser, file, search, video, image, map | Zuerst das Bild bzw. die Seite, die Quelle als Fußzeile (Favicon, Domain, Datum) |
| **Zahl** | stat, chart, table, data, calc | Die Zahl oder das Diagramm füllt die Karte; Vergleich als Delta |
| **Urteil** | hypothesis, choice, decision | Die Aussage groß, Konfidenzring, Chips „dafür/dagegen“; Auswahl als Segmentknöpfe |
| **Arbeit** | task, prompt, code, watch | Statuskreis, Titel, Besitzer (du, Atlas oder ein Agent), verknüpfter Agent |
| **Agent** | agent, diff | Live-Terminal mit Statusring; Änderungen als +/− mit Review-Siegel |
| **Ding** | entity | Monogramm, Name und Rolle; verbindet Boards miteinander |

Rahmen (frame) und Zeichnung (sketch) bleiben Werkzeuge und sind keine Kartenfamilie.

### Eine Anatomie für alle

```
┌──────────────────────────────────────────┐   Radius 16 · Haarlinie · 2 weiche Schatten
│ ◇  Titel (15 / 600, eine Zeile)       ⋯  │   Kopf 36 px; Art und ID nur im Inspektor
│                                          │
│   Gesicht: Text · Bild · Zahl · Terminal │   Körper füllt die Karte, nie leer
│                                          │
│ ◔ Atlas · vor 2 Min · 2 Belege     75 %  │   Fuß 24 px: Herkunft, Belege, Zustand
└──────────────────────────────────────────┘
```

- **Kopf:** Familiensymbol (16 px, gedämpft) und Titel in einer Zeile, voller Titel als Tooltip.
  Das Menü „⋯“ erscheint nur bei Auswahl. Kein Art-Wort, das den Titel kürzt.
- **Fuß (neu):** wer die Karte gemacht hat (Avatar von Atlas, dir oder einem Agenten), wie alt
  sie ist, wie viele Belege sie hat und ihr Zustand (Konfidenz, Status, Live-Punkt).
- **Drei Größen im Raster:** S (eine Spalte), M (zwei Spalten), L (volle Abschnittsbreite). Zum
  Beispiel: Zahl S, Diagramm M, Seite L. Die Höhe folgt dem Inhalt in 8er-Schritten, nie leere
  Fläche.

### Vier Zoomstufen ohne Klippe

| Stufe | Zoom | Was eine Karte zeigt |
|---|---|---|
| **Plakat** | unter 30 % | Jeder Abschnitt wird ein Plakat: Titel groß, die ein bis drei wichtigsten Karten als Miniatur, die Schlüsselzahl. Cluster wie heute. |
| **Überblick** | 30–60 % | Jede Karte zeigt ihr Gesicht vereinfacht: Seitenbild, Zahl groß, Diagramm ohne Achsen, Agent mit letzter Zeile und Statusring. Der Titel steht in „Fernschrift“: Sie wächst gegen den Zoom, damit sie auf dem Bildschirm nie unter 11 px fällt. |
| **Arbeit** | ab 60 % | Die volle Karte. |
| **Große Ansicht** | Leertaste | Die Karte groß über dem Board, ihre Belege ringsum. Das vereint „Hineinzoomen“ und die Kartenseite. |

Übergänge blenden in 150 ms ineinander, nie ein Sprung.
**Messlatte:** In der Gesamtansicht auf einem 13"-Laptop ist jede Zahl, jedes Seitenbild und
jeder Agentenstatus erkennbar.

### Die Schlüsselkarten neu gestaltet

- **Zahl:** kompakt (Größe S). Die Zahl in 40/700 mit tabellarischen Ziffern, darunter eine
  Delta-Pille („▼ 13 Pkt. zum Ziel“), wahlweise ein kleiner Verlauf (Sparkline). Farbe gibt es
  nur im Delta.
- **Diagramm:** eine ruhige Akzentfarbe. Der Wert, über den Atlas spricht, ist hervorgehoben, der
  Rest gedämpft. Atlas kann Anmerkungen setzen („hier bricht es ein“) als kleine Beschriftung mit
  Linie.
- **Seite (Browser und Web):** ein Rahmen wie ein kleines Safari-Fenster, mit Favicon, Domain,
  Live-Punkt und „zuletzt gesehen vor 2 Min.“. Die Vorschau ist scharf (doppelte Auflösung),
  Zitate erscheinen als markierte Stellen.
- **Agent:** Avatar, Name und Statusring (läuft, wartet, fertig, Fehler). Das Terminal in echter
  Monospace-Schrift mit Farben für ✓ und ✗, eine Fortschrittszeile („Schritt 3/5: Tests“).
  „Übernehmen“ erscheint, sobald die Änderung geprüft ist.
- **Änderungen (Diff):** eine kompakte Dateiliste mit Mini-Balken und dem Review-Siegel
  („✓ geprüft von Kiro“). Die Höhe entspricht dem Inhalt.
- **Hypothese:** ein Konfidenzring statt eines Balkens, „2 dafür · 1 dagegen“ als anklickbare
  Chips, ein Verdikt-Siegel ab zwei Belegen.
- **Entscheidung:** die Aussage groß (17/600), darunter „weil …“ und die gewählte Option, dazu
  ein Siegel „entschieden am …, von Rob“.
- **Aufgabe:** Statuskreis, Besitzer und verknüpfter Agent. Ein Haken markiert sie als erledigt.

### Verbinder

- 1,5 px stark, orthogonal mit runden Ecken. Das gibt es schon und bleibt.
- Farbe nur für „stützt“ (grün) und „widerspricht“ (rot, gestrichelt). Alle anderen Pfeile sind
  neutral, ihr Wort erscheint beim Darüberfahren.
- **Fokus und Kontext:** Ist eine Karte ausgewählt, leuchten ihre Verbindungen und die
  verbundenen Karten auf, alles andere tritt leicht zurück.

---

## 5. Ruhe – Bedienung, die zurücktritt

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◉ Atlas · wartet auf dich      [ Checkout-Analyse ▾ ]       Haiku ◐   🔊▾   ⋯   │  Kopfzeile 44 px
├────────────────────────────────────────────────────────────┬─────────────────────┤
│  Checkout-Analyse                                           │  Chat · Info · Crew │
│  Kurz gesagt: Der Adressschritt kostet die meisten Kunden.  │                     │
│                                                             │  Atlas  vor 1 Min.  │
│  1 Ziel      2 Quellen       3 Zahlen      4 Erkenntnisse   │  Der neue Checkout  │
│  ┌──────┐    ┌───────────┐   ┌──────┐      ┌───────────┐    │  läuft – links live │
│  │      │    │  Seite    │   │ 68 % │      │ Hypothese │    │  ◆ Vorschau         │
│  └──────┘    │  live ●   │   └──────┘      │    ◔ 75 % │    │                     │
│              └───────────┘                 └───────────┘    │                     │
│                                                             │                     │
│        ╭─────────────────────────────────────────────────╮  │                     │
│        │  ↶   ＋   ✎   ⌗   ▷ Präsentieren   ⌕   − ◯ +  58 % │  │ [ Nachricht …  🎙 ] │
│        ╰─────────────────────────────────────────────────╯  │                     │
└────────────────────────────────────────────────────────────┴─────────────────────┘
```

| Heute | Neu |
|---|---|
| Atlas-Kopf (95 px) und Sprechleiste | **Eine Kopfzeile** (44 px): Avatar, Name, Zustand, Board-Umschalter, Modell, Lautstärke als Menü (Stumm · Kurz · Normal · Alles), „Sprechen“ als runde Taste, ⋯ |
| Reiterleiste mit Board-Tabs | **Board-Umschalter** in der Kopfzeile, wie die Tab-Gruppen in Safari |
| Menüband oben links | **Dock unten in der Mitte** aus Glas: Rückgängig · Hinzufügen · Zeichnen · Ordnen · Präsentieren · Suchen und Befehle · Zoom. „Teilen“ und „Ansicht“ wandern ins ⋯-Menü. Die Abschnittsköpfe oben bleiben frei. |
| „Was du siehst“-Tafel unten links und Legende | **Titelblock im Board:** Titel und „Kurz gesagt“ stehen oben links und scrollen mit wie eine Dokument-Überschrift. Die Legende kommt in „Info“. |
| Zoomleiste unten rechts (mit 3D) | Zoom im Dock, 3D unter ⋯ → Darstellung |
| Schwebeleiste mit 8 Knöpfen beim Darüberfahren | **Auswahl-Leiste** nur bei Auswahl, mit höchstens vier Aktionen (Atlas fragen · An Agent · Groß ansehen · ⋯). Alles andere im Kontextmenü (Rechtsklick) und in „Info“. |
| Statuspille, Hinweise an verschiedenen Stellen | **Eine Kapsel** oben in der Mitte, nur solange etwas läuft (Live-Aktivität) |
| Chat · Mission · Terminal | **Chat · Info · Crew.** „Info“ ist der Inspektor: bei Auswahl Details, Quellen, Herkunft, Verlauf, Verbindungen und Schlagwörter, sonst Board-Info, Legende und Rezept-Prüfung. Mission und Terminal gehen in „Crew“ auf. |
| Überschriften verschwinden beim Hineinzoomen | **Abschnittsköpfe kleben oben**, solange ihr Abschnitt sichtbar ist |
| Schalter für Aktionen („Präsentation“, „Film“) | **Aktionen sind Knöpfe, Einstellungen sind Schalter**, nie umgekehrt |

Ergebnis: drei dauerhafte Bedienflächen statt sieben, und keine Überschrift und keine Karte wird
mehr von Bedienelementen verdeckt.

---

## 6. Atlas × Board – die Zusammenarbeit neu gebaut (das Herzstück)

### 6.1 Werkzeuge statt JSON-Text: der Cockpit-MCP-Server

**Heute:** Atlas bekommt einen Textauszug (höchstens 2.200 Zeichen) und schreibt am Ende seiner
Runde einen JSON-Block.
**Neu:** Das Cockpit startet für Atlas einen lokalen **MCP-Server** (Model Context Protocol). Er
läuft nur auf 127.0.0.1 und hat pro Sitzung einen eigenen Schlüssel.

- **Claude Code** bekommt ihn per `--mcp-config`, so wie heute schon `--settings` für die Hooks.
  Die Board-Werkzeuge werden in denselben Settings vorab erlaubt (`mcp__cockpit__*`), damit keine
  Rückfrage kommt.
- **Codex** bekommt ihn nur für die Sitzung per `-c mcp_servers…`. Die Konfigurationsdatei des
  Nutzers bleibt unberührt. Ob die installierte Codex-Version den Server über HTTP ansprechen
  kann, klärt der Machbarkeitstest (Phase 0). Sonst geht es über eine kleine stdio-Brücke, einen
  Modus der Cockpit-exe.

```
 Du ── Sprache / Text ──▶  Atlas (Claude Code oder Codex im Terminal)
                              │  Werkzeugaufrufe – live, während er denkt
                              ▼
                 ┌────────────────────────────────┐
                 │  Cockpit-MCP (Rust, lokal)     │  nimmt an · reicht weiter · antwortet
                 └───────────────┬────────────────┘
                                 │  Ereignis „mcp-call“ / Antwort „mcp_reply“
                                 ▼
                 ┌────────────────────────────────┐
                 │  Board-Kern (TypeScript)       │  prüft · wendet an · ordnet an
                 └────────────────────────────────┘
                                 ▲
                      deine Hände, deine Blicke
```

**Architektur-Entscheidung:** Die Board-Logik bleibt in TypeScript (`applyOps`, Grammatik,
Anordnung, alles getestet). Der Rust-Server ist nur der Bote. Ein gemeinsamer **Befehlskern**
bedient MCP-Werkzeuge, den bisherigen `cockpit-actions`-Weg (als Rückfall für CLIs ohne MCP),
Tastatur, Befehlspalette und Sprache – eine Wahrheit für alle Wege.

**Die Werkzeuge (erster Satz):**

| Werkzeug | Zweck | Antwort an Atlas |
|---|---|---|
| `board_read(section?, ids?, query?, page?)` | Board gezielt abfragen statt Textauszug | Karten als kompaktes JSON, seitenweise |
| `board_changes(since)` | Was hat sich seit meinem letzten Blick geändert, auch durch dich? | Änderungen mit Urheber |
| `card_add(cards[])` | Karten anlegen (Abschnitt, Familie, Inhalt) | neue IDs, Platz, Hinweise („Titel zu lang“) |
| `card_update` · `card_move` · `card_remove` | ändern | Ergebnis oder Konflikt (deine Karte → wird Vorschlag) |
| `link(from, to, rel)` | Beziehung setzen | ok oder Fehler mit Grund |
| `section(…)` | Abschnitt anlegen, umbenennen, verschieben | neue Reihenfolge |
| `show(ids, how)` | zeigen: Kamera, Zeigen, Spotlight, große Ansicht | was jetzt sichtbar ist |
| `board_look(region?)` | Bild des Boards zur Selbstkontrolle | PNG |
| `board_check()` | Qualitätsprüfung nach Rezept | Liste der Mängel |
| `plan(steps)` · `plan_step(i, state)` | Atlas' Arbeitsplan in der Kapsel | – |
| `ask_user(question, options)` | Rückfrage als Auswahl-Karte | deine Antwort, sobald du klickst |
| `recall(query)` | Suche über alle Boards des Projekts | Treffer mit Board |
| `agents_*` (start, send, status) | Crew steuern, mit deiner Freigabe wie heute | Status |

**Was das bringt:**

- **Live:** Die erste echte Karte erscheint mit dem ersten Werkzeugaufruf (Ziel unter 1,5 s nach
  dem Absenden), nicht nach 20 bis 40 Sekunden.
- **Selbstkorrektur:** Fehler kommen als Antwort zurück (falscher Abschnitt, Titel zu lang, Karte
  gibt es schon). Atlas korrigiert in derselben Runde.
- **Weniger Tokens:** Statt 2.200 Zeichen an jeder Nachricht reicht eine Zeile („Board
  Checkout-Analyse · 23 Karten · 2 neu seit deinem letzten Blick“). Details holt Atlas sich bei
  Bedarf.
- **Robust:** Es gibt kein JSON mehr im Fließtext, das verloren gehen kann.
- **Gleiche Regeln:** Was heute eine Bestätigung braucht (Agent starten, auf einer Webseite
  klicken, löschen), braucht sie weiter. Das Werkzeug wartet dann auf dein Ja.
- **Auch die Crew:** Crew-Agenten bekommen eingeschränkte Werkzeuge, nur für ihren eigenen Rahmen.
  So erscheinen ihre Zwischenergebnisse live als Karten und nicht erst am Ende.

**Zeitleiste einer Runde:**

```
                   0 s ──────── 10 s ──────── 20 s ──────── 30 s
HEUTE   Board      [ „Atlas bereitet vor …“ ] ..................... ▣▣▣▣▣▣▣  alles auf einmal
NEU     Board      ▣ Titel (1 s)   ▣▣▣ Zahlen   ▣ Seite   ▣▣ Erkenntnisse   ✓ Prüfung   ★ Kurz gesagt
        Kapsel     Plan: 1 ✓   2 …   3 …   4 …
```

### 6.2 Atlas ist sichtbar am Board

- **Atlas-Zeiger:** ein kleiner Avatar mit Namen, der dorthin gleitet, wo Atlas gerade arbeitet.
  Die Werkzeugaufrufe sagen, wo das ist. Wie die Zeiger anderer Leute in Figma.
- **Wachsende Karten:** Atlas legt zuerst den Rohbau an (Titel im richtigen Abschnitt), der
  Inhalt fließt nach. Das Einblenden ist sanft, ohne Schreibmaschinen-Effekt auf jeder Karte.
- **Kapsel „Atlas arbeitet“** oben in der Mitte: „Atlas · Recherche 2/4 · liest
  ux-journal.example“. Aufgeklappt zeigt sie den Plan als Häkchenliste. Am Ende steht dort
  „Fertig · 6 Karten · Ansehen“.
- **Folgen:** Die Kamera folgt Atlas nur, solange du nicht selbst navigierst. In der Kapsel gibt es
  einen Knopf „Atlas folgen“.

### 6.3 Gemeinsame Aufmerksamkeit

- **Atlas weiß, was du siehst:** den sichtbaren Ausschnitt, die Auswahl, die Karte unter der Maus
  (nach 2 s Verweilen) und die Zoomstufe. Das kommt über `board_changes` bzw. eine MCP-Ressource.
  „Das hier“ oder „die da links“ funktioniert dann zuverlässig.
- **Du siehst, was Atlas ansieht:** Karten, die Atlas gerade liest, bekommen einen feinen Rand in
  Atlas' Farbe, ohne zu leuchten. Die zitierte Stelle in einer Seite ist markiert.
- **Zeigen und Sprechen zusammen:** Wenn du sprichst und dabei mit der Maus auf eine Karte zeigst,
  bekommt Atlas diese Karte zum Satz („mach das größer“, „verbinde das mit dem Ziel“).

### 6.4 Vorschläge statt Überschreiben

- **Deine Karten ändert Atlas nicht direkt.** Er macht einen Vorschlag, entweder als Geisterkarte
  oder als markierte Änderung („Atlas schlägt vor: Titel kürzen“), mit ✓ und ✗ – wie
  „Änderungen nachverfolgen“.
- **Große Umbauten** (Abschnitte umordnen, mehr als fünf Karten verschieben, löschen) kommen als
  ein Vorschlag „Board neu ordnen?“ mit Vorher-Nachher-Vorschau.
- Einstellbar unter Atlas → Board: „Atlas ordnet frei“ oder „Atlas schlägt vor“. Für deine
  eigenen Karten gilt immer „schlägt vor“.

### 6.5 Herkunft und Vertrauen

- **Jede Karte trägt im Fuß ihre Herkunft:** wer (du, Atlas oder ein Agent), wann, woher (Quelle,
  Datei, Agentenergebnis) und wie sicher (Konfidenz, „geprüft“, „Anbieterangabe“, „Annahme“).
- **Zahlen von Atlas zeigen ihre Rechnung** in „Info“, zum Beispiel: „41 % = 1.240 von 3.025
  Abbrüchen, Funnel Q3“.
- **Veraltet-Erkennung:** Ändert sich eine Quelle oder ist sie alt, erscheint ein leises
  „veraltet?“. Das gibt es heute für Dateien und wird auf Webseiten ausgeweitet.

### 6.6 Chat und Board als ein Gespräch

- **Das Board ist das Protokoll, der Chat der Untertitel.** Atlas' Chat-Antworten werden kürzer
  (höchstens fünf Zeilen plus Karten-Chips). Die ausführliche Fassung steht als Karten im Board.
- **„Kurz gesagt“:** Am Ende einer großen Runde schreibt Atlas den Kernsatz in den Titelblock des
  Boards. Das ist das, was man morgen dem Chef zeigt.
- **Verweise in beide Richtungen:** Chat-Chip → Karte gibt es schon. Neu ist Karte → „im Gespräch
  erwähnt (3)“ in „Info“; ein Klick springt zur Stelle im Chat.
- **„Als Nächstes“ auch im Board:** Der nächste Schritt aus dem Antwort-Fuß erscheint zusätzlich
  als Vorschlags-Chip am passenden Abschnitt („＋ A/B-Test starten“).

### 6.7 Verlauf: das Board zurückspulen

- Jede Runde, deine wie die von Atlas, ist ein Schritt in einer Zeitleiste in „Info“. Mit einem
  Schieberegler spielst du das Board vor und zurück und siehst, wie es entstanden ist. Dann wählst
  du „Diesen Stand wiederherstellen“ oder „Als neues Board öffnen“.
- Technik: Deltas pro Runde in SQLite (`board_history`), begrenzt nach Anzahl und Größe. Das
  heutige Rückgängig pro Runde wird so dauerhaft und sichtbar.

### 6.8 Atlas' Arbeitsregeln am Board (Persona 3.0)

1. **Ergebnis zuerst:** Die erste Aussage im „Kurz gesagt“ ist die Kernaussage.
2. **Rezept wählen und nennen.**
3. **Erste Runde mit fünf bis neun Karten.** Die Tiefe gehört in die große Ansicht und in „Info“.
4. **Jede Behauptung hat einen Beleg** (Pfeil „stützt“ oder eine Quelle). Ohne Beleg ist sie als
   „Annahme“ gekennzeichnet.
5. **Vor dem Ende `board_check()` aufrufen** und die Mängel beheben.
6. **Beim Erklären zeigen** (`show`), keine Textwand.
7. **Karten von dir nur per Vorschlag ändern.**

---

## 7. Bewegung, Ton, Präsentation

### Bewegung

- **Federn statt Zeitkurven:** Kamera, Karten und Auswahl bewegen sich über eine Federfunktion,
  unterbrechbar und ohne Ruck. Die Kamera ist kritisch gedämpft, schwingt also nicht nach.
- **Nahtlose Übergänge:** Die große Ansicht wächst aus der Karte. In der Präsentation fliegen die
  Karten eines Abschnitts in ihre Folienposition (Zaubereffekt). Beim Neuordnen gleiten Karten,
  das gibt es heute schon.
- **Erscheinen:** Atlas' Karten blenden mit 8 px Weg und einer Unschärfe, die scharf wird, ein
  (180 ms), mehrere Karten 40 ms versetzt.
- **Eine Sache atmet:** Der Aufmerksamkeitspuls (gibt es schon) ist das einzige „schau hier“.
- **Effekte nur auf der Bühne:** Funken, Komet und Aurora gibt es nur noch in Demo und
  Präsentation, nicht beim Arbeiten.
- **„Bewegung reduzieren“** schaltet auf reine Überblendungen um.

### Ton

Wenige leise Töne aus einem einheitlichen Klangsatz, nur für drei Momente: Atlas ist fertig,
Atlas braucht dich, etwas ist schiefgegangen.

### Präsentation 3.0

- **Folie = Abschnitt**, mit Zaubereffekt-Übergang vom Board in die Folie.
- **„Präsentieren“ ist ein Knopf.** Film, „Kamera folgt“ und PDF stehen als normale Einträge im
  Menü.
- Optional eine **Referentenansicht** auf einem zweiten Bildschirm: nächste Folie, Notizen, Zeit.
- **Export:** Folien-PDF (gibt es) und neu ein **Briefing**, eine Seite mit Ergebnis, Empfehlung
  und Belegen.

---

## 8. Professionell – das Fundament

### Code

- **BoardView.tsx aufteilen:** `canvas/` (Kamera, Gesten, Raster), `cards/` (eine Datei pro
  Familie plus die Anatomie-Bausteine), `overlays/` (Auswahl-Leiste, Kapsel, Inspektor), `edges/`.
- **operator.ts aufteilen:** `protocol/` (der Befehlskern für MCP und `cockpit-actions`),
  `snapshot/`, `crew/`, `voice/`.
- **Design-Tokens 3.0 in einer Datei:** Farben, Schrift, Radien, Schatten, Abstände und Bewegung,
  jeweils hell und dunkel.

| Token | Dunkel | Hell |
|---|---|---|
| Leinwand · Abschnitt · Karte · erhaben | `#0f1115` · `#15181d` · `#1b1f25` · `#22262d` | `#f5f5f7` · `#eeeef1` · `#ffffff` · `#ffffff` + Schatten |
| Akzent | `#0a84ff` | `#007aff` |
| Zustand: gut · offen · Fehler | `#30d158` · `#ff9f0a` · `#ff453a` | `#34c759` · `#ff9500` · `#ff3b30` |
| Schrift | Segoe UI Variable **Display** für Abschnittsköpfe (24/650), **Text** für Karten (13–15), **Small** für Fußzeilen (11); Ziffern tabellarisch | gleich |
| Radien (konzentrisch) | Abschnitt 24 → Karte 16 → Innenteil 10 → Chip 8 (innen = außen − Abstand) | gleich |

### Sicherheitsnetz

- **Kartengalerie** (nur in der Entwicklerversion): jede Familie × Größe × Zoomstufe × Thema ×
  Zustand auf einer Seite.
- **Bildvergleichs-Tests:** Galerie und fünf Referenz-Boards werden per CDP fotografiert (wie
  `scripts/cdp.mjs` es heute schon kann) und gegen freigegebene Bilder verglichen. Lokal und in
  der CI auf dem Windows-Runner.
- **Layout-Prüfung als Test:** keine Überlappung, kein Text außerhalb der Karte, Abschnitte in
  Reihenfolge, nie ein Kopf unter Bedienelementen. Dafür wird `critiqueBoard` erweitert.
- **Leistungsbudget-Test:** Bei 300 Karten und 400 Pfeilen laufen Schieben und Zoomen mit
  mindestens 55 fps (CDP-Trace), ein Board öffnet in unter 400 ms.
- **Atlas-Szenarien:** sechs feste Aufgaben wie in der Erlebnis-Analyse. Gemessen werden die Zeit
  bis zur ersten Karte, ob das Rezept eingehalten ist, die Mängel laut `board_check` und die
  Selbstkorrekturen.

### Leistung

- Nur sichtbare Karten werden voll gezeichnet; fern liegende Karten in der leichten Darstellung.
- Alle Pfeile liegen gebündelt in einer Ebene.
- Pro Kamera-Frame rechnet React nichts neu: Die Kamera ist eine Transformation auf dem Container,
  die Karten sind memoisiert.
- Seitenbilder liegen in mehreren Auflösungen vor (für fern und nah).
- Live-Änderungen von Atlas werden pro Frame gebündelt, die Anordnung erfolgt inkrementell.

### Barrierefreiheit

- **Tastatur:** Tab und Pfeiltasten springen in Leserichtung von Karte zu Karte. Leertaste öffnet
  die große Ansicht, Enter bearbeitet, Entf löscht (mit Rückgängig), Strg+K öffnet die Befehle.
  Alles ist ohne Maus erreichbar.
- **Screenreader:** Das Board wird als Liste von Abschnitten mit Karten vorgelesen, jede Karte mit
  Familie, Titel und Zustand. Atlas' Arbeit wird als Live-Region angesagt.
- **Kontrast** nach WCAG AA in beiden Themen, sichtbare Fokusringe, Klickziele mindestens 28 px.

### Sprache und Texte

- Ein **Glossar** (Board, Abschnitt, Karte, Beleg, Crew …) mit überall denselben Wörtern.
- **Jede Meldung in Klartext mit Lösung**, zum Beispiel „Kein Konto angemeldet – unter *Konten*
  anmelden“ statt „no logged-in account“.

---

## 9. Fahrplan in Phasen

Jede Phase wird einzeln ausgeliefert, getestet und ist dann fertig. Umfang: S (klein) bis XL
(sehr groß).

### Phase 0 – Fundament und Machbarkeit · M

- [x] (15.10.) Design-Tokens 3.0 (Entwurf, `pro/src/design.ts`) und Kartengalerie (`gallery.ts`, Befehlspalette mit Entwickler-Schalter)
- [~] Bildvergleichs-Tests der Galerie per CDP (`pro/scripts/visual.mjs`, Referenzbilder hell/dunkel in `pro/visual/baseline`) — lokal fertig; drei echte Boards und CI fehlen noch
- [x] (15.10.) Leistung gemessen (`pro/scripts/perf.mjs`, `pro/visual/perf-baseline.json`): 50 Karten Schieben 48 fps, **150 Karten nur 20 fps**, Öffnen 0,3 / 0,95 s → Ziel 60 fps bei 300 bleibt eine Aufgabe für Phase 3
- [x] (16.10., live) **MCP-Machbarkeitstest:** Cockpit-MCP (`src-tauri/src/mcp.rs`, nur 127.0.0.1, Schlüssel pro Sitzung) mit `board_read`, `card_add`, `show` (`pro/src/mcpBoard.ts`). Live mit Claude Code (Haiku 5.5): 4 Werkzeugaufrufe, drei Karten erschienen **während** der Runde, ganze Runde 15 s, **keine Rückfrage**. Atlas startet mit den Werkzeugen (Einstellung `atlasLiveTools`, Standard an). - [ ] Codex über HTTP noch live prüfen.
- [~] BoardView.tsx und operator.ts in Module schneiden (begonnen: `operatorProtocol.ts`, `boardEdges.ts`, `cards/kinds.ts`, `cards/CardBody.tsx`; alle Tests grün)

**Fertig, wenn:** Die Galerie zeigt alle Arten, der Bildvergleich läuft, und ein kurzes Video
zeigt eine Karte, die weniger als 1,5 s nach dem Absenden erscheint.

### Phase 1 – Atlas live · L (das Herzstück)

- [x] (16.10.) Board-Werkzeuge mit Schemas, Prüfung und Antworten (`pro/src/mcpBoard.ts`, 14 Werkzeuge): plan, plan_step, board_read (nach Abschnitt, IDs, Suchwort, seitenweise), board_changes (was du inzwischen getan hast, Auswahl, sichtbarer Ausschnitt), card_add (Antwort: wohin jede Karte kam + Hinweise: Titel zu lang, Karte gibt es schon, zu viele auf einmal), card_update, card_remove, link, section, show (glow/camera/spotlight), summary („Kurz gesagt“), board_check, board_look (Bild), ask_user (Auswahl-Karte). Die Antworten der Werkzeuge lenken Atlas (z. B. nach `plan`: „zuerst die Frage-Karte, dann nach jeder Suche Karten“). - [x] (16.10., live) Ein allgemeines Werkzeug `act` für alle übrigen Cockpit-Aktionen (Agenten, Crew, recall, Seiten, Präsentieren, Erinnerungen, Modell) mit denselben Objekten wie der Block; was heute dein OK braucht, wartet weiter darauf. Live: recall über `act` fand 8 Karten auf „Checkout-Abbrüche“.
- [x] (16.10.) Ein Befehlskern: Werkzeuge laufen über dieselben geprüften Board-Ops (`cleanOps` → `changeBoard`) wie der `cockpit-actions`-Block (bleibt Rückfall für alles ohne Werkzeug)
- [x] (16.10.) Schlanker Schnappschuss: mit Werkzeugen nur noch eine Zeile zum Board (Titel, Kartenzahl, Abschnitte, Auswahl, sichtbarer Ausschnitt) statt bis zu 2.200 Zeichen
- [x] (16.10., live) Kapsel mit Plan (`AtlasCapsule.tsx`): „Atlas · 1/3 · Quellen suchen“ → „Fertig · 13 Karten · Ansehen“; zählt Atlas' Karten der Runde direkt auf dem Board (übersteht Rückfragen zwischendurch)
- [~] Atlas-Zeiger (vorhanden: Atlas' Hand an der zuletzt berührten Karte) und gestaffelt erscheinende Karten (vorhanden); **neu: deine Frage steht sofort als erste Karte** (leeres Board, live: erste Karte nach 0,5 s statt 26–30 s)
- [~] `board_check()` (Layout-Prüfung + fehlendes „Kurz gesagt“) und Persona-Regeln 3.0 (Abschnitt „Working live on the board“) — Rezepte folgen
- [x] (16.10., live) Rückfrage als Auswahl-Karte: Klick auf „Erst Heizlast berechnen lassen“ → Atlas hielt die Entscheidung als Karte fest und verband sie mit dem nächsten Schritt (9 s).
- [ ] Crew-Agenten mit eingeschränkten Werkzeugen für ihren Rahmen

**Fertig, wenn:** In den sechs Szenarien erscheint die erste Karte in unter 1,5 s, es geht keine
Aktion verloren, mindestens 90 % der Boards sind ohne Mängel laut `board_check`, und Rückgängig
nimmt eine ganze Atlas-Runde zurück.

### Phase 2 – Ruhe · M

- [x] (17.10.) Neue Kopfzeile, 44 px (Atlas · Zustand, Board-Umschalter „Bereich › Board ▾“ in der Mitte, Modell, Lautstärke-Menü, runde Sprechen-Taste, Aufwecken, ⋯) — `AtlasHeader.tsx`, `BoardSwitcher.tsx`
- [x] (16./17.10.) Dock unten in der Mitte; Menüband und Reiterleiste entfallen (Zoom im Dock, Übersicht im Board-Umschalter)
- [x] (16./17.10.) Titelblock mit „Kurz gesagt“ im Board; die Legende wandert nach „Info“ (alte „Was du siehst“-Tafel und Zoomleiste entfernt)
- [x] (17.10.) Inspektor „Info“ rechts (Karte: Art, Abschnitt, Text, Details, Herkunft, Quelle, Verbindungen als Satz, Schlagwörter; ohne Auswahl: Board, Abschnitte, Legende); „Crew“ fasst Mission und Terminal zusammen — `InfoPanel.tsx`, `roomSide.ts`
- [x] (17.10.) Auswahl-Leiste (Fragen · Agent · Groß · ⋯; bei der obersten Karte eines Abschnitts unter der Karte) und Kartenmenü per ⋯ oder Rechtsklick; keine Leiste beim Darüberfahren — `CardMenu.tsx`
- [x] (17.10.) Klebende Abschnittsköpfe (`stickyLanes` in `BoardLanes.tsx` + Tests)
- [x] (17.10.) Eine Statuskapsel oben in der Mitte (Plan, Schritt oder was Atlas tut); „1 ausgewählt“ steht jetzt über dem Eingabefeld mit „Aufheben“; die Statuspillen unten rechts sind weg. Aktionen als Knöpfe, Einstellungen als Schalter galt schon im Menüband/Dock.

**Fertig, wenn:** Es gibt drei dauerhafte Bedienflächen, kein Kopf und keine Karte ist verdeckt
(Test), und alle bisherigen Funktionen sind erreichbar (Test über die Befehlspalette).

### Phase 3 – Kartensystem 3.0 und Zoomstufen · XL

- [ ] Anatomie-Bausteine (Kopf, Körper, Fuß) und die sieben Familien
- [ ] Größen S, M und L im Raster, Höhe nach Inhalt
- [ ] Die neuen Schlüsselkarten: Zahl, Diagramm, Seite, Agent, Änderungen, Hypothese, Entscheidung
- [ ] Vier Zoomstufen mit Fernschrift und Überblendung; Abschnitte als Plakate
- [ ] Große Ansicht per Leertaste, die Seite und „Hineinzoomen“ vereint
- [ ] Verbinder mit Fokus und Kontext

**Fertig, wenn:** In der Gesamtansicht bei 1442×920 sind alle Zahlen, Seitenbilder und
Agentenstatus erkennbar (Bildtest und Augenmaß), und die Galerie ist hell und dunkel freigegeben.

### Phase 4 – Zusammenarbeit · L

- [ ] Gemeinsame Aufmerksamkeit (Ausschnitt, Maus und Auswahl gehen an Atlas; Atlas' Rand an Karten)
- [ ] Vorschlagsmodus für deine Karten; Umbau-Vorschläge mit Vorschau
- [ ] Herkunft im Kartenfuß; die Rechnung von Zahlen in „Info“
- [ ] Verlauf mit Schieberegler und Wiederherstellen
- [ ] Kurze Chat-Antworten, „Kurz gesagt“, „im Gespräch erwähnt“, Vorschlags-Chips im Board
- [ ] Zeigen und Sprechen zusammen

**Fertig, wenn:** Atlas ändert keine Karte von dir ohne dein Ja (Test), jede Atlas-Karte hat eine
Herkunft, und der Verlauf spielt 20 Runden flüssig ab.

### Phase 5 – Bewegung und Präsentation · M

- [ ] Federn für Kamera und Karten, unterbrechbar
- [ ] Zaubereffekt zwischen Abschnitten beim Präsentieren
- [ ] Präsentieren-Menü aufgeräumt; Referentenansicht (optional)
- [ ] Effekte nur noch in Demo und Präsentation
- [ ] Briefing-Export (eine Seite)

### Phase 6 – Rezepte und Qualität · M

- [ ] Sechs Rezepte mit Pflichtteilen und Prüfung
- [ ] „Neues Board“ fragt nach dem Zweck, oder Atlas wählt; Vorlagen auch für dich
- [ ] Demo neu auf Basis der Rezepte (die Nordlicht-Szene als Demo-Tab)

### Phase 7 – Feinschliff und Barrierefreiheit · M

- [ ] Tastaturbedienung vollständig, Screenreader, Kontrast, Klickziele
- [ ] Hell und dunkel gleichwertig (Galerie-Test)
- [ ] Glossar; alle Meldungen in Klartext mit Lösung
- [ ] Leere Zustände, Fehler- und Ladezustände für jede Kartenfamilie
- [ ] Klangsatz

**Vorschlag für Releases:** 0.5 = Phase 0 und 1 (Atlas live) · 0.6 = Phase 2 und 3 (Ruhe und
Karten) · 0.7 = Phase 4 und 5 · 1.0 = Phase 6 und 7.

---

## 10. Woran wir es messen

| Messgröße | Heute | Ziel |
|---|---|---|
| Zeit bis zur ersten echten Karte nach dem Absenden | Ende der Runde (ca. 10–40 s) | **unter 1,5 s** |
| Board-Änderungen, deren Ergebnis Atlas zurückbekommt | 0 % | **100 %** |
| Board-Kontext pro Nachricht | Auszug bis 2.200 Zeichen, große Boards abgeschnitten | **1 Zeile**, Rest auf Abfrage |
| Dauerhafte Bedienflächen um das Board | 7 | **3** |
| Inhalt in der Gesamtansicht (13"-Laptop) | nur Titel (Zoom unter 42 %) | **das Gesicht jeder Karte** |
| Kartenarten im Design | 29 Einzelarten | **7 Familien, 1 Anatomie** |
| fps beim Schieben und Zoomen mit 300 Karten | nicht gemessen | **mindestens 55** |
| Bildvergleichs-Tests | 0 | **Galerie und 5 Boards** |
| Barrierefreiheit | teilweise | **Tastatur vollständig, Screenreader, AA** |

---

## 11. Risiken und Gegenmittel

| Risiko | Gegenmittel |
|---|---|
| MCP in der interaktiven CLI braucht Freigaben, oder Versionen ändern sich | Machbarkeitstest zuerst (Phase 0), Freigaben vorab per Settings, `cockpit-actions` bleibt als Rückfall |
| Der Umbau bricht Vertrautes | Jede Phase einzeln ausliefern, Bildtests, alte Boards laden unverändert (Familien sind nur Darstellung) |
| Viele kleine Live-Änderungen ruckeln | Änderungen pro Frame bündeln, Anordnung inkrementell |
| Werkzeuge kosten Tokens | Kompakte Antworten, Seitengrößen, Zusammenfassungen statt Volltext |
| Der Umfang wächst | **Feature-Stopp:** in diesem Zyklus keine neuen Kartenarten und keine neuen Effekte |

## 12. Bewusst nicht (Apple sagt Nein)

- Keine neuen Kartenarten und keine neuen Board-Stile in diesem Zyklus.
- 3D, Ermittlungswand und Storyboard bleiben, aber unter „Darstellung“ und nie als Standard.
- Keine Schalter für Aktionen und keine Knopfreihen beim Darüberfahren.
- Kein gemeinsames Bearbeiten mehrerer Menschen in Echtzeit (später).
- Keine Cloud: Alles bleibt auf deinem Rechner.

## 13. Deine Entscheidungen

> **Entschieden (Rob, 14.10.2026): alle vier Empfehlungen.** Zuerst „Atlas live“; Dock unten in
> der Mitte; Vorschläge nur für deine Karten; Releases 0.5 / 0.6 / 0.7 / 1.0. Phase 0 läuft.

1. **Reihenfolge:** zuerst „Atlas live“ (der größte Sprung in der Zusammenarbeit) oder zuerst
   „Ruhe“ (der schnellste sichtbare Gewinn)? *Empfehlung: Atlas live.*
2. **Werkzeugleiste:** Dock unten in der Mitte (wie FigJam, hält die Abschnittsköpfe frei) oder
   oben in der Mitte (wie Freeform am Mac)? *Empfehlung: unten.*
3. **Vorschlagsmodus:** Soll Atlas auch seine eigenen Karten nur noch per Vorschlag umbauen, oder
   reicht „deine Karten nur per Vorschlag“? *Empfehlung: Letzteres.*
4. **Releases** wie in Abschnitt 9 vorgeschlagen (0.5, 0.6, 0.7, 1.0)?

## 14. Der erste Schritt

Phase 0: Kartengalerie, Bildvergleichs-Tests, Leistungsmessung und der MCP-Machbarkeitstest. Am
Ende steht ein kurzes Video: Du schreibst Atlas eine Frage, und nach einer Sekunde erscheint die
erste Karte, gefolgt von der nächsten, während er weiterdenkt.

---

### Anhang: Wo es heute im Code steht

| Thema | Dateien |
|---|---|
| Board-Daten, `applyOps`, Schnappschuss (`describeBoard`) | `pro/src/board.ts` |
| Zeichnen, Kamera, Gesten, Zoomstufe (`FAR_K`) | `pro/src/BoardView.tsx`, `camera.ts`, `gestures.ts` |
| Grammatik der Abschnitte, Anordnung | `pro/src/boardGrammar.ts`, `autoLayout.ts`, `edgeRoute.ts` |
| Atlas' Aktionen und Rundenende | `pro/src/operator.ts` (`parseActions`, `turnJustEnded`) |
| Atlas' Persona und Board-Regeln | `pro/src-tauri/assistants.rs` |
| Raum, Chat, Antwort-Fuß | `pro/src/AssistantsView.tsx`, `answerReport.ts`, `chatRefs.ts` |
| Sitzungsstart der CLIs (`--settings`, Hooks) | `src-tauri/src/cli.rs`, `src-tauri/src/sink.rs` (Settings-JSON) |
| Präsentation, Film, Demo | `pro/src/present.ts`, `film.ts`, `demo.ts`, `demoLive.ts` |
| Seiten auf dem Board | `pro/src/BoardBrowser.tsx` |
| Farben und Tokens heute | `src/index.css` (`--b-*`) |
