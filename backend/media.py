"""Windows SMTC medya kontrol köprüsü (kalıcı PowerShell WinRT worker)."""
import atexit
import json
import subprocess
import threading

from .config import ROOT

_SCRIPT = ROOT / "backend" / "smtc_worker.ps1"
_LOCK = threading.Lock()
_PROC: subprocess.Popen | None = None
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)


def _ensure_worker() -> subprocess.Popen:
    global _PROC
    if _PROC is not None and _PROC.poll() is None:
        return _PROC
    _PROC = subprocess.Popen(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(_SCRIPT),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=_CREATE_NO_WINDOW,
    )
    return _PROC


def _shutdown() -> None:
    global _PROC
    if _PROC is not None and _PROC.poll() is None:
        try:
            _PROC.terminate()
        except Exception:
            pass
    _PROC = None


atexit.register(_shutdown)


def _rpc(payload: dict) -> dict:
    if not _SCRIPT.exists():
        return {"ok": False, "error": "smtc_worker.ps1 bulunamadı"}
    line_in = json.dumps(payload, ensure_ascii=False) + "\n"
    with _LOCK:
        for attempt in range(2):
            proc = _ensure_worker()
            try:
                assert proc.stdin and proc.stdout
                proc.stdin.write(line_in)
                proc.stdin.flush()
                raw = proc.stdout.readline()
                if not raw:
                    raise EOFError("SMTC worker kapalı")
                return json.loads(raw)
            except Exception as exc:
                _shutdown()
                if attempt == 1:
                    return {"ok": False, "error": str(exc)}
    return {"ok": False, "error": "SMTC çağrısı başarısız"}


def get_status(app: str | None = None) -> dict:
    """Aktif Windows medya oturumunu ve tüm SMTC oturumlarını döndürür."""
    res = _rpc({"op": "status", "app": app or ""})
    if not isinstance(res, dict):
        return {"ok": False, "active": None, "sessions": []}
    res.setdefault("active", None)
    res.setdefault("sessions", [])
    return res


def send_cmd(action: str, app: str | None = None) -> dict:
    """playpause, next veya prev komutunu ilgili medya oturumuna gönderir."""
    if action not in ("playpause", "next", "prev"):
        return {"ok": False, "error": f"Geçersiz komut: {action}"}
    return _rpc({"op": "cmd", "action": action, "app": app or ""})
