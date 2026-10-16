//! The cockpit's own MCP server (Model Context Protocol, streamable HTTP, JSON responses only).
//!
//! An agent CLI (Claude Code via `--mcp-config`, Codex via `-c mcp_servers…`) calls tools here
//! while it works; each call goes to the UI as the event `mcp-call`, the UI carries it out (the
//! board logic lives in TypeScript) and answers with `mcp_reply`. Which tools exist is said by the
//! UI (`mcp_register_tools`); without registered tools the server is never started.
//!
//! Only 127.0.0.1, only peers on loopback, and every request needs `Authorization: Bearer <token>`
//! with a token issued for one session (`issue_token`) — the token also tells who is calling.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

/// How long a tool call may take in the UI before the agent gets a timeout.
const CALL_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_BODY: usize = 1_000_000;
const PROTOCOLS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

#[derive(Default)]
pub struct Mcp {
    port: Mutex<Option<u16>>,
    /// hands a call to the UI (an event to the window); boxed so tests never pull in the window code
    to_ui: Mutex<Option<Arc<dyn Fn(&McpCall) -> bool + Send + Sync>>>,
    tools: Mutex<Vec<Value>>,
    /// token → the session (or test label) it was issued for
    tokens: Mutex<HashMap<String, String>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    next: AtomicU64,
}

static MCP: OnceCell<Mcp> = OnceCell::new();

pub fn get() -> &'static Mcp {
    MCP.get_or_init(Mcp::default)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAccess {
    pub url: String,
    pub token: String,
}

/// The tool call as the UI receives it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCall {
    pub call_id: u64,
    pub caller: String,
    pub name: String,
    pub arguments: Value,
}

impl Mcp {
    /// The UI says which tools exist (and gives the handle to reach it). Starts the server once.
    pub fn register(&self, app: AppHandle, tools: Vec<Value>) -> AppResult<()> {
        *self.to_ui.lock() = Some(Arc::new(move |c: &McpCall| app.emit("mcp-call", c).is_ok()));
        *self.tools.lock() = tools;
        self.ensure_started()?;
        Ok(())
    }

    pub fn has_tools(&self) -> bool {
        !self.tools.lock().is_empty()
    }

    fn ensure_started(&self) -> AppResult<u16> {
        let mut port = self.port.lock();
        if let Some(p) = *port {
            return Ok(p);
        }
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| AppError::other(format!("MCP server could not start: {e}")))?;
        let p = listener.local_addr()?.port();
        std::thread::Builder::new()
            .name("cockpit-mcp".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let loopback = stream.peer_addr().map(|a| a.ip().is_loopback()).unwrap_or(false);
                    if !loopback {
                        continue;
                    }
                    std::thread::spawn(move || {
                        let closer = stream.try_clone().ok();
                        let _ = get().handle(stream);
                        if let Some(mut c) = closer {
                            let _ = c.shutdown(std::net::Shutdown::Write);
                            let _ = c.set_read_timeout(Some(Duration::from_millis(300)));
                            let mut buf = [0u8; 512];
                            while matches!(c.read(&mut buf), Ok(n) if n > 0) {}
                        }
                    });
                }
            })
            .map_err(|e| AppError::other(format!("MCP server could not start: {e}")))?;
        *port = Some(p);
        Ok(p)
    }

    /// A token for one session; the same session gets the same token again.
    pub fn issue_token(&self, caller: &str) -> AppResult<McpAccess> {
        let port = self.ensure_started()?;
        let mut tokens = self.tokens.lock();
        let token = tokens
            .iter()
            .find(|(_, c)| c.as_str() == caller)
            .map(|(t, _)| t.clone())
            .unwrap_or_else(|| {
                let t = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
                tokens.insert(t.clone(), caller.to_string());
                t
            });
        Ok(McpAccess { url: format!("http://127.0.0.1:{port}/mcp"), token })
    }

    /// The UI's answer to a tool call (`{"text": …, "isError": bool, "image"?: base64 png}`).
    pub fn reply(&self, call_id: u64, result: Value) {
        if let Some(tx) = self.pending.lock().remove(&call_id) {
            let _ = tx.send(result);
        }
    }

    fn caller_of(&self, auth: Option<&str>) -> Option<String> {
        let token = auth?.strip_prefix("Bearer ")?.trim();
        let tokens = self.tokens.lock();
        // constant-time compare against each known token
        tokens.iter().find(|(t, _)| t.len() == token.len() && t.bytes().zip(token.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0).map(|(_, c)| c.clone())
    }

    fn handle(&self, mut stream: TcpStream) -> std::io::Result<()> {
        let Some(req) = read_request(&mut stream) else {
            return respond(&mut stream, "400 Bad Request", "text/plain", b"bad request");
        };
        let Some(caller) = self.caller_of(req.auth.as_deref()) else {
            return respond(&mut stream, "401 Unauthorized", "text/plain", b"unauthorized");
        };
        if req.path != "/mcp" {
            return respond(&mut stream, "404 Not Found", "text/plain", b"not found");
        }
        if req.method != "POST" {
            // no server-initiated stream: the client works with plain JSON responses
            return respond(&mut stream, "405 Method Not Allowed", "text/plain", b"POST only");
        }
        let Ok(msg) = serde_json::from_slice::<Value>(&req.body) else {
            let err = rpc_error(Value::Null, -32700, "Parse error");
            return respond(&mut stream, "200 OK", "application/json", err.to_string().as_bytes());
        };
        let answers: Vec<Value> = match &msg {
            Value::Array(list) => list.iter().filter_map(|m| self.dispatch(m, &caller)).collect(),
            m => self.dispatch(m, &caller).into_iter().collect(),
        };
        match (answers.len(), msg.is_array()) {
            (0, _) => respond(&mut stream, "202 Accepted", "application/json", b""),
            (_, true) => respond(&mut stream, "200 OK", "application/json", Value::Array(answers).to_string().as_bytes()),
            _ => respond(&mut stream, "200 OK", "application/json", answers[0].to_string().as_bytes()),
        }
    }

    /// One JSON-RPC message → its response (None for notifications and responses).
    fn dispatch(&self, m: &Value, caller: &str) -> Option<Value> {
        let id = m.get("id").cloned()?;
        let method = m.get("method").and_then(|x| x.as_str())?;
        let params = m.get("params").cloned().unwrap_or(Value::Null);
        Some(match method {
            "initialize" => {
                let wanted = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or("");
                let version = PROTOCOLS.iter().find(|p| **p == wanted).copied().unwrap_or(PROTOCOLS[0]);
                rpc_ok(id, json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "cockpit", "title": "Robs AI Cockpit", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Tools of Robs AI Cockpit: the shared board you work on with the user. Changes appear on the user's screen at once."
                }))
            }
            "ping" => rpc_ok(id, json!({})),
            "tools/list" => rpc_ok(id, json!({ "tools": *self.tools.lock() })),
            "tools/call" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if !self.tools.lock().iter().any(|t| t.get("name").and_then(|n| n.as_str()) == Some(name.as_str())) {
                    return Some(rpc_error(id, -32602, &format!("Unknown tool: {name}")));
                }
                let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                rpc_ok(id, self.call(caller, name, arguments))
            }
            _ => rpc_error(id, -32601, "Method not found"),
        })
    }

    /// Hand the call to the UI and wait for its answer.
    fn call(&self, caller: &str, name: String, arguments: Value) -> Value {
        let Some(to_ui) = self.to_ui.lock().clone() else { return tool_text("The cockpit window is not ready.", true) };
        let call_id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::channel();
        self.pending.lock().insert(call_id, tx);
        let call = McpCall { call_id, caller: caller.to_string(), name, arguments };
        if !to_ui(&call) {
            self.pending.lock().remove(&call_id);
            return tool_text("The cockpit window is not ready.", true);
        }
        match rx.recv_timeout(CALL_TIMEOUT) {
            Ok(r) => as_tool_result(&r),
            Err(_) => {
                self.pending.lock().remove(&call_id);
                tool_text("The cockpit did not answer in time.", true)
            }
        }
    }
}

fn tool_text(text: &str, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

/// The UI's answer as an MCP tool result: text, optionally a picture.
fn as_tool_result(r: &Value) -> Value {
    let text = match r.get("text") {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => r.to_string(),
    };
    let mut content = vec![json!({ "type": "text", "text": text })];
    if let Some(img) = r.get("image").and_then(|v| v.as_str()) {
        content.push(json!({ "type": "image", "data": img, "mimeType": "image/png" }));
    }
    json!({ "content": content, "isError": r.get("isError").and_then(|v| v.as_bool()).unwrap_or(false) })
}

fn rpc_ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

struct Request {
    method: String,
    path: String,
    auth: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok()?;
    let mut reader = BufReader::new(stream.try_clone().ok()?.take((MAX_BODY + 64 * 1024) as u64));
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let (mut len, mut auth) = (0usize, None);
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            let k = k.trim();
            if k.eq_ignore_ascii_case("content-length") {
                len = v.trim().parse().unwrap_or(0);
            } else if k.eq_ignore_ascii_case("authorization") {
                auth = Some(v.trim().to_string());
            }
        }
    }
    if len > MAX_BODY {
        return None;
    }
    let mut body = vec![0; len];
    reader.read_exact(&mut body).ok()?;
    let path = target.split('?').next().unwrap_or("").to_string();
    Some(Request { method, path, auth, body })
}

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, body: &[u8]) -> std::io::Result<()> {
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)
}

/// Claude Code: the `--mcp-config` file for one session (HTTP server with its bearer token).
pub fn claude_config(access: &McpAccess) -> Value {
    json!({ "mcpServers": { "cockpit": { "type": "http", "url": access.url, "headers": { "Authorization": format!("Bearer {}", access.token) } } } })
}

/// Claude Code: allow every cockpit tool without a permission prompt (merged into `--settings`).
pub fn claude_permissions() -> Value {
    json!({ "allow": ["mcp__cockpit"] })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(port: u16, token: &str, body: &str) -> (String, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let req = format!("POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let (head, body) = out.split_once("\r\n\r\n").unwrap();
        (head.lines().next().unwrap().to_string(), body.to_string())
    }

    #[test]
    fn speaks_json_rpc_and_guards_with_a_token() {
        let m = get();
        *m.tools.lock() = vec![json!({ "name": "board_read", "description": "d", "inputSchema": { "type": "object" } })];
        let access = m.issue_token("test-session").unwrap();
        assert_eq!(m.issue_token("test-session").unwrap().token, access.token, "same session, same token");
        let port: u16 = access.url.split(':').nth(2).unwrap().trim_end_matches("/mcp").parse().unwrap();

        let (status, _) = post(port, "wrong", r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#);
        assert!(status.contains("401"));

        let (status, body) = post(port, &access.token, r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#);
        assert!(status.contains("200"));
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(v["result"]["serverInfo"]["name"], "cockpit");

        let (status, body) = post(port, &access.token, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        assert!(status.contains("202") && body.is_empty());

        let (_, body) = post(port, &access.token, r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["result"]["tools"][0]["name"], "board_read");

        let (_, body) = post(port, &access.token, r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope"}}"#);
        assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["error"]["code"], -32602);

        // no window in a test: a known tool answers with a clear error instead of hanging
        let (_, body) = post(port, &access.token, r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"board_read","arguments":{}}}"#);
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["result"]["isError"], true);
    }

    #[test]
    fn tool_results_carry_text_and_pictures() {
        let r = as_tool_result(&json!({ "text": "ok", "image": "AAAA" }));
        assert_eq!(r["content"][0]["text"], "ok");
        assert_eq!(r["content"][1]["mimeType"], "image/png");
        assert_eq!(r["isError"], false);
        assert_eq!(as_tool_result(&json!({ "text": { "a": 1 }, "isError": true }))["content"][0]["text"], r#"{"a":1}"#);
        let c = claude_config(&McpAccess { url: "http://127.0.0.1:1/mcp".into(), token: "t".into() });
        assert_eq!(c["mcpServers"]["cockpit"]["headers"]["Authorization"], "Bearer t");
    }
}
