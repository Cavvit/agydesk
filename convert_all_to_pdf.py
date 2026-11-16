import os
import shutil
import comtypes.client

src_dir = r"C:\Users\cavit\Desktop\Elektrik_Makinalari_Lab_Vault\Katihal_Elektronigi\Kaynaklar"
dest_ekler1 = r"C:\Users\cavit\Desktop\Elektrik_Makinalari_Lab_Vault\Katihal_Elektronigi\_ekler"
dest_ekler2 = r"C:\Users\cavit\Desktop\Katihal_Elektronigi_Vault\_ekler"

os.makedirs(dest_ekler1, exist_ok=True)
os.makedirs(dest_ekler2, exist_ok=True)

# 1. Mevcut PDF'leri kopyala
for f in os.listdir(src_dir):
    if f.lower().endswith('.pdf'):
        s = os.path.join(src_dir, f)
        d1 = os.path.join(dest_ekler1, f)
        d2 = os.path.join(dest_ekler2, f)
        shutil.copy2(s, d1)
        shutil.copy2(s, d2)
        print(f"PDF kopyalandı: {f}")

# 2. PowerPoint dosyalarını PDF'e dönüştür
ppt_files = [f for f in os.listdir(src_dir) if f.lower().endswith(('.ppsx', '.pptx', '.ppt'))]
print(f"Dönüştürülecek sunu sayısı: {len(ppt_files)}")

ppt = comtypes.client.CreateObject("PowerPoint.Application", dynamic=True)

for f in ppt_files:
    base_name = os.path.splitext(f)[0]
    out_name = base_name + ".pdf"
    out_path1 = os.path.join(dest_ekler1, out_name)
    out_path2 = os.path.join(dest_ekler2, out_name)
    in_path = os.path.join(src_dir, f)

    try:
        print(f"Dönüştürülüyor: {f} -> {out_name}")
        # Presentations.Open(FileName, ReadOnly, Untitled, WithWindow)
        pres = ppt.Presentations.Open(in_path, True, False, False)
        # 32 = ppSaveAsPDF
        pres.SaveAs(out_path1, 32)
        pres.Close()
        shutil.copy2(out_path1, out_path2)
        print(f"Tamamlandı: {out_name}")
    except Exception as e:
        print(f"Hata ({f}): {e}")

try:
    ppt.Quit()
except Exception:
    pass

print("TÜM_ISLEMLER_TAMAM")
