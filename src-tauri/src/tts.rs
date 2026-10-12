//! Local neural text-to-speech for spoken answers and voice callouts.
//!
//! * Engine: Piper (rhasspy/piper, MIT) — small ONNX voices that run in real time on a laptop CPU.
//! * One Piper process is kept running with the voice loaded (`--output_dir` mode: one line of text
//!   in, the path of a finished WAV out), so a sentence is ready in ~100–400 ms.
//! * Setup: the engine and each voice are downloaded once on request, from pinned URLs, and
//!   verified against pinned SHA-256 hashes. Text never leaves the machine.
//!
//! Two more engines sit next to Piper (Piper stays the offline default and the fallback):
//! * Supertonic 3 (supertonic.rs): far more natural German, still local — ONNX Runtime on the CPU,
//!   ten voices (five male, five female), ~415 MB once.
//! * Azure AI Speech (tts_cloud.rs): cloud voices, opt-in with the user's own key; text leaves the PC.
//!
//! Voice ids tell the engine apart: Piper ids as in the catalog, `st-…` Supertonic, `az-…` Azure.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::paths;

pub struct VoiceSpec {
    pub id: &'static str,
    pub label: &'static str,
    /// "de" or "en": voices of the dictation language are offered first.
    pub lang: &'static str,
    pub hint: &'static str,
    /// Path below the piper-voices repository, without extension.
    pub path: &'static str,
    pub sha256: &'static str,
    pub config_sha256: &'static str,
    pub size_mb: u32,
    /// Speaking styles of a multi-speaker voice, in the order of its speaker ids.
    pub styles: &'static [&'static str],
}

/// Pinned voices (piper-voices v1.0.0 on Hugging Face). ~63 MB (medium/low tier) or ~114 MB (high tier),
/// which is what runs comfortably in real time on a CPU.
pub const VOICES: &[VoiceSpec] = &[
    VoiceSpec { id: "de_DE-thorsten-medium", label: "Thorsten", lang: "de", hint: "German · male · clear and calm", path: "de/de_DE/thorsten/medium/de_DE-thorsten-medium", sha256: "7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819", config_sha256: "974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85", size_mb: 63, styles: &[] },
    VoiceSpec { id: "de_DE-thorsten-high", label: "Thorsten HD", lang: "de", hint: "German · male · high quality, the most natural German voice", path: "de/de_DE/thorsten/high/de_DE-thorsten-high", sha256: "9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1", config_sha256: "6de734444e4c3f9e33b7ebe2746dbc19b71e85f613e79c65acf623200b99a76a", size_mb: 114, styles: &[] },
    VoiceSpec { id: "de_DE-ramona-low", label: "Ramona", lang: "de", hint: "German · female · warm, a little breathy", path: "de/de_DE/ramona/low/de_DE-ramona-low", sha256: "a1068592532aad8c49bf3d1a01b8749c11d7dba726689ee28ad64e7b627ae4c5", config_sha256: "64906ab7a050ac685fa3dcea044baa798f67ed77be164f9c668a69298c6487d2", size_mb: 63, styles: &[] },
    VoiceSpec { id: "de_DE-thorsten_emotional-medium", label: "Thorsten Emotional", lang: "de", hint: "German · male · with moods: friendly, whispering, surprised …", path: "de/de_DE/thorsten_emotional/medium/de_DE-thorsten_emotional-medium", sha256: "c1764e652266cd6dcebf1b95c61973df5970a5f5272e94b655ff1ddf9a99d1ff", config_sha256: "92895b9e99f7cfc13f4a9879da615c3d6e0baa4d660e26d7b685abdd27a6d1d3", size_mb: 77, styles: &["amused", "angry", "disgusted", "drunk", "neutral", "sleepy", "surprised", "whisper"] },
    VoiceSpec { id: "de_DE-kerstin-low", label: "Kerstin", lang: "de", hint: "German · female · bright and the clearest German woman", path: "de/de_DE/kerstin/low/de_DE-kerstin-low", sha256: "d352a7641892cebf2903859af94e9ba81a141110215fe3943bcda7f7da401b7a", config_sha256: "56e708556b7b9b7a53c4f8957e021421e69f11a600962bba554cffbe72cf2d47", size_mb: 63, styles: &[] },
    // Measured (Piper → local Whisper, two German sentences): Kerstin clearest (one sentence
    // word-perfect, "Codex" misheard in the other), Eva close (only names / English words misheard),
    // Ramona more slips. The multi-speaker "mls" voice was unintelligible.
    VoiceSpec { id: "de_DE-eva_k-x_low", label: "Eva", lang: "de", hint: "German · female · friendly, small (20 MB), a little muffled", path: "de/de_DE/eva_k/x_low/de_DE-eva_k-x_low", sha256: "e88cf290fbfb768bf111330d2e8a46e376b0d85e3423a28bfebbc863a260dad8", config_sha256: "ef14b3dcb279ab4b18422a7a132877bee7a148821bd91152fb7ae9c4b3d79625", size_mb: 20, styles: &[] },
    VoiceSpec { id: "en_GB-alan-medium", label: "Alan", lang: "en", hint: "British English · male · the butler", path: "en/en_GB/alan/medium/en_GB-alan-medium", sha256: "0a309668932205e762801f1efc2736cd4b0120329622adf62be09e56339d3330", config_sha256: "c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e", size_mb: 63, styles: &[] },
    VoiceSpec { id: "en_GB-cori-high", label: "Cori HD", lang: "en", hint: "British English · female · high quality", path: "en/en_GB/cori/high/en_GB-cori-high", sha256: "470b4dd634c98f8a4850d7626ffc3dfc90774628eeef6605a6dd8f88f30a5903", config_sha256: "9e7fb5b5671612c22f3c81cbe46c1ae87b031a4632bcb509e499dad6f1e2adec", size_mb: 114, styles: &[] },
    VoiceSpec { id: "en_GB-jenny_dioco-medium", label: "Jenny", lang: "en", hint: "British English · female", path: "en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium", sha256: "469c630d209e139dd392a66bf4abde4ab86390a0269c1e47b4e5d7ce81526b01", config_sha256: "a9a7a93a317c9a3cb6563e37eb057df9ef09c06188a8a4341b0fcb58cba54dd4", size_mb: 63, styles: &[] },
    VoiceSpec { id: "en_US-lessac-high", label: "Lessac HD", lang: "en", hint: "American English · female · high quality", path: "en/en_US/lessac/high/en_US-lessac-high", sha256: "4cabf7c3a638017137f34a1516522032d4fe3f38228a843cc9b764ddcbcd9e09", config_sha256: "db42b97d9859f257bc1561b8ed980e7fb2398402050a74ddd6cbec931a92412f", size_mb: 114, styles: &[] },
    VoiceSpec { id: "en_US-ryan-medium", label: "Ryan", lang: "en", hint: "American English · male", path: "en/en_US/ryan/medium/en_US-ryan-medium", sha256: "abf4c274862564ed647ba0d2c47f8ee7c9b717d27bdad9219100eb310db4047a", config_sha256: "44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d", size_mb: 63, styles: &[] },
    VoiceSpec { id: "en_US-amy-medium", label: "Amy", lang: "en", hint: "American English · female", path: "en/en_US/amy/medium/en_US-amy-medium", sha256: "b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18", config_sha256: "95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77", size_mb: 63, styles: &[] },
];
const VOICE_BASE_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";
/// Piper 2023.11.14-2 for Windows x64 (piper.exe, onnxruntime, espeak-ng data).
const BIN_URL: &str = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
const BIN_SHA256: &str = "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea";
const MAX_TEXT: usize = 2_000;

pub fn voice(id: &str) -> Option<&'static VoiceSpec> {
    VOICES.iter().find(|v| v.id == id)
}

// ---------------------------------------------------------------------------
// Supertonic 3 (local, ONNX Runtime)
// ---------------------------------------------------------------------------

pub struct StVoice {
    pub id: &'static str,
    /// The model's style file (voice_styles/<style>.json).
    pub style: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
}

/// Measured median pitch in brackets (two German sentences, 2026-10-10).
pub const ST_VOICES: &[StVoice] = &[
    StVoice { id: "st-M4", style: "M4", label: "Supertonic Max", hint: "German · male · natural, calm and even (~117 Hz)" },
    StVoice { id: "st-M1", style: "M1", label: "Supertonic Leo", hint: "German · male · natural, lighter and bright (~138 Hz)" },
    StVoice { id: "st-M2", style: "M2", label: "Supertonic Jonas", hint: "German · male · natural, deep and lively (~91 Hz)" },
    StVoice { id: "st-M3", style: "M3", label: "Supertonic Paul", hint: "German · male · natural, deep and brisk (~97 Hz)" },
    StVoice { id: "st-M5", style: "M5", label: "Supertonic Karl", hint: "German · male · natural, deep and calm (~92 Hz)" },
    StVoice { id: "st-F1", style: "F1", label: "Supertonic Anna", hint: "German · female · natural, warm and clear (~188 Hz)" },
    StVoice { id: "st-F2", style: "F2", label: "Supertonic Lea", hint: "German · female · natural, bright and lively (~204 Hz)" },
    StVoice { id: "st-F3", style: "F3", label: "Supertonic Clara", hint: "German · female · natural, low and unhurried (~169 Hz)" },
    StVoice { id: "st-F4", style: "F4", label: "Supertonic Mia", hint: "German · female · natural, high and friendly (~210 Hz)" },
    StVoice { id: "st-F5", style: "F5", label: "Supertonic Sophie", hint: "German · female · natural, low and calm (~161 Hz)" },
];

pub fn st_voice(id: &str) -> Option<&'static StVoice> {
    ST_VOICES.iter().find(|v| v.id == id)
}

/// Supertone/supertonic-3 on Hugging Face, pinned to the commit the official SDK 1.3.1 uses.
const ST_BASE_URL: &str = "https://huggingface.co/Supertone/supertonic-3/resolve/724fb5abbf5502583fb520898d45929e62f02c0b/";
/// (path in the repo, sha256)
const ST_FILES: &[(&str, &str)] = &[
    ("onnx/tts.json", "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09"),
    ("onnx/unicode_indexer.json", "9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f"),
    ("onnx/duration_predictor.onnx", "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db"),
    ("onnx/text_encoder.onnx", "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff"),
    ("onnx/vocoder.onnx", "085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba"),
    ("onnx/vector_estimator.onnx", "883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c"),
    ("voice_styles/F1.json", "bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2"),
    ("voice_styles/F2.json", "7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6"),
    ("voice_styles/F3.json", "12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab"),
    ("voice_styles/F4.json", "c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b"),
    ("voice_styles/F5.json", "45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d"),
    ("voice_styles/M1.json", "e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b"),
    ("voice_styles/M2.json", "b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50"),
    ("voice_styles/M3.json", "ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b"),
    ("voice_styles/M4.json", "ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303"),
    ("voice_styles/M5.json", "dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2"),
    // OpenRAIL-M: kept next to the model (its use restrictions apply to whoever uses it)
    ("LICENSE", "0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f"),
];
/// ONNX Runtime 1.31.0 (MIT, Microsoft): the official Python wheel is the smallest pinned package
/// that carries onnxruntime.dll (15 MB instead of the 80 MB release zip); only the two DLLs are kept.
const ORT_WHEEL_URL: &str = "https://files.pythonhosted.org/packages/c4/86/05ed2056f43b27aaf12ebc592ebd9037a26bed315958cf882f43425fd469/onnxruntime-1.31.0-cp313-cp313-win_amd64.whl";
const ORT_WHEEL_SHA256: &str = "73e0165d58ece068c2a8a1c477c90b38e5a8adbbd399fdfdfd4bd79cbc28ff8d";
const ST_SIZE_MB: u32 = 415;

fn st_dir() -> PathBuf {
    root().join("supertonic3")
}
fn ort_dir() -> PathBuf {
    root().join("onnxruntime")
}
fn ort_dll() -> PathBuf {
    ort_dir().join("onnxruntime.dll")
}
pub fn st_installed() -> bool {
    cfg!(windows) && ort_dll().is_file() && ST_FILES.iter().all(|(p, _)| st_dir().join(p).is_file())
}

/// The two DLLs from the wheel (onnxruntime/capi/…); nothing else is extracted.
fn ort_target(name: &str) -> Option<&'static str> {
    match name {
        "onnxruntime/capi/onnxruntime.dll" => Some("onnxruntime.dll"),
        "onnxruntime/capi/onnxruntime_providers_shared.dll" => Some("onnxruntime_providers_shared.dll"),
        _ => None,
    }
}

fn extract_ort(wheel: &std::path::Path) -> Result<(), String> {
    let f = std::fs::File::open(wheel).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(ort_dir()).map_err(|e| e.to_string())?;
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
        let Some(file) = ort_target(entry.name()) else { continue };
        let mut out = std::fs::File::create(ort_dir().join(file)).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    if !ort_dll().is_file() {
        return Err("onnxruntime.dll missing in the download".into());
    }
    Ok(())
}

/// The loaded Supertonic model with the voice styles used so far.
struct StEngine {
    model: crate::supertonic::Model,
    styles: std::collections::HashMap<&'static str, crate::supertonic::Style>,
}

/// Which engine speaks a voice id.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Piper,
    Supertonic,
    Azure,
}

pub fn kind_of(id: &str) -> Option<Kind> {
    if voice(id).is_some() {
        Some(Kind::Piper)
    } else if st_voice(id).is_some() {
        Some(Kind::Supertonic)
    } else if crate::tts_cloud::voice(id).is_some() {
        Some(Kind::Azure)
    } else {
        None
    }
}

pub fn root() -> PathBuf {
    paths::root().join("tts")
}
fn bin_dir() -> PathBuf {
    root().join("bin")
}
fn engine_exe() -> PathBuf {
    bin_dir().join(if cfg!(windows) { "piper.exe" } else { "piper" })
}
fn voice_path(v: &VoiceSpec) -> PathBuf {
    root().join("voices").join(format!("{}.onnx", v.id))
}
fn out_dir() -> PathBuf {
    root().join("out")
}

/// One utterance per line: Piper reads stdin line by line, so line breaks become spaces.
/// Characters that only make sense on screen are dropped.
pub fn speakable(text: &str) -> String {
    let t: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .filter(|c| !matches!(c, '*' | '#' | '`' | '_' | '|' | '~' | '<' | '>'))
        .collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    t.chars().take(MAX_TEXT).collect()
}

/// Zip entries live under "piper/…": strip that folder, keep the rest (espeak-ng-data/…).
fn zip_target(name: &str) -> Option<PathBuf> {
    let rest = name.strip_prefix("piper/")?;
    if rest.is_empty() || rest.ends_with('/') || rest.split('/').any(|p| p == ".." || p.is_empty()) {
        return None;
    }
    Some(rest.split('/').collect())
}

fn extract_engine(zip_path: &std::path::Path) -> Result<(), String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let dir = bin_dir();
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = zip_target(entry.name()) else { continue };
        let dest = dir.join(rel);
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    if !engine_exe().is_file() {
        return Err("piper.exe missing in the download".into());
    }
    Ok(())
}

struct Engine {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    voice: String,
    length_scale: String,
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Engines kept running at once: answers, fillers and callouts use slightly different speeds (and
/// voices); each change used to restart Piper and reload the model.
const POOL: usize = 3;

#[derive(Default)]
pub struct Tts {
    /// Running engines, the most recently used last.
    engines: Mutex<Vec<Engine>>,
    installing: AtomicBool,
    /// Supertonic, loaded on first use (~0.5 GB of RAM while loaded).
    st: Mutex<Option<StEngine>>,
    /// Supertonic's denoising steps (the „Klang“ setting); 0 = the default.
    st_steps: std::sync::atomic::AtomicUsize,
}

/// The „Klang“ setting → Supertonic's denoising steps: fast 4 · balanced 5 (default) · best 8.
pub fn steps_for(quality: &str) -> usize {
    match quality {
        "fast" => 4,
        "best" => 8,
        _ => crate::supertonic::DEFAULT_STEPS,
    }
}

/// One line for Piper's `--json-input`: the text and, for a voice with styles, the speaker.
pub fn request_line(text: &str, speaker: Option<usize>) -> String {
    match speaker {
        Some(id) => json!({ "text": text, "speaker_id": id }).to_string(),
        None => json!({ "text": text }).to_string(),
    }
}

/// The speaker id of a style ("whisper" → 7 for Thorsten Emotional); None for one-speaker voices.
pub fn speaker_of(v: &VoiceSpec, style: Option<&str>) -> Option<usize> {
    if v.styles.is_empty() {
        return None;
    }
    let want = style.unwrap_or("neutral");
    v.styles.iter().position(|s| *s == want).or_else(|| v.styles.iter().position(|s| *s == "neutral"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    id: &'static str,
    label: &'static str,
    lang: &'static str,
    hint: &'static str,
    size_mb: u32,
    installed: bool,
    styles: &'static [&'static str],
    /// "piper", "supertonic" or "azure"
    engine: &'static str,
    /// speaks English too (Supertonic, the multilingual Azure voices)
    multilingual: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    id: &'static str,
    label: &'static str,
    /// ready to speak: downloaded (local) or a key stored (cloud)
    ready: bool,
    local: bool,
    size_mb: u32,
    /// cloud: the region the key belongs to (never the key)
    region: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    engine_installed: bool,
    voices: Vec<VoiceStatus>,
    engines: Vec<EngineStatus>,
    installing: bool,
    running: Option<String>,
}

/// Speed factor (1.0 = normal) → Piper's length scale (bigger = slower).
pub fn length_scale(speed: f64) -> String {
    let s = if speed.is_finite() { speed.clamp(0.5, 2.0) } else { 1.0 };
    format!("{:.2}", 1.0 / s)
}

impl Tts {
    /// How many denoising steps Supertonic takes from now on (steps_for).
    pub fn set_st_steps(&self, steps: usize) {
        self.st_steps.store(steps.clamp(2, 12), std::sync::atomic::Ordering::Relaxed);
    }

    pub fn status(&self) -> Status {
        let piper = engine_exe().is_file();
        let st = st_installed();
        let azure = crate::tts_cloud::key_set();
        let mut voices: Vec<VoiceStatus> = VOICES
            .iter()
            .map(|v| VoiceStatus { id: v.id, label: v.label, lang: v.lang, hint: v.hint, size_mb: v.size_mb, installed: piper && voice_path(v).is_file(), styles: v.styles, engine: "piper", multilingual: false })
            .collect();
        voices.extend(ST_VOICES.iter().map(|v| VoiceStatus { id: v.id, label: v.label, lang: "de", hint: v.hint, size_mb: ST_SIZE_MB, installed: st, styles: &[], engine: "supertonic", multilingual: true }));
        voices.extend(crate::tts_cloud::AZURE_VOICES.iter().map(|v| VoiceStatus { id: v.id, label: v.label, lang: "de", hint: v.hint, size_mb: 0, installed: azure, styles: v.styles, engine: "azure", multilingual: v.multilingual }));
        Status {
            engine_installed: piper || st || azure,
            voices,
            engines: vec![
                EngineStatus { id: "piper", label: "Piper", ready: piper, local: true, size_mb: 63, region: None },
                EngineStatus { id: "supertonic", label: "Supertonic 3", ready: st, local: true, size_mb: ST_SIZE_MB, region: None },
                EngineStatus { id: "azure", label: "Microsoft Azure", ready: azure, local: false, size_mb: 0, region: crate::tts_cloud::region() },
            ],
            installing: self.installing.load(Ordering::SeqCst),
            running: self.engines.lock().last().map(|e| e.voice.clone()),
        }
    }

    pub fn install(&self, app: &AppHandle, voice_id: &str) -> AppResult<()> {
        if st_voice(voice_id).is_some() {
            return self.install_supertonic(app);
        }
        let v = voice(voice_id).ok_or_else(|| AppError::invalid("Unknown voice"))?;
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err(AppError::invalid("A download is already running"));
        }
        let res = (|| -> Result<(), String> {
            let emit = |item: &str, done: u64, total: u64| {
                let _ = app.emit("tts-progress", json!({ "item": item, "done": done, "total": total }));
            };
            if !engine_exe().is_file() {
                let zip = root().join("piper_windows_amd64.zip");
                crate::stt::download(BIN_URL, &zip, BIN_SHA256, &|d, t| emit("Voice engine", d, t))?;
                extract_engine(&zip)?;
                let _ = std::fs::remove_file(&zip);
            }
            let model = voice_path(v);
            let config = model.with_extension("onnx.json");
            if !config.is_file() {
                crate::stt::download(&format!("{VOICE_BASE_URL}{}.onnx.json", v.path), &config, v.config_sha256, &|_, _| {})?;
            }
            if !model.is_file() {
                crate::stt::download(&format!("{VOICE_BASE_URL}{}.onnx", v.path), &model, v.sha256, &|d, t| emit(v.label, d, t))?;
            }
            Ok(())
        })();
        self.installing.store(false, Ordering::SeqCst);
        let _ = app.emit("tts-progress", json!({ "item": null, "done": 0, "total": 0 }));
        res.map_err(AppError::other)
    }

    /// ONNX Runtime + the Supertonic model and all ten voices (~415 MB), each file checksum-pinned.
    fn install_supertonic(&self, app: &AppHandle) -> AppResult<()> {
        if !cfg!(windows) {
            return Err(AppError::invalid("Supertonic voices are available on Windows"));
        }
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err(AppError::invalid("A download is already running"));
        }
        let res = (|| -> Result<(), String> {
            let emit = |item: &str, done: u64, total: u64| {
                let _ = app.emit("tts-progress", json!({ "item": item, "done": done, "total": total }));
            };
            if !ort_dll().is_file() {
                let wheel = root().join("onnxruntime.whl");
                crate::stt::download(ORT_WHEEL_URL, &wheel, ORT_WHEEL_SHA256, &|d, t| emit("ONNX Runtime", d, t))?;
                extract_ort(&wheel)?;
                let _ = std::fs::remove_file(&wheel);
            }
            for (path, sha) in ST_FILES {
                let dest = st_dir().join(path);
                if !dest.is_file() {
                    crate::stt::download(&format!("{ST_BASE_URL}{path}"), &dest, sha, &|d, t| emit("Supertonic voices", d, t))?;
                }
            }
            Ok(())
        })();
        self.installing.store(false, Ordering::SeqCst);
        let _ = app.emit("tts-progress", json!({ "item": null, "done": 0, "total": 0 }));
        res.map_err(AppError::other)
    }

    /// Load the Supertonic model (once) and this voice's style.
    fn st_ready<'a>(slot: &'a mut Option<StEngine>, v: &'static StVoice) -> Result<&'a mut StEngine, String> {
        if slot.is_none() {
            if !st_installed() {
                return Err("The Supertonic voices are not installed yet. Open the Voice tab and download them.".into());
            }
            crate::supertonic::init_runtime(&ort_dll())?;
            let model = crate::supertonic::Model::load(&st_dir())?;
            *slot = Some(StEngine { model, styles: Default::default() });
        }
        let e = slot.as_mut().ok_or("not loaded")?;
        if !e.styles.contains_key(v.style) {
            let s = crate::supertonic::Style::load(&st_dir().join("voice_styles").join(format!("{}.json", v.style)))?;
            e.styles.insert(v.style, s);
        }
        Ok(e)
    }

    fn synthesize_st(&self, v: &'static StVoice, text: &str, speed: f64, lang: &str) -> Result<Vec<u8>, String> {
        let mut slot = self.st.lock();
        let e = Self::st_ready(&mut slot, v)?;
        let style = e.styles.get(v.style).ok_or("voice style missing")?;
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7);
        let speed = if speed.is_finite() { speed.clamp(0.5, 2.0) } else { 1.0 } as f32;
        let steps = match self.st_steps.load(std::sync::atomic::Ordering::Relaxed) {
            0 => crate::supertonic::DEFAULT_STEPS,
            n => n,
        };
        let samples = e.model.synthesize(text, lang, style, steps, speed, seed)?;
        Ok(crate::supertonic::wav(&samples, e.model.sample_rate as u32))
    }

    fn spawn(v: &VoiceSpec, scale: &str) -> Result<Engine, String> {
        if !engine_exe().is_file() || !voice_path(v).is_file() {
            return Err(format!("The voice {} is not installed yet. Open the Voice tab and download it.", v.label));
        }
        std::fs::create_dir_all(out_dir()).map_err(|e| e.to_string())?;
        let log = std::fs::File::create(root().join("engine.log")).map_err(|e| e.to_string())?;
        let mut cmd = Command::new(engine_exe());
        cmd.current_dir(bin_dir())
            .arg("--model")
            .arg(voice_path(v))
            .arg("--output_dir")
            .arg(out_dir())
            .args(["--length_scale", scale, "--sentence_silence", "0.12", "--json-input"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Piper logs every utterance on stderr: into a file, a full pipe would block it.
            .stderr(Stdio::from(log));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| format!("Could not start the voice engine: {e}"))?;
        crate::procjob::bind_child(&child);
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);
        Ok(Engine { child, stdin, stdout, voice: v.id.into(), length_scale: scale.into() })
    }

    /// Text → WAV bytes (mono). Keeps the engine running for the next sentence. `style` picks the
    /// speaking style of a voice that has several ("whisper", "amused" …).
    /// `lang` ("de" / "en") is the language of this sentence — the multilingual engines read it
    /// with the right pronunciation; Piper voices know only their own language.
    pub fn synthesize(&self, voice_id: &str, text: &str, speed: f64, style: Option<&str>, lang: Option<&str>) -> Result<Vec<u8>, String> {
        let line = speakable(text);
        if line.is_empty() {
            return Err("Nothing to say".into());
        }
        let lang = match lang {
            Some("en") => "en",
            _ => "de",
        };
        if let Some(v) = st_voice(voice_id) {
            return self.synthesize_st(v, &line, speed, lang);
        }
        if let Some(v) = crate::tts_cloud::voice(voice_id) {
            let key = crate::tts_cloud::load_key().ok_or("No Azure key stored")?;
            let style = style.filter(|s| v.styles.contains(s));
            return crate::tts_cloud::synthesize(&key, v.name, &line, speed, style, lang, v.multilingual, v.hd);
        }
        let v = voice(voice_id).ok_or("Unknown voice")?;
        let scale = length_scale(speed);
        let request = request_line(&line, speaker_of(v, style));
        let mut pool = self.engines.lock();
        // Up to two tries: a crashed engine is restarted once.
        for attempt in 0..2 {
            let at = Self::engine_for(&mut pool, v, &scale)?;
            let e = &mut pool[at];
            let mut path = String::new();
            let ok = e.stdin.write_all(format!("{request}\n").as_bytes()).and_then(|_| e.stdin.flush()).is_ok()
                && e.stdout.read_line(&mut path).map(|n| n > 0).unwrap_or(false);
            if !ok {
                pool.remove(at);
                if attempt == 0 {
                    continue;
                }
                let log = std::fs::read_to_string(root().join("engine.log")).unwrap_or_default();
                let tail = log.lines().rev().take(3).collect::<Vec<_>>().join(" | ");
                return Err(format!("The voice engine stopped. {tail}"));
            }
            let p = PathBuf::from(path.trim());
            let bytes = std::fs::read(&p).map_err(|e| format!("Could not read the speech: {e}"))?;
            let _ = std::fs::remove_file(&p);
            return Ok(bytes);
        }
        Err("The voice engine did not answer".into())
    }

    /// Index of a running engine for this voice and speed (started if needed, the least recently
    /// used one makes room); it becomes the most recently used.
    fn engine_for(pool: &mut Vec<Engine>, v: &VoiceSpec, scale: &str) -> Result<usize, String> {
        pool.retain_mut(|e| matches!(e.child.try_wait(), Ok(None)));
        if let Some(i) = pool.iter().position(|e| e.voice == v.id && e.length_scale == scale) {
            let e = pool.remove(i);
            pool.push(e);
        } else {
            if pool.len() >= POOL {
                pool.remove(0);
            }
            pool.push(Self::spawn(v, scale)?);
        }
        Ok(pool.len() - 1)
    }

    /// Start the engine with this voice so the first answer is quick.
    pub fn warmup(&self, voice_id: &str, speed: f64) -> Result<(), String> {
        if let Some(v) = st_voice(voice_id) {
            // loading reads ~400 MB: once, then a tiny sentence so the first real one is quick
            return self.synthesize_st(v, "Okay.", 1.0, "de").map(|_| ());
        }
        if crate::tts_cloud::voice(voice_id).is_some() {
            return Ok(());
        }
        let v = voice(voice_id).ok_or("Unknown voice")?;
        let scale = length_scale(speed);
        let mut pool = self.engines.lock();
        Self::engine_for(&mut pool, v, &scale).map(|_| ())
    }

    /// Free the Supertonic model (another engine was chosen): gives its memory back.
    pub fn release(&self, engine: &str) {
        if engine == "supertonic" {
            *self.st.lock() = None;
        } else if engine == "piper" {
            self.engines.lock().clear();
        }
    }

    pub fn shutdown(&self) {
        *self.st.lock() = None;
        self.engines.lock().clear();
        if let Ok(rd) = std::fs::read_dir(out_dir()) {
            for f in rd.flatten() {
                let _ = std::fs::remove_file(f.path());
            }
        }
    }
}

#[cfg(test)]
mod pool_tests {
    use super::*;

    #[test]
    fn styles_become_speaker_ids_and_json_lines() {
        let emo = voice("de_DE-thorsten_emotional-medium").unwrap();
        assert_eq!(speaker_of(emo, Some("whisper")), Some(7));
        assert_eq!(speaker_of(emo, Some("amused")), Some(0));
        assert_eq!(speaker_of(emo, Some("nonsense")), Some(4), "unknown → neutral");
        assert_eq!(speaker_of(emo, None), Some(4));
        assert_eq!(speaker_of(voice("de_DE-thorsten-medium").unwrap(), Some("whisper")), None);
        assert_eq!(request_line("Hallo \"Welt\"", Some(7)), r#"{"speaker_id":7,"text":"Hallo \"Welt\""}"#);
        assert_eq!(request_line("Hi", None), r#"{"text":"Hi"}"#);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn klang_maps_to_supertonic_steps() {
        assert_eq!(steps_for("fast"), 4);
        assert_eq!(steps_for("best"), 8);
        assert_eq!(steps_for("balanced"), crate::supertonic::DEFAULT_STEPS);
        assert_eq!(steps_for(""), crate::supertonic::DEFAULT_STEPS);
    }

    #[test]
    fn text_is_made_speakable() {
        assert_eq!(speakable("**Fertig!**\nAlle `Tests` grün.\r\n"), "Fertig! Alle Tests grün.");
        assert_eq!(speakable("  \n\t "), "");
        assert_eq!(speakable(&"a".repeat(5000)).len(), MAX_TEXT);
    }

    #[test]
    fn speed_maps_to_length_scale() {
        assert_eq!(length_scale(1.0), "1.00");
        assert_eq!(length_scale(1.25), "0.80");
        assert_eq!(length_scale(9.0), "0.50", "clamped");
        assert_eq!(length_scale(f64::NAN), "1.00");
    }

    #[test]
    fn only_files_below_the_piper_folder_are_extracted() {
        assert_eq!(zip_target("piper/piper.exe"), Some(PathBuf::from("piper.exe")));
        assert_eq!(zip_target("piper/espeak-ng-data/de_dict"), Some(["espeak-ng-data", "de_dict"].iter().collect()));
        assert_eq!(zip_target("piper/"), None);
        assert_eq!(zip_target("piper/espeak-ng-data/"), None);
        assert_eq!(zip_target("piper/../evil.exe"), None);
        assert_eq!(zip_target("other/x.dll"), None);
    }

    #[test]
    fn voices_have_pinned_hashes() {
        for v in VOICES {
            assert_eq!(v.sha256.len(), 64, "{}", v.id);
            assert_eq!(v.config_sha256.len(), 64, "{}", v.id);
            assert!(v.path.ends_with(v.id));
        }
        assert!(voice("de_DE-thorsten-medium").is_some());
        for (path, sha) in ST_FILES {
            assert_eq!(sha.len(), 64, "{path}");
            assert!(sha.chars().all(|c| c.is_ascii_hexdigit()), "{path}");
        }
        assert_eq!(ORT_WHEEL_SHA256.len(), 64);
        assert!(ST_BASE_URL.starts_with("https://huggingface.co/Supertone/") && ORT_WHEEL_URL.starts_with("https://files.pythonhosted.org/"));
    }

    #[test]
    fn every_voice_id_belongs_to_one_engine() {
        assert_eq!(kind_of("de_DE-kerstin-low"), Some(Kind::Piper));
        assert_eq!(kind_of("st-F1"), Some(Kind::Supertonic));
        assert_eq!(kind_of("az-de-DE-KatjaNeural"), Some(Kind::Azure));
        assert_eq!(kind_of("nope"), None);
        let mut ids: Vec<&str> = VOICES.iter().map(|v| v.id).chain(ST_VOICES.iter().map(|v| v.id)).chain(crate::tts_cloud::AZURE_VOICES.iter().map(|v| v.id)).collect();
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n, "voice ids are unique");
        // every Supertonic voice has its style file in the pinned download
        for v in ST_VOICES {
            assert!(ST_FILES.iter().any(|(p, _)| *p == format!("voice_styles/{}.json", v.style)), "{}", v.id);
            assert!(crate::supertonic::STYLES.contains(&v.style));
        }
    }

    #[test]
    fn only_the_two_runtime_dlls_come_out_of_the_wheel() {
        assert_eq!(ort_target("onnxruntime/capi/onnxruntime.dll"), Some("onnxruntime.dll"));
        assert_eq!(ort_target("onnxruntime/capi/onnxruntime_providers_shared.dll"), Some("onnxruntime_providers_shared.dll"));
        assert_eq!(ort_target("onnxruntime/capi/onnxruntime_pybind11_state.pyd"), None);
        assert_eq!(ort_target("../onnxruntime.dll"), None);
    }

    /// Real Supertonic synthesis. Needs the download in `<AI_COCKPIT_HOME>/tts/`:
    /// `AI_COCKPIT_HOME=<dir> cargo test live_supertonic -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_supertonic_synthesis() {
        let t = Tts::default();
        let t0 = std::time::Instant::now();
        t.warmup("st-M4", 1.0).unwrap();
        let cold = t0.elapsed();
        let t1 = std::time::Instant::now();
        let a = t.synthesize("st-M4", "Hallo Rob, ich habe das Dashboard fertig.", 1.05, None, Some("de")).unwrap();
        println!("load {cold:?} first sentence {:?}", t1.elapsed());
        assert_eq!(&a[0..4], b"RIFF");
        assert!(a.len() > 44_100);
        t.shutdown();
    }

    /// Real synthesis. Needs an installed engine + voice:
    /// `AI_COCKPIT_HOME=<dir with tts/> cargo test live_tts -- --ignored`
    #[test]
    #[ignore]
    fn live_tts_synthesis() {
        let t = Tts::default();
        let t0 = std::time::Instant::now();
        let a = t.synthesize("de_DE-thorsten-medium", "Agent zwei ist fertig. Alle Tests sind grün.", 1.0, None, None).unwrap();
        let cold = t0.elapsed();
        let t1 = std::time::Instant::now();
        let b = t.synthesize("de_DE-thorsten-medium", "Gesendet.", 1.0, None, None).unwrap();
        println!("cold {cold:?} warm {:?}", t1.elapsed());
        assert_eq!(&a[0..4], b"RIFF");
        assert!(a.len() > b.len());
        t.shutdown();
    }
}
