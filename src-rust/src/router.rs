use crate::config::{is_restricted_session, provider_spec, FALLBACK_THRESHOLD};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

static LIGHT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)özet|ses|kayıt|ocr|el yaz|çevir|biçimlendir|formatla|temizle|deşifre|whisper").unwrap()
});
static NEON_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bneon\b").unwrap()
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
    "gemini-neon",
    "gemini-argon",
    "claude-sonnet",
    "claude-opus",
];

pub const CLOUD_CHAIN_RESTRICTED: &[&str] = &[
    "gemini-hydrogen",
    "gemini-neon",
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

fn pick(text: &str, skill: Option<&str>, restricted: bool) -> (&'static str, String) {
    if let Some(s) = skill {
        if LOCAL_SKILLS.contains(&s) {
            return ("local", format!("skill '{}' yerelde çalışır", s));
        }
        if OPUS_SKILLS.contains(&s) {
            if restricted {
                return ("gemini-neon", format!("skill '{}' → Gemini 4 Neon (AgyNote/AgyStudy)", s));
            }
            return ("claude-opus", format!("skill '{}' ağır akıl yürütme", s));
        }
        if SONNET_SKILLS.contains(&s) {
            if restricted {
                return ("gemini-neon", format!("skill '{}' → Gemini 4 Neon (AgyNote/AgyStudy)", s));
            }
            return ("claude-sonnet", format!("skill '{}' kodlama/planlama", s));
        }
    }
    if NEON_RE.is_match(text) {
        return ("gemini-neon", "Gemini 4 Neon seçildi".to_string());
    }
    if LIGHT_RE.is_match(text) {
        return ("local", "basit görev → yerel (kota harcanmaz)".to_string());
    }
    if restricted {
        // AgyNote & AgyStudy: NEVER burn Claude Opus/Sonnet or Argon quota; use Neon for heavy study/math and Hydrogen for general chat.
        if MATH_RE.is_match(text) || HARD_RE.is_match(text) || ARGON_RE.is_match(text) || CODE_RE.is_match(text) {
            return ("gemini-neon", "derin çalışma/matematik → Gemini 4 Neon".to_string());
        }
        return ("gemini-hydrogen", "genel sohbet → Gemini 4 Hydrogen".to_string());
    }
    if HARD_RE.is_match(text) {
        return ("claude-opus", "mimari/kritik analiz → Opus".to_string());
    }
    if MATH_RE.is_match(text) {
        return ("gemini-neon", "matematik analizi → Gemini 4 Neon".to_string());
    }
    if ARGON_RE.is_match(text) {
        return ("gemini-argon", "mühendislik analizi → Argon".to_string());
    }
    if CODE_RE.is_match(text) {
        return ("claude-sonnet", "kodlama → Sonnet".to_string());
    }
    ("gemini-hydrogen", "genel sohbet → ana model".to_string())
}

pub fn route_for_session<F>(
    session: &str,
    text: &str,
    skill: Option<&str>,
    has_images: bool,
    pct_of: F,
) -> Decision
where
    F: Fn(&str) -> u32,
{
    let restricted = is_restricted_session(session);
    let (mut prov, mut reason) = pick(text, skill, restricted);
    if has_images && prov == "local" {
        prov = "gemini-hydrogen";
        reason = "görsel analizi → multimodal bulut modeli".to_string();
    }
    let spec = provider_spec(prov);
    let pct = if spec.cloud { pct_of(prov) } else { 0 };
    let threshold = *FALLBACK_THRESHOLD;
    let chain = if restricted { CLOUD_CHAIN_RESTRICTED } else { CLOUD_CHAIN };

    if spec.cloud && pct >= threshold {
        for &alt in chain {
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

#[allow(dead_code)]
pub fn route<F>(text: &str, skill: Option<&str>, has_images: bool, pct_of: F) -> Decision
where
    F: Fn(&str) -> u32,
{
    route_for_session("ai1", text, skill, has_images, pct_of)
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

    #[test]
    fn restricted_sessions_never_use_opus_sonnet_or_argon() {
        for sess in ["side_ai", "src_ai", "src_ai__isg"] {
            for prompt in [
                "bu diferansiyel denklemi çöz ve ispatla",
                "kritik mimari tasarım kararı derin incele",
                "bode transfer fonksiyonu elektromanyetik",
                "python kod script fonksiyon yaz",
            ] {
                let d = route_for_session(sess, prompt, None, false, |_| 0);
                assert_eq!(d.provider, "gemini-neon", "sess={sess} prompt={prompt}");
            }
            // Even when Gemini quota is 100%, restricted sessions fall back to local, never Claude/Argon
            let fb = route_for_session(sess, "denklem çöz", None, false, |p| {
                if p.starts_with("gemini-") { 100 } else { 0 }
            });
            assert_eq!(fb.provider, "local");
        }
    }
}
