# Vidéo « Et si une appli centralisait tout ? »

Source de la vidéo réseaux sociaux de Selio (35 s, 1080 × 1920, 30 i/s). Tout est généré en code :
l'image par une page HTML animée image par image dans Chromium, le son par synthèse (aucun échantillon extérieur).

| Fichier | Rôle |
| --- | --- |
| `build.mjs` | Timeline (sous-titres karaoké, logos, compteur, écrans, caméra, bruitages) et page `scene.html` |
| `engine.js` | Moteur d'animation : `seek(t)` place chaque élément à l'instant `t` |
| `render.mjs` | Rendu des images (`frames/`) ou d'images de contrôle (`stills/`) |
| `audio.py` | Musique (120 BPM) et bruitages : `music.wav`, `sfx.wav`, `mix.wav` |
| `encode.sh` | Assemblage MP4 (H.264 + AAC) et volume normalisé (LUFS) |
| `srt.mjs` | Sous-titres de la voix off au format SRT |
| `ecrans/` | Captures iPhone de la démo (mode sombre) |
| `logos/` | Logos Simple Icons (licence CC0) ; Excel, ChatGPT, calculatrice, photos et notes sont des icônes génériques dessinées dans `build.mjs` |

## Refaire la vidéo

Depuis ce dossier, après `pnpm install` à la racine du dépôt (Node 22, Python 3 avec numpy, ffmpeg) :

```bash
node build.mjs                  # scene.html + timeline.json
node render.mjs frames 30 4     # 1 050 images, 4 pages Chromium en parallèle
python3 audio.py                # music.wav, sfx.wav, mix.wav
./encode.sh mix.wav ../Selio-video-35s.mp4 -14
./encode.sh sfx.wav ../Selio-video-35s-bruitages-seuls.mp4 -16
node srt.mjs                    # ../Selio-video-35s.srt
```

`node render.mjs stills 3.6,12.9,26.2` rend quelques images de contrôle. Si Chromium n'est pas celui de Playwright,
indiquer son chemin dans `CHROMIUM_PATH`.

Pour changer un texte, un temps, un logo ou une couleur : modifier `CAPS`, `TILES`, `SFX` ou les couleurs dans `build.mjs`,
puis relancer les commandes ci-dessus.
