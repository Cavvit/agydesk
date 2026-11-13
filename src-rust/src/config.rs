use once_cell::sync::Lazy;
use std::env;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct ProviderSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub limit: Option<u32>,
    pub window_h: u64,
    pub cloud: bool,
}

pub const PROVIDERS: &[ProviderSpec] = &[
    ProviderSpec { id: "claude-opus",     label: "Claude Opus 5.5",   limit: Some(40),  window_h: 5,  cloud: true },
    ProviderSpec { id: "claude-sonnet",   label: "Claude Sonnet 5.5", limit: Some(150), window_h: 5,  cloud: true },
    ProviderSpec { id: "gemini-argon",    label: "Gemini 4 Argon",    limit: Some(100), window_h: 5,  cloud: true },
    ProviderSpec { id: "gemini-hydrogen", label: "Gemini 4 Hydrogen", limit: Some(500), window_h: 24, cloud: true },
    ProviderSpec { id: "local",           label: "Yerel (Ollama)",    limit: None,      window_h: 0,  cloud: false },
];

pub fn provider_spec(id: &str) -> &'static ProviderSpec {
    PROVIDERS.iter().find(|p| p.id == id).unwrap_or(&PROVIDERS[3])
}

pub static ROOT: Lazy<PathBuf> = Lazy::new(|| {
    if let Ok(r) = env::var("AIWS_ROOT") {
        let p = PathBuf::from(r);
        if p.exists() {
            return p;
        }
    }
    if let Ok(exe) = env::current_exe() {
        let mut cur = exe.parent().map(|p| p.to_path_buf());
        while let Some(dir) = cur {
            if dir.join("frontend").join("index.html").exists() {
                return dir;
            }
            cur = dir.parent().map(|p| p.to_path_buf());
        }
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
});

pub static DB_PATH: Lazy<PathBuf> = Lazy::new(|| {
    env::var("AIWS_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| ROOT.join("atolye.db"))
});

pub static WORKSPACE: Lazy<PathBuf> = Lazy::new(|| {
    env::var("AIWS_WORKSPACE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| ROOT.clone())
});

pub static VAULT_DIR: Lazy<PathBuf> = Lazy::new(|| {
    if let Ok(v) = env::var("AIWS_VAULT") {
        return PathBuf::from(v);
    }
    if let Ok(up) = env::var("USERPROFILE") {
        let desktop_vault = Path::new(&up).join("Desktop").join("Elektrik_Makinalari_Lab_Vault");
        if desktop_vault.exists() {
            return desktop_vault;
        }
    }
    ROOT.join("notes")
});

pub static AGY_BIN: Lazy<String> = Lazy::new(|| {
    if let Ok(b) = env::var("AGY_BIN") {
        if !b.is_empty() {
            return b;
        }
    }
    if let Ok(up) = env::var("USERPROFILE") {
        let home = Path::new(&up);
        let candidates = [
            home.join(r"AppData\Local\Programs\Antigravity\bin\agy.cmd"),
            home.join(r"AppData\Local\agy\bin\agy.exe"),
            home.join(r"AppData\Roaming\npm\agy.cmd"),
            home.join(r"AppData\Local\Programs\agy\agy.exe"),
            home.join(r".gemini\antigravity-cli\bin\agy.exe"),
        ];
        for c in candidates {
            if c.exists() {
                return c.to_string_lossy().to_string();
            }
        }
    }
    if let Ok(path_var) = env::var("PATH") {
        for dir in env::split_paths(&path_var) {
            for name in ["agy.exe", "agy.cmd", "agy.bat"] {
                let p = dir.join(name);
                if p.exists() {
                    return p.to_string_lossy().to_string();
                }
            }
        }
    }
    "agy".to_string()
});

pub static FALLBACK_THRESHOLD: Lazy<u32> = Lazy::new(|| {
    env::var("AIWS_FALLBACK_PCT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(85)
});

pub static OLLAMA_URL: Lazy<String> = Lazy::new(|| {
    env::var("OLLAMA_URL").unwrap_or_else(|_| "http://127.0.0.1:11434".to_string())
});

pub fn normalize_effort(effort: &str) -> &'static str {
    match effort.trim().to_ascii_lowercase().as_str() {
        "medium" => "medium",
        "high" => "high",
        "xhigh" => "xhigh",
        _ => "low",
    }
}

/// Only Gemini 4 Hydrogen exposes an xhigh variant in `agy models`; other cloud models cap at high.
pub fn effective_effort(provider: &str, effort: &str) -> &'static str {
    let norm = normalize_effort(effort);
    if provider != "gemini-hydrogen" && norm == "xhigh" {
        "high"
    } else {
        norm
    }
}

pub fn model_for(provider: &str, effort: &str) -> String {
    if provider == "local" {
        return env::var("AIWS_LOCAL_MODEL").unwrap_or_else(|_| "qwen2.5:14b".to_string());
    }
    let eff = effective_effort(provider, effort);
    let (env_key, base) = match provider {
        "gemini-hydrogen" => ("AGY_HYDROGEN_MODEL", "gemini-4-hydrogen"),
        "gemini-argon" => ("AGY_ARGON_MODEL", "gemini-4-argon"),
        "claude-sonnet" => ("AGY_SONNET_MODEL", "claude-sonnet-5-5"),
        "claude-opus" => ("AGY_OPUS_MODEL", "claude-opus-5-5"),
        _ => ("AGY_HYDROGEN_MODEL", "gemini-4-hydrogen"),
    };
    if let Ok(v) = env::var(env_key) {
        if !v.trim().is_empty() {
            return v;
        }
    }
    format!("{}-{}", base, eff)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_hydrogen_and_clamps_non_hydrogen_xhigh() {
        assert_eq!(model_for("gemini-hydrogen", "low"), "gemini-4-hydrogen-low");
        assert_eq!(model_for("gemini-hydrogen", "medium"), "gemini-4-hydrogen-medium");
        assert_eq!(model_for("gemini-hydrogen", "high"), "gemini-4-hydrogen-high");
        assert_eq!(model_for("gemini-hydrogen", "xhigh"), "gemini-4-hydrogen-xhigh");
        assert_eq!(model_for("gemini-hydrogen", "unknown"), "gemini-4-hydrogen-low");
        assert_eq!(model_for("gemini-argon", "xhigh"), "gemini-4-argon-high");
        assert_eq!(model_for("claude-sonnet", "xhigh"), "claude-sonnet-5-5-high");
        assert_eq!(model_for("claude-opus", "medium"), "claude-opus-5-5-medium");
    }
}
