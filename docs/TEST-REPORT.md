# Rapport de tests

Environnement : session cloud Linux, Node 22.22, pnpm 10.28, PostgreSQL 16.15 local (rôle `selio_app` créé par migration), Redis 7.0 local, Chromium Playwright 1.64.

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
