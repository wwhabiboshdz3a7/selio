# Spot « Ce pull, trouvé à 3,50 € »

Spot publicitaire de Selio pour les réseaux (45 s, 1080 × 1920, 30 i/s). Même direction artistique et même chaîne de
production que la vidéo « Et si une appli centralisait tout ? » (`livraison/video/`) : fond encre et lueur améthyste,
Inter, sous-titres karaoké avec mots clés en or, révélation du logo en anneau d'or, vrais écrans de la démo en mode
sombre dans un iPhone. Tout est généré en code : l'image par une page HTML animée image par image dans Chromium
(flou de mouvement par sous-images), le son par synthèse (aucun échantillon extérieur).

## Le film

| Temps | Acte | Ce qu'on voit |
| --- | --- | --- |
| 0 – 6 s | Accroche | L'affaire « Exceptionnelle » du Radar : 3,50 € → revente estimée 17,99 € → **+10,71 €** de bénéfice, note 99/100. |
| 6 – 8 s | Révélation | Aspiration, onde de choc, logo Selio en anneau d'or : « Voici Selio. » |
| 8 – 16,7 s | Selio Radar | Le Radar note chaque affaire sur 100 avec le vrai bénéfice, l'alerte arrive sur le téléphone, achat validé en un clic. |
| 16,7 – 24 s | Selio Studio | Quatre photos du pull à pois, l'IA rédige l'annonce (titre, marque, taille, état, prix conseillé) ; rien n'est publié sans clic. |
| 24 – 31,2 s | Négociation et automatisations | Offre à 13 € → contre-offre à 17,10 € sans passer sous le prix plancher ; favoris, réponses, après-vente. |
| 31,2 – 34,5 s | Analyses | Chiffre d'affaires et marge brute au centime près. |
| 34,5 – 45 s | Final | « Trouve. Publie. Négocie. Encaisse. », carrousel des écrans, « Une appli. Tout ton business Vinted. », « Rejoins la bêta gratuite », lien en bio. |

Les chiffres, textes et notifications sont ceux de la démo (`/demo`) : affaire « Sweat à col V rayé Tommy Hilfiger gris »
(3,50 €, revente 17,99 €, bénéfice +10,71 €), alerte au format de `opportunityAlertPayload`, conversation `conv-001`.
La mention « Outil indépendant, non affilié à Vinted ni aux marques citées. Chiffres de démonstration. » reste à l'écran
pendant l'appel à l'action. Aucune des promesses écartées par le dossier de stratégie V4 (« zéro risque », « 100 % légal »,
« partenaire Vinted ») n'apparaît ; Radar Auto et Selio Cloud, encore à valider, ne sont pas montrés.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `build.mjs` | Timeline (sous-titres karaoké, chiffres de l'accroche, écrans, caméra, cartes, notification, bruitages) et page `scene.html` |
| `engine.js` | Moteur d'animation : `seek(t)` place chaque élément à l'instant `t` (repris du moteur de la vidéo v2) |
| `render.mjs` | Rendu des sous-images (`frames/`) ou d'images de contrôle (`stills/`) |
| `audio.py` | Musique (120 BPM, instruments de la vidéo v2, arrangement plus percutant) et bruitages : `music.wav`, `sfx.wav`, `mix.wav` |
| `encode.sh` | Flou de mouvement (moyenne de 8 sous-images), MP4 H.264 + AAC, volume normalisé (LUFS) |
| `srt.mjs` | Sous-titres au format SRT |
| `capture.mjs`, `prep.py` | Captures pleine page de la démo (mode sombre, @3x) puis recadrage des pages et vignettes (`ecrans/`) |
| `sheet.py` | Planche-contact des images de contrôle |

## Refaire la vidéo

Depuis ce dossier, après `pnpm install` à la racine du dépôt (Node 22, Python 3 avec numpy et Pillow, ffmpeg) :

```bash
node build.mjs                     # scene.html + timeline.json
node render.mjs frames 30 - 4      # sous-images, 4 pages Chromium en parallèle
python3 audio.py                   # music.wav, sfx.wav, mix.wav
./encode.sh mix.wav ../Selio-pub-45s.mp4 -14
node srt.mjs ../Selio-pub-45s.srt
```

`node render.mjs stills 1.3,3.95,13.75` rend quelques images de contrôle (`python3 sheet.py stills planche.png` pour
une planche-contact), et `RANGE=13,17` limite le rendu à un extrait. Si Chromium n'est pas celui de Playwright,
indiquer son chemin dans `CHROMIUM_PATH`.

Pour refaire les écrans (après une évolution de l'app) : `pnpm --filter @selio/web build && pnpm --filter @selio/web preview`,
puis `node capture.mjs http://127.0.0.1:4173 captures && python3 prep.py`. Les positions mises en avant (`POPS`, `TAPS`,
`FLY`, `SCROLL`) sont en pixels de capture @3x et se relisent dans les captures.

Pour changer un texte, un temps, une carte ou un bruitage : modifier `CAPS`, `NUM`, `FCHIPS`, `ALERT` ou `SFX` dans
`build.mjs`, puis relancer les commandes ci-dessus.
