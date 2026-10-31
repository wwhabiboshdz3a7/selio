# Spot publicitaire Selio (60 s / 45 s)

Vidéo de présentation de l'application Selio, générée entièrement en code (motion design HTML/CSS/JS,
rendu image par image, bande-son synthétisée). Aucune ressource externe payante : tout est reproductible
depuis ce dossier.

- `out/selio-pub-60s.mp4` — version 1 minute, 1920×1080, 30 i/s, H.264 + AAC
- `out/selio-pub-45s.mp4` — version 45 secondes (même film, rythme resserré)

## Structure

| Fichier | Rôle |
| --- | --- |
| `src/index.html`, `src/styles.css`, `src/scene.js` | La composition : 7 scènes pilotées par une timeline GSAP « scrubbable » (`window.__seek(t)`), fond WebGL (three.js) inspiré du hero 3D de l'app, interface Selio recréée avec les tokens de la charte. |
| `src/icons.js` | Icônes Phosphor (MIT) extraites par `build-icons.cjs`. |
| `assets/fonts/` | Playfair Display + Source Sans 3 (Google Fonts) copiées en local pour un rendu déterministe. |
| `timing.json`, `timing-45.json` | Découpage temporel des scènes. La chorégraphie de chaque scène s'adapte à la durée du créneau. |
| `render.cjs` | Rendu Playwright/Chromium → ffmpeg (PNG sans perte → libx264 CRF 17). Mode `--stills` pour contrôler des images fixes. |
| `render-all.sh` | Rendu parallèle par segments puis concaténation. |
| `sheet.py` | Planche-contact des images fixes (contrôle visuel). |
| `audio/make_audio.py` | Musique (nappe, piano FM, arpège, basse, percussions feutrées) + effets (balayages, impacts, clics d'interface) synthétisés en numpy, calés sur le timing. |

## Scénario (60 s)

1. **Accroche** (0–5,6 s) — « Chaque vêtement a une histoire. Et si la sienne ne faisait que commencer ? »
2. **Révélation** (5,2–11,6 s) — le monogramme se dessine, « Selio », « Donnez une seconde vie à votre dressing. »
3. **Explorer** (11,2–23 s) — grille d'annonces, filtres (état, prix), coup de cœur ajouté aux favoris.
4. **Vendre** (22,6–31,6 s) — dépôt d'annonce sur mobile : photos, titre, prix, publication en quelques minutes.
5. **Acheter en confiance** (31,2–38,6 s) — messagerie, négociation, prix accepté.
6. **Selio Pro** (38,2–51,4 s) — tableau de bord : ventes, CA, marge, stock, graphique, automatisations toutes les 15 min, export Excel.
7. **Signature** (51–60 s) — logo, « Achetez · Vendez · Recommencez », disponible sur le web et installable sur téléphone.

## Regénérer

```bash
cd video
npm install                      # gsap, three, @phosphor-icons/core
node build-icons.cjs             # (si la liste d'icônes change)
node render.cjs --every 2        # images fixes toutes les 2 s dans out/stills
python3 -I sheet.py out/stills out/sheet.png
./render-all.sh 3 timing.json out/video60_noaudio.mp4
python3 -I audio/make_audio.py timing.json audio
ffmpeg -y -i out/video60_noaudio.mp4 -i audio/mix.wav -c:v copy -c:a aac -b:a 192k \
  -af loudnorm=I=-16:TP=-1.5:LRA=11 -shortest out/selio-pub-60s.mp4
```

Pour la version 45 s, remplacer `timing.json` par `timing-45.json` (et `audio/make_audio.py timing-45.json audio45`).

## Ajouter une voix off

Le spot est conçu pour fonctionner sans voix (lecture muette sur les réseaux). Le texte prévu est dans
`audio/voix-off.txt`. Pour l'intégrer : générer le fichier (ElevenLabs, enregistrement studio…), le caler
sur les scènes, puis mixer avec un ducking de la musique :

```bash
ffmpeg -y -i out/video60_noaudio.mp4 -i audio/mix.wav -i voix.wav -filter_complex \
  "[1:a][2:a]sidechaincompress=threshold=0.05:ratio=6:attack=40:release=400[duck];[duck][2:a]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest out/selio-pub-60s-vo.mp4
```

## Licences

Polices Google Fonts (OFL), icônes Phosphor (MIT), GSAP (licence standard « no charge »), three.js (MIT).
Musique et effets : œuvre originale générée par le script, libre d'utilisation pour Selio.
