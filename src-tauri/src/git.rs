//! Git awareness via the `git` CLI (no libgit2: smaller, and respects the user's git config).
//!
//! Safety: worktree removal never uses `--force` and refuses when the worktree has
//! uncommitted or untracked changes. Nothing is ever deleted automatically.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub staged: i64,
    pub modified: i64,
    pub untracked: i64,
    pub conflicted: i64,
    pub files: Vec<FileChange>,
    pub insertions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub is_main: bool,
    pub locked: bool,
    pub prunable: bool,
}

fn git(dir: &Path, args: &[&str]) -> AppResult<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| AppError::other(format!("git not available: {e}")))?;
    if !out.status.success() {
        return Err(AppError::other(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn parse_porcelain_v2(text: &str) -> GitStatus {
    let mut s = GitStatus { is_repo: true, ..Default::default() };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# branch.oid ") {
            s.head = (rest != "(initial)").then(|| rest.chars().take(10).collect());
        } else if let Some(rest) = line.strip_prefix("# branch.head ") {
            s.branch = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            s.upstream = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let parts: Vec<&str> = line.splitn(if line.starts_with("1 ") { 9 } else { 10 }, ' ').collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let path = parts.last().copied().unwrap_or("").split('\t').next().unwrap_or("").to_string();
            let (x, y) = (xy.chars().next().unwrap_or('.'), xy.chars().nth(1).unwrap_or('.'));
            if x != '.' {
                s.staged += 1;
            }
            if y != '.' {
                s.modified += 1;
            }
            s.files.push(FileChange { path, code: xy.to_string() });
        } else if let Some(rest) = line.strip_prefix("u ") {
            s.conflicted += 1;
            let path = rest.rsplit(' ').next().unwrap_or("").to_string();
            s.files.push(FileChange { path, code: "UU".into() });
        } else if let Some(rest) = line.strip_prefix("? ") {
            s.untracked += 1;
            s.files.push(FileChange { path: rest.to_string(), code: "??".into() });
        }
    }
    s
}

pub fn parse_shortstat(text: &str) -> (i64, i64) {
    let mut ins = 0;
    let mut del = 0;
    for part in text.split(',') {
        let p = part.trim();
        let n: i64 = p.split_whitespace().next().and_then(|x| x.parse().ok()).unwrap_or(0);
        if p.contains("insertion") {
            ins = n;
        } else if p.contains("deletion") {
            del = n;
        }
    }
    (ins, del)
}

pub fn status(dir: &Path) -> AppResult<GitStatus> {
    let out = match git(dir, &["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]) {
        Ok(o) => o,
        Err(_) => return Ok(GitStatus::default()),
    };
    let mut s = parse_porcelain_v2(&out);
    s.files.truncate(500);
    if s.head.is_some() {
        if let Ok(stat) = git(dir, &["diff", "HEAD", "--shortstat"]) {
            let (i, d) = parse_shortstat(&stat);
            s.insertions = i;
            s.deletions = d;
        }
    }
    Ok(s)
}

pub fn parse_worktrees(text: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    let mut cur: Option<Worktree> = None;
    for line in text.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if let Some(w) = cur.take() {
                out.push(w);
            }
            continue;
        }
        if let Some(p) = line.strip_prefix("worktree ") {
            cur = Some(Worktree { path: p.to_string(), head: None, branch: None, is_main: out.is_empty(), locked: false, prunable: false });
        } else if let Some(w) = cur.as_mut() {
            if let Some(h) = line.strip_prefix("HEAD ") {
                w.head = Some(h.chars().take(10).collect());
            } else if let Some(b) = line.strip_prefix("branch ") {
                w.branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line.starts_with("locked") {
                w.locked = true;
            } else if line.starts_with("prunable") {
                w.prunable = true;
            }
        }
    }
    out
}

pub fn worktrees(dir: &Path) -> AppResult<Vec<Worktree>> {
    Ok(parse_worktrees(&git(dir, &["worktree", "list", "--porcelain"])?))
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 60
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.starts_with('.')
        && !name.starts_with('-')
        && !name.contains("..")
}

/// Create `<repo>/.worktrees/<name>` on a new branch `<name>`.
pub fn add_worktree(repo: &Path, name: &str, base: Option<&str>) -> AppResult<Worktree> {
    if !valid_name(name) {
        return Err(AppError::invalid("Worktree name may only contain letters, digits, '-', '_' and '.'"));
    }
    let top = PathBuf::from(git(repo, &["rev-parse", "--show-toplevel"])?.trim());
    let target = top.join(".worktrees").join(name);
    if target.exists() {
        return Err(AppError::invalid(format!("{} already exists", target.display())));
    }
    ensure_ignored(&top)?;
    let target_s = target.to_string_lossy().into_owned();
    let mut args = vec!["worktree", "add", "-b", name, &target_s];
    if let Some(b) = base.filter(|b| !b.is_empty()) {
        args.push(b);
    }
    git(&top, &args)?;
    worktrees(&top)?
        .into_iter()
        .find(|w| crate::cli::same_path(Path::new(&w.path), &target))
        .ok_or_else(|| AppError::other("worktree created but not listed"))
}

/// Make sure `.worktrees/` is ignored locally (via .git/info/exclude, not a tracked file).
fn ensure_ignored(top: &Path) -> AppResult<()> {
    let git_dir = PathBuf::from(git(top, &["rev-parse", "--git-common-dir"])?.trim());
    let git_dir = if git_dir.is_absolute() { git_dir } else { top.join(git_dir) };
    let exclude = git_dir.join("info").join("exclude");
    let current = std::fs::read_to_string(&exclude).unwrap_or_default();
    if !current.lines().any(|l| l.trim() == ".worktrees/") {
        std::fs::create_dir_all(exclude.parent().unwrap())?;
        let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
        std::fs::write(&exclude, format!("{current}{sep}.worktrees/\n"))?;
    }
    Ok(())
}

/// Remove a linked worktree only if it is clean. The branch is kept.
pub fn remove_worktree(repo: &Path, wt: &Path) -> AppResult<()> {
    let list = worktrees(repo)?;
    let entry = list
        .iter()
        .find(|w| crate::cli::same_path(Path::new(&w.path), wt))
        .ok_or_else(|| AppError::invalid("Not a worktree of this repository"))?;
    if entry.is_main {
        return Err(AppError::invalid("Refusing to remove the main worktree"));
    }
    if entry.locked {
        return Err(AppError::invalid("Worktree is locked"));
    }
    if wt.exists() {
        let st = status(wt)?;
        if st.staged + st.modified + st.untracked + st.conflicted > 0 {
            return Err(AppError::invalid(format!(
                "Worktree has uncommitted changes ({} staged, {} modified, {} untracked). Commit or discard them first.",
                st.staged, st.modified, st.untracked
            )));
        }
    }
    git(repo, &["worktree", "remove", &wt.to_string_lossy()])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let t = "# branch.oid 1234567890abcdef\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 aaa bbb src/a.rs\n1 A. N... 000000 100644 100644 000 ccc src/new.rs\n2 R. N... 100644 100644 100644 a b R100 src/to.rs\tsrc/from.rs\n? notes.txt\n";
        let s = parse_porcelain_v2(t);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.head.as_deref(), Some("1234567890"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert_eq!((s.staged, s.modified, s.untracked), (2, 1, 1));
        assert_eq!(s.files[0].path, "src/a.rs");
        assert_eq!(s.files[2].path, "src/to.rs");
    }

    #[test]
    fn parses_shortstat_and_worktrees() {
        assert_eq!(parse_shortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)\n"), (10, 2));
        assert_eq!(parse_shortstat(" 1 file changed, 1 deletion(-)"), (0, 1));
        let wt = parse_worktrees("worktree C:/r\nHEAD abcdef1234567\nbranch refs/heads/main\n\nworktree C:/r/.worktrees/x\nHEAD 111\nbranch refs/heads/x\nlocked\n");
        assert_eq!(wt.len(), 2);
        assert!(wt[0].is_main && !wt[1].is_main);
        assert_eq!(wt[1].branch.as_deref(), Some("x"));
        assert!(wt[1].locked);
    }

    #[test]
    fn worktree_names_are_validated() {
        assert!(valid_name("claude-feature_1"));
        for bad in ["", "../x", "a/b", "-rf", ".hidden", "a b", "x..y"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    fn has_git() -> bool {
        std::process::Command::new("git").arg("--version").output().is_ok()
    }

    #[test]
    fn worktree_lifecycle_refuses_dirty_removal() {
        if !has_git() {
            eprintln!("git not installed; skipping");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let run = |args: &[&str]| git(repo, args).unwrap();
        run(&["init", "-q", "-b", "main"]);
        run(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
        let wt = add_worktree(repo, "codex-tests", None).unwrap();
        assert_eq!(wt.branch.as_deref(), Some("codex-tests"));
        let wt_path = PathBuf::from(&wt.path);
        assert!(wt_path.is_dir());
        // Main repo stays clean thanks to info/exclude.
        assert_eq!(status(repo).unwrap().untracked, 0);

        std::fs::write(wt_path.join("work.txt"), "uncommitted").unwrap();
        let err = remove_worktree(repo, &wt_path).unwrap_err().to_string();
        assert!(err.contains("uncommitted"), "{err}");
        assert!(wt_path.join("work.txt").exists(), "work preserved");

        std::fs::remove_file(wt_path.join("work.txt")).unwrap();
        remove_worktree(repo, &wt_path).unwrap();
        assert!(!wt_path.exists());
        assert!(remove_worktree(repo, repo).is_err(), "main worktree protected");
    }
}
