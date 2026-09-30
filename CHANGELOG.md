# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/darkcool70/robs-ai-cockpit/releases/tag/v0.1.0
