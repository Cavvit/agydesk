use crate::config::{provider_spec, FALLBACK_THRESHOLD};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

static LIGHT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)özet|ses|kayıt|ocr|el yaz|çevir|biçimlendir|formatla|temizle|deşifre|whisper").unwrap()
});
static MATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)ispat|türev|integral|matematik|denklem|limit|olasılık|fourier|laplace").unwrap()
});
static ARGON_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)argon|simülasyon|kontrol sistemi|bode|transfer fonksiyonu|elektromanyetik").unwrap()
});
static HARD_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)mimari|tasarım kararı|zor hata|kritik|derin").unwrap()
});
static CODE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bkod\b|pcb|refactor|patch|fonksiyon|script|spice|backend|\bapi\b|python|javascript").unwrap()
});

pub const CLOUD_CHAIN: &[&str] = &[
    "gemini-hydrogen",
    "gemini-argon",
    "claude-sonnet",
    "claude-opus",
];

const LOCAL_SKILLS: &[&str] = &[
    "ozet", "whisper", "graphify", "verify-and-stop", "caveman-commit", "caveman-review", "spice",
];
const OPUS_SKILLS: &[&str] = &["llm-council", "boost"];
const SONNET_SKILLS: &[&str] = &[
    "surgical-patch", "safe-refactor", "lean-build", "investigate-first", "pcb",
    "teardown", "taste", "replica-skill", "plan", "goal",
];

#[derive(Clone, Debug, Serialize)]
pub struct Decision {
    pub provider: String,
    pub label: String,
    pub reason: String,
    pub fallback: bool,
}

fn pick(text: &str, skill: Option<&str>) -> (&'static str, String) {
    if let Some(s) = skill {
        if LOCAL_SKILLS.contains(&s) {
            return ("local", format!("skill '{}' yerelde çalışır", s));
        }
        if OPUS_SKILLS.contains(&s) {
            return ("claude-opus", format!("skill '{}' ağır akıl yürütme", s));
        }
        if SONNET_SKILLS.contains(&s) {
            return ("claude-sonnet", format!("skill '{}' kodlama/planlama", s));
        }
    }
    if LIGHT_RE.is_match(text) {
        return ("local", "basit görev → yerel (kota harcanmaz)".to_string());
    }
    if MATH_RE.is_match(text) || HARD_RE.is_match(text) {
        return ("claude-opus", "zor matematik/mimari → Opus".to_string());
    }
    if ARGON_RE.is_match(text) {
        return ("gemini-argon", "mühendislik analizi → Argon".to_string());
    }
    if CODE_RE.is_match(text) {
        return ("claude-sonnet", "kodlama → Sonnet".to_string());
    }
    ("gemini-hydrogen", "genel sohbet → ana model".to_string())
}

pub fn route<F>(text: &str, skill: Option<&str>, has_images: bool, pct_of: F) -> Decision
where
    F: Fn(&str) -> u32,
{
    let (mut prov, mut reason) = pick(text, skill);
    if has_images && prov == "local" {
        prov = "gemini-hydrogen";
        reason = "görsel analizi → multimodal bulut modeli".to_string();
    }
    let spec = provider_spec(prov);
    let pct = if spec.cloud { pct_of(prov) } else { 0 };
    let threshold = *FALLBACK_THRESHOLD;

    if spec.cloud && pct >= threshold {
        for &alt in CLOUD_CHAIN {
            if alt != prov && pct_of(alt) < threshold {
                let alt_spec = provider_spec(alt);
                return Decision {
                    provider: alt.to_string(),
                    label: alt_spec.label.to_string(),
                    reason: format!("{} kotası dolu → {}", spec.label, alt_spec.label),
                    fallback: true,
                };
            }
        }
        let loc_spec = provider_spec("local");
        return Decision {
            provider: "local".to_string(),
            label: loc_spec.label.to_string(),
            reason: format!("{} kotası %{} ≥ %{} → yerele düşürüldü", spec.label, pct, threshold),
            fallback: true,
        };
    }

    Decision {
        provider: prov.to_string(),
        label: spec.label.to_string(),
        reason,
        fallback: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_local_pick_when_images_present() {
        let d = route("bu görseli özetle", None, true, |_| 0);
        assert_eq!(d.provider, "gemini-hydrogen");
        assert!(!d.fallback);
    }

    #[test]
    fn keeps_local_when_no_images() {
        let d = route("dersi özetle", None, false, |_| 0);
        assert_eq!(d.provider, "local");
    }
}
