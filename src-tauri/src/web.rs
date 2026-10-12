//! Web material for the board: link previews (title, description, picture, first paragraphs) and
//! pictures fetched for cards. The page itself can only show `data:` images (content security
//! policy), so pictures come back as data URLs. Public http(s) addresses only.

use std::io::Read;
use std::time::Duration;

use base64::Engine;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

const MAX_PAGE: u64 = 3 * 1024 * 1024;
const MAX_MEDIA: u64 = 6 * 1024 * 1024;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RobsAICockpit/0.4 (link preview)";

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub url: String,
    pub title: String,
    pub description: String,
    pub image: Option<String>,
    pub site: String,
    /// The first paragraphs of the page, plain text.
    pub text: String,
}

/// Only public web addresses: no local files, no localhost or private networks.
pub fn check_url(u: &str) -> Result<String, String> {
    let u = u.trim();
    let rest = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")).ok_or("Only http and https links")?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").rsplit('@').next().unwrap_or("");
    let host = host.trim_start_matches('[').split(']').next().unwrap_or(host);
    let host = if host.contains(':') && !host.contains("::") { host.split(':').next().unwrap_or(host) } else { host };
    let h = host.to_lowercase();
    if h.is_empty() || !h.contains('.') && h != "::1" {
        return Err("Not a public address".into());
    }
    let private = h == "localhost"
        || h.ends_with(".localhost")
        || h.ends_with(".local")
        || h == "::1"
        || h.starts_with("127.")
        || h.starts_with("10.")
        || h.starts_with("192.168.")
        || h.starts_with("169.254.")
        || h.starts_with("0.")
        || (h.starts_with("172.") && h.split('.').nth(1).and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (16..=31).contains(&n)));
    if private {
        return Err("Local and private network addresses are not fetched".into());
    }
    Ok(u.to_string())
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(15))).http_status_as_error(false).max_redirects(5).build().new_agent()
}

/// GET → (final url, content type, body), at most `max` bytes.
fn get(url: &str, max: u64) -> Result<(String, String, Vec<u8>), String> {
    let url = check_url(url)?;
    let resp = agent().get(&url).header("User-Agent", UA).header("Accept-Language", "de,en;q=0.8").call().map_err(|e| format!("Could not load {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{url}: HTTP {}", resp.status()));
    }
    let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let mut body = Vec::new();
    resp.into_body().into_with_config().limit(max).reader().take(max).read_to_end(&mut body).map_err(|e| format!("Download interrupted: {e}"))?;
    Ok((url, ct, body))
}

static META: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<meta\b([^>]*)>").unwrap());
static ATTR: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
static TITLE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap());
static DROP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<(script|style|noscript|nav|footer|header|aside|form|svg)\b.*?</\s*(script|style|noscript|nav|footer|header|aside|form|svg)\s*>").unwrap());
static PARA: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<p\b[^>]*>(.*?)</p>").unwrap());
static TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<[^>]+>").unwrap());
static NUM_ENTITY: Lazy<Regex> = Lazy::new(|| Regex::new(r"&#(x?[0-9a-fA-F]+);").unwrap());

pub fn decode_entities(s: &str) -> String {
    let s = NUM_ENTITY.replace_all(s, |c: &regex::Captures| {
        let v = &c[1];
        let n = if let Some(h) = v.strip_prefix('x').or_else(|| v.strip_prefix('X')) { u32::from_str_radix(h, 16).ok() } else { v.parse().ok() };
        n.and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    s.replace("&nbsp;", " ").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn clean(s: &str) -> String {
    decode_entities(&TAG.replace_all(s, " ")).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `href` relative to `base` → absolute URL.
pub fn resolve(base: &str, href: &str) -> String {
    let href = href.trim();
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    let scheme_end = base.find("://").map(|i| i + 3).unwrap_or(0);
    let scheme = &base[..scheme_end.saturating_sub(3)];
    if let Some(h) = href.strip_prefix("//") {
        return format!("{scheme}://{h}");
    }
    let origin_end = base[scheme_end..].find('/').map(|i| i + scheme_end).unwrap_or(base.len());
    let origin = &base[..origin_end];
    if href.starts_with('/') {
        return format!("{origin}{href}");
    }
    let path = &base[..base.split(['?', '#']).next().unwrap_or(base).len()];
    let dir = match path.rfind('/') {
        Some(i) if i >= origin_end => &path[..=i],
        _ => return format!("{origin}/{href}"),
    };
    format!("{dir}{href}")
}

/// Title, description, picture and first paragraphs of an HTML page (pure, unit tested).
pub fn parse_preview(url: &str, html: &str) -> Preview {
    let mut meta = std::collections::HashMap::<String, String>::new();
    for m in META.captures_iter(html) {
        let mut key = None;
        let mut content = None;
        for a in ATTR.captures_iter(&m[1]) {
            let name = a[1].to_lowercase();
            let val = a.get(2).or_else(|| a.get(3)).map(|v| v.as_str().to_string()).unwrap_or_default();
            match name.as_str() {
                "property" | "name" => key = Some(val.to_lowercase()),
                "content" => content = Some(val),
                _ => {}
            }
        }
        if let (Some(k), Some(c)) = (key, content) {
            meta.entry(k).or_insert(c);
        }
    }
    let pick = |keys: &[&str]| keys.iter().find_map(|k| meta.get(*k)).map(|v| decode_entities(v).trim().to_string()).filter(|v| !v.is_empty());
    let title = pick(&["og:title", "twitter:title"]).or_else(|| TITLE.captures(html).map(|c| clean(&c[1]))).unwrap_or_default();
    let description = pick(&["og:description", "description", "twitter:description"]).unwrap_or_default();
    let image = pick(&["og:image", "og:image:url", "twitter:image", "twitter:image:src"]).map(|i| resolve(url, &i));
    let host = url.split("://").nth(1).unwrap_or(url).split('/').next().unwrap_or("").trim_start_matches("www.").to_string();
    let site = pick(&["og:site_name"]).unwrap_or(host);
    let body = DROP.replace_all(html, " ");
    let mut text = String::new();
    for p in PARA.captures_iter(&body) {
        let t = clean(&p[1]);
        if t.chars().count() < 40 {
            continue;
        }
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(&t);
        if text.chars().count() > 1400 {
            break;
        }
    }
    let text: String = text.chars().take(1600).collect();
    Preview { url: url.to_string(), title: title.chars().take(200).collect(), description: description.chars().take(500).collect(), image, site, text }
}

pub fn preview(url: &str) -> Result<Preview, String> {
    let (final_url, ct, body) = get(url, MAX_PAGE)?;
    if !ct.is_empty() && !ct.contains("html") && !ct.contains("xml") {
        let host = final_url.split("://").nth(1).unwrap_or("").split('/').next().unwrap_or("").to_string();
        return Ok(Preview { url: final_url.clone(), title: final_url.rsplit('/').next().unwrap_or(&final_url).to_string(), site: host, image: ct.starts_with("image/").then(|| final_url.clone()), ..Default::default() });
    }
    Ok(parse_preview(&final_url, &String::from_utf8_lossy(&body)))
}

/// A picture as `data:` URL (images only, at most 6 MB).
pub fn media(url: &str) -> Result<String, String> {
    let (_, ct, body) = get(url, MAX_MEDIA)?;
    let mime = ct.split(';').next().unwrap_or("").trim().to_string();
    if !mime.starts_with("image/") || mime.contains("svg") {
        return Err(format!("Not a picture ({})", if mime.is_empty() { "unknown type" } else { &mime }));
    }
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&body)))
}

/// One web search result.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

static HIT: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#).unwrap());
static SNIPPET: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<a[^>]*class="result__snippet"[^>]*>(.*?)</a>"#).unwrap());

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Results of DuckDuckGo's HTML page (pure, unit tested): the real address behind the redirect.
pub fn parse_search(html: &str) -> Vec<SearchHit> {
    let snippets: Vec<String> = SNIPPET.captures_iter(html).map(|c| clean(&c[1])).collect();
    HIT.captures_iter(html)
        .enumerate()
        .filter_map(|(i, c)| {
            let href = decode_entities(&c[1]);
            let url = match href.split("uddg=").nth(1) {
                Some(rest) => percent_decode(rest.split('&').next().unwrap_or("")),
                None if href.starts_with("http") => href.clone(),
                None => return None,
            };
            // ads point back to duckduckgo
            if !url.starts_with("http") || url.contains("duckduckgo.com/y.js") {
                return None;
            }
            Some(SearchHit { title: clean(&c[2]), url, snippet: snippets.get(i).cloned().unwrap_or_default() })
        })
        .take(8)
        .collect()
}

/// Search the web (DuckDuckGo, no account): at most 8 results.
pub fn search(query: &str) -> Result<Vec<SearchHit>, String> {
    let q = query.trim();
    if q.is_empty() || q.len() > 300 {
        return Err("Nothing to search for".into());
    }
    let url = format!("https://html.duckduckgo.com/html/?q={}", q.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>());
    let (_, _, body) = get(&url, MAX_PAGE)?;
    Ok(parse_search(&String::from_utf8_lossy(&body)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_results_come_with_their_real_address() {
        let html = r#"<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwasi.dev%2F&amp;rut=abc">WASI &amp; <b>WebAssembly</b></a>
            <a class="result__snippet" href="x">The <b>WebAssembly</b> System Interface</a></div>
            <div><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a><a class="result__snippet">ad</a></div>"#;
        assert_eq!(parse_search(html), vec![SearchHit { title: "WASI & WebAssembly".into(), url: "https://wasi.dev/".into(), snippet: "The WebAssembly System Interface".into() }]);
    }

    #[test]
    fn only_public_web_addresses() {
        assert!(check_url("https://developer.mozilla.org/en-US/docs/WebAssembly").is_ok());
        assert!(check_url("http://example.com:8080/x").is_ok());
        for bad in ["file:///C:/x", "ftp://a.b", "http://localhost:3000", "http://127.0.0.1/", "http://192.168.1.1", "http://10.0.0.8/admin", "http://172.20.0.1", "http://[::1]/", "https://intranet"] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
        assert!(check_url("http://172.40.0.1").is_ok(), "172.40 is public");
    }

    #[test]
    fn links_resolve_against_the_page() {
        assert_eq!(resolve("https://a.com/docs/page.html?x=1", "img/p.png"), "https://a.com/docs/img/p.png");
        assert_eq!(resolve("https://a.com/docs/page", "/static/p.png"), "https://a.com/static/p.png");
        assert_eq!(resolve("https://a.com", "p.png"), "https://a.com/p.png");
        assert_eq!(resolve("https://a.com/x", "//cdn.b.com/p.png"), "https://cdn.b.com/p.png");
        assert_eq!(resolve("https://a.com/x", "https://c.com/p.png"), "https://c.com/p.png");
    }

    #[test]
    fn preview_reads_meta_tags_and_paragraphs() {
        let html = r#"<html><head><title>Fallback &amp; title</title>
            <meta content="WebAssembly – MDN" property="og:title">
            <meta property='og:description' content='A low-level assembly-like language &#8212; fast.'>
            <meta property="og:image" content="/img/wasm.png"><meta property="og:site_name" content="MDN"></head>
            <body><nav><p>Menu menu menu menu menu menu menu menu menu menu</p></nav>
            <p>Short.</p><p>WebAssembly is a type of code that can be run in modern web browsers and provides new features.</p>
            <script>var x = "<p>not this paragraph at all, it is inside a script tag</p>";</script></body></html>"#;
        let p = parse_preview("https://developer.mozilla.org/en-US/docs/WebAssembly", html);
        assert_eq!(p.title, "WebAssembly – MDN");
        assert_eq!(p.description, "A low-level assembly-like language — fast.");
        assert_eq!(p.image.as_deref(), Some("https://developer.mozilla.org/img/wasm.png"));
        assert_eq!(p.site, "MDN");
        assert_eq!(p.text, "WebAssembly is a type of code that can be run in modern web browsers and provides new features.");
        let bare = parse_preview("https://www.example.com/a", "<title> Hi  there </title>");
        assert_eq!((bare.title.as_str(), bare.site.as_str(), bare.image), ("Hi there", "example.com", None));
    }
}
