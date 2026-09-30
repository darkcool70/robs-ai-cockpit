//! Launch the official OAuth page in a fresh browser context, never the user's
//! last signed-in browser account. No cookies or credentials are read by us.
use std::path::PathBuf;
use std::process::Command;
use crate::{cli::LaunchSpec, error::{AppError, AppResult}, paths};

pub const PROFILE_ENV: &str = "AI_COCKPIT_LOGIN_BROWSER_PROFILE";

fn browser() -> Option<PathBuf> {
    let candidates = [
        ("PROGRAMFILES(X86)", "Microsoft/Edge/Application/msedge.exe"),
        ("PROGRAMFILES", "Microsoft/Edge/Application/msedge.exe"),
        ("PROGRAMFILES", "Google/Chrome/Application/chrome.exe"),
        ("LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"),
    ];
    candidates.iter().filter_map(|(key, suffix)| std::env::var_os(key).map(|p| PathBuf::from(p).join(suffix))).find(|p| p.is_file())
}

pub fn available() -> bool {
    browser().is_some()
}

/// Fresh, throw-away browser data directory for one login attempt.
pub fn new_profile() -> PathBuf {
    paths::root().join("login-browser").join(uuid::Uuid::new_v4().to_string())
}

pub fn configure(spec: &mut LaunchSpec) -> AppResult<()> {
    if browser().is_none() {
        return Err(AppError::invalid("Separate account login requires Microsoft Edge or Google Chrome. Install either browser first."));
    }
    let profile = new_profile();
    spec.env_set.push(("BROWSER".into(), std::env::current_exe()?.to_string_lossy().into_owned()));
    spec.env_set.push((PROFILE_ENV.into(), profile.to_string_lossy().into_owned()));
    Ok(())
}

pub fn allowed_url(url: &str) -> bool {
    let Ok(u) = tauri::Url::parse(url) else { return false };
    u.scheme() == "https" && u.username().is_empty() && u.password().is_none()
        && u.port().is_none()
        && matches!(u.host_str(), Some("claude.ai" | "claude.com" | "console.anthropic.com" | "platform.claude.com" | "auth.openai.com" | "chatgpt.com"))
}

pub fn open(url: &str, profile: PathBuf) -> AppResult<()> {
    if !allowed_url(url) || !paths::is_within(&profile, &paths::root().join("login-browser")) {
        return Err(AppError::invalid("Invalid login browser request"));
    }
    let binary = browser().ok_or_else(|| AppError::invalid("No supported login browser found"))?;
    let private = if binary.file_name().and_then(|s| s.to_str()) == Some("msedge.exe") { "--inprivate" } else { "--incognito" };
    let mut cmd = Command::new(binary);
    cmd.arg(format!("--user-data-dir={}", profile.display()))
        .args([private, "--no-first-run", "--no-default-browser-check", "--new-window", url]);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_official_https_login_hosts() {
        assert!(allowed_url("https://claude.ai/oauth/authorize?state=test"));
        assert!(allowed_url("https://claude.com/oauth/authorize?state=test"));
        assert!(allowed_url("https://auth.openai.com/oauth/authorize?state=test"));
        for url in ["http://claude.ai/", "https://claude.ai.evil.test/", "file:///C:/x", "https://user@claude.ai/", "https://claude.ai:8080/"] {
            assert!(!allowed_url(url), "{url}");
        }
    }
}
