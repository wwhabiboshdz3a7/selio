# Selio — vidéos motion design

Vidéos animées aux couleurs de Selio (bleu `#204868`, Playfair Display + Source Sans 3, logo chevrons).
Tout est du code : chaque vidéo est une suite de scènes HTML/CSS, rendue image par image puis encodée en MP4
(H.264, 30 i/s, sans son). Les fichiers prêts à publier sont dans `out/`.

## Les vidéos

| Fichier | Sujet | Formats |
|---|---|---|
| `01-logo-reveal` | Animation du logo + signature | 9:16, 16:9, 1:1 |
| `02-manifeste` | Film de marque « Votre dressing dort » | 9:16, 16:9, 1:1 |
| `03-vendre-en-3-etapes` | Photos → description et prix → publication | 9:16 |
| `04-acheter` | Recherche, filtres, annonces, favori | 9:16 |
| `05-coup-de-coeur` | Favori puis messagerie avec le vendeur | 9:16 |
| `06-pro-tableau-de-bord` | Selio Pro : vue d'ensemble (ventes, CA, marge, stock) | 9:16 |
| `07-automatisations` | Les 5 règles + exécution toutes les 15 minutes | 9:16 |
| `08-negociation-auto` | Négociation automatique selon la remise autorisée | 9:16 |
| `09-favori-et-relance` | Message à la mise en favori + relance | 9:16 |
| `10-ventes-export-excel` | Ventes, marge, export XLSX | 9:16 |
| `11-dressing-et-stock` | Suivi d'inventaire : en stock → en vente → vendu | 9:16 |
| `12-communaute` | Espaces et classement des vendeurs | 9:16 |
| `13-ecran-accueil` | Installation sur l'écran d'accueil (PWA) | 9:16 |
| `14-seconde-vie` | Film « seconde vie » (mode responsable) | 9:16, 16:9, 1:1 |
| `00-showreel` | Montage de toutes les vidéos verticales | 9:16 |

Les articles, prénoms et chiffres affichés sont des **données de démonstration**. Les vidéos ne montrent que
des fonctions qui existent dans l'app (pas de paiement, pas de connexion Vinted, pas d'app sur les stores).

## Modifier ou refaire un rendu

```
cd motion
npm install            # polices de la charte
node render.cjs        # tout rendre dans out/
node render.cjs 07     # seulement les vidéos dont l'id contient « 07 »
node render.cjs --fmt 16x9
node render.cjs --stills 03   # images de contrôle dans out/_stills
```

Nécessite Node, Playwright (Chromium) et ffmpeg. Pour prévisualiser en temps réel, ouvrir
`src/player.html?v=03-vendre-en-3-etapes&fmt=9x16&play=1` dans Chrome.

- `src/engine.js` : timeline (`seq`, `an`, `words`, compteurs, saisie de texte), logo, icônes, vêtements dessinés en SVG, carton de fin.
- `src/style.css` : charte, composants d'interface, animations.
- `src/videos/*.js` : les textes et le déroulé de chaque vidéo (c'est là qu'on change un slogan ou une durée).
