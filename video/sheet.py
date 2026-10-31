"""Planche-contact des images fixes rendues : python3 -I sheet.py out/stills out/sheet.png [cols] [tile_w]"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 3
tw = int(sys.argv[4]) if len(sys.argv) > 4 else 640
th = tw * 9 // 16
files = sorted(f for f in os.listdir(src) if f.endswith(".png"))
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 26)), (18, 18, 18))
try:
    font = ImageFont.load_default(size=16)
except TypeError:
    font = ImageFont.load_default()
draw = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(src, f)).convert("RGB").resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 26)
    sheet.paste(im, (x, y + 26))
    draw.text((x + 8, y + 5), f.replace("t_", "t = ").replace(".png", " s"), fill=(235, 235, 235), font=font)
sheet.save(out)
print(out, sheet.size)
