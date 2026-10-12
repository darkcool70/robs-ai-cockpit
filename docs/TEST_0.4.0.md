# 0.4.0 — Testplan für Rob

Installer: `Robs AI Cockpit_0.4.0_x64-setup.exe` auf dem Desktop. Jeder Punkt dauert 1–2 Minuten.
✓ = von Claude live geprüft (Testinstanz), ○ = nur Unit-Tests, bitte besonders anschauen.

## 1. Erste Minuten
- ✓ Ohne Atlas: Assistants → „Atlas starten“ (ein Klick). Auf einem leeren Board: „Probier es“ mit vier Startern.
- ✓ „Zeig mir, was du kannst“ → Demo (drei Tabs, Film, keine echten Agenten). „Demo präsentieren“ in der Palette (Strg+K) → Vollbild, Schlusskarte. „Demo entfernen“.
- ✓ Kurze Tour (5 Schritte) unter dem „Probier es“-Kasten.
- ○ Englisch: Sprache der Stimme auf Englisch → Demo und Raum auf Englisch.

## 2. Mit Atlas arbeiten
- ✓ „Mach mir ein Dashboard zu …“ → Dashboard-Tab mit Kennzahlen, Diagramm, sortierbarer Tabelle.
- ✓ „Was als Nächstes?“ (Chip unten links) → Auswahlkarte mit 2–3 Schritten.
- ✓ „Erklär mir die Hypothese … und zeig mir, worauf sie sich stützt“ → Atlas öffnet die Belege-Ansicht.
- ✓ Karte auswählen + Z (oder Lupe) → Hineinzoomen; Esc zurück.
- ✓ Weit herauszoomen (unter 30 %) → Themen-Gruppen („Anthropic · 4 Karten“).
- ○ Sprache: „gib mir 30 Sekunden“, „was ist neu?“, „wo soll ich hinschauen?“, „Atlas, zeig mir, was du kannst“.

## 3. Crew und Agenten (in einem Git-Projekt)
- ✓ „Starte zwei Agenten parallel, jeder im eigenen Worktree: …“ → Rahmen „Crew · 2 Agenten“, eine Zeile pro Agent (Änderungen, Ergebnis, Review).
- ✓ Reviews PASS → „Alle übernehmen (2)“ → Tests auf main → Rahmen faltet sich „Crew: alles übernommen ✓“.
- ✓ Nach einem Neustart: laufende Reviews → „Review unterbrochen“ + „Neu prüfen“.
- ○ Agent scheitert (z. B. Codex mit nicht erlaubtem Modell) → roter Punkt, „Anderes Konto“, Hinweis in Accounts.
- Hinweis: deine `~/.codex/config.toml` hat `model = "gpt-6.1-sol"` — das lehnt das ChatGPT-Konto ab.

## 4. Zurückkommen
- ✓ Geänderte Karten leuchten „neu“, oben „N Karten neu seit deinem letzten Blick · Zeigen“.
- ✓ Punkt am Tab, wenn ein anderes Board Neues hat.
- ○ Länger als 10 Min weg → Banner „Seit du weg bist“; mit Push-URL eine gebündelte Push-Nachricht.

## 5. Handy (Settings → Phone remote, nur im Heimnetz)
- ✓ Einschalten, QR-Code scannen → Tabs „Agenten | Board“, Board live und nur lesend.
- ✓ „Create view-only link“ für Kollegen (kein Eingabefeld, Senden wird abgelehnt), „Revoke“, „New key“ sperrt den alten Link.
- ○ Mit dem echten Handy: Seit-du-weg-bist oben, Zeile antippen springt zur Karte.

## 6. Robustheit (sollte einfach funktionieren)
- ✓ Atlas startet auch mit langer Persona (vorher „Stuck“).
- ✓ Nachrichten an Claude kommen als deine Worte an (vorher fragte Atlas nach „Ja“).
- ✓ Neue Agenten hängen nicht mehr am „Claude in Chrome“-Dialog.
- ✓ Vollbild-Knopf des Boards füllt wirklich das Fenster.

Wenn alles passt: „push“ — dann committe ich beide Repos, tagge v0.4.0 und prüfe den Pro-Build auf GitHub.
