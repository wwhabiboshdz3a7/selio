# Selio Radar et Radar Auto

Selio Radar relit les recherches du client sur Vinted, note chaque nouvelle annonce et prévient le client sur son téléphone quand une bonne affaire apparaît ; le client l'achète lui-même en « 1 clic ». Radar Auto peut acheter seul, derrière des verrous fermés par défaut. Ce document décrit ce que fait le code (pas ce qu'il devrait faire), les règles qui ne se négocient pas, les mesures à relever, les garde-fous juridiques, ce qui manque, et la procédure de test sur nos propres comptes.

> **État au 30 octobre 2026.** Le socle est construit et testé, sur des pages locales et sur PostgreSQL local : adaptateurs catalogue et paiement (`packages/connectors`), lecture de page et achat pas à pas (`packages/cloud/src/radar/`), contrats, migration 0012, service du cœur (`packages/core/src/services/radar.ts`, `radar-sources.ts`, `alerts.ts`, pause système dans `cloud.ts`). Les routes de l'API, les passages du worker, l'envoi des notifications et les pages web sont livrés **en parallèle** de ce document : ce qui en est dit ici est écrit au conditionnel, et leur état fait foi dans [BUILD_STATUS.md](BUILD_STATUS.md). **Rien n'a jamais été lu ni acheté sur Vinted.** Radar Auto est **fermé par défaut** (`RADAR_AUTO_ENABLED=false`), l'achat réel aussi (D11, `RADAR_REAL_PURCHASE=false`) : sans eux, un achat s'arrête avant le bouton de paiement. **Aucun chiffre n'est mesuré** : les tableaux du §7 sont « à mesurer ».

## En bref

- Radar lit les pages de recherche de Vinted **depuis le compte Achat du client**, par Selio Cloud : un compte Vinted de catégorie « Achat », relié à un compte Cloud actif avec sa session chiffrée, et l'accord Cloud accepté. Jamais un compte Perso ni un compte de vente, jamais sans accord, aucun mot de passe.
- Rythme : une page toutes les **60 s** par recherche, toutes les **30 s** pour 3 recherches prioritaires quand Radar Auto est ouvert. Plafonds de pages par minute pour l'organisation (10) et pour toute la machine (30).
- Au **premier** CAPTCHA, avertissement, blocage ou « trop de requêtes » : lecture arrêtée, compte Achat **en pause** dans le Cloud, client alerté, mesure enregistrée. Après un « trop de requêtes » ou un blocage, **tout le Cloud de la machine** s'arrête 60 min. Rien n'est retenté, rien n'est contourné.
- **Ralentissement automatique**, seule réaction : au-delà de 1 blocage pour 1 000 pages (fenêtre glissante), l'intervalle double (60 → 120 → 240 s…), puis revient d'un cran par 24 h sans blocage.
- Chaque annonce nouvelle reçoit une **note sur 100** et une **revente estimée** (modèle 2 : ventes proches retrouvées par embeddings ; repli par marque et catégorie).
- Au-dessus de la note d'alerte (75), une **notification** arrive sur le téléphone (PWA, Web Push). Elle ouvre l'affaire prête pour le **« 1 clic »** : le client ouvre l'annonce et achète lui-même.
- **Radar Auto** achète au-dessus d'un seuil de note, sous un prix maximum par article et dans un plafond par jour, avec le **porte-monnaie Vinted** du client. Si la banque demande une validation **3-D Secure**, l'achat **attend le client**. Il est **réservé aux comptes de l'équipe** et **pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché** (mention visible dans l'application).
- Le pseudo, la note et la photo du vendeur ne sont gardés que le temps de l'affaire (purge à 30 jours). Ils ne figurent jamais dans une notification ni dans un journal.

## 1. Architecture

```
 Téléphone du client (PWA)                              Machine de Marseille (Docker Compose, tunnel chiffré)
┌─────────────────────────────┐  HTTPS + cookie  ┌────────────────┐  SQL (RLS)  ┌──────────────────────────────┐
│ Radar, affaire « 1 clic »,  │ ───────────────▶ │ apps/api       │ ──────────▶ │ PostgreSQL                   │
│ Radar Auto, achats,         │                  │ /api/radar/*   │             │ radar_searches, opportunities│
│ Paramètres › Notifications  │                  │ /api/purchases │             │ purchase_requests            │
│ service worker :            │                  │ /api/push/*    │             │ radar_reads, radar_alerts    │
│  push-handler.js            │                  └───────┬────────┘             │ push_subscriptions           │
└──────────────▲──────────────┘                          │ file « selio-radar » │ embeddings_cache, cloud_*    │
               │ notification                            ▼ (reprise 3-D Secure) └──────────────▲───────────────┘
┌──────────────┴──────────────┐  Web Push (VAPID) ┌──────────────────────────────┐             │
│ Services de notification    │ ◀──────────────── │ apps/worker                  │ ────────────┘
│ des navigateurs (Google,    │                   │ radar.tick (30 s)            │
│ Mozilla, Microsoft, Apple)  │                   │ alerts.send (1 min)          │ ──▶ Ollama (modèle 2)
└─────────────────────────────┘                   │ radar.auto (30 s, verrouillé)│
                                                  │ PlaywrightRunner (@selio/    │
                                                  │ cloud) : créneaux de         │
                                                  │ navigateurs partagés avec    │
                                                  │ les actions du Cloud         │
                                                  └──────────────┬───────────────┘
                                                                 │ HTTPS, session du compte Achat,
                                                                 ▼ adresse IP de la machine (partagée)
                                                              vinted.*
```

| Partie | Où | État |
|---|---|---|
| Adaptateurs « catalog-page » (page de recherche) et « checkout-page » (bouton « Acheter », paiement, 3-D Secure, confirmation), lecteur HTML sans navigateur, fixtures synthétiques | `packages/connectors/src/vinted/adapters/v1-catalog.ts`, `v1-checkout.ts`, `html.ts` ; `fixtures/catalog-*.v1.html`, `checkout-*.v1.html`, `item-buy.v1.html` | Construit, testé sur fixtures. **Non vérifié en réel** (§9) |
| Navigateur : `fetchPage` (lire une page puis tout refermer) et `openBrowsing` (navigateur d'achat sans aucune méthode d'écriture), même lancement et mêmes créneaux que les actions du Cloud | `packages/cloud/src/runner/playwright.ts`, `fake.ts` | Construit, testé, dont un vrai Chromium sur pages locales |
| `RadarReader` (lecture d'une recherche, signaux de Vinted), `PurchaseRunner` (achat pas à pas, essai à blanc, 3-D Secure), conduite imposée par un signal, mesures pures, réglages | `packages/cloud/src/radar/` | Construit, testé |
| Contrats : recherches (source, priorité, compte Achat, facteur), annonce lue, affaire, achat (`awaiting_3ds`), mesures, alertes, abonnements push, réglages Radar et Radar Auto | `packages/contracts/src/radar.ts`, `org.ts` | Construit, testé |
| Base : migration 0012 (colonnes des recherches et des achats, `radar_reads`, `push_subscriptions`, `radar_alerts`, `embeddings_cache`, RLS forcée, deux fonctions `SECURITY DEFINER`) | `packages/db/migrations/0012_radar.sql`, `packages/db/src/repos.ts` | Construit, testé sur PostgreSQL 16 |
| Service : rythme, lecture, dédoublonnage, estimation, note, alertes, Radar Auto, reprise 3-D Secure, mesures, rétention ; pause du compte sur signal (`cloud.pauseFromSystem`) | `packages/core/src/services/radar.ts`, `radar-sources.ts`, `alerts.ts`, `cloud.ts` | Construit, testé avec un lecteur et un acheteur simulés |
| Routes `/api/radar/*`, `/api/purchases/*`, `/api/push/*`, `/api/admin/radar` ; clés VAPID | `apps/api` | Livré en parallèle : voir BUILD_STATUS |
| Passages `radar.tick`, `alerts.send`, `radar.auto`, reprise `radar.resume`, envoi Web Push, rétention | `apps/worker` | Livré en parallèle : voir BUILD_STATUS |
| Pages Radar, affaire « 1 clic », Radar Auto, achats, Paramètres › Notifications, gestionnaire `push` du service worker | `apps/web` | Livré en parallèle : voir BUILD_STATUS |

## 2. La lecture des recherches

### 2.1 Depuis le compte Achat, par Selio Cloud

Une recherche a une **source** : `demo` (le simulateur de démonstration, par défaut) ou `cloud` (lecture en direct). Avant chaque lecture en direct, le cœur vérifie (`checkLiveAccountTx`) :

1. **le compte Vinted lu** : celui choisi sur la recherche, qui doit être un compte **Achat** actif (sinon refus) ; à défaut, celui de Radar Auto ; à défaut, le premier compte Achat actif. Un compte **Perso** ou **de vente** n'est jamais lu ;
2. ce compte a un **compte Selio Cloud actif** (ni en pause, ni arrêté, ni « connexion à refaire ») avec une **session** enregistrée ;
3. l'**accord Cloud** est accepté pour la version courante du texte.

Sinon, l'erreur est claire : « Radar en direct demande Selio Cloud activé sur le compte Achat : <raison> » (409), et rien n'est lancé. Pendant un passage planifié, la recherche est simplement écartée avec sa raison. Seul le worker lit en direct : une lecture à la demande d'une recherche en direct depuis l'API répondrait 503.

Restent ensuite, toujours avant d'ouvrir le navigateur : l'arrêt global des automatisations, le coupe-circuit de la machine, le rythme de la recherche, le plafond de pages par minute de l'organisation, et le **verrou du compte Cloud**. C'est le même verrou que pour les actions du Cloud : une lecture Radar et une réponse du Cloud ne tournent jamais en même temps sur un compte (sinon « compte occupé », lecture au passage suivant).

- **Aucun mot de passe** : la session est celle que le client a ouverte lui-même dans la fenêtre sécurisée du Cloud ([CLOUD.md §1.3](CLOUD.md)).
- **Aucun cookie hors de cette session** : seuls les cookies et le stockage local des domaines Vinted (liste fermée) sont gardés, sans les cookies anti-robot (`datadome`, `cf_clearance`…), jamais réinjectés ([CLOUD.md §1.2](CLOUD.md)).
- La session est déchiffrée (données associées = identifiant du compte Cloud) puis refiltrée. Illisible : elle est effacée et le compte passe « connexion à refaire ». Après la lecture, la session relue est refiltrée et rechiffrée **seulement si c'est encore celle du début** ; si Vinted la refuse, elle est effacée.

### 2.2 Rythme

| Recherche | Intervalle de base | Constante |
|---|---|---|
| En direct | 60 s | `RADAR_READ_INTERVAL_SECONDS` |
| Prioritaire, quand Radar Auto est ouvert pour l'organisation (3 au plus, les plus anciennes d'abord) | 30 s | `RADAR_PRIORITY_INTERVAL_SECONDS`, `RADAR_MAX_PRIORITY_SEARCHES` |
| Simulateur de démonstration | 1 h | `RADAR_DEMO_INTERVAL_SECONDS` |

- L'intervalle est **multiplié par le facteur de ralentissement** courant **de l'organisation** (§2.5). `planReads` (fonction pure, horloge injectée) range les recherches dues : en retard d'abord, prioritaires ensuite, puis la plus anciennement lue.
- **Calage sur le passage** : les recherches d'une organisation sont lues l'une après l'autre ; la dernière lecture de chacune est datée de l'**heure prévue du passage** (`anchorReadAt`, si la lecture a lieu dans les 30 s qui suivent), et une recherche est due quand sa prochaine lecture tombe au plus 5 s après le passage (`RADAR_DUE_TOLERANCE_SECONDS`). Sans ce calage, la deuxième recherche, lue 8 s après la première, n'était plus due au passage suivant : 90 s au lieu de 60 s, 60 s au lieu de 30 s. Les plafonds de pages par minute restent la limite dure.
- **Plafonds de pages par minute** : 10 par organisation (réglage `settings.radar.maxPagesPerMinute`, de 1 à 60) et, dans le worker, 30 pour toute la machine (`RADAR_MAX_PAGES_PER_MINUTE_GLOBAL`). Les **pages ouvertes par un achat** Radar Auto (annonce, paiement, confirmation) y comptent aussi. Une fois un plafond atteint, plus aucune page n'est lue en direct pendant ce passage (pour l'organisation, ou pour toute la machine) ; seule une lecture qui n'a lancé **aucun navigateur** rend sa place (une erreur après le chargement de la page la garde).
- Le worker passerait **toutes les 30 s** (`radar.tick`, `RADAR_TICK_EVERY_MS`, un seul passage à la fois) ; une recherche n'est lue que si elle est due.
- **Un Chromium neuf par page** (`PlaywrightRunner.fetchPage`) : même lancement que les actions du Cloud (bac à sable, environnement minimal, contexte sans enregistrement sur le disque, dossier de travail temporaire), budget `RADAR_PAGE_BUDGET_MS` (30 s, jamais plus que `CLOUD_ACTION_TIMEOUT_MS`), puis fermeture.
- **Créneaux partagés** : les navigateurs de Radar (lectures et achats) prennent les mêmes créneaux que les actions et les fenêtres de connexion du Cloud (`BrowserSlots`, `CLOUD_MAX_BROWSERS`). Sans créneau libre en 30 s : `unavailable`, rien n'a touché Vinted, rien n'est compté, lecture au passage suivant.
- La lecture **ne suit pas les heures actives** du Cloud (8 h – 23 h) : elle continue la nuit. Les heures calmes (§4.1) ne concernent que les notifications. À décider avec Ibrahim (§9).
- Les lectures Radar ne comptent pas dans le plafond d'actions du Cloud (`automationActionsPerDay`) : elles ont leurs propres plafonds de pages.

### 2.3 Lecture d'une page

1. **Adresse** : `buildSearchUrl` donne `https://<domaine Vinted du compte>/catalog?search_text=…&price_to=…&currency=EUR&order=newest_first`. Seuls les mots-clés (plus la marque quand il n'y en a qu'une) et le prix maximum passent dans l'adresse : les identifiants numériques de Vinted pour les marques, tailles, états et catégories ne sont pas connus (§9).
2. **Chargement** : `RadarReader.readSearch` charge la page avec la session du compte Achat. **Aucune action sur la page** : ni clic, ni défilement, ni saisie. Un signal de Vinted visible dès le chargement arrête tout aussitôt.
3. **Lecture** : `parseCatalogPage` (adaptateur `vinted-catalog-v1`) lit jusqu'à 96 annonces : référence, adresse, titre, marque, taille, état, prix, port s'il est affiché, nombre de photos, photo, pseudo et note du vendeur, date de publication. La date est lue si la page donne un horodatage, sinon **estimée** depuis le texte relatif (« il y a 3 min » : maintenant − 3 min, à la minute près).
4. **Filtre local** : marques, tailles, états et prix sont filtrés **après** la lecture (`filterCatalogItems`). La catégorie, invisible sur une carte, n'est pas filtrée.
5. **Revalidation et dédoublonnage** par le cœur : chaque annonce est une donnée non fiable d'une page tierce (schéma strict, adresse https d'un domaine Vinted, photo https seulement). Une annonce déjà connue est écartée par sa **référence Vinted** (index unique par organisation : une annonce ne donne qu'une affaire, quelle que soit la recherche qui la trouve), sinon par titre et prix.
6. **Résultats** : `ok` ; `blocked` (signal de Vinted, §2.4, y compris un en-tête de vérification `cf-mitigated: challenge` quel que soit le statut) ; `not_logged_in` (session refusée : effacée, connexion à refaire) ; `page_changed` (page non reconnue : adaptateur à revoir, ou vérification que le détecteur ne connaît pas, **rien n'est inventé**) ; `timeout` ; `unavailable` (aucun navigateur lancé) ; `error` (dont un statut 5xx).
7. **Mesure d'abord** : dès que la page a été chargée, la mesure (`radar_reads`), la date de lecture et le compteur de pages sont écrits dans une transaction à part, **avant** le traitement des annonces. Une erreur ensuite ne fait jamais relire la page au passage suivant.
8. **Lectures anormales de suite** : `page_changed`, `error` ou `timeout` après lancement sont comptés par recherche (`consecutive_failures`, remis à zéro par une lecture correcte). Au bout de **3 de suite** (`RADAR_MAX_CONSECUTIVE_ANOMALIES`), Selio **arrête la lecture de la recherche** (désactivée avec la raison), double le facteur de ralentissement de l'organisation, alerte le client (notification « Radar : recherche arrêtée ») et l'écrit au journal d'audit (`radar.search_suspended`, vue opérateur). Le client la réactive lui-même après vérification.
9. **Stock initial** : à la **première lecture en direct** d'une recherche, toutes les annonces de la page sont du stock déjà en ligne ; ensuite, une annonce publiée avant la lecture précédente (marge de 2 min), ou sans date après une coupure de plus de 30 min (pause, coupe-circuit), l'est aussi. Ces affaires sont visibles dans la liste, mais **ni alerte, ni Radar Auto, ni mesure du délai** (`observed.initialStock`).

### 2.4 Arrêt au premier signal de Vinted

| Signal | Conduite |
|---|---|
| CAPTCHA (`captcha`) | Lecture arrêtée aussitôt ; compte Cloud du compte Achat **en pause** avec la raison ; email aux propriétaires et notification « Radar en pause » ; lecture comptée « bloquée » ; facteur de ralentissement recalculé |
| Avertissement (`warning`) | Idem (compté comme un blocage) |
| Blocage (`blocked`) | Idem, **plus le coupe-circuit de la machine** : 60 min sans aucune lecture Radar ni action Cloud, toutes organisations confondues |
| « Trop de requêtes » (`rate_limited`, HTTP 429) | Idem, plus le coupe-circuit de la machine |

- **Ordre imposé** par `cloud.pauseFromSystem` : la pause est écrite d'abord, seule, dans sa propre transaction ; puis le coupe-circuit ; puis l'email. La mesure, l'alerte et le déverrouillage suivent dans une autre transaction : une panne au milieu ne perd jamais la pause.
- **Rien n'est retenté.** Le client vérifie son compte dans Vinted, puis reprend le compte dans l'espace Cloud en confirmant l'avoir fait ([CLOUD.md §1.5](CLOUD.md)). Aucune tentative de résolution ni de contournement, aucun changement d'adresse ou d'empreinte.
- **Même conduite pendant un achat Radar Auto** (§6) : un signal arrête le parcours, met le compte en pause, et la demande d'achat est marquée « bloquée ». Les pages de l'achat sont **mesurées** (`radar_reads`, sorte `purchase`) et le signal compte dans le taux de blocage et le ralentissement, comme une lecture.
- La détection est celle du Cloud (`detectBlock`, `packages/cloud/src/guard.ts`) : statuts 429 et 403, domaines de services de vérification, cadres de CAPTCHA, textes en évidence. Ses motifs ont été écrits **sans page réelle** de blocage (§9).
- Le worker écrirait le déclenchement du coupe-circuit en **erreur** dans son journal (ligne « COUPE-CIRCUIT »), comme pour le Cloud : c'est l'alerte de l'opérateur.

### 2.5 Ralentissement automatique

- **Mesure** : chaque lecture écrit une ligne `radar_reads` (sorte `search`, résultat, durée, pages, annonces vues et nouvelles, facteur en vigueur) ; chaque achat Radar Auto une ligne `purchase` avec ses pages. Les lectures du simulateur sont marquées `demo` et ne comptent jamais.
- **Fenêtre glissante** : les 1 000 dernières mesures en direct **de l'organisation** (`RADAR_SLOWDOWN_WINDOW_READS`), comptées en pages. Le taux est rapporté aux pages présentes : 1 blocage sur 200 pages vaut 5 pour 1 000. Une fenêtre encore incomplète ralentit donc plus tôt, jamais plus tard.
- **Doublement** : après un blocage (lecture ou achat), si le taux (ce blocage compris) dépasse 1 pour 1 000 (`RADAR_BLOCKS_PER_1000_THRESHOLD`), le facteur **de l'organisation** double : 60 → 120 → 240 → 480 s…, pour **toutes** ses recherches en direct (même adresse, mêmes comptes Achat). Le facteur est gardé à part (`radar_org_state`) : supprimer puis recréer une recherche ne le remet pas à ×1.
- **Retour progressif** : le facteur est divisé par deux par tranche complète de 24 h sans blocage dans l'organisation (`RADAR_SLOWDOWN_RECOVERY_HOURS`), jusqu'à 1.
- **Plafond** : ×64 dans le cœur, qui applique la règle (`RADAR_MAX_SLOWDOWN_FACTOR`, contrainte 1 à 64 en base). Le module de mesures de `@selio/cloud` (`radar/metrics.ts`), qui n'est pas branché sur le planificateur, plafonne à ×8. **Écart à trancher** (§9).
- C'est la **seule** réaction automatique : jamais de changement d'adresse, de compte ou d'empreinte, jamais de relecture immédiate. Comme un blocage met aussi le compte en pause, le facteur s'applique dès la reprise.

| Situation (recherche en direct à 60 s) | Facteur | Intervalle |
|---|---|---|
| Aucun blocage | ×1 | 60 s |
| Un blocage, taux au-delà de 1 ‰ | ×2 | 120 s |
| Un deuxième blocage, taux toujours au-delà | ×4 | 240 s |
| Puis 24 h sans blocage | ×2 | 120 s |
| Puis 48 h sans blocage | ×1 | 60 s |

### 2.6 Ce que Radar ne fait jamais

| Interdit | Ce qui l'empêche dans le code |
|---|---|
| Résoudre ou contourner un CAPTCHA, une vérification ou une limite de débit | `detectBlock` sert seulement à s'arrêter ; aucune dépendance de résolution ; pause, alerte, rien n'est retenté |
| Modifier l'empreinte ou le User-Agent, masquer l'automatisation | Même lancement que le Cloud : aucun plugin « stealth », un seul argument ajouté (`--disable-dev-shm-usage`), User-Agent d'origine |
| Utiliser des proxys, masquer ou faire tourner l'adresse | Sortie par l'adresse de la machine, sans proxy |
| Lire depuis un compte Perso ou de vente, ou sans accord Cloud | `checkLiveAccountTx` ; un compte choisi sur une recherche doit être un compte Achat actif |
| Demander, stocker ou journaliser un mot de passe ; collecter d'autres cookies que la session vinted.\* du compte | Session de la fenêtre sécurisée seulement, filtrée sur la liste fermée des domaines, sans cookies anti-robot |
| Saisir un code bancaire, cliquer hors de Vinted | Le navigateur d'achat n'a aucune méthode d'écriture ; un clic n'est permis que sur une page Vinted (§6.3) |
| Garder les données personnelles des vendeurs au-delà de l'affaire | Purge à 30 jours (§8.3) |

## 3. Note et estimation de revente

### 3.1 Note de l'affaire (sur 100)

`scoreOpportunity` (`packages/domain/src/radar.ts`) explique la note critère par critère sur la fiche de l'affaire :

| Critère | Points |
|---|---|
| Marge estimée (port et protection acheteur compris) par rapport à la marge cible de la recherche | 40 |
| Taux de marge par rapport au taux cible | 15 |
| État déclaré et nombre de photos | 15 |
| Marque et demande (confiance de l'estimation, nombre de ventes comparables) | 15 |
| Fiabilité du vendeur (note, nombre d'avis) | 10 |
| Port et fraîcheur de l'annonce | 5 |

- **Coût total** = prix + port + protection acheteur (réglage `buyerFees`, 0,70 € + 5 % par défaut). Au-dessus du budget de la recherche, la note est plafonnée à 59 ; avec une marge nulle ou négative, à 10.
- Le port n'est pas toujours affiché sur la page de recherche : il compte alors pour 0 et la fiche le dit (« vérifié au paiement »).
- La raison du critère « vendeur » est **générique** (« Fiabilité du vendeur (note et avis visibles sur l'annonce) : +8/10 ») : ni la note ni le nombre d'avis ne sont recopiés dans les raisons, qui restent après la purge (§8.3).
- **Seuils** : alerte à partir de 75 (`alertMinScore`, seuil « À valider ») ; Radar Auto à partir de 85 par défaut (`autoBuy.threshold`, réglable de 50 à 100).

### 3.2 Revente estimée : modèle 2, puis repli

1. **Comparables par embeddings** (modèle 2, `OLLAMA_EMBED_MODEL`, `qwen3-embedding:0.6b` par défaut), quand l'IA sait vectoriser (`canEmbed`). Le titre de l'annonce (précédé de la marque) est comparé aux titres des **ventes de l'organisation** (jusqu'à 500, les plus récentes d'abord). On garde les **8 plus proches** au-dessus d'une similarité cosinus de **0,6**. Avec au moins 2 ventes proches, la revente est la **médiane** de leurs prix de vente, ajustée à l'état. Méthode affichée : « embeddings » ; confiance haute à partir de 5 ventes proches d'une similarité moyenne d'au moins 0,75.
2. **Repli par marque et catégorie** (méthode d'avant, « brand_category ») quand il y a moins de 2 ventes proches, ou quand l'IA n'a pas de modèle 2, est en panne, a son disjoncteur ouvert ou a épuisé son quota. Médiane des ventes de même marque et catégorie (3 au moins), sinon de même marque (2 au moins), sinon multiple prudent du prix observé (×1,6), confiance faible. **Une panne de l'IA ne bloque jamais la lecture.**
3. **Cache** : les vecteurs sont gardés dans `embeddings_cache`, par organisation, modèle et empreinte du texte (un titre modifié est revectorisé). Au plus 200 nouvelles ventes sont vectorisées par lecture. L'IA n'est jamais appelée dans une transaction.
4. L'estimation est toujours présentée comme une estimation, avec sa méthode et le nombre de comparables, jamais comme une donnée observée.

Limites :

- Le lot de comparables ne contient que les ventes de l'organisation : aucune observation de marché « vendue » n'existe en mode connecté, puisque Selio Track n'est pas construit. Le type `market` du cache est prêt pour elles.
- **§5.10 du prompt remplacera ce calcul** par le modèle de prix entraîné (gradient boosting, quantiles P25 / P50 / P75). Les comparables du modèle 2 en resteront l'un des deux moteurs.

## 4. Alertes sur le téléphone (PWA, Web Push)

### 4.1 Ce qui déclenche une notification

| Alerte | Quand | Contenu |
|---|---|---|
| Affaire (`opportunity`) | Affaire **lue en direct** (jamais une affaire simulée), nouvelle, note ≥ `alertMinScore` (75), alertes activées | « Affaire Radar : <titre de l'annonce> », prix, note, revente estimée ; ouvre `/app/radar/affaires/<id>` |
| Paiement à valider (`payment_3ds`) | Radar Auto : la banque demande une validation 3-D Secure ; puis, si le délai expire, « achat abandonné » | « Validez le paiement dans votre application bancaire » ; ouvre `/app/radar/achats/<id>` |
| Radar en pause (`blocked`) | Vinted a affiché un CAPTCHA, un avertissement, un blocage ou « trop de requêtes » ; ou une recherche arrêtée par Selio après 3 lectures anormales de suite | Le compte Achat est en pause dans Selio Cloud (ouvre `/app/cloud`) ; ou « Radar : recherche arrêtée » (ouvre `/app/radar`) |
| Radar Auto arrêté (`payment_3ds`) | Achat à l'issue incertaine (« Payer » cliqué sans confirmation reconnue) | « Radar Auto arrêté : achat à vérifier » ; ouvre `/app/radar/achats/<id>` |

- **Une seule alerte par affaire** (clé `opportunity:<id>`, index unique), même si deux lectures la trouvent ; une par demande d'achat ; une par pause. **Aucune alerte pour le stock initial** (§2.3).
- **Destinataires** : les appareils abonnés des **membres actuels** de l'organisation (jointure sur les adhésions à chaque envoi). Retirer un membre supprime ses abonnements dans la même transaction ; un rôle sans le droit de voir Radar les perd aussi. La **déconnexion** retire d'abord l'abonnement de l'appareil (sans jamais bloquer la déconnexion). Dans Paramètres › Notifications, chaque appareil abonné est listé et peut être **retiré** (`DELETE /api/push/subscriptions/:id`, ses appareils seulement), par exemple un téléphone perdu.
- **Heures calmes** (réglage `quietHours`, par exemple de 22 h à 8 h dans le fuseau de l'organisation ; aucune par défaut) : l'alerte d'affaire part à la fin de la plage, la lecture continue. Les alertes de paiement et de pause partent tout de suite.
- **Contenu minimal** : `{ title, body, url }`. Jamais de pseudo, de note ni de photo du vendeur. L'adresse est un chemin relatif de l'application, vérifié par le schéma côté serveur puis par le service worker.
- **Envoi** (`sendDueAlerts`) : une notification par appareil abonné ; l'alerte est « envoyée » dès qu'un appareil l'a reçue, sinon retentée (3 essais au plus, à 2 puis 4 min d'écart), et abandonnée au-delà de 12 h de retard ou si l'affaire a déjà été traitée. Une réponse 404 ou 410 du service de notification désactive l'abonnement, comme 5 échecs consécutifs. Sans clés VAPID, les alertes restent en file et expirent après 12 h.
- Le worker enverrait les alertes **chaque minute** (`alerts.send`, `CRON_ALERTS`), et tout de suite après une demande de validation 3-D Secure, avec une durée de vie d'une heure chez le service de notification et une urgence haute pour les affaires et les paiements. L'API proposerait une **notification de test** (`POST /api/push/test`).

### 4.2 Clés VAPID

Chaque envoi Web Push est signé avec une paire de clés **VAPID** du serveur. Les notifications passent par les services gratuits des navigateurs (Google, Mozilla, Microsoft, Apple) : aucun service payant.

```bash
# Une seule fois, sur la machine (ou le poste de l'opérateur), jamais dans le dépôt :
npx web-push generate-vapid-keys
# Même chose avec la version déjà installée dans le dépôt, sans téléchargement :
pnpm --filter @selio/worker exec web-push generate-vapid-keys
```

- Recopier « Public Key » dans `VAPID_PUBLIC_KEY` et « Private Key » dans `VAPID_PRIVATE_KEY`, **à l'identique côté API et worker**, et renseigner `VAPID_SUBJECT=mailto:<adresse de contact réelle>` (ou une URL https). Uniquement dans le fichier `.env` du serveur (`chmod 600`) : **jamais commitées**, jamais dans Netlify, jamais collées dans une conversation.
- Le navigateur ne reçoit que la clé **publique** (`GET /api/push/config`). La clé **privée** ne quitte jamais le serveur : c'est un secret au même titre que `SECRETS_ENCRYPTION_KEY`, à inclure dans la copie chiffrée des `.env` ([SAUVEGARDE.md §1.1](SAUVEGARDE.md)).
- Clés à moitié remplies ou mal formées (publique : 65 octets, privée : 32 octets, en base64 « url ») : le démarrage s'arrête. Clés absentes : notifications désactivées, et le démarrage le signale.
- **Changer de clés oblige chaque appareil à se réabonner** (un abonnement est lié à la clé publique) : ne les régénérer qu'en cas de fuite.

### 4.3 Sur l'appareil du client

- Le client activerait les notifications dans **Paramètres › Notifications** (page web livrée en parallèle, voir BUILD_STATUS) : le navigateur demande l'autorisation, s'abonne avec la clé publique, puis envoie l'abonnement à l'API. Un appareil ne reçoit les alertes que d'une seule organisation : s'il s'abonne pour une autre, l'ancien abonnement est retiré.
- **iPhone** : seulement l'application ajoutée à l'écran d'accueil (Partager › Sur l'écran d'accueil), ouverte depuis son icône (iOS 16.4 et suivants). Android et ordinateur : Chrome, Firefox, Edge. Connexion https obligatoire.
- Le service worker de la PWA (vite-plugin-pwa, mode `generateSW`) importe `public/push-handler.js`. Il affiche la notification et, au toucher, ouvre l'application sur le chemin de l'alerte (ou y ramène un onglet déjà ouvert). Rien ne tourne en permanence dans la page.
- En démonstration, rien ne part d'un serveur : la notification de test s'affiche seulement sur l'appareil.

## 5. « 1 clic »

La notification (ou le flux de Radar) ouvre la page de l'affaire (`/app/radar/affaires/<id>`, données de `GET /api/radar/opportunities/:id`) : photo, note détaillée, coût total (article + port + protection), revente et marge estimées, méthode d'estimation, et lien vers l'annonce sur Vinted (https, domaine de la liste fermée, sans paramètres).

- Le client **ouvre l'annonce et achète lui-même** sur Vinted, avec son compte. Selio n'achète rien ici (D11).
- « Je l'ai achetée » (`quickBuy`, `POST /api/radar/opportunities/:id/buy`, corps facultatif `{ paidCents }`) enregistre un achat **fait par le client** : seul l'anti-doublon bloque ; le budget de la recherche, le prix maximum et la marge estimée ne sont que des **avertissements** (le client a déjà payé), et le plafond du jour de Radar Auto ne s'applique pas. Le client peut saisir ou corriger le **prix réellement payé** (port et protection compris ; prérempli avec le coût estimé). Selio **reporte ce prix dans Manager** : un article « en stock » étiqueté `radar`, avec un événement qui garde le lien vers l'affaire. La marge se suit ensuite jusqu'à la revente.
- Au plus une demande active par affaire (index unique) : deux clics ne créent pas deux achats.

## 6. Radar Auto

### 6.1 Verrous

Tant qu'un verrou est fermé, Radar Auto n'évalue rien : `runAutoBuy` rend `{ disabled: true, reasons }`. `GET /api/radar/auto/status` (`autoStatus`, lecture seule) liste chaque verrou avec son état.

| Verrou | Par défaut | Qui l'ouvre |
|---|---|---|
| Serveur : `RADAR_AUTO_ENABLED` (API et worker) | fermé | L'opérateur, pour les tests de l'équipe |
| Adresse partagée : `RADAR_AUTO_ORG_IDS` (organisations de l'équipe) | vide | L'opérateur. Renseignée, toute autre organisation est refusée ; vide (hors production seulement), aucune restriction par organisation. En production, l'API et le worker refuseraient de démarrer avec `RADAR_AUTO_ENABLED=true` sans elle |
| Organisation : réglage `autoBuy.enabled` | désactivé | Le propriétaire (droit `purchase.execute`), par `PATCH /api/radar/settings`. Refusé (403, avec la mention) si le verrou serveur est fermé. Date et auteur de l'activation enregistrés (`enabledAt`, `enabledBy`) et audités |
| Compte Achat relié à Selio Cloud (compte Cloud actif, session enregistrée) | — | Le client, dans l'espace Cloud |
| Accord Selio Cloud pour la version courante | — | Le client |

S'y ajoutent l'arrêt global des automatisations et le coupe-circuit de la machine. **Mention visible** (`RADAR_AUTO_SHARED_ADDRESS_NOTICE`) : « Radar Auto n'est pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché : il reste réservé aux comptes de l'équipe Selio, pour les tests. »

### 6.2 Achat réel ou essai à blanc

- **Achat réel** seulement si `RADAR_AUTO_ENABLED=true` **et** `RADAR_REAL_PURCHASE=true` (D11 : désactivé par défaut). Le navigateur reprend ce verrou : `PurchaseRunner` reçoit `realPurchaseAllowed` (les deux à la fois) et refuse un achat réel sans lui, avant de lancer quoi que ce soit.
- Sinon, **essai à blanc** : le parcours va jusqu'à la page de paiement, relit le total, et **s'arrête avant le bouton de paiement**. La demande est enregistrée « simulée » (aucun paiement, aucune commande) et reste annulable pendant le délai prévu.
- Sans navigateur (l'API seule, sans worker), seules les affaires **du simulateur** sont « achetées » en simulation, sans rien ouvrir ; une affaire **lue en direct** n'est jamais simulée à la place du worker (elle attend le passage `radar.auto`), et le résultat dit `realPurchase: false`.

### 6.3 Décision et déroulé

**Décision**, pour chaque affaire nouvelle, de la mieux notée à la moins bien notée (`autoBuyDecision`, puis `runPurchaseChecks`) : note ≥ seuil (85 par défaut) ; coût total ≤ prix maximum par article (`maxItemCents`, 60 € par défaut) ; dépense du jour + coût ≤ plafond par jour (`dailyCapCents`, 150 € par défaut, jour local de l'organisation) ; marge estimée positive ; affaire pas déjà achetée. Une réservation (« en cours ») et un index unique empêchent deux passages d'acheter la même affaire ; une réservation qui n'a lancé aucun navigateur (compte occupé, aucun créneau) est retirée. **Candidates par le navigateur** : affaires lues en direct seulement (jamais celles du simulateur), avec une adresse Vinted valide, hors stock initial. **Au plus un achat par le navigateur et par passage** (rythme humain), et plus rien après un signal de Vinted.

**Plafond du jour** (`spentSince`) : achats automatiques faits (réels ou à blanc), en attente de 3-D Secure, en cours, et **toute demande dont « Payer » a été cliqué** (`payment_attempted`), même bloquée ou annulée, au total relu sinon au maximum accepté : un achat à l'issue incertaine reste compté. Les achats faits à la main par le client (« 1 clic ») n'y entrent pas.

**Arrêt automatique de Radar Auto** : après une issue incertaine (« Payer » cliqué sans confirmation reconnue) ou une validation 3-D Secure expirée, Selio remet le réglage de l'organisation à « désactivé », avec la date et la raison (`autoBuy.suspendedAt`, `suspendedReason`), et alerte le client. Rien n'est racheté tant qu'il n'a pas vérifié dans Vinted et **réactivé lui-même** Radar Auto (acquittement).

**Déroulé** dans le navigateur (`PurchaseRunner.buy`), sur les sélecteurs de l'adaptateur « checkout-page » :

1. **Annonce** : signaux de Vinted ; annonce vendue, réservée, masquée ou supprimée (aucun clic) ; prix affiché au plus égal au maximum (sinon `price_changed`, aucun clic) ; bouton « Acheter » présent.
2. **« Acheter »** : la page de paiement doit être reconnue, sinon arrêt sans paiement.
3. **Porte-monnaie Vinted** : choisi s'il est proposé ; proposé mais impossible à choisir, arrêt sans paiement. Selio ne saisit jamais de carte ni de code.
4. **Total à payer** relu, au plus égal au maximum (sinon `price_changed`, aucun paiement). Ce maximum (`autoMaxTotalCents`) est le **coût décidé à la détection + 1 €** (arrondis de la protection), **+ 8 €** si la page de recherche n'affichait pas le port ; jamais au-dessus du prix maximum par article, du reste du plafond du jour, ni du coût qui annulerait la marge estimée. Un vendeur qui monte son prix après la détection fait donc échouer l'achat avant le paiement.
   **Porte-monnaie Vinted imposé** : s'il n'est pas proposé au paiement (solde insuffisant, page changée), arrêt `wallet_not_offered` **avant « Payer »**, en essai à blanc comme en achat réel ; jamais le moyen de paiement enregistré (en général la carte) à sa place.
5. **Essai à blanc** : arrêt ici.
6. **Achat réel** : « Payer », puis confirmation (référence de commande) : achat « effectué », prix d'achat reporté dans Manager.
7. **3-D Secure** demandé par la banque : le navigateur **reste ouvert** (`CLOUD_3DS_TIMEOUT_MS`, 10 min par défaut) ; la demande passe « Validation bancaire attendue » jusqu'à l'**échéance du navigateur** (`expiresAt` rendu par le runner, jamais l'heure du début du passage) et le client reçoit une notification. Pendant l'attente, le **compte Achat est tenu** (`cloud_accounts.held_until`) : aucune lecture, aucune action Cloud, aucun second achat avec la même session. Il valide **lui-même** dans l'application de sa banque, puis touche « J'ai validé » : l'API met une reprise en file (`POST /api/purchases/:id/resume`, réponse 202) et le worker relit la page **sans recliquer ni rien saisir, sans reprendre la session ni le verrou**, et **seulement avec le compte Achat qui a ouvert ce navigateur** (`cloud_account_id` de la demande ; jamais de repli sur un autre compte, aucune session réécrite à la reprise). Délai passé : achat abandonné, compte libéré, Radar Auto arrêté, alerte « vérifiez dans Vinted », **rien n'est racheté**.

**Garanties du navigateur d'achat** : la page tenue ouverte ne sait que naviguer vers une annonce ou un catalogue Vinted, lire, cliquer sur un bouton nommé et lire l'état d'une case. **Aucune méthode n'écrit de texte.** Un clic est refusé si la page affichée n'est plus une page Vinted (la page de la banque, par exemple). Tout échec **après** le clic sur « Payer » est marqué « effets inconnus » : l'achat n'est **jamais** relancé automatiquement, l'affaire passe « en observation » et le client vérifie dans Vinted.

### 6.4 Résultats

| Issue | Demande d'achat | Affaire |
|---|---|---|
| Essai à blanc arrivé au paiement | Achetée (simulée), annulable pendant `cancelWindowMinutes` (30 min par défaut) | achetée |
| Paiement confirmé | Achetée, avec la référence de commande et le prix reporté dans Manager | achetée |
| Validation 3-D Secure demandée | Validation bancaire attendue, jusqu'à `awaiting3dsUntil` | inchangée |
| Annonce vendue, réservée ou masquée | Bloquée | écartée |
| Prix ou total au-dessus du maximum | Bloquée (« arrêt avant de payer ») | en observation |
| Signal de Vinted | Bloquée ; compte Achat en pause, client alerté | en observation |
| Session refusée | Bloquée ; connexion à refaire dans le Cloud | en observation |
| Porte-monnaie Vinted non proposé | Bloquée (« arrêt avant Payer »), rien n'est payé | en observation |
| Aucun navigateur libre, compte occupé | Réservation retirée, rien tenté ; l'affaire reste disponible | inchangée |
| Erreur, résultat incertain (« Payer » cliqué) | Bloquée (« vérifiez dans Vinted avant de relancer »), comptée dans le plafond du jour ; **Radar Auto arrêté** jusqu'à la réactivation par le client | en observation |

### 6.5 Annulation

- **Achat simulé** de Radar Auto : annulable dans Selio pendant `cancelWindowMinutes` (0 à 1 440 min, 30 par défaut) ; l'affaire est alors écartée.
- **Achat réel** : il ne s'annule pas depuis Selio. Une annulation éventuelle se fait dans Vinted, selon ses règles, et la note de la demande le dit.
- **Achat en attente de 3-D Secure** : le client peut l'abandonner (« vérifiez dans Vinted qu'aucune commande n'a été passée ») ; le worker fermerait alors le navigateur tenu ouvert.
- **Achat « 1 clic »** : fait par le client lui-même sur Vinted, il ne s'annule pas depuis Selio.

## 7. Mesures

Rien n'est présenté comme mesuré tant qu'aucune lecture en direct n'existe : `radarMetrics` rend alors le statut `to_measure` (« à mesurer ») et toutes les valeurs à `null`. Le simulateur ne compte jamais.

| Mesure | Définition | Source |
|---|---|---|
| Délai publication → détection | `detectedAt` (lecture qui a trouvé l'annonce) − `publishedAt`, seulement pour une date **absolue** ou **à la minute près** (« il y a 3 min » ; jamais « il y a 2 h » ni « il y a 3 j »), hors stock initial | Affaires lues en direct |
| Délai détection → achat | Confirmation de commande (`executedAt`) − `detectedAt` | Achats **réels** seulement |
| Blocages pour 1 000 pages | (mesures `blocked` + `captcha` + `rate_limited`, lectures et achats) ÷ pages lues en direct × 1 000 | `radar_reads` |
| Pages lues et blocages par jour | Par jour UTC, pages d'achat comprises | `radar_reads` |
| Facteur de ralentissement, intervalle effectif | Facteur de l'organisation, intervalle par recherche en direct | `radar_org_state`, `radar_searches` |

Où les lire : la page Radar (prévue, données de `GET /api/radar/metrics?days=30`, médianes) ; la vue opérateur (`GET /api/admin/radar`, compteurs par organisation sans aucune donnée d'annonce ni de vendeur, et coupe-circuit en cours) ; ou directement en base avec le **rôle propriétaire** (la RLS est forcée pour `selio_app`) :

```sql
-- Pages lues, blocages, durée et facteur par jour (lectures en direct seulement)
select date_trunc('day', read_at at time zone 'UTC')::date as jour,
       count(*) as pages,
       count(*) filter (where outcome in ('blocked', 'captcha', 'rate_limited')) as blocages,
       round(1000.0 * count(*) filter (where outcome in ('blocked', 'captcha', 'rate_limited')) / nullif(count(*), 0), 2) as pour_mille,
       percentile_disc(0.5) within group (order by duration_ms) as duree_p50_ms,
       percentile_disc(0.95) within group (order by duration_ms) as duree_p95_ms,
       max(factor) as facteur_max
from radar_reads
where source = 'cloud' and org_id = '<organisation de test>'
group by 1 order by 1;

-- Délai publication → détection (secondes), affaires lues en direct
select count(*) as affaires,
       percentile_disc(0.5) within group (order by d) as p50_s,
       percentile_disc(0.9) within group (order by d) as p90_s
from (select extract(epoch from (observed->>'detectedAt')::timestamptz - (observed->>'publishedAt')::timestamptz) as d
      from opportunities
      where org_id = '<organisation de test>' and observed->>'source' = 'connector'
        and observed->>'publishedAt' is not null and observed->>'detectedAt' is not null) t;

-- Délai détection → achat (secondes), achats réels
select p.id, extract(epoch from p.executed_at - (o.observed->>'detectedAt')::timestamptz) as secondes
from purchase_requests p join opportunities o on o.id = p.opportunity_id
where p.org_id = '<organisation de test>' and p.status = 'executed' and o.observed->>'detectedAt' is not null
order by p.executed_at;
```

Aucun repère n'existe : les 60 s et 30 s sont des cibles du prompt, pas des mesures. Les tableaux ci-dessous sont à remplir pendant la procédure de test (§10).

**Relevé par période de test**

| Période | Compte Achat (équipe) | Recherches (dont prioritaires) | Pages lues | Blocages | Pour 1 000 pages | Durée d'une lecture p50 / p95 | Publication → détection p50 / p90 | Détection → achat p50 | Facteur max | Remarques |
|---|---|---|---|---|---|---|---|---|---|---|
| à mesurer | | | | | | | | | | |

**Relevé par jour**

| Jour | Pages lues | Blocages (CAPTCHA / avertissement / blocage / 429) | Pour 1 000 pages | Facteur max | Affaires trouvées | Alertes envoyées | Achats (essai à blanc / réel / 3-D Secure) |
|---|---|---|---|---|---|---|---|
| à mesurer | | | | | | | |

## 8. Garde-fous juridiques et données

### 8.1 Avant toute activation pour un client

- **Avis écrit de l'avocat** sur la lecture en direct (elle passe par Selio Cloud, déjà soumis à son avis) et sur le bot d'achat (Radar Auto), au regard des conditions d'utilisation de Vinted et des conditions de vente de Selio. Jusque-là, Radar en direct et Radar Auto ne servent que sur des comptes de l'équipe.
- **Texte de l'accord Cloud** : il ne parle aujourd'hui que de répondre et de relancer (`CLOUD_CONSENT_TEXT`, version `2026-10-29.2`). Avant d'ouvrir Radar en direct à un client, il faut l'étendre à la lecture des recherches (et à l'achat automatique pour Radar Auto), le faire relire par l'avocat et incrémenter `CLOUD_CONSENT_VERSION` : chacun relit et accepte de nouveau.
- On ne promet jamais « zéro risque » ni « 100 % légal ». Selio est présenté comme indépendant de Vinted : ni affilié, ni approuvé, ni sponsorisé.

### 8.2 Adresse partagée

- Radar lit depuis l'adresse de la machine, comme le Cloud. Un « trop de requêtes » ou un blocage pendant une lecture Radar déclenche **le même coupe-circuit** que le Cloud (60 min, toute la machine) : un client de Radar peut donc interrompre le Cloud de tous les autres pendant une heure. Cela pèse dans la décision d'Ibrahim.
- Volume à mettre en face : une recherche lue toutes les 60 s représente 1 440 pages par jour, 2 880 à 30 s (lecture jour et nuit, §2.2).
- **Radar Auto n'est pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché.** Une adresse fixe par client reste une décision en attente (§7 du prompt).

### 8.3 Données des vendeurs

- Une carte de la page de recherche montre le pseudo, la note, le nombre d'avis et la photo de l'annonce. Ils ne sont gardés que dans l'affaire (`opportunities.observed`), le temps de l'affaire.
- **Purge** (`purgeRadarData`, appelée par la tâche de rétention quotidienne du worker) : une affaire écartée est supprimée 30 jours après sa dernière mise à jour (ses alertes avec elle) ; les autres perdent pseudo, note, nombre d'avis, photo et **adresse de l'annonce** (qui mène au vendeur) 30 jours après leur création ; une raison de la note qui citerait encore la note du vendeur (affaires d'avant le texte générique) est réécrite (le titre, le prix et les montants restent pour le suivi de la marge). Les mesures `radar_reads` (aucune donnée de vendeur) et les alertes traitées sont gardées 90 jours. Les données purgées restent dans les sauvegardes chiffrées jusqu'à leur rotation (30 jours).
- **Jamais** dans une notification (schéma du contenu), **jamais** dans un journal (le worker ne journalise que des identifiants, des codes et des compteurs ; le message d'une exception est remplacé par son type), **jamais** dans la vue opérateur (compteurs seulement).
- Les embeddings ne portent que des titres (et la marque) : ventes de l'organisation et annonces des affaires, jamais un pseudo.
- Ces données ne servent pas à Selio Track : Radar ne constitue aucune base de vendeurs.

## 9. Ce qui n'est pas fait, limites connues

- **Identifiants numériques de Vinted** pour les marques (`brand_ids[]`), tailles (`size_ids[]`), états (`status_ids[]`) et catégories (`catalog[]`) : à relever sur de vraies pages. En attendant, le filtre se fait après la lecture : une recherche « marque A ou marque B » lit une page plus large que nécessaire, et la catégorie n'est pas filtrée.
- **Sélecteurs non vérifiés en réel** : catalogue (`vinted-catalog-v1`), annonce et paiement (`vinted-checkout-v1`) sont écrits sur des fixtures synthétiques. Les paramètres de l'adresse (`price_to`, `currency`, `order=newest_first`) sont aussi à confirmer. Un nouvel état d'une page se traite dans un fichier `v2-catalog.ts` ou `v2-checkout.ts` avec ses fixtures, jamais en modifiant `v1` en place (CONNECTORS.md).
- **Motifs de blocage** (`detectBlock`) : écrits sans page réelle de CAPTCHA ou d'avertissement de Vinted, à compléter dès qu'un vrai signal est observé.
- **Date de publication** souvent estimée depuis un texte relatif : seules les dates absolues ou à la minute près entrent dans la médiane ; une page qui ne montre que « il y a 2 h » ne donne aucune mesure.
- **Porte-monnaie seulement** : aucun réglage ne permet au propriétaire d'autoriser la carte quand le porte-monnaie n'est pas proposé (arrêt avant « Payer »). À ajouter seulement sur décision d'Ibrahim.
- **Plafond de pages de la machine et achats** : un achat n'est pas lancé si le plafond de la machine est atteint, et ses pages y sont comptées après coup (le nombre de pages vient du navigateur d'achat).
- **3-D Secure** :
  - la reprise ne vit que dans la mémoire du worker ; après un redémarrage, elle rend « délai dépassé, effets inconnus » (le client vérifie dans Vinted, rien n'est racheté) ;
  - un créneau de navigateur reste pris pendant l'attente (jusqu'à `CLOUD_3DS_TIMEOUT_MS`), ce qui réduit la capacité du Cloud ; le compte Achat est tenu (aucune lecture ni action sur lui) pendant ce temps ;
  - si « Payer » redirige toute la page vers le site de la banque, ce n'est pas reconnu comme 3-D Secure : le résultat est « non confirmé », effets inconnus. À vérifier lors d'un achat réel sur un compte de l'équipe.
- **Écarts de valeurs à trancher** :
  - plafond du facteur de ralentissement : ×64 dans les contrats, la base et le cœur, qui l'appliquent ; ×8 dans `@selio/cloud` (`radar/metrics.ts`, non branché sur le planificateur) ;
  - délai 3-D Secure : aligné à 10 min par défaut (`CLOUD_3DS_TIMEOUT_MS` = 600000, transmis par l'API et le worker ; `RADAR_3DS_TIMEOUT_MINUTES` = 10 dans les contrats, repli du cœur et texte de la page Radar Auto). Si `CLOUD_3DS_TIMEOUT_MS` est changé, le texte de la page garde 10 min (le compte à rebours de l'achat suit, lui, la date enregistrée) : valeur à mesurer sur un vrai achat.
- **Lecture la nuit** : aucune plage horaire ne limite la lecture (les heures calmes ne visent que les notifications). À décider avec Ibrahim : l'aligner sur les heures actives du Cloud (8 h – 23 h) ?
- **Accord Cloud** à étendre à Radar avant toute ouverture à un client (§8.1).
- **Facturation** : Radar à 14,99 € et Radar Auto à 29,99 € (montants indicatifs) ne sont pas appliqués. La lecture en direct suppose un compte Cloud actif, donc une offre qui comprend le Cloud (Agence, ou Pro avec l'option).
- **Comparables** : ventes de l'organisation seulement tant que Track n'existe pas. Une organisation sans ventes n'a que le repli par marque et catégorie, voire le multiple ×1,6.
- **Email** : les alertes d'affaire et de paiement partent seulement en Web Push. La pause du compte part aussi par email (service Cloud), si un service d'email est branché (`EMAIL_PROVIDER`).
- **Domaines** : www.vinted.fr par défaut ; un autre domaine Vinted se règle par compte (`vintedHost`, liste fermée), à vérifier sur de vraies pages.
- **Tests** : `pnpm --filter @selio/cloud test:int` ne lance que le test d'intégration des actions du Cloud ; celui de Radar (`radar.int.test.ts`) tourne avec `pnpm --filter @selio/cloud test` quand `CLOUD_CHROMIUM_PATH` est défini.

## 10. Procédure de test sur nos propres comptes

But : vérifier sur le vrai site, **avec des comptes qui appartiennent à l'équipe**, que les pages sont reconnues, que tout s'arrête au premier signal, et mesurer les délais et le taux de blocage avant toute décision d'ouverture. **Jamais sur le compte d'un client.**

### 10.1 Préalables

- Un compte Vinted **de l'équipe**, rangé dans la catégorie **Achat** dans Selio, au sein d'une organisation de l'équipe. Pour l'étape 6 seulement : un petit solde dans son porte-monnaie Vinted.
- Une machine avec Selio Cloud activé (`CLOUD_ENABLED=true`, Chromium avec son bac à sable, [CLOUD.md §7](CLOUD.md)), l'accord Cloud accepté et la connexion faite dans la fenêtre sécurisée.
- Les clés VAPID en place (§4.2) et au moins un téléphone abonné.
- `RADAR_AUTO_ENABLED=false` et `RADAR_REAL_PURCHASE=false` jusqu'à l'étape 5 ; à partir de l'étape 5, `RADAR_AUTO_ORG_IDS=<organisation de l'équipe>`.
- Ibrahim informé du créneau ; une personne suit le journal du worker pendant toute la durée, en journée.

### 10.2 Étapes

0. **Tests locaux**, sans aucune requête vers Vinted : `pnpm --filter @selio/connectors test`, `CLOUD_CHROMIUM_PATH=… pnpm --filter @selio/cloud test` (lecture, page de blocage, achat à blanc, 3-D Secure et confirmation sur un vrai Chromium, pages locales), `pnpm --filter @selio/db test` et `pnpm --filter @selio/core test` (PostgreSQL local).
1. **Relevé à la main, sans aucune automatisation** : dans un navigateur ordinaire connecté au compte de l'équipe, ouvrir une page de recherche, une annonce et la page de paiement (sans payer). Comparer avec les fixtures (`catalog-page.v1.html`, `item-buy.v1.html`, `checkout-page.v1.html`) : grille, cartes, prix, port, date, pseudo ; bouton « Acheter » ; porte-monnaie, total, bouton de paiement. Noter les identifiants numériques des marques, tailles, états et catégories qui apparaissent dans l'adresse quand on filtre à la main. En cas d'écart : adaptateur `v2` et fixtures **avant** l'étape 2.
2. **Une recherche en direct pendant une journée** : une seule recherche (`source: cloud`), au rythme par défaut (60 s). Vérifier que les pages sont reconnues (`ok`, aucun `page_changed`), que les annonces correspondent à la page vue à la main, sans doublon, avec des notes et des reventes plausibles.
3. **Montée progressive** : 3 recherches, puis plusieurs jours d'affilée. On ne passe à l'étape suivante qu'avec **zéro blocage**.
4. **Notifications** : notification de test sur chaque appareil (Android, iPhone en application installée, ordinateur) ; vraie alerte d'affaire ; heures calmes ; le toucher ouvre la bonne affaire ; aucun pseudo, aucune note, aucune photo de vendeur dans la notification.
5. **Radar Auto en essai à blanc** : `RADAR_AUTO_ENABLED=true`, `RADAR_AUTO_ORG_IDS=<organisation de l'équipe>`, `RADAR_REAL_PURCHASE=false` ; activation dans l'organisation ; recherches prioritaires (30 s). Vérifier que chaque achat s'arrête avant le bouton de paiement (« simulé »), que le total relu correspond à la page, que le porte-monnaie est choisi, que l'annulation fonctionne.
6. **Achat réel, sur décision écrite d'Ibrahim seulement** : `RADAR_REAL_PURCHASE=true` le temps du test, prix maximum et plafond du jour bas, un article que l'équipe veut vraiment acheter, paiement par le porte-monnaie. Si possible, un cas 3-D Secure (carte qui le demande) : notification, validation dans l'application bancaire, reprise. Revenir aussitôt à `RADAR_REAL_PURCHASE=false`.
7. **Fin** : `RADAR_AUTO_ENABLED=false`, recherches en direct désactivées, compte Cloud arrêté (session effacée) si le test est terminé ; tableaux du §7 remplis ; un court point pour Ibrahim (fait, mesuré, bloqué).

### 10.3 Ce qu'on mesure

- Par jour et par période : les tableaux du §7 (pages lues, blocages et leur type, taux pour 1 000 pages, facteur maximal, durée d'une lecture p50 / p95, délais publication → détection et détection → achat).
- Exactitude de la lecture : sur 20 annonces tirées au hasard, comparer à la main le titre, le prix, le port, la marque, la taille, l'état et la date avec la page Vinted, et noter le taux de champs justes.
- Notifications : délai entre la détection et l'arrivée sur le téléphone, par appareil.
- Achat : durée du parcours jusqu'au paiement ; délai de la validation 3-D Secure par le client.
- Charge : navigateurs ouverts en même temps et mémoire, en regard de `pnpm cloud:bench` ([CLOUD.md §4](CLOUD.md)).

### 10.4 Critères d'arrêt immédiat

Le test s'arrête (recherches désactivées, `RADAR_AUTO_ENABLED=false`) et la suite attend une décision d'Ibrahim dès que :

- un CAPTCHA, un avertissement, un blocage ou un « trop de requêtes » apparaît, **même une seule fois** (la pause automatique s'est faite ; on ne reprend pas le même jour) ;
- Vinted envoie un message, un email ou une restriction au compte de test ;
- le taux dépasse 1 blocage pour 1 000 pages sur la période, ou le coupe-circuit de la machine se déclenche ;
- une page n'est plus reconnue (`page_changed`) ou une annonce lue ne correspond pas à la page ;
- un clic inattendu, un total payé au-dessus du maximum, un achat en double ou un résultat « effets inconnus » ;
- une donnée de vendeur (pseudo, note, photo) apparaît dans un journal ou une notification ;
- le Cloud des autres comptes est gêné (créneaux saturés, actions reportées).

### 10.5 Journal du test

| Date | Étape | Réglages (recherches, rythme, verrous) | Durée | Pages | Blocages | Incident | Décision |
|---|---|---|---|---|---|---|---|
| à remplir | | | | | | | |

## 11. Exploitation

### Réglages

Variables d'environnement : [CLES-ET-CONFIGURATION.md §11](CLES-ET-CONFIGURATION.md). Réglages de l'organisation (`PATCH /api/radar/settings`, `updateRadarSettings`) : alertes (activées, note minimale, heures calmes) et pages lues par minute ; Radar Auto (activation, seuil, prix maximum par article, plafond par jour, délai d'annulation, compte Achat). Sur chaque recherche : source (simulateur ou en direct), priorité (3 au plus), compte Achat lu.

### Arrêt d'urgence

- **Une recherche** : la désactiver.
- **Un compte Achat** : pause ou arrêt dans l'espace Cloud (arrêter efface aussi la session).
- **Une organisation** : l'arrêt global des automatisations bloque aussi Radar en direct et Radar Auto.
- **Radar Auto partout** : `RADAR_AUTO_ENABLED=false` côté API et worker, puis redémarrage ; le worker retirerait le planning `radar.auto`.
- **Toute lecture en direct** : `CLOUD_ENABLED=false` puis redémarrage du worker ; seul le simulateur continue. Le coupe-circuit automatique fait la même chose pendant 60 min après un « trop de requêtes » ou un blocage ; levée manuelle, après vérification : `update cloud_runtime set suspended_until = null, reason = null;`.
- **Arrêt du worker** : plus aucune lecture ni aucun achat ne démarre, ceux en cours se terminent (au plus `RADAR_PURCHASE_TIMEOUT_MS` + 15 s), et les navigateurs tenus ouverts pour une validation 3-D Secure sont fermés (les demandes expireront, avec une alerte).

### Restauration

`select app_cloud_after_restore();` (obligatoire après toute restauration, [SAUVEGARDE.md §7](SAUVEGARDE.md)) met tous les comptes Cloud en pause et efface les sessions : Radar en direct s'arrête jusqu'à ce que chaque client se reconnecte et reprenne.

## 12. FAQ client

**Selio achète-t-il à ma place ?** Avec Radar, non : vous recevez une alerte, vous ouvrez l'annonce sur Vinted et vous achetez vous-même. Radar Auto (l'achat automatique) n'est pas ouvert aux clients pour l'instant.

**Selio connaît-il mon mot de passe Vinted ?** Non. Radar lit avec la session de votre compte Achat, que vous avez ouverte vous-même dans la fenêtre sécurisée de Selio Cloud. Votre mot de passe n'est ni enregistré, ni journalisé.

**Pourquoi un compte « Achat » ?** Radar ne lit jamais depuis vos comptes de vente ni depuis un compte personnel : si Vinted réagit, seul le compte Achat est concerné.

**Que se passe-t-il si Vinted affiche un CAPTCHA ?** La lecture s'arrête, le compte Achat se met en pause et vous êtes prévenu. Vérifiez votre compte dans Vinted, puis reprenez-le dans l'espace Cloud. Rien n'est retenté entre-temps, et les lectures suivantes ralentissent.

**Mon compte peut-il être sanctionné ?** C'est possible : les conditions de Vinted interdisent les outils automatisés, et nous ne promettons jamais « zéro risque ». Radar lit rarement, à visage découvert, et s'arrête au premier signal.

**La note et la revente sont-elles sûres ?** Ce sont des estimations, calculées à partir de vos ventes les plus proches (ou, à défaut, de la marque et de la catégorie). La fiche dit toujours comment elles ont été obtenues.

**Pourquoi la notification ne montre-t-elle pas le vendeur ?** Nous ne gardons pas les données des vendeurs au-delà de l'affaire, et nous ne les envoyons jamais dans une notification.

**Selio est-il lié à Vinted ?** Non. Selio est un outil indépendant : ni affilié, ni approuvé, ni sponsorisé par Vinted.
