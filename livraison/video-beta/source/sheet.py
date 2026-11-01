"""Planche-contact des images de contrôle : python3 -I sheet.py stills sortie.png [colonnes] [largeur]"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

src, out = Path(sys.argv[1]), sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 8
tw = int(sys.argv[4]) if len(sys.argv) > 4 else 270
th = tw * 1920 // 1080
files = sorted(src.glob("*.jpg"))
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 22)), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 22)
    sheet.paste(im, (x, y + 22))
    d.text((x + 6, y + 5), f.stem, fill=(255, 230, 120))
sheet.save(out)
print(out, sheet.size)
