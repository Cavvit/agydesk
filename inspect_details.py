import zipfile
import xml.etree.ElementTree as ET
import glob
import fitz

print("=================== 1. ELEKTRİK MAKİNALARI LAB ===================")
files = glob.glob('G:/Drive*/Dönem 7/Elektrik Makinaları Lab/*.xlsx')
with zipfile.ZipFile(files[0]) as z:
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
            text = ''.join([t.text for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t') if t.text])
            shared_strings.append(text)
    
    stree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    for r in list(range(1, 15)) + [8]:
        # print rows 1 to 15 to see headers, groups, dates
        for row in stree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
            if int(row.attrib.get('r')) in range(1, 15):
                cells = []
                for c in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                    val = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                    v_str = val.text if val is not None else ''
                    if c.attrib.get('t') == 's' and v_str.isdigit():
                        v_str = shared_strings[int(v_str)]
                    cells.append(f"{c.attrib.get('r')}:{v_str}")
                print(f"R{row.attrib.get('r')}: " + " | ".join(cells))
            break
        break

print("\n--- Rows 1..15 full dump ---")
with zipfile.ZipFile(files[0]) as z:
    stree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    for row in stree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
        r_num = int(row.attrib.get('r'))
        if r_num <= 15:
            cells = []
            for c in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                val = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                v_str = val.text if val is not None else ''
                if c.attrib.get('t') == 's' and v_str.isdigit():
                    v_str = shared_strings[int(v_str)]
                cells.append(f"{c.attrib.get('r')}: {v_str}")
            print(f"Row {r_num}: " + " | ".join(cells))

print("\n=================== 2. HABERLEŞME LAB ===================")
hab_file = glob.glob('G:/Drive*/Dönem 7/Haberleşme Lab/Haberleşme LABORATUVARI 14 00-16 00 DENEY DAĞILIMI.pdf')[0]
doc = fitz.open(hab_file)
for pno in range(len(doc)):
    print(f"--- Haberleşme Sayfa {pno+1} ---")
    print(doc[pno].get_text())

print("\n=================== 3. KONTROL LAB ===================")
kon_takvim = glob.glob('G:/Drive*/Dönem 7/Kontrol Lab/Takvim2026_kopyası.pdf')[0]
doc = fitz.open(kon_takvim)
for pno in range(len(doc)):
    print(f"--- Kontrol Takvim Sayfa {pno+1} ---")
    print(doc[pno].get_text())
