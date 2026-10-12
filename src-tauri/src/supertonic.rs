//! Supertonic 3 (Supertone, model under the BigScience OpenRAIL-M license, sample code MIT):
//! a small flow-matching TTS that reads German far more naturally than Piper, run through
//! ONNX Runtime on the CPU. No phonemizer: the text goes in as Unicode characters.
//!
//! Pipeline per sentence (ported from the official Rust example): text → duration predictor →
//! text encoder → a few denoising steps of the vector estimator on random latent noise → vocoder
//! → 44.1 kHz mono. Everything here is pure engine code; downloading and the pool live in tts.rs.

use std::path::Path;

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;

/// The ten built-in voice styles: five male, five female.
pub const STYLES: &[&str] = &["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"];

/// Denoising steps: 8 is the reference quality; 5 is hard to tell apart and ~40 % quicker.
pub const DEFAULT_STEPS: usize = 5;

#[derive(Deserialize)]
struct Cfg {
    ae: AeCfg,
    ttl: TtlCfg,
}
#[derive(Deserialize)]
struct AeCfg {
    sample_rate: i32,
    base_chunk_size: i32,
}
#[derive(Deserialize)]
struct TtlCfg {
    chunk_compress_factor: i32,
    latent_dim: i32,
}

#[derive(Deserialize)]
struct StyleFile {
    style_ttl: StylePart,
    style_dp: StylePart,
}
#[derive(Deserialize)]
struct StylePart {
    data: Vec<Vec<Vec<f32>>>,
    dims: Vec<usize>,
}

/// One voice: the two style embeddings (shape [1, a, b]).
pub struct Style {
    ttl: ([usize; 3], Vec<f32>),
    dp: ([usize; 3], Vec<f32>),
}

fn part(p: StylePart) -> Result<([usize; 3], Vec<f32>), String> {
    let flat: Vec<f32> = p.data.into_iter().flatten().flatten().collect();
    let dims = match p.dims.as_slice() {
        [a, b, c] => [*a, *b, *c],
        _ => return Err("voice style: unexpected shape".into()),
    };
    if dims.iter().product::<usize>() != flat.len() {
        return Err("voice style: size does not match its shape".into());
    }
    Ok((dims, flat))
}

impl Style {
    pub fn load(path: &Path) -> Result<Style, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("voice style: {e}"))?;
        let f: StyleFile = serde_json::from_str(&text).map_err(|e| format!("voice style: {e}"))?;
        Ok(Style { ttl: part(f.style_ttl)?, dp: part(f.style_dp)? })
    }
}

pub struct Model {
    dp: Session,
    enc: Session,
    est: Session,
    voc: Session,
    indexer: Vec<i64>,
    pub sample_rate: i32,
    chunk: usize,
    latent_dim: usize,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The ONNX Runtime library is loaded once per process, from the cockpit's own copy.
static ORT_INIT: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
pub fn init_runtime(dll: &Path) -> Result<(), String> {
    ORT_INIT
        .get_or_init(|| {
            if !dll.is_file() {
                return Err("ONNX Runtime is missing".into());
            }
            ort::init_from(dll).map_err(|e| format!("Could not load ONNX Runtime: {e}"))?.with_name("cockpit-tts").commit();
            Ok(())
        })
        .clone()
}

/// CPU threads for one synthesis: half the cores (the app and the agents keep the rest), 2…6.
fn threads() -> usize {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    (n / 2).clamp(2, 6)
}

fn session(path: &Path) -> Result<Session, String> {
    Session::builder()
        .map_err(err)?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(err)?
        .with_intra_threads(threads())
        .map_err(err)?
        .commit_from_file(path)
        .map_err(|e| format!("{}: {e}", path.display()))
}

impl Model {
    /// `dir` holds onnx/*.onnx, onnx/tts.json and onnx/unicode_indexer.json.
    pub fn load(dir: &Path) -> Result<Model, String> {
        let onnx = dir.join("onnx");
        let cfg: Cfg = serde_json::from_str(&std::fs::read_to_string(onnx.join("tts.json")).map_err(err)?).map_err(err)?;
        let indexer: Vec<i64> = serde_json::from_str(&std::fs::read_to_string(onnx.join("unicode_indexer.json")).map_err(err)?).map_err(err)?;
        Ok(Model {
            dp: session(&onnx.join("duration_predictor.onnx"))?,
            enc: session(&onnx.join("text_encoder.onnx"))?,
            est: session(&onnx.join("vector_estimator.onnx"))?,
            voc: session(&onnx.join("vocoder.onnx"))?,
            indexer,
            sample_rate: cfg.ae.sample_rate,
            chunk: (cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor).max(1) as usize,
            latent_dim: (cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor).max(1) as usize,
        })
    }

    /// Text ids for the model ("-1" for characters it has never seen).
    fn ids(&self, text: &str) -> Vec<i64> {
        text.chars().map(|c| self.indexer.get(c as usize).copied().unwrap_or(-1)).collect()
    }

    /// One sentence (or a few) → samples in -1…1. `speed` 1.0 = normal, bigger = quicker.
    pub fn synthesize(&mut self, text: &str, lang: &str, style: &Style, steps: usize, speed: f32, seed: u64) -> Result<Vec<f32>, String> {
        let prepared = preprocess(text, lang);
        let ids = self.ids(&prepared);
        let n = ids.len();
        if n == 0 {
            return Err("Nothing to say".into());
        }
        let text_ids = Tensor::from_array(([1usize, n], ids)).map_err(err)?;
        let text_mask = Tensor::from_array(([1usize, 1, n], vec![1.0f32; n])).map_err(err)?;
        let style_dp = Tensor::from_array((style.dp.0, style.dp.1.clone())).map_err(err)?;
        let style_ttl = Tensor::from_array((style.ttl.0, style.ttl.1.clone())).map_err(err)?;

        let duration = {
            let out = self
                .dp
                .run(ort::inputs! { "text_ids" => &text_ids, "style_dp" => &style_dp, "text_mask" => &text_mask })
                .map_err(err)?;
            let (_, d) = out["duration"].try_extract_tensor::<f32>().map_err(err)?;
            d.first().copied().unwrap_or(0.0) / speed.clamp(0.5, 2.0)
        };
        if !(duration.is_finite() && duration > 0.0) {
            return Err("The voice could not time this sentence".into());
        }
        let (emb_shape, emb) = {
            let out = self
                .enc
                .run(ort::inputs! { "text_ids" => &text_ids, "style_ttl" => &style_ttl, "text_mask" => &text_mask })
                .map_err(err)?;
            let (s, d) = out["text_emb"].try_extract_tensor::<f32>().map_err(err)?;
            let shape: Vec<usize> = s.iter().map(|&x| x as usize).collect();
            (shape, d.to_vec())
        };
        let text_emb = Tensor::from_array((emb_shape, emb)).map_err(err)?;

        let wav_len = (duration * self.sample_rate as f32) as usize;
        let latent_len = wav_len.div_ceil(self.chunk).max(1);
        let mut xt = noise(self.latent_dim * latent_len, seed);
        let latent_mask = Tensor::from_array(([1usize, 1, latent_len], vec![1.0f32; latent_len])).map_err(err)?;
        let total = Tensor::from_array(([1usize], vec![steps as f32])).map_err(err)?;
        for step in 0..steps {
            let cur = Tensor::from_array(([1usize], vec![step as f32])).map_err(err)?;
            let noisy = Tensor::from_array(([1usize, self.latent_dim, latent_len], xt)).map_err(err)?;
            let out = self
                .est
                .run(ort::inputs! {
                    "noisy_latent" => &noisy,
                    "text_emb" => &text_emb,
                    "style_ttl" => &style_ttl,
                    "latent_mask" => &latent_mask,
                    "text_mask" => &text_mask,
                    "current_step" => &cur,
                    "total_step" => &total
                })
                .map_err(err)?;
            let (_, d) = out["denoised_latent"].try_extract_tensor::<f32>().map_err(err)?;
            xt = d.to_vec();
        }
        let latent = Tensor::from_array(([1usize, self.latent_dim, latent_len], xt)).map_err(err)?;
        let out = self.voc.run(ort::inputs! { "latent" => &latent }).map_err(err)?;
        let (_, wav) = out["wav_tts"].try_extract_tensor::<f32>().map_err(err)?;
        Ok(wav[..wav_len.min(wav.len())].to_vec())
    }
}

/// Gaussian noise (Box–Muller over SplitMix64): the start of the denoising.
pub fn noise(n: usize, seed: u64) -> Vec<f32> {
    let mut s = seed ^ 0x9E37_79B9_7F4A_7C15;
    let mut next = || {
        s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = s;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        ((z >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    };
    let mut out = Vec::with_capacity(n + 1);
    while out.len() < n {
        let (u1, u2) = (next(), next());
        let r = (-2.0 * u1.ln()).sqrt();
        let t = std::f64::consts::TAU * u2;
        out.push((r * t.cos()) as f32);
        out.push((r * t.sin()) as f32);
    }
    out.truncate(n);
    out
}

/// The text as the model was trained on it (the official normaliser): decomposed Unicode, no
/// emoji, plain dashes and quotes, a final punctuation mark, wrapped in language tags.
pub fn preprocess(text: &str, lang: &str) -> String {
    let mut t: String = text
        .nfkd()
        .filter(|c| !matches!(*c as u32, 0x1F300..=0x1FAFF | 0x2600..=0x27BF | 0x1F1E6..=0x1F1FF))
        .map(|c| match c {
            '–' | '‑' | '—' => '-',
            '_' | '[' | ']' | '|' | '/' | '#' | '→' | '←' | '*' | '~' | '<' | '>' => ' ',
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '«' | '»' => '"',
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '´' | '`' => '\'',
            c if c.is_control() => ' ',
            c => c,
        })
        .filter(|c| !matches!(c, '♥' | '☆' | '♡' | '©' | '\\'))
        .collect();
    t = t.replace('@', " at ");
    for p in [",", ".", "!", "?", ";", ":", "'"] {
        t = t.replace(&format!(" {p}"), p);
    }
    while t.contains("\"\"") {
        t = t.replace("\"\"", "\"");
    }
    let mut t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some(last) = t.chars().last() {
        if !".!?;:,'\")]}…".contains(last) {
            t.push('.');
        }
    }
    let lang = if crate_langs().contains(&lang) { lang } else { "na" };
    format!("<{lang}>{t}</{lang}>")
}

fn crate_langs() -> &'static [&'static str] {
    &["en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi", "na"]
}

/// Samples → a 16-bit mono WAV file in memory.
pub fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_prepared_like_the_reference() {
        assert_eq!(preprocess("Hallo  Rob", "de"), "<de>Hallo Rob.</de>");
        assert_eq!(preprocess("Fertig – „super“ ✅!", "de"), "<de>Fertig - \"super\"!</de>");
        assert_eq!(preprocess("Done ,ok", "xx"), "<na>Done,ok.</na>");
        // umlauts are decomposed (a + combining diaeresis), as the model's indexer expects
        assert_eq!(preprocess("ä", "de").chars().count(), "<de>a\u{308}.</de>".chars().count());
    }

    #[test]
    fn noise_is_gaussian_and_repeatable() {
        let a = noise(10_001, 7);
        assert_eq!(a.len(), 10_001);
        assert_eq!(a, noise(10_001, 7));
        let mean = a.iter().sum::<f32>() / a.len() as f32;
        let var = a.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / a.len() as f32;
        assert!(mean.abs() < 0.05 && (var - 1.0).abs() < 0.08, "{mean} {var}");
    }

    #[test]
    fn wav_header_is_valid() {
        let w = wav(&[0.0, 1.0, -1.0], 44_100);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(w.len(), 44 + 6);
        assert_eq!(u32::from_le_bytes([w[24], w[25], w[26], w[27]]), 44_100);
        assert_eq!(i16::from_le_bytes([w[46], w[47]]), 32767);
    }
}
