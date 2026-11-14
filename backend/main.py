"""Atölye backend: görev yönlendirme, kota, izinler, checkpoint, SSE olayları."""
import asyncio
import json

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import checkpoints, config, media, permissions, providers, router, store, vault
from .config import PROVIDERS, ROOT, VAULT_DIR, WORKSPACE

WS_HINT = (
    f"[Atölye Çalışma İstasyonu — Gerçek Obsidian Kasası ({VAULT_DIR}) sol panelde ve sekmelerde zaten bağlıdır. "
    "Ders Klasörleri ve Ana İndeksler: "
    "[[00_DIFRANSIYEL_DENKLEMLER_ANA_INDEKS]] (Diferansiyel Denklemler: [[01_Birinci_Mertebeden_Dif_Denklemler_Tam_Rehber]], [[02_Yuksek_Mertebeden_Sabit_Katsayili_Lineer_Denklemler]], [[03_CIKMIS_VIZE_SORULARI_VE_HOCA_TUZAKLARI]], [[DIFRANSIYEL_DENKLEMLER_VIZE_TEK_PARCA_TAM_NOT]]), "
    "[[00_LAB_CALISMA_PLANI]] (Elektrik Makinaları Lab: [[Deney_1_DC_Sont_Motor]], [[Deney_2_Tek_Fazli_Transformator]], [[Deney_3_Uc_Fazli_Transformator]], [[Quiz_Hoca_Tuzak_Sorulari_ve_Cozumler]]), "
    "[[00_KSG_ANA_INDEKS]] (Kontrol Sistemlerine Giriş: [[01_Kontrol_Sistemlerine_Giris_ve_Temel_Kavramlar]], [[02_Laplace_Donusumu_ve_Transfer_Fonksiyonu_Modelleme]], [[03_Blok_Diyagramlari_Elemanlar_ve_Temel_Indirgeme_Kurallari]], [[04_Cok_Cevrimli_Sistemler_ve_Bozucu_Girisli_Blok_Indirgeme]], [[05_QUIZ_SORU_BANKASI_COZUMLU]], [[KSG_QUIZ_TEK_PARCA_TAM_NOT]]), "
    "[[00_YUKSEK_GERILIM_ANA_INDEKS]] (Yüksek Gerilim Tekniği: [[01_YG_Giris_Trafo_Merkezi_ve_Temel_Elemanlar]], [[02_Ayiricilar_ve_Kesiciler_Manevra_Siralari]], [[03_Hatlar_Iletkenler_Direkler_Izolatorler_Kablolar_Baralar]], [[04_Olcme_Koruma_Kumanda_ve_Gerilim_Ayar_Elemanlari]], [[05_Desarj_Olaylari_Elektrot_Sistemleri_ve_Odev_Cozumleri]], [[06_QUIZ_SINIFLANDIRMA_VE_SIRALAMA_SORU_BANKASI]], [[YUKSEK_GERILIM_QUIZ_TEK_PARCA_TAM_NOT]]), "
    "[[00_SECMELI_TASARIM_ANA_INDEKS]] (Seçmeli Tasarım: [[01_Termal_Kamera_Verileri_ve_Analizi_5N1K]], [[02_IHA_Goruntuleri_ile_Arazi_Analizi_5N1K]]). "
    f"ÖNEMLİ: Kullanıcı bir notu açmanı isterse disk taraması yapma veya frontend kodunu değiştirme; yalnızca yanıtında [[Dosya_Adi]] şeklinde yaz, arayüz o sekmeyi otomatik açar. Yeni not oluşturman istenirse doğrudan {VAULT_DIR} altındaki ilgili kasa klasörüne .md dosyası olarak yaz. "
    "GÖRSEL KURALLARI: Arayüz yanıtını markdown olarak çizer. Matematiği $...$ veya $$...$$ ile yaz (ör. $I_A$, $R_{fe}$). "
    "ASCII sanat ÇİZME. Devre şemaları için şu hazır blokları kullan (blok içi boş kalabilir; arayüz gerçek direnç/bobin sembolleriyle çizer): ```sema trafo-esdeger``` (tam eşdeğer devre), ```sema trafo-bosta``` (boşta çalışma / demir kaybı), ```sema trafo-kisadevre``` (kısa devre / bakır kaybı), ```sema trafo-baglanti``` (tüm 3 fazlı Y/Δ grupları) veya ```sema trafo-baglanti-yy``` / ```-yd``` / ```-dy``` / ```-dd```, ```sema dc-sont``` (DC şönt motor). Kod bloklarında dili belirt (ör. ```c, ```python). "
    "Diğer akış/blok şemalarını ```mermaid``` bloğu ile ver; düğüm etiketlerinde indis için alt çizgi kullanma, düz yaz (ör. IA, RF).]\n\n"
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


class LogReq(BaseModel):
    session: str
    msg: str
    kind: str = ""


class SessionReq(BaseModel):
    session: str


class NoteSaveReq(BaseModel):
    rel: str
    content: str


class KasaCreateReq(BaseModel):
    title: str
    tag: str = "Çalışma Kasası"
    desc: str = ""
    icon: str = "📘"


class NoteCreateReq(BaseModel):
    kasa: str
    title: str
    content: str = ""


class CalEventReq(BaseModel):
    day: int
    title: str
    kind: str = "task"
    kasa: str = ""


class ChatMsgReq(BaseModel):
    session: str
    w: str
    h: str


@app.get("/api/health")
async def health():
    return {"ok": True, "agy": providers.agy_available(),
            "ollama": await providers.ollama_alive(),
            "git_checkpoints": checkpoints.available(WORKSPACE),
            "vault": str(VAULT_DIR),
            "running": {s: _steps.get(s, "Çalışıyor…") for s in _tasks}}


@app.get("/api/ping")
async def ping():
    return {"ok": True}


@app.get("/api/vault")
async def get_vault():
    return vault.scan_vault()


@app.post("/api/kasa")
async def create_kasa_ep(r: KasaCreateReq):
    try:
        res = vault.create_kasa(r.title, r.tag, r.desc, r.icon)
        store.add_log("vault", f"❖ Yeni kasa oluşturuldu: {r.title}", "ok")
        emit("log")
        return res
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
async def quota():
    return store.quota_status()


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


async def _job(r: RunReq, dec: router.Decision):
    loop = asyncio.get_running_loop()
    try:
        emit("step", session=r.session, step=f"Yönlendiriliyor → {dec.label}")
        await asyncio.sleep(0.2)
        init_step = (
            f"{dec.label} çalışıyor… ({dec.reason})"
            if dec.provider == "local"
            else f"{dec.label} ({config.effective_effort(dec.provider, r.effort)}) çalışıyor… ({dec.reason})"
        )
        emit("step", session=r.session, step=init_step)
        conv_id = store.get_conv_id(r.session)
        src_ctx = await asyncio.to_thread(vault.build_context_from_sources, r.sources, r.active_note)
        img_paths = await asyncio.to_thread(vault.resolve_chat_images, r.images)
        img_ctx = vault.build_image_prompt_block(img_paths)
        user_text = "Eklenen görseli incele ve içeriğini açıkla." if (not r.text.strip() and img_paths) else r.text
        base_prompt = f"{src_ctx}{img_ctx}{user_text}"
        prompt = f"{WS_HINT}{base_prompt}" if not conv_id else base_prompt
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
            on_step=lambda st: loop.call_soon_threadsafe(lambda s=st: emit("step", session=r.session, step=s)),
            on_failover=_on_failover,
        )
        used_effort = None if dec.provider == "local" else config.effective_effort(dec.provider, r.effort)
        if new_conv:
            store.set_conv_id(r.session, new_conv)
        if real:  # DEMO/yer tutucu yanıtlar gerçek kotadan sayılmaz
            store.record_usage(dec.provider, tokens, real)
        store.add_log(r.session, f"✓ Tamamlandı ({dec.label}{'' if real else ', DEMO'}): {log_text}", "ok")
        if not _subs:
            store.add_chat_msg(r.session, "a", text)
        emit("done", session=r.session, reply=text, real=real, tokens=tokens,
             conv_id=new_conv, route=dec.dict(), effort=used_effort, quota=store.quota_status())
        emit("log")
    except asyncio.CancelledError:
        providers.kill_session_proc(r.session)
        raise
    except Exception as e:  # sağlayıcı hatası kullanıcıya gösterilir
        store.add_log(r.session, f"✗ Hata ({dec.label}): {e}", "w")
        emit("error", session=r.session, error=str(e), quota=store.quota_status())
        emit("log")
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
    if risk != "safe":
        ref = await asyncio.to_thread(checkpoints.snapshot, WORKSPACE)
        if ref:
            store.add_checkpoint(r.session, ref, log_text)
            cp = len(store.pending_checkpoints(r.session))
            store.add_log(r.session, f"● Checkpoint alındı (#{cp}) → {log_text}", "ok")
        else:
            store.add_log(r.session, "● Checkpoint alınamadı (git deposu yok)", "w")
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
    store.clear_chat_msgs(r.session)
    store.add_log(r.session, "🧹 Oturum bağlamı sıfırlandı", "m")
    emit("log")
    return {"cleared": True}


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


@app.get("/api/media/status")
async def media_status(app: str = ""):
    return await asyncio.to_thread(media.get_status, app)


@app.post("/api/media/cmd")
async def media_cmd(r: MediaCmdReq):
    res = await asyncio.to_thread(media.send_cmd, r.action, r.app, r.position_ms)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "Medya komutu başarısız"))
    return res


@app.middleware("http")
async def _no_cache(request, call_next):
    resp = await call_next(request)
    if not request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp

app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="ui")
