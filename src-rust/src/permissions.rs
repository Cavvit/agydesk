use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;

static RISKY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bsil|force|push|yazdır|gönder|drop|reset|rm -rf|delete").unwrap()
});

static WRITE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)yaz\b|oluştur|düzenle|kaydet|çalıştır|\bkod|pcb|refactor|patch|kur\b|ekle").unwrap()
});

const WRITE_SKILLS: &[&str] = &[
    "surgical-patch",
    "safe-refactor",
    "lean-build",
    "pcb",
    "replica-skill",
    "fisle",
];

pub fn classify(text: &str, skill: Option<&str>) -> &'static str {
    if RISKY_RE.is_match(text) {
        return "risky";
    }
    if let Some(s) = skill {
        if WRITE_SKILLS.contains(&s) {
            return "write";
        }
    }
    if WRITE_RE.is_match(text) {
        return "write";
    }
    "safe"
}

pub fn needs_approval(mode: &str, risk: &str, allow: &HashMap<String, bool>) -> bool {
    if allow.get(risk).copied().unwrap_or(false) {
        return false;
    }
    match mode {
        "g" => risk != "safe",
        "y" => risk == "risky",
        _ => false,
    }
}
