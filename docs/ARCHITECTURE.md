# Architecture

## Vue d'ensemble

```
┌──────────────┐  HTTPS (cookie HttpOnly)   ┌──────────────┐   SQL (RLS)   ┌──────────────┐
│ apps/web     │ ─────────────────────────▶ │ apps/api     │ ────────────▶ │ PostgreSQL   │
│ vitrine+app  │  WebSocket (fenêtre de     │ Fastify      │               └──────▲───────┘
│ (Netlify)    │ ◀────────────────────────▶ │              │                      │ SQL (RLS)
└──────────────┘   connexion du Cloud)      │              │   Redis       ┌──────┴───────┐
┌──────────────┐  Bearer (jeton limité)     │              │ ────────────▶ │ apps/worker  │
│ apps/        │ ─────────────────────────▶ │              │ BullMQ et     │ tâches,      │
│ extension    │  lit la page visible       └──────┬───────┘ pub/sub Cloud │ Selio Cloud  │
└──────────────┘                                   │                       └──┬────────┬──┘
                                                   │ HTTP privé ou            │        │ Chromium neuf par action,
                                                   ▼ passerelle               │        ▼ profil temporaire
                                            ┌──────────────┐                  │   ┌──────────┐
                                            │ Ollama       │ ◀────────────────┘   │ vinted.* │
                                            └──────────────┘                      └──────────┘
```

- **Monorepo pnpm**, TypeScript partout, schémas Zod partagés (`packages/contracts`).
- **Séparation domaine / infrastructure / interface** : `packages/domain` ne dépend que de `contracts` ; `packages/core` orchestre les services sur `packages/db` ; `apps/api` n'est qu'une couche HTTP ; `apps/web` consomme une interface `DataClient` implémentée deux fois (démo locale, API).
- **Aucun processus permanent dans le navigateur** : les règles d'automatisation sont évaluées par le worker ; l'extension n'agit qu'à la demande sur la page ouverte.
- **Selio Cloud** (détails : CLOUD.md) : le worker ouvre un Chromium **sur notre machine, seulement pour agir** (une action ; bac à sable actif, environnement minimal, contexte sans enregistrement sur le disque, dossier de travail temporaire ; puis fermeture), au rythme humain et dans les plafonds de l'offre. Aucun processus permanent par compte. La fenêtre de connexion du client est filmée par capture d'écran CDP. Ses images et les entrées du client passent par Redis pub/sub (`cloud:screen:<id>`, `cloud:input:<id>`) entre le worker et l'API, puis par un WebSocket (ticket à usage unique) entre l'API et le navigateur du client. L'API ne lance jamais de navigateur.
- **Selio Radar** (détails : RADAR.md) : le worker passe **toutes les 30 s** (`radar.tick`) et lit les recherches dues (60 s en direct, 30 s pour 3 recherches prioritaires quand Radar Auto est ouvert, 1 h pour le simulateur, multiplié par le facteur de ralentissement). La lecture en direct passe par le compte Achat du client relié à Selio Cloud, dans le **même exécuteur Playwright** que les actions du Cloud : un Chromium neuf par page (`fetchPage`), puis fermeture. Lectures, achats de Radar Auto (`openBrowsing`), actions et fenêtres de connexion du Cloud prennent leurs navigateurs dans **un seul sémaphore partagé** (`BrowserSlots`, `CLOUD_MAX_BROWSERS`) et respectent le même **coupe-circuit de la machine** (`cloud_runtime`). Le cœur décide et enregistre (mesures, pause, alertes) ; `@selio/cloud` ne touche pas à la base. Les alertes partent du worker en **Web Push** (clés VAPID) vers les services de notification des navigateurs ; le navigateur du client ne reçoit que la clé publique. Le branchement dans l'API et le worker est livré en parallèle de ce document : état dans BUILD_STATUS.md.
- **Sauvegarde** (SAUVEGARDE.md) : `scripts/sauvegarde/` hors application. Chaque nuit, PostgreSQL et photos chiffrés avec age et copiés hors machine ; chaque mois, test de restauration.

## Paquets

| Paquet | Rôle | Dépendances |
|---|---|---|
| `contracts` | Entités, payloads, libellés, quotas par plan | zod |
| `domain` | Argent en centimes, marge, prix plancher, politique de négociation, machine à états des commandes, CSV, analyses, garde-fous d'automatisation, radar (note sur 100, estimation de revente par marque et catégorie ou par ventes proches — similarité cosinus des embeddings), achat, texte non fiable, permissions | contracts |
| `ai` | `AIProvider` (health, generate, structured, stream, timeout, annulation, erreurs typées, métriques), `MockAIProvider`, `OllamaProvider`, disjoncteur, file à concurrence limitée, prompts, validation de sortie, service | contracts, domain |
| `connectors` | Interface par capacité, simulateur de démonstration, connecteur Vinted expérimental (transport extension), adaptateurs DOM versionnés + fixtures (conversation et annonce `v1`, page de recherche `catalog-v1` et paiement `checkout-v1` pour Selio Radar, non vérifiés en réel), lecteur HTML borné sans navigateur, interface `PaymentProvider` et client Revolut Merchant API (REST + webhooks signés, sans SDK) | contracts, domain |
| `ui` | tokens.css, thème Tailwind v4, preset v3, composants | react, lucide |
| `demo-data` | Jeu de données de démonstration déterministe, état persistant | contracts, domain, connectors |
| `db` | Pool pg, transactions scopées (`set local app.org_id`), migrations, RLS, coffre AES-GCM, dépôts | contracts |
| `core` | Services serveur partagés par l'API et le worker | ai, connectors, db, domain |
| `cloud` | Socle navigateur de Selio Cloud : exécuteur Playwright (un Chromium par action, bac à sable vérifié au démarrage, environnement en liste blanche, contexte sans enregistrement), fenêtre de connexion par capture d'écran CDP avec garde de navigation, filtre de session sur la liste fermée des domaines Vinted (sans cookies anti-robot), détection des signaux de Vinted (pour s'arrêter), créneaux de navigateurs, banc de capacité `pnpm cloud:bench`. Selio Radar (`src/radar/`) : lecture d'une page (`fetchPage`, `RadarReader`), achat pas à pas sans aucune méthode d'écriture (`openBrowsing`, `PurchaseRunner`, essai à blanc par défaut, attente 3-D Secure), conduite imposée par un signal, mesures pures. Ne touche ni à la base ni au chiffrement | contracts (domaines Vinted), connectors (adaptateur Vinted v1), playwright-core |

## Modèle de données

Tables : `users`, `organizations`, `memberships`, `sessions`, `marketplace_connections`, `inventory_items`, `inventory_events`, `customers`, `conversations`, `messages`, `orders`, `shipments`, `automation_rules`, `automation_state`, `jobs`, `radar_searches`, `opportunities`, `purchase_requests`, `ai_requests`, `usage_events`, `subscriptions`, `payment_orders`, `invoices`, `payment_events`, `audit_logs`, `extension_tokens`, `rate_limits`, `password_resets`, `invites`, `invoice_counters`, `cloud_consents`, `cloud_accounts`, `cloud_actions`, `cloud_login_sessions`, `cloud_runtime`, `radar_reads`, `push_subscriptions`, `radar_alerts`, `embeddings_cache`.

Points structurants :
- toute table métier porte `org_id` ; une politique RLS `org_id = app_current_org()` est **forcée** pour le rôle applicatif `selio_app` (non superuser) ;
- `orders.dedupe_key` unique par organisation (idempotence : référence externe, sinon article + client + jour) ;
- `jobs.dedupe_key` unique (règle + cible + jour local) ; `payment_events.id` unique (webhooks : `revolut:<order_id>:<event>`) ; `payment_orders.order_id` unique (une ligne par commande chez le fournisseur) ; `invoices.number` unique, `SEL-AAAA-000001` par une séquence SQL par année (`app_next_invoice_number`) ;
- `messages.external_ref`, `conversations.external_ref` uniques par organisation (ingestion idempotente) ;
- secrets de connexion en `bytea` chiffrés (clé hors base) ; jetons d'extension stockés hachés (SHA-256), préfixe public.
- `jobs.runs_in` vaut `server`, `browser` (remis à l'extension) ou `cloud` (exécuté par le worker dans Chromium) ; index partiel des tâches Cloud échues ;
- Selio Cloud (0011) : `cloud_accounts.connection_id` unique (un compte Cloud par compte Vinted, supprimé avec lui), session en `bytea` chiffrée (AES-256-GCM, données associées = identifiant du compte Cloud), verrou `running_since` ; `cloud_consents` (version, empreinte SHA-256 du texte, date, utilisateur) ; `cloud_actions` (journal de 90 jours, sans texte de message) ; `cloud_login_sessions` (empreinte du ticket seulement, `attached_at` : ticket à usage unique) ; RLS forcée sur ces quatre tables ; `cloud_runtime` (coupe-circuit de la machine, une ligne, aucune donnée d'organisation) ; `app_cloud_after_restore()` à lancer après toute restauration.
- Selio Radar (0012) : `radar_searches` porte la source (`demo` ou `cloud`), la priorité, le compte Achat lu, le facteur de ralentissement et les compteurs de pages et de blocages ; une affaire par référence Vinted et par organisation (index unique sur `observed->>'externalRef'`) ; une seule demande d'achat active par affaire (index unique partiel) ; `purchase_requests` garde le total réel, la référence de commande, l'article reporté dans Manager et la fin de l'attente 3-D Secure ; `radar_reads` (une ligne par lecture, 90 jours, base du taux de blocage et du ralentissement) ; `push_subscriptions` (adresse unique, liée à l'utilisateur et à une seule organisation) ; `radar_alerts` (file des notifications, une par affaire, sans donnée de vendeur) ; `embeddings_cache` (vecteurs du modèle 2 par organisation, modèle et empreinte du texte) ; RLS forcée sur ces quatre tables ; fonctions `SECURITY DEFINER` `app_radar_org_ids()` et `app_push_endpoint_release()`.

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
- **Selio Cloud** : règle « répondre » ou « relancer » sur un compte actif dans le Cloud → tâche `runs_in = cloud` → passage du worker chaque minute (`runDueCloudJobs`) : au plus une action par compte, garde-fous (arrêt global, coupe-circuit, accord de la version courante, offre, plafond de comptes, compte actif, session, niveau léger, heures actives 8 h – 23 h, plafond du jour `automationActionsPerDay`, 12 par heure, 3 à 7 min entre deux actions) → verrou du compte, **relecture sous verrou** (arrêt global, coupe-circuit, accord, offre, plafond de comptes) et prise unique de la tâche → Chromium hors transaction → journal `cloud_actions`, compteur `cloud.action` (seulement si le navigateur a été lancé), session refiltrée et rechiffrée si elle n'a pas changé entre-temps. CAPTCHA, avertissement, blocage ou « trop de requêtes » → pause du compte écrite d'abord, email, rien n'est retenté ; « trop de requêtes » ou blocage → coupe-circuit de la machine ; session refusée → connexion à refaire ; aucun navigateur libre → tâche remise en file sans rien compter.
- **Selio Radar** : `radar.tick` (worker, toutes les 30 s) → `planReads` (fonction pure : recherches dues, prioritaires d'abord) → `runSearch` par recherche due, dans les plafonds de pages par minute (organisation, puis machine) → garde-fous (arrêt global, coupe-circuit, rythme, compte Achat relié à un compte Cloud actif avec session, accord Cloud) → verrou du compte Cloud, session déchiffrée → Chromium hors transaction (`fetchPage`, page catalogue lue puis refermée ; aucun créneau libre : rien n'est lu ni compté) → annonces revalidées, dédoublonnées (référence Vinted, sinon titre et prix) → revente estimée hors transaction (embeddings du modèle 2 avec cache, sinon marque et catégorie) → note, affaire, alerte en file (note ≥ 75, heures calmes), ligne `radar_reads`, facteur de ralentissement. CAPTCHA, avertissement, blocage ou « trop de requêtes » → pause du compte Cloud écrite d'abord (`cloud.pauseFromSystem`), coupe-circuit de la machine pour « trop de requêtes » et blocage, email et notification, mesure « bloquée », rien n'est retenté. `alerts.send` (chaque minute) envoie les alertes échues en Web Push.
- **Radar Auto** (fermé par défaut) : `radar.auto` (worker, toutes les 30 s, seulement si `RADAR_AUTO_ENABLED`) → verrous (serveur, organisations de l'équipe, réglage de l'organisation, compte Achat dans le Cloud, accord) → affaires nouvelles de la mieux notée à la moins bien notée (seuil, prix maximum par article, plafond du jour, contrôles) → réservation (index unique) → au plus un achat par le navigateur et par passage (`openBrowsing` : annonce, « Acheter », porte-monnaie Vinted, total relu ; essai à blanc arrêté avant le paiement tant que `RADAR_REAL_PURCHASE` est fermé) → issue enregistrée, prix d'achat reporté dans Manager. Validation 3-D Secure : navigateur tenu ouvert (`CLOUD_3DS_TIMEOUT_MS`), notification, le client valide dans sa banque, reprise mise en file par l'API (`selio-radar`) et relue par le worker sans rien saisir ; délai passé : abandon et alerte, rien n'est racheté.
- **Paiement** : `POST /api/billing/checkout` crée la commande Revolut (pendant l'essai : capture manuelle d'un montant de vérification de 1 € ; ensuite : capture automatique du prix de l'offre) et renvoie son jeton public → le navigateur ouvre le formulaire Revolut (carte enregistrée « pour le marchand ») → le webhook signé confirme (`ORDER_AUTHORISED` sur une commande de vérification : carte retenue — celle de la tentative aboutie, lue sur la commande — et autorisation annulée ; `ORDER_COMPLETED` : période ouverte et facture, clôture atomique de la commande). `POST /api/billing/card` enregistre une nouvelle carte de la même façon (1 € autorisé puis annulé) ; en retard de paiement, le débit est retenté dans l'heure. Le worker (`billing.renew`, toutes les heures) débite les renouvellements avec le moyen enregistré, relance à J+1 / J+3 / J+7 après un échec (une commande jamais présentée à la banque est remplacée sans compter d'échec ; une commande restée en traitement est annulée chez Revolut avant d'être comptée échouée) puis ramène à l'accès de base avec 30 jours de conservation, carte oubliée. Une période déjà payée n'est jamais écrasée (409 : changement d'offre ou de carte). Sans clé Revolut, aucune commande n'est créée et l'interface le dit.

## Front-end

- React 19, Vite 7, react-router 7, TanStack Query, Tailwind v4 branché sur `tokens.css` (`@theme inline`), lucide-react, PWA (vite-plugin-pwa en `generateSW`, `NetworkOnly` sur `/api`). Notifications de Selio Radar (livrées en parallèle, voir BUILD_STATUS.md) : le service worker généré importe `public/push-handler.js` (affichage de la notification, ouverture d'un chemin interne seulement) ; l'abonnement se fait avec la clé publique VAPID servie par l'API ; aucun processus permanent dans la page.
- `DataClient` : `DemoClient` (état en `localStorage`, règles `domain`, simulateurs, instantanés clonés) et `ApiClient` (fetch + cookie). Le mode est choisi à la connexion ; sans `VITE_API_BASE_URL`, seul le mode démonstration est proposé, sans repli silencieux.
- Paiement côté web : Paramètres › Abonnement (offre et périodicité, bouton « Enregistrer ma carte » ou « Payer », « Changer de carte » pour un abonnement en cours, widget `@revolut/checkout` chargé à la demande, attente du webhook avec rafraîchissement toutes les 5 s pendant 1 minute, résiliation en trois clics, reprise, changement d'offre au prochain renouvellement), Paramètres › Factures (liste et vue imprimable noir sur blanc, mentions de l'émetteur lues dans `VITE_INVOICE_ISSUER_*`), bandeau « Enregistrez votre carte » pendant l'essai sans carte. La démonstration simule le paiement (succès immédiat, factures, résiliation) et le dit. Le bundle navigateur importe l'index de `@selio/connectors` pour le simulateur : `node:crypto`, utilisé par le client Revolut serveur, y est remplacé par un shim (`apps/web/src/lib/shims/node-crypto.ts`, alias Vite) qui n'est jamais exécuté.
