//! Filesystem layout of the cockpit. Everything the app writes lives under one root
//! (`~/.ai-cockpit` by default, overridable with `AI_COCKPIT_HOME`).
//!
//! ```text
//! ~/.ai-cockpit/
//!   cockpit.db                 SQLite metadata (no credentials, no transcripts)
//!   profiles/claude/<slug>/    CLAUDE_CONFIG_DIR of a managed Claude profile
//!   profiles/codex/<slug>/     CODEX_HOME of a managed Codex profile
//!   run/<session-id>/          hook + statusLine events written by the sink
//! ```

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

pub fn root() -> PathBuf {
    if let Some(p) = std::env::var_os("AI_COCKPIT_HOME") {
        return PathBuf::from(p);
    }
    home().join(".ai-cockpit")
}

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn db_path() -> PathBuf {
    root().join("cockpit.db")
}

pub fn profiles_root() -> PathBuf {
    root().join("profiles")
}

pub fn run_root() -> PathBuf {
    root().join("run")
}

pub fn session_run_dir(session_id: &str) -> PathBuf {
    run_root().join(session_id)
}

/// Default (non-isolated) config dirs used by the CLIs when no env override is set.
pub fn default_config_dir(provider: &str) -> PathBuf {
    match provider {
        "claude" => home().join(".claude"),
        _ => home().join(".codex"),
    }
}

/// Turn a free-form nickname into a safe directory name.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    // Short: profile paths end up inside socket paths (Codex), which Windows caps at 108 chars.
    out.truncate(24);
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "profile".into()
    } else {
        out
    }
}

/// Lexically normalise a path (resolve `.`/`..`) without touching the filesystem.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn lower(p: &Path) -> String {
    // Windows paths are case-insensitive; compare case-folded with unified separators.
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// True if `p` is strictly inside `base` (after lexical normalisation).
pub fn is_within(p: &Path, base: &Path) -> bool {
    let p = lower(&normalize(p));
    let base = lower(&normalize(base));
    let base = base.trim_end_matches('/');
    p.len() > base.len() && p.starts_with(base) && p.as_bytes()[base.len()] == b'/'
}

/// Codex keeps a local socket inside its home (`app-server-control/app-server-control.sock`).
/// Unix-domain socket paths are limited to 108 bytes, also on Windows.
pub const CODEX_SOCKET_SUFFIX: &str = "app-server-control/app-server-control.sock";

pub fn codex_home_too_long(dir: &Path) -> bool {
    dir.join(CODEX_SOCKET_SUFFIX).to_string_lossy().len() > 105
}

/// Only directories inside `profiles/` are owned by the app and may be deleted by it.
pub fn is_managed_profile_dir(p: &Path) -> bool {
    is_within(p, &profiles_root())
}

pub fn ensure_dir(p: &Path) -> AppResult<()> {
    std::fs::create_dir_all(p).map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_handles_spaces_and_symbols() {
        assert_eq!(slugify("Claude Pro A"), "claude-pro-a");
        assert_eq!(slugify("  Codex / Main!! "), "codex-main");
        assert_eq!(slugify("äöü"), "profile");
        assert_eq!(slugify("A very long nickname for my second account").len(), 24);
        assert!(!slugify("A very long nickname for my second account").ends_with('-'));
    }

    #[test]
    fn within_is_case_insensitive_and_separator_agnostic() {
        let base = Path::new(r"C:\Users\me\.ai-cockpit\profiles");
        assert!(is_within(Path::new(r"c:/users/ME/.ai-cockpit/profiles/claude/a"), base));
        assert!(!is_within(Path::new(r"C:\Users\me\.ai-cockpit\profiles"), base));
        assert!(!is_within(Path::new(r"C:\Users\me\.ai-cockpit\profiles-evil\x"), base));
        assert!(!is_within(Path::new(r"C:\Users\me\.ai-cockpit\profiles\..\cockpit.db"), base));
        assert!(!is_within(Path::new(r"C:\Users\me\.claude"), base));
    }

    #[test]
    fn codex_socket_path_limit() {
        assert!(!codex_home_too_long(Path::new(r"C:\Users\me\.ai-cockpit\profiles\codex\codex-second-account")));
        assert!(codex_home_too_long(Path::new(r"C:\Users\me\AppData\Local\Temp\claude\some-long-session-folder\scratchpad\profiles\codex\codex")));
    }

    #[test]
    fn normalize_resolves_parent_components() {
        assert_eq!(
            normalize(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
    }
}
