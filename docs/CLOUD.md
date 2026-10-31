# Selio Cloud

Selio Cloud agit sur un compte Vinted depuis notre machine de Marseille quand l'ordinateur du client est éteint : répondre à un message, relancer un acheteur après 24 h. Ce document décrit ce que fait le code (pas ce qu'il devrait faire), ce qui est interdit et pourquoi, la capacité, les offres, les limites et l'exploitation.

> **État au 29 octobre 2026.** Le socle (`packages/cloud`), les contrats, la base (migration 0011), le service du cœur (`packages/core/src/services/cloud.ts`), les routes de l'API, les tâches du worker et l'espace `/cloud` sont construits et testés, sur des pages locales et sur PostgreSQL local. Une revue de sécurité a été corrigée le même jour (bac à sable de Chromium, environnement minimal, domaines Vinted en liste fermée, redirections de la fenêtre de connexion, CAPTCHA pendant la connexion, ticket à usage unique, relectures sous verrou, coupe-circuit de la machine, restauration). **Rien n'a jamais été exécuté contre Vinted.** Le Cloud est **désactivé par défaut** (`CLOUD_ENABLED=false`). Aucune activation pour un client avant l'avis de l'avocat (voir PRODUCTION-CHECKLIST.md). État détaillé : [BUILD_STATUS.md](BUILD_STATUS.md).

## En bref

- Le client donne son **accord écrit** (écran d'accord versionné), puis **se connecte lui-même** à Vinted dans une fenêtre sécurisée. Selio ne voit, ne garde et ne journalise **jamais** son mot de passe.
- Seule la **session** du compte (cookies et stockage local des domaines vinted.\*) est gardée, **chiffrée**, une par compte, supprimable en un clic.
- Un navigateur Chromium **s'ouvre seulement pour agir**, avec son **bac à sable** et un environnement minimal, dans un contexte **sans enregistrement sur le disque**, au **rythme humain** et dans les **plafonds de l'offre**, puis se referme.
- Au **premier** CAPTCHA, avertissement, blocage ou « trop de requêtes » (pendant une action **ou pendant la connexion**), le compte **se met en pause**, le client est prévenu, **rien n'est retenté**. Après un « trop de requêtes » ou un blocage, **tout le Cloud de la machine** s'arrête une heure (adresse partagée).
- Chaque action est inscrite dans un **journal** visible par le client, gardé **90 jours**.
- Au lancement, tous les comptes partagent l'adresse IP de la machine : **actions légères seulement** (répondre, relancer). Les actions lourdes attendent une décision d'Ibrahim.

## 1. Architecture

```
 Navigateur du client (espace /cloud)                     Machine de Marseille (Docker Compose, tunnel chiffré)
┌──────────────────────────────┐   HTTPS + cookie   ┌────────────────┐   SQL (RLS)   ┌──────────────────────────────┐
│ accord, comptes, journal,    │ ─────────────────▶ │ apps/api       │ ────────────▶ │ PostgreSQL                   │
│ réglages                     │                    │ /api/cloud/*   │               │ cloud_consents               │
│ fenêtre de connexion :       │ ◀── WebSocket ───▶ │ relais         │               │ cloud_accounts (session      │
│  images JPEG ◀ / ▶ souris,   │   (ticket court)   └───────┬────────┘               │   chiffrée), cloud_actions   │
│  clavier                     │                            │ Redis pub/sub          │ (90 j), cloud_login_sessions,│
└──────────────────────────────┘                            │ cloud:screen:<id> ▲    │ jobs (runs_in = 'cloud')     │
                                                            │ cloud:input:<id>  ▼    └──────────────▲───────────────┘
                                                            │ file « selio-cloud-login »            │
                                                    ┌───────▼───────────────────────────────────────┴──┐
                                                    │ apps/worker : cloud.tick (CRON_CLOUD, chaque     │
                                                    │ minute) → runCloudTick / runDueCloudJobs (core)  │
                                                    │ cloud.login → fenêtre de connexion               │
                                                    │   PlaywrightRunner (@selio/cloud)                │
                                                    │   └─ Chromium neuf + profil temporaire, puis     │
                                                    │      fermeture et suppression du profil          │
                                                    └──────────────────────┬───────────────────────────┘
                                                                           │ HTTPS, adresse IP de la machine (partagée)
                                                                           ▼
                                                                       vinted.*
```

| Partie | Où | État |
|---|---|---|
| Socle navigateur : exécuteur Playwright, fenêtre de connexion et sa garde de navigation, filtre de session, détection des signaux, rythme, créneaux de navigateurs, dossiers de travail, vérification du bac à sable, banc de capacité | `packages/cloud` (`@selio/cloud`) | Construit. 94 tests, dont 8 sur un vrai Chromium (pages locales, jamais vinted.fr) |
| Contrats : accord, comptes, journal, fenêtre de connexion, codes, raisons de pause, constantes de rythme, **liste fermée des domaines Vinted** (`VINTED_DOMAINS`), cookies anti-robot écartés | `packages/contracts/src/cloud.ts`, `vinted-domains.ts` | Construit, testé |
| Base : tables Cloud sous RLS forcée, coupe-circuit `cloud_runtime`, fonctions `SECURITY DEFINER` limitées, `app_cloud_after_restore()` | `packages/db/migrations/0011_cloud.sql`, `packages/db/src/repos.ts` | Construit, testé sur PostgreSQL 16 |
| Service : accord, disponibilité selon l'offre, comptes, fenêtre de connexion, planificateur, journal, maintenance, coupe-circuit | `packages/core/src/services/cloud.ts` | Construit, 44 tests avec un exécuteur simulé |
| Routes `/api/cloud/*` et relais WebSocket (ticket à usage unique) | `apps/api` | Construit, testé (Redis local) |
| Tâches `cloud.tick` et `cloud.login` | `apps/worker` | Construit, testé (FakeRunner) |
| Espace `/cloud` (tableau de bord, accord, comptes, journal, réglages, fenêtre de connexion) | `apps/web` | Construit, testé (API et démonstration) |

### 1.1 Le navigateur n'est ouvert que pour agir

- **Un Chromium neuf par action** (`PlaywrightRunner.run`, `chromium.launch` puis `browser.newContext`) : le **contexte de navigation est sans enregistrement** (cookies et stockage local en mémoire, jamais dans un fichier de profil), et un **dossier de travail temporaire neuf** (droits 0700, préfixe `selio-cloud-`) sert de HOME, TMPDIR et dossier d'artefacts à Chromium ; il est supprimé à la fin. Le worker est seul sur `CLOUD_PROFILE_DIR` : au démarrage, il supprime **tous** les `selio-cloud-*` restants (quel que soit leur âge), puis, à chaque passage, ceux plus vieux que la plus longue action ou fenêtre (plus 3 min). Aucun processus permanent par compte.
- **Bac à sable de Chromium actif** (`chromiumSandbox: true`, jamais `--no-sandbox`) et **environnement minimal en liste blanche** (`PATH`, langue, fuseau, polices, affichage ; HOME et TMPDIR dans le dossier de travail) : Chromium ne voit jamais `SECRETS_ENCRYPTION_KEY`, `DATABASE_URL`, les clés de paiement ni aucune autre variable du worker. Au démarrage, le worker vérifie que Chromium se lance avec son bac à sable (`probeChromium`) ; sinon **le Cloud reste désactivé**. `CLOUD_CHROMIUM_SANDBOX=false` n'existe que pour un poste de développement en root et est refusé en production. Un test lance un faux exécutable qui enregistre les arguments et l'environnement réellement transmis par Playwright.
- Déroulé d'une action : injection de la session (cookies, puis stockage local au chargement de la page) → ouverture de la conversation → reconnaissance de la page par l'adaptateur Vinted v1 → écriture et envoi → relecture de la session (filtrée) → fermeture.
- **Aucun clic à l'aveugle.** La conversation doit être reconnue avant d'écrire : la lecture réutilise `parseConversationPage` de l'adaptateur v1 du connecteur (`packages/connectors`), sans recopier ses sélecteurs. L'envoi ne compte comme fait que si le message apparaît dans la conversation. Sinon, le résultat est `timeout` avec `sideEffects: "unknown"`, et le service ne renvoie jamais le message tout seul.
- **Durée maximale** d'une action : `CLOUD_ACTION_TIMEOUT_MS` (90 s), navigateur compris. **Navigateurs simultanés** : `CLOUD_MAX_BROWSERS` (5), partagés entre les actions et les fenêtres de connexion (`BrowserSlots`) ; les fenêtres de connexion n'en prennent jamais plus que `CLOUD_MAX_BROWSERS - 1` (et 2 par organisation). Une action qui n'obtient pas de navigateur en 30 s, ou dont le Chromium ne démarre pas, rend `unavailable` : **rien n'a touché Vinted**, la tâche est remise en file, sans ligne de journal, sans compteur `cloud.action` et sans consommer le délai humain.
- Lancement de Chromium : langue `fr-FR`, fuseau `Europe/Paris`, un seul argument ajouté par nous (`--disable-dev-shm-usage`, pour Docker ; Chromium écrit alors sa mémoire partagée dans TMPDIR, c'est-à-dire le dossier de travail), bac à sable actif, environnement minimal. Rien qui touche à l'empreinte (voir §2).

### 1.2 Une session chiffrée par compte

- **Filtre avant tout stockage** : seuls les cookies des **domaines de Vinted** et le stockage local des origines `https://…` de ces domaines sont gardés (`filterStorageState` dans `packages/cloud`, `filterVintedStorageState` dans les contrats). Les domaines sont une **liste fermée** (`VINTED_DOMAINS` : vinted.fr, .be, .lu, .nl, .de, .at, .es, .pt, .it, .co.uk, .ie, .com, .pl, .cz, .sk, .lt, .hu, .ro, .hr, .si, .gr, .se, .dk, .fi), partagée par les contrats, le cœur et `@selio/cloud` : `vinted.lol`, `vinted.xyz`, les imitations (`vinted.fr.evil.com`, `notvinted.fr`), Google, Facebook et tout le reste sont écartés. Le réglage `vintedHost` d'une connexion n'accepte qu'un domaine de cette liste. **Les cookies de passage des services anti-robot** (`datadome`, `cf_clearance`, `__cf_bm`, `_abck`, `reese84`…) ne sont jamais gardés ni réinjectés : une vérification passée par un humain ne sert jamais de laissez-passer au robot. Une entrée illisible donne une session vide, sans message d'erreur qui recopierait une valeur.
- **Chiffrement** : AES-256-GCM (`SecretBox` de `@selio/db`), clé `SECRETS_ENCRYPTION_KEY` hors base, **données associées = identifiant du compte Cloud** (un chiffré recopié sur un autre compte ne se déchiffre pas). Colonne `cloud_accounts.session_ciphertext`.
- **Jamais exposée** : les lectures ordinaires de la base ne renvoient pas la colonne chiffrée ; l'API ne dit que « une session est enregistrée » et sa date.
- **En clair** seulement dans la mémoire du worker et de Chromium pendant une action ou une connexion (contexte sans enregistrement : aucun fichier de cookies). Le dossier de travail (en mémoire vive conseillé, voir §7) ne reçoit que les fichiers temporaires de Chromium.
- **Réécrite après une action seulement si c'est encore la même session** (date d'enregistrement inchangée, compte non arrêté, relu sous verrou de ligne) : jamais recréée après « Arrêter » ou « Supprimer la session », jamais une session neuve (reconnexion pendant l'action) écrasée par l'ancienne.
- **Supprimée** : par le client en un clic ; quand il arrête le Cloud ; quand il déconnecte ou supprime le compte Vinted (suppression en cascade) ; quand Vinted ne reconnaît plus la session (`not_logged_in`, le client doit se reconnecter) ; quand l'offre ne permet plus le Cloud, quelle qu'en soit la raison (Accès de base, Starter, Pro sans l'option ouverte), ou pour les comptes au-delà du nombre permis par l'offre, au passage de maintenance suivant ; après toute restauration d'une sauvegarde (`app_cloud_after_restore()`, voir SAUVEGARDE.md). Une session supprimée reste dans les sauvegardes chiffrées jusqu'à leur rotation (30 jours), sans jamais être réutilisée.

### 1.3 Fenêtre de connexion sécurisée

Le client se connecte **lui-même** : Selio ne lui demande jamais son mot de passe.

1. Le client clique « Se connecter » sur un compte. L'API crée une fenêtre de connexion (`cloud_login_sessions`) et renvoie un **ticket** aléatoire, montré une seule fois. Seule son **empreinte SHA-256** est en base. Il expire après `CLOUD_LOGIN_TIMEOUT_MS` (5 min, même valeur que `CLOUD_LOGIN_TTL_MINUTES` affichée par l'application). Il **ne sert qu'une fois** : la première WebSocket le consomme (`attached_at`), toute seconde connexion est refusée. Au plus 2 fenêtres ouvertes par organisation ; aucune tant qu'une pause venue de Vinted n'a pas été acquittée.
2. Le worker ouvre Chromium sur la page de connexion de Vinted. Il filme la page par **capture d'écran CDP** (`Page.startScreencast`) : images JPEG de qualité 60, 2 à 4 par seconde.
3. Les images vont du worker à l'API par **Redis pub/sub** (`cloud:screen:<id>`), puis au navigateur du client par **WebSocket** (`/api/cloud/login/:id/ws?ticket=…`). Si la WebSocket se ferme avant la fin (onglet fermé, coupure), la fenêtre est **annulée** : le worker referme Chromium aussitôt, rien de ce qui a été tapé ne reste ouvert. Les clics et frappes du client font le chemin inverse (`cloud:input:<id>`). Ils sont validés par un schéma strict côté API, puis à nouveau côté worker, et rejoués dans Chromium (CDP `Input.*`). Le pub/sub ne stocke rien.
4. **Aucune frappe n'est journalisée** ni citée dans une erreur, ni par le worker, ni par l'API, ni par `@selio/cloud`. Les journaux ne contiennent que des identifiants, des codes et des compteurs.
5. Le cadre principal ne peut aller que sur une page **https** de Vinted (liste fermée) ou d'un fournisseur de connexion, sur le port par défaut. La première requête d'une navigation est filtrée (`route`) ; comme ce filtre ne voit pas les **redirections HTTP**, chaque étape de redirection du cadre principal et chaque page affichée sont revérifiées, et la fenêtre est **fermée** (« refused ») au moindre écart. Aucune requête n'atteint la machine elle-même ni le réseau local (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, IPv6 locales). Les fenêtres surgissantes sont fermées : la connexion par Google, Facebook ou Apple n'est donc **pas** prise en charge (e-mail et mot de passe seulement, à valider).
6. **CAPTCHA, avertissement, blocage ou « trop de requêtes » pendant la connexion** (`blockSignal`, même détection que pour les actions, sans attendre de page de membre) : la fenêtre est fermée **sans lire ni enregistrer la session**, le compte passe en pause avec la raison, les propriétaires reçoivent l'email, et un « trop de requêtes » ou un blocage déclenche le coupe-circuit de la machine. Le client doit vérifier son compte dans Vinted, reprendre en le confirmant, puis se reconnecter. C'est la règle la plus stricte ; un assouplissement (garder la session sans les cookies anti-robot) serait une **décision d'Ibrahim**.
7. Dès que la connexion est détectée (et qu'aucun signal n'est affiché), la session est lue, filtrée et chiffrée, et le compte passe « actif ». La fenêtre se ferme et le dossier de travail est supprimé.

Côté API : origine vérifiée avant la mise à niveau WebSocket, ticket consommé à la mise à niveau (le verrou Redis reste une seconde barrière contre deux connexions simultanées), au plus 5 ouvertures de fenêtre par quart d'heure et par utilisateur, `CLOUD_ENABLED=true` qui exige `REDIS_URL`.

### 1.4 Planificateur au rythme humain

- Les règles d'automatisation « répondre à un nouveau message » et « relancer sans réponse » créent des tâches `jobs` avec `runs_in = 'cloud'` quand le compte de la conversation est actif dans le Cloud (`decideRunsIn` dans `automation.ts`). Les autres tâches restent sur le serveur ou l'extension. Un compte **Perso** n'est jamais utilisé.
- Le worker fait un passage chaque minute (`CRON_CLOUD`) : `runCloudTick` parcourt les organisations qui ont des comptes Cloud, en parallèle jusqu'à `CLOUD_MAX_BROWSERS`.
- **Au plus une action par compte et par passage.** Avant d'ouvrir le navigateur, `planAccountRun` vérifie dans cet ordre : arrêt global des automatisations, coupe-circuit de la machine, accord valide pour la version courante, offre compatible, compte dans le nombre de comptes de l'offre (les plus anciens d'abord), compte actif, session présente, niveau d'action autorisé, heures actives, plafond du jour, plafond horaire, délai depuis la dernière action.
- **Relu sous verrou juste avant chaque action**, dans la transaction qui prend la tâche : arrêt global, coupe-circuit, accord, offre et plafond de comptes. Un arrêt d'urgence déclenché pendant un passage arrête donc aussi les comptes suivants de ce passage.
- **Horloge relue** à chaque compte et à la fin de chaque action : `lastActionAt` et la fin de l'action dans le journal sont l'instant réel de fin (le délai humain se compte en temps réel, une action ne démarre pas après la fin des heures actives).

| Garde-fou | Valeur actuelle | Où |
|---|---|---|
| Heures actives | Dans le fuseau de l'organisation : 8 h – 23 h partout (`CLOUD_ACTIVE_HOURS` `8-23` côté API et worker, `CLOUD_ACTIVE_HOURS_DEFAULT` des contrats, `pacing.ts`) | `CLOUD_ACTIVE_HOURS`, `CLOUD_ACTIVE_HOURS_DEFAULT` |
| Plafond par jour | `automationActionsPerDay` de l'offre, pour toutes les actions Cloud de l'organisation depuis 0 h UTC (compteur d'usage `cloud.action`) | `PLAN_QUOTAS` |
| Plafond par heure | 12 actions par compte | `CLOUD_MAX_ACTIONS_PER_HOUR` |
| Délai entre deux actions d'un compte | 3 min au moins, plus 0 à 4 min tirées au hasard | `CLOUD_MIN_MINUTES_BETWEEN_ACTIONS`, `CLOUD_JITTER_MAX_MINUTES` |
| Tâche trop ancienne | plus de 24 h : écartée (on ne répond pas avec des jours de retard) | `CLOUD_JOB_MAX_AGE_HOURS` |
| Passage interrompu | compte verrouillé depuis plus de 15 min : la tâche est marquée en échec, jamais renvoyée, et le compte passe **en pause « interrupted »** (Vinted a pu afficher un signal que personne n'a lu) | `CLOUD_LOCK_STALE_MINUTES` |
| Coupe-circuit de la machine | 60 min sans aucune action Cloud après un « trop de requêtes » ou un blocage | `CLOUD_CIRCUIT_BREAKER_MINUTES` |

Aucune de ces valeurs n'est mesurée : ce sont des valeurs prudentes, à revoir après observation. Un verrou par compte (`running_since`) et une prise conditionnelle de la tâche empêchent qu'une même tâche parte deux fois, même avec deux passages simultanés. Chaque passage **qui a ouvert le navigateur** compte une action `cloud.action` : faite, en échec, ou mise en pause par Vinted. Un refus avant lancement (navigateur jamais ouvert) ne compte pas. Il reste à décider avec Ibrahim si un CAPTCHA doit consommer le quota.

`packages/cloud/src/pacing.ts` contient un second jeu de délais (45 à 180 s entre deux actions) que le planificateur n'utilise pas : le cœur applique 3 min + 0 à 4 min (voir §6).

### 1.5 Pause au premier avertissement

- `detectBlock` (`packages/cloud/src/guard.ts`) cherche les signaux de Vinted : statuts HTTP 429 et 403, domaine d'un service de vérification, cadres de CAPTCHA visibles, textes « en évidence » (titre, titres, alertes, boîtes de dialogue, pages courtes sans champ de saisie). Les scripts et le corps des messages sont ignorés : un script anti-robot chargé partout, ou un acheteur qui écrit « trop de requêtes », ne déclenchent pas de pause.
- `captcha`, `warning`, `blocked`, `rate_limited` → le compte passe **en pause avec la raison**. La pause est écrite **seule et d'abord** (transaction courte) : elle survit à un échec de l'enregistrement du reste. Les propriétaires de l'organisation reçoivent un email (« le compte est en pause »), et **rien n'est retenté**. La reprise exige que le client confirme avoir vérifié son compte dans Vinted (`resume` avec `acknowledge: true`).
- `rate_limited` et `blocked` visent souvent l'**adresse** plutôt que le compte : **coupe-circuit de la machine** (`cloud_runtime.suspended_until`, 60 min) — plus aucune action Cloud, toutes organisations confondues ; le worker l'écrit en **erreur** dans son journal (alerte de l'opérateur). Levée manuelle après vérification : `update cloud_runtime set suspended_until = null, reason = null;`. Durée et principe **à valider avec Ibrahim** (le prompt ne prévoyait qu'une pause par compte).
- Une exception pendant l'action (navigation en cours, calque qui masque le bouton, délai d'une étape) n'est plus classée « erreur » d'emblée : la page est **relue avec `detectBlock`** ; un CAPTCHA ou une page de vérification rend le code du signal, donc la pause.
- À l'arrêt du worker (SIGTERM), plus aucune action ne démarre et celle en cours se termine (attente `CLOUD_ACTION_TIMEOUT_MS` + 15 s ; `TimeoutStopSec=150` et `KillMode=mixed` côté systemd, `stop_grace_period: 150s` côté Docker).
- `not_logged_in` → la session est effacée et le compte repasse « connexion à refaire ».
- Si l'exécuteur ne sait pas s'il a cliqué (`sideEffects` inconnu), la tâche est marquée en échec et n'est jamais renvoyée. Si rien n'a été cliqué, elle attend la reprise.
- Les motifs ont été écrits **sans page réelle** de blocage ou d'avertissement Vinted. Ils sont à compléter dès qu'un vrai signal est observé.

### 1.6 Journal des actions (90 jours)

- Table `cloud_actions` : sorte d'action, niveau, statut (`queued`, `running`, `done`, `failed`, `skipped`, `paused`), dates. Le détail a des clés fermées : code, durée, référence de conversation, longueur du message. **Jamais le texte du message, jamais un secret.**
- Le client consulte le journal et l'exporte en CSV (formules neutralisées). Purge à 90 jours par `cloudMaintenance` / `purgeCloudJournal`, que le worker appellerait chaque jour (voir BUILD_STATUS).
- Audit (`audit_logs`) : `cloud.consent.accepted`, `cloud.account.enabled` / `paused` / `resumed` / `stopped` / `needs_login` / `settings_updated`, `cloud.session.deleted`, `cloud.login.started` / `completed` / `cancelled`, `cloud.journal.exported`.

### 1.7 Écran d'accord versionné

- Texte dans `CLOUD_CONSENT_TEXT`, version dans `CLOUD_CONSENT_VERSION` (`2026-10-29.1`) : règles de Vinted contre les outils automatisés, adresse IP partagée (un compte sanctionné peut faire bloquer l'adresse pour tous), pause au premier avertissement, aucun mot de passe gardé, session seule gardée, chiffrée et supprimable, journal de 90 jours, responsabilité du titulaire du compte, indépendance vis-à-vis de Vinted. Jamais « zéro risque ».
- L'accord exige une case cochée (`accepted: true`) et la version affichée. Sont enregistrés (`cloud_consents`) : version, **empreinte SHA-256 du texte**, date, utilisateur, adresse IP.
- **Sans accord valide pour la version courante (version et empreinte), aucune activation ni aucune action Cloud** (`no_consent`). Changer le texte oblige à changer la version : tout le monde doit relire et accepter à nouveau.
- Permissions : `cloud.read` pour tous les rôles ; `cloud.manage` (accepter l'accord, activer, mettre en pause, arrêter, effacer une session, ouvrir la fenêtre de connexion) pour propriétaire et administrateur.

## 2. Ce qui est interdit, et pourquoi

| Interdit | Pourquoi | Ce qui l'empêche dans le code |
|---|---|---|
| Résoudre ou contourner un CAPTCHA, à la main ou par un service payant | Un CAPTCHA est la façon dont Vinted dit « stop ». Le contourner, c'est passer outre une protection de la plateforme, ce que l'étude juridique exclut. | `detectBlock` sert uniquement à s'arrêter, pendant les actions **et** pendant la connexion (fenêtre fermée sans enregistrer la session). Aucune dépendance de résolution. Cookies de passage anti-robot jamais gardés ni réinjectés. Pause, email, reprise par le client seulement. |
| Falsifier l'empreinte du navigateur : plugin « stealth », User-Agent modifié, options qui masquent l'automatisation | Se faire passer pour un humain sur un autre appareil est une tromperie. Notre position : agir à visage découvert, rarement, ou ne pas agir. | `CHROMIUM_ARGS` ne contient que `--disable-dev-shm-usage`. `ignoreDefaultArgs` n'est jamais utilisé. Un test vérifie que Chromium se présente comme `HeadlessChrome`. |
| Stocker, journaliser ou transmettre le mot de passe Vinted (y compris à l'IA) | Un mot de passe stocké est une cible, et il donnerait un accès complet au compte. | Aucun type ne porte de mot de passe. Les frappes sont relayées sans être lues ni écrites. L'IA ne voit jamais la fenêtre. |
| Collecter globalement les cookies ou sessions | Minimisation des données (RGPD) et règle non négociable. | Filtre vinted.\* avant tout chiffrement, testé contre les imitations de domaine. |
| Masquer l'adresse IP, proxy par compte | Règle non négociable du projet. | Le Cloud sort par l'adresse de la machine, sans proxy. L'adresse fixe par client reste une décision d'Ibrahim. |
| Retenter automatiquement après un signal de Vinted | Insister après un avertissement aggrave le risque pour le compte et pour l'adresse partagée. | Pause avec la raison. La reprise demande l'acquittement du client. |
| Garder un navigateur ouvert en permanence par compte | Ce n'est pas un usage humain, et c'est inutile. | Un Chromium par action, fermé ensuite. |
| Lancer Chromium sans bac à sable, ou avec l'environnement du worker | Chromium affiche des pages tierces ; une faille d'un moteur de rendu ne doit donner accès ni à la clé de chiffrement des sessions, ni à la base. | `chromiumSandbox: true`, environnement en liste blanche, vérification au démarrage (Cloud désactivé sinon), `CLOUD_CHROMIUM_SANDBOX=false` refusé en production. |
| Faire de la fenêtre de connexion un navigateur général | Le client pilote la fenêtre : elle ne doit mener qu'à Vinted. | Liste fermée des domaines, https obligatoire, redirections revérifiées, réseau local bloqué, fenêtre fermée au moindre écart. |

## 3. Adresse IP partagée : actions légères seulement

- **Légères** (autorisées) : `reply` (répondre), `follow_up` (relancer après 24 h). **Lourdes** (fermées) : `republish` (republier), `bulk_edit` (modifier en masse).
- Les actions lourdes sont refusées à trois endroits tant que `CLOUD_HEAVY_ACTIONS=false` : réglage du compte, planificateur et exécuteur. `bulk_edit` n'a aucune implémentation navigateur. La republication est écrite mais **non vérifiée**.
- **10 comptes Cloud au plus par organisation** (`CLOUD_MAX_ACCOUNTS_PER_ORG`), et jamais plus que les comptes Vinted de l'offre. Le plafond est revérifié à chaque action (pas seulement à l'activation).
- **Coupe-circuit** : après un « trop de requêtes » ou un blocage sur un compte, plus aucune action sur la machine pendant 60 min (§1.5).
- Risque assumé et écrit dans l'accord : un compte sanctionné peut faire bloquer l'adresse de la machine pour tous les autres.
- **À décider par Ibrahim** : ouvrir ou non les actions lourdes ; une adresse fixe par client (§7 du prompt) ; le décompte d'un CAPTCHA dans le quota.
- Radar Auto n'est pas concerné par ce bloc.

## 4. Capacité

- **Cible : 50 navigateurs ouverts en même temps** sur la machine de Marseille (32 Go de mémoire vive). Le prompt compte environ 350 Mo par navigateur, soit environ 17,5 Go pour 50. **C'est une hypothèse, rien n'est mesuré sur la machine.** Valeur prudente en attendant : `CLOUD_MAX_BROWSERS=5`.
- Comme le navigateur ne s'ouvre que pour agir, 50 comptes n'imposent pas 50 navigateurs ouverts en même temps. Le besoin réel est à peu près : *navigateurs simultanés ≈ actions par heure × durée moyenne d'une action (s) / 3 600*. Les deux termes sont à mesurer.

### Mesurer

```bash
# Sur la machine, pages LOCALES seulement (jamais vinted.fr) :
CLOUD_CHROMIUM_PATH=/chemin/vers/chrome CLOUD_BENCH_CONTEXTS=50 pnpm cloud:bench
# CLOUD_BENCH_PARALLEL=5 : ouvertures 5 par 5 ; CLOUD_BENCH_HOLD_MS=3000 : attente avant la mesure
```

Le banc ouvre N navigateurs, chacun sur son profil temporaire comme en production, sur la page de conversation de démonstration. Il imprime un tableau à reporter ci-dessous : mémoire (PSS, partage compté une fois), temps d'ouverture p50 / p95, mémoire disponible. Une vraie page Vinted pèse plus lourd qu'une page locale : prévoir une marge.

| Date | Machine | Chromium | Navigateurs ouverts / demandés | Mémoire Chromium totale | Mémoire par navigateur | Ouverture p50 / p95 | Mémoire disponible après | Remarques |
|---|---|---|---|---|---|---|---|---|
| à mesurer | Marseille | | 5 / 5 | | | | | |
| à mesurer | Marseille | | 10 / 10 | | | | | |
| à mesurer | Marseille | | 25 / 25 | | | | | |
| à mesurer | Marseille | | 50 / 50 | | | | | |

Seul repère existant, **sans valeur pour la production** : dans le conteneur de développement (4 cœurs, 16 Go, Chromium 141, page locale), 5 navigateurs se sont ouverts en environ 1,1 s chacun, pour environ 143 Mo chacun.

À relever aussi en production, chaque semaine : durée moyenne d'une action, actions par heure aux heures chargées, et **taux de pause** (pauses par Vinted / actions).

## 5. Offres

| Offre | Cloud | Détail |
|---|---|---|
| Agence | **Compris** (`cloudIncluded`) | Jusqu'à 10 comptes Cloud, actions par jour = `automationActionsPerDay` de l'offre |
| Pro | **En option, prix à décider** | Mention affichée. Activable seulement si `CLOUD_PRO_OPTION=true`, et alors **rien n'est facturé**. Prix et facturation : décision d'Ibrahim |
| Starter, Accès de base | Indisponible | Après un retour à ces offres, comptes arrêtés et sessions supprimées au passage de maintenance suivant |

Offre réduite : si le Cloud n'est plus disponible, **quelle qu'en soit la raison** (y compris Pro sans l'option ouverte), tous les comptes sont arrêtés et les sessions effacées au passage de maintenance suivant ; s'il reste disponible avec moins de comptes (Agence → Pro avec l'option), les comptes au-delà du plafond n'agissent plus dès le passage suivant, puis sont arrêtés (les plus récents d'abord ; le client réactive ceux qu'il préfère).

Le prompt (§5.2) cite une option à 9,99 € pour Starter et Pro. Le code suit la règle plus récente de ce chantier : Starter sans Cloud, Pro en option sans prix. **À confirmer par Ibrahim.** Rien n'est facturé pour le Cloud aujourd'hui.

## 6. Limites connues

- **Jamais testé contre Vinted.** Les éléments propres au Cloud dans `packages/cloud/src/vinted.ts` ne sont pas vérifiés sur le vrai site : bouton d'envoi, menu du membre, noms des cookies de session (`access_token_web`, `refresh_token_web`), URL de connexion, bouton de republication. Ils sont à valider dans un navigateur réel, puis à déplacer dans un adaptateur `v2` du connecteur (`packages/connectors`, jamais en modifiant `v1`).
- Les motifs de `detectBlock` sont construits sans page réelle de blocage. Aucun taux de blocage n'est mesuré.
- Connexion par Google, Facebook ou Apple non prise en charge (fenêtres surgissantes fermées). La fenêtre de connexion désactive aussi le cache HTTP.
- Adresse d'une conversation : `https://www.vinted.fr/inbox/<référence>` par défaut. Un autre domaine Vinted peut être réglé dans `connection.config.vintedHost`, à vérifier sur de vraies pages.
- Heures actives (8 h – 23 h) et validité de la fenêtre de connexion (5 min) sont alignées partout. Reste : le rythme de `pacing.ts` (45 à 180 s), non utilisé par le planificateur (3 min + 0 à 4 min).
- La liste `VINTED_DOMAINS` est à revoir à chaque ouverture de pays par Vinted (un domaine absent n'est simplement pas utilisable).
- La garde de navigation repère une redirection hors liste **après** que Chromium a envoyé la requête redirigée (elle ferme la fenêtre aussitôt, sans rien afficher) : une règle de pare-feu de la machine reste conseillée (§7).
- Le Chromium du conteneur de développement (141) ne correspond pas exactement à `playwright-core` 1.64. En production, installer la version attendue par `playwright-core`.
- L'image Docker du worker (`deploy/Dockerfile.worker`) n'embarque pas encore Chromium (voir DEPLOYMENT.md).
- **Pas de « Selio Box »** (petit agent chez le client qui agirait avec sa propre connexion) : à concevoir plus tard.
- Avis de l'avocat sur le Cloud en attente : aucune activation client avant.

## 7. Exploitation

### Installer Chromium et des polices sur la machine

Le Cloud ne télécharge jamais de navigateur : il utilise l'exécutable indiqué par `CLOUD_CHROMIUM_PATH`.

```bash
# Chromium de la version attendue par playwright-core (téléchargement gratuit, une fois, par l'opérateur),
# dans un dossier lisible par l'utilisateur « selio » :
cd /opt/selio
sudo PLAYWRIGHT_BROWSERS_PATH=/opt/selio/pw-browsers pnpm --filter @selio/cloud exec playwright-core install --with-deps chromium
# CLOUD_CHROMIUM_PATH = l'exécutable « chrome » sous /opt/selio/pw-browsers/chromium-<révision>/
find /opt/selio/pw-browsers -type f -name chrome -perm -u+x
# Polices (Debian / Ubuntu) : sans elles, texte et émojis s'affichent en carrés dans la fenêtre de connexion
sudo apt-get install -y fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji
"$CLOUD_CHROMIUM_PATH" --version
```

`--with-deps` installe aussi les bibliothèques système de Chromium. Le paquet `chromium` de la distribution fonctionne aussi, mais sa version ne suit pas `playwright-core`.

### Bac à sable de Chromium (obligatoire)

Chromium est toujours lancé avec son bac à sable. Au démarrage, le worker le vérifie (`probeChromium`) et écrit « Cloud désactivé : … bac à sable … » s'il ne peut pas démarrer ainsi. Prérequis :

- le worker ne tourne **pas** en root (`User=selio` dans `selio-worker.service`) : Chromium refuse son bac à sable en root ;
- les espaces de noms utilisateur sont permis : `sysctl kernel.unprivileged_userns_clone` à 1 (Debian) ; sur Ubuntu 23.10 et suivants, un profil AppArmor pour l'exécutable de Chromium (ou `kernel.apparmor_restrict_unprivileged_userns=0`) ; pas de `RestrictNamespaces=` dans le service ;
- en Docker, le profil seccomp par défaut interdit ces espaces de noms : fournir un profil adapté à Chromium (jamais `seccomp=unconfined`, jamais `CLOUD_CHROMIUM_SANDBOX=false`).

Vérification à la main : `sudo -u selio "$CLOUD_CHROMIUM_PATH" --headless --dump-dom about:blank` doit afficher une page vide sans erreur « No usable sandbox ».

Isolation supplémentaire possible (à décider) : lancer Chromium sous un utilisateur système distinct du worker, ce qui demande un petit lanceur privilégié.

### Pare-feu (conseillé)

La fenêtre de connexion bloque déjà la machine et le réseau local et ferme la fenêtre sur une redirection hors liste. En complément, interdire au niveau du système les connexions sortantes de Chromium vers `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` et `100.64.0.0/10` (nftables sur le cgroup du service ou sur un utilisateur dédié à Chromium), en laissant Node joindre PostgreSQL, Redis et Ollama.

### Réglages

Variables `CLOUD_*` : voir [CLES-ET-CONFIGURATION.md §9](CLES-ET-CONFIGURATION.md). L'essentiel :

- `CLOUD_ENABLED=false` par défaut, côté API et côté worker. Le worker n'agit que si `CLOUD_ENABLED=true` **et** si `CLOUD_CHROMIUM_PATH` désigne un exécutable. Au démarrage, il écrit « Cloud activé » ou « Cloud désactivé ».
- `CLOUD_PROFILE_DIR` : dossiers de travail temporaires de Chromium, **réservé à un seul worker** (tout `selio-cloud-*` restant est supprimé au démarrage). Les cookies restent en mémoire ; conseillé en **mémoire vive** (tmpfs) pour que même les fichiers temporaires de Chromium ne touchent jamais le disque :

  ```bash
  # /etc/fstab
  tmpfs  /var/lib/selio-cloud  tmpfs  size=2g,mode=0700,uid=selio,gid=selio,noexec,nodev,nosuid  0  0
  ```

  Taille indicative : quelques dizaines de Mo par navigateur ouvert, à mesurer. Ce dossier n'entre **jamais** dans la sauvegarde.

### systemd

`deploy/systemd/selio-worker.service` a `ProtectSystem=strict` et `PrivateTmp=true`. Avec le dossier par défaut (`/tmp/selio-cloud`), Chromium écrit dans le `/tmp` privé du service. Avec un tmpfs dédié, ajouter au service (`systemctl edit selio-worker`) :

```ini
[Service]
ReadWritePaths=/var/lib/selio-cloud
Environment=CLOUD_PROFILE_DIR=/var/lib/selio-cloud
# Les Chromium sont des processus enfants du worker : ils comptent dans sa mémoire.
# Valeurs à fixer après « pnpm cloud:bench », pour protéger PostgreSQL et Ollama :
# MemoryHigh=…
# MemoryMax=…
```

### Arrêt d'urgence

- Un compte : bouton Pause ou Arrêter (arrêter supprime aussi la session).
- Toute l'organisation : l'arrêt global des automatisations (`automation_state.globalPaused`) bloque aussi le Cloud.
- Toute la machine : `CLOUD_ENABLED=false` puis redémarrage du worker. Les tâches restent en file ; celles de plus de 24 h seront écartées. Le coupe-circuit automatique (§1.5) fait la même chose pendant 60 min après un « trop de requêtes » ou un blocage.

### Vérifications

- Tests : `pnpm --filter @selio/cloud test` (les tests sur vrai Chromium se sautent sans `CLOUD_CHROMIUM_PATH`), puis `CLOUD_CHROMIUM_PATH=… pnpm --filter @selio/cloud test` sur la machine.
- Capacité : `pnpm cloud:bench` (§4).
- Sauvegarde : les sessions chiffrées sont dans PostgreSQL, donc dans la sauvegarde nocturne ; la clé `SECRETS_ENCRYPTION_KEY` n'y est pas. **Après toute restauration**, `select app_cloud_after_restore();` (étape obligatoire) met tous les comptes Cloud en pause « restored », efface les sessions et annule les tâches Cloud : chaque client se reconnecte et reprend lui-même (voir [SAUVEGARDE.md](SAUVEGARDE.md)).

## 8. FAQ client

**Selio connaît-il mon mot de passe Vinted ?** Non. Vous vous connectez vous-même dans une fenêtre sécurisée. Votre mot de passe n'est ni enregistré, ni journalisé, ni transmis à l'IA ou à quiconque.

**Qu'est-ce que Selio garde ?** Seulement la session de ce compte : les cookies et le stockage local de Vinted. Elle est chiffrée sur notre machine, en France, et vous pouvez la supprimer à tout moment en un clic.

**Que fait le Cloud, exactement ?** Pour l'instant, il répond aux messages et relance les acheteurs après 24 h, selon vos règles d'automatisation, aux heures de journée, au rythme d'une personne, dans les plafonds de votre offre. Chaque action est dans votre journal.

**Mon compte peut-il être sanctionné ?** C'est possible. Les conditions de Vinted interdisent les outils automatisés, et nous ne promettons jamais « zéro risque ». Pour limiter ce risque, le Cloud agit rarement, à visage découvert, et s'arrête au premier signal.

**Que se passe-t-il si Vinted affiche un CAPTCHA ou un avertissement ?** Le compte se met en pause, vous recevez un email, et rien n'est retenté. Vérifiez votre compte depuis votre navigateur habituel, puis reprenez le Cloud en le confirmant. C'est vrai aussi pendant la connexion : si Vinted affiche une vérification dans la fenêtre sécurisée, elle se ferme sans rien enregistrer.

**Pourquoi rien ne se passe la nuit ?** Le Cloud n'agit qu'aux heures actives, comme une personne. Un message vieux de plus de 24 h n'est plus traité automatiquement.

**Combien de comptes ?** Jusqu'à 10 par organisation, dans la limite des comptes de votre offre.

**Comment tout arrêter ?** Le bouton « Arrêter » de chaque compte arrête le Cloud et efface la session. La pause garde la session.

**Selio est-il lié à Vinted ?** Non. Selio est un outil indépendant : ni affilié, ni approuvé, ni sponsorisé par Vinted.
