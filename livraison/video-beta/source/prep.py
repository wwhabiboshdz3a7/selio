"""Prépare les écrans réels de la vidéo bêta à partir des captures pleine page (captures/*-full.png, voir capture.mjs) :
pages recadrées à la hauteur utile (ecrans/page-*.png). Les maquettes (ecrans/page-<id>.png des pages de mocks/mocks.html)
sont rendues par mocks/mocks.mjs ; les vignettes du carrousel final (ecrans/thumb-*.jpg) viennent du spot de 45 s."""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC, OUT = HERE / "captures", HERE / "ecrans"
OUT.mkdir(exist_ok=True)
PAGES = {"studio": 5985, "autohub": 8000, "orders": 3663, "analytics": 3000}  # hauteur utile (défilement max + un écran)

for pid, h in PAGES.items():
    im = Image.open(SRC / f"{pid}-full.png").convert("RGB")
    im.crop((0, 0, im.width, min(h, im.height))).save(OUT / f"page-{pid}.png", optimize=True)
print("ok", sorted(p.name for p in OUT.iterdir()))
