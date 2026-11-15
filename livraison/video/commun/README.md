# Chaîne commune des vidéos courtes

Reprise du moteur de la vidéo « Et si une appli centralisait tout ? » (`../source`) pour les vidéos par filiale
(`../studio/source`, `../bot/source`, `../track/source`). Tout est généré en code : image animée dans Chromium,
musique et bruitages synthétisés (aucun échantillon extérieur, aucun droit à payer).

| Fichier | Rôle |
| --- | --- |
| `page.mjs` | Assemble `scene.html` et `timeline.json` : polices Inter, fond, logo + nom de la filiale, bouton final, sous-titres |
| `moteur.js` | `seek(t)` : fond, éclats, grain, sous-titres karaoké, logo, bouton ; appelle `drawScene(t)` de la vidéo |
| `render.mjs` | Rendu des sous-images (`frames/`, 8 par image sur les passages rapides `TL.FAST`) ou d'images de contrôle (`stills/`) |
| `encode.sh` | Flou de mouvement, MP4 H.264 + AAC, volume normalisé (LUFS) |
| `srt.mjs` | Sous-titres SRT tirés de la timeline |
| `sons.py` | Instruments, groove à 120 BPM paramétrable, bruitages |

Chaque dossier `source` d'une vidéo contient `build.mjs` (timeline, textes, HTML), `scene.js` (animation propre à la vidéo)
et `audio.py` (réglage de la musique). Les commandes se lancent depuis ce dossier `source` :

```bash
node build.mjs
node ../../commun/render.mjs stills 2.5,11.9        # images de contrôle
node ../../commun/render.mjs frames 30 - 4           # environ 5 minutes
python3 audio.py
../../commun/encode.sh mix.wav ../../Selio-<Nom>-<durée>.mp4 -14
node ../../commun/srt.mjs ../../Selio-<Nom>-<durée>.srt
```

Si le Chromium de Playwright manque, indiquer celui de la machine : `CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.
