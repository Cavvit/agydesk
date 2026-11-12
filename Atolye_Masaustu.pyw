import os
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8780"
LOG_FILE = os.path.join(ROOT, "server.log")


def is_up() -> bool:
    try:
        with urllib.request.urlopen(URL + "/api/ping", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_backend() -> None:
    if is_up():
        return
    py = os.path.join(os.path.dirname(sys.executable), "python.exe")
    if not os.path.exists(py):
        py = shutil.which("python") or "python"
    flags = (
        getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
    )
    log_fh = open(LOG_FILE, "a", encoding="utf-8", errors="replace")
    subprocess.Popen(
        [py, "-m", "uvicorn", "backend.main:app", "--port", "8780", "--host", "127.0.0.1"],
        cwd=ROOT,
        creationflags=flags,
        stdin=subprocess.DEVNULL,
        stdout=log_fh,
        stderr=log_fh,
        close_fds=True,
    )
    for _ in range(40):
        if is_up():
            return
        time.sleep(0.2)


def find_browser() -> str | None:
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        shutil.which("msedge"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        shutil.which("chrome"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def main() -> None:
    ensure_backend()
    if "--daemon-only" in sys.argv:
        return
    browser = find_browser()
    if browser:
        subprocess.Popen([browser, f"--app={URL}/?v={int(time.time())}", "--window-size=1500,920"])
    else:
        os.startfile(URL)


if __name__ == "__main__":
    main()
