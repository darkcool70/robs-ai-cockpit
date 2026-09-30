# Development

## Prerequisites (Windows 11)

* Node 22+, pnpm 10
* Rust stable (rustup, MSVC toolchain) + **Visual Studio 2022 Build Tools** with the C++ workload and Windows SDK
* WebView2 runtime (preinstalled on Windows 11)
* Optional for real sessions: `claude` (Claude Code) and `codex` (Codex CLI). The Codex CLI bundled
  with the Codex desktop app (`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`) is detected automatically.

```bash
pnpm install
pnpm tauri dev          # app with hot reload
pnpm test               # frontend unit tests (vitest)
cd src-tauri && cargo test   # backend tests
pnpm tauri build        # NSIS installer in <target>/release/bundle/nsis
```

### Cargo target directory

Optional: if the repo lives in a synced folder (OneDrive, Dropbox …), redirect the build output
outside it with an (untracked)
`src-tauri/.cargo/config.toml`:

```toml
[build]
target-dir = "C:/Users/<you>/.cache/ai-cockpit-target"
```

### Isolated test data

`AI_COCKPIT_HOME=<dir>` moves the database, managed profiles and run files — use it for manual
testing so your real `~/.ai-cockpit` is untouched.

### Driving the UI from scripts

`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9229` exposes the WebView over CDP
on localhost (dev only). `window.__TAURI_INTERNALS__.invoke(cmd, args)` calls backend commands.

## Layout

```
src/                     React UI
  lib/api.ts             typed command wrappers (mirror of commands.rs)
  lib/terminals.ts       xterm instance cache, output routing, shortcuts passthrough
  lib/format.ts          number/time formatting (tested)
  store.ts               Zustand app store + event listeners
  components/, views/
src-tauri/src/
  commands.rs  cli.rs  pty.rs  monitor.rs  detect.rs  sink.rs  git.rs
  store.rs  db.rs  paths.rs  error.rs  usage/{mod,claude,codex,aggregate}.rs
```

## Rules

* Migrations are append-only (`db::MIGRATIONS`); add a test when adding one.
* Never hold a `parking_lot` guard across a call that may lock again — bind results first
  (`let x = f(&db.lock()); if let … = x`). Never emit Tauri events while holding a lock.
* Tauri commands must not run on the main thread (`#[tauri::command(async)]` or `async fn`).
* PTY reader threads must never block (they only push into a channel).
* Nothing in the backend may open credential files; add parsers only for `*.jsonl` logs.
* Integration with real CLIs is verified manually (see below); unit tests never pretend a CLI exists.

## Test coverage

| Area | Tests |
|---|---|
| Account isolation / command construction / Windows paths / `.cmd` shims | `cli.rs` |
| Path containment (managed-dir deletion guard) | `paths.rs` |
| Process lifecycle: output, env, exit code, kill, double start, missing binary (real ConPTY) | `pty.rs` |
| Status derivation | `monitor.rs` |
| Migrations (fresh, idempotent, upgrade with data) | `db.rs` |
| Usage parsing, malformed lines, duplicates, partial lines, re-index, timezone normalisation | `usage/*` |
| Aggregation, ranges at local midnight, price matching | `usage/aggregate.rs` |
| Sink sanitisation (no prompt/tool data) | `sink.rs` |
| Git porcelain parsing, worktree lifecycle refusing dirty removal (real git) | `git.rs` |
| Auth status interpretation (no identifying data kept) | `commands.rs` |
| Formatting, arg splitting, fuzzy match | `src/lib/*.test.ts` |

## Manual verification log (MVP)

Verified on Windows 11, Claude Code 2.1.158, Codex CLI 0.154.0-alpha:

* Two Claude sessions + one Codex session running interactively side by side (2- and 3-pane layouts).
* Claude `--settings` injection: hooks and statusLine delivered to the sink; model captured;
  idle → working → waiting-for-input transitions.
* Claude auth error ("401 OAuth access token has expired") detected and surfaced.
* Codex: rollout discovered by cwd/start time, provider session id + model captured,
  idle → working → waiting-for-input, live `rate_limits` → quota snapshots.
* Managed profile correctly reports "Not logged in" while default profiles are connected.
* App exit terminates all child CLIs.
