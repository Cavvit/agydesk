import zipfile
import xml.etree.ElementTree as ET
import glob
import fitz

print("--- 1. Elektrik Makinaları Lab Excel Araştırması ---")
files = glob.glob('G:/Drive*/Dönem 7/Elektrik Makinaları Lab/*.xlsx')
print('Excel files:', files)
if files:
    with zipfile.ZipFile(files[0]) as z:
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                text = ''.join([t.text for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t') if t.text])
                shared_strings.append(text)
        
        for i, s in enumerate(shared_strings):
            if any(k in s.lower() for k in ['cavit', 'özgen', 'ozgen']):
                print(f"Matched string [{i}]: {s}")

        for sf in [f for f in z.namelist() if f.startswith('xl/worksheets/sheet')]:
            stree = ET.fromstring(z.read(sf))
            for row in stree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
                r_idx = row.attrib.get('r')
                row_items = []
                match = False
                for c in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                    val = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                    v_str = val.text if val is not None else ''
                    if c.attrib.get('t') == 's' and v_str.isdigit():
                        v_str = shared_strings[int(v_str)]
                    if any(k in str(v_str).lower() for k in ['cavit', 'özgen', 'ozgen']):
                        match = True
                    row_items.append(f"{c.attrib.get('r')}:{v_str}")
                if match:
                    print(f"Sheet {sf} Row {r_idx}: " + " | ".join(row_items))

print("\n--- 2. Haberleşme Lab PDF Araştırması ---")
hab_pdfs = glob.glob('G:/Drive*/Dönem 7/Haberleşme Lab/*.pdf')
for hp in hab_pdfs:
    try:
        doc = fitz.open(hp)
        for pno in range(len(doc)):
            text = doc[pno].get_text()
            if any(k in text.lower() for k in ['cavit', 'özgen', 'ozgen']):
                print(f"Match in {hp} page {pno+1}")
                lines = [l for l in text.split('\n') if any(k in l.lower() for k in ['cavit', 'özgen', 'ozgen', 'grup', 'tarih', 'deney'])]
                print("   Snippet:", lines[:10])
    except Exception as e:
        print(f"Error reading {hp}: {e}")

print("\n--- 3. Kontrol Lab PDF Araştırması ---")
kon_pdfs = glob.glob('G:/Drive*/Dönem 7/Kontrol Lab/*.pdf')
for kp in kon_pdfs:
    try:
        doc = fitz.open(kp)
        for pno in range(len(doc)):
            text = doc[pno].get_text()
            if any(k in text.lower() for k in ['cavit', 'özgen', 'ozgen']):
                print(f"Match in {kp} page {pno+1}")
                lines = [l for l in text.split('\n') if any(k in l.lower() for k in ['cavit', 'özgen', 'ozgen', 'grup', 'tarih', 'deney'])]
                print("   Snippet:", lines[:10])
    except Exception as e:
        print(f"Error reading {kp}: {e}")
