# Essai « verre liquide » (Liquid Glass)

_Version du 8 novembre 2026 — rédigé à partir des livrables de l'agent application (`livraison/liquid-glass/RAPPORT.md`, `mesures.json`, 16 captures) et du code._

Ibrahim veut juger le style « Liquid Glass » d'iOS 26 (flou de l'arrière-plan, réfraction des bords, reflet, teinte qui suit le contenu) sur une petite surface de l'application, sans changer la charte ailleurs (§6 du prompt).

## Où

| Surface | Fichier | Quand |
|---|---|---|
| **Dock flottant en bas, sur mobile** (< 768 px) : Accueil, Articles, « Générer » au centre, Messages, Affaires ; 60 px au-dessus de la zone de sécurité | `apps/web/src/app/components/MobileDock.tsx` | essai actif seulement ; le contributeur photos a une version réduite (ses deux destinations autour de « Générer ») |
| **Carte d'alerte Radar** : la carte d'une affaire dans la liste et le bloc « Acheter en un clic » de la page d'une affaire | `apps/web/src/app/components/deals.tsx`, `apps/web/src/app/pages/RadarDeal.tsx` (`data-testid="radar-alert-card"`) | essai actif seulement ; sinon la carte habituelle, inchangée |

Ailleurs, rien ne change : sans l'essai, aucune surface de verre n'est rendue.

## Comment

- Composant **`GlassSurface`** (`packages/ui/src/components/GlassSurface.tsx`) : `as`, `tone` (clair / sombre / auto), `intensity` (soft / regular), `refraction`, `opaque`, `contentClassName`. Attributs `data-glass` (glass / opaque), `data-glass-fallback` (raison du repli) pour les tests et le diagnostic.
- Styles dans `packages/ui/src/styles/glass.css` (`@layer components`) : **surface opaque par défaut** (`var(--surface)`, filet `var(--border)`) ; le verre ne s'active que dans un `@supports` qui exige `backdrop-filter` (ou `-webkit-backdrop-filter`, Safari iOS) **et** `color-mix()`. Flou 18 px, saturation 160 % (12 px / 140 % en « soft »), liseré clair de 1 px, reflet en dégradé en haut, reflet lent animé (14 s), ombre très douce.
- **Réfraction des bords** : filtre SVG `feTurbulence` + `feDisplacementMap` sur un anneau au bord, un identifiant par instance, **Chromium seulement** (Safari garde flou + liseré + reflet).
- **Couleurs** : jetons `--glass-*` construits à partir des rôles de la charte (`tokens.css`, clair et sombre), aucun hex dans le composant.
- **Contraste** : `scrimAlphaFor` (`packages/ui/src/lib/contrast.ts`) calcule l'opacité minimale de la couche de fond pour tenir **4,5:1 sur n'importe quel fond** (blanc comme noir) : 52 % pour le texte clair, 67 % pour le texte sombre ; les jetons prennent 56 % et 70 %. Dans le verre, `--text-muted` et `--text-subtle` passent à `--text` (un gris tenu à 4,5:1 exigerait une couche presque opaque). **Correction de la revue (8 novembre 2026)** : les rôles colorés n'étaient pas couverts (onglet actif du dock en `text-accent` #6442D6 : environ 2:1 sur la seule sous-couche, 4,0:1 avec le verre, quand une photo sombre passe dessous ; `text-success` 3,2:1 et `text-danger` 4,2:1 dans la carte Radar). Ils sont désormais redéfinis dans le contenu du verre par des variantes calculées pour 4,5:1 sur blanc ET noir avec la sous-couche déclarée : en clair, violet 900, vert, rouge et ambre très foncés ; en sombre, violet 100 et des teintes très claires (jetons `--glass-light-accent`… / `--glass-dark-accent`… de `tokens.css`, vérifiés par `contrast.test.ts`). `--on-accent` suit la surface pour les boutons pleins. L'onglet actif du dock porte en plus une pastille (repère non textuel).
- Détection : `useGlassCapabilities()` lit `matchMedia` et `CSS.supports`, suit les changements de préférence en direct ; côté serveur, valeurs sûres (opaque, immobile, sans réfraction).

## Replis

| Condition | Rendu |
|---|---|
| Pas de `backdrop-filter` (ou pas de `color-mix`) | surface opaque |
| `prefers-reduced-transparency: reduce` | surface opaque |
| `prefers-contrast: more` | surface opaque, filet `var(--text)` |
| `prefers-reduced-motion: reduce` | reflet immobile |
| Mode contraste élevé de Windows (`forced-colors`) | couleurs système |
| Navigateur hors Chromium | pas de réfraction |

La page Paramètres › Apparence dit, sur l'appareil, lequel s'applique. `prefers-reduced-transparency` n'a pas pu être émulé dans Chromium : couvert par la règle CSS et les tests unitaires seulement.

## Activation

- **Désactivé par défaut.** Réglage **« Essai : verre liquide »** dans Paramètres › Apparence (`apps/web/src/app/pages/settings/Appearance.tsx`), mémorisé **par utilisateur et par appareil** (`localStorage`, clé `selio.glass.<utilisateur>` ; aucune préférence côté serveur, l'essai ne justifiant pas de migration).
- **`VITE_EXPERIMENT_GLASS=true`** (variable publique du site) active l'essai par défaut pour la démo et les captures ; un choix explicite de l'utilisateur l'emporte toujours. Ne pas la mettre sur le site de production.

## Captures

`livraison/liquid-glass/` : avant / après, clair et sombre, sur la vue d'ensemble et sur Radar, pour un iPhone 15 et un Android 412 × 915, soit 16 captures. Script : `scripts/glass-captures/capture.mjs`.

**Limite :** ces captures sont faites dans **Chromium headless qui émule** les appareils (taille, densité, agent utilisateur). Ce n'est ni Safari iOS (WebKit, préfixe `-webkit-`, pas de réfraction), ni un vrai Chrome Android. **À refaire au doigt par Ibrahim** sur son iPhone (Safari, application ajoutée à l'écran d'accueil) et sur un Android d'entrée de gamme.

## Mesures de fluidité au défilement

Page des articles (`/app/items`), 3 passages de 3 s par cas **après un passage de chauffe ignoré**, **ordre des états alterné** d'un passage à l'autre, Chromium headless sur serveur **sans carte graphique** (rendu logiciel). **Quatre états**, pour attribuer le coût à sa vraie cause : sans dock, **dock opaque** (même DOM fixe, même espace réservé, sans flou ni reflet), verre sans réfraction ni animation du reflet, verre complet. Profil iPhone : **réfraction coupée** (captures comprises), car Safari ne l'aura jamais. Mesures du 8 novembre 2026 (`livraison/liquid-glass/mesures.json`), médianes, coût d'une image **sans limite de cadence** :

| Appareil (émulé) | Sans dock | Dock opaque | Verre sans réfraction ni animation | Verre complet |
|---|---:|---:|---:|---:|
| iPhone 15 (sans réfraction) | 0,61 ms | 0,65 ms | 0,67 ms | 2,58 ms (15 % du budget de 16,7 ms) |
| Android 412 × 915 (réfraction affichée) | 0,63 ms | 0,65 ms | 0,64 ms | 2,67 ms (16 % du budget) |

À 60 Hz : 60 images/s et **0 % d'images > 32 ms dans les huit cas** (le « 58 i/s, 3,4 % » de la première mesure, faite sans chauffe et toujours dans le même ordre, était un effet de démarrage).

Lecture (corrigée après la revue) : **le flou et le liseré ne coûtent presque rien** (au plus +2,3 % par rapport au même dock opaque). Le surcoût (environ × 4 par image) vient de **l'animation du reflet**, repeinte à chaque image (sur iPhone, réfraction coupée, elle fait à elle seule × 3,85), la réfraction n'ajoutant que peu sur Android. La première version de ce document imputait un « × 5 » au flou en comparant un dock en verre à l'absence de dock : c'était faux. Rendu logiciel sur serveur : sur un téléphone, le flou passe par la carte graphique ; **à mesurer sur les vrais téléphones** (Safari : Web Inspector › Timelines ; Chrome Android : `chrome://inspect` › Performance).

## Avis

**On garde l'essai, tel quel et désactivé par défaut. On ne l'étend pas encore. Avis conditionnel aux mesures sur de vrais téléphones.**

Pourquoi garder :
- Les replis sont complets et vérifiés (opaque sans flou, en contraste renforcé, en transparence réduite, en couleurs forcées ; reflet immobile en mouvement réduit), et le contraste est calculé, pas estimé : texte courant **et** rôles colorés (accent, succès, erreur, avertissement) tiennent 4,5:1 sur blanc et sur noir dans le verre.
- Le coût est borné et connu : deux surfaces ; le flou lui-même est quasi gratuit ici ; à 60 Hz rien ne se dégrade dans nos mesures.
- La charte n'est pas touchée : sans l'essai, l'application est identique au pixel près.

Pourquoi ne pas étendre maintenant :
- Le reflet animé multiplie par 4 environ le coût d'une image du dock ; l'étendre à d'autres surfaces multiplierait ce coût. **Piste simple si un téléphone peine : figer le reflet** (comme le fait déjà « réduire les animations ») plutôt que retirer le flou.
- Aucune mesure sur un vrai iPhone ni un vrai Android : les chiffres ci-dessus sont des émulations dans Chromium.
- Le verre impose du texte principal seulement (les gris passent à `--text`) et des couleurs d'accent plus foncées (ou plus claires en sombre) : la hiérarchie et les couleurs de la charte s'en trouvent aplaties à l'intérieur du verre.

Ce qui ferait changer l'avis :
- **Étendre** (par exemple à la barre du haut sur mobile) si, au doigt, le défilement reste à 60 images/s sur un Android d'entrée de gamme et sur l'iPhone, et si Ibrahim trouve le rendu Safari (sans réfraction) à la hauteur.
- **Abandonner** si un Android d'entrée de gamme descend sous ~50 images/s au défilement avec le dock, ou si le dock gêne la lecture du contenu qui passe dessous (le texte reste lisible dans nos captures, mais le contenu visible à travers le dock distrait en clair comme en sombre).

## Tests

- `packages/ui` : `contrast.test.ts` (valeurs WCAG, minimum de la couche, jetons relus), `glass.test.ts` (détection et choix du repli), `GlassSurface.test.tsx` (attributs, replis, changements de préférence en direct, réfraction Chromium seulement, rendu serveur, aucun hex).
- `apps/web` : réglage d'Apparence, dock mobile et carte Radar (tests de l'agent application).
