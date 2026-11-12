# Série motion design Selio — 37 vidéos courtes et 8 films verticaux

Même direction artistique que les spots de 45 s et 80 s (`livraison/video-pub`, `livraison/video-beta`) : fond encre et
améthyste, Inter, sous-titres karaoké avec mots-clés en or, logo blanc, vrais écrans de la démo en mode sombre dans un
iPhone, pastilles flottantes. Une vidéo par module, des films de marque et des vidéos de commercialisation.
H.264, 30 i/s, AAC à −14 LUFS.

| Vidéo | Sujet |
| --- | --- |
| `01-logo` | Anneau d'or, logo, promesse |
| `02-des-heures` | « Tu passes encore des heures… » + chrono |
| `03-track` | Revente moyenne et prix d'achat maximum |
| `04-radar` | Recherche, note sur 100, alerte, vrai bénéfice |
| `05-controle` | Contrôle à la réception |
| `06-studio` | Photos, annonce qui s'écrit, publication |
| `07-dressing` | Note sur 100 par annonce |
| `08-negociation` | Contre-offre et prix plancher |
| `09-automatisation` | Favoris, réponses, après-vente |
| `10-commandes` | Bordereaux et export |
| `11-analyses` | Marges au centime près |
| `12-neuf-applis` | « Combien d'applis tu ouvres… » |
| `13-ecosysteme` | Trouve. Publie. Négocie. Encaisse. |
| `14-pepite` | Le pull repéré à 4,00 € |
| `15-essai-14-jours` | L'essai : 14 jours, plan Pro, rien débité avant la fin |
| `16-trois-offres` | Starter, Pro, Agence ; au mois ou à l'année (2 mois offerts) |
| `17-offre-fondateurs` | 50 premiers clients : −30 % pendant 6 mois, 1 mois offert sur Starter |
| `18-parcours-complet` | Les 8 étapes, de l'achat à la marge |
| `19-avant-apres` | Avant / après Selio |
| `20-une-journee` | Une journée de revendeur, heure par heure |
| `22-republier` | Republier dès 7 jours, 10 variantes prêtes |
| `23-prix-conseille` | Vente rapide, standard, marge maximale |
| `25-demo-sans-compte` | « Explore la démo, sans compte » |
| `26-toi-qui-decides` | Rien n'est publié sans ton clic |
| `27-mot-de-passe` | Le mot de passe Vinted n'est jamais demandé |
| `28-l-ia-redige` | L'IA rédige, elle ne décide rien |
| `29-note-sur-100` | Les quatre critères de la note |
| `30-prix-plancher` | Le prix plancher, jamais révélé |
| `31-ta-marge` | La formule de la marge brute |
| `32-cout-reel` | Prix + port + protection acheteurs |
| `33-plusieurs-comptes` | Vente, Achat, Perso ; 1, 3 ou 10 comptes |
| `34-importe-ton-stock` | Import et export CSV |
| `35-changer-d-outil` | Reprendre ses réglages sans donner ses identifiants |
| `36-sur-ton-telephone` | Écran d'accueil, clair ou sombre, photos au téléphone |
| `37-stock-automatique` | Remise en ligne tant qu'il reste du stock |
| `38-apres-la-vente` | Bordereau, remerciement, relance |
| `39-messagerie` | L'assistant propose, tu valides |

### Films par filiale (27 à 44 s), pour les comptes dédiés

| Film | Contenu |
| --- | --- |
| `50-film-radar` | Recherche, note sur 100, alerte, coût réel, bénéfice, « c'est toi qui achètes » |
| `51-film-track` | Ventes observées, revente moyenne, achat maximum, comparables, lien vers le Radar |
| `52-film-studio` | Trois étapes, photos, titre et description, attributs, prix conseillé, publication |
| `53-film-gestion` | Dressing, négociation, automatisation, commandes, analyses |
| `54-film-cloud` | Ordinateur éteint, connexion par le client, rythme humain, pause, journal (aperçu) |
| `55-film-comptes` | Checklist d'ouverture de boutique et textes prêts à copier |
| `56-film-agents` | Rôles, accès, journal d'audit, boutiques clientes (aperçu) |
| `57-film-plateforme` | L'outil de gestion puis les six filiales |

Chaque film s'ouvre sur un carton au nom de la filiale. Cloud et Agents portent la mention « aperçu » (état des espaces
dans `apps/web/src/app/spaces/spaces.tsx`) ; Track y est encore « en développement ».

Toutes les vidéos sont verticales (1080 × 1920) et se terminent sur « Essaie 14 jours gratuits » (commercialisation ;
plus de mention de bêta). Les faits commerciaux (essai, offres, offre fondateurs, facturation annuelle) viennent de
`packages/demo-data/src/plans.ts` sur la branche produit ; aucun montant n'est affiché car les prix y sont encore
marqués « indicatifs ». Le bouton et la mention se changent dans `engine.js` (`CTA`, `DISCLAIMER`).

Les textes des vidéos 01 à 14 reprennent les sous-titres validés des trois spots existants, ceux des vidéos 27 à 39
les réponses de la FAQ (`packages/domain/src/help-text.ts`) ; les chiffres sont ceux des écrans de la démo
(pull Tommy Hilfiger à pois). Les écrans viennent de `../../video-beta/source/ecrans` (captures réelles et maquettes
dans la charte, voir le README de ce dossier). Pas de voix off.

## Fabrication

```bash
cd livraison/video-motion/source
npm install                 # Inter
node render.cjs             # tout rendre dans livraison/video-motion/
node render.cjs 08          # une seule vidéo (filtre sur l'id)
node render.cjs --stills 04 && python3 -I sheet.py Selio-motion-04-radar-9x16   # planche de contrôle
```

Nécessite Node, Playwright (Chromium), ffmpeg, Python 3 avec numpy et Pillow. Aperçu en temps réel :
`player.html?v=04-radar&fmt=9x16&play=1`.

- `engine.js` : moteur déterministe `seek(t)`, sous-titres (`caps`), iPhone (`phone`), pastilles (`fchip`),
  mises en avant (`hl`, `ck`, `bd`), notification, cartons de fin. Chaque élément déclare aussi son bruitage.
- `videos/modules.js`, `videos/marque.js`, `videos/commerce.js`, `videos/confiance.js`, `videos/films.js` : le déroulé de chaque vidéo (textes, instants, défilements).
- `audio.py` : musique et bruitages synthétisés (instruments repris du spot de 80 s, aucun échantillon tiers).
- `render.cjs` : capture image par image, encodage, mixage.
