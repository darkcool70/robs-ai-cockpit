//! Wake word: say the operator's name ("Atlas, …") and it listens — no key, fully local.
//!
//! A light energy detector watches the microphone. Only when somebody actually speaks is the
//! start of the utterance (≤ 2 s) given to the local Whisper server; if it begins with the wake
//! word, the rest of that same breath is recorded until a pause and sent as the command.
//! Nothing is stored; audio never leaves the machine. Paused while the cockpit records or speaks.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, StreamTrait};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::stt::{rms, Config, Stt};

/// How Whisper tends to write a spoken name, plus greetings in front of it.
/// Up to two of them: "Okay, hey Jana", "So, Jana", "Ähm, Jana".
static LEAD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^\W*(?:(?:hey|hi|hallo|hello|ok|okay|oke|yo|na|so|also|ähm|äh|ehm|hm|und|du|ach|ja|moin|servus|guten morgen|guten tag|guten abend|sag mal|hör mal|pass auf)\W+){0,2}").unwrap());

/// A name as it sounds, so that spellings of the same sound are equal: "Yana", "Janna", "Jahna",
/// "Iana" → "jana"; "Adlas", "Attlas" → "atlas". Whisper writes a short name differently from one
/// time to the next; the sound is what the user said.
pub fn sound(word: &str) -> String {
    let w: String = word.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
    let w = w.replace("ph", "f").replace("th", "t").replace("ck", "k").replace("sch", "s").replace("ie", "i");
    let chars: Vec<char> = w.chars().collect();
    let vowel = |c: char| "aeiouäöü".contains(c);
    let mut out = String::new();
    for (i, &c) in chars.iter().enumerate() {
        let next = chars.get(i + 1).copied();
        let c = match c {
            'y' => 'j',
            // "Iana", "Ianna": an i in front of a vowel at the start is a j
            'i' if i == 0 && next.is_some_and(vowel) => 'j',
            'c' | 'g' | 'q' => 'k',
            'z' | 'ß' => 's',
            'w' | 'v' => 'f',
            'd' => 't',
            'b' => 'p',
            // a silent h ("Jahna", "Hannah" keeps its first)
            'h' if i > 0 => continue,
            c => c,
        };
        if out.chars().last() != Some(c) {
            out.push(c);
        }
    }
    out
}

/// The same name by its sound: equal, or equal up to the last vowel ("Jana" / "Jane" / "Janna").
fn sounds_like(heard: &str, word: &str) -> bool {
    let (a, b) = (sound(heard), sound(word));
    if a.chars().count() < 3 || b.chars().count() < 3 {
        return false;
    }
    if a == b {
        return true;
    }
    let stem = |s: &str| -> String {
        let t = s.trim_end_matches(|c: char| "aeo".contains(c));
        if t.chars().count() >= 3 { t.to_string() } else { s.to_string() }
    };
    let (la, lb) = (a.chars().count() as i32, b.chars().count() as i32);
    (la - lb).abs() <= 1 && la >= 4 && lb >= 4 && stem(&a) == stem(&b)
}

fn variants(word: &str) -> Vec<String> {
    let w = word.trim().to_lowercase();
    let mut v = vec![w.clone()];
    if w == "atlas" {
        v.extend(["at las", "atlass", "adlas", "attlas", "atlantis"].map(String::from));
    }
    if w == "jarvis" {
        v.extend(["javis", "jarwis", "jervis", "jarvice"].map(String::from));
    }
    v
}

/// If `text` starts with one of the wake words: what follows it (may be empty).
pub fn wake_match(text: &str, words: &[String]) -> Option<String> {
    let rest = LEAD.replace(text, "").to_string();
    let lower = rest.to_lowercase();
    let mut best: Option<usize> = None;
    for w in words.iter().filter(|w| w.trim().chars().count() >= 3) {
        for v in variants(w) {
            if lower.starts_with(&v) {
                // the word must end there ("Atlas," "Atlas." "Atlas bitte"), not "Atlasgebirge"
                let after = lower[v.len()..].chars().next();
                if after.map_or(true, |c| !c.is_alphanumeric()) {
                    best = Some(best.map_or(v.len(), |b: usize| b.max(v.len())));
                }
            }
        }
    }
    // not letter for letter: the first word by its sound ("Yana, mach …" for "Jana")
    if best.is_none() {
        let first: String = rest.chars().take_while(|c| c.is_alphanumeric()).collect();
        if words.iter().filter(|w| w.trim().chars().count() >= 3).any(|w| sounds_like(&first, w.trim())) {
            best = Some(first.len());
        }
    }
    let n = best?;
    let tail = rest.get(n..).unwrap_or("").trim_start_matches(|c: char| !c.is_alphanumeric()).trim().to_string();
    Some(tail)
}

/// Energy-based voice activity on 20 ms frames, with a slowly adapting room level.
pub struct Vad {
    floor: f32,
    voiced: u32,
    quiet: u32,
}

impl Default for Vad {
    fn default() -> Self {
        Self { floor: 0.006, voiced: 0, quiet: 0 }
    }
}

impl Vad {
    /// Feed one frame's RMS; true while speech is going on (with 3 frames to start).
    pub fn push(&mut self, level: f32) -> bool {
        let speech = level > (self.floor * 3.5).max(0.009);
        if speech {
            self.voiced += 1;
            self.quiet = 0;
        } else {
            self.quiet += 1;
            if self.quiet > 10 {
                self.voiced = 0;
            }
            // the room level follows the quiet frames only
            self.floor = self.floor * 0.98 + level.min(self.floor * 2.0) * 0.02;
        }
        self.voiced >= 3
    }
    pub fn quiet_ms(&self) -> u32 {
        self.quiet * 20
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum WakeEvent {
    /// The wake word was recognised; the rest of the sentence is still being recorded.
    Heard,
    /// The sentence after the wake word (empty: just the name).
    Command(String),
}

/// The listening state machine, fed with microphone samples (testable without a microphone).
pub struct Detector {
    rate: u32,
    frame: usize,
    vad: Vad,
    /// the last second, for the beginning of an utterance
    history: Vec<f32>,
    utterance: Option<Vec<f32>>,
    checked: bool,
    awake: bool,
    /// an utterance that was not for us: wait for its pause before listening again
    ignoring: bool,
    /// what the start of the utterance said (the wake check) — reused when nothing came after it
    head: String,
    /// somebody kept speaking after the wake check
    more: bool,
}

impl Detector {
    pub fn new(rate: u32) -> Self {
        Self { rate, frame: (rate as usize / 50).max(1), vad: Vad::default(), history: Vec::new(), utterance: None, checked: false, awake: false, ignoring: false, head: String::new(), more: false }
    }

    fn samples(&self, ms: usize) -> usize {
        self.rate as usize * ms / 1000
    }

    pub fn reset(&mut self) {
        self.history.clear();
        self.utterance = None;
        self.checked = false;
        self.awake = false;
        self.ignoring = false;
        self.head.clear();
        self.more = false;
    }

    /// Feed new samples; `recognise` turns audio into text (Whisper). Returns what happened.
    pub fn feed(&mut self, fresh: &[f32], words: &[String], recognise: &mut dyn FnMut(&[f32], u32) -> String) -> Vec<WakeEvent> {
        let mut out = Vec::new();
        let frame = self.frame;
        for chunk in fresh.chunks(frame) {
            let speaking = self.vad.push(rms(chunk));
            self.history.extend_from_slice(chunk);
            let keep = self.samples(1000);
            if self.history.len() > keep {
                let drop = self.history.len() - keep;
                self.history.drain(..drop);
            }
            if self.ignoring {
                if self.vad.quiet_ms() >= END_SILENCE_MS {
                    self.ignoring = false;
                }
                continue;
            }
            match self.utterance.as_mut() {
                None if speaking => {
                    let pre = self.samples(PREROLL_MS + 60).min(self.history.len());
                    self.utterance = Some(self.history[self.history.len() - pre..].to_vec());
                    self.checked = false;
                    self.awake = false;
                }
                Some(u) => u.extend_from_slice(chunk),
                None => {}
            }
            let len_ms = match self.utterance.as_ref() {
                Some(u) => u.len() * 1000 / self.rate as usize,
                None => continue,
            };
            let quiet = self.vad.quiet_ms();
            let ended = quiet >= END_SILENCE_MS;
            // 1. does it start with the wake word? (once, on the first ~2 s — or at the first
            //    short pause: a name alone is over after half a second)
            if !self.checked && (len_ms >= CHECK_MS || quiet >= CHECK_QUIET_MS) {
                self.checked = true;
                let n = self.samples(CHECK_MS);
                let head = self.utterance.as_ref().map(|u| u[..n.min(u.len())].to_vec()).unwrap_or_default();
                self.head = recognise(&head, self.rate);
                self.more = len_ms > CHECK_MS;
                self.awake = wake_match(&self.head, words).is_some();
                if self.awake {
                    out.push(WakeEvent::Heard);
                } else {
                    // not for us: forget it and wait until that talking pauses
                    self.utterance = None;
                    self.ignoring = !ended;
                    continue;
                }
            }
            if self.awake && speaking && quiet == 0 {
                self.more = true;
            }
            // 2. awake: keep recording the same breath until a pause, then it is the command.
            //    Just the name and nothing after it: answer at once, no second listening pass.
            let name_only = self.awake && !self.more && quiet >= NAME_ONLY_MS && wake_match(&self.head, words).is_some_and(|t| t.is_empty());
            if self.awake && (ended || name_only || len_ms >= MAX_COMMAND_MS) {
                let audio = self.utterance.take().unwrap_or_default();
                // nothing was said after the check: what was heard then is the whole sentence
                let text = if self.more { recognise(&audio, self.rate) } else { std::mem::take(&mut self.head) };
                out.push(WakeEvent::Command(wake_match(&text, words).unwrap_or(text)));
                self.checked = false;
                self.awake = false;
                self.more = false;
            }
        }
        out
    }
}

#[derive(Default)]
pub struct Wake {
    stop: Mutex<Option<Sender<()>>>,
    /// The cockpit is recording or speaking: ignore the microphone.
    busy: Arc<AtomicBool>,
}

pub struct WakeConfig {
    pub words: Vec<String>,
    pub stt: Config,
}

const PREROLL_MS: usize = 350;
const CHECK_MS: usize = 2000;
/// A short pause is enough to check for the name (it need not wait for the end of the sentence).
const CHECK_QUIET_MS: u32 = 460;
/// Only the name was said and nothing follows: answer after this pause.
const NAME_ONLY_MS: u32 = 620;
const END_SILENCE_MS: u32 = 900;
const MAX_COMMAND_MS: usize = 20_000;

impl Wake {
    pub fn running(&self) -> bool {
        self.stop.lock().is_some()
    }

    pub fn set_busy(&self, busy: bool) {
        self.busy.store(busy, Ordering::SeqCst);
    }

    pub fn stop(&self) {
        if let Some(tx) = self.stop.lock().take() {
            let _ = tx.send(());
        }
    }

    pub fn start(&self, app: AppHandle, stt: Arc<Stt>, cfg: WakeConfig) -> Result<(), String> {
        self.stop();
        if cfg.words.iter().all(|w| w.trim().chars().count() < 3) {
            return Err("No wake word (name of at least three letters)".into());
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let (ok_tx, ok_rx) = std::sync::mpsc::channel();
        let busy = self.busy.clone();
        std::thread::Builder::new()
            .name("wake-word".into())
            .spawn(move || listen(app, stt, cfg, rx, ok_tx, busy))
            .map_err(|e| e.to_string())?;
        match ok_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {
                *self.stop.lock() = Some(tx);
                Ok(())
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err("The microphone did not respond".into()),
        }
    }
}

fn listen(app: AppHandle, stt: Arc<Stt>, cfg: WakeConfig, stop: Receiver<()>, ok: Sender<Result<(), String>>, busy: Arc<AtomicBool>) {
    let open = || -> Result<(cpal::Stream, Arc<Mutex<Vec<f32>>>, u32), String> {
        let device = crate::stt::find_device(cfg.stt.device.as_deref())?;
        let supported = device.default_input_config().map_err(|e| format!("Microphone not usable: {e}"))?;
        let rate = supported.sample_rate();
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let buf = Arc::new(Mutex::new(Vec::with_capacity(rate as usize * 4)));
        let stream = match format {
            cpal::SampleFormat::F32 => crate::stt::build_stream::<f32>(&device, &config, buf.clone())?,
            cpal::SampleFormat::I16 => crate::stt::build_stream::<i16>(&device, &config, buf.clone())?,
            cpal::SampleFormat::U16 => crate::stt::build_stream::<u16>(&device, &config, buf.clone())?,
            cpal::SampleFormat::I32 => crate::stt::build_stream::<i32>(&device, &config, buf.clone())?,
            other => return Err(format!("Unsupported microphone sample format {other:?}")),
        };
        stream.play().map_err(|e| format!("Could not start the microphone: {e}"))?;
        Ok((stream, buf, rate))
    };
    let (stream, buf, rate) = match open() {
        Ok(x) => {
            let _ = ok.send(Ok(()));
            x
        }
        Err(e) => {
            let _ = ok.send(Err(e));
            return;
        }
    };
    let _ = app.emit("wake-state", json!({ "listening": true }));
    let mut det = Detector::new(rate);
    loop {
        match stop.recv_timeout(Duration::from_millis(60)) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let fresh = std::mem::take(&mut *buf.lock());
        if busy.load(Ordering::SeqCst) {
            det.reset();
            continue;
        }
        let mut recognise = |audio: &[f32], rate: u32| {
            let loud = audio.chunks((rate as usize / 50).max(1)).map(rms).fold(0f32, f32::max);
            stt.recognise(&cfg.stt, audio, rate, loud).map(|t| t.text).unwrap_or_else(|e| {
                eprintln!("wake word: {e}");
                String::new()
            })
        };
        for ev in det.feed(&fresh, &cfg.words, &mut recognise) {
            match ev {
                WakeEvent::Heard => {
                    let _ = app.emit("wake-heard", json!({}));
                }
                WakeEvent::Command(c) => {
                    let _ = app.emit("wake", json!({ "command": c }));
                }
            }
        }
    }
    drop(stream);
    let _ = app.emit("wake-state", json!({ "listening": false }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_wake_word_starts_the_sentence() {
        let words = w(&["Atlas"]);
        assert_eq!(wake_match("Atlas, starte zwei Agenten für den Login.", &words).as_deref(), Some("starte zwei Agenten für den Login."));
        assert_eq!(wake_match("Hey Atlas! Was machen die Agenten?", &words).as_deref(), Some("Was machen die Agenten?"));
        assert_eq!(wake_match("atlas.", &words).as_deref(), Some(""));
        assert_eq!(wake_match("At las, Status bitte", &words).as_deref(), Some("Status bitte"));
        assert_eq!(wake_match("Okay, Atlass. Weiter.", &words).as_deref(), Some("Weiter."));
    }

    #[test]
    fn the_name_counts_by_its_sound() {
        let jana = w(&["Jana"]);
        for heard in ["Jana, mach die Karte kleiner", "Yana, mach die Karte kleiner", "Janna mach die Karte kleiner", "Jahna, mach die Karte kleiner", "Hey Jana, mach die Karte kleiner", "Okay, hey Jana. Mach die Karte kleiner", "So, Jana, mach die Karte kleiner", "Ähm, Iana, mach die Karte kleiner", "Jane, mach die Karte kleiner"] {
            assert_eq!(wake_match(heard, &jana).as_deref().map(|t| t.to_lowercase()), Some("mach die karte kleiner".to_string()), "{heard}");
        }
        assert_eq!(wake_match("Yana?", &jana).as_deref(), Some(""));
        for other in ["Ja, na klar machen wir das", "Jaja, schon gut", "Januar wird kalt", "Hannah kommt später", "Diana hat angerufen", "Ich habe Jana gesagt", "Ja.", "Jan kommt gleich", "Jena ist schön"] {
            assert_eq!(wake_match(other, &jana), None, "{other}");
        }
        let atlas = w(&["Atlas"]);
        assert_eq!(wake_match("Adlass, zeig alles", &atlas).as_deref(), Some("zeig alles"));
        assert_eq!(wake_match("Atlasgebirge ist hoch", &atlas), None);
        assert_eq!((sound("Yana"), sound("Jahna"), sound("Janna")), ("jana".to_string(), "jana".to_string(), "jana".to_string()));
    }

    #[test]
    fn other_sentences_do_not_wake_it() {
        let words = w(&["Atlas"]);
        assert_eq!(wake_match("Ich habe den Atlas gestern gekauft.", &words), None);
        assert_eq!(wake_match("Atlasgebirge ist schön", &words), None);
        assert_eq!(wake_match("", &words), None);
        assert_eq!(wake_match("Atlas", &w(&["Al"])), None, "too short to be a wake word");
    }

    #[test]
    fn several_names_work() {
        let words = w(&["Atlas", "Jarvis"]);
        assert_eq!(wake_match("Jarwis, mach weiter", &words).as_deref(), Some("mach weiter"));
    }


    /// Synthetic speech: a tone burst of `ms` with a given level.
    fn tone(ms: usize, rate: u32, amp: f32) -> Vec<f32> {
        (0..rate as usize * ms / 1000).map(|i| (i as f32 * 0.07).sin() * amp).collect()
    }
    fn silence(ms: usize, rate: u32) -> Vec<f32> {
        vec![0.0005; rate as usize * ms / 1000]
    }

    #[test]
    fn detector_wakes_on_the_name_and_returns_the_rest_of_the_breath() {
        let rate = 16_000;
        let words = w(&["Atlas"]);
        let mut d = Detector::new(rate);
        let mut calls = 0;
        // first check: the head says the name; second: the whole sentence
        let mut rec = |a: &[f32], _r: u32| {
            calls += 1;
            if a.len() <= rate as usize * 2 + 100 { "Atlas, wie ist".to_string() } else { "Atlas, wie ist der Status?".to_string() }
        };
        let mut audio = silence(1500, rate);
        audio.extend(tone(3500, rate, 0.2));
        audio.extend(silence(1500, rate));
        let mut events = Vec::new();
        for c in audio.chunks(960) {
            events.extend(d.feed(c, &words, &mut rec));
        }
        assert_eq!(events, vec![WakeEvent::Heard, WakeEvent::Command("wie ist der Status?".into())]);
        assert_eq!(calls, 2);
    }

    #[test]
    fn detector_ignores_other_talk_until_it_pauses() {
        let rate = 16_000;
        let words = w(&["Atlas"]);
        let mut d = Detector::new(rate);
        let mut calls = 0;
        let mut rec = |_: &[f32], _: u32| {
            calls += 1;
            "Ich habe gestern den Film gesehen".to_string()
        };
        let mut audio = silence(1000, rate);
        audio.extend(tone(8000, rate, 0.2)); // a long sentence of someone else
        audio.extend(silence(1500, rate));
        let mut events = Vec::new();
        for c in audio.chunks(960) {
            events.extend(d.feed(c, &words, &mut rec));
        }
        assert!(events.is_empty());
        assert_eq!(calls, 1, "one check per utterance, not every 2 s while they talk");
    }

    /// Real speech from Piper through the real Whisper: needs an installed STT and TTS:
    /// `AI_COCKPIT_HOME=<dir with stt/ and tts/> cargo test live_wake -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_wake_word_from_real_speech() {
        let tts = crate::tts::Tts::default();
        let stt = Stt::default();
        let cfg = Config { model: std::env::var("STT_TEST_MODEL").unwrap_or("small".into()), language: "de".into(), vocabulary: "Atlas, Claude, Codex".into(), device: None };
        let say = |t: &str| {
            let wav = tts.synthesize("de_DE-thorsten-medium", t, 1.0, None, None).unwrap();
            let rate = u32::from_le_bytes(wav[24..28].try_into().unwrap());
            let pcm: Vec<f32> = wav[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
            (pcm, rate)
        };
        let (other, rate) = say("Ich habe mir gestern einen neuen Atlas gekauft, mit vielen Karten.");
        let (cmd, _) = say("Atlas, wie ist der Status der Agenten?");
        let pause = vec![0.0005f32; rate as usize * 3 / 2];
        let mut audio = pause.clone();
        audio.extend(&other);
        audio.extend(&pause);
        audio.extend(&cmd);
        audio.extend(&pause);
        let words = w(&["Atlas"]);
        let mut d = Detector::new(rate);
        let t0 = std::time::Instant::now();
        let mut rec = |a: &[f32], r: u32| stt.recognise(&cfg, a, r, 0.2).map(|t| t.text).unwrap_or_default();
        let mut events = Vec::new();
        for c in audio.chunks(rate as usize / 20) {
            events.extend(d.feed(c, &words, &mut rec));
        }
        println!("{events:?} in {:?}", t0.elapsed());
        stt.shutdown();
        tts.shutdown();
        assert_eq!(events.first(), Some(&WakeEvent::Heard));
        match events.last() {
            Some(WakeEvent::Command(c)) => assert!(c.to_lowercase().contains("status"), "{c}"),
            other => panic!("no command: {other:?}"),
        }
        assert_eq!(events.len(), 2, "the other sentence must not wake it");
    }

    #[test]
    fn vad_needs_a_few_loud_frames_and_adapts_to_the_room() {
        let mut v = Vad::default();
        for _ in 0..50 {
            assert!(!v.push(0.004), "room noise is no speech");
        }
        assert!(!v.push(0.05));
        assert!(!v.push(0.05));
        assert!(v.push(0.05), "three loud frames: speech");
        for _ in 0..50 {
            v.push(0.002);
        }
        assert!(v.quiet_ms() >= 900);
    }
}
