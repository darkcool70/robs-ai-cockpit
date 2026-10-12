// Typed wrappers around the Rust command surface. Keep in sync with src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

/**
 * "copilot" (GitHub Copilot CLI) and "antigravity" (Google's agy) run on free tiers (src/lib/providers.ts).
 * "custom": any other terminal CLI (Aider, OpenCode, Ollama …) started by its command line.
 */
export type Provider = "claude" | "codex" | "copilot" | "antigravity" | "custom";

export type SessionStatus =
  | "idle"
  | "starting"
  | "working"
  | "waiting-for-input"
  | "rate-limited"
  /** an API / CLI error ended the turn (runtime.error says what) — not a finished turn */
  | "error"
  | "stopped"
  | "failed";

/** The error that ended an agent's turn (src-tauri/src/failure.rs). */
export interface TurnError {
  kind: "model" | "limit" | "auth" | "server" | "network" | "request" | "unknown";
  message: string;
  at: number;
}

export interface CliInfo {
  provider: Provider;
  path: string | null;
  version: string | null;
  source: string;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  profilesRoot: string;
  runRoot: string;
  exePath: string;
  telemetry: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string | null;
  defaults: ProjectDefaults;
}

/** How much the agent may do on its own. Maps to --permission-mode (Claude) / sandbox+approvals (Codex). */
export type Autonomy = "" | "manual" | "accept-edits" | "plan" | "auto" | "full";

export interface SessionOptions {
  autonomy?: Autonomy | null;
  effort?: string | null;
  addDirs?: string[];
  appendSystemPrompt?: string | null;
  fallbackModel?: string | null;
  webSearch?: boolean;
  chrome?: boolean;
  initialPrompt?: string | null;
}

export interface ProjectDefaults {
  accountId?: string;
  model?: string;
  autoContinue?: boolean;
  options?: SessionOptions;
}

export type AuthStatus = "unknown" | "connected" | "connected-api" | "logged-out" | "expired" | "error";

export interface Account {
  id: string;
  provider: Provider;
  name: string;
  configDir: string;
  managed: boolean;
  color: string | null;
  authStatus: AuthStatus;
  authDetail: string | null;
  authCheckedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  /** Provider "custom": command line that starts the tool. */
  command?: string | null;
  sort: number;
  /** Login email reported by the CLI's status command (Claude). */
  authEmail?: string | null;
  /** Organisation of that login (Claude). */
  authOrg?: string | null;
}

export interface ModelInfo {
  id: string;
  label: string;
  efforts: string[];
}

export interface RuntimeView {
  id: string;
  status: SessionStatus;
  attention: string | null;
  model: string | null;
  providerSessionId: string | null;
  transcriptPath: string | null;
  running: boolean;
  pid: number | null;
  contextPercent: number | null;
  autoContinue: boolean;
  autoContinueAt: number | null;
  autoContinueNote: string | null;
  loginUrl: string | null;
  pendingInput: boolean;
  currentActivity?: string | null;
  /** What it said so far in the running turn (before a tool call). */
  interim?: string | null;
  lastMessage?: string | null;
  lastPrompt?: string | null;
  turnStartedAt?: number | null;
  turnEndedAt?: number | null;
  turnFiles?: number;
  notice?: string | null;
  automation?: AutomationView | null;
  gitBranch?: string | null;
  gitChanged?: number | null;
  /** The error that ended the last turn (status "error", or "rate-limited" for a limit). */
  error?: TurnError | null;
}

export type AutomationMode = "queue" | "loop" | "goal";

export interface AutomationView {
  id: string;
  name: string;
  mode: AutomationMode;
  state: "running" | "paused" | "done" | "stopped";
  sent: number;
  total: number | null;
  note: string | null;
  /** Mode "goal": supervisor's progress estimate, 0–100. */
  progress?: number | null;
}

export interface GoalConfig {
  goal: string;
  criteria?: string | null;
  supervisorAccountId?: string | null;
  supervisorModel?: string | null;
  preamble?: string | null;
}

export interface GoalStep {
  at: number;
  status: "continue" | "done" | "blocked" | "error";
  progress: number;
  summary: string;
  prompt?: string | null;
  question?: string | null;
}

export interface Automation {
  id: string;
  sessionId: string;
  name: string;
  mode: AutomationMode;
  prompts: string[];
  repeat: number;
  delaySec: number;
  stopPhrase: string | null;
  state: "running" | "paused" | "done" | "stopped";
  step: number;
  iteration: number;
  lastSentAt: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  goal?: GoalConfig | null;
  progress?: number | null;
  log?: GoalStep[];
  pending?: string | null;
}

/** Pro edition license (null in the open-source build). */
export interface ProStatus {
  state: "trial" | "active" | "expired";
  trialEndsAt: number;
  plan: "monthly" | "yearly" | null;
  validUntil: number | null;
  keyHint: string | null;
  email: string | null;
  checkedAt: number | null;
  server: string;
}

export type AssistantPower = "advisor" | "builder" | "operator";

/** A named agent with a face, a personality and a goal (see AssistantsView). */
export interface Assistant {
  id: string;
  name: string;
  /** "preset:<id>" or a data:image URL. */
  avatar: string;
  color: string | null;
  soul: string;
  agentMd: string;
  accountId: string | null;
  model: string | null;
  autonomy: string | null;
  projectId: string | null;
  goal: string;
  criteria: string | null;
  supervisorAccountId: string | null;
  supervisorModel: string | null;
  maxRounds: number;
  delaySec: number;
  /** What it may do: advisor (talks, plans), builder (codes, goals), operator (steers the cockpit). */
  power: AssistantPower;
  sessionId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  text: string;
  sort: number;
}

export type ActivityKind = "prompt" | "tool" | "file" | "done" | "limit" | "continue" | "loop" | "input" | "start" | "exit" | "error";

export interface Activity {
  ts: number;
  kind: ActivityKind;
  text: string;
  file: string | null;
}

export interface TimelineItem extends Activity {
  sessionId: string;
  sessionName: string | null;
}

export interface RecentFile {
  file: string;
  ts: number;
  edits: number;
  sessionId: string;
  sessionName: string | null;
  provider: Provider | null;
  exists: boolean;
}

/** Payload of a notification shown in the heads-up window. */
export interface HudNote {
  id: string;
  sessionId: string;
  kind: "done" | "input" | "limit" | "loop" | "failed" | "goal";
  title: string;
  subtitle: string;
  message: string;
  provider: Provider;
  at: number;
  /** Set when the session belongs to an assistant: its face in the pop-up. */
  avatar?: string | null;
  color?: string | null;
  /** Animation mood of the face. */
  mood?: string | null;
}

export interface Session {
  id: string;
  name: string;
  provider: Provider;
  kind: "agent" | "login" | "status";
  accountId: string | null;
  projectId: string | null;
  cwd: string;
  extraArgs: string[];
  options: SessionOptions;
  autoContinue: boolean;
  voiceHotkey?: string | null;
  requestedModel: string | null;
  status: SessionStatus;
  exitCode: number | null;
  model: string | null;
  providerSessionId: string | null;
  transcriptPath: string | null;
  worktreePath: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  lastActivityAt: string | null;
  closed: boolean;
  runtime?: RuntimeView | null;
}

export interface HistoryRow extends Session {
  projectName: string | null;
  accountName: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  usageModel: string | null;
}

export interface HistoryFilter {
  projectId?: string;
  accountId?: string;
  provider?: string;
  model?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  records: number;
}

export interface Group {
  key: string;
  label: string;
  provider: Provider | null;
  totals: Totals;
  apiValueUsd: number | null;
}

export interface Point {
  key: string;
  total: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageSummary {
  range: string;
  fromMs: number | null;
  totals: Totals;
  cacheHitRatio: number | null;
  byAccount: Group[];
  byProvider: Group[];
  byModel: Group[];
  byProject: Group[];
  bySession: Group[];
  byDay: Point[];
  byWeek: Point[];
  byHour: Point[];
  apiValue: { valueUsd: number; pricedTokens: number; unpricedModels: string[] };
}

export interface UsageFilter {
  accountId?: string;
  provider?: string;
}

export interface Price {
  modelPattern: string;
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok: number;
  cacheWritePerMtok: number;
}

export interface QuotaWindow {
  window: string;
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null; // epoch seconds
  source: string;
  capturedAt: number; // epoch ms
}

export type TaskStatus = "open" | "running" | "review" | "done";
export interface Task {
  id: string;
  title: string;
  text: string;
  status: TaskStatus;
  sessionId: string | null;
  result: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
  startedAt: number | null;
  finishedAt: number | null;
  projectId?: string | null;
  worktree?: string | null;
  branch?: string | null;
  tests?: string | null;
}
export interface TaskInput {
  id?: string;
  title: string;
  text: string;
  status?: TaskStatus;
  sessionId?: string | null;
  result?: string | null;
  sort?: number;
  projectId?: string | null;
  worktree?: string | null;
  branch?: string | null;
  tests?: string | null;
}
export interface MergeResult {
  merged: boolean;
  head: string | null;
  conflicts: string[];
  message: string;
}
export interface TestRun {
  ok: boolean;
  code: number | null;
  durationMs: number;
  tail: string;
  timedOut: boolean;
}
export interface Pin {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  sessionName: string | null;
  text: string;
  note: string | null;
  createdAt: string;
}
export interface RemoteInfo {
  url: string;
  port: number;
  /** until when the link's key opens the page (ms) */
  expires: number;
  /** the view-only link for colleagues (board and operator answer, nothing to send) */
  viewUrl: string | null;
  viewExpires: number | null;
}
export interface UpdateInfo {
  repo: string | null;
  branch: string | null;
  head: string | null;
  remote: boolean;
  behind: number | null;
  dirty: boolean;
  building: boolean;
  exe: string;
}
export interface NamedLayout {
  name: string;
  mode: string;
  panes: (string | null)[];
  updatedAt: string;
}
export interface SessionStats {
  sessionId: string;
  sessionName: string | null;
  turns: number;
  workingMs: number;
  waitingMs: number;
  files: number;
  inputs: number;
  limits: number;
}
export interface SearchHit {
  sessionId: string;
  sessionName: string;
  provider: Provider;
  startedAt: string | null;
  snippet: string;
  hits: number;
}
export interface Review {
  dir: string;
  status: GitStatus;
  diff: string;
  untracked: [string, string][];
  truncated: boolean;
}

export interface IndexReport {
  filesSeen: number;
  filesRead: number;
  records: number;
  bytesRead: number;
  errors: string[];
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  files: { path: string; code: string }[];
  insertions: number;
  deletions: number;
}

export interface Worktree {
  path: string;
  head: string | null;
  branch: string | null;
  isMain: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface Attach {
  seq: number;
  data: string;
  running: boolean;
}

export interface SecurityOverview {
  dataDir: string;
  dbPath: string;
  profilesRoot: string;
  runRoot: string;
  accounts: { account: string; provider: Provider; configDir: string; managed: boolean; reads: string[] }[];
  processes: { sessionId: string; kind: string; provider: Provider; pid: number | null; cwd: string }[];
  telemetry: boolean;
  network: string;
}

export interface SttModel {
  id: string;
  label: string;
  hint: string;
  sizeMb: number;
  installed: boolean;
}

export interface SttStatus {
  serverInstalled: boolean;
  models: SttModel[];
  devices: string[];
  recordingTarget: string | null;
  serverRunning: boolean;
  installing: boolean;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  site: string;
  text: string;
}

export interface TtsVoice {
  id: string;
  label: string;
  lang: "de" | "en";
  hint: string;
  sizeMb: number;
  installed: boolean;
  /** speaking styles of a voice with moods ("amused", "whisper" …) */
  styles?: string[];
  /** which engine speaks it (older backends: Piper) */
  engine?: TtsEngineId;
  /** also speaks English natively (Supertonic, multilingual Azure voices) */
  multilingual?: boolean;
}

export type TtsEngineId = "piper" | "supertonic" | "azure";

export interface TtsEngine {
  id: TtsEngineId;
  label: string;
  /** downloaded (local) or a key stored (cloud) */
  ready: boolean;
  local: boolean;
  sizeMb: number;
  /** cloud: the region of the stored key (the key itself never reaches the UI) */
  region: string | null;
}

export interface TtsStatus {
  /** any engine ready */
  engineInstalled: boolean;
  voices: TtsVoice[];
  engines?: TtsEngine[];
  installing: boolean;
  running: string | null;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  detectClis: () => invoke<CliInfo[]>("detect_clis"),

  projectsList: () => invoke<Project[]>("projects_list"),
  projectAdd: (path: string, name?: string) => invoke<Project>("project_add", { path, name }),
  projectOpen: (id: string) => invoke<void>("project_open", { id }),
  projectRename: (id: string, name: string) => invoke<void>("project_rename", { id, name }),
  projectRemove: (id: string) => invoke<void>("project_remove", { id }),
  projectSetDefaults: (id: string, defaults: ProjectDefaults) => invoke<void>("project_set_defaults", { id, defaults }),

  accountsList: () => invoke<Account[]>("accounts_list"),
  modelCatalog: (accountId: string) => invoke<ModelInfo[]>("model_catalog", { accountId }),
  accountAdd: (input: { provider: Provider; name: string; mode: "managed" | "existing"; configDir?: string; color?: string; command?: string }) =>
    invoke<Account>("account_add", { input }),
  accountUpdate: (id: string, name: string, color?: string | null) => invoke<void>("account_update", { id, name, color }),
  accountCheckAuth: (id: string, force = false) => invoke<Account>("account_check_auth", { id, force }),
  accountRemove: (id: string, deleteFiles: boolean) =>
    invoke<{ deletedFiles: boolean; configDir: string }>("account_remove", { id, deleteFiles }),
  accountLogin: (id: string, cols: number, rows: number, deviceAuth = false, separateBrowser = true) =>
    invoke<Session>("account_login", { id, deviceAuth, separateBrowser, cols, rows }),
  accountStatusTerminal: (id: string, cols: number, rows: number) =>
    invoke<Session>("account_status_terminal", { id, cols, rows }),

  sessionCreate: (input: {
    accountId: string;
    projectId?: string | null;
    cwd?: string | null;
    name?: string;
    model?: string;
    extraArgs?: string[];
    resumeProviderSessionId?: string;
    options?: SessionOptions;
    autoContinue?: boolean;
  }) => invoke<Session>("session_create", { input }),
  sessionStart: (id: string, cols: number, rows: number) => invoke<Session>("session_start", { id, cols, rows }),
  sessionStop: (id: string) => invoke<void>("session_stop", { id }),
  sessionRestart: (id: string, cols: number, rows: number) => invoke<Session>("session_restart", { id, cols, rows }),
  sessionDuplicate: (id: string) => invoke<Session>("session_duplicate", { id }),
  sessionRename: (id: string, name: string) => invoke<void>("session_rename", { id, name }),
  sessionClose: (id: string) => invoke<void>("session_close", { id }),
  sessionReopen: (id: string) => invoke<Session>("session_reopen", { id }),
  sessionsOpen: () => invoke<Session[]>("sessions_open"),
  sessionSetAutoContinue: (id: string, on: boolean) => invoke<void>("session_set_auto_continue", { id, on }),
  sessionQueueInput: (id: string, text: string) => invoke<void>("session_queue_input", { id, text }),
  sessionHandoff: (id: string, accountId: string, message?: string) => invoke<Session>("session_handoff", { id, accountId, message }),
  loginOpenPrivate: (id: string) => invoke<void>("login_open_private", { id }),
  historyQuery: (filter: HistoryFilter) => invoke<{ rows: HistoryRow[]; total: number }>("history_query", { filter }),

  ptyAttach: (id: string) => invoke<Attach>("pty_attach", { id }),
  ptyScreen: (id: string) => invoke<string>("pty_screen", { id }),
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),

  usageSummary: (range: string, filter?: UsageFilter) => invoke<UsageSummary>("usage_summary", { range, filter }),
  usageHeatmap: (days: number, filter?: UsageFilter) => invoke<Point[]>("usage_heatmap", { days, filter }),
  usageReindex: (full = false) => invoke<IndexReport>("usage_reindex", { full }),
  pricesGet: () => invoke<Price[]>("prices_get"),
  pricesSave: (prices: Price[]) => invoke<void>("prices_save", { prices }),
  quotaOverview: () => invoke<Record<string, QuotaWindow[]>>("quota_overview"),
  quotaHistory: (hours = 6) => invoke<Record<string, QuotaWindow[]>>("quota_history", { hours }),
  tasksList: () => invoke<Task[]>("tasks_list"),
  taskSave: (input: TaskInput) => invoke<Task>("task_save", { input }),
  taskDelete: (id: string) => invoke<void>("task_delete", { id }),
  layoutsNamed: () => invoke<NamedLayout[]>("layouts_named"),
  layoutNamedSave: (name: string, mode: string, panes: (string | null)[]) => invoke<void>("layout_named_save", { name, mode, panes }),
  layoutNamedDelete: (name: string) => invoke<void>("layout_named_delete", { name }),
  activityStats: (fromMs: number) => invoke<SessionStats[]>("activity_stats", { fromMs }),
  transcriptSearch: (query: string, limit?: number) => invoke<SearchHit[]>("transcript_search", { query, limit }),
  reviewGet: (dir: string) => invoke<Review>("review_get", { dir }),
  reviewCommit: (dir: string, message: string) => invoke<string>("review_commit", { dir, message }),
  pushSend: (url: string, title: string, message: string, priority?: string) => invoke<void>("push_send", { url, title, message, priority }),
  saveTextFile: (path: string, content: string) => invoke<void>("save_text_file", { path, content }),
  taskMerge: (id: string) => invoke<MergeResult>("task_merge", { id }),
  testsRun: (dir: string, command: string, timeoutSec?: number) => invoke<TestRun>("tests_run", { dir, command, timeoutSec }),
  pinsList: () => invoke<Pin[]>("pins_list"),
  pinSave: (pin: Partial<Pin> & { text: string }) => invoke<Pin>("pin_save", { pin: { id: "", projectId: null, sessionId: null, sessionName: null, note: null, createdAt: "", ...pin } }),
  pinDelete: (id: string) => invoke<void>("pin_delete", { id }),
  reportSave: (name: string, content: string) => invoke<string>("report_save", { name, content }),
  /** `expires` (ms; missing: 24 h); an optional view-only key for colleagues with its own expiry. */
  remoteStart: (port: number, key: string, expires?: number, viewKey?: string | null, viewExpires?: number) =>
    invoke<RemoteInfo>("remote_start", { port, key, expires, viewKey: viewKey ?? null, viewExpires }),
  /** New keys while the remote is on (the old ones stop at once); no view key: revoked. */
  remoteSetKeys: (key: string, expires: number, viewKey: string | null, viewExpires?: number) =>
    invoke<RemoteInfo>("remote_set_keys", { key, expires, viewKey, viewExpires }),
  remoteStop: () => invoke<void>("remote_stop"),
  remoteStatus: () => invoke<RemoteInfo | null>("remote_status"),
  /** The open board as a read-only page for the phone remote; false while the remote is off. */
  remoteShareBoard: (html: string, title: string, operator: string | null, answer: string | null) => invoke<boolean>("remote_share_board", { html, title, operator, answer }),
  /** "Seit du weg bist" at the top of the phone page (no lines: you are back); false while the remote is off. */
  remoteShareDigest: (since: number, lines: { kind: string; text: string; anchor?: string }[]) => invoke<boolean>("remote_share_digest", { since, lines }),
  updateInfo: (fetch = false) => invoke<UpdateInfo>("update_info", { fetch }),
  updateStart: (pull: boolean) => invoke<void>("update_start", { pull }),
  updateApply: (exe: string) => invoke<void>("update_apply", { exe }),

  settingsGet: () => invoke<Record<string, unknown>>("settings_get"),
  settingsSet: (key: string, value: unknown) => invoke<void>("settings_set", { key, value }),
  layoutGet: () => invoke<{ mode: string; panes: unknown } | null>("layout_get"),
  layoutSave: (mode: string, panes: unknown) => invoke<void>("layout_save", { mode, panes }),

  securityOverview: () => invoke<SecurityOverview>("security_overview"),
  openKnownDir: (which: "data" | "profiles" | "account" | "project" | "cwd", id?: string) =>
    invoke<void>("open_known_dir", { which, accountId: which === "account" ? id : undefined, sessionId: which !== "account" ? id : undefined }),
  exportSettings: (dest: string) => invoke<void>("export_settings", { dest }),
  deleteAppData: (confirm: string, includeProfiles: boolean) => invoke<void>("delete_app_data", { confirm, includeProfiles }),

  hudLayout: (height: number, width?: number) => invoke<void>("hud_layout", { height, width }),
  focusMain: () => invoke<void>("focus_main"),
  recentFiles: (limit = 100, sessionId?: string) => invoke<RecentFile[]>("activity_recent_files", { limit, sessionId }),
  timeline: (sessionId?: string, limit = 200) => invoke<TimelineItem[]>("activity_timeline", { sessionId, limit }),
  fileOpen: (path: string) => invoke<void>("file_open", { path }),
  fileDiff: (path: string) => invoke<{ kind: "diff" | "new" | "unchanged"; text: string }>("file_diff", { path }),
  automationList: (sessionId?: string) => invoke<Automation[]>("automation_list", { sessionId }),
  openProjectPage: (page: "download" | "pro" | "repo") => invoke<void>("open_project_page", { page }),
  proStatus: () => invoke<ProStatus>("pro_status"),
  proActivate: (key: string) => invoke<ProStatus>("pro_activate", { key }),
  proDeactivate: () => invoke<ProStatus>("pro_deactivate"),
  proRefresh: () => invoke<ProStatus>("pro_refresh"),
  proOpen: (what: "monthly" | "yearly" | "portal" | "pricing") => invoke<void>("pro_open", { what }),
  assistantsList: () => invoke<Assistant[]>("assistants_list"),
  assistantSave: (input: Partial<Assistant> & { name: string; avatar: string }) => invoke<Assistant>("assistant_save", { input }),
  assistantDelete: (id: string) => invoke<void>("assistant_delete", { id }),
  /** The model of the assistant's session for its next start (restart it afterwards; the conversation is kept). */
  assistantSetModel: (id: string, model: string) => invoke<Session>("assistant_set_model", { id, model }),
  assistantLaunch: (id: string, goal?: string, chat = false) => invoke<{ session: Session; automation: Automation | null }>("assistant_launch", { id, goal, chat }),
  automationSave: (input: { id?: string; sessionId: string; name: string; mode: AutomationMode; prompts: string[]; repeat: number; delaySec: number; stopPhrase?: string | null; start: boolean; goal?: GoalConfig | null }) =>
    invoke<Automation>("automation_save", { input }),
  automationControl: (id: string, action: "start" | "pause" | "stop" | "reset") => invoke<Automation>("automation_control", { id, action }),
  automationDelete: (id: string) => invoke<void>("automation_delete", { id }),
  templatesList: () => invoke<Template[]>("templates_list"),
  templateSave: (template: Template) => invoke<Template>("template_save", { template }),
  templateDelete: (id: string) => invoke<void>("template_delete", { id }),

  sttStatus: () => invoke<SttStatus>("stt_status"),
  sttInstall: (model: string) => invoke<void>("stt_install", { model }),
  sttWarmup: () => invoke<void>("stt_warmup"),
  sttStart: (target: string) => invoke<void>("stt_start", { target }),
  sttStop: () => invoke<{ target: string; text: string; send: boolean }>("stt_stop"),
  sttCancel: () => invoke<void>("stt_cancel"),
  wakeStart: (words: string[]) => invoke<void>("wake_start", { words }),
  wakeStop: () => invoke<void>("wake_stop"),
  /** The command after the wake phrase, or null when `text` would not wake it. */
  wakeCheck: (text: string, words: string[]) => invoke<string | null>("wake_check", { text, words }),
  wakeBusy: (busy: boolean) => invoke<void>("wake_busy", { busy }),
  wakeRunning: () => invoke<boolean>("wake_running"),
  /** Board: preview of a web page (title, description, picture URL, first paragraphs). */
  linkPreview: (url: string) => invoke<LinkPreview>("link_preview", { url }),
  /** Board: a picture from the web as data URL. */
  mediaFetch: (url: string) => invoke<string>("media_fetch", { url }),
  openWebLink: (url: string) => invoke<void>("open_web_link", { url }),
  browserOpen: (url: string, title?: string) => invoke<string>("browser_open", { url, title }),
  browserDock: (a: { label: string; url?: string; x: number; y: number; w: number; h: number; visible: boolean }) => invoke<void>("browser_dock", a),
  browserUndock: (label: string) => invoke<void>("browser_undock", { label }),
  browserUrl: (label: string) => invoke<string | null>("browser_url", { label }),
  browserPdf: (label: string, name: string) => invoke<string>("browser_pdf", { label, name }),
  browserAct: (action: Record<string, unknown>, label?: string) => invoke<Record<string, unknown>>("browser_act", { action, label }),
  browserSnapshot: (label?: string, maxWidth?: number) => invoke<{ src: string; title: string }>("browser_snapshot", { label, maxWidth }),
  osintLookup: (target: string) => invoke<{ kind: string; target: string; dns: { kind: string; value: string }[]; registrar?: string | null; registered?: string | null; expires?: string | null; nameservers: string[]; subdomains: string[]; firstSeen?: string | null; lastSeen?: string | null; network?: string | null; country?: string | null; city?: string | null; lat?: number | null; lon?: number | null; ip?: string | null; errors: string[] }>("osint_lookup", { target }),
  /** Milliseconds since the last keyboard/mouse input in any program. */
  userIdleMs: () => invoke<number>("user_idle_ms"),
  /** Barge-in: keep only the last `ms` milliseconds of the running recording. */
  sttKeepRecent: (ms: number) => invoke<void>("stt_keep_recent", { ms }),
  ttsStatus: () => invoke<TtsStatus>("tts_status"),
  /** Whiteboard JSON of a scope ("project:<id>"), null when empty. */
  boardGet: (scope: string) => invoke<string | null>("board_get", { scope }),
  boardSave: (scope: string, data: string) => invoke<void>("board_save", { scope, data }),
  boardList: (prefix: string) => invoke<{ scope: string; updatedAt: string; title: string | null }[]>("board_list", { prefix }),
  boardDelete: (scope: string) => invoke<void>("board_delete", { scope }),
  /** Writes `<project>/.cockpit/BOARD.md`; returns its path. */
  boardExport: (projectId: string, markdown: string) => invoke<string>("board_export", { projectId, markdown }),
  boardImage: (projectId: string, png: string) => invoke<string>("board_image", { projectId, png }),
  boardPdf: (projectId: string, title: string, pdf: string, open = true) => invoke<string>("board_pdf", { projectId, title, pdf, open }),
  projectBuild: (projectId: string) => invoke<{ command: string; dir: string; ok: boolean; passed: number; failed: number; ms: number; tail: string; timedOut: boolean }[]>("project_build", { projectId }),
  projectTests: (projectId: string) => invoke<{ command: string; dir: string; ok: boolean; passed: number; failed: number; ms: number; tail: string; timedOut: boolean }[]>("project_tests", { projectId }),
  pdfBytes: (path: string) => invoke<ArrayBuffer>("pdf_bytes", { path }),
  pptxSlides: (path: string) => invoke<string[]>("pptx_slides", { path }),
  webSearch: (query: string) => invoke<{ title: string; url: string; snippet: string }[]>("web_search", { query }),
  codeScan: (path: string) => invoke<{ root: string; files: { path: string; lines: number; imports: string[] }[]; truncated: boolean; manifests: string[] }>("code_scan", { path }),
  fileStamps: (paths: string[]) => invoke<{ path: string; exists: boolean; modified: number; files: number }[]>("file_stamps", { paths }),
  filePreview: (path: string) => invoke<{ kind: string; name: string; size: number; image?: string | null; text?: string | null; slides: string[]; pages?: number | null }>("file_preview", { path }),
  ttsInstall: (voice: string) => invoke<void>("tts_install", { voice }),
  ttsWarmup: (voice: string, speed?: number) => invoke<void>("tts_warmup", { voice, speed }),
  /** WAV bytes of the spoken text. */
  ttsSpeak: (text: string, voice: string, speed?: number, style?: string, lang?: "de" | "en") => invoke<ArrayBuffer>("tts_speak", { text, voice, speed, style, lang }),
  /** Store (checked first) or remove (`key` null) the key of a cloud voice provider. */
  ttsCloudKey: (provider: "azure", region: string | null, key: string | null) => invoke<void>("tts_cloud_key", { provider, region, key }),
  /** Free an engine's memory after switching away from it. */
  ttsRelease: (engine: TtsEngineId) => invoke<void>("tts_release", { engine }),
  sessionSetVoiceHotkey: (id: string, hotkey: string | null) => invoke<string | null>("session_set_voice_hotkey", { id, hotkey }),

  gitStatus: (path: string) => invoke<GitStatus>("git_status", { path }),
  gitWorktrees: (path: string) => invoke<Worktree[]>("git_worktrees", { path }),
  gitWorktreeAdd: (projectId: string, name: string, base?: string) => invoke<Worktree>("git_worktree_add", { projectId, name, base }),
  gitWorktreeRemove: (projectId: string, worktreePath: string) => invoke<void>("git_worktree_remove", { projectId, worktreePath }),
};

export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
