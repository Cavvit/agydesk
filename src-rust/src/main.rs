#![windows_subsystem = "windows"]

mod checkpoints;
mod config;
mod media;
mod permissions;
mod providers;
mod router;
mod store;
mod vault;

use axum::{
    body::Bytes,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{delete, get, post},
    Json, Router,
};
use config::{provider_spec, ROOT, VAULT_DIR, WORKSPACE};
use futures_util::stream::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    net::TcpStream,
    os::windows::process::CommandExt,
    path::Path,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt as _;
use tower_http::{cors::CorsLayer, services::ServeDir, services::ServeFile};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DETACHED_PROCESS: u32 = 0x00000008;

/// Opt out of Windows 10/11 EcoQoS execution-speed throttling so WebView2 UI stays responsive on battery / silent mode.
fn disable_windows_power_throttling() {
    #[repr(C)]
    struct ProcessPowerThrottlingState {
        version: u32,
        control_mask: u32,
        state_mask: u32,
    }
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn SetProcessInformation(
            hprocess: isize,
            process_information_class: i32,
            process_information: *const ProcessPowerThrottlingState,
            process_information_size: u32,
        ) -> i32;
    }
    const PROCESS_POWER_THROTTLING: i32 = 4;
    const PROCESS_POWER_THROTTLING_CURRENT_VERSION: u32 = 1;
    const PROCESS_POWER_THROTTLING_EXECUTION_SPEED: u32 = 0x1;
    let state = ProcessPowerThrottlingState {
        version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        control_mask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        state_mask: 0,
    };
    unsafe {
        let _ = SetProcessInformation(
            GetCurrentProcess(),
            PROCESS_POWER_THROTTLING,
            &state as *const ProcessPowerThrottlingState,
            std::mem::size_of::<ProcessPowerThrottlingState>() as u32,
        );
    }
}

#[derive(Clone)]
struct AppState {
    tx: broadcast::Sender<Value>,
    tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    steps: Arc<Mutex<HashMap<String, String>>>,
    auth_needed: Arc<AtomicBool>,
    auth_running: Arc<AtomicBool>,
}

impl AppState {
    fn emit(&self, event: &str, mut data: Value) {
        if event == "step" {
            if let (Some(sess), Some(st)) = (
                data.get("session").and_then(|v| v.as_str()),
                data.get("step").and_then(|v| v.as_str()),
            ) {
                if let Ok(mut map) = self.steps.lock() {
                    map.insert(sess.to_string(), st.to_string());
                }
            }
        }
        if let Some(obj) = data.as_object_mut() {
            obj.insert("event".to_string(), json!(event));
        }
        let _ = self.tx.send(data);
    }
}

fn ws_hint() -> String {
    let vd = VAULT_DIR.to_string_lossy();
    let write_rule = if vault::is_split_vault() {
        format!(
            "Yeni not (.md) oluşturman istenirse {vd}\\AgyDesk_Notlar\\<Kasa>\\ altına, belge/görsel (.pdf, .docx, .pptx, .png vb.) oluşturman istenirse {vd}\\AgyDesk_Dokuman\\<Kasa>\\ altına yaz."
        )
    } else {
        format!("Yeni not oluşturman istenirse doğrudan {vd} altındaki ilgili kasa klasörüne .md dosyası olarak yaz.")
    };
    format!(
        "[Atölye Çalışma İstasyonu — Gerçek Obsidian Kasası ({vd}) sol panelde ve sekmelerde zaten bağlıdır. \
Ders Klasörleri ve Ana İndeksler: \
[[00_DIFRANSIYEL_DENKLEMLER_ANA_INDEKS]] (Diferansiyel Denklemler: [[01_Birinci_Mertebeden_Dif_Denklemler_Tam_Rehber]], [[02_Yuksek_Mertebeden_Sabit_Katsayili_Lineer_Denklemler]], [[03_CIKMIS_VIZE_SORULARI_VE_HOCA_TUZAKLARI]], [[DIFRANSIYEL_DENKLEMLER_VIZE_TEK_PARCA_TAM_NOT]]), \
[[00_LAB_CALISMA_PLANI]] (Elektrik Makinaları Lab: [[Deney_1_DC_Sont_Motor]], [[Deney_2_Tek_Fazli_Transformator]], [[Deney_3_Uc_Fazli_Transformator]], [[Quiz_Hoca_Tuzak_Sorulari_ve_Cozumler]]), \
[[00_KSG_ANA_INDEKS]] (Kontrol Sistemlerine Giriş: [[01_Kontrol_Sistemlerine_Giris_ve_Temel_Kavramlar]], [[02_Laplace_Donusumu_ve_Transfer_Fonksiyonu_Modelleme]], [[03_Blok_Diyagramlari_Elemanlar_ve_Temel_Indirgeme_Kurallari]], [[04_Cok_Cevrimli_Sistemler_ve_Bozucu_Girisli_Blok_Indirgeme]], [[05_QUIZ_SORU_BANKASI_COZUMLU]], [[KSG_QUIZ_TEK_PARCA_TAM_NOT]]), \
[[00_YUKSEK_GERILIM_ANA_INDEKS]] (Yüksek Gerilim Tekniği: [[01_YG_Giris_Trafo_Merkezi_ve_Temel_Elemanlar]], [[02_Ayiricilar_ve_Kesiciler_Manevra_Siralari]], [[03_Hatlar_Iletkenler_Direkler_Izolatorler_Kablolar_Baralar]], [[04_Olcme_Koruma_Kumanda_ve_Gerilim_Ayar_Elemanlari]], [[05_Desarj_Olaylari_Elektrot_Sistemleri_ve_Odev_Cozumleri]], [[06_QUIZ_SINIFLANDIRMA_VE_SIRALAMA_SORU_BANKASI]], [[YUKSEK_GERILIM_QUIZ_TEK_PARCA_TAM_NOT]]), \
[[00_SECMELI_TASARIM_ANA_INDEKS]] (Seçmeli Tasarım: [[01_Termal_Kamera_Verileri_ve_Analizi_5N1K]], [[02_IHA_Goruntuleri_ile_Arazi_Analizi_5N1K]]). \
ÖNEMLİ: Kullanıcı bir notu açmanı isterse disk taraması yapma veya frontend kodunu değiştirme; yalnızca yanıtında [[Dosya_Adi]] şeklinde yaz, arayüz o sekmeyi otomatik açar. {write_rule} \
GÖRSEL KURALLARI: Arayüz yanıtını markdown olarak çizer. Matematiği $...$ veya $$...$$ ile yaz (ör. $I_A$, $R_{{fe}}$). \
ASCII sanat ÇİZME. Devre şemaları için şu hazır blokları kullan (blok içi boş kalabilir; arayüz gerçek direnç/bobin sembolleriyle çizer): ```sema trafo-esdeger``` (tam eşdeğer devre), ```sema trafo-bosta``` (boşta çalışma / demir kaybı), ```sema trafo-kisadevre``` (kısa devre / bakır kaybı), ```sema trafo-baglanti``` (tüm 3 fazlı Y/Δ grupları) veya ```sema trafo-baglanti-yy``` / ```-yd``` / ```-dy``` / ```-dd```, ```sema dc-sont``` (DC şönt motor). Kod bloklarında dili belirt (ör. ```c, ```python). \
Diğer akış/blok şemalarını ```mermaid``` bloğu ile ver; düğüm etiketlerinde indis için alt çizgi kullanma, düz yaz (ör. IA, RF).]\n\n"
    )
}

#[derive(Deserialize, Clone)]
struct RunReq {
    session: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    images: Vec<String>,
    #[serde(default)]
    skill: Option<String>,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default = "default_effort")]
    effort: String,
    #[serde(default)]
    allow: HashMap<String, bool>,
    #[serde(default)]
    approved: bool,
    #[serde(default)]
    sources: Vec<String>,
    #[serde(default)]
    active_note: Option<String>,
    #[serde(default)]
    force_provider: Option<String>,
}

fn default_mode() -> String {
    "y".to_string()
}

fn default_effort() -> String {
    "low".to_string()
}

#[derive(Deserialize)]
struct LogReq {
    session: String,
    msg: String,
    #[serde(default)]
    kind: String,
}

#[derive(Deserialize)]
struct SessionReq {
    session: String,
}

#[derive(Deserialize)]
struct NoteSaveReq {
    rel: String,
    content: String,
}

#[derive(Deserialize)]
struct KasaCreateReq {
    title: String,
    #[serde(default = "default_kasa_tag")]
    tag: String,
    #[serde(default)]
    desc: String,
    #[serde(default = "default_kasa_icon")]
    icon: String,
    #[serde(default)]
    space: String,
    #[serde(default)]
    accent: String,
}
fn default_kasa_tag() -> String {
    "Çalışma Kasası".to_string()
}
fn default_kasa_icon() -> String {
    "📘".to_string()
}

#[derive(Deserialize)]
struct KasaUpdateReq {
    key: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    desc: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    accent: Option<String>,
    #[serde(default)]
    space: Option<String>,
}

#[derive(Deserialize)]
struct SpaceSaveReq {
    #[serde(default)]
    id: Option<String>,
    title: String,
    #[serde(default = "default_space_icon")]
    icon: String,
    #[serde(default = "default_space_accent")]
    accent: String,
    #[serde(default)]
    tag: String,
    #[serde(default)]
    desc: String,
}
fn default_space_icon() -> String {
    "🗂".to_string()
}
fn default_space_accent() -> String {
    "#e0a458".to_string()
}

#[derive(Deserialize)]
struct SpaceDelQuery {
    id: String,
}

#[derive(Deserialize)]
struct NoteCreateReq {
    kasa: String,
    title: String,
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
struct FolderCreateReq {
    parent: String,
    name: String,
}

#[derive(Deserialize)]
struct VaultMoveReq {
    src: String,
    #[serde(default)]
    target: String,
    #[serde(default = "default_move_pos")]
    position: String,
}
fn default_move_pos() -> String {
    "into".to_string()
}

#[derive(Deserialize)]
struct CalEventReq {
    day: i64,
    title: String,
    #[serde(default = "default_cal_kind")]
    kind: String,
    #[serde(default)]
    kasa: String,
}
fn default_cal_kind() -> String {
    "task".to_string()
}

#[derive(Deserialize)]
struct ChatMsgReq {
    session: String,
    w: String,
    h: String,
}

#[derive(Deserialize)]
struct RelQuery {
    rel: String,
}

#[derive(Deserialize)]
struct UploadQuery {
    name: String,
    #[serde(default)]
    note: String,
}

fn err_resp(code: StatusCode, msg: String) -> Response {
    (code, Json(json!({ "detail": msg }))).into_response()
}

async fn health_ep(State(st): State<AppState>) -> Json<Value> {
    let ollama = providers::ollama_alive().await;
    let mut running = serde_json::Map::new();
    if let (Ok(tasks), Ok(steps)) = (st.tasks.lock(), st.steps.lock()) {
        for k in tasks.keys() {
            let step = steps
                .get(k)
                .cloned()
                .unwrap_or_else(|| "Çalışıyor…".to_string());
            running.insert(k.clone(), json!(step));
        }
    }
    Json(json!({
        "ok": true,
        "engine": "rust-native",
        "agy": providers::agy_available(),
        "ollama": ollama,
        "git_checkpoints": checkpoints::available(&WORKSPACE),
        "vault": VAULT_DIR.to_string_lossy(),
        "running": running,
        "auth_needed": st.auth_needed.load(Ordering::Relaxed),
        "auth_running": st.auth_running.load(Ordering::Relaxed)
    }))
}

async fn ping_ep() -> Json<Value> {
    Json(json!({ "ok": true, "engine": "rust" }))
}

async fn get_ui_state_ep() -> Json<Value> {
    Json(Value::Object(store::get_ui_state()))
}

async fn set_ui_state_ep(body: Bytes) -> Response {
    let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(&body) else {
        return err_resp(StatusCode::BAD_REQUEST, "Geçersiz JSON nesnesi".to_string());
    };
    store::set_ui_state(&map);
    Json(json!({ "ok": true })).into_response()
}

async fn get_vault_ep() -> Json<Value> {
    let v = tokio::task::spawn_blocking(vault::scan_vault)
        .await
        .unwrap_or_else(|_| json!({}));
    Json(v)
}

async fn create_kasa_ep(
    State(st): State<AppState>,
    Json(r): Json<KasaCreateReq>,
) -> Response {
    match vault::create_kasa(&r.title, &r.tag, &r.desc, &r.icon, &r.space, &r.accent) {
        Ok(res) => {
            store::add_log("vault", &format!("❖ Yeni kasa oluşturuldu: {}", r.title), "ok");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn update_kasa_ep(
    State(st): State<AppState>,
    Json(r): Json<KasaUpdateReq>,
) -> Response {
    match vault::update_kasa(
        &r.key,
        r.title.as_deref(),
        r.tag.as_deref(),
        r.desc.as_deref(),
        r.icon.as_deref(),
        r.accent.as_deref(),
        r.space.as_deref(),
    ) {
        Ok(res) => {
            let lbl = res
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or(&r.key);
            store::add_log("vault", &format!("❖ Kasa güncellendi: {}", lbl), "ok");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) if e.starts_with("Kasa bulunamadı:") => err_resp(StatusCode::NOT_FOUND, e),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn save_space_ep(
    State(st): State<AppState>,
    Json(r): Json<SpaceSaveReq>,
) -> Response {
    match vault::save_space(
        r.id.as_deref(),
        &r.title,
        &r.icon,
        &r.accent,
        &r.tag,
        &r.desc,
    ) {
        Ok(res) => {
            let ttl = res
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(&r.title);
            store::add_log("vault", &format!("🗂 Alan kaydedildi: {}", ttl), "ok");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) if e.starts_with("Alan bulunamadı:") => err_resp(StatusCode::NOT_FOUND, e),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn delete_space_ep(
    State(st): State<AppState>,
    Query(q): Query<SpaceDelQuery>,
) -> Response {
    match vault::delete_space(&q.id) {
        Ok(res) => {
            store::add_log("vault", &format!("🗂 Alan silindi: {}", q.id), "w");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) if e.starts_with("Alan bulunamadı:") => err_resp(StatusCode::NOT_FOUND, e),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn create_folder_ep(
    State(st): State<AppState>,
    Json(r): Json<FolderCreateReq>,
) -> Response {
    match vault::create_folder(&r.parent, &r.name) {
        Ok(res) => {
            let rel = res.get("rel").and_then(|v| v.as_str()).unwrap_or("");
            store::add_log("vault", &format!("📁 Yeni klasör oluşturuldu: {}", rel), "ok");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) => {
            let code = if e.contains("bulunamadı") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            err_resp(code, e)
        }
    }
}

async fn move_vault_item_ep(
    State(st): State<AppState>,
    Json(r): Json<VaultMoveReq>,
) -> Response {
    match vault::move_item(&r.src, &r.target, &r.position) {
        Ok(res) => {
            let moved = res.get("moved").and_then(|v| v.as_bool()).unwrap_or(false);
            let reordered = res.get("reordered").and_then(|v| v.as_bool()).unwrap_or(false);
            if moved {
                let old_rel = res.get("old_rel").and_then(|v| v.as_str()).unwrap_or("");
                let new_rel = res.get("new_rel").and_then(|v| v.as_str()).unwrap_or("");
                store::add_log("vault", &format!("📦 Taşındı: {} → {}", old_rel, new_rel), "ok");
                st.emit("log", json!({}));
            } else if reordered {
                let new_rel = res.get("new_rel").and_then(|v| v.as_str()).unwrap_or("");
                store::add_log("vault", &format!("↕ Sıralama güncellendi: {}", new_rel), "ok");
                st.emit("log", json!({}));
            }
            Json(res).into_response()
        }
        Err(e) => {
            let code = if e.contains("bulunamadı") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            err_resp(code, e)
        }
    }
}

async fn get_note_ep(Query(q): Query<RelQuery>) -> Response {
    match vault::read_note(&q.rel) {
        Ok(res) => Json(res).into_response(),
        Err(e) => err_resp(StatusCode::NOT_FOUND, e),
    }
}

async fn save_note_ep(
    State(st): State<AppState>,
    Json(r): Json<NoteSaveReq>,
) -> Response {
    match vault::write_note(&r.rel, &r.content) {
        Ok(res) => {
            store::add_log("vault", &format!("💾 Not kaydedildi: {}", r.rel), "ok");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn create_note_ep(
    State(st): State<AppState>,
    Json(r): Json<NoteCreateReq>,
) -> Response {
    match vault::create_note(&r.kasa, &r.title, &r.content) {
        Ok(res) => {
            let rel = res.get("rel").and_then(|v| v.as_str()).unwrap_or("");
            store::add_log("vault", &format!("📝 Yeni not oluşturuldu: {}", rel), "ok");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn delete_note_ep(
    State(st): State<AppState>,
    Query(q): Query<RelQuery>,
) -> Response {
    match vault::delete_note(&q.rel) {
        Ok(res) => {
            store::add_log("vault", &format!("🗑 Not silindi: {}", q.rel), "w");
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn get_calendar_ep() -> Json<Value> {
    Json(json!(store::get_cal_events()))
}

async fn post_calendar_ep(
    State(st): State<AppState>,
    Json(r): Json<CalEventReq>,
) -> Response {
    if r.title.trim().is_empty() || !(1..=31).contains(&r.day) {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "Geçersiz gün veya başlık".to_string(),
        );
    }
    let ev = store::add_cal_event(r.day, &r.title, &r.kind, &r.kasa);
    store::add_log(
        "takvim",
        &format!("▦ Takvime eklendi ({} Kas): {}", r.day, r.title),
        "ok",
    );
    st.emit("log", json!({}));
    Json(ev).into_response()
}

async fn delete_calendar_ep(AxumPath(ev_id): AxumPath<i64>) -> Json<Value> {
    store::del_cal_event(ev_id);
    Json(json!({ "deleted": ev_id }))
}

async fn upload_asset_ep(
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Response {
    match vault::save_asset(&q.note, &q.name, &body) {
        Ok(res) => Json(res).into_response(),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn get_docx_ep(Query(q): Query<RelQuery>) -> Response {
    match vault::docx_to_html(&q.rel) {
        Ok(res) => Json(res).into_response(),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn get_pptx_ep(Query(q): Query<RelQuery>) -> Response {
    let rel = q.rel.clone();
    let res = tokio::task::spawn_blocking(move || vault::pptx_to_slides(&rel))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(val) => Json(val).into_response(),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn get_pdf_info_ep(Query(q): Query<RelQuery>) -> Response {
    let rel = q.rel.clone();
    let res = tokio::task::spawn_blocking(move || vault::pdf_info(&rel))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn raw_file_ep(
    AxumPath(rel): AxumPath<String>,
    req: axum::extract::Request,
) -> Response {
    let Ok(p) = vault::safe_path(&rel) else {
        return err_resp(StatusCode::BAD_REQUEST, "Geçersiz dosya yolu".to_string());
    };
    if !p.exists() {
        return err_resp(StatusCode::NOT_FOUND, "Dosya bulunamadı".to_string());
    }
    match tower::ServiceExt::oneshot(ServeFile::new(p), req).await {
        Ok(r) => r.into_response(),
        Err(e) => err_resp(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

async fn get_chats_ep() -> Json<Value> {
    Json(json!(store::get_chat_msgs()))
}

async fn post_chat_ep(Json(r): Json<ChatMsgReq>) -> Json<Value> {
    store::add_chat_msg(&r.session, &r.w, &r.h);
    Json(json!({ "ok": true }))
}

#[derive(Deserialize, Default)]
struct QuotaQuery {
    #[serde(default)]
    refresh: Option<String>,
}

async fn quota_ep(Query(q): Query<QuotaQuery>) -> Json<Value> {
    let force = matches!(
        q.refresh.as_deref(),
        Some("1") | Some("true") | Some("yes")
    );
    let rows = tokio::task::spawn_blocking(move || store::quota_status_with(true, force))
        .await
        .unwrap_or_default();
    Json(json!(rows))
}

async fn get_log_ep() -> Json<Value> {
    Json(json!(store::get_log(60)))
}

async fn post_log_ep(State(st): State<AppState>, Json(r): Json<LogReq>) -> Json<Value> {
    store::add_log(&r.session, &r.msg, &r.kind);
    st.emit("log", json!({}));
    Json(json!({ "ok": true }))
}

async fn events_ep(
    State(st): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = st.tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(val) => Some(Ok(Event::default().data(val.to_string()))),
        Err(_) => None,
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping"))
}

async fn run_job(st: AppState, r: RunReq, mut dec: router::Decision) {
    let sess = r.session.clone();
    st.emit(
        "step",
        json!({
            "session": sess,
            "step": format!("Yönlendiriliyor → {}", dec.label)
        }),
    );
    tokio::time::sleep(Duration::from_millis(120)).await;
    let init_step = if dec.provider == "local" {
        format!("{} çalışıyor… ({})", dec.label, dec.reason)
    } else {
        let eff = config::effective_effort(&dec.provider, &r.effort);
        format!("{} ({}) çalışıyor… ({})", dec.label, eff, dec.reason)
    };
    st.emit(
        "step",
        json!({
            "session": sess,
            "step": init_step
        }),
    );

    let conv_id = store::get_conv_id(&sess);
    let sources_c = r.sources.clone();
    let active_c = r.active_note.clone();
    let images_c = r.images.clone();
    let (src_ctx, img_paths) = tokio::task::spawn_blocking(move || {
        let sc = vault::build_context_from_sources(&sources_c, active_c.as_deref());
        let imgs = vault::resolve_chat_images(&images_c);
        (sc, imgs)
    })
    .await
    .unwrap_or_default();

    let img_ctx = vault::build_image_prompt_block(&img_paths);
    let user_text = if r.text.trim().is_empty() && !img_paths.is_empty() {
        "Eklenen görseli incele ve içeriğini açıkla.".to_string()
    } else {
        r.text.clone()
    };
    let base_prompt = format!("{}{}{}", src_ctx, img_ctx, user_text);
    let prompt = if conv_id.is_none() {
        format!("{}{}", ws_hint(), base_prompt)
    } else {
        base_prompt
    };
    let log_text = if r.text.trim().is_empty() && !img_paths.is_empty() {
        format!("[{} görsel]", img_paths.len())
    } else {
        r.text.clone()
    };

    let st_step = st.clone();
    let sess_step = sess.clone();
    let on_step = move |s: String| {
        st_step.emit(
            "step",
            json!({
                "session": sess_step,
                "step": s
            }),
        );
    };

    let mut failover_prov: Option<(String, String)> = None;
    let res = providers::complete(
        dec.provider.clone(),
        prompt,
        img_paths,
        sess.clone(),
        r.mode.clone(),
        r.effort.clone(),
        conv_id,
        on_step,
        |new_p, why| {
            failover_prov = Some((new_p, why));
        },
    )
    .await;

    if let Some((np, why)) = failover_prov {
        dec.label = provider_spec(&np).label.to_string();
        dec.provider = np;
        dec.reason = why;
        dec.fallback = true;
    }

    let used_effort: Option<&str> = if dec.provider == "local" {
        None
    } else {
        Some(config::effective_effort(&dec.provider, &r.effort))
    };

    match res {
        Ok((text, tokens, real, new_conv)) => {
            if dec.provider != "local" && real {
                st.auth_needed.store(false, Ordering::Relaxed);
            }
            if let Some(ref cid) = new_conv {
                store::set_conv_id(&sess, Some(cid));
            }
            if real {
                store::record_usage(&dec.provider, tokens, true);
            }
            let demo_suffix = if real { "" } else { ", DEMO" };
            store::add_log(
                &sess,
                &format!("✓ Tamamlandı ({}{}): {}", dec.label, demo_suffix, log_text),
                "ok",
            );
            if st.tx.receiver_count() == 0 {
                store::add_chat_msg(&sess, "a", &text);
            }
            let fresh_quota = tokio::task::spawn_blocking(|| store::quota_status_with(true, true))
                .await
                .unwrap_or_default();
            st.emit(
                "done",
                json!({
                    "session": sess,
                    "reply": text,
                    "real": real,
                    "tokens": tokens,
                    "conv_id": new_conv,
                    "route": dec,
                    "effort": used_effort,
                    "quota": fresh_quota
                }),
            );
            st.emit("log", json!({}));
        }
        Err(e) => {
            let auth_req = providers::is_auth_error(&e);
            let ollama_ok = if auth_req {
                st.auth_needed.store(true, Ordering::Relaxed);
                providers::ollama_alive().await
            } else {
                false
            };
            store::add_log(&sess, &format!("✗ Hata ({}): {}", dec.label, e), "w");
            let fresh_quota = tokio::task::spawn_blocking(|| store::quota_status_with(true, true))
                .await
                .unwrap_or_default();
            st.emit(
                "error",
                json!({
                    "session": sess,
                    "error": e,
                    "code": if auth_req { "auth_required" } else { "provider_error" },
                    "ollama_available": ollama_ok,
                    "quota": fresh_quota
                }),
            );
            st.emit("log", json!({}));
        }
    }

    if let Ok(mut tasks) = st.tasks.lock() {
        tasks.remove(&sess);
    }
    if let Ok(mut steps) = st.steps.lock() {
        steps.remove(&sess);
    }
}

async fn run_ep(State(st): State<AppState>, Json(r): Json<RunReq>) -> Response {
    if r.text.trim().is_empty() && r.images.is_empty() {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "Mesaj veya görsel boş olamaz".to_string(),
        );
    }
    if let Ok(tasks) = st.tasks.lock() {
        if tasks.contains_key(&r.session) {
            return err_resp(StatusCode::CONFLICT, "Oturum meşgul".to_string());
        }
    }
    let log_text = if r.text.trim().is_empty() {
        format!("[{} görsel]", r.images.len())
    } else {
        r.text.clone()
    };
    let risk = permissions::classify(&r.text, r.skill.as_deref());
    if !r.approved && permissions::needs_approval(&r.mode, risk, &r.allow) {
        store::add_log(
            &r.session,
            &format!("⏸ Onay bekleniyor ({}): {}", risk, log_text),
            "w",
        );
        st.emit("log", json!({}));
        return Json(json!({ "status": "approval", "risk": risk })).into_response();
    }
    if r.mode == "r" && risk == "risky" {
        store::add_log(
            &r.session,
            &format!("⚠ YOLO: riskli işlem onaysız çalıştı: {}", log_text),
            "w",
        );
    }
    if risk != "safe" {
        let ws = WORKSPACE.clone();
        let snap = tokio::task::spawn_blocking(move || checkpoints::snapshot(&ws))
            .await
            .ok()
            .flatten();
        if let Some(reference) = snap {
            store::add_checkpoint(&r.session, &reference, &log_text);
            let cp = store::pending_checkpoints(&r.session).len();
            store::add_log(
                &r.session,
                &format!("● Checkpoint alındı (#{}) → {}", cp, log_text),
                "ok",
            );
        } else {
            store::add_log(
                &r.session,
                "● Checkpoint alınamadı (git deposu yok)",
                "w",
            );
        }
    }

    let dec = if r.force_provider.as_deref() == Some("local") {
        router::Decision {
            provider: "local".to_string(),
            label: provider_spec("local").label.to_string(),
            reason: "Kullanıcı yerel modele yönlendirdi".to_string(),
            fallback: true,
        }
    } else {
        if providers::agy_available() {
            let _ = tokio::task::spawn_blocking(|| store::fetch_agy_usage(false)).await;
        }
        router::route(&r.text, r.skill.as_deref(), !r.images.is_empty(), store::used_pct)
    };
    store::add_log(
        &r.session,
        &format!("İş başladı → {}: {}", dec.label, log_text),
        "",
    );
    let cps_count = store::pending_checkpoints(&r.session).len();
    let sess = r.session.clone();
    let dec_ret = dec.clone();
    let st_clone = st.clone();

    let handle = tokio::spawn(async move {
        run_job(st_clone, r, dec).await;
    });
    if let Ok(mut tasks) = st.tasks.lock() {
        tasks.insert(sess, handle);
    }
    st.emit("log", json!({}));

    Json(json!({
        "status": "started",
        "route": dec_ret,
        "risk": risk,
        "checkpoints": cps_count
    }))
    .into_response()
}

async fn stop_ep(State(st): State<AppState>, Json(r): Json<SessionReq>) -> Json<Value> {
    let killed = providers::kill_session_proc(&r.session);
    let mut aborted = false;
    if let Ok(mut tasks) = st.tasks.lock() {
        if let Some(h) = tasks.remove(&r.session) {
            h.abort();
            aborted = true;
        }
    }
    if let Ok(mut steps) = st.steps.lock() {
        steps.remove(&r.session);
    }
    store::add_log(&r.session, "■ Acil durdurma", "w");
    st.emit("log", json!({}));
    Json(json!({ "stopped": killed || aborted }))
}

async fn clear_ep(State(st): State<AppState>, Json(r): Json<SessionReq>) -> Json<Value> {
    store::set_conv_id(&r.session, None);
    store::clear_chat_msgs(&r.session);
    store::add_log(&r.session, "🧹 Oturum bağlamı sıfırlandı", "m");
    st.emit("log", json!({}));
    Json(json!({ "cleared": true }))
}

#[derive(Deserialize)]
struct MediaStatusQuery {
    #[serde(default)]
    app: String,
}

#[derive(Deserialize)]
struct MediaCmdReq {
    action: String,
    #[serde(default)]
    app: String,
    #[serde(default)]
    position_ms: Option<i64>,
}

async fn media_status_ep(Query(q): Query<MediaStatusQuery>) -> Json<Value> {
    let res = tokio::task::spawn_blocking(move || media::get_status(&q.app))
        .await
        .unwrap_or_else(|_| json!({"ok": false, "active": null, "sessions": []}));
    Json(res)
}

async fn media_cmd_ep(Json(r): Json<MediaCmdReq>) -> Response {
    let res = tokio::task::spawn_blocking(move || media::send_cmd(&r.action, &r.app, r.position_ms))
        .await
        .unwrap_or_else(|_| json!({"ok": false, "error": "Medya görevi başarısız"}));
    if res.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Json(res).into_response()
    } else {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Medya komutu başarısız")
            .to_string();
        err_resp(StatusCode::BAD_REQUEST, msg)
    }
}

async fn undo_ep(State(st): State<AppState>, Json(r): Json<SessionReq>) -> Response {
    let cps = store::pending_checkpoints(&r.session);
    if cps.is_empty() {
        return err_resp(
            StatusCode::NOT_FOUND,
            "Geri alınacak checkpoint yok".to_string(),
        );
    }
    let first_ref = cps[0].reference.clone();
    let ws = WORKSPACE.clone();
    let res = tokio::task::spawn_blocking(move || checkpoints::restore(&ws, &first_ref))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

    if let Err(e) = res {
        return err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Geri alma başarısız: {}", e),
        );
    }
    store::mark_undone(&r.session);
    store::add_log(
        &r.session,
        &format!("↶ {} checkpoint geri alındı", cps.len()),
        "w",
    );
    st.emit("log", json!({}));
    Json(json!({ "undone": cps.len() })).into_response()
}

async fn auth_login_ep(State(st): State<AppState>) -> Json<Value> {
    if st.auth_running.swap(true, Ordering::SeqCst) {
        return Json(json!({ "status": "running" }));
    }
    st.emit(
        "auth",
        json!({ "status": "pending", "message": "Chrome'da Google oturum açma penceresi açılıyor…" }),
    );
    store::add_log("auth", "🔑 agy CLI oturum açma başlatıldı", "");
    st.emit("log", json!({}));

    let st_c = st.clone();
    tokio::spawn(async move {
        let res = tokio::task::spawn_blocking(providers::run_agy_login_sync)
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
        st_c.auth_running.store(false, Ordering::SeqCst);
        match res {
            Ok(()) => {
                st_c.auth_needed.store(false, Ordering::Relaxed);
                store::add_log("auth", "✓ agy CLI oturumu doğrulandı", "ok");
                st_c.emit("auth", json!({ "status": "ok" }));
            }
            Err(err) => {
                st_c.auth_needed.store(true, Ordering::Relaxed);
                store::add_log("auth", &format!("✗ Oturum açılamadı: {}", err), "w");
                st_c.emit("auth", json!({ "status": "failed", "error": err }));
            }
        }
        st_c.emit("log", json!({}));
    });

    Json(json!({ "status": "started" }))
}

async fn no_cache_mw(req: axum::extract::Request, next: Next) -> Response {
    let is_api = req.uri().path().starts_with("/api/");
    let mut resp = next.run(req).await;
    if !is_api {
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, no-cache, must-revalidate"),
        );
    }
    resp
}

fn load_window_icon() -> Option<tao::window::Icon> {
    let icon_path = ROOT.join("frontend").join("agydesk_logo.png");
    let img = image::open(icon_path).ok()?.into_rgba8();
    let (w, h) = img.dimensions();
    tao::window::Icon::from_rgba(img.into_raw(), w, h).ok()
}

#[derive(Debug, Clone, Copy)]
enum WinCmd {
    Drag,
    Minimize,
    ToggleMaximize,
    Close,
}

#[derive(Debug, Clone, Copy)]
struct WinBounds {
    w: f64,
    h: f64,
    x: f64,
    y: f64,
    max: bool,
}

fn load_win_bounds(sw: f64, sh: f64) -> WinBounds {
    let def_w = (sw * 0.82).clamp(960.0, 1340.0).min((sw - 24.0).max(760.0));
    let def_h = (sh * 0.82).clamp(620.0, 840.0).min((sh - 48.0).max(520.0));
    let def_x = ((sw - def_w) / 2.0).max(12.0);
    let def_y = ((sh - def_h) / 2.0).max(12.0);
    let mut b = WinBounds {
        w: def_w,
        h: def_h,
        x: def_x,
        y: def_y,
        max: false,
    };

    let state = store::get_ui_state();
    let Some(raw) = state.get("win_bounds").and_then(|v| v.as_str()) else {
        return b;
    };
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return b;
    };
    if let (Some(w), Some(h)) = (
        v.get("w").and_then(|n| n.as_f64()),
        v.get("h").and_then(|n| n.as_f64()),
    ) {
        if w.is_finite() && h.is_finite() {
            b.w = w.clamp(760.0, (sw - 20.0).max(760.0));
            b.h = h.clamp(520.0, (sh - 44.0).max(520.0));
        }
    }
    if let (Some(x), Some(y)) = (
        v.get("x").and_then(|n| n.as_f64()),
        v.get("y").and_then(|n| n.as_f64()),
    ) {
        if x.is_finite() && y.is_finite() && x >= -40.0 && x <= sw - 180.0 && y >= 0.0 && y <= sh - 120.0 {
            b.x = x;
            b.y = y;
        }
    }
    b.max = v.get("max").and_then(|m| m.as_bool()).unwrap_or(false);
    b
}

fn save_win_bounds(b: &WinBounds) {
    let mut map = serde_json::Map::new();
    let val = json!({
        "w": b.w.round(),
        "h": b.h.round(),
        "x": b.x.round(),
        "y": b.y.round(),
        "max": b.max
    })
    .to_string();
    map.insert("win_bounds".to_string(), Value::String(val));
    store::set_ui_state(&map);
}

fn run_native_window() {
    use tao::{
        dpi::{LogicalPosition, LogicalSize},
        event::{Event as TaoEvent, WindowEvent},
        event_loop::{ControlFlow, EventLoopBuilder},
        platform::windows::WindowBuilderExtWindows,
        window::WindowBuilder,
    };
    use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows};

    const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-background-timer-throttling --disable-renderer-backgrounding";

    store::init();

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(1);
    let url = format!("http://127.0.0.1:8780/?v={}", ts);

    let event_loop = EventLoopBuilder::<WinCmd>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let (sw, sh) = event_loop
        .primary_monitor()
        .or_else(|| event_loop.available_monitors().next())
        .map(|m| {
            let s = m.size().to_logical::<f64>(m.scale_factor());
            (s.width, s.height)
        })
        .unwrap_or((1536.0, 864.0));
    let mut bounds = load_win_bounds(sw, sh);

    let window = WindowBuilder::new()
        .with_title("AgyDesk — EEM Çalışma İstasyonu")
        .with_decorations(false)
        .with_undecorated_shadow(true)
        .with_inner_size(LogicalSize::new(bounds.w, bounds.h))
        .with_position(LogicalPosition::new(bounds.x, bounds.y))
        .with_maximized(bounds.max)
        .with_window_icon(load_window_icon())
        .build(&event_loop)
        .expect("Win32 penceresi oluşturulamadı");

    let make_ipc = |p: tao::event_loop::EventLoopProxy<WinCmd>| {
        move |req: wry::http::Request<String>| {
            let cmd = match req.body().as_str() {
                "drag" => Some(WinCmd::Drag),
                "min" => Some(WinCmd::Minimize),
                "max" => Some(WinCmd::ToggleMaximize),
                "close" => Some(WinCmd::Close),
                _ => None,
            };
            if let Some(c) = cmd {
                let _ = p.send_event(c);
            }
        }
    };

    let primary_dir = std::env::var_os("LOCALAPPDATA")
        .map(|d| std::path::PathBuf::from(d).join("AgyDesk").join("webview2_data"))
        .unwrap_or_else(|| std::env::temp_dir().join("agydesk_webview2_data"));
    let _ = std::fs::create_dir_all(&primary_dir);
    let mut web_context = WebContext::new(Some(primary_dir));
    let build_primary = WebViewBuilder::new(&window)
        .with_web_context(&mut web_context)
        .with_additional_browser_args(WEBVIEW_ARGS)
        .with_url(&url)
        .with_devtools(true)
        .with_ipc_handler(make_ipc(proxy.clone()))
        .build();

    let (webview, _fallback_ctx) = match build_primary {
        Ok(wv) => (wv, None),
        Err(_) => {
            let fallback_dir =
                std::env::temp_dir().join(format!("agydesk_webview2_data_{}", std::process::id()));
            let mut fb_ctx = WebContext::new(Some(fallback_dir));
            let wv = WebViewBuilder::new(&window)
                .with_web_context(&mut fb_ctx)
                .with_additional_browser_args(WEBVIEW_ARGS)
                .with_url(&url)
                .with_devtools(true)
                .with_ipc_handler(make_ipc(proxy.clone()))
                .build()
                .expect("WebView2 bileşeni başlatılamadı");
            (wv, Some(fb_ctx))
        }
    };
    let mut webview_opt = Some(webview);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            TaoEvent::UserEvent(cmd) => match cmd {
                WinCmd::Drag => {
                    let _ = window.drag_window();
                }
                WinCmd::Minimize => {
                    window.set_minimized(true);
                }
                WinCmd::ToggleMaximize => {
                    let next_max = !window.is_maximized();
                    window.set_maximized(next_max);
                    bounds.max = next_max;
                    save_win_bounds(&bounds);
                }
                WinCmd::Close => {
                    bounds.max = window.is_maximized();
                    save_win_bounds(&bounds);
                    drop(webview_opt.take());
                    media::shutdown();
                    std::thread::spawn(|| {
                        std::thread::sleep(Duration::from_millis(300));
                        std::process::exit(0);
                    });
                    *control_flow = ControlFlow::Exit;
                }
            },
            TaoEvent::WindowEvent {
                event: WindowEvent::Resized(sz),
                ..
            } => {
                if !window.is_maximized() {
                    let ls = sz.to_logical::<f64>(window.scale_factor());
                    if ls.width >= 400.0 && ls.height >= 300.0 {
                        bounds.w = ls.width;
                        bounds.h = ls.height;
                    }
                }
            }
            TaoEvent::WindowEvent {
                event: WindowEvent::Moved(pos),
                ..
            } => {
                if !window.is_maximized() {
                    let lp = pos.to_logical::<f64>(window.scale_factor());
                    if lp.x > -10000.0 && lp.y > -10000.0 {
                        bounds.x = lp.x;
                        bounds.y = lp.y;
                    }
                }
            }
            TaoEvent::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                bounds.max = window.is_maximized();
                save_win_bounds(&bounds);
                drop(webview_opt.take());
                media::shutdown();
                std::thread::spawn(|| {
                    std::thread::sleep(Duration::from_millis(300));
                    std::process::exit(0);
                });
                *control_flow = ControlFlow::Exit;
            }
            TaoEvent::LoopDestroyed => {
                drop(webview_opt.take());
                media::shutdown();
                std::process::exit(0);
            }
            _ => {}
        }
    });
}

fn is_port_listening() -> bool {
    TcpStream::connect_timeout(
        &"127.0.0.1:8780".parse().unwrap(),
        Duration::from_millis(80),
    )
    .is_ok()
}

fn build_router() -> Router {
    store::init();
    std::thread::spawn(|| {
        let _ = store::fetch_agy_usage(true);
    });

    let (tx, _rx) = broadcast::channel::<Value>(256);
    let state = AppState {
        tx,
        tasks: Arc::new(Mutex::new(HashMap::new())),
        steps: Arc::new(Mutex::new(HashMap::new())),
        auth_needed: Arc::new(AtomicBool::new(false)),
        auth_running: Arc::new(AtomicBool::new(false)),
    };

    let frontend_dir = ROOT.join("frontend");
    Router::new()
        .route("/api/health", get(health_ep))
        .route("/api/ping", get(ping_ep))
        .route("/api/auth/login", post(auth_login_ep))
        .route("/api/ui_state", get(get_ui_state_ep).post(set_ui_state_ep))
        .route("/api/vault", get(get_vault_ep))
        .route("/api/vault/move", post(move_vault_item_ep))
        .route("/api/kasa", post(create_kasa_ep))
        .route("/api/kasa/update", post(update_kasa_ep))
        .route("/api/space", post(save_space_ep).delete(delete_space_ep))
        .route("/api/folder", post(create_folder_ep))
        .route("/api/note", get(get_note_ep).post(save_note_ep).delete(delete_note_ep))
        .route("/api/note/create", post(create_note_ep))
        .route("/api/calendar", get(get_calendar_ep).post(post_calendar_ep))
        .route("/api/calendar/:ev_id", delete(delete_calendar_ep))
        .route("/api/upload", post(upload_asset_ep))
        .route("/api/docx", get(get_docx_ep))
        .route("/api/pptx", get(get_pptx_ep))
        .route("/api/pdf_info", get(get_pdf_info_ep))
        .route("/api/raw/*rel", get(raw_file_ep))
        .route("/api/chats", get(get_chats_ep).post(post_chat_ep))
        .route("/api/quota", get(quota_ep))
        .route("/api/log", get(get_log_ep).post(post_log_ep))
        .route("/api/events", get(events_ep))
        .route("/api/run", post(run_ep))
        .route("/api/stop", post(stop_ep))
        .route("/api/clear", post(clear_ep))
        .route("/api/undo", post(undo_ep))
        .route("/api/media/status", get(media_status_ep))
        .route("/api/media/cmd", post(media_cmd_ep))
        .fallback_service(ServeDir::new(frontend_dir).append_index_html_on_directories(true))
        .layer(middleware::from_fn(no_cache_mw))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

fn main() {
    disable_windows_power_throttling();
    let args: Vec<String> = std::env::args().collect();
    let daemon_only = args.iter().any(|a| a == "--daemon-only");

    if daemon_only {
        if is_port_listening() {
            return;
        }
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let app = build_router();
            if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:8780").await {
                let _ = axum::serve(listener, app).await;
            }
        });
        return;
    }

    if !is_port_listening() {
        std::thread::spawn(|| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let app = build_router();
                if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:8780").await {
                    let _ = axum::serve(listener, app).await;
                }
            });
        });
        for _ in 0..40 {
            if is_port_listening() {
                break;
            }
            std::thread::sleep(Duration::from_millis(15));
        }
    }

    run_native_window();
}
