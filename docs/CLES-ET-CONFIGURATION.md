# Selio — clés et configuration

_Version du 29 octobre 2026 · branche `claude/gracious-wright-rf41nt`_

## En bref

- **Démo sur Netlify : aucune clé.** Glissez le dossier de l'archive `livraison/selio-demo-netlify.zip` sur https://app.netlify.com/drop.
- **Mode connecté** (vrais comptes, base de données) : un serveur Linux (API + worker), PostgreSQL 16 et Redis, avec les clés des sections 2 et 3.
- **Votre IA** : la machine avec Ollama et ses trois modèles — « mon IA perso » (texte), le modèle des photos et le modèle des prix (section 4).
- Ce dont vous n'avez **pas** besoin : voir la section « Inutile ».

## 1. Site web sur Netlify (vitrine + application)

À saisir dans Netlify › Site configuration › Environment variables. Ces variables sont PUBLIQUES (embarquées dans le site) : n'y mettez jamais de secret. Pour la démonstration seule, ne mettez rien.

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `VITE_API_BASE_URL` | Facultatif (démo) / Obligatoire (mode connecté) | `URL publique de votre API Selio, ex. https://api.votre-domaine.fr` | Vide = l'application ne propose que la démonstration (aucun serveur nécessaire). |
| `VITE_SHOW_INDICATIVE_PRICING` | Facultatif | `true ou false` | Affiche les tarifs indicatifs sur la vitrine. |
| `VITE_INVOICE_ISSUER_NAME` | Recommandé | `Selio SAS` | Raison sociale imprimée sur les factures (Paramètres › Factures). Vide = « Selio ». |
| `VITE_INVOICE_ISSUER_ADDRESS` | Recommandé | `12 rue … \| 13001 Marseille \| France` | Adresse de l'émetteur, lignes séparées par « \| ». Vide = « Adresse à compléter » sur la facture, avec un avertissement avant impression. |
| `VITE_INVOICE_ISSUER_SIREN` | Recommandé | `123 456 789` | SIREN de l'émetteur. Vide = « à compléter ». |
| `VITE_INVOICE_ISSUER_VAT` | Recommandé | `FR12345678901` | Numéro de TVA intracommunautaire. Vide = « à compléter ». |
| `VITE_INVOICE_ISSUER_EMAIL` | Recommandé | `facturation@votre-domaine.fr` | Contact imprimé sur les factures. Vide = « à compléter ». |

## 2. Base de données et cache (serveur métier)

À placer dans le fichier .env du serveur (jamais dans Git ni dans Netlify). Avec deploy/docker-compose.prod.yml, PostgreSQL et Redis sont lancés pour vous : il suffit de choisir les deux mots de passe.

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `POSTGRES_PASSWORD` | Obligatoire | `mot de passe long (≥ 24 caractères)` | Mot de passe du propriétaire de la base « selio » (utilisé seulement pour les migrations). |
| `APP_DB_PASSWORD` | Obligatoire | `mot de passe long, différent du précédent` | Rôle applicatif « selio_app » (non superutilisateur) : l'isolation par organisation (RLS) s'applique à lui. |
| `DATABASE_URL` | Obligatoire (hors Docker) | `postgres://selio_app:MOT_DE_PASSE@hôte:5432/selio` | Fournie automatiquement par docker-compose. À renseigner si vous utilisez une base PostgreSQL 16 managée. |
| `REDIS_URL` | Recommandé | `redis://hôte:6379` | File de tâches (BullMQ). Sans Redis, les tâches s'exécutent dans l'API (convient pour démarrer). |
| `SECRETS_ENCRYPTION_KEY` | Obligatoire | `32 octets en base64` | Chiffre les secrets de connexion en base. Générer : node -e "console.log(require('crypto').randomBytes(32).toString('base64'))". À sauvegarder à part : sans elle, les secrets chiffrés sont perdus. |

## 3. Serveur API (réseau et sécurité)

Même fichier .env que ci-dessus (API et worker).

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `PUBLIC_WEB_URL` | Obligatoire | `https://votre-site.netlify.app` | Adresse du site web (retours de paiement, liens). |
| `CORS_ORIGINS` | Obligatoire | `https://votre-site.netlify.app` | Origines autorisées à appeler l'API avec cookies (plusieurs : séparées par des virgules). |
| `COOKIE_SECURE` | Obligatoire | `true` | Obligatoire en production (HTTPS). Le serveur refuse de démarrer sinon. |
| `TRUST_PROXY` | Recommandé | `true` | Derrière Caddy/Nginx, pour lire la vraie adresse IP (limites de débit, audit). |
| `NODE_ENV` | Obligatoire | `production` | Active les garde-fous de production (pas d'IA simulée, cookies sécurisés). |
| `OPERATOR_EMAILS` | Recommandé | `vous@domaine.fr` | Comptes ayant accès à l'administration Selio. |
| `PORT / HOST / LOG_LEVEL` | Facultatif | `8787 / 0.0.0.0 / info` | Valeurs par défaut adaptées. |

## 4. IA : mon IA perso et les deux modèles qui l'épaulent (annonces, réponses, prix)

Le navigateur n'appelle jamais l'IA : seuls l'API et le worker parlent au serveur Ollama, idéalement par réseau privé (VPN). Sans ces variables, l'IA reste simulée (démo uniquement). Trois modèles, tous sur la machine : le détail et les commandes d'installation sont dans docs/OLLAMA-SETUP.md.

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `AI_PROVIDER` | Obligatoire | `ollama` | « mock » (simulateur) est interdit en production. |
| `OLLAMA_BASE_URL` | Obligatoire | `http://10.0.0.5:11434` | Adresse (privée) du PC qui fait tourner Ollama. |
| `OLLAMA_MODEL` | Obligatoire | `nom donné à part par Ibrahim` | « Mon IA perso », la voix : réponses aux acheteurs, annonces, aide. La valeur de démarrage (qwen2.5:7b-instruct) est à remplacer par le modèle choisi. Installer : ollama pull <nom> |
| `OLLAMA_VISION_MODEL` | Recommandé | `qwen3-vl:8b` (défaut si absent) | Modèle 1, les photos : Studio lit réellement les photos, lecture des étiquettes, contrôle des photos. Laissé vide, l'annonce est rédigée à partir des indications seulement (signalé à l'écran). Installer : ollama pull qwen3-vl:8b |
| `OLLAMA_EMBED_MODEL` | Recommandé | `qwen3-embedding:0.6b` (défaut si absent) | NOUVEAU — modèle 2, les prix : vecteurs pour retrouver les ventes comparables et estimer un prix. Laissé vide, les embeddings sont désactivés (erreur explicite). Installer : ollama pull qwen3-embedding:0.6b |
| `OLLAMA_AUTH_HEADER` | Facultatif | `Bearer xxxxx` | NOUVEAU — en-tête d'autorisation si une passerelle protège Ollama. |
| `AI_HEALTH_TOKEN` | Recommandé | `jeton long (≥ 16 caractères)` | Protège l'URL de supervision /api/ai/health. |
| `ALLOW_AI_FALLBACK` | Obligatoire | `false` | En production, jamais de texte simulé présenté comme venant du modèle. |
| `AI_TIMEOUT_MS, AI_MAX_CONCURRENCY, AI_CONTEXT_LIMIT, AI_MAX_OUTPUT_TOKENS, AI_QUEUE_MAX_PENDING, AI_CIRCUIT_FAILURES, AI_CIRCUIT_COOLDOWN_MS` | Facultatif | `45000, 2, 8192, 700, 100, 3, 60000` | Réglages de performance : valeurs par défaut prudentes, à ajuster après « pnpm ai:bench » sur la machine (AI_MAX_CONCURRENCY aligné sur OLLAMA_NUM_PARALLEL). |

## 5. Paiement des abonnements (Revolut Merchant API)

Uniquement si vous facturez des abonnements. Le paiement passe par **Revolut Business** (compte marchand) : formulaire Revolut Checkout dans l'application (carte, Apple Pay, Google Pay, Revolut Pay), carte enregistrée « pour le marchand », débits de renouvellement par l'API depuis le worker, webhooks signés. **Aucun numéro de carte ne transite par Selio.** Sans `REVOLUT_SECRET_KEY`, le paiement est désactivé : l'application le dit, les essais ne sont pas débités et finissent en accès de base. Commencez toujours par le **bac à sable** (`REVOLUT_MODE=sandbox`, hôte `https://sandbox-merchant.revolut.com`).

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `REVOLUT_SECRET_KEY` | Facultatif (vide = paiement désactivé) | `sk_…` | Clé **secrète** de l'API marchand (Revolut Business › Merchant › API). Jamais la clé publique, jamais dans Netlify. Mêmes valeurs côté API et worker. |
| `REVOLUT_WEBHOOK_SECRET` | Obligatoire avec la clé | `wsk_…` | Secret de signature renvoyé par Revolut à la création du webhook (voir la procédure ci-dessous). Sans lui, les webhooks sont refusés et aucun paiement n'est confirmé. API seulement. |
| `REVOLUT_MODE` | Facultatif | `sandbox` (défaut) ou `live` | Bac à sable ou production (`https://merchant.revolut.com`). |
| `REVOLUT_LIVE_ALLOWED` | Facultatif | `false` | Garde-fou : `REVOLUT_MODE=live` est **refusé au démarrage** tant que cette variable n'est pas explicitement `true`. À passer à `true` seulement après validation complète du parcours en bac à sable. |
| `REVOLUT_API_VERSION` | Facultatif | `2026-08-17` | Valeur de l'en-tête `Revolut-Api-Version` envoyé à chaque appel. |
| `FRANCHISE_TVA` | Facultatif | `false` | `true` si Selio est en franchise en base de TVA (art. 293 B du CGI) : factures à 0 % avec la mention légale ; `false` = TVA 20 %. Même valeur côté API et worker. |

### Ouvrir le compte et brancher les webhooks, pas à pas

1. **Compte Revolut Business**, puis activer **Merchant** (compte marchand) dans l'application Revolut Business : c'est lui qui fournit les clés d'API, le bac à sable et le tableau de bord des paiements. Frais indicatifs : 1 % + 0,20 € par carte européenne, argent réglé sous 24 h sur le compte marchand ; ces frais restent à la charge de Selio et ne sont jamais refacturés au client.
2. **Bac à sable d'abord** : dans Merchant › API, créer les clés du bac à sable. Renseigner `REVOLUT_SECRET_KEY` (clé `sk_…` du bac à sable), `REVOLUT_MODE=sandbox`, `REVOLUT_LIVE_ALLOWED=false` dans le `.env` de l'API et du worker, puis redémarrer : le journal affiche « Paiement Revolut en mode bac à sable ».
3. **Créer le webhook par l'API** (une fois par environnement), depuis une machine qui a la clé, jamais depuis le navigateur. L'URL est celle de votre API publique (HTTPS) suivie de `/api/billing/webhook/revolut` :

   ```bash
   curl -X POST https://sandbox-merchant.revolut.com/api/1.0/webhooks \
     -H "Authorization: Bearer $REVOLUT_SECRET_KEY" \
     -H "Revolut-Api-Version: 2026-08-17" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://api.votre-domaine.fr/api/billing/webhook/revolut","events":["ORDER_COMPLETED","ORDER_AUTHORISED","ORDER_PAYMENT_DECLINED","ORDER_PAYMENT_FAILED","ORDER_CANCELLED"]}'
   ```

   La réponse contient `signing_secret` (`wsk_…`) : il n'est montré qu'une fois. Le copier dans `REVOLUT_WEBHOOK_SECRET` (API) et redémarrer. Chaque livraison est vérifiée (HMAC-SHA256 de `v1.<horodatage>.<corps>`, tolérance de 5 minutes, plusieurs signatures acceptées pendant une rotation) et traitée une seule fois (idempotence par commande et événement).
4. **Tester le parcours complet en bac à sable** avec les cartes de test Revolut : enregistrement de la carte pendant l'essai (autorisation de **1 €** seulement, jamais le prix de l'offre, annulée aussitôt ; la banque peut afficher la réservation quelques heures), paiement hors essai, facture `SEL-AAAA-000001` dans Paramètres › Factures, refus de carte (relances J+1, J+3, J+7 après l'échéance avec email), « Changer de carte » (même autorisation de 1 €, puis débit en retard retenté dans l'heure), résiliation et reprise. Une autorisation de vérification encaissée par erreur (clic « Capture » dans Revolut Business) n'active rien et n'émet aucune facture : elle est journalisée (`billing.unexpected_capture`) pour remboursement manuel depuis Revolut Business.
5. **Production** : créer les clés live et un second webhook (même commande, hôte `https://merchant.revolut.com`, URL de production), renseigner `REVOLUT_SECRET_KEY` (live) et le nouveau `REVOLUT_WEBHOOK_SECRET`, puis `REVOLUT_MODE=live` **et** `REVOLUT_LIVE_ALLOWED=true`. Sans les deux, l'API refuse de démarrer.
6. **Site (Netlify)** : rien de secret à saisir. La politique de sécurité du site (`netlify.toml`, `deploy/netlify/_headers`) autorise déjà le script et les iframes du formulaire Revolut (`https://merchant.revolut.com` et `https://sandbox-merchant.revolut.com`). Renseigner les mentions des factures `VITE_INVOICE_ISSUER_*` (section 1) avant la première facture réelle.

## 6. Worker (tâches planifiées)

Mêmes variables base / Redis / chiffrement / IA que l'API. Les cadences ont des valeurs par défaut.

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `CRON_AUTOMATION_TICK, CRON_JOBS_PROCESS, CRON_CONNECTOR_SYNC, CRON_RADAR, CRON_RETENTION` | Facultatif | `*/5 * * * *, * * * * *, */15 * * * *, 0 * * * *, 0 3 * * *` | Expressions cron (UTC) : automatisations, file, synchronisation, radar, rétention. |
| `CRON_BILLING_RENEW` | Facultatif | `0 * * * *` | Échéances d'abonnement, **toutes les heures** : fins d'essai (débit de l'offre retenue, ou accès de base sans carte, après relecture des cartes enregistrées chez Revolut), renouvellements à l'initiative du marchand, relances J+1 / J+3 / J+7 après un échec (calculées à l'heure de l'échéance : un passage horaire les tient le jour annoncé par email ; un passage quotidien les décalerait d'un jour), annulation des autorisations de vérification restées posées. Idempotent : rien n'est tenté hors échéance. Le worker a besoin de `REVOLUT_SECRET_KEY`, `REVOLUT_MODE`, `FRANCHISE_TVA`, `PUBLIC_WEB_URL` et des variables d'email (section 7) ; pas du secret de webhook. |

## 7. Emails transactionnels (invitations, mot de passe oublié, échec de paiement, alertes)

Même fichier .env que l'API. Sans rien, le fournisseur « noop » journalise chaque envoi (adresse masquée `i***@domaine`, jamais le contenu) et n'expédie rien : c'est le réglage de la démo et des tests. En production, « noop » est accepté mais signalé par un avertissement au démarrage : **le service d'email est à choisir avec Ibrahim** avant d'activer `smtp`. Les liens des emails pointent vers `PUBLIC_WEB_URL` (`/invitation?token=…`, `/mot-de-passe?token=…`) ; les jetons servent une fois (invitation : 7 jours, mot de passe : 1 heure) et seule leur empreinte est stockée.

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `EMAIL_PROVIDER` | Facultatif | `noop` (défaut) ou `smtp` | `noop` : journalisation seule. `smtp` : envoi réel par le serveur de `SMTP_URL`. |
| `SMTP_URL` | Obligatoire avec `smtp` | `smtp://utilisateur:motdepasse@smtp.exemple.fr:587` ou `smtps://…:465` | Serveur d'envoi (STARTTLS sur 587, TLS direct sur 465). Contient le mot de passe : jamais dans Git ni dans les journaux. |
| `EMAIL_FROM` | Recommandé | `Selio <no-reply@votre-domaine.fr>` | Expéditeur affiché. Le domaine doit être autorisé par votre service d'email (SPF / DKIM), sinon les messages partent en indésirables. |

## 8. Stockage des photos (S3 compatible, MinIO sur la machine)

Les photos ne transitent jamais par l'API : le navigateur reçoit des URLs signées (envoi et lecture, courte durée) vers un stockage compatible S3 hébergé sur notre machine — les données restent en France. En local, `docker compose up -d minio` démarre MinIO avec le bucket `selio-photos`. Sans `STORAGE_ENDPOINT`, le stockage est désactivé (les routes `/api/uploads` répondent 503, signalé au démarrage). Détails et sécurité : docs/STOCKAGE.md.

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `STORAGE_ENDPOINT` | Facultatif (vide = désactivé) | `http://127.0.0.1:9000` en local, `https://photos.votre-domaine.fr` en production | Adresse du service S3. Elle figure dans les URLs signées : le navigateur doit pouvoir la joindre (Caddy devant MinIO, CORS pour l'origine du site). |
| `STORAGE_BUCKET` | Obligatoire si endpoint | `selio-photos` | Un seul bucket ; isolation par préfixe `org/<organisation>/`. |
| `STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY` | Obligatoires si endpoint | `identifiant / secret MinIO` | Compte dédié limité au bucket (pas le compte racine). Le secret ne sert qu'à signer côté API. |
| `STORAGE_REGION` | Facultatif | `fr-mrs-1` | Région signée (MinIO accepte n'importe quelle valeur). |
| `STORAGE_FORCE_PATH_STYLE` | Facultatif | `true` | `true` pour MinIO (`endpoint/bucket/clé`) ; `false` pour un S3 « virtual-hosted ». |
| `STORAGE_PRESIGN_TTL_SECONDS` | Facultatif | `900` | Durée de vie des URLs signées (60 s à 7 jours ; viser court). |

## 9. Selio Cloud (navigateur sur la machine, quand l'ordinateur du client est éteint)

**Désactivé par défaut**, et à laisser ainsi tant que l'avocat n'a pas donné son avis (docs/PRODUCTION-CHECKLIST.md). Aucune de ces variables n'est un secret. Le Cloud ne demande **aucun mot de passe Vinted** : le client se connecte lui-même dans une fenêtre sécurisée, et seule la session du compte est gardée, chiffrée avec `SECRETS_ENCRYPTION_KEY` (section 2). Fonctionnement, règles et capacité : docs/CLOUD.md.

| Variable | Où | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|---|
| `CLOUD_ENABLED` | API et worker | Facultatif | `false` (défaut) | `true` ouvre la fenêtre de connexion (API, exige `REDIS_URL`) et les actions (worker, exige aussi `CLOUD_CHROMIUM_PATH`). `false` : réglages et journal consultables, rien ne s'exécute. |
| `CLOUD_CHROMIUM_PATH` | Worker | Obligatoire si activé | `/opt/selio/pw-browsers/chromium-<révision>/…/chrome` | Exécutable Chromium installé sur la machine. Le Cloud ne télécharge jamais de navigateur. Vide = Cloud indisponible. |
| `CLOUD_HEADLESS` | Worker | Facultatif | `true` | Navigateur sans fenêtre. |
| `CLOUD_CHROMIUM_SANDBOX` | Worker | Facultatif | `true` | Bac à sable de Chromium. **`false` est refusé en production** (le worker ne démarre pas). Au démarrage, le worker vérifie que Chromium se lance avec son bac à sable ; sinon le Cloud reste désactivé (docs/CLOUD.md §7). `false` seulement sur un poste de développement où le worker tourne en root. |
| `CLOUD_MAX_BROWSERS` | API et worker | Facultatif | `5` | Navigateurs ouverts en même temps (actions et fenêtres de connexion confondues ; les fenêtres de connexion n'en prennent jamais plus que `CLOUD_MAX_BROWSERS - 1`, et 2 au plus par organisation). Valeur prudente : la cible de 50 est une **hypothèse à mesurer** avec `pnpm cloud:bench`. |
| `CLOUD_MAX_ACCOUNTS_PER_ORG` | API et worker | Facultatif | `10` | Comptes Cloud au plus par organisation, jamais au-delà des comptes Vinted de l'offre. |
| `CLOUD_HEAVY_ACTIONS` | API et worker | Facultatif | `false` | Actions lourdes (republier, modifier en masse) sur l'adresse IP partagée. **À décider par Ibrahim** : `false` tant qu'il n'a pas tranché. |
| `CLOUD_PRO_OPTION` | API et worker | Facultatif | `false` | Cloud activable en option avec l'offre Pro (**prix à décider, rien n'est facturé**). `false` : compris dans Agence seulement. |
| `CLOUD_ACTIVE_HOURS` | API et worker | Facultatif | `8-23` | Heures actives « début-fin », dans le fuseau de chaque organisation. Aucune action la nuit. |
| `CLOUD_LOGIN_TIMEOUT_MS` | API et worker | Facultatif | `300000` | Validité de la fenêtre de connexion et de son ticket (5 minutes). |
| `CLOUD_ACTION_TIMEOUT_MS` | Worker | Facultatif | `90000` | Durée maximale d'une action, navigateur compris. |
| `CLOUD_PROFILE_DIR` | Worker | Recommandé | `/var/lib/selio-cloud` (tmpfs) | Dossiers de travail temporaires de Chromium (HOME, TMPDIR), un par action ou fenêtre, supprimés à la fin ; les cookies restent en mémoire. **Réservé à un seul worker** : tout `selio-cloud-*` restant est supprimé au démarrage, puis les dossiers abandonnés à chaque passage. Vide = `<dossier temporaire>/selio-cloud`. En mémoire vive conseillé (docs/DEPLOYMENT.md). |
| `CRON_CLOUD` | Worker | Facultatif | `* * * * *` | Passage du planificateur du Cloud (UTC) : une action au plus par compte et par passage. |
| `CLOUD_BENCH_CONTEXTS`, `CLOUD_BENCH_PARALLEL`, `CLOUD_BENCH_HOLD_MS` | `pnpm cloud:bench` | Facultatif | `5`, `1`, `3000` | Banc de capacité : navigateurs à ouvrir, ouvertures simultanées, attente avant la mesure. Pages locales seulement. |

L'état des routes de l'API, des tâches du worker et de l'espace `/cloud` est dans docs/BUILD_STATUS.md.

## 10. Sauvegarde (scripts/sauvegarde)

Fichier à part, **`/etc/selio/backup.env`** (`chmod 600`, propriétaire root), à partir de `scripts/sauvegarde/backup.env.example`. Ce ne sont pas des variables de l'API ni du worker. Procédure complète, bascule sur le portable comprise : docs/SAUVEGARDE.md.

| Variable | Statut | Exemple / format | À quoi elle sert |
|---|---|---|---|
| `BACKUP_PG_DOCKER_CONTAINER` | Une des deux | `deploy-postgres-1` | PostgreSQL dans Docker Compose (port non publié) : nom du conteneur, ses outils sont utilisés. Avec `BACKUP_PG_USER` (`selio`) et `BACKUP_PG_DB` (`selio`). |
| `DATABASE_URL` | Une des deux | `postgres://selio@127.0.0.1:5432/selio` | PostgreSQL installé sur la machine. **Rôle propriétaire** (superutilisateur ou BYPASSRLS), jamais `selio_app`. Mot de passe dans `/root/.pgpass` plutôt que dans l'adresse. |
| `BACKUP_DIR` | Facultatif | `/var/backups/selio` | Dossier local des sauvegardes (0700). |
| `BACKUP_KEEP_DAYS` / `BACKUP_KEEP_MIN` | Facultatif | `30` / `3` | Rotation (locale et hors machine), et nombre minimal de sauvegardes locales gardées. |
| `BACKUP_AGE_RECIPIENT` | Obligatoire (ou la suivante) | `age1…,age1…` (sans espace) | **Clés publiques** age. La clé privée n'est jamais sur la machine (portable de secours, papier). |
| `BACKUP_PASSPHRASE_FILE` | À défaut d'age | `/etc/selio/backup.pass` (0600) | Chiffrement gpg symétrique (AES-256). Plus faible : la phrase est sur la machine. |
| `BACKUP_MINIO_SOURCE` | Recommandé | `selio-minio:selio-photos` | Source rclone des photos (clé MinIO en lecture seule). Vide = photos non sauvegardées, signalé. |
| `BACKUP_RCLONE_REMOTE` | Obligatoire | `selio-hors-machine:selio-sauvegardes` | Copie hors machine, destination à choisir avec Ibrahim. Vide = code de sortie 3. |
| `BACKUP_RCLONE_CONFIG` | Facultatif | `/etc/selio/rclone.conf` (0600) | Configuration rclone (identifiants de MinIO et de la destination : **secrets**). |
| `BACKUP_LOG_FILE` | Facultatif | vide | Journal ; par défaut `backup.log` et `restore-test.log` dans `BACKUP_DIR`. |
| `BACKUP_PG_TIMEOUT_S` | Facultatif | `3600` | Attente maximale d'une réponse de PostgreSQL pendant le comptage des lignes. |
| `RESTORE_DATABASE_URL` | Test de restauration | `postgres://selio@127.0.0.1:55432/postgres` | Connexion d'administration au serveur **de test** (superutilisateur). |
| `RESTORE_DB_NAME` | Facultatif | `selio_restore_test` | Base temporaire ; doit commencer par `selio_restore_test` (garde-fou). |
| `BACKUP_AGE_IDENTITY` | Test de restauration (age) | `~/.config/selio/selio-sauvegarde.key` | Clé **privée** age : sur le portable de secours seulement, jamais sur la machine. |
| `RESTORE_CHECK_PHOTOS` | Facultatif | `true` | Vérifie aussi l'archive des photos. |

## Réglages faits dans l'application (pas des clés)

- **Extension navigateur** : Pas de variable : dans Selio › Comptes Vinted › « Avancé — relier l'extension Selio », créez un jeton d'extension, puis collez l'adresse de l'API et le jeton dans les options de l'extension.
- **Achat auto** : Page « Achat auto » : seuil de note (85 conseillé), plafond par jour, prix maximal par article, délai d'annulation. Désactivé par défaut.
- **Coût réel d'achat** : Page « Achat auto » : protection acheteurs = part fixe + pourcentage (par défaut 0,70 € + 5 %, modifiable).
- **Dressing intelligent** : Republication conseillée après 7 jours (réglable : 5 à 30 jours).
- **Assistant IA** : Paramètres › Assistant IA : ton, signature, validation avant envoi, quota mensuel.

## Inutile

- Aucune clé Vinted : Vinted ne propose pas d'API publique pour les vendeurs. La lecture et l'aide à la publication passent par l'extension Selio, dans votre navigateur, avec votre session. Selio Cloud ne demande pas non plus de mot de passe Vinted : le client se connecte lui-même dans la fenêtre sécurisée.
- Aucune clé OpenAI ou autre IA payante : Selio est prévu pour votre modèle personnel (Ollama).
- Aucun secret dans Netlify : seules les variables VITE_ ci-dessus, qui sont publiques (adresse de l'API, tarifs indicatifs, mentions des factures).
- Aucune autre clé de paiement : tout passe par Revolut (section 5), et seul le serveur détient la clé secrète. Le navigateur ne reçoit que le jeton public d'une commande, consommé par le formulaire Revolut.
- Aucune clé Supabase (anon / service) : la base est un PostgreSQL 16 standard (Docker sur le serveur). Vous pouvez l'héberger chez Supabase ou un autre Postgres managé : seule DATABASE_URL change.

## Mise en ligne pas à pas

### Démo seule (aucune clé)

1. Télécharger livraison/selio-demo-netlify.zip depuis la branche claude/gracious-wright-rf41nt du dépôt selio sur GitHub.
2. Le décompresser, puis glisser le DOSSIER obtenu sur https://app.netlify.com/drop (ou, pour mettre à jour un site existant : Netlify › Deploys › glisser le dossier).
3. C'est en ligne : la démo tourne dans le navigateur, données fictives.

### Site relié à GitHub (mises à jour automatiques)

1. Netlify › Add new site › Import from Git › dépôt selio › branche claude/gracious-wright-rf41nt.
2. Netlify lit netlify.toml : commande « pnpm build:web », dossier publié apps/web/dist. Rien à changer.
3. Ajouter VITE_API_BASE_URL quand l'API sera en ligne (sinon : démo seule).

### Mode connecté (vrais comptes, base de données)

1. Louer un serveur Linux (VPS) et y installer Docker.
2. Cloner le dépôt, copier apps/api/.env.example vers deploy/.env et remplir les sections 2, 3 et 4 (puis 5 pour le paiement Revolut, 7 et 8 quand le service d'email et MinIO sont choisis).
3. docker compose -f deploy/docker-compose.prod.yml up -d --build (migrations comprises, jusqu'à la 0009 : tables de paiement et de factures).
4. Mettre Caddy devant l'API (deploy/Caddyfile) pour le HTTPS, puis renseigner VITE_API_BASE_URL dans Netlify.
5. Mettre en place la sauvegarde chiffrée de la nuit et le test de restauration mensuel (section 10, docs/SAUVEGARDE.md) avant d'accueillir de vrais clients.

### Brancher mon IA perso et ses deux modèles

1. Sur la machine : installer Ollama, puis ollama pull <modèle de texte donné par Ibrahim>, ollama pull qwen3-vl:8b et ollama pull qwen3-embedding:0.6b ; régler OLLAMA_MAX_LOADED_MODELS=3 et OLLAMA_KEEP_ALIVE=30m (docs/OLLAMA-SETUP.md).
2. Renseigner AI_PROVIDER=ollama, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_VISION_MODEL, OLLAMA_EMBED_MODEL côté API et worker.
3. Lancer pnpm ai:diagnose (les trois modèles doivent être « présent »), puis pnpm ai:bench, puis vérifier Paramètres › Assistant IA (« Opérationnel »).

## Sécurité

- Ne commitez jamais de fichier `.env` (déjà ignoré par Git).
- Sauvegardez `SECRETS_ENCRYPTION_KEY` séparément de la base.
- N'exposez pas le port 11434 d'Ollama sur Internet : VPN ou passerelle authentifiée.
- En production, le serveur refuse de démarrer si `COOKIE_SECURE` n'est pas `true`, si `AI_PROVIDER=mock` ou si `ALLOW_AI_FALLBACK=true`. Il démarre mais avertit si `EMAIL_PROVIDER=noop` (aucun email envoyé) ou si `STORAGE_ENDPOINT` est vide (pas de photos).
- `SMTP_URL`, `STORAGE_SECRET_KEY`, `REVOLUT_SECRET_KEY` et `REVOLUT_WEBHOOK_SECRET` sont des secrets au même titre que `SECRETS_ENCRYPTION_KEY` : fichier `.env` du serveur seulement, jamais dans Netlify ni dans le navigateur.
- Sauvegarde : `/etc/selio/backup.env`, `rclone.conf` et le fichier de phrase de passe gpg sont des secrets (`chmod 600`). La clé **privée** age n'est jamais sur la machine. Les `.env` ne sont pas dans la sauvegarde automatique : copie chiffrée à part (docs/SAUVEGARDE.md §1.1).
- Selio Cloud : `CLOUD_ENABLED=false` tant que l'avocat n'a pas donné son avis ; `CLOUD_HEAVY_ACTIONS=false` tant qu'Ibrahim n'a pas décidé.
- `REVOLUT_MODE=live` sans `REVOLUT_LIVE_ALLOWED=true` arrête le démarrage : impossible d'encaisser de l'argent réel par inadvertance.
