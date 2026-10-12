# Vision: an AI colleague who sits next to you

**North star.** You talk, it understands. It thinks out loud on a shared board, hands the work to
a crew of coding agents, watches them, shows you what came out — and only interrupts you when a
decision is really yours. It feels like a person in the room: it speaks, draws, points, pins,
opens, remembers. Everything runs on your machine with your own subscriptions.

## What "done" feels like

1. **Talk, don't type.** One shortcut from anywhere; the answer comes back as a natural voice in
   under a second of its first sentence. Conversations flow without pressing anything.
2. **Think on the board.** Every plan, idea and decision lives on a board you both edit. The
   operator draws while it talks and points at what it means.
3. **The board is alive.** Cards show what the agents are doing right now: a step turns "doing"
   when its agent starts, "done" with the result pinned next to it when the agent finishes.
4. **It runs the crew.** Starting, briefing, watching, unblocking and reporting on agents is the
   operator's job; it picks the account with quota left and isolates parallel work in worktrees.
5. **You decide, by voice.** Permission prompts of every agent reach you as a short question
   ("Claude B wants to run npm test — allow?") and "yes" answers them.
6. **It remembers.** Boards per project and topic are the shared memory every agent gets.
7. **It presents.** "Erklär mir den Plan" — it walks you through the board card by card, the card
   it talks about glows.

## What makes the film AIs feel real (JARVIS, FRIDAY, Samantha, TARS, the Enterprise computer)

1. **Presence without friction.** A name is enough. The answer to "Atlas…" is instant ("Ja?"),
   never silence. Thinking may take seconds — *acknowledging* may not (> ~0.5 s of dead air feels
   like a machine).
2. **Full-duplex conversation.** You can interrupt mid-sentence and it stops and listens. It
   speaks in short turns, not monologues.
3. **Situational awareness with tact.** It knows what is going on, says what matters when it
   matters, stays quiet otherwise, and greets you with a short briefing when you come back.
4. **It shows, not only tells.** It builds things in the room and points at them.
5. **A personality you can rely on**, consistent voice and tone.
6. **It acts.** It only asks when the decision is really yours, and reports honestly.

Gaps found against this (2026-10-06) and how they are closed:

| Gap | Fix | Status |
|---|---|---|
| Dead air between your sentence and the operator's answer | instant spoken acknowledgement + a visible "thinking" state | ✅ |
| Cannot interrupt it | full-duplex: the mic stays open while it speaks, echo-aware barge-in (M9) | ✅ |
| Must press a key | local wake word with the command in the same breath (M10) | ✅ |
| No "while you were away" | spoken return briefing when you come back to the cockpit | ✅ |

## What research says (2026-10-06) and what follows from it

| Finding | Source | Consequence for the cockpit |
|---|---|---|
| The gap between speakers is ~200 ms across languages; a first audible response under ~800 ms feels natural, beyond ~1.5 s robotic | Stivers et al. 2009 (PNAS); voice-agent latency guides | End a spoken turn after **0.9 s** of quiet in conversations (not 1.5 s); acknowledge at once |
| Overlap is normal (>40 % of turns): backchannels, interruptions | Full-Duplex-Bench; Duplex Cue study | Barge-in (M9) |
| Interruptions cost least at task **breakpoints** | Iqbal & Bailey (CHI 2007/08) | Spoken reports wait until you stop typing (attention-aware delivery) |
| Mixed initiative: weigh benefit vs. cost of acting, time it well, cheap dismissal and correction | Horvitz (CHI 1999) | **Undo** on the board (Ctrl+Z / “rückgängig”); risky actions confirmed |
| 18 guidelines: remember recent interactions, learn from the user, global controls, explain | Amershi et al. (CHI 2019) | **Memory** the operator keeps (M11); **personality dials** (M13) |
| Calm technology: inform in the periphery, minimal attention | Weiser & Brown 1995; Case 2015 | **Ambient orb** (M12): the crew's state at a glance from any program |

## Milestones

| | Milestone | Status |
|---|---|---|
| M1 | Voice tab, neural offline voices, effects, signals, auto-send, spoken answers | ✅ 0.4.0 |
| M2 | Operator role: snapshot, actions, events, voice confirmations | ✅ 0.4.0 |
| M3 | Board: cards, arrows, frames, live agent cards, pictures, sharing as `.cockpit/BOARD.md` | ✅ 0.4.0 |
| M4 | Living board: agent start/finish update their cards, results are pinned | ✅ 0.4.0 |
| M5 | Presenting: `[[card]]` markers in spoken answers make the card glow at that sentence | ✅ 0.4.0 |
| M6 | Decide by voice: agent permission prompts reach the operator, "yes" answers them | ✅ 0.4.0 |
| M7 | Several boards per project (plan, architecture, ideas…) | ✅ 0.4.0 |
| M8 | Review chain: a finished worktree agent is reviewed by a second model, tests run, merge by voice | ✅ 0.4.0 |
| M9 | Barge-in: speak while it talks and it stops and listens (echo-aware, mic open while it speaks) | ✅ 0.4.0 |
| M10 | Wake word ("Atlas, …") without pressing anything, fully local, command in the same breath | ✅ 0.4.0 |
| M11 | Memory across sessions: preferences and decisions the operator keeps and uses | ✅ 0.4.0 |
| M12 | Ambient HUD: a tiny always-on-top orb with the crew's state, glanceable from any program | ✅ 0.4.0 |
| M13 | Personality dials (humour, brevity, initiative) like TARS | ✅ 0.4.0 |
| — | Faster turns (0.9 s), attention-aware delivery at breakpoints, undo on the board | ✅ 0.4.0 |
| M14 | Streaming answers: speak the first sentence while the model still writes | ⚠️ built, opt-in — measured: Claude Code draws an answer only when it is complete (~0.3 s gain); needs a streaming channel from the CLI |
| M15 | Backchannels: a soft “mhm” in your breath pauses while you speak longer | ✅ 0.4.0 |
| M16 | Learning when not to interrupt: the pause it waits for adapts to how you react | ✅ 0.4.0 |
| M18 | Presenting board: web / picture / video / topic cards, camera that follows the explanation, cursor, subtitles, research | ✅ 0.4.0 |
| M19 | The operator sees the board as an image (vision) and arranges it for readability itself — plus a layout check in every snapshot | ✅ 0.4.0 |
| M20 | Natural fillers while it thinks: “Okay.” → “Moment.” → “Ich bin noch dran.”, in the answering voice, worded for question/task and the agent's usual pace | ✅ 0.4.0 |
| M17 | Its own words while it works: the sentence the agent writes before a tool call is read from the transcript at the next tool start and spoken at once — measured live: first own sentence after **6.0 s**, final answer after 39 s (token streaming from the interactive CLI is not available) | ✅ 0.4.0 |
| M22 | Slides: the board as a presentation — overview, then frame by frame; camera, narration with glow and subtitles, “weiter / zurück / tiefer / Ende” by voice, the operator presents too (verified live: 12 s to start, 8 s per slide) | ✅ 0.4.0 |
| M25 | Board magic: materialising cards, sparks, comet trail, aurora, slide titles; charts / big numbers / tables, pen marks, spotlight; slides from documents; reminders at slides; emotional voice; engine pool | ✅ 0.4.0 |
| M24 | Hands-free presenting (pause for questions, then the next slide), slides as PDF, HD voices + pitch, Codex interim speech | ✅ 0.4.0 |
| M23 | “Warte” / “weiter”: an interrupted answer waits and continues from the sentence it stopped in | ✅ 0.4.0 |
| M21 | Fillers that say what it does: “Ich lese gerade bei MDN nach.”, “Ich suche kurz im Netz.” from the live tool activity | ✅ 0.4.0 |
