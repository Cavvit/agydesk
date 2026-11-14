"""Gerçek Obsidian Kasası (Vault) okuyucu ve yazıcı."""
import html
import json
import re
import shutil
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from .config import ROOT, VAULT_DIR

IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"}
DOC_EXT = {".pdf", ".docx", ".doc", ".pptx", ".ppsx", ".ppt", ".xlsx", ".xls", ".csv", ".txt"}
ASSET_EXT = IMG_EXT | DOC_EXT
MAX_ASSET = 50 * 1024 * 1024
SPACES_FILENAME = ".agydesk_spaces.json"

DEFAULT_SPACES = [
    {
        "id": "donem_7",
        "title": "Dönem 7",
        "icon": "🎓",
        "accent": "#e0a458",
        "tag": "EEM · 7. Dönem",
        "desc": "7. dönem zorunlu ve seçmeli dersler, laboratuvar föyleri ve vize/final notları.",
    },
    {
        "id": "donem_8",
        "title": "Dönem 8",
        "icon": "🚀",
        "accent": "#79c0ff",
        "tag": "EEM · 8. Dönem",
        "desc": "8. dönem ders kasaları, bitirme projesi ve bahar dönemi çalışma alanları.",
    },
    {
        "id": "belgeler",
        "title": "Belgeler & Arşiv",
        "icon": "🗂",
        "accent": "#7bc47f",
        "tag": "Belgeler · Genel & Proje",
        "desc": "Ders dışı belgeler, CV, sertifikalar, resmi evraklar ve kişisel projeler.",
    },
]

DEFAULT_SPACE_ASSIGNMENTS = {
    "Difransiyel_Denklemler": "donem_7",
    "Elektrik_Makineleri_Lab": "donem_7",
    "Haberlesme_Lab": "donem_7",
    "Katihal_Elektronigi": "donem_7",
    "Kontrol_Lab": "donem_7",
    "Kontrol_Sistemlerine_Giris": "donem_7",
    "Mikrodalga": "donem_7",
    "Secmeli_Tasarim": "donem_7",
    "Universite_Secmeli_Beslenme": "donem_7",
    "Yuksek_Gerilim_Teknigi": "donem_7",
}

FOLDER_NAMES = {
    "Difransiyel_Denklemler": "Diferansiyel Denklemler",
    "Elektrik_Makineleri_Lab": "Elektrik Makinaları Lab",
    "Kontrol_Sistemlerine_Giris": "Kontrol Sistemlerine Giriş",
    "Secmeli_Tasarim": "Seçmeli Tasarım",
    "Yuksek_Gerilim_Teknigi": "Yüksek Gerilim Tekniği",
    "Haberlesme_Lab": "Haberleşme Laboratuvarı",
    "Kontrol_Lab": "Kontrol Laboratuvarı",
    "Katihal_Elektronigi": "Katıhal Elektroniği",
    "Universite_Secmeli_Beslenme": "Beslenme ve Sağlıklı Yaşam",
}

FOLDER_META = {
    "Difransiyel_Denklemler": {
        "icon": "∫",
        "accent": "#d2a8ff",
        "tag": "Matematik · Diferansiyel & Operatör",
        "desc": "1. mertebe (ayrılabilir, tam, integral çarpanı, homojen, lineer, Bernoulli, Riccati), yüksek mertebe operatör metodu ve Cauchy-Euler diferansiyel denklemler.",
    },
    "Elektrik_Makineleri_Lab": {
        "icon": "⚡",
        "accent": "#e0a458",
        "tag": "EEM Lab · Deney & Trafo",
        "desc": "DC Şönt Motor, Tek ve Üç Fazlı Transformatör deney föyleri, eşdeğer devreler ve sözlü/quiz soru bankası.",
    },
    "Kontrol_Sistemlerine_Giris": {
        "icon": "∿",
        "accent": "#79c0ff",
        "tag": "Kontrol · Laplace & Blok",
        "desc": "Açık/kapalı çevrim sistemler, Laplace dönüşümü, transfer fonksiyonu modelleme ve blok diyagram indirgeme.",
    },
    "Yuksek_Gerilim_Teknigi": {
        "icon": "🌩",
        "accent": "#f0883e",
        "tag": "Yüksek Gerilim · Şalt & Deşarj",
        "desc": "Trafo merkezi ekipmanları, kesici-ayırıcı manevra sıraları, izolatörler, deşarj olayları ve elektrot sistemleri.",
    },
    "Secmeli_Tasarim": {
        "icon": "🛰",
        "accent": "#7bc47f",
        "tag": "SAYZEK · İHA & Termal",
        "desc": "Termal kamera görüntü analizi, İHA verileriyle arazi sınıflandırma, değişim tespiti ve 5N1K proje raporları.",
    },
    "Haberlesme_Lab": {
        "icon": "📡",
        "accent": "#58a6ff",
        "tag": "Haberleşme · Modülasyon & Fiber",
        "desc": "AM/FM/PWM/FSK modülasyonu, spektrum analizi, fiber optik verici-alıcı ve anten deneyleri.",
    },
    "Kontrol_Lab": {
        "icon": "🎛️",
        "accent": "#3fb950",
        "tag": "Kontrol Lab · PID & Tank",
        "desc": "İkili su tankı seviye kontrolü, ısı akış sistemleri, araç hız kontrolü ve DC motor PID regülasyonu.",
    },
    "Katihal_Elektronigi": {
        "icon": "⚛️",
        "accent": "#bc8cff",
        "tag": "Fizik & Yarıiletken · Kuantum & Bant",
        "desc": "Kristal örgüler, Miller indisleri, Drude iletkenlik modeli, Fermi-Dirac dağılımı ve p-n eklem fiziği.",
    },
    "Universite_Secmeli_Beslenme": {
        "icon": "🥑",
        "accent": "#f1e05a",
        "tag": "Üni Seçmeli · Beslenme & Metabolizma",
        "desc": "Makro/mikro besin ögeleri, CHO, lipidler, proteinler, vitaminler ve sporcu beslenmesi rehberleri.",
    },
    "Mikrodalga": {
        "icon": "〰️",
        "accent": "#ff7b72",
        "tag": "Mikrodalga · İletim & Kılavuz",
        "desc": "İletim hatları, Smith abağı, çoklu yansıma ve dikdörtgen/dairesel dalga kılavuzları.",
    },
}

_H1_RE = re.compile(r"^#\s+(.+)$", re.M)
_WIKI_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")


def _clean_title(p: Path, text: str = "") -> str:
    if text:
        m = _H1_RE.search(text)
        if m:
            t = re.sub(r"^[^\wÇĞİÖŞÜçğıöşü]+", "", m.group(1)).strip()
            if t:
                return t
    s = p.stem
    s = re.sub(r"^\d+_", "", s)
    return s.replace("_", " ")


def _safe_path(rel: str) -> Path:
    clean = rel.replace("\\", "/").lstrip("/")
    target = (VAULT_DIR / clean).resolve()
    if not str(target).startswith(str(VAULT_DIR.resolve())):
        raise ValueError("Geçersiz dosya yolu")
    return target


def _load_spaces_cfg() -> dict:
    """`.agydesk_spaces.json` dosyasını okur; yoksa bellek içi varsayılanları döndürür."""
    spaces = [dict(s) for s in DEFAULT_SPACES]
    assignments = dict(DEFAULT_SPACE_ASSIGNMENTS)
    kasa_meta: dict[str, dict] = {}
    tree_order: dict[str, list[str]] = {}
    cfg_path = VAULT_DIR / SPACES_FILENAME
    if cfg_path.exists():
        try:
            raw = json.loads(cfg_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(raw, dict):
                raw_spaces = raw.get("spaces")
                if isinstance(raw_spaces, list) and raw_spaces:
                    parsed = []
                    for item in raw_spaces:
                        if isinstance(item, dict) and item.get("id") and item.get("title"):
                            parsed.append({
                                "id": str(item["id"]),
                                "title": str(item["title"]),
                                "icon": str(item.get("icon") or "🗂"),
                                "accent": str(item.get("accent") or "#e0a458"),
                                "tag": str(item.get("tag") or "Çalışma Alanı"),
                                "desc": str(item.get("desc") or ""),
                            })
                    if parsed:
                        spaces = parsed
                raw_assign = raw.get("assignments")
                if isinstance(raw_assign, dict):
                    for k, v in raw_assign.items():
                        if isinstance(k, str) and isinstance(v, str) and v:
                            assignments[k] = v
                raw_meta = raw.get("kasa_meta")
                if isinstance(raw_meta, dict):
                    for k, v in raw_meta.items():
                        if isinstance(k, str) and isinstance(v, dict):
                            kasa_meta[k] = dict(v)
                raw_order = raw.get("tree_order")
                if isinstance(raw_order, dict):
                    for k, v in raw_order.items():
                        if isinstance(k, str) and isinstance(v, list):
                            tree_order[k] = [str(item) for item in v if isinstance(item, str) and item]
        except Exception:
            pass
    return {"spaces": spaces, "assignments": assignments, "kasa_meta": kasa_meta, "tree_order": tree_order}


def _save_spaces_cfg(cfg: dict) -> None:
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    cfg_path = VAULT_DIR / SPACES_FILENAME
    payload = {
        "version": 1,
        "spaces": cfg.get("spaces", DEFAULT_SPACES),
        "assignments": cfg.get("assignments", {}),
        "kasa_meta": cfg.get("kasa_meta", {}),
        "tree_order": cfg.get("tree_order", {}),
    }
    cfg_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _sort_with_order(entries: list[Path], order_names: list[str] | None, default_key) -> list[Path]:
    if not order_names:
        return sorted(entries, key=default_key)
    rank = {name: i for i, name in enumerate(order_names)}
    ordered = [p for p in entries if p.name in rank]
    ordered.sort(key=lambda p: rank[p.name])
    rest = sorted([p for p in entries if p.name not in rank], key=default_key)
    return ordered + rest


def _resolve_kasa_space(key: str, cfg: dict) -> str:
    spaces = cfg["spaces"]
    valid_ids = {s["id"] for s in spaces}
    assigned = cfg["assignments"].get(key)
    if assigned and assigned in valid_ids:
        return assigned
    default_for_key = DEFAULT_SPACE_ASSIGNMENTS.get(key)
    if default_for_key and default_for_key in valid_ids:
        return default_for_key
    if "belgeler" in valid_ids:
        return "belgeler"
    return spaces[0]["id"] if spaces else "donem_7"


def _meta_for_folder(key: str, cfg: dict | None = None) -> dict:
    base_label = FOLDER_NAMES.get(key, key.replace("_", " "))
    base = FOLDER_META.get(key, {
        "icon": "📘",
        "accent": "#e0a458",
        "tag": "Çalışma Kasası",
        "desc": f"{base_label} ders notları, deney raporları ve kaynak belgeleri.",
    })
    out = {
        "label": base_label,
        "icon": base.get("icon", "📘"),
        "accent": base.get("accent", "#e0a458"),
        "tag": base.get("tag", "Çalışma Kasası"),
        "desc": base.get("desc", ""),
    }
    if cfg:
        ov = cfg.get("kasa_meta", {}).get(key)
        if isinstance(ov, dict):
            for field in ("label", "icon", "accent", "tag", "desc"):
                val = ov.get(field)
                if isinstance(val, str) and val.strip():
                    out[field] = val.strip()
    return out


def scan_vault() -> dict:
    cfg = _load_spaces_cfg()
    if not VAULT_DIR.exists():
        spaces_empty = [
            {
                **s,
                "count_kasas": 0,
                "counts": {"notes": 0, "docs": 0, "images": 0, "total": 0},
                "mtime": 0,
                "kasalar": [],
            }
            for s in cfg["spaces"]
        ]
        return {
            "vault_path": str(VAULT_DIR),
            "spaces": spaces_empty,
            "tree": [],
            "kasalar": [],
            "root_docs": [],
            "pages": {},
            "wikimap": {},
            "sources": [],
            "backlinks": {},
        }

    tree: list[dict] = []
    kasalar: list[dict] = []
    root_docs: list[dict] = []
    pages: dict[str, dict] = {}
    wikimap: dict[str, str] = {}
    sources: list[dict] = []
    md_links_raw: dict[str, list[str]] = {}

    tree_order: dict[str, list[str]] = cfg.get("tree_order", {})
    folders = _sort_with_order(
        [d for d in VAULT_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")],
        tree_order.get("__kasas__"),
        lambda x: x.name.lower(),
    )
    for idx, d in enumerate(folders):
        f_key = d.name
        meta = _meta_for_folder(f_key, cfg)
        f_label = meta["label"]
        space_id = _resolve_kasa_space(f_key, cfg)
        kids: list[dict] = []
        n_notes = 0
        n_docs = 0
        n_imgs = 0
        latest_mtime = d.stat().st_mtime
        preview_items: list[dict] = []
        index_id: str | None = None

        def _scan_dir(cur_dir: Path, is_asset_bucket: bool = False) -> list[dict]:
            nonlocal n_notes, n_docs, n_imgs, latest_mtime, index_id
            items: list[dict] = []
            cur_rel = cur_dir.relative_to(VAULT_DIR).as_posix()
            entries = _sort_with_order(
                [p for p in cur_dir.iterdir() if not p.name.startswith(".")],
                tree_order.get(cur_rel),
                lambda x: (x.is_dir(), x.name.lower()),
            )
            for f in entries:
                if f.is_dir():
                    special_bucket = f.name in ("_gorseller", "_ekler", "assets")
                    sub_kids = _scan_dir(f, is_asset_bucket=(is_asset_bucket or special_bucket))
                    if special_bucket and not sub_kids:
                        continue
                    sub_rel = f.relative_to(VAULT_DIR).as_posix()
                    latest_mtime = max(latest_mtime, f.stat().st_mtime)
                    if f.name == "_ekler":
                        sub_label = f"📎 Kaynak Belgeler ({len(sub_kids)})"
                    elif f.name == "_gorseller":
                        sub_label = f"🖼 Görseller ({len(sub_kids)})"
                    elif f.name == "assets":
                        sub_label = f"📁 Ekler ({len(sub_kids)})"
                    else:
                        raw_lbl = _meta_for_folder(f.name, cfg)["label"]
                        sub_label = f"{raw_lbl} ({len(sub_kids)})" if sub_kids else raw_lbl
                    items.append({
                        "n": sub_label,
                        "i": "📁",
                        "open": False,
                        "k": sub_kids,
                        "kasa": f_key,
                        "space": space_id,
                        "rel": sub_rel,
                    })
                    continue

                ext = f.suffix.lower()
                if ext not in (".md", ".html") and ext not in ASSET_EXT:
                    continue

                rel = f.relative_to(VAULT_DIR).as_posix()
                nid = f"note:{rel}"
                latest_mtime = max(latest_mtime, f.stat().st_mtime)
                head = ""
                full_md = ""
                if ext == ".md":
                    n_notes += 1
                    try:
                        full_md = f.read_text(encoding="utf-8", errors="replace")
                        head = full_md[:400]
                    except Exception:
                        pass
                elif ext == ".html":
                    n_notes += 1
                elif ext in IMG_EXT:
                    n_imgs += 1
                else:
                    n_docs += 1

                title = f.name if is_asset_bucket else _clean_title(f, head)
                if ext == ".md" and full_md:
                    md_links_raw[nid] = [m.strip() for m in _WIKI_RE.findall(full_md)]
                icon = "📝" if ext == ".md" else ("🌐" if ext == ".html" else ("🖼" if ext in IMG_EXT else ("📘" if ext in (".docx", ".doc") else "📄")))
                items.append({"n": title, "id": nid, "i": icon, "rel": rel, "ext": ext, "kasa": f_key, "space": space_id})
                pages[nid] = {"t": title, "i": icon, "rel": rel, "folder": f_label, "kasa": f_key, "space": space_id, "ext": ext, "mtime": f.stat().st_mtime}
                wikimap[f.name.lower()] = nid
                wikimap[f.stem.lower()] = nid
                wikimap[title.lower()] = nid
                wikimap[f.stem.lower().replace("_", " ")] = nid
                if not is_asset_bucket and (index_id is None or f.stem.startswith("00_")):
                    if f.stem.startswith("00_") or index_id is None:
                        index_id = nid
                if not is_asset_bucket and ext in (".md", ".html", ".pdf") and len(preview_items) < 4:
                    preview_items.append({"id": nid, "title": title, "icon": icon, "ext": ext})
                sources.append({
                    "id": nid,
                    "rel": rel,
                    "title": f"{f_label} · {title}",
                    "short_title": title,
                    "kasa": f_key,
                    "space": space_id,
                    "folder": f_label,
                    "ext": ext,
                    "icon": icon,
                    "checked": (not is_asset_bucket) and (f.stem.startswith("00_") or "TEK_PARCA" in f.stem or "Deney_1" in f.stem),
                })
            return items

        kids = _scan_dir(d, False)

        tree.append({"n": f_label, "kasa": f_key, "space": space_id, "rel": f_key, "i": meta["icon"], "open": idx < 2, "k": kids})
        first_page_id = next((k["id"] for k in kids if "id" in k), None)
        kasalar.append({
            "key": f_key,
            "space": space_id,
            "title": f_label,
            "icon": meta["icon"],
            "accent": meta["accent"],
            "tag": meta["tag"],
            "desc": meta["desc"],
            "mtime": latest_mtime,
            "index_id": index_id or first_page_id,
            "counts": {
                "notes": n_notes,
                "docs": n_docs,
                "images": n_imgs,
                "total": n_notes + n_docs + n_imgs,
            },
            "previews": preview_items,
        })

    # Kök dizindeki tekil belgeler (örn. 00_LAB_ORTAK_TAKVIM.md)
    root_files = _sort_with_order(
        [f for f in VAULT_DIR.iterdir() if f.is_file() and not f.name.startswith(".")],
        tree_order.get("__root_docs__"),
        lambda x: x.name.lower(),
    )
    for f in root_files:
        ext = f.suffix.lower()
        if ext not in (".md", ".html") and ext not in ASSET_EXT:
            continue
        rel = f.name
        nid = f"note:{rel}"
        head = ""
        full_md = ""
        if ext == ".md":
            try:
                full_md = f.read_text(encoding="utf-8", errors="replace")
                head = full_md[:400]
            except Exception:
                pass
        title = _clean_title(f, head)
        if ext == ".md" and full_md:
            md_links_raw[nid] = [m.strip() for m in _WIKI_RE.findall(full_md)]
        icon = "📝" if ext == ".md" else ("🌐" if ext == ".html" else ("🖼" if ext in IMG_EXT else ("📘" if ext in (".docx", ".doc") else "📄")))
        root_space = "donem_7" if ("LAB" in f.stem.upper() or "TAKVIM" in f.stem.upper()) else ("belgeler" if any(s["id"] == "belgeler" for s in cfg["spaces"]) else cfg["spaces"][0]["id"])
        pages[nid] = {"t": title, "i": icon, "rel": rel, "folder": "Ortak Belgeler", "kasa": "", "space": root_space, "ext": ext, "mtime": f.stat().st_mtime}
        wikimap[f.name.lower()] = nid
        wikimap[f.stem.lower()] = nid
        wikimap[title.lower()] = nid
        wikimap[f.stem.lower().replace("_", " ")] = nid
        root_docs.append({"id": nid, "rel": rel, "title": title, "icon": icon, "ext": ext, "space": root_space, "mtime": f.stat().st_mtime})

    spaces_out: list[dict] = []
    for sp in cfg["spaces"]:
        sid = sp["id"]
        sp_kasalar = [k for k in kasalar if k["space"] == sid]
        sp_notes = sum(k["counts"]["notes"] for k in sp_kasalar)
        sp_docs = sum(k["counts"]["docs"] for k in sp_kasalar)
        sp_imgs = sum(k["counts"]["images"] for k in sp_kasalar)
        sp_mtime = max([k["mtime"] for k in sp_kasalar], default=0)
        spaces_out.append({
            **sp,
            "count_kasas": len(sp_kasalar),
            "counts": {
                "notes": sp_notes,
                "docs": sp_docs,
                "images": sp_imgs,
                "total": sp_notes + sp_docs + sp_imgs,
            },
            "mtime": sp_mtime,
            "kasalar": [
                {
                    "key": k["key"],
                    "title": k["title"],
                    "icon": k["icon"],
                    "accent": k["accent"],
                    "total": k["counts"]["total"],
                }
                for k in sp_kasalar
            ],
        })

    backlinks: dict[str, list[dict]] = {}
    for src_id, raw_targets in md_links_raw.items():
        src_page = pages.get(src_id, {})
        for rt in raw_targets:
            k = rt.lower().replace(".md", "").strip()
            target_id = wikimap.get(k) or wikimap.get(k.replace("_", " "))
            if target_id and target_id != src_id:
                lst = backlinks.setdefault(target_id, [])
                if not any(x["id"] == src_id for x in lst):
                    lst.append({"id": src_id, "title": src_page.get("t", src_id), "folder": src_page.get("folder", "")})

    return {
        "vault_path": str(VAULT_DIR),
        "spaces": spaces_out,
        "tree": tree,
        "kasalar": kasalar,
        "root_docs": root_docs,
        "pages": pages,
        "wikimap": wikimap,
        "sources": sources,
        "backlinks": backlinks,
    }


def read_note(rel: str) -> dict:
    p = _safe_path(rel)
    if not p.exists():
        raise FileNotFoundError(rel)
    cfg = _load_spaces_cfg()
    ext = p.suffix.lower()
    parts = [part for part in rel.replace("\\", "/").lstrip("/").split("/") if part]
    f_key = parts[0] if len(parts) > 1 else ""
    folder = _meta_for_folder(f_key, cfg)["label"] if f_key else "Ortak Belgeler"
    space_id = _resolve_kasa_space(f_key, cfg) if f_key else "donem_7"
    mtime = p.stat().st_mtime
    if ext == ".pdf":
        return {"rel": rel, "ext": ext, "kasa": f_key, "space": space_id, "folder": folder, "title": _clean_title(p), "content": "", "mtime": mtime}
    text = p.read_text(encoding="utf-8", errors="replace")
    return {
        "rel": rel,
        "ext": ext,
        "kasa": f_key,
        "space": space_id,
        "folder": folder,
        "title": _clean_title(p, text if ext == ".md" else ""),
        "content": text,
        "mtime": mtime,
    }


def write_note(rel: str, content: str) -> dict:
    p = _safe_path(rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    mirror = ROOT / "notes" / rel.replace("\\", "/").lstrip("/")
    if mirror.resolve() != p.resolve():
        try:
            mirror.parent.mkdir(parents=True, exist_ok=True)
            mirror.write_text(content, encoding="utf-8")
        except Exception:
            pass
    return read_note(rel)


def _slugify(text: str) -> str:
    tr_map = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = text.translate(tr_map)
    s = re.sub(r"[^\w\s\-]", "", s).strip()
    s = re.sub(r"[\s\-]+", "_", s)
    return s[:60] or "Yeni_Kasa"


def create_kasa(title: str, tag: str = "Çalışma Kasası", desc: str = "", icon: str = "📘", space: str = "", accent: str = "") -> dict:
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("Kasa adı boş olamaz")
    folder_key = _slugify(clean_title)
    d = _safe_path(folder_key)
    d.mkdir(parents=True, exist_ok=True)
    clean_tag = tag.strip() or "Çalışma Kasası"
    clean_desc = desc.strip() or f"{clean_title} ders notları, deney raporları ve kaynak belgeleri."
    clean_icon = (icon or "📘").strip() or "📘"
    clean_accent = (accent or "#e0a458").strip() or "#e0a458"

    FOLDER_NAMES[folder_key] = clean_title
    FOLDER_META[folder_key] = {
        "icon": clean_icon,
        "accent": clean_accent,
        "tag": clean_tag,
        "desc": clean_desc,
    }

    cfg = _load_spaces_cfg()
    valid_ids = {s["id"] for s in cfg["spaces"]}
    clean_space = space.strip()
    if clean_space and clean_space in valid_ids:
        target_space = clean_space
    else:
        target_space = _resolve_kasa_space(folder_key, cfg)
    cfg["assignments"][folder_key] = target_space
    cfg["kasa_meta"][folder_key] = {
        "label": clean_title,
        "icon": clean_icon,
        "accent": clean_accent,
        "tag": clean_tag,
        "desc": clean_desc,
    }
    _save_spaces_cfg(cfg)

    idx_rel = f"{folder_key}/00_{folder_key.upper()}_ANA_INDEKS.md"
    idx_path = _safe_path(idx_rel)
    if not idx_path.exists():
        content = (
            f"# {clean_title} — Ana İndeks\n\n"
            f"> [!NOTE] **Kasa Özeti**\n"
            f"> {clean_desc}\n\n"
            f"## Konular & Notlar\n"
            f"- Bu kasaya yeni not eklemek için sol paneldeki **＋ Yeni Not** butonunu kullanabilir veya PDF/Görsel/Word dosyalarını doğrudan sürükleyip bırakabilirsin.\n"
        )
        write_note(idx_rel, content)
    return {"key": folder_key, "title": clean_title, "space": target_space, "index_id": f"note:{idx_rel}"}


def update_kasa(
    key: str,
    title: str | None = None,
    tag: str | None = None,
    desc: str | None = None,
    icon: str | None = None,
    accent: str | None = None,
    space: str | None = None,
) -> dict:
    clean_key = key.replace("\\", "/").strip("/")
    if not clean_key or "/" in clean_key:
        raise ValueError("Geçersiz kasa anahtarı")
    d = _safe_path(clean_key)
    if not d.exists() or not d.is_dir():
        raise FileNotFoundError(clean_key)

    cfg = _load_spaces_cfg()
    valid_ids = {s["id"] for s in cfg["spaces"]}
    if space is not None:
        sp = space.strip()
        if sp:
            if sp not in valid_ids:
                raise ValueError(f"Alan bulunamadı: {sp}")
            cfg["assignments"][clean_key] = sp

    cur_meta = _meta_for_folder(clean_key, cfg)
    entry = dict(cfg["kasa_meta"].get(clean_key, {}))
    if title is not None and title.strip():
        entry["label"] = title.strip()
        FOLDER_NAMES[clean_key] = title.strip()
    elif "label" not in entry:
        entry["label"] = cur_meta["label"]
    for field, val in (("tag", tag), ("desc", desc), ("icon", icon), ("accent", accent)):
        if val is not None and val.strip():
            entry[field] = val.strip()
        elif field not in entry:
            entry[field] = cur_meta[field]

    cfg["kasa_meta"][clean_key] = entry
    _save_spaces_cfg(cfg)
    resolved_space = _resolve_kasa_space(clean_key, cfg)
    return {"key": clean_key, "space": resolved_space, **entry}


def save_space(
    space_id: str | None = None,
    title: str = "",
    icon: str = "🗂",
    accent: str = "#e0a458",
    tag: str = "",
    desc: str = "",
) -> dict:
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("Alan adı boş olamaz")
    cfg = _load_spaces_cfg()
    spaces = cfg["spaces"]
    clean_id = (space_id or "").strip()
    existing = next((s for s in spaces if s["id"] == clean_id), None) if clean_id else None

    if existing:
        existing["title"] = clean_title
        if icon.strip():
            existing["icon"] = icon.strip()
        if accent.strip():
            existing["accent"] = accent.strip()
        existing["tag"] = tag.strip() or existing.get("tag") or "Çalışma Alanı"
        existing["desc"] = desc.strip()
        saved = existing
    else:
        base_id = _slugify(clean_title).lower()
        new_id = base_id
        n = 2
        used = {s["id"] for s in spaces}
        while new_id in used:
            new_id = f"{base_id}_{n}"
            n += 1
        saved = {
            "id": new_id,
            "title": clean_title,
            "icon": icon.strip() or "🗂",
            "accent": accent.strip() or "#e0a458",
            "tag": tag.strip() or "Çalışma Alanı",
            "desc": desc.strip() or f"{clean_title} çalışma alanı ve kasaları.",
        }
        spaces.append(saved)

    _save_spaces_cfg(cfg)
    return saved


def delete_space(space_id: str) -> dict:
    clean_id = space_id.strip()
    cfg = _load_spaces_cfg()
    spaces = cfg["spaces"]
    if len(spaces) <= 1:
        raise ValueError("Son kalan çalışma alanı silinemez")
    idx = next((i for i, s in enumerate(spaces) if s["id"] == clean_id), None)
    if idx is None:
        raise FileNotFoundError(clean_id)
    spaces.pop(idx)
    fallback = "belgeler" if any(s["id"] == "belgeler" for s in spaces) else spaces[0]["id"]
    for k, v in list(cfg["assignments"].items()):
        if v == clean_id:
            cfg["assignments"][k] = fallback
    _save_spaces_cfg(cfg)
    return {"deleted": clean_id, "fallback": fallback}


def create_folder(parent_rel: str, name: str) -> dict:
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Klasör adı boş olamaz")
    parent_clean = parent_rel.replace("\\", "/").strip("/")
    if not parent_clean:
        raise ValueError("Üst kasa/klasör belirtilmedi")
    parent_path = _safe_path(parent_clean)
    if not parent_path.exists() or not parent_path.is_dir():
        raise FileNotFoundError(parent_clean)
    slug = _slugify(clean_name)
    rel = f"{parent_clean}/{slug}"
    d = _safe_path(rel)
    n = 2
    while d.exists():
        rel = f"{parent_clean}/{slug}_{n}"
        d = _safe_path(rel)
        n += 1
    d.mkdir(parents=True, exist_ok=True)
    FOLDER_NAMES[d.name] = clean_name
    mirror = ROOT / "notes" / rel
    if mirror.resolve() != d.resolve():
        try:
            mirror.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
    return {"rel": rel, "name": clean_name, "kasa": parent_clean.split("/")[0]}


def create_note(kasa: str, title: str, content: str = "") -> dict:
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("Not başlığı boş olamaz")
    raw_kasa = kasa.replace("\\", "/").strip("/")
    kasa_path = _safe_path(raw_kasa)
    if kasa_path.exists() and kasa_path.is_dir():
        kasa_clean = raw_kasa
    else:
        parts = [_slugify(part) for part in raw_kasa.split("/") if part]
        kasa_clean = "/".join(parts) or _slugify(raw_kasa)
    slug = _slugify(clean_title)
    rel = f"{kasa_clean}/{slug}.md"
    p = _safe_path(rel)
    n = 2
    while p.exists():
        rel = f"{kasa_clean}/{slug}_{n}.md"
        p = _safe_path(rel)
        n += 1
    body = content.strip() or f"# {clean_title}\n\nBuraya notlarını, matematiksel ifadeleri ($f_0 = \\frac{{1}}{{2\\pi\\sqrt{{LC}}}}$) veya devre şemalarını yazabilirsin.\n"
    note = write_note(rel, body)
    return {"id": f"note:{rel}", **note}


def delete_note(rel: str) -> dict:
    p = _safe_path(rel)
    if not p.exists() or p.is_dir():
        raise FileNotFoundError(rel)
    p.unlink()
    mirror = ROOT / "notes" / rel.replace("\\", "/").lstrip("/")
    if mirror.exists() and not mirror.is_dir():
        try:
            mirror.unlink()
        except Exception:
            pass
    return {"deleted": rel}


def _clean_rel(raw: str) -> str:
    s = str(raw or "").strip()
    if s.startswith("note:"):
        s = s[5:]
    return s.replace("\\", "/").strip("/")


def _mirror_move(old_rel: str, new_rel: str) -> None:
    mirror_root = ROOT / "notes"
    if mirror_root.resolve() != VAULT_DIR.resolve():
        m_src = mirror_root / old_rel
        m_dst = mirror_root / new_rel
        if m_src.exists() and not m_dst.exists():
            try:
                m_dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(m_src), str(m_dst))
            except Exception:
                pass


def _migrate_tree_order_keys(tree_order: dict[str, list[str]], old_rel: str, new_rel: str) -> None:
    updated: dict[str, list[str]] = {}
    prefix = old_rel + "/"
    for k, v in tree_order.items():
        if k == old_rel:
            updated[new_rel] = v
        elif k.startswith(prefix):
            updated[new_rel + k[len(old_rel):]] = v
        else:
            updated[k] = v
    tree_order.clear()
    tree_order.update(updated)


def move_item(src_rel: str, target_rel: str, position: str = "into") -> dict:
    """Belge veya klasörü başka bir klasöre taşır ya da ağaç içindeki sırasını günceller."""
    clean_src = _clean_rel(src_rel)
    clean_target = _clean_rel(target_rel)
    pos = (position or "into").strip().lower()
    if pos not in ("into", "before", "after"):
        raise ValueError("Geçersiz konum (into, before, after bekleniyor)")
    if not clean_src:
        raise ValueError("Taşınacak öğe belirtilmedi")

    src = _safe_path(clean_src)
    if not src.exists():
        raise FileNotFoundError(clean_src)
    src_is_dir = src.is_dir()
    src_is_root_kasa = src_is_dir and "/" not in clean_src

    cfg = _load_spaces_cfg()
    tree_order: dict[str, list[str]] = cfg.setdefault("tree_order", {})

    if pos == "into":
        if src_is_root_kasa:
            raise ValueError("Çalışma kasası başka bir klasörün içine taşınamaz")
        is_root_target = clean_target in ("", "_root_docs")
        dst_dir = VAULT_DIR if is_root_target else _safe_path(clean_target)
        if not dst_dir.exists() or not dst_dir.is_dir():
            raise FileNotFoundError(clean_target)
        if src_is_dir and (dst_dir.resolve() == src.resolve() or src.resolve() in dst_dir.resolve().parents):
            raise ValueError("Klasör kendi içine veya alt klasörüne taşınamaz")
        if src.parent.resolve() == dst_dir.resolve():
            return {
                "old_rel": clean_src,
                "new_rel": clean_src,
                "is_dir": src_is_dir,
                "kasa": clean_src.split("/")[0] if "/" in clean_src else "",
                "moved": False,
                "reordered": False,
                "already_here": True,
            }
        dst = dst_dir / src.name
        if dst.exists():
            raise ValueError(f"Hedef klasörde '{src.name}' zaten mevcut")

        old_parent_key = "__root_docs__" if src.parent.resolve() == VAULT_DIR.resolve() else src.parent.relative_to(VAULT_DIR).as_posix()
        shutil.move(str(src), str(dst))
        new_rel = dst.relative_to(VAULT_DIR).as_posix()
        _mirror_move(clean_src, new_rel)

        if old_parent_key in tree_order:
            tree_order[old_parent_key] = [n for n in tree_order[old_parent_key] if n != src.name]
        new_parent_key = "__root_docs__" if dst_dir.resolve() == VAULT_DIR.resolve() else dst_dir.relative_to(VAULT_DIR).as_posix()
        if new_parent_key in tree_order and dst.name not in tree_order[new_parent_key]:
            tree_order[new_parent_key].append(dst.name)
        if src_is_dir:
            _migrate_tree_order_keys(tree_order, clean_src, new_rel)
        _save_spaces_cfg(cfg)
        return {
            "old_rel": clean_src,
            "new_rel": new_rel,
            "is_dir": src_is_dir,
            "kasa": new_rel.split("/")[0] if "/" in new_rel else "",
            "moved": True,
            "reordered": False,
        }

    # pos in ("before", "after")
    if not clean_target:
        raise ValueError("Hedef öğe belirtilmedi")
    if clean_src == clean_target:
        return {
            "old_rel": clean_src,
            "new_rel": clean_src,
            "is_dir": src_is_dir,
            "kasa": clean_src.split("/")[0] if "/" in clean_src else "",
            "moved": False,
            "reordered": False,
        }
    ref = _safe_path(clean_target)
    if not ref.exists():
        raise FileNotFoundError(clean_target)

    # Kök kasalar arası sıralama
    if src_is_root_kasa:
        if not (ref.is_dir() and "/" not in clean_target):
            raise ValueError("Çalışma kasası yalnızca başka bir kasa ile sıralanabilir")
        src_sp = _resolve_kasa_space(clean_src, cfg)
        ref_sp = _resolve_kasa_space(clean_target, cfg)
        if src_sp != ref_sp:
            cfg["assignments"][clean_src] = ref_sp
        dirs = _sort_with_order(
            [d for d in VAULT_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")],
            tree_order.get("__kasas__"),
            lambda x: x.name.lower(),
        )
        names = [d.name for d in dirs if d.name != clean_src]
        ref_idx = names.index(ref.name)
        ins_idx = ref_idx if pos == "before" else ref_idx + 1
        names.insert(ins_idx, clean_src)
        tree_order["__kasas__"] = names
        _save_spaces_cfg(cfg)
        return {
            "old_rel": clean_src,
            "new_rel": clean_src,
            "is_dir": True,
            "kasa": clean_src,
            "moved": False,
            "reordered": True,
        }

    # Kök belgeler arası sıralama
    if "/" not in clean_target:
        if not ref.is_file():
            raise ValueError("Dosya veya klasör bir kasanın yerine konulamaz; kasanın içine bırakın")
        dst_dir = VAULT_DIR
        moved = False
        new_rel = clean_src
        if src.parent.resolve() != dst_dir.resolve():
            if src_is_dir:
                raise ValueError("Klasör kök belge alanına taşınamaz")
            dst = dst_dir / src.name
            if dst.exists():
                raise ValueError(f"Ortak belgelerde '{src.name}' zaten mevcut")
            old_parent_key = src.parent.relative_to(VAULT_DIR).as_posix()
            shutil.move(str(src), str(dst))
            new_rel = dst.relative_to(VAULT_DIR).as_posix()
            _mirror_move(clean_src, new_rel)
            if old_parent_key in tree_order:
                tree_order[old_parent_key] = [n for n in tree_order[old_parent_key] if n != src.name]
            moved = True
        root_files = _sort_with_order(
            [f for f in VAULT_DIR.iterdir() if f.is_file() and not f.name.startswith(".")],
            tree_order.get("__root_docs__"),
            lambda x: x.name.lower(),
        )
        item_name = Path(new_rel).name
        names = [f.name for f in root_files if f.name != item_name]
        ref_idx = names.index(ref.name)
        names.insert(ref_idx if pos == "before" else ref_idx + 1, item_name)
        tree_order["__root_docs__"] = names
        _save_spaces_cfg(cfg)
        return {
            "old_rel": clean_src,
            "new_rel": new_rel,
            "is_dir": False,
            "kasa": "",
            "moved": moved,
            "reordered": True,
        }

    # Kasa / alt klasör içi taşıma + konumlandırma
    dst_dir = ref.parent
    target_parent_key = dst_dir.relative_to(VAULT_DIR).as_posix()
    moved = False
    new_rel = clean_src
    if src.parent.resolve() != dst_dir.resolve():
        if src_is_dir and (dst_dir.resolve() == src.resolve() or src.resolve() in dst_dir.resolve().parents):
            raise ValueError("Klasör kendi içine veya alt klasörüne taşınamaz")
        dst = dst_dir / src.name
        if dst.exists():
            raise ValueError(f"Hedef klasörde '{src.name}' zaten mevcut")
        old_parent_key = "__root_docs__" if src.parent.resolve() == VAULT_DIR.resolve() else src.parent.relative_to(VAULT_DIR).as_posix()
        shutil.move(str(src), str(dst))
        new_rel = dst.relative_to(VAULT_DIR).as_posix()
        _mirror_move(clean_src, new_rel)
        if old_parent_key in tree_order:
            tree_order[old_parent_key] = [n for n in tree_order[old_parent_key] if n != src.name]
        if src_is_dir:
            _migrate_tree_order_keys(tree_order, clean_src, new_rel)
        moved = True

    entries = _sort_with_order(
        [p for p in dst_dir.iterdir() if not p.name.startswith(".")],
        tree_order.get(target_parent_key),
        lambda x: (x.is_dir(), x.name.lower()),
    )
    item_name = Path(new_rel).name
    names = [p.name for p in entries if p.name != item_name]
    ref_idx = names.index(ref.name)
    names.insert(ref_idx if pos == "before" else ref_idx + 1, item_name)
    tree_order[target_parent_key] = names
    _save_spaces_cfg(cfg)
    return {
        "old_rel": clean_src,
        "new_rel": new_rel,
        "is_dir": src_is_dir,
        "kasa": new_rel.split("/")[0] if "/" in new_rel else "",
        "moved": moved,
        "reordered": True,
    }


def _pdf_to_text(p: Path, max_pages: int = 15) -> str:
    """PDF dosyasından pypdf ile metin çıkarır (varsa)."""
    try:
        import pypdf
        reader = pypdf.PdfReader(str(p))
        parts: list[str] = []
        for idx, page in enumerate(reader.pages[:max_pages]):
            t = (page.extract_text() or "").strip()
            if t:
                parts.append(f"[Sayfa {idx + 1}]\n{t}")
        return "\n\n".join(parts).strip()
    except Exception:
        return ""


def pdf_info(rel: str) -> dict:
    """PDF dosyasının sayfa sayısını, boyutunu ve sayfa bazlı çıkarılmış metnini döndürür."""
    p = _safe_path(rel)
    if not p.exists() or p.is_dir():
        raise FileNotFoundError(rel)
    size_kb = round(p.stat().st_size / 1024, 1)
    pages_txt: list[dict] = []
    num_pages = 0
    try:
        import pypdf
        reader = pypdf.PdfReader(str(p))
        num_pages = len(reader.pages)
        for idx, page in enumerate(reader.pages[:30]):
            t = (page.extract_text() or "").strip()
            pages_txt.append({"page": idx + 1, "text": t})
    except Exception:
        pass
    full_text = "\n\n".join(f"### Sayfa {x['page']}\n{x['text']}" for x in pages_txt if x["text"]).strip()
    return {
        "rel": rel,
        "name": p.name,
        "title": _clean_title(p),
        "size_kb": size_kb,
        "pages": num_pages,
        "pages_text": pages_txt,
        "full_text": full_text,
        "scanned": num_pages > 0 and not full_text,
    }


def build_context_from_sources(rels: list[str], active_rel: str | None = None, max_chars: int = 12000) -> str:
    """Seçili kaynakların ve aktif notun gerçek metnini AI istemine eklemek üzere derler."""
    ordered: list[str] = []
    if active_rel:
        clean_a = active_rel[5:] if active_rel.startswith("note:") else active_rel
        if clean_a:
            ordered.append(clean_a)
    for r in rels or []:
        clean_r = r[5:] if r.startswith("note:") else r
        if clean_r and clean_r not in ordered:
            ordered.append(clean_r)
    if not ordered:
        return ""
    blocks: list[str] = []
    total = 0
    for rel in ordered[:8]:
        try:
            p = _safe_path(rel)
            if not p.exists() or p.is_dir():
                continue
            ext = p.suffix.lower()
            if ext in (".md", ".txt", ".csv"):
                txt = p.read_text(encoding="utf-8", errors="replace").strip()
            elif ext == ".html":
                raw_html = p.read_text(encoding="utf-8", errors="replace")
                txt = re.sub(r"<[^>]+>", " ", raw_html).strip()
            elif ext in (".docx", ".doc"):
                d = docx_to_html(rel)
                txt = re.sub(r"<[^>]+>", " ", d.get("html", "")).strip()
            elif ext in (".pptx", ".ppsx"):
                d = pptx_to_slides(rel)
                txt = "\n\n".join(
                    f"[Slayt {s['num']}] {s['title']}\n" + "\n".join(s["lines"])
                    for s in d.get("slides", [])
                ).strip()
            elif ext == ".pdf":
                txt = _pdf_to_text(p)
                if not txt:
                    blocks.append(f"[Ekli PDF Kaynağı (Görsel/Taranmış): {rel} — Dosya yolu: {p}]")
                    continue
            elif ext in IMG_EXT:
                blocks.append(f"[Ekli Görsel Kaynağı: {rel} ({ext}) — Dosya yolu: {p} (görmek için read_file / view_file kullan)]")
                continue
            else:
                blocks.append(f"[Ekli Kaynak Dosya: {rel} ({ext}) — Dosya yolu: {p}]")
                continue
            budget = max(800, (max_chars - total) // max(1, len(ordered)))
            snippet = txt[:budget]
            if len(txt) > budget:
                snippet += "\n...(kısaltıldı)..."
            tag = "AKTİF AÇIK NOT" if (active_rel and rel in active_rel) else "SEÇİLİ KASA KAYNAĞI"
            blocks.append(f"--- [{tag}: {rel}] ---\n{snippet}")
            total += len(snippet)
            if total >= max_chars:
                break
        except Exception:
            continue
    if not blocks:
        return ""
    return "[KASA KAYNAK BAĞLAMI — Yanıtını aşağıdaki gerçek ders notlarına ve kaynaklara dayandır:]\n" + "\n\n".join(blocks) + "\n--- [KAYNAK BAĞLAMI SONU] ---\n\n"


def resolve_chat_images(rels: list[str]) -> list[Path]:
    """Sohbete eklenen görsel yollarını doğrular ve mutlak Path listesi döndürür."""
    out: list[Path] = []
    for raw in (rels or [])[:8]:
        clean = str(raw).strip()
        if clean.startswith("note:"):
            clean = clean[5:]
        if not clean:
            continue
        try:
            p = _safe_path(clean)
        except Exception:
            continue
        if p.exists() and p.is_file() and p.suffix.lower() in IMG_EXT and p not in out:
            out.append(p)
    return out


def build_image_prompt_block(paths: list[Path]) -> str:
    if not paths:
        return ""
    lines = [f"- Görsel {i + 1}: {p}" for i, p in enumerate(paths)]
    return (
        "[KULLANICININ SOHBETE EKLEDİĞİ GÖRSELLER — Yanıtlamadan önce `read_file` / `view_file` "
        "aracını kullanarak aşağıdaki görsel dosyalarını mutlaka açıp incele:]\n"
        + "\n".join(lines)
        + "\n[EK GÖRSELLER SONU]\n\n"
    )


def save_asset(note_rel: str, name: str, data: bytes) -> dict:
    """Görsel, PDF, DOCX veya MD dosyasını ilgili kasanın altına kaydeder."""
    ext = Path(name).suffix.lower()
    is_chat_img = note_rel.strip() == ".chat_images"
    if is_chat_img:
        if ext not in IMG_EXT:
            raise ValueError("Sohbete yalnızca görsel dosyaları eklenebilir")
    else:
        allowed = ASSET_EXT | {".md", ".html"}
        if ext not in allowed:
            raise ValueError("Desteklenmeyen dosya türü (yalnızca MD, HTML, PDF, DOCX veya görsel)")
    if not data or len(data) > MAX_ASSET:
        raise ValueError("Dosya boş veya 50 MB sınırını aşıyor")
    stem = re.sub(r"[^\w\-]+", "_", Path(name).stem).strip("_")[:40] or "dosya"
    if is_chat_img:
        d = VAULT_DIR / ".chat_images"
        d.mkdir(parents=True, exist_ok=True)
        stamp = int(time.time())
        target = d / f"{stem}_{stamp}{ext}"
        n = 1
        while target.exists():
            n += 1
            target = d / f"{stem}_{stamp}_{n}{ext}"
    else:
        if note_rel:
            clean_nr = note_rel[5:] if note_rel.startswith("note:") else note_rel
            p_nr = _safe_path(clean_nr)
            base = p_nr if p_nr.is_dir() else p_nr.parent
        else:
            folders = sorted([d for d in VAULT_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]) if VAULT_DIR.exists() else []
            base = folders[0] if folders else VAULT_DIR
        if base == VAULT_DIR and VAULT_DIR.exists():
            folders = sorted([d for d in VAULT_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")])
            if folders:
                base = folders[0]
        is_dir_target = bool(note_rel and _safe_path(note_rel[5:] if note_rel.startswith("note:") else note_rel).is_dir())
        if ext in (".md", ".html", ".pdf", ".docx", ".doc", ".pptx", ".ppsx", ".ppt", ".xlsx", ".xls", ".csv", ".txt") and is_dir_target:
            d = base
            target = d / f"{stem}{ext}"
            n = 1
            while target.exists():
                n += 1
                target = d / f"{stem}_{n}{ext}"
        elif is_dir_target and base.name in ("_gorseller", "_ekler", "assets"):
            d = base
            target = d / f"{stem}{ext}"
            n = 1
            while target.exists():
                n += 1
                target = d / f"{stem}_{n}{ext}"
        else:
            d = base / "_gorseller"
            d.mkdir(parents=True, exist_ok=True)
            stamp = int(time.time())
            target = d / f"{stem}_{stamp}{ext}"
            n = 1
            while target.exists():
                n += 1
                target = d / f"{stem}_{stamp}_{n}{ext}"
    if not str(target.resolve()).startswith(str(VAULT_DIR.resolve())):
        raise ValueError("Geçersiz dosya yolu")
    target.write_bytes(data)
    rel = target.relative_to(VAULT_DIR).as_posix()
    return {
        "rel": rel,
        "id": f"note:{rel}",
        "name": target.name,
        "ext": ext,
        "embed": f"![[_gorseller/{target.name}]]" if target.parent.name == "_gorseller" else f"![[{target.name}]]",
    }


def docx_to_html(rel: str) -> dict:
    """DOCX dosyasının paragraf ve tablolarını temiz HTML olarak döndürür."""
    p = _safe_path(rel)
    if not p.exists():
        raise FileNotFoundError(rel)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    out: list[str] = []
    with zipfile.ZipFile(p) as z:
        xml_bytes = z.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    body = root.find("w:body", ns)
    if body is None:
        return {"rel": rel, "title": p.name, "html": "<p>(Boş belge)</p>"}
    for child in body:
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            texts = [t.text for t in child.findall(".//w:t", ns) if t.text]
            line = "".join(texts).strip()
            if not line:
                continue
            pPr = child.find("w:pPr", ns)
            style = ""
            if pPr is not None:
                ps = pPr.find("w:pStyle", ns)
                if ps is not None:
                    style = ps.attrib.get(f"{{{ns['w']}}}val", "").lower()
            esc = html.escape(line)
            if "heading1" in style or "baslik1" in style or style == "1":
                out.append(f"<h2>{esc}</h2>")
            elif "heading2" in style or "baslik2" in style or style == "2":
                out.append(f"<h3>{esc}</h3>")
            else:
                out.append(f"<p>{esc}</p>")
        elif tag == "tbl":
            rows_html = []
            for r_idx, tr in enumerate(child.findall("w:tr", ns)):
                cells = []
                for tc in tr.findall("w:tc", ns):
                    ct = " ".join("".join(t.text for t in p_el.findall(".//w:t", ns) if t.text).strip() for p_el in tc.findall("w:p", ns)).strip()
                    cell_tag = "th" if r_idx == 0 else "td"
                    cells.append(f"<{cell_tag}>{html.escape(ct)}</{cell_tag}>")
                if cells:
                    rows_html.append("<tr>" + "".join(cells) + "</tr>")
            if rows_html:
                out.append("<table>" + "".join(rows_html) + "</table>")
    return {"rel": rel, "title": p.name, "html": "\n".join(out) or "<p>(Metin içeriği bulunamadı)</p>"}


def pptx_to_slides(rel: str) -> dict:
    """PPTX/PPSX sunum dosyasının slayt metinlerini ve gömülü görsellerini PDF benzeri sayfa kartları için çıkarır."""
    import base64
    p = _safe_path(rel)
    if not p.exists():
        raise FileNotFoundError(rel)
    ext = p.suffix.lower()
    if ext == ".ppt":
        return {
            "rel": rel,
            "title": p.name,
            "count": 0,
            "slides": [],
            "note": "Eski ikili .ppt formatı doğrudan XML olarak okunamıyor; PowerPoint üzerinden .pptx veya .pdf olarak kaydedin.",
        }
    ns_a = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    ns_p = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
    ns_r = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    slides: list[dict] = []
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
        slide_files = sorted(
            [n for n in names if re.match(r"^ppt/slides/slide\d+\.xml$", n)],
            key=lambda n: int(re.search(r"slide(\d+)\.xml$", n).group(1)),
        )
        for idx, sfile in enumerate(slide_files, start=1):
            root = ET.fromstring(z.read(sfile))
            title = ""
            lines: list[str] = []
            # Extract shapes in order; detect title placeholder if present
            for sp in root.iter(f"{ns_p}sp"):
                is_title = False
                ph = sp.find(f".//{ns_p}ph")
                if ph is not None and ph.attrib.get("type", "") in ("title", "ctrTitle"):
                    is_title = True
                sp_paras: list[str] = []
                for para in sp.findall(f".//{ns_a}p"):
                    txt = "".join(t.text for t in para.findall(f".//{ns_a}t") if t.text).strip()
                    if txt:
                        sp_paras.append(txt)
                if not sp_paras:
                    continue
                if is_title and not title:
                    title = " ".join(sp_paras)
                else:
                    lines.extend(sp_paras)
            if not title and lines:
                title = lines[0]
                lines = lines[1:]

            # Extract embedded raster images referenced by this slide
            images: list[str] = []
            s_num = re.search(r"slide(\d+)\.xml$", sfile).group(1)
            rels_path = f"ppt/slides/_rels/slide{s_num}.xml.rels"
            if rels_path in names:
                rels_root = ET.fromstring(z.read(rels_path))
                rid_to_target = {}
                for rel_el in rels_root:
                    rid = rel_el.attrib.get("Id", "")
                    tgt = rel_el.attrib.get("Target", "")
                    if rid and tgt:
                        rid_to_target[rid] = tgt
                seen_imgs: set[str] = set()
                for blip in root.iter(f"{ns_a}blip"):
                    rid = blip.attrib.get(f"{ns_r}embed", "")
                    tgt = rid_to_target.get(rid, "")
                    if not tgt:
                        continue
                    norm = ("ppt/" + tgt.lstrip("./").replace("../", "")) if "media/" in tgt else ""
                    if not norm or norm in seen_imgs or norm not in names:
                        continue
                    seen_imgs.add(norm)
                    img_ext = Path(norm).suffix.lower().lstrip(".")
                    mime = {
                        "png": "image/png",
                        "jpg": "image/jpeg",
                        "jpeg": "image/jpeg",
                        "gif": "image/gif",
                        "webp": "image/webp",
                        "svg": "image/svg+xml",
                    }.get(img_ext)
                    if not mime:
                        continue
                    raw_bytes = z.read(norm)
                    if len(raw_bytes) <= 4 * 1024 * 1024:
                        b64 = base64.b64encode(raw_bytes).decode("ascii")
                        images.append(f"data:{mime};base64,{b64}")

            slides.append({
                "num": idx,
                "title": title or f"Slayt {idx}",
                "lines": lines,
                "images": images,
            })
    return {"rel": rel, "title": p.name, "count": len(slides), "slides": slides}
