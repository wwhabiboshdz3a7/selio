# Selio

Plateforme de gestion pour revendeurs Vinted : vitrine, application web de gestion (responsive, installable), extension navigateur, API, worker et intégration IA prête à raccorder à un serveur Ollama.

> Selio est un outil indépendant, sans affiliation avec Vinted. Vinted n'expose pas d'API publique pour les vendeurs : aucune compatibilité officielle n'est promise, aucun faux OAuth n'est implémenté.

## Modules

- **Générateur d'annonces** : photos → titre, description, marque, catégorie, taille, état, couleurs ; prix conseillé calculé sur les ventes comparables ; choix du compte Vinted, brouillon ou publication. Modèle IA personnel (Ollama + modèle de vision).
- **Dressing intelligent** : note /100 au-dessus de chaque annonce (visibilité, attractivité, qualité, prix) avec les améliorations à faire ; tri « en ligne depuis 7 jours ou plus » ; 10 republications pré-faites par annonce, suivi des variantes déjà utilisées et de leur rendement à 48 h.
- **Analyse des revendeurs** : grands revendeurs, leur niche, marques, rotation, niches porteuses (inspiration ResellTrack).
- **Bonnes affaires · À valider · Achat auto** : note /100 expliquée, coût réel (prix + port + protection acheteurs), revente, bénéfice et marge ; validation en un clic ; achat automatique au-dessus d'un seuil avec plafond par jour et délai d'annulation (simulé tant qu'aucun connecteur d'achat n'est autorisé).
- Stock, messagerie, clients, commandes, analyses (galerie de graphiques personnalisable), automatisations, paramètres.

## Deux modes, clairement séparés

| Mode | Ce qu'il prouve | Ce qu'il ne prouve pas |
|---|---|---|
| **Démonstration** (sans credentials, données fictives persistantes dans le navigateur, bandeau permanent) | Le parcours métier complet et les règles de marge/négociation, avec simulateurs déterministes pour marketplace, paiement et IA | Toute intégration externe réelle |
| **Connecté** (authentification réelle, PostgreSQL avec isolation par organisation) | Persistance serveur, rôles, jetons d'extension, file de tâches, raccordement Ollama | Les connecteurs Vinted (expérimentaux, à valider dans un navigateur réel) |

## Démarrage rapide

```bash
corepack enable && pnpm install
pnpm dev                       # vitrine + application en mode démonstration : http://127.0.0.1:5173
```

Mode connecté (API + worker) :

```bash
docker compose up -d                           # PostgreSQL 16 + Redis 7
cp apps/api/.env.example apps/api/.env         # puis renseigner SECRETS_ENCRYPTION_KEY (32 octets base64)
DATABASE_URL=postgres://selio:selio@127.0.0.1:5432/selio pnpm db:migrate
DATABASE_URL=postgres://selio:selio@127.0.0.1:5432/selio pnpm db:seed:demo   # facultatif : organisation de démo en base
pnpm dev:api                                   # http://127.0.0.1:8787
pnpm dev:worker
VITE_API_BASE_URL=http://127.0.0.1:8787 pnpm dev   # l'application propose alors « Compte connecté »
```

Extension : `pnpm build:extension` puis chargement non empaqueté de `apps/extension/dist` (voir [docs/EXTENSION-INSTALL.md](docs/EXTENSION-INSTALL.md)).

## Mise en ligne

- **Démo sur Netlify, sans aucune clé** : `deploy/netlify/pack.sh` produit `livraison/selio-demo-netlify.zip` ; décompresser puis glisser le dossier sur https://app.netlify.com/drop.
- **Clés et variables à fournir** (base de données, chiffrement, IA, Stripe…) : [docs/CLES-ET-CONFIGURATION.md](docs/CLES-ET-CONFIGURATION.md), aussi en PDF dans `livraison/Selio-cles-et-configuration.pdf`.
- Détails : [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Vérifications

```bash
pnpm lint && pnpm typecheck
pnpm test                 # unitaires + intégration (les tests base/API/worker se désactivent si PostgreSQL local est absent)
pnpm test:e2e             # Playwright sur l'application en démonstration (desktop, tablette, mobile)
pnpm build                # web, API, worker, extension
pnpm ai:diagnose          # diagnostic du provider IA configuré
```

## Structure

```
apps/web         vitrine + application (React, Vite, PWA)       apps/api        API Fastify (sessions, RLS, jetons extension, webhooks)
apps/worker      planificateur BullMQ                           apps/extension  extension Chrome MV3
packages/ui      composants conformes aux guidelines            packages/domain règles métier pures (argent, marge, négociation…)
packages/contracts schémas Zod partagés                         packages/connectors simulateur, connecteur Vinted expérimental, Stripe
packages/ai      AIProvider, Mock, Ollama, disjoncteur, file    packages/db     migrations, RLS, dépôts
packages/core    services serveur partagés API/worker           packages/demo-data jeu de données de démonstration
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DECISIONS.md](docs/DECISIONS.md) · [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md)
- [docs/CONNECTORS.md](docs/CONNECTORS.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/CLES-ET-CONFIGURATION.md](docs/CLES-ET-CONFIGURATION.md) · [docs/OLLAMA-SETUP.md](docs/OLLAMA-SETUP.md) · [docs/EXTENSION-INSTALL.md](docs/EXTENSION-INSTALL.md)
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md) · [docs/PRODUCTION-CHECKLIST.md](docs/PRODUCTION-CHECKLIST.md)

La charte (tokens, preset Tailwind, guidelines) est dans `brand/` et `packages/ui`.
