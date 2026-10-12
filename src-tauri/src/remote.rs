//! Phone remote: a tiny web page in the home network to see the agents and answer them.
//!
//! Off by default. Every request needs the access key (128-bit random, part of the URL the
//! cockpit shows); plain HTTP, so it is meant for a trusted home network only. It can only
//! read agent status / last answers and queue text into running agent sessions — the same
//! input queue the cockpit uses, so text is typed only when the CLI is ready.
//!
//! The board (Pro) can be shown too, read-only: the cockpit pushes a self-contained HTML snapshot
//! of the open board (no scripts, pictures inline) and the phone page shows it in a sandboxed
//! frame. Only peers from private / link-local / loopback addresses are answered.
//!
//! Keys expire: the owner's key (and the optional view-only key for colleagues) carries an
//! expiry; an expired key gets 401 and a calm "Link abgelaufen" page. The view-only key opens
//! only the board (with the operator's answer) — the server refuses everything else for it.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::monitor::Runtimes;

pub struct Remote {
    /// The running listener: its stop flag and its thread (joined on stop, so the port is free again).
    stop: Mutex<Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>>,
    pub info: Mutex<Option<RemoteInfo>>,
    /// The board as the cockpit last shared it (read-only snapshot), while the remote is on.
    board: Arc<Mutex<Option<SharedBoard>>>,
    /// "Seit du weg bist": what happened since you left the cockpit (Pro), while you are away.
    digest: Arc<Mutex<Option<AwayDigest>>>,
    /// Who may ask: the owner's key and the optional view-only key, each with its expiry.
    access: Arc<Mutex<Access>>,
}

/// One access key and until when it opens the page (ms since the epoch).
#[derive(Debug, Clone, Default)]
pub struct KeyEntry {
    pub key: String,
    pub expires: u64,
}

/// The keys the remote answers to. Never logged, never sent anywhere but in the links.
#[derive(Debug, Clone, Default)]
pub struct Access {
    pub owner: KeyEntry,
    /// a second key for colleagues: the board and the operator's answer, nothing to send
    pub viewer: Option<KeyEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Owner,
    Viewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Auth {
    /// the role and until when its key is valid
    Ok(Role, u64),
    /// a key that was valid once (the page says "Link abgelaufen")
    Expired(Role),
    Denied,
}

/// A key lives 24 h unless another lifetime was chosen (8 h / 24 h / 7 days in Settings).
pub const DEFAULT_TTL_MS: u64 = 24 * 3_600_000;
/// The longest lifetime the cockpit offers (7 days) plus a little slack; never longer.
pub const MAX_TTL_MS: u64 = 7 * 24 * 3_600_000 + 3_600_000;

/// 0 → the default lifetime from now; never later than the longest lifetime from now.
pub fn clamp_expiry(expires: u64, now: u64) -> u64 {
    if expires == 0 {
        now + DEFAULT_TTL_MS
    } else {
        expires.min(now + MAX_TTL_MS)
    }
}

/// Check both keys against `k` (constant time each); a matching key past its expiry is `Expired`.
pub fn authorize(access: &Access, k: Option<&str>, now: u64) -> Auth {
    let Some(k) = k.filter(|k| valid_key(k)) else { return Auth::Denied };
    let owner = eq_ct(k, &access.owner.key);
    let viewer = access.viewer.as_ref().filter(|v| eq_ct(k, &v.key));
    let (role, entry) = match (owner, viewer) {
        (true, _) => (Role::Owner, &access.owner),
        (false, Some(v)) => (Role::Viewer, v),
        _ => return Auth::Denied,
    };
    if now >= entry.expires {
        Auth::Expired(role)
    } else {
        Auth::Ok(role, entry.expires)
    }
}

/// The keys as the cockpit hands them over: valid, distinct, expiries clamped.
pub fn make_access(key: String, expires: u64, viewer: Option<(String, u64)>, now: u64) -> AppResult<Access> {
    if !valid_key(&key) {
        return Err(AppError::invalid("Remote access key is missing"));
    }
    let viewer = match viewer {
        Some((vk, _)) if !valid_key(&vk) => return Err(AppError::invalid("View-only key is not valid")),
        Some((vk, _)) if vk == key => return Err(AppError::invalid("The view-only key must differ from the access key")),
        Some((vk, ve)) => Some(KeyEntry { key: vk, expires: clamp_expiry(ve, now) }),
        None => None,
    };
    Ok(Access { owner: KeyEntry { key, expires: clamp_expiry(expires, now) }, viewer })
}

/// One line of the "since you were away" digest; `kind` picks its colour on the phone, `anchor`
/// (opaque, per snapshot) is the card on the phone's board page the line is about.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AwayLine {
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
}

/// What happened since `since` (ms), in a few short lines, for the top of the phone page.
#[derive(Debug, Clone, Default, Serialize)]
pub struct AwayDigest {
    pub since: u64,
    pub lines: Vec<AwayLine>,
}

/// The digest stays short: this many lines of at most this many characters.
pub const MAX_DIGEST_LINES: usize = 8;
pub const MAX_DIGEST_CHARS: usize = 200;

/// A read-only snapshot of the open board for the phone, and who the operator is.
#[derive(Debug, Clone, Default)]
pub struct SharedBoard {
    pub html: String,
    pub title: String,
    pub ts: u64,
    /// session id of the operator (its answers are shown cleaned, it is listed first)
    pub operator: Option<String>,
    /// the operator's latest answer without its action block
    pub answer: Option<String>,
}

/// Largest board snapshot the phone gets (pictures are inline).
pub const MAX_SHARED_BOARD: usize = 8 * 1024 * 1024;
/// What phone messages to the operator start with, so it knows you read on a small screen.
pub const PHONE_PREFIX: &str = "[Vom Handy] ";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub url: String,
    pub port: u16,
    /// until when the link's key is valid (ms)
    pub expires: u64,
    /// the view-only link for colleagues (board and operator answer, nothing to send)
    pub view_url: Option<String>,
    pub view_expires: Option<u64>,
    /// "http://<lan ip>:<port>" — the links are rebuilt from it when the keys change
    #[serde(skip)]
    base: String,
}

impl RemoteInfo {
    fn new(base: String, port: u16, access: &Access) -> Self {
        RemoteInfo {
            url: format!("{base}/?k={}", access.owner.key),
            port,
            expires: access.owner.expires,
            view_url: access.viewer.as_ref().map(|v| format!("{base}/?k={}", v.key)),
            view_expires: access.viewer.as_ref().map(|v| v.expires),
            base,
        }
    }
}

impl Default for Remote {
    fn default() -> Self {
        Remote {
            stop: Mutex::new(None),
            info: Mutex::new(None),
            board: Arc::new(Mutex::new(None)),
            digest: Arc::new(Mutex::new(None)),
            access: Arc::new(Mutex::new(Access::default())),
        }
    }
}

/// Only the home network may ask: loopback, private (10/8, 172.16/12, 192.168/16), link-local,
/// and IPv6 unique-local / link-local addresses. Anything routed from outside is dropped.
pub fn is_lan_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_lan_peer(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            v6.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

/// Best guess of this computer's address in the home network (no packet is sent).
pub fn lan_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.168.0.1:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

fn eq_ct(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn valid_key(k: &str) -> bool {
    k.len() >= 24 && k.chars().all(|c| c.is_ascii_alphanumeric())
}

impl Remote {
    /// Start listening with the owner's key (expiry in ms, 0: the default lifetime) and an optional
    /// view-only key for colleagues.
    pub fn start(&self, db: Arc<Db>, runtimes: Runtimes, port: u16, key: String, expires: u64, viewer: Option<(String, u64)>) -> AppResult<RemoteInfo> {
        // one start / stop at a time (two quick starts must not leave a listener without keys)
        let mut slot = self.stop.lock();
        self.halt(&mut slot);
        let access = make_access(key, expires, viewer, crate::db::now_ms() as u64)?;
        let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|e| AppError::other(format!("Port {port} is not available: {e}")))?;
        listener.set_nonblocking(true)?;
        let flag = Arc::new(AtomicBool::new(false));
        let info = RemoteInfo::new(format!("http://{}:{port}", lan_ip()), port, &access);
        *self.access.lock() = access;
        *self.info.lock() = Some(info.clone());
        let board = self.board.clone();
        let digest = self.digest.clone();
        let keys = self.access.clone();
        let running = flag.clone();
        let thread = std::thread::spawn(move || {
            let flag = running;
            while !flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, peer)) => {
                        if !is_lan_peer(peer.ip()) {
                            drop(stream);
                            continue;
                        }
                        // On Windows an accepted socket inherits the listener's non-blocking
                        // mode: a request that arrives a moment later would read as "no data".
                        let _ = stream.set_nonblocking(false);
                        let (db, rts, keys, board, digest) = (db.clone(), runtimes.clone(), keys.clone(), board.clone(), digest.clone());
                        std::thread::spawn(move || {
                            let closer = stream.try_clone().ok();
                            let _ = handle(stream, &db, &rts, &keys, &board, &digest);
                            // Close gracefully: send FIN, then drain. Dropping a socket with unread
                            // bytes makes Windows send a reset, and the phone loses the response.
                            if let Some(mut c) = closer {
                                let _ = c.shutdown(std::net::Shutdown::Write);
                                let _ = c.set_read_timeout(Some(Duration::from_millis(300)));
                                let mut buf = [0u8; 512];
                                while matches!(c.read(&mut buf), Ok(n) if n > 0) {}
                            }
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
                    Err(_) => std::thread::sleep(Duration::from_millis(500)),
                }
            }
        });
        *slot = Some((flag, thread));
        Ok(info)
    }

    pub fn stop(&self) {
        let mut slot = self.stop.lock();
        self.halt(&mut slot);
    }

    #[allow(clippy::type_complexity)]
    fn halt(&self, slot: &mut Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)>) {
        if let Some((f, thread)) = slot.take() {
            f.store(true, Ordering::SeqCst);
            // the loop sees the flag within one poll (≤ 0.5 s) and drops the listener: the port is free
            let _ = thread.join();
        }
        *self.info.lock() = None;
        *self.board.lock() = None;
        *self.digest.lock() = None;
        *self.access.lock() = Access::default();
    }

    /// New keys while the remote is on ("New key", a view-only link made or revoked) — no restart,
    /// the old keys stop working at once. Errors while the remote is off.
    pub fn set_keys(&self, key: String, expires: u64, viewer: Option<(String, u64)>) -> AppResult<RemoteInfo> {
        let access = make_access(key, expires, viewer, crate::db::now_ms() as u64)?;
        let mut info = self.info.lock();
        let Some(cur) = info.as_mut() else { return Err(AppError::invalid("The phone remote is off")) };
        *cur = RemoteInfo::new(cur.base.clone(), cur.port, &access);
        *self.access.lock() = access;
        Ok(cur.clone())
    }

    /// The cockpit says what happened since you left (no lines: you are back, the digest goes).
    /// Ignored while the remote is off; returns whether it was taken.
    pub fn share_digest(&self, since: u64, lines: Vec<AwayLine>) -> bool {
        if self.info.lock().is_none() {
            return false;
        }
        let lines: Vec<AwayLine> = lines
            .into_iter()
            .filter(|l| !l.text.trim().is_empty())
            .take(MAX_DIGEST_LINES)
            .map(|l| AwayLine {
                kind: l.kind.chars().filter(|c| c.is_ascii_lowercase()).take(12).collect(),
                text: l.text.trim().chars().take(MAX_DIGEST_CHARS).collect(),
                // an anchor reaches the page only as a plain short token (it ends up in an attribute)
                anchor: l.anchor.filter(|a| !a.is_empty() && a.len() <= 32 && a.chars().all(|c| c.is_ascii_alphanumeric())),
            })
            .collect();
        *self.digest.lock() = if lines.is_empty() { None } else { Some(AwayDigest { since, lines }) };
        true
    }

    /// The cockpit shares the open board (and who the operator is). Ignored while the remote is off.
    pub fn share_board(&self, mut shared: SharedBoard) -> AppResult<bool> {
        if shared.html.len() > MAX_SHARED_BOARD {
            return Err(AppError::invalid("The board is too big to share"));
        }
        if self.info.lock().is_none() {
            return Ok(false);
        }
        shared.title = shared.title.chars().take(120).collect();
        shared.answer = shared.answer.map(|a| a.chars().take(4000).collect());
        shared.ts = crate::db::now_ms() as u64;
        *self.board.lock() = Some(shared);
        Ok(true)
    }
}

struct Request {
    method: String,
    path: String,
    query: String,
    body: Vec<u8>,
}

/// The most a request may be (line, headers and body): a peer that sends an endless line without
/// a line break gets "bad request" instead of growing the cockpit's memory.
const MAX_REQUEST: u64 = 64 * 1024 + 200_000;

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let mut reader = BufReader::new(stream.try_clone().ok()?.take(MAX_REQUEST));
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
    }
    if len > 200_000 {
        return None;
    }
    let mut body = vec![0; len];
    reader.read_exact(&mut body).ok()?;
    let (path, query) = target.split_once('?').map(|(p, q)| (p.to_string(), q.to_string())).unwrap_or((target, String::new()));
    Some(Request { method, path, query, body })
}

fn param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == name).map(|(_, v)| v.to_string()))
}

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, body: &[u8]) -> std::io::Result<()> {
    respond_with(stream, status, ctype, "", body)
}

fn respond_with(stream: &mut TcpStream, status: &str, ctype: &str, extra: &str, body: &[u8]) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n{extra}Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)
}

/// The board snapshot may show pictures and styles, never run a script or load anything.
const BOARD_CSP: &str = "Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'\r\n";

const NO_BOARD: &str = r#"<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0d1117;color:#8b98a9;font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;padding:16px}</style></head><body><p>Noch kein Board geteilt.<br>Öffne im Cockpit ein Board — es erscheint hier von selbst.</p></body></html>"#;

/// The phone pages run their own inline script, talk only to this server and frame only the board.
const PAGE_CSP: &str = "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n";

/// A calm page instead of the app when the link no longer opens it (no script, nothing about the keys).
fn gone_page(expired: Option<Role>) -> String {
    let (head, sub) = match expired {
        Some(Role::Owner) => ("Link abgelaufen – scanne den QR-Code neu", "Der Link galt nur für eine Weile. Im Cockpit: Einstellungen → Phone remote → QR code."),
        Some(Role::Viewer) => ("Link abgelaufen", "Dieser Link zum Mitlesen galt nur für eine Weile – frag nach einem neuen."),
        None => ("Dieser Link gilt nicht (mehr) – scanne den QR-Code neu", "Im Cockpit: Einstellungen → Phone remote → QR code."),
    };
    format!(
        r#"<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Robs AI Cockpit</title><style>body{{margin:0;background:#0d1014;color:#d6dde6;font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;padding:16px}}.logo{{width:34px;height:34px;margin:0 auto 14px;border-radius:50%;background:#000;color:#22d66e;font-weight:700;display:grid;place-items:center}}p{{margin:6px auto;max-width:34ch}}.m{{color:#8a95a3;font-size:13.5px}}</style></head><body><div><div class="logo">R</div><p><b>{head}</b></p><p class="m">{sub}</p></div></body></html>"#
    )
}

/// 401: pages get the calm page, the API a short JSON the phone page understands.
fn deny(stream: &mut TcpStream, req: &Request, expired: Option<Role>) -> std::io::Result<()> {
    if req.method == "GET" && (req.path == "/" || req.path == "/board") {
        return respond_with(stream, "401 Unauthorized", "text/html; charset=utf-8", BOARD_CSP, gone_page(expired).as_bytes());
    }
    let body: &[u8] = if expired.is_some() { br#"{"error":"expired"}"# } else { br#"{"error":"denied"}"# };
    respond(stream, "401 Unauthorized", "application/json", body)
}

fn handle(mut stream: TcpStream, db: &Db, runtimes: &Runtimes, keys: &Mutex<Access>, board: &Mutex<Option<SharedBoard>>, digest: &Mutex<Option<AwayDigest>>) -> std::io::Result<()> {
    let Some(req) = read_request(&mut stream) else { return respond(&mut stream, "400 Bad Request", "text/plain", b"bad request") };
    let auth = authorize(&keys.lock(), param(&req.query, "k").as_deref(), crate::db::now_ms() as u64);
    let (role, expires) = match auth {
        Auth::Ok(role, expires) => (role, expires),
        Auth::Expired(role) => return deny(&mut stream, &req, Some(role)),
        Auth::Denied => return deny(&mut stream, &req, None),
    };
    // the view-only key: the board and its title, nothing else (enforced here, not only hidden)
    if role == Role::Viewer {
        return match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/") => respond_with(&mut stream, "200 OK", "text/html; charset=utf-8", PAGE_CSP, VIEW_PAGE.as_bytes()),
            ("GET", "/api/state") => {
                let b = board.lock().as_ref().map(|b| json!({ "title": b.title, "ts": b.ts }));
                let body = json!({ "role": "view", "board": b, "now": crate::db::now_ms(), "expires": expires }).to_string();
                respond(&mut stream, "200 OK", "application/json", body.as_bytes())
            }
            ("GET", "/board") => serve_board(&mut stream, board),
            ("GET", _) => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
            _ => respond(&mut stream, "403 Forbidden", "application/json", br#"{"error":"view only"}"#),
        };
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/") => respond_with(&mut stream, "200 OK", "text/html; charset=utf-8", PAGE_CSP, PAGE.as_bytes()),
        ("GET", "/api/state") => {
            // everything but the (large) page itself
            let shared = board.lock().as_ref().map(|b| SharedBoard { html: String::new(), title: b.title.clone(), ts: b.ts, operator: b.operator.clone(), answer: b.answer.clone() });
            let away = digest.lock().clone();
            let mut v = state_json(db, runtimes, shared.as_ref(), away.as_ref());
            v["role"] = json!("owner");
            v["expires"] = json!(expires);
            respond(&mut stream, "200 OK", "application/json", v.to_string().as_bytes())
        }
        ("GET", "/board") => serve_board(&mut stream, board),
        ("POST", "/api/send") => {
            let v: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
            let (id, text) = (v["id"].as_str().unwrap_or(""), v["text"].as_str().unwrap_or(""));
            // the operator learns that you read on the phone (short answers, the board read-only)
            let to_operator = board.lock().as_ref().and_then(|b| b.operator.clone()).is_some_and(|op| op == id);
            let text = if to_operator && !text.trim().is_empty() { format!("{PHONE_PREFIX}{}", text.trim()) } else { text.to_string() };
            match queue(runtimes, id, &text) {
                Ok(()) => respond(&mut stream, "200 OK", "application/json", b"{\"ok\":true}"),
                Err(e) => respond(&mut stream, "400 Bad Request", "application/json", json!({ "error": e.to_string() }).to_string().as_bytes()),
            }
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
    }
}

fn serve_board(stream: &mut TcpStream, board: &Mutex<Option<SharedBoard>>) -> std::io::Result<()> {
    let html = board.lock().as_ref().map(|b| b.html.clone()).unwrap_or_else(|| NO_BOARD.to_string());
    respond_with(stream, "200 OK", "text/html; charset=utf-8", BOARD_CSP, html.as_bytes())
}

/// Same rules as the cockpit's input queue (typed once the CLI is ready).
pub fn queue(runtimes: &Runtimes, id: &str, text: &str) -> AppResult<()> {
    let text = text.trim_end();
    if text.trim().is_empty() || text.len() > 20_000 {
        return Err(AppError::invalid("Nothing to send"));
    }
    let mut rts = runtimes.lock();
    let rt = rts.get_mut(id).filter(|r| r.view.running && r.kind == "agent").ok_or_else(|| AppError::invalid("Session is not running"))?;
    rt.pending_input = Some(match rt.pending_input.take() {
        Some(prev) => format!("{prev}\n\n{text}"),
        None => text.to_string(),
    });
    rt.view.pending_input = true;
    Ok(())
}

fn state_json(db: &Db, runtimes: &Runtimes, shared: Option<&SharedBoard>, digest: Option<&AwayDigest>) -> Value {
    let sessions = crate::store::open_sessions(&db.0.lock()).unwrap_or_default();
    let rts = runtimes.lock();
    let operator = shared.and_then(|b| b.operator.as_deref());
    let list: Vec<Value> = sessions
        .into_iter()
        .filter(|s| s.kind == "agent")
        .map(|s| {
            let rt = rts.get(&s.id).map(|r| &r.view);
            let is_operator = operator == Some(s.id.as_str());
            // the operator's answer comes cleaned from the cockpit (no action block)
            let raw = if is_operator { shared.and_then(|b| b.answer.clone()).or_else(|| rt.and_then(|v| v.last_message.clone())) } else { rt.and_then(|v| v.last_message.clone()) };
            let last: Option<String> = raw.map(|m| m.chars().take(if is_operator { 4000 } else { 1500 }).collect());
            json!({
                "operator": is_operator,
                "id": s.id,
                "name": s.name,
                "provider": s.provider,
                "running": rt.is_some_and(|v| v.running),
                "status": rt.map(|v| v.status.clone()).unwrap_or(s.status),
                "notice": rt.and_then(|v| v.notice.clone()),
                "lastMessage": last,
                "pending": rt.is_some_and(|v| v.pending_input),
                "turnEndedAt": rt.and_then(|v| v.turn_ended_at),
            })
        })
        .collect();
    let board = shared.map(|b| json!({ "title": b.title, "ts": b.ts }));
    json!({ "sessions": list, "now": crate::db::now_ms(), "board": board, "digest": digest })
}

const PAGE: &str = r##"<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Robs AI Cockpit</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0d1014;color:#d6dde6;font:15px system-ui,sans-serif}
header{position:sticky;top:0;background:#11151a;border-bottom:1px solid #222932;padding:12px 16px;display:flex;align-items:center;gap:10px}
.logo{width:26px;height:26px;border-radius:50%;background:#000;color:#22d66e;font-weight:700;display:grid;place-items:center}
main{padding:12px;display:grid;gap:12px;max-width:720px;margin:auto}
.card{background:#11151a;border:1px solid #222932;border-radius:10px;padding:12px}
.card.wait{border-color:#56c08780}.row{display:flex;align-items:center;gap:8px}.name{font-weight:600;flex:1}
.st{font-size:12px;padding:2px 8px;border-radius:99px;background:#1c222a;color:#8a95a3}
.st.waiting-for-input{background:#56c08722;color:#56c087}.st.working{background:#6ea8fe22;color:#6ea8fe}.st.rate-limited{background:#e3b34122;color:#e3b341}
.msg{white-space:pre-wrap;color:#b5bfcc;font-size:13.5px;margin:8px 0;max-height:220px;overflow:auto}
textarea{width:100%;box-sizing:border-box;background:#0b0e12;color:#d6dde6;border:1px solid #2d3540;border-radius:8px;padding:8px;font:inherit;min-height:44px}
button{background:#6ea8fe26;color:#6ea8fe;border:1px solid #6ea8fe99;border-radius:8px;padding:8px 12px;font:inherit}
.btns{display:flex;gap:8px;margin-top:6px}.muted{color:#5d6773;font-size:12px}
.tabs{display:flex;gap:4px;margin-left:auto}.tab{padding:5px 12px;border-radius:99px;border-color:transparent;background:none;color:#8a95a3;font-size:13px}.tab.on{background:#6ea8fe22;color:#6ea8fe;border-color:#6ea8fe55}
.card.op{border-color:#38bdf866}.badge{font-size:11px;color:#38bdf8;border:1px solid #38bdf855;border-radius:99px;padding:1px 7px}
#board{display:none;flex-direction:column;height:calc(100dvh - 51px)}#board.bar{height:calc(100dvh - 118px)}#board iframe{display:block;flex:1;min-height:0;width:100%;border:0;background:#0d1117}
.away{border-color:#38bdf855;background:#0f1622}.away ul{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:5px}.away li{display:flex;gap:8px;align-items:baseline;font-size:14px;color:#c9d3df}
.away li.go{cursor:pointer}.arr{margin-left:auto;color:#38bdf8;padding-left:6px}
.bdg{flex:none;max-height:30vh;overflow:auto;padding:8px 12px;border-bottom:1px solid #38bdf833}.bdg ul{margin-top:4px;gap:3px}.bdg li{font-size:13px}.bdg .name{font-size:13px}
.x{background:none;border:0;color:#8a95a3;padding:0 4px;font-size:18px;line-height:1}
.gone{display:grid;place-items:center;min-height:90vh;text-align:center;padding:16px}.gone p{margin:6px auto;max-width:34ch}
.dot{flex:none;width:7px;height:7px;border-radius:50%;background:#38bdf8;transform:translateY(-1px)}.dot.error{background:#f87171}.dot.need,.dot.choice,.dot.red{background:#e3b341}.dot.crew,.dot.done{background:#56c087}.dot.working,.dot.quiet{background:#5d6773}
.opbar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;align-items:flex-end;padding:8px 10px;background:#11151a;border-top:1px solid #222932}.opbar textarea{flex:1;min-height:44px;max-height:120px}
</style></head><body>
<header><div class="logo">R</div><b>Cockpit</b><span class="muted" id="t"></span><nav class="tabs" id="tabs" hidden><button class="tab on" data-tab="list">Agenten</button><button class="tab" data-tab="board">Board</button></nav></header>
<main id="list"><p class="muted">Lade…</p></main>
<section id="board"><div class="bdg away" id="bdg" hidden></div><iframe id="frame" title="Board (nur lesen)" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
<div class="opbar" id="opbar" hidden><textarea id="opmsg" data-id="op" placeholder="Nachricht an den Operator…"></textarea><button id="opsend">Senden</button></div></section>
<script>
const k=new URLSearchParams(location.search).get('k');const drafts={};
const esc=s=>(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label={"waiting-for-input":"wartet auf dich","working":"arbeitet","rate-limited":"Limit","idle":"bereit","stopped":"gestoppt","failed":"Fehler","error":"Fehler","starting":"startet"};
let tab='list',boardTs=0,opId=null,goA=null,dgHide='',dead=false;const $=id=>document.getElementById(id);
const hm=t=>new Date(t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
function gone(exp){dead=true;document.body.innerHTML=`<div class="gone"><div><div class="logo" style="margin:0 auto 14px">R</div><p><b>${exp?'Link abgelaufen – scanne den QR-Code neu':'Dieser Link gilt nicht (mehr) – scanne den QR-Code neu'}</b></p><p class="muted">Im Cockpit: Einstellungen → Phone remote → QR code.</p></div></div>`}
async function denied(r){if(r.status!==401)return false;const e=await r.json().catch(()=>({}));gone(e.error==='expired');return true}
async function send(id,text){if(!text.trim())return;const r=await fetch('/api/send?k='+k,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,text})});
if(await denied(r))return;if(!r.ok){alert((await r.json()).error||'Fehler')}else{drafts[id]='';load()}}
function show(t){tab=t;$('list').style.display=t==='list'?'':'none';$('board').style.display=t==='board'?'flex':'none';
document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));if(t==='board')loadBoard()}
function jump(a){try{const el=$('frame').contentDocument.getElementById(a);if(!el)return false;for(let p=el;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
el.scrollIntoView({block:'start'});el.style.outline='2px solid #38bdf8';el.style.outlineOffset='3px';setTimeout(()=>{el.style.outline=''},2600);return true}catch(e){return false}}
function goTo(a){if(!a||!boardTs)return;goA=a;if(tab!=='board')show('board');else loadBoard()}
function loadBoard(){const f=$('frame');if(f.dataset.ts===String(boardTs)){if(goA){let d=null;try{d=f.contentDocument}catch(e){}if(d&&d.readyState==='complete'&&d.URL!=='about:blank'){jump(goA);goA=null}}return}
let y=0;try{y=f.contentWindow.scrollY||0}catch(e){}
f.onload=()=>{const a=goA;goA=null;if(a&&jump(a))return;try{f.contentWindow.scrollTo(0,y)}catch(e){}};f.dataset.ts=String(boardTs);f.src='/board?k='+k+'&t='+boardTs}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>show(b.dataset.tab));
document.addEventListener('click',e=>{const t=e.target.closest&&e.target.closest('[data-a]');if(t)goTo(t.dataset.a)});
$('opsend').onclick=()=>{const t=$('opmsg');if(opId&&t.value.trim())send(opId,t.value).then(()=>{t.value='';t.blur()})};
const dline=l=>`<li${l.anchor?` class="go" data-a="${esc(l.anchor)}"`:''}><span class="dot ${esc(l.kind)}"></span><span>${esc(l.text)}</span>${l.anchor?'<span class="arr">›</span>':''}</li>`;
function boardDigest(dg){const b=$('bdg'),lines=dg&&dg.lines.length?dg.lines:[],sig=lines.length?dg.since+'|'+lines.map(l=>l.text+(l.anchor||'')).join('|'):'';
b.hidden=!sig||sig===dgHide;if(b.hidden||b.dataset.sig===sig)return;b.dataset.sig=sig;
b.innerHTML=`<div class="row"><span class="name">Seit du weg bist</span><span class="muted">seit ${hm(dg.since)}</span><button class="x" id="bdgx" aria-label="Ausblenden">×</button></div><ul>${lines.map(dline).join('')}</ul>`;
$('bdgx').onclick=()=>{dgHide=sig;b.hidden=true}}
async function load(){try{const r=await fetch('/api/state?k='+k);if(await denied(r))return;if(!r.ok)throw 0;const d=await r.json();
$('t').textContent=hm(Date.now())+(d.expires&&d.expires-d.now<2*3600e3?' · Link bis '+hm(d.expires):'');
boardTs=d.board?d.board.ts:0;$('tabs').hidden=!d.board;if(!d.board&&tab==='board')show('list');
const op=d.sessions.find(s=>s.operator&&s.running);opId=op?op.id:null;$('opbar').hidden=!opId;$('board').classList.toggle('bar',!!opId);
if(op)$('opmsg').placeholder='Nachricht an '+op.name+'…';if(tab==='board')loadBoard();
const list=d.sessions.sort((a,b)=>b.operator-a.operator||(b.status==='waiting-for-input')-(a.status==='waiting-for-input')||b.running-a.running);
const focused=document.activeElement&&document.activeElement.dataset.id;
const dg=d.digest;boardDigest(d.board?dg:null);
const away=dg&&dg.lines.length?`<div class="card away"><div class="row"><span class="name">Seit du weg bist</span><span class="muted">seit ${hm(dg.since)}</span></div><ul>${dg.lines.map(dline).join('')}</ul></div>`:'';
$('list').innerHTML=away+(list.map(s=>`<div class="card ${s.status==='waiting-for-input'&&s.running?'wait':''} ${s.operator?'op':''}">
<div class="row"><span class="name">${esc(s.name)}</span>${s.operator?'<span class="badge">Operator</span>':''}<span class="st ${s.status}">${label[s.status]||s.status}</span></div>
${s.notice?`<div class="msg" style="color:#e3b341">${esc(s.notice)}</div>`:''}
${s.lastMessage?`<div class="msg">${esc(s.lastMessage)}</div>`:''}
${s.running?`<textarea data-id="${s.id}" placeholder="Antwort…">${esc(drafts[s.id]||'')}</textarea>
<div class="btns"><button data-send="${s.id}">Senden</button><button data-go="${s.id}">weiter</button>${s.pending?'<span class="muted">wartet in der Warteschlange…</span>':''}</div>`:'<div class="muted">läuft nicht</div>'}</div>`).join('')||'<p class="muted">Keine Agenten.</p>');
document.querySelectorAll('textarea').forEach(t=>{t.oninput=()=>drafts[t.dataset.id]=t.value;if(t.dataset.id===focused)t.focus()});
document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>send(b.dataset.send,drafts[b.dataset.send]||''));
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>send(b.dataset.go,'weiter'));
}catch(e){$('t').textContent='keine Verbindung'}}
load();setInterval(()=>{if(!dead&&(!document.activeElement||document.activeElement.tagName!=='TEXTAREA'))load()},4000);
</script></body></html>"##;

/// The page for the view-only key: the board (with the operator's answer in it), nothing to send.
const VIEW_PAGE: &str = r##"<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board · nur lesen</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#0d1014;color:#d6dde6;font:15px system-ui,sans-serif}
header{position:sticky;top:0;background:#11151a;border-bottom:1px solid #222932;padding:12px 16px;display:flex;align-items:center;gap:10px}
.logo{width:26px;height:26px;flex:none;border-radius:50%;background:#000;color:#22d66e;font-weight:700;display:grid;place-items:center}
#h{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.muted{color:#5d6773;font-size:12px}#t{margin-left:auto;flex:none}
iframe{display:block;width:100%;height:calc(100dvh - 51px);border:0;background:#0d1117}
.gone{display:grid;place-items:center;min-height:90vh;text-align:center;padding:16px}.gone p{margin:6px auto;max-width:34ch}
</style></head><body>
<header><div class="logo">R</div><b id="h">Board</b><span class="muted">nur lesen</span><span class="muted" id="t"></span></header>
<iframe id="frame" title="Board (nur lesen)" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
<script>
const k=new URLSearchParams(location.search).get('k');const $=id=>document.getElementById(id);let ts=-1,dead=false;
const hm=t=>new Date(t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
function gone(exp){dead=true;document.body.innerHTML=`<div class="gone"><div><div class="logo" style="margin:0 auto 14px">R</div><p><b>${exp?'Link abgelaufen – frag nach einem neuen Link':'Dieser Link gilt nicht (mehr) – frag nach einem neuen Link'}</b></p></div></div>`}
async function load(){try{const r=await fetch('/api/state?k='+k);if(r.status===401){const e=await r.json().catch(()=>({}));return gone(e.error==='expired')}if(!r.ok)throw 0;const d=await r.json();
$('t').textContent=hm(Date.now());$('h').textContent=d.board?d.board.title:'Board';
const n=d.board?d.board.ts:0;if(n===ts)return;ts=n;const f=$('frame');let y=0;try{y=f.contentWindow.scrollY||0}catch(e){}
f.onload=()=>{try{f.contentWindow.scrollTo(0,y)}catch(e){}};f.src='/board?k='+k+'&t='+n}catch(e){$('t').textContent='keine Verbindung'}}
load();setInterval(()=>{if(!dead)load()},5000);
</script></body></html>"##;

#[cfg(test)]
mod tests {
    use super::*;

    fn request(port: u16, raw: &str) -> String {
        // The accept loop polls every 150 ms; under a busy test run give it a moment.
        let mut s = (0..50)
            .find_map(|_| TcpStream::connect(("127.0.0.1", port)).ok().or_else(|| {
                std::thread::sleep(Duration::from_millis(100));
                None
            }))
            .expect("remote server did not start");
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn key_is_required_and_state_is_served() {
        let db = Arc::new(Db::new(crate::db::open_in_memory().unwrap()));
        let rts: Runtimes = Default::default();
        let r = Remote::default();
        assert!(r.start(db.clone(), rts.clone(), 0, "short".into(), 0, None).is_err());
        // Port 0 is not reported back; pick a free port first.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let key = "a".repeat(32);
        let info = r.start(db, rts, port, key.clone(), 0, None).unwrap();
        assert!(info.url.ends_with(&format!(":{port}/?k={key}")));
        std::thread::sleep(Duration::from_millis(200));
        assert!(request(port, "GET /api/state HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 401"));
        assert!(request(port, &format!("GET /api/state?k={} HTTP/1.1\r\n\r\n", "b".repeat(32))).starts_with("HTTP/1.1 401"));
        let ok = request(port, &format!("GET /api/state?k={key} HTTP/1.1\r\n\r\n"));
        assert!(ok.starts_with("HTTP/1.1 200") && ok.contains("\"sessions\":[]"), "{ok}");
        let page = request(port, &format!("GET /?k={key} HTTP/1.1\r\n\r\n"));
        assert!(page.contains("Robs AI Cockpit"));
        let body = r#"{"id":"nope","text":"hi"}"#;
        let sent = request(port, &format!("POST /api/send?k={key} HTTP/1.1\r\nContent-Length: {}\r\n\r\n{body}", body.len()));
        assert!(sent.starts_with("HTTP/1.1 400") && sent.contains("not running"));
        // no board shared yet: a calm placeholder, and the state says so
        let none = request(port, &format!("GET /board?k={key} HTTP/1.1\r\n\r\n"));
        assert!(none.starts_with("HTTP/1.1 200") && none.contains("Noch kein Board"));
        assert!(request(port, &format!("GET /api/state?k={key} HTTP/1.1\r\n\r\n")).contains("\"board\":null"));
        let shared = SharedBoard { html: "<p>Plan</p>".into(), title: "Plan".into(), operator: Some("op1".into()), answer: Some("Fertig.".into()), ..Default::default() };
        assert!(r.share_board(shared).unwrap());
        let page = request(port, &format!("GET /board?k={key} HTTP/1.1\r\n\r\n"));
        assert!(page.contains("<p>Plan</p>") && page.contains("Content-Security-Policy: default-src 'none'"), "{page}");
        assert!(request(port, "GET /board HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 401"));
        let st = request(port, &format!("GET /api/state?k={key} HTTP/1.1\r\n\r\n"));
        assert!(st.contains("\"title\":\"Plan\"") && !st.contains("<p>Plan</p>"), "{st}");
        r.stop();
        // off: nothing is kept, a later share is ignored
        assert!(!r.share_board(SharedBoard { html: "x".into(), ..Default::default() }).unwrap());
        assert!(r.board.lock().is_none());
        assert!(r.share_board(SharedBoard { html: "x".repeat(MAX_SHARED_BOARD + 1), ..Default::default() }).is_err());
    }

    #[test]
    fn away_digest_is_served_while_on() {
        let db = Arc::new(Db::new(crate::db::open_in_memory().unwrap()));
        let r = Remote::default();
        let line = |kind: &str, text: &str| AwayLine { kind: kind.into(), text: text.into(), anchor: None };
        // off: ignored
        assert!(!r.share_digest(1, vec![line("done", "Atlas ist fertig")]));
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let key = "c".repeat(32);
        r.start(db, Default::default(), port, key.clone(), 0, None).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let many: Vec<AwayLine> = (0..20).map(|i| line("crew\"><x", &format!("Zeile {i} {}", "x".repeat(300)))).collect();
        assert!(r.share_digest(42, many));
        {
            let d = r.digest.lock();
            let d = d.as_ref().unwrap();
            assert_eq!(d.lines.len(), MAX_DIGEST_LINES);
            assert_eq!(d.lines[0].kind, "crewx", "only lowercase letters reach the page's class");
            assert_eq!(d.lines[0].text.chars().count(), MAX_DIGEST_CHARS);
        }
        assert!(r.share_digest(42, vec![line("done", "Atlas ist fertig"), line("quiet", "  ")]));
        let st = request(port, &format!("GET /api/state?k={key} HTTP/1.1\r\n\r\n"));
        assert!(st.contains("\"since\":42") && st.contains("Atlas ist fertig") && !st.contains("quiet"), "{st}");
        // back at the PC: no lines, the digest goes
        assert!(r.share_digest(42, vec![]));
        assert!(request(port, &format!("GET /api/state?k={key} HTTP/1.1\r\n\r\n")).contains("\"digest\":null"));
        assert!(request(port, &format!("GET /?k={key} HTTP/1.1\r\n\r\n")).contains("Seit du weg bist"));
        r.stop();
        assert!(r.digest.lock().is_none());
    }

    fn entry(key: &str, expires: u64) -> KeyEntry {
        KeyEntry { key: key.into(), expires }
    }

    #[test]
    fn keys_expire_and_roles_are_told_apart() {
        let (own, view) = ("o".repeat(32), "v".repeat(32));
        let access = Access { owner: entry(&own, 1_000), viewer: Some(entry(&view, 2_000)) };
        assert_eq!(authorize(&access, Some(&own), 999), Auth::Ok(Role::Owner, 1_000));
        assert_eq!(authorize(&access, Some(&view), 999), Auth::Ok(Role::Viewer, 2_000));
        // expiry is exact: at the stamp the key no longer opens anything
        assert_eq!(authorize(&access, Some(&own), 1_000), Auth::Expired(Role::Owner));
        assert_eq!(authorize(&access, Some(&view), 1_500), Auth::Ok(Role::Viewer, 2_000));
        assert_eq!(authorize(&access, Some(&view), 2_000), Auth::Expired(Role::Viewer));
        // wrong, missing, short or empty keys are simply denied (even against an empty table)
        for k in [None, Some(""), Some("short"), Some(&"x".repeat(32) as &str), Some(&own[..31])] {
            assert_eq!(authorize(&access, k, 0), Auth::Denied, "{k:?}");
        }
        assert_eq!(authorize(&Access::default(), Some(""), 0), Auth::Denied);
        assert_eq!(authorize(&Access { owner: entry(&own, 1_000), viewer: None }, Some(&view), 0), Auth::Denied);
    }

    #[test]
    fn expiry_is_clamped_and_keys_are_checked() {
        let now = 1_000_000;
        assert_eq!(clamp_expiry(0, now), now + DEFAULT_TTL_MS);
        assert_eq!(clamp_expiry(u64::MAX, now), now + MAX_TTL_MS, "never longer than 7 days");
        assert_eq!(clamp_expiry(now + 8 * 3_600_000, now), now + 8 * 3_600_000);
        assert_eq!(clamp_expiry(5, now), 5, "a past expiry stays past");
        let k = "k".repeat(32);
        assert!(make_access("short".into(), 0, None, now).is_err());
        assert!(make_access(k.clone(), 0, Some(("bad key with spaces and more".into(), 0)), now).is_err());
        assert!(make_access(k.clone(), 0, Some((k.clone(), 0)), now).is_err(), "the view key must differ");
        let a = make_access(k, 0, Some(("w".repeat(32), u64::MAX)), now).unwrap();
        assert_eq!(a.viewer.unwrap().expires, now + MAX_TTL_MS);
    }

    #[test]
    fn expired_and_replaced_keys_get_401() {
        let db = Arc::new(Db::new(crate::db::open_in_memory().unwrap()));
        let r = Remote::default();
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let old = "e".repeat(32);
        // expired a moment ago (a restart with a stale key still starts, but opens nothing)
        let info = r.start(db, Default::default(), port, old.clone(), 1, None).unwrap();
        assert_eq!(info.expires, 1);
        std::thread::sleep(Duration::from_millis(200));
        let page = request(port, &format!("GET /?k={old} HTTP/1.1\r\n\r\n"));
        assert!(page.starts_with("HTTP/1.1 401") && page.contains("Link abgelaufen – scanne den QR-Code neu"), "{page}");
        assert!(page.contains("default-src 'none'") && !page.contains("<script"), "the 401 page runs nothing");
        assert!(!page.contains(&old), "the key is never echoed");
        let api = request(port, &format!("GET /api/state?k={old} HTTP/1.1\r\n\r\n"));
        assert!(api.starts_with("HTTP/1.1 401") && api.contains(r#"{"error":"expired"}"#) && !api.contains("sessions"), "{api}");
        let board = request(port, &format!("GET /board?k={old} HTTP/1.1\r\n\r\n"));
        assert!(board.starts_with("HTTP/1.1 401") && board.contains("Link abgelaufen"));
        let body = r#"{"id":"x","text":"hi"}"#;
        let sent = request(port, &format!("POST /api/send?k={old} HTTP/1.1\r\nContent-Length: {}\r\n\r\n{body}", body.len()));
        assert!(sent.starts_with("HTTP/1.1 401") && sent.contains("expired"));
        // "New key": swapped live, the old one is no longer known at all
        let new = "n".repeat(32);
        let info = r.set_keys(new.clone(), 0, None).unwrap();
        assert!(info.url.ends_with(&format!(":{port}/?k={new}")) && info.expires > crate::db::now_ms() as u64);
        assert!(request(port, &format!("GET /api/state?k={new} HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 200"));
        let gone = request(port, &format!("GET /?k={old} HTTP/1.1\r\n\r\n"));
        assert!(gone.starts_with("HTTP/1.1 401") && gone.contains("gilt nicht (mehr)"), "{gone}");
        assert!(request(port, &format!("GET /api/state?k={old} HTTP/1.1\r\n\r\n")).contains(r#"{"error":"denied"}"#));
        let ok = request(port, &format!("GET /?k={new} HTTP/1.1\r\n\r\n"));
        assert!(ok.contains("Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'") && ok.contains("connect-src 'self'"), "{ok}");
        r.stop();
        assert!(r.set_keys("m".repeat(32), 0, None).is_err(), "off: no keys to change");
    }

    #[test]
    fn view_only_key_sees_the_board_and_nothing_else() {
        let db = Arc::new(Db::new(crate::db::open_in_memory().unwrap()));
        let r = Remote::default();
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let (own, view) = ("p".repeat(32), "q".repeat(32));
        let info = r.start(db, Default::default(), port, own.clone(), 0, Some((view.clone(), 0))).unwrap();
        assert!(info.view_url.as_deref().is_some_and(|u| u.ends_with(&format!(":{port}/?k={view}"))));
        std::thread::sleep(Duration::from_millis(200));
        let shared = SharedBoard { html: "<p>Plan</p>".into(), title: "Plan".into(), operator: Some("op1".into()), answer: Some("Fertig.".into()), ..Default::default() };
        assert!(r.share_board(shared).unwrap());
        let dl = AwayLine { kind: "done".into(), text: "Atlas ist fertig".into(), anchor: Some("a1b2".into()) };
        assert!(r.share_digest(7, vec![dl]));
        // the view page: the board frame, no message box, no agent list
        let page = request(port, &format!("GET /?k={view} HTTP/1.1\r\n\r\n"));
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("Board · nur lesen"), "{page}");
        assert!(!page.contains("textarea") && !page.contains("/api/send") && !page.contains("Agenten"));
        // its state: the board's title and stamp only — no sessions, no digest, no answer text
        let st = request(port, &format!("GET /api/state?k={view} HTTP/1.1\r\n\r\n"));
        assert!(st.contains(r#""role":"view""#) && st.contains(r#""title":"Plan""#), "{st}");
        assert!(!st.contains("sessions") && !st.contains("digest") && !st.contains("Atlas") && !st.contains("Fertig."), "{st}");
        assert!(request(port, &format!("GET /board?k={view} HTTP/1.1\r\n\r\n")).contains("<p>Plan</p>"));
        // sending is refused by the server, whatever the page shows
        let body = r#"{"id":"op1","text":"rm -rf"}"#;
        let sent = request(port, &format!("POST /api/send?k={view} HTTP/1.1\r\nContent-Length: {}\r\n\r\n{body}", body.len()));
        assert!(sent.starts_with("HTTP/1.1 403") && sent.contains("view only"), "{sent}");
        assert!(request(port, &format!("GET /api/other?k={view} HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 404"));
        // the owner keeps everything, with the digest's anchor
        let own_st = request(port, &format!("GET /api/state?k={own} HTTP/1.1\r\n\r\n"));
        assert!(own_st.contains(r#""role":"owner""#) && own_st.contains(r#""anchor":"a1b2""#) && own_st.contains("\"sessions\""), "{own_st}");
        // revoking the view key: the colleague's link stops at once
        let info = r.set_keys(own.clone(), 0, None).unwrap();
        assert!(info.view_url.is_none());
        assert!(request(port, &format!("GET /?k={view} HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 401"));
        assert!(request(port, &format!("GET /?k={own} HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 200"));
        r.stop();
    }

    #[test]
    fn digest_anchors_stay_plain_tokens() {
        let db = Arc::new(Db::new(crate::db::open_in_memory().unwrap()));
        let r = Remote::default();
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        r.start(db, Default::default(), port, "d".repeat(32), 0, None).unwrap();
        let l = |a: &str| AwayLine { kind: "news".into(), text: "Neu".into(), anchor: Some(a.into()) };
        assert!(r.share_digest(1, vec![l("ok12"), l("x\" onclick=\"y"), l(""), l(&"a".repeat(33))]));
        let anchors: Vec<Option<String>> = r.digest.lock().as_ref().unwrap().lines.iter().map(|x| x.anchor.clone()).collect();
        assert_eq!(anchors, vec![Some("ok12".into()), None, None, None]);
        r.stop();
    }

    #[test]
    fn a_second_start_on_the_same_port_takes_over() {
        // React's StrictMode (dev) and a quick off/on start the remote twice in a row: the old
        // listener must have let go of the port before the new one binds it (Windows has no reuse).
        let db = Arc::new(Db::new(crate::db::open_in_memory().unwrap()));
        let r = Remote::default();
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let (k1, k2) = ("f".repeat(32), "g".repeat(32));
        r.start(db.clone(), Default::default(), port, k1.clone(), 0, None).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        r.start(db, Default::default(), port, k2.clone(), 0, None).expect("the port is free again");
        assert!(request(port, &format!("GET /api/state?k={k2} HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 200"));
        assert!(request(port, &format!("GET /api/state?k={k1} HTTP/1.1\r\n\r\n")).starts_with("HTTP/1.1 401"));
        r.stop();
    }

    #[test]
    fn an_endless_request_line_is_cut_off() {
        let db = Arc::new(Db::new(crate::db::open_in_memory().unwrap()));
        let r = Remote::default();
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        r.start(db, Default::default(), port, "h".repeat(32), 0, None).unwrap();
        let mut s = (0..50)
            .find_map(|_| TcpStream::connect(("127.0.0.1", port)).ok().or_else(|| {
                std::thread::sleep(Duration::from_millis(100));
                None
            }))
            .unwrap();
        s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        // more than any request may be, no line break, and the connection stays open
        let t = std::time::Instant::now();
        s.write_all(&vec![b'A'; MAX_REQUEST as usize + 4096]).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        assert!(out.starts_with("HTTP/1.1 400"), "{out}");
        assert!(t.elapsed() < Duration::from_secs(5), "answered at once, not after the read timeout: {:?}", t.elapsed());
        r.stop();
    }

    #[test]
    fn only_home_network_peers() {
        for ok in ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.178.23", "169.254.1.1", "::1", "fe80::1", "fd12:3456::1", "::ffff:192.168.0.5"] {
            assert!(is_lan_peer(ok.parse().unwrap()), "{ok}");
        }
        for bad in ["8.8.8.8", "172.32.0.1", "100.64.0.1", "2a00:1450::1", "::ffff:8.8.8.8"] {
            assert!(!is_lan_peer(bad.parse().unwrap()), "{bad}");
        }
    }
}
