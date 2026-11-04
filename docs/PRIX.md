# Estimation des prix

Comment Selio propose un prix : la base de références, les deux moteurs (comparables et modèle entraîné), la combinaison, les trois stratégies, le délai de vente, l'entraînement et ses mesures. Puis comment l'évaluer, ce qu'il faut à Ibrahim, les limites, et qui s'en sert (Studio, Manager, Radar, Track, extension). Prompt §5.10, partie 07 du compte rendu de la réunion 2.

> **État au 4 novembre 2026, après relecture.** Le modèle de prix (`packages/pricing`), le service du cœur (`packages/core/src/services/pricing.ts`), les contrats (`packages/contracts/src/pricing.ts`), la migration 0013, les routes de l'API, les tâches du worker, les écrans web et le panneau de l'extension sont construits et testés ; l'état détaillé fait foi dans [BUILD_STATUS.md](BUILD_STATUS.md). Corrigé après relecture : les ventes d'une organisation ne sont **jamais** servies une à une à une autre (comparables, scans, flux des ventes) et ne sont versées dans la base qu'avec **son accord** (réglage désactivé par défaut) ; ses propres ventes ne comptent plus deux fois ; une vente remboursée ou supprimée sort de la base ; l'entraînement ne lit que des ventes, écarte les prix estimés du mois de test et tourne dans un fil séparé ; Radar n'utilise jamais un modèle de démonstration pour une vraie annonce. **Aucun chiffre de ce document n'est une mesure réelle** : la vraie base de références n'existe pas encore, tout a été construit et testé sur des données synthétiques. L'usage des données issues de Vinted (annonces lues par Track) est **à valider juridiquement** (partie 7 du prompt) : aucune promesse n'est faite à ce sujet.

## En bref

- **Deux moteurs.** Les **comparables** : des ventes proches, retrouvées par le modèle 2 (embeddings des titres), ou à défaut de même marque et catégorie ; on peut les montrer, donc les expliquer. Le **modèle de prix** : un gradient boosting quantile entraîné sur le passé, qui prédit P25, P50 et P75 et le délai de vente.
- **Combinaison.** Plus il y a de comparables, plus ils pèsent : 0,8 × n / 12, plafonné à 80 % dès 12 comparables ; le modèle garde le reste. Sans les deux : « Pas assez de références », aucun prix n'est inventé.
- **Trois stratégies.** Vente rapide (P25), standard (P50), marge maximale (P75), arrondies à x,90, chacune avec un délai estimé.
- **Entraînement** chaque semaine sur le passé, **test sur le dernier mois jamais vu**, et le modèle servi est exactement celui qui a été testé. Moins de 500 ventes avant le mois de test : pas de modèle.
- **Honnêteté.** L'erreur affichée vient du test sur la **vraie** base. Tant qu'elle est vide ou synthétique, l'interface dit « Modèle non entraîné » ou « Données de démonstration », et la confiance reste « faible ».
- **Mon IA perso explique le prix en mots ; elle ne le choisit jamais** (D07). Une explication qui cite un montant ou un chiffre absent des faits est écartée.
- **Aucune donnée personnelle** dans la base : ni pseudo, ni photo, ni titre, ni identifiant d'annonce réutilisable ; dates au jour et nombre de photos par tranches pour Track et les ventes ; base gardée **24 mois**.
- **Ventes des clients** : versées dans la base seulement avec l'accord de l'organisation (Paramètres › IA, **désactivé par défaut**, à valider juridiquement), et seulement pour l'entraînement agrégé du modèle : jamais comme comparables, scans ou flux d'une autre organisation.

## 1. Où vit quoi

| Partie | Où | État |
|---|---|---|
| Modèle de prix : nettoyage, gradient boosting quantile, entraînement et test, prédiction, combinaison, lecture de fichiers, rapport, données synthétiques, `pnpm prix:eval` | `packages/pricing` (TypeScript pur, processeur, `zod` seule dépendance) — détails : [packages/pricing/README.md](../packages/pricing/README.md) | Construit, 59 tests |
| Contrats : référence de prix, caractéristiques, estimation, méthodes, stratégies, état du modèle, textes de l'interface | `packages/contracts/src/pricing.ts` | Construit, testé |
| Base : `price_references` (unique `dedupe_key`, aucune donnée personnelle), `price_models` (un seul « actif ») | `packages/db/migrations/0013_track_pricing.sql`, `repos.priceReferences`, `repos.priceModels` | Construit, testé sur PostgreSQL 16 |
| Service interne : comparables, combinaison, stratégies, explication, références tirées des ventes, entraînement, état du modèle | `packages/core/src/services/pricing.ts` | Construit, testé (base dédiée `selio_test_core_pricing`) |
| Branchements : Studio, Radar, Market | `packages/core/src/services/studio.ts`, `radar.ts`, `market.ts` | Construit, testé |
| Explication et validation de la sortie de mon IA perso | `packages/ai` (`buildPriceExplanationRequest`, `validatePriceExplanation`) | Construit, testé |
| Panneau « Comparables Selio » de l'extension | `apps/extension` (`src/shared/comparables.ts`, `src/content/comparables-panel.ts`, `src/background/comparables.ts`) | Construit, testé (voir §12) |
| Routes `POST /api/pricing/estimate`, `GET /api/pricing/model` (ventes réelles, de démonstration et au prix estimé face au minimum de 500), `GET /api/admin/pricing`, `POST /api/admin/pricing/train`, `POST /api/ext/comparables` ; chargement du modèle actif | `apps/api` | Construit, testé |
| Tâches `pricing.references` (chaque nuit) et `pricing.train` (chaque semaine), entraîneur bâti sur `@selio/pricing` dans un fil séparé (`pricing-train-thread.ts`) | `apps/worker` | Construit, testé |
| Écrans : Studio, fiche article, Radar, Paramètres (état du modèle, **partage des ventes**) | `apps/web` | Construit, testé |

## 2. La base de références

### 2.1 Ce qu'une référence contient, et rien d'autre

Marque, catégorie, sous-catégorie, taille, matière, couleur, état, prix affiché, prix final (quand il est connu), dates de mise en ligne et de vente, nombre de photos, vues et favoris (s'ils sont visibles), source, état de la référence (`listed`, `sold`, `gone`).

**Jamais** : pseudo, profil, photo, titre libre, description, adresse ou identifiant d'annonce réutilisable publiquement. La clé de dédoublonnage est une empreinte (`sale:<sha256>`, `track:<sha256>`). Pour Track, elle est calculée **par la base** (`app_track_store_references`) avec un sel propre (`ref_store_salt`), distinct de celui qui sert à reconnaître une annonce d'une lecture à l'autre : le rôle applicatif, qui peut calculer la clé d'état d'une annonce, ne peut pas en déduire la clé de sa référence. **Moins de quasi-identifiants** : pour les sources `track` et `sale`, dates de mise en ligne et de vente **au jour** (UTC), nombre de photos **par tranches** (0, 1, 2–3, 4–5, 6–9, 10 et plus) ; la base est **effacée après 24 mois** (`PRICE_REFERENCE_RETENTION_MONTHS`, passage de rétention du worker). Les garanties sont tenues par le code, pas seulement par la consigne :

- `PRICE_REFERENCE_KEYS` (contrats) liste les seules clés autorisées ; un test vérifie qu'aucune autre n'apparaît ;
- dans `@selio/pricing`, les champs personnels sont typés `never`, le schéma est strict, une ligne qui en porte un est écartée (`personal_data`) et un **fichier entier** est refusé s'il a une colonne personnelle (`PersonalDataError`) ;
- une vente réelle convertie garde l'organisation qui l'a fournie (`contributor_org_id`), **jamais renvoyée** par l'API, pour être effacée avec elle, et pour que les agrégats lus par une organisation n'en contiennent jamais d'une autre (`source <> 'sale' or contributor_org_id = organisation courante`).

### 2.2 D'où viennent les références

| Source (contrats) | Source (`@selio/pricing`) | D'où | Comment elle arrive |
|---|---|---|---|
| `sale` | `client_sale` | Ventes réelles des clients (commandes payées, expédiées, livrées ou terminées) **des organisations qui l'ont accepté** (`settings.pricing.shareSales`, désactivé par défaut) | `addReferencesFromSales`, chaque nuit par organisation (tâche `pricing.references` du worker) ; ni client, ni titre, ni identifiant de commande. Les ventes devenues inéligibles (remboursée, annulée, supprimée) sont **retirées** au passage suivant ; accord retiré : toutes, tout de suite (audit `pricing.share_sales_disabled`). Servent **seulement à l'entraînement agrégé** du modèle |
| `track` | `track` | Annonces des pages publiques du catalogue lues par Selio Track ([TRACK.md](TRACK.md)) | À chaque lecture d'un filtre suivi ; une annonce **disparue** devient `gone` avec un prix final **estimé** au dernier prix affiché (vendue **ou** retirée) |
| `import` | `provided_base` | Base fournie par Ibrahim | **Pas encore de chargement en base** : la source existe dans le schéma ; aujourd'hui, une base fournie s'évalue avec `pnpm prix:eval` (§9) |
| `demo` | `demo` | Simulateur (Track en mode simulateur, ventes de démonstration) | Jamais compté comme une donnée réelle, **jamais utilisé comme comparable** ; sert à entraîner un modèle « de démonstration » tant que la vraie base est trop petite |
| — | `extension_capture` | Annonces vues par l'extension | **Non utilisé.** Le panneau des comparables de l'extension n'enregistre rien (§11.5) |

### 2.3 Nettoyage

Fait par `@selio/pricing` (`src/clean.ts`) avant tout entraînement ; le détail des règles est dans le [README du paquet](../packages/pricing/README.md#nettoyage-srccleants).

- **Normalisation** : marque (casse, accents, ponctuation, alias courants : « Levi Strauss » = `levis`), catégorie (pluriels simples), taille ramenée sur une échelle commune de XXS à 4XL (lettres, tailles européennes, W, pointures, âges enfants), matière principale d'une composition, couleur principale, état en ordinal, saison tirée de la date.
- **Doublons** : même marque, catégorie, taille, prix affiché et jour de mise en ligne : la ligne vendue la plus complète est gardée.
- **Écartées** : lots, prix sous 1 €, prix au-delà de 50 × la médiane (marque et catégorie, sinon catégorie, sinon base), délai négatif, date future, prix ou date invalide, ligne portant un champ personnel.
- **Rapport** : lignes lues, gardées, vendues et non vendues, écartées par raison, par source.

## 3. Premier moteur : les comparables (explicables)

Les comparables sont des **ventes** dont on connaît le prix final : celles de l'organisation (ses commandes non annulées ni remboursées) et celles de la base de références **lues par Track ou importées** (sources `track` et `import`, prix final connu ou estimé). Jamais le simulateur, et **jamais les ventes versées par une organisation** (`sale`) : celles d'une autre ne sont jamais montrées une à une (avec deux ventes d'une marque rare, P25 et P75 redonneraient leurs prix exacts), les siennes viennent déjà de ses commandes et ne comptent pas deux fois.

Choix pour un article (`selectComparables`) :

1. **Par similarité** (modèle 2) : le titre de l'article et celui des ventes (marque comprise) sont transformés en vecteurs, puis comparés (similarité cosinus). Les 8 plus proches au-dessus de 0,6, dans la même catégorie quand elle est connue. Il en faut **2 au moins**. Les vecteurs sont gardés dans `embeddings_cache` (le cache de Radar, par organisation, sous l'empreinte du texte) ; 200 vecteurs nouveaux au plus par estimation.
2. Sinon, **même marque et même catégorie** : 3 au moins.
3. Sinon, **même marque** : 2 au moins.
4. Sinon, **aucun comparable**.

Les quantiles des prix retenus (P25, P50, P75) sont corrigés par l'état de l'article (neuf avec étiquette × 1,15 … satisfaisant × 0,75, inconnu × 0,95, comme l'estimation de revente de Radar). Le délai est la médiane des délais connus. Le modèle 2 est facultatif : en panne, désactivé ou hors quota, on passe directement à l'étape 2, sans erreur.

Une référence de la base n'a **pas de titre** : son texte comparé est fait de ses attributs (marque, sous-catégorie, catégorie, matière, couleur, taille).

## 4. Second moteur : le modèle de prix entraîné

Gradient boosting quantile écrit à la main dans `@selio/pricing` (aucune bibliothèque d'apprentissage, aucun service extérieur, aucune carte graphique) :

- **Cible** : le logarithme du prix final des références **vendues**.
- **Variables** : encodage cible lissé et calculé hors pli pour la marque, la marque × la catégorie et la sous-catégorie ; catégorie, système de taille, matière, couleur, saison ; état et taille en ordinal ; nombre de photos ; fréquence de la marque. Les vues et favoris ne servent pas à prédire (inconnus avant la mise en ligne).
- **Trois modèles séparés**, un par quantile (τ = 0,25 / 0,5 / 0,75), perte quantile (pinball), profondeur 5, 300 arbres au plus, taux d'apprentissage 0,05, sous-échantillonnage 0,8, arrêt anticipé. Les trois prix sont triés à la prédiction : ils ne se croisent jamais.
- **Graine fixe** : même base, même graine → même modèle, octet pour octet ; mêmes prédictions au bit près après rechargement du JSON.
- **Facteurs d'explication** (marque, état, taille, saison, matière, erreur du modèle) : l'effet de chacun sur le prix médian par rapport à une valeur neutre. Ce sont ces faits, et eux seuls, que reçoit mon IA perso.

## 5. Combinaison

| Situation | Méthode affichée | Poids |
|---|---|---|
| Comparables **et** modèle | `blend` — « Ventes comparables et modèle de prix » | comparables : 0,8 × min(1, n / 12) ; modèle : le reste |
| Comparables par similarité seuls (pas de modèle) | `embeddings` — « Ventes proches (similarité des titres) » | comparables 100 % |
| Comparables de marque et catégorie seuls | `comparables` — « Ventes de même marque et catégorie » | comparables 100 % |
| Modèle seul (aucun comparable) | `model` — « Modèle de prix » | modèle 100 % |
| Ni l'un ni l'autre | `none` — « Pas assez de références » | aucun prix |

Exemples de poids : 1 comparable → 7 % ; 6 → 40 % ; 12 ou plus → 80 %. La combinaison se fait quantile par quantile (P25 avec P25…). La confiance (faible, moyenne, élevée) suit la même pondération ; celle du modèle reste **faible** tant qu'il n'a pas d'erreur mesurée sur de vraies données.

## 6. Trois stratégies

| Stratégie | Prix | Pour qui |
|---|---|---|
| **Vente rapide** | P25 | Vendre vite, quitte à laisser un peu de marge |
| **Standard** | P50 | Le prix du milieu des ventes comparables |
| **Marge maximale** | P75 | Attendre l'acheteur qui paiera plus |

Chaque prix est arrondi au prix psychologique le plus proche finissant par 90 centimes (27,43 € → 27,90 € ; 26,90 € reste 26,90 €), jamais sous 1 €. **Studio** relève en plus chaque prix au **plancher** de l'organisation quand le prix d'achat est connu (prix d'achat + marge minimale) et le signale ; il garde le prix d'achat et le plancher de l'article. Les stratégies sont des **propositions** : le vendeur choisit et peut tout changer.

## 7. Délai de vente

- Le modèle de délai est le même gradient boosting, au quantile 0,5 sur log(1 + jours), avec deux variables de plus (délai typique de la marque, écart entre le prix affiché et le prix typique). Il donne un délai médian **à chacun des trois prix**.
- Côté comparables : médiane des délais connus (mise en ligne → vente).
- Les deux sont combinés avec les mêmes poids que le prix. Inconnu : rien n'est affiché.
- **Limite** : seules les ventes conclues apprennent le délai (pas de traitement de la censure). Au début, les délais longs sont sous-estimés.

## 8. Entraînement, test et ré-entraînement

1. **Chaque nuit** (02:30 UTC, `CRON_PRICING_REFERENCES`) : les ventes des organisations **qui l'ont accepté** entrent dans la base de références, sans donnée personnelle ; les ventes devenues inéligibles et celles des organisations sans accord en sortent (tâche `pricing.references` du worker).
2. **Chaque dimanche** (04:00 UTC, `PRICING_TRAIN_CRON`), ou à la demande d'un opérateur (`POST /api/admin/pricing/train`, mise en file pour le worker), le worker lance `trainActiveModel` :
   - Seulement les **ventes** (prix final connu ou estimé, 200 000 au plus, les plus récentes d'abord) : une annonce encore en ligne n'apprend rien au modèle de prix et ne compte pas dans le seuil. Ventes **réelles** (`sale`, `track`, `import`) si elles atteignent `PRICING_MIN_REFERENCES` (500 au moins) ; sinon celles du **simulateur**, et le modèle est enregistré « données de démonstration » (`synthetic`). Sous le seuil des deux côtés : aucun modèle.
   - Entraînement sur le passé, **test sur les 30 derniers jours jamais vus**. Refus sous **500 ventes** avant le mois de test.
   - **Prix estimés** (annonces disparues de Track, `finalPriceEstimated`) : **jamais dans le mois de test** (l'erreur publiée ne porte que sur des ventes au prix réel) ; à l'entraînement **seulement à défaut** de 500 ventes au prix réel. Le rapport et les mesures enregistrées le disent (`estimatedTrain`, `estimatedExcludedFromTest`).
   - Le nouveau modèle devient le seul « actif » (`price_models`, l'ancien est archivé) ; le worker le recharge aussitôt, l'API **toutes les heures** et à son démarrage.
3. **Modèle servi = modèle testé** : aucun ré-ajustement sur le dernier mois. Il ignore donc les 30 derniers jours jusqu'au ré-entraînement suivant. Choix voulu : l'erreur affichée est celle du modèle réellement utilisé.

L'entraînement tourne dans un **fil d'exécution séparé** du worker (`worker_threads`, `ThreadedPriceTrainer`) : la boucle d'événements (Radar toutes les 30 s, Cloud, Track, fenêtres de connexion) reste libre pendant le calcul (≈ 6 s pour 20 000 références et ≈ 37 s pour 100 000 sur le poste de développement, **à mesurer sur la machine de Marseille**). Au-delà de `PRICING_TRAIN_MAX_MS` (10 min par défaut), le fil est arrêté, l'entraînement est « interrompu » et l'ancien modèle reste actif. Un seul entraînement à la fois.

## 9. Mesures suivies

Calculées sur le **dernier mois jamais vu**, à chaque entraînement :

| Mesure | Ce qu'elle dit |
|---|---|
| **MdAPE** (erreur médiane en %) | La moitié des estimations P50 sont à moins de cet écart du prix réel |
| **MAPE** (erreur moyenne en %) | Sensible aux grosses erreurs |
| **Part à ±20 %** | Part des estimations P50 à moins de 20 % du prix réel |
| **Couverture P25–P75** | Part des prix réels dans l'intervalle ; viser ≈ 50 % (sinon l'intervalle est trop large ou trop étroit) |
| **Erreur de référence** | MdAPE de la simple médiane marque × catégorie : le modèle doit faire mieux |
| **Erreur du délai** | Erreur médiane et moyenne, en jours |
| Volumes | Ventes utilisables, d'entraînement, de validation, de test ; arbres retenus ; durée |

Où les lire :

- `pnpm prix:eval` imprime le rapport complet (§10) ;
- le journal du worker après chaque entraînement : « prix : modèle entraîné, testé sur le dernier mois et chargé » avec MdAPE, part à ±20 % et couverture, ou « … sur les données de DÉMONSTRATION (aucune mesure réelle) » ;
- `GET /api/pricing/model` (état pour l'interface : mesures **seulement** si le modèle a été testé sur de vraies données) et `GET /api/admin/pricing` (opérateurs : modèles enregistrés et base par source) ;
- Paramètres de l'application (écran livré en parallèle : voir BUILD_STATUS).

Une mesure n'est jamais remplacée par 0 : sans assez de ventes de test, elle vaut `null` et l'interface dit « erreur non mesurée ».

## 10. Les seuils « insuffisant »

| Seuil | Effet |
|---|---|
| Moins de **500 ventes** avant le mois de test (`PRICE_MODEL_MIN_REFERENCES`, `PRICING_MIN_REFERENCES`) | Aucun modèle entraîné ; « Modèle non entraîné » ; les comparables travaillent seuls |
| Moins de **30 ventes** dans le mois de test | Modèle entraîné, mais erreur « non mesurée » (`null`) |
| Base réelle sous le seuil, simulateur au-dessus | Modèle « Données de démonstration » : confiance faible, mesures jamais présentées comme réelles |
| Moins de **2** ventes proches par similarité | Repli sur marque et catégorie |
| Moins de **3** ventes de même marque et catégorie, puis moins de **2** de même marque | Aucun comparable |
| Ni comparable ni modèle | « Pas assez de références pour proposer un prix : fixez-le à la main. » |
| Scan de niche Track : moins de **10** références ou **3** ventes sur 90 jours | « Données insuffisantes », aucune note, **aucun prix ni délai** (seulement les volumes), rien n'est décompté du quota, **20 par jour** au plus ([TRACK.md](TRACK.md)) |

## 11. Évaluer sur une base : `pnpm prix:eval`

Aucune donnée n'est fournie dans le dépôt, et le script ne fait aucune requête réseau. Depuis la racine :

```bash
pnpm prix:eval chemin/references.csv --out chemin/modele-prix.json   # CSV ou JSON
pnpm prix:eval chemin/references.csv --backtest                      # + 4 fenêtres d'un mois
pnpm prix:eval --synthetic 20000                                     # données SYNTHÉTIQUES (source demo)
```

Options : `--now AAAA-MM-JJ` (fin du mois de test ; par défaut la date la plus récente du fichier), `--seed 42`, `--holdout 30`, `--backtest [n]`, `--source provided_base` (source des lignes qui n'en ont pas), `--out` (par défaut `<fichier>.modele-prix.json` à côté du fichier lu ; avec `--synthetic`, rien n'est écrit sans `--out`). Codes de sortie : 0 modèle entraîné, 1 erreur, **2 moins de 500 ventes** (modèle non écrit).

### 11.1 Format du fichier

CSV avec en-tête (séparateur `,` `;` ou tabulation, colonnes en camelCase ou snake_case), ou JSON (tableau d'objets, ou `{ "references": [...] }`). **Toute colonne inconnue est refusée, et le fichier entier est refusé s'il contient une colonne personnelle** (pseudo, vendeur, identifiant, adresse, photo, titre…).

| Colonne | Obligatoire | Contenu |
|---|---|---|
| `category` | oui | catégorie (texte libre, ex. « Jeans ») |
| `listedPriceCents` ou `listedPriceEur` | oui | prix affiché (centimes entiers, ou euros « 29,90 ») |
| `listedAt` | oui | date ISO 8601 de mise en ligne |
| `brand` | non (vide = sans marque) | marque |
| `subcategory`, `size`, `material`, `color` | non | texte libre |
| `condition` | non (vide = inconnu) | `new_with_tags`, `new_without_tags` (ou `new`), `very_good`, `good`, `satisfactory`, ou le libellé français |
| `finalPriceCents` ou `finalPriceEur` | non | prix final de vente |
| `soldAt` | non | date ISO 8601 de vente (vide = non vendue) |
| `photoCount`, `views`, `favorites` | non | entiers |
| `source` | non | `client_sale`, `extension_capture`, `track`, `provided_base` (défaut), `demo` |

```csv
brand;category;subcategory;size;material;color;condition;listedPriceCents;finalPriceCents;listedAt;soldAt;photoCount;source
Levi's;Jeans;Jean droit;W32 L32;denim;bleu;Très bon état;3500;3000;2026-09-02;2026-09-14;6;provided_base
Zara;Robes;Robe midi;38;viscose;vert;Bon état;1800;;2026-10-01;;4;provided_base
```

(Valeurs fictives.)

### 11.2 Lire le rapport

Le rapport s'imprime dans le terminal, en français : nettoyage (lignes gardées et écartées par raison, sources), origine des données (« réelles » ou « DÉMONSTRATION »), dates du mois de test, volumes, arbres retenus, puis les mesures du §9 pour le prix et le délai, le backtest s'il est demandé, les remarques et la durée. Le modèle JSON (≈ 1 Mo pour 20 000 références) est écrit dans le fichier `--out`. Ce fichier ne contient que des statistiques et des arbres : aucune ligne de la base.

## 12. Ce qu'il faut à Ibrahim

- **Une base de références**, au format du §11.1, sans aucune colonne personnelle. Idéalement des **ventes conclues** (prix final et dates de mise en ligne et de vente), sur plusieurs mois.
- **Combien** : 500 ventes **avant** le dernier mois, au strict minimum pour qu'un modèle soit entraîné, et au moins 30 ventes dans le dernier mois pour qu'une erreur soit mesurée. Pour des mesures stables, viser **plusieurs milliers** de ventes, dont plus d'un millier dans le dernier mois (la simulation de référence utilise 20 000 références, dont ≈ 1 500 ventes testées). Plus la base couvre de marques et de catégories, moins le repli sur la médiane est fréquent.
- **D'où** : la provenance de la base fournie et le droit de s'en servir sont à confirmer ; l'usage des données issues de Vinted (Track) attend l'avis de l'avocat.
- **Une décision** : le partage des ventes des clients avec la base commune (réglage d'organisation, désactivé par défaut) et le texte de l'accord dans les conditions de vente, **à faire valider par l'avocat** avant de le proposer aux clients.
- **La machine** : **processeur seul**. Ni carte graphique, ni service payant, ni bibliothèque d'apprentissage. L'entraînement prend quelques secondes par semaine, une prédiction moins d'une milliseconde (mesures du poste de développement, à refaire sur la machine de Marseille avec `pnpm prix:eval --synthetic 20000`). La carte graphique ne sert qu'aux modèles d'Ollama : le modèle 2 (similarité des titres) et mon IA perso (explication), tous deux facultatifs pour l'estimation.
- **À faire de notre côté** pour qu'une base fournie serve en production : un chargement dans `price_references` (source `import`), qui n'existe pas encore.

## 13. Limites honnêtes

- **Rien n'est mesuré sur le vrai marché.** Sur 20 000 références synthétiques (graine 7), testées sur le dernier mois : erreur médiane ≈ 18 %, ≈ 54 % des estimations à ±20 %, ≈ 50 % des prix réels dans l'intervalle P25–P75, contre ≈ 26 % d'erreur médiane pour la médiane marque × catégorie. Ces chiffres décrivent **le générateur**, pas le marché.
- **Un plancher d'erreur d'environ 17 %**, voulu dans la simulation (comme dans celle du compte rendu) : deux articles de même marque, catégorie, taille et état ne se vendent pas au même prix (photos, saison, vendeur, chance). Aucun modèle ne descend sous ce bruit. Sur la vraie base, ce plancher est **à mesurer** ; il pourrait être plus haut.
- **« Disparue » n'est pas « vendue »** : une annonce de Track qui disparaît peut avoir été retirée. Son prix final est **estimé** au dernier prix affiché et marqué comme tel ; ces références pèsent autant que les autres dans les comparables, ce qui peut tirer les prix vers le haut. Elles ne servent jamais à mesurer l'erreur du modèle, et à l'entraîner seulement à défaut d'assez de ventes au prix réel (§8).
- **Catégories larges** (femme, homme, enfant, chaussures, sacs, accessoires, maison, électronique, autre) côté Selio : la sous-catégorie fait la finesse, quand elle est connue.
- **Sans catégorie** (cas du panneau de l'extension, §14), les comparables sont cherchés dans toutes les catégories et le modèle prédit comme pour « autre » : l'estimation est moins précise, et le dit par sa méthode et sa confiance.
- **Délai** : seules les ventes conclues l'apprennent (censure non traitée).
- **Le modèle ignore les 30 derniers jours** jusqu'au ré-entraînement suivant (§8).
- **Vecteurs par organisation** : les références sont ré-embarquées par chaque organisation (200 au plus par estimation) ; un cache partagé demanderait une nouvelle table.
- **Fuseau** : saison et dédoublonnage en UTC.

## 14. Qui s'en sert

| Module | Usage |
|---|---|
| **Studio** | Après la rédaction de l'annonce : les trois stratégies (standard proposée, vente rapide et marge maximale en fourchette), la méthode, le nombre de comparables, l'explication en mots ; prix relevé au plancher si besoin ; alertes « peu de ventes comparables », « données de démonstration ». Sans estimation (panne, aucune référence), le calcul d'avant s'applique. |
| **Manager** | Fiche et formulaire d'un article : estimation à la demande (`POST /api/pricing/estimate`), écrans livrés en parallèle (voir BUILD_STATUS). |
| **Radar** | Revente estimée de chaque annonce lue (`pricing.estimateMany`, un seul chargement et une seule passe d'embeddings par lecture), méthodes affichées : ventes proches, marque et catégorie, modèle, combinaison ; repli prudent sans estimation. Sur une **vraie** annonce (lecture en direct), un modèle entraîné sur les données de démonstration n'est **jamais** utilisé : comparables réels seuls, sinon repli prudent (la marge, la note, les alertes et Radar Auto ne reposent jamais sur le simulateur). |
| **Track** | Recherche par photo (description par le modèle 1, puis estimation avec explication), niches et tendances ([TRACK.md](TRACK.md)). |
| **Extension** | Panneau « Comparables Selio » sur une page article : fourchette P25 / P50 / P75, trois stratégies, délai, nombre de comparables, méthode, position du prix affiché (`POST /api/ext/comparables`, Pro et Agence, **sans explication** par mon IA perso). Seuls le titre, la marque, la taille, l'état et le prix partent (la catégorie n'est pas lue par l'adaptateur v1 et part vide) ; rien n'est enregistré. Voir [EXTENSION-INSTALL.md](EXTENSION-INSTALL.md). |

## 15. L'IA explique, elle ne décide pas

- Les prix viennent **uniquement** des comparables et du modèle (§3 à §6). Mon IA perso reçoit les trois prix, la méthode, le nombre de comparables, le délai, la confiance et les facteurs, avec la consigne de ne rien modifier et de ne rien inventer.
- Sa sortie est **relue** (`validatePriceExplanation`) : un montant autre que les trois prix, ou un chiffre absent des faits, fait **écarter** l'explication. Elle n'est jamais bloquante : sans IA, désactivée, hors quota, en panne ou écartée, l'estimation s'affiche sans explication.
- Chaque explication compte dans le quota IA du mois, comme une requête de résumé (`summary`).
- Le vocabulaire de l'interface : « mon IA perso » ; jamais « prix garanti » ni « prix juste » : une **estimation**.
