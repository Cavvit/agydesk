import os

vault_base = r'C:\Users\cavit\Desktop\Elektrik_Makinalari_Lab_Vault'

hab_notes = {
    "Deney_1_AM_Modulasyon_ve_Demodulasyon.md": """# 📡 Deney 1: AM Modülasyon ve Demodülasyonu

> [!IMPORTANT] Deney Bilgileri & Takvim
> - **Ders:** Haberleşme Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 3. Grup
> - **Tarih:** 09 Kasım 2026 Pazartesi (Tamamlandı)
> - **Saat:** 14:00 – 15:00

---

## 1. Temel Teori
Genlik modülasyonunda yüksek frekanslı taşıyıcı sinyalin genliği, düşük frekanslı bilgi sinyaline göre orantılı olarak değiştirilir:
$$s(t) = [V_c + m(t)] \cos(2\pi f_c t) = V_c [1 + m \cos(2\pi f_m t)] \cos(2\pi f_c t)$$

Modülasyon İndeksi:
$$m = \frac{V_m}{V_c} = \frac{V_{max} - V_{min}}{V_{max} + V_{min}}$$

- $m < 1$: Normal modülasyon.
- $m = 1$: Kritik modülasyon (%100).
- $m > 1$: Aşırı modülasyon (Zarf distorsiyonu ve faz terslenmesi oluşur).

## 2. Demodülasyon
- Zarf dedektörü (Diyot + Paralel RC alçak geçiren filtre) kullanılır.
- RC zaman sabiti kriteri: $\frac{1}{f_c} \ll RC \ll \frac{1}{f_m}$
""",
    "Deney_3_PWM_Modulasyonu_ve_Demodulasyonu.md": """# 📡 Deney 3: Darbe Genişlik Modülasyonu (PWM) ve Demodülasyonu

> [!IMPORTANT] Deney Bilgileri & Takvim
> - **Ders:** Haberleşme Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 3. Grup
> - **Tarih:** 05 Ekim 2026 Pazartesi (Tamamlandı)
> - **Saat:** 14:00 – 15:00

---

## 1. Temel Teori
PWM (Pulse Width Modulation), periyodik bir darbe katarının genliği ve frekansı sabit tutulurken, darbe genişliğinin (duty cycle) modüle eden sinyalin anlık genliğine göre değiştirilmesidir.

Doluluk Oranı (Duty Cycle):
$$D = \frac{T_{on}}{T} \times 100$$

## 2. Modülatör & Demodülatör Devresi
- **Modülatör:** Bir testere dişi (veya üçgen) dalga üreteci ile analog bilgi sinyali bir gerilim karşılaştırıcıya (komparatör / LM311 ya da op-amp) girilir.
- **Demodülatör:** Bir RC alçak geçiren filtre (LPF) darbe katarının ortalama değerini alarak orijinal sinyali geri üretir.
""",
    "Deney_4_FSK_Modulasyonu_ve_Demodulasyonu.md": """# 📡 Deney 4: Frekans Kaydırmalı Anahtarlama (FSK) ve Demodülasyonu

> [!IMPORTANT] Deney Bilgileri & Takvim
> - **Ders:** Haberleşme Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 3. Grup
> - **Tarih:** 12 Ekim 2026 Pazartesi (Tamamlandı)
> - **Saat:** 14:00 – 15:00

---

## 1. Temel Teori
FSK (Frequency Shift Keying), sayısal ikili verilerin (0 ve 1) iki farklı ayrık taşıyıcı frekansla iletilmesidir:
- Sayısal '1' (Mark): $f_1$ frekansı
- Sayısal '0' (Space): $f_2$ frekansı

## 2. Devre Gerçeklemesi
- **Modülatör:** XR-2206 monolitik fonksiyon üreteci entegresi veya gerilim kontrollü osilatör (VCO).
- **Demodülatör:** Faz kilitlemeli çevrim (PLL - NE565) veya eşik algılayıcılı bant geçiren filtre kombinasyonu.
""",
    "Deney_5_Fiber_Optik_Verici_ve_Alici.md": """# 📡 Deney 5: Fiber Optik Verici ve Alıcı Devreleri

> [!IMPORTANT] Deney Bilgileri & Takvim
> - **Ders:** Haberleşme Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 3. Grup
> - **Tarih:** 19 Ekim 2026 Pazartesi (Tamamlandı)
> - **Saat:** 14:00 – 15:00

---

## 1. Temel Teori
Elektriksel sinyallerin ışık sinyaline dönüştürülerek dielektrik cam veya plastik fiber optik kablo üzerinden toplam iç yansıma prensibiyle iletilmesidir.

- **Kritik Açı & Toplam İç Yansıma:** $\theta_c = \arcsin\left(\frac{n_2}{n_1}\right)$ (Çekirdek $n_1 >$ Kılıf $n_2$).
- **Sayısal Açıklık (Numerical Aperture - NA):**
$$NA = \sqrt{n_1^2 - n_2^2} = \sin(\theta_{max})$$

## 2. Devre Elemanları
- **Işık Kaynağı (Verici):** 660 nm Kırmızı LED veya Lazer Diyot.
- **Işık Algılayıcı (Alıcı):** PIN Fotodiyot veya Çığ (Avalanche) Fotodiyot (APD) + Akım-Gerilim Transimpedans Kuvvetlendiricisi.
""",
    "Deney_6_Antenler.md": """# 📡 Deney 6: Antenler ve Işıma Karakteristikleri

> [!IMPORTANT] Deney Bilgileri & Takvim
> - **Ders:** Haberleşme Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 3. Grup
> - **Tarih:** 26 Ekim 2026 Pazartesi (Tamamlandı)
> - **Saat:** 14:00 – 15:00

---

## 1. Temel Teori
Antenler, iletim hatlarındaki kılavuzlanmış elektromanyetik dalgaları serbest uzaydaki küresel dalgalara (ve tersine) dönüştüren dönüştürücülerdir.

- **Yarım Dalga Dipol Boyu:** $L \approx \frac{\lambda}{2} = \frac{c}{2f}$
- **Giriş Empedansı:** Dipol rezonansta yaklaşık $73 + j42.5\ \Omega$ (kısaltılarak saf $73\ \Omega$ yapılır).
- **Yönelticilik & Kazanç:** $G = \eta \cdot D$
""",
    "Deney_7_FDM_Frekans_Bolmeli_Cogullayici.md": """# 📡 Deney 7: Frekans Bölmeli Çoğullayıcı (FDM)

> [!IMPORTANT] Deney Bilgileri & Takvim
> - **Ders:** Haberleşme Laboratuvarı
> - **Öğrenci:** Cavit ÖZGEN (200705054)
> - **Grup:** 3. Grup
> - **Tarih:** 02 Kasım 2026 Pazartesi (Tamamlandı)
> - **Saat:** 14:00 – 15:00

---

## 1. Temel Teori
FDM (Frequency Division Multiplexing), tek bir iletim kanalının toplam bant genişliğini birden çok alt frekans bandına bölerek farklı sinyalleri eşzamanlı taşıma tekniğidir.

- Her kanal farklı bir $f_{c1}, f_{c2}, \dots$ taşıyıcısı ile modüle edilir (DSB-SC veya SSB).
- Kanallar arasında karışmayı (crosstalk) önlemek için koruma bantları (guard bands) bırakılır.
- Alıcıda keskin bant geçiren filtreler (BPF) ile ayrıştırılarak demodüle edilir.
"""
}

hab_dir = os.path.join(vault_base, 'Haberlesme_Lab')
for fname, content in hab_notes.items():
    fpath = os.path.join(hab_dir, fname)
    with open(fpath, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '\n')
    print('Created:', fname)

print('All Haberlesme notes generated.')
