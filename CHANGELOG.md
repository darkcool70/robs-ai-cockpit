# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/darkcool70/robs-ai-cockpit/releases/tag/v0.1.0
