# Installer Selio sur la machine — procédure du week-end

Pour Ibrahim, et pour Claude Code lancé sur la machine. Une étape à la fois ; on note les chiffres relevés à la fin.
Les détails sont dans [DEPLOYMENT.md](DEPLOYMENT.md), [OLLAMA-SETUP.md](OLLAMA-SETUP.md) et [CLES-ET-CONFIGURATION.md](CLES-ET-CONFIGURATION.md).

## 0. Ce qu'il faut avant de commencer

- La machine (32 Go de mémoire, carte graphique 16 Go) sous **Linux** (Ubuntu 24.04 conseillé), branchée en filaire.
- Un accès au dépôt GitHub.
- **Claude Code sur la machine**, au choix :
  - l'application Claude pour ordinateur, puis Réglages › Claude Code › Remote Control, et ajouter le dossier du dépôt : une session cloud peut alors travailler dans ce dossier ;
  - ou la commande `claude` dans un terminal, ouverte dans le dossier du dépôt.
- Les secrets ne passent **jamais** par le chat. Les clés internes sont générées sur la machine ; les clés externes (Revolut, email, notifications) sont collées par toi directement dans le fichier `.env`.

## 1. Système

```bash
sudo apt update && sudo apt install -y git curl ca-certificates docker.io docker-compose-v2
sudo usermod -aG docker "$USER"            # se reconnecter ensuite
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo corepack enable
nvidia-smi                                  # la carte graphique doit apparaître (pilote NVIDIA installé)
```

## 2. Le dépôt

```bash
sudo mkdir -p /opt/selio && sudo chown "$USER" /opt/selio
git clone <adresse du dépôt> /opt/selio && cd /opt/selio
pnpm install --frozen-lockfile
```

## 3. Les trois modèles d'IA

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull <modèle de texte choisi>       # mon IA perso
ollama pull qwen3-vl:8b                    # modèle 1 : les photos
ollama pull qwen3-embedding:0.6b           # modèle 2 : les prix
```

Réglages d'Ollama (fichier de service, voir OLLAMA-SETUP.md) : `OLLAMA_MAX_LOADED_MODELS=3`, `OLLAMA_KEEP_ALIVE=30m`, `OLLAMA_NUM_PARALLEL=2`. Ollama écoute **seulement en local** : jamais ouvert sur Internet.

Vérifier puis mesurer :

```bash
AI_PROVIDER=ollama OLLAMA_MODEL=<modèle de texte> pnpm ai:diagnose
AI_PROVIDER=ollama OLLAMA_MODEL=<modèle de texte> BENCH_MODE=reply pnpm ai:bench
AI_PROVIDER=ollama BENCH_MODE=photo BENCH_PHOTO=/chemin/photo.jpg pnpm ai:bench
AI_PROVIDER=ollama BENCH_MODE=embed pnpm ai:bench
```

## 4. Base de données, Redis, photos, API et worker

```bash
cd /opt/selio/deploy
cp ../apps/api/.env.example .env
chmod 600 .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → SECRETS_ENCRYPTION_KEY
openssl rand -base64 24                                                        # → POSTGRES_PASSWORD, APP_DB_PASSWORD
```

Dans `.env`, remplir au minimum : `SECRETS_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `PUBLIC_WEB_URL`, `CORS_ORIGINS` (l'adresse Netlify), `OPERATOR_EMAILS`, `AI_PROVIDER=ollama`, `OLLAMA_*`.
Laisser fermés : `RADAR_AUTO_ENABLED=false`, `RADAR_REAL_PURCHASE=false`, `CLOUD_ENABLED=false`, `TRACK_LIVE_ENABLED=false`, `REFERRAL_ENABLED=false`.
Revolut en **bac à sable** d'abord (`REVOLUT_MODE=sandbox`), quand le compte marchand existe.

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api      # attendre « listening »
curl -s http://127.0.0.1:8787/api/health
```

Le service `migrate` applique les migrations 0001 à 0018 tout seul. Les photos (MinIO) : voir DEPLOYMENT.md, partie « Photos ».

## 5. Adresse publique et vitrine

- Exposer l'API en HTTPS (Caddy, fichier `deploy/Caddyfile`) sur un sous-domaine, par exemple `api.<domaine>`.
- Sur Netlify, mettre `VITE_API_BASE_URL=https://api.<domaine>` puis redéployer : la vitrine passe en mode réel.
- Sans domaine pour l'instant : on reste en mode démonstration sur Netlify, et on teste le mode réel sur la machine elle-même (`pnpm dev` en local).

## 6. Les chiffres à relever

| Mesure | Commande | Résultat |
|---|---|---|
| Réponses de mon IA perso par minute | `pnpm ai:bench` (reply) | |
| Secondes par photo (modèle 1) | `pnpm ai:bench` (photo) | |
| Textes par seconde (modèle 2) | `pnpm ai:bench` (embed) | |
| Mémoire de la carte graphique, 3 modèles chargés | `nvidia-smi` | |
| Mémoire et temps par navigateur Cloud | `CLOUD_CHROMIUM_PATH=… pnpm cloud:bench` | |

Reporter ces chiffres dans OLLAMA-SETUP.md et CLOUD.md, puis régler les quotas et `CLOUD_MAX_BROWSERS`.

## 7. Ce qui attend encore

- Selio Cloud reste fermé : l'image Docker du worker n'a pas encore Chromium, et l'avis de l'avocat manque.
- Email réel (`EMAIL_PROVIDER=smtp`) et clés des notifications (`VAPID_*`) : quand le service d'email est choisi.
- Sauvegarde nocturne : `scripts/sauvegarde/` (voir SAUVEGARDE.md), à brancher dès que de vraies données arrivent.
