# Déploiement

Trois cibles distinctes : **vitrine + application** (Netlify, statique), **serveur métier** (API + worker + PostgreSQL + Redis sur une machine Linux), **serveur IA** (Ollama, raccordé plus tard, voir OLLAMA-SETUP.md). GitHub héberge le code ; il n'est jamais un serveur métier.

## Environnements

| Environnement | Web | API | Base | IA |
|---|---|---|---|---|
| Local | `pnpm dev` (démo seule, ou connecté avec `VITE_API_BASE_URL`) | `pnpm dev:api` | `docker compose up -d` | `AI_PROVIDER=mock` |
| Recette | Netlify (branche de prévisualisation) | machine Linux, `NODE_ENV=production`, Postgres managé ou Docker | Postgres + sauvegardes | Ollama via réseau privé |
| Production | Netlify (domaine) | idem, derrière Caddy/Nginx TLS | Postgres managé + PITR | Ollama dédié |

La configuration de production est **distincte** : `NODE_ENV=production` impose `COOKIE_SECURE=true`, `ALLOW_AI_FALLBACK=false`, `AI_PROVIDER≠mock` (le démarrage échoue sinon).

## 1. Vitrine et application (Netlify)

`netlify.toml` à la racine : commande `pnpm install --frozen-lockfile && pnpm build:web`, publication `apps/web/dist`, redirection SPA, en-têtes de sécurité, cache immuable des assets, `sw.js` sans cache. La CSP (`netlify.toml` et `deploy/netlify/_headers`, à garder identiques) autorise le script (`script-src`) et les iframes (`frame-src`) du formulaire de paiement Revolut Checkout depuis `https://merchant.revolut.com` et `https://sandbox-merchant.revolut.com` ; tout le reste reste limité au site. Le service worker ne met jamais ce script en cache (il n'est ni pré-caché ni dans une règle d'exécution).

Variables Netlify (publiques, préfixe `VITE_`) :
- `VITE_API_BASE_URL` : URL publique de l'API (ex. `https://api.exemple.fr`). Vide → l'application ne propose que la démonstration.
- `VITE_SHOW_INDICATIVE_PRICING` : `true`/`false`.
- `VITE_INVOICE_ISSUER_NAME`, `VITE_INVOICE_ISSUER_ADDRESS` (lignes séparées par `|`), `VITE_INVOICE_ISSUER_SIREN`, `VITE_INVOICE_ISSUER_VAT`, `VITE_INVOICE_ISSUER_EMAIL` : mentions de l'émetteur imprimées sur les factures (Paramètres › Factures). Vides → « à compléter » sur la facture et avertissement avant impression. Aucun secret : ces valeurs sont publiques.

Côté API, ajouter l'origine Netlify à `CORS_ORIGINS` et `PUBLIC_WEB_URL`.

### Déploiement manuel (glisser-déposer)

```bash
deploy/netlify/pack.sh                    # build + archive : livraison/selio-demo-netlify.zip
VITE_API_BASE_URL=https://api.exemple.fr deploy/netlify/pack.sh livraison/selio-connecte.zip   # variante mode connecté
```

L'archive contient `apps/web/dist` plus `_headers` (CSP, HSTS, cache) et `_redirects` (SPA) pris dans `deploy/netlify/`, puisque `netlify.toml` n'est pas lu lors d'un glisser-déposer. Décompresser, puis glisser le dossier sur https://app.netlify.com/drop (nouveau site) ou dans l'onglet *Deploys* d'un site existant.

La liste complète des clés et variables (Netlify, serveur, IA, paiement Revolut, emails, stockage) est dans [CLES-ET-CONFIGURATION.md](CLES-ET-CONFIGURATION.md).

### Mises à jour et erreurs côté navigateur

- Le service worker est en mise à jour automatique : après un nouveau déploiement, les navigateurs passent à la nouvelle version au chargement suivant (plus de version périmée gardée en cache). Si un ancien onglet demande un fichier qui n'existe plus, la page se recharge une fois d'elle-même.
- Notifications de Selio Radar (livrées en parallèle, voir BUILD_STATUS.md) : le service worker généré importe `push-handler.js`, servi à la racine du site, hors du cache immuable de `/assets/*`. Rien à régler côté Netlify : aucune clé n'y est saisie, le navigateur reçoit la clé publique VAPID de l'API (`GET /api/push/config`).
- En cas d'erreur, seule la page concernée affiche l'écran d'erreur (le menu reste utilisable), avec un bouton « Copier le rapport » : version de build (commit + date), navigateur, page, pile d'appels. Rien n'est envoyé sur le réseau.

## 2. Serveur métier (Linux)

### Option A — Docker Compose (recommandée)
```bash
git clone <dépôt> /opt/selio && cd /opt/selio/deploy
cp ../apps/api/.env.example .env           # compléter : SECRETS_ENCRYPTION_KEY, POSTGRES_PASSWORD, APP_DB_PASSWORD,
                                           # CORS_ORIGINS, PUBLIC_WEB_URL, OPERATOR_EMAILS, AI_*, REVOLUT_* (bac à sable d'abord), FRANCHISE_TVA,
                                           # VAPID_* (notifications Radar) ; RADAR_AUTO_ENABLED et RADAR_REAL_PURCHASE restent à false
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api
```
Le service `migrate` (`node dist/migrate.js`, migrations copiées dans `/app/migrations`) applique les migrations et définit le mot de passe du rôle `selio_app` (RLS) avant de démarrer l'API et le worker. L'API écoute sur `127.0.0.1:8787` ; Caddy (`deploy/Caddyfile`) publie en HTTPS.

### Option B — systemd
```bash
corepack enable && pnpm install --frozen-lockfile && pnpm build:api && pnpm build:worker
sudo useradd -r -s /usr/sbin/nologin selio && sudo mkdir -p /etc/selio /opt/selio/var
sudo cp deploy/systemd/*.service /etc/systemd/system/
# /etc/selio/api.env et worker.env : variables de .env.example (chmod 600, propriétaire root:selio)
DATABASE_URL=postgres://selio:...@127.0.0.1:5432/selio APP_DB_PASSWORD=... pnpm db:migrate
sudo systemctl enable --now selio-api selio-worker
```

### Clé de chiffrement
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
À stocker dans le gestionnaire de secrets de l'hébergeur ou dans `/etc/selio/*.env` (jamais en Git). Sauvegardée séparément de la base.

### Opérateurs
`OPERATOR_EMAILS=admin@exemple.fr` : les comptes créés avec ces emails obtiennent l'accès `/admin`. Pour un compte existant : `update users set is_operator = true where email = '…'`.

### Photos (MinIO) et emails (SMTP)
- **Photos** : stockage objet compatible S3 sur la machine. En local, `docker compose up -d minio` (racine du dépôt) démarre MinIO (API `:9000`, console `:9001`) et crée le bucket `selio-photos` sans accès anonyme. Côté API : `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (compte dédié au bucket, pas le compte racine). En production, publier MinIO derrière Caddy sur un sous-domaine (ex. `photos.votre-domaine.fr`) avec CORS `PUT`/`GET` pour l'origine du site : les URLs signées sont appelées directement par le navigateur. Le volume `selio_minio` entre dans la sauvegarde chiffrée nocturne. Sans `STORAGE_ENDPOINT`, l'API démarre, avertit, et `/api/uploads` répond 503. Détails : STOCKAGE.md.
- **Emails** (invitations, mot de passe oublié, échec de paiement, alertes) : `EMAIL_PROVIDER=smtp` + `SMTP_URL=smtp://utilisateur:motdepasse@hôte:587` (ou `smtps://…:465`) + `EMAIL_FROM`. Par défaut `noop` : rien n'est envoyé, chaque envoi est journalisé avec l'adresse masquée ; accepté en production mais signalé au démarrage tant que le service d'email n'est pas choisi avec Ibrahim. Prévoir SPF/DKIM sur le domaine de `EMAIL_FROM`.

### Paiement (Revolut Merchant API)
- Même `.env` pour l'API et le worker : `REVOLUT_SECRET_KEY` (clé secrète `sk_…`), `REVOLUT_MODE` (`sandbox` par défaut), `REVOLUT_API_VERSION`, `FRANCHISE_TVA` ; côté API seulement, `REVOLUT_WEBHOOK_SECRET` (`wsk_…`). Sans clé, le paiement est désactivé et signalé au démarrage : les essais ne sont pas débités et finissent en accès de base.
- **Webhook** : à créer une fois par environnement avec `POST /api/1.0/webhooks` chez Revolut (URL `https://<api>/api/billing/webhook/revolut`, événements `ORDER_COMPLETED`, `ORDER_AUTHORISED`, `ORDER_PAYMENT_DECLINED`, `ORDER_PAYMENT_FAILED`, `ORDER_CANCELLED`) ; le `signing_secret` renvoyé va dans `REVOLUT_WEBHOOK_SECRET`. Commande complète dans CLES-ET-CONFIGURATION.md §5. La route lit le corps brut, vérifie la signature (HMAC-SHA256, tolérance 5 min) et traite chaque événement une seule fois ; elle est limitée à 120 appels par minute.
- **Mode live** : `REVOLUT_MODE=live` exige `REVOLUT_LIVE_ALLOWED=true`, sinon l'API et le worker refusent de démarrer. Valider le parcours complet en bac à sable avant.
- **Worker** : la tâche `billing.renew` (`CRON_BILLING_RENEW`, toutes les heures) applique les fins d'essai, débite les renouvellements avec le moyen de paiement enregistré « pour le marchand », relance à J+1 / J+3 / J+7 après un échec, à l'heure de l'échéance (email à chaque fois, via `EMAIL_*`), puis ramène à l'accès de base avec 30 jours de conservation des données (la carte qui échouait est oubliée : le prochain paiement enregistre celle que le client saisit). Elle réannule aussi les autorisations de vérification (1 €) restées posées. Les factures `SEL-AAAA-000001` sont émises par l'API (webhook) ou par le worker (renouvellement) ; la clôture d'une commande est atomique (une seule facture même si les deux la constatent en même temps) et la numérotation est un compteur transactionnel (aucun trou en cas d'annulation).

### Selio Cloud (worker et API)
Détails, règles et capacité : [CLOUD.md](CLOUD.md) ; variables : [CLES-ET-CONFIGURATION.md §9](CLES-ET-CONFIGURATION.md). **Désactivé par défaut** (`CLOUD_ENABLED=false` côté API et worker) et à laisser ainsi tant que l'avocat n'a pas donné son avis. L'état des routes de l'API, des tâches du worker et de l'espace `/cloud` est dans BUILD_STATUS.md.

- **Qui fait quoi.** L'API ne lance jamais de navigateur : elle garde l'accord, les comptes et le journal, met en file la fenêtre de connexion et relaie ses images et les entrées du client entre Redis et un WebSocket (`/api/cloud/login/:id/ws`). Avec `CLOUD_ENABLED=true`, elle exige `REDIS_URL`. Seul le **worker** lance Chromium : un navigateur neuf par action, fermé ensuite, au plus `CLOUD_MAX_BROWSERS` à la fois. Il n'agit que si `CLOUD_ENABLED=true` **et** si `CLOUD_CHROMIUM_PATH` désigne un exécutable. Au démarrage, il écrit « Cloud activé » ou « Cloud désactivé » dans son journal.
- **Chromium pour le worker, option B (systemd)** : installer sur la machine le Chromium attendu par `playwright-core`, ses bibliothèques et des polices (commandes dans CLOUD.md §7), puis `CLOUD_CHROMIUM_PATH=…` dans `/etc/selio/worker.env`. Mettre la même valeur de `CLOUD_MAX_BROWSERS` côté API et worker.
- **Chromium pour le worker, option A (Docker), à faire** : l'image actuelle `deploy/Dockerfile.worker` (`node:22-alpine`) **ne contient pas Chromium**, et le Chromium de Playwright ne tourne pas sur Alpine. Il faudra une image Debian (`node:22-bookworm-slim`) avec `playwright-core install --with-deps chromium` au moment de la construction, des polices (`fonts-liberation`, `fonts-noto-core`, `fonts-noto-color-emoji`) et `CLOUD_CHROMIUM_PATH` fixé. Côté `docker-compose.prod.yml`, ajouter au service `worker` un dossier de profils en mémoire vive et une limite de mémoire fixée après mesure :

  ```yaml
  worker:
    environment:
      CLOUD_PROFILE_DIR: /var/lib/selio-cloud
    tmpfs:
      - /var/lib/selio-cloud:size=2g,mode=0700,uid=1000,gid=1000
    # mem_limit: …   (après « pnpm cloud:bench » sur la machine)
    # Bac à sable de Chromium (espaces de noms utilisateur) : le profil seccomp par défaut de Docker
    # les interdit. Fournir un profil adapté (ex. celui publié pour Chrome) ; jamais « seccomp=unconfined »
    # ni CLOUD_CHROMIUM_SANDBOX=false. Sans bac à sable, le worker désactive le Cloud au démarrage.
    # security_opt: ["seccomp=./seccomp-chromium.json"]
  ```

  Le `Dockerfile.worker` n'a pas encore été modifié. `docker-compose.prod.yml` a déjà `stop_grace_period: 150s` et `init: true` pour le worker (arrêt qui attend l'action en cours, récupération des processus de Chromium).
- **Bac à sable de Chromium (obligatoire)** : Chromium est lancé avec son bac à sable (jamais `--no-sandbox`) et un environnement minimal (aucune variable du worker : ni `SECRETS_ENCRYPTION_KEY`, ni `DATABASE_URL`, ni clés de paiement). Au démarrage, le worker vérifie que Chromium se lance ainsi ; sinon il écrit « Cloud désactivé : … bac à sable … » et n'agit pas. Prérequis sur l'hôte (option B) : le worker ne tourne **pas** en root (`User=selio`), les espaces de noms utilisateur sont permis (`sysctl kernel.unprivileged_userns_clone=1` sur Debian ; sur Ubuntu 23.10 et suivants, profil AppArmor pour l'exécutable de Chromium ou `kernel.apparmor_restrict_unprivileged_userns=0`), et le service n'a pas `RestrictNamespaces=`. `NoNewPrivileges=true` reste compatible (bac à sable par espaces de noms, sans binaire setuid).
- **Arrêt du worker** : `selio-worker.service` a `KillMode=mixed` et `TimeoutStopSec=150` : seul Node reçoit SIGTERM, n'ouvre plus de navigateur et attend l'action en cours (`CLOUD_ACTION_TIMEOUT_MS` + 15 s) ; un signal de Vinted lu pendant cette action est toujours enregistré.
- **Dossier de travail en tmpfs (conseillé)** : chaque action utilise un dossier temporaire (0700) supprimé à la fin, qui sert de HOME et TMPDIR à Chromium. Les cookies et le stockage local restent en mémoire (contexte de navigation sans enregistrement) ; en mémoire vive, même les fichiers temporaires de Chromium (mémoire partagée, caches) ne touchent jamais le disque. Sur l'hôte : une ligne `tmpfs /var/lib/selio-cloud tmpfs size=2g,mode=0700,uid=selio,gid=selio,noexec,nodev,nosuid 0 0` dans `/etc/fstab`, puis `CLOUD_PROFILE_DIR=/var/lib/selio-cloud`. Avec `selio-worker.service` (`ProtectSystem=strict`), ajouter `ReadWritePaths=/var/lib/selio-cloud` (`systemctl edit selio-worker`). Sans réglage, les profils vont dans `/tmp/selio-cloud`, le `/tmp` privé du service (`PrivateTmp=true`). Le dossier est réservé à un seul worker : au démarrage, tout `selio-cloud-*` restant est supprimé quel que soit son âge, puis chaque passage du Cloud supprime les dossiers plus vieux que la plus longue action ou fenêtre (plus 3 min).
- **Mémoire** : les Chromium sont des processus enfants du worker et comptent dans sa mémoire (cgroup systemd ou conteneur). Fixer `MemoryHigh` / `MemoryMax` (systemd) ou `mem_limit` (Docker) seulement après mesure, pour protéger PostgreSQL et Ollama. La cible de 50 navigateurs simultanés est une hypothèse (CLOUD.md §4).
- **WebSocket** : Caddy (`reverse_proxy`) relaie les WebSocket sans réglage particulier. La politique de sécurité du site (`netlify.toml`, `deploy/netlify/_headers`) doit autoriser `wss:` dans `connect-src`. Le tunnel chiffré doit laisser passer les connexions longues.
- **Pare-feu (conseillé)** : la fenêtre de connexion refuse déjà la machine elle-même et les adresses privées, et ferme la fenêtre si une redirection sort de Vinted. En complément, interdire au niveau du système les connexions sortantes de Chromium vers `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` et `100.64.0.0/10` (règle nftables sur le cgroup du service, ou utilisateur système dédié à Chromium), PostgreSQL, Redis et Ollama restant joignables par Node.
- **Arrêt d'urgence** : `CLOUD_ENABLED=false` puis redémarrage du worker. Les tâches Cloud restent en file ; celles de plus de 24 h seront écartées. Coupe-circuit levé à la main (après vérification) : `update cloud_runtime set suspended_until = null, reason = null;`.

### Selio Radar (worker, API, notifications)
Fonctionnement, règles et procédure de test : [RADAR.md](RADAR.md) ; variables : [CLES-ET-CONFIGURATION.md §11](CLES-ET-CONFIGURATION.md). Le branchement dans l'API et le worker est livré en parallèle de ce document : son état fait foi dans BUILD_STATUS.md. **Radar Auto et l'achat réel restent fermés** (`RADAR_AUTO_ENABLED=false`, `RADAR_REAL_PURCHASE=false`, D11), et Radar Auto n'est pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché.

- **Lecture en direct = Selio Cloud.** Radar lit depuis le compte Achat du client avec la session du Cloud, dans le même Chromium que les actions du Cloud : sans `CLOUD_ENABLED=true` et `CLOUD_CHROMIUM_PATH` (section « Selio Cloud » ci-dessus, avec le bac à sable), seules les recherches du simulateur sont lues. Les prérequis de Chromium, du dossier de travail en tmpfs (`CLOUD_PROFILE_DIR`, aussi utilisé par Radar) et du pare-feu sont les mêmes.
- **Créneaux partagés.** Lectures de page et achats de Radar prennent les créneaux de `CLOUD_MAX_BROWSERS`, comme les actions et les fenêtres de connexion du Cloud. Un achat qui attend une validation 3-D Secure garde son créneau jusqu'à `CLOUD_3DS_TIMEOUT_MS` (10 min). Régler `CLOUD_MAX_BROWSERS` après `pnpm cloud:bench`, en comptant ces lectures (au plus `RADAR_MAX_PAGES_PER_MINUTE_GLOBAL`, 30 pages par minute sur la machine).
- **Passages du worker** : `radar.tick` toutes les 30 s (`RADAR_TICK_EVERY_MS`), `alerts.send` chaque minute (`CRON_ALERTS`), `radar.auto` toutes les 30 s seulement si `RADAR_AUTO_ENABLED=true` (sinon le planning est retiré au démarrage), et la file `selio-radar` pour la reprise après une validation 3-D Secure (le navigateur tenu ouvert vit dans le worker : l'API y met la reprise en file, ce qui exige `REDIS_URL`).
- **Clés VAPID** : à générer une fois (`npx web-push generate-vapid-keys`, ou `pnpm --filter @selio/worker exec web-push generate-vapid-keys`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` **identiques** dans l'environnement de l'API et du worker (`deploy/.env`, ou `/etc/selio/api.env` et `worker.env` en 600). Jamais commitées. Sans elles, les alertes restent en file (signalé au démarrage). Le worker contacte seulement les services de notification des navigateurs (Google, Mozilla, Microsoft, Apple) en HTTPS sortant : aucun port à ouvrir.
- **Verrous** : `RADAR_AUTO_ENABLED`, `RADAR_AUTO_ORG_IDS`, `RADAR_REAL_PURCHASE` et `CLOUD_3DS_TIMEOUT_MS` ont la **même valeur** côté API et worker. En production, `RADAR_AUTO_ENABLED=true` sans `RADAR_AUTO_ORG_IDS` (organisations de l'équipe) arrête le démarrage ; un journal de démarrage en `warn` signale Radar Auto ouvert.
- **Arrêt du worker** : plus aucune lecture ni aucun achat ne démarre ; ceux en cours se terminent (au plus `RADAR_PURCHASE_TIMEOUT_MS` + 15 s, sous les 150 s de `TimeoutStopSec` / `stop_grace_period`) ; les navigateurs qui attendent une validation 3-D Secure sont fermés (les demandes expirent avec une alerte, rien n'est racheté).
- **Arrêt d'urgence** : `RADAR_AUTO_ENABLED=false` (API et worker) puis redémarrage arrête Radar Auto ; `CLOUD_ENABLED=false` arrête toute lecture en direct. Un « trop de requêtes » ou un blocage pendant une lecture Radar déclenche **le même coupe-circuit** que le Cloud (60 min, toute la machine), avec la ligne « COUPE-CIRCUIT » en erreur dans le journal du worker.

### Supervision
- `GET /api/health` : vivacité (public).
- `GET /api/ai/health` avec `x-health-token: $AI_HEALTH_TOKEN` : santé IA + métriques.
- Journaux JSON (pino) sur stdout ; en-têtes sensibles masqués.
- Selio Radar : vue opérateur `GET /api/admin/radar` (lectures en direct, blocages pour 1 000 pages, facteur de ralentissement par organisation, coupe-circuit en cours ; aucune donnée d'annonce ni de vendeur). Alerte à brancher sur les lignes « COUPE-CIRCUIT » et « radar : signal de Vinted » du journal du worker.

## 3. Extension
`pnpm build:extension` → `apps/extension/dist`. Distribution : installation non empaquetée (équipe) ou archive `pnpm --filter @selio/extension zip`. Publication sur le Chrome Web Store non réalisée (compte développeur payant, non créé).

## 4. Sauvegardes
Voir [SAUVEGARDE.md](SAUVEGARDE.md) et `scripts/sauvegarde/`. Chaque nuit à 03:30 : `pg_dump --format=custom` et photos MinIO, chiffrés avec age (clé publique seulement sur la machine), sommes SHA-256, copie hors machine avec rclone, rotation 30 jours. Le 1er du mois : test de restauration dans une base temporaire, comparé au manifeste, de préférence sur le portable de secours. Les `.env` et `SECRETS_ENCRYPTION_KEY` sont sauvegardés à part, à la main. La procédure de bascule sur le portable est au §7 de SAUVEGARDE.md. Avec Docker Compose, la sauvegarde passe par le conteneur PostgreSQL (`BACKUP_PG_DOCKER_CONTAINER`) : aucun port à publier.

## 5. Mise à jour
```bash
git pull && pnpm install --frozen-lockfile && pnpm build:api && pnpm build:worker
pnpm db:migrate && sudo systemctl restart selio-api selio-worker
```
Les migrations sont idempotentes et additives ; pas de suppression de colonne sans migration dédiée et sauvegarde préalable. La 0007 (jetons d'invitation et de mot de passe oublié, tables globales hors RLS comme `users` et `sessions`), la 0008 (rattrapage des quotas des abonnements créés avant les offres 1/3/10, vue administrateur alignée sur le quota IA réel ; ne touche pas aux JSON complets, c'est-à-dire aux devis sur mesure) la 0009 (paiement Revolut : colonnes d'abonnement, tables `payment_orders` et `invoices` sous RLS, séquence de numérotation des factures par année ; les abonnements d'un fournisseur disparu repassent à `none` ; la colonne historique de l'ancien adaptateur de test, créée par la 0001, reste en place, vide — aucune colonne n'est supprimée) et la 0010 (durcissement de la facturation : compteur de factures `invoice_counters` transactionnel, amorcé depuis les séquences et les factures existantes sans rupture de numérotation ; index unique sur `invoices.order_id` ; colonne `payment_events.claimed_at` pour la réservation des webhooks) s'appliquent ainsi. La 0011 (Selio Cloud : tables `cloud_consents`, `cloud_accounts` avec la session chiffrée, `cloud_actions`, `cloud_login_sessions` sous RLS forcée, table `cloud_runtime` du coupe-circuit (une ligne, sans donnée d'organisation), deux fonctions `SECURITY DEFINER` limitées, fonction `app_cloud_after_restore()` à lancer après une restauration (voir SAUVEGARDE.md §7), index des tâches `runs_in = 'cloud'`) aussi ; elle n'active rien : le Cloud reste fermé tant que `CLOUD_ENABLED=false`. La 0012 (Selio Radar : colonnes des recherches — source, priorité, compte Achat, facteur de ralentissement, compteurs — et des demandes d'achat — total, référence de commande, article reporté dans Manager, délai 3-D Secure ; tables `radar_reads`, `push_subscriptions`, `radar_alerts`, `embeddings_cache` sous RLS forcée ; index unique des affaires par référence Vinted ; une seule demande d'achat active par affaire, index créé seulement si l'existant n'a pas de doublon, avertissement sinon ; fonctions `SECURITY DEFINER` `app_radar_org_ids()` et `app_push_endpoint_release()`) est additive et idempotente ; elle n'ouvre ni Radar Auto ni l'achat réel.
