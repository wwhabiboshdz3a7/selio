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

`netlify.toml` à la racine : commande `pnpm install --frozen-lockfile && pnpm build:web`, publication `apps/web/dist`, redirection SPA, en-têtes de sécurité, cache immuable des assets, `sw.js` sans cache.

Variables Netlify (publiques, préfixe `VITE_`) :
- `VITE_API_BASE_URL` : URL publique de l'API (ex. `https://api.exemple.fr`). Vide → l'application ne propose que la démonstration.
- `VITE_SHOW_INDICATIVE_PRICING` : `true`/`false`.

Côté API, ajouter l'origine Netlify à `CORS_ORIGINS` et `PUBLIC_WEB_URL`.

## 2. Serveur métier (Linux)

### Option A — Docker Compose (recommandée)
```bash
git clone <dépôt> /opt/selio && cd /opt/selio/deploy
cp ../apps/api/.env.example .env           # compléter : SECRETS_ENCRYPTION_KEY, POSTGRES_PASSWORD, APP_DB_PASSWORD,
                                           # CORS_ORIGINS, PUBLIC_WEB_URL, OPERATOR_EMAILS, AI_*, STRIPE_* (test)
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
Les migrations sont idempotentes et additives ; pas de suppression de colonne sans migration dédiée et sauvegarde préalable.
