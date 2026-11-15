# Vidéo « Selio Studio  »

Vertical 1080 × 1920, 27 s, 30 i/s, sous-titres incrustés (karaoké) et SRT. Fabriquée avec la chaîne commune
(`../../commun`, voir son README) : `build.mjs` (timeline et textes), `scene.js` (animation), `audio.py` (musique).

```bash
node build.mjs
node ../../commun/render.mjs frames 30 - 4
python3 audio.py
../../commun/encode.sh mix.wav ../../Selio-Studio-27s.mp4 -14
node ../../commun/srt.mjs ../../Selio-Studio-27s.srt
node ../../commun/render.mjs stills  tes photos deviennent une annonce:11.9   # couverture : stills/t-….jpg → ../../Selio-Studio-couverture.jpg
```

Pour changer un texte ou un temps : `CAPS` (sous-titres), `SFX` (bruitages) et les constantes `T_…` dans `build.mjs`.
