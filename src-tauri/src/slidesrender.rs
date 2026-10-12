//! Real pages on the board: the bytes of a PDF (the UI renders its pages with pdf.js), and
//! PowerPoint slides as pictures — exported by PowerPoint itself when it is installed (Windows).
//! The export never touches a PowerPoint the user is working in: it opens the file read-only and
//! hidden, and only quits PowerPoint when it was not running before.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use base64::Engine;

const MAX_PDF: u64 = 60 * 1024 * 1024;
const MAX_SLIDES: usize = 40;

/// A PDF's bytes (PDFs only, at most 60 MB).
pub fn pdf_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")) != Some(true) {
        return Err("Not a PDF".into());
    }
    let meta = std::fs::metadata(path).map_err(|_| format!("{} not found", path.display()))?;
    if meta.len() > MAX_PDF {
        return Err("The PDF is too big to show (over 60 MB)".into());
    }
    std::fs::read(path).map_err(|e| e.to_string())
}

/// A folder per file version, so a second look is instant.
fn cache_dir(path: &Path) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    if let Ok(m) = std::fs::metadata(path) {
        m.len().hash(&mut h);
        if let Ok(t) = m.modified() {
            t.hash(&mut h);
        }
    }
    crate::paths::root().join("slides").join(format!("{:016x}", h.finish()))
}

/// The PowerShell that exports every slide as a PNG (pure, unit tested: quoting).
pub fn export_script(file: &Path, out: &Path) -> String {
    let q = |p: &Path| p.to_string_lossy().replace('\'', "''");
    format!(
        "$ErrorActionPreference='Stop'; $was = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0; \
         $ppt = New-Object -ComObject PowerPoint.Application; \
         try {{ $p = $ppt.Presentations.Open('{file}', $true, $false, $false); \
           foreach ($s in $p.Slides) {{ if ($s.SlideIndex -gt {max}) {{ break }}; $s.Export(('{out}\\' + $s.SlideIndex + '.png'), 'PNG', 1280, 720) }}; \
           $p.Close() }} finally {{ if (-not $was) {{ $ppt.Quit() }} }}",
        file = q(file),
        out = q(out),
        max = MAX_SLIDES
    )
}

fn slide_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<(u32, PathBuf)> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let p = e.path();
                    let n = p.file_stem()?.to_str()?.parse::<u32>().ok()?;
                    (p.extension()?.to_str()? == "png").then_some((n, p))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files.into_iter().map(|(_, p)| p).collect()
}

/// Every slide of a PowerPoint as a picture (data URLs), exported by PowerPoint.
pub fn pptx_slides(path: &Path) -> Result<Vec<String>, String> {
    if !path.is_file() {
        return Err(format!("{} not found", path.display()));
    }
    let dir = cache_dir(path);
    if slide_files(&dir).is_empty() {
        if !cfg!(windows) {
            return Err("Slide pictures need PowerPoint on Windows".into());
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &export_script(path, &dir)]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd.spawn().map_err(|e| format!("Could not start PowerShell: {e}"))?;
        let started = Instant::now();
        loop {
            if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
                if !s.success() && slide_files(&dir).is_empty() {
                    let _ = std::fs::remove_dir_all(&dir);
                    return Err("PowerPoint could not export the slides (is PowerPoint installed?)".into());
                }
                break;
            }
            if started.elapsed() > Duration::from_secs(150) {
                let _ = child.kill();
                return Err("PowerPoint took too long".into());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    Ok(slide_files(&dir)
        .into_iter()
        .take(MAX_SLIDES)
        .filter_map(|p| std::fs::read(p).ok())
        .map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pdfs_and_safe_quoting() {
        let d = tempfile::tempdir().unwrap();
        let txt = d.path().join("a.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(pdf_bytes(&txt).is_err());
        let pdf = d.path().join("a.PDF");
        std::fs::write(&pdf, b"%PDF-1.4").unwrap();
        assert_eq!(pdf_bytes(&pdf).unwrap(), b"%PDF-1.4");
        let s = export_script(Path::new("C:/Rob's Folien/deck.pptx"), Path::new("C:/out"));
        assert!(s.contains("Open('C:/Rob''s Folien/deck.pptx', $true, $false, $false)"));
        assert!(s.contains("if (-not $was) { $ppt.Quit() }"), "never closes a PowerPoint the user has open");
    }

    #[test]
    fn slides_come_in_order() {
        let d = tempfile::tempdir().unwrap();
        for n in ["10", "2", "1"] {
            std::fs::write(d.path().join(format!("{n}.png")), "x").unwrap();
        }
        std::fs::write(d.path().join("notes.txt"), "x").unwrap();
        let names: Vec<String> = slide_files(d.path()).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["1.png", "2.png", "10.png"]);
    }
}

#[cfg(test)]
mod live {
    /// `PPTX_TEST=<file.pptx> cargo test live_pptx -- --ignored` (needs PowerPoint).
    #[test]
    #[ignore]
    fn live_pptx_export() {
        let f = std::env::var("PPTX_TEST").expect("PPTX_TEST");
        let t = std::time::Instant::now();
        let slides = super::pptx_slides(std::path::Path::new(&f)).unwrap();
        println!("{} slides in {:?}, first {} bytes", slides.len(), t.elapsed(), slides.first().map(|s| s.len()).unwrap_or(0));
        assert!(!slides.is_empty());
        let t = std::time::Instant::now();
        assert_eq!(super::pptx_slides(std::path::Path::new(&f)).unwrap().len(), slides.len());
        println!("again (cached) in {:?}", t.elapsed());
    }
}
