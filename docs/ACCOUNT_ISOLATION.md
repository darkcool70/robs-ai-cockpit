# Account isolation

Multiple subscriptions (e.g. **Claude Pro A**, **Claude Pro B**, **Codex / ChatGPT**) are kept apart by
giving each profile its own configuration directory — the mechanism the CLIs themselves support.

| Provider | Env var | Default | Where the login lives |
|---|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude` (+ `~/.claude.json`) | `<dir>/.credentials.json` on Windows (Keychain on macOS) |
| Codex CLI | `CODEX_HOME` | `~/.codex` | `<dir>/auth.json` |

Verified on this machine (Claude Code 2.1.158, Codex CLI 0.154): an empty `CLAUDE_CONFIG_DIR`
reports `loggedIn:false`, an empty `CODEX_HOME` reports "Not logged in", while the default
directories stay logged in — i.e. isolation is real.

## Profile types

* **Managed** (recommended): `~/.ai-cockpit/profiles/<provider>/<slug>`. Created empty; you log in
  once via *Login with Claude* / *Login with ChatGPT / Codex*, which runs
  `claude auth login --claudeai` or `codex login` in a terminal pane. The CLI opens the browser and
  stores its own tokens in that directory.
* **Existing directory**: point a profile at a directory you already use (e.g. `~/.claude`). Useful
  to reuse your current login. The cockpit never deletes such a directory.

Special case: when a profile points at the CLI's *default* directory, the cockpit does **not** set
the env var (Claude resolves `~/.claude.json` differently when `CLAUDE_CONFIG_DIR` is set, which
would look like a logged-out account). Inherited values are still removed, so the default applies.

## Launch environment (per session)

Built by `cli::build_agent_command` (unit tested):

* removed: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`
* set: the profile's config env var (unless default dir), `TERM=xterm-256color`, `COLORTERM=truecolor`
* cwd: the project directory or a git worktree of it

## What is *not* isolated

* **Project-level config** (`<repo>/.claude/`, `<repo>/.codex/`, `CLAUDE.md`, `AGENTS.md`) is shared by
  every account that works in that repo — this is intentional, it is project configuration.
* **Global tools** such as `git` credentials, SSH keys and MCP servers started by the CLIs run as
  your Windows user in all profiles.
* Claude **managed/enterprise policy** files apply to every profile.

## Removing a profile

## Choosing another Claude account

The account card's **Sign in with another Claude account** button opens the official
login flow in a fresh private browser context on Windows. Browser cookies from
another profile are not reused. Authentication remains in the selected CLI config
directory. Stop that account's running sessions before changing its login.
See [stability and verification](STABILITY.md) for requirements and tests.

## Removing a profile

*Remove local profile* deletes only the cockpit's metadata row. For managed profiles you are
asked separately whether to delete the directory (which logs that profile out). Deletion is
refused for anything outside `~/.ai-cockpit/profiles` and while the profile has running sessions.
