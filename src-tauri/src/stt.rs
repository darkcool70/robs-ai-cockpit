//! Local speech-to-text for dictating into sessions.
//!
//! * Audio: microphone via cpal (WASAPI on Windows), mixed to mono and resampled to 16 kHz.
//! * Recognition: whisper.cpp's `whisper-server`, started on 127.0.0.1 with the model kept in
//!   memory, so a short command is transcribed in about a second on a laptop CPU.
//! * Setup: the server binary and a model are downloaded once on request, from pinned URLs,
//!   and verified against pinned SHA-256 hashes. Audio never leaves the machine.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::paths;

pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub file: &'static str,
    pub sha256: &'static str,
    pub size_mb: u32,
}

/// Measured on a Core Ultra 5 125H (CPU only), 9 s of German speech, model loaded, 30 s window:
/// base ≈ 1 s, small ≈ 2.7 s, large-v3-turbo ≈ 14 s. With the 10 s window used here: small ≈ 0.9 s.
pub const MODELS: &[ModelSpec] = &[
    ModelSpec { id: "base", label: "Base (fastest)", hint: "~60 MB · well under 1 s per command · occasional mistakes", file: "ggml-base-q5_1.bin", sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898", size_mb: 57 },
    ModelSpec { id: "small", label: "Small (recommended)", hint: "~190 MB · about 1 s per command · good with technical terms", file: "ggml-small-q5_1.bin", sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb", size_mb: 181 },
    ModelSpec { id: "turbo", label: "Large v3 turbo (best, slow on CPU)", hint: "~550 MB · several seconds per command without a GPU", file: "ggml-large-v3-turbo-q5_0.bin", sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2", size_mb: 547 },
];
const MODEL_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
/// whisper.cpp CPU build for Windows x64 (contains whisper-server.exe and its DLLs).
const BIN_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip";
const BIN_SHA256: &str = "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c";
const MAX_RECORDING: Duration = Duration::from_secs(120);
const SAMPLE_RATE: u32 = 16_000;
/// Whisper encodes a fixed window (30 s by default) no matter how short the clip is. The server
/// runs with a ~10 s window (`-ac 512`), which makes a spoken command about 3× faster on CPU;
/// longer dictation is cut at speech pauses into pieces that fit.
const AUDIO_CTX: &str = "512";
const MAX_CHUNK_S: f32 = 9.5;
const MIN_CHUNK_S: f32 = 5.0;

pub fn model(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|m| m.id == id)
}

pub fn root() -> PathBuf {
    paths::root().join("stt")
}
fn bin_dir() -> PathBuf {
    root().join("bin")
}
fn server_exe() -> PathBuf {
    bin_dir().join(if cfg!(windows) { "whisper-server.exe" } else { "whisper-server" })
}
fn model_path(m: &ModelSpec) -> PathBuf {
    root().join("models").join(m.file)
}

// ---------------------------------------------------------------------------
// Transcript post-processing (pure, unit tested)
// ---------------------------------------------------------------------------

/// Phrases Whisper tends to invent on silence or noise (mostly from subtitle training data).
static HALLUCINATION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(untertitel.*|.*amara\.org.*|vielen dank( fürs zuschauen)?\.?|danke( fürs zuschauen)?\.?|tschüss\.?|thank you\.?|thanks for watching\.?|you\.?|\.+|…)$").unwrap()
});
static BRACKETED: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\[[^\]]*\]|\([^)]*(musik|music|applaus|lachen|stille|silence)[^)]*\)|\*[^*]*\*").unwrap());
/// A spoken "…, absenden" at the end means: press Enter after inserting.
static SEND_WORD: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)[\s,.;:!-]*\b(und\s+)?(absenden|abschicken|senden|enter|send it|submit)[\s.!]*$").unwrap()
});

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
    pub send: bool,
}

pub fn clean_transcript(raw: &str) -> Transcript {
    let text = BRACKETED.replace_all(raw, " ");
    let mut text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if HALLUCINATION.is_match(text.trim()) {
        return Transcript { text: String::new(), send: false };
    }
    let mut send = false;
    if let Some(m) = SEND_WORD.find(&text) {
        send = true;
        text.truncate(m.start());
    }
    let text = text.trim().trim_end_matches([',', ';']).trim().to_string();
    Transcript { text, send }
}

/// Mono f32 at `rate` → 16 kHz (linear interpolation; plenty for speech recognition).
pub fn resample(input: &[f32], rate: u32) -> Vec<f32> {
    if rate == SAMPLE_RATE || input.is_empty() {
        return input.to_vec();
    }
    let ratio = rate as f64 / SAMPLE_RATE as f64;
    let n = (input.len() as f64 / ratio) as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * ratio;
            let j = pos as usize;
            let frac = (pos - j as f64) as f32;
            let a = input[j];
            let b = *input.get(j + 1).unwrap_or(&a);
            a + (b - a) * frac
        })
        .collect()
}

/// 16-bit PCM WAV at 16 kHz mono.
pub fn wav_bytes(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut v = Vec::with_capacity(44 + data_len as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data_len).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes()); // PCM
    v.extend_from_slice(&1u16.to_le_bytes()); // mono
    v.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    v.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    v.extend_from_slice(&2u16.to_le_bytes());
    v.extend_from_slice(&16u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        v.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    v
}

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Simple energy VAD: milliseconds of 20 ms frames clearly louder than the recording's own
/// noise floor (its quietest fifth). Room noise alone stays near the floor; speech does not.
pub fn voiced_ms(samples: &[f32], rate: u32) -> u32 {
    let frame = (rate as usize / 50).max(1);
    let mut energies: Vec<f32> = samples.chunks(frame).map(rms).collect();
    if energies.is_empty() {
        return 0;
    }
    let mut sorted = energies.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let floor = sorted[sorted.len() / 5];
    let threshold = (floor * 4.0).max(0.008);
    energies.retain(|e| *e > threshold);
    energies.len() as u32 * 20
}

/// Split long audio into pieces of at most MAX_CHUNK_S, cutting at the quietest 30 ms frame
/// between MIN_CHUNK_S and MAX_CHUNK_S so words are not cut in half.
pub fn chunk_bounds(samples: &[f32], rate: u32) -> Vec<(usize, usize)> {
    let max = (MAX_CHUNK_S * rate as f32) as usize;
    let min = (MIN_CHUNK_S * rate as f32) as usize;
    let frame = (rate as usize * 3 / 100).max(1);
    let mut out = Vec::new();
    let mut start = 0;
    while samples.len() - start > max {
        let lo = start + min;
        let hi = start + max;
        let mut best = (f32::MAX, hi);
        let mut i = lo;
        while i + frame <= hi {
            let e = rms(&samples[i..i + frame]);
            if e < best.0 {
                best = (e, i + frame / 2);
            }
            i += frame;
        }
        out.push((start, best.1));
        start = best.1;
    }
    if start < samples.len() {
        out.push((start, samples.len()));
    }
    out
}

/// Quiet recordings make Whisper hallucinate; normalise speech to a healthy level first.
fn normalize(samples: &mut [f32]) {
    let peak = samples.iter().fold(0f32, |m, x| m.max(x.abs()));
    if peak > 0.001 && peak < 0.5 {
        let gain = (0.7 / peak).min(20.0);
        samples.iter_mut().for_each(|x| *x *= gain);
    }
}

// ---------------------------------------------------------------------------
// Microphone capture
// ---------------------------------------------------------------------------

struct Captured {
    samples: Vec<f32>,
    rate: u32,
    loudest: f32,
}

struct Recording {
    target: String,
    stop: Sender<()>,
    handle: std::thread::JoinHandle<Result<Captured, String>>,
}

fn find_device(name: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
        if let Ok(mut devs) = host.input_devices() {
            if let Some(d) = devs.find(|d| d.description().map(|x| x.name() == name).unwrap_or(false)) {
                return Ok(d);
            }
        }
    }
    host.default_input_device().ok_or_else(|| "No microphone found. Check Windows sound settings.".to_string())
}

pub fn input_devices() -> Vec<String> {
    cpal::default_host()
        .input_devices()
        .map(|ds| ds.filter_map(|d| d.description().ok().map(|x| x.name().to_string())).collect())
        .unwrap_or_default()
}

fn build_stream<T>(device: &cpal::Device, config: &cpal::StreamConfig, buf: Arc<Mutex<Vec<f32>>>) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    device
        .build_input_stream(
            config.clone(),
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let mut b = buf.lock();
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|s| <f32 as cpal::FromSample<T>>::from_sample_(*s)).sum();
                    b.push(sum / channels as f32);
                }
            },
            |e| eprintln!("microphone stream error: {e}"),
            None,
        )
        .map_err(|e| format!("Could not open the microphone: {e}"))
}

fn record(device: Option<String>, stop: Receiver<()>, started: Sender<Result<(), String>>, level: impl Fn(f32)) -> Result<Captured, String> {
    let open = || -> Result<(cpal::Stream, Arc<Mutex<Vec<f32>>>, u32), String> {
        let device = find_device(device.as_deref())?;
        let supported = device.default_input_config().map_err(|e| format!("Microphone not usable: {e}"))?;
        let rate = supported.sample_rate();
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let buf = Arc::new(Mutex::new(Vec::with_capacity(rate as usize * 10)));
        let stream = match format {
            cpal::SampleFormat::F32 => build_stream::<f32>(&device, &config, buf.clone())?,
            cpal::SampleFormat::I16 => build_stream::<i16>(&device, &config, buf.clone())?,
            cpal::SampleFormat::U16 => build_stream::<u16>(&device, &config, buf.clone())?,
            cpal::SampleFormat::I32 => build_stream::<i32>(&device, &config, buf.clone())?,
            other => return Err(format!("Unsupported microphone sample format {other:?}")),
        };
        stream.play().map_err(|e| format!("Could not start the microphone: {e}"))?;
        Ok((stream, buf, rate))
    };
    let (stream, buf, rate) = match open() {
        Ok(x) => {
            let _ = started.send(Ok(()));
            x
        }
        Err(e) => {
            let _ = started.send(Err(e.clone()));
            return Err(e);
        }
    };
    let t0 = Instant::now();
    let mut seen = 0usize;
    let mut loudest = 0f32;
    loop {
        match stop.recv_timeout(Duration::from_millis(80)) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let (r, len) = {
            let b = buf.lock();
            (rms(&b[seen.min(b.len())..]), b.len())
        };
        seen = len;
        loudest = loudest.max(r);
        level(r);
        if t0.elapsed() > MAX_RECORDING {
            break;
        }
    }
    drop(stream);
    let samples = std::mem::take(&mut *buf.lock());
    Ok(Captured { samples, rate, loudest })
}

// ---------------------------------------------------------------------------
// whisper-server process
// ---------------------------------------------------------------------------

struct Server {
    child: Child,
    port: u16,
    model: String,
    language: String,
}

fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(timeout)).http_status_as_error(false).build().new_agent()
}

fn wait_ready(port: u16, child: &mut Child, deadline: Duration) -> Result<(), String> {
    let t0 = Instant::now();
    let a = agent(Duration::from_secs(2));
    while t0.elapsed() < deadline {
        if let Ok(Some(st)) = child.try_wait() {
            let log = std::fs::read_to_string(root().join("server.log")).unwrap_or_default();
            let tail: String = log.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" | ");
            return Err(format!("Speech server exited ({st}). {tail}"));
        }
        if a.get(format!("http://127.0.0.1:{port}/")).call().is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("Speech server did not start in time".into())
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn download(url: &str, dest: &Path, sha256: &str, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
    let resp = agent(Duration::from_secs(1800)).get(url).call().map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }
    let total = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
    let part = dest.with_extension("part");
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut reader = resp.into_body().into_with_config().limit(2 * 1024 * 1024 * 1024).reader();
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    let mut last = Instant::now();
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if last.elapsed() > Duration::from_millis(250) {
            progress(done, total);
            last = Instant::now();
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    progress(done, total);
    let got = hex(&hasher.finalize());
    if got != sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(format!("Checksum mismatch for {url} — the file was not installed."));
    }
    std::fs::rename(&part, dest).map_err(|e| e.to_string())
}

/// Only the server and the libraries it loads; the archive also carries unrelated tools.
fn wanted_from_zip(name: &str) -> Option<String> {
    let file = name.rsplit('/').next()?.to_string();
    let lower = file.to_ascii_lowercase();
    (lower == "whisper-server.exe" || lower == "whisper.dll" || (lower.starts_with("ggml") && lower.ends_with(".dll"))).then_some(file)
}

fn extract_server(zip_path: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let dir = bin_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut found = false;
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
        let Some(file) = wanted_from_zip(entry.name()) else { continue };
        let mut out = std::fs::File::create(dir.join(&file)).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        found |= file.eq_ignore_ascii_case("whisper-server.exe");
    }
    if !found {
        return Err("whisper-server.exe missing in the download".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct Stt {
    server: Mutex<Option<Server>>,
    recording: Mutex<Option<Recording>>,
    installing: AtomicBool,
    /// Serialises server (re)starts between warm-up and transcription.
    starting: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    id: &'static str,
    label: &'static str,
    hint: &'static str,
    size_mb: u32,
    installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    server_installed: bool,
    models: Vec<ModelStatus>,
    devices: Vec<String>,
    recording_target: Option<String>,
    server_running: bool,
    installing: bool,
}

pub struct Config {
    pub model: String,
    pub language: String,
    pub vocabulary: String,
    pub device: Option<String>,
}

impl Stt {
    pub fn status(&self) -> Status {
        Status {
            server_installed: server_exe().is_file(),
            models: MODELS
                .iter()
                .map(|m| ModelStatus { id: m.id, label: m.label, hint: m.hint, size_mb: m.size_mb, installed: model_path(m).is_file() })
                .collect(),
            devices: input_devices(),
            recording_target: self.recording.lock().as_ref().map(|r| r.target.clone()),
            server_running: self.server.lock().is_some(),
            installing: self.installing.load(Ordering::SeqCst),
        }
    }

    pub fn install(&self, app: &AppHandle, model_id: &str) -> AppResult<()> {
        let m = model(model_id).ok_or_else(|| AppError::invalid("Unknown speech model"))?;
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err(AppError::invalid("A download is already running"));
        }
        let res = (|| -> Result<(), String> {
            let emit = |item: &str, done: u64, total: u64| {
                let _ = app.emit("stt-progress", json!({ "item": item, "done": done, "total": total }));
            };
            if !server_exe().is_file() {
                let zip = root().join("whisper-bin-x64.zip");
                download(BIN_URL, &zip, BIN_SHA256, &|d, t| emit("Speech server", d, t))?;
                extract_server(&zip)?;
                let _ = std::fs::remove_file(&zip);
            }
            if !model_path(m).is_file() {
                download(&format!("{MODEL_BASE_URL}{}", m.file), &model_path(m), m.sha256, &|d, t| emit(m.label, d, t))?;
            }
            Ok(())
        })();
        self.installing.store(false, Ordering::SeqCst);
        let _ = app.emit("stt-progress", json!({ "item": null, "done": 0, "total": 0 }));
        res.map_err(AppError::other)
    }

    /// Start (or reuse) the server for this model/language. Blocks until it answers.
    pub fn ensure_server(&self, model_id: &str, language: &str) -> Result<u16, String> {
        let _one = self.starting.lock();
        let m = model(model_id).ok_or("Unknown speech model")?;
        {
            let mut cur = self.server.lock();
            if let Some(s) = cur.as_mut() {
                let alive = matches!(s.child.try_wait(), Ok(None));
                if alive && s.model == m.id && s.language == language {
                    return Ok(s.port);
                }
                let _ = s.child.kill();
                let _ = s.child.wait();
                *cur = None;
            }
        }
        if !server_exe().is_file() || !model_path(m).is_file() {
            return Err("Speech recognition is not installed yet. Open Settings → Voice and download a model.".into());
        }
        let port = free_port()?;
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_sub(2).clamp(2, 12);
        let log = std::fs::File::create(root().join("server.log")).map_err(|e| e.to_string())?;
        let mut cmd = Command::new(server_exe());
        cmd.current_dir(bin_dir())
            .args(["-m", &model_path(m).to_string_lossy(), "--host", "127.0.0.1", "--port", &port.to_string()])
            .args(["-l", language, "-t", &threads.to_string()])
            // Greedy decoding without temperature fallback: same result on clear speech, faster.
            .args(["-ac", AUDIO_CTX, "-nf", "-bo", "1"])
            .stdin(Stdio::null())
            .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("Could not start the speech server: {e}"))?;
        crate::procjob::bind_child(&child);
        if let Err(e) = wait_ready(port, &mut child, Duration::from_secs(90)) {
            let _ = child.kill();
            return Err(e);
        }
        *self.server.lock() = Some(Server { child, port, model: m.id.into(), language: language.into() });
        Ok(port)
    }

    pub fn start(self: &Arc<Self>, app: &AppHandle, target: &str, cfg: Config) -> AppResult<()> {
        let mut rec = self.recording.lock();
        if rec.is_some() {
            return Err(AppError::invalid("Already recording"));
        }
        if !server_exe().is_file() || model(&cfg.model).map(|m| !model_path(m).is_file()).unwrap_or(true) {
            return Err(AppError::invalid("Speech recognition is not installed yet. Open Settings → Voice and download a model."));
        }
        let (stop_tx, stop_rx) = std::sync::mpsc::channel();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let app2 = app.clone();
        let device = cfg.device.clone();
        let handle = std::thread::Builder::new()
            .name("stt-record".into())
            .spawn(move || {
                record(device, stop_rx, started_tx, move |level| {
                    let _ = app2.emit("stt-level", json!({ "level": level }));
                })
            })
            .map_err(AppError::from)?;
        match started_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(AppError::invalid(e)),
            Err(_) => return Err(AppError::invalid("The microphone did not respond")),
        }
        *rec = Some(Recording { target: target.into(), stop: stop_tx, handle });
        drop(rec);
        // Load the model while the user is still speaking.
        let me = self.clone();
        std::thread::spawn(move || {
            let _ = me.ensure_server(&cfg.model, &cfg.language);
        });
        Ok(())
    }

    pub fn cancel(&self) {
        if let Some(r) = self.recording.lock().take() {
            let _ = r.stop.send(());
            let _ = r.handle.join();
        }
    }

    /// Stop recording and transcribe. Returns (target session, transcript).
    pub fn stop(&self, cfg: &Config) -> AppResult<(String, Transcript)> {
        let r = self.recording.lock().take().ok_or_else(|| AppError::invalid("Not recording"))?;
        let _ = r.stop.send(());
        let cap = r.handle.join().map_err(|_| AppError::other("recording thread crashed"))?.map_err(AppError::invalid)?;
        Ok((r.target, self.recognise(cfg, &cap.samples, cap.rate, cap.loudest)?))
    }

    /// Mono samples at `rate` → cleaned transcript.
    pub fn recognise(&self, cfg: &Config, samples: &[f32], rate: u32, loudest: f32) -> AppResult<Transcript> {
        let seconds = samples.len() as f32 / rate.max(1) as f32;
        if seconds < 0.35 || loudest < 0.004 || voiced_ms(samples, rate) < 250 {
            // Too short, silence or just room noise: Whisper would only invent text.
            return Ok(Transcript { text: String::new(), send: false });
        }
        let mut samples = resample(samples, rate);
        normalize(&mut samples);
        let port = self.ensure_server(&cfg.model, &cfg.language).map_err(AppError::invalid)?;
        let mut text = String::new();
        for (a, b) in chunk_bounds(&samples, SAMPLE_RATE) {
            // No silence padding: measured, it makes Whisper mis-hear the first words.
            let audio = &samples[a..b];
            // The previous piece as context keeps sentences and spelling consistent.
            let tail: String = text.chars().rev().take(160).collect::<Vec<_>>().into_iter().rev().collect();
            let prompt = format!("{} {}", cfg.vocabulary.trim(), tail).trim().to_string();
            let part = transcribe(port, &wav_bytes(audio), &prompt).map_err(AppError::invalid)?;
            let part = BRACKETED.replace_all(&part, " ");
            let part = part.split_whitespace().collect::<Vec<_>>().join(" ");
            if !part.is_empty() && !HALLUCINATION.is_match(&part) {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(&part);
            }
        }
        Ok(clean_transcript(&text))
    }

    pub fn shutdown(&self) {
        self.cancel();
        if let Some(mut s) = self.server.lock().take() {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }
}

fn transcribe(port: u16, wav: &[u8], vocabulary: &str) -> Result<String, String> {
    let boundary = format!("----cockpit{}", uuid::Uuid::new_v4().simple());
    let mut body = Vec::with_capacity(wav.len() + 1024);
    let mut field = |name: &str, value: &str| {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    };
    field("response_format", "json");
    field("temperature", "0.0");
    if !vocabulary.trim().is_empty() {
        // Whisper's prompt biases spelling of names and technical terms.
        field("prompt", vocabulary.trim());
    }
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let mut resp = agent(Duration::from_secs(180))
        .post(format!("http://127.0.0.1:{port}/inference"))
        .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
        .send(&body[..])
        .map_err(|e| format!("Speech server request failed: {e}"))?;
    let status = resp.status();
    let text = resp.body_mut().read_to_string().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Speech server error {status}: {}", text.chars().take(200).collect::<String>()));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("Unexpected speech server reply: {}", text.chars().take(120).collect::<String>()))?;
    Ok(v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcripts_are_cleaned_and_send_word_detected() {
        let t = clean_transcript(" Bitte führe die Tests aus\n und behebe den Fehler.\n");
        assert_eq!(t, Transcript { text: "Bitte führe die Tests aus und behebe den Fehler.".into(), send: false });
        let t = clean_transcript(" Committe die Änderungen, absenden.");
        assert_eq!(t, Transcript { text: "Committe die Änderungen".into(), send: true });
        assert!(clean_transcript("Mach weiter und senden").send);
        assert!(!clean_transcript("Sende die Mail an Peter").send, "only as the last word");
        assert_eq!(clean_transcript("Untertitel im Auftrag des ZDF, 2021").text, "");
        assert_eq!(clean_transcript(" Vielen Dank.").text, "");
        assert_eq!(clean_transcript("[BLANK_AUDIO]").text, "");
        assert_eq!(clean_transcript("(Musik) Starte den Server").text, "Starte den Server");
    }

    #[test]
    fn resampling_and_wav_header() {
        let input: Vec<f32> = (0..48_000).map(|i| (i as f32 / 48.0).sin()).collect();
        let out = resample(&input, 48_000);
        assert_eq!(out.len(), 16_000);
        let wav = wav_bytes(&out);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(wav.len(), 44 + 32_000);
    }

    #[test]
    fn quiet_speech_is_normalised_but_silence_is_left_alone() {
        let mut quiet = vec![0.05f32, -0.1, 0.02];
        normalize(&mut quiet);
        assert!((quiet[1] + 0.7).abs() < 1e-4);
        let mut silence = vec![0.0f32; 10];
        normalize(&mut silence);
        assert!(silence.iter().all(|x| *x == 0.0));
    }

    #[test]
    fn long_audio_is_cut_at_pauses() {
        let rate = 16_000u32;
        let r = rate as usize;
        assert_eq!(chunk_bounds(&vec![0.1f32; r * 4], rate), vec![(0, r * 4)], "short clip stays whole");
        // 20 s of "speech" with a pause at 7.0–7.3 s and at 14.0–14.3 s.
        let mut s: Vec<f32> = (0..r * 20).map(|i| ((i as f32) / 5.0).sin() * 0.3).collect();
        for p in [7.0f32, 14.0] {
            let a = (p * rate as f32) as usize;
            s[a..a + r * 3 / 10].iter_mut().for_each(|x| *x = 0.0);
        }
        let b = chunk_bounds(&s, rate);
        assert_eq!(b.len(), 3, "{b:?}");
        assert!(b.iter().all(|(x, y)| (y - x) as f32 / rate as f32 <= MAX_CHUNK_S + 0.01));
        let cut = b[0].1 as f32 / rate as f32;
        assert!((7.0..7.3).contains(&cut), "cut in the pause, got {cut}");
        assert_eq!(b.last().unwrap().1, s.len());
    }

    #[test]
    fn room_noise_is_not_speech() {
        let rate = 16_000;
        // Steady hiss around 0.01 RMS for two seconds.
        let noise: Vec<f32> = (0..rate * 2).map(|i| ((i * 7919 % 1000) as f32 / 1000.0 - 0.5) * 0.035).collect();
        assert!(voiced_ms(&noise, rate as u32) < 250, "{}", voiced_ms(&noise, rate as u32));
        // Same hiss with one second of louder "speech" in the middle.
        let mut speech = noise.clone();
        for (i, s) in speech.iter_mut().enumerate().skip(rate / 2).take(rate) {
            *s += (i as f32 / 8.0).sin() * 0.2;
        }
        assert!(voiced_ms(&speech, rate as u32) >= 900);
        assert_eq!(voiced_ms(&[], rate as u32), 0);
    }

    #[test]
    fn only_server_files_are_extracted() {
        assert_eq!(wanted_from_zip("Release/whisper-server.exe").as_deref(), Some("whisper-server.exe"));
        assert_eq!(wanted_from_zip("Release/ggml-cpu-alderlake.dll").as_deref(), Some("ggml-cpu-alderlake.dll"));
        assert_eq!(wanted_from_zip("Release/whisper.dll").as_deref(), Some("whisper.dll"));
        assert!(wanted_from_zip("Release/wchess.exe").is_none());
        assert!(wanted_from_zip("Release/SDL2.dll").is_none());
    }

    /// Real recognition through whisper-server. Needs an installed engine + model:
    /// `AI_COCKPIT_HOME=<dir with stt/> STT_TEST_WAV=<16-bit mono wav> cargo test live_ -- --ignored`
    #[test]
    #[ignore]
    fn live_recognition_from_wav() {
        let wav = std::fs::read(std::env::var("STT_TEST_WAV").expect("STT_TEST_WAV")).unwrap();
        let rate = u32::from_le_bytes(wav[24..28].try_into().unwrap());
        let pcm: Vec<f32> = wav[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0 * 0.2).collect();
        // Simulate a 48 kHz microphone at low volume: exercises resampling and normalisation.
        let mic: Vec<f32> = pcm.windows(2).flat_map(|w| (0..3).map(move |k| w[0] + (w[1] - w[0]) * k as f32 / 3.0)).collect();
        let stt = Stt::default();
        let cfg = Config { model: std::env::var("STT_TEST_MODEL").unwrap_or("small".into()), language: "de".into(), vocabulary: "npm, git, store.ts".into(), device: None };
        let t0 = Instant::now();
        let first = stt.recognise(&cfg, &mic, rate * 3, 0.1).unwrap();
        let cold = t0.elapsed();
        let t1 = Instant::now();
        let second = stt.recognise(&cfg, &mic, rate * 3, 0.1).unwrap();
        println!("cold {cold:?} warm {:?}: {:?}", t1.elapsed(), second);
        stt.shutdown();
        assert_eq!(first, second);
        let lower = second.text.to_lowercase();
        assert!(lower.contains("tests") && lower.contains("git"), "{lower}");
    }

    #[test]
    fn models_have_pinned_hashes() {
        for m in MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
        }
        assert!(model("small").is_some());
    }
}
