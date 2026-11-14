use crate::config::{ROOT, VAULT_DIR};
use once_cell::sync::Lazy;
use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
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
const DOC_EXT: &[&str] = &[".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".csv", ".txt"];

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
    Mutex::new(m)
});

static H1_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^#\s+(.+)$").unwrap());
static WIKI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]").unwrap());
static NUM_PREFIX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+_").unwrap());
static HTML_TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());

fn folder_meta_for(key: &str) -> FolderMeta {
    if let Ok(map) = CUSTOM_FOLDERS.lock() {
        if let Some(m) = map.get(key) {
            return m.clone();
        }
    }
    let label = key.replace('_', " ");
    FolderMeta {
        label: label.clone(),
        icon: "📘".to_string(),
        accent: "#e0a458".to_string(),
        tag: "Çalışma Kasası".to_string(),
        desc: format!("{} ders notları, deney raporları ve kaynak belgeleri.", label),
    }
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
    entries.sort_by_key(|x| {
        (
            x.is_dir(),
            x.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase(),
        )
    });

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
                let raw_lbl = folder_meta_for(&fname).label;
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
                "rel": sub_rel
            }));
            continue;
        }

        let ext = ext_lower(&f);
        if is_asset_bucket && !is_asset_ext(&ext) {
            continue;
        }
        if !is_asset_bucket && ext != ".md" && ext != ".html" && !is_asset_ext(&ext) {
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
            "kasa": ctx.f_key
        }));
        ctx.pages.insert(
            nid.clone(),
            json!({
                "t": title,
                "i": icon,
                "rel": rel,
                "folder": ctx.f_label,
                "kasa": ctx.f_key,
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
            "folder": ctx.f_label,
            "ext": ext,
            "icon": icon,
            "checked": checked
        }));
    }
    items
}

pub fn scan_vault() -> Value {
    if !VAULT_DIR.exists() {
        return json!({
            "vault_path": VAULT_DIR.to_string_lossy(),
            "tree": [],
            "kasalar": [],
            "pages": {},
            "wikimap": {},
            "sources": [],
            "backlinks": {}
        });
    }

    let mut tree: Vec<Value> = Vec::new();
    let mut kasalar: Vec<Value> = Vec::new();
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
    folders.sort();

    for (idx, d) in folders.iter().enumerate() {
        let f_key = d
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let meta = folder_meta_for(&f_key);
        let f_label = meta.label.clone();

        let mut n_notes = 0usize;
        let mut n_docs = 0usize;
        let mut n_imgs = 0usize;
        let mut latest_mtime = mtime_of(d);
        let mut preview_items: Vec<Value> = Vec::new();
        let mut index_id: Option<String> = None;

        let mut ctx = ScanDirCtx {
            f_key: &f_key,
            f_label: &f_label,
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
            "rel": f_key,
            "i": "📘",
            "open": idx < 2,
            "k": kids
        }));
        kasalar.push(json!({
            "key": f_key,
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
        "tree": tree,
        "kasalar": kasalar,
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
    let ext = ext_lower(&p);
    let clean_rel = rel.replace('\\', "/");
    let parts: Vec<&str> = clean_rel.trim_start_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let f_key = if parts.len() > 1 {
        parts[0].to_string()
    } else {
        p.parent()
            .and_then(|pr| pr.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string()
    };
    let folder = folder_meta_for(&f_key).label;
    let mtime = mtime_of(&p);
    if ext == ".pdf" {
        return Ok(json!({
            "rel": rel,
            "ext": ext,
            "kasa": f_key,
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

pub fn create_kasa(title: &str, tag: &str, desc: &str, icon: &str) -> Result<Value, String> {
    let clean_title = title.trim();
    if clean_title.is_empty() {
        return Err("Kasa adı boş olamaz".to_string());
    }
    let folder_key = slugify(clean_title);
    let d = safe_path(&folder_key)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;

    let meta_desc = if desc.trim().is_empty() {
        format!(
            "{} ders notları, deney raporları ve kaynak belgeleri.",
            clean_title
        )
    } else {
        desc.trim().to_string()
    };
    let meta = FolderMeta {
        label: clean_title.to_string(),
        icon: if icon.trim().is_empty() {
            "📘".to_string()
        } else {
            icon.trim().to_string()
        },
        accent: "#e0a458".to_string(),
        tag: if tag.trim().is_empty() {
            "Çalışma Kasası".to_string()
        } else {
            tag.trim().to_string()
        },
        desc: meta_desc.clone(),
    };
    if let Ok(mut map) = CUSTOM_FOLDERS.lock() {
        map.insert(folder_key.clone(), meta);
    }

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
        "index_id": format!("note:{}", idx_rel)
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

        if (ext == ".md" || ext == ".html" || is_doc_ext(&ext)) && is_dir_target {
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
