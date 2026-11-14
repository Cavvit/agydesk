use crate::config::{ROOT, VAULT_DIR};
use once_cell::sync::Lazy;
use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const MAX_ASSET: usize = 50 * 1024 * 1024;

const IMG_EXT: &[&str] = &[".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"];
const DOC_EXT: &[&str] = &[".pdf", ".docx", ".doc", ".pptx", ".ppsx", ".ppt", ".xlsx", ".xls", ".csv", ".txt"];

fn is_img_ext(ext: &str) -> bool {
    IMG_EXT.contains(&ext)
}

fn is_doc_ext(ext: &str) -> bool {
    DOC_EXT.contains(&ext)
}

fn is_asset_ext(ext: &str) -> bool {
    is_img_ext(ext) || is_doc_ext(ext)
}

#[derive(Clone)]
pub struct FolderMeta {
    pub label: String,
    pub icon: String,
    pub accent: String,
    pub tag: String,
    pub desc: String,
}

static CUSTOM_FOLDERS: Lazy<Mutex<HashMap<String, FolderMeta>>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert(
        "Difransiyel_Denklemler".to_string(),
        FolderMeta {
            label: "Diferansiyel Denklemler".to_string(),
            icon: "∫".to_string(),
            accent: "#d2a8ff".to_string(),
            tag: "Matematik · Diferansiyel & Operatör".to_string(),
            desc: "1. mertebe (ayrılabilir, tam, integral çarpanı, homojen, lineer, Bernoulli, Riccati), yüksek mertebe operatör metodu ve Cauchy-Euler diferansiyel denklemler.".to_string(),
        },
    );
    m.insert(
        "Elektrik_Makineleri_Lab".to_string(),
        FolderMeta {
            label: "Elektrik Makinaları Lab".to_string(),
            icon: "⚡".to_string(),
            accent: "#e0a458".to_string(),
            tag: "EEM Lab · Deney & Trafo".to_string(),
            desc: "DC Şönt Motor, Tek ve Üç Fazlı Transformatör deney föyleri, eşdeğer devreler ve sözlü/quiz soru bankası.".to_string(),
        },
    );
    m.insert(
        "Kontrol_Sistemlerine_Giris".to_string(),
        FolderMeta {
            label: "Kontrol Sistemlerine Giriş".to_string(),
            icon: "∿".to_string(),
            accent: "#79c0ff".to_string(),
            tag: "Kontrol · Laplace & Blok".to_string(),
            desc: "Açık/kapalı çevrim sistemler, Laplace dönüşümü, transfer fonksiyonu modelleme ve blok diyagram indirgeme.".to_string(),
        },
    );
    m.insert(
        "Yuksek_Gerilim_Teknigi".to_string(),
        FolderMeta {
            label: "Yüksek Gerilim Tekniği".to_string(),
            icon: "🌩".to_string(),
            accent: "#f0883e".to_string(),
            tag: "Yüksek Gerilim · Şalt & Deşarj".to_string(),
            desc: "Trafo merkezi ekipmanları, kesici-ayırıcı manevra sıraları, izolatörler, deşarj olayları ve elektrot sistemleri.".to_string(),
        },
    );
    m.insert(
        "Secmeli_Tasarim".to_string(),
        FolderMeta {
            label: "Seçmeli Tasarım".to_string(),
            icon: "🛰".to_string(),
            accent: "#7bc47f".to_string(),
            tag: "SAYZEK · İHA & Termal".to_string(),
            desc: "Termal kamera görüntü analizi, İHA verileriyle arazi sınıflandırma, değişim tespiti ve 5N1K proje raporları.".to_string(),
        },
    );
    m.insert(
        "Haberlesme_Lab".to_string(),
        FolderMeta {
            label: "Haberleşme Laboratuvarı".to_string(),
            icon: "📡".to_string(),
            accent: "#58a6ff".to_string(),
            tag: "Haberleşme · Modülasyon & Fiber".to_string(),
            desc: "AM/FM/PWM/FSK modülasyonu, spektrum analizi, fiber optik verici-alıcı ve anten deneyleri.".to_string(),
        },
    );
    m.insert(
        "Kontrol_Lab".to_string(),
        FolderMeta {
            label: "Kontrol Laboratuvarı".to_string(),
            icon: "🎛️".to_string(),
            accent: "#3fb950".to_string(),
            tag: "Kontrol Lab · PID & Tank".to_string(),
            desc: "İkili su tankı seviye kontrolü, ısı akış sistemleri, araç hız kontrolü ve DC motor PID regülasyonu.".to_string(),
        },
    );
    m.insert(
        "Katihal_Elektronigi".to_string(),
        FolderMeta {
            label: "Katıhal Elektroniği".to_string(),
            icon: "⚛️".to_string(),
            accent: "#bc8cff".to_string(),
            tag: "Fizik & Yarıiletken · Kuantum & Bant".to_string(),
            desc: "Kristal örgüler, Miller indisleri, Drude iletkenlik modeli, Fermi-Dirac dağılımı ve p-n eklem fiziği.".to_string(),
        },
    );
    m.insert(
        "Universite_Secmeli_Beslenme".to_string(),
        FolderMeta {
            label: "Beslenme ve Sağlıklı Yaşam".to_string(),
            icon: "🥑".to_string(),
            accent: "#f1e05a".to_string(),
            tag: "Üni Seçmeli · Beslenme & Metabolizma".to_string(),
            desc: "Makro/mikro besin ögeleri, CHO, lipidler, proteinler, vitaminler ve sporcu beslenmesi rehberleri.".to_string(),
        },
    );
    m.insert(
        "Mikrodalga".to_string(),
        FolderMeta {
            label: "Mikrodalga".to_string(),
            icon: "〰️".to_string(),
            accent: "#ff7b72".to_string(),
            tag: "Mikrodalga · İletim & Kılavuz".to_string(),
            desc: "İletim hatları, Smith abağı, çoklu yansıma ve dikdörtgen/dairesel dalga kılavuzları.".to_string(),
        },
    );
    Mutex::new(m)
});

const SPACES_FILENAME: &str = ".agydesk_spaces.json";

const DEFAULT_D7_KEYS: &[&str] = &[
    "Difransiyel_Denklemler",
    "Elektrik_Makineleri_Lab",
    "Haberlesme_Lab",
    "Katihal_Elektronigi",
    "Kontrol_Lab",
    "Kontrol_Sistemlerine_Giris",
    "Mikrodalga",
    "Secmeli_Tasarim",
    "Universite_Secmeli_Beslenme",
    "Yuksek_Gerilim_Teknigi",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpaceDef {
    pub id: String,
    pub title: String,
    #[serde(default = "def_space_icon")]
    pub icon: String,
    #[serde(default = "def_accent")]
    pub accent: String,
    #[serde(default = "def_space_tag")]
    pub tag: String,
    #[serde(default)]
    pub desc: String,
}

fn def_space_icon() -> String {
    "🗂".to_string()
}
fn def_accent() -> String {
    "#e0a458".to_string()
}
fn def_space_tag() -> String {
    "Çalışma Alanı".to_string()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct KasaOverride {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub desc: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpacesCfg {
    #[serde(default = "def_version")]
    pub version: u32,
    #[serde(default)]
    pub spaces: Vec<SpaceDef>,
    #[serde(default)]
    pub assignments: HashMap<String, String>,
    #[serde(default)]
    pub kasa_meta: HashMap<String, KasaOverride>,
    #[serde(default)]
    pub tree_order: HashMap<String, Vec<String>>,
}

fn def_version() -> u32 {
    1
}

fn default_spaces_list() -> Vec<SpaceDef> {
    vec![
        SpaceDef {
            id: "donem_7".to_string(),
            title: "Dönem 7".to_string(),
            icon: "🎓".to_string(),
            accent: "#e0a458".to_string(),
            tag: "EEM · 7. Dönem".to_string(),
            desc: "7. dönem zorunlu ve seçmeli dersler, laboratuvar föyleri ve vize/final notları.".to_string(),
        },
        SpaceDef {
            id: "donem_8".to_string(),
            title: "Dönem 8".to_string(),
            icon: "🚀".to_string(),
            accent: "#79c0ff".to_string(),
            tag: "EEM · 8. Dönem".to_string(),
            desc: "8. dönem ders kasaları, bitirme projesi ve bahar dönemi çalışma alanları.".to_string(),
        },
        SpaceDef {
            id: "belgeler".to_string(),
            title: "Belgeler & Arşiv".to_string(),
            icon: "🗂".to_string(),
            accent: "#7bc47f".to_string(),
            tag: "Belgeler · Genel & Proje".to_string(),
            desc: "Ders dışı belgeler, CV, sertifikalar, resmi evraklar ve kişisel projeler.".to_string(),
        },
    ]
}

fn load_spaces_cfg() -> SpacesCfg {
    let mut cfg = SpacesCfg {
        version: 1,
        spaces: default_spaces_list(),
        assignments: DEFAULT_D7_KEYS
            .iter()
            .map(|k| ((*k).to_string(), "donem_7".to_string()))
            .collect(),
        kasa_meta: HashMap::new(),
        tree_order: HashMap::new(),
    };
    let p = VAULT_DIR.join(SPACES_FILENAME);
    if let Ok(raw) = fs::read_to_string(&p) {
        if let Ok(parsed) = serde_json::from_str::<SpacesCfg>(&raw) {
            let valid_spaces: Vec<SpaceDef> = parsed
                .spaces
                .into_iter()
                .filter(|s| !s.id.trim().is_empty() && !s.title.trim().is_empty())
                .collect();
            if !valid_spaces.is_empty() {
                cfg.spaces = valid_spaces;
            }
            for (k, v) in parsed.assignments {
                if !k.trim().is_empty() && !v.trim().is_empty() {
                    cfg.assignments.insert(k, v);
                }
            }
            cfg.kasa_meta = parsed.kasa_meta;
            for (k, v) in parsed.tree_order {
                let clean_v: Vec<String> = v.into_iter().filter(|s| !s.is_empty()).collect();
                if !clean_v.is_empty() {
                    cfg.tree_order.insert(k, clean_v);
                }
            }
        }
    }
    cfg
}

fn sort_entries_with_order(entries: &mut [PathBuf], order_names: Option<&Vec<String>>, dirs_last: bool) {
    let rank: HashMap<&str, usize> = match order_names {
        Some(list) if !list.is_empty() => list
            .iter()
            .enumerate()
            .map(|(i, s)| (s.as_str(), i))
            .collect(),
        _ => HashMap::new(),
    };
    entries.sort_by(|a, b| {
        let an = a.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let bn = b.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let ra = rank.get(an).copied();
        let rb = rank.get(bn).copied();
        match (ra, rb) {
            (Some(ia), Some(ib)) => ia.cmp(&ib),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => {
                let da = if dirs_last { a.is_dir() } else { false };
                let db = if dirs_last { b.is_dir() } else { false };
                da.cmp(&db).then_with(|| an.to_lowercase().cmp(&bn.to_lowercase()))
            }
        }
    });
}

fn save_spaces_cfg(cfg: &SpacesCfg) -> Result<(), String> {
    fs::create_dir_all(&*VAULT_DIR).map_err(|e| e.to_string())?;
    let p = VAULT_DIR.join(SPACES_FILENAME);
    let body = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&p, body.as_bytes()).map_err(|e| e.to_string())
}

fn resolve_kasa_space(key: &str, cfg: &SpacesCfg) -> String {
    let valid: std::collections::HashSet<&str> = cfg.spaces.iter().map(|s| s.id.as_str()).collect();
    if let Some(a) = cfg.assignments.get(key) {
        if valid.contains(a.as_str()) {
            return a.clone();
        }
    }
    if DEFAULT_D7_KEYS.contains(&key) && valid.contains("donem_7") {
        return "donem_7".to_string();
    }
    if valid.contains("belgeler") {
        return "belgeler".to_string();
    }
    cfg.spaces
        .first()
        .map(|s| s.id.clone())
        .unwrap_or_else(|| "donem_7".to_string())
}

static H1_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^#\s+(.+)$").unwrap());
static WIKI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]").unwrap());
static NUM_PREFIX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+_").unwrap());
static HTML_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());

fn folder_meta_for(key: &str, cfg: Option<&SpacesCfg>) -> FolderMeta {
    let mut base = if let Ok(map) = CUSTOM_FOLDERS.lock() {
        map.get(key).cloned()
    } else {
        None
    }
    .unwrap_or_else(|| {
        let label = key.replace('_', " ");
        FolderMeta {
            label: label.clone(),
            icon: "📘".to_string(),
            accent: "#e0a458".to_string(),
            tag: "Çalışma Kasası".to_string(),
            desc: format!("{} ders notları, deney raporları ve kaynak belgeleri.", label),
        }
    });
    if let Some(c) = cfg {
        if let Some(ov) = c.kasa_meta.get(key) {
            if let Some(v) = &ov.label {
                if !v.trim().is_empty() {
                    base.label = v.trim().to_string();
                }
            }
            if let Some(v) = &ov.icon {
                if !v.trim().is_empty() {
                    base.icon = v.trim().to_string();
                }
            }
            if let Some(v) = &ov.accent {
                if !v.trim().is_empty() {
                    base.accent = v.trim().to_string();
                }
            }
            if let Some(v) = &ov.tag {
                if !v.trim().is_empty() {
                    base.tag = v.trim().to_string();
                }
            }
            if let Some(v) = &ov.desc {
                if !v.trim().is_empty() {
                    base.desc = v.trim().to_string();
                }
            }
        }
    }
    base
}

fn clean_title(p: &Path, text: &str) -> String {
    if !text.is_empty() {
        if let Some(cap) = H1_RE.captures(text) {
            if let Some(m) = cap.get(1) {
                let raw = m.as_str().trim();
                let trimmed = raw
                    .trim_start_matches(|c: char| !c.is_alphanumeric())
                    .trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("Not");
    let stripped = NUM_PREFIX_RE.replace(stem, "");
    stripped.replace('_', " ")
}

fn mtime_of(p: &Path) -> f64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn ext_lower(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|s| format!(".{}", s.to_lowercase()))
        .unwrap_or_default()
}

pub fn safe_path(rel: &str) -> Result<PathBuf, String> {
    let clean = rel.replace('\\', "/").trim_start_matches('/').to_string();
    if clean.contains("..") {
        return Err("Geçersiz dosya yolu".to_string());
    }
    let mut p = VAULT_DIR.clone();
    for seg in clean.split('/').filter(|s| !s.is_empty()) {
        p.push(seg);
    }
    Ok(p)
}

fn rel_posix(p: &Path) -> String {
    p.strip_prefix(&*VAULT_DIR)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

struct ScanDirCtx<'a> {
    f_key: &'a str,
    f_label: &'a str,
    space_id: &'a str,
    cfg: &'a SpacesCfg,
    n_notes: &'a mut usize,
    n_docs: &'a mut usize,
    n_imgs: &'a mut usize,
    latest_mtime: &'a mut f64,
    preview_items: &'a mut Vec<Value>,
    index_id: &'a mut Option<String>,
    pages: &'a mut serde_json::Map<String, Value>,
    wikimap: &'a mut serde_json::Map<String, Value>,
    sources: &'a mut Vec<Value>,
    md_links_raw: &'a mut HashMap<String, Vec<String>>,
}

fn scan_dir_items(cur_dir: &Path, is_asset_bucket: bool, ctx: &mut ScanDirCtx<'_>) -> Vec<Value> {
    let mut items: Vec<Value> = Vec::new();
    let mut entries: Vec<PathBuf> = fs::read_dir(cur_dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .collect();
    let cur_rel = rel_posix(cur_dir);
    sort_entries_with_order(&mut entries, ctx.cfg.tree_order.get(&cur_rel), true);

    for f in entries {
        let fname = f.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if fname.starts_with('.') {
            continue;
        }
        if f.is_dir() {
            let special_bucket = fname == "_gorseller" || fname == "_ekler" || fname == "assets";
            let sub_kids = scan_dir_items(&f, is_asset_bucket || special_bucket, ctx);
            if special_bucket && sub_kids.is_empty() {
                continue;
            }
            let sub_rel = rel_posix(&f);
            let mt = mtime_of(&f);
            if mt > *ctx.latest_mtime {
                *ctx.latest_mtime = mt;
            }
            let sub_label = if fname == "_ekler" {
                format!("📎 Kaynak Belgeler ({})", sub_kids.len())
            } else if fname == "_gorseller" {
                format!("🖼 Görseller ({})", sub_kids.len())
            } else if fname == "assets" {
                format!("📁 Ekler ({})", sub_kids.len())
            } else {
                let raw_lbl = folder_meta_for(&fname, Some(ctx.cfg)).label;
                if sub_kids.is_empty() {
                    raw_lbl
                } else {
                    format!("{} ({})", raw_lbl, sub_kids.len())
                }
            };
            items.push(json!({
                "n": sub_label,
                "i": "📁",
                "open": false,
                "k": sub_kids,
                "kasa": ctx.f_key,
                "space": ctx.space_id,
                "rel": sub_rel
            }));
            continue;
        }

        let ext = ext_lower(&f);
        if ext != ".md" && ext != ".html" && !is_asset_ext(&ext) {
            continue;
        }

        let rel = rel_posix(&f);
        let nid = format!("note:{}", rel);
        let mt = mtime_of(&f);
        if mt > *ctx.latest_mtime {
            *ctx.latest_mtime = mt;
        }
        let mut head = String::new();
        let mut full_md = String::new();
        if ext == ".md" {
            *ctx.n_notes += 1;
            if let Ok(bytes) = fs::read(&f) {
                full_md = String::from_utf8_lossy(&bytes).to_string();
                head = full_md.chars().take(400).collect();
            }
        } else if ext == ".html" {
            *ctx.n_notes += 1;
        } else if is_img_ext(&ext) {
            *ctx.n_imgs += 1;
        } else {
            *ctx.n_docs += 1;
        }

        let title = if is_asset_bucket {
            fname.clone()
        } else {
            clean_title(&f, &head)
        };
        if ext == ".md" && !full_md.is_empty() {
            let links: Vec<String> = WIKI_RE
                .captures_iter(&full_md)
                .filter_map(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
                .collect();
            ctx.md_links_raw.insert(nid.clone(), links);
        }
        let icon = if ext == ".md" {
            "📝"
        } else if ext == ".html" {
            "🌐"
        } else if is_img_ext(&ext) {
            "🖼"
        } else if ext == ".docx" || ext == ".doc" {
            "📘"
        } else {
            "📄"
        };
        items.push(json!({
            "n": title,
            "id": nid,
            "i": icon,
            "rel": rel,
            "ext": ext,
            "kasa": ctx.f_key,
            "space": ctx.space_id
        }));
        ctx.pages.insert(
            nid.clone(),
            json!({
                "t": title,
                "i": icon,
                "rel": rel,
                "folder": ctx.f_label,
                "kasa": ctx.f_key,
                "space": ctx.space_id,
                "ext": ext,
                "mtime": mt
            }),
        );
        let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        ctx.wikimap.insert(fname.to_lowercase(), json!(nid));
        ctx.wikimap.insert(stem.to_lowercase(), json!(nid));
        ctx.wikimap.insert(title.to_lowercase(), json!(nid));
        ctx.wikimap
            .insert(stem.to_lowercase().replace('_', " "), json!(nid));

        if !is_asset_bucket && (ctx.index_id.is_none() || stem.starts_with("00_")) {
            *ctx.index_id = Some(nid.clone());
        }
        if !is_asset_bucket
            && (ext == ".md" || ext == ".html" || ext == ".pdf")
            && ctx.preview_items.len() < 4
        {
            ctx.preview_items.push(json!({
                "id": nid,
                "title": title,
                "icon": icon,
                "ext": ext
            }));
        }
        let checked = !is_asset_bucket
            && (stem.starts_with("00_")
                || stem.contains("TEK_PARCA")
                || stem.contains("Deney_1"));
        ctx.sources.push(json!({
            "id": nid,
            "rel": rel,
            "title": format!("{} · {}", ctx.f_label, title),
            "short_title": title,
            "kasa": ctx.f_key,
            "space": ctx.space_id,
            "folder": ctx.f_label,
            "ext": ext,
            "icon": icon,
            "checked": checked
        }));
    }
    items
}

pub fn scan_vault() -> Value {
    let cfg = load_spaces_cfg();
    if !VAULT_DIR.exists() {
        let spaces_empty: Vec<Value> = cfg
            .spaces
            .iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "title": s.title,
                    "icon": s.icon,
                    "accent": s.accent,
                    "tag": s.tag,
                    "desc": s.desc,
                    "count_kasas": 0,
                    "counts": { "notes": 0, "docs": 0, "images": 0, "total": 0 },
                    "mtime": 0.0,
                    "kasalar": []
                })
            })
            .collect();
        return json!({
            "vault_path": VAULT_DIR.to_string_lossy(),
            "spaces": spaces_empty,
            "tree": [],
            "kasalar": [],
            "root_docs": [],
            "pages": {},
            "wikimap": {},
            "sources": [],
            "backlinks": {}
        });
    }

    let mut tree: Vec<Value> = Vec::new();
    let mut kasalar: Vec<Value> = Vec::new();
    let mut root_docs: Vec<Value> = Vec::new();
    let mut pages: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut wikimap: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut sources: Vec<Value> = Vec::new();
    let mut md_links_raw: HashMap<String, Vec<String>> = HashMap::new();

    let mut folders: Vec<PathBuf> = fs::read_dir(&*VAULT_DIR)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && !p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .starts_with('.')
        })
        .collect();
    sort_entries_with_order(&mut folders, cfg.tree_order.get("__kasas__"), false);

    for (idx, d) in folders.iter().enumerate() {
        let f_key = d
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let meta = folder_meta_for(&f_key, Some(&cfg));
        let f_label = meta.label.clone();
        let space_id = resolve_kasa_space(&f_key, &cfg);

        let mut n_notes = 0usize;
        let mut n_docs = 0usize;
        let mut n_imgs = 0usize;
        let mut latest_mtime = mtime_of(d);
        let mut preview_items: Vec<Value> = Vec::new();
        let mut index_id: Option<String> = None;

        let mut ctx = ScanDirCtx {
            f_key: &f_key,
            f_label: &f_label,
            space_id: &space_id,
            cfg: &cfg,
            n_notes: &mut n_notes,
            n_docs: &mut n_docs,
            n_imgs: &mut n_imgs,
            latest_mtime: &mut latest_mtime,
            preview_items: &mut preview_items,
            index_id: &mut index_id,
            pages: &mut pages,
            wikimap: &mut wikimap,
            sources: &mut sources,
            md_links_raw: &mut md_links_raw,
        };
        let kids = scan_dir_items(d, false, &mut ctx);

        let fallback_idx = index_id.or_else(|| {
            kids.iter()
                .find_map(|k| k.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        });

        tree.push(json!({
            "n": f_label,
            "kasa": f_key,
            "space": space_id,
            "rel": f_key,
            "i": meta.icon,
            "open": idx < 2,
            "k": kids
        }));
        kasalar.push(json!({
            "key": f_key,
            "space": space_id,
            "title": f_label,
            "icon": meta.icon,
            "accent": meta.accent,
            "tag": meta.tag,
            "desc": meta.desc,
            "mtime": latest_mtime,
            "index_id": fallback_idx,
            "counts": {
                "notes": n_notes,
                "docs": n_docs,
                "images": n_imgs,
                "total": n_notes + n_docs + n_imgs
            },
            "previews": preview_items
        }));
    }

    // Kök dizindeki tekil belgeler (örn. 00_LAB_ORTAK_TAKVIM.md)
    let mut root_files: Vec<PathBuf> = fs::read_dir(&*VAULT_DIR)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && !p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .starts_with('.')
        })
        .collect();
    sort_entries_with_order(&mut root_files, cfg.tree_order.get("__root_docs__"), false);
    for f in root_files {
        let ext = ext_lower(&f);
        if ext != ".md" && ext != ".html" && !is_asset_ext(&ext) {
            continue;
        }
        let fname = f.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let nid = format!("note:{}", fname);
        let mt = mtime_of(&f);
        let mut head = String::new();
        let mut full_md = String::new();
        if ext == ".md" {
            if let Ok(bytes) = fs::read(&f) {
                full_md = String::from_utf8_lossy(&bytes).to_string();
                head = full_md.chars().take(400).collect();
            }
        }
        let title = clean_title(&f, &head);
        if ext == ".md" && !full_md.is_empty() {
            let links: Vec<String> = WIKI_RE
                .captures_iter(&full_md)
                .filter_map(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
                .collect();
            md_links_raw.insert(nid.clone(), links);
        }
        let icon = if ext == ".md" {
            "📝"
        } else if ext == ".html" {
            "🌐"
        } else if is_img_ext(&ext) {
            "🖼"
        } else if ext == ".docx" || ext == ".doc" {
            "📘"
        } else {
            "📄"
        };
        let stem = f.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let stem_up = stem.to_uppercase();
        let root_space = if stem_up.contains("LAB") || stem_up.contains("TAKVIM") {
            if cfg.spaces.iter().any(|s| s.id == "donem_7") {
                "donem_7".to_string()
            } else {
                cfg.spaces.first().map(|s| s.id.clone()).unwrap_or_else(|| "donem_7".to_string())
            }
        } else if cfg.spaces.iter().any(|s| s.id == "belgeler") {
            "belgeler".to_string()
        } else {
            cfg.spaces.first().map(|s| s.id.clone()).unwrap_or_else(|| "donem_7".to_string())
        };
        pages.insert(
            nid.clone(),
            json!({
                "t": title,
                "i": icon,
                "rel": fname,
                "folder": "Ortak Belgeler",
                "kasa": "",
                "space": root_space,
                "ext": ext,
                "mtime": mt
            }),
        );
        wikimap.insert(fname.to_lowercase(), json!(nid));
        wikimap.insert(stem.to_lowercase(), json!(nid));
        wikimap.insert(title.to_lowercase(), json!(nid));
        wikimap.insert(stem.to_lowercase().replace('_', " "), json!(nid));
        root_docs.push(json!({
            "id": nid,
            "rel": fname,
            "title": title,
            "icon": icon,
            "ext": ext,
            "space": root_space,
            "mtime": mt
        }));
    }

    let spaces_out: Vec<Value> = cfg
        .spaces
        .iter()
        .map(|sp| {
            let mut n_kasas = 0usize;
            let mut sp_notes = 0usize;
            let mut sp_docs = 0usize;
            let mut sp_imgs = 0usize;
            let mut sp_mtime = 0.0f64;
            let mut sp_list: Vec<Value> = Vec::new();
            for k in &kasalar {
                if k.get("space").and_then(|v| v.as_str()) == Some(sp.id.as_str()) {
                    n_kasas += 1;
                    let cnt = k.get("counts");
                    let kn = cnt.and_then(|c| c.get("notes")).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let kd = cnt.and_then(|c| c.get("docs")).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let ki = cnt.and_then(|c| c.get("images")).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let kt = cnt.and_then(|c| c.get("total")).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    sp_notes += kn;
                    sp_docs += kd;
                    sp_imgs += ki;
                    let km = k.get("mtime").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if km > sp_mtime {
                        sp_mtime = km;
                    }
                    sp_list.push(json!({
                        "key": k.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                        "title": k.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "icon": k.get("icon").and_then(|v| v.as_str()).unwrap_or("📘"),
                        "accent": k.get("accent").and_then(|v| v.as_str()).unwrap_or("#e0a458"),
                        "total": kt
                    }));
                }
            }
            json!({
                "id": sp.id,
                "title": sp.title,
                "icon": sp.icon,
                "accent": sp.accent,
                "tag": sp.tag,
                "desc": sp.desc,
                "count_kasas": n_kasas,
                "counts": {
                    "notes": sp_notes,
                    "docs": sp_docs,
                    "images": sp_imgs,
                    "total": sp_notes + sp_docs + sp_imgs
                },
                "mtime": sp_mtime,
                "kasalar": sp_list
            })
        })
        .collect();

    let mut backlinks: serde_json::Map<String, Value> = serde_json::Map::new();
    for (src_id, raw_targets) in md_links_raw {
        let src_title = pages
            .get(&src_id)
            .and_then(|p| p.get("t"))
            .and_then(|v| v.as_str())
            .unwrap_or(&src_id)
            .to_string();
        let src_folder = pages
            .get(&src_id)
            .and_then(|p| p.get("folder"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        for rt in raw_targets {
            let k = rt.to_lowercase().replace(".md", "").trim().to_string();
            let target_id = wikimap
                .get(&k)
                .or_else(|| wikimap.get(&k.replace('_', " ")))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if let Some(tid) = target_id {
                if tid != src_id {
                    let arr = backlinks
                        .entry(tid)
                        .or_insert_with(|| json!([]))
                        .as_array_mut()
                        .unwrap();
                    let exists = arr
                        .iter()
                        .any(|x| x.get("id").and_then(|v| v.as_str()) == Some(&src_id));
                    if !exists {
                        arr.push(json!({
                            "id": src_id,
                            "title": src_title,
                            "folder": src_folder
                        }));
                    }
                }
            }
        }
    }

    json!({
        "vault_path": VAULT_DIR.to_string_lossy(),
        "spaces": spaces_out,
        "tree": tree,
        "kasalar": kasalar,
        "root_docs": root_docs,
        "pages": pages,
        "wikimap": wikimap,
        "sources": sources,
        "backlinks": backlinks
    })
}

pub fn read_note(rel: &str) -> Result<Value, String> {
    let p = safe_path(rel)?;
    if !p.exists() {
        return Err(format!("Dosya bulunamadı: {}", rel));
    }
    let cfg = load_spaces_cfg();
    let ext = ext_lower(&p);
    let clean_rel = rel.replace('\\', "/");
    let parts: Vec<&str> = clean_rel.trim_start_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let f_key = if parts.len() > 1 {
        parts[0].to_string()
    } else {
        String::new()
    };
    let folder = if f_key.is_empty() {
        "Ortak Belgeler".to_string()
    } else {
        folder_meta_for(&f_key, Some(&cfg)).label
    };
    let space_id = if f_key.is_empty() {
        "donem_7".to_string()
    } else {
        resolve_kasa_space(&f_key, &cfg)
    };
    let mtime = mtime_of(&p);
    if ext == ".pdf" {
        return Ok(json!({
            "rel": rel,
            "ext": ext,
            "kasa": f_key,
            "space": space_id,
            "folder": folder,
            "title": clean_title(&p, ""),
            "content": "",
            "mtime": mtime
        }));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let title = clean_title(&p, if ext == ".md" { &text } else { "" });
    Ok(json!({
        "rel": rel,
        "ext": ext,
        "kasa": f_key,
        "space": space_id,
        "folder": folder,
        "title": title,
        "content": text,
        "mtime": mtime
    }))
}

pub fn write_note(rel: &str, content: &str) -> Result<Value, String> {
    let p = safe_path(rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content.as_bytes()).map_err(|e| e.to_string())?;
    let clean = rel.replace('\\', "/").trim_start_matches('/').to_string();
    let mirror = ROOT.join("notes").join(&clean);
    if mirror != p {
        if let Some(mp) = mirror.parent() {
            let _ = fs::create_dir_all(mp);
        }
        let _ = fs::write(&mirror, content.as_bytes());
    }
    read_note(rel)
}

fn slugify(text: &str) -> String {
    let mut s = String::with_capacity(text.len());
    for c in text.chars() {
        let mapped = match c {
            'ç' => 'c',
            'ğ' => 'g',
            'ı' => 'i',
            'ö' => 'o',
            'ş' => 's',
            'ü' => 'u',
            'Ç' => 'C',
            'Ğ' => 'G',
            'İ' => 'I',
            'Ö' => 'O',
            'Ş' => 'S',
            'Ü' => 'U',
            _ => c,
        };
        if mapped.is_ascii_alphanumeric() || mapped == '_' || mapped == ' ' || mapped == '-' {
            s.push(mapped);
        }
    }
    let parts: Vec<&str> = s
        .split(|c: char| c.is_whitespace() || c == '-')
        .filter(|p| !p.is_empty())
        .collect();
    let joined = parts.join("_");
    let truncated: String = joined.chars().take(60).collect();
    if truncated.is_empty() {
        "Yeni_Kasa".to_string()
    } else {
        truncated
    }
}

pub fn create_kasa(
    title: &str,
    tag: &str,
    desc: &str,
    icon: &str,
    space: &str,
    accent: &str,
) -> Result<Value, String> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Err("Kasa adı boş olamaz".to_string());
    }
    let folder_key = slugify(clean_title);
    let d = safe_path(&folder_key)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;

    let clean_tag = if tag.trim().is_empty() {
        "Çalışma Kasası".to_string()
    } else {
        tag.trim().to_string()
    };
    let meta_desc = if desc.trim().is_empty() {
        format!(
            "{} ders notları, deney raporları ve kaynak belgeleri.",
            clean_title
        )
    } else {
        desc.trim().to_string()
    };
    let clean_icon = if icon.trim().is_empty() {
        "📘".to_string()
    } else {
        icon.trim().to_string()
    };
    let clean_accent = if accent.trim().is_empty() {
        "#e0a458".to_string()
    } else {
        accent.trim().to_string()
    };

    let meta = FolderMeta {
        label: clean_title.to_string(),
        icon: clean_icon.clone(),
        accent: clean_accent.clone(),
        tag: clean_tag.clone(),
        desc: meta_desc.clone(),
    };
    if let Ok(mut map) = CUSTOM_FOLDERS.lock() {
        map.insert(folder_key.clone(), meta);
    }

    let mut cfg = load_spaces_cfg();
    let valid_ids: std::collections::HashSet<String> =
        cfg.spaces.iter().map(|s| s.id.clone()).collect();
    let clean_space = space.trim();
    let target_space = if !clean_space.is_empty() && valid_ids.contains(clean_space) {
        clean_space.to_string()
    } else {
        resolve_kasa_space(&folder_key, &cfg)
    };
    cfg.assignments
        .insert(folder_key.clone(), target_space.clone());
    cfg.kasa_meta.insert(
        folder_key.clone(),
        KasaOverride {
            label: Some(clean_title.to_string()),
            icon: Some(clean_icon),
            accent: Some(clean_accent),
            tag: Some(clean_tag),
            desc: Some(meta_desc.clone()),
        },
    );
    save_spaces_cfg(&cfg)?;

    let idx_rel = format!("{}/00_{}_ANA_INDEKS.md", folder_key, folder_key.to_uppercase());
    let idx_path = safe_path(&idx_rel)?;
    if !idx_path.exists() {
        let content = format!(
            "# {} — Ana İndeks\n\n> [!NOTE] **Kasa Özeti**\n> {}\n\n## Konular & Notlar\n- Bu kasaya yeni not eklemek için sol paneldeki **＋ Yeni Not** butonunu kullanabilir veya PDF/Görsel/Word dosyalarını doğrudan sürükleyip bırakabilirsin.\n",
            clean_title, meta_desc
        );
        let _ = write_note(&idx_rel, &content);
    }
    Ok(json!({
        "key": folder_key,
        "title": clean_title,
        "space": target_space,
        "index_id": format!("note:{}", idx_rel)
    }))
}

pub fn update_kasa(
    key: &str,
    title: Option<&str>,
    tag: Option<&str>,
    desc: Option<&str>,
    icon: Option<&str>,
    accent: Option<&str>,
    space: Option<&str>,
) -> Result<Value, String> {
    let clean_key = key.replace('\\', "/").trim_matches('/').to_string();
    if clean_key.is_empty() || clean_key.contains('/') {
        return Err("Geçersiz kasa anahtarı".to_string());
    }
    let d = safe_path(&clean_key)?;
    if !d.exists() || !d.is_dir() {
        return Err(format!("Kasa bulunamadı: {}", clean_key));
    }

    let mut cfg = load_spaces_cfg();
    let valid_ids: std::collections::HashSet<String> =
        cfg.spaces.iter().map(|s| s.id.clone()).collect();
    if let Some(sp) = space {
        let sp_clean = sp.trim();
        if !sp_clean.is_empty() {
            if !valid_ids.contains(sp_clean) {
                return Err(format!("Geçersiz alan: {}", sp_clean));
            }
            cfg.assignments
                .insert(clean_key.clone(), sp_clean.to_string());
        }
    }

    let cur_meta = folder_meta_for(&clean_key, Some(&cfg));
    let mut entry = cfg.kasa_meta.get(&clean_key).cloned().unwrap_or_default();

    let pick = |new_val: Option<&str>, existing: Option<String>, fallback: String| -> String {
        if let Some(v) = new_val {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        existing.filter(|s| !s.trim().is_empty()).unwrap_or(fallback)
    };

    let new_label = pick(title, entry.label, cur_meta.label);
    let new_icon = pick(icon, entry.icon, cur_meta.icon);
    let new_accent = pick(accent, entry.accent, cur_meta.accent);
    let new_tag = pick(tag, entry.tag, cur_meta.tag);
    let new_desc = pick(desc, entry.desc, cur_meta.desc);

    entry.label = Some(new_label.clone());
    entry.icon = Some(new_icon.clone());
    entry.accent = Some(new_accent.clone());
    entry.tag = Some(new_tag.clone());
    entry.desc = Some(new_desc.clone());

    if let Ok(mut map) = CUSTOM_FOLDERS.lock() {
        map.insert(
            clean_key.clone(),
            FolderMeta {
                label: new_label.clone(),
                icon: new_icon.clone(),
                accent: new_accent.clone(),
                tag: new_tag.clone(),
                desc: new_desc.clone(),
            },
        );
    }

    cfg.kasa_meta.insert(clean_key.clone(), entry);
    save_spaces_cfg(&cfg)?;
    let resolved_space = resolve_kasa_space(&clean_key, &cfg);
    Ok(json!({
        "key": clean_key,
        "space": resolved_space,
        "label": new_label,
        "icon": new_icon,
        "accent": new_accent,
        "tag": new_tag,
        "desc": new_desc,
    }))
}

pub fn save_space(
    space_id: Option<&str>,
    title: &str,
    icon: &str,
    accent: &str,
    tag: &str,
    desc: &str,
) -> Result<Value, String> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Err("Alan adı boş olamaz".to_string());
    }
    let mut cfg = load_spaces_cfg();
    let clean_id = space_id.unwrap_or("").trim();

    let saved = if !clean_id.is_empty() {
        if let Some(existing) = cfg.spaces.iter_mut().find(|s| s.id == clean_id) {
            existing.title = clean_title.to_string();
            if !icon.trim().is_empty() {
                existing.icon = icon.trim().to_string();
            }
            if !accent.trim().is_empty() {
                existing.accent = accent.trim().to_string();
            }
            if !tag.trim().is_empty() {
                existing.tag = tag.trim().to_string();
            } else if existing.tag.trim().is_empty() {
                existing.tag = "Çalışma Alanı".to_string();
            }
            existing.desc = desc.trim().to_string();
            existing.clone()
        } else {
            return Err(format!("Alan bulunamadı: {}", clean_id));
        }
    } else {
        let base_id = slugify(clean_title).to_lowercase();
        let mut new_id = base_id.clone();
        let mut n = 2usize;
        let used: std::collections::HashSet<String> =
            cfg.spaces.iter().map(|s| s.id.clone()).collect();
        while used.contains(&new_id) {
            new_id = format!("{}_{}", base_id, n);
            n += 1;
        }
        let item = SpaceDef {
            id: new_id,
            title: clean_title.to_string(),
            icon: if icon.trim().is_empty() {
                "🗂".to_string()
            } else {
                icon.trim().to_string()
            },
            accent: if accent.trim().is_empty() {
                "#e0a458".to_string()
            } else {
                accent.trim().to_string()
            },
            tag: if tag.trim().is_empty() {
                "Çalışma Alanı".to_string()
            } else {
                tag.trim().to_string()
            },
            desc: if desc.trim().is_empty() {
                format!("{} çalışma alanı ve kasaları.", clean_title)
            } else {
                desc.trim().to_string()
            },
        };
        cfg.spaces.push(item.clone());
        item
    };

    save_spaces_cfg(&cfg)?;
    serde_json::to_value(saved).map_err(|e| e.to_string())
}

pub fn delete_space(space_id: &str) -> Result<Value, String> {
    let clean_id = space_id.trim();
    let mut cfg = load_spaces_cfg();
    if cfg.spaces.len() <= 1 {
        return Err("Son kalan çalışma alanı silinemez".to_string());
    }
    let Some(idx) = cfg.spaces.iter().position(|s| s.id == clean_id) else {
        return Err(format!("Alan bulunamadı: {}", clean_id));
    };
    cfg.spaces.remove(idx);
    let fallback = if cfg.spaces.iter().any(|s| s.id == "belgeler") {
        "belgeler".to_string()
    } else {
        cfg.spaces[0].id.clone()
    };
    for v in cfg.assignments.values_mut() {
        if v == clean_id {
            *v = fallback.clone();
        }
    }
    save_spaces_cfg(&cfg)?;
    Ok(json!({
        "deleted": clean_id,
        "fallback": fallback
    }))
}

pub fn create_folder(parent_rel: &str, name: &str) -> Result<Value, String> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Klasör adı boş olamaz".to_string());
    }
    let parent_clean = parent_rel.replace('\\', "/").trim_matches('/').to_string();
    if parent_clean.is_empty() {
        return Err("Üst kasa/klasör belirtilmedi".to_string());
    }
    let parent_path = safe_path(&parent_clean)?;
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(format!("Üst klasör bulunamadı: {}", parent_clean));
    }
    let slug = slugify(clean_name);
    let mut rel = format!("{}/{}", parent_clean, slug);
    let mut d = safe_path(&rel)?;
    let mut n = 2;
    while d.exists() {
        rel = format!("{}/{}_{}", parent_clean, slug, n);
        d = safe_path(&rel)?;
        n += 1;
    }
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let dir_name = d.file_name().and_then(|s| s.to_str()).unwrap_or(&slug).to_string();
    if let Ok(mut guard) = CUSTOM_FOLDERS.lock() {
        guard.insert(
            dir_name,
            FolderMeta {
                label: clean_name.to_string(),
                icon: "📁".to_string(),
                accent: "#e0a458".to_string(),
                tag: "Klasör".to_string(),
                desc: String::new(),
            },
        );
    }
    let mirror = ROOT.join("notes").join(&rel);
    if mirror != d {
        let _ = fs::create_dir_all(&mirror);
    }
    let top_kasa = parent_clean.split('/').next().unwrap_or(&parent_clean).to_string();
    Ok(json!({
        "rel": rel,
        "name": clean_name,
        "kasa": top_kasa
    }))
}

pub fn create_note(kasa: &str, title: &str, content: &str) -> Result<Value, String> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Err("Not başlığı boş olamaz".to_string());
    }
    let raw_kasa = kasa.replace('\\', "/").trim_matches('/').to_string();
    let kasa_clean = match safe_path(&raw_kasa) {
        Ok(p) if p.exists() && p.is_dir() => raw_kasa,
        _ => {
            let parts: Vec<String> = raw_kasa
                .split('/')
                .filter(|s| !s.is_empty())
                .map(slugify)
                .collect();
            if parts.is_empty() {
                slugify(kasa)
            } else {
                parts.join("/")
            }
        }
    };
    let slug = slugify(clean_title);
    let mut rel = format!("{}/{}.md", kasa_clean, slug);
    let mut p = safe_path(&rel)?;
    let mut n = 2;
    while p.exists() {
        rel = format!("{}/{}_{}.md", kasa_clean, slug, n);
        p = safe_path(&rel)?;
        n += 1;
    }
    let body = if content.trim().is_empty() {
        format!(
            "# {}\n\nBuraya notlarını, matematiksel ifadeleri ($f_0 = \\frac{{1}}{{2\\pi\\sqrt{{LC}}}}$) veya devre şemalarını yazabilirsin.\n",
            clean_title
        )
    } else {
        content.trim().to_string()
    };
    let mut note = write_note(&rel, &body)?;
    if let Some(obj) = note.as_object_mut() {
        obj.insert("id".to_string(), json!(format!("note:{}", rel)));
    }
    Ok(note)
}

pub fn delete_note(rel: &str) -> Result<Value, String> {
    let p = safe_path(rel)?;
    if !p.exists() || p.is_dir() {
        return Err(format!("Dosya bulunamadı: {}", rel));
    }
    fs::remove_file(&p).map_err(|e| e.to_string())?;
    let clean = rel.replace('\\', "/").trim_start_matches('/').to_string();
    let mirror = ROOT.join("notes").join(clean);
    if mirror.exists() && !mirror.is_dir() {
        let _ = fs::remove_file(&mirror);
    }
    Ok(json!({ "deleted": rel }))
}

fn clean_rel_str(raw: &str) -> String {
    let s = raw.trim();
    let s = s.strip_prefix("note:").unwrap_or(s);
    s.replace('\\', "/").trim_matches('/').to_string()
}

fn mirror_move_path(old_rel: &str, new_rel: &str) {
    let mirror_root = ROOT.join("notes");
    if mirror_root != *VAULT_DIR {
        let m_src = mirror_root.join(old_rel);
        let m_dst = mirror_root.join(new_rel);
        if m_src.exists() && !m_dst.exists() {
            if let Some(parent) = m_dst.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::rename(&m_src, &m_dst);
        }
    }
}

fn migrate_tree_order_keys(tree_order: &mut HashMap<String, Vec<String>>, old_rel: &str, new_rel: &str) {
    let prefix = format!("{}/", old_rel);
    let mut updated: HashMap<String, Vec<String>> = HashMap::with_capacity(tree_order.len());
    for (k, v) in tree_order.drain() {
        if k == old_rel {
            updated.insert(new_rel.to_string(), v);
        } else if let Some(rest) = k.strip_prefix(&prefix) {
            updated.insert(format!("{}/{}", new_rel, rest), v);
        } else {
            updated.insert(k, v);
        }
    }
    *tree_order = updated;
}

fn sorted_dir_names(dir: &Path, order_names: Option<&Vec<String>>, dirs_last: bool, only_dirs: bool, only_files: bool) -> Vec<String> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let nm = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if nm.starts_with('.') {
                return false;
            }
            if only_dirs && !p.is_dir() {
                return false;
            }
            if only_files && !p.is_file() {
                return false;
            }
            true
        })
        .collect();
    sort_entries_with_order(&mut entries, order_names, dirs_last);
    entries
        .into_iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string()))
        .collect()
}

pub fn move_item(src_rel: &str, target_rel: &str, position: &str) -> Result<Value, String> {
    let clean_src = clean_rel_str(src_rel);
    let clean_target = clean_rel_str(target_rel);
    let pos = if position.trim().is_empty() {
        "into".to_string()
    } else {
        position.trim().to_lowercase()
    };
    if pos != "into" && pos != "before" && pos != "after" {
        return Err("Geçersiz konum (into, before, after bekleniyor)".to_string());
    }
    if clean_src.is_empty() {
        return Err("Taşınacak öğe belirtilmedi".to_string());
    }
    let src = safe_path(&clean_src)?;
    if !src.exists() {
        return Err(format!("Öğe bulunamadı: {}", clean_src));
    }
    let src_is_dir = src.is_dir();
    let src_is_root_kasa = src_is_dir && !clean_src.contains('/');
    let src_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Geçersiz dosya adı".to_string())?
        .to_string();
    let old_parent_rel = clean_src
        .rsplit_once('/')
        .map(|(p, _)| p.to_string())
        .unwrap_or_default();

    let mut cfg = load_spaces_cfg();

    if pos == "into" {
        if src_is_root_kasa {
            return Err("Çalışma kasası başka bir klasörün içine taşınamaz".to_string());
        }
        let is_root_target = clean_target.is_empty() || clean_target == "_root_docs";
        let dst_dir = if is_root_target {
            VAULT_DIR.clone()
        } else {
            safe_path(&clean_target)?
        };
        if !dst_dir.exists() || !dst_dir.is_dir() {
            return Err(format!("Hedef klasör bulunamadı: {}", clean_target));
        }
        let new_parent_rel = if is_root_target {
            String::new()
        } else {
            clean_target.clone()
        };
        if src_is_dir && (new_parent_rel == clean_src || new_parent_rel.starts_with(&format!("{}/", clean_src))) {
            return Err("Klasör kendi içine veya alt klasörüne taşınamaz".to_string());
        }
        if old_parent_rel == new_parent_rel {
            let kasa = clean_src
                .split_once('/')
                .map(|(k, _)| k.to_string())
                .unwrap_or_default();
            return Ok(json!({
                "old_rel": clean_src,
                "new_rel": clean_src,
                "is_dir": src_is_dir,
                "kasa": kasa,
                "moved": false,
                "reordered": false,
                "already_here": true
            }));
        }
        let dst = dst_dir.join(&src_name);
        if dst.exists() {
            return Err(format!("Hedef klasörde '{}' zaten mevcut", src_name));
        }
        fs::rename(&src, &dst).map_err(|e| format!("Taşıma hatası: {}", e))?;
        let new_rel = if new_parent_rel.is_empty() {
            src_name.clone()
        } else {
            format!("{}/{}", new_parent_rel, src_name)
        };
        mirror_move_path(&clean_src, &new_rel);

        let old_key = if old_parent_rel.is_empty() {
            "__root_docs__".to_string()
        } else {
            old_parent_rel
        };
        if let Some(list) = cfg.tree_order.get_mut(&old_key) {
            list.retain(|n| n != &src_name);
        }
        let new_key = if new_parent_rel.is_empty() {
            "__root_docs__".to_string()
        } else {
            new_parent_rel
        };
        if let Some(list) = cfg.tree_order.get_mut(&new_key) {
            if !list.contains(&src_name) {
                list.push(src_name.clone());
            }
        }
        if src_is_dir {
            migrate_tree_order_keys(&mut cfg.tree_order, &clean_src, &new_rel);
        }
        save_spaces_cfg(&cfg)?;
        let kasa = new_rel
            .split_once('/')
            .map(|(k, _)| k.to_string())
            .unwrap_or_default();
        return Ok(json!({
            "old_rel": clean_src,
            "new_rel": new_rel,
            "is_dir": src_is_dir,
            "kasa": kasa,
            "moved": true,
            "reordered": false
        }));
    }

    // pos == "before" || pos == "after"
    if clean_target.is_empty() {
        return Err("Hedef öğe belirtilmedi".to_string());
    }
    if clean_src == clean_target {
        let kasa = clean_src
            .split_once('/')
            .map(|(k, _)| k.to_string())
            .unwrap_or_default();
        return Ok(json!({
            "old_rel": clean_src,
            "new_rel": clean_src,
            "is_dir": src_is_dir,
            "kasa": kasa,
            "moved": false,
            "reordered": false
        }));
    }
    let ref_path = safe_path(&clean_target)?;
    if !ref_path.exists() {
        return Err(format!("Hedef öğe bulunamadı: {}", clean_target));
    }
    let ref_name = ref_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Geçersiz hedef adı".to_string())?
        .to_string();

    if src_is_root_kasa {
        if clean_target.contains('/') || !ref_path.is_dir() {
            return Err("Çalışma kasası yalnızca başka bir kasa ile sıralanabilir".to_string());
        }
        let src_sp = resolve_kasa_space(&clean_src, &cfg);
        let ref_sp = resolve_kasa_space(&clean_target, &cfg);
        if src_sp != ref_sp {
            cfg.assignments.insert(clean_src.clone(), ref_sp);
        }
        let mut names = sorted_dir_names(
            &VAULT_DIR,
            cfg.tree_order.get("__kasas__"),
            false,
            true,
            false,
        );
        names.retain(|n| n != &clean_src);
        let ref_idx = names
            .iter()
            .position(|n| n == &ref_name)
            .unwrap_or(names.len());
        let ins_idx = if pos == "before" {
            ref_idx
        } else {
            (ref_idx + 1).min(names.len())
        };
        names.insert(ins_idx, clean_src.clone());
        cfg.tree_order.insert("__kasas__".to_string(), names);
        save_spaces_cfg(&cfg)?;
        return Ok(json!({
            "old_rel": clean_src,
            "new_rel": clean_src,
            "is_dir": true,
            "kasa": clean_src,
            "moved": false,
            "reordered": true
        }));
    }

    if !clean_target.contains('/') {
        if !ref_path.is_file() {
            return Err("Dosya veya klasör bir kasanın yerine konulamaz; kasanın içine bırakın".to_string());
        }
        let mut moved = false;
        let mut new_rel = clean_src.clone();
        if !old_parent_rel.is_empty() {
            if src_is_dir {
                return Err("Klasör kök belge alanına taşınamaz".to_string());
            }
            let dst = VAULT_DIR.join(&src_name);
            if dst.exists() {
                return Err(format!("Ortak belgelerde '{}' zaten mevcut", src_name));
            }
            fs::rename(&src, &dst).map_err(|e| format!("Taşıma hatası: {}", e))?;
            new_rel = src_name.clone();
            mirror_move_path(&clean_src, &new_rel);
            if let Some(list) = cfg.tree_order.get_mut(&old_parent_rel) {
                list.retain(|n| n != &src_name);
            }
            moved = true;
        }
        let mut names = sorted_dir_names(
            &VAULT_DIR,
            cfg.tree_order.get("__root_docs__"),
            false,
            false,
            true,
        );
        names.retain(|n| n != &src_name);
        let ref_idx = names
            .iter()
            .position(|n| n == &ref_name)
            .unwrap_or(names.len());
        let ins_idx = if pos == "before" {
            ref_idx
        } else {
            (ref_idx + 1).min(names.len())
        };
        names.insert(ins_idx, src_name);
        cfg.tree_order.insert("__root_docs__".to_string(), names);
        save_spaces_cfg(&cfg)?;
        return Ok(json!({
            "old_rel": clean_src,
            "new_rel": new_rel,
            "is_dir": false,
            "kasa": "",
            "moved": moved,
            "reordered": true
        }));
    }

    let target_parent_rel = clean_target
        .rsplit_once('/')
        .map(|(p, _)| p.to_string())
        .unwrap_or_default();
    let dst_dir = safe_path(&target_parent_rel)?;
    let mut moved = false;
    let mut new_rel = clean_src.clone();

    if old_parent_rel != target_parent_rel {
        if src_is_dir
            && (target_parent_rel == clean_src
                || target_parent_rel.starts_with(&format!("{}/", clean_src)))
        {
            return Err("Klasör kendi içine veya alt klasörüne taşınamaz".to_string());
        }
        let dst = dst_dir.join(&src_name);
        if dst.exists() {
            return Err(format!("Hedef klasörde '{}' zaten mevcut", src_name));
        }
        fs::rename(&src, &dst).map_err(|e| format!("Taşıma hatası: {}", e))?;
        new_rel = format!("{}/{}", target_parent_rel, src_name);
        mirror_move_path(&clean_src, &new_rel);
        let old_key = if old_parent_rel.is_empty() {
            "__root_docs__".to_string()
        } else {
            old_parent_rel
        };
        if let Some(list) = cfg.tree_order.get_mut(&old_key) {
            list.retain(|n| n != &src_name);
        }
        if src_is_dir {
            migrate_tree_order_keys(&mut cfg.tree_order, &clean_src, &new_rel);
        }
        moved = true;
    }

    let mut names = sorted_dir_names(
        &dst_dir,
        cfg.tree_order.get(&target_parent_rel),
        true,
        false,
        false,
    );
    names.retain(|n| n != &src_name);
    let ref_idx = names
        .iter()
        .position(|n| n == &ref_name)
        .unwrap_or(names.len());
    let ins_idx = if pos == "before" {
        ref_idx
    } else {
        (ref_idx + 1).min(names.len())
    };
    names.insert(ins_idx, src_name);
    cfg.tree_order.insert(target_parent_rel, names);
    save_spaces_cfg(&cfg)?;
    let kasa = new_rel
        .split_once('/')
        .map(|(k, _)| k.to_string())
        .unwrap_or_default();
    Ok(json!({
        "old_rel": clean_src,
        "new_rel": new_rel,
        "is_dir": src_is_dir,
        "kasa": kasa,
        "moved": moved,
        "reordered": true
    }))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn docx_to_html(rel: &str) -> Result<Value, String> {
    let p = safe_path(rel)?;
    if !p.exists() {
        return Err(format!("Dosya bulunamadı: {}", rel));
    }
    let file = fs::File::open(&p).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut doc_xml = String::new();
    if let Ok(mut entry) = archive.by_name("word/document.xml") {
        let _ = entry.read_to_string(&mut doc_xml);
    }
    if doc_xml.is_empty() {
        return Ok(json!({
            "rel": rel,
            "title": p.file_name().and_then(|n| n.to_str()).unwrap_or(""),
            "html": "<p>(Boş belge)</p>"
        }));
    }

    let mut reader = Reader::from_str(&doc_xml);
    reader.trim_text(false);
    let mut out: Vec<String> = Vec::new();
    let mut in_p = false;
    let mut in_t = false;
    let mut cur_p = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.local_name();
                if name.as_ref() == b"p" {
                    in_p = true;
                    cur_p.clear();
                } else if name.as_ref() == b"t" && in_p {
                    in_t = true;
                }
            }
            Ok(Event::Text(e)) => {
                if in_t {
                    if let Ok(txt) = e.unescape() {
                        cur_p.push_str(&txt);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = e.local_name();
                if name.as_ref() == b"t" {
                    in_t = false;
                } else if name.as_ref() == b"p" {
                    in_p = false;
                    let trimmed = cur_p.trim();
                    if !trimmed.is_empty() {
                        out.push(format!("<p>{}</p>", html_escape(trimmed)));
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    let html_str = if out.is_empty() {
        "<p>(Metin içeriği bulunamadı)</p>".to_string()
    } else {
        out.join("\n")
    };
    Ok(json!({
        "rel": rel,
        "title": p.file_name().and_then(|n| n.to_str()).unwrap_or(""),
        "html": html_str
    }))
}

fn b64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((data.len() + 2) / 3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(T[b0 >> 2] as char);
        out.push(T[((b0 & 3) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 { T[((b1 & 15) << 2) | (b2 >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[b2 & 63] as char } else { '=' });
    }
    out
}

pub fn pptx_to_slides(rel: &str) -> Result<Value, String> {
    let p = safe_path(rel)?;
    if !p.exists() {
        return Err(format!("Dosya bulunamadı: {}", rel));
    }
    let ext = ext_lower(&p);
    let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    if ext == ".ppt" {
        return Ok(json!({
            "rel": rel,
            "title": fname,
            "count": 0,
            "slides": [],
            "note": "Eski ikili .ppt formatı doğrudan XML olarak okunamıyor; PowerPoint üzerinden .pptx veya .pdf olarak kaydedin."
        }));
    }
    let file = fs::File::open(&p).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let slide_re = Regex::new(r"^ppt/slides/slide(\d+)\.xml$").unwrap();
    let mut slide_entries: Vec<(usize, String, String)> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let name = f.name().to_string();
            if let Some(cap) = slide_re.captures(&name) {
                let snum_str = cap[1].to_string();
                let num: usize = snum_str.parse().unwrap_or(0);
                slide_entries.push((num, name, snum_str));
            }
        }
    }
    slide_entries.sort_by_key(|x| x.0);

    let mut slides: Vec<Value> = Vec::new();
    for (idx, (_, sname, snum)) in slide_entries.iter().enumerate() {
        let mut sxml = String::new();
        if let Ok(mut entry) = archive.by_name(sname) {
            let _ = entry.read_to_string(&mut sxml);
        }
        let mut reader = Reader::from_str(&sxml);
        reader.trim_text(false);
        let mut in_sp = false;
        let mut is_title_sp = false;
        let mut in_p = false;
        let mut in_t = false;
        let mut cur_p = String::new();
        let mut sp_paras: Vec<String> = Vec::new();
        let mut title = String::new();
        let mut lines: Vec<String> = Vec::new();
        let mut rel_ids: Vec<String> = Vec::new();

        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) => {
                    let ln = e.local_name();
                    let tag = ln.as_ref();
                    if tag == b"sp" {
                        in_sp = true;
                        is_title_sp = false;
                        sp_paras.clear();
                    } else if tag == b"ph" && in_sp {
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == b"type" {
                                let v = String::from_utf8_lossy(&attr.value);
                                if v == "title" || v == "ctrTitle" {
                                    is_title_sp = true;
                                }
                            }
                        }
                    } else if tag == b"p" {
                        in_p = true;
                        cur_p.clear();
                    } else if tag == b"t" && in_p {
                        in_t = true;
                    } else if tag == b"blip" {
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == b"embed" {
                                rel_ids.push(String::from_utf8_lossy(&attr.value).to_string());
                            }
                        }
                    }
                }
                Ok(Event::Empty(e)) => {
                    let ln = e.local_name();
                    let tag = ln.as_ref();
                    if tag == b"ph" && in_sp {
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == b"type" {
                                let v = String::from_utf8_lossy(&attr.value);
                                if v == "title" || v == "ctrTitle" {
                                    is_title_sp = true;
                                }
                            }
                        }
                    } else if tag == b"blip" {
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == b"embed" {
                                rel_ids.push(String::from_utf8_lossy(&attr.value).to_string());
                            }
                        }
                    }
                }
                Ok(Event::Text(e)) => {
                    if in_t {
                        if let Ok(t) = e.unescape() {
                            cur_p.push_str(&t);
                        }
                    }
                }
                Ok(Event::End(e)) => {
                    let ln = e.local_name();
                    let tag = ln.as_ref();
                    if tag == b"t" {
                        in_t = false;
                    } else if tag == b"p" {
                        in_p = false;
                        let trimmed = cur_p.trim().to_string();
                        if !trimmed.is_empty() {
                            sp_paras.push(trimmed);
                        }
                        cur_p.clear();
                    } else if tag == b"sp" {
                        in_sp = false;
                        if !sp_paras.is_empty() {
                            if is_title_sp && title.is_empty() {
                                title = sp_paras.join(" ");
                            } else {
                                lines.extend(sp_paras.drain(..));
                            }
                        }
                        sp_paras.clear();
                    }
                }
                Ok(Event::Eof) => break,
                Err(_) => break,
                _ => {}
            }
        }
        if title.is_empty() && !lines.is_empty() {
            title = lines.remove(0);
        }

        let mut images: Vec<String> = Vec::new();
        let rels_name = format!("ppt/slides/_rels/slide{}.xml.rels", snum);
        let mut rxml = String::new();
        if let Ok(mut rentry) = archive.by_name(&rels_name) {
            let _ = rentry.read_to_string(&mut rxml);
        }
        if !rxml.is_empty() && !rel_ids.is_empty() {
            let mut rid_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
            let mut rr = Reader::from_str(&rxml);
            loop {
                match rr.read_event() {
                    Ok(Event::Empty(e)) | Ok(Event::Start(e)) => {
                        if e.local_name().as_ref() == b"Relationship" {
                            let mut id = String::new();
                            let mut tgt = String::new();
                            for attr in e.attributes().flatten() {
                                match attr.key.local_name().as_ref() {
                                    b"Id" => id = String::from_utf8_lossy(&attr.value).to_string(),
                                    b"Target" => tgt = String::from_utf8_lossy(&attr.value).to_string(),
                                    _ => {}
                                }
                            }
                            if !id.is_empty() && !tgt.is_empty() {
                                rid_map.insert(id, tgt);
                            }
                        }
                    }
                    Ok(Event::Eof) | Err(_) => break,
                    _ => {}
                }
            }
            let mut seen = std::collections::HashSet::new();
            for rid in rel_ids {
                if let Some(tgt) = rid_map.get(&rid) {
                    if !tgt.contains("media/") {
                        continue;
                    }
                    let clean = tgt.trim_start_matches("./").replace("../", "");
                    let norm = if clean.starts_with("ppt/") { clean } else { format!("ppt/{}", clean) };
                    if !seen.insert(norm.clone()) {
                        continue;
                    }
                    let mime = if norm.ends_with(".png") {
                        Some("image/png")
                    } else if norm.ends_with(".jpg") || norm.ends_with(".jpeg") {
                        Some("image/jpeg")
                    } else if norm.ends_with(".gif") {
                        Some("image/gif")
                    } else if norm.ends_with(".webp") {
                        Some("image/webp")
                    } else if norm.ends_with(".svg") {
                        Some("image/svg+xml")
                    } else {
                        None
                    };
                    if let Some(m) = mime {
                        if let Ok(mut img_f) = archive.by_name(&norm) {
                            let mut buf = Vec::new();
                            if img_f.read_to_end(&mut buf).is_ok() && buf.len() <= 4 * 1024 * 1024 {
                                images.push(format!("data:{};base64,{}", m, b64_encode(&buf)));
                            }
                        }
                    }
                }
            }
        }

        slides.push(json!({
            "num": idx + 1,
            "title": if title.is_empty() { format!("Slayt {}", idx + 1) } else { title },
            "lines": lines,
            "images": images
        }));
    }

    Ok(json!({
        "rel": rel,
        "title": fname,
        "count": slides.len(),
        "slides": slides
    }))
}

pub fn pdf_info(rel: &str) -> Result<Value, String> {
    let p = safe_path(rel)?;
    if !p.exists() || p.is_dir() {
        return Err(format!("Dosya bulunamadı: {}", rel));
    }
    let size_kb = (fs::metadata(&p).map(|m| m.len()).unwrap_or(0) as f64 / 1024.0 * 10.0).round() / 10.0;

    // Optional fast Python pypdf extraction if available, otherwise return metadata immediately
    let py_script = format!(
        "import json, pypdf; r=pypdf.PdfReader(r'{}'); pages=[{{'page':i+1,'text':(pg.extract_text() or '').strip()}} for i,pg in enumerate(r.pages[:30])]; print(json.dumps({{'pages':len(r.pages),'pages_text':pages}}))",
        p.to_string_lossy()
    );
    let mut num_pages = 0;
    let mut pages_txt: Vec<Value> = Vec::new();
    if let Ok(out) = Command::new("python")
        .args(["-c", &py_script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if out.status.success() {
            if let Ok(v) = serde_json::from_slice::<Value>(&out.stdout) {
                num_pages = v.get("pages").and_then(|x| x.as_u64()).unwrap_or(0);
                if let Some(arr) = v.get("pages_text").and_then(|x| x.as_array()) {
                    pages_txt = arr.clone();
                }
            }
        }
    }
    let mut full_parts = Vec::new();
    for x in &pages_txt {
        let t = x.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let pg = x.get("page").and_then(|v| v.as_u64()).unwrap_or(0);
        if !t.is_empty() {
            full_parts.push(format!("### Sayfa {}\n{}", pg, t));
        }
    }
    let full_text = full_parts.join("\n\n");
    Ok(json!({
        "rel": rel,
        "name": p.file_name().and_then(|n| n.to_str()).unwrap_or(""),
        "title": clean_title(&p, ""),
        "size_kb": size_kb,
        "pages": num_pages,
        "pages_text": pages_txt,
        "full_text": full_text,
        "scanned": num_pages > 0 && full_text.is_empty()
    }))
}

pub fn build_context_from_sources(rels: &[String], active_rel: Option<&str>) -> String {
    let max_chars: usize = 12000;
    let mut ordered: Vec<String> = Vec::new();
    if let Some(a) = active_rel {
        let clean_a = a.strip_prefix("note:").unwrap_or(a).to_string();
        if !clean_a.is_empty() {
            ordered.push(clean_a);
        }
    }
    for r in rels {
        let clean_r = r.strip_prefix("note:").unwrap_or(r).to_string();
        if !clean_r.is_empty() && !ordered.contains(&clean_r) {
            ordered.push(clean_r);
        }
    }
    if ordered.is_empty() {
        return String::new();
    }
    let mut blocks: Vec<String> = Vec::new();
    let mut total: usize = 0;
    let count = ordered.len().min(8);

    for rel in ordered.into_iter().take(8) {
        let Ok(p) = safe_path(&rel) else { continue };
        if !p.exists() || p.is_dir() {
            continue;
        }
        let ext = ext_lower(&p);
        let txt = if ext == ".md" || ext == ".txt" || ext == ".csv" {
            fs::read(&p)
                .ok()
                .map(|b| String::from_utf8_lossy(&b).trim().to_string())
                .unwrap_or_default()
        } else if ext == ".html" {
            let raw = fs::read(&p)
                .ok()
                .map(|b| String::from_utf8_lossy(&b).to_string())
                .unwrap_or_default();
            HTML_TAG_RE.replace_all(&raw, " ").trim().to_string()
        } else if ext == ".docx" || ext == ".doc" {
            docx_to_html(&rel)
                .ok()
                .and_then(|v| v.get("html").and_then(|h| h.as_str()).map(|s| s.to_string()))
                .map(|h| HTML_TAG_RE.replace_all(&h, " ").trim().to_string())
                .unwrap_or_default()
        } else if ext == ".pptx" || ext == ".ppsx" {
            pptx_to_slides(&rel)
                .ok()
                .and_then(|v| v.get("slides").and_then(|s| s.as_array()).cloned())
                .map(|arr| {
                    arr.iter()
                        .map(|s| {
                            let num = s.get("num").and_then(|x| x.as_u64()).unwrap_or(0);
                            let t = s.get("title").and_then(|x| x.as_str()).unwrap_or("");
                            let ls = s
                                .get("lines")
                                .and_then(|x| x.as_array())
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|v| v.as_str())
                                        .collect::<Vec<_>>()
                                        .join("\n")
                                })
                                .unwrap_or_default();
                            format!("[Slayt {}] {}\n{}", num, t, ls)
                        })
                        .collect::<Vec<_>>()
                        .join("\n\n")
                })
                .unwrap_or_default()
        } else if is_img_ext(&ext) {
            blocks.push(format!(
                "[Ekli Görsel Kaynağı: {} ({}) — Dosya yolu: {} (görmek için read_file / view_file kullan)]",
                rel,
                ext,
                p.to_string_lossy()
            ));
            continue;
        } else {
            blocks.push(format!(
                "[Ekli Kaynak Dosya: {} ({}) — Dosya yolu: {}]",
                rel,
                ext,
                p.to_string_lossy()
            ));
            continue;
        };

        if txt.is_empty() {
            continue;
        }
        let budget = ((max_chars.saturating_sub(total)) / count.max(1)).max(800);
        let mut snippet: String = txt.chars().take(budget).collect();
        if txt.chars().count() > budget {
            snippet.push_str("\n...(kısaltıldı)...");
        }
        let is_active = active_rel.map(|a| a.contains(&rel)).unwrap_or(false);
        let tag = if is_active {
            "AKTİF AÇIK NOT"
        } else {
            "SEÇİLİ KASA KAYNAĞI"
        };
        blocks.push(format!("--- [{}: {}] ---\n{}", tag, rel, snippet));
        total += snippet.len();
        if total >= max_chars {
            break;
        }
    }

    if blocks.is_empty() {
        return String::new();
    }
    format!(
        "[KASA KAYNAK BAĞLAMI — Yanıtını aşağıdaki gerçek ders notlarına ve kaynaklara dayandır:]\n{}\n--- [KAYNAK BAĞLAMI SONU] ---\n\n",
        blocks.join("\n\n")
    )
}

pub fn resolve_chat_images(rels: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for raw in rels.iter().take(8) {
        let clean = raw.trim().strip_prefix("note:").unwrap_or(raw.trim());
        if clean.is_empty() {
            continue;
        }
        let Ok(p) = safe_path(clean) else { continue };
        if !p.exists() || !p.is_file() || !is_img_ext(&ext_lower(&p)) {
            continue;
        }
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

pub fn build_image_prompt_block(paths: &[PathBuf]) -> String {
    if paths.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = paths
        .iter()
        .enumerate()
        .map(|(i, p)| format!("- Görsel {}: {}", i + 1, p.to_string_lossy()))
        .collect();
    format!(
        "[KULLANICININ SOHBETE EKLEDİĞİ GÖRSELLER — Yanıtlamadan önce `read_file` / `view_file` aracını kullanarak aşağıdaki görsel dosyalarını mutlaka açıp incele:]\n{}\n[EK GÖRSELLER SONU]\n\n",
        lines.join("\n")
    )
}

fn unique_timestamped_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|x| x.as_secs())
        .unwrap_or(0);
    let mut t = dir.join(format!("{}_{}{}", stem, stamp, ext));
    let mut n = 1;
    while t.exists() {
        n += 1;
        t = dir.join(format!("{}_{}_{}{}", stem, stamp, n, ext));
    }
    t
}

pub fn save_asset(note_rel: &str, name: &str, data: &[u8]) -> Result<Value, String> {
    let name_path = Path::new(name);
    let ext = ext_lower(name_path);
    let is_chat_img = note_rel.trim() == ".chat_images";
    if is_chat_img {
        if !is_img_ext(&ext) {
            return Err("Sohbete yalnızca görsel dosyaları eklenebilir".to_string());
        }
    } else if ext != ".md" && ext != ".html" && !is_asset_ext(&ext) {
        return Err(
            "Desteklenmeyen dosya türü (yalnızca MD, HTML, PDF, DOCX veya görsel)".to_string(),
        );
    }
    if data.is_empty() || data.len() > MAX_ASSET {
        return Err("Dosya boş veya 50 MB sınırını aşıyor".to_string());
    }

    let stem_raw = name_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("dosya");
    let stem = slugify(stem_raw);

    let target = if is_chat_img {
        let d = VAULT_DIR.join(".chat_images");
        fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        unique_timestamped_path(&d, &stem, &ext)
    } else {
        let mut is_dir_target = false;
        let base = if !note_rel.trim().is_empty() {
            let clean_nr = note_rel.strip_prefix("note:").unwrap_or(note_rel);
            let p_nr = safe_path(clean_nr)?;
            if p_nr.is_dir() {
                is_dir_target = true;
                p_nr
            } else {
                p_nr.parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| VAULT_DIR.clone())
            }
        } else {
            VAULT_DIR.clone()
        };

        let base_name = base
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let is_bucket_dir = is_dir_target
            && (base_name == "_gorseller" || base_name == "_ekler" || base_name == "assets");
        if ((ext == ".md" || ext == ".html" || is_doc_ext(&ext)) && is_dir_target) || is_bucket_dir {
            let mut t = base.join(format!("{}{}", stem, ext));
            let mut n = 1;
            while t.exists() {
                n += 1;
                t = base.join(format!("{}_{}{}", stem, n, ext));
            }
            t
        } else {
            let d = base.join("_gorseller");
            fs::create_dir_all(&d).map_err(|e| e.to_string())?;
            unique_timestamped_path(&d, &stem, &ext)
        }
    };

    fs::write(&target, data).map_err(|e| e.to_string())?;
    let rel = rel_posix(&target);
    let tname = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let in_gorseller = target
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        == Some("_gorseller");
    let embed = if in_gorseller {
        format!("![[_gorseller/{}]]", tname)
    } else {
        format!("![[{}]]", tname)
    };

    Ok(json!({
        "rel": rel,
        "id": format!("note:{}", rel),
        "name": tname,
        "ext": ext,
        "embed": embed
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_kasa_space_defaults_and_overrides() {
        let mut cfg = SpacesCfg {
            version: 1,
            spaces: default_spaces_list(),
            assignments: DEFAULT_D7_KEYS
                .iter()
                .map(|k| ((*k).to_string(), "donem_7".to_string()))
                .collect(),
            kasa_meta: HashMap::new(),
            tree_order: HashMap::new(),
        };
        assert_eq!(resolve_kasa_space("Mikrodalga", &cfg), "donem_7");
        assert_eq!(resolve_kasa_space("CV_ve_Belgeler", &cfg), "belgeler");
        cfg.assignments
            .insert("Bitirme_Projesi".to_string(), "donem_8".to_string());
        assert_eq!(resolve_kasa_space("Bitirme_Projesi", &cfg), "donem_8");
        cfg.assignments
            .insert("Hayalet_Kasa".to_string(), "olmayan_alan".to_string());
        assert_eq!(resolve_kasa_space("Hayalet_Kasa", &cfg), "belgeler");
    }

    #[test]
    fn folder_meta_applies_override() {
        let mut cfg = SpacesCfg {
            version: 1,
            spaces: default_spaces_list(),
            assignments: HashMap::new(),
            kasa_meta: HashMap::new(),
            tree_order: HashMap::new(),
        };
        cfg.kasa_meta.insert(
            "Mikrodalga".to_string(),
            KasaOverride {
                label: Some("Mikrodalga Mühendisliği".to_string()),
                icon: Some("📡".to_string()),
                accent: Some("#79c0ff".to_string()),
                tag: Some("RF".to_string()),
                desc: Some("Özel açıklama".to_string()),
            },
        );
        let meta = folder_meta_for("Mikrodalga", Some(&cfg));
        assert_eq!(meta.label, "Mikrodalga Mühendisliği");
        assert_eq!(meta.icon, "📡");
        assert_eq!(meta.accent, "#79c0ff");
        assert_eq!(meta.tag, "RF");
        assert_eq!(meta.desc, "Özel açıklama");
    }
}
