# Ollama — construire maintenant, valider plus tard

Le matériel IA n'est pas encore disponible. L'intégration est écrite, testée sur HTTP simulé et prête à être raccordée. **Aucune latence ni capacité n'a été mesurée sur le matériel cible : les chiffres viendront du diagnostic exécuté sur place.**

## Architecture cible

```
navigateur ──HTTPS──▶ API Selio (Linux) ──réseau privé / passerelle authentifiée──▶ Ollama (PC dédié, port 11434 non exposé publiquement)
```
- Le navigateur n'appelle **jamais** Ollama ; seules l'API et le worker le font (`OllamaProvider`, côté serveur).
- Le serveur métier et le serveur IA peuvent être séparés : `OLLAMA_BASE_URL` pointe vers une adresse privée (VPN WireGuard/Tailscale, ou passerelle HTTPS avec en-tête d'authentification).
- Ne pas exposer `11434` sur Internet sans protection. Si une passerelle est nécessaire, placer Caddy devant Ollama avec `basic_auth` ou un en-tête `Authorization`, et transmettre cet en-tête via `OllamaProvider({ headers })` (pris en charge par le code ; variable à ajouter dans la configuration lors du raccordement).

## Installation sur le futur PC

1. Installer Ollama (Linux) : `curl -fsSL https://ollama.com/install.sh | sh` ; vérifier `ollama --version`.
2. Lier le service à l'interface privée uniquement : `OLLAMA_HOST=10.0.0.5:11434` (fichier `/etc/systemd/system/ollama.service.d/override.conf`, `Environment="OLLAMA_HOST=..."`), puis `systemctl daemon-reload && systemctl restart ollama`.
3. Télécharger le modèle choisi : `ollama pull qwen2.5:7b-instruct` (valeur par défaut de `OLLAMA_MODEL`). Un modèle instruct 7–8 B quantifié en Q4 tient dans ~6 Go de VRAM ; sans GPU, prévoir une latence de plusieurs secondes par réponse (à mesurer).
4. Régler la concurrence côté Ollama : `OLLAMA_NUM_PARALLEL=2`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_KEEP_ALIVE=30m`.
5. Pare-feu : n'autoriser `11434` que depuis l'adresse privée du serveur métier.

## Configuration côté Selio (API et worker)

```
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://10.0.0.5:11434
OLLAMA_MODEL=qwen2.5:7b-instruct
AI_TIMEOUT_MS=45000          # délai maximal par génération
AI_MAX_CONCURRENCY=2         # aligné sur OLLAMA_NUM_PARALLEL
AI_CONTEXT_LIMIT=8192        # num_ctx
AI_MAX_OUTPUT_TOKENS=400     # num_predict
AI_QUEUE_MAX_PENDING=100     # au-delà : erreur « file saturée »
AI_CIRCUIT_FAILURES=3        # pannes consécutives avant ouverture du disjoncteur
AI_CIRCUIT_COOLDOWN_MS=60000
AI_HEALTH_TOKEN=<jeton long>
ALLOW_AI_FALLBACK=false      # obligatoire en production
```

## Diagnostic

```bash
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 OLLAMA_MODEL=qwen2.5:7b-instruct pnpm ai:diagnose
```
Vérifie la joignabilité (`/api/tags`), la présence du modèle, puis une génération structurée (JSON). Codes de sortie : 0 OK, 2 provider/modèle indisponible, 3 génération en échec.

En service : `GET /api/ai/health` (en-tête `x-health-token`) renvoie santé, métriques (p50/p95, échecs, sorties rejetées, jetons), état de la file et du disjoncteur. L'interface affiche le statut IA (Paramètres › Assistant IA, pastille dans la barre latérale, alerte sur la vue d'ensemble).

## Comportement en cas d'indisponibilité

- File à concurrence limitée et délai par requête ; annulation si le client ferme la connexion.
- Disjoncteur : après N échecs, les appels sont refusés immédiatement pendant le temps de repos, puis un appel d'essai est tenté.
- Suggestions manuelles : erreur explicite « assistant indisponible », l'utilisateur rédige lui-même.
- Automatisations : gabarits déterministes, elles continuent sans IA. Aucun résultat simulé ne remplace Ollama en production (`AI_PROVIDER=mock` refusé).
- Quotas : par organisation (plan + réglage), vérifiés avant chaque appel.

## Tests disponibles

- Unitaires et contrat sur HTTP simulé : `packages/ai/src/ai.test.ts` (génération structurée, modèle manquant, sortie invalide, timeout, annulation, santé, flux, disjoncteur, file, validation politique, quotas).
- Intégration réelle (optionnelle) : lancer `pnpm ai:diagnose` avec un Ollama accessible ; non exécutée dans cette session (matériel absent).

## Changer de fournisseur plus tard

Implémenter `AIProvider` (`packages/ai/src/types.ts`) et l'ajouter dans `createProvider`. Aucun fournisseur payant n'est appelé automatiquement : l'ajout d'un provider facturé exigera une configuration explicite et une décision documentée.
