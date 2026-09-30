//! Detection of the official CLIs and construction of the exact command lines we launch.
//!
//! Command construction is kept pure (no I/O) so it can be unit tested: account isolation
//! depends on getting the environment exactly right.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

use crate::paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Codex,
    /// Any other terminal CLI (Gemini CLI, Aider, Ollama, …) configured by its command line.
    Custom,
}

impl Provider {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude" => Some(Provider::Claude),
            "codex" => Some(Provider::Codex),
            "custom" => Some(Provider::Custom),
            _ => None,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
            Provider::Custom => "custom",
        }
    }
    pub fn binary_name(&self) -> &'static str {
        self.as_str()
    }
    /// Env var that selects the isolated config directory.
    pub fn config_env(&self) -> &'static str {
        match self {
            Provider::Claude => "CLAUDE_CONFIG_DIR",
            Provider::Codex => "CODEX_HOME",
            // Custom CLIs keep their own configuration; the cockpit sets nothing.
            Provider::Custom => "",
        }
    }
}

/// Environment variables that would silently switch a CLI from subscription auth to
/// API-key billing, or redirect it to another account. Always stripped from children.
pub const STRIPPED_ENV: &[&str] = &[
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
    "CLAUDE_CODE_OAUTH_SCOPES",
    "CLAUDE_CODE_API_KEY",
    "CLAUDECODE",
    // Markers of a surrounding Claude Code session (when the cockpit itself was started from
    // one). Inherited, they make the agents think they are sub-sessions: e.g. transcript
    // saving is switched off, which breaks resume and usage analytics.
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "BROWSER",
    "AI_COCKPIT_LOGIN_BROWSER_PROFILE",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub provider: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: String,
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

fn candidate_paths(p: Provider) -> Vec<PathBuf> {
    let home = paths::home();
    let mut out = Vec::new();
    match p {
        Provider::Claude => {
            out.push(home.join(".local/bin/claude.exe"));
            out.push(home.join(".local/bin/claude"));
            if let Some(appdata) = std::env::var_os("APPDATA") {
                out.push(PathBuf::from(appdata).join("npm/claude.cmd"));
            }
        }
        Provider::Codex => {
            if let Some(appdata) = std::env::var_os("APPDATA") {
                out.push(PathBuf::from(appdata).join("npm/codex.cmd"));
            }
            // The Codex desktop app ships a CLI in a versioned folder; pick the newest.
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                let base = PathBuf::from(local).join("OpenAI/Codex/bin");
                if let Ok(rd) = std::fs::read_dir(&base) {
                    let mut found: Vec<(std::time::SystemTime, PathBuf)> = rd
                        .flatten()
                        .map(|e| e.path().join("codex.exe"))
                        .filter(|p| p.is_file())
                        .filter_map(|p| {
                            let m = p.metadata().ok()?.modified().ok()?;
                            Some((m, p))
                        })
                        .collect();
                    found.sort_by(|a, b| b.0.cmp(&a.0));
                    out.extend(found.into_iter().map(|x| x.1));
                }
            }
        }
        // Resolved from the profile's own command line.
        Provider::Custom => {}
    }
    out
}

pub fn detect(p: Provider, override_path: Option<&str>) -> CliInfo {
    let (path, source) = if let Some(o) = override_path.filter(|s| !s.trim().is_empty()) {
        (Some(PathBuf::from(o)), "settings")
    } else if let Ok(found) = which::which(p.binary_name()) {
        (Some(found), "PATH")
    } else if let Some(c) = candidate_paths(p).into_iter().find(|c| c.is_file()) {
        (Some(c), "known location")
    } else {
        (None, "not found")
    };
    let version = path.as_deref().and_then(|p| run_capture(p, &["--version"], &[], None, 8).ok())
        .map(|o| o.stdout.lines().next().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty());
    CliInfo {
        provider: p.as_str().into(),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        version,
        source: source.into(),
    }
}

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

/// Fully resolved process description. `env_set`/`env_remove` are applied on top of the
/// cockpit's own environment.
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env_set: Vec<(String, String)>,
    pub env_remove: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AccountEnv<'a> {
    pub provider: Provider,
    pub config_dir: &'a str,
}

impl AccountEnv<'_> {
    /// Whether this profile points at the CLI's default directory. In that case we must NOT
    /// set the env var: e.g. Claude resolves `~/.claude.json` differently when
    /// `CLAUDE_CONFIG_DIR` is set, which would look like a logged-out account.
    pub fn uses_default_dir(&self) -> bool {
        same_path(
            Path::new(self.config_dir),
            &paths::default_config_dir(self.provider.as_str()),
        )
    }
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    let f = |p: &Path| {
        paths::normalize(p)
            .to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    f(a) == f(b)
}

#[derive(Debug, Clone, PartialEq)]
pub enum SessionMode {
    /// New conversation. For Claude we pre-assign the session UUID.
    New { session_id: Option<String> },
    /// Resume a provider conversation by id.
    Resume { session_id: String },
}

/// Structured per-session launch options, mapped to the official flags of each CLI.
/// Everything is optional: an empty value means "whatever the CLI / user settings say".
#[derive(Debug, Clone, Default, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionOptions {
    /// "manual" | "accept-edits" | "plan" | "auto" | "full" (None = CLI default).
    pub autonomy: Option<String>,
    /// Claude: low|medium|high|xhigh|max. Codex: per model, see its models cache.
    pub effort: Option<String>,
    pub add_dirs: Vec<String>,
    /// Claude only.
    pub append_system_prompt: Option<String>,
    /// Claude only.
    pub fallback_model: Option<String>,
    /// Codex only: `--search`.
    pub web_search: bool,
    /// Claude only: `--chrome`.
    pub chrome: bool,
    /// Typed into the session once it is ready (first start only).
    pub initial_prompt: Option<String>,
}

pub const AUTONOMY_LEVELS: &[&str] = &["manual", "accept-edits", "plan", "auto", "full"];
pub const CLAUDE_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

impl SessionOptions {
    /// Reject values that would produce an invalid command line.
    pub fn validate(&self, provider: Provider) -> Result<(), String> {
        let nonempty = |o: &Option<String>| o.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        if let Some(a) = nonempty(&self.autonomy) {
            if !AUTONOMY_LEVELS.contains(&a.as_str()) {
                return Err(format!("Unknown autonomy level {a}"));
            }
        }
        if let Some(e) = nonempty(&self.effort) {
            // Codex adds levels over time (its catalog lists them per model); only the shape
            // is checked there. Claude's levels are fixed by `--effort`.
            let ok = match provider {
                Provider::Claude => CLAUDE_EFFORTS.contains(&e.as_str()),
                Provider::Codex => e.len() <= 16 && e.chars().all(|c| c.is_ascii_lowercase()),
                Provider::Custom => true,
            };
            if !ok {
                return Err(format!("Unsupported effort level {e}"));
            }
        }
        for d in &self.add_dirs {
            if !d.trim().is_empty() && !Path::new(d.trim()).is_dir() {
                return Err(format!("Additional directory {d} does not exist"));
            }
        }
        if let Some(m) = nonempty(&self.fallback_model) {
            if m.contains(char::is_whitespace) {
                return Err("Fallback model must be an alias or model id (no spaces)".into());
            }
        }
        Ok(())
    }
}

fn opt(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Clone)]
pub struct AgentLaunch<'a> {
    pub binary: &'a str,
    pub account: AccountEnv<'a>,
    pub cwd: &'a str,
    pub mode: SessionMode,
    pub model: Option<&'a str>,
    pub display_name: Option<&'a str>,
    /// Claude only: path to a per-session settings file (hooks + statusLine).
    pub settings_file: Option<&'a str>,
    pub options: &'a SessionOptions,
    pub extra_args: &'a [String],
}

fn base_env(account: &AccountEnv) -> (Vec<(String, String)>, Vec<String>) {
    let mut set = vec![
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
    ];
    // Custom CLIs may rely on API keys in the environment (that is how they log in).
    let remove: Vec<String> = if account.provider == Provider::Custom { Vec::new() } else { STRIPPED_ENV.iter().map(|s| s.to_string()).collect() };
    if !account.uses_default_dir() && !account.provider.config_env().is_empty() {
        set.push((account.provider.config_env().to_string(), account.config_dir.to_string()));
    }
    (set, remove)
}

/// `.cmd`/`.bat` shims (npm installs) cannot be spawned directly by CreateProcess.
fn wrap_program(binary: &str, args: Vec<String>) -> (String, Vec<String>) {
    let lower = binary.to_lowercase();
    if cfg!(windows) && (lower.ends_with(".cmd") || lower.ends_with(".bat")) {
        let mut a = vec!["/d".to_string(), "/c".to_string(), binary.to_string()];
        a.extend(args);
        ("cmd.exe".to_string(), a)
    } else {
        (binary.to_string(), args)
    }
}

pub fn build_agent_command(l: &AgentLaunch) -> LaunchSpec {
    let mut args: Vec<String> = Vec::new();
    match l.account.provider {
        Provider::Claude => {
            match &l.mode {
                SessionMode::New { session_id: Some(id) } => {
                    args.push("--session-id".into());
                    args.push(id.clone());
                }
                SessionMode::New { session_id: None } => {}
                SessionMode::Resume { session_id } => {
                    args.push("--resume".into());
                    args.push(session_id.clone());
                }
            }
            if let Some(s) = l.settings_file {
                args.push("--settings".into());
                args.push(s.into());
            }
            if let Some(m) = l.model.filter(|m| !m.is_empty()) {
                args.push("--model".into());
                args.push(m.into());
            }
            if let Some(n) = l.display_name.filter(|n| !n.is_empty()) {
                args.push("--name".into());
                args.push(n.into());
            }
            let o = l.options;
            if let Some(e) = opt(&o.effort) {
                args.push("--effort".into());
                args.push(e.into());
            }
            match opt(&o.autonomy) {
                Some("manual") => args.extend(["--permission-mode".into(), "manual".into()]),
                Some("accept-edits") => args.extend(["--permission-mode".into(), "acceptEdits".into()]),
                Some("plan") => args.extend(["--permission-mode".into(), "plan".into()]),
                Some("auto") => args.extend(["--permission-mode".into(), "auto".into()]),
                Some("full") => args.push("--dangerously-skip-permissions".into()),
                _ => {}
            }
            if let Some(f) = opt(&o.fallback_model) {
                args.push("--fallback-model".into());
                args.push(f.into());
            }
            if let Some(p) = opt(&o.append_system_prompt) {
                args.push("--append-system-prompt".into());
                args.push(p.into());
            }
            if o.chrome {
                args.push("--chrome".into());
            }
            // `--add-dir` is variadic: one flag per directory, `=` form so nothing after it
            // is swallowed as another directory.
            for d in o.add_dirs.iter().map(|d| d.trim()).filter(|d| !d.is_empty()) {
                args.push(format!("--add-dir={d}"));
            }
        }
        Provider::Codex => {
            if let SessionMode::Resume { session_id } = &l.mode {
                args.push("resume".into());
                args.push(session_id.clone());
            }
            if let Some(m) = l.model.filter(|m| !m.is_empty()) {
                args.push("--model".into());
                args.push(m.into());
            }
            let o = l.options;
            if let Some(e) = opt(&o.effort) {
                // Unquoted on purpose: the value survives cmd.exe (npm shim) and Codex falls
                // back to the raw string when it is not valid TOML.
                args.push("-c".into());
                args.push(format!("model_reasoning_effort={e}"));
            }
            match opt(&o.autonomy) {
                Some("manual") | Some("plan") => {
                    args.extend(["--sandbox".into(), "read-only".into(), "--ask-for-approval".into(), "on-request".into()])
                }
                Some("accept-edits") => {
                    args.extend(["--sandbox".into(), "workspace-write".into(), "--ask-for-approval".into(), "on-request".into()])
                }
                Some("auto") => args.push("--approve-for-me".into()),
                Some("full") => args.push("--dangerously-bypass-approvals-and-sandbox".into()),
                _ => {}
            }
            if o.web_search {
                args.push("--search".into());
            }
            for d in o.add_dirs.iter().map(|d| d.trim()).filter(|d| !d.is_empty()) {
                args.push("--add-dir".into());
                args.push(d.into());
            }
        }
        Provider::Custom => {}
    }
    // Provider::Custom: its own arguments arrive in `extra_args` (from the profile's command line).
    args.extend(l.extra_args.iter().cloned());
    let (program, args) = wrap_program(l.binary, args);
    let (env_set, env_remove) = base_env(&l.account);
    LaunchSpec { program, args, cwd: l.cwd.to_string(), env_set, env_remove }
}

/// Interactive official login flow for a profile (runs in a terminal pane).
pub fn build_login_command(binary: &str, account: &AccountEnv, cwd: &str, device_auth: bool) -> LaunchSpec {
    let args: Vec<String> = match account.provider {
        Provider::Claude => vec!["auth".into(), "login".into(), "--claudeai".into()],
        Provider::Codex => {
            let mut a = vec!["login".to_string()];
            if device_auth {
                a.push("--device-auth".into());
            }
            a
        }
        // No standard login command: the tool itself runs and asks for its login.
        Provider::Custom => Vec::new(),
    };
    let (program, args) = wrap_program(binary, args);
    let (env_set, env_remove) = base_env(account);
    LaunchSpec { program, args, cwd: cwd.to_string(), env_set, env_remove }
}

/// Non-interactive auth status check.
pub fn build_status_command(binary: &str, account: &AccountEnv) -> LaunchSpec {
    let args: Vec<String> = match account.provider {
        Provider::Claude => vec!["auth".into(), "status".into(), "--json".into()],
        Provider::Codex => vec!["login".into(), "status".into()],
        Provider::Custom => vec!["--version".into()],
    };
    let (program, args) = wrap_program(binary, args);
    let (env_set, env_remove) = base_env(account);
    LaunchSpec {
        program,
        args,
        cwd: paths::home().to_string_lossy().into_owned(),
        env_set,
        env_remove,
    }
}

// ---------------------------------------------------------------------------
// Non-interactive execution with timeout
// ---------------------------------------------------------------------------

pub struct Captured {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub fn run_spec(spec: &LaunchSpec, timeout_secs: u64) -> std::io::Result<Captured> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).current_dir(&spec.cwd);
    for k in &spec.env_remove {
        cmd.env_remove(k);
    }
    for (k, v) in &spec.env_set {
        cmd.env(k, v);
    }
    spawn_with_timeout(cmd, timeout_secs)
}

pub fn run_capture(
    program: &Path,
    args: &[&str],
    env: &[(&str, &str)],
    cwd: Option<&Path>,
    timeout_secs: u64,
) -> std::io::Result<Captured> {
    let (prog, wrapped) = wrap_program(
        &program.to_string_lossy(),
        args.iter().map(|s| s.to_string()).collect(),
    );
    let mut cmd = Command::new(prog);
    cmd.args(wrapped);
    for (k, v) in env {
        cmd.env(k, v);
    }
    if let Some(c) = cwd {
        cmd.current_dir(c);
    }
    spawn_with_timeout(cmd, timeout_secs)
}

fn spawn_with_timeout(mut cmd: Command, timeout_secs: u64) -> std::io::Result<Captured> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn()?;
    let mut out = child.stdout.take();
    let mut err = child.stderr.take();
    let t_out = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(o) = out.as_mut() {
            let _ = std::io::Read::read_to_end(o, &mut s);
        }
        s
    });
    let t_err = std::thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(e) = err.as_mut() {
            let _ = std::io::Read::read_to_end(e, &mut s);
        }
        s
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    let code = loop {
        if let Some(st) = child.try_wait()? {
            break st.code();
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "command timed out"));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let stdout = String::from_utf8_lossy(&t_out.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&t_err.join().unwrap_or_default()).into_owned();
    Ok(Captured { code, stdout, stderr })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude_acc(dir: &str) -> AccountEnv<'_> {
        AccountEnv { provider: Provider::Claude, config_dir: dir }
    }

    #[test]
    fn claude_isolated_profile_sets_config_dir_and_strips_keys() {
        let dir = r"C:\Users\me\.ai-cockpit\profiles\claude\account-a";
        let spec = build_agent_command(&AgentLaunch {
            binary: r"C:\Users\me\.local\bin\claude.exe",
            account: claude_acc(dir),
            cwd: r"C:\Projects\My App",
            mode: SessionMode::New { session_id: Some("11111111-2222-3333-4444-555555555555".into()) },
            model: None,
            display_name: Some("feature x"),
            settings_file: Some(r"C:\Users\me\.ai-cockpit\run\s1\settings.json"),
            options: &SessionOptions::default(),
            extra_args: &[],
        });
        assert_eq!(spec.program, r"C:\Users\me\.local\bin\claude.exe");
        assert_eq!(
            spec.args,
            vec![
                "--session-id",
                "11111111-2222-3333-4444-555555555555",
                "--settings",
                r"C:\Users\me\.ai-cockpit\run\s1\settings.json",
                "--name",
                "feature x"
            ]
        );
        assert_eq!(spec.cwd, r"C:\Projects\My App");
        assert!(spec.env_set.contains(&("CLAUDE_CONFIG_DIR".into(), dir.into())));
        assert!(!spec.env_set.iter().any(|(k, _)| k == "CODEX_HOME"));
        for k in ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE"] {
            assert!(spec.env_remove.iter().any(|r| r == k), "{k} must be stripped");
        }
    }

    #[test]
    fn two_claude_accounts_get_distinct_dirs() {
        let a = build_agent_command(&AgentLaunch {
            binary: "claude",
            account: claude_acc("/p/claude/a"),
            cwd: "/w",
            mode: SessionMode::New { session_id: None },
            model: None,
            display_name: None,
            settings_file: None,
            options: &SessionOptions::default(),
            extra_args: &[],
        });
        let b = build_agent_command(&AgentLaunch {
            binary: "claude",
            account: claude_acc("/p/claude/b"),
            cwd: "/w",
            mode: SessionMode::New { session_id: None },
            model: None,
            display_name: None,
            settings_file: None,
            options: &SessionOptions::default(),
            extra_args: &[],
        });
        let get = |s: &LaunchSpec| s.env_set.iter().find(|(k, _)| k == "CLAUDE_CONFIG_DIR").cloned();
        assert_ne!(get(&a), get(&b));
    }

    #[test]
    fn default_dir_profile_does_not_set_env() {
        let def = paths::default_config_dir("claude");
        let def = def.to_string_lossy();
        let spec = build_status_command("claude", &claude_acc(&def));
        assert!(!spec.env_set.iter().any(|(k, _)| k == "CLAUDE_CONFIG_DIR"));
        // ...but an inherited value is still removed so the default really applies.
        assert!(spec.env_remove.iter().any(|k| k == "CLAUDE_CONFIG_DIR"));
        assert_eq!(spec.args, vec!["auth", "status", "--json"]);
    }

    #[test]
    fn claude_resume_and_model() {
        let spec = build_agent_command(&AgentLaunch {
            binary: "claude",
            account: claude_acc("/p/a"),
            cwd: "/w",
            mode: SessionMode::Resume { session_id: "abc".into() },
            model: Some("opus"),
            display_name: None,
            settings_file: None,
            options: &SessionOptions::default(),
            extra_args: &["--permission-mode".into(), "plan".into()],
        });
        assert_eq!(spec.args, vec!["--resume", "abc", "--model", "opus", "--permission-mode", "plan"]);
    }

    #[test]
    fn codex_commands() {
        let acc = AccountEnv { provider: Provider::Codex, config_dir: r"D:\cockpit\profiles\codex\main" };
        let spec = build_agent_command(&AgentLaunch {
            binary: "codex.exe",
            account: acc.clone(),
            cwd: "/w",
            mode: SessionMode::Resume { session_id: "019a-uuid".into() },
            model: None,
            display_name: None,
            settings_file: Some("ignored"),
            options: &SessionOptions::default(),
            extra_args: &[],
        });
        assert_eq!(spec.args, vec!["resume", "019a-uuid"]);
        assert!(spec.env_set.contains(&("CODEX_HOME".into(), r"D:\cockpit\profiles\codex\main".into())));
        assert!(!spec.env_set.iter().any(|(k, _)| k == "CLAUDE_CONFIG_DIR"));

        let login = build_login_command("codex.exe", &acc, "/w", true);
        assert_eq!(login.args, vec!["login", "--device-auth"]);
        let st = build_status_command("codex.exe", &acc);
        assert_eq!(st.args, vec!["login", "status"]);
    }

    #[test]
    fn claude_login_uses_subscription_flow() {
        let spec = build_login_command("claude", &claude_acc("/p/a"), "/w", false);
        assert_eq!(spec.args, vec!["auth", "login", "--claudeai"]);
    }

    #[cfg(windows)]
    #[test]
    fn npm_cmd_shims_are_wrapped() {
        let spec = build_login_command(r"C:\Users\me\AppData\Roaming\npm\codex.CMD",
            &AccountEnv { provider: Provider::Codex, config_dir: "/x" }, "/w", false);
        assert_eq!(spec.program, "cmd.exe");
        assert_eq!(spec.args[..3], ["/d", "/c", r"C:\Users\me\AppData\Roaming\npm\codex.CMD"]);
        assert_eq!(spec.args[3], "login");
    }

    #[test]
    fn claude_options_map_to_official_flags() {
        let o = SessionOptions {
            autonomy: Some("auto".into()),
            effort: Some("high".into()),
            add_dirs: vec![r"C:\shared lib".into(), " ".into()],
            append_system_prompt: Some("Antworte auf Deutsch".into()),
            fallback_model: Some("sonnet".into()),
            chrome: true,
            ..Default::default()
        };
        let spec = build_agent_command(&AgentLaunch {
            binary: "claude",
            account: claude_acc("/p/a"),
            cwd: "/w",
            mode: SessionMode::New { session_id: None },
            model: Some("opus"),
            display_name: None,
            settings_file: None,
            options: &o,
            extra_args: &["--verbose".into()],
        });
        assert_eq!(
            spec.args,
            vec![
                "--model", "opus", "--effort", "high", "--permission-mode", "auto", "--fallback-model", "sonnet",
                "--append-system-prompt", "Antworte auf Deutsch", "--chrome", r"--add-dir=C:\shared lib", "--verbose"
            ]
        );
        let full = SessionOptions { autonomy: Some("full".into()), ..Default::default() };
        let spec = build_agent_command(&AgentLaunch {
            binary: "claude", account: claude_acc("/p/a"), cwd: "/w", mode: SessionMode::New { session_id: None },
            model: None, display_name: None, settings_file: None, options: &full, extra_args: &[],
        });
        assert_eq!(spec.args, vec!["--dangerously-skip-permissions"]);
    }

    #[test]
    fn codex_options_map_to_official_flags() {
        let acc = AccountEnv { provider: Provider::Codex, config_dir: "/c" };
        let o = SessionOptions { autonomy: Some("auto".into()), effort: Some("xhigh".into()), web_search: true, add_dirs: vec!["/x".into()], chrome: true, ..Default::default() };
        let spec = build_agent_command(&AgentLaunch {
            binary: "codex", account: acc.clone(), cwd: "/w", mode: SessionMode::Resume { session_id: "id".into() },
            model: None, display_name: Some("ignored"), settings_file: None, options: &o, extra_args: &[],
        });
        assert_eq!(spec.args, vec!["resume", "id", "-c", "model_reasoning_effort=xhigh", "--approve-for-me", "--search", "--add-dir", "/x"]);
        for (level, expect) in [
            ("plan", vec!["--sandbox", "read-only", "--ask-for-approval", "on-request"]),
            ("accept-edits", vec!["--sandbox", "workspace-write", "--ask-for-approval", "on-request"]),
            ("full", vec!["--dangerously-bypass-approvals-and-sandbox"]),
        ] {
            let o = SessionOptions { autonomy: Some(level.into()), ..Default::default() };
            let spec = build_agent_command(&AgentLaunch {
                binary: "codex", account: acc.clone(), cwd: "/w", mode: SessionMode::New { session_id: None },
                model: None, display_name: None, settings_file: None, options: &o, extra_args: &[],
            });
            assert_eq!(spec.args, expect, "{level}");
        }
    }

    #[test]
    fn options_validation() {
        assert!(SessionOptions { autonomy: Some("yolo".into()), ..Default::default() }.validate(Provider::Claude).is_err());
        assert!(SessionOptions { effort: Some("max".into()), ..Default::default() }.validate(Provider::Claude).is_ok());
        assert!(SessionOptions { effort: Some("ultra".into()), ..Default::default() }.validate(Provider::Codex).is_ok());
        assert!(SessionOptions { effort: Some("x y".into()), ..Default::default() }.validate(Provider::Codex).is_err());
        assert!(SessionOptions { effort: Some("ultra".into()), ..Default::default() }.validate(Provider::Claude).is_err());
        assert!(SessionOptions { add_dirs: vec!["Z:/definitely/missing/dir".into()], ..Default::default() }.validate(Provider::Claude).is_err());
        assert!(SessionOptions::default().validate(Provider::Codex).is_ok());
    }

    #[test]
    fn same_path_ignores_case_and_separators() {
        assert!(same_path(Path::new(r"C:\Users\Me\.claude\"), Path::new("c:/users/me/.claude")));
        assert!(!same_path(Path::new(r"C:\Users\Me\.claude2"), Path::new("c:/users/me/.claude")));
    }
}


/// Split a command line like a shell would for simple cases: whitespace, "double" and 'single' quotes.
pub fn split_command(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for ch in s.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => cur.push(ch),
            None if ch == '"' || ch == '\'' => {
                quote = Some(ch);
                has = true;
            }
            None if ch.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                has = false;
            }
            None => cur.push(ch),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod custom_tests {
    use super::*;

    #[test]
    fn splits_command_lines() {
        assert_eq!(split_command("ollama run qwen3"), vec!["ollama", "run", "qwen3"]);
        assert_eq!(split_command(r#"aider --model "sonnet 4" --no-git"#), vec!["aider", "--model", "sonnet 4", "--no-git"]);
        assert_eq!(split_command("  gemini  "), vec!["gemini"]);
        assert!(split_command("   ").is_empty());
    }

    #[test]
    fn custom_cli_keeps_its_environment_and_args() {
        let acc = AccountEnv { provider: Provider::Custom, config_dir: "/x" };
        let spec = build_agent_command(&AgentLaunch {
            binary: "gemini", account: acc, cwd: "/w", mode: SessionMode::New { session_id: None }, model: None,
            display_name: None, settings_file: None, options: &SessionOptions::default(), extra_args: &["--yolo".to_string()],
        });
        assert_eq!(spec.args, vec!["--yolo".to_string()]);
        assert!(spec.env_remove.is_empty(), "API keys stay available to custom CLIs");
        assert!(!spec.env_set.iter().any(|(k, _)| k.is_empty()));
    }
}
