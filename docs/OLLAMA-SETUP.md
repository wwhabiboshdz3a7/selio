# Ollama — les trois modèles d'IA sur la machine

Tout le service tourne sur notre machine, chez Ibrahim à Marseille : **32 Go de mémoire vive, carte graphique de 16 Go**. L'intégration est écrite et testée sur HTTP simulé ; les repères de capacité ci-dessous sont **à confirmer sur place** avec `pnpm ai:diagnose` puis `pnpm ai:bench`, et à reporter dans le tableau « Mesures » en bas de ce document.

## Les trois modèles

Trois rôles, tous servis par Ollama sur la même machine. Dans l'interface et les documents, le modèle de texte s'appelle **« mon IA perso »** (jamais « Ollama » ni le nom du modèle).

| Rôle | Variable | Valeur par défaut | Sert à | Mémoire GPU (Q4, estimation) |
|---|---|---|---|---|
| **Mon IA perso**, la voix | `OLLAMA_MODEL` | `qwen2.5:7b-instruct` (valeur de démarrage) | Réponses aux acheteurs, rédaction des annonces, aide, explication des prix en mots | ≈ 5 Go pour un 7–8 B |
| **Modèle 1**, les photos | `OLLAMA_VISION_MODEL` | `qwen3-vl:8b` | Studio (annonce à partir des photos), lecture des étiquettes, contrôle des photos | ≈ 6 Go |
| **Modèle 2**, les prix | `OLLAMA_EMBED_MODEL` | `qwen3-embedding:0.6b` | Vecteurs (embeddings) pour retrouver les ventes comparables et estimer un prix | ≈ 1 Go |

- **Le nom du modèle de texte est donné à part par Ibrahim** : la valeur par défaut ne sert qu'au démarrage. On le renseigne dans `OLLAMA_MODEL` côté API et worker, rien d'autre ne change.
- Les trois tiennent ensemble dans les 16 Go de la carte (≈ 12–13 Go avec le cache de contexte à `AI_CONTEXT_LIMIT=8192` et `OLLAMA_NUM_PARALLEL=2`). Si le modèle de texte choisi dépasse ≈ 8 B, Ollama déborde sur la mémoire vive et tout ralentit : à vérifier avec `ollama ps` (colonne « PROCESSOR », viser 100 % GPU).
- Un modèle secondaire peut être désactivé en laissant sa variable **explicitement vide** (`OLLAMA_VISION_MODEL=`) : Studio rédige alors sans lire les photos et l'écran le signale ; `OLLAMA_EMBED_MODEL=` désactive les embeddings (erreur « config » explicite, jamais un vecteur simulé).

## Routage

Le code choisit le modèle, jamais l'utilisateur :

| Demande | Modèle | Chemin dans le code |
|---|---|---|
| Requête **avec images** (`images` non vide) | modèle 1 (`visionModel`) | `OllamaProvider.target()` → `POST /api/generate` |
| `AIService.embed(orgId, textes)` | modèle 2 (`embedModel`) | `OllamaProvider.embed()` → `POST /api/embed` `{ model, input }` |
| Tout le reste (réponses, annonces sans photo, aide, flux) | mon IA perso (`model`) | `POST /api/generate` |

Les embeddings passent par la même file et le même disjoncteur que les générations ; leur latence est mesurée à part sous le rôle `embed` (`metrics.byKind.embed`, p50/p95), car elle n'a rien à voir avec celle d'une réponse rédigée. **Quotas :** `createAIService` ne reçoit aucun `QuotaGuard` (API et worker) ; le quota IA de l'offre est appliqué par l'appelant côté `core` en comptant les lignes `ai_requests` du mois (`messaging.suggestReply`, `studio.generateListing`). Un futur consommateur de `AIService.embed` (estimation des prix, 5.10) devra faire de même : rien ne le décompte aujourd'hui.

## Architecture

```
navigateur ──HTTPS──▶ API Selio ──réseau privé (tunnel WireGuard/Tailscale)──▶ Ollama (machine de Marseille, port 11434 non exposé)
```
- Le navigateur n'appelle **jamais** Ollama ; seules l'API et le worker le font (`OllamaProvider`, côté serveur).
- `OLLAMA_BASE_URL` pointe vers une adresse privée. Si une passerelle est nécessaire, placer Caddy devant Ollama avec un en-tête `Authorization`, transmis par `OLLAMA_AUTH_HEADER`.
- Aucun port ouvert sur Internet : voir `docs/DEPLOYMENT.md`.

## Installation sur la machine

1. Installer Ollama (Linux) : `curl -fsSL https://ollama.com/install.sh | sh` ; vérifier `ollama --version`.
2. Télécharger les trois modèles :
   ```bash
   ollama pull <modèle de texte donné par Ibrahim>   # mon IA perso (OLLAMA_MODEL)
   ollama pull qwen3-vl:8b                           # modèle 1, les photos
   ollama pull qwen3-embedding:0.6b                  # modèle 2, les prix
   ```
3. Régler le service pour **garder les trois chargés** et n'écouter que sur l'interface privée (`/etc/systemd/system/ollama.service.d/override.conf`) :
   ```ini
   [Service]
   Environment="OLLAMA_HOST=10.0.0.5:11434"
   Environment="OLLAMA_MAX_LOADED_MODELS=3"
   Environment="OLLAMA_KEEP_ALIVE=30m"
   Environment="OLLAMA_NUM_PARALLEL=2"
   ```
   puis `systemctl daemon-reload && systemctl restart ollama`.
   - `OLLAMA_MAX_LOADED_MODELS=3` : sans lui, Ollama décharge un modèle pour en charger un autre et chaque bascule coûte plusieurs secondes.
   - `OLLAMA_KEEP_ALIVE=30m` : un modèle inutilisé reste en mémoire 30 minutes (au lieu de 5), pour ne pas recharger le modèle de vision entre deux annonces Studio.
   - `OLLAMA_NUM_PARALLEL=2` : deux requêtes à la fois par modèle, aligné sur `AI_MAX_CONCURRENCY=2`. À augmenter seulement si la mesure le justifie (chaque requête parallèle réserve son cache de contexte).
4. Relever le modèle exact de la carte : `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv` et le noter dans le tableau « Mesures ».
5. Pare-feu : n'autoriser `11434` que depuis l'adresse privée du serveur métier (même machine ou tunnel).

## Configuration côté Selio (API et worker)

```
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://10.0.0.5:11434
OLLAMA_MODEL=<nom donné par Ibrahim>   # mon IA perso (texte)
OLLAMA_VISION_MODEL=qwen3-vl:8b        # modèle 1 : les photos
OLLAMA_EMBED_MODEL=qwen3-embedding:0.6b # modèle 2 : les prix
OLLAMA_AUTH_HEADER=                    # facultatif : « Bearer … » si une passerelle protège Ollama
AI_TIMEOUT_MS=45000                    # délai maximal par génération
AI_MAX_CONCURRENCY=2                   # aligné sur OLLAMA_NUM_PARALLEL, à régler après pnpm ai:bench
AI_CONTEXT_LIMIT=8192                  # num_ctx
AI_MAX_OUTPUT_TOKENS=700               # num_predict (une annonce complète tient dans ~500 jetons)
AI_QUEUE_MAX_PENDING=100               # au-delà : erreur « file saturée »
AI_CIRCUIT_FAILURES=3                  # pannes consécutives avant ouverture du disjoncteur
AI_CIRCUIT_COOLDOWN_MS=60000
AI_HEALTH_TOKEN=<jeton long>
ALLOW_AI_FALLBACK=false                # obligatoire en production
```

## Santé : les trois modèles sont vérifiés

`health()` interroge `/api/tags` et compare aux trois modèles attendus :

| Situation | `status` | `ok` |
|---|---|---|
| Les trois présents | `healthy` | oui |
| Modèle de texte présent, mais modèle 1 ou 2 absent | `degraded` (le message dit lequel et la commande `ollama pull`) | non |
| Modèle de texte absent, ou serveur injoignable | `unavailable` | non |

`details.models` liste `{ role, name, present }` pour `text`, `vision`, `embed` ; `details.missing` donne les noms à installer ; `details.installed` ce que le serveur a réellement. Un nom est reconnu s'il est exact, ou si la variable ne porte pas d'étiquette et que `:latest` est installé ; une autre étiquette (`qwen3-embedding:4b` pour `:0.6b`) compte comme absent, car la génération répondrait 404.

En service : `GET /api/ai/health` (en-tête `x-health-token`) renvoie cette santé, les métriques (globales et par rôle : p50/p95, échecs, sorties rejetées, jetons), l'état de la file et du disjoncteur. L'interface affiche le statut (Paramètres › Assistant IA, pastille dans la barre latérale, alerte sur la vue d'ensemble).

## Diagnostic

```bash
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 OLLAMA_MODEL=<texte> pnpm ai:diagnose
```
Affiche les trois modèles et leur présence, teste une génération structurée (JSON) sur mon IA perso puis un embedding sur le modèle 2. Codes de sortie : 0 OK, 2 serveur injoignable ou modèle de texte absent, 3 génération en échec, 4 embedding en échec. Un modèle secondaire absent est signalé mais n'interrompt pas le diagnostic.

## Mesurer la capacité : `pnpm ai:bench`

Trois mesures, choisies par `BENCH_MODE`, toutes avec `AI_MAX_CONCURRENCY` demandes en parallèle pendant `BENCH_SECONDS` (60 par défaut) :

```bash
# 1. Réponses acheteur (mon IA perso) → réponses par minute, p50/p95, jetons
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 OLLAMA_MODEL=<texte> BENCH_SECONDS=120 BENCH_WATTS=300 pnpm ai:bench

# 2. Annonces Studio à partir d'une photo réduite (modèle 1) → secondes par photo
BENCH_MODE=photo BENCH_PHOTO=/chemin/pull.jpg BENCH_PHOTOS=4 AI_PROVIDER=ollama ... pnpm ai:bench

# 3. Embeddings par lots de 16 titres (modèle 2) → textes par seconde, p50/p95 par lot
BENCH_MODE=embed BENCH_BATCH=16 AI_PROVIDER=ollama ... pnpm ai:bench
```

`BENCH_WATTS` est la puissance de la machine en charge lue au wattmètre (à défaut, `nvidia-smi --query-gpu=power.draw --format=csv -l 1` pendant la mesure donne celle de la carte seule) ; `BENCH_KWH_EUR` le prix du kWh (0,2001 € par défaut, tarif Bleu option Base au 1er août 2026). Coût d'électricité par réponse = watts × secondes par réponse ÷ 3 600 000 × prix du kWh.

### Repères attendus (à confirmer)

| Mesure | Repère | Où le lire |
|---|---|---|
| Réponses acheteur | **≈ 15 réponses par minute** (p50 ≈ 8 s à 2 en parallèle) | `pnpm ai:bench` (mode `reply`) |
| Studio | **≈ 3,6 s par photo** (4 à 6 photos réduites par annonce, pas 12 en pleine taille) | `pnpm ai:bench` (mode `photo`) |
| Embeddings | plusieurs dizaines de titres par seconde | `pnpm ai:bench` (mode `embed`) |

Ces repères viennent du compte rendu de réunion, pas d'une mesure sur la machine. Après mesure :
- régler `AI_MAX_CONCURRENCY` (et `OLLAMA_NUM_PARALLEL`) sur la valeur qui donne le meilleur débit **sans** faire exploser le p95 ;
- caler les quotas des offres (réponses par mois, annonces et photos Studio) sur le débit mesuré × heures d'activité, avec de la marge pour le Cloud et Radar ;
- remplir le tableau ci-dessous.

### Mesures sur la machine

| Date | Carte (`nvidia-smi`) | Modèle de texte | Parallèle | Réponses / min | p50 / p95 réponse | s / photo Studio | Textes / s (embed) | W en charge | Centimes / réponse |
|---|---|---|---|---|---|---|---|---|---|
| à remplir | | | | | | | | | |

## Comportement en cas d'indisponibilité

- File à concurrence limitée et délai par requête ; annulation si le client ferme la connexion.
- Disjoncteur : après N échecs, les appels sont refusés immédiatement pendant le temps de repos, puis un appel d'essai est tenté. Il est commun aux trois modèles (un seul serveur Ollama) ; les erreurs de configuration (`model_missing` : modèle non installé, `config` : modèle non configuré ou texte vide) et les sorties invalides, annulations et quotas n'y comptent pas, seules les pannes du serveur (réseau, délai, 5xx) l'ouvrent. Trois annonces Studio sur un modèle de vision non installé ne coupent donc pas les réponses aux acheteurs.
- Suggestions manuelles : erreur explicite « assistant indisponible », l'utilisateur rédige lui-même.
- Automatisations : gabarits déterministes, elles continuent sans IA. Aucun résultat simulé ne remplace Ollama en production (`AI_PROVIDER=mock` refusé).
- Modèle 1 **désactivé** (`OLLAMA_VISION_MODEL=` explicitement vide) : Studio rédige sans lire les photos, à partir des indications, et l'écran l'affiche. Modèle 1 **configuré mais non installé** (valeur par défaut `qwen3-vl:8b` sans `ollama pull`) : santé « degraded », chaque génération Studio reçoit `model_missing` et l'API répond 503 « Générateur indisponible (model_missing) » jusqu'au `ollama pull` ; rien n'est rédigé en production (`ALLOW_AI_FALLBACK=false`).
- Modèle 2 : `AIService.embed` lève `model_missing` (non installé) ou `config` (désactivé), jamais un vecteur inventé. Aucun consommateur n'est branché pour l'instant : l'estimation de prix de Studio (`comparablesFromSales`) n'utilise pas encore les embeddings ; prévu avec l'estimation des prix (5.10).
- Quotas : par organisation (plan + réglage `settings.ai.monthlyRequestQuota`), vérifiés par `core` avant chaque réponse et chaque annonce Studio en comptant les `ai_requests` du mois ; les embeddings ne sont pas décomptés (voir « Routage »).

## Tests disponibles

- Unitaires et contrat sur HTTP simulé : `packages/ai/src/ai.test.ts` (génération structurée, routage des trois modèles, embeddings `/api/embed`, modèle manquant, sortie invalide, timeout, annulation, santé à trois modèles, flux, disjoncteur, file, validation politique, quotas, simulateur d'embeddings déterministe).
- Intégration réelle : `pnpm ai:diagnose` puis `pnpm ai:bench` avec un Ollama accessible ; à exécuter sur la machine.

## Changer de fournisseur plus tard

Implémenter `AIProvider` (`packages/ai/src/types.ts`, `embed` optionnel) et l'ajouter dans `createProvider`. Aucun fournisseur payant n'est appelé automatiquement : l'ajout d'un provider facturé exigera une configuration explicite et une décision documentée.
