//! Run a project's tests for the board: find how the project tests itself (npm / pnpm / yarn,
//! Cargo, pytest, Go), run it with a time limit and read the summary (passed / failed) from the
//! output of the common runners.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub command: String,
    pub dir: String,
    pub ok: bool,
    pub passed: u64,
    pub failed: u64,
    pub ms: u64,
    /// the end of the output (failures are usually there)
    pub tail: String,
    pub timed_out: bool,
}

/// How a project runs its tests: (command, directory). Several for mixed projects.
pub fn detect(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let pkg = root.join("package.json");
    if let Ok(text) = std::fs::read_to_string(&pkg) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            let script = v.pointer("/scripts/test").and_then(|s| s.as_str()).unwrap_or("");
            if !script.is_empty() && !script.contains("no test specified") {
                let runner = if root.join("pnpm-lock.yaml").is_file() { "pnpm test" } else if root.join("yarn.lock").is_file() { "yarn test" } else { "npm test --silent" };
                out.push((runner.to_string(), root.to_path_buf()));
            }
        }
    }
    for dir in [root.to_path_buf(), root.join("src-tauri")] {
        if dir.join("Cargo.toml").is_file() {
            out.push(("cargo test".to_string(), dir));
            break;
        }
    }
    if ["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini"].iter().any(|f| root.join(f).is_file()) && (root.join("tests").is_dir() || root.join("test").is_dir() || root.join("pytest.ini").is_file()) {
        out.push(("python -m pytest -q".to_string(), root.to_path_buf()));
    }
    if root.join("go.mod").is_file() {
        out.push(("go test ./...".to_string(), root.to_path_buf()));
    }
    out
}

/// How a project builds itself: (command, directory).
pub fn detect_build(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if let Ok(text) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if v.pointer("/scripts/build").and_then(|s| s.as_str()).is_some_and(|s| !s.trim().is_empty()) {
                let runner = if root.join("pnpm-lock.yaml").is_file() { "pnpm build" } else if root.join("yarn.lock").is_file() { "yarn build" } else { "npm run build --silent" };
                out.push((runner.to_string(), root.to_path_buf()));
            }
        }
    }
    for dir in [root.to_path_buf(), root.join("src-tauri")] {
        if dir.join("Cargo.toml").is_file() {
            out.push(("cargo build".to_string(), dir));
            break;
        }
    }
    if root.join("go.mod").is_file() {
        out.push(("go build ./...".to_string(), root.to_path_buf()));
    }
    out
}

static ANSI: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]").unwrap());
static VITEST: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*Tests\s+(?:(\d+) failed \|\s*)?(?:(\d+) passed)?").unwrap());
static JEST: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^Tests:\s+(?:(\d+) failed, )?(?:\d+ skipped, )?(?:(\d+) passed, )?\d+ total").unwrap());
static CARGO: Lazy<Regex> = Lazy::new(|| Regex::new(r"test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed").unwrap());
static PYTEST: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^=*\s*(.*?\d+ (?:passed|failed).*?) in [\d.]+s").unwrap());
static NUM_WORD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+) (passed|failed|error|errors)").unwrap());
static GO_OK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^ok\s+\S+").unwrap());
static GO_FAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^(?:--- FAIL|FAIL\s+\S+)").unwrap());

/// Passed / failed from a runner's output (pure, unit tested); None when no summary is found.
pub fn summary(output: &str) -> Option<(u64, u64)> {
    let o = ANSI.replace_all(output, "");
    let n = |m: Option<regex::Match>| m.and_then(|x| x.as_str().parse::<u64>().ok()).unwrap_or(0);
    if let Some(c) = VITEST.captures_iter(&o).filter(|c| c.get(1).is_some() || c.get(2).is_some()).last() {
        return Some((n(c.get(2)), n(c.get(1))));
    }
    if let Some(c) = JEST.captures_iter(&o).last() {
        return Some((n(c.get(2)), n(c.get(1))));
    }
    let cargo: Vec<_> = CARGO.captures_iter(&o).collect();
    if !cargo.is_empty() {
        return Some(cargo.iter().fold((0, 0), |(p, f), c| (p + n(c.get(1)), f + n(c.get(2)))));
    }
    if let Some(c) = PYTEST.captures_iter(&o).last() {
        let (mut p, mut f) = (0, 0);
        for w in NUM_WORD.captures_iter(&c[1]) {
            let v = w[1].parse::<u64>().unwrap_or(0);
            if &w[2] == "passed" { p += v } else { f += v }
        }
        return Some((p, f));
    }
    let (ok, fail) = (GO_OK.find_iter(&o).count() as u64, GO_FAIL.find_iter(&o).count() as u64);
    if ok + fail > 0 {
        return Some((ok, fail));
    }
    None
}

/// Run one command in `dir` (Windows: through cmd), at most `limit`; output tail and summary.
pub fn run(command: &str, dir: &Path, limit: Duration) -> Result<TestRun, String> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };
    cmd.current_dir(dir).env("CI", "1").env("FORCE_COLOR", "0").env("NO_COLOR", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("Could not run {command}: {e}"))?;
    let mut so = child.stdout.take().ok_or("no output")?;
    let mut se = child.stderr.take().ok_or("no output")?;
    let a = std::thread::spawn(move || { let mut b = Vec::new(); let _ = so.read_to_end(&mut b); b });
    let b = std::thread::spawn(move || { let mut v = Vec::new(); let _ = se.read_to_end(&mut v); v });
    let mut timed_out = false;
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(s);
        }
        if started.elapsed() > limit {
            timed_out = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let mut out = a.join().unwrap_or_default();
    out.extend(b.join().unwrap_or_default());
    let text = ANSI.replace_all(&String::from_utf8_lossy(&out), "").into_owned();
    let (passed, failed) = summary(&text).unwrap_or((0, 0));
    let ok = !timed_out && status.map(|s| s.success()).unwrap_or(false) && failed == 0;
    let chars: Vec<char> = text.chars().collect();
    let tail: String = chars[chars.len().saturating_sub(4000)..].iter().collect();
    Ok(TestRun { command: command.to_string(), dir: dir.to_string_lossy().into_owned(), ok, passed, failed, ms: started.elapsed().as_millis() as u64, tail, timed_out })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summaries_of_the_common_runners() {
        assert_eq!(summary(" Test Files  24 passed (24)\n      Tests  151 passed (151)\n"), Some((151, 0)));
        assert_eq!(summary("      Tests  1 failed | 136 passed (137)"), Some((136, 1)));
        assert_eq!(summary("Tests:       2 failed, 1 skipped, 40 passed, 43 total"), Some((40, 2)));
        assert_eq!(summary("test result: ok. 148 passed; 0 failed; 3 ignored\ntest result: FAILED. 2 passed; 1 failed;"), Some((150, 1)));
        assert_eq!(summary("===== 3 failed, 10 passed, 1 error in 1.20s ====="), Some((10, 4)));
        assert_eq!(summary("ok  \tgithub.com/x/a\t0.1s\nFAIL\tgithub.com/x/b\t0.2s\n"), Some((1, 1)));
        assert_eq!(summary("\x1b[32m      Tests  5 passed (5)\x1b[0m"), Some((5, 0)));
        assert_eq!(summary("nothing here"), None);
    }

    #[test]
    fn projects_say_how_they_test() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("package.json"), r#"{"scripts":{"test":"vitest run"}}"#).unwrap();
        std::fs::write(d.path().join("pnpm-lock.yaml"), "").unwrap();
        std::fs::create_dir(d.path().join("src-tauri")).unwrap();
        std::fs::write(d.path().join("src-tauri").join("Cargo.toml"), "").unwrap();
        let found: Vec<String> = detect(d.path()).into_iter().map(|(c, _)| c).collect();
        assert_eq!(found, vec!["pnpm test".to_string(), "cargo test".to_string()]);
        let e = tempfile::tempdir().unwrap();
        std::fs::write(e.path().join("package.json"), r#"{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}"#).unwrap();
        assert!(detect(e.path()).is_empty());
    }

    #[test]
    fn projects_say_how_they_build() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("package.json"), r#"{"scripts":{"build":"tsc && vite build","test":"vitest"}}"#).unwrap();
        std::fs::write(d.path().join("go.mod"), "module x").unwrap();
        let found: Vec<String> = detect_build(d.path()).into_iter().map(|(c, _)| c).collect();
        assert_eq!(found, vec!["npm run build --silent".to_string(), "go build ./...".to_string()]);
        assert!(detect_build(tempfile::tempdir().unwrap().path()).is_empty());
    }

    #[test]
    fn a_command_runs_and_is_read() {
        let d = tempfile::tempdir().unwrap();
        let r = run("echo       Tests  3 passed (3)", d.path(), Duration::from_secs(20)).unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!((r.passed, r.failed), (3, 0));
        let f = run("echo test result: FAILED. 2 passed; 1 failed; && exit 1", d.path(), Duration::from_secs(20)).unwrap();
        assert!(!f.ok);
        assert_eq!((f.passed, f.failed), (2, 1));
    }
}
