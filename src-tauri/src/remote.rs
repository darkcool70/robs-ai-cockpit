//! Phone remote: a tiny web page in the home network to see the agents and answer them.
//!
//! Off by default. Every request needs the access key (128-bit random, part of the URL the
//! cockpit shows); plain HTTP, so it is meant for a trusted home network only. It can only
//! read agent status / last answers and queue text into running agent sessions — the same
//! input queue the cockpit uses, so text is typed only when the CLI is ready.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::monitor::Runtimes;

pub struct Remote {
    stop: Mutex<Option<Arc<AtomicBool>>>,
    pub info: Mutex<Option<RemoteInfo>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub url: String,
    pub port: u16,
}

impl Default for Remote {
    fn default() -> Self {
        Remote { stop: Mutex::new(None), info: Mutex::new(None) }
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
    pub fn start(&self, db: Arc<Db>, runtimes: Runtimes, port: u16, key: String) -> AppResult<RemoteInfo> {
        self.stop();
        if !valid_key(&key) {
            return Err(AppError::invalid("Remote access key is missing"));
        }
        let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|e| AppError::other(format!("Port {port} is not available: {e}")))?;
        listener.set_nonblocking(true)?;
        let flag = Arc::new(AtomicBool::new(false));
        *self.stop.lock() = Some(flag.clone());
        let info = RemoteInfo { url: format!("http://{}:{port}/?k={key}", lan_ip()), port };
        *self.info.lock() = Some(info.clone());
        std::thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        // On Windows an accepted socket inherits the listener's non-blocking
                        // mode: a request that arrives a moment later would read as "no data".
                        let _ = stream.set_nonblocking(false);
                        let (db, rts, key) = (db.clone(), runtimes.clone(), key.clone());
                        std::thread::spawn(move || {
                            let _ = handle(stream, &db, &rts, &key);
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
                    Err(_) => std::thread::sleep(Duration::from_millis(500)),
                }
            }
        });
        Ok(info)
    }

    pub fn stop(&self) {
        if let Some(f) = self.stop.lock().take() {
            f.store(true, Ordering::SeqCst);
        }
        *self.info.lock() = None;
    }
}

struct Request {
    method: String,
    path: String,
    query: String,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let mut reader = BufReader::new(stream.try_clone().ok()?);
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
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)
}

fn handle(mut stream: TcpStream, db: &Db, runtimes: &Runtimes, key: &str) -> std::io::Result<()> {
    let Some(req) = read_request(&mut stream) else { return respond(&mut stream, "400 Bad Request", "text/plain", b"bad request") };
    let authorized = param(&req.query, "k").is_some_and(|k| eq_ct(&k, key));
    if !authorized {
        return respond(&mut stream, "401 Unauthorized", "text/plain", b"Access key missing or wrong.");
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/") => respond(&mut stream, "200 OK", "text/html; charset=utf-8", PAGE.as_bytes()),
        ("GET", "/api/state") => {
            let body = state_json(db, runtimes).to_string();
            respond(&mut stream, "200 OK", "application/json", body.as_bytes())
        }
        ("POST", "/api/send") => {
            let v: Value = serde_json::from_slice(&req.body).unwrap_or(Value::Null);
            let (id, text) = (v["id"].as_str().unwrap_or(""), v["text"].as_str().unwrap_or(""));
            match queue(runtimes, id, text) {
                Ok(()) => respond(&mut stream, "200 OK", "application/json", b"{\"ok\":true}"),
                Err(e) => respond(&mut stream, "400 Bad Request", "application/json", json!({ "error": e.to_string() }).to_string().as_bytes()),
            }
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
    }
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

fn state_json(db: &Db, runtimes: &Runtimes) -> Value {
    let sessions = crate::store::open_sessions(&db.0.lock()).unwrap_or_default();
    let rts = runtimes.lock();
    let list: Vec<Value> = sessions
        .into_iter()
        .filter(|s| s.kind == "agent")
        .map(|s| {
            let rt = rts.get(&s.id).map(|r| &r.view);
            let last: Option<String> = rt.and_then(|v| v.last_message.clone()).map(|m| m.chars().take(1500).collect());
            json!({
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
    json!({ "sessions": list, "now": crate::db::now_ms() })
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
</style></head><body>
<header><div class="logo">R</div><b>Robs AI Cockpit</b><span class="muted" id="t"></span></header>
<main id="list"><p class="muted">Lade…</p></main>
<script>
const k=new URLSearchParams(location.search).get('k');const drafts={};
const esc=s=>(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label={"waiting-for-input":"wartet auf dich","working":"arbeitet","rate-limited":"Limit","idle":"bereit","stopped":"gestoppt","failed":"Fehler","starting":"startet"};
async function send(id,text){if(!text.trim())return;const r=await fetch('/api/send?k='+k,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,text})});
if(!r.ok){alert((await r.json()).error||'Fehler')}else{drafts[id]='';load()}}
async function load(){try{const r=await fetch('/api/state?k='+k);if(!r.ok)throw 0;const d=await r.json();
document.getElementById('t').textContent=new Date().toLocaleTimeString();
const list=d.sessions.sort((a,b)=>(b.status==='waiting-for-input')-(a.status==='waiting-for-input')||b.running-a.running);
const focused=document.activeElement&&document.activeElement.dataset.id;
document.getElementById('list').innerHTML=list.map(s=>`<div class="card ${s.status==='waiting-for-input'&&s.running?'wait':''}">
<div class="row"><span class="name">${esc(s.name)}</span><span class="st ${s.status}">${label[s.status]||s.status}</span></div>
${s.notice?`<div class="msg" style="color:#e3b341">${esc(s.notice)}</div>`:''}
${s.lastMessage?`<div class="msg">${esc(s.lastMessage)}</div>`:''}
${s.running?`<textarea data-id="${s.id}" placeholder="Antwort…">${esc(drafts[s.id]||'')}</textarea>
<div class="btns"><button data-send="${s.id}">Senden</button><button data-go="${s.id}">weiter</button>${s.pending?'<span class="muted">wartet in der Warteschlange…</span>':''}</div>`:'<div class="muted">läuft nicht</div>'}</div>`).join('')||'<p class="muted">Keine Agenten.</p>';
document.querySelectorAll('textarea').forEach(t=>{t.oninput=()=>drafts[t.dataset.id]=t.value;if(t.dataset.id===focused)t.focus()});
document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>send(b.dataset.send,drafts[b.dataset.send]||''));
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>send(b.dataset.go,'weiter'));
}catch(e){document.getElementById('t').textContent='keine Verbindung'}}
load();setInterval(()=>{if(!document.activeElement||document.activeElement.tagName!=='TEXTAREA')load()},4000);
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
        assert!(r.start(db.clone(), rts.clone(), 0, "short".into()).is_err());
        // Port 0 is not reported back; pick a free port first.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let key = "a".repeat(32);
        let info = r.start(db, rts, port, key.clone()).unwrap();
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
        r.stop();
    }
}
