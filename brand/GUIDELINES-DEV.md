# Selio — Guidelines design pour les devs

Version 3.0 · octobre 2026 · remplace la charte « noir + orange Braise » de la v2.

Les fichiers à brancher : `packages/ui/src/styles/tokens.css` (variables CSS, clair + sombre) et `theme.css` (utilitaires Tailwind v4 branchés sur les variables). L'app mobile (Expo) reprend les mêmes valeurs : voir §9.

---

## 1. Le principe en une phrase

**Encre et porcelaine partout, l'améthyste là où l'œil doit aller, l'or pour ce qui distingue.** L'interface est un outil de travail : elle s'efface derrière les chiffres, les articles et les messages du revendeur.

Quatre règles qui tranchent 90 % des décisions :

1. **Épuré d'abord.** Une carte = fond `--surface` + filet 1 px. Jamais filet **et** ombre cumulés, jamais de bordure colorée au repos. Plusieurs indicateurs côte à côte vont dans **une seule** carte découpée par des filets (composant `StatStrip`), pas dans une rangée de cartes.
2. **Une seule police : Inter.** La hiérarchie se fait par la taille et la graisse (400 / 500 / 600), jamais par une autre famille.
3. **Le violet est rare.** Il signale l'action principale, l'élément actif ou sélectionné, le focus, un lien d'action. Les icônes sont **neutres** (`--text-muted`), sans tuile colorée.
4. **L'or est plus rare encore.** Réservé aux notes excellentes, aux étoiles, aux objectifs atteints et aux éléments « premium » (icône du générateur IA). Jamais en fond plein, jamais pour un avertissement.

Plus d'orange décoratif : ni tuile, ni pastille pleine, ni graphique, ni logo. Seul l'ambre sémantique `--warning` subsiste, en petit (icône ou libellé d'avertissement).

## 2. Couleurs

Ne jamais écrire un hex dans un composant : utiliser les **rôles** (`var(--text)`, `bg-surface`, `text-accent`…). Les rôles basculent tout seuls en mode sombre. Dans un canvas ou du WebGL, lire la valeur avec `getComputedStyle(document.documentElement).getPropertyValue('--violet-500')`.

### Rôles

| Rôle | Clair | Sombre | Usage |
|---|---|---|---|
| `--bg` | `#F5F5F7` (porcelaine) | `#1A1820` | Fond de page |
| `--surface` | `#FFFFFF` | `#23202A` | Cartes, panneaux, modales |
| `--surface-sidebar` | `#FAFAFB` | `#1E1B24` | Menu latéral |
| `--surface-muted` | `#F1F0F4` | `#2D2A35` | Survol, pistes de jauges, zones secondaires |
| `--border` | `#E7E5EC` | `#37333F` | Tous les filets |
| `--text` | `#1C1A24` | `#EEEBF3` (blanc cassé) | Titres et texte principal |
| `--text-muted` | `#6E6A7B` | `#B4AFC0` | Légendes, dates, compteurs (AA sur tous les fonds) |
| `--text-subtle` | `#A3A0AE` | `#868193` | Placeholders et décor **uniquement** (pas AA) |
| `--primary` | encre `#1C1A24` | `#EEEBF3` | Bouton principal (encre) |
| `--accent` | `#6442D6` (violet-600) | `#B5A3FF` | Action forte, élément actif, lien, texte violet |
| `--accent-soft` | `#F5F2FF` | violet 18 % | Fond de l'élément actif ou sélectionné |
| `--accent-vivid` | `#7C5CEB` (violet-500) | `#9B80F7` | Graphiques, pastilles, toggles, barres |
| `--gold` | `#C1933B` | `#E2C67C` | Formes or : anneaux de note, étoiles, jauge d'objectif atteint |
| `--gold-soft` | `#FBF7EC` | or 16 % | Fond des badges « Très bonne affaire » / « Exceptionnelle » |
| `--gold-text` | `#7A591A` | `#E8CF8E` | Seul or autorisé pour du **texte** |

### Améthyste et Champagne

| Token | Hex | Usage |
|---|---|---|
| `violet-500` | `#7C5CEB` | Formes et graphiques. Texte blanc dessus : 4,6:1 (gros texte et boutons). |
| `violet-600` | `#6442D6` | Texte violet sur clair, bouton accent avec texte blanc (≥ 6:1). |
| `violet-700` | `#5232B5` | Survol, départ du dégradé de marque. |
| `gold-300` | `#E2C67C` | Icône or posée sur le fond de marque (bouton « Générer une annonce »). |
| `gold-500` | `#C1933B` | Formes or. **Jamais pour du texte sur fond clair.** |
| `gold-700` | `#7A591A` | Texte or sur fond clair (6,4:1). |

`bg-brand` (utilitaire de `base.css`) : dégradé violet-700 → violet-500, identique en clair et en sombre, texte blanc. Réservé aux appels à l'action du **générateur IA** (bouton du menu, variante de bouton `brand`, bulles envoyées de la messagerie). C'est le seul dégradé de l'application.

### Statuts

Vert `--success` (connecté, vendu, marge positive), `--warning` (en attente, à vérifier), rouge `--danger` (erreur, marge négative). Ils s'affichent en **petit** : une pastille de 6 px + un libellé, une icône de 16 px, ou le chiffre lui-même coloré. Jamais en fond plein, jamais en bordure épaisse.

### Tons des graphiques

`--tone-*` (`braise` = améthyste, `amber` = champagne, `slate`, `indigo`, `rose`, `teal`, `sky`, `emerald`) ne servent **qu'aux graphiques de répartition** (anneau, barre empilée), dans cet ordre : améthyste, or, ardoise, puis les autres. Jamais pour une icône, un badge ou un fond de carte. Les noms historiques sont conservés pour la compatibilité.

### Échelle des notes sur 100

| Niveau | Bonnes affaires | Dressing | Forme (anneau, barre) | Texte |
|---|---|---|---|---|
| Excellent | ≥ 85 | ≥ 80 | `--gold` | `--gold-text` |
| Bon | 75 – 84 | 60 – 79 | `--accent-vivid` | `--accent` |
| Moyen | 60 – 74 | 40 – 59 | lavande (`--accent-vivid` 42 % dans `--surface-muted`) | `--text-muted` |
| Faible | < 60 | < 40 | `--tone-rose` | `--danger` |

Fonctions : `scoreTone(score, "deal" | "listing")` et `scoreTextTone(...)` dans `apps/web/src/components/charts.tsx`. Les sous-critères (barres de détail) restent en `--accent-vivid` : la longueur porte l'information, pas la couleur.

## 3. Typographie

**Inter**, chargée en 400, 500 et 600. Rien d'autre.

| Style | Taille / interligne | Graisse | Usage |
|---|---|---|---|
| Display | 48 / 52 | 600, -0.03em | Pages marketing uniquement |
| Chiffre clé | 32 / 38 | 600, -0.02em | Indicateurs (`StatStrip`) |
| Titre de page | 24 / 30 | 600, -0.02em | Un par écran |
| Titre de carte | 16 / 24 | 600 | En-tête de carte / section |
| Texte | 14 / 20 | 400 | Texte d'interface par défaut |
| Tableau | 13 / 18 | 400 / 500 | Lignes de tableau, listes denses |
| Label | 12 / 16 | 500 | Badges, légendes, sur-titres |

- **Tous les nombres** (prix, marges, compteurs) en `tabular-nums` (classe `.num`), alignés à droite dans les tableaux.
- Les prix s'écrivent à la française : `1 286,00 €` (`Intl.NumberFormat('fr-FR', …)`).
- Majuscules espacées seulement pour les en-têtes de colonnes, les sur-titres de page et les titres de groupe du menu (11–12 px, 500, `--text-muted`).

## 4. Espacement et grille

- Grille de **4 px**. Valeurs autorisées : 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Padding de carte : **20 px** (16 px sur mobile), 24 px pour les cartes de graphique. Écart entre cartes : **16 px** ; entre sections : **32 px**.
- Marges de page : 48 px desktop large, 32 px tablette, 16 px mobile. En-tête de page → contenu : 32 px.
- Menu latéral : 264 px, fond `--surface-sidebar`, filet droit 1 px.

## 5. Formes, bordures, ombres

| | Valeur |
|---|---|
| Badges, inputs compacts | radius 6 px |
| Boutons, inputs | radius 8 px |
| Cartes | radius 12 px |
| Modales | radius 16 px |
| Avatars, toggles, pastilles, puces de filtre | radius plein |

- Les cartes n'ont **pas d'ombre**, seulement `1px solid var(--border)`.
- `--shadow-sm` pour les pastilles posées sur une photo (note, « 7 j en ligne »). `--shadow-md` pour ce qui flotte (menu, toast). `--shadow-lg` pour les modales.
- Carte sélectionnée : filet `--accent` + anneau 1 px `--accent`. Aucune autre bordure colorée.

## 6. Composants

### Boutons

| Variante | Fond | Texte | Quand |
|---|---|---|---|
| **Primaire** | `--primary` (encre) | blanc | Action principale d'un formulaire ou d'une carte (« Enregistrer », « Nouvelle recherche ») |
| **Accent** | `--accent` (violet) | blanc | L'action qui fait gagner de l'argent (« Valider l'achat », « Publier directement »). Une par carte, idéalement une par écran. |
| **Brand** | `bg-brand` (dégradé violet) | blanc, icône or | Générateur IA uniquement (« Générer une annonce », « Générer avec l'IA ») |
| **Secondaire** | `--surface` + filet | `--text` | Actions annexes (« Exporter CSV », « Republier ») |
| **Fantôme** | transparent | `--text-muted` | Actions tertiaires (« Suivre », « Écarter », « Supprimer » dans une liste) |
| **Danger** | transparent | `--danger` | Suppression définitive (toujours avec confirmation) |

### Navigation (menu latéral)

- Icônes neutres (`--text-muted`) de 18 px, **aucune tuile colorée**.
- Élément actif : fond `--accent-soft`, texte `--text`, icône `--accent`.
- Compteurs : pastille `--surface-muted`, texte `--text-muted` 11 px ; en violet seulement sur l'élément actif.
- État d'un module (Achat auto) : pastille 6 px (`--success` ou `--border-strong`) + libellé « Activé » / « Arrêté ».
- En tête : un seul bouton `bg-brand` « Générer une annonce ».

### En-tête de page

Sur-titre facultatif (12 px, majuscules, `--text-muted`) → titre 24 px → description `--text-muted` (max ~70 caractères par ligne) ; actions alignées en haut à droite. **Pas de tuile d'icône.**

### Bandeau de démonstration

Une ligne de 32 px, texte 12 px `--text-muted`, pastille violette, filet bas. Pas de fond coloré.

### Indicateurs (`StatStrip`)

Une carte, cellules séparées par des filets. Libellé 13 px `--text-muted` → chiffre 32 px 600 → variation 12 px (`--success` / `--danger`) → sparkline violette facultative. Pas d'icône décorative.

### Alertes

Fond `--surface`, filet `--border` (filet `--danger` à 35 % pour une erreur), icône de statut 16 px. Plusieurs alertes : une seule carte, une ligne par alerte.

### Filtres

- Puces (`FilterChip`) : sans bordure au repos, `--accent-soft` + texte `--accent` quand actives, compteur en `--text-muted`.
- Contrôle segmenté (`Segmented`) : piste filet 1 px, segment actif `--accent-soft` + texte `--accent`.

### Tableaux

- Pas de bordures verticales. Lignes séparées par `--border`, hauteur 48 px (40 px en dense).
- En-tête : 12 px, 500, `--text-muted`. Survol : `--surface-muted`. Ligne sélectionnée : `--accent-soft`.

### Badges

- Statut : fond `--surface-muted`, texte 12 px 500, pastille 6 px colorée.
- Bande de note : neutre (faible, correcte), `--accent-soft` (bonne), `--gold-soft` + `--gold-text` (très bonne, exceptionnelle).

### Champs, cases, toggles

- Champ : 36 px, fond `--surface`, filet `--border-strong`, radius 8 px. Focus : anneau violet `--focus-ring`.
- Case à cocher et curseur : `accent-color` violet. Toggle : off `--border-strong`, on `--accent-vivid`, pastille blanche.

### Messagerie

Bulle reçue : `--surface` + filet. Bulle envoyée : `bg-brand`, texte blanc. Conversation sélectionnée : `--accent-soft`. Non lus : date et compteur en violet. Suggestion de l'IA : filet 1 px `--accent` en pointillés + libellé en `--accent`.

### Graphiques

- Série principale en `--accent-vivid`. Deux séries superposées (CA / marge) : même violet, l'une à 35 % d'opacité.
- Or pour un objectif atteint (jauge du mois) ou un excellent niveau ; jamais comme seconde couleur décorative.
- Grille horizontale seulement, `--border`, 1 px. Barres : radius 4 px. Courbes : 2 px, aire en dégradé violet 20 % → 0.
- Barres de colonnes : la plus haute pleine, les autres à 35 %.

## 7. Icônes et images

- Jeu d'icônes unique : **Lucide** (contour). Tailles 16 px (texte, boutons), 18 px (menu), 20 px (raccourcis). Couleur `currentColor`, par défaut `--text-muted`.
- Pas de tuile d'icône colorée. Exception : tuile discrète (`IconTile`, ton `neutral`, `accent` ou `gold`) pour un état vide ou la galerie de graphiques.
- Les seules images de l'interface sont les **photos d'articles** : ratio 1:1 dans les listes, 4:5 en grille, radius 8–12 px, fond `--surface-muted` pendant le chargement.

## 8. Logo

Le dessin du logo ne change pas. Dans l'application : composant `Logo` (`apps/web/src/components/Logo.tsx`), qui affiche le PNG **noir** en mode clair et le PNG **blanc** en mode sombre (variante Tailwind `dark:`, qui suit à la fois le choix de l'utilisateur et le thème du système).

| Fichier | Quand |
|---|---|
| `selio-logo-noir.png` | Version par défaut, sur fond clair |
| `selio-logo-blanc.png` | Mode sombre, fond encre ou fond `bg-brand` |
| `selio-icone-noir.png` / `-blanc.png` | Symbole seul : favicon, avatar, petits espaces |
| `selio-app-icon-noir.png` | Icône d'application (1024 × 1024) |

- Les fichiers `*-orange.png` sont **retirés** de la charte v3 : ne plus les utiliser.
- Taille minimum 20 px de haut (symbole seul : 16 px). Zone de protection = hauteur du « S » tout autour.
- Interdits : déformer, ajouter une ombre ou un contour, le poser sur une photo, le recolorer (ni violet, ni or).

## 9. Mobile (Expo / React Native)

Mêmes valeurs, en objet JS :

```js
export const colors = {
  bg: '#F5F5F7', surface: '#FFFFFF', surfaceMuted: '#F1F0F4',
  border: '#E7E5EC', borderStrong: '#D6D3DE',
  text: '#1C1A24', textMuted: '#6E6A7B', textSubtle: '#A3A0AE',
  primary: '#1C1A24', onPrimary: '#FFFFFF',
  accent: '#6442D6', accentVivid: '#7C5CEB', accentSoft: '#F5F2FF',
  gold: '#C1933B', goldText: '#7A591A', goldSoft: '#FBF7EC',
  success: '#1D7F4E', warning: '#A15C07', danger: '#B42318',
};
export const colorsDark = {
  bg: '#1A1820', surface: '#23202A', surfaceMuted: '#2D2A35',
  border: '#37333F', borderStrong: '#48434F',
  text: '#EEEBF3', textMuted: '#B4AFC0', textSubtle: '#868193',
  primary: '#EEEBF3', onPrimary: '#1A1820',
  accent: '#B5A3FF', accentVivid: '#9B80F7', accentSoft: 'rgba(155,128,247,0.18)',
  gold: '#E2C67C', goldText: '#E8CF8E', goldSoft: 'rgba(212,172,87,0.16)',
  success: '#5CC896', warning: '#E5B259', danger: '#F0857A',
};
export const font = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' }; // @expo-google-fonts/inter
export const radius = { sm: 6, md: 8, lg: 12, xl: 16 };
```

- Onglet actif de la tab bar : icône + libellé en `accent`, inactif en `textMuted`.
- Le bouton « Générer » de la tab bar reprend le fond de marque (dégradé violet-700 → violet-500), icône or.
- Cibles tactiles : 44 × 44 px minimum. Texte de champ en 16 px (évite le zoom iOS).

## 10. Accessibilité

- Contraste minimum 4,5:1 pour le texte : utiliser `--text-muted` (jamais `--text-subtle`) pour toute information ; `gold-500` et `violet-500` ne sont **jamais** des couleurs de texte sur fond clair.
- Focus visible sur tout élément interactif (`--focus-ring`, anneau violet, global dans `tokens.css`).
- La couleur n'est jamais le seul signal : une note a toujours son chiffre et sa bande en toutes lettres, un statut son libellé, une marge négative son signe « − ».
- Respect de `prefers-reduced-motion` (géré dans `tokens.css`). Animations d'interface : 120–200 ms, opacité et translation.

## 11. Checklist avant de merger un écran

- [ ] Aucun hex en dur, aucun bleu, aucun orange hors de l'ambre `--warning` (icône ou libellé).
- [ ] Icônes neutres, pas de tuile colorée, pas de rangée de cartes KPI (utiliser `StatStrip`).
- [ ] Violet seulement pour l'actif, la sélection, le focus et l'action principale ; or seulement pour l'excellence et le premium.
- [ ] Cartes : filet **ou** ombre, jamais les deux.
- [ ] Chiffres en `tabular-nums`, prix au format `fr-FR`.
- [ ] Testé en mode clair **et** sombre (logo blanc, texte blanc cassé).
- [ ] Testé à 390 px de large.
