//! A project's code as the board sees it: every source file with its size and the imports it
//! names (raw, as written — the board resolves them), and when files last changed (file watches).
//! Local, read-only, bounded: generated / vendored folders are skipped, at most MAX_FILES files.

use std::path::Path;
use std::time::UNIX_EPOCH;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use walkdir::WalkDir;

const MAX_FILES: usize = 4000;
const MAX_BYTES: u64 = 512 * 1024;

/// Folders that are never the project's own code.
pub const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", "out", ".next", ".nuxt", "vendor", "__pycache__", ".venv", "venv", "env",
    ".idea", ".vscode", "coverage", ".turbo", ".cache", "bin", "obj", ".cockpit", ".worktrees", "site-packages", ".svelte-kit",
];

const CODE_EXT: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "rs", "py", "go", "java", "kt", "cs", "rb", "php", "swift", "c", "h", "cpp", "hpp"];

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeFile {
    /// relative to the root, with forward slashes
    pub path: String,
    pub lines: usize,
    /// what it imports, as written ("./board", "crate::store", "react", "os.path" …)
    pub imports: Vec<String>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeScan {
    pub root: String,
    pub files: Vec<CodeFile>,
    /// more files than MAX_FILES (the rest is left out)
    pub truncated: bool,
    /// manifest files found (package.json, Cargo.toml …) — what kind of project it is
    pub manifests: Vec<String>,
}

fn skip(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || (name.starts_with('.') && name.len() > 1)
}

static JS_IMPORT: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)(?:^\s*import\s[^'";]*?from\s*|^\s*import\s*|^\s*export\s[^'";]*?from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]"#).unwrap());
static RS_MOD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([a-z_][a-z0-9_]*)\s*;").unwrap());
static RS_USE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+((?:crate|super|self)(?:::[A-Za-z_][A-Za-z0-9_]*)+)").unwrap());
static RS_PATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(crate(?:::[a-z_][a-z0-9_]*)+)::").unwrap());
static PY_IMPORT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*(?:from\s+(\.*[A-Za-z0-9_.]*)\s+import|import\s+([A-Za-z0-9_.]+))").unwrap());
static GO_IMPORT: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\s*(?:import\s+)?(?:[A-Za-z_]+\s+)?"([^"]+)"\s*$"#).unwrap());
static C_INCLUDE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\s*#include\s+"([^"]+)""#).unwrap());
static JAVA_IMPORT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*(?:import|using)\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;").unwrap());

/// The imports a source file names, by its language.
pub fn imports_of(ext: &str, text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: &str| {
        let s = s.trim().to_string();
        if !s.is_empty() && !out.contains(&s) && out.len() < 200 {
            out.push(s);
        }
    };
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "vue" | "svelte" => JS_IMPORT.captures_iter(text).for_each(|c| push(&c[1])),
        "rs" => {
            RS_MOD.captures_iter(text).for_each(|c| push(&format!("mod {}", &c[1])));
            RS_USE.captures_iter(text).for_each(|c| push(&c[1]));
            RS_PATH.captures_iter(text).for_each(|c| push(&c[1]));
        }
        "py" => PY_IMPORT.captures_iter(text).for_each(|c| push(c.get(1).or(c.get(2)).map(|m| m.as_str()).unwrap_or(""))),
        "go" => {
            // only inside import blocks / lines
            let mut inside = false;
            for line in text.lines() {
                let l = line.trim();
                if l.starts_with("import (") {
                    inside = true;
                    continue;
                }
                if inside && l == ")" {
                    inside = false;
                    continue;
                }
                if inside || l.starts_with("import ") {
                    if let Some(c) = GO_IMPORT.captures(l) {
                        push(&c[1]);
                    }
                }
            }
        }
        "c" | "h" | "cpp" | "hpp" => C_INCLUDE.captures_iter(text).for_each(|c| push(&c[1])),
        "java" | "kt" | "cs" => JAVA_IMPORT.captures_iter(text).for_each(|c| push(&c[1])),
        _ => {}
    }
    out
}

/// Every source file under `root` with its imports (bounded).
pub fn scan(root: &Path) -> Result<CodeScan, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    let mut out = CodeScan { root: root.to_string_lossy().replace('\\', "/"), ..Default::default() };
    let walker = WalkDir::new(root).max_depth(12).into_iter().filter_entry(|e| e.depth() == 0 || !(e.file_type().is_dir() && skip(&e.file_name().to_string_lossy())));
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let rel = p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/");
        let name = entry.file_name().to_string_lossy().to_string();
        if ["package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml", "build.gradle", "setup.py", "requirements.txt"].contains(&name.as_str()) && out.manifests.len() < 40 {
            out.manifests.push(rel.clone());
        }
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !CODE_EXT.contains(&ext.as_str()) || name.ends_with(".d.ts") || name.ends_with(".min.js") {
            continue;
        }
        if out.files.len() >= MAX_FILES {
            out.truncated = true;
            break;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if size > MAX_BYTES {
            out.files.push(CodeFile { path: rel, lines: 0, imports: vec![] });
            continue;
        }
        let text = std::fs::read_to_string(p).unwrap_or_default();
        out.files.push(CodeFile { path: rel, lines: text.lines().count(), imports: imports_of(&ext, &text) });
    }
    Ok(out)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub path: String,
    pub exists: bool,
    /// newest change inside (ms since 1970); a folder: its newest file
    pub modified: u64,
    /// files counted (a folder: how many inside)
    pub files: usize,
}

fn mtime(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// When a file — or anything in a folder — last changed (file watches poll this).
pub fn stamp(path: &Path) -> Stamp {
    let shown = path.to_string_lossy().replace('\\', "/");
    let Ok(meta) = std::fs::metadata(path) else {
        return Stamp { path: shown, exists: false, modified: 0, files: 0 };
    };
    if meta.is_file() {
        return Stamp { path: shown, exists: true, modified: mtime(&meta), files: 1 };
    }
    let mut newest = mtime(&meta);
    let mut files = 0;
    let walker = WalkDir::new(path).max_depth(10).into_iter().filter_entry(|e| e.depth() == 0 || !(e.file_type().is_dir() && skip(&e.file_name().to_string_lossy())));
    for e in walker.flatten().take(20_000) {
        if let Ok(m) = e.metadata() {
            if m.is_file() {
                files += 1;
            }
            newest = newest.max(mtime(&m));
        }
    }
    Stamp { path: shown, exists: true, modified: newest, files }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_imports_in_every_language() {
        let ts = "import { a } from \"./board\";\nimport type { B } from '../lib/api';\nimport \"./x.css\";\nexport { c } from './c';\nconst d = require('fs');\nconst e = await import(\"./lazy\");";
        assert_eq!(imports_of("ts", ts), vec!["./board", "../lib/api", "./x.css", "./c", "fs", "./lazy"]);
        let rs = "mod store;\npub mod commands;\nuse crate::db::Db;\nuse super::x;\nfn f() { crate::paths::home(); }";
        assert_eq!(imports_of("rs", rs), vec!["mod store", "mod commands", "crate::db::Db", "super::x", "crate::db", "crate::paths"]);
        let py = "import os\nfrom .models import User\nfrom app.db import session\n";
        assert_eq!(imports_of("py", py), vec!["os", ".models", "app.db"]);
        let go = "package main\nimport (\n  \"fmt\"\n  db \"example.com/app/db\"\n)\n";
        assert_eq!(imports_of("go", go), vec!["fmt", "example.com/app/db"]);
    }

    #[test]
    fn scans_a_project_and_skips_generated_folders() {
        let dir = std::env::temp_dir().join(format!("codemap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src/lib")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("package.json"), "{}").unwrap();
        std::fs::write(dir.join("src/main.ts"), "import { a } from './lib/a';\n").unwrap();
        std::fs::write(dir.join("src/lib/a.ts"), "export const a = 1;\n").unwrap();
        std::fs::write(dir.join("node_modules/x/index.js"), "x").unwrap();
        let s = scan(&dir).unwrap();
        let mut paths: Vec<_> = s.files.iter().map(|f| f.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["src/lib/a.ts", "src/main.ts"]);
        assert_eq!(s.manifests, vec!["package.json"]);
        assert_eq!(s.files.iter().find(|f| f.path == "src/main.ts").unwrap().imports, vec!["./lib/a"]);
        let st = stamp(&dir.join("src"));
        assert!(st.exists && st.files == 2 && st.modified > 0);
        assert!(!stamp(&dir.join("nope")).exists);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
