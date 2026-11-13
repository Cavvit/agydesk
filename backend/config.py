"""Atölye yapılandırması. Antigravity CLI (agy) + yerel Ollama."""
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("AIWS_DB", ROOT / "atolye.db"))
WORKSPACE = Path(os.getenv("AIWS_WORKSPACE", ROOT))
_DESKTOP_VAULT = Path.home() / "Desktop" / "Elektrik_Makinalari_Lab_Vault"
VAULT_DIR = Path(os.getenv("AIWS_VAULT", _DESKTOP_VAULT if _DESKTOP_VAULT.exists() else (ROOT / "notes")))

def _resolve_agy_bin() -> str:
    from_env = os.getenv("AGY_BIN")
    if from_env:
        return from_env
    for cmd in ("agy", "agy.cmd", "agy.exe"):
        w = shutil.which(cmd)
        if w:
            return w
    home = Path.home()
    candidates = [
        home / "AppData" / "Local" / "agy" / "bin" / "agy.exe",
        home / "AppData" / "Roaming" / "npm" / "agy.cmd",
        home / "AppData" / "Local" / "Programs" / "agy" / "agy.exe",
        home / ".gemini" / "antigravity-cli" / "bin" / "agy.exe",
        home / ".gemini" / "antigravity-cli" / "bin" / "agy",
        home / ".local" / "bin" / "agy",
        home / ".npm-global" / "bin" / "agy",
        Path("/data/data/com.termux/files/usr/bin/agy"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "agy"

AGY_BIN = _resolve_agy_bin()

FALLBACK_THRESHOLD = int(os.getenv("AIWS_FALLBACK_PCT", "85"))

# Sağlayıcı limitleri (pencere içi istek kotası)
PROVIDERS = {
    "claude-opus":     {"label": "Claude Opus 5.5",   "limit": 40,   "window_h": 5,  "cloud": True},
    "claude-sonnet":   {"label": "Claude Sonnet 5.5", "limit": 150,  "window_h": 5,  "cloud": True},
    "gemini-argon":    {"label": "Gemini 4 Argon",    "limit": 100,  "window_h": 5,  "cloud": True},
    "gemini-hydrogen": {"label": "Gemini 4 Hydrogen", "limit": 500,  "window_h": 24, "cloud": True},
    "local":           {"label": "Yerel (Ollama)",    "limit": None, "window_h": 0,  "cloud": False},
}

_ENV_MODEL_OVERRIDES = {
    "local": "AIWS_LOCAL_MODEL",
    "gemini-hydrogen": "AGY_HYDROGEN_MODEL",
    "gemini-argon": "AGY_ARGON_MODEL",
    "claude-sonnet": "AGY_SONNET_MODEL",
    "claude-opus": "AGY_OPUS_MODEL",
}

_BASE_MODELS = {
    "gemini-hydrogen": "gemini-4-hydrogen",
    "gemini-argon": "gemini-4-argon",
    "claude-sonnet": "claude-sonnet-5-5",
    "claude-opus": "claude-opus-5-5",
}

# agy models çıktısındaki gerçek model kimlikleri
MODELS = {
    "local": os.getenv("AIWS_LOCAL_MODEL", "qwen2.5:14b"),
    "gemini-hydrogen": os.getenv("AGY_HYDROGEN_MODEL", "gemini-4-hydrogen-low"),
    "gemini-argon": os.getenv("AGY_ARGON_MODEL", "gemini-4-argon-low"),
    "claude-sonnet": os.getenv("AGY_SONNET_MODEL", "claude-sonnet-5-5-low"),
    "claude-opus": os.getenv("AGY_OPUS_MODEL", "claude-opus-5-5-low"),
}


def normalize_effort(effort: str | None) -> str:
    val = (effort or "low").strip().lower()
    return val if val in ("low", "medium", "high", "xhigh") else "low"


def effective_effort(provider: str, effort: str | None) -> str:
    """Only Gemini 4 Hydrogen exposes an xhigh variant in `agy models`; other cloud models cap at high."""
    norm = normalize_effort(effort)
    if provider != "gemini-hydrogen" and norm == "xhigh":
        return "high"
    return norm


def model_for(provider: str, effort: str | None = "low") -> str:
    if provider == "local":
        return MODELS["local"]
    env_key = _ENV_MODEL_OVERRIDES.get(provider)
    if env_key:
        override = os.getenv(env_key, "").strip()
        if override:
            return override
    eff = effective_effort(provider, effort)
    base = _BASE_MODELS.get(provider, "gemini-4-hydrogen")
    return f"{base}-{eff}"


OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
