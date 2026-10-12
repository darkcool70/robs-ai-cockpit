//! Cloud voices — opt-in only: Microsoft Azure AI Speech (official API, the user's own key).
//!
//! * Nothing is sent before the user typed a key and chose a cloud voice; the Voice tab says that
//!   the spoken text then goes to Microsoft. Without a key, offline or on any error the cockpit
//!   speaks the sentence with a local voice instead (the frontend falls back to Piper).
//! * The key is stored DPAPI-encrypted (secret.rs) together with its region and never leaves the
//!   backend except in the request header to `<region>.tts.speech.microsoft.com`.
//! * The unofficial free "Edge Read Aloud" endpoint is deliberately NOT used: it is not licensed
//!   for third-party (let alone commercial) apps.

use std::io::Read;
use std::time::Duration;

use crate::secret;

pub struct CloudVoice {
    pub id: &'static str,
    /// The Azure voice name.
    pub name: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    /// Also speaks English (and other languages) natively.
    pub multilingual: bool,
    /// Speaking styles (`mstts:express-as`).
    pub styles: &'static [&'static str],
    /// HD voices take no prosody tags.
    pub hd: bool,
}

/// A small curated set of German Azure voices (de-DE, as listed in the Azure docs, 2026-10).
pub const AZURE_VOICES: &[CloudVoice] = &[
    CloudVoice { id: "az-de-DE-SeraphinaMultilingualNeural", name: "de-DE-SeraphinaMultilingualNeural", label: "Seraphina (Azure)", hint: "German · female · warm and very natural, also speaks English", multilingual: true, styles: &[], hd: false },
    CloudVoice { id: "az-de-DE-FlorianMultilingualNeural", name: "de-DE-FlorianMultilingualNeural", label: "Florian (Azure)", hint: "German · male · calm and very natural, also speaks English", multilingual: true, styles: &[], hd: false },
    CloudVoice { id: "az-de-DE-Seraphina:DragonHDLatestNeural", name: "de-DE-Seraphina:DragonHDLatestNeural", label: "Seraphina HD (Azure)", hint: "German · female · HD, the most lifelike (costs about twice as much)", multilingual: true, styles: &[], hd: true },
    CloudVoice { id: "az-de-DE-Florian:DragonHDLatestNeural", name: "de-DE-Florian:DragonHDLatestNeural", label: "Florian HD (Azure)", hint: "German · male · HD, the most lifelike (costs about twice as much)", multilingual: true, styles: &[], hd: true },
    CloudVoice { id: "az-de-DE-KatjaNeural", name: "de-DE-KatjaNeural", label: "Katja (Azure)", hint: "German · female · clear, news-reader style", multilingual: false, styles: &[], hd: false },
    CloudVoice { id: "az-de-DE-ConradNeural", name: "de-DE-ConradNeural", label: "Conrad (Azure)", hint: "German · male · friendly, with moods (cheerful)", multilingual: false, styles: &["cheerful", "sad"], hd: false },
];

pub fn voice(id: &str) -> Option<&'static CloudVoice> {
    AZURE_VOICES.iter().find(|v| v.id == id)
}

const SECRET: &str = "azure-speech";

/// What is stored: the region and the key.
pub struct AzureKey {
    pub region: String,
    key: String,
}

pub fn valid_region(r: &str) -> bool {
    (3..=32).contains(&r.len()) && r.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

pub fn valid_key(k: &str) -> bool {
    (16..=128).contains(&k.len()) && k.chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn load_key() -> Option<AzureKey> {
    let raw = secret::load(SECRET)?;
    let (region, key) = raw.split_once('\n')?;
    (valid_region(region) && valid_key(key)).then(|| AzureKey { region: region.into(), key: key.into() })
}

/// Region only (shown in the Voice tab), never the key.
pub fn region() -> Option<String> {
    load_key().map(|k| k.region)
}

pub fn key_set() -> bool {
    secret::exists(SECRET)
}

/// Check a key with a one-word request, then store it. Returns an error the user can act on.
pub fn set_key(region: &str, key: &str) -> Result<(), String> {
    let region = region.trim().to_ascii_lowercase().replace(' ', "");
    let key = key.trim();
    if !valid_region(&region) {
        return Err("Region looks wrong — e.g. germanywestcentral or westeurope (Azure portal → your Speech resource).".into());
    }
    if !valid_key(key) {
        return Err("The key looks wrong — copy KEY 1 of your Speech resource.".into());
    }
    let k = AzureKey { region: region.clone(), key: key.into() };
    synthesize(&k, AZURE_VOICES[0].name, "Test.", 1.0, None, "de", false, true)?;
    secret::save(SECRET, &format!("{region}\n{key}"))
}

pub fn clear_key() {
    secret::clear(SECRET);
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// The SSML for one sentence: voice, optional style, speed, and English inside a multilingual voice.
#[allow(clippy::too_many_arguments)]
pub fn ssml(voice: &str, text: &str, speed: f64, style: Option<&str>, lang: &str, multilingual: bool, hd: bool) -> String {
    let mut inner = esc(text);
    if multilingual && lang == "en" {
        inner = format!("<lang xml:lang=\"en-US\">{inner}</lang>");
    }
    let s = if speed.is_finite() { speed.clamp(0.5, 2.0) } else { 1.0 };
    if !hd && (s - 1.0).abs() >= 0.02 {
        inner = format!("<prosody rate=\"{:+.0}%\">{inner}</prosody>", (s - 1.0) * 100.0);
    }
    if let Some(st) = style.filter(|s| s.chars().all(|c| c.is_ascii_alphabetic()) && !s.is_empty()) {
        inner = format!("<mstts:express-as style=\"{st}\">{inner}</mstts:express-as>");
    }
    format!(
        "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xmlns:mstts=\"https://www.w3.org/2001/mstts\" xml:lang=\"de-DE\"><voice name=\"{}\">{inner}</voice></speak>",
        esc(voice)
    )
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .timeout_connect(Some(Duration::from_secs(4)))
        .http_status_as_error(false)
        .build()
        .new_agent()
}

/// Text → WAV (24 kHz mono). Errors are short and never contain the key.
#[allow(clippy::too_many_arguments)]
pub fn synthesize(k: &AzureKey, voice: &str, text: &str, speed: f64, style: Option<&str>, lang: &str, multilingual: bool, hd: bool) -> Result<Vec<u8>, String> {
    let url = format!("https://{}.tts.speech.microsoft.com/cognitiveservices/v1", k.region);
    let body = ssml(voice, text, speed, style, lang, multilingual, hd);
    let resp = agent()
        .post(&url)
        .header("Ocp-Apim-Subscription-Key", &k.key)
        .header("Content-Type", "application/ssml+xml")
        .header("X-Microsoft-OutputFormat", "riff-24khz-16bit-mono-pcm")
        .header("User-Agent", "RobsAICockpit")
        .send(body.as_bytes())
        .map_err(|e| format!("Azure is not reachable ({e})"))?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(match status {
            401 | 403 => "Azure rejected the key (wrong key or region)".into(),
            429 => "Azure quota or rate limit reached".into(),
            400 => "Azure did not accept this voice in your region".into(),
            s => format!("Azure answered HTTP {s}"),
        });
    }
    let mut wav = Vec::new();
    resp.into_body().into_with_config().limit(32 * 1024 * 1024).reader().read_to_end(&mut wav).map_err(|e| format!("Azure: {e}"))?;
    if wav.len() < 44 || &wav[0..4] != b"RIFF" {
        return Err("Azure sent no audio".into());
    }
    Ok(wav)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssml_is_escaped_and_carries_speed_style_and_language() {
        let s = ssml("de-DE-ConradNeural", "A & B <ok>", 1.1, Some("cheerful"), "de", false, false);
        assert!(s.contains("<voice name=\"de-DE-ConradNeural\">"));
        assert!(s.contains("<mstts:express-as style=\"cheerful\"><prosody rate=\"+10%\">A &amp; B &lt;ok&gt;</prosody></mstts:express-as>"), "{s}");
        let e = ssml("de-DE-SeraphinaMultilingualNeural", "Hello", 1.0, None, "en", true, false);
        assert!(e.contains("<lang xml:lang=\"en-US\">Hello</lang>") && !e.contains("prosody"));
        let hd = ssml("de-DE-Florian:DragonHDLatestNeural", "Hallo", 1.3, Some("x\"y"), "de", true, true);
        assert!(!hd.contains("prosody") && !hd.contains("express-as"), "HD: no prosody; odd style dropped");
    }

    #[test]
    fn keys_and_regions_are_checked() {
        assert!(valid_region("germanywestcentral") && valid_region("westeurope"));
        assert!(!valid_region("evil.com/x") && !valid_region("ab"));
        assert!(valid_key(&"a1".repeat(16)));
        assert!(!valid_key("short") && !valid_key(&format!("{}\nX", "a".repeat(20))));
        assert!(AZURE_VOICES.iter().all(|v| v.id == format!("az-{}", v.name)));
    }
}
