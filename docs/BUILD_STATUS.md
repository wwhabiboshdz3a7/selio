# État de construction

Dernière mise à jour : 8 octobre 2026 (session cloud, branche `claude/jolly-knuth-5bu1el`).

## Classification des modules

Légende : **IT** implémenté et testé · **IV** implémenté, intégration externe à valider · **SD** simulé en démonstration · **NI** non implémenté.

| Module | Mode démonstration | Mode connecté | Notes |
|---|---|---|---|
| Vitrine (accueil, fonctionnalités, extension, assistant, tarifs, FAQ, contact, légal, connexion, inscription) | IT | IT | Textes légaux en brouillon ; formulaire de contact sans envoi (email non configuré) |
| Onboarding (compte, préférences, mode, extension, règles IA, checklist) | IT | IT | |
| Vue d'ensemble (CA, marge, stock, alertes, filtres temporels) | IT | IT | Calculs depuis les données, aucun KPI aléatoire |
| Articles et stock (CRUD, photos, prix, statuts, recherche/tri/pagination, import/export CSV, lot, historique) | IT | IT | Photos : data URL (démo) / URL en base (connecté) — stockage objet signé à brancher |
| Messagerie et négociation (conversations, brouillons, suggestions IA validées, plancher/marge, statut réel, blocage connecteur) | IT (envoi simulé) | IT avec simulateur ; **IV** pour Vinted (préparation seule, envoi manuel) | Jamais « envoyé » avant confirmation du connecteur |
| CRM (fiche, historique, notes, tags, fusion) | IT | IT | Minimisation des données |
| Commandes et expédition (idempotence, transitions, marge, suivi, document) | IT (document « Démonstration ») | IT ; document réel **NI** (fourni par la plateforme) | |
| Analyses (ventes, marge, rotation, panier, filtres, export) | IT | IT | Conventions affichées |
| Automatisations (règles, horaires, limites, file, historique, pause, arrêt global, retry, doublons) | IT (exécution immédiate simulée) | IT (serveur) ; actions navigateur **IV** (remises à l'extension) | Explication serveur/navigateur dans l'interface |
| Radar (recherches, opportunités classées, observé/estimé) | SD | SD (simulateur côté serveur) | Connecteur réel **NI** (pas de source autorisée) |
| Achat assisté (budget, contrôles, simulation, doublons) | SD | SD | Achat réel **NI** et désactivé par conception |
| Paramètres (organisation, rôles, connexions, IA, abonnement/consommation, notifications, sécurité, données, statut) | IT | IT | Email de notification **NI** |
| Administration opérateur (services, files, connecteurs, IA, plans/quotas, erreurs, audit) | IT | IT | |
| Extension MV3 (popup, options, service worker, content script, jetons, diagnostic) | — | **IV** : adaptateurs sur fixtures, à valider sur vinted.fr | Build et chargement Chromium vérifiés |
| Connecteur Vinted | — | **IV** (expérimental) | Aucun envoi automatique |
| Paiement Stripe (checkout, webhooks vérifiés, idempotence) | SD | **IV** mode test (aucune clé fournie) | |
| IA Ollama (provider, file, disjoncteur, quotas, santé, diagnostic) | SD (MockAIProvider) | **IV** : HTTP simulé testé, matériel absent | Aucune latence mesurée |
| Base PostgreSQL + RLS + migrations | — | IT | Tests sur PostgreSQL 16 local |
| Worker BullMQ (ticks, rétention, radar, sync) | — | IT (tâches) ; planification BullMQ **IV** (Redis local disponible, exécution longue non observée) | |

## Commandes exécutées et résultats (session)

Voir docs/TEST-REPORT.md pour le détail. Résumé : lint ✔, typecheck ✔, tests unitaires et d'intégration ✔ (PostgreSQL 16 et Redis 7 locaux), build web/API/worker/extension ✔, Playwright desktop/tablette/mobile ✔, chargement de l'extension dans Chromium ✔.

## Limites connues

- Aucune vérification en conditions réelles de l'extension sur vinted.fr (adaptateurs sur fixtures synthétiques).
- Ollama non raccordé (matériel absent) ; aucune mesure de latence ou de capacité.
- Stripe non configuré (aucune clé) ; webhooks et checkout testés avec signatures simulées.
- Pas d'email transactionnel (invitations, réinitialisation de mot de passe, notifications).
- Stockage de fichiers privé avec URLs signées : interface prévue, non branché.
- Pas de 2FA.
- Publication Chrome Web Store non réalisée.
- Textes juridiques et tarifs : brouillons / indicatifs.

## Prochaine tâche exacte

1. Raccorder Ollama : suivre docs/OLLAMA-SETUP.md, exécuter `pnpm ai:diagnose`, mesurer p50/p95 via `/api/ai/health`, ajuster `AI_MAX_CONCURRENCY` et les quotas.
2. Valider les adaptateurs Vinted dans un navigateur réel (diagnostic de l'extension), créer `v2.ts` + fixtures si besoin, retirer le statut « expérimental » uniquement après validation.
3. Brancher un stockage objet (S3 compatible) pour les photos avec URLs signées (`packages/db` + route d'upload avec contrôle de type/taille).
4. Configurer un service d'email, puis implémenter réinitialisation de mot de passe et invitations par email.
