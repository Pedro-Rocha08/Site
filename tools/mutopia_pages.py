# Uso: python3 tools/mutopia_pages.py . /tmp/pdfs
# Baixa o PDF (A4) de cada peça com MIDI local e gera imagens leves das páginas
# (PNG de 4 tons de cinza, ~100 dpi) em assets/mutopia/pages/<id>/<n>.png.
# Depois grava o número de páginas no índice data/mutopia.json (campo "pages").
import json, os, sys, time, glob, subprocess, urllib.request
from PIL import Image
site, tmp = sys.argv[1], sys.argv[2]
FTP = 'https://www.mutopiaproject.org/ftp/'
idx_path = os.path.join(site, 'data/mutopia.json')
idx = json.load(open(idx_path))
fields = idx['fields']
if 'pages' not in fields: fields.append('pages')
PI = fields.index('pages')
os.makedirs(tmp, exist_ok=True)
for it in idx['items']:
    while len(it) <= PI: it.append(0)
    if it[9] != 1 or not it[7] or not it[7].endswith('.pdf'): continue
    out = os.path.join(site, 'assets/mutopia/pages', str(it[0]))
    done = sorted(glob.glob(os.path.join(out, '*.png')))
    if done: it[PI] = len(done); continue
    pdf = os.path.join(tmp, '%d.pdf' % it[0])
    if not os.path.exists(pdf):
        for a in range(3):
            try:
                b = urllib.request.urlopen(FTP + it[7], timeout=60).read()
                if b[:4] == b'%PDF': open(pdf, 'wb').write(b)
                break
            except Exception: time.sleep(3)
        time.sleep(0.25)
    if not os.path.exists(pdf): continue
    pre = os.path.join(tmp, 'r%d' % it[0])
    subprocess.run(['pdftoppm', '-r', '100', '-gray', '-png', pdf, pre], check=False)
    pngs = sorted(glob.glob(pre + '*.png'), key=lambda f: int(f.rsplit('-', 1)[1].split('.')[0]))
    if not pngs: continue
    os.makedirs(out, exist_ok=True)
    for n, f in enumerate(pngs, 1):
        im = Image.open(f).convert('L').quantize(colors=4, dither=Image.Dither.NONE)
        im.save(os.path.join(out, '%d.png' % n), 'PNG', optimize=True)
        os.remove(f)
    it[PI] = len(pngs)
    print(it[0], len(pngs), flush=True)
json.dump(idx, open(idx_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print('ok')
