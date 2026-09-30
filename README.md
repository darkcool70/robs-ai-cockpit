<div align="center">

<img src="assets/logo.png" width="96" alt="Robs AI Cockpit logo" />

# Robs AI Cockpit

**Run several official Claude Code and OpenAI Codex CLI sessions side by side — across multiple
accounts — with notifications, loops, voice input, token analytics and quota visibility.**

[![CI](https://github.com/darkcool70/robs-ai-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/darkcool70/robs-ai-cockpit/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/darkcool70/robs-ai-cockpit?include_prereleases&sort=semver)](https://github.com/darkcool70/robs-ai-cockpit/releases)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Platform: Windows 11](https://img.shields.io/badge/platform-Windows%2011-0078D6)
![Built with Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)

</div>

<!-- Screenshot: save a screenshot as docs/images/cockpit.png and remove this comment's markers.
<p align="center"><img src="docs/images/cockpit.png" alt="Robs AI Cockpit with four agent panes" width="900" /></p>
-->

Robs AI Cockpit is a local-first desktop app and the control plane for your AI coding agents. The
official `claude` and `codex` binaries do all the work and handle authentication themselves. The
cockpit launches them in real terminals, keeps accounts isolated, tells you the moment an agent
needs you, and reads their local logs (read-only) to show what happened.

**No backend. No telemetry. No API keys. No stored credentials.**

```
┌────────────┬──────────────────────┬──────────────────────┐
│ Projects   │ Claude A  [terminal] │ Claude B  [terminal] │
│ Sessions   ├──────────────────────┼──────────────────────┤
│            │ Codex     [terminal] │ + New session        │
├────────────┴──────────────────────┴──────────────────────┤
│ ● Claude A 5h 68% wk 39%  ● Claude B …  ● Codex 5h 0%    │
└──────────────────────────────────────────────────────────┘
```

## Highlights

* **1–8 live terminal panes**: resizable grid or tabs. Every pane runs the real CLI and stays
  fully interactive.
* **Mission control** (`Ctrl+0`): every agent at a glance. It shows what each one is doing right
  now, its last answer, changed files, git state, context % and loop progress, and you can reply
  right from the card.
* **Notifications that find you**: a pop-up bottom-right, on top of every program and without
  stealing focus, when an agent is done, needs input or hits a limit. You can reply or dictate
  from the pop-up. Optional phone push via ntfy.
* **Multiple accounts**: any number of Claude / Codex profiles, each isolated in its own
  `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. It shows 5-hour and weekly quota with the time until reset.
* **Auto-continue after usage limits**: the cockpit waits for the reset and types "continue" for
  you.
* **Loops, prompt queues and a task board**, with auto-dispatch to idle agents, a night shift,
  and a git worktree per task.
* **Voice input**: local whisper.cpp with system-wide push-to-talk, per-pane shortcuts and spoken
  commands. Audio never leaves your computer.
* **Token analytics**: measured from the providers' local logs. Breaks down by provider,
  account, model, project, session, hour and day, and shows the cache hit rate.

<details>
<summary><b>All features</b></summary>

* **Overview (mission control, Ctrl+0)**: every agent at a glance, agents waiting for you first.
  Each card shows what the agent is doing right now ("Editing store.ts", "Running npm test") and
  for how long, its last answer, files changed this turn, git branch and uncommitted files,
  context % and loop progress. You can reply or dictate right from the card. It shows tokens today
  (click for per hour, account, model, cache hit rate and API-equivalent value) and per agent. For
  each account it shows quota with a reset countdown, the pace over the last hour, and a warning
  when the limit will be reached before the reset. There is also "Resume all" after a restart, a
  list of recently changed files (diff view, open in Cursor / VS Code) and an activity timeline.
* **Tasks**: a board with the columns open · running · review · done. Drag a task onto an agent
  or use "Give to…". When the agent finishes, its answer lands in "Review" (feedback, review by
  another agent, done).
* **Review & commit**: every uncommitted change of a repository as per-file diffs, with the agent
  that last edited each file. Commit with a message, or let an agent commit.
* **Workflow helpers**:
  * saved workspaces (pane layouts)
  * focus mode
  * roles (Coder, Tester, Reviewer, Docs, Planner or your own)
  * a recommended account with the most quota left
  * a `/compact` hint at 85 % context
  * a warning when two agents edit the same file
  * handing an answer to another agent
  * full-text search over all conversations
  * a Markdown week/month report
  * spoken commands
  * an F1 shortcut overview
* **Automation**:
  * auto-dispatch of tasks to ⚡ agents
  * a night shift with report and push
  * a git worktree per task with "merge & done"
  * tests after every turn
  * hang detection
  * daily token budgets per project
* **More ways to work**:
  * other terminal CLIs as agents (Gemini CLI, Aider, Ollama …)
  * phone remote in your home network (secret link)
  * reading answers aloud
  * dropping files onto a pane
  * prompt history and favourites
  * pins with notes
  * a light theme and a font size per pane
  * updating from source
* **Loops & templates**: prompt queues (each prompt is sent once, when the agent has finished the
  previous one) and loops (N rounds, or until a stop phrase). You can pause, stop and reset them.
  A prompt template library is also available in the command palette.
* **Accounts**: any number of Claude / Codex profiles, grouped by provider. Logins run the CLI's
  own flow in a fresh private browser window. Login state is re-checked in the background.
* **Session options**:
  * autonomy (Manual · Plan · Edits auto · Auto mode · Full access), mapped to
    `--permission-mode` or to the Codex sandbox and approvals
  * model and effort, taken from each account's catalog
  * additional directories and extra system instructions
  * a fallback model, Chrome (Claude) and web search (Codex)
  * a *start task* that is typed in once the CLI is ready
  * per-project defaults
* **Auto-continue**: when a CLI reports a usage limit, the cockpit reads the printed reset time
  (else quota data, else a retry interval), waits, then types "continue" (configurable). An
  exited process is resumed first.
* **Team start & broadcast**: start several agents in one project, optionally with one git
  worktree each and a common task, and send one message to several agents.
* **Voice input**: a system-wide shortcut per session plus one for the focused pane (default
  Alt+Shift+Space), and Alt+Shift+1…8 for panes 1–8. You can tap or hold to talk. Transcription
  runs locally with whisper.cpp. Voice detection guards against hallucinated text. There are also
  vocabulary hints and microphone selection, and the model is a one-time, checksum-verified
  download.
* **Git**: an inspector with branch, HEAD, dirty files and diff stats. You can create isolated
  `.worktrees/<name>` per agent, and removal is safe (dirty worktrees are refused).
* **History**: every session with project, agent, account, model, duration and tokens, with
  filters.
* **Usage analytics**: measured tokens from provider logs for today / 7 d / 30 d / all time,
  broken down by every dimension. Includes an activity heatmap and an *API-equivalent value* from
  your own price table.
* **Quota**: 5-hour and weekly usage, from documented/local sources only (Claude statusLine JSON,
  Codex rollout `rate_limits`).
* **Security page**: shows where data lives, what is read, and which processes are running.
  Telemetry is off. Also offers export and wipe.
* **Keyboard**:
  * `Ctrl+N` new session, `Ctrl+Shift+N` new pane
  * `Ctrl+P` command palette, `Ctrl+0` overview
  * `Ctrl+1…9` focus a pane, `Ctrl+W` close a pane
  * `Ctrl+Shift+F` focus mode
  * `Ctrl+Shift+C/V` copy/paste in terminals

</details>

## Installation

### Download

1. Download the latest `Robs AI Cockpit_x.y.z_x64-setup.exe` from
   [**Releases**](https://github.com/darkcool70/robs-ai-cockpit/releases).
2. Run the installer. The builds are not code-signed yet, so Windows SmartScreen may warn you.
   Choose *More info → Run anyway*.

### Requirements

* Windows 11 (Windows 10 with the WebView2 runtime should work but is untested)
* At least one agent CLI on your `PATH`:
  * [Claude Code](https://docs.anthropic.com/en/docs/claude-code): `claude`
  * [Codex CLI](https://github.com/openai/codex): `codex`. The Codex CLI bundled with the Codex
    desktop app is detected automatically.
* A subscription or account for each provider you use

### Build from source

```bash
pnpm install
pnpm tauri dev      # run with hot reload
pnpm tauri build    # NSIS installer
```

Prerequisites (Node 22+, pnpm 10, Rust stable, Visual Studio Build Tools) and details are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Getting started

1. **Accounts → Add account**: for example *Claude A*, *Claude B* and *Codex* (or use *Quick
   setup*). To reuse an existing login, pick "existing directory" and leave the path empty.
2. Click **Login with …** and complete the provider's own browser flow.
3. Add a project directory in the sidebar, press `Ctrl+N` and pick an account.

## Privacy

* Everything stays on your computer: the SQLite database and run files are under
  `~/.ai-cockpit`.
* The cockpit never reads or stores passwords, OAuth tokens or cookies. Logins are done by the
  official CLIs.
* API-key environment variables are stripped from every spawned CLI, so your subscription logins
  are used and you are never billed per token by accident.
* The only network traffic the cockpit itself causes is opt-in: the voice model download, phone
  push and phone remote. See [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | components, decisions, lifecycle |
| [SECURITY](docs/SECURITY.md) | trust model, data at rest, what is never done |
| [ACCOUNT_ISOLATION](docs/ACCOUNT_ISOLATION.md) | how profiles are separated |
| [USAGE_ANALYTICS](docs/USAGE_ANALYTICS.md) | parsers, dedup, quota sources |
| [STABILITY](docs/STABILITY.md) | lifecycle guarantees, login isolation, verification |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | setup, tests, conventions |

## Contributing

Bug reports, ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
first. Security issues: please report them privately, as described in [SECURITY.md](SECURITY.md).

## Disclaimer

Robs AI Cockpit is an independent open-source project. It is **not affiliated with, endorsed by
or sponsored by Anthropic or OpenAI**. "Claude" and "Claude Code" are trademarks of Anthropic,
PBC. "OpenAI" and "Codex" are trademarks of OpenAI. They are used here only to describe
compatibility.

The cockpit only starts the official CLIs; it does not access provider APIs itself. You are
responsible for using your accounts in line with each provider's terms of service and usage
policies. This includes running several accounts and moving a conversation to another account.

## License

[Apache License 2.0](LICENSE) © 2026 Robert Bansimer
