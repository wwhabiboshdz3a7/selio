# Rapport de tests

Environnement : Linux de développement, Node 22.22, pnpm 10.28, PostgreSQL 16.15 local (rôle `selio_app` créé par migration), Redis 7.0 local, Chromium Playwright 1.64.

Toute vérification non exécutée est marquée **non exécutée**.

## Vérifications statiques

| Commande | Résultat |
|---|---|
| `pnpm lint` (ESLint 9, typescript-eslint, react-hooks) | ✔ 0 erreur |
| `pnpm typecheck` (tous les paquets et applications) | ✔ 0 erreur |

## Tests unitaires et d'intégration (`pnpm test`, Vitest 3)

| Projet | Fichiers | Tests | Résultat | Couverture fonctionnelle |
|---|---|---|---|---|
| contracts | 1 | 4 | ✔ | Défauts, montants entiers, sorties IA, mot de passe |
| domain | 10 | 43 | ✔ | Argent (dont propriété parse∘format), marge/plancher, politique de négociation (acceptation, contre-proposition, tours, horaires, limites, injection), commandes (transitions, idempotence), CSV (guillemets, erreurs ligne par ligne, formules), analyses, garde-fous d'automatisation, radar, contenu non fiable, permissions |
| ui | 1 | 3 | ✔ | Formats fr-FR |
| ai | 1 | 22 | ✔ | Mock déterministe, Ollama sur HTTP simulé (JSON, modèle manquant, sortie invalide, 5xx, timeout, annulation, santé, flux), disjoncteur, file, validation politique (intention, prix, fuite, HTML, lien, injection), service (repli démo vs erreur production, quotas, disjoncteur), config |
| connectors | 1 | 11 | ✔ | Simulateur (idempotence, refus), Vinted (jamais d'envoi, statuts), adaptateur DOM sur fixtures (article, conversation, page inconnue, prix), registre, webhooks Stripe (signature, rejeu) |
| demo-data | 1 | 1 | ✔ | Cohérence et déterminisme du jeu de données |
| db | 1 | 6 | ✔ (PostgreSQL réel) | Coffre AES-GCM, hachages, migrations idempotentes, **isolation RLS inter-organisations sans filtre applicatif**, idempotence commandes et événements de paiement, limitation de débit |
| core | 0 | 0 | — | Couvert par api/worker |
| api | 1 | 7 | ✔ (PostgreSQL réel, Fastify inject) | Inscription/connexion, isolation (404 cross-org), parcours complet (article → conversation → suggestion validée → envoi simulé → échec signalé → commande sans doublon → transitions → analyses → CSV → CRM), automatisations (idempotence, validation, arrêt global), rôles (lecteur 403, quota, admin), jetons d'extension (ping, capture, doublon, règles, portées, révocation, jeton forgé), webhook Stripe (signature, rejeu, dupliqué), santé IA protégée, export, suppression avec confirmation, déconnexion |
| worker | 1 | 1 | ✔ (PostgreSQL réel) | Tick d'automatisation multi-organisations idempotent, traitement des tâches, rétention |
| web | 1 | 6 | ✔ (happy-dom) | Client de démonstration : règles de marge, suggestion/envoi/échec, commandes sans doublon, règles idempotentes + arrêt global, achat simulé, réinitialisation |
| extension | 2 | 5 | ✔ | Contrat de messages, manifeste (permissions minimales), content script compilé sur fixture (panneau, diagnostic, aucune capture sans clic, DOM hôte intact) |

Total : **109** tests, tous verts.

## Tests end-to-end (`pnpm test:e2e`, Playwright, application construite en mode démonstration)

Projets : desktop 1280×800, tablette 768×1024, mobile 375×740 (tactile). Locale fr-FR, fuseau Europe/Paris.

| Scénario | desktop | tablette | mobile |
|---|---|---|---|
| Vitrine : accueil, CTA, transparence, mention d'indépendance | ✔ | ✔ | ✔ |
| Vitrine : navigation, tarifs indicatifs, FAQ, légal (noindex, brouillon) | ✔ | ✔ | ✔ |
| Vitrine : mode sombre, absence de débordement horizontal | ✔ | ✔ | ✔ |
| Connexion : démo explicite, mode connecté honnête sans API | ✔ | ✔ | ✔ |
| Parcours de référence : création d'article (achat, frais, plancher) → stock/recherche/export → conversation (offre évaluée, justification) → suggestion IA validée, modification, envoi simulé confirmé → échec d'envoi signalé → commande depuis l'offre sans doublon, transition → analyses + conventions + export → automatisation (exécution, file, validation) → radar (analyse, observé/estimé, score justifié) → achat assisté simulé avec confirmation tapée → CRM (historique) | ✔ | ✔ | ✔ |
| Import CSV : prévisualisation des erreurs ligne par ligne, import partiel | ✔ | ✔ | ✔ |
| Suppression avec mot de confirmation, réinitialisation de la démo | ✔ | ✔ | ✔ |
| Navigation (menu mobile), mode sombre, audit, création et révocation d'un jeton d'extension | ✔ | ✔ | ✔ |

Résultat global : **24 scénarios (8 × 3 projets) verts en 51 s**.

## Inspections visuelles

Captures prises à 375 px, 768 px et 1 280 px, clair et sombre (`apps/web/scripts/screenshots.mjs`) : accueil, tarifs, connexion, vue d'ensemble, stock, messagerie, automatisations, radar, analyses, connexions ; popup et options de l'extension (`apps/extension/scripts/check-extension.mjs`). Corrections apportées après inspection : débordement des cartes sur mobile, chevauchement du statut IA dans la barre latérale, lisibilité du graphique sur mobile, cohérence prix plancher ≤ prix affiché dans le jeu de démo, en-tête de conversation sur mobile.

## Tests prioritaires demandés

| Exigence | Où |
|---|---|
| Règles de prix et marge | domain (pricing, negotiation), web (client démo), api (parcours) |
| Permissions et isolation entre organisations | db (RLS), api (404 cross-org, 403 lecteur, admin) |
| Imports invalides | domain (csv), e2e (import) |
| Jobs idempotents | domain (automation), api, worker, web |
| Coupure de connexion | connectors (statuts), web/api (connexion dégradée/expirée → envoi bloqué, test `[échec]`) |
| Indisponibilité IA | ai (service sans repli → erreur ; disjoncteur), api (503 explicite via AppError) |
| Réponse IA invalide | ai (invalid_output, validation politique), api (mock invalide → 422 via service) |
| Tentative d'injection | domain (untrusted), ai (echo refusé), seed démo (message « ignore previous instructions ») |
| Webhook dupliqué | connectors, db, api |
| Révocation du jeton d'extension | api (401 après révocation), e2e (révocation UI) |
| Suppression avec confirmation | e2e (SUPPRIMER), api (nom d'organisation) |
| Mode clair/sombre et mobile | e2e (3 projets, emulateMedia), captures |

## Non exécuté

- Intégration Ollama réelle (matériel absent) — `pnpm ai:diagnose` à lancer sur le PC cible.
- Validation des adaptateurs Vinted sur le site réel.
- Parcours Stripe en mode test avec de vraies clés.
- Exécution longue du planificateur BullMQ (les tâches sont testées directement ; le scheduler répétable n'a pas tourné plusieurs heures).
- Tests de charge.

## Vérifications du 13 octobre 2026

Après trois modifications de l'interface web (libellé de l'assistant IA, script de thème sorti du HTML pour respecter la CSP, libellé français du rôle dans les paramètres) et la correction des Dockerfiles :

| Vérification | Résultat |
|---|---|
| `pnpm lint` et `pnpm typecheck` (tout le dépôt) | ✔ 0 erreur |
| `pnpm test:e2e` (8 scénarios × desktop, tablette, mobile) | ✔ 24/24 |
| Démo servie avec les règles Netlify (`_headers`, `_redirects`) : en-têtes, liens directs, rechargement des pages de l'application, thème enregistré, absence de violation CSP et d'erreur console | ✔ 21/21 |
| Test négatif : un script inline est bien signalé comme violation CSP | ✔ |
| `pnpm deploy --legacy` de l'API et du worker, puis démarrage depuis le dossier déployé | ✔ (API : `/api/health` répond ; worker : démarrage et arrêt propre) |
| Construction des images Docker | **non exécutée** (client Docker présent, démon injoignable dans l'environnement de test) |
| `pnpm test` complet (PostgreSQL 16 et Redis 7 locaux) | ✔ 109/109 |

## Vérifications du 24 octobre 2026

Sur la dernière version (espaces Studio, Agents, Track, Cloud et générateur, onglet Automatisation, charte violet/or), puis après les correctifs du jour :

| Vérification | Résultat |
|---|---|
| `pnpm lint` et `pnpm typecheck` | ✔ 0 erreur |
| `pnpm test` (PostgreSQL 16 et Redis 7 locaux) | ✔ 237/237 (41 fichiers) |
| `pnpm test:e2e` (desktop, tablette, mobile) | ✔ 116 réussis, 4 ignorés par conception, 0 échec |
| Nouveau test `layout-clipping.spec.ts` : contenu coupé hors zone défilante, 46 pages, mobile et tablette | ✔ (6 pages en défaut avant correction) |
| Archive `livraison/selio-demo-netlify.zip` servie avec ses `_headers` et `_redirects` | ✔ 21/21 |
| Charge, serveur en mode production, 50 connexions, 15 s par route (machine 4 cœurs, base locale, données de démonstration) | ✔ 0 erreur : santé 1 094 req/s, conversations 286, articles 223, dressing 85, vue d'ensemble 41 |

Défauts trouvés et corrigés :

- **Blocage du serveur** dès 10 requêtes simultanées : 14 lectures de l'organisation ouvraient une seconde connexion au milieu d'une transaction (réserve de 10 connexions épuisée, délai de 10 s puis erreur). Vue d'ensemble : 0 req/s et 50 erreurs avant, 41 req/s et 0 erreur après. Test de non-régression dans `apps/api/test/api.test.ts`.
- **Webhook Stripe** : un événement dont le traitement échouait était ensuite ignoré comme doublon. Seul un événement traité est désormais un doublon (test dans `packages/db`).
- **Mobile et tablette** : messagerie, vue d'ensemble, en-tête de page, paramètres, démarrage, journal des tâches et accueil des espaces.
- **Libellés** : le nom technique du serveur de modèle réapparaissait dans la vitrine, la FAQ, le Studio et les réglages IA.

Non exécuté : construction des images Docker ; capacité du modèle IA réel (non raccordé) ; navigateurs autres que Chromium.

## Vérifications du 29 octobre 2026 (paiement Revolut et correction des findings de relecture)

| Vérification | Résultat |
|---|---|
| `pnpm lint` et `pnpm typecheck` (tout le dépôt) | ✔ 0 erreur |
| `pnpm test` (PostgreSQL 16 et Redis 7 locaux, Revolut simulé en HTTP) | ✔ 411/411 (56 fichiers) |
| `pnpm build:api`, `pnpm build:worker`, `pnpm build:web` | ✔ |
| Migration 0010 sur une base jetable (0001 → 0009 puis deux numéros tirés par la séquence, puis 0010) | ✔ compteur amorcé à 2, numéro suivant `SEL-2026-000003`, numéro rendu après `rollback`, deux transactions concurrentes → numéros consécutifs |
| Playwright (`pnpm test:e2e`) | **non exécuté** (aucun navigateur dans le conteneur) |

Défauts de relecture corrigés (tests de non-régression dans `apps/worker/src/tasks.test.ts`, `apps/api/test/api.test.ts`, `packages/db/src/db.test.ts`, `packages/connectors/src/payments/revolut.test.ts`) :

- **Double facture** quand le worker et le webhook `ORDER_COMPLETED` clôturaient la même commande en même temps : clôture conditionnelle et atomique (`update … where state <> 'completed' returning`), index unique sur `invoices.order_id`, réservation atomique des webhooks (`claimed_at`) relâchée en cas d'échec.
- **Carte qui échoue reprise après un retour à l'accès de base** : la carte est oubliée après la troisième relance ; après un paiement depuis le formulaire, la carte retenue est celle de la tentative aboutie de la commande (sinon la plus récente « pour le marchand ») ; parcours « Changer de carte » (`POST /api/billing/card`), débit retenté dans l'heure en retard de paiement.
- **Relances décalées d'un jour** par le passage quotidien à 05:00 : tâche horaire ; test avec échéance à 14:00 et un passage par heure (tentatives le 1er, 2, 4 et 8 novembre, dates identiques dans les emails).
- **Réservation du prix de l'offre pendant l'essai** (jusqu'à 499,90 €) : autorisation de 1 € seulement, annulée aussitôt ; autorisations restées posées réannulées par le worker ; capture inattendue journalisée sans activation ni facture.
- **Carte refusée puis acceptée dans le même formulaire** ignorée : l'état « failed » n'est plus terminal pour une commande de vérification.
- **Carte perdue si la liste des moyens tombe en panne pendant le webhook** : erreur transitoire → 503 et rejeu par Revolut ; relecture des moyens « pour le marchand » avant de fermer un essai.
- **Commande jamais présentée à la banque comptée comme un refus** : annulée et remplacée sans échec compté ; **commande restée en traitement** annulée chez Revolut avant d'être comptée échouée (marge 20 h) ; un `ORDER_COMPLETED` tardif prolonge la période déjà payée au lieu de la raccourcir.
- **Période payée écrasée** par un nouveau paiement à capture automatique : 409 tant que la période court.
- **Trous de numérotation** des factures en cas de transaction annulée : compteur transactionnel `invoice_counters` à la place des séquences.
