# Architecture

## Vue d'ensemble

```
┌──────────────┐   HTTPS (cookie HttpOnly)   ┌──────────────┐    SQL (RLS)    ┌────────────┐
│ apps/web     │ ───────────────────────────▶│ apps/api     │ ───────────────▶│ PostgreSQL │
│ vitrine+app  │                             │ Fastify      │                 └────────────┘
│ (Netlify)    │   Bearer (jeton limité)     │              │    Redis        ┌────────────┐
└──────────────┘ ◀──┐                        │              │ ───────────────▶│ BullMQ     │◀── apps/worker
┌──────────────┐    │                        └──────┬───────┘                 └────────────┘
│ apps/        │────┘                               │ HTTP privé / passerelle authentifiée
│ extension    │  lit la page visible               ▼
└──────────────┘                              ┌──────────────┐
                                              │ Ollama       │  (serveur IA séparé, jamais exposé au navigateur)
                                              └──────────────┘
```

- **Monorepo pnpm**, TypeScript partout, schémas Zod partagés (`packages/contracts`).
- **Séparation domaine / infrastructure / interface** : `packages/domain` ne dépend que de `contracts` ; `packages/core` orchestre les services sur `packages/db` ; `apps/api` n'est qu'une couche HTTP ; `apps/web` consomme une interface `DataClient` implémentée deux fois (démo locale, API).
- **Aucun processus permanent dans le navigateur** : les règles d'automatisation sont évaluées par le worker ; l'extension n'agit qu'à la demande sur la page ouverte.

## Paquets

| Paquet | Rôle | Dépendances |
|---|---|---|
| `contracts` | Entités, payloads, libellés, quotas par plan | zod |
| `domain` | Argent en centimes, marge, prix plancher, politique de négociation, machine à états des commandes, CSV, analyses, garde-fous d'automatisation, radar, achat, texte non fiable, permissions | contracts |
| `ai` | `AIProvider` (health, generate, structured, stream, timeout, annulation, erreurs typées, métriques), `MockAIProvider`, `OllamaProvider`, disjoncteur, file à concurrence limitée, prompts, validation de sortie, service | contracts, domain |
| `connectors` | Interface par capacité, simulateur de démonstration, connecteur Vinted expérimental (transport extension), adaptateurs DOM versionnés + fixtures, adaptateur Stripe (REST + webhooks) | contracts, domain |
| `ui` | tokens.css, thème Tailwind v4, preset v3, composants | react, lucide |
| `demo-data` | Jeu de données de démonstration déterministe, état persistant | contracts, domain, connectors |
| `db` | Pool pg, transactions scopées (`set local app.org_id`), migrations, RLS, coffre AES-GCM, dépôts | contracts |
| `core` | Services serveur partagés par l'API et le worker | ai, connectors, db, domain |

## Modèle de données

Tables : `users`, `organizations`, `memberships`, `sessions`, `marketplace_connections`, `inventory_items`, `inventory_events`, `customers`, `conversations`, `messages`, `orders`, `shipments`, `automation_rules`, `automation_state`, `jobs`, `radar_searches`, `opportunities`, `purchase_requests`, `ai_requests`, `usage_events`, `subscriptions`, `payment_events`, `audit_logs`, `extension_tokens`, `rate_limits`.

Points structurants :
- toute table métier porte `org_id` ; une politique RLS `org_id = app_current_org()` est **forcée** pour le rôle applicatif `selio_app` (non superuser) ;
- `orders.dedupe_key` unique par organisation (idempotence : référence externe, sinon article + client + jour) ;
- `jobs.dedupe_key` unique (règle + cible + jour local) ; `payment_events.id` unique (webhooks) ;
- `messages.external_ref`, `conversations.external_ref` uniques par organisation (ingestion idempotente) ;
- secrets de connexion en `bytea` chiffrés (clé hors base) ; jetons d'extension stockés hachés (SHA-256), préfixe public.

Migrations : `packages/db/migrations/*.sql`, runner `pnpm db:migrate` (table `schema_migrations`, verrou consultatif).

## Calculs financiers

- Montants : **centimes entiers** (`z.number().int()`), aucun flottant ; taux appliqués avec arrondi « demi vers l'infini ».
- CA = somme des prix de vente des commandes `paid`/`shipped`/`delivered`/`completed`, datées par création.
- Coût d'acquisition = prix d'achat + frais d'acquisition, **figé dans la commande** à la vente.
- Marge brute = vente − frais plateforme vendeur − port à charge vendeur − autres coûts − coût d'acquisition. Taux = marge / vente. Ce n'est pas un bénéfice net comptable.
- Prix plancher suggéré = max(acquisition + port + marge minimale absolue, (acquisition + port) / (1 − taux minimal − taux de frais)).

## Politique de négociation (déterministe)

`evaluateOffer` → `accept | counter | decline | escalate | hold` avec les raisons :
1. hors plage horaire → `hold` ; limite par acheteur atteinte → `escalate` ;
2. offre ≥ prix affiché → `accept` ; offre ≥ plancher et remise ≤ remise max → `accept` ;
3. sinon contre-proposition = max(plancher, prix − remise max, prix − pas × (tour + 1)) ; au-delà du nombre de tours → `escalate`.

L'IA reçoit la décision et rédige ; sa sortie est validée par schéma puis par politique (intention cohérente, prix identique au prix imposé, aucun lien/HTML, aucune fuite du prix d'achat ou du plancher, aucun écho d'injection). En production, une défaillance IA remonte une erreur explicite ; le repli sur gabarit n'existe qu'en démonstration ou pour les automatisations (qui continuent sans IA).

## Flux clés

- **Envoi d'un message** : brouillon → `pending` → connecteur (`sendMessage` idempotent par identifiant) → `sent` (avec `simulated` si démo) ou `failed` avec raison. Jamais `sent` avant confirmation.
- **Commande** : création idempotente ; transitions contrôlées ; statut d'article dérivé (réservé / vendu / remis en vente).
- **Automatisation** : règle → garde-fous (`gateRule` : pause globale, activée, horaires, limites jour/acheteur, délai minimal) → job (`awaiting_approval` par défaut) → exécution serveur ou remise à l'extension (`runsIn = browser`), nouvelles tentatives exponentielles bornées.
- **Extension** : content script (monde isolé, shadow DOM) → service worker (seul détenteur du jeton) → `/api/ext/*` (portées du jeton) → réponse d'affichage.

## Front-end

- React 19, Vite 7, react-router 7, TanStack Query, Tailwind v4 branché sur `tokens.css` (`@theme inline`), lucide-react, PWA (vite-plugin-pwa, `NetworkOnly` sur `/api`).
- `DataClient` : `DemoClient` (état en `localStorage`, règles `domain`, simulateurs, instantanés clonés) et `ApiClient` (fetch + cookie). Le mode est choisi à la connexion ; sans `VITE_API_BASE_URL`, seul le mode démonstration est proposé, sans repli silencieux.
