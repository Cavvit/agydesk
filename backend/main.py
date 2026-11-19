"""Atölye backend: görev yönlendirme, kota, izinler, checkpoint, SSE olayları."""
import asyncio
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import checkpoints, config, media, permissions, providers, router, store, vault
from .config import PROVIDERS, ROOT, VAULT_DIR, WORKSPACE

_WRITE_RULE = (
    f"Yeni not (.md) -> {VAULT_DIR}\\AgyDesk_Notlar\\<Kasa>\\, belge/görsel -> {VAULT_DIR}\\AgyDesk_Dokuman\\<Kasa>\\."
    if (VAULT_DIR / "AgyDesk_Notlar").is_dir() or (VAULT_DIR / "AgyDesk_Dokuman").is_dir()
    else f"Yeni not -> {VAULT_DIR}\\<Kasa>\\*.md."
)


def _is_restricted_session(session: str) -> bool:
    return session == "side_ai" or session == "src_ai" or session.startswith("src_ai__")


def _ws_hint_for(session: str) -> str:
    if not _is_restricted_session(session):
        return f"[AgyAI CLI: tam erişim aktif. Kasa: {VAULT_DIR}. Not açmak için [[Dosya_Adi]] yaz.]\n\n"
    drive_rule = ""
    for cand in (r"G:\Drive'ım", r"G:\My Drive"):
        if Path(cand).exists():
            drive_rule = (
                f" Drive okuma: {cand}; Drive yedekleme/yazma: yalnızca {cand}\\AgyDesk_Belgeler. "
                "Drive'a yazmadan önce aynı dosyanın Drive'da var olup olmadığını kontrol et (çift kopya oluşturma, mevcut dosyayı güncelle)."
            )
            break
    return (
        f"[AgyDesk Kısıtlı Çalışma Modu (yalnızca Kasa/Drive/Görsel/Web arama; proje/shell kapalı). Kasa: {VAULT_DIR}. {_WRITE_RULE}{drive_rule} "
        "Not açmak için [[Dosya_Adi]] yaz. Matematik: $...$/$$...$$. ASCII çizme; devre için ```sema trafo-esdeger|trafo-bosta|trafo-kisadevre|trafo-baglanti|dc-sont```, akış için ```mermaid``` (alt çizgisiz etiket) kullan.]\n\n"
    )

app = FastAPI(title="Atölye")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
store.init()

_subs: list[asyncio.Queue] = []
_tasks: dict[str, asyncio.Task] = {}
_steps: dict[str, str] = {}
_src_hashes: dict[str, str] = {}
_auth_needed = False
_auth_running = False


def emit(event: str, **data):
    if event == "step" and "session" in data and "step" in data:
        _steps[data["session"]] = data["step"]
    payload = {"event": event, **data}
    for q in list(_subs):
        q.put_nowait(payload)


class RunReq(BaseModel):
    session: str
    text: str = ""
    images: list[str] = []
    skill: str | None = None
    mode: str = "y"
    effort: str = "low"
    allow: dict = {}
    approved: bool = False
    sources: list[str] = []
    active_note: str | None = None
    force_provider: str | None = None
    win_id: str | None = None


class LogReq(BaseModel):
    session: str
    msg: str
    kind: str = ""


class SessionReq(BaseModel):
    session: str


class CompactReq(BaseModel):
    session: str
    recent_msgs: list[str] = []


class NoteSaveReq(BaseModel):
    rel: str
    content: str


class KasaCreateReq(BaseModel):
    title: str
    tag: str = "Çalışma Kasası"
    desc: str = ""
    icon: str = "📘"
    space: str = ""
    accent: str = ""


class KasaUpdateReq(BaseModel):
    key: str
    title: str | None = None
    tag: str | None = None
    desc: str | None = None
    icon: str | None = None
    accent: str | None = None
    space: str | None = None


class SpaceSaveReq(BaseModel):
    id: str | None = None
    title: str
    icon: str = "🗂"
    accent: str = "#e0a458"
    tag: str = ""
    desc: str = ""


class NoteCreateReq(BaseModel):
    kasa: str
    title: str
    content: str = ""


class FolderCreateReq(BaseModel):
    parent: str
    name: str


class VaultMoveReq(BaseModel):
    src: str
    target: str = ""
    position: str = "into"


class CalEventReq(BaseModel):
    day: int
    title: str
    kind: str = "task"
    kasa: str = ""


class ChatMsgReq(BaseModel):
    session: str
    w: str
    h: str


class OpenTargetReq(BaseModel):
    target: str
    reveal: bool = False


@app.get("/api/health")
async def health():
    return {"ok": True, "agy": providers.agy_available(),
            "ollama": await providers.ollama_alive(),
            "git_checkpoints": checkpoints.available(WORKSPACE),
            "vault": str(VAULT_DIR),
            "running": {s: _steps.get(s, "Çalışıyor…") for s in _tasks},
            "auth_needed": _auth_needed,
            "auth_running": _auth_running}


@app.post("/api/auth/login")
async def auth_login_ep():
    global _auth_needed, _auth_running
    if _auth_running:
        return {"status": "running"}
    _auth_running = True
    emit("auth", status="pending", message="Chrome'da Google oturum açma penceresi açılıyor…")
    store.add_log("auth", "🔑 agy CLI oturum açma başlatıldı")
    emit("log")

    async def _run_login():
        global _auth_needed, _auth_running
        try:
            await asyncio.to_thread(providers.run_agy_login_sync)
            _auth_needed = False
            store.add_log("auth", "✓ agy CLI oturumu doğrulandı", "ok")
            emit("auth", status="ok")
        except Exception as e:
            _auth_needed = True
            store.add_log("auth", f"✗ Oturum açılamadı: {e}", "w")
            emit("auth", status="failed", error=str(e))
        finally:
            _auth_running = False
            emit("log")

    asyncio.create_task(_run_login())
    return {"status": "started"}


@app.get("/api/ping")
async def ping():
    return {"ok": True}


@app.get("/api/system/battery")
async def system_battery():
    try:
        import psutil
        bat = psutil.sensors_battery()
    except Exception:
        bat = None
    if bat is None:
        return {"available": False}
    secs = bat.secsleft if isinstance(bat.secsleft, int) and bat.secsleft >= 0 else None
    return {
        "available": True,
        "percent": int(round(bat.percent)),
        "plugged": bool(bat.power_plugged),
        "secs_left": secs,
    }


@app.get("/api/ui_state")
async def get_ui_state_ep():
    return store.get_ui_state()


@app.post("/api/ui_state")
async def set_ui_state_ep(req: Request):
    try:
        raw = await req.body()
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Geçersiz JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "Nesne bekleniyordu")
    clean = {str(k): (None if v is None else str(v)) for k, v in data.items() if k}
    store.set_ui_state(clean)
    return {"ok": True}


_VAULT_CACHE = {"t": 0.0, "v": None, "k": None}
_VAULT_TTL = 3.0  # sn; harici (Obsidian vb.) degisiklikler en gec bu surede yansir


def _vault_snapshot():
    now = time.monotonic()
    v = _VAULT_CACHE["v"]
    key = str(vault.VAULT_DIR)
    if v is not None and _VAULT_CACHE["k"] == key and now - _VAULT_CACHE["t"] < _VAULT_TTL:
        return v
    v = vault.scan_vault()
    _VAULT_CACHE["v"] = v
    _VAULT_CACHE["k"] = key
    _VAULT_CACHE["t"] = time.monotonic()
    return v


@app.get("/api/vault")
async def get_vault():
    # Tarama olay dongusunu bloklamasin (medya/pil/SSE istekleri takilmasin)
    return await asyncio.to_thread(_vault_snapshot)


@app.post("/api/kasa")
async def create_kasa_ep(r: KasaCreateReq):
    try:
        res = vault.create_kasa(r.title, r.tag, r.desc, r.icon, r.space, r.accent)
        store.add_log("vault", f"❖ Yeni kasa oluşturuldu: {r.title}", "ok")
        emit("log")
        return res
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/kasa/update")
async def update_kasa_ep(r: KasaUpdateReq):
    try:
        res = vault.update_kasa(r.key, r.title, r.tag, r.desc, r.icon, r.accent, r.space)
        store.add_log("vault", f"❖ Kasa güncellendi: {res.get('label', r.key)}", "ok")
        emit("log")
        return res
    except FileNotFoundError as e:
        raise HTTPException(404, f"Kasa bulunamadı: {e}")
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/space")
async def save_space_ep(r: SpaceSaveReq):
    try:
        res = vault.save_space(r.id, r.title, r.icon, r.accent, r.tag, r.desc)
        store.add_log("vault", f"🗂 Alan kaydedildi: {res['title']}", "ok")
        emit("log")
        return res
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/api/space")
async def delete_space_ep(id: str):
    try:
        res = vault.delete_space(id)
        store.add_log("vault", f"🗂 Alan silindi: {id}", "w")
        emit("log")
        return res
    except FileNotFoundError as e:
        raise HTTPException(404, f"Alan bulunamadı: {e}")
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/folder")
async def create_folder_ep(r: FolderCreateReq):
    try:
        res = vault.create_folder(r.parent, r.name)
        store.add_log("vault", f"📁 Yeni klasör oluşturuldu: {res['rel']}", "ok")
        emit("log")
        return res
    except FileNotFoundError as e:
        raise HTTPException(404, f"Üst klasör bulunamadı: {e}")
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/vault/move")
async def move_vault_item_ep(r: VaultMoveReq):
    try:
        res = vault.move_item(r.src, r.target, r.position)
        if res.get("moved"):
            store.add_log("vault", f"📦 Taşındı: {res['old_rel']} → {res['new_rel']}", "ok")
            emit("log")
        elif res.get("reordered"):
            store.add_log("vault", f"↕ Sıralama güncellendi: {res['new_rel']}", "ok")
            emit("log")
        return res
    except FileNotFoundError as e:
        raise HTTPException(404, f"Öğe bulunamadı: {e}")
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/note")
async def get_note(rel: str):
    try:
        return vault.read_note(rel)
    except Exception as e:
        raise HTTPException(404, str(e))


@app.post("/api/note")
async def save_note(r: NoteSaveReq):
    try:
        res = vault.write_note(r.rel, r.content)
        store.add_log("vault", f"💾 Not kaydedildi: {r.rel}", "ok")
        emit("log")
        return res
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/note/create")
async def create_note_ep(r: NoteCreateReq):
    try:
        res = vault.create_note(r.kasa, r.title, r.content)
        store.add_log("vault", f"📝 Yeni not oluşturuldu: {res['rel']}", "ok")
        emit("log")
        return res
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/api/note")
async def delete_note_ep(rel: str):
    try:
        res = vault.delete_note(rel)
        store.add_log("vault", f"🗑 Not silindi: {rel}", "w")
        emit("log")
        return res
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/calendar")
async def get_calendar():
    return store.get_cal_events()


@app.post("/api/calendar")
async def post_calendar(r: CalEventReq):
    if not r.title.strip() or not (1 <= r.day <= 31):
        raise HTTPException(400, "Geçersiz gün veya başlık")
    ev = store.add_cal_event(r.day, r.title, r.kind, r.kasa)
    store.add_log("takvim", f"▦ Takvime eklendi ({r.day} Kas): {r.title}", "ok")
    emit("log")
    return ev


@app.delete("/api/calendar/{ev_id}")
async def delete_calendar(ev_id: int):
    store.del_cal_event(ev_id)
    return {"deleted": ev_id}


@app.post("/api/upload")
async def upload_asset(request: Request, name: str, note: str = ""):
    try:
        return vault.save_asset(note, name, await request.body())
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/docx")
async def get_docx(rel: str):
    try:
        return vault.docx_to_html(rel)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/pptx")
async def get_pptx(rel: str):
    try:
        return vault.pptx_to_slides(rel)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/pdf_info")
async def get_pdf_info(rel: str):
    try:
        return vault.pdf_info(rel)
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/raw/{rel:path}")
async def raw_file(rel: str):
    try:
        p = vault._safe_path(rel)
        if not p.exists():
            raise HTTPException(404, "Dosya bulunamadı")
        return FileResponse(p)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/chats")
async def get_chats():
    return store.get_chat_msgs()


@app.post("/api/chats")
async def post_chat(r: ChatMsgReq):
    store.add_chat_msg(r.session, r.w, r.h)
    return {"ok": True}


@app.get("/api/quota")
async def quota(refresh: bool = False):
    return await asyncio.to_thread(store.quota_status, True, refresh)


@app.get("/api/log")
async def get_log():
    return store.get_log()


@app.post("/api/log")
async def post_log(r: LogReq):
    store.add_log(r.session, r.msg, r.kind)
    emit("log")
    return {"ok": True}


@app.get("/api/events")
async def events():
    q: asyncio.Queue = asyncio.Queue()
    _subs.append(q)

    async def gen():
        try:
            yield "retry: 2000\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            _subs.remove(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


async def _refresh_quota_bg():
    try:
        fresh = await asyncio.to_thread(store.quota_status, True, True)
        emit("quota", quota=fresh)
    except Exception:
        pass


async def _job(r: RunReq, dec: router.Decision):
    global _auth_needed
    loop = asyncio.get_running_loop()
    try:
        init_step = (
            f"{dec.label} çalışıyor… ({dec.reason})"
            if dec.provider == "local"
            else f"{dec.label} ({config.effective_effort(dec.provider, r.effort)}) çalışıyor… ({dec.reason})"
        )
        emit("step", session=r.session, win_id=r.win_id, step=init_step)
        conv_id = store.get_conv_id(r.session)
        raw_src_ctx = await asyncio.to_thread(vault.build_context_from_sources, r.sources, r.active_note)
        if raw_src_ctx:
            h = hashlib.sha256(raw_src_ctx.encode("utf-8", errors="ignore")).hexdigest()
            unchanged = bool(conv_id) and _src_hashes.get(r.session) == h
            _src_hashes[r.session] = h
            src_ctx = "" if unchanged else raw_src_ctx
        else:
            src_ctx = ""
        img_paths = await asyncio.to_thread(vault.resolve_chat_images, r.images)
        img_ctx = vault.build_image_prompt_block(img_paths)
        user_text = "Eklenen görseli incele ve içeriğini açıkla." if (not r.text.strip() and img_paths) else r.text
        base_prompt = f"{src_ctx}{img_ctx}{user_text}"
        if not conv_id:
            compact_ctx = store.pop_compact_ctx(r.session)
            if compact_ctx:
                base_prompt = (
                    f"[Önceki Sohbetin Sıkıştırılmış Özeti]\n{compact_ctx}\n\n"
                    f"[Yeni Kullanıcı İsteği]\n{base_prompt}"
                )
        prompt = f"{_ws_hint_for(r.session)}{base_prompt}" if not conv_id else base_prompt
        log_text = f"[{len(img_paths)} görsel]" if (not r.text.strip() and img_paths) else r.text

        def _on_failover(new_prov: str, why: str):
            dec.provider = new_prov
            dec.label = PROVIDERS[new_prov]["label"]
            dec.reason = why
            dec.fallback = True

        text, tokens, real, new_conv = await providers.complete(
            dec.provider,
            prompt,
            image_paths=img_paths,
            session=r.session,
            mode=r.mode,
            effort=r.effort,
            conv_id=conv_id,
            on_step=lambda st: loop.call_soon_threadsafe(lambda s=st: emit("step", session=r.session, win_id=r.win_id, step=s)),
            on_delta=lambda d: loop.call_soon_threadsafe(lambda txt=d: emit("delta", session=r.session, win_id=r.win_id, delta=txt)),
            on_failover=_on_failover,
        )
        used_effort = None if dec.provider == "local" else config.effective_effort(dec.provider, r.effort)
        if dec.provider != "local" and real:
            _auth_needed = False
        if new_conv:
            store.set_conv_id(r.session, new_conv)
        if real:  # DEMO/yer tutucu yanıtlar gerçek kotadan sayılmaz
            store.record_usage(dec.provider, tokens, real)
        store.add_log(r.session, f"✓ Tamamlandı ({dec.label}{'' if real else ', DEMO'}): {log_text}", "ok")
        if not _subs:
            store.add_chat_msg(r.session, "a", text)
        cached_quota = store.quota_status()
        emit("done", session=r.session, win_id=r.win_id, reply=text, real=real, tokens=tokens,
             conv_id=new_conv, route=dec.dict(), effort=used_effort, quota=cached_quota)
        emit("log")
        asyncio.create_task(_refresh_quota_bg())
    except asyncio.CancelledError:
        providers.kill_session_proc(r.session)
        raise
    except Exception as e:  # sağlayıcı hatası kullanıcıya gösterilir
        err_str = str(e)
        auth_req = providers.is_auth_error(err_str)
        ollama_ok = False
        if auth_req:
            _auth_needed = True
            ollama_ok = await providers.ollama_alive()
        store.add_log(r.session, f"✗ Hata ({dec.label}): {err_str}", "w")
        cached_quota = store.quota_status()
        emit(
            "error",
            session=r.session,
            win_id=r.win_id,
            error=err_str,
            code="auth_required" if auth_req else "provider_error",
            ollama_available=ollama_ok,
            quota=cached_quota,
        )
        emit("log")
        asyncio.create_task(_refresh_quota_bg())
    finally:
        _tasks.pop(r.session, None)
        _steps.pop(r.session, None)


@app.post("/api/run")
async def run(r: RunReq):
    if not r.text.strip() and not r.images:
        raise HTTPException(400, "Mesaj veya görsel boş olamaz")
    if r.session in _tasks:
        raise HTTPException(409, "Oturum meşgul")
    log_text = f"[{len(r.images)} görsel]" if not r.text.strip() else r.text
    risk = permissions.classify(r.text, r.skill)
    if not r.approved and permissions.needs_approval(r.mode, risk, r.allow):
        store.add_log(r.session, f"⏸ Onay bekleniyor ({risk}): {log_text}", "w")
        emit("log")
        return {"status": "approval", "risk": risk}
    if r.mode == "r" and risk == "risky":
        store.add_log(r.session, f"⚠ YOLO: riskli işlem onaysız çalıştı: {log_text}", "w")
    cp = None
    if risk != "safe" and not _is_restricted_session(r.session):
        ref = await asyncio.to_thread(checkpoints.snapshot, WORKSPACE)
        if ref:
            store.add_checkpoint(r.session, ref, log_text)
            cp = len(store.pending_checkpoints(r.session))
            store.add_log(r.session, f"● Checkpoint alındı (#{cp}) → {log_text}", "ok")
        else:
            store.add_log(r.session, "● Checkpoint alınamadı (git deposu yok)", "w")
    if r.force_provider == "local":
        dec = router.Decision(
            provider="local",
            label=PROVIDERS["local"]["label"],
            reason="Kullanıcı yerel modele yönlendirdi",
            fallback=True,
        )
    else:
        if providers.agy_available():
            asyncio.create_task(asyncio.to_thread(store.fetch_agy_usage, False))
        dec = router.route(r.text, r.skill, store.used_pct, has_images=bool(r.images))
    store.add_log(r.session, f"İş başladı → {dec.label}: {log_text}")
    _tasks[r.session] = asyncio.create_task(_job(r, dec))
    emit("log")
    return {"status": "started", "route": dec.dict(), "risk": risk,
            "checkpoints": len(store.pending_checkpoints(r.session))}


@app.post("/api/stop")
async def stop(r: SessionReq):
    killed = providers.kill_session_proc(r.session)
    t = _tasks.pop(r.session, None)
    if t:
        t.cancel()
    store.add_log(r.session, "■ Acil durdurma", "w")
    emit("log")
    return {"stopped": bool(t or killed)}


@app.post("/api/clear")
async def clear_session(r: SessionReq):
    store.set_conv_id(r.session, None)
    store.set_compact_ctx(r.session, None)
    store.clear_chat_msgs(r.session)
    _src_hashes.pop(r.session, None)
    store.add_log(r.session, "🧹 Oturum bağlamı sıfırlandı", "m")
    emit("log")
    return {"cleared": True}


_COMPACT_PROMPT = (
    "Bu sohbeti yeni ve temiz bir oturuma aktarmak için sıkıştırılmış teknik özet çıkar. "
    "Sadece şunları kısa maddeler halinde yaz: "
    "(1) Ana amaç ve çözülen konular, (2) Alınan kararlar ve değiştirilen dosya/sembol adları, "
    "(3) Açık kalan işler veya önemli kısıtlar. Gereksiz sohbet cümlelerini atla."
)


@app.post("/api/compact")
async def compact_session(r: CompactReq):
    conv_id = store.get_conv_id(r.session)
    if not conv_id:
        recent = [m.strip() for m in r.recent_msgs if m and m.strip()][-5:]
        summary = " · ".join(recent) if recent else "(henüz içerik yok)"
        store.clear_chat_msgs(r.session)
        return {
            "compacted": True,
            "real": False,
            "summary": summary,
            "label": "yerel özetleyici",
            "tokens": 0,
        }

    dec = router.route("Bu konuşmayı özetle", "compact", store.used_pct, has_images=False)
    try:
        text, tokens, real, _ = await providers.complete(
            dec.provider,
            _COMPACT_PROMPT,
            session=r.session,
            mode="y",
            effort="low",
            conv_id=conv_id,
        )
    except Exception as e:
        raise HTTPException(500, f"Bağlam sıkıştırma başarısız: {e}")

    summary = (text or "").strip()
    if not real or not summary:
        raise HTTPException(502, "Modelden gerçek özet alınamadı; mevcut oturum korundu.")

    store.record_usage(dec.provider, tokens, True)
    store.set_conv_id(r.session, None)
    store.set_compact_ctx(r.session, summary)
    store.clear_chat_msgs(r.session)
    store.add_log(r.session, f"🗜 Bağlam sıkıştırıldı ({dec.label})", "m")
    emit("log")
    return {
        "compacted": True,
        "real": True,
        "summary": summary,
        "label": dec.label,
        "tokens": tokens,
    }


@app.post("/api/undo")
async def undo(r: SessionReq):
    cps = store.pending_checkpoints(r.session)
    if not cps:
        raise HTTPException(404, "Geri alınacak checkpoint yok")
    try:
        await asyncio.to_thread(checkpoints.restore, WORKSPACE, cps[0]["ref"])
    except Exception as e:
        raise HTTPException(500, f"Geri alma başarısız: {e}")
    store.mark_undone(r.session)
    store.add_log(r.session, f"↶ {len(cps)} checkpoint geri alındı", "w")
    emit("log")
    return {"undone": len(cps)}


class MediaCmdReq(BaseModel):
    action: str
    app: str = ""
    position_ms: int | None = None


class MediaOpenReq(BaseModel):
    app: str = ""
    title: str = ""
    platform: str = ""


@app.get("/api/media/status")
async def media_status(app: str = ""):
    return await asyncio.to_thread(media.get_status, app)


@app.post("/api/media/cmd")
async def media_cmd(r: MediaCmdReq):
    res = await asyncio.to_thread(media.send_cmd, r.action, r.app, r.position_ms)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "Medya komutu başarısız"))
    return res


@app.post("/api/media/open")
async def media_open(r: MediaOpenReq):
    res = await asyncio.to_thread(media.open_app, r.app, r.title, r.platform)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "Medya uygulaması açılamadı"))
    return res


def _open_external_target(target: str, reveal: bool) -> dict:
    """Open URL or local file/folder in system shell."""
    trimmed = target.strip()
    if not trimmed:
        raise HTTPException(400, "Boş hedef")

    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    low = trimmed.lower()
    if low.startswith(("http://", "https://", "mailto:")):
        subprocess.Popen(["rundll32.exe", "url.dll,FileProtocolHandler", trimmed], creationflags=no_window)
        return {"ok": True, "kind": "url", "path": trimmed}

    if low.startswith("file:///"):
        path_str = unquote(trimmed[8:])
    elif low.startswith("file://"):
        path_str = unquote(trimmed[7:])
    else:
        path_str = trimmed

    if path_str.startswith(("~/", "~\\")):
        path_str = os.path.expanduser("~") + path_str[1:]
    path_str = path_str.replace("/", "\\")

    path = Path(path_str)
    if not path.is_absolute():
        in_root = ROOT / path
        in_vault = VAULT_DIR / path
        if in_root.exists():
            path = in_root
        elif in_vault.exists():
            path = in_vault

    if path.is_dir():
        subprocess.Popen(["explorer.exe", str(path)], creationflags=no_window)
        return {"ok": True, "kind": "dir", "path": str(path)}
    if path.is_file():
        if reveal:
            subprocess.Popen(["explorer.exe", f"/select,{path}"], creationflags=no_window)
            return {"ok": True, "kind": "reveal", "path": str(path)}
        os.startfile(str(path))
        return {"ok": True, "kind": "file", "path": str(path)}
    if path.parent.is_dir():
        subprocess.Popen(["explorer.exe", str(path.parent)], creationflags=no_window)
        return {"ok": True, "kind": "parent", "path": str(path.parent)}
    raise HTTPException(404, f"Yol bulunamadı: {path}")


@app.post("/api/open")
async def open_target_ep(r: OpenTargetReq):
    return await asyncio.to_thread(_open_external_target, r.target, r.reveal)


@app.middleware("http")
async def _no_cache(request, call_next):
    resp = await call_next(request)
    path = request.url.path
    if not path.startswith("/api/"):
        # no-cache: ETag ile dogrula (degismediyse 304), her seferinde 570 KB indirme yok
        resp.headers["Cache-Control"] = "no-cache"
    elif request.method not in ("GET", "HEAD", "OPTIONS"):
        _VAULT_CACHE["v"] = None  # yazma sonrasi kasa onbellegini gecersiz kil
    return resp

app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="ui")
