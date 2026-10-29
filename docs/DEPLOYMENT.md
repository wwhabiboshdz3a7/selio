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
- En cas d'erreur, seule la page concernée affiche l'écran d'erreur (le menu reste utilisable), avec un bouton « Copier le rapport » : version de build (commit + date), navigateur, page, pile d'appels. Rien n'est envoyé sur le réseau.

## 2. Serveur métier (Linux)

### Option A — Docker Compose (recommandée)
```bash
git clone <dépôt> /opt/selio && cd /opt/selio/deploy
cp ../apps/api/.env.example .env           # compléter : SECRETS_ENCRYPTION_KEY, POSTGRES_PASSWORD, APP_DB_PASSWORD,
                                           # CORS_ORIGINS, PUBLIC_WEB_URL, OPERATOR_EMAILS, AI_*, REVOLUT_* (bac à sable d'abord), FRANCHISE_TVA
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

### Supervision
- `GET /api/health` : vivacité (public).
- `GET /api/ai/health` avec `x-health-token: $AI_HEALTH_TOKEN` : santé IA + métriques.
- Journaux JSON (pino) sur stdout ; en-têtes sensibles masqués.

## 3. Extension
`pnpm build:extension` → `apps/extension/dist`. Distribution : installation non empaquetée (équipe) ou archive `pnpm --filter @selio/extension zip`. Publication sur le Chrome Web Store non réalisée (compte développeur payant, non créé).

## 4. Sauvegardes
Voir SECURITY.md (pg_dump quotidien, test de restauration mensuel, clé de chiffrement sauvegardée à part).

## 5. Mise à jour
```bash
git pull && pnpm install --frozen-lockfile && pnpm build:api && pnpm build:worker
pnpm db:migrate && sudo systemctl restart selio-api selio-worker
```
Les migrations sont idempotentes et additives ; pas de suppression de colonne sans migration dédiée et sauvegarde préalable. La 0007 (jetons d'invitation et de mot de passe oublié, tables globales hors RLS comme `users` et `sessions`), la 0008 (rattrapage des quotas des abonnements créés avant les offres 1/3/10, vue administrateur alignée sur le quota IA réel ; ne touche pas aux JSON complets, c'est-à-dire aux devis sur mesure) la 0009 (paiement Revolut : colonnes d'abonnement, tables `payment_orders` et `invoices` sous RLS, séquence de numérotation des factures par année ; les abonnements d'un fournisseur disparu repassent à `none` ; la colonne historique de l'ancien adaptateur de test, créée par la 0001, reste en place, vide — aucune colonne n'est supprimée) et la 0010 (durcissement de la facturation : compteur de factures `invoice_counters` transactionnel, amorcé depuis les séquences et les factures existantes sans rupture de numérotation ; index unique sur `invoices.order_id` ; colonne `payment_events.claimed_at` pour la réservation des webhooks) s'appliquent ainsi.
