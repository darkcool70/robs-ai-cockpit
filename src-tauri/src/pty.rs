//! PTY process manager (ConPTY on Windows via portable-pty).
//!
//! Each session keeps a bounded replay buffer so panes can be re-attached (layout changes,
//! tab switches, app reload) without losing screen state. Output is pushed to an
//! [`OutputSink`] with a monotonically increasing sequence number per session so the
//! frontend can de-duplicate between the replay snapshot and live events.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::cli::LaunchSpec;
use crate::db::now_ms;
use crate::detect::{self, Detection, Utf8Stream};
use crate::error::{AppError, AppResult};

const REPLAY_CAP: usize = 1024 * 1024;
const REPLAY_TRIM_TO: usize = 768 * 1024;

pub trait OutputSink: Send + Sync + 'static {
    fn output(&self, id: &str, seq: u64, data: &str);
    fn exit(&self, id: &str, code: Option<i64>);
    fn detection(&self, _id: &str, _d: &Detection) {}
    fn login_url(&self, _id: &str, _url: &str) {}
}

pub struct PtyHandle {
    pub id: String,
    pub pid: Option<u32>,
    pub started_ms: i64,
    pub last_output_ms: AtomicI64,
    pub last_input_ms: AtomicI64,
    pub exited: AtomicBool,
    pub exit_code: Mutex<Option<i64>>,
    pub detection: Mutex<Option<(Detection, i64)>>,
    /// Last official login URL printed by the CLI (login terminals).
    pub login_url: Mutex<Option<String>>,
    /// Last size requested by the UI (used when the backend restarts a session).
    pub size: Mutex<(u16, u16)>,
    /// Virtual screen fed with the same output as the UI terminal. TUIs redraw with cursor
    /// movements, so only a real screen tells what the user currently sees (dialogs, links).
    screen: Mutex<vt100::Parser>,
    /// Scan the screen for login links until this time (set when "http" shows up).
    url_scan_until: AtomicI64,
    /// A UI terminal is attached; otherwise the backend answers cursor-position queries.
    pub frontend: AtomicBool,
    seq: AtomicU64,
    replay: Mutex<Vec<u8>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl PtyHandle {
    pub fn write(&self, data: &[u8]) -> AppResult<()> {
        let mut w = self.writer.lock();
        let w = w.as_mut().ok_or_else(|| AppError::invalid("session is not running"))?;
        w.write_all(data)?;
        w.flush()?;
        self.last_input_ms.store(now_ms(), Ordering::Relaxed);
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        *self.size.lock() = (cols, rows);
        self.screen.lock().screen_mut().set_size(rows.max(2), cols.max(10));
        if let Some(m) = self.master.lock().as_ref() {
            m.resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
                .map_err(|e| AppError::other(e.to_string()))?;
        }
        Ok(())
    }

    /// Plain text of what is currently visible in the terminal (wrapped lines joined).
    pub fn screen_text(&self) -> String {
        self.screen.lock().screen().contents()
    }

    /// Replay snapshot: (last sequence number included, text).
    pub fn snapshot(&self) -> (u64, String) {
        let buf = self.replay.lock();
        // Hold the lock while reading seq so no chunk is both in the snapshot and "newer".
        let seq = self.seq.load(Ordering::SeqCst);
        // Skip leading UTF-8 continuation bytes left by trimming.
        let start = buf.iter().position(|b| (b & 0xC0) != 0x80).unwrap_or(buf.len());
        (seq, String::from_utf8_lossy(&buf[start..]).into_owned())
    }

    pub fn kill(&self) {
        let _ = self.killer.lock().kill();
    }

    /// Close the pseudo console. On Windows this also unblocks the reader thread.
    fn close(&self) {
        self.writer.lock().take();
        self.master.lock().take();
    }

    fn push_output(&self, bytes: &[u8]) -> u64 {
        let mut buf = self.replay.lock();
        buf.extend_from_slice(bytes);
        if buf.len() > REPLAY_CAP {
            let cut = buf.len() - REPLAY_TRIM_TO;
            buf.drain(..cut);
        }
        self.last_output_ms.store(now_ms(), Ordering::Relaxed);
        self.seq.fetch_add(1, Ordering::SeqCst) + 1
    }
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<PtyHandle>>>,
    /// Sessions that have a terminal in the UI (it answers the console's cursor queries).
    frontends: Mutex<std::collections::HashSet<String>>,
}

impl PtyManager {
    pub fn get(&self, id: &str) -> Option<Arc<PtyHandle>> {
        self.sessions.lock().get(id).cloned()
    }

    /// The UI created a terminal for this session (called from `pty_attach`).
    pub fn mark_frontend(&self, id: &str) {
        self.frontends.lock().insert(id.to_string());
        if let Some(h) = self.get(id) {
            h.frontend.store(true, Ordering::SeqCst);
        }
    }

    pub fn running_ids(&self) -> Vec<String> {
        self.sessions
            .lock()
            .values()
            .filter(|h| !h.exited.load(Ordering::Relaxed))
            .map(|h| h.id.clone())
            .collect()
    }

    pub fn all(&self) -> Vec<Arc<PtyHandle>> {
        self.sessions.lock().values().cloned().collect()
    }

    pub fn remove(&self, id: &str) {
        if let Some(h) = self.sessions.lock().remove(id) {
            h.kill();
            h.close();
        }
    }

    pub fn spawn(
        &self,
        id: &str,
        spec: &LaunchSpec,
        cols: u16,
        rows: u16,
        sink: Arc<dyn OutputSink>,
    ) -> AppResult<Arc<PtyHandle>> {
        if let Some(existing) = self.get(id) {
            if !existing.exited.load(Ordering::Relaxed) {
                return Err(AppError::invalid("session is already running"));
            }
        }
        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::other(format!("openpty failed: {e}")))?;

        let mut cmd = CommandBuilder::new(&spec.program);
        cmd.args(&spec.args);
        cmd.cwd(&spec.cwd);
        for k in &spec.env_remove {
            cmd.env_remove(k);
        }
        for (k, v) in &spec.env_set {
            cmd.env(k, v);
        }
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::other(format!("failed to start {}: {e}", spec.program)))?;
        drop(pair.slave);
        // Ends with the cockpit, even after a crash.
        if let Some(pid) = child.process_id() {
            crate::procjob::bind_pid(pid);
        }

        let reader = pair.master.try_clone_reader().map_err(|e| AppError::other(e.to_string()))?;
        let writer = pair.master.take_writer().map_err(|e| AppError::other(e.to_string()))?;
        let handle = Arc::new(PtyHandle {
            id: id.to_string(),
            pid: child.process_id(),
            started_ms: now_ms(),
            last_output_ms: AtomicI64::new(0),
            last_input_ms: AtomicI64::new(0),
            exited: AtomicBool::new(false),
            exit_code: Mutex::new(None),
            detection: Mutex::new(None),
            login_url: Mutex::new(None),
            size: Mutex::new((cols, rows)),
            screen: Mutex::new(vt100::Parser::new(rows.max(2), cols.max(10), 0)),
            url_scan_until: AtomicI64::new(0),
            frontend: AtomicBool::new(self.frontends.lock().contains(id)),
            seq: AtomicU64::new(0),
            replay: Mutex::new(Vec::new()),
            writer: Mutex::new(Some(writer)),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(child.clone_killer()),
        });
        self.sessions.lock().insert(id.to_string(), handle.clone());

        // Reader thread.
        {
            let h = handle.clone();
            let sink = sink.clone();
            std::thread::Builder::new()
                .name(format!("pty-read-{id}"))
                .spawn(move || read_loop(h, reader, sink))
                .map_err(AppError::from)?;
        }
        // Waiter thread.
        {
            let h = handle.clone();
            std::thread::Builder::new()
                .name(format!("pty-wait-{id}"))
                .spawn(move || {
                    let code = child.wait().ok().map(|s| s.exit_code() as i64);
                    *h.exit_code.lock() = code;
                    // Give the reader a moment to drain the final output, then close the
                    // console so the reader sees EOF (ConPTY keeps the pipe open otherwise).
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    h.close();
                    sink.exit(&h.id, code);
                    // A restart may replace the runtime only after the old exit event
                    // has finished updating it.
                    h.exited.store(true, Ordering::SeqCst);
                })
                .map_err(AppError::from)?;
        }
        Ok(handle)
    }
}

fn read_loop(h: Arc<PtyHandle>, mut reader: Box<dyn Read + Send>, sink: Arc<dyn OutputSink>) {
    let mut buf = vec![0u8; 32 * 1024];
    let mut utf8 = Utf8Stream::default();
    let mut tail = String::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let text = utf8.push(&buf[..n]);
                if text.is_empty() {
                    continue;
                }
                let seq = h.push_output(text.as_bytes());
                h.screen.lock().process(text.as_bytes());
                // ConPTY asks for the cursor position at startup and waits for the answer.
                // Normally the UI terminal replies; a session started without one (in the
                // background, off-screen) would hang forever, so answer on its behalf.
                if text.contains("\x1b[6n") && !h.frontend.load(Ordering::SeqCst) {
                    let (row, col) = h.screen.lock().screen().cursor_position();
                    let _ = h.write(format!("\x1b[{};{}R", row + 1, col + 1).as_bytes());
                }
                sink.output(&h.id, seq, &text);

                // Scan for limit/auth messages. Keep the last partial line for context.
                let plain = detect::strip_ansi(&text);
                let window = format!("{tail}{plain}");
                if let Some(d) = detect::scan(&window) {
                    let mut cur = h.detection.lock();
                    // The same message printed again after the user (or auto-continue)
                    // typed something is a new event: the limit is still in effect.
                    let answered = |t: i64| h.last_input_ms.load(Ordering::Relaxed) > t;
                    let changed = cur.as_ref().map(|(c, t)| c != &d || answered(*t)).unwrap_or(true);
                    if changed {
                        *cur = Some((d.clone(), now_ms()));
                        drop(cur);
                        sink.detection(&h.id, &d);
                    }
                }
                if plain.contains("http") {
                    h.url_scan_until.store(now_ms() + 4000, Ordering::Relaxed);
                }
                if now_ms() < h.url_scan_until.load(Ordering::Relaxed) {
                    // Links can arrive in pieces; re-read the screen until output settles.
                    if let Some(url) = detect::login_url(&format!("{}\n", h.screen_text())) {
                        let mut cur = h.login_url.lock();
                        if cur.as_deref() != Some(url.as_str()) {
                            *cur = Some(url.clone());
                            drop(cur);
                            sink.login_url(&h.id, &url);
                        }
                    }
                }
                // Keep the unfinished last line (long enough for an OAuth URL split across reads).
                tail = window.rsplit('\n').next().unwrap_or("").chars().rev().take(4096).collect::<Vec<_>>().into_iter().rev().collect();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct Collect {
        out: Mutex<String>,
        exit: Mutex<Option<Option<i64>>>,
        seqs: Mutex<Vec<u64>>,
    }
    impl OutputSink for Collect {
        fn output(&self, _id: &str, seq: u64, data: &str) {
            self.out.lock().push_str(data);
            self.seqs.lock().push(seq);
        }
        fn exit(&self, _id: &str, code: Option<i64>) {
            *self.exit.lock() = Some(code);
        }
    }

    fn shell_spec(script: &str) -> LaunchSpec {
        #[cfg(windows)]
        let (program, args) = ("cmd.exe".to_string(), vec!["/d".into(), "/c".into(), script.to_string()]);
        #[cfg(not(windows))]
        let (program, args) = ("sh".to_string(), vec!["-c".into(), script.to_string()]);
        LaunchSpec {
            program,
            args,
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            env_set: vec![("COCKPIT_TEST_VAR".into(), "isolated-42".into())],
            env_remove: vec![],
        }
    }

    /// ConPTY asks for the cursor position (DSR) on startup and waits for the answer.
    /// In the app xterm.js replies; here we play the terminal.
    fn wait_exit_answering(c: &Collect, h: Option<&PtyHandle>) -> Option<i64> {
        let t = Instant::now();
        let mut answered = false;
        while t.elapsed() < Duration::from_secs(20) {
            if let Some(code) = *c.exit.lock() {
                return code;
            }
            if let Some(h) = h {
                if !answered && c.out.lock().contains("[6n") {
                    let _ = h.write(b"[1;1R");
                    answered = true;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("process did not exit; output so far: {:?}", c.out.lock());
    }

    fn wait_exit(c: &Collect) -> Option<i64> {
        wait_exit_answering(c, None)
    }

    #[test]
    fn lifecycle_output_env_and_exit_code() {
        let m = PtyManager::default();
        let sink = Arc::new(Collect::default());
        #[cfg(windows)]
        let script = "echo hello-%COCKPIT_TEST_VAR% & exit 3";
        #[cfg(not(windows))]
        let script = "echo hello-$COCKPIT_TEST_VAR; exit 3";
        let h = m.spawn("t1", &shell_spec(script), 80, 24, sink.clone()).unwrap();
        assert!(h.pid.is_some());
        let code = wait_exit_answering(&sink, Some(&h));
        assert_eq!(code, Some(3));
        std::thread::sleep(Duration::from_millis(100));
        assert!(sink.out.lock().contains("hello-isolated-42"), "got: {:?}", sink.out.lock());
        let (seq, snap) = h.snapshot();
        assert!(snap.contains("hello-isolated-42"));
        assert!(h.screen_text().contains("hello-isolated-42"), "virtual screen follows output: {:?}", h.screen_text());
        assert_eq!(seq, *sink.seqs.lock().last().unwrap());
        assert!(h.exited.load(Ordering::SeqCst));
        assert!(h.write(b"x").is_err(), "writes after exit are rejected");
    }

    #[test]
    fn wrapped_login_link_is_rebuilt_from_the_screen() {
        // A long URL printed on one line wraps over several terminal rows; ConPTY may also
        // position the cursor instead of printing newlines.
        let url = format!("https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_{}&state={}", "x".repeat(60), "y".repeat(40));
        let mut p = vt100::Parser::new(24, 50, 0);
        p.process(format!("\x1b[2;1HIf your browser did not open, navigate to:\r\n\r\n{url}\x1b[9;1HPress Esc to cancel").as_bytes());
        let found = crate::detect::login_url(&format!("{}\n", p.screen().contents()));
        assert_eq!(found.as_deref(), Some(url.as_str()));
    }

    #[test]
    fn starts_without_a_ui_terminal() {
        // No frontend attached: the manager answers ConPTY's cursor query itself, so the
        // process runs to completion instead of hanging.
        let m = PtyManager::default();
        let sink = Arc::new(Collect::default());
        #[cfg(windows)]
        let script = "echo headless-ok & exit 0";
        #[cfg(not(windows))]
        let script = "echo headless-ok; exit 0";
        m.spawn("t4", &shell_spec(script), 80, 24, sink.clone()).unwrap();
        assert_eq!(wait_exit(&sink), Some(0));
        std::thread::sleep(Duration::from_millis(100));
        assert!(sink.out.lock().contains("headless-ok"));
    }

    #[test]
    fn kill_stops_long_running_process() {
        let m = PtyManager::default();
        let sink = Arc::new(Collect::default());
        #[cfg(windows)]
        let script = "ping -n 30 127.0.0.1 >NUL";
        #[cfg(not(windows))]
        let script = "sleep 30";
        let h = m.spawn("t2", &shell_spec(script), 80, 24, sink.clone()).unwrap();
        assert!(m.spawn("t2", &shell_spec(script), 80, 24, sink.clone()).is_err(), "double start rejected");
        std::thread::sleep(Duration::from_millis(300));
        let t = Instant::now();
        h.kill();
        wait_exit(&sink);
        assert!(t.elapsed() < Duration::from_secs(10));
        assert!(m.running_ids().is_empty());
    }

    #[test]
    fn missing_binary_is_an_error() {
        let m = PtyManager::default();
        let sink = Arc::new(Collect::default());
        let spec = LaunchSpec {
            program: "definitely-not-a-real-binary-xyz".into(),
            args: vec![],
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            env_set: vec![],
            env_remove: vec![],
        };
        assert!(m.spawn("t3", &spec, 80, 24, sink).is_err());
    }
}
