# Usage analytics & quota

## Three kinds of numbers — never mixed

| Kind | Source | Shown as |
|---|---|---|
| **Measured tokens** | Provider-written local session logs, parsed read-only | "measured" |
| **Estimated value** | Measured tokens × *your* configured API prices | "Estimated API-equivalent value" |
| **Quota / plan usage** | Values the official CLI itself reports (statusLine, rollout `rate_limits`) | percentage + source + capture time |

Nothing is invented. If a value is unavailable, the UI says so ("Quota details available in /status").
"Actual additional API spend" is always `$0`: subscription logins are used and API-key env vars are
stripped from every session.

## Provider adapters (`src-tauri/src/usage/`)

### Claude — `claude.rs`
* Files: `<CLAUDE_CONFIG_DIR>/projects/**/*.jsonl` (includes sub-agent sidechains).
* Lines with `type=assistant` and `message.usage`:
  `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`,
  `output_tokens_details.thinking_tokens` (reasoning, informational).
* Claude writes one line **per content block** with identical usage → records are keyed by
  `message.id + requestId` and upserted (max of values), so duplicates and re-copied history
  (resume/fork) are counted once.
* `<synthetic>` model entries and zero-usage lines are ignored.
* The transcript format is internal to Claude Code; unknown/malformed lines are skipped.

### Codex — `codex.rs`
* Files: `<CODEX_HOME>/sessions/**/rollout-*.jsonl` and `archived_sessions/`.
* `event_msg/token_count.info.total_token_usage` is **cumulative** and frequently re-emitted with
  the same value. The adapter stores the *delta* against the previous total of the same file
  (parser state persisted in `indexed_files.state`). If a total ever decreases (reset), it falls
  back to `last_token_usage`.
* OpenAI semantics: `cached_input_tokens ⊂ input_tokens`, `reasoning_output_tokens ⊂ output_tokens`.
  Normalised to: input = input − cached, cache read = cached, output = output (reasoning shown as
  "of which").
* Model from `turn_context.model`, session id / cwd from `session_meta`.

### Normalised record
`UsageRecord { provider, accountId, providerSessionId, projectPath, ts (UTC ms), model,
inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, source, confidence }`

**Total** = input + output + cache read + cache write (reasoning is not added again).

## Incremental indexing

`indexed_files(path, size, mtime, offset, state)`: unchanged files are skipped by size+mtime; changed
files are read from the stored byte offset and only **complete** lines are consumed (a writer
mid-flush never produces half records). A file that shrank is re-read from 0; dedup keys prevent
double counting. Runs 3 s after launch and every 60 s (Settings), or via "Index logs now".

Note: Claude Code deletes transcripts older than `cleanupPeriodDays` (default 30). Usage already
indexed stays in the cockpit database.

## Aggregation

Ranges: Today (local midnight), 7 days, 30 days, all time. Breakdowns by provider, account, model,
project (cwd), session, day, ISO week, hour of day; cache hit ratio = cache read / (input + cache
read + cache write); GitHub-style heatmap of the last 53 weeks.

## API-equivalent value

Settings → prices per model pattern (USD / 1M tokens for input, output, cache read, cache write).
Case-insensitive substring match; longest pattern wins. No prices ship with the app — enter current
public list prices yourself. Unpriced models are listed.

## Quota sources (in priority order)

1. **Documented machine-readable CLI output**
   * Claude Code: the **statusLine** command receives JSON including
     `rate_limits.five_hour.used_percentage/resets_at` and `rate_limits.seven_day…`
     (claude.ai subscribers, after the first response of a session). The cockpit registers its own
     statusLine for cockpit sessions via `--settings` and stores snapshots (`source=claude-statusline`).
2. **Documented CLI command** — `/status`, `/usage` inside the TUI. Offered as "Open /status"
   (utility terminal). Not scraped.
3. **Reliable local provider state**
   * Codex writes `rate_limits.primary/secondary` (`used_percent`, `window_minutes` 300 / 10080,
     `resets_at`) into its rollout logs; captured during indexing and live while a session runs
     (`source=codex-rollout`).
   * `codex app-server` exposes account/rate-limit RPCs but is marked *experimental*; not used yet.
4. **Fallback** — neutral "Quota details available in /status".

Snapshots older than 6 h are marked "may be outdated". No undocumented web endpoints are called.

## Rate-limit detection (`detect.rs`)

Conservative phrase matching on ANSI-stripped output for "usage limit reached", "5-hour limit
reached", "You've hit your usage limit", auth errors (`Please run /login`, `OAuth token has expired`)
and "approaching usage limit". A detection counts only if it happened after the user's last
input. On a limit, the UI *suggests* starting a new session with another connected account of the
same provider — it never switches automatically. On an auth error the account is shown as
"Login expired" until a login flow or an explicit re-check.
