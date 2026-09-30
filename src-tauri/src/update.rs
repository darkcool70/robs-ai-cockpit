//! "Update from source": pull (if the repo has a remote), build the release, then swap the
//! installed executable after the app has exited and start it again.
//!
//! The helper that swaps the file is a separate PowerShell process: the cockpit's job object
//! only contains the agent CLIs it binds explicitly, so the helper survives the app's exit.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

static BUILDING: AtomicBool = AtomicBool::new(false);

/// Repository this binary was built from (compile time), if it still exists.
pub fn repo_root() -> Option<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?.to_path_buf();
    (root.join("package.json").is_file() && root.join("src-tauri").is_dir()).then_some(root)
}

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = quiet(Command::new("git").arg("-C").arg(dir).args(args)).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub remote: bool,
    pub behind: Option<i64>,
    pub dirty: bool,
    pub building: bool,
    pub exe: String,
}

pub fn info(fetch: bool) -> UpdateInfo {
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let Some(root) = repo_root() else {
        return UpdateInfo { repo: None, branch: None, head: None, remote: false, behind: None, dirty: false, building: BUILDING.load(Ordering::SeqCst), exe };
    };
    let remote = git(&root, &["remote"]).is_some_and(|r| !r.is_empty());
    if remote && fetch {
        let _ = git(&root, &["fetch", "--quiet"]);
    }
    let behind = if remote { git(&root, &["rev-list", "--count", "HEAD..@{u}"]).and_then(|n| n.parse().ok()) } else { None };
    UpdateInfo {
        repo: Some(root.to_string_lossy().into_owned()),
        branch: git(&root, &["branch", "--show-current"]),
        head: git(&root, &["log", "-1", "--format=%h %s"]),
        remote,
        behind,
        dirty: git(&root, &["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty()),
        building: BUILDING.load(Ordering::SeqCst),
        exe,
    }
}

/// "Built application at: C:\...\RobsAICockpit.exe" → path.
pub fn built_exe(line: &str) -> Option<PathBuf> {
    let i = line.find("Built application at:")?;
    let p = line[i + "Built application at:".len()..].trim();
    (!p.is_empty()).then(|| PathBuf::from(p))
}

/// Pull (optional) + release build in the background; progress as `update-progress` events,
/// the result as `update-done` { ok, exe, error }.
pub fn start(app: AppHandle, pull: bool) -> AppResult<()> {
    let root = repo_root().ok_or_else(|| AppError::invalid("The source folder this app was built from is not available"))?;
    if BUILDING.swap(true, Ordering::SeqCst) {
        return Err(AppError::invalid("An update is already being built"));
    }
    std::thread::spawn(move || {
        let emit = |line: &str| {
            let _ = app.emit("update-progress", line.to_string());
        };
        let result = (|| -> Result<PathBuf, String> {
            if pull {
                emit("git pull --ff-only …");
                let out = quiet(Command::new("git").arg("-C").arg(&root).args(["pull", "--ff-only"])).output().map_err(|e| e.to_string())?;
                emit(String::from_utf8_lossy(&out.stdout).trim());
                if !out.status.success() {
                    return Err(format!("git pull failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
                }
            }
            emit("pnpm install …");
            let _ = quiet(Command::new("cmd").args(["/d", "/c", "pnpm install --frozen-lockfile"]).current_dir(&root)).output();
            emit("Building the release (takes a few minutes) …");
            let mut child = quiet(Command::new("cmd").args(["/d", "/c", "pnpm tauri build --no-bundle 2>&1"]).current_dir(&root))
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| e.to_string())?;
            let mut exe = None;
            if let Some(out) = child.stdout.take() {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Some(p) = built_exe(&line) {
                        exe = Some(p);
                    }
                    let l = line.trim();
                    if l.starts_with("Compiling") || l.starts_with("Finished") || l.starts_with("Built") || l.contains("error") || l.starts_with("vite") || l.contains("modules transformed") {
                        emit(l);
                    }
                }
            }
            let status = child.wait().map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("The build failed — see the lines above".into());
            }
            exe.filter(|p| p.is_file()).ok_or_else(|| "Build finished but the executable was not found".into())
        })();
        BUILDING.store(false, Ordering::SeqCst);
        let _ = match result {
            Ok(exe) => app.emit("update-done", serde_json::json!({ "ok": true, "exe": exe })),
            Err(e) => app.emit("update-done", serde_json::json!({ "ok": false, "error": e })),
        };
    });
    Ok(())
}

/// PowerShell that waits for this process to end, replaces the executable and starts it.
pub fn swap_script(pid: u32, built: &Path, target: &Path) -> String {
    let q = |p: &Path| p.to_string_lossy().replace('\'', "''");
    format!(
        "$ErrorActionPreference='Stop'\n\
         try {{ Wait-Process -Id {pid} -Timeout 60 -ErrorAction SilentlyContinue }} catch {{}}\n\
         Start-Sleep -Milliseconds 500\n\
         for ($i=0; $i -lt 20; $i++) {{ try {{ Copy-Item -LiteralPath '{b}' -Destination '{t}' -Force; break }} catch {{\n\
           try {{ Rename-Item -LiteralPath '{t}' -NewName ('RobsAICockpit.previous-' + (Get-Date -Format yyyyMMdd-HHmmss) + '.exe') }} catch {{}}\n\
           Start-Sleep -Milliseconds 500 }} }}\n\
         Start-Process -FilePath '{t}'\n",
        b = q(built),
        t = q(target)
    )
}

/// Start the swap helper; the caller exits the app right after.
pub fn apply(built: &Path) -> AppResult<()> {
    if !built.is_file() {
        return Err(AppError::invalid("The new build was not found"));
    }
    let target = std::env::current_exe()?;
    if crate::cli::same_path(built, &target) {
        return Err(AppError::invalid("This build is already running"));
    }
    let script = std::env::temp_dir().join(format!("robs-ai-cockpit-update-{}.ps1", std::process::id()));
    std::fs::write(&script, swap_script(std::process::id(), built, &target))?;
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"]).arg(&script);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        cmd.creation_flags(0x0000_0008 | 0x0000_0200 | 0x0800_0000);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| AppError::other(format!("could not start the updater: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_built_executable_in_tauri_output() {
        assert_eq!(built_exe("       Built application at: C:\\x\\release\\RobsAICockpit.exe"), Some(PathBuf::from("C:\\x\\release\\RobsAICockpit.exe")));
        assert_eq!(built_exe("Compiling foo"), None);
    }

    #[test]
    fn swap_script_quotes_paths() {
        let s = swap_script(42, Path::new("C:\\b'x\\new.exe"), Path::new("C:\\Programs\\Robs AI Cockpit\\RobsAICockpit.exe"));
        assert!(s.contains("Wait-Process -Id 42"));
        assert!(s.contains("'C:\\b''x\\new.exe'"));
        assert!(s.contains("Start-Process -FilePath 'C:\\Programs\\Robs AI Cockpit\\RobsAICockpit.exe'"));
    }

    #[test]
    fn repo_root_is_this_checkout() {
        assert!(repo_root().is_some_and(|r| r.join("src-tauri").join("Cargo.toml").is_file()));
    }
}
