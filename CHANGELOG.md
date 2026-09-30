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

[Unreleased]: https://github.com/darkcool70/robs-ai-cockpit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/darkcool70/robs-ai-cockpit/releases/tag/v0.1.0
