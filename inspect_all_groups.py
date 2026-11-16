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
            cell_ref = c.attrib.get('r')
            col_letter = ''.join([ch for ch in cell_ref if ch.isalpha()])
            val = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
            v_str = val.text if val is not None else ''
            if c.attrib.get('t') == 's' and v_str.isdigit():
                v_str = shared_strings[int(v_str)]
            row_dict[col_letter] = v_str
        rows[r_num] = row_dict

print("Row 1..3 details:")
for r in [1, 2, 3]:
    print(r, rows.get(r))

print("\nAll headers / date rows for other groups:")
for r in [5, 9, 13, 17, 21, 25]:
    if r in rows:
        print(f"Row {r} (Group {rows[r].get('A')}): F={rows[r].get('F')}, G={rows[r].get('G')}, H={rows[r].get('H')}, I={rows[r].get('I')}, J={rows[r].get('J')}, K={rows[r].get('K')}")

print("\nLet's check columns O..U for all groups:")
for r in sorted(rows.keys()):
    if rows[r].get('O'):
        print(f"Row {r}: O={rows[r].get('O')} P={rows[r].get('P')} Q={rows[r].get('Q')} R={rows[r].get('R')} S={rows[r].get('S')} T={rows[r].get('T')} U={rows[r].get('U')}")
