# AgyDesk — EEM Çalışma İstasyonu & Antigravity CLI Entegrasyon Rehberi

> **Sürüm:** Faz 1 · Güncel Kararlı Sürüm  
> **Tarih:** 8 Kasım 2026  
> **Konu:** AgyDesk Kurulumu, Antigravity CLI (`agy`) Bağlantısı, Mimari Diff Notları ve Diferansiyel Denklemler (DİF) Not Rehberi

---

## ⚡ 1. Hızlı Başlangıç (Arkadaşın İçin 3 Adımda Kurulum)

### Adım 1: Python ve Bağımlılıklar
Bilgisayarında Python 3.10 veya üzeri kurulu olmalıdır (kurulumda *"Add Python to PATH"* seçili olmalıdır).
AgyDesk klasörünü aç ve komut satırında bağımlılıkları yükle:
```powershell
pip install -r requirements.txt
```

### Adım 2: Antigravity CLI (`agy`) Kurulumu ve Giriş
AgyDesk, harici API anahtarı yerine doğrudan yerel **Antigravity CLI (`agy`)** altyapısını kullanır.
1. `agy` kurulu değilse terminalde kur:
   ```powershell
   npm install -g antigravity-cli
   # veya winget / pip dağıtımınız üzerinden
   ```
2. Hesabınla oturum aç:
   ```powershell
   agy auth
   ```
3. Oturumun doğruluğunu test et:
   ```powershell
   agy --version
   ```

*(Not: Eğer `agy` sisteminde standart dışı bir dizindeyse, ortam değişkeni olarak `AIWS_AGY_BIN="C:\yol\agy.exe"` tanımlayabilirsin. AgyDesk otomatik olarak PATH, AppData ve npm dizinlerini tarar.)*

### Adım 3: Tek Tıkla Başlatma
- Klasördeki **`Baslat_AgyDesk.bat`** dosyasına çift tıkla.
- Veya doğrudan terminalden:
  ```powershell
  python -m uvicorn backend.main:app --port 8780
  ```
- Tarayıcı üzerinden açmak istersen: **`http://127.0.0.1:8780`**  
- `Atolye_Masaustu.pyw` dosyasını çalıştırırsan masaüstü uygulama modunda (Edge/Chrome penceresinde) penceresiz ve sessizce açılır.

---

## 📚 2. Obsidian Kasa (Vault) Yönetimi

AgyDesk, yerel klasör tabanlı **Obsidian Kasa (`notes/`)** mimarisiyle çalışır:
- Kullanıcıya özel ders notları, PDF'ler ve görseller yerel `notes/` dizininde (veya `AIWS_VAULT` ile tanımlanan dizinde) tutulur ve gizlilik gereği Git deposuna dahil edilmez (`.gitignore` ile hariç tutulmuştur).
- Sol panelden yeni ders/proje kasası ve Markdown (`.md`) notu oluşturulabilir, mevcut PDF ve görsel ekleri uygulama içi tam ekran stüdyoda (Gece Modu & OCR destekli) incelenebilir.

---

## 🛠 3. AgyDesk Değişiklik / Diff Notları (Changelog)

AgyDesk'in bu güncel sürümünde yapılan temel geliştirmeler:

| Modül | Yapılan Değişiklikler / Diff |
| :--- | :--- |
| **Arayüz (Frontend)** | • Yüksek kontrastlı EEM Atölye teması (Instrument Sans + JetBrains Mono).<br>• Çoklu sekme (Tab) yönetimi ve sekmeler arası senkronizasyon.<br>• LaTeX matematik desteği (`$...$` ve `$$...$$`).<br>• Dahili Mermaid diyagram ve SVG elektrik devre çizim motoru (`sema trafo-...`, `sema dc-sont`).<br>• İnteraktif EEM çalışma takvimi (Vize, quiz, teslim takibi). |
| **Kasa (Obsidian Vault)** | • Sol panelde tam Obsidian not ağacı gezgini.<br>• Markdown notları haricinde `_ekler` ve `_gorseller` klasörlerindeki PDF, DOCX ve görsel dosyalarını anında önizleme.<br>• Çift yönlü bağlantı (Wikilinks `[[Not_Adi]]`) tıklanabilir sekme açma entegrasyonu. |
| **Backend & Motor** | • FastAPI + Uvicorn asenkron mimari.<br>• `agy` CLI arka plan işlemi üzerinden `stream-json` SSE (Server-Sent Events) canlı akış.<br>• SQLite tabanlı kalıcı oturum (`atolye.db`), kota izleme ve geri alma (checkpoint/undo) mekanizması.<br>• Çoklu model yönlendirme ve %85 kota aşımında yerel Ollama fallback motoru. |
| **Taşınabilirlik** | • Sabit yerel kullanıcı yolları kaldırıldı; dinamik `Path.home()` ve `ROOT / "notes"` yapısına geçirildi.<br>• Tek tık başlatıcı `Baslat_AgyDesk.bat` eklendi. |

---

## 🤖 4. Antigravity CLI (`agy`) Entegrasyonu & Yetkiler

AgyDesk sohbet ekranı, doğrudan arkada çalışan `agy` oturumuna bağlıdır:

### Model Dağılımı (Thinking Kapalı / Düşük Gecikme Modu)
- **Genel Sohbet / Not Analizi:** `gemini-4-hydrogen-{low|medium|high|xhigh}` (varsayılan `low`, arayüzden seçilebilir)
- **Mühendislik / Kontrol / Simülasyon:** `gemini-4-argon-low` (`--thinking off`)
- **Kodlama / PCB / Donanım:** `claude-sonnet-5-5-low` (`--thinking off`)
- **Ağır Matematik / İspat:** `claude-opus-5-5-low` (`--thinking off`)
- **Yerel Fallback:** Ollama `qwen2.5:14b` (`think: false`, bulut kotası dolduğunda devreye girer)

### İzin Modları (Arayüzdeki Renkli Rozetler)
- 🟢 **Onaylı (`g`):** `--mode accept-edits` (Dosya yazma/değiştirme öncesi onay kartı sunar).
- 🟡 **Akıllı (`y`):** `--mode auto` (Yalnızca riskli sistem işlemlerinde onay ister).
- 🔴 **Tam Otomatik (`r`):** `--dangerously-skip-permissions` (`agya` modu, kesintisiz otonom çalışma).

---

## 📁 5. Dosya ve Dizin Yapısı

```
agydesk/
├── src-rust/                 # Native Rust (Axum + Tao/Wry WebView2) masaüstü motoru
│   ├── Cargo.toml
│   └── src/                  # main, config, providers, router, store, vault, permissions, checkpoints
├── backend/                  # Python FastAPI alternatif çekirdeği
│   ├── config.py             # Model, agy yolu ve kasa ayarları
│   ├── main.py               # REST ve SSE API uç noktaları
│   ├── providers.py          # agy CLI stream-json alt işlem yönetimi
│   ├── router.py             # Akıllı model ve kota yönlendiricisi
│   ├── store.py              # SQLite oturum ve kota veritabanı
│   └── vault.py              # Obsidian Markdown ve ek okuyucu
├── frontend/                 # Tek sayfa modern arayüz ve statik varlıklar
│   ├── index.html            # Ana uygulama şablonu ve istemci mantığı
│   ├── agydesk.ico           # Uygulama simgesi
│   └── agydesk_logo.png      # Logo
├── notes/                    # Yerel Obsidian Kasaları (.gitignore ile Git dışında tutulur)
├── AgyDesk.exe               # Native Win32/WebView2 derlenmiş masaüstü uygulaması
├── WebView2Loader.dll        # WebView2 yerel yükleyici kütüphanesi
├── Baslat_AgyDesk.bat        # Tek tık Windows başlatma betiği
├── Atolye_Masaustu.pyw       # Python penceresiz masaüstü başlatıcı
├── requirements.txt          # Python bağımlılıkları
└── DIFF_VE_KURULUM_REHBERI.md# Bu rehber
```

---
*İyi çalışmalar ve sınavlarda başarılar!*
