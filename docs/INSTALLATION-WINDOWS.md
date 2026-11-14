# Selio en production sur le PC Windows — procédure complète

Pour Claude Code lancé sur le PC (et pour Ibrahim). À suivre dans l'ordre. Ne rien inventer : si une étape échoue, s'arrêter et dire pourquoi.

**Ce qu'on met en place**

| Partie | Où elle tourne | Adresse |
|---|---|---|
| Vitrine + application web | Netlify | `https://seliovprod.netlify.app` |
| Les trois modèles d'IA (Ollama) | Windows, directement sur la carte NVIDIA | `http://127.0.0.1:11434` (jamais ouvert sur Internet) |
| Base de données, Redis, API, worker | Docker Desktop dans WSL 2 (Ubuntu) | `http://127.0.0.1:8787` sur le PC |
| Pont entre Netlify et l'API | Cloudflare Tunnel (gratuit) | adresse `https://….trycloudflare.com` |

Netlify relaie `https://seliovprod.netlify.app/api/*` vers le tunnel : le site et l'API ont ainsi la même adresse, et les cookies de connexion marchent.

**Règle des secrets** : aucune clé ne passe par le chat. Les clés internes sont générées sur le PC. Les clés externes (Revolut, email) seront collées par Ibrahim lui-même dans `.env`, plus tard.

---

## 1. Préparer Windows (Ibrahim, une fois)

1. Pilote NVIDIA à jour (GeForce Experience ou nvidia.com).
2. PowerShell **en administrateur** :
   ```powershell
   wsl --install -d Ubuntu-24.04
   ```
   Redémarrer, ouvrir « Ubuntu », créer l'utilisateur.
3. Installer **Docker Desktop** (docker.com) : cocher « Use WSL 2 », puis Réglages › Resources › WSL integration › activer Ubuntu-24.04.
4. Installer **Ollama pour Windows** (ollama.com/download).
5. Dans Ubuntu, installer Claude Code puis le lancer dans le dossier du projet (étape 2).

## 2. Récupérer le projet (dans Ubuntu / WSL)

```bash
sudo apt update && sudo apt install -y git curl ca-certificates openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo corepack enable
mkdir -p ~/selio && cd ~/selio
git clone <adresse du dépôt GitHub> .
git checkout <branche la plus à jour, celle que Netlify construit>
pnpm install --frozen-lockfile
docker version            # doit répondre (Docker Desktop lancé)
```

Garder le projet **dans Ubuntu** (`~/selio`), pas dans `C:\` : c'est beaucoup plus rapide.

## 3. Les trois modèles d'IA (sur Windows)

Réglages d'Ollama pour une carte de 16 Go, à poser **avant** de télécharger. PowerShell (utilisateur normal) :

```powershell
setx OLLAMA_MAX_LOADED_MODELS 3
setx OLLAMA_NUM_PARALLEL 2
setx OLLAMA_KEEP_ALIVE 30m
setx OLLAMA_FLASH_ATTENTION 1
setx OLLAMA_KV_CACHE_TYPE q8_0
```

Quitter Ollama (icône près de l'horloge › Quit), le relancer, puis :

```powershell
ollama pull ministral-3:8b           # texte : réponses aux acheteurs, annonces, aide
ollama pull qwen3-vl:8b              # photos : Studio, étiquettes, mètre ruban
ollama pull qwen3-embedding:0.6b     # prix : ventes comparables
ollama list
nvidia-smi
```

Les trois tiennent ensemble dans 16 Go (environ 6 + 6 + 1 Go, versions compressées par défaut). Si un nom n'existe pas (`pull` refusé), vérifier sur ollama.com/library et le signaler avant d'en prendre un autre.

Vérifier depuis Ubuntu que Docker joint Ollama :

```bash
docker run --rm curlimages/curl -s http://host.docker.internal:11434/api/tags | head -c 300
```

Si ça échoue : `setx OLLAMA_HOST 0.0.0.0:11434`, relancer Ollama, et dans la fenêtre du pare-feu Windows **n'autoriser que les réseaux privés**. Ollama ne doit jamais être joignable depuis Internet.

## 4. Configuration du serveur (`deploy/.env`, dans Ubuntu)

```bash
cd ~/selio/deploy
cp ../apps/api/.env.example .env && chmod 600 .env
echo "SECRETS_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "APP_DB_PASSWORD=$(openssl rand -hex 24)"
```

Copier ces trois lignes dans `.env` (ne pas les afficher ailleurs), puis régler :

```
NODE_ENV=production
PUBLIC_WEB_URL=https://seliovprod.netlify.app
CORS_ORIGINS=https://seliovprod.netlify.app
COOKIE_SECURE=true
TRUST_PROXY=true
OPERATOR_EMAILS=<email d'Ibrahim>

AI_PROVIDER=ollama
ALLOW_AI_FALLBACK=false
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=ministral-3:8b
OLLAMA_VISION_MODEL=qwen3-vl:8b
OLLAMA_EMBED_MODEL=qwen3-embedding:0.6b

# Laissés fermés
RADAR_AUTO_ENABLED=false
RADAR_REAL_PURCHASE=false
CLOUD_ENABLED=false
TRACK_LIVE_ENABLED=false
REFERRAL_ENABLED=false

# Pas encore de compte Revolut ni de service d'email : laisser vides
REVOLUT_SECRET_KEY=
REVOLUT_WEBHOOK_SECRET=
EMAIL_PROVIDER=noop
```

Sans Revolut, l'application affiche « Le paiement n'est pas configuré » et l'essai de 14 jours fonctionne. Sans email, rien ne part (invitations et mot de passe oublié inactifs) : c'est signalé au démarrage, ce n'est pas une erreur.

## 5. Démarrer le serveur

```bash
cd ~/selio/deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs --tail=50 migrate api worker
curl -s http://127.0.0.1:8787/api/health
```

Les migrations (0001 à 0018) s'appliquent toutes seules. Puis vérifier l'IA depuis le projet :

```bash
cd ~/selio
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=ministral-3:8b pnpm ai:diagnose
```

## 6. Ouvrir l'API à Netlify (tunnel)

```bash
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel --url http://127.0.0.1:8787
```

Noter l'adresse affichée (`https://xxxx.trycloudflare.com`). Elle change à chaque relance du tunnel : il faudra alors refaire l'étape 7. Plus tard, avec un vrai nom de domaine, on passera à un tunnel nommé qui garde la même adresse.

## 7. Brancher Netlify sur le serveur

1. Dans `netlify.toml`, **au-dessus** de la règle `from = "/*"`, ajouter :
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "https://xxxx.trycloudflare.com/api/:splat"
     status = 200
     force = true
   ```
   Committer et pousser sur la branche que Netlify construit.
2. Sur Netlify › Site configuration › Environment variables :
   `VITE_API_BASE_URL = https://seliovprod.netlify.app`
   puis Deploys › Trigger deploy › Clear cache and deploy site.
3. Ouvrir `https://seliovprod.netlify.app/api/health` : doit répondre `{"ok":true,…}`.
4. Créer le premier compte sur `https://seliovprod.netlify.app/inscription` avec l'email mis dans `OPERATOR_EMAILS` : il aura l'accès `/admin`.

## 8. Où vont les variables

| Variable | Où | Quand |
|---|---|---|
| Clés internes, IA, adresses, interrupteurs | `deploy/.env` sur le PC | maintenant |
| `VITE_API_BASE_URL` | Netlify (Environment variables) | maintenant |
| Adresse du tunnel | `netlify.toml` (règle `/api/*`) | à chaque nouvelle adresse |
| Revolut (`REVOLUT_*`), email (`EMAIL_PROVIDER`, `SMTP_URL`, `EMAIL_FROM`) | `deploy/.env` sur le PC, collées par Ibrahim | quand les comptes existent |
| Mentions des factures (`VITE_INVOICE_ISSUER_*`) | Netlify | avant la première vraie facture |

Après une modification de `deploy/.env` : `docker compose -f docker-compose.prod.yml up -d` (redémarre l'API et le worker). Après une modification sur Netlify : redéployer le site.

## 9. Chiffres à relever et renvoyer

```bash
cd ~/selio
AI_PROVIDER=ollama OLLAMA_MODEL=ministral-3:8b BENCH_MODE=reply pnpm ai:bench
AI_PROVIDER=ollama BENCH_MODE=photo BENCH_PHOTO=/chemin/photo.jpg pnpm ai:bench
AI_PROVIDER=ollama BENCH_MODE=embed pnpm ai:bench
```

Plus `nvidia-smi` avec les trois modèles chargés. Reporter les chiffres dans `docs/OLLAMA-SETUP.md`.

## 10. À savoir

- Le PC doit rester allumé, Docker Desktop, Ollama et le tunnel lancés. Désactiver la mise en veille.
- Selio Cloud reste fermé (Chromium absent de l'image du worker, avis de l'avocat attendu).
- Sauvegarde : `scripts/sauvegarde/` dès que de vraies données arrivent (voir `docs/SAUVEGARDE.md`).

---

Réalisé par Ibrahim
