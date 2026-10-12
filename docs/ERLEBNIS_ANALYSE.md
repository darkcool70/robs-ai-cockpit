# Erlebnis-Analyse: Atlas als Präsentator

Stand 12.10.2026. Grundlage: Live-Test in der Testinstanz (Build vom 11./12.10.). Vier echte
Anliegen wurden getippt, mitgeschnitten wurde alle 0,5 s, mit Bildern nach 1/3/6/10/20 s und
Chat-/Sprachtext. Danach folgte eine Bewertung aus Sicht eines Zuhörers, der morgen etwas
entscheiden oder vortragen muss.

**Maßstab (Rob):** „wie in einer Firma jemand, der etwas vorstellt – mit Audio und Visuellem versucht
er mich bestmöglich mit Informationen auszustatten“. Ein guter Präsentator:

1. **holt ab**: Er sagt zuerst in einem Satz, worum es geht und was herauskommt.
2. **zeigt, worüber er spricht**: Bild und Ton laufen im Takt. Was er sagt, sieht man groß.
3. **führt durch eine Gliederung**: Ziel → Belege → Erkenntnisse → Optionen → Empfehlung → nächste Schritte.
4. **trennt Fakt und Einschätzung**: Er sagt, wie sicher etwas ist und woher es kommt.
5. **hört auf zu reden, wenn man fragt**, und antwortet auf die Frage, nicht auf die vorige.
6. **lässt etwas Bleibendes zurück**: Das Board ist das Protokoll, nicht der Chat.

## Die Szenarien

| # | Anliegen | Dauer | Gut | Schwach |
|---|----------|-------|-----|---------|
| 1 | „Ich muss morgen meinem Chef erklären, ob wir kleinen Kanzleien lokale KI anbieten sollten. Bereite mich vor – auf einem neuen Board und kurz gesagt.“ | 14 s | Erkennt das vorhandene Board und baut es nicht doppelt. Die Empfehlung kommt sofort („Pilot statt Angebot an alle“) mit Kurzfassung und „Was dir fehlt“ (Quellen von Anbietern). | Die Antwort endet mit einem englischen Protokoll „Done/Verified/Next“. Das Board wird nicht gezeigt, die Kamera bleibt, wo sie war. |
| 2 | „Stell mir das jetzt in zwei Minuten vor, wie in einem Meeting.“ | 18 s | Atlas startet die Präsentation (Folienleiste) und spricht mit Untertiteln. Der Vortrag ist sauber gegliedert und nennt die Karten mit [[id]]. | **Die Kamera bleibt die ganzen zwei Minuten auf der Übersicht (42 %)**, die Karten sind nicht lesbar. Die Folien kannten nur Rahmen und Einzelkarten, keine Abschnitte. Werkzeugleiste und Reiter bleiben sichtbar, die Folienleiste überdeckt die Reiter. |
| 3 | „Warum empfiehlst du das? Zeig mir die Belege.“ | 54 s | Atlas liest die Quellen selbst, trennt Fakt und Einschätzung und **korrigiert sich selbst** (Kosten 6.490 € netto statt „ab 3.000 €“). | **Das Board ändert sich nicht.** Keine Hervorhebung der Belege, keine „stützt/widerspricht“-Pfeile, die falsche Kostenkarte bleibt stehen. Alles steht als Textwand im Chat. |
| 4 | „Was machen meine Agenten gerade?“ | 12 s | Schnell und ehrlich („kein Agent läuft“). | „3 Aufgaben in Prüfung, **laut Snapshot ohne Titel**“: Dem Schnappschuss fehlen die Titel (Fehler). Nichts ist sichtbar, kein Blick auf die Mission. „Claude A ist bei 16 %“ ist missverständlich (verbraucht oder übrig?). |

Außerdem beobachtet (Runde 45, neues Board „Lokale KI für Kanzleien“, 34 s):

- **Struktur:** Die sechs Abschnitte stehen sauber von links nach rechts. „Neues Kapitel rechts: Umsetzung“ setzt Kapitel 7 ganz rechts.
- **Text außerhalb der Karte:** Schlagwörter („#Lokale KI #Kanzlei ↗1 Board“) hängen unter den Karten und stoßen an die Pfeile.
- **Abgeschnittene Titel:** Titel waren gekürzt („Volumen und Kosten n…“), weil die Art („AUFGABE“) in derselben Zeile stand. Im Abschnitt „Nächste Schritte“ ist diese Angabe ohnehin doppelt. Bei Aufgaben standen zwei Kreise nebeneinander (Art-Symbol + Status).
- **Doppelte Karten:** Für das Kapitel „Umsetzung“ hat Atlas die drei Schritte **neu angelegt statt verschoben**.
- **Falsche Kartenart:** Die Zielkarte war als „Entscheidung“ angelegt.
- **Sprache läuft weiter:** Bei einer neuen Frage las Atlas die vorige Antwort weiter vor.
- **Platzhalter verdeckt Inhalt:** „Atlas bereitet vor“ lag über einer Abschnittsüberschrift.
- **Englische Reste:** Die Persönlichkeitszeile im Kopf („You are calm, loyal …“), „just now“, die Fehlermeldung „Your Pro trial has ended“.
- **Abgelaufene Testphase:** Der Knopf „Aufwecken“ sieht weiter benutzbar aus.

## Wie Atlas Informationen liefern sollte (Zielbild)

1. **Erster Satz = Ergebnis.** „Kurz: Pilot mit zwei Kanzleien, kein Angebot an alle.“ Die Begründung folgt erst danach.
2. **Das Board ist die Bühne, der Chat nur der Untertitel.** Alles Wichtige steht als Karte im richtigen Abschnitt. Der Chat fasst in höchstens fünf Zeilen zusammen und verweist auf die Karten.
3. **Zeigen beim Sprechen.** Jede genannte Karte ([[id]]) wird sichtbar: In der Präsentation springt die Folie auf ihren Abschnitt, sonst fährt die Kamera lesbar hin, und die Karte leuchtet.
4. **Gliederung = Abschnitte = Folien.** Ein Vortrag geht Abschnitt für Abschnitt („Erstens das Ziel … zweitens, was wir wissen …“) und die Folien folgen dem.
5. **Belege sichtbar machen.** Bei „warum?“ werden die Belege hervorgehoben und „stützt/widerspricht“-Pfeile zur Empfehlung gezogen. Schwache Belege bekommen eine Markierung („Anbieterangabe“, „nicht geprüft“). Korrekturen landen auf der Karte, nicht nur im Chat.
6. **Unterbrechbar.** Eine neue Frage beendet die laufende Rede sofort.
7. **Nächster Schritt als Knopf.** „Soll ich die Kosten nachrechnen?“ wird ein Vorschlag, den man anklicken kann. Ein Protokoll mit „Done/Verified/Next“ gibt es nicht.
8. **Ruhig bleiben.** Es erscheint nur, was hilft. Schlagwörter, Kartenart und ID sieht man erst beim Hinsehen (Maus darüber).

## Umsetzung Schritt für Schritt

- [x] (11./12.10.) Kartenkopf: Der Titel hat die volle Breite, Kartenart und ID erscheinen erst beim Drüberfahren. Aufgaben zeigen nur noch einen Kreis (den Status). Schlagwörter und „auch auf anderen Boards“ erscheinen nur bei Maus darüber oder Auswahl, nichts hängt mehr über den Kartenrand.
- [x] (12.10.) **Folien = Abschnitte:** Ein Board mit Abschnitten wird Abschnitt für Abschnitt präsentiert, lange Abschnitte in Teilen à 4 Karten („Nächste Schritte · 1/2“). Getestet.
- [x] (12.10.) **Folien folgen der Rede:** Nennt Atlas beim Präsentieren eine Karte ([[id]]), die auf einer anderen Folie liegt, wechselt die Präsentation dorthin. Die Kamera zeigt den Abschnitt, die Karte leuchtet. Getestet (`slideFor`).
- [x] (11.10.) Füllwörter an Pfeilen („then“, „dann“) sind weg. Die Rahmenbeschreibung steht im Kopf des Rahmens.
- [x] (12.10.) Präsentationsmodus ruhig: Werkzeugleiste und Reiter blenden aus, nur die Folienleiste bleibt (live gesehen).
- [x] ○ (12.10.) Eine neue Frage (getippt) beendet die laufende Rede sofort. Gesprochen gab es das schon (Barge-in).
- [x] (12.10., live) Antwort-Fuß: „Erledigt · geprüft“ (aufklappbar), „Als Nächstes“ als Vorschlag. Der Knopf „Ja, mach das“ erscheint nur bei einem einzelnen Vorschlag, nicht bei „… oder …?“. Kartenmarker zeigen den Kartennamen.
- [x] ○ (12.10.) Der Platzhalter „Atlas bereitet vor“ sucht eine freie Stelle, nie über Karten oder Abschnittsüberschriften (getestet).
- [x] (12.10., live) Persona „wie ein guter Präsentator“: Ergebnis zuerst („Kurz: Ja, … aber zuerst als Pilot“). „Stell vor“ öffnet **das genannte Board** (`{"do":"present","board":…}`). Danach bekommt Atlas sofort dessen Karten und Folien und hält den Vortrag Abschnitt für Abschnitt, die Folien folgen (live: Folie springt auf „Ziel & Kontext“ bei 92 % statt Übersicht bei 42 %). „Warum?“ zeigt Dafür/Dagegen/Kosten/Offen mit Kartenmarkern und hebt die Belege auf dem Board hervor (Spotlight, live).
- [x] ○ (12.10.) Der Schnappschuss nennt Aufgaben mit Titel. Zahlen mit Bedeutung („noch 16 % übrig“).
- [x] ○ (12.10.) Englische Reste: Persönlichkeitszeile (eingebaute Persönlichkeiten mit deutschem Untertitel, live), Zeiten („gerade eben“, „vor 3 Min.“, live), Testphasen-Meldung. Bei abgelaufener Testphase steht „Pro holen“ statt „Aufwecken“.
- [x] ○ (12.10.) Kartenmarker gehören zu ihrem Board (chatRefs.ts). Vorher: Kartenmarker in **älteren** Chat-Nachrichten wurden gegen das gerade offene Board aufgelöst. Ist ein anderes Board offen, zeigt „[[g1]]“ eine falsche Karte. Lösung: das Board zur Nachricht merken (Schnappschuss-Zeitpunkt) und Marker nur dort auflösen bzw. beim Klick das Board öffnen.
- [x] ○ (12.10.) Nach einem großen Bau zeigt die Kamera das ganze Board (overviewAfterTurn; Live-Runde 45 hatte Spalte 4 abgeschnitten).
- [ ] „Warum?“: Atlas hebt hervor, zieht aber noch keine neuen „stützt/widerspricht“-Pfeile, wenn schon welche da sind. Beobachten.
- [ ] Mit Mikrofon (Rob): Gespräch statt Tippen, „Atlas, stell mir das Chef-Briefing vor“, dazwischenfragen („warte“ / „warum?“).
