# Checklist avant mise en production

## Infrastructure
- [ ] PostgreSQL 16 managé ou Docker.
- [ ] **Sauvegarde testée** (SAUVEGARDE.md) : `/etc/selio/backup.env` en 600, clé publique age sur la machine et clé privée seulement sur le portable de secours et sur papier, copie hors machine choisie avec Ibrahim (`BACKUP_RCLONE_REMOTE`), `backup.sh` lancé à la main avec le **code 0** puis planifié à 03:30 (`crontab.example`), et un **test de restauration réussi** (`restore-test.sh --remote` depuis le portable) noté dans le registre de SAUVEGARDE.md §6.
- [ ] Copie chiffrée des `.env` et de `SECRETS_ENCRYPTION_KEY` rangée à part (SAUVEGARDE.md §1.1) ; bascule sur le portable relue, et si possible répétée une fois (SAUVEGARDE.md §7).
- [ ] Rôle `selio_app` avec mot de passe fort (`APP_DB_PASSWORD`) ; l'API n'utilise jamais le rôle propriétaire.
- [ ] Redis persistant (AOF) pour le worker.
- [ ] `SECRETS_ENCRYPTION_KEY` générée, stockée hors Git et sauvegardée séparément.
- [ ] TLS devant l'API (Caddy/Nginx), `TRUST_PROXY=true`, `COOKIE_SECURE=true`, `NODE_ENV=production`.
- [ ] `CORS_ORIGINS` et `PUBLIC_WEB_URL` = domaine Netlify ; `VITE_API_BASE_URL` côté Netlify.
- [ ] Supervision : `/api/health`, `/api/ai/health` (jeton), alertes sur les journaux d'erreur.

## Produit
- [ ] Textes juridiques (mentions légales, confidentialité, conditions) complétés et validés par un conseil : ce sont des **brouillons**.
- [ ] Tarifs définitifs décidés ; `VITE_SHOW_INDICATIVE_PRICING` ajusté ; CGV rédigées.
- [ ] Service d'email choisi avec Ibrahim et branché (`EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`, SPF/DKIM) : invitations et mot de passe oublié sont prêts ; par défaut `noop`, rien ne part (avertissement au démarrage).
- [ ] Stockage objet pour les photos (MinIO sur la machine derrière Caddy, `STORAGE_*`) : routes `/api/uploads` prêtes, envoi depuis le navigateur à brancher (data URL en démo, URL en base en connecté tant que ce n'est pas fait).
- [ ] `pnpm db:migrate` exécuté (0005 → 0011 : carte enregistrée, vue administrateur de l'usage, jetons, rattrapage des quotas des anciens abonnements, paiement Revolut avec `payment_orders` et `invoices`, compteur de factures transactionnel et réservation des webhooks, tables de Selio Cloud).
- [ ] Logo vectoriel officiel fourni (`logo-principal.svg`) pour favicons nets.

## Connecteurs et IA
- [ ] Adaptateurs DOM Vinted validés sur le site réel par un humain (diagnostic de l'extension) ; statut « expérimental » retiré uniquement après validation.
- [ ] Vérification juridique de l'usage de l'extension au regard des conditions d'utilisation de la plateforme.
- [ ] Serveur Ollama installé (OLLAMA-SETUP.md), `pnpm ai:diagnose` OK, latence et capacité mesurées, `ALLOW_AI_FALLBACK=false`.
- [ ] Quotas IA par plan revus selon la capacité mesurée.

## Paiement (Revolut Merchant API)
- [ ] Compte Revolut Business avec le compte marchand (Merchant) activé ; clés du **bac à sable** d'abord (`REVOLUT_SECRET_KEY=sk_…`, `REVOLUT_MODE=sandbox`) côté API et worker.
- [ ] Webhook créé par l'API chez Revolut (`POST /api/1.0/webhooks`, URL `https://<api>/api/billing/webhook/revolut`, les 5 événements `ORDER_*`) et `signing_secret` copié dans `REVOLUT_WEBHOOK_SECRET` ; démarrage sans avertissement « webhooks refusés ».
- [ ] Parcours validé en bac à sable avec les cartes de test : carte enregistrée pendant l'essai (autorisation de 1 € annulée, rien débité), paiement hors essai, facture `SEL-AAAA-000001` imprimable, carte refusée → relances J+1 / J+3 / J+7 avec emails (worker toutes les heures), « Changer de carte » en retard de paiement puis débit retenté dans l'heure, retour à l'accès de base, résiliation en trois clics et reprise.
- [ ] Procédure convenue pour une capture inattendue d'autorisation de vérification (audit `billing.unexpected_capture`) : remboursement manuel depuis Revolut Business.
- [ ] Mentions des factures renseignées côté Netlify (`VITE_INVOICE_ISSUER_NAME`, `_ADDRESS`, `_SIREN`, `_VAT`, `_EMAIL`) et régime de TVA choisi (`FRANCHISE_TVA`) : plus aucun « à compléter » sur une facture réelle ; numérotation continue validée avec le comptable (séquence SQL par année).
- [ ] CSP du site inchangée ou mise à jour à l'identique dans `netlify.toml` et `deploy/netlify/_headers` (script et iframes Revolut autorisés) ; le formulaire s'ouvre en production.
- [ ] Passage en live : clés live, second webhook sur `https://merchant.revolut.com`, puis `REVOLUT_MODE=live` **et** `REVOLUT_LIVE_ALLOWED=true`. Sans les deux, l'API et le worker refusent de démarrer : c'est voulu.
- [ ] Emails d'échec de paiement réels (`EMAIL_PROVIDER=smtp`) : en `noop`, les relances sont faites mais aucun email ne part.
- [ ] Décidé avec Ibrahim : purge ou anonymisation des données 30 jours après le retour à l'accès de base (tâche à écrire) ; prélèvement SEPA pour l'annuel (plus tard).

## Selio Cloud (CLOUD.md)
- [ ] `CLOUD_ENABLED=false` (défaut) côté API **et** worker tant que tout ce qui suit n'est pas coché.
- [ ] **Accord juridique écrit de l'avocat** sur le Cloud (conditions de Vinted, texte d'accord `CLOUD_CONSENT_TEXT`, conditions de vente) **avant toute activation pour un client**. Si le texte d'accord change, incrémenter `CLOUD_CONSENT_VERSION`.
- [ ] `CLOUD_HEAVY_ACTIONS=false` tant qu'Ibrahim n'a pas décidé (adresse IP partagée) ; adresse fixe par client : décision en attente.
- [ ] Offres confirmées par Ibrahim : compris dans Agence ; Pro « en option, prix à décider » (`CLOUD_PRO_OPTION=false` tant que le prix n'est pas fixé, rien n'est facturé).
- [ ] Chromium de la version attendue par `playwright-core` et polices installés pour le worker, `CLOUD_CHROMIUM_PATH` réglé, dossier de travail en tmpfs (`CLOUD_PROFILE_DIR`, réservé au worker) ; image Docker du worker adaptée si option Docker (DEPLOYMENT.md, « Selio Cloud »).
- [ ] **Bac à sable de Chromium** opérationnel : worker hors root, espaces de noms utilisateur permis (profil seccomp adapté en Docker) ; au démarrage, le journal du worker dit « Cloud activé … sandbox: true » et non « Cloud désactivé : … bac à sable ». `CLOUD_CHROMIUM_SANDBOX` absent ou `true`.
- [ ] Pare-feu : connexions sortantes de Chromium vers la machine et les plages privées interdites (CLOUD.md §7).
- [ ] Arrêt du worker : `KillMode=mixed` et `TimeoutStopSec=150` (systemd) ou `stop_grace_period: 150s` (Docker) en place ; procédure de restauration avec `select app_cloud_after_restore();` connue de l'opérateur (SAUVEGARDE.md §7).
- [ ] Coupe-circuit (60 min après « trop de requêtes » ou blocage) validé par Ibrahim, et alerte de l'opérateur branchée sur le journal du worker (ligne « COUPE-CIRCUIT »).
- [ ] `CLOUD_CHROMIUM_PATH=… pnpm --filter @selio/cloud test` vert sur la machine ; `pnpm cloud:bench` lancé à 5, 10, 25 puis 50 navigateurs, tableau de CLOUD.md §4 rempli, `CLOUD_MAX_BROWSERS` et la limite de mémoire du worker fixés d'après la mesure.
- [ ] Sélecteurs propres au Cloud (bouton d'envoi, menu du membre, cookies de session, URL de connexion) validés sur un **compte Vinted de test** appartenant à l'équipe, puis reportés dans un adaptateur `v2` du connecteur ; motifs de `detectBlock` complétés avec les vrais signaux observés.
- [ ] Parcours complet vérifié avec ce compte de test : accord, fenêtre de connexion (aucune frappe dans les journaux de l'API, du worker et de Redis), réponse envoyée et confirmée dans le journal, pause manuelle, suppression de la session en un clic, arrêt.
- [ ] Politique du site (`netlify.toml`, `deploy/netlify/_headers`) avec `wss:` dans `connect-src` ; WebSocket testé à travers Caddy et le tunnel.

## Qualité
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` verts sur la branche de release.
- [ ] Revue de sécurité des dépendances (`pnpm audit`) et mise à jour des versions épinglées.
- [ ] Jeu de données de démonstration réinitialisé ; aucun compte de test en production.
- [ ] Opérateurs listés dans `OPERATOR_EMAILS` ; comptes de test supprimés.
