"""İzin modları: g=Onaylı, y=Akıllı, r=Tam otomatik. Tek doğruluk kaynağı sunucudur."""
import re

RISKY = re.compile(r"\bsil|force|push|yazdır|gönder|drop|reset|rm -rf|delete", re.I)
WRITE = re.compile(r"yaz\b|oluştur|düzenle|kaydet|çalıştır|\bkod|pcb|refactor|patch|kur\b|ekle", re.I)
WRITE_SKILLS = {"surgical-patch", "safe-refactor", "lean-build", "pcb", "replica-skill", "fisle"}


def classify(text: str, skill: str | None = None) -> str:
    """'risky' | 'write' | 'safe'"""
    if RISKY.search(text):
        return "risky"
    if (skill and skill in WRITE_SKILLS) or WRITE.search(text):
        return "write"
    return "safe"


def needs_approval(mode: str, risk: str, allow: dict | None = None) -> bool:
    if allow and allow.get(risk):
        return False
    if mode == "g":
        return risk != "safe"
    if mode == "y":
        return risk == "risky"
    return False  # 'r': sormaz (yalnızca uygulama içi onay; CLI/OS izinlerini aşmaz)
