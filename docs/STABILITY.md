# Stability and account login

Claude login uses the official `claude auth login --claudeai` flow. On Windows,
the cockpit routes its browser opener to a fresh Edge InPrivate or Chrome Incognito
window with a unique browser data directory for every login attempt. This prevents
the last browser account from being selected implicitly. Complete authentication
yourself in that window; the cockpit never reads passwords, cookies or tokens.
Browser profile metadata lives under `~/.ai-cockpit/login-browser/`. Private browsing
does not retain signed-in cookies after its windows close. Close the login window
after completing or cancelling authentication. Other platforms currently need the
normal CLI login flow (`separateBrowser: false` at the command API).

Only official HTTPS authentication hosts are accepted by the browser helper.
No fallback opens a potentially wrong account in the default browser. If neither
Edge nor Chrome exists, a visible error explains the requirement. Existing global
CLI profiles still share credentials with external terminals using that directory;
use a managed profile for independent accounts. Login changes are refused while
that account has running cockpit sessions.

Model observations and requested models are separate database fields. Only a model
explicitly entered for a new session is passed as `--model`. Runtime observations
use the canonical model ID and cannot turn a display name into a startup override.
The migration lets already-started legacy sessions resume using the CLI's saved
model, because their original user choice cannot reliably be reconstructed.

Start/restart/close operations are serialized in the backend. Duplicate starts are
rejected before modifying runtime state. Restart waits for the previous exit
callback; a timeout leaves the session available for a retry. The frontend blocks
repeat launch clicks, waits for terminal attachment, and retains panes when closing
fails. Startup errors have a visible Retry action. Terminal layers cannot cover the
Resume button.

## Typing into a CLI (start task, auto-continue, broadcast)

Text is never written blindly. Each PTY also feeds a virtual screen (`vt100`), because TUIs redraw
with cursor movements and the raw stream does not show what is visible. Queued text is typed only
when output has been quiet for 1.5 s, the screen is not empty, no trust / onboarding / login
dialog is visible, and the input box is ready: Claude via the `SessionStart` hook (or its footer
when hooks are off), Codex via its composer ("Ask Codex to do anything", "context left",
"? for shortcuts"). Multi-line text is sent as a bracketed paste, then Enter.

Auto-continue schedules the reset time printed by the CLI plus 90 s, else the latest quota
snapshot of an exhausted window, else the retry interval. After typing it checks that the CLI
starts working (hook / rollout event) and retries once (a menu may take the first Enter); after 12
failed attempts it stops. Typing in the terminal before the scheduled time cancels it.
Repeated limit messages after input count as new events.

Failover copies only the conversation's own files (`projects/<slug>/<id>.jsonl` plus its folder
for Claude, `sessions/**/rollout-*<id>.jsonl` for Codex) into the other profile, stops the old
process first and resumes in a new pane. Nothing leaves the machine.

## Voice input

Recording uses cpal (WASAPI) in its own thread; samples are mixed to mono, resampled to 16 kHz and
normalised. Recordings shorter than 0.35 s, or with less than 250 ms of frames clearly above the
recording's own noise floor, are discarded: Whisper otherwise invents text from room noise.
Known subtitle hallucinations ("Untertitel…", "Vielen Dank.") are filtered as well.

`whisper-server` runs on 127.0.0.1 with the model loaded; it is started while the user is still
speaking and restarted only when model or language change. It uses a ~10 s audio window
(`-ac 512`, greedy decoding without fallback): measured on a Core Ultra 5 CPU a 9 s sentence takes
0.9 s instead of 2.7 s with the default 30 s window, with the same text. Longer recordings are
cut into ≤ 9.5 s pieces at the quietest point between 5 and 9.5 s; each piece gets the previous
text as context. No silence padding: measured, it made Whisper mis-hear the first words. It is assigned to a Windows job object
with KILL_ON_JOB_CLOSE, so it ends with the cockpit even after a crash. Downloads come from pinned
URLs (whisper.cpp release b5130, Hugging Face models) and are verified against pinned SHA-256
hashes before use; only the server binary and its DLLs are extracted.

Shortcuts are registered system-wide through the global-shortcut plugin and re-synced whenever
sessions or settings change; one that cannot be registered (used by another program) is reported.
While a new shortcut is being recorded, all voice shortcuts are paused. Ctrl+Alt with keys that
are AltGr characters on German keyboards ({ [ ] } @ € µ \ ~ |) is refused. The default
"focused pane" shortcut is Alt+Shift+Space (Ctrl+Alt+Space is commonly taken).

## Process lifetime

Every process the cockpit starts — agent CLIs in their pseudo consoles and the speech server —
joins one Windows job object with KILL_ON_JOB_CLOSE. If the cockpit is closed, crashes or is
ended in Task Manager, Windows ends them as well; nothing keeps running unseen (verified by
force-killing the app with a running session).

ConPTY asks the terminal for the cursor position when a process starts and waits for the
answer. Normally the pane's xterm replies. For a session started without a pane (in the
background, off-screen) the backend answers instead, so it never hangs at startup.

Queued text (start task, loops, auto-continue, replies) is dropped only when the process has
really exited — not in the few milliseconds between registering a session and spawning it. When
a queued task waits for a dialog only the user should answer (trust this folder, login), the
session shows a notice and the pop-up says so.

Environment markers of a surrounding Claude Code session (`CLAUDE_CODE_CHILD_SESSION`,
`CLAUDECODE`, …) are removed from agents: inherited, they switch transcript saving off.

## Activity, notifications and loops

Claude: hook events (`--details`: tool name, file path, short command/prompt excerpts, never tool
output) and the transcript tail for the last answer. The idle reminder notification ("Claude is
waiting for your input") is not treated as a request for input. Codex: its rollout log
(`task_complete.last_agent_message`, commands, patches) plus git changes in the working
directory, attributed to agents that are working at that moment. Stored locally in `activity`
(pruned after 30 days); `activityDetails` switches the details off.

The heads-up window is created hidden at startup and shown with SW_SHOWNOACTIVATE /
HWND_TOPMOST, so it never steals keyboard focus. Pop-ups appear when the session is not on
screen (or always, per setting) and expire after a configurable time, paused while hovered.

Loops decide with a pure function (`automation::decide`): send the next prompt when the agent
finished the previous turn (hook / rollout signal; for CLIs without signals: settled output 8 s
after sending) plus the configured pause; wait during usage limits; finish after N prompts or on
the stop phrase. Progress written by the monitor applies only while the loop is still running in
the database, so a pause from the UI always wins. Closing a session pauses its loops; moving a
conversation to another account moves them along.

## Codex profile paths

Codex keeps a local socket at `<CODEX_HOME>/app-server-control/app-server-control.sock`; socket
paths are limited to 108 characters, also on Windows. Profile slugs are capped at 24 characters and
the cockpit refuses Codex directories whose socket path would be too long.

## Verification

Run `pnpm test`, `pnpm build`, and `cargo test --lib` in `src-tauri`.
The regression suite covers rapid Resume clicks, close failures, startup retry,
model migration, canonical model detection and authentication URL validation.

For Windows integration checks, launch a debug build with an **isolated, short**
`AI_COCKPIT_HOME` (Codex socket limit, see above) and
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230`.
Run `node scripts/integration-check.mjs`. It creates test accounts and a project,
clicks actual Start/Resume controls, verifies process lifecycle and history reopen,
and starts the official login flow. It does not sign in or send model prompts. A session only starts rendering once a terminal
pane answers the console's startup cursor query, so show sessions in a pane when scripting.
`pty_screen` returns the visible text of a session for assertions. Auto-continue, team start and
failover can be exercised without any quota by pointing `claudePath` / `codexPath` at a small
script that prints a limit message and echoes its input.
Close the test login and app afterwards. Do not enable debugging in normal use.

OAuth completion, account entitlements and actual inference require the user's
login and are not simulated by these checks.
