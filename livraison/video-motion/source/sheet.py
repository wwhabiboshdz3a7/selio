"""Planche de contrôle : python3 -I sheet.py <préfixe> → stills/_sheet-<préfixe>.jpg"""
import glob, sys
from PIL import Image
pre = sys.argv[1]
ims = [Image.open(f) for f in sorted(glob.glob(f"stills/{pre}-[0-9]*.jpg"))]
h = 640
ims = [i.resize((int(i.width * h / i.height), h)) for i in ims]
cols = min(len(ims), 8 if ims[0].width < h else 4)
W = ims[0].width
s = Image.new("RGB", (cols * W, -(-len(ims) // cols) * h), "#555")
for n, i in enumerate(ims):
    s.paste(i, ((n % cols) * W, (n // cols) * h))
s.save(f"stills/_sheet-{pre}.jpg", quality=82)
