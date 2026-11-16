import fitz, glob

files = glob.glob('G:/Drive*/Dönem 7/Haberleşme Lab/*.pdf')
for f in files:
    print("FILE:", f)
    doc = fitz.open(f)
    print("Pages:", len(doc))
    for pno in range(min(5, len(doc))):
        text = doc[pno].get_text()
        for line in text.split('\n')[:15]:
            if line.strip():
                print(f"  P{pno+1}: {line.strip()}")

print("\n--- Kontrol Lab PDF listesi ---")
kfiles = glob.glob('G:/Drive*/Dönem 7/Kontrol Lab/*.pdf')
for k in kfiles:
    print("KONTROL FILE:", k)
