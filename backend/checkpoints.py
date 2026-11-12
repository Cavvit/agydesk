"""Git tabanlı checkpoint. Çalışma klasörü bir git deposu değilse devre dışı kalır.
Geri alma YALNIZCA izlenen dosyaları eski haline döndürür; yeni oluşturulan izlenmeyen dosyaları silmez."""
import subprocess
from pathlib import Path


def _git(ws: Path, *args: str) -> str:
    r = subprocess.run(["git", *args], cwd=ws, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()


def available(ws: Path) -> bool:
    try:
        _git(ws, "rev-parse", "--is-inside-work-tree")
        _git(ws, "rev-parse", "HEAD")
        return True
    except Exception:
        return False


def snapshot(ws: Path) -> str | None:
    """Çalışma ağacının anlık görüntüsünü (stash commit) üretir; ağacı DEĞİŞTİRMEZ."""
    if not available(ws):
        return None
    ref = _git(ws, "stash", "create")
    return ref or _git(ws, "rev-parse", "HEAD")


def restore(ws: Path, ref: str) -> None:
    _git(ws, "restore", f"--source={ref}", "--staged", "--worktree", ".")
