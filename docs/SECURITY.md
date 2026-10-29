# Sécurité

## Authentification et sessions
- Mots de passe hachés (scrypt, sel aléatoire), 10 caractères minimum.
- Sessions opaques (32 octets aléatoires) en base, cookie `HttpOnly`, `SameSite=Lax`, `Secure` obligatoire en production (`COOKIE_SECURE=true` imposé par la validation de configuration), expiration glissante 30 jours.
- Limitation de débit : globale par IP (300/min), connexion/inscription (compteur en base par IP + email), suggestions IA, envoi, création de jetons.

## Isolation multi-tenant
- Chaque requête métier ouvre une transaction `set local app.org_id = <org>` ; les tables métier ont une politique RLS **forcée** pour le rôle `selio_app` (non superuser, `NOBYPASSRLS`).
- Les contrôles d'autorisation applicatifs (`can(role, action)`) s'ajoutent à la RLS : propriétaire / administrateur / opérateur / lecture.
- Tests d'accès inter-organisations : `packages/db/src/db.test.ts` (RLS sans filtre applicatif) et `apps/api/test/api.test.ts` (404 sur ressources d'une autre organisation).

## Secrets
- Infrastructure : variables d'environnement validées au démarrage (Zod) ; `.env.example` avec placeholders uniquement ; aucun secret en Git.
- Par organisation : AES-256-GCM avec `SECRETS_ENCRYPTION_KEY` (32 octets base64, hors base) et AAD = identifiant de connexion.
- Jetons d'extension : `prefix.secret`, seul le hachage SHA-256 est stocké ; affiché une fois ; portées limitées ; expiration 90 jours ; révocation immédiate.
- Réponses API : jamais de hachage, de clé ni de secret ; `hasSecret` booléen uniquement.
- Journaux : en-têtes `cookie`, `authorization`, `x-health-token`, `set-cookie` masqués ; pas de corps de requête loggé.

## Entrées non fiables
- Validation stricte Zod sur toutes les entrées ; montants entiers ; tailles bornées.
- Messages acheteurs et contenus marketplace : nettoyage (caractères de contrôle, longueur), détection de motifs d'injection (journalisée), jamais interprétés comme instructions ; prompts IA balisés `<<<DONNÉES_NON_FIABLES>>>`.
- Sortie IA : schéma + politique (prix imposé, pas de lien/HTML, pas de fuite).
- Export CSV : neutralisation des formules (`=`, `+`, `-`, `@`).
- Interface : React échappe par défaut ; l'extension n'utilise que `textContent` dans un shadow DOM fermé.
- Fichiers : photos limitées à JPEG/PNG/WebP, 1,5 Mo, 12 par article côté application ; côté stockage, 5 Mo maximum, type et taille signés dans l'URL de téléversement (démo : data URL locale ; connecté : `/api/uploads`, voir docs/STOCKAGE.md et limites).

## En-têtes et réseau
- Netlify : CSP stricte (`script-src 'self'` plus les deux hôtes du formulaire de paiement Revolut, `frame-src` limité à ces mêmes hôtes, `frame-ancestors 'none'`), HSTS, nosniff, Referrer-Policy, Permissions-Policy. Même valeur dans `netlify.toml` et `deploy/netlify/_headers`.
- API : Helmet, CORS restreint aux origines configurées avec credentials, `frame-ancestors` via Helmet.
- Ollama n'est jamais exposé au navigateur : accès serveur → serveur via réseau privé ou passerelle authentifiée.

## Paiement (Revolut Merchant API)
- **Aucun numéro de carte ne transite par Selio** : la carte est saisie dans le formulaire Revolut Checkout (iframe et script servis par `merchant.revolut.com` ou le bac à sable), enregistrée « pour le marchand » chez Revolut. Selio ne stocke que des identifiants (`revolut_customer_id`, `payment_method_id`) et des montants ; les factures et l'interface disent « carte enregistrée » sans détail de carte.
- Le navigateur ne reçoit que le **jeton public** d'une commande (`POST /api/billing/checkout`), jamais la clé secrète ; le mode (bac à sable ou live) lui est transmis pour charger le bon widget. Le succès affiché par le formulaire n'est pas une confirmation : l'abonnement ne change qu'à la réception du **webhook** signé, et l'interface rafraîchit l'abonnement toutes les 5 s pendant une minute en le disant.
- Webhooks : corps brut, signature `Revolut-Signature` vérifiée en HMAC-SHA256 (`v1.<horodatage>.<corps>`, comparaison à temps constant, tolérance 5 minutes sur `Revolut-Request-Timestamp`, plusieurs signatures acceptées pendant une rotation du secret), idempotence par commande et événement (`payment_events`), commande inconnue ignorée, route limitée en débit, aucune session requise ni créée. Sans `REVOLUT_WEBHOOK_SECRET`, tout webhook est refusé (signalé au démarrage).
- Secrets : `REVOLUT_SECRET_KEY` (`sk_…`) et `REVOLUT_WEBHOOK_SECRET` (`wsk_…`) uniquement en variables d'environnement du serveur ; une clé qui ne commence pas par `sk_` est refusée ; les journaux du client Revolut ne contiennent ni clé, ni corps de requête, ni donnée de carte. Le mode live est refusé tant que `REVOLUT_LIVE_ALLOWED` n'est pas `true`.
- Débits à l'initiative du marchand (renouvellements, relances) : seulement avec un moyen de paiement enregistré « pour le marchand » et une commande ouverte par organisation à la fois (jamais deux débits pour une même échéance) ; après l'échéance puis J+1, J+3 et J+7 en échec, retour à l'accès de base avec conservation des données 30 jours. Toutes les actions de facturation exigent le rôle propriétaire (`billing.manage`) et sont journalisées dans l'audit sans montant de carte.

## Journal d'audit
Actions sensibles (connexion, membres, règles, jetons, connexions, exports, suppression, changements de plan par l'opérateur) dans `audit_logs`, sans contenu de message ni secret. Durées de conservation configurables par organisation ; nettoyage quotidien par le worker.

## Sauvegardes et restauration
- Sauvegarde : `pg_dump -Fc "$DATABASE_URL_OWNER" > selio-$(date +%F).dump` (quotidien, chiffré au repos, rétention 30 jours recommandée).
- Restauration : `pg_restore -d "$DATABASE_URL_OWNER" --clean --if-exists selio.dump` puis `pnpm db:migrate`.
- Test de restauration à planifier mensuellement sur une base jetable. La clé `SECRETS_ENCRYPTION_KEY` doit être sauvegardée séparément : sans elle, les secrets de connexion sont irrécupérables (par conception).

## Limites connues
- Pas de 2FA. Réinitialisation du mot de passe et invitations par email : jetons de 32 octets à usage unique dont seule l'empreinte SHA-256 est stockée (1 h / 7 jours), réponse de « mot de passe oublié » identique et à temps constant qu'un compte existe ou non, pages web qui retirent le jeton de l'adresse avant le rendu. Tant que `EMAIL_PROVIDER=noop` (défaut, signalé au démarrage en production), aucun email ne part : le service d'email reste à choisir.
- Stockage des photos : URLs signées (SigV4) vers un stockage S3 compatible sur notre machine, type et taille imposés par la signature, clés `org/<orgId>/…` vérifiées ; côté API prêt (`/api/uploads`), l'envoi depuis le navigateur reste à brancher et, sans `STORAGE_ENDPOINT`, les photos restent des URL/data URL dans la base.
- Paiement : la purge des données après `data_retention_until` (30 jours après le retour à l'accès de base) n'est pas encore une tâche du worker (suppression ou anonymisation à décider) ; le prélèvement SEPA pour l'annuel n'est pas implémenté ; changer de carte alors qu'une carte est déjà enregistrée passe par le support (l'API ne rouvre pas de formulaire dans ce cas).
