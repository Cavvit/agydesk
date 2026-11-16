import zipfile, xml.etree.ElementTree as ET, glob, datetime

files = glob.glob('G:/Drive*/Dönem 7/Elektrik Makinaları Lab/*.xlsx')
with zipfile.ZipFile(files[0]) as z:
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
            text = ''.join([t.text for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t') if t.text])
            shared_strings.append(text)

    stree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    rows = {}
    for row in stree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData/{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
        r_num = int(row.attrib.get('r'))
        row_dict = {}
        for c in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
            cell_ref = c.attrib.get('r') # e.g. A5
            col_letter = ''.join([ch for ch in cell_ref if ch.isalpha()])
            val = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
            v_str = val.text if val is not None else ''
            if c.attrib.get('t') == 's' and v_str.isdigit():
                v_str = shared_strings[int(v_str)]
            row_dict[col_letter] = v_str
        rows[r_num] = row_dict

print("Row 4 (Headers):", rows.get(4))
print("Row 5 (G1 data):", rows.get(5))
print("Row 6:", rows.get(6))
print("Row 7:", rows.get(7))
print("Row 8 (Cavit):", rows.get(8))
print("Row 9 (G2 data):", rows.get(9))

def excel_date(num):
    try:
        # Excel base date is 1899-12-30
        d = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(num)))
        return d.strftime('%d.%m.%Y')
    except:
        return str(num)

def excel_time(num):
    try:
        val = float(num) * 24
        hours = int(val)
        mins = int(round((val - hours) * 60))
        return f"{hours:02d}:{mins:02d}"
    except:
        return str(num)

print("\n--- Tarih ve Saatler Çözümü ---")
for col in ['F', 'G', 'H', 'I', 'J', 'K']:
    d_val = rows[5].get(col)
    exp_name = rows[4].get(col)
    print(f"Deney: {exp_name} (Col {col}) -> Excel date raw: {d_val} -> {excel_date(d_val)}")

print("\n--- G1 Saatleri (Row 5 O..U) ---")
for col in ['P', 'Q', 'R', 'S', 'T', 'U']:
    t_val = rows[5].get(col)
    exp_col = {'P':'F', 'Q':'G', 'R':'H', 'S':'I', 'T':'J', 'U':'K'}[col]
    print(f"G1 Deney: {rows[4].get(exp_col)} -> Excel time raw: {t_val} -> {excel_time(t_val)}")

print("\n--- Cavit hangi grupta? ---")
# Row 5 has A5=G1. Row 6, 7, 8 have empty A. Row 9 has A9=G2.
# That means Row 5, 6, 7, 8 belong to G1! Let's verify:
for r in range(4, 25):
    if r in rows:
        print(f"R{r}: A='{rows[r].get('A', '')}', B='{rows[r].get('B', '')}', C='{rows[r].get('C', '')}'")
