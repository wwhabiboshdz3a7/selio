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
- [ ] `pnpm db:migrate` exécuté (0005 → 0012 : carte enregistrée, vue administrateur de l'usage, jetons, rattrapage des quotas des anciens abonnements, paiement Revolut avec `payment_orders` et `invoices`, compteur de factures transactionnel et réservation des webhooks, tables de Selio Cloud, tables de Selio Radar). Si la 0012 a averti « doublons actifs existants », les résoudre puis la relancer pour créer l'index d'une seule demande d'achat active par affaire.
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

## Selio Radar et Radar Auto (RADAR.md)
- [ ] **`RADAR_AUTO_ENABLED=false`** côté API **et** worker (défaut), et **`RADAR_REAL_PURCHASE=false`** (D11). `RADAR_AUTO_ORG_IDS` vide, sauf pendant un test de l'équipe (et alors uniquement ses organisations). Le journal de démarrage ne contient pas « Radar Auto OUVERT ».
- [ ] **Décision d'Ibrahim** sur Radar Auto pour les clients : tant qu'elle n'est pas prise, il n'est pas activable sur l'adresse partagée, et la mention est visible sur la page Radar Auto.
- [ ] **Avis écrit de l'avocat** sur la lecture en direct (par Selio Cloud) et sur le bot d'achat, avant toute activation pour un client ; texte de l'accord Cloud étendu à Radar (lecture des recherches, achat automatique) et `CLOUD_CONSENT_VERSION` incrémentée.
- [ ] **Clés VAPID en production** : paire générée une fois sur la machine (`npx web-push generate-vapid-keys`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` (vraie adresse de contact) identiques côté API et worker, dans le `.env` du serveur seulement (jamais dans Git ni Netlify), rangées avec la copie chiffrée des `.env` ; le démarrage dit « Notifications Web Push activées ».
- [ ] **Test de notification** réussi : « notification de test » reçue sur Android (Chrome), sur iPhone (Selio ajouté à l'écran d'accueil) et sur ordinateur ; une vraie alerte d'affaire reçue, qui ouvre la bonne page ; heures calmes respectées ; aucun pseudo, aucune note, aucune photo de vendeur dans la notification.
- [ ] Sélecteurs du catalogue et du paiement relevés sur une vraie page avec un **compte Vinted de l'équipe** (adaptateurs `v2` et fixtures si besoin) ; identifiants numériques des marques, tailles, états et catégories relevés ; paramètres de l'adresse de recherche confirmés.
- [ ] **Procédure de test de RADAR.md §10** menée sur nos propres comptes, tableaux de mesures (§7) remplis, critères d'arrêt respectés : zéro blocage avant chaque montée en charge.
- [ ] Rythmes et plafonds validés par Ibrahim : 60 s / 30 s, 10 pages par minute et par organisation, 30 pour la machine (`RADAR_MAX_PAGES_PER_MINUTE_GLOBAL`), lecture la nuit ou non ; coupe-circuit partagé avec le Cloud accepté.
- [ ] Écarts tranchés : plafond du facteur de ralentissement (×64 appliqué par le cœur, ×8 demandé), délai 3-D Secure (10 min serveur, 15 min affichées).
- [ ] `CLOUD_MAX_BROWSERS` fixé en comptant les lectures et achats de Radar (créneaux partagés, créneau gardé pendant une attente 3-D Secure).
- [ ] Purge des données des vendeurs vérifiée après une tâche de rétention (affaires écartées supprimées après 30 jours ; pseudo, note et photo effacés des autres après 30 jours).
- [ ] Achat réel : `RADAR_REAL_PURCHASE=true` seulement le temps d'un test d'achat sur un compte de l'équipe, décidé par écrit par Ibrahim, puis retour à `false`.

## Qualité
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` verts sur la branche de release.
- [ ] Revue de sécurité des dépendances (`pnpm audit`) et mise à jour des versions épinglées.
- [ ] Jeu de données de démonstration réinitialisé ; aucun compte de test en production.
- [ ] Opérateurs listés dans `OPERATOR_EMAILS` ; comptes de test supprimés.
