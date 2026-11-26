#![windows_subsystem = "windows"]

mod checkpoints;
mod config;
mod media;
mod memory_graph;
mod permissions;
mod providers;
mod router;
mod store;
mod vault;
mod vault_guard;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path as AxumPath, Query, State},
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
    collections::{hash_map::DefaultHasher, HashMap, HashSet},
    convert::Infallible,
    hash::{Hash, Hasher},
    net::TcpStream,
    os::windows::process::CommandExt,
    path::Path,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, oneshot};
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
    src_hashes: Arc<Mutex<HashMap<String, u64>>>,
    mem_hashes: Arc<Mutex<HashMap<String, u64>>>,
    auth_needed: Arc<AtomicBool>,
    auth_running: Arc<AtomicBool>,
    guard_pending: Arc<Mutex<HashMap<String, (String, oneshot::Sender<bool>)>>>,
    guard_grants: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    guard_seq: Arc<AtomicU64>,
}

fn hash_str(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
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

fn ws_hint_for(session: &str) -> String {
    let vd = VAULT_DIR.to_string_lossy();
    if !config::is_restricted_session(session) {
        return format!(
            "[AgyAI CLI: tam erişim aktif. Kasa: {vd}. Not açmak için [[Dosya_Adi]] yaz.]\n\n"
        );
    }
    let write_rule = if vault::is_split_vault() {
        format!(
            "Yeni not (.md) -> {vd}\\AgyDesk_Notlar\\<Kasa>\\, belge/görsel -> {vd}\\AgyDesk_Dokuman\\<Kasa>\\."
        )
    } else {
        format!("Yeni not -> {vd}\\<Kasa>\\*.md.")
    };
    let drive_rule = match (&*config::DRIVE_DIR, &*config::DRIVE_VAULT_DIR) {
        (Some(dr), Some(dv)) => format!(
            " Drive okuma: {}; Drive yedekleme/yazma: yalnızca {}. Drive'a yazmadan önce aynı dosyanın Drive'da var olup olmadığını kontrol et (çift kopya oluşturma, mevcut dosyayı güncelle).",
            dr.to_string_lossy(),
            dv.to_string_lossy()
        ),
        _ => String::new(),
    };
    let study_rule = if config::is_study_session(session) {
        let pdirs: Vec<String> = config::PERSONAL_DIRS
            .iter()
            .map(|(_, lbl, p)| format!("{} ({})", lbl, p.to_string_lossy()))
            .collect();
        if pdirs.is_empty() {
            String::new()
        } else {
            format!(
                " Kişisel klasörler [{}], Drive geneline yazma, genel terminal komutları (Python/PowerShell/MATLAB vb. — `.pptx`/`.ppt`/`.docx`/`.xlsx`/grafik/simülasyon üretimi dahil) ve açık Chrome tarayıcı penceresi (`chrome-devtools` MCP: list_pages, select_page, take_snapshot, take_screenshot, click, fill, navigate_page, evaluate_script) KULLANICI ONAYI (veya `/browser` komutu) ile açıktır: kullanıcı istediğinde `agydesk-guard.exe --read-doc \"<dosya>\"` (DOCX/DOC/PPTX/XLSX/ODT/SLX okur), `agydesk-guard.exe --list \"<klasor>\"` (en yeniden eskiye listeler), read_file/write_file/edit_file, `agydesk-guard.exe --copy/--move/--sync`, `run_command` veya açık Chrome penceresi için `chrome-devtools` MCP aracını doğrudan çağır; AgyDesk kullanıcıya otomatik onay kartı gösterir (reddedilirse bildiriş yap). Sunum (.pptx/.ppt), Word (.docx), Excel (.xlsx), grafik veya simülasyon istendiğinde kasaya `.py` (veya `.ps1`) betiği yazıp `run_command` ile doğrudan `python` (`python-pptx`, `python-docx`, `openpyxl`, `matplotlib`, `PIL` kurulu; `.ppt` için PowerPoint COM) çalıştır — asla 'AgyStudy'de terminal/Python kapalı' veya 'yalnızca PDF üretebilirim' deme. Proje klasörleri (ai-workstation, atolye.db, .git, .agents, .gemini, .ssh) ve sistem yapılandırmaları kesinlikle kapalıdır.",
                pdirs.join(", ")
            )
        }
    } else {
        String::new()
    };
    let mode_label = if config::is_study_session(session) {
        "AgyStudy Çalışma Modu (Kasa/Drive otomatik; İndirilenler/Masaüstü/Belgeler/Resimler/Drive-yazma/terminal/Chrome tarayıcı kullanıcı onaylı; proje/yapılandırma kapalı)"
    } else {
        "AgyDesk Kısıtlı Çalışma Modu (yalnızca Kasa/Drive/Görsel/Web arama/Belge okuma/PDF üretimi/Dosya listeleme-kopyalama-taşıma-senkron; proje/genel shell kapalı)"
    };
    format!(
        "[{mode_label}. Kasa: {vd}. {write_rule}{drive_rule}{study_rule} \
İkili Office/Simulink belgelerini (.docx, .doc, .pptx, .xlsx, .odt, .ods, .odp, .slx) okumak için run_command ile: C:\\Users\\cavit\\ai-workstation\\agydesk-guard.exe --read-doc \"<dosya>\" çalıştır. \
Klasör içeriğini en yeniden eskiye listelemek için run_command ile: C:\\Users\\cavit\\ai-workstation\\agydesk-guard.exe --list \"<klasor>\" çalıştır. \
PDF oluşturmak için önce kasaya .md veya .html yaz, sonra run_command ile: C:\\Users\\cavit\\ai-workstation\\agydesk-guard.exe --md-to-pdf \"<girdi.md>\" \"<cikti.pdf>\" (veya --html-to-pdf) çalıştır. \
İkili dosya (PDF, görsel, PPTX, DOCX vb.) veya klasör kopyalamak/taşımak/Drive'a yedeklemek için run_command ile: C:\\Users\\cavit\\ai-workstation\\agydesk-guard.exe --copy \"<kaynak>\" \"<hedef>\" (veya --move, --sync) çalıştır. \
Not açmak için [[Dosya_Adi]] yaz. Matematik: $...$/$$...$$. ASCII çizme; devre için ```sema trafo-esdeger|trafo-bosta|trafo-kisadevre|trafo-baglanti|dc-sont```, akış için ```mermaid``` (alt çizgisiz etiket) kullan.]\n\n"
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
struct CompactReq {
    session: String,
    #[serde(default)]
    recent_msgs: Vec<String>,
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
struct RootDocSpaceReq {
    rel: String,
    #[serde(default)]
    space: Option<String>,
    #[serde(default)]
    spaces: Option<Vec<String>>,
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
        "warm_procs": providers::warm_pool_count(),
        "memory_graph": memory_graph::get_stats(),
        "auth_needed": st.auth_needed.load(Ordering::Relaxed),
        "auth_running": st.auth_running.load(Ordering::Relaxed)
    }))
}

async fn ping_ep() -> Json<Value> {
    Json(json!({ "ok": true, "engine": "rust" }))
}

#[repr(C)]
struct WinSystemPowerStatus {
    ac_line_status: u8,
    battery_flag: u8,
    battery_life_percent: u8,
    system_status_flag: u8,
    battery_life_time: u32,
    battery_full_life_time: u32,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetSystemPowerStatus(lpSystemPowerStatus: *mut WinSystemPowerStatus) -> i32;
}

async fn system_battery_ep() -> Json<Value> {
    #[cfg(target_os = "windows")]
    {
        let mut st = WinSystemPowerStatus {
            ac_line_status: 255,
            battery_flag: 255,
            battery_life_percent: 255,
            system_status_flag: 0,
            battery_life_time: u32::MAX,
            battery_full_life_time: u32::MAX,
        };
        let ok = unsafe { GetSystemPowerStatus(&mut st as *mut WinSystemPowerStatus) };
        if ok != 0 && (st.battery_flag & 128) == 0 && st.battery_life_percent <= 100 {
            let plugged = st.ac_line_status == 1;
            let secs_left = if st.battery_life_time != u32::MAX {
                Some(st.battery_life_time)
            } else {
                None
            };
            return Json(json!({
                "available": true,
                "percent": st.battery_life_percent,
                "plugged": plugged,
                "secs_left": secs_left,
            }));
        }
    }
    Json(json!({ "available": false }))
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

async fn update_root_doc_space_ep(
    State(st): State<AppState>,
    Json(r): Json<RootDocSpaceReq>,
) -> Response {
    match vault::update_root_doc_space(&r.rel, r.space.as_deref(), r.spaces.as_deref()) {
        Ok(res) => {
            let sp = res
                .get("space")
                .and_then(|v| v.as_str())
                .unwrap_or("all");
            store::add_log(
                "vault",
                &format!("📌 Ortak kök belge kapsamı güncellendi: {} → {}", r.rel, sp),
                "ok",
            );
            st.emit("log", json!({}));
            Json(res).into_response()
        }
        Err(e) if e.starts_with("Dosya bulunamadı:") => err_resp(StatusCode::NOT_FOUND, e),
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
            let rel_idx = r.rel.clone();
            std::thread::spawn(move || memory_graph::index_single_note(&rel_idx));
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
            let rel = res.get("rel").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !rel.is_empty() {
                let rel_idx = rel.clone();
                std::thread::spawn(move || memory_graph::index_single_note(&rel_idx));
            }
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
            let rel_idx = q.rel.clone();
            std::thread::spawn(move || memory_graph::index_single_note(&rel_idx));
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
    let note = q.note;
    let name = q.name;
    let res = tokio::task::spawn_blocking(move || vault::save_asset(&note, &name, &body))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(res) => Json(res).into_response(),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn get_docx_ep(Query(q): Query<RelQuery>) -> Response {
    let rel = q.rel.clone();
    let res = tokio::task::spawn_blocking(move || vault::docx_to_html(&rel))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(res) => Json(res).into_response(),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn get_docx_pdf_ep(Query(q): Query<RelQuery>) -> Response {
    let rel = q.rel.clone();
    let res = tokio::task::spawn_blocking(move || vault::docx_to_pdf_bytes(&rel))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "application/pdf")
            .header(axum::http::header::CACHE_CONTROL, "no-store")
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|e| err_resp(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn delete_docx_pdf_ep(Query(q): Query<RelQuery>) -> Response {
    vault::evict_docx_pdf(&q.rel);
    Json(json!({"ok": true})).into_response()
}

#[derive(Deserialize)]
struct LocalPathQuery {
    path: String,
}

async fn local_raw_file_ep(
    Query(q): Query<LocalPathQuery>,
    req: axum::extract::Request,
) -> Response {
    let Ok(p) = vault::resolve_preview_path(&q.path) else {
        return err_resp(StatusCode::BAD_REQUEST, "Geçersiz dosya yolu".to_string());
    };
    if !p.is_file() {
        return err_resp(StatusCode::NOT_FOUND, "Dosya bulunamadı".to_string());
    }
    match tower::ServiceExt::oneshot(ServeFile::new(p), req).await {
        Ok(r) => r.into_response(),
        Err(e) => err_resp(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

async fn local_text_ep(Query(q): Query<LocalPathQuery>) -> Response {
    let path = q.path.clone();
    let res = tokio::task::spawn_blocking(move || vault::read_preview_text(&path))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(v) => Json(v).into_response(),
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

async fn get_pptx_pdf_ep(Query(q): Query<RelQuery>) -> Response {
    let rel = q.rel.clone();
    let res = tokio::task::spawn_blocking(move || vault::pptx_to_pdf_bytes(&rel))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "application/pdf")
            .header(axum::http::header::CACHE_CONTROL, "no-store")
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|e| err_resp(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn delete_pptx_pdf_ep(Query(q): Query<RelQuery>) -> Response {
    vault::evict_pptx_pdf(&q.rel);
    Json(json!({"ok": true})).into_response()
}

async fn get_xlsx_ep(Query(q): Query<RelQuery>) -> Response {
    let rel = q.rel.clone();
    let res = tokio::task::spawn_blocking(move || vault::xlsx_to_sheets(&rel))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(val) => Json(val).into_response(),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn get_xlsx_pdf_ep(Query(q): Query<RelQuery>) -> Response {
    let rel = q.rel.clone();
    let res = tokio::task::spawn_blocking(move || vault::xlsx_to_pdf_bytes(&rel))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match res {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "application/pdf")
            .header(axum::http::header::CACHE_CONTROL, "no-store")
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|e| err_resp(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
        Err(e) => err_resp(StatusCode::BAD_REQUEST, e),
    }
}

async fn delete_xlsx_pdf_ep(Query(q): Query<RelQuery>) -> Response {
    vault::evict_pptx_pdf(&q.rel);
    Json(json!({"ok": true})).into_response()
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
    let restricted_sess = config::is_restricted_session(&sess);
    let sources_c = r.sources.clone();
    let active_c = r.active_note.clone();
    let images_c = r.images.clone();
    let query_c = r.text.clone();
    let (raw_src_ctx, img_paths, raw_mem_ctx) = tokio::task::spawn_blocking(move || {
        let sc = vault::build_context_from_sources(&sources_c, active_c.as_deref());
        let imgs = vault::resolve_chat_images(&images_c);
        let mc = if restricted_sess {
            memory_graph::query_memory_context(&query_c, active_c.as_deref(), 1400)
        } else {
            String::new()
        };
        (sc, imgs, mc)
    })
    .await
    .unwrap_or_default();

    // Token guard: skip resending identical source context when continuing an existing conversation.
    let src_ctx = if raw_src_ctx.is_empty() {
        String::new()
    } else {
        let h = hash_str(&raw_src_ctx);
        let unchanged = if conv_id.is_some() {
            st.src_hashes
                .lock()
                .ok()
                .and_then(|m| m.get(&sess).copied())
                == Some(h)
        } else {
            false
        };
        if let Ok(mut m) = st.src_hashes.lock() {
            m.insert(sess.clone(), h);
        }
        if unchanged {
            String::new()
        } else {
            raw_src_ctx
        }
    };

    // Token guard: skip resending identical memory graph block on consecutive turns.
    let mem_ctx = if raw_mem_ctx.is_empty() {
        String::new()
    } else {
        let h = hash_str(&raw_mem_ctx);
        let unchanged = if conv_id.is_some() {
            st.mem_hashes
                .lock()
                .ok()
                .and_then(|m| m.get(&sess).copied())
                == Some(h)
        } else {
            false
        };
        if let Ok(mut m) = st.mem_hashes.lock() {
            m.insert(sess.clone(), h);
        }
        if unchanged {
            String::new()
        } else {
            raw_mem_ctx
        }
    };

    let img_ctx = vault::build_image_prompt_block(&img_paths);
    let trimmed_req = r.text.trim();
    let is_browser_cmd = r.skill.as_deref() == Some("browser")
        || trimmed_req
            .to_ascii_lowercase()
            .starts_with("/browser");
    let browser_ctx = if is_browser_cmd && config::is_study_session(&sess) {
        if let Ok(mut grants) = st.guard_grants.lock() {
            grants
                .entry(sess.clone())
                .or_default()
                .insert("browser".to_string());
        }
        "[AÇIK CHROME TARAYICI MODU (/browser aktif — oturum izni verildi): Kullanıcının şu an açık olan Chrome penceresine `chrome-devtools` MCP araçlarıyla bağlan (`list_pages` ile açık sekmeleri gör, ilgili sekmeyi `select_page` ile seç, `take_snapshot` / `take_screenshot` / `evaluate_script` / `click` / `fill` / `navigate_page` kullan). Yeni izole tarayıcı açma, kullanıcının açık Chrome penceresini kullan.]\n\n"
    } else {
        ""
    };
    let user_text = if trimmed_req.is_empty() && !img_paths.is_empty() {
        "Eklenen görseli incele ve içeriğini açıkla.".to_string()
    } else if is_browser_cmd {
        let rest = trimmed_req
            .strip_prefix("/browser")
            .or_else(|| trimmed_req.strip_prefix("/Browser"))
            .or_else(|| trimmed_req.strip_prefix("/BROWSER"))
            .unwrap_or(trimmed_req)
            .trim();
        if rest.is_empty() {
            "Şu an açık olan Chrome penceremdeki aktif sekmeyi listele ve içeriğini kısaca özetle.".to_string()
        } else {
            rest.to_string()
        }
    } else {
        r.text.clone()
    };
    let base_prompt = format!("{}{}{}{}{}", browser_ctx, mem_ctx, src_ctx, img_ctx, user_text);
    let base_prompt = if conv_id.is_none() {
        if let Some(compact_ctx) = store::pop_compact_ctx(&sess) {
            format!(
                "[Önceki Sohbetin Sıkıştırılmış Özeti]\n{}\n\n[Yeni Kullanıcı İsteği]\n{}",
                compact_ctx, base_prompt
            )
        } else {
            base_prompt
        }
    } else {
        base_prompt
    };
    let prompt = if conv_id.is_none() {
        format!("{}{}", ws_hint_for(&sess), base_prompt)
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

    let st_delta = st.clone();
    let sess_delta = sess.clone();
    let on_delta = move |d: String| {
        st_delta.emit(
            "delta",
            json!({
                "session": sess_delta,
                "delta": d
            }),
        );
    };

    let turn_started = std::time::SystemTime::now();
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
        on_delta,
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
                if restricted_sess {
                    let s_m = sess.clone();
                    let u_m = user_text.clone();
                    let a_m = text.clone();
                    let n_m = r.active_note.clone();
                    std::thread::spawn(move || {
                        memory_graph::record_turn_memory(&s_m, &u_m, &a_m, n_m.as_deref());
                    });
                }
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
            let cached_quota = store::quota_status();
            let reply_for_scan = text.clone();
            let touched_files = tokio::task::spawn_blocking(move || {
                detect_touched_files(&reply_for_scan, turn_started)
            })
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
                    "quota": cached_quota,
                    "touched_files": touched_files
                }),
            );
            st.emit("log", json!({}));
            let st_q = st.clone();
            tokio::spawn(async move {
                if let Ok(fresh) = tokio::task::spawn_blocking(|| store::quota_status_with(true, true)).await {
                    st_q.emit("quota", json!({ "quota": fresh }));
                }
            });
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
            let cached_quota = store::quota_status();
            st.emit(
                "error",
                json!({
                    "session": sess,
                    "error": e,
                    "code": if auth_req { "auth_required" } else { "provider_error" },
                    "ollama_available": ollama_ok,
                    "quota": cached_quota
                }),
            );
            st.emit("log", json!({}));
            let st_q = st.clone();
            tokio::spawn(async move {
                if let Ok(fresh) = tokio::task::spawn_blocking(|| store::quota_status_with(true, true)).await {
                    st_q.emit("quota", json!({ "quota": fresh }));
                }
            });
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
    if risk != "safe" && !config::is_restricted_session(&r.session) {
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

    let dec = if let Some(fp) = r.force_provider.as_deref().filter(|s| !s.trim().is_empty()) {
        let restricted = config::is_restricted_session(&r.session);
        let allowed = match fp {
            "local" | "gemini-hydrogen" | "gemini-neon" => true,
            "gemini-argon" | "claude-sonnet" | "claude-opus" => !restricted,
            _ => false,
        };
        if allowed {
            let spec = provider_spec(fp);
            router::Decision {
                provider: spec.id.to_string(),
                label: spec.label.to_string(),
                reason: format!("Kullanıcı {} modelini seçti", spec.label),
                fallback: fp == "local",
            }
        } else {
            router::route_for_session(
                &r.session,
                &r.text,
                r.skill.as_deref(),
                !r.images.is_empty(),
                store::used_pct,
            )
        }
    } else {
        if providers::agy_available() {
            tokio::spawn(async {
                let _ = tokio::task::spawn_blocking(|| store::fetch_agy_usage(false)).await;
            });
        }
        router::route_for_session(
            &r.session,
            &r.text,
            r.skill.as_deref(),
            !r.images.is_empty(),
            store::used_pct,
        )
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
    cancel_guard_approvals_for_session(&st, &r.session);
    store::add_log(&r.session, "■ Acil durdurma", "w");
    st.emit("log", json!({}));
    Json(json!({ "stopped": killed || aborted }))
}

async fn clear_ep(State(st): State<AppState>, Json(r): Json<SessionReq>) -> Json<Value> {
    providers::kill_session_proc(&r.session);
    cancel_guard_approvals_for_session(&st, &r.session);
    if let Ok(mut g) = st.guard_grants.lock() {
        g.remove(&r.session);
    }
    store::set_conv_id(&r.session, None);
    store::set_compact_ctx(&r.session, None);
    store::clear_chat_msgs(&r.session);
    if let Ok(mut m) = st.src_hashes.lock() {
        m.remove(&r.session);
    }
    if let Ok(mut m) = st.mem_hashes.lock() {
        m.remove(&r.session);
    }
    store::add_log(&r.session, "🧹 Oturum bağlamı sıfırlandı", "m");
    st.emit("log", json!({}));
    Json(json!({ "cleared": true }))
}

const COMPACT_PROMPT: &str = "Bu sohbeti yeni ve temiz bir oturuma aktarmak için sıkıştırılmış teknik özet çıkar. Sadece şunları kısa maddeler halinde yaz: (1) Ana amaç ve çözülen konular, (2) Alınan kararlar ve değiştirilen dosya/sembol adları, (3) Açık kalan işler veya önemli kısıtlar. Gereksiz sohbet cümlelerini atla.";

async fn compact_ep(State(st): State<AppState>, Json(r): Json<CompactReq>) -> Response {
    let conv_id = store::get_conv_id(&r.session);
    if conv_id.is_none() {
        let recent: Vec<String> = r
            .recent_msgs
            .iter()
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty())
            .collect();
        let tail: Vec<&str> = recent
            .iter()
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|s| s.as_str())
            .collect();
        let summary = if tail.is_empty() {
            "(henüz içerik yok)".to_string()
        } else {
            tail.join(" · ")
        };
        store::clear_chat_msgs(&r.session);
        return Json(json!({
            "compacted": true,
            "real": false,
            "summary": summary,
            "label": "yerel özetleyici",
            "tokens": 0
        }))
        .into_response();
    }

    let mut dec = router::route_for_session(
        &r.session,
        "Bu konuşmayı özetle",
        Some("compact"),
        false,
        store::used_pct,
    );
    let mut failover_prov: Option<(String, String)> = None;
    let res = providers::complete(
        dec.provider.clone(),
        COMPACT_PROMPT.to_string(),
        Vec::new(),
        r.session.clone(),
        "y".to_string(),
        "low".to_string(),
        conv_id,
        |_| {},
        |_| {},
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

    let (text, tokens, real, _) = match res {
        Ok(v) => v,
        Err(e) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Bağlam sıkıştırma başarısız: {}", e),
            );
        }
    };

    let summary = text.trim().to_string();
    if !real || summary.is_empty() {
        return err_resp(
            StatusCode::BAD_GATEWAY,
            "Modelden gerçek özet alınamadı; mevcut oturum korundu.".to_string(),
        );
    }

    store::record_usage(&dec.provider, tokens, true);
    store::set_conv_id(&r.session, None);
    store::set_compact_ctx(&r.session, Some(&summary));
    store::clear_chat_msgs(&r.session);
    store::add_log(
        &r.session,
        &format!("🗜 Bağlam sıkıştırıldı ({})", dec.label),
        "m",
    );
    st.emit("log", json!({}));
    Json(json!({
        "compacted": true,
        "real": true,
        "summary": summary,
        "label": dec.label,
        "tokens": tokens
    }))
    .into_response()
}

#[derive(Deserialize)]
struct GuardApproveReq {
    session: String,
    #[serde(default)]
    tool: String,
    #[serde(default)]
    action: String,
    #[serde(default)]
    root_key: String,
    #[serde(default)]
    root_label: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    dst_path: Option<String>,
}

#[derive(Deserialize)]
struct GuardDecideReq {
    id: String,
    #[serde(default)]
    session: String,
    allow: bool,
    #[serde(default)]
    remember: bool,
    #[serde(default)]
    root_key: Option<String>,
}

fn cancel_guard_approvals_for_session(st: &AppState, session: &str) {
    let mut cancelled_ids = Vec::new();
    if let Ok(mut pending) = st.guard_pending.lock() {
        let keys: Vec<String> = pending
            .iter()
            .filter(|(_, (s, _))| s == session)
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys {
            if let Some((_, tx)) = pending.remove(&k) {
                let _ = tx.send(false);
                cancelled_ids.push(k);
            }
        }
    }
    for id in cancelled_ids {
        st.emit(
            "guard_approval_done",
            json!({ "id": id, "session": session, "allow": false }),
        );
    }
}

async fn guard_approve_ep(State(st): State<AppState>, Json(r): Json<GuardApproveReq>) -> Json<Value> {
    if !r.session.is_empty() && !r.root_key.is_empty() {
        if let Ok(grants) = st.guard_grants.lock() {
            if grants
                .get(&r.session)
                .map(|set| set.contains(&r.root_key))
                .unwrap_or(false)
            {
                return Json(json!({ "decision": "allow" }));
            }
        }
    }

    let seq = st.guard_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let req_id = format!("g_{}", seq);
    let (tx, rx) = oneshot::channel::<bool>();
    if let Ok(mut pending) = st.guard_pending.lock() {
        pending.insert(req_id.clone(), (r.session.clone(), tx));
    }

    st.emit(
        "guard_approval",
        json!({
            "id": req_id,
            "session": r.session,
            "tool": r.tool,
            "action": r.action,
            "root_key": r.root_key,
            "root_label": r.root_label,
            "path": r.path,
            "dst_path": r.dst_path,
        }),
    );

    match tokio::time::timeout(Duration::from_secs(120), rx).await {
        Ok(Ok(true)) => Json(json!({ "decision": "allow" })),
        Ok(Ok(false)) => Json(json!({
            "decision": "deny",
            "reason": "Kullanıcı bu erişimi/işlemi reddetti."
        })),
        _ => {
            if let Ok(mut pending) = st.guard_pending.lock() {
                pending.remove(&req_id);
            }
            st.emit(
                "guard_approval_done",
                json!({ "id": req_id, "session": r.session, "allow": false }),
            );
            Json(json!({
                "decision": "deny",
                "reason": "Erişim/işlem onayı zaman aşımına uğradı veya iptal edildi."
            }))
        }
    }
}

async fn guard_decide_ep(State(st): State<AppState>, Json(r): Json<GuardDecideReq>) -> Json<Value> {
    let mut sess = r.session.clone();
    if let Ok(mut pending) = st.guard_pending.lock() {
        if let Some((s, tx)) = pending.remove(&r.id) {
            if sess.is_empty() {
                sess = s;
            }
            if r.allow && r.remember {
                if let Some(rk) = r.root_key.as_deref().filter(|k| !k.is_empty()) {
                    if let Ok(mut grants) = st.guard_grants.lock() {
                        grants
                            .entry(sess.clone())
                            .or_default()
                            .insert(rk.to_string());
                    }
                }
            }
            let _ = tx.send(r.allow);
        }
    }
    st.emit(
        "guard_approval_done",
        json!({ "id": r.id, "session": sess, "allow": r.allow }),
    );
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct MemoryQueryParams {
    #[serde(default)]
    q: String,
    #[serde(default)]
    active: Option<String>,
}

async fn memory_stats_ep() -> Json<Value> {
    Json(memory_graph::get_stats())
}

async fn memory_reindex_ep() -> Json<Value> {
    match tokio::task::spawn_blocking(memory_graph::sync_vault_index).await {
        Ok(Ok(stats)) => Json(json!({ "ok": true, "stats": stats })),
        Ok(Err(e)) => Json(json!({ "ok": false, "error": e })),
        Err(e) => Json(json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn memory_query_ep(Query(p): Query<MemoryQueryParams>) -> Json<Value> {
    let res = tokio::task::spawn_blocking(move || {
        memory_graph::debug_query(&p.q, p.active.as_deref())
    })
    .await
    .unwrap_or_else(|e| json!({ "ok": false, "error": e.to_string() }));
    Json(res)
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

#[derive(Deserialize)]
struct MediaOpenReq {
    #[serde(default)]
    app: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    platform: String,
}

#[derive(Deserialize)]
struct MediaVolumeReq {
    #[serde(default)]
    volume: Option<i64>,
    #[serde(default)]
    muted: Option<bool>,
    #[serde(default)]
    toggle_mute: bool,
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

async fn media_open_ep(Json(r): Json<MediaOpenReq>) -> Response {
    let res = tokio::task::spawn_blocking(move || media::open_app(&r.app, &r.title, &r.platform))
        .await
        .unwrap_or_else(|_| json!({"ok": false, "error": "Medya uygulaması açılamadı"}));
    if res.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Json(res).into_response()
    } else {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Medya uygulaması açılamadı")
            .to_string();
        err_resp(StatusCode::BAD_REQUEST, msg)
    }
}

async fn media_volume_ep(Json(r): Json<MediaVolumeReq>) -> Response {
    let res = tokio::task::spawn_blocking(move || media::set_volume(r.volume, r.muted, r.toggle_mute))
        .await
        .unwrap_or_else(|_| json!({"ok": false, "error": "Ses ayarı başarısız"}));
    if res.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        Json(res).into_response()
    } else {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Ses ayarı başarısız")
            .to_string();
        err_resp(StatusCode::BAD_REQUEST, msg)
    }
}

#[derive(Deserialize)]
struct OpenTargetReq {
    target: String,
    #[serde(default)]
    reveal: bool,
}

fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn preview_ext_priority(ext: &str) -> Option<u8> {
    match ext {
        ".docx" | ".doc" => Some(0),
        ".pdf" => Some(1),
        ".pptx" | ".ppsx" | ".ppt" => Some(2),
        ".xlsx" | ".xlsm" | ".xls" | ".csv" => Some(3),
        ".html" | ".htm" => Some(4),
        ".md" => Some(5),
        ".png" | ".jpg" | ".jpeg" | ".webp" | ".svg" | ".gif" | ".bmp" => Some(6),
        ".txt" => Some(7),
        _ => None,
    }
}

fn extract_reply_candidate_paths(reply: &str) -> Vec<String> {
    use once_cell::sync::Lazy;
    use regex::Regex;
    static RE_MD_LINK: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\]\(((?:file:///|file://|[A-Za-z]:[\\/])[^)\r\n]+)\)").unwrap());
    static RE_BACKTICK: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"`((?:file:///|file://|[A-Za-z]:[\\/]|~[\\/])[^`\r\n]+)`").unwrap());
    static RE_WIKI: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\[([^\]|\r\n]+)").unwrap());
    static RE_BARE_FILE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r#"(?i)(file:///?[^\s<>"'`)\]]+)"#).unwrap());
    static RE_BARE_WIN: Lazy<Regex> =
        Lazy::new(|| Regex::new(r#"(?:^|[\s(>\[])([A-Za-z]:[\\/][^\s<>"'`|?*)\]]+)"#).unwrap());

    let mut out: Vec<String> = Vec::new();
    for cap in RE_MD_LINK.captures_iter(reply) {
        if let Some(m) = cap.get(1) {
            out.push(m.as_str().trim().to_string());
        }
    }
    for cap in RE_BACKTICK.captures_iter(reply) {
        if let Some(m) = cap.get(1) {
            out.push(m.as_str().trim().to_string());
        }
    }
    for cap in RE_WIKI.captures_iter(reply) {
        if let Some(m) = cap.get(1) {
            out.push(m.as_str().trim().to_string());
        }
    }
    for cap in RE_BARE_FILE.captures_iter(reply) {
        if let Some(m) = cap.get(1) {
            out.push(m.as_str().trim_end_matches(&['.', ',', ';', ':', '!', '?'][..]).to_string());
        }
    }
    for cap in RE_BARE_WIN.captures_iter(reply) {
        if let Some(m) = cap.get(1) {
            out.push(m.as_str().trim_end_matches(&['.', ',', ';', ':', '!', '?'][..]).to_string());
        }
    }
    out
}

fn scan_recent_vault_files(
    dir: &std::path::Path,
    depth: usize,
    cutoff: std::time::SystemTime,
    out: &mut Vec<(std::path::PathBuf, u128)>,
) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let p = ent.path();
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.starts_with("~$") || name == "node_modules" {
            continue;
        }
        if p.is_dir() {
            scan_recent_vault_files(&p, depth + 1, cutoff, out);
        } else if p.is_file() {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| format!(".{}", e.to_ascii_lowercase()))
                .unwrap_or_default();
            if preview_ext_priority(&ext).is_none() {
                continue;
            }
            if let Ok(meta) = ent.metadata() {
                if let Ok(mt) = meta.modified() {
                    if mt >= cutoff {
                        let ts = mt
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis())
                            .unwrap_or(0);
                        out.push((p, ts));
                    }
                }
            }
        }
    }
}

fn detect_touched_files(reply: &str, turn_started: std::time::SystemTime) -> Vec<Value> {
    let cutoff = turn_started
        .checked_sub(Duration::from_secs(2))
        .unwrap_or(turn_started);

    struct Found {
        path: std::path::PathBuf,
        rel: Option<String>,
        ext: String,
        prio: u8,
        mentioned: bool,
        mtime_ms: u128,
    }

    let mut by_key: std::collections::HashMap<String, Found> = std::collections::HashMap::new();
    let mut consider = |p: std::path::PathBuf, mentioned: bool| {
        if !p.is_file() {
            return;
        }
        let fname = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if fname.starts_with("~$") || fname.starts_with('.') {
            return;
        }
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_ascii_lowercase()))
            .unwrap_or_default();
        let Some(prio) = preview_ext_priority(&ext) else {
            return;
        };
        let Ok(meta) = std::fs::metadata(&p) else {
            return;
        };
        let Ok(mt) = meta.modified() else {
            return;
        };
        if mt < cutoff {
            return;
        }
        let mtime_ms = mt
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let canon = std::fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
        let key = canon.to_string_lossy().to_lowercase();
        if let Some(ex) = by_key.get_mut(&key) {
            if mentioned {
                ex.mentioned = true;
            }
            if mtime_ms > ex.mtime_ms {
                ex.mtime_ms = mtime_ms;
            }
            return;
        }
        let rel = vault::vault_rel_if_inside(&p);
        by_key.insert(
            key,
            Found {
                path: p,
                rel,
                ext,
                prio,
                mentioned,
                mtime_ms,
            },
        );
    };

    for raw in extract_reply_candidate_paths(reply) {
        if let Ok(p) = vault::resolve_preview_path(&raw) {
            consider(p, true);
        } else if !raw.contains('/') && !raw.contains('\\') && !raw.contains(':') {
            // Maybe a wiki-style basename inside vault; let vault scan match it below
            let low = raw.to_ascii_lowercase();
            let mut recent = Vec::new();
            scan_recent_vault_files(&VAULT_DIR, 0, cutoff, &mut recent);
            for (rp, _) in recent {
                let rn = rp
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let rstem = rp
                    .file_stem()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if rn == low || rstem == low {
                    consider(rp, true);
                }
            }
        }
    }

    let mut recent_vault: Vec<(std::path::PathBuf, u128)> = Vec::new();
    scan_recent_vault_files(&VAULT_DIR, 0, cutoff, &mut recent_vault);
    for (rp, _) in recent_vault {
        consider(rp, false);
    }

    let mut items: Vec<Found> = by_key.into_values().collect();
    items.sort_by(|a, b| {
        b.mentioned
            .cmp(&a.mentioned)
            .then_with(|| a.prio.cmp(&b.prio))
            .then_with(|| b.mtime_ms.cmp(&a.mtime_ms))
    });
    items.truncate(5);

    items
        .into_iter()
        .map(|f| {
            let name = f
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let in_vault = f.rel.is_some();
            json!({
                "path": f.path.to_string_lossy(),
                "rel": f.rel,
                "in_vault": in_vault,
                "name": name,
                "ext": f.ext,
                "mentioned": f.mentioned
            })
        })
        .collect()
}

fn open_external_target(raw_target: &str, reveal: bool) -> Result<(String, String), String> {
    let trimmed = raw_target
        .trim()
        .trim_matches(|c| c == '<' || c == '>' || c == '"' || c == '\'');
    if trimmed.is_empty() {
        return Err("Boş hedef".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
    {
        Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
        return Ok(("url".to_string(), trimmed.to_string()));
    }

    let mut path_str = if lower.starts_with("file:///") {
        percent_decode_path(&trimmed[8..])
    } else if lower.starts_with("file://") {
        percent_decode_path(&trimmed[7..])
    } else {
        trimmed.to_string()
    };

    if path_str.starts_with("~/") || path_str.starts_with("~\\") {
        if let Ok(home) = std::env::var("USERPROFILE") {
            path_str = format!("{}{}", home, &path_str[1..]);
        }
    }
    path_str = path_str.replace('/', "\\");

    let mut path = std::path::PathBuf::from(&path_str);
    if !path.is_absolute() {
        if let Ok(resolved) = vault::resolve_preview_path(&path_str) {
            if resolved.exists() {
                path = resolved;
            }
        }
        if !path.is_absolute() {
            let in_root = ROOT.join(&path);
            let in_vault = VAULT_DIR.join(&path);
            if in_root.exists() {
                path = in_root;
            } else if in_vault.exists() {
                path = in_vault;
            }
        }
    } else if !path.exists() {
        if let Ok(resolved) = vault::resolve_preview_path(&path_str) {
            if resolved.exists() {
                path = resolved;
            }
        }
    }

    if path.is_dir() {
        Command::new("explorer.exe")
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Klasör açılamadı: {}", e))?;
        return Ok(("dir".to_string(), path.display().to_string()));
    }
    if path.is_file() {
        if reveal {
            Command::new("explorer.exe")
                .arg(format!("/select,{}", path.display()))
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Klasör açılamadı: {}", e))?;
            return Ok(("reveal".to_string(), path.display().to_string()));
        }
        Command::new("explorer.exe")
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Dosya açılamadı: {}", e))?;
        return Ok(("file".to_string(), path.display().to_string()));
    }
    if let Some(parent) = path.parent() {
        if parent.is_dir() {
            Command::new("explorer.exe")
                .arg(parent)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Üst klasör açılamadı: {}", e))?;
            return Ok(("parent".to_string(), parent.display().to_string()));
        }
    }
    Err(format!("Yol bulunamadı: {}", path.display()))
}

async fn open_target_ep(Json(r): Json<OpenTargetReq>) -> Response {
    let target = r.target;
    let reveal = r.reveal;
    let res = tokio::task::spawn_blocking(move || open_external_target(&target, reveal)).await;
    match res {
        Ok(Ok((kind, opened_path))) => Json(json!({
            "ok": true,
            "kind": kind,
            "path": opened_path
        }))
        .into_response(),
        Ok(Err(msg)) => err_resp(StatusCode::NOT_FOUND, msg),
        Err(e) => err_resp(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
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

#[derive(Debug, Clone, serde::Deserialize)]
struct DetachReq {
    tab: String,
    #[serde(default)]
    token: String,
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    #[serde(default)]
    w: Option<f64>,
    #[serde(default)]
    h: Option<f64>,
}

#[derive(Debug, Clone)]
enum WinCmd {
    Drag,
    Minimize,
    ToggleMaximize,
    Close,
    Detach(DetachReq),
    SetTitle(String),
}

fn percent_encode_query(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

fn parse_detach_cli_args() -> Option<DetachReq> {
    let args: Vec<String> = std::env::args().collect();
    let mut tab: Option<String> = None;
    let mut token = String::new();
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut w: Option<f64> = None;
    let mut h: Option<f64> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--detached-tab" if i + 1 < args.len() => {
                tab = Some(args[i + 1].clone());
                i += 2;
            }
            "--detach-token" if i + 1 < args.len() => {
                token = args[i + 1].clone();
                i += 2;
            }
            "--x" if i + 1 < args.len() => {
                x = args[i + 1].parse::<f64>().ok();
                i += 2;
            }
            "--y" if i + 1 < args.len() => {
                y = args[i + 1].parse::<f64>().ok();
                i += 2;
            }
            "--w" if i + 1 < args.len() => {
                w = args[i + 1].parse::<f64>().ok();
                i += 2;
            }
            "--h" if i + 1 < args.len() => {
                h = args[i + 1].parse::<f64>().ok();
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }
    tab.map(|t| DetachReq { tab: t, token, x, y, w, h })
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

    let detach_cli = parse_detach_cli_args();
    let is_detached = detach_cli.is_some();

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(1);
    let url = if let Some(ref req) = detach_cli {
        format!(
            "http://127.0.0.1:8780/?v={}&detach_tab={}&detach_token={}",
            ts,
            percent_encode_query(&req.tab),
            percent_encode_query(&req.token)
        )
    } else {
        format!("http://127.0.0.1:8780/?v={}", ts)
    };

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
    if let Some(ref req) = detach_cli {
        bounds.max = false;
        if let Some(w) = req.w.filter(|v| v.is_finite()) {
            bounds.w = w.clamp(760.0, (sw - 20.0).max(760.0));
        }
        if let Some(h) = req.h.filter(|v| v.is_finite()) {
            bounds.h = h.clamp(520.0, (sh - 44.0).max(520.0));
        }
        if let Some(x) = req.x.filter(|v| v.is_finite()) {
            bounds.x = x.clamp(-40.0, (sw - 180.0).max(0.0));
        }
        if let Some(y) = req.y.filter(|v| v.is_finite()) {
            bounds.y = y.clamp(0.0, (sh - 120.0).max(0.0));
        }
    }

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
            let body = req.body().as_str();
            if let Some(rest) = body.strip_prefix("title:") {
                let _ = p.send_event(WinCmd::SetTitle(rest.to_string()));
                return;
            }
            if let Some(rest) = body.strip_prefix("detach:") {
                if let Ok(dreq) = serde_json::from_str::<DetachReq>(rest) {
                    let _ = p.send_event(WinCmd::Detach(dreq));
                }
                return;
            }
            let cmd = match body {
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
        .with_new_window_req_handler(|req_url| {
            let _ = open_external_target(&req_url, false);
            false
        })
        .with_navigation_handler(|nav_url| {
            let low = nav_url.to_ascii_lowercase();
            if low.starts_with("http://127.0.0.1:8780")
                || low.starts_with("http://localhost:8780")
                || low.starts_with("about:")
                || low.starts_with("blob:")
                || low.starts_with("data:")
            {
                true
            } else {
                let _ = open_external_target(&nav_url, false);
                false
            }
        })
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
                .with_new_window_req_handler(|req_url| {
                    let _ = open_external_target(&req_url, false);
                    false
                })
                .with_navigation_handler(|nav_url| {
                    let low = nav_url.to_ascii_lowercase();
                    if low.starts_with("http://127.0.0.1:8780")
                        || low.starts_with("http://localhost:8780")
                        || low.starts_with("about:")
                        || low.starts_with("blob:")
                        || low.starts_with("data:")
                    {
                        true
                    } else {
                        let _ = open_external_target(&nav_url, false);
                        false
                    }
                })
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
                    if !is_detached {
                        save_win_bounds(&bounds);
                    }
                }
                WinCmd::Close => {
                    bounds.max = window.is_maximized();
                    if !is_detached {
                        save_win_bounds(&bounds);
                    }
                    drop(webview_opt.take());
                    media::shutdown();
                    std::thread::spawn(|| {
                        std::thread::sleep(Duration::from_millis(300));
                        std::process::exit(0);
                    });
                    *control_flow = ControlFlow::Exit;
                }
                WinCmd::SetTitle(t) => {
                    window.set_title(&t);
                }
                WinCmd::Detach(dreq) => {
                    if let Ok(exe) = std::env::current_exe() {
                        let mut cmd = std::process::Command::new(exe);
                        cmd.arg("--detached-tab").arg(&dreq.tab);
                        if !dreq.token.is_empty() {
                            cmd.arg("--detach-token").arg(&dreq.token);
                        }
                        if let Some(x) = dreq.x {
                            cmd.arg("--x").arg(format!("{}", x.round()));
                        }
                        if let Some(y) = dreq.y {
                            cmd.arg("--y").arg(format!("{}", y.round()));
                        }
                        if let Some(w) = dreq.w {
                            cmd.arg("--w").arg(format!("{}", w.round()));
                        }
                        if let Some(h) = dreq.h {
                            cmd.arg("--h").arg(format!("{}", h.round()));
                        }
                        let _ = cmd.spawn();
                    }
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
                if !is_detached {
                    save_win_bounds(&bounds);
                }
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
    memory_graph::init_memory_graph();
    std::thread::spawn(|| {
        let _ = store::fetch_agy_usage(true);
    });
    std::thread::spawn(|| {
        let _ = memory_graph::sync_vault_index();
    });
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(60));
        let _ = providers::reap_idle_procs(Duration::from_secs(600));
    });

    let (tx, _rx) = broadcast::channel::<Value>(256);
    let state = AppState {
        tx,
        tasks: Arc::new(Mutex::new(HashMap::new())),
        steps: Arc::new(Mutex::new(HashMap::new())),
        src_hashes: Arc::new(Mutex::new(HashMap::new())),
        mem_hashes: Arc::new(Mutex::new(HashMap::new())),
        auth_needed: Arc::new(AtomicBool::new(false)),
        auth_running: Arc::new(AtomicBool::new(false)),
        guard_pending: Arc::new(Mutex::new(HashMap::new())),
        guard_grants: Arc::new(Mutex::new(HashMap::new())),
        guard_seq: Arc::new(AtomicU64::new(0)),
    };

    let frontend_dir = ROOT.join("frontend");
    Router::new()
        .route("/api/health", get(health_ep))
        .route("/api/ping", get(ping_ep))
        .route("/api/system/battery", get(system_battery_ep))
        .route("/api/auth/login", post(auth_login_ep))
        .route("/api/ui_state", get(get_ui_state_ep).post(set_ui_state_ep))
        .route("/api/vault", get(get_vault_ep))
        .route("/api/vault/move", post(move_vault_item_ep))
        .route("/api/kasa", post(create_kasa_ep))
        .route("/api/kasa/update", post(update_kasa_ep))
        .route("/api/space", post(save_space_ep).delete(delete_space_ep))
        .route("/api/root_doc/space", post(update_root_doc_space_ep))
        .route("/api/folder", post(create_folder_ep))
        .route("/api/note", get(get_note_ep).post(save_note_ep).delete(delete_note_ep))
        .route("/api/note/create", post(create_note_ep))
        .route("/api/calendar", get(get_calendar_ep).post(post_calendar_ep))
        .route("/api/calendar/:ev_id", delete(delete_calendar_ep))
        .route(
            "/api/upload",
            post(upload_asset_ep).layer(DefaultBodyLimit::max(105 * 1024 * 1024)),
        )
        .route("/api/docx", get(get_docx_ep))
        .route("/api/docx_pdf", get(get_docx_pdf_ep).delete(delete_docx_pdf_ep))
        .route("/api/pptx", get(get_pptx_ep))
        .route("/api/pptx_pdf", get(get_pptx_pdf_ep).delete(delete_pptx_pdf_ep))
        .route("/api/xlsx", get(get_xlsx_ep))
        .route("/api/xlsx_pdf", get(get_xlsx_pdf_ep).delete(delete_xlsx_pdf_ep))
        .route("/api/pdf_info", get(get_pdf_info_ep))
        .route("/api/raw/*rel", get(raw_file_ep))
        .route("/api/local_raw", get(local_raw_file_ep))
        .route("/api/local_text", get(local_text_ep))
        .route("/api/chats", get(get_chats_ep).post(post_chat_ep))
        .route("/api/quota", get(quota_ep))
        .route("/api/log", get(get_log_ep).post(post_log_ep))
        .route("/api/events", get(events_ep))
        .route("/api/run", post(run_ep))
        .route("/api/stop", post(stop_ep))
        .route("/api/clear", post(clear_ep))
        .route("/api/compact", post(compact_ep))
        .route("/api/undo", post(undo_ep))
        .route("/api/guard/approve", post(guard_approve_ep))
        .route("/api/guard/decide", post(guard_decide_ep))
        .route("/api/media/status", get(media_status_ep))
        .route("/api/media/cmd", post(media_cmd_ep))
        .route("/api/media/open", post(media_open_ep))
        .route("/api/media/volume", post(media_volume_ep))
        .route("/api/open", post(open_target_ep))
        .route("/api/memory/stats", get(memory_stats_ep))
        .route("/api/memory/reindex", post(memory_reindex_ep))
        .route("/api/memory/query", get(memory_query_ep))
        .fallback_service(ServeDir::new(frontend_dir).append_index_html_on_directories(true))
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .layer(middleware::from_fn(no_cache_mw))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

fn ensure_background_daemon() -> bool {
    if is_port_listening() {
        return true;
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cmd = std::process::Command::new(exe);
        cmd.arg("--daemon-only")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
        if cmd.spawn().is_ok() {
            for _ in 0..100 {
                if is_port_listening() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }
    is_port_listening()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--vault-guard") {
        std::process::exit(vault_guard::run_cli_guard());
    }
    disable_windows_power_throttling();
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

    if !ensure_background_daemon() {
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
    providers::kill_all_procs();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn upload_large_chat_image_over_2mb_and_serve_raw() {
        let app = build_router();
        let mut payload = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        payload.resize(3 * 1024 * 1024 + 128, 0x42);

        let req = Request::builder()
            .method("POST")
            .uri("/api/upload?name=agydesk_test_large.png&note=.chat_images")
            .header("content-type", "image/png")
            .body(Body::from(payload.clone()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "upload >2MB must not hit 413");

        let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
        let rel = json_val["rel"].as_str().expect("rel field").to_string();
        assert!(rel.starts_with(".chat_images/"));

        let get_req = Request::builder()
            .method("GET")
            .uri(format!("/api/raw/{}", rel))
            .body(Body::empty())
            .unwrap();
        let get_resp = app.oneshot(get_req).await.unwrap();
        assert_eq!(get_resp.status(), StatusCode::OK, "raw serve must return 200");
        let served = axum::body::to_bytes(get_resp.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap();
        assert_eq!(served.len(), payload.len());

        if let Ok(p) = vault::safe_path(&rel) {
            let _ = std::fs::remove_file(p);
        }
    }
}
