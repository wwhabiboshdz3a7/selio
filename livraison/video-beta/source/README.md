# Vidéo « Rejoins la bêta fermée » — 80 s, 1080 × 1920 (vertical)

Vidéo de présentation de Selio aux revendeurs Vinted, construite sur le script en 12 étapes (fil conducteur : le pull
Tommy Hilfiger femme à pois). Même direction artistique et même chaîne de fabrication que le spot de 45 s
(`livraison/video-pub`) : fond encre et améthyste, Inter, sous-titres karaoké, logo en anneau d'or, vrais écrans de la
démo en mode sombre dans un iPhone. Pas de voix off (aucune synthèse vocale disponible) : les 12 phrases clés sont à
l'image en karaoké et dans le fichier `.srt`, prêtes à être enregistrées.

## Ce qui est réel et ce qui est maquetté

| Étape | Écran | Origine |
| --- | --- | --- |
| 5 Studio, dépôt · 10 Automatisation · 11 Commandes et Analyses | pages de la démo (`/studio`, `/app/automatisation`, `/app/orders`, `/app/analytics`) | capture réelle (`capture.mjs`) |
| 2 Track · 3 Radar (réglages, affaire, annonce) · 4 Contrôle · 6 Studio annonce · 7 Publication · 8 Dressing · 9 Négociation | `mocks/mocks.html` | maquettes dans la charte Selio, rendues par `mocks/mocks.mjs` |

Les écrans « type Vinted » (annonce, annonce publiée, dressing) sont des maquettes neutres, sans logo ni couleurs de la
plateforme. Tous les chiffres sont des exemples. Les cochages du contrôle, le titre qui s'écrit, les notes du dressing,
les favoris, la négociation, les bordereaux et l'export sont des superpositions animées (`OVERLAYS` dans `build.mjs`).

## Fabrication

```bash
cd livraison/video-beta/source
# 1. écrans réels (serveur de prévisualisation de apps/web sur 127.0.0.1:4173) puis recadrage
CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node capture.mjs http://127.0.0.1:4173
python3 -I prep.py
# 2. maquettes → ecrans/page-<id>.png + mocks/boxes.json
CHROMIUM_PATH=... node mocks/mocks.mjs
# 3. timeline + page de rendu, bande son, sous-titres
node build.mjs && python3 -I audio.py && node srt.mjs ../Selio-beta-80s.srt
# 4. contrôle visuel, rendu (8 sous-images par image sur les passages rapides), encodage
CHROMIUM_PATH=... node render.mjs stills 0.6,5.3,17.9,62.3,78.6 && python3 -I sheet.py stills planche.jpg
CHROMIUM_PATH=... node render.mjs frames 30 - 4
./encode.sh mix.wav ../Selio-beta-80s.mp4 -14
```

Fichiers : `build.mjs` (timeline : sous-titres, écrans, défilements, zones mises en avant, superpositions, caméra,
bruitages), `engine.js` (moteur déterministe `seek(t)`), `render.mjs`, `encode.sh` (H.264 + AAC, −14 LUFS),
`audio.py` (musique et bruitages synthétisés, sans échantillon tiers), `srt.mjs`, `capture.mjs`, `prep.py`,
`mocks/`, `ecrans/` (écrans et vignettes du carrousel final).

## Pour la vraie version

- Voix off : enregistrer les 30 lignes du `.srt` (mêmes instants que le karaoké) et les mixer dans `encode.sh`
  (le spot de 45 s montre le câblage).
- Lien de la bêta : le bouton dit « Rejoins la bêta fermée » et « Lien en bio » tient lieu de [LIEN] ; remplacer dans
  `build.mjs` (`#bio`) par l'adresse réelle le jour où elle existe.
- Si une maquette devient un vrai écran, le capturer avec `capture.mjs` et le substituer dans `PAGES`.
