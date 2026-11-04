# Selio Track

Selio Track analyse le marché pour les offres Pro et Agence : filtres suivis et relus toutes les 2 h, tendances, annonces disparues, scans de niche notés sur 100, recherche par photo, flux des ventes (Agence) et comparables dans le panneau de l'extension. **Statistiques seulement** : Track ne republie aucune annonce et ne garde ni photo d'annonce ni pseudo. Ce document décrit ce que fait le code, les règles, les quotas, ce qui n'est pas fait, et la procédure d'activation de la lecture en direct après l'avis de l'avocat. L'estimation des prix sur laquelle Track s'appuie est décrite dans [PRIX.md](PRIX.md).

> **État au 4 novembre 2026, après relecture.** Les contrats (`packages/contracts/src/track.ts`), la migration 0013, le service du cœur (`packages/core/src/services/track.ts`), les routes de l'API, le passage du worker, les pages web `/track` et le panneau de l'extension sont construits et testés, sur PostgreSQL local et sur des pages locales ; l'état détaillé fait foi dans [BUILD_STATUS.md](BUILD_STATUS.md). Corrigé après relecture : quotas contrôlés sous verrou dans la transaction qui réserve la place, empreinte retirée qui garde sa place 2 h, ralentissement qui redescend vraiment d'un cran par 24 h, disparitions jugées sur la page entière, catégorie du filtre jamais recopiée, références moins identifiables (dates au jour, photos par tranches, clé à sel propre, 24 mois), scans insuffisants sans chiffres, recherche par photo refusée sans modèle de vision. **Par défaut, la source est le simulateur** (`TRACK_LIVE_ENABLED=false`) : les données affichées sont alors marquées « données de démonstration ». **Aucune page de Vinted n'a jamais été lue par Track.** L'usage des données issues de Vinted est **à valider juridiquement** (avis de l'avocat attendu, partie 7 du prompt) : la lecture en direct reste fermée tant que cet avis n'est pas rendu, et rien n'est promis à ce sujet.

## En bref

- Le client **suit des filtres** (mêmes critères qu'une recherche Radar). Deux clients qui suivent les mêmes critères partagent **une seule lecture** : l'empreinte normalisée des critères est commune.
- Chaque empreinte est relue **toutes les 2 h** (± 10 min). Chaque lecture produit un **instantané** : nombre d'annonces, prix médian, P25 et P75, nouvelles annonces, annonces disparues, parts des marques. Aucune annonce n'est gardée.
- Une annonce **disparue** entre deux lectures (vendue **ou** retirée) devient une référence de prix au prix final **estimé**, toujours présentée comme une estimation.
- **Niches** (marque × catégorie) notées de 0 à 100 : demande, vitesse, concurrence, marge. Sous un volume minimal : « données insuffisantes », sans note et sans décompter le quota.
- **Recherche par photo** : le modèle 1 décrit l'article, l'estimation des prix donne la fourchette et les trois stratégies. **La photo n'est jamais conservée.**
- **Agence** : flux des ventes par marque et catégorie (sans vendeur). L'analyse d'un vendeur concurrent est **à valider juridiquement (RGPD)** : seul un écran d'explication existe.
- **Source** : le simulateur par défaut. La lecture en direct des pages **publiques** du catalogue passe par le lecteur de Selio Cloud, sans session, avec les garde-fous de Radar, derrière `TRACK_LIVE_ENABLED=false`.

## 1. Où vit quoi

| Partie | Où | État |
|---|---|---|
| Contrats : filtres, empreinte, instantanés, tendances, scans, recherches par photo, flux des ventes, textes de l'interface (« Track est compris à partir de Pro », mention juridique, « estimation », « données de démonstration », « données insuffisantes ») | `packages/contracts/src/track.ts`, quotas dans `org.ts` (`PLAN_QUOTAS`) | Construit, testé |
| Base : `track_filters`, `track_scans`, `track_photo_searches` (organisation, RLS forcée) ; `track_snapshots`, `price_references` (partagées, sans donnée personnelle) ; `track_filter_reads`, `track_runtime` (partagées, **aucun droit direct** pour l'application : onze fonctions `SECURITY DEFINER` seulement) | `packages/db/migrations/0013_track_pricing.sql`, `packages/db/src/repos.ts` | Construit, testé sur PostgreSQL 16 |
| Service : filtres et quotas, empreinte, rythme, lecture (simulateur ou pages publiques), disparitions, instantanés, tendances, scans, recherche par photo, flux des ventes, analyse d'un vendeur (refusée), rétention | `packages/core/src/services/track.ts` | Construit, testé (base dédiée `selio_test_core_track`) |
| Section « Track » de la page marché (niches, sans vendeur) | `packages/core/src/services/market.ts` | Construit, testé |
| Panneau « Comparables Selio » sur une page article | `apps/extension` | Construit, testé |
| Routes `/api/track/*` (filtres, tendances, scans, recherche par photo, flux des ventes, analyse d'un vendeur, utilisation), `POST /api/ext/comparables` | `apps/api` | Livré en parallèle : voir BUILD_STATUS |
| Passage `track.tick` (toutes les 15 min), lecteur des pages publiques `CloudTrackReader`, rétention | `apps/worker` | Livré en parallèle : voir BUILD_STATUS |
| Pages `/track` (tableau de bord, filtres, détail, niches, photo, ventes, vendeurs) | `apps/web` | Livré en parallèle : voir BUILD_STATUS |

## 2. Fonctionnement

### 2.1 Filtres suivis

Un filtre a un nom et des critères : mots-clés, marques, catégories, tailles, états, prix maximum (les critères d'une recherche Radar). Il peut être coupé et rallumé.

- **Quota** : 5 filtres en Pro, 25 en Agence. Le suivant est refusé (402). Sans Track dans l'offre : 402 « Track est compris à partir de Pro ».
- **Doublon** : un filtre aux mêmes critères (après normalisation) que l'un des siens est refusé (409).
- **Sous verrou** : création, modification et suppression prennent un verrou de l'organisation (`pg_advisory_xact_lock`) ; le quota est contrôlé et écrit dans la même transaction : deux créations simultanées à 4/5 n'en font jamais 6. Rallumer un filtre ne dépasse jamais le quota de filtres actifs (contrôle dans la transaction de la mise à jour). 20 créations ou modifications par minute et par membre au plus.
- **Une empreinte retirée garde sa place 2 h** : supprimer un filtre ou changer ses critères enregistre un événement `track.filter_change` (jamais facturé). Tant que filtres de l'organisation + empreintes retirées depuis moins de 2 h tiennent dans le quota, une nouvelle empreinte est lue au passage suivant ; au-delà, sa **première lecture attend 2 h**. Revenir à des critères abandonnés que personne d'autre ne suit ne relance pas de lecture immédiate. Changer de critères en boucle ne lit donc pas plus de pages que le quota n'en permet (5 ou 25 toutes les 2 h).
- Après un passage à une offre plus petite, la rétention coupe les filtres en trop, les plus récents d'abord (audit `track.filters_disabled_by_plan`) ; la liste reste lisible sans Track, pour qu'un client revenu à Starter puisse retirer ses anciens filtres.

### 2.2 Empreinte partagée : une seule lecture par critères

`fingerprintOf` normalise les critères (marques et mots-clés **pliés** : minuscules, accents retirés, apostrophes typographiques ’ ‘ ` ´ ramenées à l'apostrophe droite ; tailles en majuscules ; espaces réduits ; listes dédoublonnées et triées) puis en calcule l'empreinte SHA-256 (version 2). Deux filtres qui ne diffèrent que par la casse, les accents (« Sézane » / « Sezane »), l'apostrophe (« Levi’s » d'un clavier iOS / « Levi's »), l'ordre ou des espaces ont la même empreinte : la même page n'est lue qu'une fois. La même règle est appliquée côté web (`apps/web/src/lib/track.ts`). La 0013 n'ayant jamais été déployée, aucune empreinte de version 1 n'est à migrer.

La table partagée `track_filter_reads` a **une ligne par empreinte**, quel que soit le nombre d'organisations qui la suivent : critères normalisés, dernière et prochaine lecture, dernier résultat, facteur de ralentissement, état des annonces actives. Une organisation ne peut lire l'état d'une empreinte que si elle la suit (vérifié par les fonctions `SECURITY DEFINER`). Le nombre de pages lues ne dépend donc que du nombre de **critères différents**, pas du nombre de clients.

### 2.3 Lecture toutes les 2 h

- Prochaine lecture : 2 h après la précédente (`TRACK_READ_INTERVAL_MINUTES`, 120 par défaut), plus un écart propre à l'empreinte de ± 10 min, multipliée par le facteur de ralentissement.
- Le worker passerait toutes les 15 min (`CRON_TRACK`) et lirait les empreintes dues pendant 12 min au plus, une à la fois, dans le plafond de pages de Track (`TRACK_MAX_PAGES_PER_MINUTE`, 10) et dans celui de la machine partagé avec Radar (`RADAR_MAX_PAGES_PER_MINUTE_GLOBAL`). Radar reste prioritaire : quand la machine est au plafond, Track attend le passage suivant.
- Une lecture **prend** l'empreinte pour 10 min : deux passages ne la lisent jamais en même temps.

### 2.4 Instantanés, disparitions et « estimation »

À chaque lecture réussie :

1. Les annonces sont revalidées (schéma strict, comme Radar). Leur identifiant n'est jamais gardé : la base en calcule une **empreinte salée** (`app_track_ref_keys` ; le sel est dans `track_runtime`, que l'application ne lit jamais).
2. **Disparitions**, jugées sur la page **entière** : en direct, le worker lit la page sans filtre, puis applique lui-même le filtre local (marques, tailles, états, prix) et transmet le nombre d'annonces de la page entière et la publication la plus ancienne (`seenCount`, `oldestPublishedAt`). Une annonce vue à la lecture précédente et absente n'est comptée « disparue » que si elle aurait encore dû figurer sur la page : publiée après la plus ancienne annonce de la page entière (ou page du simulateur incomplète). Sinon, elle est simplement sortie de la page : sort inconnu, rien n'est compté. En direct, la taille réelle d'une page n'étant pas relevée sur Vinted, la page est **toujours traitée comme pleine** (sous-estimation assumée). Date de publication inconnue : jamais comptée. Une annonce illisible ou sans référence sur la page : **aucune** disparition comptée à cette lecture. La première lecture d'une empreinte ne compte aucune disparition.
3. **Instantané** (`track_snapshots`) : nombre d'annonces, prix médian, P25, P75, nouvelles, disparues, délai médian en ligne des disparues, parts des 10 premières marques, périmètre (catégories et marques des critères, et `categoriesVerified` : faux en direct quand le filtre a des catégories, que ni l'adresse ni la carte ne permettent d'appliquer). Un scan de niche ne compte que les instantanés limités à **sa** catégorie et vérifiés. Aucune annonce, aucun pseudo, aucune photo.
4. **Références de prix** (`price_references`), écrites par la base (`app_track_store_references`, clé à **sel propre**, jamais rendue) : chaque annonce vue (`listed`, prix affiché) et chaque disparue (`gone`, **prix final estimé** au dernier prix affiché, `finalPriceEstimated`), dates **au jour**, nombre de photos **par tranches**. **Seulement si la catégorie de l'annonce a été lue** : la catégorie du filtre n'est jamais recopiée sur une annonce qui peut être d'une autre (aujourd'hui, en direct, la carte du catalogue ne la donne pas : aucune référence n'est donc écrite en direct tant que l'adaptateur ne la lit pas). Source `track` en direct, `demo` avec le simulateur. Base gardée 24 mois.

Partout, l'interface dit « Annonces disparues depuis la lecture précédente : vendues ou retirées (estimation) ». Une disparition n'est jamais présentée comme une vente certaine.

### 2.5 Tendances

Pour un filtre : un point par jour (annonces en ligne, prix médian, nouvelles, disparues), sur 7, 30 (par défaut) ou 90 jours, **bornés à l'historique du plan** (3 mois en Pro, 12 en Agence). Variation du prix médian sur la période, total des disparitions, source de la dernière lecture et mentions (juridique, estimation, démonstration le cas échéant).

### 2.6 Scans de niche (note sur 100)

Pour une marque (facultative) et une catégorie, sur les 90 derniers jours :

| Composante | Poids | Calcul (0 à 100) |
|---|---|---|
| **Demande** | 35 % | Part des références vendues ou disparues parmi celles de la niche |
| **Vitesse** | 25 % | 100 pour une vente le jour même, 0 à partir de 30 jours de délai médian (50 si inconnu) |
| **Concurrence** | 20 % | 100 / (1 + annonces actives / 50) : moins d'annonces actives, meilleure note |
| **Marge** | 20 % | (P50 de revente − prix d'achat médian) / P50 de revente, 100 à partir de 50 % ; prix d'achat = vos propres achats de la niche, sinon le quart le moins cher des annonces |

- Données **réelles** d'abord ; le simulateur seulement à défaut, et la note est alors marquée « données de démonstration ».
- Moins de **10 références** ou de **3 ventes** : « Données insuffisantes pour noter cette niche », **aucune note, aucun prix ni délai** (seulement les volumes : une médiane sur une ou deux ventes serait le prix exact d'une vente), **rien n'est décompté** du quota, mais **20 par jour** au plus (429 au-delà, `TRACK_SCAN_INSUFFICIENT_PER_DAY`).
- Les ventes versées par une **autre** organisation ne comptent jamais dans un scan ([PRIX.md](PRIX.md) §2).
- Quota : 10 scans par mois en Pro, 50 en Agence (compteur `track.scan`), contrôlé et décompté sous un verrou de l'organisation : des scans simultanés ne le dépassent pas.

### 2.7 Recherche par photo

1. Le client envoie une photo (JPEG, PNG ou WebP), avec une marque ou une note facultatives.
2. **Sans modèle de vision** branché (`OLLAMA_VISION_MODEL` absent : la requête irait au modèle de texte, qui ne voit pas la photo) : refus 503 « Lecture des photos indisponible », rien n'est décrit ni décompté. Le simulateur, lui, est marqué « simulé ».
3. La **place du quota est réservée** (événement `track.photo_search`) sous un verrou de l'organisation, dans la transaction du contrôle, **avant** l'appel au modèle : des recherches simultanées ne dépassent jamais le quota. Elle est **rendue** si la lecture de la photo ou l'estimation échoue.
4. Le **modèle 1** (vision) décrit l'article : titre, marque, catégorie, sous-catégorie, matière, couleur, état, **sans aucun prix**. Un champ vide (« "brand": "" ») vaut « inconnu ». Une description invalide est écartée (422). La requête IA est close avant l'estimation (jamais laissée « en cours »).
5. L'**estimation des prix** donne la fourchette, les trois stratégies, le délai et l'explication par mon IA perso ([PRIX.md](PRIX.md)).
6. Seules la description et l'estimation sont enregistrées (`track_photo_searches`) : **la photo n'est jamais conservée**, ni en base, ni sur le disque, ni dans un journal, ni dans un message d'erreur.

Quota : 30 recherches par mois en Pro, 150 en Agence (compteur `track.photo_search`). Chaque recherche compte aussi dans le quota IA (une lecture de photo, comme le générateur d'annonces).

### 2.8 Historique par plan

| | Pro | Agence |
|---|---|---|
| Scans et recherches par photo gardés | 3 mois | 12 mois |
| Tendances consultables | 3 mois | 12 mois |

La rétention quotidienne du worker (livrée en parallèle) supprimerait les scans et recherches plus anciens que l'historique du plan (tout, sans Track). Les instantanés, partagés, sont gardés selon le plan **le plus long** parmi les organisations qui suivent l'empreinte (12 mois au plus) ; une empreinte que plus personne ne suit est effacée avec ses instantanés (`app_track_purge`).

### 2.9 Agence : flux des ventes et analyse d'un vendeur

- **Flux des ventes** : références vendues ou disparues des 30 derniers jours, regroupées par marque et catégorie. **Aucun vendeur, aucune annonce, aucune vente d'une autre organisation.** Réservé à Agence (402 « Le flux des ventes est compris dans Agence »). Sans données réelles, le simulateur, marqué comme tel.
- **Analyse d'un vendeur concurrent** : **non construite**. Elle demande de lire et de rattacher des annonces à un pseudo, ce qui est **à valider juridiquement (RGPD)**. Tant que `TRACK_SELLER_ANALYSIS_ENABLED=false` (défaut) : refus 409 avec l'explication. Même à `true` : 501, seul l'écran d'explication existe. Aucun pseudo n'est lu ni gardé.

### 2.10 Ailleurs dans Selio

- **Page marché** : une section « Track » liste les niches vues (marque × catégorie, annonces, vendues ou disparues, part estimée), sans aucun vendeur.
- **Extension** : sur une page article, le panneau « Comparables Selio » affiche la fourchette P25 / P50 / P75, les trois stratégies, le nombre de comparables et la méthode, pour Pro et Agence ([EXTENSION-INSTALL.md](EXTENSION-INSTALL.md)). Seuls le titre, la marque, la taille, l'état et le prix partent ; rien n'est enregistré.
- **Estimation des prix** : les références de Track (dont les disparues, estimées) servent de comparables et d'entraînement au modèle de prix, une fois réelles ([PRIX.md](PRIX.md)).

## 3. Source : simulateur par défaut, lecture en direct derrière `TRACK_LIVE_ENABLED`

| | Simulateur (défaut) | Lecture en direct |
|---|---|---|
| Réglage | `TRACK_LIVE_ENABLED=false` | `TRACK_LIVE_ENABLED=true` (API **et** worker), et Selio Cloud actif dans le worker (`CLOUD_ENABLED=true`, Chromium) |
| Ce qui est lu | Une page simulée, déterministe (même empreinte, même heure : même page) | Une page **publique** du catalogue (`buildSearchUrl`, domaine de la liste fermée), **sans session**, sans compte, sans cookie |
| Références et instantanés | Source `demo`, jamais comptés comme réels, jamais comparables | Source `track` |
| Interface | « Données de démonstration : le simulateur remplace la lecture des pages tant que la lecture en direct n'est pas ouverte. » | Mention juridique ; « estimation » pour les disparues |

**Garde-fous de la lecture en direct** (les mêmes que Radar, briques communes) :

- **Lecteur de Selio Cloud** : `RadarReader.readSearch({ session: null })`, un Chromium neuf par page, bac à sable actif, environnement minimal, dans les **mêmes créneaux de navigateurs** que le Cloud et Radar (`CLOUD_MAX_BROWSERS`), et dans les deux plafonds de pages par minute (Track, machine). Aucun créneau libre : rien n'est lu ni compté, nouvel essai 5 min plus tard.
- **Champs personnels retirés avant le cœur** : adresse, photo, pseudo, note et avis du vendeur sont mis à vide par le lecteur du worker ; le cœur ne garde de toute façon que des agrégats et des empreintes.
- **Arrêt au premier signal** (`detectBlock` : CAPTCHA, avertissement, blocage, « trop de requêtes ») : **toutes** les lectures en direct de Track sont mises en pause 60 min (écrit d'abord), le facteur de ralentissement partagé double (fenêtre glissante des 1 000 dernières lectures de Track, au-delà de 1 blocage pour 1 000 pages), et pour un blocage ou un « trop de requêtes » le **coupe-circuit de la machine** (`cloud_runtime`, 60 min) arrête aussi le Cloud et Radar. Le passage s'arrête : aucune autre page n'est lue. **Rien n'est retenté, rien n'est contourné** (aucune résolution de CAPTCHA, aucun proxy, aucune adresse masquée, User-Agent d'origine).
- **Ralentissement** : facteur plafonné à ×8 (16 h entre deux lectures), qui redescend d'un cran par 24 h sans blocage. Le facteur stocké et la date du dernier blocage ne sont réécrits **qu'à un blocage** (comme Radar) : une lecture réussie ne réécrit jamais un facteur déjà diminué, il ne s'effondre donc pas en quelques lectures. Une empreinte dont la page est illisible 3 fois de suite (page changée, erreur, délai) ralentit seule (×2).
- **Coupe-circuit de la machine en cours** ou **Track en pause** : aucune lecture en direct.

## 4. Règles qui ne se négocient pas

- **Statistiques seulement.** Aucune annonce n'est republiée, affichée telle quelle ou exportée. Les écrans montrent des nombres, des prix agrégés et des parts de marques.
- **Aucune donnée personnelle** dans les tables de Track et dans la base de références : ni pseudo, ni profil, ni photo d'annonce ou de personne, ni titre libre, ni identifiant d'annonce réutilisable (empreinte salée seulement). Les journaux du worker ne contiennent que des empreintes abrégées, des codes et des compteurs.
- **La photo d'une recherche par photo n'est jamais conservée.**
- **Les disparitions sont des estimations** et le disent.
- **Rien n'est présenté comme mesuré sans mesure** : données du simulateur toujours marquées, « données insuffisantes » plutôt qu'une note fragile.
- **Lecture en direct fermée par défaut**, ouverte seulement après l'avis de l'avocat (§7) ; analyse d'un vendeur non construite.
- Selio est **indépendant de Vinted** (ni affilié, ni approuvé, ni sponsorisé).

## 5. Quotas

`PLAN_QUOTAS` (`packages/contracts/src/org.ts`) :

| | Free / Starter | Pro | Agence |
|---|---|---|---|
| Filtres suivis, relus toutes les 2 h (`trackFiltersFollowed`) | 0 : Track indisponible | 5 | 25 |
| Scans de niche par mois (`trackScansPerMonth`, compteur `track.scan`) | 0 | 10 | 50 |
| Recherches par photo par mois (`trackPhotoSearchesPerMonth`, compteur `track.photo_search`) | 0 | 30 | 150 |
| Historique (`trackHistoryMonths`) | 0 | 3 mois | 12 mois |
| Flux des ventes | — | — | oui |
| Comparables dans l'extension, tendances sur 30 jours | — | oui | oui |

- Remise à zéro le 1er du mois (UTC) ; la date anniversaire est une décision d'Ibrahim (partie 7).
- Un scan « données insuffisantes » n'est pas décompté (20 par jour au plus).
- Les contrôles de quota (filtres, scans, recherches par photo) se font sous un verrou de l'organisation, dans la transaction qui écrit ou réserve la place.
- Page « Mon utilisation » : les filtres suivis comptent les filtres de l'organisation (même décompte que le refus à la création), les scans et recherches leurs compteurs du mois.

## 6. Ce qui n'est pas fait, limites connues

- **Jamais exécuté contre Vinted.** Le lecteur en direct n'est testé qu'avec un lecteur simulé et des pages locales ; les sélecteurs du catalogue et les paramètres de l'adresse de recherche sont ceux de Radar, écrits sur des fixtures synthétiques (`catalog-page.v1.html`), **non vérifiés** sur une vraie page publique.
- **Avis de l'avocat** attendu sur la collecte de Track et l'usage des données issues de Vinted (statistiques, base de références, entraînement du modèle de prix).
- **Analyse d'un vendeur concurrent** : écran d'explication seulement (RGPD).
- **« Disparue » = vendue ou retirée** : pas de moyen de distinguer les deux sans lire la page de l'annonce, ce que Track ne fait pas.
- **Une page par lecture** (96 annonces au plus) : un filtre très large ne voit que les annonces les plus récentes.
- **Catégories** : `vinted-dom-v1` ne lit pas la catégorie d'une page article (le panneau de l'extension l'envoie vide) et l'adaptateur catalogue ne la lit pas sur une carte ni ne la passe dans l'adresse (`catalog[]`, identifiants à relever en réel) : en direct, aucune référence n'est écrite et les instantanés d'un filtre à catégorie ne comptent pour aucune catégorie, tant que ce n'est pas fait.
- **Taille d'une page** : à relever sur une vraie page publique ; en attendant, une lecture en direct est traitée comme une page pleine (les disparitions des annonces les plus anciennes ne sont pas comptées).
- **Rôle de la base** : le worker et l'API partagent `selio_app` ; la fonction qui calcule la clé d'état d'une annonce (`app_track_ref_keys`) reste donc appelable par l'API. Les références n'utilisent pas cette clé (autre sel), mais un rôle worker distinct fermerait complètement la porte (à décider avec le déploiement).
- **Vecteurs du modèle 2** gardés par organisation : les références communes sont ré-embarquées par chaque organisation.
- **Mesures de blocage de Track** : à relever comme pour Radar (RADAR.md §7) dès la première lecture en direct.

## 7. Activer la lecture en direct, après l'avis de l'avocat

À ne faire qu'avec un **avis écrit** de l'avocat sur la lecture des pages publiques et l'usage des données (statistiques, base de références, entraînement), et l'accord d'Ibrahim.

1. **Avis reçu et rangé** avec les décisions (DECISIONS.md) ; conditions éventuelles reportées dans ce document et dans les textes de l'interface (mention juridique `TRACK_LEGAL_NOTICE`, conditions de vente).
2. **Vérifier l'adaptateur** sur une vraie page publique du catalogue, depuis un poste de l'équipe, à la main : sélecteurs, paramètres de l'adresse de recherche, identifiants des marques, tailles, états et catégories. Mettre à jour l'adaptateur (`v2` et fixture) si besoin.
3. **Prérequis Cloud** : `CLOUD_ENABLED=true` et Chromium dans le worker (CLOUD.md §7, bac à sable vérifié au démarrage), `CLOUD_MAX_BROWSERS` réglé après `pnpm cloud:bench` en comptant Radar et Track.
4. **Réglages prudents** : `TRACK_MAX_PAGES_PER_MINUTE=2` pour commencer, `TRACK_READ_INTERVAL_MINUTES=120` (ou plus), quelques filtres de l'équipe seulement.
5. `TRACK_LIVE_ENABLED=true` côté **API et worker**, puis redémarrage. Le journal de démarrage doit dire « Track : lecture en direct des pages publiques OUVERTE ».
6. **Surveiller** pendant une semaine : lignes « track : Vinted a arrêté la lecture » et « COUPE-CIRCUIT » du journal du worker, blocages pour 1 000 pages, facteur de ralentissement, pages illisibles. **Critère d'arrêt** : un seul signal de Vinted dans la première semaine → `TRACK_LIVE_ENABLED=false` et analyse avant toute reprise.
7. Monter les plafonds par paliers, zéro blocage avant chaque palier. Les mesures relevées vont dans BUILD_STATUS.md.

**Arrêt d'urgence** : `TRACK_LIVE_ENABLED=false` (API et worker) puis redémarrage : retour immédiat au simulateur. `CLOUD_ENABLED=false` arrête aussi toute lecture en direct, Radar compris.

## 8. Exploitation

- **Variables** : [CLES-ET-CONFIGURATION.md §12](CLES-ET-CONFIGURATION.md) (`TRACK_LIVE_ENABLED`, `TRACK_SELLER_ANALYSIS_ENABLED`, `TRACK_READ_INTERVAL_MINUTES`, `TRACK_MAX_PAGES_PER_MINUTE`, `CRON_TRACK`, et celles du prix).
- **Base** : migration 0013, additive et idempotente ; aucun rôle séparé pour le worker : les tables `track_filter_reads` et `track_runtime` ne s'atteignent que par les fonctions `SECURITY DEFINER` (onze, dont `app_track_store_references`).
- **Supervision** : journal du worker (« track : passage », pages lues, blocages, pauses). Après un signal, Track repart seul à la fin de la pause (60 min) ; le facteur de ralentissement redescend d'un cran par 24 h sans blocage.
