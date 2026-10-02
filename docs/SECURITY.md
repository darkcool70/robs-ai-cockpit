# Security & trust model

Robs AI Cockpit is a **local control plane** around the official `claude` (Claude Code) and
`codex` (OpenAI Codex CLI) binaries. It is not a model client, not a proxy and has no backend.

## Trust boundaries

```
┌──────────────────────────── your Windows user account ────────────────────────────┐
│                                                                                     │
│  Robs AI Cockpit (Tauri)                official CLIs (trusted, unmodified)       │
│  ┌───────────────────────────┐  spawn    ┌─────────────────────┐   HTTPS            │
│  │ WebView UI  ── IPC ──►    │ ───PTY──► │ claude / codex      │ ─────────► Anthropic│
│  │ Rust core                 │           │ (own auth, own      │ ─────────► OpenAI   │
│  │  • SQLite metadata        │ ◄─files── │  config dir)        │                     │
│  │  • read-only log indexer  │           └─────────────────────┘                     │
│  └───────────────────────────┘                                                        │
│        ▲ no network                                                                   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

* **Trusted:** the official CLIs you installed, your OS user account, your project files.
* **The cockpit is trusted with:** starting those CLIs, reading their *local* logs read-only,
  and storing metadata. It is **not** trusted with credentials and never receives them.
* **Out of scope:** malware already running as your user (it could read the CLIs' credential
  files directly, with or without the cockpit).

## What the cockpit never does

| Never | How it is enforced |
|---|---|
| Ask for / store passwords | There is no password field anywhere. Login = the CLI's own `claude auth login` / `codex login`, run in a visible terminal pane. |
| Copy OAuth tokens | The indexer only opens `*.jsonl` session logs; credential files (`.credentials.json`, `auth.json`) are never opened. Auth status comes from `claude auth status --json` / `codex login status`, and only non-identifying fields (logged in? subscription type) are kept — no e-mail, no org id. |
| Use API keys by default | Every spawned CLI has `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY` removed from its environment so subscription logins are used. A profile that is logged in via API key is flagged "API login". |
| Proxy model traffic | The CLIs talk to their providers directly. The cockpit contains no HTTP client. |
| Upload code / sessions | No backend exists. No telemetry, analytics SDK, crash reporter or auto-updater is included. |
| Call private provider endpoints | Quota numbers come only from documented/local sources (see USAGE_ANALYTICS.md). |
| Silently switch accounts | Rate-limit detection only *suggests* another account; the user must click. |
| Delete things outside its own directories | Profile deletion is only allowed for dirs under `~/.ai-cockpit/profiles` (checked lexically, case-insensitive, `..` resolved). Worktree removal refuses dirty worktrees and never uses `--force`. Project removal never touches files. |

## Data at rest

| Location | Content |
|---|---|
| `~/.ai-cockpit/cockpit.db` | Projects (name, path), account nicknames + config dir (+ the login email / organisation that `claude auth status` reports, to tell profiles apart), session metadata (name, cwd, status, times, model, provider session id, transcript path), numeric token counts, quota percentages, prices, settings, audit log, loops and prompt templates you wrote. With **activity details** on (default; Settings → Notifications & activity): an activity timeline with paths of changed files, short excerpts of your prompts (≤ 300 chars), of commands the agent ran (≤ 200) and of the agent's last answer (≤ 1200), kept 30 days. **Never tool output, code contents, tokens or passwords.** |
| `~/.ai-cockpit/stt/` | The speech engine (whisper.cpp server + DLLs) and model, downloaded on request and verified by SHA-256. Audio is processed in memory and never stored. |
| `~/.ai-cockpit/profiles/<provider>/<name>/` | The isolated config directory *of the CLI* (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). The CLI stores its own login here. The cockpit never reads the credential files. |
| `~/.ai-cockpit/run/<session>/` | Per-session `settings.json` (hook + statusLine registration) and sanitized events (`events.jsonl`, `statusline.json`). |

`AI_COCKPIT_HOME` overrides the root (used for tests).

## Claude hook / statusLine sink

To know whether a Claude session is *working* or *waiting for input*, and to receive the documented
`rate_limits` from the statusLine, each Claude session is started with
`--settings ~/.ai-cockpit/run/<id>/settings.json`. That file registers hooks
(`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`,
`SessionEnd`) and a statusLine, all pointing at the cockpit executable itself:

```
"<path>/RobsAICockpit.exe" sink hook "<run-dir>"
"<path>/RobsAICockpit.exe" sink statusline "<run-dir>"
```

The sink:
* runs without a window and never starts the GUI;
* keeps an allow-list of fields (event name, session id, transcript path, tool **name**, a
  truncated notification message; statusLine: model, rate limits, context %, cost totals) —
  **tool outputs are always discarded**. Only when started with `--details` (activity details
  on) it also keeps file paths and short excerpts of the prompt, the command / search pattern /
  description of a tool call and the last answer; edit contents (`old_string` / `new_string`)
  are never kept;
* refuses to write anywhere outside `~/.ai-cockpit/run`;
* prints nothing for hooks (so nothing is injected into Claude's context).

User settings files are not modified; Claude Code merges the `--settings` source with the user's
own settings, so user hooks keep working. Both features can be disabled in Settings.

## IPC surface

* The webview has only `core:default` and the native open/save/ask dialogs.
* Opening directories in Explorer is a Rust command that resolves the path from a known id
  (account, project, session, data dir). The frontend cannot open arbitrary paths.
* Setting keys are allow-listed; SQL uses bound parameters; the only dynamic column name is
  checked against an allow-list.
* CSP: `default-src 'self'`, no remote scripts, IPC only.

## Processes

* Every session is a ConPTY child of the cockpit. All children are killed when the cockpit exits.
* The Security page lists running processes (PID, provider, cwd).

## Network transparency

The cockpit itself sends no telemetry and talks to no server of its own. The only network
traffic it causes is opt-in and started by you:

| Feature | Traffic |
|---|---|
| Settings → Voice → download | whisper.cpp binary (GitHub release) and model (Hugging Face), checksum-verified, once |
| Phone push | HTTPS POST of agent name + a short answer excerpt to the push URL *you* configure (e.g. ntfy) |
| Phone remote | local HTTP server in your home network, protected by a random secret key; off by default |
| Update from source | `git fetch` / `git pull` of the repository the app was built from |

The CLIs you run (`claude`, `codex`, …) of course talk to their providers — that is their own
traffic, not the cockpit's. Build time: `pnpm` / `cargo` download dependencies. WebView2 is the
system component (updated by Windows). Fonts are local system fonts.

## Reporting

Please report vulnerabilities privately as described in [SECURITY.md](../SECURITY.md) —
not as a public issue.
