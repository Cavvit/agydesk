# AgyDesk — Çalışma İstasyonu (Native Rust + Gömülü `agy` CLI)

Native Rust masaüstü motoru (`AgyDesk.exe` — Axum + Tao/Wry WebView2) ve Python (FastAPI) backend alternatifi. Bulut modelleri doğrudan yerel **Antigravity CLI (`agy`)** üzerinden (`stream-json` headless modda, `--thinking off`) çalışır; harici API anahtarı gerekmez.

## Çalıştırma
```powershell
# Doğrudan Native Masaüstü Uygulaması (Önerilen):
.\AgyDesk.exe
# veya Baslat_AgyDesk.bat

# Python Backend ile (Masaüstü veya Android Termux):
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765
python -m pytest tests -q
```

## Tablet (Android / Termux) Kullanımı
```bash
git clone https://github.com/Cavvit/agydesk.git ~/ai-workstation
cd ~/ai-workstation
pip install -r requirements.txt
# Çalışma notlarını notes/ klasörüne kopyaladıktan sonra:
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765
# Tablet tarayıcısında (Chrome/Brave) aç: http://127.0.0.1:8765
```

## Model & İzin Eşlemesi (`agy` CLI)
- **Genel sohbet / orkestrasyon:** `gemini-3.8-flash-low` (`--thinking off`)
- **Mühendislik / simülasyon / kontrol:** `gemini-4-argon-low` (`--thinking off`)
- **Kodlama / PCB / mimari:** `claude-sonnet-5-5-low` (`--thinking off`)
- **Ağır matematik / ispat / konsey:** `claude-opus-5-5-low` (`--thinking off`)
- **Basit özet / ses / OCR (veya kota ≥%85):** Yerel Ollama (`http://localhost:11434`, `qwen2.5:14b`, `think: false`)

### İzin Modu → `agy` Bayrakları
- 🟢 **Onaylı (`g`):** `--mode accept-edits` (uygulama önce onay kartı çıkarır)
- 🟡 **Akıllı (`y`):** `--mode auto` (riskli işlerde uygulama onay kartı çıkarır)
- 🔴 **Tam Otomatik (`r`):** `--dangerously-skip-permissions` (`agya` karşılığı)

Her AI oturumu kendi `conversation_id` değerini SQLite'da saklar ve `--conversation <id>` ile çok turlu bağlamı korur (`/clear` ile sıfırlanır). Kişisel notlar yerel `notes/` dizininde tutulur ve `.gitignore` ile sürüm kontrolünden hariç tutulmuştur.
