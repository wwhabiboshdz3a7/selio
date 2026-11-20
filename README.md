# Selio

Selio est un écosystème d'outils pour les revendeurs Vinted : gérer son stock et ses annonces, répondre et négocier, analyser le marché, trouver et acheter des articles, au même endroit, avec une IA qui tourne sur notre propre machine. Une vitrine, une application web installable (ordinateur, tablette, téléphone), une extension Chrome, une API, un worker et trois modèles d'IA locaux.

> Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted. Hors de l'API Vinted Pro Integrations (réservée aux comptes Pro admis par Vinted, accès à demander : connecteur préparé sans aucun appel), Vinted n'expose pas d'API publique pour les vendeurs : aucune compatibilité officielle n'est promise, aucun faux OAuth n'est implémenté.

## Les cinq filiales

| Filiale | Ce qu'elle fait |
|---|---|
| **Selio Manager** | Gestion complète et automatisation : stock, dressing noté sur 100 et republications pré-faites, messagerie et négociation par l'IA (la politique décide, l'IA rédige), relances, commandes, marges, analyses, journal d'activité, multi-comptes. Deux fonctionnalités intégrées : **Selio Cloud** (agir quand l'ordinateur est éteint, fermé par défaut) et **Selio Agent** (équipe et délégation : titulaire, administrateur, exécuteur sans les finances, contributeur photos, lecture seule) |
| **Selio Studio** | Annonces créées à partir des photos : tri, étiquette et mesures lues avec leur provenance (jamais de mesure inventée), prix conseillé par les ventes comparables |
| **Selio Track** | Analyse du marché, statistiques seulement : filtres suivis, tendances, niches notées sur 100, recherche par photo, alertes de tendance |
| **Selio Bot** | Recherche et achat : recherches surveillées, bonnes affaires notées sur 100, revente estimée, achat rapide en 1 clic ; achat automatique et achat réel fermés par défaut |
| **Selio Compte** | Services autour des comptes Vinted et accompagnement, payés une fois ou sur devis |

Et **Selio Admin** (`/admin`) pour l'équipe : comptes, qualification, accès offert, offres commerciales et codes promo, Track, santé, supervision. Parrainage « un mois offert aux deux » prêt, fermé par défaut (`REFERRAL_ENABLED`).

## Deux modes, clairement séparés

| Mode | Ce qu'il prouve | Ce qu'il ne prouve pas |
|---|---|---|
| **Démonstration** (développement local, données fictives gardées dans le navigateur, bandeau permanent) | Le parcours métier complet et les règles de marge et de négociation, avec des simulateurs déterministes | Toute intégration externe réelle |
| **Connecté** (production : authentification réelle, PostgreSQL isolé par organisation) | Persistance serveur, rôles, jetons d'extension, file de tâches, IA locale (Ollama), paiement (simulé tant que Revolut n'est pas configuré) | Les connecteurs Vinted (expérimentaux, à valider dans un navigateur réel) |

La démonstration utilise de **vraies annonces Vinted** (photos, titres, marques et prix issus du dépôt revendo, sans nom de compte) : `python3 packages/demo-data/scripts/import-revendo-photos.py <chemin/vers/revendo>` régénère `apps/web/public/demo/photos/` et `packages/demo-data/src/catalog.generated.ts`. Les statistiques (vues, ventes, clients) restent fictives.

## Démarrage rapide

Il faut Node 22 et pnpm 10 (`corepack enable`).

```bash
corepack enable && pnpm install
pnpm dev                       # vitrine + application en mode démonstration : http://127.0.0.1:5173
```

Mode connecté (API + worker) :

```bash
docker compose up -d                           # PostgreSQL 16 + Redis 7 (MinIO : docker compose up -d minio minio-init)
cp apps/api/.env.example apps/api/.env         # puis renseigner SECRETS_ENCRYPTION_KEY (32 octets base64)
DATABASE_URL=postgres://selio:selio@127.0.0.1:5432/selio pnpm db:migrate
DATABASE_URL=postgres://selio:selio@127.0.0.1:5432/selio pnpm db:seed:demo   # facultatif : organisation de démo en base
pnpm dev:api                                   # http://127.0.0.1:8787
pnpm dev:worker
VITE_API_BASE_URL=http://127.0.0.1:8787 pnpm dev   # l'application propose alors « Compte connecté »
```

Extension : `pnpm build:extension` puis chargement non empaqueté de `apps/extension/dist` ([docs/EXTENSION-INSTALL.md](docs/EXTENSION-INSTALL.md)). Paquet pour le Chrome Web Store : `pnpm extension:pack` → `apps/extension/release/selio-extension-<version>.zip`, **sans rien publier** ([docs/WEB-STORE.md](docs/WEB-STORE.md)).

## Production

- **Site** (vitrine + application) : Netlify, construit depuis la branche de production ; Netlify relaie `/api/*` vers l'API.
- **Serveur** : un PC Windows, WSL 2 + Docker Desktop (API, worker, PostgreSQL, Redis), Ollama sur la carte NVIDIA (Ministral 3 8B, Qwen3-VL 8B, Qwen3-Embedding 0.6B), adresse fixe par Tailscale Funnel.
- Installation : [docs/INSTALLATION-WINDOWS.md](docs/INSTALLATION-WINDOWS.md) · activer chaque fonction pas à pas : [docs/TUTORIELS.md](docs/TUTORIELS.md) · toutes les variables : [docs/CLES-ET-CONFIGURATION.md](docs/CLES-ET-CONFIGURATION.md) (aussi en PDF dans `livraison/Selio-cles-et-configuration.pdf`).
- Démonstration seule sur Netlify, sans aucune clé : `deploy/netlify/pack.sh` produit `livraison/selio-demo-netlify.zip`, à glisser sur https://app.netlify.com/drop.

## Vérifications

```bash
pnpm lint && pnpm typecheck
pnpm test:unit                       # domain, contracts, ai, connectors, cloud, pricing, ui, web, extension
npx vitest run --project core        # services serveur (PostgreSQL local)
pnpm test:integration                # api, worker, db (PostgreSQL 16 et Redis 7 locaux)
pnpm test:e2e                        # Playwright sur l'application en démonstration (ordinateur, tablette, téléphone)
pnpm build                           # web, API, worker, extension
pnpm extension:pack                  # paquet Chrome Web Store contrôlé (permissions, manifeste, archive)
pnpm ai:diagnose                     # diagnostic des trois modèles d'IA
```

## Structure

```
apps/web         vitrine + application (React, Vite, PWA)       apps/api        API Fastify (sessions, RLS, jetons extension, webhooks)
apps/worker      planificateur BullMQ                           apps/extension  extension Chrome MV3
packages/ui      composants de la charte violet/or              packages/domain règles métier pures, aide et tutoriels
packages/contracts schémas Zod partagés                         packages/connectors simulateur, connecteur Vinted expérimental, paiement Revolut
packages/ai      AIProvider, Mock, Ollama, disjoncteur, file    packages/db     migrations 0001 → 0023, RLS, dépôts
packages/core    services serveur partagés API/worker           packages/demo-data jeu de données de démonstration, tarifs indicatifs
packages/cloud   navigateur de Selio Cloud (fermé par défaut)   packages/pricing modèle de prix maison (processeur)
packages/storage stockage S3 compatible, URLs signées           packages/email  emails transactionnels (noop ou SMTP)
```

## Documentation

Sommaire complet : **[docs/README.md](docs/README.md)**. Pour commencer :

- [docs/GUIDE-TECHNIQUE.md](docs/GUIDE-TECHNIQUE.md) : comment Selio a été développé (architecture, choix techniques, données, sécurité, IA, paiement, tests, déploiement, journal du développement).
- [docs/TUTORIELS.md](docs/TUTORIELS.md) : tutoriels d'activation en production.
- [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md) : état de chaque module.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DECISIONS.md](docs/DECISIONS.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/SUPERVISION.md](docs/SUPERVISION.md) · [docs/SAUVEGARDE.md](docs/SAUVEGARDE.md)
- Par filiale : [docs/STUDIO.md](docs/STUDIO.md), [docs/TRACK.md](docs/TRACK.md), [docs/PRIX.md](docs/PRIX.md), [docs/BOT.md](docs/BOT.md), [docs/RADAR.md](docs/RADAR.md), [docs/CLOUD.md](docs/CLOUD.md), [docs/NEGOCIATION.md](docs/NEGOCIATION.md), [docs/MIGRATION.md](docs/MIGRATION.md) ; vitrine : [docs/VITRINE.md](docs/VITRINE.md).

Les clients trouvent les mêmes réponses et des tutoriels pas à pas dans le centre d'aide de l'application (`/app/help`) et la FAQ publique (`/faq`).

La charte (tokens, preset Tailwind, guidelines) est dans `brand/` et `packages/ui`.

---

Développé par Ibrahim — Selio.
