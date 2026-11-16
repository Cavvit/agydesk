import os

vault_base = r'C:\Users\cavit\Desktop\Elektrik_Makinalari_Lab_Vault'

kon_index = """# 🎛️ Kontrol Laboratuvarı — Ana İndeks ve Çalışma Planı

> [!IMPORTANT] Laboratuvar ve Grup Bilgileri
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 14. Grup (G-14)
> - **Laboratuvar Saati:** Perşembe günleri 16:00 – 17:00
> - **Grup Arkadaşları:** Arda Gümrükçü, Eyüp Dolanbay, Melih Şahinoğlu, Oğuzhan Hombaç, Cavit Özgen
> - **Kaynak Belgeler:** [[_kaynaklar/Takvim2026_kopyası.pdf]], [[_kaynaklar/Ders_Ä°zlencesi_2026.pdf]]

---

## 📅 Cavit ÖZGEN — Kontrol Laboratuvar Takvimi

| Hafta | Tarih | Saat | Deney No | Deney Adı | Durum |
| :---: | :---: | :---: | :---: | :--- | :---: |
| 1 | 22.10.2026 | 16:00 - 17:00 | **2. Deney** | [[Deney_2_Isi_Akis_Kontrol_Sistemi]] | Tamamlandı |
| 2 | 12.11.2026 | 16:00 - 17:00 | **3. Deney** | [[Deney_3_Arac_Kontrol_Sistemi]] | Dün Yapıldı |
| 3 | **03.12.2026** | **16:00 - 17:00** | **4. Deney** | [[Deney_4_DC_Motor_Kontrol_Sistemi]] | **Gelecek Deney (Sıradaki)** |
| 4 | 17.12.2026 | 16:00 - 17:00 | **1. Deney** | [[Deney_1_Ikili_Tank_Deney_Sistemi]] | Planlandı |

---

## 📑 Deney Föyleri ve Notlar
- [[Deney_1_Ikili_Tank_Deney_Sistemi]] — Çift su tankı sıvı seviye kontrolü, Bernoulli/Torricelli modelleme, lineerleştirme ve PI seviye kontrolü.
- [[Deney_2_Isi_Akis_Kontrol_Sistemi]] — Hava kanalı sıcaklık kontrolü, 1. mertebeden gecikmeli modelleme, PI kontrolcü tasarımı.
- [[Deney_3_Arac_Kontrol_Sistemi]] — 1 metre ray sistemi üzerinde araç pozisyon kontrolü, PV kontrolcü tasarımı.
- [[Deney_4_DC_Motor_Kontrol_Sistemi]] — DC motor hız ve pozisyon kontrolü, optik enkoder/potansiyometre geri beslemesi, kapalı çevrim PID/PI ayarı.
"""

kon_dir = os.path.join(vault_base, 'Kontrol_Lab')
with open(os.path.join(kon_dir, '00_KONTROL_LAB_ANA_INDEKS.md'), 'w', encoding='utf-8') as f:
    f.write(kon_index.strip() + '\n')

kon_notes = {
    'Deney_1_Ikili_Tank_Deney_Sistemi.md': """# 🎛️ Deney 1: İkili Su Tankı Deney Sistemi

> [!IMPORTANT] Deney Bilgileri ve Takvim
> - **Ders:** Kontrol Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 14. Grup (G-14)
> - **Tarih:** **17 Aralık 2026 Perşembe**
> - **Saat:** 16:00 – 17:00

---

## 1. Deneyin Amacı ve Matematiksel Modelleme
İkili tank sistemi dikey konumlandırılmış iki şeffaf tanktan oluşur. Üstteki Tank 1 pompa ile doldurulurken, altındaki çıkış deliğinden Tank 2'ye boşalır.

- **Torricelli Yasası (Sıvı Çıkış Akışı):**
$$f_o = A_o \\sqrt{2g L_1}$$
- **Sıvı Kütle Korunumu:**
$$A_t \\frac{dL_1}{dt} = f_i - f_o = f_i - A_o \\sqrt{2g L_1}$$
- Çalışma noktası civarında lineerleştirilerek 1. mertebeden transfer fonksiyonu elde edilir:
$$G(s) = \\frac{\\Delta L_1(s)}{\\Delta f_i(s)} = \\frac{R}{R A_t s + 1}$$
""",
    'Deney_2_Isi_Akis_Kontrol_Sistemi.md': """# 🎛️ Deney 2: Isı Akış Kontrol Sistemi Deneyi

> [!IMPORTANT] Deney Bilgileri ve Takvim
> - **Ders:** Kontrol Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 14. Grup (G-14)
> - **Tarih:** 22 Ekim 2026 Perşembe (Tamamlandı)
> - **Saat:** 16:00 – 17:00

---

## 1. Deneyin Amacı
Bir fan ve elektrikli ısıtıcı kullanılan hava kanalı boyunca seçilen sensör noktalarındaki sıcaklığı PI kontrolcü tasarlayarak istenen referans değerde tutmak.

- **Sistem Modeli (Gecikmeli 1. Mertebe Transfer Fonksiyonu):**
$$G(s) = \\frac{K}{\\tau s + 1} e^{-\\theta s}$$
Burada $K$ statik kazanç, $\\tau$ zaman sabiti, $\\theta$ ise havanın ısıtıcıdan sensöre ulaşma gecikme süresidir.
""",
    'Deney_3_Arac_Kontrol_Sistemi.md': """# 🎛️ Deney 3: Araç Kontrol Sistemi (AKS)

> [!IMPORTANT] Deney Bilgileri ve Takvim
> - **Ders:** Kontrol Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 14. Grup (G-14)
> - **Tarih:** 12 Kasım 2026 Perşembe (Dün Yapıldı)
> - **Saat:** 16:00 – 17:00

---

## 1. Deneyin Amacı
1 metre uzunluğundaki doğrusal ray sistemi üzerinde hareket eden aracın pozisyonunu PV (Proportional-Velocity) kontrolcü mimarisi ile kontrol etmek.

- **Hareket Denklemi:**
$$M \\ddot{x}(t) + b \\dot{x}(t) = F(t)$$
- Transfer Fonksiyonu:
$$\\frac{X(s)}{F(s)} = \\frac{1}{s(M s + b)}$$
""",
    'Deney_4_DC_Motor_Kontrol_Sistemi.md': """# 🎛️ Deney 4: DC Motor Kontrol Sistemi

> [!IMPORTANT] Deney Bilgileri ve Takvim
> - **Ders:** Kontrol Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 14. Grup (G-14)
> - **Tarih:** **03 Aralık 2026 Perşembe**
> - **Saat:** 16:00 – 17:00
> - **Durum:** **Sıradaki Deney**

---

## 1. Deneyin Amacı ve Matematiksel Modeli
Armatür kontrollü bir DC motorun hız ve açısal pozisyonunun kapalı çevrim geri besleme ile kontrol edilmesi.

- **Armatür Gerilim Denklemi:**
$$V_a(t) = R_a I_a(t) + L_a \\frac{dI_a(t)}{dt} + e_b(t), \\quad e_b(t) = K_b \\omega(t)$$
- **Mekanik Moment Denklemi:**
$$T_m(t) = K_t I_a(t) = J \\frac{d\\omega(t)}{dt} + B \\omega(t)$$
- **Açısal Hız Transfer Fonksiyonu:**
$$\\frac{\\Omega(s)}{V_a(s)} = \\frac{K_t}{(R_a + s L_a)(J s + B) + K_t K_b}$$
"""
}

for fname, cont in kon_notes.items():
    with open(os.path.join(kon_dir, fname), 'w', encoding='utf-8') as f:
        f.write(cont.strip() + '\n')
    print('Created Kontrol note:', fname)

print('All Kontrol notes successfully generated.')
