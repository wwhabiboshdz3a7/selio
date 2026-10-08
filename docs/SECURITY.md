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
- Fichiers : photos limitées à JPEG/PNG/WebP, 1,5 Mo, 12 par article (démo : data URL locale ; connecté : stockage à brancher avec URLs signées — voir limites).

## En-têtes et réseau
- Netlify : CSP stricte (`script-src 'self'`, `frame-ancestors 'none'`), HSTS, nosniff, Referrer-Policy, Permissions-Policy.
- API : Helmet, CORS restreint aux origines configurées avec credentials, `frame-ancestors` via Helmet.
- Ollama n'est jamais exposé au navigateur : accès serveur → serveur via réseau privé ou passerelle authentifiée.

## Journal d'audit
Actions sensibles (connexion, membres, règles, jetons, connexions, exports, suppression, changements de plan par l'opérateur) dans `audit_logs`, sans contenu de message ni secret. Durées de conservation configurables par organisation ; nettoyage quotidien par le worker.

## Sauvegardes et restauration
- Sauvegarde : `pg_dump -Fc "$DATABASE_URL_OWNER" > selio-$(date +%F).dump` (quotidien, chiffré au repos, rétention 30 jours recommandée).
- Restauration : `pg_restore -d "$DATABASE_URL_OWNER" --clean --if-exists selio.dump` puis `pnpm db:migrate`.
- Test de restauration à planifier mensuellement sur une base jetable. La clé `SECRETS_ENCRYPTION_KEY` doit être sauvegardée séparément : sans elle, les secrets de connexion sont irrécupérables (par conception).

## Limites connues
- Pas de 2FA ; pas de réinitialisation de mot de passe par email (service d'email non configuré) ; les invitations créent un compte avec mot de passe aléatoire à définir par l'administrateur.
- Le stockage de fichiers privé avec URLs signées est prévu (interface) mais non branché : en mode connecté les photos sont des URL/data URL dans la base, à remplacer par un stockage objet avant mise en production.
