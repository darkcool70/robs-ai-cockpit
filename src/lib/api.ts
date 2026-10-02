// Typed wrappers around the Rust command surface. Keep in sync with src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";

/** "custom": any other terminal CLI (Gemini CLI, Aider, Ollama …) started by its command line. */
export type Provider = "claude" | "codex" | "custom";

export type SessionStatus =
  | "idle"
  | "starting"
  | "working"
  | "waiting-for-input"
  | "rate-limited"
  | "stopped"
  | "failed";

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
  lastMessage?: string | null;
  lastPrompt?: string | null;
  turnStartedAt?: number | null;
  turnEndedAt?: number | null;
  turnFiles?: number;
  notice?: string | null;
  automation?: AutomationView | null;
  gitBranch?: string | null;
  gitChanged?: number | null;
}

export interface AutomationView {
  id: string;
  name: string;
  mode: "queue" | "loop";
  state: "running" | "paused" | "done" | "stopped";
  sent: number;
  total: number | null;
  note: string | null;
}

export interface Automation {
  id: string;
  sessionId: string;
  name: string;
  mode: "queue" | "loop";
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
}

export interface Template {
  id: string;
  name: string;
  text: string;
  sort: number;
}

export type ActivityKind = "prompt" | "tool" | "file" | "done" | "limit" | "continue" | "loop" | "input" | "start" | "exit";

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
  kind: "done" | "input" | "limit" | "loop" | "failed";
  title: string;
  subtitle: string;
  message: string;
  provider: Provider;
  at: number;
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
  remoteStart: (port: number, key: string) => invoke<RemoteInfo>("remote_start", { port, key }),
  remoteStop: () => invoke<void>("remote_stop"),
  remoteStatus: () => invoke<RemoteInfo | null>("remote_status"),
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

  hudLayout: (height: number) => invoke<void>("hud_layout", { height }),
  focusMain: () => invoke<void>("focus_main"),
  recentFiles: (limit = 100, sessionId?: string) => invoke<RecentFile[]>("activity_recent_files", { limit, sessionId }),
  timeline: (sessionId?: string, limit = 200) => invoke<TimelineItem[]>("activity_timeline", { sessionId, limit }),
  fileOpen: (path: string) => invoke<void>("file_open", { path }),
  fileDiff: (path: string) => invoke<{ kind: "diff" | "new" | "unchanged"; text: string }>("file_diff", { path }),
  automationList: (sessionId?: string) => invoke<Automation[]>("automation_list", { sessionId }),
  automationSave: (input: { id?: string; sessionId: string; name: string; mode: "queue" | "loop"; prompts: string[]; repeat: number; delaySec: number; stopPhrase?: string | null; start: boolean }) =>
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
