"""Prépare les écrans de la vidéo à partir des captures pleine page (captures/*-full.png, voir capture.mjs) :
pages recadrées à la hauteur utile (ecrans/page-*.png) et vignettes du carrousel final (ecrans/thumb-*.jpg)."""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC, OUT = HERE / "captures", HERE / "ecrans"
OUT.mkdir(exist_ok=True)
SCREEN_H = 2556  # hauteur d'un écran d'iPhone 15 Pro en px de capture (852 × 3)
PAGES = {"radar": 13300, "studio": 4600, "nego": 3213, "autohub": 3700, "analytics": 3400}
THUMBS = {"overview": 0, "radar": 4560, "studioann": 0, "nego": 0, "autohub": 700, "analytics": 900, "dressing": 0, "cloud": 0}

for pid, h in PAGES.items():
    im = Image.open(SRC / f"{pid}-full.png").convert("RGB")
    im.crop((0, 0, im.width, min(h, im.height))).save(OUT / f"page-{pid}.png", optimize=True)
for pid, y in THUMBS.items():
    im = Image.open(SRC / f"{pid}-full.png").convert("RGB")
    # la barre d'état et l'en-tête restent en haut de chaque vignette
    top = im.crop((0, 0, im.width, 330))
    body = im.crop((0, y + 330 if y else 330, im.width, (y or 0) + SCREEN_H))
    card = Image.new("RGB", (im.width, SCREEN_H), (26, 24, 32))
    card.paste(top, (0, 0))
    card.paste(body, (0, 330))
    card.resize((560, round(560 * SCREEN_H / im.width)), Image.LANCZOS).save(OUT / f"thumb-{pid}.jpg", quality=90)
print("ok", sorted(p.name for p in OUT.iterdir()))
