# Publicités Selio : sources

Tout est produit en code : pages HTML rendues par Chromium (Playwright), photos de démonstration du dépôt
(`apps/web/public/demo/photos`), vraies captures de l'application (`livraison/video/source/ecrans`), logo de `brand/`.
Le jean du concept B est dessiné en SVG (`jean.mjs`), sans logo de marque. Réalisé par Ibrahim.

| Fichier | Rôle |
| --- | --- |
| `commun.mjs` | Chemins, couleurs et styles de la marque, composants (recadrage de capture, anneau de note, icônes), rendu en image |
| `concepts.mjs` | Les 4 concepts : titres, sous-titres, scènes (`tall`, `wide`, `focus`) et petits visuels des bannières (`rect`, `sky`) |
| `jean.mjs` | Les quatre photos d'exemple du jean (face, dos, étiquette, mètre ruban) |
| `build.mjs` | Formats et mises en page ; écrit `../visuels/` (Meta, Google Display, bannières, logos) |
| `textes.mjs` | Tous les textes (Meta, Instagram, Google Search, extensions, Performance Max), vérification des longueurs, écrit `../textes.md` et `../google-ads-editeur.csv` |
| `videos.mjs` | Versions 16:9 des vidéos verticales de `livraison/video/` → `../videos/` |
| `pdf.mjs` | `../Selio-publicites.pdf` (planches, textes clés, plan) |

## Régénérer

Node 22 et Playwright (`npm i -g playwright` ou celui de `/opt/node-tools`), ffmpeg pour les vidéos.
Si Chromium n'est pas celui de Playwright, indiquer son chemin dans `CHROMIUM_PATH`.

```bash
node textes.mjs          # vérifie les longueurs (sort en erreur si une limite est dépassée), écrit textes.md et le CSV
node build.mjs           # 52 visuels en une dizaine de secondes ; « node build.mjs studio » ou « node build.mjs 300x250 » pour une partie
node videos.mjs          # 3 vidéos 16:9 (environ 2 minutes)
node pdf.mjs             # le PDF, après les deux premières commandes
```

Pour changer un texte de visuel : `concepts.mjs` ; un texte d'annonce : `textes.mjs` (puis relancer) ; une taille ou une
mise en page : `build.mjs`. Les bannières Google sont gardées sous 150 Ko (qualité JPEG abaissée automatiquement si besoin).
