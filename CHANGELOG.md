# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.1] - 2026-10-14

A tidier Atlas room: sections you can rename and move, a compact header that gives the board
the height, and the board fully in English in English mode.

### Added
- **Rename and move sections on the board (Pro):** double-click a section heading to give it your own name („Erkenntnisse“ → „Was wir wissen“), the ‹ › arrows next to it move it one step left or right — its cards go along, Ctrl+Z undoes it. Atlas can do the same when asked (`{"op":"lane"}`).

### Changed
- **The board speaks English in English mode:** entity kinds (Organisation, Technology …), relation words in the card zoom, the crew view and the card zoom's hints follow the room's language — also in the board picture and the saved web page.
- **Status notes on the board** („1 ausgewählt …“, „Atlas denkt nach …“) moved to the bottom right above the zoom bar, so they never collide with the welcome card at the top.
- The app tour's spotlight uses a calm accent ring instead of a glow.
- **A compact room header:** Atlas' header is about 95 px instead of 160 (smaller face, name and line in one block, the „Missionszentrale“ line moved into the name's tooltip) — the board gets the height.

### Fixed
- Card names in an answer's footer („Als Nächstes“) stayed empty when the answer was about another board than the open one; footer and answer now share the same card references and refresh once the project's boards are loaded.

## [0.4.0] - 2026-10-12

Atlas, the AI operator you talk to, with a structured whiteboard (Board 2.0), presentations that
follow its words, natural offline voices, a ribbon toolbar, touchpad zoom that works, free
Copilot accounts and much more. The first part of 0.4.0 (until 2026-10-05) is listed further
down.

### Added
- **„Klang“ for the Supertonic voices:** Schnell · Ausgewogen · Beste (4 / 5 / 8 denoising steps) in the Voice tab — a quicker first sentence or the finest sound.
- **Card references in the chat belong to their board:** every operator answer remembers the board it was about (from the snapshot or its own board switch); `[[g1]]` shows that board's card, a click opens it there — before, an older answer pointed at the open board's `g1` (`pro/src/chatRefs.ts`). References to cards that are gone no longer show as bare ids.
- **After a big build the camera steps back:** six new cards or new cards in three sections in one turn → at the end the whole board is shown, like a presenter showing the whole picture first (`overviewAfterTurn`).
- **English crew view:** progress, „Merge all“, review badges and the agent card's steering buttons follow the room's language.
- **Atlas presents like a person in a meeting (Pro):** a board in sections is presented section by section (long ones in parts of four cards), and the slides follow the talk — when Atlas names a card (`[[id]]`) that is on another slide, the presentation moves there by itself. While presenting the stage is calm: toolbar and board tabs step aside, only the slide bar stays. The persona learned the presenter's rules: the result first, „stell vor“ → present section by section, „warum? / Belege?“ → show it on the board (spotlight, supports/contradicts arrows, corrected cards), one truth on the board (move instead of duplicating). Findings and plan: docs/ERLEBNIS_ANALYSE.md.
- **Answer footer in the chat (Pro):** the „Done / Verified / Next“ lines at the end of an answer become a small footer — „Erledigt · geprüft“ folds open, the next step stands as a suggestion with a „Ja, mach das“ button on the latest answer (`pro/src/answerReport.ts`).
- **Resizable assistant panel (Pro):** drag the edge between the board and Chat/Mission/Terminal; double-click resets it, the width is remembered (`pro/src/SideSplitter.tsx`).
- **„Dieses Board nach Abschnitten ordnen?“:** older boards offer the new order once (one click, undoable) instead of moving anything silently.
- **Board 2.0 — a structured whiteboard (Pro):** the board has a grammar now (`pro/src/boardGrammar.ts`, brief in docs/BOARD_DESIGN.md): sections stand as columns from left to right in the order a project lead runs a decision — Ziel & Kontext · Quellen · Zahlen · Erkenntnisse · Optionen · Offene Fragen · Entscheidung · Nächste Schritte — each with a calm panel and its number, heading and count. Every card of the operator goes into its section (`"zone"`, or derived from its kind), stacked top to bottom (chains in arrow order, a step's prompt right below it), a tall section continues in a second column; a new topic opens an own chapter to the right (`{"op":"section","title":"…"}`), the operator's frames are chapters with sections inside; docked pages take their section's full width. Cards you placed, moved or resized stay where they are; new cards keep clear of them. `{"op":"layout"}` / „Aufräumen“ puts an older board into sections.
- **Connectors that carry meaning:** arrows run orthogonally with soft corners through the gutters, around cards and section headings (`pro/src/edgeRoute.ts`), fan out where several meet one side; a label only where the operator wrote one, a relation shows in the line (green „stützt“, red dashed „widerspricht“); no sparks.
- **Text never leaves a card:** German hyphenation (`lang="de"`, `hyphens:auto`, `overflow-wrap`), long words broken in the height model and in the board picture (`wrapWords`), cards as tall as their text up to a limit, then „mehr ›“.
- **Natural German voices — „Stimmen-Engine“ in the Voice tab:** Supertonic 3 (local, ten natural voices — five male, five female — one download of ~415 MB, checksum-pinned; ONNX Runtime loaded at run time from the cockpit's own copy) next to Piper, and Microsoft Azure voices (Seraphina, Florian, HD, Katja, Conrad) as an explicit cloud opt-in with your own key (checked before it is stored, DPAPI-encrypted, never shown or logged; a cloud voice is never picked automatically). Each sentence goes to the engine in its language (Supertonic and the multilingual Azure voices read English too); Azure gets speed and moods (Conrad „cheerful“ for good news). When Supertonic or Azure fails (offline, quota, key), that sentence is spoken by the local Piper voice, with one notice. Research and measurements in docs/VOICE_LANGUAGE.md („Bessere deutsche Stimmen“): all ten Supertonic voices understood word for word by Whisper where Piper misheard „Rob“, „Dashboard“, „Codex“.
- **One control bar in the assistant's room (Pro):** „Sprechen“ / „Gespräch beenden“ as the primary action with the conversation's state (Hört zu · Versteht · Denkt nach · Spricht), „Unterbrechen“ while it speaks, a segmented voice control **Stumm · Kurz · Normal · Alles** (one click sets voiceMuted / voiceSpeakWhen / voiceBrief; Ctrl+Shift+M and the spoken / typed controls land on the same segment), the model chip and „Aufwecken“ / „Schlafen“ on the right, edit / workspace / terminal / voice settings in a quiet „⋯“ menu. Narrow rooms show icons with tooltips; fixed widths keep it from jumping. Replaces the scattered header buttons, the separate mute icon and the second „Sprechen“ at the chat input (dictate + send stay).
- **Free-tier accounts: GitHub Copilot CLI and Antigravity CLI** (research in docs/PROVIDERS.md — the free Gemini CLI login and Qwen OAuth ended in 2026). Copilot is a full provider: isolated profiles (`COPILOT_HOME`), „Log in with GitHub“, the GitHub login name read from its `config.json`, live status / activity / answers / context % from its own `session-state/<id>/events.jsonl`, resume by id, a `session.error` 429 becomes „rate-limited“ (failover can move the work); `GH_TOKEN`/`GITHUB_TOKEN` are kept out of its sessions so the profile's login counts. Antigravity (`agy`, Gemini CLI's successor) runs with its one profile (login in the system keyring), status from the screen, Google API keys kept out so it stays on the free login. Approval levels are deliberately not mapped to their allow-all switches — these agents ask before tools.
- **„free“ badge and tiered account choice:** free-tier accounts carry a „free“ badge (Accounts, new-session dialog); crew research members take a free account first, the operator can send simple tasks there with `"provider":"free"`, code work and reviews stay on Claude / Codex (work done for free is reviewed by Claude); the snapshot marks free accounts for Atlas.
- Screen detection knows free-tier limit messages („You've reached your rate limit“, `RESOURCE_EXHAUSTED`, „quota exceeded“, „out of AI credits“); GitHub's device-login page and Google sign-in can open in the private login window.
- **„Anderes Konto“ on a failed agent (Pro):** an agent stuck on an error gets a chip on its card that restarts the same task in the same worktree on the best other account (another provider first after a model error, never an account that failed recently); partial work in the worktree is kept and the new agent continues from it.
- **The operator shows what a card rests on (Pro):** while it explains, `{"op":"zoominto","id":…}` opens the card's evidence view („off“ closes it) — verified live: asked about the hypothesis, Atlas explained it and opened its evidence by itself. Same-titled pieces in the evidence view show their entity („#OpenAI“, „#Google“).
- **A partner, not a tool (Pro):** „Was als Nächstes?“ in the board caption — the operator looks at the board and puts 2–3 concrete next steps on a choice card, the one it recommends first (verified live). Spoken: „was ist neu?“ (a briefing of what changed since you were last here), „was jetzt?“, „öffne das Board …“, „nächster / voriger Tab“.
- **„Übernehmen“ on a diff card (Pro):** an agent's reviewed changes go into the project with one click (after a yes) — its agents in the worktree are stopped, the branch is merged, the task is closed.
- **The command palette finds cards on every board** of the project („Andere Boards“), not only the open one.
- **Frames tidy themselves:** an AI frame with five or more cards dropped in without places is laid out as a grid.
- **Crew dashboard (Pro):** when the operator sends two or more agents off in one answer, the cockpit gathers them in one calm frame by itself — the live crew, tests and build on top, then one row per agent with its card, its changes and its result (they land in its row) — instead of cards all over the board. When all are done the operator is told once and fills the frame's „Crew-Ergebnis“ card, citing the agents' cards.
- **Crew progress at a glance (Pro):** a crew frame's header shows one dot per agent (working / needs you / done) and „2/3 fertig“; the operator's snapshot carries it too.
- **A research crew folds away (Pro):** once the operator's summary stands in the „Ergebnis“ frame, the raw crew frame (with its pages) folds into one compact card; the consolidation message names each agent's result card so the summary can cite it.
- **Steer one agent from its card (Pro):** „Anweisung“ (a new instruction, taken as soon as it is ready) and „Stopp“ (after a yes) on every running agent's card; „Nochmal“ on a finished one — its task prefilled to correct, sent to it again (restarted in its worktree when it was stopped); its old review counts as stale and a new one runs when it is done.
- **Crew card for its own crew (Pro):** the live Crew card inside a crew frame lists only that crew — finished and stopped members too, with their state and „2/3 fertig“.
- **Review verdict on the diff card (Pro):** a calm „Review ✓ / ✗ / läuft / alt“ badge next to an agent's changes (a click shows the review); in a crew frame the review card sits at the end of the agent's row. On a failed review, „Befunde zurück“ sends its findings to that agent as a new round (restarted in its worktree when it was stopped).
- **„Alle übernehmen“ (Pro):** once every member of a code crew is done and no review runs or failed, the crew frame's header offers to take all changes over — confirmed once, merged branch by branch, stopping at the first conflict with a clear message; merged diff cards turn „übernommen“. A stale review (the agent ran again after it) blocks it until the new review is in. Afterwards the project's tests run once on the main tree and the header shows „übernommen · Tests ✓ / ✗“ (red tests are reported to the operator); when all is well the dashboard folds into one calm card „Crew: alles übernommen ✓“, opened again with „Aufklappen“.
- **Cited cards light up (Pro):** when the operator's answer is read rather than heard, the cards it cites with [[id]] glow together as it arrives; the persona asks for brief citations when answering from cards.
- **What changed since you last looked (Pro):** opening a board — or coming back to the window after ten minutes or more — the cards that are new or changed since then wear a soft halo with a small „neu“, which fades once the card has been on screen for a moment (or you click it). One calm line says „3 Karten neu seit deinem letzten Blick · Zeigen“; when more than nine cards (or nearly the whole board) changed it says „Viel Neues: … · Zeigen · In 30 Sekunden“ once instead of glowing everywhere. A board redrawn from its source glows only the cards that really changed.
- **Where to look next (Pro):** at most one card breathes gently, three times, then rests with a faint ring — an agent that needs you, a choice card waiting for your answer, red tests or build, a watch that rang, an agent that just finished, the answer to what you asked (in that order). Clicking the card (or × on the line) settles it; when the card is off screen the line says „Als Nächstes: … ›“ and flies you there. Quiet while presenting, filming, drawing or in the spotlight.
- **Briefings that fit your time (Pro):** „gib mir 30 Sekunden“, „was ist neu, ganz kurz“, „erklär mir das Board in fünf Minuten“, „Kurzfassung“ — the briefing keeps to the time (about 2.2 spoken words a second: one or two sentences, the three main points, or chapter by chapter), short ones without new cards, and names the cards new on this board with [[id]] so they light up. Also „In 30 Sekunden“ in the welcome-back banner and the palette.
- **„Quelle geändert – aktualisieren?“ (Pro):** a file or data card notices when its file changed since it was read (checked every 15 s while the board is open); one click reads it again and the card glows as changed.
- **A heat map of the project (Pro):** in the overview every tile warms calmly with how much changed on its board since you last looked (border, glow, a light wash — nothing new stays as it was), and lists „Was sich geändert hat“ in at most three lines („Chart: Preise 2026“, „+ 4 weitere“); the briefing gets those lines too.
- **The operator says where to look (Pro):** `{"op":"look","id":"…","why":"…"}` makes a card the one to look at next (after an agent that needs you, before everything else, for three hours; `"id":"off"` takes it back). „Als Nächstes: …“ is said once — at the end of a „was ist neu?“ briefing, or by itself when you come back in a voice conversation; „Wo soll ich hinschauen?“ flies there and says why.
- **Changes stay visible from far away (Pro):** zoomed out, new cards keep a bolder halo and are not counted as seen yet, and a frame holding new cards glows with „3 neu“ (folded frames show the count at any zoom; during a summary the frames still say where the news is).
- **The board as a web page to pass on (Pro):** „Als Webseite speichern“ (toolbar and palette) saves the open board as one calm, self-contained HTML file — title, caption, a picture of the whole board, then its chapters in reading order with every card (charts as small SVGs, tables, hypotheses with their confidence, choices, sources as links, details folded behind „mehr“, folded frames folded). Read-only: no scripts, nothing loaded from elsewhere, local paths reduced to file names, card ids left out. Opens in any browser, prints cleanly.
- **The board on your phone (Pro):** while the phone remote is on, its page gets a „Board“ tab — the open board, live and read-only (it refreshes a few seconds after the board changes and keeps your place), the operator's latest answer on top and a line to message it. The operator is listed first among the agents with its answer cleaned of its action block; messages from the phone reach it marked „[Vom Handy]“ so it answers short.
- **QR code for the phone remote:** „QR code“ next to the link in Settings shows the link as a code for the phone's camera (on request only — it carries the key).
- **Agent failures are seen:** when an API or CLI error ends an agent's turn — a model the account may not use („The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account“), login expired, provider overloaded, network down — the session gets the new status „error“ with what went wrong (from Codex's rollout `task_complete.error`, Claude Code's `StopFailure` hook, else the error line on screen for CLIs without those signals). A red dot, the error on the agent's card and in Mission Control, „1 Fehler“ in the crew frame's header, a notification, and „Als Nächstes“ points at it. A limit stays „rate limited“ with its own recovery.
- **The operator hears about a failed agent once (Pro)** — with the error and a concrete fix (another model / account, log in again, wait and continue) — and asks before acting. One automatic step only when clearly safe: a first turn that failed on the model or the login, with nothing answered and nothing changed in its worktree, moves once to another logged-in account (for a model error the other provider) in the same worktree; its board card and crew frame follow.
- **„Seit du weg bist“ (Pro):** while you are away from the cockpit window the crew keeps working, and one digest says what happened in at most six calm lines, the most important first — an agent stuck on an error, an agent that needs you, a question waiting, red tests or build, „Crew fertig – 2 Änderungen warten auf dich“, „Atlas und Scout sind fertig“, what is new on the boards, who still works (nothing at all: „Nichts Neues, seit du weg bist“). The same lines show in three places: at the top of the phone page (while the remote is on and you are away; gone when you are back), in the welcome-back banner (back after ten minutes or more with news, or at start-up after four hours — a click on a line flies to its cards), and in the „was ist neu?“ / „In 30 Sekunden“ briefing.
- **One push while you are away (Pro):** once you have been away longer than the push minutes in Settings, the digest's news („Crew fertig – 2 Änderungen warten auf dich“, below it „Atlas ist fertig“) go out as one push through the existing push address — each thing once, at most one push every eight minutes, failures and limits as before. Off without a push address; „One short digest while you are away“ in Settings turns it off (then the old „is waiting for you“ push comes back).
- **What changed, as a film (Pro):** „Abspielen“ in the „N Karten neu“ line and in the welcome-back banner — or spoken „spiel ab, was neu ist“, „zeig mir, was sich geändert hat“ — plays only the cards that changed, one by one and close up, in reading order (the newest twelve at most).
- **News dots on the tabs (Pro):** a tab whose board holds cards new since you last looked at it wears a small calm dot (the count in its tooltip, no numbers on the bar); checked when the tabs change, when you come back to the window and every minute, reading only boards saved since you looked.
- **Account health:** an account whose turn failed on the model or the login is remembered (with the message and the time) until a later turn on it answers. For six hours new agents, crew members and reviewers — and the recommended account in „New session“ and the limit failover — go to another account as long as one works (never no choice); the operator's snapshot marks it „avoid“, and when it asked for that provider it hears why it got another. Its card in Accounts says „⚠ Model not available — …“ with the fix (the profile's own `config.toml` `model = "…"` / `settings.json`, never edited by the cockpit) and „Try again“; logging in again clears a login failure.
- **The cockpit's own model per account:** with a model failure the account card suggests another model from the account's catalog — „Use for cockpit sessions“ passes it to every new session on that account that picks no model of its own (agents, reviewers, New session); „Back to the CLI default“ undoes it. Your CLI config stays as it is.
- **The operator's own turn failing is seen (Pro):** it cannot tell you itself — its chat shows a calm bar above the input with the error and the fix („Edit Atlas“ / „Accounts“), and one toast per failure reaches you wherever you are („Open Atlas“).
- **Entity clusters at the farthest zoom (Pro):** zoomed far out (below 30 %), cards that share an entity (a tag or an entity card's name) and lie near each other read as one soft region with one name and a count — „Anthropic · 5 Karten“ — like a map names a region instead of its streets. At most seven, a card in one at most, none that only repeats a frame, no label over a frame's name; a region holding changed cards glows with „N neu“. A click on the name flies there; a double-click on a card from far away flies to it.
- **Zoom into a card (Pro):** „Hineinzoomen“ (the magnifier on a card, Z, „Belege“ on its page, the palette, or spoken „zoom in die Karte …“, „zeig mir die Belege zu …“, „was steckt hinter …“) shows the card large in the middle with its evidence around it — what supports or contradicts it on the left, its sources and quotes above, what it leads to on the right, where else it comes up on the project's other boards below — at most nine pieces, the rest one click away. A click on a piece goes one level deeper (a breadcrumb back; Esc, „zurück“ or „raus“ step back), a piece from another board opens there. Nothing is stored; the board stays as it is.
- **The first five minutes (Pro):** Atlas in one click — while there is no operator, the Assistants page opens with „Atlas – dein Operator“ and „Atlas starten“ (on a logged-in Claude account first, then Codex; „Erst anpassen“ opens the editor as before; without a logged-in account it says so and leads to Accounts). Atlas's empty board says „Probier es“ with three one-click requests that go to Atlas like typed messages — „Erklär mir dieses Projekt als Board“ (with a project folder; in a git repo also what was worked on last) or „Plane etwas mit mir“ (without one), „Mach mir ein Dashboard“ (live accounts, agents, tasks), „Recherchiere mit einer Crew“ — then „Atlas ist dran – gleich erscheint es hier“ until it draws; later empty boards keep the three as small chips. „Kurze Tour“ (also in the board's palette) points in five calm steps at the chat, the board, the crew („Mission“), boards and overview, and „Talk“ — a soft ring and a small card, skippable, remembered. One quiet hint „Lern Atlas kennen“ after the core tour while no operator exists, and one line in the empty workspace. Palette „Erste Schritte wieder zeigen“ brings it all back. Texts follow the voice language (German by default).
- **„Zeig mir, was du kannst“ — a built-in demo (Pro):** one click on the empty board (or in the palette) opens a showcase at zero quota — no agent, no AI turn — as its own workspace „Demo“ next to your boards: „Demo · Recherche“ (three entities, a hypothesis with evidence for and against and a source, the timeline folded), „Demo · Dashboard“ (three KPIs, two charts, a sortable data grid) and „Demo · Crew“ (a finished crew of three — agent cards, their changes with +/− and „Review ✓“, the „Crew-Ergebnis“, the raw results folded). All real cards, calm (5–9 visible per board), every caption saying it is invented example data. A guided film of about 80 seconds plays right away — each board builds itself, the camera glides to what is said, subtitles throughout and the voice when voice output is on; Esc or „Anhalten“ stops it, „Film abspielen“ plays it again. A small bar on the demo's tabs says „Beispieldaten · keine echten Agenten“, and „Demo entfernen“ deletes its tabs and workspace and goes back to the board you came from. Recall, backlinks, the knowledge graph and briefings leave the demo out unless you are in it; demo agent cards show their finished state instead of a terminal.
- **The demo for anyone — by voice, by Atlas, on stage, in English (Pro):** say „Atlas, zeig mir, was du kannst“ / „zeig mir die Demo“ (opens it with its film), „spiel die Demo ab“, „präsentier die Demo“, „Demo anhalten“, „Demo entfernen“ — or ask Atlas, which opens it itself (`{"do":"demo"}`, with „present“, „film“, „stop“, „remove“; never waits for an OK). „Präsentieren“ (on the demo's bar and in the palette: „Demo präsentieren“) plays the film full screen for an audience: every bar and the side panel hidden, the sentence large and calm at the bottom, a quiet progress line with one segment per step, „Esc · Beenden“; at the end a closing card „Das war Robs AI Cockpit — jetzt mit deinem Projekt“ with „Atlas starten“ (the demo goes, you are back on your own board, Atlas wakes — or, without one yet, the Assistants page to meet Atlas), „Nochmal ansehen“ and „Schließen“. With the voice language English the demo is English: „Demo · Research / Dashboard / Crew“ with the same cards, places and timing in natural English, the film's eleven sentences, the bar and the closing card; a demo in the other language is replaced, and the film always speaks the language of the demo that is there.
- **Phone keys that expire:** the phone remote's key now has a lifetime — 8 hours, 24 hours (default) or 7 days, chosen in Settings („Key lifetime“) — and Settings says until when it works („Key valid until Fri 18:30 (in 5 h)“). „New key“ is always there (also while the remote is off) and swaps the key on the running remote without a restart; the old link stops at once. An expired link gets a calm page on the phone, „Link abgelaufen – scanne den QR-Code neu“ (an open phone page switches to it by itself); in its last two hours the phone's header says „Link bis 18:30“. A key from before keeps working for the chosen lifetime from the first start.
- **A view-only link for colleagues (Pro):** „Create view-only link“ in Settings makes a second key with its own QR code — it opens only the open board with the operator's answer, live and read-only: no message line, no agent list, no „Seit du weg bist“. The server enforces it (the key gets the board page and its title only, sending is refused with 403), it expires like yours and „Revoke“ stops it at once.
- **„Seit du weg bist“ on the phone's Board tab too (Pro):** compact at the top of the board (hide with ×; it comes back when something new happens). Tapping a line — there or on the Agenten tab — scrolls the phone's board page to the card it is about (folded chapters open), with a short ring around it.
- **Boards that are laid out, not dropped (Pro):** the operator's new cards are placed by the board's structure (autoLayout.ts) — linked cards as a diagram from left to right (evidence in one column right before the hypothesis it supports, prompts below their step, long chains wrapping into rows), unlinked cards grouped by kind (numbers in a row, charts side by side, sources together) with one size per kind, frames sized to their cards, everything on a 10 px grid in reading order. The user's cards and cards with coordinates never move; „Aufräumen“ uses the same layout. The operator is told to leave out x/y. Cards are as tall as their text (no empty bodies); everything packs into one compact block as wide as the widest part (entities as a context row above the diagram, small groups beside or under it), groups in a row grow so every row ends at the same right edge (a dashboard: numbers, charts, then table and notes). The layout check also names arrows that run through cards.
- **Arrow labels never sit on a card (Pro):** a label stands on its arrow where no card is — nor its buttons above nor its tags below (middle first, then a little before or after), shortened with „…“ when there is no room whole, the full text as tooltip; diagram columns leave room for their labels, and an arrow that skips a column is led around the card standing in it (edgeLabel.ts, also in the operator's picture). The camera keeps every card it follows fully in view, with the cards linked straight to them (a source leading into the evidence) while they stay readable, the hypothesis first when not all fit; a context row sits right on top of the diagram; a new frame around cards already on the board hugs them.
- **Line charts draw their line with „reduce motion“ on**, and the picture the operator sees draws lines, entities as on the board and no text outside a card.
- **„Wann spricht Atlas?“ — one rule for everything the cockpit says (Voice tab → Spoken answers):** „Nur wenn ich frage“ (default) speaks the answers to what you said (Talk, wake word, dictation — including the follow-up round after it read something) and, when something truly needs you (an agent asks for a decision, a failure, red tests after a merge, a watch you set), one short sentence, once; everything else stays silent text. „Wichtiges auch melden“ adds the agents' results (finished, review verdict, crew done) and „Als Nächstes“ in one sentence each, and the welcome-back briefing; „Alles vorlesen“ is the old behaviour. It governs the operator's answers to events and typed messages, answers in a voice conversation, other agents' answers and „braucht dich“ calls, the welcome-back briefing and „Als Nächstes“ (speakPolicy.ts, unit tested). Slides, the demo film, reading a page, reminders and the status report are things you start yourself and speak as before.
- **Eva, a third German woman's voice** (`de_DE-eva_k-x_low`, 20 MB, pinned like every voice), and „Amy · Deutsch mit Akzent“ as a choice for German text with an English voice (Amy reads German herself — understandable, strongly American; she then also says German fillers). Measured with Piper → local Whisper on two German sentences: Kerstin the clearest (stays the automatic choice for Amy, 1.12× higher to match her), Eva close — only names and English words misheard (matched at 1.06×), Ramona more slips; the many-speaker German „mls“ voice was unintelligible and is not offered.
- **Chart labels that never overlap (Pro):** axis labels fit their bar's slot — as they are, on two lines, or at an angle with „…“ (full text as tooltip), thinned out when there are very many; value labels only where they have room; a pie gets a legend of its largest slices and „+n weitere“ (chartLabels.ts, also in the picture the operator sees).
- **The camera comes close when the operator talks about cards (Pro):** cards it names ([[id]] spoken or written, point) are shown together at a readable zoom; new cards are brought into view with readable titles even from far out; a long way steps back halfway and comes close again; after a spoken explanation the camera returns to where you were — unless you moved it yourself (camera.ts).
- **Clearer cards (Pro):** title with what the card is (one calm word; the id only on hover), text clamped to whole lines with „mehr ›“ for the rest, the source under a card („Quelle: …“, a click goes there), the operator's tiny sizes raised to a readable card. The layout check names long titles, untitled cards, cut chart labels, cards in no reading order and cards too small to read.
- **Mute with one click:** a speaker button in Atlas's room header and in the voice bar, Strg+Umschalt+M, or the Voice tab („Stumm“, `voiceMuted`, kept across restarts) silences every spoken output — answers, fillers, callouts, briefings, the presentation. Only the output: everything still arrives as text (the cards an answer cites light up as for a read answer), and the microphone, „Sprechen“ and the wake word keep working, so you can say „sprich wieder“.
- **Tell it how much to talk — spoken or typed in the chat:** „sprich erstmal nicht“ / „sei still“ / „psst“ / „mute“ mutes (one soft sound, no sentence), „du darfst wieder sprechen“ / „sprich wieder“ unmutes („Okay.“), „sprich weniger“ / „nur das Wichtigste“ → „Nur wenn ich frage“ plus short answers (two sentences, `voiceBrief`, „Kurz fassen“ in the Voice tab), „sag mir alles“ / „sprich mehr“ → „Wichtiges auch melden“, „lies alles vor“ → „Alles vorlesen“; English too, also after the wake word („Atlas, sei still“). A toast confirms each change. Only whole short sentences count — „sprich mit dem Agenten über …“ stays a message (speechControl.ts, checked before every other voice command).
- **Never feel a wait:** while it works on what you said, it says what it is actually doing — „Ich suche kurz im Netz.“, „Ich lese gerade bei MDN nach.“, „Ich schau mir den Code an.“, „Ich lass kurz die Tests laufen.“, „Ich baue die Karten auf.“ — from its live tool activity, the first ~2.5 s in, then at most one line every 6–8 s (calmer after 45 s), never the same line twice; only with nothing to report a light filler („Ich bin noch dran.“). It stops the moment the answer starts, and stays silent when muted (progress.ts).

### Changed
- **Card bodies in the calm Board 2.0 look, and a light board (Pro):** every colour of the board is a token now (`--b-*` in `src/index.css`, dark by default, light with the app's light theme — „Hell“ or „Wie Windows“ on a light Windows), and the card bodies, sections, frames, connectors, toolbar, tabs, caption and zoom panels, menus, the command palette, the overview, the reader and the zoom-into view use them instead of fixed `text-white` / dark backgrounds. Charts: bars and line in the one accent, pies in the accent, two tints of it and greys with a hairline between slices (the exported picture uses the same palette), values in tabular figures. Numbers: 32 px, tabular, no gradient or glow. Tables: a header over a hairline, 18 px rows as the layout sizes them, number columns right-aligned, „+n weitere“ instead of half a row. Hypothesis: a thin meter in the accent (green confirmed, red rejected), a small pill instead of the rubber stamp. Choice, search, calculator, code (Xcode colours dark/light), diff, tests, crew list, entity faces, web, topic, watch and the data grid calm too — no neon, no glows; colour only for status and meaning. Text next to a meter, number or picture gets whole lines only (`linesIn`, `tableFit`, `numericColumns` in `pro/src/cardText.ts`).
- **The board's toolbar is a ribbon (Pro):** instead of ~30 unlabelled icons in one row, six named groups — **Hinzufügen** (Gedanken: Notiz, Idee, Frage, Hypothese · Arbeit: Aufgabe, Prompt, Code, Rechner · Von außen: Websuche, Bild, Link, Datei · „Weitere Kartenarten …“ opens the commands) · **Ordnen** (Aufräumen, Rahmen, Thema) · **Zeichnen** (Stift) · **Ansicht** (Alles zeigen, Hinein-/Herauszoomen, Wissensgraph, 3D-Raum, Vollbild) · **Präsentieren** (Präsentation, Film, Kamera folgt, Folien als PDF) · **Teilen** (Mit Agenten teilen, Automatisch teilen, Als Webseite speichern) — with Rückgängig, Wiederholen and Befehle (Strg+K) always in the bar. Hovering a group for a moment (with a grace period on the way into the panel) or clicking it opens a translucent panel: every tool with its name, one line on what it is for and when, and its shortcut; on/off tools show a switch and their group a small blue dot. Keyboard: Enter/Space/↓ open, ↑↓ move, ←→ go to the next group, Esc closes; touch and pen toggle by tap. Narrow boards (below ~720 px, or when the names do not fit) show only the group icons; panels never leave the board. New on the way: „Datei“ (file picker, same cards as dropping files from Explorer), the link field takes a bare domain (`heise.de` → `https://heise.de`), and the palette gained „Automatisch teilen“ and „Kamera folgt“ (`pro/src/BoardToolbar.tsx`, `pro/src/toolbarGroups.ts`).
- **Board look (Apple-quality restyle, Pro):** system font stack, a type scale on an 8-pt grid, cards with 14 px radius, hairline and soft layered shadows, the kind as a small muted sign instead of coloured borders and gradients, calm frames, translucent toolbar and tabs with monochrome icons, quiet card entrance instead of flash/sweep/sparks (reduced motion respected). The board picture (`{"do":"look"}`, slides PDF, overview, saved web page) is drawn in the same look with sections and routed arrows.
- Atlas thinks in sections: the persona tells it to place cards by `"zone"` and open chapters to the right instead of coordinates; the snapshot shows „Sections (left → right)“ and each card's §section; the layout check no longer calls cards in a section „lonely“ and judges crossings on the routed arrows.
- **German is always spoken by a German voice:** „Amy · Deutsch mit Akzent“ is gone from „Deutsch spricht“ (Amy stays for English); with Supertonic installed, German text of an English voice goes to Supertonic Anna / Max first.
- **No card ids in shared board pages (Pro):** „Als Webseite speichern“ and the phone's board page anchor their cards opaquely (by position in the file, salted per run on the phone) instead of by the board's card ids.
- **The phone pages are locked down further:** the phone remote's own pages now carry a Content-Security-Policy too (only their own script, talking only to the cockpit, framing only the board; they cannot be framed themselves).
- **Live cards speak the board's language:** quota, agents and tasks cards say „übrig bei …“, „1 arbeitet · 0 brauchen dich“, „3 warten auf Prüfung“ (English when the voice language is English).
- **A calmer sidebar:** a reviewer leaves the sidebar once its verdict stands on the review card (or another model took over); it stays in History. A reviewer that failed for good stays visible to look into.
- **The phone remote answers only the home network:** requests from addresses outside private / link-local / loopback ranges are dropped, on top of the secret key; the board page is served with a strict Content-Security-Policy (no scripts, inline pictures only).
- **Live pages sleep:** a page out of sight for two minutes is closed to free memory — its card keeps its last picture and it opens again when you look.
- **Spoken answers skip the report lines:** „Done: … / Verified: …“ stay in the chat, only the next step is read aloud.
- **A dashboard rebuild keeps your own cards** (only the operator's cards are replaced).
- **Moving a card no longer counts as changing it:** dragging, resizing or putting a card in a frame keeps its time, so „new since you last looked“ (the overview's tiles, the glow, the briefing) means what really changed; cards a source refresh redraws unchanged keep their time too.
- **A click into a page on the board is not leaving:** the board's focus going to a docked web page no longer counts as being away (the cockpit asks whether its window is still in front); leaving the window from inside a page, and coming back to it, are still noticed.
- **Calmer first states (Pro):** the operator's empty chat says in one sentence what to do and how to start (asleep: which button wakes it); starting the operator speaks the voice language („Leg zuerst Atlas an“ with „Atlas anlegen“ instead of „Create an operator first: Assistants → New assistant → Role: Operator“, „Atlas ist da“, „Atlas konnte nicht starten: …“ instead of a bare error).
- **One language in Atlas's room (Pro):** the room, Mission control and the board speak the voice language — German by default, English when the voice language is English — instead of mixing both: header „Missionszentrale – sag, was du brauchst, Atlas verteilt die Arbeit an deine Agenten“, status chip „Bereit / Arbeitet / Wartet auf dich / Schläft“, „Aufwecken“, „Sprechen“, „Im Arbeitsbereich“, the chat input, permission bar („fragt“, „Ja / Nein“), action receipts („Auf das Board gezeichnet (3)“, „claude-Agenten im eigenen Worktree starten: …“), Mission control's log, memory and reminders, the operator's toasts and review cards („Review läuft …“), the board's toolbar and card tooltips, the hint line at the bottom, the palette (groups, labels, „Notiz hinzufügen“), the caption panel, the zoom control and the live cards. What goes *to* the operator (results, events, declined actions) stays English for the model; the chat shows „Ergebnisse zurückgemeldet“ / „Neues von deinen Agenten“ in its place. The smoke test clicks the board's buttons by either language's title.

### Fixed
- **Touchpad pinch never reached the board:** Tauri/wry ties WebView2's pinch zoom to the zoom hotkeys, and with those off a precision-touchpad pinch was dropped before the page — now the window's zoom is on (the pinch arrives as Ctrl+wheel and zooms the board) while the app itself never scales: every Ctrl+wheel and Ctrl + / − / 0 is cancelled app-wide, touch pinch outside the board is blocked by `touch-action`. Verified with a synthetic touchpad pinch (board 70 % → 106 %, app scale unchanged).
- **A new question stops the old answer being read aloud;** the „Atlas bereitet vor“ placeholder never covers cards or section headings; arrow labels like „then“ / „dann“ are gone; a frame's description sits in its head instead of loose under it; tags and „↗ other boards“ show only when you look at a card; a task shows one circle (its state), not two; card titles get the full width (kind and id appear on hover).
- **German where the room is German:** chat times („gerade eben“, „vor 5 Min.“), built-in personalities show a German subtitle instead of the model instruction „You are calm …“, the expired-trial message; the room offers „Pro holen“ instead of a wake button that cannot work. The operator's snapshot names the tasks in review (it had only a count).
- **Board zoom that always works (Pro):** a touchpad pinch zooms around the fingers 1:1 and smoothly (all events of a frame applied together — before, every wheel event re-rendered the board), Ctrl/Alt + mouse wheel zooms a calm ~20 % per notch, two fingers and the plain mouse wheel move the board (Shift: sideways) — a fast two-finger swipe was misread as a mouse wheel and zoomed. Over cards, the caption panel and toolbars the board keeps the gesture; a card body or panel that can still scroll scrolls first and a gesture stays with whoever took it (no jumping); overlays (reader, overview, palette, zoomed-in card) scroll themselves without moving the board underneath. A pinch over a page docked on a card zooms the board (the page hands back its pinch and the moves it cannot scroll through WebView2's own message channel, no Tauri IPC); other pinned pages step aside while zooming. Camera flights give way to your fingers, a lost touch no longer blocks the next pinch, + / − / 0 work in full screen (they did nothing there), Ctrl + / Ctrl − zoom the board, the app's own page zoom is off for the window and docked pages. Pure, tested gesture math in `pro/src/gestures.ts`; a one-time hint „Zwei Finger: verschieben · Zusammenziehen/Spreizen: zoomen“.
- **Opening the demo leaves a workspace of yours called „Demo“ alone:** the demo tabs then open without their own workspace instead of replacing its tabs.
- **A reviewer that is still working is not cut off at 8 minutes:** the 8-minute limit applies to a silent reviewer; one that visibly works gets up to 20 minutes before another model takes over.
- **A crew merged one by one closes too:** when the last change of a crew is taken over with its own „Übernehmen“, the tests run on the main tree and the dashboard folds — as after „Alle übernehmen“.
- **Full screen really is full screen:** the board's full-screen mode (and the demo's presentation) carried both `relative` and `fixed`, and the stylesheet order let `relative` win — the board stayed in its box with the sidebar and chat around it. Now only one is set; the stage header and the demo bar count as top bars for the camera, and the stage subtitle sits above the voice pill.
- **„Show everything“ keeps the cards in the open:** fitting the board now leaves out the caption panel (cards go beside or above it, whichever shows them larger) and any bar under the tabs (e.g. the demo's) — before, a frame's last card or its title could sit hidden underneath.
- **The demo film's subtitle no longer vanishes mid-sentence:** with a slow voice a sentence could outlast the board's 9-second subtitle; it now stays until the sentence is spoken.
- **A crew frame's tooltip names its members by their card** when their sessions are gone (after a restart), instead of a session id; a diff card that was never read from a folder no longer offers „↻ refresh“ (it would have emptied the card).
- **Crews after a restart:** members without a running session count as done when their result card stands, otherwise as stopped — the header says „2/2 beendet · 2 gestoppt“ instead of a false „alle fertig ✓“ (before, every crew showed „0/2 fertig“ forever after a restart).
- **Reviews cut off by a restart no longer hang:** a review card still "running" when the app starts (the review chain lives in memory) says „Review unterbrochen“, blocks „Alle übernehmen“, and „Neu prüfen“ starts it anew.
- **Claude agents took your messages for foreign text:** the cockpit handed messages to Claude Code as a paste, which Claude Code now wraps as `<pasted_content>` — and the model then asked for an OK instead of doing what you said (seen live). Messages are now typed in small bursts (line breaks as Alt+Enter), so they arrive as your own words; Codex still gets a paste.
- **A new agent's task got lost in Claude Code's "Claude in Chrome extension detected" question:** the cockpit now waits for that dialog and answers it with the default (browser tools stay off, `/chrome` turns them on), then sends the task (seen live with a worktree agent).
- **No review of nothing:** an agent that finished without any change (e.g. stopped on an error) is not reviewed forever — the operator is told what happened and proposes the next step.
- **One sidebar entry per assistant:** when an assistant gets a new session (new persona after an update, another project), its old stopped session steps aside (it stays in History).
- **The operator would not start** once its persona outgrew the Windows command line (32 767 characters, „CreateProcessW failed“): long system prompts now go to the CLI as a file (`--append-system-prompt-file`).
- **A failed turn counted as finished:** an agent whose turn ended in an API error went to „review“ and a review of nothing started; now its task stays open and nothing treats it as done.
- **A review hung at „Review running…“ forever (Pro):** a reviewer that fails (model not available, limit, crashed CLI) is noticed, and the review moves once to the other provider; when there is none — or the second one fails too — the card says „Review nicht möglich“ and the operator asks whether to merge. A silent reviewer is given up after 8 minutes on a clock (before, only a session change could notice it).
- **„Anderes Konto“ said „läuft jetzt auf …“ when nothing was restarted (Pro):** when the move to another account fails (the worktree cannot be read, the new session does not start), the card's button now shows the error instead of a success toast.
- **The demo never touches a board of yours that shares a demo tab's name (Pro):** a tab you called „Demo Crew“ or „Demo Research“ lands on the same scope as a demo tab — opening the demo overwrote it and „Demo entfernen“ deleted it. The demo now replaces or deletes only its own boards (its tab title or its „Demo mit Beispieldaten“ caption) and otherwise asks you to rename the tab.
- **Phone remote turned on twice in a row stayed off:** a second start on the same port (a quick off/on, React's dev double-start) failed with „Port … is not available“ while the old listener still held the port, and left the remote off. Stopping now waits for the old listener, and starts and stops run one at a time.
- **Phone remote: an endless request no longer grows memory:** a peer in the network that sends a request line without end gets „400“ once the request exceeds ~260 KB, instead of being read into memory until the 10-second timeout.
- **The cockpit no longer presses Esc into a Claude session because of output that quotes the Chrome dialog:** the "keep browser tools off" answer is given only when the dialog's own option line is on screen — not when the phrase appears in a grep, a file or an answer (Esc interrupts a working Claude turn).
- **A failed turn on Claude Code below 2.1.295 looked finished:** those CLIs have hooks but no `StopFailure`, so an API error ended the turn without any hook and the on-screen error was ignored while hooks reported state. The monitor now remembers per run whether `StopFailure` is registered; without it the error line on screen counts unless a later hook shows the turn went on (newer CLIs are unchanged).
- **A Claude API error could show the previous answer as its message:** a `StopFailure` without text fell back to the transcript's last message, which may be the last successful answer; it is now used only when it is the API error itself, else „API error (rate_limit)“ etc.
- **Messages typed into Claude Code no longer open its menus:** a message starting with `#` (memory), or with `/` that is not a slash command (a path, a heading), gets a space in front; a line ending in an `@` word gets a space after it, so the Enter sends instead of picking a file suggestion. A slash command you type (`/compact`, `/review …`) still runs.
- **„übernommen · Tests laufen …“ no longer sticks after a restart (Pro):** a crew's test run after „Alle übernehmen“ that was cut off by a restart shows „Tests ?“ (result unknown) and the dashboard folds as it would without tests.
- **The phone could show an older board (Pro):** two overlapping pushes of the live board raced; they now run one at a time, with one more run afterwards, so the newest board always arrives last.
- **„Demo entfernen“ dissolved a workspace of yours called „Demo“ (Pro):** it removed any workspace of that name; now only the demo's own one (all of its tabs are demo tabs).
- **Addressing Atlas by name works while a conversation is open:** the wake word was paused for as long as a voice conversation existed — also while the microphone was closed because Atlas was thinking or waiting for results — so „Atlas, …“ went unheard until the conversation ended. It now pauses only while the cockpit records or speaks.
- **„Atlas?“ — „Ja?“ no longer ends up in your sentence:** after the bare name the microphone opened 650 ms later while „Ja?“ was often still playing, so it calibrated on (and transcribed) its own voice; it now opens right after „Ja?“ has been played.
- **The microphone no longer reopens after news nobody asked for:** in a voice conversation it listens again after an answer to you (or a question for you), not after the operator reported an agent's result — that is what made it hear the room and drop to „Standby“ again and again.
- **One dictation no longer makes an agent talk forever:** answers were read aloud for the last session you ever dictated to, including later typed turns; now only the turn you started by voice is answered aloud.
- **Review cards while a reviewer starts (Pro):** a replacement reviewer's card was briefly labelled „Review unterbrochen“ while it started, and a review that found no reviewer left its card marked as starting (so a later interruption went unnoticed); both fixed.
- **Atlas starts fast and asks before switching up (Pro):** with „Schnell starten“ (Atlas editor, on by default; an explicit model still wins) Atlas starts on Haiku (`haiku` alias). For a crew, research across many sources, code/architecture or a long document it asks in one sentence („Für das hier würde ich auf Opus wechseln – gründlicher, aber langsamer. Wechseln?“, action `{"do":"model","to":"opus"}`). That question always waits for your Ja/Nein, whatever „Frag mich vor“ is set to. On yes its session restarts with `--model opus --resume`, so the conversation is kept. This avoids `/model`, which Claude Code saves as the account default for every new session. After a big task Atlas proposes going back down; if Atlas sits idle for 10 minutes on a bigger model, the cockpit proposes it too. The room header shows the model („Haiku · schnell“), and you can click it to choose another.
- **Something on screen at once (Pro):** when you send Atlas a request, the board shows a calm placeholder „Atlas bereitet vor: …“ in the same frame. It sits where the cards will land, shows the live activity („liest store.ts“, „sucht im Netz: …“) and is replaced as soon as the first card lands. It is never a card, never saved and never part of Atlas' snapshot. What Atlas has already said in the running turn appears as a live caption in the chat, and its activity there is in German.

## 0.4.0, first part (2026-10-05, released together with the above)

### Added
- **Natural fillers while it thinks:** the acknowledgement now comes in the *answering* voice (same speaker, same effect, a touch quicker and softer) instead of the deep robot callout voice. When the answer takes longer it says a little more — “Moment.”, “Hm, ich schau kurz.”, “Ich bin noch dran.”, “Dauert noch einen kleinen Moment.” — at ~6 s, ~15 s, then every ~20 s, slightly irregular, never the same twice in a row, rotating through all phrases. Worded for a question (“Gute Frage.”) or a task (“Mach ich.”), shorter for agents that usually answer quickly and longer for slow ones (learned per agent), in the language of the voice (an English voice says English fillers). Only sounds Piper really pronounces (“Hm”, “Öhm” — not “Hmm”/“Mhm”/“Ähm”, checked phoneme by phoneme and by listening back with Whisper). Voice tab → “Keep me posted while it thinks”.
- **The knowledge graph (ontology) under the boards:** arrows now carry meaning — *leads to, causes, depends on, part of, supports, contradicts, example of, source of* — each with its own colour and stroke; sparks flow along “leads to”, “causes” and “source of”, a ⚡ marks a contradiction; click the middle of an arrow to say what it means. Cards carry entities (`#tags`); when an entity also appears on another board the card shows “↗ 1 board” and a click takes you there. The **knowledge graph** view shows every card of every board of the project as one living, force-laid-out constellation — boards in their colours, entities as glowing hubs that link cards across boards, relations in their colours, hover for neighbours, click to jump to the card. The operator sets relations and tags, sees the main entities in its snapshot, and can **recall** (`{"do":"recall"}`) across all boards before researching again. Verified live: Atlas built “Backend-Entscheidung” with 12 typed relations and tagged cards; asked “Was hatten wir zu Performance und Rust?” it recalled “bis 7×” and “Kernlogik in Rust” from another board and linked them in; the graph showed 25 cards and 7 entities over 3 boards.
- **Cards the operator puts on top of each other move apart** by themselves (the shorter way), so guessed coordinates never hide a card.
- **What an agent changed, right on the board:** when an agent working in its own worktree finishes a turn, a *Changes* card appears next to it — the files with added / removed lines as bars, a click shows the patch in colour (green / red), ↻ reads it again. Also by the operator: `{"kind":"diff","path":"…"}`. Verified live: plan → prompt → agent in a worktree → result → “Changes · greet.py +7/−0” with the patch → the automatic review started.
- **Build live:** a live card shows whether the project builds and how long it takes, over time (`{"do":"build"}`; npm/pnpm/yarn `build`, `cargo build`, `go build`), the failing output goes back to the operator.
- **The operator picks the shape:** a plan becomes a timeline, work in progress a kanban, a topic a mind map — without being asked.
- **Frames in a shape:** any frame shows its cards as a *timeline* (left to right in the order of the arrows, alternating around a glowing axis), a *kanban* (columns by status with heads and counts — or by kind), a *mind map* (the first card in the middle, branches to the rest) or a *grid* — one click in the frame's head, or the operator with `{"op":"arrange"}`. New cards in such a frame are arranged with the others, and a frame that grows pushes other frames and loose cards out of its way. Verified live: kanban and mind map by click, “Zeig den Release-Plan als Zeitleiste” by Atlas.
- **Voice on the board:** the operator knows where each card lies (left / right, top / bottom) and which cards are on your screen, so “die zwei Notizen unten links: pack sie in einen Rahmen” works (verified live). Short board commands work at once without the AI: “Stift an / aus”, “zeig das ganze Board”, “näher” / “weiter weg”, “aufräumen”, “Licht aus”.
- **Live tests on the board:** the cockpit finds how a project tests itself (npm / pnpm / yarn, Cargo, pytest, Go), runs it (button on the card, or the operator with `{"do":"test"}`) and a live card shows green / red, passed / failed, the time and the last runs; the end of the failing output goes back to the operator. Verified live: a pytest project with one wrong test → “1 failing · 2 passed · 1.4 s”, Atlas named `test_wrong` in `tests/test_calc.py:10` and put the cause next to the card.
- **Real pages on the board:** PDF pages rendered with pdf.js and PowerPoint slides exported by PowerPoint itself (read-only, hidden, cached per file version; PowerPoint is only closed again when it was not running before) — large on the card, turned with arrows or by the operator (`"page"`), the card takes the page's shape. Verified live: 3 slides exported in 2.6 s (then from the cache in 1 ms), PDF and slides turned to page 2 and 3.
- **Board sounds:** soft pops when cards land, a pen scratch when the operator marks something, a shimmer for the spotlight, a whoosh when a page turns (Voice tab → “Board sounds”).
- **Boards complete themselves when opened:** file, data and search cards that were saved without their preview load it when the board opens (before, only newly added cards did).
- **Drawing on the board:** the operator sketches freely — flows, architectures, mind maps, little illustrations — as SVG that draws itself stroke by stroke (a strict filter keeps only drawing elements: no scripts, links, images or foreign content; ids made unique per card). You draw too: the pen (P) puts ink on the board. Verified live: Atlas drew “Quellcode → Compiler → app.wasm → Browser” with labelled arrows in 25 s.
- **Gestures:** circle cards with the pen and a menu appears — *explain*, *summarise*, *give to an agent*, *frame around* (verified live).
- **Crew rooms:** `{"do":"crew"}` sends up to five research agents off side by side on one topic (they read, search the web and report; they change no files — works in folders without git), each in a “Crew” frame with its sub-question; when all are done the operator consolidates their findings in the “Ergebnis” frame. Verified live with “Rust vs Go für CLI-Tools”: two agents with speech bubbles, then decisions, a big number “bis 7×” in a pen circle, a benchmark table, contradictions as questions and “Wie weiter?”.
- **Live numbers:** stat and chart cards bound to the cockpit — quota per account, agents working / needing you, tasks, context — update by themselves (verified live: Claude A 36 %, Codex 14 %).
- **A taken card id no longer misdirects arrows:** when the operator names a new card with an id that exists, the card gets a fresh id and the rest of that batch (arrows, frames, marks) follows it — found by Atlas itself in the crew test.
- **Named workspaces (Pro):** tabs grouped under a name (“mach daraus ein Projekt Marketing”) — a calm switcher next to the tabs (name + menu: all workspaces, “Neuer Bereich”, “Tabs zuordnen”); the tabs row and the overview show only that workspace, new tabs join it, and it remembers which tab was open (also after a restart). Kept per project under its own board scope, never shown as a tab. The operator makes and opens them (`{"do":"workspace","name":…,"tabs":[…]}` / `{"open":…}`) and sees them in its snapshot.
- **Dashboard on demand (Pro):** “mach mir ein Dashboard zu …” — the operator only gives the content (`{"do":"dashboard","topic":…,"kpis":[…],"charts":[…],"tables":[…],"live":[…]}`) and the cockpit lays out its own tab “Dashboard · …” as a tidy grid: KPI cards in a row on top, charts in two columns, tables full width, live cards (agents, tests, build …) in their place, a caption.
- **Data grid (Pro):** the data card is now a calm spreadsheet — sticky header, columns that know their type (number, %, €, date, year — guessed from values and names, changeable per column), click a header to sort (dates as dates, empty cells last), quick search, column menus with value filters, number ranges, “Gruppieren nach …” and the sum / Ø / min / max, smooth with hundreds of rows (only the rows in sight are drawn). Double-click a cell to edit (Enter saves, Esc cancels, Tab moves on), add and remove rows — all undoable, and the operator sees that you edited by hand. One click makes or updates a linked chart card (“als Diagramm”), another saves the current view as CSV next to the project (or downloads it). Double-click the card opens the grid large. The operator gives formats, search, ranges and read-only in the view and changes a grid in place without resending it (`{"op":"cells","append":…,"set":…,"remove":…}`); its snapshot shows columns with types, the view and the first rows.
- **The crew works on the board (Pro):** drag any card onto an agent's card — it lights up (“Let go — Scout takes it”), the agent gets the card as its next task with the board context, an arrow “zugewiesen” shows who has it, the task goes doing → done and the result lands next to it (verified live). Every card can send a fresh agent off (“Agent”), agents show their own words as speech bubbles over their card, and the operator consolidates what its crew found.
- **Ask the operator about a card:** “Atlas” on any card → type what it should do → the card shows *sent → the operator is on it → answered* and the answer appears right next to it with an arrow (verified live).
- **Choice cards:** the operator asks on the board (“Wie weiter?”) with buttons; your click comes back to it and it carries on (verified live in 16 s).
- **Data cards, Power BI-like:** a dataset from the operator (rows, objects or CSV) or from a CSV/JSON file — filter chips, grouping with sum/avg/count/max, sorting by clicking a column, table ↔ bars ↔ line ↔ pie, totals; the operator steers the view with `{"op":"view"}`. Verified live: an operator-built sales dashboard filtered on EU as bars by month, and a dropped CSV turned into a data card with Σ and ø.
- **Calculator cards** (formulas line by line with names, %, k/M and functions — a small parser, no eval), **web search cards** (DuckDuckGo results on the board, one click pins a result as a web card), and **real files as cards**: pictures show the picture, text/Markdown/code/CSV their content (“As data”), PowerPoint its thumbnail and slide titles, Word its text, PDF its pages; cards size themselves to what they show.
- **Cards glide** to their new place when the operator moves or regroups them.
- **A render error stays in its card:** error boundaries around every card, the board and the app — a broken card says so, the rest keeps working (before, one bad card could blank the whole window).
- **The board feels like magic (Pro):** cards the operator conjures materialise out of light and blur with a flash of their colour, a sweep of light and sparks — one after another in the order it explains them; arrows draw themselves after their cards; its hand leaves a comet trail of glowing dots; a slow aurora runs over the board while it works; between slides the slide's title appears large in the middle and makes way. Everything is CSS/SVG and stands still with “reduce motion”.
- **New tools for the operator:** *chart* cards (bars grow, the line draws itself, the pie opens), *stat* cards (one big number that counts up), *table* cards (rows slide in), a **pen** (`{"op":"mark"}` — circle, underline, check, cross, star, question, drawn stroke by stroke) and a **spotlight** (`{"op":"spotlight"}` — these cards stay bright, the rest steps back; Esc ends it). While presenting, the slide's cards are lit automatically. Charts, numbers and tables also appear in the board picture, the PDF, `BOARD.md` and the slide narration. Verified live: asked for “Wasm vs JS”, Atlas built a big number in a pen circle with the spotlight on it, a bar chart, a comparison table, an underline and a star in 20 s.
- **Slides from documents:** drop files from Explorer onto the board — they become cards where you drop them (“Make slides from it”); file, web and video cards have a **Slides** action: the operator reads the source (PDF, Markdown, a page …), builds its own board (a frame per chapter, key points, numbers as stat/chart, comparisons as tables, quotes, open questions, pen marks on the two most important points), links it from a topic card and presents it. Verified live with `docs/VISION.md`: 31 cards in 6 frames, presented.
- **Reminders at slides:** “erklär mir das morgen nochmal” — the operator sets `{"do":"remind"}` (in 2h / at 09:00 / an ISO time) at the board and slide that are open; at that time you hear it at a quiet moment and “Zeig's mir” opens the board right at that slide. Listed (and removable) in Mission control; the snapshot now carries the date so “tomorrow” works. Verified live: “Erinnere mich morgen um 9 Uhr …” → reminder for 07.10. 09:00.
- **Thorsten Emotional:** a German voice with moods — “Auto” whispers at night (22–7 h), sounds friendly for good news (“Fertig”, “grün”, “done”) and neutral otherwise; or pick one (neutral, friendly, whisper, surprised, sleepy) in the Voice tab. Measured: the whisper style is half as loud and breathy, as it should be.
- **Faster voice:** up to three Piper engines stay loaded (answers, fillers and callouts use different speeds and voices — each switch used to restart Piper and reload the model). Warm: 0.1 s per sentence.
- **Frames wrap their cards in every direction** (also to the left and up), cards of different sizes in a frame no longer land on top of each other, and frames the operator builds are moved apart when they would run into each other. The layout check now reports frames overlapping and cards lying in a frame they don't belong to, instead of false alarms.
- **Big answers are no longer cut:** the live view kept only 6,000 characters of the last answer, so the action block of a large board (from a document) was lost; it now keeps the whole answer (the timeline still stores an excerpt).
- **Presenting on its own:** in a voice conversation the presentation goes on by itself — after each slide it waits 4.5 s for your question, then shows the next one (or, when the operator presents, asks it to explain the next slide); “warte” stops that and keeps the slide, “weiter” moves on, at the end it asks “Noch Fragen?”. Toggle in the slide bar.
- **Slides as PDF (Pro):** one page per slide (overview first) with title, page number and the board's name, drawn sharp from the board without the internal card ids, saved as `.cockpit/<board>.pdf` and opened (Shift+click: only save) — also by the operator (`{"do":"pdf"}`). Written by a tiny built-in PDF writer, no library.
- **More and better voices:** Thorsten HD (the most natural German voice, high-quality tier), Ramona (German, female), Cori HD and Lessac HD (English, female, high quality) and Jenny (British, female) — all pinned by SHA-256 like the others. Verified: Thorsten HD downloads in 11 s and speaks.
- **Pitch per voice:** higher or deeper at (nearly) the same speed — Piper speaks slower and the sound plays faster, so the pitch moves but the tempo stays. In the Voice tab (“Pitch”) and per assistant next to its voice and effect.
- **Codex talks while it works, too:** its own “commentary” messages from the rollout (“Ich prüfe kurz die Tests.”) are spoken at once in conversations, like Claude's interim sentences.
- **Slides (Pro):** the board as a presentation — the overview first, then every frame (or every step with what hangs below it) as a slide. The camera glides to the slide's cards, a bar at the top shows where you are, and it can tell you what is on each slide, with each card lighting up and subtitles while it is mentioned. Keys: ← → / Space, Home, Enter (go deeper), Esc. By voice: “präsentier das Board”, then “weiter”, “zurück”, “nochmal”, “tiefer”, “von vorne”, “Ende”. “Tiefer” goes into the slide's topic card and presents that board; an empty one the operator fills first. The operator presents as well (`{"do":"present"}`): verified live with Atlas — start and first slide explained after 12 s, “Nächste Folie bitte” after 8 s, the camera on the slide and its cards glowing while it speaks.
- **“Warte” and “weiter”:** interrupt an answer (barge-in or your dictation key) and say “warte” / “Moment” — it stays quiet and keeps the rest; “weiter” continues from the sentence it stopped in (for ten minutes). Anything else you say starts something new. Sentences are no longer cut at dots inside words (“.wasm”, “1.2”).
- **It talks while it works (M17):** in spoken turns agents now say one short sentence before they start reading or researching (“Ich schau kurz im Netz nach.”). The cockpit picks that sentence out of the transcript the moment the tool starts and speaks it in the agent's voice — measured live with Atlas: first own words after 6.0 s instead of silence until the answer at 39 s. The final answer waits until that sentence is finished instead of cutting it off.
- **Fillers that say what it is doing:** when nothing else was said for a while, the live tool activity becomes a sentence — “Ich lese gerade bei MDN nach.” (MDN, GitHub, Wikipedia … by name), “Ich suche kurz im Netz.”, “Ich schau mir den Code an.”, “Ich schreib gerade am Code.”, “Ich hab einen Helfer losgeschickt.” — each only once per answer, never right after its own words; the timed “Moment.” steps back while it reports.
- **The operator sees its board (M19):** `{"do":"look"}` draws the board as a picture into the project (`.cockpit/board.png`) for the operator's Read tool; every snapshot carries a *layout check* (cards on top of each other, cards out of their frame, crossing or board-wide arrows, lone cards, a sprawling board). Verified live: Atlas looked at a deliberately messed-up board, regrouped it into two frames with straight arrows, looked again and confirmed nothing overlaps.
- **Voice tab**: everything about talking to your agents in one place — who the shortcut talks
  to, sending, pauses, the AI's voice, spoken answers, signals, the spoken commands and a voice log.
- **Natural neural voices**, offline: Piper voices (German: Thorsten, Kerstin; English: Alan,
  Ryan, Amy) are downloaded on request and verified by checksum. Answers are synthesised sentence
  by sentence (first sentence in ~0.1–0.6 s); the orb pulses with the voice.
- **Voice effects**: Natural, Jarvis (crisp with a little room) and Robot (ring-modulated).
- **Sci-fi signals and spoken callouts**: chirps, a whoosh when something is sent, chimes when an
  agent is done, plus short robot callouts (“Gesendet.”, “Standby.”); classic beeps or off.
- **Dictation sends by itself**: after you stop talking the text goes out after a short countdown
  (Esc keeps it typed but unsent, Enter sends at once); “only type it” is still available.
- **Spoken answers by default** for the agent you just talked to; optional announcements when the
  other agents finish or need you.
- **Conversations go to standby** when nobody speaks for a while; “Tschüss” ends them.
- New spoken commands: “Status” / “Was ist los?” (instant spoken report of all agents),
  “Fenster 2 vorlesen”, “Fenster 2 weiter”, “Antworten aus / an”, “Neuer Agent”, “Zeig Sprache”.
- **Operator (Pro)**: an assistant role that steers the whole cockpit — your own Jarvis. It sees a
  live snapshot of agents, accounts and tasks with every message, starts agents (in their own
  worktree, on the account with the most quota left), hands out work, reads results, watches the
  agents it dispatched and tells you by voice when they are done. Stopping agents and work outside
  a worktree wait for your “yes”. The main voice shortcut can talk to it hands-free.
- **The board (Pro)**: the operator's visual world, shared with you — an endless canvas per
  project with notes, ideas, steps, ready-to-run prompts, code, files, questions, decisions, frames
  and arrows. Ask “Erstell mir einen Plan für …” and the operator draws it while it talks (cards
  write themselves, arrows draw in); steps run left to right, each prompt hangs below its step.
  You drag, write, connect and select on the same board; the operator reads all of it with your
  next message, so the board becomes the project's shared context. “Run” on a prompt starts an
  agent in its own worktree, which appears as a live mini terminal with an arrow from its prompt.
- Board: **pictures** (paste a screenshot with Ctrl+V or upload one), the operator **points** at cards
  while it explains (they glow), and **“Share with agents”** writes the plan to
  `.cockpit/BOARD.md` in the project (Markdown with a Mermaid diagram; optionally kept up to date).
  “Run” on a prompt gives the agent the board context around it: goal, earlier steps, decisions and
  open questions.
- **Living board (Pro)**: cards of agents follow them — their step turns “doing” when the agent
  starts and “done” when it finishes, with its answer pinned as a result card.
- **Presenting (Pro)**: when the operator explains the board, the card it talks about glows exactly
  while that sentence is spoken.
- **Decide by voice (Pro)**: an agent's permission question reaches the operator with its options
  (“Datei-Agent möchte cockpit-ok.txt anlegen — erlauben?”); your “yes” answers it in the agent.
- **Several boards per project (Pro)**: Plan, Architecture, Ideas… as tabs; the operator can open
  or create them.
- **Review chain (Pro)**: when an agent the operator started in a worktree is done, the project's
  tests run and a second model reviews the changes (Codex reviews Claude and the other way round;
  if one fails, the other takes over). The verdict lands on the board and the operator asks you
  whether to merge — “yes” merges.
- **Wake word**: say the operator's name — “Atlas, wie ist der Status?” — anywhere, without a key.
  A light voice detector listens; only the start of an utterance is checked by the local Whisper,
  and the rest of the same breath becomes the command. Off by default (Voice tab); paused while the
  cockpit speaks or records; other sentences that merely contain the name do not wake it.
- **Interrupt it by talking**: in a conversation the microphone stays open while it speaks; when
  you start talking it stops at once and your words (from the first syllable) are the next
  message. Its own voice coming back from the speakers is filtered out.
- **No dead air**: the moment your sentence goes out it acknowledges (“Bin dran.”), and a
  “thinking” bar shows what it is doing until the answer comes.
- **“Welcome back” briefing**: after 10 minutes away, a short spoken summary of what the agents did
  — only if something happened.
- **The presenting board (Pro)**: the operator answers every question on the board, like a teacher
  with a whiteboard — it researches with its web tools and pins **web cards** (the page's picture,
  summary and source fill themselves), **pictures** from the web, **videos** that play right on the
  board (YouTube / Vimeo), code, and **topic cards**: doors to a deeper board with a way back. While
  it talks, the **camera glides** to the card it explains, its **cursor** moves across the board and
  **subtitles** show what it says. `zoom` moves the camera like slides.
- Board interaction: two fingers move, pinch zooms (touchpad), the wheel zooms at the pointer;
  smooth camera; double-click opens a card large (reader) or goes into a topic, F zooms to the
  selection; paste a link to add a web or video card.
- The operator can end the voice conversation itself (“ich schau mir das erstmal selbst an”).
- Wake phrase: set your own (“Hey Atlas”, “Computer”…) and test it with a button.
- **Memory (Pro)**: the operator keeps notes of lasting preferences, decisions and conventions
  (“Before every merge, show the test results”) across sessions; see, add and delete them in
  Mission control.
- **Ambient orb**: while the cockpit is in the background, a small orb bottom right shows the
  crew at a glance — blue breathes while agents work, amber pulses when one needs you, green when
  all are done, red on limits or errors. Hover for the list, click to open the cockpit.
- **Personality dials (Pro)**: humour, brevity and initiative as sliders, written into soul.md.
- **Undo on the board (Pro)**: Ctrl+Z / Ctrl+Y or “rückgängig” takes back any change — yours or
  the operator's.
- **Speaks up at a pause**: reports outside a conversation wait until you stop typing for a moment
  (in any program), at the latest 45 seconds — interruptions at a breakpoint cost the least.
- Conversations end a spoken sentence after 0.9 s of quiet (was 1.5 s).
- **“Mhm” while you talk**: a soft hum in your breath pauses during longer sentences shows it is
  listening.
- **It learns when to speak up**: cutting a report short makes it wait for a longer pause next
  time; listening to the end makes it bolder again (2–10 s).
- Agents started by the operator run even when every pane is taken (no pane dialog in between).
- Spoken answers show as a slim bar at the bottom instead of covering the screen.
- **Hypotheses on the board (Pro)**: the operator thinks out loud — a hypothesis card with a
  confidence bar that glides as evidence flows in (supports / contradicts arrows; measured facts
  weigh more than ideas, examples and estimates count half, red tests count against), “+12” floating
  up, and a stamp “bestätigt” / “verworfen” once two pieces of evidence decide it.
- **Watches (Pro)**: “wenn Agent X fertig ist / die Tests rot werden / die Aufgabe erledigt ist,
  dann …” as cards — breathing while armed, ringing when they fire; the board points at what they
  mean and the operator carries out their “then”. Re-arm with one click.
- **One undo per operator answer (Pro)**: everything the operator does to the board in one answer
  is one step for Ctrl+Z / “rückgängig”.
- **Command palette (Pro)**: Ctrl+K or “/” on the board — every tool, new card, watch and card on
  the board by name; whatever matches nothing goes to the operator as a request.
- **Semantic zoom (Pro)**: zoomed out, cards become their titles (big enough to read) and frames
  carry their name above them like places on a map; closer, the full content returns.
- **Code as a board (Pro)**: “wie ist das Projekt aufgebaut?” — the operator scans a folder
  (`{"do":"map"}`, or “Code als Architektur-Board” in the palette) and draws its architecture: a
  card per module (files, lines, language, entry points, biggest files), depends-on arrows weighted
  by the imports that cross (×12), laid out in layers — what starts things on top, the foundation
  at the bottom, import cycles cut on their light side — and the libraries it builds on. Imports
  are read for TypeScript/JavaScript (incl. aliases), Rust, Python, Go, C/C++, Java/Kotlin/C#.
- **The board as a space of understanding (Pro)**: “Was du siehst” — a caption written by the
  operator, a legend that builds itself, the chapters in reading order; **looks** the operator
  picks: an investigation wall (cork, pinned cards, sagging red strings) or a storyboard (film
  frames, big chapter numbers); **entity cards** (people, organisations, technologies, events …)
  as round portraits; **dates** on cards and a real time axis with years in timeline frames;
  **depth (3D)** — the board tilts into space and the cards stand on glowing stems by time,
  importance, confidence or chapter, drag to orbit; **pages** — any card opens as a page:
  Markdown, code like an editor (colours, line numbers, a range highlighted, pick lines → a code
  card as context), diffs with red / green gutters, “Als Kontext”, “Im Editor”, “Quelle”,
  “Verbunden mit”; **[[wiki links]]** between cards with backlinks; code cards with path + lines
  show the real lines on the board. Zoom: touch pinch, Ctrl / Alt + two fingers, + / − / 0, a
  slider, and a “two fingers zoom” switch for touchpads.
- **Calm by default (Pro)**: the operator shows the core first (5–9 short cards), keeps depth in
  each card's details (“mehr ›” opens the page) and in **folded frames** (one compact card with a
  count and “Aufklappen”), and offers where to go deeper; investigation wall, storyboard and 3D
  only on request or for a deliberate illustration. The wall got a calmer look (no cork, no tilt,
  small pins, fine red threads), 3D a quiet floor grid.
- **Maps, browser, OSINT (Pro)**: map cards with a place or a route (Google Maps, live on the
  board); browser cards and **browser windows** inside the cockpit (for pages that refuse to be
  framed — consoles, Google Maps); `{"do":"osint"}` — public facts about a domain or IP (DNS,
  registration, certificate names, web archive, network, rough server location) as a summary
  card, a map and folded details. Nothing about private persons.
- **More depth on demand (Pro)**: answers cite board cards — `[[id]]` in the chat is the card's
  name, a click flies to it; **film** — a board builds itself chapter by chapter; **“Tiefer”** on
  any card — the operator builds a board of its own for it (code modules: their files, one level
  deeper, flat folders kept to 12 cards); **logs as timelines** (start, every distinct error with
  its count, warnings, end — times on a real axis); **“Wissen herausziehen”** on documents; an
  **OSINT graph** of who and what stands behind a domain; a **picture of a browser window** onto
  the board; the knowledge graph with **depth (time)** on request; and a board check after every
  bigger build (too many cards, long texts, too many arrows, 3D left on) that the operator fixes.
- **Web pages on the board (Pro)**: any page as a real browser view in the cockpit — large over
  the whole board (with back, reload, pin, window, close), pinned small on its card (it moves and
  resizes with the board) or in a window of its own; it steps aside under menus, the palette,
  pages you read, far zoom and 3D, and the card keeps its last picture. The operator reads pages
  and — with your OK — clicks, types and navigates in them (`{"do":"page"}`); page content is
  passed on as untrusted data.
- **Pages you can watch and speak to (Pro)**: before the operator clicks, types or searches in a
  page, the element lights up with its name (“◆ Atlas klickt”); search fields hidden behind a
  button are opened first. Say “scroll weiter”, “klick auf …”, “such nach …”, “groß”,
  “anpinnen” or “schließ die Seite” while a page is open on the board. The crew card shows each
  agent's code changes (+/−).
- **Comparing and quoting pages (Pro)**: two pages large side by side, each with its own bar; a
  strip of the pages visited under the bar; a selection — or a passage the operator names —
  becomes a quote card with its source next to the page.
- **Web crew and page wall (Pro)**: up to eight pages large on the board at once, tiled calmly;
  `{"do":"crew","pages":true}` sends a crew of up to eight agents onto pages of their own — each
  page's bar shows the agent's name and what it does, the page follows the addresses the agent
  reads, and when the crew is done the pages go back onto their cards and the operator
  consolidates. On a wall the bars stay compact.
- **Project overview (Pro)**: all boards of a project as tiles with a picture, caption, what is
  on them and what is new since you last looked; “Willkommen zurück” after a while, and a
  briefing by the operator (“Briefing”, “zeig mir die Übersicht”, `{"do":"overview"}`).
- **Compare, read aloud, keep (Pro)**: two pages side by side become a calm comparison table on
  the board (“Vergleichen”); a page is read aloud with the passage being read lit up on it
  (“Vorlesen”, “lies mir die Seite vor”); a page is kept as a PDF card next to it.
- **Living source boards (Pro)**: architecture and log boards follow their source — a changed
  repo or log redraws the board by itself, your own cards stay, what changed glows.
- **Crew card (Pro)**: with two or more agents at work, one calm card shows them all — state,
  current step, task, tests.
- **File watches (Pro)**: “wenn sich Datei Y ändert …” — a watch on a file or a folder (anything
  inside it) fires when it changes; the operator reads and reports.

### Fixed

- The cockpit could go blank (endless re-render) when the Mission tab opened with no reminders or
  operator memory saved.
- New settings of this release were refused by the backend (“Unknown setting”); a test now checks
  that every setting the UI writes is allowed.
- Long prompts to Codex were sometimes left in its input box: Codex took the Enter right after a
  long paste for a line break. A second Enter now submits them.
- Codex sessions started by the cockpit no longer stop at the "Update available" menu.
- Uploading an assistant's own picture failed silently (the app's content security policy blocks
  blob: images); pictures are now read as data: URLs.
- Long answers of Claude agents were cut at 1,500 characters before the cockpit saw them.
- **Assistant roles (Pro)**: Advisor (talks and plans, plan mode), Builder (codes, goals, task
  proposals) and Operator; each assistant can have its own voice and effect.
- The heads-up pop-up shows the send countdown and who is speaking.

## [0.3.1] - 2026-10-05

### Added
- **New voice overlay**: a glowing orb in the lower third that reacts to your voice, swirls while
  Whisper transcribes and pulses while an answer is read aloud.
- **Dictate into any text field**: with the cursor in a field of the cockpit (task, chat, search),
  the main voice shortcut types there instead of into a terminal.
- Dictation **stops by itself** after about 1.5 seconds of quiet (Settings → Voice); Esc while
  transcribing discards the text.
- **Assistants (Pro)**: chat first (they ask questions and only start goals when you say so), voice
  conversations (answers are read aloud, then the mic opens again), and task proposals you confirm
  and hand to running agents or new agents in their own worktrees.
- Review: "Add repository…" and a hint when a folder has no git yet.

### Fixed
- Only one cockpit runs at a time; starting it again brings the window to the front. Several
  instances ran loops twice and kept old voice shortcuts alive.
- Voice shortcuts that would break typing or editing everywhere (Shift+letter, Ctrl+A/C/V…)
  are refused with an explanation.
- The phone remote closes connections gracefully.

## [0.3.0] - 2026-10-04

### Added
- The official installer is the **Pro edition**: assistants and goals are free for 7 days from
  the first start, then a monthly or yearly subscription (Settings → Pro). The license is
  checked with Ed25519-signed tokens; see docs/PRO.md.
- The free open-source build marks Assistants as Pro in the sidebar and links to the
  official download.

## [0.2.0] - 2026-10-03

### Added
- Groundwork for **Robs AI Cockpit Pro** (coming soon): assistants and goals, free for 7 days,
  then a monthly or yearly subscription. The free edition shows an info page instead.
  See docs/PRO.md.
- **Assistants** (Pro): named agents with an animated face (8 characters or your own picture), a
  personality (soul.md), working agreements (agent.md), their own terminal and a goal they
  pursue on their own. Each has a room with an immersive chat (answers, your messages,
  supervisor notes, live tool activity), the live terminal next to it, and permission requests
  you can answer right from the chat. Notifications show the assistant's face.
- **Goals** (Pro) as a third mode next to queues and loops: no fixed prompts. After every answer a
  small supervisor model (Claude Haiku or a small Codex model, run in the background with your
  own login) rates the progress and writes the next instruction, until the goal is reached, the
  agent needs you, or the round limit is used up.
- Accounts show which login (email and organisation) each Claude profile uses: on the
  Accounts page, in the account picker of "New session", in the overview and the status bar.
  Taken from `claude auth status`; the Codex CLI does not report it.
- Agent answers keep their line breaks in the overview and notifications.

### Fixed
- Prompts typed by the cockpit (start task, loops, auto-continue) were sometimes left in the
  input box without being sent: Codex took the Enter as part of the paste. Prompts are now sent
  as one bracketed paste, and the cockpit presses Enter again if the CLI did not start.
- Loops and goals no longer hang when the session restarts in the middle of a turn.
- Pop-ups no longer fire after every single round of a running loop or goal, only at its end
  or when the agent needs you.
- The phone remote sometimes dropped a request: on Windows an accepted connection inherited
  the listener's non-blocking mode.

## [0.1.0] - 2026-09-30

First public release.

### Added
- 1–8 live terminal panes running the official Claude Code and Codex CLIs, plus custom CLIs.
- Multiple isolated accounts per provider, login via the CLIs' own flows.
- Mission control overview, task board, review & commit, loops and prompt queues.
- Heads-up notifications (done / needs input / limit / loop finished), phone push via ntfy.
- Auto-continue after usage limits, optional failover to another account.
- Local voice input (whisper.cpp), spoken commands, read-aloud.
- Token analytics and 5-hour / weekly quota from local provider logs.

### Fixed
- Notifications were delayed by minutes while the cockpit was minimized or in the background:
  WebView2 background throttling is now disabled for the main and the notification window.
- Claude Code's new "You've hit your weekly limit · resets Oct 2, 11am" message was not
  recognised, so limits showed as "working" and auto-continue never started.
- Several Codex agents started together in one folder could be attached to the same Codex
  conversation, so "resume" opened the same thread in every pane.
- Codex's "Update available" prompt now counts as a dialog: queued text is never typed into it
  (Enter there would run `npm install -g`), and the pane asks you to answer it.

[Unreleased]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.3.1...v0.4.0
[0.2.0]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/darkcool70/robs-ai-cockpit/releases/tag/v0.1.0
