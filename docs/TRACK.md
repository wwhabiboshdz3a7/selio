# Selio Track

Selio Track analyse le marché pour les offres Pro et Agence : filtres suivis et relus toutes les 2 h, tendances, annonces disparues, scans de niche notés sur 100, recherche par photo, flux des ventes (Agence) et comparables dans le panneau de l'extension. **Statistiques seulement** : Track ne republie aucune annonce et ne garde ni photo d'annonce ni pseudo. Ce document décrit ce que fait le code, les règles, les quotas, ce qui n'est pas fait, et la procédure de passage au réel, progressive (avis de l'avocat favorable du 26 novembre 2026). L'estimation des prix sur laquelle Track s'appuie est décrite dans [PRIX.md](PRIX.md).

> **Mise à jour du 26 novembre 2026.** **Avis de l'avocat favorable** à la lecture des pages publiques du catalogue, annoncé par Ibrahim ([DECISIONS.md](DECISIONS.md) D62). L'ouverture se fait par la configuration du PC de production, **progressivement** (§7 : Track en pause, puis paliers de pages par minute), garde-fous inchangés. Dans le code, `TRACK_LIVE_ENABLED` reste `false` par défaut ; les écrans suivent l'interrupteur réel (« en cours d'ouverture » tant qu'il est fermé). L'image du worker embarque désormais Chromium (`deploy/Dockerfile.worker`). L'analyse d'un vendeur concurrent reste refusée (RGPD).
>
> **Mise à jour du 15 novembre 2026.** Ajouts : compteur « filtres suivis / quota » réel partout (Mon utilisation, vue opérateur, refus au-delà du quota), **alertes de tendance** par filtre (§2.11), **Track dans l'administration** `/admin/track` avec pause manuelle (§8), journal partagé des lectures, lecture publique sans session rendue possible dans l'exécuteur du Cloud (elle était refusée faute de session), vérification hors ligne `pnpm track:check`, et la procédure **« Passage au réel »** (§7). **L'interrupteur reste fermé** (`TRACK_LIVE_ENABLED=false`) : toujours aucune page de Vinted lue.
>
> **État au 4 novembre 2026, après relecture.** Les contrats (`packages/contracts/src/track.ts`), la migration 0013, le service du cœur (`packages/core/src/services/track.ts`), les routes de l'API, le passage du worker, les pages web `/track` et le panneau de l'extension sont construits et testés, sur PostgreSQL local et sur des pages locales ; l'état détaillé fait foi dans [BUILD_STATUS.md](BUILD_STATUS.md). Corrigé après relecture : quotas contrôlés sous verrou dans la transaction qui réserve la place, empreinte retirée qui garde sa place 2 h, ralentissement qui redescend vraiment d'un cran par 24 h, disparitions jugées sur la page entière, catégorie du filtre jamais recopiée, références moins identifiables (dates au jour, photos par tranches, clé à sel propre, 24 mois), scans insuffisants sans chiffres, recherche par photo refusée sans modèle de vision. **Par défaut, la source est le simulateur** (`TRACK_LIVE_ENABLED=false`) : les données affichées sont alors marquées « données de démonstration ». **Aucune page de Vinted n'a jamais été lue par Track** à cette date. (Avis de l'avocat rendu depuis, favorable : voir la mise à jour du 26 novembre 2026.)

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
| Alertes de tendance par filtre (réglage, évaluation après chaque instantané, historique, notification) | `packages/core/src/services/track-alerts.ts`, migration 0021, page du filtre | Construit, testé (15 novembre 2026) |
| Track dans l'administration (`/admin/track`, `/api/admin/track/*`) : source, interrupteur, pauses, lecteur, journal, usage par client, pause manuelle | `packages/core/src/services/track-admin.ts`, `apps/web/src/app/pages/admin/AdminTrack.tsx` | Construit, testé (15 novembre 2026) |
| Vérification hors ligne de la configuration (`pnpm track:check`) | `apps/worker/src/track-check.ts` | Construit, testé (15 novembre 2026) |

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

### 2.11 Alertes de tendance

Chaque filtre peut prévenir quand sa tendance bouge. Tout est **coupé par défaut** et se règle dans la page du filtre (`/track/filtres/:id`, section « Alertes de tendance »), par un membre qui peut modifier Track :

| Règle | Déclenchée quand | Réglage |
|---|---|---|
| Prix médian qui bouge | le prix médian de la dernière lecture s'écarte de ± X % de la médiane des 7 jours précédents | X de 5 à 90 % (15 par défaut) |
| Nouvelles annonces au-dessus d'un seuil | la dernière lecture compte au moins N nouvelles annonces | N de 1 à 96 (10 par défaut) |
| Délai de vente qui baisse | le délai médian des annonces disparues (estimation) baisse de X % face aux 7 jours précédents | X de 10 à 90 % (25 par défaut) |

- **Évaluation** : par le worker, juste après chaque nouvel instantané d'une empreinte (`runTrackRead`), pour chaque organisation dont un filtre **actif** suit l'empreinte avec ses alertes allumées (fonction `app_track_alert_targets`). Une variation demande **3 instantanés de référence** au moins sur 7 jours, **de la même source** (le simulateur n'est jamais comparé à une lecture en direct).
- **Pas de rafale** : une alerte par filtre et par règle au plus toutes les **24 h**, contrôlé sous un verrou de l'organisation.
- **Envoi** : la file des notifications de la PWA (`radar_alerts`, type `track_trend`, tâche « alerts.send », Web Push sur les appareils abonnés, heures calmes de l'organisation respectées). Contenu : nom du filtre et agrégats, lien vers la page du filtre ; aucune annonce, aucun pseudo. Données du simulateur annoncées « Données de démonstration ».
- **Historique** : chaque alerte est listée dans la page du filtre (`track_alert_events`, RLS), gardée selon l'historique du plan, effacée avec le filtre.
- **Désactivable** : l'interrupteur « Recevoir les alertes de ce filtre » (ou « Tout couper ») ; un filtre en pause n'est plus évalué.
- Démonstration : les règles sont rejouées sur l'historique simulé, sans notification.

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
- **Pause manuelle** (`/admin/track`, opérateur « tech ») : plus aucune lecture, simulateur compris, relue par le worker avant chaque lecture (aucun redémarrage).
- **Page publique, contexte vierge** : le lecteur demande explicitement une lecture publique (`publicPage`) ; l'exécuteur n'accepte alors qu'une page catalogue, refuse toute session, n'injecte aucun cookie et ne relit ni ne rend aucune session. Sans ce drapeau, l'absence de session reste un refus (Radar). Avant le 15 novembre 2026, ce chemin était refusé (« aucune session ») : la lecture en direct n'aurait jamais rien lu.

## 4. Règles qui ne se négocient pas

- **Statistiques seulement.** Aucune annonce n'est republiée, affichée telle quelle ou exportée. Les écrans montrent des nombres, des prix agrégés et des parts de marques.
- **Aucune donnée personnelle** dans les tables de Track et dans la base de références : ni pseudo, ni profil, ni photo d'annonce ou de personne, ni titre libre, ni identifiant d'annonce réutilisable (empreinte salée seulement). Les journaux du worker ne contiennent que des empreintes abrégées, des codes et des compteurs.
- **La photo d'une recherche par photo n'est jamais conservée.**
- **Les disparitions sont des estimations** et le disent.
- **Rien n'est présenté comme mesuré sans mesure** : données du simulateur toujours marquées, « données insuffisantes » plutôt qu'une note fragile.
- **Lecture en direct fermée par défaut** ; avis de l'avocat favorable (26 novembre 2026), ouverture progressive par la configuration du PC (§7) ; analyse d'un vendeur non construite.
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
- Page « Mon utilisation », vue opérateur « utilisation par client » et `/admin/track` : les filtres suivis comptent les filtres de l'organisation, actifs ou en pause (même décompte que le refus 402 à la création, sous verrou), face au quota du plan ; les scans et recherches leurs compteurs du mois. Les filtres suivis sont une limite, pas une consommation du mois : ils ne déclenchent pas l'alerte à 80 %.

## 6. Ce qui n'est pas fait, limites connues

- **Jamais exécuté contre Vinted.** Le lecteur en direct n'est testé qu'avec un lecteur simulé et des pages locales ; les sélecteurs du catalogue et les paramètres de l'adresse de recherche sont ceux de Radar, écrits sur des fixtures synthétiques (`catalog-page.v1.html`), **non vérifiés** sur une vraie page publique.
- **Avis de l'avocat** : favorable à la lecture des pages publiques du catalogue (26 novembre 2026, D62) ; l'ouverture reste progressive (§7).
- **Analyse d'un vendeur concurrent** : écran d'explication seulement (RGPD).
- **« Disparue » = vendue ou retirée** : pas de moyen de distinguer les deux sans lire la page de l'annonce, ce que Track ne fait pas.
- **Une page par lecture** (96 annonces au plus) : un filtre très large ne voit que les annonces les plus récentes.
- **Catégories** : `vinted-dom-v1` ne lit pas la catégorie d'une page article (le panneau de l'extension l'envoie vide) et l'adaptateur catalogue ne la lit pas sur une carte ni ne la passe dans l'adresse (`catalog[]`, identifiants à relever en réel) : en direct, aucune référence n'est écrite et les instantanés d'un filtre à catégorie ne comptent pour aucune catégorie, tant que ce n'est pas fait.
- **Taille d'une page** : à relever sur une vraie page publique ; en attendant, une lecture en direct est traitée comme une page pleine (les disparitions des annonces les plus anciennes ne sont pas comptées).
- **Rôle de la base** : le worker et l'API partagent `selio_app` ; la fonction qui calcule la clé d'état d'une annonce (`app_track_ref_keys`) reste donc appelable par l'API. Les références n'utilisent pas cette clé (autre sel), mais un rôle worker distinct fermerait complètement la porte (à décider avec le déploiement).
- **Vecteurs du modèle 2** gardés par organisation : les références communes sont ré-embarquées par chaque organisation.
- **Mesures de blocage de Track** : à relever comme pour Radar (RADAR.md §7) dès la première lecture en direct ; `/admin/track` les montre (blocages pour 1 000 pages, journal de 7 jours).
- **Pas d'ouverture par organisation** : l'interrupteur vaut pour toutes les empreintes suivies. Le nombre de pages ne dépend que des critères différents et des plafonds (`TRACK_MAX_PAGES_PER_MINUTE=2` : 24 lectures au plus par passage de 15 min, environ 190 empreintes toutes les 2 h).
- **Alertes « délai de vente »** : ne se déclenchent qu'avec des disparitions comptées ; en direct, la page est toujours traitée comme pleine, elles seront donc rares (sous-estimation assumée).

## 7. Passage au réel (procédure pour Ibrahim)

**Avis de l'avocat : favorable (26 novembre 2026). Ouverture progressive :** Track d'abord en pause (§7.4), puis paliers de pages par minute (§7.7). Tout est prêt côté code ; **l'interrupteur est fermé par défaut** (`TRACK_LIVE_ENABLED=false`) et ne s'ouvre que par `deploy/.env`, une fois les autres prérequis remplis. Garde-fous inchangés : arrêt au premier CAPTCHA, blocage ou « trop de requêtes », coupe-circuit de la machine, plafonds, aucun contournement.

### 7.1 Prérequis (tous obligatoires)

1. [x] **Avis de l'avocat favorable** à la lecture des pages publiques du catalogue, annoncé par Ibrahim le 26 novembre 2026 et rangé dans [DECISIONS.md](DECISIONS.md) (D62). L'analyse d'un vendeur concurrent reste refusée quoi qu'il arrive (`TRACK_SELLER_ANALYSIS_ENABLED=false`).
2. [x] **Accord d'Ibrahim**, daté, dans DECISIONS.md (D62).
3. **Adaptateur vérifié à la main** sur une vraie page publique du catalogue, depuis un poste de l'équipe, dans un navigateur ordinaire (jamais par Selio) : sélecteurs, paramètres de l'adresse de recherche, identifiants des marques, tailles, états et catégories, nombre d'annonces par page. Adaptateur (`v2`) et fixture mis à jour si besoin. Tant que la catégorie n'est pas lue, la lecture en direct n'écrit aucune référence (instantanés seulement).
4. **Mesures** : `pnpm cloud:bench` sur le PC de production pour régler `CLOUD_MAX_BROWSERS` (Cloud, Radar et Track partagent les navigateurs) ; mesures de Radar relevées (RADAR.md §7) si Radar tourne déjà en direct.
5. **Base à jour** : migrations jusqu'à `0021_track_suivi.sql` appliquées (`pnpm db:migrate`), API et worker déployés depuis la même version.
6. **Selio Cloud prêt** : Chromium est dans l'image du worker (`deploy/Dockerfile.worker`, `/usr/local/bin/selio-chromium`), profil seccomp `deploy/chromium-seccomp.json` et dossier de travail en tmpfs déclarés dans `docker-compose.prod.yml` ; reste à vérifier le bac à sable au démarrage sur le PC ([CLOUD.md](CLOUD.md) §7).

### 7.2 Vérifier hors ligne

Sur le PC de production, depuis le dossier de Selio :

```
pnpm track:check -- --env-file deploy/.env --live --db
```

La commande ne lit aucune page de Vinted et n'affiche aucun secret. Elle dit, ligne par ligne : `[ok]`, `[MANQUE]` (bloquant), `[!]` (réglage à revoir), `[à faire]` (vérification à la main : mise en pause avant l'ouverture, adaptateur ; l'avis de l'avocat est compté `[ok]`). Avec `--db`, elle lit aussi l'état de Track en base (pause manuelle, pause après un signal, ralentissement, migration 0021). On ne passe à la suite qu'avec **aucune ligne `[MANQUE]`**.

### 7.3 Réglages à changer dans `deploy/.env` (PC de production)

L'API et le worker lisent le même fichier (`env_file` de `deploy/docker-compose.prod.yml`) : une seule valeur pour les deux.

| Variable | Valeur de départ | Pourquoi |
|---|---|---|
| `TRACK_LIVE_ENABLED` | `true` | l'interrupteur (seule variable qui ouvre la lecture) |
| `CLOUD_ENABLED` | `true` | Track lit avec le lecteur de Selio Cloud |
| `CLOUD_CHROMIUM_PATH` | `/usr/local/bin/selio-chromium` | Chromium de l'image du worker ; aucun navigateur n'est téléchargé |
| `CLOUD_PROFILE_DIR` | `/var/lib/selio-cloud` | dossier de travail en mémoire vive (tmpfs de `docker-compose.prod.yml`) |
| `CLOUD_CHROMIUM_SANDBOX` | ne pas définir (vrai) | refusé à `false` en production |
| `TRACK_MAX_PAGES_PER_MINUTE` | `2` | départ prudent (défaut 10) |
| `TRACK_READ_INTERVAL_MINUTES` | `120` (ou `180`) | une lecture par empreinte toutes les 2 h au plus |
| `CLOUD_MAX_BROWSERS` | valeur issue de `pnpm cloud:bench` | navigateurs partagés avec le Cloud et Radar |
| `RADAR_MAX_PAGES_PER_MINUTE_GLOBAL` | inchangé (30) | plafond de la machine, Radar prioritaire |
| `TRACK_SELLER_ANALYSIS_ENABLED` | `false` (inchangé) | RGPD |

Relancer `pnpm track:check -- --env-file deploy/.env --db` (sans `--live` : l'interrupteur est maintenant ouvert dans le fichier).

### 7.4 Ouvrir

1. Dans `/admin/track`, **« Mettre Track en pause »** (raison : « passage au réel ») : la première lecture se fera sous vos yeux, pas pendant le redémarrage.
2. Redémarrer l'API et le worker : `docker compose -f deploy/docker-compose.prod.yml up -d api worker`.
3. Journal de démarrage du worker : la ligne « Track : lecture en direct des pages publiques OUVERTE » doit apparaître. Si c'est « TRACK_LIVE_ENABLED=true mais Selio Cloud est désactivé », le simulateur reste la source : revoir `CLOUD_ENABLED` et Chromium.
4. `/admin/track` : « Interrupteur : Ouvert », « Source : En direct ».
5. **« Reprendre »** quand vous êtes prêt à observer : le passage suivant du worker (15 min au plus) lit les empreintes dues, au plus 2 pages par minute.

### 7.5 Observer les premières heures depuis `/admin/track`

La page se rafraîchit toutes les 30 secondes.

- **Dernières lectures** : résultat « Lue », nombre d'annonces lues, nouvelles et disparues, source « En direct ». Les pages des filtres suivis passent de « Simulateur » à « Pages publiques du catalogue ».
- **Erreurs et blocages récents** : « CAPTCHA », « Blocage », « Trop de requêtes » (arrêt), « Page non reconnue » (adaptateur à revoir), « Délai dépassé ».
- **Pause** : « Pause après un signal » (60 min, posée seule par Track) ou « Coupe-circuit » (machine arrêtée, Cloud et Radar compris).
- **Ralentissement** et **blocages pour 1 000 pages** (fenêtre glissante des 1 000 dernières lectures en direct).
- Journal du worker en parallèle : lignes « track : page publique lue », « track : Vinted a arrêté la lecture », « COUPE-CIRCUIT ».

**Critère d'arrêt : un seul signal de Vinted (CAPTCHA, blocage, « trop de requêtes ») pendant la première semaine** → revenir en arrière (§7.6) et analyser avant toute reprise. Plusieurs « Page non reconnue » → revenir en arrière et revoir l'adaptateur.

### 7.6 Revenir en arrière

1. **Tout de suite, sans redémarrage** : `/admin/track` → « Mettre Track en pause ». Plus aucune lecture au plus tard au passage suivant du worker.
2. **Retour au simulateur** : `TRACK_LIVE_ENABLED=false` dans `deploy/.env`, puis `docker compose -f deploy/docker-compose.prod.yml up -d api worker`. Le journal de démarrage doit dire « Track : simulateur (données de démonstration), lecture en direct fermée ».
3. `/admin/track` → « Reprendre » : le simulateur reprend (données marquées « démonstration »).
4. **Arrêt de toute lecture en direct**, Radar compris : `CLOUD_ENABLED=false` et redémarrage.

Les instantanés déjà lus en direct restent (statistiques, source `cloud`) ; à la reprise du simulateur, la première lecture de chaque empreinte ne compte aucune disparition (changement de source). Un coupe-circuit se lève seul au bout de 60 min ; le ralentissement redescend d'un cran par 24 h sans blocage.

### 7.7 Monter par paliers

Après **une semaine sans aucun signal** : `TRACK_MAX_PAGES_PER_MINUTE` 2 → 4 → 6 → 10, un palier par semaine, zéro blocage avant chaque palier (redémarrage du worker à chaque changement). Les mesures relevées (blocages pour 1 000 pages, facteur atteint, pages illisibles) vont dans BUILD_STATUS.md.

## 8. Exploitation

- **Variables** : [CLES-ET-CONFIGURATION.md §12](CLES-ET-CONFIGURATION.md) (`TRACK_LIVE_ENABLED`, `TRACK_SELLER_ANALYSIS_ENABLED`, `TRACK_READ_INTERVAL_MINUTES`, `TRACK_MAX_PAGES_PER_MINUTE`, `CRON_TRACK`, et celles du prix).
- **Base** : migration 0013, additive et idempotente ; aucun rôle séparé pour le worker : les tables `track_filter_reads` et `track_runtime` ne s'atteignent que par les fonctions `SECURITY DEFINER` (onze, dont `app_track_store_references`).
- **Supervision** : `/admin/track` (tout opérateur ; pause et reprise réservées au rôle « tech », auditées `admin.track_paused` / `admin.track_resumed`) et journal du worker (« track : passage », pages lues, blocages, pauses, alertes). Après un signal, Track repart seul à la fin de la pause (60 min) ; le facteur de ralentissement redescend d'un cran par 24 h sans blocage. Une pause manuelle, elle, ne se lève qu'à la main.
- **Journal partagé des lectures** (`track_read_log`, 0021) : une ligne par lecture (empreinte, source, résultat, compteurs, facteur, code), 7 jours, sans donnée d'organisation ni de personne ; lu par `/admin/track` seulement.
- **Vérification hors ligne** : `pnpm track:check` (§7.2).
- **Migration 0021** (additive, idempotente) : `track_filters.alert_rules`, `track_alert_events` (RLS), type `track_trend` de la file des notifications, pause manuelle dans `track_runtime`, `track_read_log`, huit fonctions `SECURITY DEFINER` de lecture pour l'administration et le worker.
