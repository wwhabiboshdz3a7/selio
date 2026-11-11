# Série motion design Selio — 14 vidéos courtes

Même direction artistique que les spots de 45 s et 80 s (`livraison/video-pub`, `livraison/video-beta`) : fond encre et
améthyste, Inter, sous-titres karaoké avec mots-clés en or, logo blanc, vrais écrans de la démo en mode sombre dans un
iPhone, pastilles flottantes, bouton « Rejoins la bêta fermée ». Une vidéo par module, plus des films de marque
déclinés en 9:16, 16:9 et 1:1. H.264, 30 i/s, AAC à −14 LUFS.

| Vidéo | Sujet | Formats |
| --- | --- | --- |
| `01-logo` | Anneau d'or, logo, promesse | 9:16, 16:9, 1:1 |
| `02-des-heures` | « Tu passes encore des heures… » + chrono | 9:16, 16:9, 1:1 |
| `03-track` | Revente moyenne et prix d'achat maximum | 9:16 |
| `04-radar` | Recherche, note sur 100, alerte, vrai bénéfice | 9:16 |
| `05-controle` | Contrôle à la réception | 9:16 |
| `06-studio` | Photos, annonce qui s'écrit, publication | 9:16 |
| `07-dressing` | Note sur 100 par annonce | 9:16 |
| `08-negociation` | Contre-offre et prix plancher | 9:16 |
| `09-automatisation` | Favoris, réponses, après-vente | 9:16 |
| `10-commandes` | Bordereaux et export | 9:16 |
| `11-analyses` | Marges au centime près | 9:16 |
| `12-neuf-applis` | « Combien d'applis tu ouvres… » | 9:16, 16:9, 1:1 |
| `13-ecosysteme` | Trouve. Publie. Négocie. Encaisse. | 9:16 |
| `14-pepite` | Le pull repéré à 4,00 € | 9:16 |
| `00-showreel` | Les 14 vidéos verticales à la suite | 9:16 |

Les textes reprennent les sous-titres validés des trois spots existants ; les chiffres sont ceux des écrans de la démo
(pull Tommy Hilfiger à pois). Les écrans viennent de `../../video-beta/source/ecrans` (captures réelles et maquettes
dans la charte, voir le README de ce dossier). Pas de voix off.

## Fabrication

```bash
cd livraison/video-motion/source
npm install                 # Inter
node render.cjs             # tout rendre dans livraison/video-motion/
node render.cjs 08          # une seule vidéo (filtre sur l'id)
node render.cjs --fmt 16x9  # un seul format
node render.cjs --stills 04 && python3 -I sheet.py Selio-motion-04-radar-9x16   # planche de contrôle
```

Nécessite Node, Playwright (Chromium), ffmpeg, Python 3 avec numpy et Pillow. Aperçu en temps réel :
`player.html?v=04-radar&fmt=9x16&play=1`.

- `engine.js` : moteur déterministe `seek(t)`, sous-titres (`caps`), iPhone (`phone`), pastilles (`fchip`),
  mises en avant (`hl`, `ck`, `bd`), notification, cartons de fin. Chaque élément déclare aussi son bruitage.
- `videos/modules.js`, `videos/marque.js` : le déroulé de chaque vidéo (textes, instants, défilements).
- `audio.py` : musique et bruitages synthétisés (instruments repris du spot de 80 s, aucun échantillon tiers).
- `render.cjs` : capture image par image, encodage, mixage.
