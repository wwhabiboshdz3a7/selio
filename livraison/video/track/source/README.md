# Vidéo « Selio Track  »

Vertical 1080 × 1920, 24 s, 30 i/s, sous-titres incrustés (karaoké) et SRT. Fabriquée avec la chaîne commune
(`../../commun`, voir son README) : `build.mjs` (timeline et textes), `scene.js` (animation), `audio.py` (musique).

```bash
node build.mjs
node ../../commun/render.mjs frames 30 - 4
python3 audio.py
../../commun/encode.sh mix.wav ../../Selio-Track-24s.mp4 -14
node ../../commun/srt.mjs ../../Selio-Track-24s.srt
node ../../commun/render.mjs stills  sache quoi acheter:15.4   # couverture : stills/t-….jpg → ../../Selio-Track-couverture.jpg
```

Pour changer un texte ou un temps : `CAPS` (sous-titres), `SFX` (bruitages) et les constantes `T_…` dans `build.mjs`.
