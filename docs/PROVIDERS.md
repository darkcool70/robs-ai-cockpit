# Weitere Anbieter — kostenlose Kontingente (Stand 10.10.2026)

Ziel: zusätzliche, **kostenlose** Tokens für einfache Arbeit (Recherche-Crew, kleine Aufgaben),
damit Claude- und Codex-Abos länger reichen. Regel: **ein Konto pro Person**, so wie es der Anbieter
vorsieht — keine Tricks, um Gratis-Kontingente zu vervielfachen.

## Ergebnis der Recherche

| Werkzeug | Gratis? | Kontingent | Anmeldung | Profil-Ordner | Im Cockpit |
|---|---|---|---|---|---|
| **GitHub Copilot CLI** (`copilot`) | **Ja** — Copilot Free steckt in jedem GitHub-Konto, die CLI ist in allen Plänen enthalten | „AI Credits“-Kontingent pro Monat (GitHub nennt für Free keine Zahl), Reset am 1. des Monats 00:00 UTC; Free hat seit 24.06.2026 **nur „Auto“-Modellwahl** | `copilot login` (Gerätecode + github.com/login/device) | `COPILOT_HOME` (Standard `~/.copilot`) — eigene Profile möglich | **Eigener Anbieter** ✓ |
| **Antigravity CLI** (`agy`, Nachfolger der Gemini CLI) | **Ja**, aber klein | Google AI Free: wöchentliches Kontingent, Zahlen offiziell nicht genannt; Nutzer berichten von ~20 Agenten-Anfragen/Tag bzw. schnellem 429 | Beim ersten Start: Google-Anmeldung im Browser, Code zurück ins Terminal | `~/.gemini/antigravity-cli`, Login im **System-Schlüsselbund** → nur **ein** Profil pro Windows-Benutzer | **Eigener Anbieter** ✓ (ein Profil) |
| Gemini CLI (`gemini`) | **Nicht mehr** | Gratis-Login (1000 Anfragen/Tag) am **18.06.2026 abgeschaltet**; geht nur noch mit bezahltem Gemini-API-Schlüssel | API-Schlüssel | `~/.gemini` | als „Other CLI“ (Hinweis angepasst) |
| Qwen Code (`qwen`) | **Nicht mehr direkt** | Qwen-OAuth-Gratisstufe am **15.04.2026 eingestellt** (QwenLM/qwen-code#3203); kostenlos nur noch über einen anderen Anbieter, z. B. OpenRouter-Gratismodelle | API-Schlüssel (OpenRouter) | `~/.qwen` | als „Other CLI“ |
| OpenRouter `:free`-Modelle | Ja (mit Konto + Schlüssel) | 20 Anfragen/Minute, **50/Tag** (1000/Tag, wenn je ≥ 10 $ Guthaben gekauft) | API-Schlüssel | — | über Qwen Code / OpenCode / Aider als „Other CLI“ |
| OpenCode Zen Gratismodelle | zeitweise | „free while in feedback period“ — wechselt ständig | OpenCode-Konto/Schlüssel | — | als „Other CLI“ |
| Mistral Vibe | ja, sehr klein | Le Chat Free: ~25 Nachrichten/Tag Soft-Cap | Mistral-Konto | — | nicht eingebaut (zu wenig) |
| Amp Free | unsicher | täglich bis 10 $ Guthaben, seit Mai 2026 für viele Nutzer pausiert/gekürzt | Amp-Konto | — | nicht eingebaut (unsicher, eigene Bedingungen) |

Quellen: geminicli.com/docs/resources/quota-and-pricing (Hinweis „Gemini CLI was replaced by
Antigravity CLI on June 18th, 2026“), codelabs.developers.google.com/antigravity-cli-hands-on,
antigravity.google/docs/cli/commands/usage, docs.github.com (Copilot-Pläne, CLI-Befehlsreferenz,
`cli-config-dir-reference`, Usage-based billing, „Changes to model selection for Free and Student
plans“ 24.06.2026), Copilot-SDK „Streaming session events“, github.com/QwenLM/qwen-code/issues/3203,
openrouter.ai (Free-Limits), ampcode.com/news.

## Was jetzt unterstützt wird

- **GitHub Copilot CLI** als vollwertiger Anbieter: eigene Profile (`COPILOT_HOME`), Anmeldung
  per Knopf („Log in with GitHub“), angemeldeter GitHub-Name aus `config.json` (der Token selbst
  liegt im Windows-Anmeldeinformationsspeicher und wird nie gelesen), Status/Antwort/Tätigkeit aus
  dem eigenen Ereignis-Log `session-state/<id>/events.jsonl`, Kontext-% aus `session.usage_info`,
  Fortsetzen per `--resume=<id>`, Fehler aus `session.error` (429 → „rate-limited“ → Failover).
  `GH_TOKEN`/`GITHUB_TOKEN`/`COPILOT_GITHUB_TOKEN` werden der Copilot-Sitzung entzogen, damit
  das Profil-Login gilt; Auto-Update aus (`COPILOT_AUTO_UPDATE=false`).
- **Antigravity CLI (`agy`)** als Anbieter mit genau einem Profil: Erkennung, Start mit
  `--model`, Anmeldung läuft im agy-Fenster selbst, Status über die Bildschirm-Heuristik,
  Limit-Erkennung über die Bildschirmzeile (429 / RESOURCE_EXHAUSTED / „quota exceeded“).
  Gemini-/Google-API-Schlüssel werden entzogen, damit nicht versehentlich bezahlte API-Nutzung läuft.
- **„free“-Plakette** an Konten, im Dialog „Neue Sitzung“, in der Konten-Liste.
- **Kontowahl nach Stufe**: Crew-Recherche nimmt zuerst ein Gratis-Konto; Atlas kann mit
  `"provider":"free"` einfache Aufgaben dorthin schicken; Code-Arbeit und Reviews bleiben auf
  Claude/Codex (Review einer Gratis-Arbeit → Claude). Gratis-Konten sind sonst nur letzte Reserve.

## Bewusst NICHT gemacht (Entscheidung für Rob)

- **Freigabe-Stufen (Autonomie) werden für Copilot/agy nicht auf deren „alles erlauben“-Schalter
  abgebildet** (`--allow-all-tools`, `--allow-all`, `--dangerously-skip-permissions`). Diese
  Agenten fragen also vor Werkzeugen nach; die Sitzung zeigt „needs you“, Atlas oder du antwortest.
  Für unbeaufsichtigte Crews ist das langsamer. Wenn du das willst, muss das ausdrücklich
  freigegeben werden (Stelle: `src-tauri/src/cli.rs`, `build_agent_command`, Zweige Copilot/Antigravity).
- Keine Mehrfach-Konten-Tricks, kein Auslesen privater Kontingent-Endpunkte.

## Risiken

- Copilot Free: kleines Monatskontingent, nur „Auto“-Modell (meist ein kleineres Modell) → für
  Recherche/Zusammenfassungen gut, für schwierige Code-Arbeit nicht.
- Antigravity: Kontingent sehr klein und laut Nutzerberichten unberechenbar (429 nach wenigen
  Prompts); Flags/Startbildschirm ändern sich noch oft → Live-Prüfung nötig.
- Ein Konto pro Person: GitHub/Google-Bedingungen verbieten das Vervielfachen von Gratis-Konten.

## So schließt du die Konten an (Rob)

**GitHub Copilot (empfohlen)**
1. Installieren (einmal, in einem normalen Terminal): `npm i -g @github/copilot`
   (oder `winget install GitHub.Copilot`).
2. Cockpit → **Accounts** → Abschnitt „GitHub Copilot CLI accounts“ → **Add GitHub Copilot CLI account**
   → „Add & Log in with GitHub“.
3. Im Login-Fenster steht ein Code und `https://github.com/login/device` → öffnen (Knopf „Open login
   in private window“ geht auch), mit deinem GitHub-Konto anmelden, Code eingeben, Copilot erlauben.
4. Auf ↻ (Re-check) klicken → „Connected“, „Signed in as <dein GitHub-Name>“, Plakette „free“.
5. **Live prüfen:** neue Sitzung auf dem Copilot-Konto mit einer kleinen Aufgabe → Status wird
   „working“ und danach „waiting“, die Antwort erscheint als letzte Nachricht; Kontext-% sichtbar;
   ob der Text sauber eingefügt wurde (kein „[Pasted text]“-Problem); Modellfeld „auto“
   funktioniert (sonst leer lassen); `/usage` im „Open /usage“-Fenster zeigt das Kontingent.

**Antigravity (optional, kleines Kontingent)**
1. Installieren in PowerShell: `irm https://antigravity.google/cli/install.ps1 | iex`
2. Accounts → „Add Antigravity CLI account“ → „Add & Sign in with Google“.
3. Im agy-Fenster: Google-Anmeldung wählen, im Browser anmelden, Code zurück ins Fenster
   kopieren, Farbschema/Nutzungsbedingungen bestätigen. Fenster schließen.
4. **Live prüfen:** Sitzung starten → beim ersten Mal kommt die Ordner-Vertrauensfrage („Yes, I trust
   this folder“) — der Auftrag wartet, bis du sie beantwortest; danach arbeitet agy; bei
   ausgeschöpftem Kontingent soll die Sitzung „rate-limited“ zeigen.

**Gemini CLI / Qwen Code** lohnen nur noch mit API-Schlüssel (z. B. OpenRouter-Gratismodelle für
Qwen Code: 50 Anfragen/Tag) — unter „Other CLIs“.
