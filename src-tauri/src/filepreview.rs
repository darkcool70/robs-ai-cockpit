//! What a file on disk shows on the board: a picture as a picture, text / Markdown / code / CSV as
//! its content, a PowerPoint as its thumbnail and slide titles, a Word document as its text, a
//! PDF with its page count. Local only, size-limited, read-only.

use std::io::Read;
use std::path::Path;

use base64::Engine;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

const MAX_IMAGE: u64 = 8 * 1024 * 1024;
const MAX_TEXT: usize = 200 * 1024;
const MAX_OFFICE: u64 = 80 * 1024 * 1024;

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    /// image | text | pptx | docx | pdf | other
    pub kind: String,
    pub name: String,
    pub size: u64,
    /// picture (or the presentation's thumbnail) as data URL
    pub image: Option<String>,
    /// text content (excerpt)
    pub text: Option<String>,
    /// PowerPoint: the first text of every slide
    pub slides: Vec<String>,
    /// PDF: pages
    pub pages: Option<usize>,
}

fn ext(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

const TEXT_EXT: &[&str] = &["txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "toml", "xml", "html", "css", "js", "ts", "tsx", "jsx", "rs", "py", "go", "java", "cs", "c", "cpp", "h", "sh", "ps1", "sql", "log", "ini", "cfg", "bas", "vba"];

static A_T: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<a:t>(.*?)</a:t>").unwrap());
static W_T: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<w:t[^>]*>(.*?)</w:t>|</w:p>").unwrap());
static PDF_PAGE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/Type\s*/Page[^s]").unwrap());

fn unxml(s: &str) -> String {
    crate::web::decode_entities(s)
}

/// Slide number from "ppt/slides/slide12.xml".
fn slide_no(name: &str) -> Option<u32> {
    name.strip_prefix("ppt/slides/slide")?.strip_suffix(".xml")?.parse().ok()
}

/// The first texts of a slide's XML, as its title line (pure, unit tested).
pub fn slide_title(xml: &str) -> String {
    let texts: Vec<String> = A_T.captures_iter(xml).map(|c| unxml(&c[1])).filter(|t| !t.trim().is_empty()).take(3).collect();
    let t = texts.join(" · ");
    t.chars().take(120).collect()
}

/// A Word document's text, paragraph by paragraph (pure, unit tested).
pub fn docx_text(xml: &str) -> String {
    let mut out = String::new();
    for c in W_T.captures_iter(xml) {
        match c.get(1) {
            Some(t) => out.push_str(&unxml(t.as_str())),
            None => out.push('\n'),
        }
        if out.len() > MAX_TEXT {
            break;
        }
    }
    out.trim().to_string()
}

fn read_zip_entry<R: Read + std::io::Seek>(z: &mut zip::ZipArchive<R>, name: &str, max: u64) -> Option<Vec<u8>> {
    let f = z.by_name(name).ok()?;
    let mut buf = Vec::new();
    f.take(max).read_to_end(&mut buf).ok()?;
    Some(buf)
}

pub fn preview(path: &Path) -> Result<FilePreview, String> {
    let meta = std::fs::metadata(path).map_err(|_| format!("{} not found", path.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let size = meta.len();
    let e = ext(path);
    let mut p = FilePreview { kind: "other".into(), name, size, ..Default::default() };
    match e.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => {
            if size > MAX_IMAGE {
                return Ok(p);
            }
            let mime = match e.as_str() { "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "bmp" => "image/bmp", _ => "image/png" };
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            p.kind = "image".into();
            p.image = Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
        }
        "pptx" | "docx" => {
            if size > MAX_OFFICE {
                return Ok(p);
            }
            let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
            let mut z = zip::ZipArchive::new(f).map_err(|_| "Not a valid Office file".to_string())?;
            if let Some(thumb) = read_zip_entry(&mut z, "docProps/thumbnail.jpeg", MAX_IMAGE) {
                p.image = Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(thumb)));
            }
            if e == "pptx" {
                p.kind = "pptx".into();
                let mut slides: Vec<(u32, String)> = z.file_names().filter_map(|n| slide_no(n).map(|i| (i, n.to_string()))).collect();
                slides.sort();
                for (_, n) in slides.into_iter().take(60) {
                    if let Some(xml) = read_zip_entry(&mut z, &n, 4 * 1024 * 1024) {
                        p.slides.push(slide_title(&String::from_utf8_lossy(&xml)));
                    }
                }
            } else {
                p.kind = "docx".into();
                if let Some(xml) = read_zip_entry(&mut z, "word/document.xml", 16 * 1024 * 1024) {
                    p.text = Some(docx_text(&String::from_utf8_lossy(&xml)).chars().take(MAX_TEXT).collect());
                }
            }
        }
        "pdf" => {
            p.kind = "pdf".into();
            if size <= MAX_OFFICE {
                let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
                p.pages = Some(PDF_PAGE.find_iter(&String::from_utf8_lossy(&bytes)).count()).filter(|n| *n > 0);
            }
        }
        x if TEXT_EXT.contains(&x) => {
            let mut buf = Vec::new();
            std::fs::File::open(path).map_err(|e| e.to_string())?.take(MAX_TEXT as u64).read_to_end(&mut buf).map_err(|e| e.to_string())?;
            p.kind = "text".into();
            p.text = Some(String::from_utf8_lossy(&buf).into_owned());
        }
        _ => {}
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn slides_and_documents_give_their_text() {
        assert_eq!(slide_title(r#"<p:sp><a:t>Quartal 3</a:t></p:sp><a:t> </a:t><a:t>Umsatz &amp; Kosten</a:t><a:t>a</a:t><a:t>b</a:t>"#), "Quartal 3 · Umsatz & Kosten · a");
        assert_eq!(slide_no("ppt/slides/slide12.xml"), Some(12));
        assert_eq!(slide_no("ppt/slides/_rels/slide1.xml.rels"), None);
        assert_eq!(docx_text(r#"<w:p><w:r><w:t>Hallo</w:t></w:r><w:r><w:t xml:space="preserve"> Welt</w:t></w:r></w:p><w:p><w:r><w:t>Zwei</w:t></w:r></w:p>"#), "Hallo Welt\nZwei");
    }

    #[test]
    fn files_on_disk_preview_by_type() {
        let dir = tempfile::tempdir().unwrap();
        let csv = dir.path().join("d.csv");
        std::fs::write(&csv, "a,b\n1,2\n").unwrap();
        let p = preview(&csv).unwrap();
        assert_eq!((p.kind.as_str(), p.text.as_deref()), ("text", Some("a,b\n1,2\n")));
        // a tiny pptx: two slides out of order, and a thumbnail
        let pptx = dir.path().join("deck.pptx");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&pptx).unwrap());
        let o: zip::write::SimpleFileOptions = Default::default();
        z.start_file("ppt/slides/slide2.xml", o).unwrap();
        z.write_all(b"<a:t>Zweite</a:t>").unwrap();
        z.start_file("ppt/slides/slide1.xml", o).unwrap();
        z.write_all(b"<a:t>Erste</a:t>").unwrap();
        z.start_file("docProps/thumbnail.jpeg", o).unwrap();
        z.write_all(&[0xff, 0xd8, 0xff]).unwrap();
        z.finish().unwrap();
        let p = preview(&pptx).unwrap();
        assert_eq!(p.kind, "pptx");
        assert_eq!(p.slides, vec!["Erste".to_string(), "Zweite".to_string()]);
        assert!(p.image.unwrap().starts_with("data:image/jpeg;base64,"));
        assert!(preview(&dir.path().join("missing.txt")).is_err());
    }
}
