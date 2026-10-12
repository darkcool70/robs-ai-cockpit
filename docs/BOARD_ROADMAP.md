# Board roadmap — the operator's living workspace

> Working list for the board and the operator (Pro). Everything Rob asked for, plus what follows
> from it. Worked through top to bottom; each item is ticked with the version and how it was
> verified. Vision and research: [VISION.md](VISION.md). The board's grammar and look (sections
> left → right, connectors, type scale, colours): [BOARD_DESIGN.md](BOARD_DESIGN.md) (Board 2.0, 11.10.2026).

**North star (Rob, 06.10.2026):** the board is where the whole crew's intelligence becomes visible
and usable. The operator sends agents off *on the board*, you watch them work and deliver, the
operator gathers and consolidates everything for you, asks whether it should show you something,
and you work *into* the board yourself — give input, hand cards to agents, see your input being
processed — by mouse, keyboard and voice, with all senses. Everything the world has to show
belongs on it: real charts and data (Power BI-like filtering), files (pictures, PDFs, PowerPoint,
terminals), web search, calculations, videos — arranged, written on, consolidated, pushed away,
brought back, slid over — professional and impressive.

**North star v2 (Rob, 07.10.2026):** something that does not exist yet — a *super tool*: a
multimodal board where a human and a crew of AIs exchange knowledge at the speed of sight and
speech. Not a whiteboard with AI on top: a **living knowledge space** with an ontology underneath —
every card is a thing with a type, every arrow a relation with a meaning, every board part of one
graph of everything the project knows — that the operator reads, reasons over, extends, shows and
acts on, and that you can see, touch, ask and steer.

**North star v3 (Rob, 07.10.2026 evening):** the board is a **space of understanding** at
every level of the conversation. When the operator gathers knowledge (say, the newest AI topics),
it builds an **investigation wall**: evidence pinned up, people / organisations / technologies /
events as entities, red strings with meaning between them, a time axis along the bottom,
hypotheses in the middle. You can go into any of it — zoom into a card until it is a page, open a
source like a Markdown note, jump into the link, hand anything to the operator as context with one
click — and the board always **says what you are looking at**: a caption, a legend, a reading
order like a storyboard. One switch tilts the whole board into **depth (3D)**: the z axis is time
(or importance, or confidence), the knowledge stands up in layers you can fly around. Code is
read like in an editor: syntax colours, line numbers, changes marked, any line range a context for
the operator. Like Obsidian, every note links ([[…]]), knows its backlinks, and the operator
retrieves from all of it (RAG) before it answers. The exchange runs on many levels at once —
what is said, what is shown, what is meant, what is uncertain — the meta level made visible.

**North star v4 (Rob, 08.10.2026 evening): the number one way to work with AI.** Not a chat, not
a whiteboard — the best harness there is: many web pages open on the board at once (4, 6, 8),
the operator working on several in parallel or sending a crew of sub-agents onto them — each
with its name on its page, so you watch who does what where — their results flowing onto the
board and consolidated there; a board grows tabs and becomes a project ("Marketing") that is
saved, and when you come back after days you see at once what was worked out on every tab —
pictures, pages, data grids, mind maps, charts, dashboards. Everything steerable by your words
and voice; the operator brings proposals by itself and works *with* you: research, analysis,
ontology, agent steering — visual, with audio, with all senses.

### Level 8 tasks — by impact (written 08.10.2026)

1. ✅ (0.4.0, verified live: 4 crew pages as 2×2) **Page wall** — up to 8 pages large on the board at once, tiled calmly (2 → side by side, 3–4 → 2×2, 5–6 → 3×2, 7–8 → 4×2), each with its bar.
2. ✅ (0.4.0, verified live: "Marketing für ein KI-Desktop-Tool" — 4 agents, each page with its name and activity, the Zielgruppe page followed its agent to the Stack Overflow survey 2026; consolidated into stats, a price chart, findings, raw material folded) **Web crew** — `{"do":"crew","pages":true}`: every crew agent gets its own page on the wall; the page's bar shows the agent's name and what it does right now; when the agent opens a web address, its page follows (you see where it reads); its results land next to its page; when all are done the operator consolidates them in an "Ergebnis" frame and proposes what next.
3. ✅ (0.4.0, verified live: 3 tiles with pictures, "Willkommen zurück" after 5 h) **Project overview & return** — an "Übersicht" of all tabs of a project as tiles with a small picture of each board, its caption, what is on it, and what is new since you last looked; coming back after a while, the operator offers a short briefing of what happened.
4. ✅ (0.4.0, verified live: Bereich „Marketing“ with its dashboard tab, switcher next to the tabs) **Workspaces you name** — "mach daraus ein Projekt Marketing": the tabs of the moment are grouped as a named workspace with its own overview, reopened by name.
5. ✅ (0.4.0, verified live: 5 channels sorted by reach with one header click) **Data grid** — a real grid card (sortable, filterable, editable cells, many rows) for research results and lists, chartable in one click.
6. ✅ (0.4.0, verified live: 3 KPIs + a live agents card, a price chart, a channel grid — in 15 s; rebuilding keeps your own cards) **Dashboard card set** — the operator builds a dashboard tab by itself (KPI numbers, charts, a data grid, live cards) when asked "mach mir ein Dashboard zu …".
7. ✅ (0.4.0, verified live: „Was als Nächstes?“ → a choice card with three concrete steps, the recommended one first) **Proactive partner** — after a crew finishes or a board is built, the operator proposes 2–3 next steps on a choice card; when you return, it says what it would do next.
8. ✅ (0.4.0; commands tested, spoken path not yet with a microphone) **Everything by voice** — "öffne vier Seiten zu …", "schick die Crew los", "zeig mir die Übersicht", "was ist neu?" — spoken commands for the new tools.
9. ✅ (0.4.0, partly live: re-run reviews ended PASS in 30 s; whether a failing Codex reviewer was replaced, and the error dot, not yet seen live) **Agent failures — detect, show, recover** — a turn ended by an API / CLI error (model not available, login, overloaded, network) is status „error“, never „done“: read from Codex's rollout (`task_complete.error`), Claude Code's `StopFailure` hook, else the error line on screen; shown on the agent card, in Mission Control, „1 Fehler“ in the crew header, „Als Nächstes“; the operator hears it once with a concrete fix, one safe automatic move to another account at most; a failing reviewer moves to the other provider, a review card never hangs. Next: an „Auf anderem Konto neu starten“ button on the failed card (the failed account in Accounts and the operator's own failing turn: item 10).
10. ✅ (0.4.0, partly live: with Codex at 2 % quota two Codex requests went to Claude A by themselves; the model-failure path not yet live — needs a Codex turn) **Account health** — a model / login failure is remembered per account (setting `accountHealth`, message + time, cleared by the next answered turn on it, by „Try again“, by logging in again); for 6 h new agents, crew members, reviewers, recoveries, the „New session“ recommendation and the limit failover skip it while another account works; the operator's snapshot marks it „avoid“. Accounts shows „⚠ Model not available — …“ with the fix in the profile's own config file and a suggested model from the catalog — „Use for cockpit sessions“ sets the cockpit's own model for that account (setting `accountModels`, the CLI config is never touched). The operator's own failed turn: a calm bar in its chat with the fix, one toast per failure anywhere. Next: „Auf anderem Konto neu starten“ on the failed card; the same health dot in the sidebar's account list; Claude agents' fallback model (`--fallback-model`) proposed from the same signal.
11. ✅ (0.4.0, verified live in a fresh instance: core tour → „Lern Atlas kennen“ → „Atlas starten“ → „Probier es“ with three starters → „Mach mir ein Dashboard“ built „Dashboard · Cockpit“ in 16 s; the 5-step tour ran through) **The first five minutes** — a new user feels within a minute why this is the way to work with AI: „Atlas starten“ in one click on the Assistants page (logged-in Claude first, then Codex; no account → Accounts); Atlas's empty board says „Probier es“ with three one-click requests sent like typed messages (the project as a board — in a git repo with what was worked on last — or a plan without a folder; a live dashboard; a research crew), „Atlas ist dran“ until it draws, small chips on later empty boards; „Kurze Tour“ in five steps (chat, board, crew, boards & overview, Talk) as a soft ring with a card, skippable, remembered (localStorage `firstRun.v1`); one „Lern Atlas kennen“ hint after the core tour while no operator exists, one line in the empty workspace; palette „Erste Schritte wieder zeigen“. (firstRun.ts, FirstSteps.tsx) Next: ~~an „Atlas, zeig mir, was du kannst“ demo board built without any agent~~ (item 12); the core tour's first step leading to Atlas in Pro; voice as a first-run starter (mic check + „sag einfach …“).
12. ✅ (0.4.0, verified live: palette → three Demo tabs, the film ran with subtitles through Recherche and Dashboard, Crew showed „alle fertig ✓“ with „Review ✓“, „Demo entfernen“ brought the own tabs back; no console errors) **„Zeig mir, was du kannst“ — the demo at zero quota** — for new users and for showing the cockpit to others: one click on the empty board („Probier es“ and the later chips) or in the palette builds three calm example boards with the real board ops — „Demo · Recherche“ (3 entities, a hypothesis with supports / contradicts and a source, the timeline folded), „Demo · Dashboard“ (the real dashboard grid: 3 KPIs, 2 charts, a data grid), „Demo · Crew“ (a finished crew frame: 3 agent cards, their diffs with +/− and review PASS, „Crew-Ergebnis“, results and reviews folded) — 5–9 cards visible each, no layout or calm complaints, every caption „Demo mit Beispieldaten“. They form the workspace „Demo“ (own tabs, never mixed into the user's; recall / backlinks / graph / briefings skip them unless you are inside), and a guided film of ~80 s starts at once: each board builds itself, camera and glow follow eleven calm subtitles, the timeline unfolds and folds back, the overview shows the three tiles; voice via `speak()` when voice output is on (the step waits for the sentence). A bar on demo tabs: „Beispieldaten · keine echten Agenten · Film abspielen / Anhalten · Demo entfernen“ (back to the board you came from). Demo agent cards (`session` „demo:…“) show their finished state, never a terminal, no „Open“ / drop target; the crew header reads „alle fertig ✓“ from the result cards; „Alle übernehmen“ / „Übernehmen“ / „↻ refresh“ never appear. One persona sentence: the operator points to it and never cites it as fact. (demo.ts, demoScope.ts, demoLive.ts, DemoTour.tsx) Next: ~~a voice command and an operator action; an English demo~~ (item 13); a mind-map tab.
13. ✅ (0.4.0, verified live: palette → „Demo präsentieren“ fills the whole window (1442×920), 11 large subtitles in 84 s, closing card „Das war Robs AI Cockpit“ with „Atlas starten“ / „Nochmal ansehen“, Esc leaves; asked „Zeig mir die Demo.“ Atlas opened it with the film in 8 s; spoken start and English not yet live) **The demo for anyone — voice, Atlas, stage, English** — spoken / typed partner commands „Atlas, zeig mir, was du kannst“, „zeig mir die Demo“ (open + film), „spiel die Demo ab“, „präsentier die Demo“ / „führ uns die Demo vor“, „Demo anhalten“, „Demo entfernen“ (+ English); the operator action `{"do":"demo"}` (`"act"`: present / film / stop / remove; no confirmation in any mode) with one persona sentence. **Presenting** („Präsentieren“ on the demo bar, palette „Demo präsentieren“): the board full screen with every bar, the caption panel and the side panel hidden (`.board-stage` keeps only the board, the overview and the stage layer), the film's sentence large at the bottom once it is said, one progress segment per step filling over its time, „Esc · Beenden“; then a closing card „Das war Robs AI Cockpit — jetzt mit deinem Projekt“: „Atlas starten“ removes the demo, returns to your own board and wakes Atlas (no operator yet → Assistants with „Atlas starten“), „Nochmal ansehen“, „Schließen“. **English** when the voice language is English: „Demo · Research / Dashboard / Crew“ — same card ids, places, links, folds and timing, natural English words (calm checks pass), the film's eleven sentences fit their time; a demo in the other language is replaced, the film speaks the language of the demo that is there. Polish: the film's subtitle stays while a slow voice is still speaking. (demoEn.ts, DemoStage.tsx, demoLive.ts, partner.ts, operator.ts) Next: a mind-map tab; a short „Demo für Entwickler“ variant (code map + review); recording the presented film as a video to share.
14. ✅ (0.4.0, verified live: header, status „Schläft“, „Aufwecken“ / „Sprechen“ / „Im Arbeitsbereich“, chat „Du“, the German hint line; smoke test green with the new titles) **One language in Atlas's room** — the room (header, status chip, buttons, chat input, permission bar), Mission control (pending actions, log, memory, reminders, review chain, „Frag mich vor“), the action receipts and the operator's toasts / notes / review cards, and the board (toolbar and card tooltips, hint line, palette, caption panel, zoom control, live cards) follow the voice language: German by default, English with the English voice language; prompts and events *to* the operator stay English. (AssistantsView.tsx, MissionControl.tsx, operator.ts `describe(a, english)`, BoardView.tsx `tr()` / `kindStyles()`, BoardSpace.tsx, BoardTools.tsx, BoardPalette.tsx, firstRun.ts) Next: English for the board parts still German-only (entity kinds, relation words in the reader, CardZoom, Crew view); the backend's own timeline notes (goal loop, limits) in the room.

**The first rule (Rob, 08.10.2026): calm, clear, beautiful.** The board must be understood at a
glance. The operator has every degree of freedom — maps, browser windows, OSINT, entities, time
axes, depth, walls, storyboards — but uses them only when they help. It shows the core (5–9
cards), keeps the depth one click away (card details, folded frames) and goes deeper when asked.
3D and the investigation wall are special effects for a real reason, never the way of working;
the default look is clean. Not flooding the user matters more than showing everything.

### Level 6 goals — the investigation & story space (written 07.10.2026)

1. **It says what you see.** Every board carries a caption (what this is, in one or two
   sentences, written by the operator), a legend that builds itself (what the colours, card kinds
   and arrow kinds mean on *this* board) and a reading order: chapters numbered 1, 2, 3 like a
   storyboard, each frame with its own one-line caption.
2. **Looks for what it is.** Board styles the operator picks by itself: *investigation wall*
   (dark cork, cards pinned with a pin and a slight tilt, red strings that sag, photos with a
   paper edge, stamps), *storyboard* (scenes left to right, numbered, captions under them),
   *clean* (today's look). Same data, a different way to understand it.
3. **Entities are things.** A card kind for people, organisations, technologies, places, events
   — round portrait-like cards that become the hubs of the wall; the ontology links them across
   boards.
4. **Time is an axis.** Cards carry a date ("2025-03", "März 2025"); a timeline frame places
   them proportionally on a real time axis with year / month ticks; the 3D view can use time as
   depth.
5. **Depth (3D).** One switch tilts the board into space: the floor holds the frames, cards rise
   by time (newest highest), by importance or by confidence; drag to orbit, wheel to fly; the
   operator can turn it on to show an evolution. The knowledge graph gets a 3D mode too.
6. **Go into anything.** A card opens as a page: notes and web texts as rendered Markdown, code
   with syntax colours and line numbers (a line range highlighted), diffs like an editor (red /
   green gutter), files as their content — with "open the source", "open in the editor" and
   "give it to the operator as context" on every page.
7. **Obsidian inside.** [[Title]] links in any card text jump to that card (on any board of the
   project) and count as relations; every card shows its backlinks; the operator recalls across
   everything before it answers (RAG) and cites the cards it used.
8. **Code like an editor.** Module cards open to their files, a file card to its code; changed
   lines marked in colour; double-click a module → its files as a board one level deeper.
9. **Zoom like a map, on every device.** Pinch, Ctrl/Alt + scroll, keyboard + / − / 0 and a zoom
   slider; far away the board shows its chapters and entities, closer the cards, closest the
   pages.
10. **The operator uses all of it by itself.** Knowledge gathering → investigation wall with
    entities, evidence, strings, timeline, hypotheses and a caption; code → architecture map,
    editor pages, diffs; plans → storyboard. It explains while it builds, and asks what to open
    next.

## Where we stand — honest gap analysis (07.10.2026)

| Area | Top level already | Not yet top level |
|---|---|---|
| **Knowledge** | cards, arrows, frames, topic boards, BOARD.md export | arrows have no *meaning* (causes / depends on / contradicts …); cards are not *things* with a type; boards don't know each other; no "where else did we talk about X?"; the operator can't recall across boards |
| **Agent power** | crew rooms, worktree agents, diffs, tests, build, research, presenting, drawing, data, files | it reacts per message — no standing goals or watches ("tell me when X"); it can't query the knowledge graph; it can't build a board from a whole repo or folder; no merge from the board |
| **Illustration** | charts, numbers, tables, sketches, pages, video, timeline / kanban / mind map | no automatic diagrams from structure (architecture from code, flows from logs); no maps / geo; no animated explanations (step-by-step builds of a diagram); no themes |
| **Animation & feel** | materialise, sparks, comet trail, pen, spotlight, glide, slide titles, sounds | arrows are static — nothing *flows*; no visible "thinking" of the operator on the board; no zoom-into-a-card semantic zoom (detail appears as you come closer) |
| **Interaction** | drag-to-agent, ask-on-card, gestures, choice cards, voice commands, pen | no command palette ("/" anywhere); no multi-user / remote view; no linking by voice ("verbinde das mit …"); no undo of a whole operator turn as one step |
| **Senses & speed** | voice in / out, fillers, interim speech, subtitles, sounds, presenting | no glanceable "state of everything" heat map; no attention guidance (where should I look now?); no summaries that adapt to how much time you have |

## Goals — levels toward the super tool

**Level 1 — Knowledge graph (now).** Typed relations on arrows (causes, depends on, part of,
supports, contradicts, example of, source of, leads to) with their own look and *flowing*
particles; cards carry entities / tags; a **graph view** of everything the project's boards know,
force-laid-out and alive, with links across boards; backlinks on cards ("also on board X");
the operator can **recall** across all boards and relate things with meaning.

**Level 2 — The operator thinks on the board.** Its reasoning becomes visible: hypotheses as cards
that get confirmed or crossed out, evidence flowing into them; standing **watches** ("sag mir, wenn
die Tests rot werden / wenn Agent X fertig ist") that live as cards; one undo for a whole operator
turn; a command palette for you.

**Level 3 — The board understands sources.** Point it at a repo, a folder, a set of PDFs or a
website: it builds the board itself — architecture diagram from code, entities and relations
from documents, timelines from logs — and keeps it up to date.

**Level 4 — Semantic zoom & attention.** Far away you see the shape of the knowledge; closer, the
cards; closer still, their full content. A gentle pulse shows where you should look next; a heat
map shows what changed since you last looked; "gib mir 30 Sekunden / 5 Minuten" adapts the
explanation.

**Level 5 — Shared and remote.** The board as a live page for others (read-only first), voice and
board on a phone, the crew working while you are away and briefing you when you return.

## Level 1 — Knowledge graph

- [x] (0.4.0, verified live: Atlas drew 12 typed relations; sparks flow on leads-to / causes / source-of, ⚡ on contradicts) Typed relations on arrows: meaning, look (colour, dash, icon) and flowing particles for flows; the operator sets them (`{"op":"link","rel":"causes"}`), you pick them on the arrow.
- [x] (0.4.0, verified live: 10 of 11 cards tagged) Entities / tags on cards (`"tags":["WebAssembly","Performance"]`), shown as chips.
- [x] (0.4.0, verified live: 25 cards, 7 entities over 3 boards, glowing hubs, boards in colour) Graph view: all boards of the project as one living graph (force layout), cards as nodes by kind, relations as edges, the same entity on several boards linked; hover shows neighbours, click jumps to the card on its board.
- [x] (0.4.0, verified live: 8 cards “↗ 1 board”) Backlinks: a card whose entity appears on other boards shows where ("↗ 2 boards").
- [x] (0.4.0, verified live: “Was hatten wir zu Performance und Rust?” → Atlas found “bis 7×” and “Kernlogik in Rust” on the board Recherche and linked them in) Recall: `{"do":"recall","query":"…"}` — the operator searches every board of the project (titles, texts, tags, relations) and gets the matching cards back with their board.
- [x] (0.4.0) The snapshot carries the ontology in short: the main entities and how they relate.

## Level 2 — The operator thinks on the board

- [x] (0.4.0, verified live: Atlas set up 3 hypotheses with evidence — bars 70 / 13 / 9 %; it noticed itself that example values stamped too early → examples now count half and a stamp needs two pieces of evidence) Hypotheses as cards that evidence confirms or crosses out (supports / contradicts flow into them; a confidence bar that moves).
- [x] (0.4.0, verified live: task ticked done → the watch rang, the board pointed, Atlas summed up 16 s later) Watches: "sag mir, wenn die Tests rot werden / wenn Agent X fertig ist" — standing cards that fire, speak and point. (File changes as a trigger: later.)
- [x] (0.4.0, verified live: redo chain shows one step per answer) One undo for a whole operator turn.
- [x] (0.4.0, verified live) A command palette on the board ("/" or Ctrl+K): every tool by name, by keyboard; unmatched text goes to the operator.
- [x] (0.4.0, verified live: 11 of 11 cards as titles, frame names floating above) Semantic zoom: far away titles and frame names, closer the full content. (Entity clusters at the farthest level: Level 4.)

## Level 3 — The board understands sources

- [x] (0.4.0, verified live: file written → watch fired → Atlas read it out) Watch on files: "wenn sich Datei Y ändert" (polled change stamps of a file or folder, every 4 s, generated folders skipped).
- [x] (0.4.0, verified live on this repo: 181 files → 12 modules in layers, src/lib at the bottom as the foundation; Atlas explained it, marked “Hier fängst du an” and the risks) Repo → board: point it at a folder, it draws the architecture (modules, dependencies as depends-on arrows, entry points, libraries).
- [x] (0.4.0) Zoom into a module: "Tiefer" on a module card → its files as a board of their own (the same map one level deeper).
- [x] (0.4.0) Documents → entities: "Wissen herausziehen" on a file card; the operator builds the terms and actors with relations.
- [x] (0.4.0) Logs → timeline: a log file becomes a timeline of what happened, errors marked and grouped.
- [x] (0.4.0; architecture / log boards verified live — see Level 7; file / data cards unit-tested, not yet live) Keeps it up to date: the source board refreshes itself when the source changes (with a "what changed" glow that stays until seen); file and data cards notice their file changed and offer „Quelle geändert – aktualisieren?“.

## Level 4 — Semantic zoom & attention

- [x] (0.4.0, verified live: k3 and n2 glowed with "neu", "2 Karten neu seit deinem letzten Blick") What changed since you last looked: cards new or changed since the board was last left (or since you came back to the window after 10+ min) wear a soft halo with „neu“ that fades once the card was on screen for 8 s or clicked; one calm line counts them with „Zeigen“; more than 9 (or nearly the whole board) becomes one summary with „In 30 Sekunden“ instead of a flood. Moving a card no longer counts as a change.
- [x] (0.4.0, unit-tested, not yet live) Attention guidance: at most one card breathes (three pulses, then a faint ring) — agent needs you › waiting choice › red tests / build › watch rang › agent finished › your answer is there; clicking it settles that moment; off screen the line says „Als Nächstes: … ›“. Quiet while presenting, filming, drawing, in the spotlight.
- [x] (0.4.0, unit-tested, not yet live) Time-boxed briefings: „gib mir 30 Sekunden“, „was ist neu, ganz kurz“, „erklär mir das Board in 5 Minuten“, „Kurzfassung“ — the length follows the budget (≈ 2.2 words / s), short ones add no cards, the board's new cards are cited with [[id]].
- [x] (0.4.0, unit-tested, not yet live) Heat map of the project: overview tiles warm calmly with how much changed since you last looked, with „Was sich geändert hat“ in at most three lines (also in the briefing).
- [x] (0.4.0, unit-tested, not yet live) The operator names where to look: `{"op":"look","id","why"}` (persona sentence); „Als Nächstes: …“ is said once — closing a „was ist neu?“ briefing or by itself when you return in a voice conversation; „Wo soll ich hinschauen?“ flies there.
- [x] (0.4.0, unit-tested, not yet live) Changes visible from far away: bolder halos, not counted as seen while far, frames (and folded frames) with „N neu“ and a glow.
- [x] (0.4.0, unit-tested, not yet live) A click into a docked web page no longer counts as leaving the window (window focus asked from Tauri).
- [x] (0.4.0, unit-tested, not yet live) A "since you were away" film: „Abspielen“ in the news line and the welcome-back banner, „spiel ab, was neu ist“ — only the changed cards, close up, in reading order (at most 12).
- [x] (0.4.0, verified live: a card saved to „Dashboard · Marketing“ in the background → dot with „1 Karte neu seit deinem letzten Blick“, gone once the tab opened) Per-tab heat: a small calm dot on tabs whose board has cards new since you last looked (count in the tooltip); only boards saved since are read again.
- [x] (0.4.0, verified live: „KI-Agenten 2026“ at 16 % — Anthropic · 4, Google · 5, OpenAI · 5, Agent-Harness · 5) Entity clusters at the farthest zoom (below 30 %): cards sharing an entity and lying near each other become one soft region with one name and a count (the entity card as its hub), glowing „N neu“ with their changed cards; at most 7, a card in one at most, none that repeats a frame, no label over a frame name; clustered cards' titles fade back; a click on the name (or a double-click on a far card) flies there. (clusters.ts, ClusterLayer.tsx)
- [ ] Next: clusters across boards in the overview tiles; a calm fade-out of the cluster labels on the way in (today they leave at once while the titles fade in).

## Level 5 — Shared and remote

- [x] (0.4.0, unit-tested, not yet live) The board as a page for others: „Als Webseite speichern“ — one self-contained, read-only HTML file (title, caption, the board as a picture, chapters in reading order, every card readable: charts as SVG, tables, confidence bars, choices, sources, details folded). No scripts, nothing external, no local paths or card ids. (share.ts, shareLive.ts)
- [x] (0.4.0, verified live: turned on in Settings, /board served the crew board with Atlas's answer on top, CSP set, wrong key → 401; checked at 412 px without overflow — scanned with a real phone not yet) Board on the phone: the phone remote (off by default, secret key, home network only) gets a „Board“ tab — the open board live and read-only in a sandboxed frame with a strict CSP, the operator's latest answer on top, a line to message the operator („[Vom Handy]“ prefix, persona sentence). Nothing but sending a message can be done from the phone.
- [x] (0.4.0, unit-tested + decoded with jsQR v1–v10, not yet live) QR code for the phone link in Settings (own encoder, no dependency), shown on request.
- [x] (0.4.0, unit-tested, not yet live) The remote drops requests from outside private / link-local / loopback addresses.
- [x] (0.4.0, unit-tested + Rust-tested, not yet live) „Seit du weg bist“: one pure digest (away.ts — errors, needs you, questions, red tests, crews done with their waiting changes, agents done, board news, who still works; 1–6 lines) at the top of the phone page while you are away, in the welcome-back banner (lines fly to their cards) and in the briefing.
- [x] (0.4.0, unit-tested, not yet live) Push when it matters while away: after the push minutes away from the window, one bundled push („Crew fertig – 2 Änderungen warten auf dich“ / „Atlas ist fertig“) through the existing push URL — each thing once, at most every 8 min; replaces the core's waiting push unless switched off.
- [x] (0.4.0, verified live: key with expiry and CSP; „New key“ → the old one 401 at once; expiry itself unit-tested) Keys that expire: a lifetime per key (8 h / 24 h default / 7 days, „Key lifetime“ in Settings; the server clamps to 7 days and never accepts a key without expiry), „Key valid until … (in 5 h)“ in Settings, „New key“ always visible and swapped live on the running remote (`remote_set_keys`, no rebind; the old link stops at once). An expired key gets 401 with a calm „Link abgelaufen – scanne den QR-Code neu“ page (no script), the API a short `{"error":"expired"}` that switches an open phone page to the same message; a replaced key gets „Dieser Link gilt nicht (mehr)“. Older saved keys get the chosen lifetime from their first start. (remote.rs `authorize` / `make_access`, src/lib/remoteKeys.ts)
- [x] (0.4.0, verified live: „Board · nur lesen“ without a message box, minimal state, POST /api/send → 403, „Revoke“ → 401) A view-only link for colleagues: a second key (its own QR code in Settings, on request; „Revoke“) that opens only the board page with the operator's answer — its `/` is a board-only page, its `/api/state` carries only the board's title and stamp (no sessions, no digest), `/api/send` and any other method answer 403, other paths 404. Enforced by the server per key, not by hiding UI. Expires like the owner's key.
- [x] (0.4.0, partly live: no real card ids in the board HTML any more; the digest on the phone not yet seen with a phone) „Seit du weg bist“ on the phone's Board tab (compact at the top, × hides it until something new happens); tapping a line there or on the Agenten tab scrolls the phone's board page to its card (folded chapters open, a short ring). Cards are anchored opaquely: salted per run on the phone (the same anchor in the snapshot and the digest, phoneAnchor.ts), by position in the saved file — the board's card ids no longer appear in shared pages.
- [x] (0.4.0, Rust-tested, not yet live) The phone pages themselves carry a CSP (own inline script only, `connect-src 'self'`, `frame-src 'self'`, `frame-ancestors 'none'`).
- [ ] Next: voice on the phone (the phone's dictation works already; spoken answers would need TTS audio served by the remote — owner key only, a short-lived audio URL); a „Link läuft bald ab – verlängern?“ action in the cockpit's notifications an hour before the key expires; several named view-only links (one per colleague, each revocable) with a „who looked when“ line; HTTPS for the remote (self-signed certificate pinned through the QR code) so keys never cross the Wi-Fi in clear text.

## Level 6 — Investigation & story space

- [x] (0.4.0, verified live: Ctrl + two fingers 85→75 %, touch pinch 21→57 %) Zoom with the touchpad: pinch, Ctrl / Alt + two fingers, touch-screen pinch, + / − / 0 keys, a zoom slider with the percentage, and a switch "two fingers zoom" for touchpads whose pinch does nothing.
- [x] (0.4.0, verified live) Caption ("Was du siehst"), self-building legend (folds out), numbered chapters with captions (storyboard reading order).
- [x] (0.4.0, verified live: Atlas chose the wall for "KI-Lage 2025" and the storyboard for "Code-Blick" by itself) Board styles: investigation wall (cork, pins, tilt, sagging red strings), storyboard (film frames, big chapter numbers), clean — set by the operator.
- [x] (0.4.0, verified live: 9 entities — Anthropic, OpenAI, DeepSeek, MCP …) Entity cards (person, organisation, technology, place, event, concept, product, paper) as round portraits.
- [x] (0.4.0, verified live: 22 dated cards, timeline frame with years) Dates on cards and a real time axis in timeline frames.
- [x] (0.4.0, verified live) Depth (3D): the board tilted in space, cards standing on glowing stems by time / importance / confidence / chapter, orbit by dragging.
- [x] (0.4.0, verified live: operator.ts:1266-1278 highlighted in the full file) Pages: Markdown for notes and web texts, code with syntax colours and line numbers (line ranges), diffs like an editor, "as context", "open in editor", "source" and "connected with" on every page; pick lines → a code card as context. Code cards with path + lines show the real lines right on the board.
- [x] (0.4.0) [[Wiki links]] between cards (across the project's boards) with backlinks on the page.
- [x] (0.4.0, verified live: "KI-Lage 2025" — 31 cards, caption, entities, dated evidence with sources, red strings source-of / supports / part-of / causes, timeline, a hypothesis at 84 %, a choice card) The operator builds investigation walls by itself.
- [x] (0.4.0, verified live: the hypothesis with its source above, two „stützt“ and one „widerspricht“ left, breadcrumb back; same-titled pieces now show their entity) "Zoom into a card" to a sub-board of its evidence: „Hineinzoomen“ (magnifier on the card, Z, „Belege“ on its page, palette, „zoom in die Karte …“ / „zeig mir die Belege zu …“) — the card large in the middle, supports / contradicts left, sources and quotes above, consequences right, its places on other boards below (at most 9, „+N weitere“), lines in the relation's colour; a click goes one level deeper with a breadcrumb, Esc / „zurück“ / „raus“ step back. A view, nothing stored. (zoomInto.ts, CardZoom.tsx)
- [x] (0.4.0) RAG answers cite the cards they used ([[id]] chips that light the cards up), the film builds a board in story order, and the operator opens a card's evidence view by itself while it explains ({"op":"zoominto"}, verified live).
- [ ] Next: the knowledge graph in 3D (entities as stars, time as depth) — only as a special view, never the way of working (Rob, 08.10.).

## Level 7 — Calm by default, every degree of freedom on demand (08.10.2026)

- [x] (0.4.0, verified live: "Claude-News" — clean look, no 3D, 10 visible cards, sources folded) Calm board rules in the operator's persona: 5–9 cards first, short texts, details in the card's page ("mehr ›"), folded frames for depth, a choice card for where to go next; wall / storyboard / 3D only on request or for a deliberate illustration.
- [x] (0.4.0) Folded frames: one compact card with a count and "Aufklappen"; arrows end at the folded frame; the operator folds / opens with {"op":"collapse"}.
- [x] (0.4.0) Card details: long Markdown only on the page; the card stays short.
- [x] (0.4.0) A calmer look: the investigation wall without cork and tilt (small pins, fine red threads); 3D on a quiet floor grid.
- [x] (0.4.0, verified live: walking route Hauptbahnhof → Brandenburger Tor live from Google Maps) Map cards: a place or a route (driving / walking / bicycling / transit), "Groß" opens it in a window.
- [x] (0.4.0, verified live: Google Cloud Console opened in its own cockpit window) Browser cards (a page live on the board) and browser windows inside the cockpit for pages that refuse framing.
- [x] (0.4.0, verified live: anthropic.com → summary card, server map, folded details) OSINT about infrastructure: DNS (Google DNS), registration (RDAP), certificate names (crt.sh), web archive, network and rough server location — never about private persons.
- [x] (0.4.0, verified live: github.com → registrar, IP, Microsoft network, Zurich, DNS and mail providers, sub-domains folded) OSINT graph mode on request.
- [x] (0.4.0, verified live: the Tauri Wikipedia page as a 158 KB picture) A picture of a browser window onto the board ({"do":"snap"}, palette).
- [x] (0.4.0) Board check: after the operator builds 4+ cards it gets the layout and calm check once (too many cards, long texts, too many arrows, 3D left on) and fixes it.
- [x] (0.4.0, verified live: 7 card references in one answer) Answers cite cards: [[id]] in the chat becomes the card's name — a click flies to it, hovering lights it up.
- [x] (0.4.0, verified live) Film: the board builds itself chapter by chapter, card by card, titles as subtitles (toolbar, palette, {"do":"present","slide":"film"}).
- [x] (0.4.0) Go deeper on request: "Tiefer" on any card — the operator builds a board of its own for it and the card leads there.
- [x] (0.4.0, verified live: src/lib → 11 files + "+19 weitere Dateien", tests with their file) Code: one level deeper into a module by click; flat folders stay at 12 cards.
- [x] (0.4.0, verified live: app.log → start, slow queries ×2, payment timeouts ×3, breaker, disk full, end on a time axis) Logs as timelines ({"do":"timeline"}, "Als Zeitachse" on log files); dates with times.
- [x] (0.4.0) Documents → knowledge: "Wissen herausziehen" on text / Word / Markdown files; the operator's recipe for it.
- [x] (0.4.0) The knowledge graph with depth on request: time as the third axis, drag to turn — flat by default.
- [x] (0.4.0, verified live: the Tauri article large over the board, pinned on its card, stepping aside under the palette) Web pages on the board: a real browser view docked into the cockpit (any site, also those that refuse framing) — large over the board with a bar (back, reload, pin, window, close), pinned on its card (moves and resizes with the board), or in a window of its own; it steps aside whenever something lies over the board, the board is far away, tilted or the card is off screen, and the card keeps its last picture.
- [x] (0.4.0) The operator's hands in a page: {"do":"page"} read (text + numbered links, fields, buttons), click, type, scroll, back, go — clicking, typing and going wait for the user's OK; page content goes to the operator marked as untrusted.
- [x] (0.4.0, verified live: a new file in the repo → the board drew src/api by itself within seconds) Source boards stay up to date: architecture and log boards remember their source, redraw the drawn cards when it changes (the operator's own cards stay) and the changed cards glow.
- [x] (0.4.0, verified live) A calm "Crew" card when two or more agents work: each agent's state, what it does now, its task, the tests.
- [x] (0.4.0) Fixed an endless re-render (Mission tab, empty reminders / memory) that could blank the cockpit.
- [x] (0.4.0, verified live: "◆ Atlas klickt" around the button a moment before the click) The page shows what is about to happen: the element lights up with who acts (Atlas or you), then the click / typing / search happens.
- [x] (0.4.0, verified live: Wikipedia — the hidden search opened, searched, the right result clicked, key points as cards beside the page) Page search ({"act":"search"}) that opens hidden search fields; numbering only on visible elements (a stale "#1" can no longer hit the wrong element).
- [x] (0.4.0) Voice control of pages: "scroll weiter / hoch", "zurück", "neu laden", "klick auf …", "such nach …", "groß", "anpinnen", "schließ die Seite".
- [x] (0.4.0) The crew card shows each agent's code changes (+/−); a click shows its diff card.
- [x] (0.4.0, verified live: tauri.app → "What is Tauri?" in the strip under the bar) The pages visited in a page view, as a strip under its bar — a click goes back there; the card keeps the current address and title.
- [x] (0.4.0, verified live: "Create small, fast, secure, cross-platform applications" as a card linked to its page) Quotes: your selection in a page ("Zitat" in the bar) or a passage the operator names ({"act":"quote"}) becomes a quote card with its source, the passage lit up on the page.
- [x] (0.4.0, verified live: Tauri and Electron side by side) Two pages large side by side to compare ("daneben" on a card, {"where":"side"}), each with its own bar.
- [x] (0.4.0, verified live: Tauri vs. Electron — a table of 6 criteria, a verdict, source arrows) Compare two open pages ("Vergleichen" in the bar, {"do":"compare"}): the operator gets both texts and builds a calm "Vergleich" frame.
- [x] (0.4.0, verified live: "Frontend Independent" lit while spoken) Read a page aloud with the passage being read lit up and scrolled to ("Vorlesen" in the bar, "lies mir die Seite vor", {"do":"readpage"}); interrupting the voice ends it.
- [x] (0.4.0, verified live: tauri-2-0-….pdf as a file card next to the page) Save a page as a PDF card (WebView2 prints it into the cockpit's "pages" folder; the card shows its pages).
- [x] (0.4.0, unit-tested, not yet live) **A professional board experience** (Rob, 09.10.: "zoomt nicht, Achsen-Beschriftungen überlappen, zufällige Karten, Anordnung ergibt keinen Sinn"): the operator's cards are laid out by structure (autoLayout.ts — diagrams along the arrows, groups by kind, frames sized to content, reading order, 10 px grid; user cards and explicit coordinates never move; persona: no x/y); chart labels fitted (flat / two lines / angled with „…“, value labels without collisions, pie legend; chartLabels.ts); the camera zooms to a readable level for [[id]] (spoken and written), point and new cards, steps back halfway on long flights and returns after a spoken explanation (camera.ts); cards with a kind word, whole-line text with „mehr ›“, a visible source, no tiny cards; the layout check names long titles, cut labels, no reading order, tiny cards.
- [ ] Next: see what the user wants next.

## Done

- [x] Presenting board: web / picture / video / topic cards, camera, cursor, subtitles (0.4.0)
- [x] The operator sees the board as a picture and tidies it (M19, 0.4.0)
- [x] Slides: frame by frame, narration with glow, voice control, hands-free with pauses, PDF export (0.4.0)
- [x] Board magic: materialising cards, sparks, comet trail, aurora, slide titles (0.4.0)
- [x] Charts, big numbers, tables, pen marks, spotlight (0.4.0)
- [x] Slides from documents (drop / "Slides" action), reminders at slides, emotional voice (0.4.0)
- [x] A render error stays in its card (error boundaries for every card, the board and the app) (0.4.0)
- [x] **Cards glide** when the operator moves, groups or brings back cards (0.4.0).
- [x] **Crew on the board**: live agent cards with terminal, activity and speech bubbles of their own words; results land next to them (0.4.0).
- [x] **Hand work to an agent by dragging** (0.4.0, verified live: “Let go — Scout takes it”, arrow “zugewiesen”, task doing → done, result card next to it).
- [x] **Run / Assign on every card** (0.4.0).
- [x] **Choice cards** (0.4.0, verified live: click → the operator carried on in 16 s).
- [x] **Your input, visibly processed** (0.4.0, verified live: sent → the operator is on it → answered, answer card next to it).
- [x] **Data cards (Power BI-like)** (0.4.0, verified live: operator dashboard filtered on EU as bars; CSV dropped → “As data” → Σ 3.850).
- [x] **Calculator card**, **web search card** (DuckDuckGo), **real files as cards** (pictures, text, CSV, PowerPoint, Word, PDF) (0.4.0, verified live).
- [x] What an agent changed: a diff card next to every agent in its own worktree (0.4.0, verified live: greet.py +7/−0).
- [x] Build live and tests live, the failing output to the operator (0.4.0, tests verified live with pytest).
- [x] The operator picks the fitting shape by itself (persona) (0.4.0).
- [x] Voice on the board: positions and what is on screen; instant board commands (0.4.0, verified live).
- [x] PDF pages and PowerPoint slides as real pages (0.4.0, verified live).
- [x] Crew rooms (0.4.0, verified live: “Rust vs Go für CLI-Tools”).
- [x] Freehand sketches and the pen; gestures (0.4.0, verified live).
- [x] Live data cards: quota, agents, tasks, context (0.4.0, verified live).
- [x] Frames as timeline / kanban / mind map / grid (0.4.0, verified live).
- [x] Board sounds (0.4.0).

## Later

- [x] Open from the pre-release review (09.10.2026) — all seven confirmed in the code and fixed, unit-tested (none judged a non-problem): Claude Code below 2.1.295 (no StopFailure hook) — the run remembers whether StopFailure is registered, without it the on-screen error counts unless a later hook shows the turn went on (monitor.rs, commands.rs; sink.rs comment corrected); a StopFailure without text uses the transcript's last message only when it is the API error, else the error type (failure.rs); typed messages: leading `#` and a leading `/` that is no slash command get a space in front, a line ending in an `@` word a space after it — a typed `/compact` still runs (monitor.rs claude_keys); "Tests laufen …" cut off by a restart becomes „Tests ?“ and the crew folds (crewBoard.ts mergedTests / crewTick); phone pushes run one at a time with one rerun (shareLive.ts); „Demo entfernen“ dissolves only the demo's own workspace (demoLive.ts isDemoWorkspace); a replacement reviewer's card is not called „Review unterbrochen“ while it starts, and no way out of startReviewer leaves the card marked as starting (operator.ts).
- [ ] Open from the live test (09.10.2026): ~~review cards hanging after a restart~~ (done: „Review unterbrochen“ + „Neu prüfen“, unit-tested); ~~full chain live~~ (done 09.10.); ~~merged one by one, the dashboard did not fold~~ (done: the last single „Übernehmen“ runs the same close as „Alle übernehmen“, unit-tested).
- [x] Merge from the board: „Übernehmen“ on an agent's diff card (after a yes) — 0.4.0.
- [x] (0.4.0, verified live: crewdemo — Div +23 and Pow +17 each in their row with changes, result and review card, „Crew-Ergebnis“ and Atlas consolidating with [[card]] citations) A "crew dashboard" frame the cockpit sets up by itself when the operator sends several agents in one answer (live crew, tests, build; one row per agent with its diff and result), progress in the frame's header ("2/3 fertig", a dot per agent), one nudge to the operator when all are done to fill its "Crew-Ergebnis" card with [[card]] citations.
- [x] (0.4.0, unit-tested, not yet live) Crew consolidation stays calm: a research crew's raw frame (with its pages) folds away once the operator's summary stands; its consolidation message names each agent's result card for citing.
- [x] (0.4.0, unit-tested, not yet live) Steer one crew member from its card: „Anweisung“ (a new instruction) and „Stopp“ (after a yes); „Nochmal“ on a finished one (its task prefilled, restarted in its worktree when stopped, its old review marked stale, a new review when done).
- [x] (0.4.0, verified live: Div + Pow reviewed PASS, „Alle übernehmen (2)“ merged both, tests on main 11/11 green, the frame folded to „Crew: alles übernommen ✓“) The Crew card inside a crew frame shows only that crew; a review badge (✓ / ✗ / läuft / alt) next to every agent's diff; „Alle übernehmen“ in the crew frame's header once all are done and no review runs, failed or is stale — branch by branch, stopping at the first conflict.
- [x] (0.4.0, verified live: Div + Pow reviewed PASS, „Alle übernehmen (2)“ merged both, tests on main 11/11 green, the frame folded to „Crew: alles übernommen ✓“) After „Alle übernehmen“: the tests run once on the main tree (green / red in the crew frame's header, red reported to the operator); all well → the dashboard folds into „Crew: alles übernommen ✓“. „Befunde zurück“ on a failed review sends its findings to that agent as a new round.
- [x] (0.4.0, unit-tested, not yet live) Cited cards light up when an answer is read rather than heard; the persona asks for brief [[id]] citations when answering from cards.
- [ ] Board "rooms" for each agent working on a topic, consolidated into one summary board.
- [ ] Push: commit both repos, tag v0.4.0, check the Pro build on GitHub (when Rob says so — one release, not many).
