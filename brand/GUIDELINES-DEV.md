# Selio — Guidelines design pour les devs

Version 2.0 · octobre 2026 · remplace la charte « bleu marine + Playfair » de la v1.

Les fichiers à brancher : `tokens.css` (variables CSS, clair + sombre) et `tailwind.preset.js` si le projet utilise Tailwind. L'app mobile (Expo) reprend les mêmes valeurs : voir §9.

---

## 1. Le principe en une phrase

**Noir et blanc partout, l'orange seulement là où l'œil doit aller.** L'interface est un outil de travail : elle s'efface derrière les chiffres, les articles et les messages du revendeur.

Trois règles qui tranchent 90 % des décisions :

1. **Pas d'effet décoratif.** Pas de dégradé, pas de 3D, pas de verre dépoli, pas d'ombre sur les cartes au repos. Une carte = fond blanc + bordure 1 px.
2. **Une seule police : Inter.** Pas de serif, pas de police d'affichage. La hiérarchie se fait par la taille et la graisse (400 / 500 / 600), jamais par une autre famille.
3. **L'orange est rare.** Il signale l'action principale, l'élément actif, ou un chiffre qui compte. Si plus de 10 % de l'écran est orange, il y en a trop.

## 2. Couleurs

Ne jamais écrire un hex dans un composant : utiliser les **rôles** (`var(--text)`, `bg-surface`, `text-accent`…). Les rôles basculent tout seuls en mode sombre.

### Rôles

| Rôle | Clair | Sombre | Usage |
|---|---|---|---|
| `--bg` | `#FAFAFA` | `#0B0B0C` | Fond de page |
| `--surface` | `#FFFFFF` | `#18181B` | Cartes, panneaux, modales, sidebar |
| `--surface-muted` | `#F4F4F5` | `#27272A` | Survol de ligne, zones secondaires |
| `--border` | `#E4E4E7` | `#27272A` | Toutes les bordures par défaut |
| `--text` | `#0B0B0C` | `#FAFAFA` | Titres et texte principal |
| `--text-muted` | `#71717A` | `#A1A1AA` | Légendes, dates, métadonnées |
| `--primary` | `#0B0B0C` | `#FAFAFA` | Bouton principal |
| `--accent` | `#C4501B` | `#EA6A2A` | Action forte, élément actif, lien |
| `--accent-soft` | `#FEF3EC` | orange 14 % | Fond de badge/sélection orange |
| `--accent-vivid` | `#EA6A2A` | `#EA6A2A` | Graphiques, pastilles, indicateurs |

### Orange « Braise »

| Token | Hex | Contraste sur blanc | À utiliser pour |
|---|---|---|---|
| `braise-500` | `#EA6A2A` | 3.2:1 | Formes, graphiques, icônes ≥ 20 px. **Jamais pour du texte sur blanc.** |
| `braise-600` | `#C4501B` | 4.7:1 ✅ AA | Texte orange, bouton orange avec texte blanc |
| `braise-700` | `#A3410F` | 6.3:1 | Hover / pressed |
| `braise-50` | `#FEF3EC` | — | Fond de badge, ligne sélectionnée |

### Statuts

Vert `#15803D` (connecté, vendu, marge positive), ambre `#B45309` (en attente), rouge `#B91C1C` (erreur, marge négative). Ils s'affichent en **petit** : une pastille de 6 px + un libellé gris, ou le chiffre lui-même coloré. Jamais en fond plein.

### Ce qui disparaît de la v1

Tous les bleus (`#204868`, `#7394AE`, `#0C1B27`…), les fonds bleu nuit, les dégradés et les visuels 3D. Le bleu ne doit plus apparaître nulle part, y compris dans les graphiques.

## 3. Typographie

**Inter**, chargée en 400, 500 et 600. Rien d'autre. Playfair Display et Source Sans Pro sont retirées.

| Style | Taille / interligne | Graisse | Usage |
|---|---|---|---|
| Display | 48 / 52 | 600, -0.03em | Pages marketing uniquement |
| Chiffre clé | 32 / 38 | 600, -0.02em | KPI des tableaux de bord |
| Titre de page | 24 / 30 | 600, -0.02em | Un par écran (« Vue d'ensemble ») |
| Titre de carte | 20 / 26 ou 16 / 24 | 600 | En-tête de carte / section |
| Texte | 14 / 20 | 400 | Texte d'interface par défaut |
| Tableau | 13 / 18 | 400 / 500 | Lignes de tableau, listes denses |
| Label | 12 / 16 | 500 | Badges, en-têtes de colonnes, légendes |

- **Tous les nombres** (prix, marges, compteurs) en `font-variant-numeric: tabular-nums` (classe `.num` ou attribut `data-num`), alignés à droite dans les tableaux.
- Les prix s'écrivent à la française : `1 286,00 €` (espace fine insécable avant le €, utiliser `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`).
- Pas de texte en MAJUSCULES espacées, sauf les en-têtes de colonnes de tableau (12 px, 500, +0.04em, `--text-muted`).
- Pas d'italique dans l'interface.

## 4. Espacement et grille

- Grille de **4 px**. Valeurs autorisées : 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Padding de carte : **20 px** (16 px sur mobile). Écart entre cartes : **16 px**.
- Marges de page : 32 px desktop, 16 px mobile. Largeur max du contenu : 1280 px.
- Sidebar Espace Pro : 232 px, fond `--surface`, bordure droite 1 px.

## 5. Formes, bordures, ombres

| | Valeur |
|---|---|
| Badges, inputs compacts | radius 6 px |
| Boutons, inputs | radius 8 px |
| Cartes | radius 12 px |
| Modales, bottom sheets | radius 16 px |
| Avatars, toggles, pastilles | radius plein |

- Les cartes n'ont **pas d'ombre**, seulement `1px solid var(--border)`.
- `--shadow-md` uniquement pour ce qui flotte (menu, popover, toast). `--shadow-lg` uniquement pour les modales.
- Pas de bordure de couleur sur les cartes, sauf la carte sélectionnée : bordure `--accent`.

## 6. Composants

### Boutons

| Variante | Fond | Texte | Quand |
|---|---|---|---|
| **Primaire** | `--primary` (noir) | blanc | Action principale d'un formulaire ou d'une carte (« Enregistrer », « Ajouter ») |
| **Accent** | `--accent` (orange) | blanc | **Une seule fois par écran**, l'action qui fait gagner de l'argent (« Vendre », « Publier », « Acheter maintenant ») |
| **Secondaire** | `--surface` + bordure | `--text` | Actions annexes (« Exporter XLSX », « Modifier ») |
| **Fantôme** | transparent | `--text-muted` | Actions tertiaires (« Ignorer », « Plus tard ») |
| **Danger** | transparent | `--danger` | Suppression (toujours avec confirmation) |

Hauteurs : 32 px (compact, tableaux), 36 px (défaut), 44 px (mobile). Padding horizontal 12 / 14 / 16 px. Texte 14 px, 500. Icône 16 px à gauche, gap 6 px.

### Navigation (sidebar Espace Pro)

- Élément inactif : texte `--text-muted`, 14 px, 500.
- Élément actif : fond `--surface-muted`, texte `--text`, **barre verticale orange de 2 px à gauche**. C'est le seul orange de la sidebar.
- Titres de groupe (« IA Selio », « Achat ») : 12 px, `--text-subtle`.
- Badge « V2 » : fond `--surface-muted`, texte `--text-muted`, 11 px.

### Cartes KPI

Libellé 13 px `--text-muted` → chiffre 32 px 600 → variation 12 px. Variation positive en `--success`, négative en `--danger`. Pas d'icône décorative.

### Tableaux

- Pas de bordures verticales. Lignes séparées par `--border`, hauteur 48 px (40 px en dense).
- En-tête : 12 px, 500, `--text-muted`, fond `--surface`.
- Survol : `--surface-muted`. Ligne sélectionnée : `--accent-soft`.
- Colonnes numériques alignées à droite, `tabular-nums`. Marge positive en vert, en gras 500.

### Badges de statut

Fond `--surface-muted`, texte `--text` 12 px 500, pastille de 6 px colorée à gauche. Exemples : `● Connecté` (vert), `● En vente` (orange `--accent-vivid`), `● Vendu` (noir), `● Archivé` (gris).

### Champs

Hauteur 36 px, fond `--surface`, bordure `--border-strong`, radius 8 px, texte 14 px. Focus : anneau orange `--focus-ring`, pas de changement de bordure. Label au-dessus, 13 px 500. Erreur : bordure et message en `--danger`.

### Toggles

Off : fond `--gray-300`. On : fond `--primary` (noir). Le toggle n'est **pas** orange : on garde l'orange pour l'action.

### Messagerie

Bulle reçue : `--surface-muted`, texte `--text`. Bulle envoyée : `--primary` (noir), texte blanc. Suggestion de l'IA : bordure 1 px `--accent` en pointillés + libellé « Suggestion IA » en `--accent`.

### Graphiques

- Série principale en `--accent-vivid` (`#EA6A2A`), séries secondaires en gris (`--gray-900`, `--gray-400`, `--gray-300`).
- Grille horizontale seulement, `--border`, 1 px. Pas de grille verticale.
- Barres : radius 4 px en haut. Courbes : 2 px, sans points sauf au survol.
- Une seule couleur vive par graphique.

## 7. Icônes et images

- Jeu d'icônes unique : **Lucide** (contour, 1.5 px). Tailles 16 px (dans le texte et les boutons) et 20 px (navigation). Couleur `currentColor`.
- Plus d'illustrations 3D ni de visuels décoratifs. Les seules images de l'interface sont les **photos d'articles** : ratio 1:1 dans les listes, 4:5 sur la fiche annonce, radius 8 px, fond `--surface-muted` pendant le chargement.

## 8. Logo

Le dessin du logo ne change pas, seule sa couleur change. Fichiers dans `logo/` :

| Fichier | Quand |
|---|---|
| `selio-logo-noir.png` | **Version par défaut**, sur fond blanc ou gris clair |
| `selio-logo-blanc.png` | Sur fond noir ou orange |
| `selio-logo-orange.png` | Usage ponctuel (marketing, réseaux) sur fond blanc |
| `selio-icone-*.png` | Symbole seul : favicon, avatar, petits espaces |
| `selio-app-icon-orange.png` / `-noir.png` | Icône d'application (1024 × 1024) |

- Dans le header de l'app : logo noir, 24 px de haut.
- Taille minimum 24 px de haut (symbole seul : 16 px). Zone de protection = hauteur du « S » tout autour.
- Interdits : déformer, ajouter une ombre ou un contour, le mettre sur une photo, le recolorer dans une autre couleur que noir / blanc / Braise.
- Les PNG fournis sont exportés à 4× (≈ 1 900 px de large). Pour le SVG : reprendre le fichier source `logo-principal.svg` de la v1 et remplacer la couleur de remplissage par `#0B0B0C`, `#FFFFFF` ou `#C4501B`.

## 9. Mobile (Expo / React Native)

Mêmes valeurs, en objet JS :

```js
export const colors = {
  bg: '#FAFAFA', surface: '#FFFFFF', surfaceMuted: '#F4F4F5',
  border: '#E4E4E7', borderStrong: '#D4D4D8',
  text: '#0B0B0C', textMuted: '#71717A', textSubtle: '#A1A1AA',
  primary: '#0B0B0C', onPrimary: '#FFFFFF',
  accent: '#C4501B', accentVivid: '#EA6A2A', accentSoft: '#FEF3EC',
  success: '#15803D', warning: '#B45309', danger: '#B91C1C',
};
export const font = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' }; // @expo-google-fonts/inter
export const radius = { sm: 6, md: 8, lg: 12, xl: 16 };
```

- Onglet actif de la tab bar : icône + libellé en `--text`, petit point orange de 4 px sous l'icône. Inactif : `--text-subtle`.
- Le bouton « Vendre » de la tab bar est le bouton accent de l'app (orange).
- Cibles tactiles : 44 × 44 px minimum. Texte de champ en 16 px (évite le zoom iOS).

## 10. Accessibilité

- Contraste minimum 4.5:1 pour le texte (déjà garanti par les rôles ; `braise-500` n'est **jamais** une couleur de texte sur fond clair).
- Focus visible sur tout élément interactif (`--focus-ring`, déjà global dans `tokens.css`).
- La couleur n'est jamais le seul signal : un statut a toujours un libellé, une marge négative a toujours son signe « − ».
- Respect de `prefers-reduced-motion` (géré dans `tokens.css`). Animations : 120–200 ms, uniquement opacité et translation.

## 11. Checklist avant de merger un écran

- [ ] Aucun hex en dur, aucun bleu.
- [ ] Une seule police (Inter), trois graisses max.
- [ ] Au plus **un** bouton orange visible.
- [ ] Cartes sans ombre, bordure 1 px.
- [ ] Chiffres en `tabular-nums`, prix au format `fr-FR`.
- [ ] Testé en mode clair **et** sombre.
- [ ] Testé à 375 px de large.
