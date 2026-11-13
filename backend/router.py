"""Görev yönlendirici: göreve göre sağlayıcı seçer, kota doluysa yerele düşürür."""
import re
from dataclasses import dataclass, asdict

from .config import FALLBACK_THRESHOLD, PROVIDERS

LIGHT = re.compile(r"özet|ses|kayıt|ocr|el yaz|çevir|biçimlendir|formatla|temizle|deşifre|whisper", re.I)
MATH = re.compile(r"ispat|türev|integral|matematik|denklem|limit|olasılık|fourier|laplace", re.I)
ARGON = re.compile(r"argon|simülasyon|kontrol sistemi|bode|transfer fonksiyonu|elektromanyetik", re.I)
HARD = re.compile(r"mimari|tasarım kararı|zor hata|kritik|derin", re.I)
CODE = re.compile(r"\bkod\b|pcb|refactor|patch|fonksiyon|script|spice|backend|\bapi\b|python|javascript", re.I)

CLOUD_CHAIN = ["gemini-hydrogen", "gemini-argon", "claude-sonnet", "claude-opus"]

LOCAL_SKILLS = {"ozet", "whisper", "graphify", "verify-and-stop", "caveman-commit", "caveman-review", "spice"}
OPUS_SKILLS = {"llm-council", "boost"}
SONNET_SKILLS = {"surgical-patch", "safe-refactor", "lean-build", "investigate-first", "pcb",
                 "teardown", "taste", "replica-skill", "plan", "goal"}


@dataclass
class Decision:
    provider: str
    label: str
    reason: str
    fallback: bool = False

    def dict(self):
        return asdict(self)


def _pick(text: str, skill: str | None) -> tuple[str, str]:
    if skill in LOCAL_SKILLS:
        return "local", f"skill '{skill}' yerelde çalışır"
    if skill in OPUS_SKILLS:
        return "claude-opus", f"skill '{skill}' ağır akıl yürütme"
    if skill in SONNET_SKILLS:
        return "claude-sonnet", f"skill '{skill}' kodlama/planlama"
    if LIGHT.search(text):
        return "local", "basit görev → yerel (kota harcanmaz)"
    if MATH.search(text) or HARD.search(text):
        return "claude-opus", "zor matematik/mimari → Opus"
    if ARGON.search(text):
        return "gemini-argon", "mühendislik analizi → Argon"
    if CODE.search(text):
        return "claude-sonnet", "kodlama → Sonnet"
    return "gemini-hydrogen", "genel sohbet → ana model"


def route(text: str, skill: str | None, pct_of, has_images: bool = False) -> Decision:
    """pct_of(provider_id) -> kullanım yüzdesi. Test edilebilsin diye enjekte edilir."""
    prov, reason = _pick(text, skill)
    if has_images and prov == "local":
        prov = "gemini-hydrogen"
        reason = "görsel analizi → multimodal bulut modeli"
    pct = pct_of(prov) if PROVIDERS[prov]["cloud"] else 0
    if PROVIDERS[prov]["cloud"] and pct >= FALLBACK_THRESHOLD:
        for alt in CLOUD_CHAIN:
            if alt != prov and pct_of(alt) < FALLBACK_THRESHOLD:
                return Decision(alt, PROVIDERS[alt]["label"],
                                f"{PROVIDERS[prov]['label']} kotası dolu → {PROVIDERS[alt]['label']}",
                                fallback=True)
        return Decision("local", PROVIDERS["local"]["label"],
                        f"{PROVIDERS[prov]['label']} kotası %{pct} ≥ %{FALLBACK_THRESHOLD} → yerele düşürüldü",
                        fallback=True)
    return Decision(prov, PROVIDERS[prov]["label"], reason)
