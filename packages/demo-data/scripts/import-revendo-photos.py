#!/usr/bin/env python3
"""
Importe les vraies photos d'annonces Vinted du dépôt « revendo » dans la démo Selio.

Sources (dépôt revendo, branche principale et historique git) :
  - status/<id>.json : une miniature JPEG (120×160) + titre, marque, catégorie, prix de chaque annonce ;
  - jobs/<compte>/<id>/NN.jpg : galeries en pleine définition encore présentes dans l'historique.

Sorties :
  - apps/web/public/demo/photos/*.webp (photos recompressées, servies par le site) ;
  - packages/demo-data/src/catalog.generated.ts (catalogue typé utilisé par la démo).

Aucun nom de compte n'est repris. Les images de marque avec mannequin (photo officielle,
visage d'une personne réelle) sont exclues.

Usage : python3 packages/demo-data/scripts/import-revendo-photos.py /chemin/vers/revendo
"""
import base64
import io
import json
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "apps/web/public/demo/photos"
OUT_TS = ROOT / "packages/demo-data/src/catalog.generated.ts"
URL_PREFIX = "/demo/photos"

# Exclues : photo officielle de marque avec mannequin (droits + visage d'une personne réelle),
# et miniatures d'un article déjà présent (même vêtement que les galeries ou qu'une autre annonce).
EXCLUDE = {"20261002-050434-l6fc", "20261011-102533-xmk6", "20261012-223656-dvmf", "20261011-101730-afln"}

# Titres et couleurs corrigés d'après la photo (la reconnaissance automatique de revendo
# décrit parfois une maille rayée ou à losanges comme unie, ou se trompe de couleur).
TITLE_FIXES = {
    "yaso": ("T-shirt rayé Tommy Hilfiger rose et blanc", "Rose"),
    "lpdt": ("Pull rayé Tommy Hilfiger bleu ciel", "Bleu ciel"),
    "74wo": ("Pull col V rayé Tommy Hilfiger marine et rouge", "Bleu marine"),
    "xn51": ("Pull col V à losanges rouge et marine", "Rouge"),
    "nywk": ("Pull rayé Tommy Hilfiger beige", "Beige"),
    "qzbq": ("Pull col V à losanges abricot", "Abricot"),
    "i0f8": ("Pull col V rayé Tommy Hilfiger blanc et bordeaux", "Blanc"),
    "xhzr": ("Blouse ¾ rayée Nautica noir et blanc", "Noir"),
    "3ylv": ("Cardigan à fleurs Tommy Hilfiger marine", "Bleu marine"),
    "s33t": ("Sweat à col V rayé Tommy Hilfiger gris", "Gris"),
    "z815": ("Polo rayé Tommy Hilfiger marine et rouge", "Bleu marine"),
    "n5g4": ("Pull rayé marine et blanc", "Bleu marine"),
    "qeub": ("Pull col V à losanges Tommy Hilfiger marine", "Bleu marine"),
    "gocv": ("Pull col V rayé Tommy Hilfiger fuchsia", "Fuchsia"),
    "9ftg": ("Pull col V bleu canard", "Bleu canard"),
    "xu43": ("Pull rayé orange, jaune et blanc", "Orange"),
    "oyuf": ("Pull col V à losanges Tommy Hilfiger crème", "Crème"),
    "qbnp": ("Haut rayé Tommy Hilfiger gris", "Gris"),
    "hu2a": ("Pull rayé Tommy Hilfiger marine et blanc", "Bleu marine"),
    "ntin": ("Cardigan rayé Tommy Hilfiger marine", "Bleu marine"),
    "nt1r": ("Pull à ancres Tommy Hilfiger gris", "Gris"),
    "cmrz": ("T-shirt uni gris", "Gris"),
    "8mcb": ("Sweat à col V Tommy Hilfiger corail", "Corail"),
    "00gd": ("Pull chiné Tommy Hilfiger rose", "Rose"),
    "nxjw": ("Pull col V à losanges rose et chocolat", "Rose"),
    "ybm9": ("Pull col V à losanges marine et rouge", "Bleu marine"),
    "0r7c": ("Pull col roulé Tommy Hilfiger rose pâle", "Rose"),
}

# Galeries en pleine définition (historique git de revendo) : titre établi d'après les photos.
GALLERIES = {
    "20261007-194513-yw5b": {"title": "Pull à pois Tommy Hilfiger marine", "brand": "Tommy Hilfiger", "category": "Pulls ras de cou", "price": "18", "size": "M", "rayon": "women"},
    "20261008-064028-x4iv": {"title": "Pull torsadé Tommy Hilfiger gris et écru", "brand": "Tommy Hilfiger", "category": "Pulls d'hiver", "price": "18", "size": "XL", "rayon": "men"},
}

COLORS = [
    ("jaune moutarde", "Jaune"), ("bleu marine", "Bleu marine"), ("marine", "Bleu marine"), ("blanc", "Blanc"), ("gris", "Gris"),
    ("rouge", "Rouge"), ("crème", "Crème"), ("écru", "Écru"), ("noir", "Noir"), ("fuchsia", "Fuchsia"), ("abricot", "Abricot"),
    ("corail", "Corail"), ("bordeaux", "Bordeaux"), ("beige", "Beige"),
]


def color_of(title: str) -> str | None:
    t = title.lower()
    for word, label in COLORS:
        if re.search(rf"\b{re.escape(word)}\b", t):
            return label
    return None


def size_of(title: str) -> str | None:
    m = re.search(r"taille\s+(\d+\s*ans|[A-Z]{1,3}\b|\d{2})", title)
    return m.group(1).strip() if m else None


def item_category(vinted_category: str, title: str, index: int) -> str:
    t = f"{vinted_category} {title}".lower()
    if re.search(r"\d+\s*ans", t):
        return "kids"
    if re.search(r"robe|blouse|cardigan", t):
        return "women"
    if re.search(r"polo|sweat", t):
        return "men"
    return "women" if index % 2 == 0 else "men"


def clean_title(title: str) -> str:
    return re.sub(r"\s+taille\s+(\d+\s*ans|[A-Z]{1,3}\b|\d{2})", "", title).strip()


def save_webp(img: Image.Image, name: str, quality: int) -> str:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    img.save(OUT_DIR / f"{name}.webp", "WEBP", quality=quality, method=6)
    return f"{URL_PREFIX}/{name}.webp"


def upscale_thumb(raw: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w = 360
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    return im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))


def fit_full(raw: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w = 800
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) if im.width > w else im


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True).stdout


def main() -> None:
    repo = Path(sys.argv[1]).resolve()
    entries = []

    # 1) Galeries en pleine définition, depuis l'historique git.
    log = git(repo, "log", "--all", "--diff-filter=A", "--format=%H", "--name-only", "--", "jobs/").decode().split("\n")
    commit, files = None, {}
    for line in log:
        if re.fullmatch(r"[0-9a-f]{40}", line):
            commit = line
        elif line.endswith(".jpg") and commit:
            parts = line.split("/")
            if len(parts) == 4 and parts[2] in GALLERIES:
                files.setdefault(parts[2], {})[parts[3]] = (commit, line)
    for job_id, meta in GALLERIES.items():
        photos = []
        for n, (fname, (c, path)) in enumerate(sorted(files.get(job_id, {}).items())):
            photos.append(save_webp(fit_full(git(repo, "show", f"{c}:{path}")), f"g-{job_id[-4:]}-{n + 1}", 68))
        if photos:
            entries.append({"key": f"g-{job_id[-4:]}", "title": meta["title"], "brand": meta["brand"], "vintedCategory": meta["category"], "category": meta["rayon"], "size": meta["size"], "color": color_of(meta["title"]), "priceCents": round(float(meta["price"]) * 100), "photos": photos, "fullSize": True})

    # 2) Miniatures + fiches des annonces traitées (status/*.json).
    for i, f in enumerate(sorted((repo / "status").glob("*.json"))):
        d = json.loads(f.read_text())
        sid = d.get("id") or f.stem
        s = d.get("summary") or {}
        title = (s.get("title") or "").strip()
        if sid in EXCLUDE or not title or not str(d.get("thumb", "")).startswith("data:image"):
            continue
        raw = base64.b64decode(d["thumb"].split(",", 1)[1])
        url = save_webp(upscale_thumb(raw), f"r-{sid[-4:]}", 80)
        fixed_title, fixed_color = TITLE_FIXES.get(sid[-4:], (clean_title(title), None))
        entries.append({
            "key": f"r-{sid[-4:]}",
            "title": fixed_title,
            "brand": (s.get("brand") or "").strip() or None,
            "vintedCategory": (s.get("category") or "").strip(),
            "category": item_category(s.get("category") or "", title, i),
            "size": size_of(title),
            "color": fixed_color or color_of(title),
            "priceCents": round(float(str(s.get("price") or "18").replace(",", ".")) * 100),
            "photos": [url],
            "fullSize": False,
        })

    body = json.dumps(entries, ensure_ascii=False, indent=2)
    OUT_TS.write_text(
        "// Fichier généré par packages/demo-data/scripts/import-revendo-photos.py — ne pas modifier à la main.\n"
        "// Vraies annonces Vinted (photos et fiches issues du dépôt revendo), sans nom de compte.\n"
        'import type { ItemCategory } from "@selio/contracts";\n\n'
        "export interface CatalogEntry {\n  key: string;\n  title: string;\n  brand: string | null;\n  vintedCategory: string;\n  category: ItemCategory;\n  size: string | null;\n  color: string | null;\n  priceCents: number;\n  photos: string[];\n  /** Galerie complète en pleine définition (sinon : miniature agrandie). */\n  fullSize: boolean;\n}\n\n"
        f"export const REAL_CATALOG: CatalogEntry[] = {body};\n"
    )
    total = sum(p.stat().st_size for p in OUT_DIR.glob("*.webp"))
    print(f"{len(entries)} annonces, {sum(len(e['photos']) for e in entries)} photos, {total // 1024} Ko")


if __name__ == "__main__":
    main()
