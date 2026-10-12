# German text with an English voice

A Piper voice only knows the language it was trained on: `en_US-amy-medium` reads German with
English sounds. So the cockpit decides the language of every sentence it speaks
(`src/lib/speechLang.ts`, a small word list: German and English function words, umlauts) and hands
German sentences to a German voice. English stays with the chosen voice, exactly as before.

| Setting (Voice tab → *The AI's voice*) | Key | Default |
| --- | --- | --- |
| German voice („Deutsch spricht“) | `ttsGermanVoice` | automatic: Supertonic Anna / Max when installed, else Kerstin for a female voice, Thorsten for a male one, else any installed local German voice (never a cloud voice unless chosen). „Amy · Deutsch mit Akzent“ was removed (2026-10-10); an old `ttsAutoLanguage: false` is ignored |
| Its pitch | `ttsGermanPitch` | `auto`: 1.12 for Kerstin behind a female voice, else 1 |

* **Why Kerstin for Amy:** both are clean, calm female voices. Kerstin speaks at ~160 Hz, Amy at
  ~200 Hz; the pitch factor 1.12 (the cockpit's usual pitch trick: Piper speaks slower, playback is
  faster, so the tempo stays) brings her to ~185 Hz. Ramona was measured too, but is breathier and
  less steady.
* **Measured intelligibility** (Piper → local Whisper small, two German sentences, 2026-10-09):
  Kerstin clearest (one sentence word-perfect, „Codex“ misheard in the other); Eva (`eva_k-x_low`,
  16 kHz, ~182 Hz → pitch 1.06) only names / English words misheard („Rob“, „Dashboard“, „Codex“);
  Ramona more slips; Amy reading German herself understandable with a strong accent, Amy with a
  German espeak config unintelligible; `de_DE-mls-medium` (236 speakers) unintelligible for every
  high-pitched speaker tried, so it is not offered.
* **Sentences without a hint** ("Okay.", "Standby.") follow the rest of the answer, or the dictation
  language when the whole text has none.
* **Fillers and callouts** use the same rule, and an English voice says German fillers while you
  dictate in German.
* **Missing voice:** with an English main voice and German dictation, the German voice is downloaded
  once on start (checksum-pinned like every voice). Until it is there, the main voice keeps speaking.
* **Voice cloning (XTTS-v2 and similar)** is deliberately not built in: it needs Python plus PyTorch
  (several GB), is slower than real time on a laptop CPU, and the XTTS model license (Coqui Public
  Model License) does not allow commercial use, which rules it out for the Pro edition.

# Bessere deutsche Stimmen (Recherche + Umsetzung, 10.10.2026)

Robs Urteil über die Piper-Proben: die deutschen Frauen- und Männerstimmen klingen nicht schön.
Ziel: natürlich klingendes Deutsch, das im verkauften Pro-Produkt verwendet werden darf, Atlas soll
in ~1 s anfangen zu sprechen. Ergebnis: **Supertonic 3 ist eingebaut (lokal, neue Standard-
Empfehlung)**, **Azure als Cloud-Option mit eigenem Schlüssel**, Piper bleibt Offline-Ersatz.

## Was es gibt – ehrlich bewertet

**Lokal (läuft auf dem PC, nichts geht ins Netz)**

| Engine | Deutsch | Größe | Tempo hier (Core Ultra 5, unter Last) | Lizenz (Verkauf?) | Urteil |
| --- | --- | --- | --- | --- | --- |
| **Supertonic 3** (Supertone, Apr. 2026) | 10 feste Stimmen (5 m, 5 w), sehr natürlich, auch Englisch | ~415 MB (Modell 400 MB + ONNX Runtime 15 MB), ~0,5 GB RAM | erster Satz (2,8 s Audio) **0,9–1,2 s**, danach ~0,3× Echtzeit | Modell OpenRAIL-M (geschäftlich erlaubt, mit Nutzungsverboten: kein Nachahmen echter Personen ohne Einwilligung, nichts als echte Aufnahme ausgeben), Code MIT | **eingebaut.** Reine ONNX-Pipeline ohne Phonemizer → in Rust portierbar (`ort`, DLL zur Laufzeit). Repo seit 09/2026 archiviert, Gewichte bleiben verfügbar (fest auf Commit gepinnt). |
| Kyutai **Pocket TTS** (2026) | Deutsch ja, aber nur 1 fertige Stimme („Jürgen“), weitere nur per Stimmklon (gated) | ~100 M Parameter | hier knapp langsamer als Echtzeit (Python/PyTorch, unter Last; Kyutai: 6× auf M4) | Code MIT, Gewichte CC-BY-4.0 | klingt gut (Probe 99), aber PyTorch/Python nötig, autoregressiv → aufwendiger Rust-Port. Später interessant. |
| Neuphonic **NeuTTS Nano German** | ja, Stimmklon | ~230 M | „Echtzeit auf Laptop-CPU“ | eigene Lizenz (Kontaktangaben nötig), Wasserzeichen | nicht gewählt: unklare Verkaufslizenz, braucht espeak + llama.cpp. |
| Kokoro-82M | **kein Deutsch** (offiziell en/fr/es/it/pt/hi/ja/zh) | 82 M | sehr schnell | Apache-2.0 | scheidet aus. |
| Orpheus/Kani (z. B. „Kartoffel-Orpheus“ 3B) | sehr natürlich | 1–3 GB+ | auf CPU deutlich langsamer als Echtzeit | Llama-Lizenz | nur mit GPU sinnvoll. |
| F5-TTS / XTTS-v2 / Fish-Speech | gut, Stimmklon | GB-Bereich, PyTorch | langsamer als Echtzeit auf CPU | **nicht kommerziell** (CC-BY-NC / CPML) | scheidet aus. |
| Chatterbox Multilingual (Resemble) | ja | ~0,5 B | auf CPU zu langsam | MIT | erst mit GPU. |
| Piper „high“ (Thorsten HD) und weitere Piper-Stimmen | bereits getestet | 63–114 MB | ~0,1 s | MIT/CC-Varianten | bleibt Offline-Ersatz; klingt synthetisch. |
| Windows-11-„natürliche“ Stimmen (Katja/Conrad für die Sprachausgabe) | sehr gut | – | – | **nicht für Fremd-Apps freigegeben**: nur über Narrator; SAPI-Adapter (NaturalVoiceSAPIAdapter) benutzt aus Systemdateien gezogene Schlüssel und kann jederzeit brechen | für ein verkauftes Produkt nicht vertretbar. |

**Cloud (Text verlässt den PC – nur mit ausdrücklicher Zustimmung)**

| Dienst | Deutsche Stimmen | Preis (10/2026) | Schlüssel | Urteil |
| --- | --- | --- | --- | --- |
| **Microsoft Azure AI Speech** | Seraphina/Florian Multilingual, Seraphina/Florian HD (Dragon), Katja, Conrad (Stimmungen), dazu neue MAI-Voice-2 (Klaus/Mia mit vielen Stimmungen) | Free F0: **0,5 Mio. Zeichen/Monat gratis**, danach ~15–16 $ je 1 Mio. Zeichen, HD teurer | eigener Azure-Speech-Schlüssel + Region | **eingebaut.** Offizielle API, EU-Regionen, laut Microsoft werden Text und Audio der Echtzeit-Synthese nicht gespeichert. |
| ElevenLabs (Flash v2.5) | sehr natürlich, ~75 ms | ab 6 $/Monat (30 000 Credits), Gratis-Plan **ohne** kommerzielle Nutzung | API-Schlüssel | bester Klang, aber teuer pro Zeichen; nicht eingebaut (kann als dritter Anbieter in `tts_cloud.rs` folgen). |
| OpenAI gpt-4o-mini-tts | gut, steuerbar per Anweisung („sprich warm“) | ~0,015 $/Minute | API-Schlüssel | Deutsch mit leichtem Akzent; nicht eingebaut. |
| Google Cloud Chirp 3 HD | gut | 30 $ je 1 Mio. Zeichen, 1 Mio./Monat gratis | Google-Cloud-Projekt + Schlüssel | nicht eingebaut (Azure deckt dasselbe ab). |
| „Edge-TTS“ (inoffizieller Gratis-Zugang zu den Edge-Vorlesestimmen) | sehr gut | „gratis“ | – | **nicht zulässig**: nur für Edges eigene Vorlesefunktion gedacht, Microsoft verweist für Apps auf Azure; seit Ende 2025 zeitweise gesperrt. Bewusst nicht benutzt. |

## Was eingebaut ist

* **Voice-Tab → „Stimmen-Engine“**: Supertonic (offline · natürlich), Piper (offline · klein),
  Azure (Cloud · eigener Schlüssel); je Engine eigene Stimmenliste. Einstellung `ttsVoiceEngine`
  (nur Anzeige), gesprochen wird weiter mit `ttsNeuralVoice` – die Stimmen-ID sagt die Engine:
  Piper-IDs wie bisher, `st-…` Supertonic, `az-…` Azure.
* **Supertonic** (`src-tauri/src/supertonic.rs`, `tts.rs`): Download auf Knopfdruck, alle Dateien
  per SHA-256 gepinnt (Hugging Face `Supertone/supertonic-3@724fb5ab`, ONNX Runtime 1.31.0 aus dem
  offiziellen Wheel, nur `onnxruntime.dll` + `onnxruntime_providers_shared.dll`). Die DLL wird zur
  Laufzeit geladen (`ort` mit `load-dynamic`) – kein Build-Download, keine größere App. Modell bleibt
  geladen, solange Supertonic spricht; Wechsel zu einer anderen Engine gibt den Speicher frei
  (`tts_release`). 5 Rechenschritte: gemessen gleich verständlich wie die Referenz mit 8, ~35 %
  schneller (3 Schritte: hörbare Fehler). Die Sprache jedes Satzes (de/en) geht an die Engine.
* **Azure** (`src-tauri/src/tts_cloud.rs`): Region + KEY 1 eingeben, Häkchen „Texte dürfen an
  Microsoft gehen“, „Prüfen & speichern“ (ein Testwort, erst dann gespeichert). Der Schlüssel liegt
  **DPAPI-verschlüsselt** in `<home>/secrets/azure-speech.bin` (`secret.rs`), kommt nie zurück ins
  UI, nicht in Logs, nicht in den Settings-Export. SSML mit Tempo (`prosody`), Stimmung
  (`express-as`, z. B. Conrad „cheerful“ bei guten Nachrichten) und Englisch in Multilingual-Stimmen
  (`<lang xml:lang="en-US">`). Eine Cloud-Stimme spricht **nur, wenn sie ausdrücklich gewählt ist** –
  nie automatisch als Ersatz.
* **Ausfallsicher**: Scheitert Supertonic oder Azure (offline, Kontingent, falscher Schlüssel), spricht
  genau dieser Satz die lokale Piper-Stimme (`synth()` in `tts.ts`), mit höchstens einem Hinweis pro
  Minute. Erst wenn auch Piper fehlt, die Windows-Stimme.
* **„Amy · Deutsch mit Akzent“ entfernt**: Deutsch spricht immer eine deutsche Stimme; Amy bleibt fürs
  Englische.

## Messung (lokales Whisper small, 10.10.2026)

| Stimme | Satz 1 (Dashboard) | Satz 2 („Codex braucht dich kurz …“) | Satz 3 (lang) |
| --- | --- | --- | --- |
| Piper Kerstin (alt) | fehlerfrei | „**Kurz** braucht dich“ | – |
| Piper Eva (alt) | „Rube“, „Dash-Boot“ | „Cortx“ | – |
| Piper Ramona (alt) | „das spart“, „Abgänden“ | „Obst brauch dich … freier Baby“ | – |
| Supertonic (alle 10) | alle fehlerfrei, auch „Rob“, „Dashboard“ | alle fehlerfrei, auch „Codex“ | 8/10 fehlerfrei, F4/F5 je ein Laut |

Hörproben: `Stimmproben Atlas/neu/` auf dem Desktop (mit LIESMICH.txt).

# How much it talks

| Say or type (a whole short sentence) | Effect | Settings |
| --- | --- | --- |
| „sprich erstmal nicht“, „sei still“, „psst“, „mute“, „be quiet“ | muted — one soft sound, no sentence | `voiceMuted` = true |
| „du darfst wieder sprechen“, „sprich wieder“, „unmute“ | unmuted — „Okay.“ | `voiceMuted` = false |
| „sprich weniger“, „nur das Wichtigste“, „talk less“ | „Nur wenn ich frage“, spoken answers at most two sentences, no fillers | `voiceSpeakWhen` = asked, `voiceBrief` = true |
| „sag mir alles“, „sprich mehr“, „keep me posted“ | „Wichtiges auch melden“ | `voiceSpeakWhen` = important, `voiceBrief` = false |
| „lies alles vor“, „read everything“ | „Alles vorlesen“ | `voiceSpeakWhen` = all, `voiceBrief` = false |

* Parsed in `src/lib/speechControl.ts` (pure, unit tested, false positives too: „sprich mit dem
  Agenten über …“, „sag mir alles über …“, „erzähl mir mehr“ stay messages). Checked before every
  other voice command (dictation, conversation, wake word) and in the assistant chat.
* **Muted = output only.** `speak`, fillers, callouts and the operator's own reader stay silent;
  a conversation still listens again after each answer, the wake word and „Sprechen“ still work.
  Interface sounds (the short beeps) follow their own setting. Button: Atlas's room header and the
  voice bar; shortcut Strg+Umschalt+M.
* **While it works** (`src/lib/progress.ts`, runtime in `fillers.ts`): progress lines from the live
  activity (monitor.rs: `Fetching …`, `Web search: …`, `Reading …`, `Editing …`, Bash descriptions),
  the first one ~2.5 s after sending, then one every 6–8 s (11–14 s after 45 s, ×1.5 with
  `voiceBrief`), never a line twice per wait; its own interim sentence goes first; a filler only
  when there is nothing to report.
