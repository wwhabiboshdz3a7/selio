# Inventaire vidéo et marketing

État au 15 novembre 2026. Réalisé par Ibrahim.

## Les vidéos

| Vidéo | Durée | Format | Sujet | État | Fichiers |
| --- | --- | --- | --- | --- | --- |
| « Et si une appli centralisait tout ? » | 35 s | 1080 × 1920, 30 i/s, H.264 + AAC, −14 LUFS | Le revendeur jongle entre neuf applis ; tout est aspiré, Selio rassemble stock, ventes, marges, contre-offres et notes d'annonces. Fin : « Rejoins la bêta gratuite, lien en bio ». | **Finie** (sans voix off : sous-titres karaoké, musique et bruitages) | `Selio-video-35s.mp4`, `Selio-video-35s.srt` (18 sous-titres), `Selio-video-couverture.jpg`, source dans `source/` |
| Selio Studio : « Tes photos deviennent une annonce » | 27 s | idem | Photos d'un pull → lecture de l'étiquette (marque, taille), mesures sur le mètre ruban, titre et description rédigés, question au vendeur pour la matière, validation. « Tu gardes la main. » | **Finie** | `Selio-Studio-27s.mp4`, `Selio-Studio-27s.srt` (12), `Selio-Studio-couverture.jpg`, source dans `studio/source/` |
| Selio Bot : « Il négocie et relance pendant que tu dors » | 29 s | idem | 2 h 47, une offre arrive ; règles fixées une fois (plancher 14,50 €), contre-offre à 17,10 € acceptée, relance des favoris après 24 h, résumé du matin avec une demande à valider. Conversation et prénoms d'exemple ; mention « la nuit : ordinateur allumé, ou Selio Cloud (en option) ». | **Finie** | `Selio-Bot-29s.mp4`, `Selio-Bot-29s.srt` (13), `Selio-Bot-couverture.jpg`, source dans `bot/source/` |
| Selio Track : « Sache quoi acheter » | 24 s | idem | Pull acheté 8 € : se revend combien ? Prix médian, fourchette, annonces disparues, note de niche 78/100. Badge « Exemple · chiffres fictifs » à l'écran et dans la mention finale. | **Finie** | `Selio-Track-24s.mp4`, `Selio-Track-24s.srt` (9), `Selio-Track-couverture.jpg`, source dans `track/source/` |
| Version de 15 s du 35 s, accroches B et C, version sans logos | 15 s | — | Proposées dans `Selio-proposition-video.pdf` | **Pas faites** (à sortir sur demande) | — |
| Version « bruitages seuls » du 35 s (pour poser une voix) | 35 s | idem | Même image, sans musique | Se régénère (`./encode.sh sfx.wav …`) ; fichier ignoré par git | — |
| Voix off (Elias ou Ibrahim) | — | — | Script de 98 mots dans `Selio-script-video.pdf` | **Pas enregistrée** | — |

Les quatre vidéos se refont depuis leur dossier `source` (README dans chacun). Les trois nouvelles partagent la chaîne `commun/`
(moteur d'animation, rendu, encodage, sous-titres, sons) reprise de la première. Les fichiers intermédiaires
(`frames/`, `stills/`, `*.wav`, `scene.html`, `timeline.json`) sont ignorés par git.

Toutes les images sont générées en code ou viennent du dépôt (photos de démonstration `apps/web/public/demo/photos`,
logo `brand/`). Aucune voix ni musique sous licence : bandes son synthétisées. Aucun logo ni écran de Vinted dans les
trois nouvelles vidéos (la première montre le logo Vinted parmi les applis du « chaos », icône Simple Icons CC0, avec la
mention « non affilié à Vinted ni aux marques citées »).

## Les documents marketing (dossier `livraison/`)

| Document | Pages | Contenu | État |
| --- | --- | --- | --- |
| `Selio-strategie-marketing-V1.pdf` | 8 | V1 d'Elias : produits et noms, options de prix, calendrier de 3 semaines, budget de départ 400 à 500 € | Document de travail, dépassé par la V4 |
| `Selio-reponses-techniques.pdf` | 15 | Réponses techniques d'Ibrahim à la V1 | Livré |
| `Selio-reponses-strategie-V2.pdf` | 12 | Réponses aux douze questions de la V2 (serveur, coûts par requête, capacité) | Livré |
| `Selio-reponses-strategie-V3.pdf` | 9 | Réponses aux onze blocs de la V3 (machine, Studio, Track, Bot, négociation) | Livré |
| `Selio-strategie-V4-master.html` | — | Dossier V4 Master : calendrier jusqu'au lancement, phases de contenu vidéo, SEO, KPI, partenariats | Référence en cours |
| `Selio-proposition-video.pdf` | 10 | Proposition de la vidéo de 35 s : storyboard, script minuté, trois accroches, version de 15 s | Livré |
| `Selio-script-video.pdf` | 7 | Script final calé sur le rendu, marche à suivre pour enregistrer la voix | Livré |
| `Selio-analyse-de-marche.pdf`, `Selio-analyse-de-marche-perso.pdf` | 8 et 6 | Marché des outils Vinted ; nombre de clients visables | Livré |
| `Selio-etude-juridique-concurrents.pdf` | 8 | Comment les concurrents se protègent | Livré |
| **`Selio-plan-reseaux.pdf`** (+ `Selio-plan-reseaux.html`) | 12 | **Nouveau** : objectifs, cibles, plateformes, noms de comptes, bios, piliers, calendrier de 4 semaines jour par jour, codes promo, créateurs, indicateurs, règles, qui fait quoi | Livré ; version courte `docs/RESEAUX-SOCIAUX.md` |

## Ce qui reste

- Vérifier la disponibilité des noms de comptes et ouvrir les comptes (Elias).
- Enregistrer une voix off si on en veut une (les vidéos se comprennent sans le son).
- Version de 15 s du 35 s et versions de 15 s de Bot et Studio (calendrier : 30 novembre et 20 décembre).
- Bannières des réseaux (logo blanc sur fond violet nuit) ; tutos en écran réel à capturer quand l'interface sera stabilisée.
