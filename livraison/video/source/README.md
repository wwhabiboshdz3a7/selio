# Vidéo « Et si une appli centralisait tout ? »

Source de la vidéo réseaux sociaux de Selio (35 s, 1080 × 1920, 30 i/s). Tout est généré en code :
l'image par une page HTML animée image par image dans Chromium (scène 3D, flou de mouvement par sous-images),
le son par synthèse (aucun échantillon extérieur).

| Fichier | Rôle |
| --- | --- |
| `build.mjs` | Timeline (sous-titres karaoké, fenêtres d'applis, notifications, écrans, caméra, cartes, bruitages) et page `scene.html` |
| `engine.js` | Moteur d'animation : `seek(t)` place chaque élément à l'instant `t` |
| `render.mjs` | Rendu des sous-images (`frames/`) ou d'images de contrôle (`stills/`) |
| `audio.py` | Musique (120 BPM) et bruitages : `music.wav`, `sfx.wav`, `mix.wav` |
| `encode.sh` | Flou de mouvement (moyenne de 8 sous-images), MP4 H.264 + AAC, volume normalisé (LUFS) |
| `srt.mjs` | Sous-titres de la voix off au format SRT |
| `capture.mjs`, `measure.mjs`, `decorate.mjs` | Captures pleine page de la démo (mode sombre) et positions des éléments mis en avant |
| `ecrans/` | Captures utilisées (recadrées en bas à la partie montrée) |
| `logos/` | Logos Simple Icons (licence CC0) ; Excel, ChatGPT, calculatrice, photos, notes et point relais sont des icônes génériques dessinées dans `build.mjs` |

## Refaire la vidéo

Depuis ce dossier, après `pnpm install` à la racine du dépôt (Node 22, Python 3 avec numpy, ffmpeg) :

```bash
node build.mjs                     # scene.html + timeline.json
node render.mjs frames 30 - 4      # sous-images, 4 pages Chromium en parallèle (une dizaine de minutes)
python3 audio.py                   # music.wav, sfx.wav, mix.wav
./encode.sh mix.wav ../Selio-video-35s.mp4 -14
./encode.sh sfx.wav ../Selio-video-35s-bruitages-seuls.mp4 -16
node srt.mjs ../Selio-video-35s.srt
```

`node render.mjs stills 3.6,12.9,26.2` rend quelques images de contrôle, et `RANGE=13.8,16.8` limite le rendu à un extrait.
Si Chromium n'est pas celui de Playwright, indiquer son chemin dans `CHROMIUM_PATH`.

Pour refaire les captures : servir la démo (`demo/` de la branche `demo`), puis
`node capture.mjs http://127.0.0.1:8899 ecrans ./decorate.mjs`. Les positions mises en avant (`POPS`, `TAPS`, `SCROLL`)
se relisent avec `node measure.mjs http://127.0.0.1:8899 ./decorate.mjs`.

Pour changer un texte, un temps, une fenêtre ou une couleur : modifier `CAPS`, `WINS`, `NOTIFS`, `FCHIPS` ou `SFX` dans
`build.mjs`, puis relancer les commandes ci-dessus.
