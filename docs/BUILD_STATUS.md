# État de construction

Dernière mise à jour : 28 octobre 2026 (fin de la semaine 1 : trois modèles d'IA, offres 1/3/10 et essai 14 jours, compteurs par filiale, gabarits de contre-offre, emails, jetons, stockage S3 compatible, puis correction des findings de relecture).

## Classification des modules

Légende : **IT** implémenté et testé · **IV** implémenté, intégration externe à valider · **SD** simulé en démonstration · **NI** non implémenté.

| Module | Mode démonstration | Mode connecté | Notes |
|---|---|---|---|
| Vitrine (accueil, fonctionnalités, extension, assistant, tarifs, FAQ, contact, légal, connexion, inscription, mot de passe oublié, nouveau mot de passe, invitation) | IT | IT | Textes légaux en brouillon ; formulaire de contact sans envoi. Pages `/mot-de-passe?token=` et `/invitation?token=` : jeton retiré de l'adresse avant le rendu, formulaires branchés sur `/api/auth/password/*` et `/api/auth/invite/accept` |
| Aide (FAQ partagée de 78 questions, recherche instantanée, ancres, « Poser une question », page /app/help) | IT (réponse tirée de la FAQ, signalée) | IT avec simulateur IA ; Ollama **IV** | Vitrine : recherche locale, sans IA (D16). Chiffres (offres, essai, quotas, durées des jetons) tirés des constantes du code |
| Tarifs (essai 14 jours avec carte enregistrée, Starter / Pro / Agence 1 / 3 / 10 comptes, annuel 2 mois offerts, fondateurs, filiales : Studio seul au curseur, Radar, Radar Auto, Cloud en option, Selio Comptes) | IT | IT | Montants **indicatifs** dans `PRICING` (`packages/demo-data/src/plans.ts`), jamais en dur dans un composant ; devis Studio seul monotone (interpolation entre packs, plancher 0,02 €/photo, 4,99 € minimum) ; aucun paiement encaissé ; fin d'essai non appliquée tant que le paiement n'est pas branché |
| Offres et quotas (`PLAN_QUOTAS` 1/3/10, aucun compte à la carte, essai `trialing` 14 j au plan Pro, quotas Studio / Track / Cloud / relance 24 h par plan) | IT | IT | Anciens abonnements : JSON `quotas` d'avant les offres remplacé par ceux du plan à la lecture (`resolveQuotas`) et en base (migration 0008) ; un devis sur mesure (JSON complet) est conservé |
| Compteurs par filiale et page « Mon utilisation » (annonces et photos portées Studio, scans et recherches par photo Track, actions Cloud du jour, réponses de mon IA perso, articles, comptes, membres ; alerte à 80 % ; remise à zéro le 1er du mois UTC) | IT | IT | Le compteur IA suit la règle du refus : requêtes `ai_requests` du mois (échecs compris, aide exclue) face au plus petit entre le quota du plan et `settings.ai.monthlyRequestQuota` (500 par défaut). Vue administrateur « utilisation par client » (fonction SQL `app_admin_org_usage`, triée du plus proche de sa limite) |
| Onboarding (compte, préférences, mode, extension, règles IA, checklist) | IT | IT | |
| Vue d'ensemble (CA, marge, stock, alertes, filtres temporels) | IT | IT | Calculs depuis les données, aucun KPI aléatoire |
| Articles et stock (CRUD, photos, prix, statuts, recherche/tri/pagination, import/export CSV, lot, historique) | IT | IT | Photos : data URL (démo) / URL en base (connecté) ; stockage S3 compatible prêt côté API (voir ligne dédiée), envoi depuis le navigateur à brancher |
| Messagerie et négociation (conversations, brouillons, suggestions IA validées, plancher/marge, statut réel, blocage connecteur) | IT (envoi simulé) | IT avec simulateur ; **IV** pour Vinted (préparation seule, envoi manuel) | Gabarits de contre-offre : « dernier prix » seulement au plancher, formule neutre sinon, jamais « meilleur prix » ni « très bon état » ; la validation (`false_last_price`) l'impose aussi au vrai modèle |
| CRM (fiche, historique, notes, tags, fusion) | IT | IT | Minimisation des données |
| Commandes et expédition (idempotence, transitions, marge, suivi, document) | IT (document « Démonstration ») | IT ; document réel **NI** (fourni par la plateforme) | |
| Analyses (ventes, marge, rotation, panier, filtres, export) | IT | IT | Conventions affichées |
| Automatisations (règles, horaires, limites, file, historique, pause, arrêt global, retry, doublons) | IT (exécution immédiate simulée) | IT (serveur) ; actions navigateur **IV** (remises à l'extension) | Négociation automatique : mêmes gabarits de contre-offre que l'IA |
| Radar (recherches, opportunités classées, observé/estimé) | SD | SD (simulateur côté serveur) | Connecteur réel **NI** (pas de source autorisée) |
| Achat assisté (budget, contrôles, simulation, doublons) | SD | SD | Achat réel **NI** et désactivé par conception |
| Comptes Vinted catégorisés (vente, achat, perso) ; Paramètres (organisation, rôles, IA, abonnement, utilisation, notifications, sécurité, données, statut) | IT | IT | Invitation : compte créé, email avec lien 7 jours, retour en arrière si l'email ne part pas (503 `email_unavailable`). Email de notification (alertes) : gabarit prêt, aucun déclencheur branché |
| Administration opérateur (services, files, connecteurs, IA, plans/quotas, utilisation par client, erreurs, audit) | IT | IT | |
| Emails transactionnels (`packages/email` : invitation, mot de passe oublié, échec de paiement, alerte ; gabarits texte + HTML échappé) | IT (noop) | IT avec `noop` (journal, adresse masquée) ; `smtp` **IV** (nodemailer, STARTTLS imposé sur `smtp://`, délais 10–15 s) | Fournisseur à valider avec Ibrahim ; `noop` par défaut, signalé au démarrage en production. Envoi hors transaction PostgreSQL et hors chemin de réponse (mot de passe oublié : 204 à temps constant) |
| Jetons envoyés par email (réinitialisation 1 h, invitation 7 jours : 32 octets, empreinte SHA-256 seule en base, usage unique, sessions fermées) | — | IT | Migration 0007, tables globales hors RLS comme `users` ; `token_invalid` sans distinguer inconnu / expiré / utilisé |
| Stockage des photos (`packages/storage` : S3 compatible, SigV4 maison, URLs signées PUT/GET, `/api/uploads/policy`, `/presign`, `/read`) | — | IT (signature, politique, routes) ; MinIO **IV** (à déployer sur la machine) | Type et taille signés, clés `org/<orgId>/…`, 5 Mo max ; sans `STORAGE_ENDPOINT` : 503 `storage_unconfigured`. Côté navigateur à brancher |
| Extension MV3 (popup, options, service worker, content script, jetons, diagnostic) | — | **IV** : adaptateurs sur fixtures, testée sur un vrai compte | Build et chargement Chromium vérifiés |
| Connecteur Vinted | — | **IV** (expérimental) | Aucun envoi automatique |
| Paiement Stripe (checkout, webhooks vérifiés, idempotence, prix Starter / Pro / Agence) | SD | **IV** mode test (aucune clé fournie) | **À remplacer par Revolut** (semaine 2) derrière une interface de fournisseur ; carte enregistrée dès l'essai (`cardOnFile`) et résiliation en fin de période (`cancelAtPeriodEnd`) prévues en base (0005) |
| IA : trois modèles via Ollama (mon IA perso = texte, modèle 1 = photos `qwen3-vl:8b`, modèle 2 = prix `qwen3-embedding:0.6b`), routage par tâche, file, disjoncteur, santé à trois modèles, diagnostic, banc d'essai | SD (MockAIProvider, embeddings déterministes) | **IV** : HTTP simulé testé, matériel absent | Aucune latence mesurée (`pnpm ai:bench` à lancer sur la machine). Disjoncteur insensible aux erreurs de configuration (`model_missing`, `config`). Modèle 2 : aucun consommateur branché (prévu 5.10) |
| Base PostgreSQL + RLS + migrations 0001 → 0008 | — | IT | Tests sur PostgreSQL 16 local ; 0008 réécrit les anciens JSON de quotas et aligne la vue administrateur sur le quota IA réel |
| Worker BullMQ (ticks, rétention, radar, sync) | — | IT (tâches) ; planification BullMQ **IV** (Redis local disponible, exécution longue non observée) | |

## Commandes exécutées et résultats (session du 28 octobre 2026)

Voir docs/TEST-REPORT.md pour le détail des sessions précédentes. Cette session : `pnpm -s lint` ✔, `pnpm -s typecheck` ✔ (0 erreur), `pnpm -s test` ✔ (51 fichiers, 348 tests : unitaires + intégration sur PostgreSQL 16 et Redis 7 locaux, migrations 0001 → 0008 appliquées sur `selio_test` et `selio_test_api`), `pnpm -s build:api` ✔, `pnpm -s build:web` ✔ (PWA générée). Playwright **non exécuté** dans cette session (aucun navigateur dans le conteneur) : `npx playwright install chromium` puis `pnpm --filter @selio/web test:e2e` sur la machine.

## Limites connues

- Ollama non raccordé (matériel absent) : aucune mesure de latence ni de capacité ; `AI_MAX_CONCURRENCY` et les quotas restent les valeurs prudentes par défaut. Modèle 1 configuré mais non installé → Studio répond 503 jusqu'au `ollama pull` (santé « degraded »).
- Paiement : adaptateur Stripe de test, à remplacer par Revolut ; aucune carte enregistrée (`cardOnFile` toujours faux), fin d'essai non appliquée, email d'échec de paiement prêt mais sans déclencheur.
- Emails : service à valider avec Ibrahim ; `EMAIL_PROVIDER=noop` par défaut (rien ne part, journal seul), avertissement au démarrage en production. SMTP testé sans réseau (transport injecté) : connexion réelle, SPF/DKIM à vérifier sur la machine.
- Stockage des photos : API prête, MinIO à déployer sur la machine (derrière Caddy, CORS), envoi depuis le navigateur à écrire ; tant que ce n'est pas fait, les photos restent des URL / data URL en base.
- Modèle 2 (embeddings) : disponible dans `AIService.embed`, aucun consommateur ni décompte de quota ; l'estimation de prix utilise les ventes comparables sans embeddings (5.10).
- Anciens abonnements : la migration 0008 doit être exécutée au déploiement (`pnpm db:migrate`) ; en attendant, la lecture applique déjà les quotas du plan.
- Données de démonstration : quatre comptes Vinted pour un quota Pro de 3 → la jauge « Comptes Vinted » affiche « Limite atteinte » (4 / 3). Décision produit à prendre (retirer un compte du seed ou mettre la démo sur des quotas Agence).
- Remise à zéro des compteurs : 1er du mois (UTC) ; la date anniversaire reste à décider (docs §7).
- Pas de 2FA. Pas de vérification en conditions réelles des adaptateurs de l'extension au-delà du test manuel déjà fait.
- Publication Chrome Web Store non réalisée. Textes juridiques et tarifs : brouillons / indicatifs.
- Tests Playwright non rejoués dans le conteneur de cette session.

## Prochaine tâche exacte

1. Déploiement de la semaine 1 sur la machine : `pnpm db:migrate` (0005 → 0008), les trois modèles Ollama (`ollama pull`, `OLLAMA_MAX_LOADED_MODELS=3`, `OLLAMA_KEEP_ALIVE`), `pnpm ai:diagnose` puis `pnpm ai:bench` (réponses / min, p50 / p95, s / photo, textes / s), reporter les chiffres dans docs/OLLAMA-SETUP.md et régler `AI_MAX_CONCURRENCY` et les quotas.
2. Semaine 2 — paiement Revolut (prompt 5.5) : interface de fournisseur de paiement (Stripe conservé comme adaptateur de test, Mollie en secours), adaptateur Revolut Merchant API (formulaire intégré, carte enregistrée dès l'inscription → `cardOnFile`, débit mensuel depuis le worker, webhooks vérifiés et idempotents), échecs à J+1 / J+3 / J+7 avec `paymentFailedEmail`, retour à l'accès de base après trois échecs, factures, résiliation en trois clics (`cancelAtPeriodEnd`), environnement de test.
3. Photos : MinIO sur la machine (`docker compose up -d minio`, Caddy, CORS), puis l'envoi depuis le navigateur par `POST /api/uploads/presign` → `PUT` signé (articles, Studio, avatars) à la place des data URL.
4. Décisions à obtenir d'Ibrahim et à brancher : service d'email (`EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`, SPF/DKIM), prix définitifs (`PRICING`), date de remise à zéro des quotas, données de démonstration (4 comptes vs quota 3).
