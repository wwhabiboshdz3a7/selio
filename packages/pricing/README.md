# @selio/pricing — le modèle de prix

Estimation des prix de Selio (§5.10 du prompt, partie 07 du compte rendu de la réunion 2), en TypeScript pur, sur le processeur, sans dépendance hors `zod`. Ce paquet ne touche ni à la base, ni au réseau, ni à l'IA : le cœur (`@selio/core`) lui fournit les références, stocke le modèle JSON et appelle mon IA perso pour mettre l'explication en mots.

> **État au 30 octobre 2026.** Construit et testé sur des données **synthétiques** seulement. **Aucun chiffre n'est une mesure réelle** : la base de références réelle n'existe pas encore. L'usage des données issues de Vinted (annonces vues par l'extension ou par Track) est **à valider juridiquement** (avis de l'avocat, partie 7 du prompt) ; ce paquet ne collecte rien lui-même.

## Les règles tenues par le code

- **Aucune donnée personnelle.** Une référence ne contient que : marque, catégorie, sous-catégorie, taille, matière, couleur, état, prix affiché, prix final (quand il est connu), dates, nombre de photos, vues et favoris (si visibles), source. Ni pseudo, ni identifiant ou adresse d'annonce, ni photo, ni titre.
  - le type `PriceReference` interdit ces champs (`never`) ;
  - le schéma `priceReferenceSchema` est strict (toute clé inconnue est refusée) ;
  - `cleanReferences` écarte une ligne qui en porterait un (raison `personal_data`) et ne recopie que les champs autorisés ;
  - `parseReferencesCsv` / `parseReferencesJson` refusent le **fichier entier** s'il contient une colonne ou une clé personnelle (`PersonalDataError`).
- **Rien n'est présenté comme mesuré sans mesure.** L'erreur vient du test sur le **dernier mois jamais vu** ; moins de 30 ventes dans ce mois → métriques `null` (« erreur non mesurée »). Des références `demo` → `dataOrigin` ≠ `"real"` → l'interface affiche « données de démonstration » (`modelStatus`, `MODEL_STATUS_LABELS`). La confiance d'une prédiction reste « faible » tant que le modèle n'a pas d'erreur mesurée sur de vraies données.
- **Mon IA perso explique, elle ne décide pas** (D07). `blendEstimate` produit les prix, les faits chiffrés (`facts`) et les consignes (`rules` : « ne modifie pas les prix, n'invente aucun chiffre ») ; le texte de l'IA ne change jamais un prix. Un texte de repli déterministe (`summary`) existe si l'IA est indisponible.
- **Déterminisme.** Tout tirage passe par un générateur à graine (`createRng`) ; même base, même graine → même modèle JSON, octet pour octet.

## La méthode

```
références ──▶ cleanReferences ──▶ ventes du passé ──▶ 4 modèles (GBM) ──▶ test sur le dernier mois
                (normalisation,       (avant le mois       P25, P50, P75        MdAPE, MAPE, ±20 %,
                 doublons, lots,       de test)            + délai médian       couverture P25–P75,
                 aberrations)                                                    erreur du délai
article ──▶ predictPrice (P25 / P50 / P75, délai, facteurs) ──┐
ventes proches (modèle 2) ──▶ summarizeComparables ───────────┴─▶ blendEstimate ──▶ 3 stratégies + explication
```

### Nettoyage (`src/clean.ts`)

| Étape | Règle |
|---|---|
| Marque | casse, accents, apostrophes, ponctuation et espaces retirés ; alias courants (`DEFAULT_BRAND_ALIASES` : « Levi Strauss » → `levis`, « TNF » → `thenorthface`…), complétés par `brandAliases` ; vide ou « sans marque » → `sansmarque` |
| Catégorie | texte normalisé, pluriels simples retirés (« Jeans » = « jean ») ; une catégorie « lot » est écartée |
| Taille | classe ordinale commune de 0 (XXS) à 8 (4XL+) : lettres (« S/M » = 2,5), tailles européennes (38 = M), tour de taille (W32 = L), pointures (35 → 0, 47 → 8) ; âge pour les enfants ; −1 si inconnue ou taille unique |
| Matière, couleur | matière principale d'une composition (« 80 % coton 20 % polyester » → coton), couleur principale |
| État | neuf avec étiquette (4) > neuf sans étiquette (3) > très bon (2) > bon (1) > satisfaisant (0) ; absent → −1 ; illisible → écarté |
| Saison | depuis la date de mise en ligne (hiver, printemps, été, automne) |
| Doublons | même marque, catégorie, taille, prix affiché et jour de mise en ligne : la ligne vendue la plus complète est gardée |
| Aberrations | prix < 1 €, prix > 50 × la médiane de la marque et de la catégorie (à défaut de la catégorie, puis de toute la base), délai négatif, date future, prix ou date invalide |

Le rapport (`CleaningReport`) compte les lignes gardées, vendues, non vendues et écartées par raison.

### Modèle (`src/gbm.ts`, `src/features.ts`, `src/train.ts`)

- **Cible** : logarithme du prix final (à défaut, prix affiché d'un article vendu). Seules les références **vendues** entrent dans le modèle de prix.
- **Variables** : encodage cible lissé (moyenne du log-prix rapprochée de l'a priori, `targetSmoothing` = 20) pour la marque, la marque × la catégorie (a priori : la marque) et la sous-catégorie (a priori : la catégorie), calculé **hors pli** (5 plis) à l'entraînement ; modalités (catégorie, système de taille, matière, couleur, saison) ; ordinaux (état, taille) ; nombre de photos ; fréquence de la marque. Les vues et favoris ne servent pas à prédire (inconnus avant la mise en ligne).
- **Gradient boosting maison** : histogrammes de 64 classes au plus par variable numérique, variables modales en « une modalité contre les autres » (équivalent one-hot), perte quantile (pinball) avec feuilles au τ-quantile des résidus, profondeur 5, 300 arbres au plus, taux d'apprentissage 0,05, sous-échantillonnage 0,8, arrêt anticipé (30 arbres sans progrès) sur 15 % des ventes d'entraînement tirées à graine.
- **Trois modèles séparés** (τ = 0,25 / 0,5 / 0,75) plutôt qu'un modèle à plusieurs sorties : chacun choisit ses séparations ; les quantiles sont triés à la prédiction pour ne jamais se croiser.
- **Délai de vente** : même GBM, quantile 0,5 sur log(1 + jours), avec deux variables de plus (délai typique de la marque, écart entre le prix affiché et le prix typique). Il donne le délai médian à chacun des trois prix.
- **Entraînement et test** : `trainPriceModel(références, { now, seed, holdoutDays = 30 })` entraîne sur les ventes antérieures au dernier mois et teste sur ce mois. Le modèle renvoyé est **exactement** celui qui a été testé. Refus sous **500 ventes** avant le mois de test (`report.insufficient`, modèle `null`). Backtest glissant optionnel (`backtest: true` → 4 fenêtres d'un mois).
- **Sérialisation** : JSON versionné (`format: "selio-price-model"`, `version: 1`), environ 1 Mo pour 20 000 références ; `loadPriceModel` le vérifie ; les prédictions après rechargement sont identiques au bit près.
- **Vitesse** : environ 6 s d'entraînement pour 20 000 références, environ 0,2 ms par prédiction (mesuré sur le poste de développement, pas sur la machine de Marseille).

### Comparables et combinaison (`src/blend.ts`)

- Poids des comparables : 0 comparable → modèle seul ; 0,8 × n / 12 entre les deux ; **≥ 12 comparables → 80 %**. Sans modèle entraîné : comparables seuls ; sans rien : méthode `none`.
- Combinaison quantile par quantile (P25 avec P25, etc.).
- Stratégies : **vente rapide = P25**, **standard = P50**, **marge maximale = P75**, arrondies au prix psychologique le plus proche (x,90 par défaut, x,99 ou sans arrondi), jamais sous 1 €, chacune avec son délai estimé.
- Explication : facteurs (marque, état, taille, saison, matière, nombre de comparables, erreur du modèle), chacun avec son effet sur le prix médian par rapport à une référence neutre, plus les faits chiffrés et les consignes pour mon IA perso.

## Utilisation

```ts
import { trainPriceModel, loadPriceModel, predictPrice, summarizeComparables, blendEstimate, modelStatus } from "@selio/pricing";

const { model, report } = trainPriceModel(references, { now: new Date(), seed: 42 }); // model null sous 500 ventes
// … le cœur stocke serializePriceModel(model) et report.metrics ; chaque semaine, nouvel entraînement.

const m = loadPriceModel(json);
const prediction = predictPrice(m, { brand: "Levi's", category: "Jeans", size: "W32", condition: "very_good" }, { explain: true });
const comparables = summarizeComparables(pricesOfNearestSales, delaysOfNearestSales); // modèle 2, côté cœur
const estimate = blendEstimate({ comparables, model: prediction }); // stratégies, confiance, explication
modelStatus(m); // "not_trained" | "demo_data" | "unmeasured" | "measured"
```

`@selio/pricing/synthetic` (`generateSyntheticReferences`) produit des références de démonstration (source `demo`) pour les tests, le script et une éventuelle démo ; jamais pour de vrais clients.

## Évaluer sur une base : `pnpm prix:eval`

Aucune donnée n'est fournie dans le dépôt. Depuis la racine :

```bash
pnpm prix:eval chemin/references.csv --out chemin/modele-prix.json   # CSV ou JSON
pnpm prix:eval chemin/references.csv --backtest                      # + 4 fenêtres d'un mois
pnpm prix:eval --synthetic 20000                                     # données SYNTHÉTIQUES (demo)
```

Options : `--now AAAA-MM-JJ` (fin du mois de test ; par défaut la date la plus récente du fichier), `--seed 42`, `--holdout 30`, `--backtest [n]`, `--source provided_base` (source des lignes qui n'en ont pas), `--out` (par défaut `<fichier>.modele-prix.json` à côté du fichier lu ; avec `--synthetic`, rien n'est écrit sans `--out`). Code de sortie 2 sous 500 ventes (modèle non écrit).

### Format attendu

En-tête obligatoire, séparateur `,` `;` ou tabulation, colonnes en camelCase ou snake_case. Toute autre colonne est refusée, et le fichier entier est refusé s'il contient une colonne personnelle (pseudo, vendeur, identifiant, url, photo, titre…).

| Colonne | Obligatoire | Contenu |
|---|---|---|
| `brand` | non (vide = sans marque) | marque |
| `category` | oui | catégorie |
| `subcategory`, `size`, `material`, `color` | non | texte libre |
| `condition` | non (vide = inconnu) | `new_with_tags`, `new_without_tags` (ou `new`), `very_good`, `good`, `satisfactory`, ou le libellé français |
| `listedPriceCents` ou `listedPriceEur` | oui | prix affiché (centimes entiers, ou euros « 29,90 ») |
| `finalPriceCents` ou `finalPriceEur` | non | prix final de vente |
| `listedAt` | oui | date ISO 8601 de mise en ligne |
| `soldAt` | non | date ISO 8601 de vente (vide = non vendue) |
| `photoCount`, `views`, `favorites` | non | entiers |
| `source` | non | `client_sale`, `extension_capture`, `track`, `provided_base` (défaut), `demo` |

Exemple (valeurs fictives) :

```csv
brand;category;subcategory;size;material;color;condition;listedPriceCents;finalPriceCents;listedAt;soldAt;photoCount;source
Levi's;Jeans;Jean droit;W32 L32;denim;bleu;Très bon état;3500;3000;2026-09-02;2026-09-14;6;provided_base
Zara;Robes;Robe midi;38;viscose;vert;Bon état;1800;;2026-10-01;;4;provided_base
```

En JSON : un tableau d'objets avec les mêmes clés (camelCase), ou `{ "references": [...] }`.

## Sur données synthétiques (repère, pas une mesure)

20 000 références synthétiques (graine 7), test sur le dernier mois (≈ 1 500 ventes) : erreur médiane ≈ 18 %, ≈ 54 % des estimations à ±20 %, ≈ 50 % des prix réels dans l'intervalle P25–P75, contre ≈ 26 % d'erreur médiane pour la médiane de la marque et de la catégorie. Le bruit propre à chaque article est réglé pour que l'erreur ne descende pas sous ≈ 17 %, comme dans la simulation du compte rendu. **Ces chiffres décrivent le générateur, pas le marché** : les vraies valeurs viendront de la vraie base.

## Commandes

- `pnpm --filter @selio/pricing test` : tests (dont un entraînement sur 20 000 références synthétiques, une dizaine de secondes).
- `pnpm --filter @selio/pricing typecheck`
- `pnpm prix:eval …` : voir plus haut.

## Ce qui n'est pas fait

- **Aucune donnée réelle** : erreur, couverture et délais restent à mesurer sur la vraie base (ventes des clients, annonces vues par l'extension et par Track, base fournie par Ibrahim), après l'avis de l'avocat sur les données issues de Vinted.
- **Censure du délai** : seules les ventes conclues apprennent le délai ; un article encore en ligne n'est pas compté (les délais longs sont sous-estimés au début).
- **Pas de ré-entraînement sur le dernier mois** : le modèle servi est celui qui a été testé ; il ignore donc les 30 derniers jours jusqu'au ré-entraînement suivant (hebdomadaire, côté worker).
- **Fuseau** : saison et jour de dédoublonnage en UTC (écart d'une heure ou deux avec Paris, sans effet notable).
