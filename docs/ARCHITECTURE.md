# Architecture

## Principle

The official `claude` and `codex` CLIs are the execution engines. The cockpit is the control
plane around them: launch, isolate, observe, index, visualise. It never re-implements a model
client and never talks to a provider API.

```
┌────────────────────────────── WebView (React 19 + TS) ──────────────────────────────┐
│ Sidebar (projects, sessions) │ Workspace: panes (xterm.js, cached per session)│Inspector│
│ Views: Accounts · Usage · History · Security · Settings        Zustand store          │
└───────────────▲─────────────── invoke / events ──────────────────────────▲───────────┘
                │                                                          │ pty-output (batched)
┌───────────────┴──────────────────── Rust core (Tauri 2) ────────────────┴───────────┐
│ commands.rs   IPC surface (all run off the main thread)                             │
│ cli.rs        CLI detection + pure command construction (env isolation)             │
│ pty.rs        ConPTY sessions (portable-pty), replay buffer, reader → channel        │
│ monitor.rs    1 Hz: hooks/statusLine (Claude), rollout tail (Codex) → status         │
│ detect.rs     conservative limit/auth phrase detection on output                    │
│ sink.rs       `ai-cockpit sink …` subcommand invoked by Claude hooks/statusLine       │
│ usage/        read-only incremental log indexer + aggregation                       │
│ git.rs        git CLI: status, worktrees (safe add/remove)                           │
│ store.rs/db.rs SQLite (WAL) with append-only migrations                              │
└─────────────────────────────────────────────────────────────────────────────────────┘
           │ spawn (env: CLAUDE_CONFIG_DIR / CODEX_HOME)        ▲ read-only
           ▼                                                     │
   claude.exe / codex.exe  ──writes──►  <config>/projects/*.jsonl, <CODEX_HOME>/sessions/**/rollout-*.jsonl
```

## Key decisions

| Topic | Decision | Why |
|---|---|---|
| Shell | Tauri 2 (not Electron) | Small, Rust backend for PTY/SQLite, no Node runtime in production. No blocker found. |
| PTY | `portable-pty` (WezTerm) → ConPTY | Maintained, cross-platform (macOS/Linux later). |
| Terminal | xterm.js 6 + fit + WebGL (DOM fallback) | Real terminal emulation; the CLIs' TUIs work unmodified. |
| Output transport | reader thread → mpsc → emitter thread (6 ms coalescing) → `pty-output` event | A reader must never block on the UI: a stalled reader stalls ConPTY, which blocks writes. |
| Re-layout | xterm instances cached per session and re-parented | No replay, scrollback survives layout/tab changes. A 1 MB backend replay buffer covers app reloads. |
| Dedup of output | per-session sequence numbers | Snapshot + live events can overlap. |
| Claude session state | documented hooks + statusLine via per-session `--settings` | Reliable working / waiting / model / quota without parsing ANSI. |
| Codex session state | tail the session's own rollout log (`task_started`/`task_complete`) | Local provider state; no private API. |
| Fallback state | output-activity heuristic, labelled as such | Works for any CLI. |
| Conversation id | Claude: pre-assigned via `--session-id`; Codex: discovered from rollout `session_meta` | Enables Resume (`--resume <id>` / `codex resume <id>`) and exact per-session analytics. |
| Persistence | SQLite via rusqlite (bundled), WAL, `user_version` migrations | Single file, fast, tested upgrades. |
| Charts | hand-written SVG | Zero dependencies, dense, no animation. |
| Git | `git` CLI | Respects user config/credentials; no libgit2 build. |

## Session lifecycle

```
create (DB row, not started) → pane mounts terminal (size known) → session_start
  → write run/<id>/settings.json (Claude) → build LaunchSpec → spawn in ConPTY
  → monitor derives: starting → idle → working ⇄ waiting-for-input (→ rate-limited)
  → exit: stopped (user / exit 0) | failed (non-zero)
Restart = stop + start; Claude resumes the same conversation if its transcript exists,
Codex resumes by discovered id. Duplicate = new conversation with same account/cwd/args.
Close = stop + hide (history keeps the row). App start marks stale "live" rows as stopped.
```

## Status derivation (`monitor::compute_status`, unit-tested)

1. exited → `stopped` (user stop or exit 0) / `failed`.
2. limit phrase detected after the last user input → `rate-limited`; auth phrase → attention.
3. provider signal: last hook/rollout event says working → `working`; idle → `waiting-for-input`
   (unless the user answered afterwards and output is streaming again).
4. no provider signal yet → `starting` (no output, < 20 s) / `idle`.
5. heuristic only (utility terminals): recent output after input → `working`, else waiting.

## Data model

`accounts`, `projects`, `sessions`, `layouts`, `settings` (migration 1);
`usage_records` (unique `dedup_key`), `indexed_files` (byte offset + parser state per file),
`quota_snapshots`, `prices` (migration 2); `audit_log` (migration 3).
Timestamps: ISO-8601 UTC strings for metadata, epoch-ms integers for usage/quota
(indexed, range-scanned). Day/hour grouping uses SQLite `localtime`.

## Performance

* Log indexing is incremental (size + mtime + byte offset, only complete lines), background
  every 60 s (configurable), DB lock held only per-file transaction.
* Transcripts are never loaded for analytics beyond the new bytes; only numbers are stored.
* Aggregations are SQL `GROUP BY` over indexed `ts` columns.
* All IPC commands run on Tauri's async runtime, never on the UI thread.

## Cross-platform notes

Windows-first. Things that differ elsewhere: Claude credentials in Keychain on macOS (isolation
via `CLAUDE_CONFIG_DIR` still applies), `.cmd` shim wrapping is Windows-only, known install
locations in `cli::candidate_paths`. PTY, SQLite, paths and UI are portable.
