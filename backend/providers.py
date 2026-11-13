"""Sağlayıcı adaptörleri: Bulut modelleri doğrudan gömülü Antigravity CLI (agy) üzerinden,
yerel modeller Ollama üzerinden çalıştırılır. API anahtarı gerekmez."""
import asyncio
import base64
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import httpx

from . import store
from .config import AGY_BIN, MODELS, OLLAMA_URL, PROVIDERS, VAULT_DIR, WORKSPACE, effective_effort, model_for
from .router import CLOUD_CHAIN

_procs: dict[str, subprocess.Popen] = {}
_RESET_RE = re.compile(r"Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", re.I)


def _parse_reset_s(err: str) -> int:
    m = _RESET_RE.search(err)
    if not m:
        return 3600
    h, mn, s = (int(x or 0) for x in m.groups())
    return max(60, h * 3600 + mn * 60 + s)


def agy_available() -> bool:
    return Path(AGY_BIN).exists() or shutil.which(AGY_BIN) is not None


async def ollama_alive() -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as c:
            return (await c.get(f"{OLLAMA_URL}/api/tags")).status_code == 200
    except Exception:
        return False


def kill_session_proc(session: str) -> bool:
    p = _procs.pop(session, None)
    if p and p.poll() is None:
        try:
            p.kill()
            return True
        except Exception:
            pass
    return False


async def _mock(provider: str, prompt: str, why: str) -> tuple[str, int, bool, str | None]:
    await asyncio.sleep(1.0)
    return (f"[DEMO · {provider}] {why}. İstek: {prompt[:160]}", 0, False, None)


async def _local(prompt: str, image_paths: list[Path] | None = None) -> tuple[str, int, bool, str | None]:
    payload: dict = {"model": MODELS["local"], "prompt": prompt, "think": False, "stream": False}
    if image_paths:
        b64s: list[str] = []
        for p in image_paths:
            try:
                raw = p.read_bytes()
                if 0 < len(raw) <= 20 * 1024 * 1024:
                    b64s.append(base64.b64encode(raw).decode("ascii"))
            except Exception:
                pass
        if b64s:
            payload["images"] = b64s
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            r = await c.post(f"{OLLAMA_URL}/api/generate", json=payload)
            r.raise_for_status()
            j = r.json()
            return j.get("response", ""), j.get("eval_count", 0), True, None
    except Exception:
        return await _mock("local", prompt, "Ollama çalışmıyor (yerel model kapalı)")


def _mode_flags(mode: str) -> list[str]:
    if mode in ("r", "y"):
        return ["--dangerously-skip-permissions"]
    return ["--mode", "accept-edits"]


def _run_agy_sync(
    session: str,
    model: str,
    effort: str,
    prompt: str,
    mode: str,
    conv_id: str | None,
    on_step: Callable[[str], None] | None,
) -> tuple[str, int, bool, str | None]:
    cmd = [
        AGY_BIN,
        "-p", prompt,
        "--output-format", "stream-json",
        "--model", model,
        "--effort", effort,
        "--print-timeout", "300s",
        *_mode_flags(mode),
    ]
    if VAULT_DIR != WORKSPACE and VAULT_DIR.exists():
        cmd.extend(["--add-dir", str(VAULT_DIR)])
    if conv_id:
        cmd.extend(["--conversation", conv_id])

    proc = subprocess.Popen(
        cmd,
        cwd=str(WORKSPACE),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    _procs[session] = proc

    new_conv = conv_id
    chunks: list[str] = []
    tool_logs: list[str] = []
    final_resp: str | None = None
    agy_err: str | None = None
    tokens = 0

    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            etype = ev.get("event")
            if etype == "init":
                new_conv = ev.get("conversation_id") or new_conv
            elif etype == "step_update":
                su = ev.get("step_update") or {}
                new_conv = su.get("conversation_id") or new_conv
                stype = su.get("step_type", "")
                delta = su.get("text_delta")
                if delta:
                    chunks.append(delta)
                err_txt = su.get("error")
                if isinstance(err_txt, str) and err_txt.strip():
                    agy_err = err_txt.strip()
                tcalls = su.get("tool_calls") or []
                tlabel = ""
                if tcalls:
                    t0 = tcalls[0]
                    tname, obj = t0.get("name", "tool"), (t0.get("args") or {})
                    tsum = (obj.get("toolSummary") or obj.get("Path") or tname).strip('"')
                    tlabel = f"🛠 {tname}: {tsum}"
                elif su.get("tool_name"):
                    tname, obj = su.get("tool_name", "tool"), ((su.get("tool_info") or {}).get("parameters") or {})
                    tsum = (obj.get("toolSummary") or obj.get("Path") or tname).strip('"')
                    tlabel = f"🛠 {tname}: {tsum}"
                if tlabel:
                    if tlabel not in tool_logs:
                        tool_logs.append(tlabel)
                    if on_step:
                        on_step(tlabel)
                elif on_step and stype:
                    on_step(f"agy ({model}) · adım #{su.get('step_index', 0)}: {stype}")
                u = su.get("usage") or {}
                tokens = u.get("total_tokens") or tokens
            elif etype == "result":
                res = ev.get("result") or {}
                new_conv = res.get("conversation_id") or new_conv
                final_resp = res.get("response")
                err_txt = res.get("error")
                if isinstance(err_txt, str) and err_txt.strip():
                    agy_err = err_txt.strip()
                elif res.get("status") and res.get("status") != "SUCCESS" and not agy_err:
                    agy_err = f"agy durum: {res.get('status')}"
                u = res.get("usage") or {}
                tokens = u.get("total_tokens") or tokens

        proc.wait(timeout=5)
    finally:
        _procs.pop(session, None)
        if proc.poll() is None:
            proc.kill()

    text = (final_resp if final_resp is not None else "".join(chunks)).strip()
    if not text and agy_err:
        raise RuntimeError(agy_err)
    if not text and tool_logs:
        text = "✓ Tamamlanan işlemler:\n" + "\n".join(f"• {x}" for x in tool_logs[-8:])
    if not text:
        err = (proc.stderr.read() if proc.stderr else "").strip()
        if proc.returncode != 0 or err:
            raise RuntimeError(err or f"agy çıkış kodu: {proc.returncode}")
    return text, tokens, True, new_conv


async def complete(
    provider: str,
    prompt: str,
    *,
    image_paths: list[Path] | None = None,
    session: str = "default",
    mode: str = "y",
    effort: str = "low",
    conv_id: str | None = None,
    on_step: Callable[[str], None] | None = None,
    on_failover: Callable[[str, str], None] | None = None,
) -> tuple[str, int, bool, str | None]:
    """(metin, token, gerçek_mi, conv_id)"""
    if provider == "local":
        if await ollama_alive():
            return await _local(prompt, image_paths)
        if agy_available():
            provider = "gemini-hydrogen"
            if on_failover:
                on_failover(provider, "Yerel Ollama kapalı → Gemini 4 Hydrogen (agy CLI)")
        else:
            return await _local(prompt, image_paths)
    if not agy_available():
        return await _mock(provider, prompt, "agy CLI bulunamadı")

    chain = [provider] + [p for p in CLOUD_CHAIN if p != provider]
    cur_conv = conv_id
    last_err: Exception | None = None
    for idx, prov in enumerate(chain):
        eff = effective_effort(prov, effort)
        model = model_for(prov, eff)
        try:
            text, tokens, real, new_conv = await asyncio.to_thread(
                _run_agy_sync, session, model, eff, prompt, mode, cur_conv, on_step
            )
            if idx > 0 and on_failover:
                on_failover(prov, f"{PROVIDERS[provider]['label']} kotası doldu → {PROVIDERS[prov]['label']}")
            return text, tokens, real, new_conv
        except Exception as e:
            msg = str(e)
            last_err = e
            if "RESOURCE_EXHAUSTED" in msg or "Individual quota reached" in msg or '"error_code":429' in msg:
                store.mark_exhausted(prov, _parse_reset_s(msg))
                cur_conv = None  # farklı modele geçerken konuşma kimliği sıfırlanır
                if on_step and idx + 1 < len(chain):
                    nxt = PROVIDERS[chain[idx + 1]]["label"]
                    on_step(f"⚠ {PROVIDERS[prov]['label']} kotası doldu → {nxt} modeline geçiliyor…")
                continue
            raise
    if last_err:
        return await _local(prompt, image_paths)
    return await _mock(provider, prompt, "beklenmeyen durum")
