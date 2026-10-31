# Stockage des photos — compatible S3, sur notre machine

Les photos (articles, générateur Studio, avatars) ne transitent pas par l'API : le navigateur les envoie **directement** à un stockage objet compatible S3 avec une URL signée que l'API lui a délivrée, puis les relit avec une autre URL signée, courte. En production ce stockage est **MinIO sur la machine de Marseille** : les données restent en France, sur un disque que nous contrôlons, sans service payant. Le code ne dépend que de l'API S3 : un autre fournisseur compatible S3 se branche en changeant quatre variables.

Code : `packages/storage` (configuration, signature SigV4 écrite à la main avec `node:crypto`, politique, clés, client) et `apps/api/src/routes/uploads.ts` (routes).

## Comment ça marche

```
navigateur ──POST /api/uploads/presign {kind, contentType, size}──▶ API Selio
           ◀── {key, uploadUrl (PUT signé), headers, readUrl (GET signé), expiresAt} ──
navigateur ──PUT uploadUrl (Content-Type + Content-Length imposés) ──▶ MinIO
navigateur ──GET readUrl (≤ 15 min) ───────────────────────────────▶ MinIO
```

1. **Validation côté API** (`validateUpload`) : kind ∈ `item-photo | studio-photo | avatar`, type ∈ `image/jpeg | image/png | image/webp`, taille ≤ **5 Mo**. Sinon 400 `upload_rejected` avec `details.reason` (`kind`, `content_type`, `size`).
2. **Clé d'objet** (`objectKey`) : `org/<orgId>/<kind>/<id>.<ext>`, où `id` est un UUID généré par l'API et `ext` déduite du type MIME. **Aucun nom de fichier fourni par l'utilisateur** n'entre dans la clé ; les identifiants sont vérifiés (`[A-Za-z0-9_-]`).
3. **PUT signé** (`presignUpload`) : signature AWS SigV4 en paramètres de requête, valable `STORAGE_PRESIGN_TTL_SECONDS` (900 s par défaut). `Content-Type` et `Content-Length` font partie des en-têtes signés : le stockage refuse un fichier d'un autre type ou d'une autre taille que ce que l'API a validé. Le client doit renvoyer les `headers` reçus tels quels.
4. **GET signé** (`presignDownload`) : même durée, hôte seul signé. `GET /api/uploads/read?key=…` ne signe que les clés qui commencent par `org/<orgId de la session>/` (sinon 403, sans dire si la clé existe).
5. **Audit** : chaque demande de téléversement est journalisée (`upload.presigned`, avec `key`, `kind`, `size`, `contentType`).
6. **Aucune URL publique** : le bucket n'a aucun accès anonyme (`mc anonymous set none`), et l'API ne renvoie jamais d'URL non signée. Une URL expirée répond 403 côté stockage ; le client en redemande une.

### Routes

| Route | Entrée | Sortie | Erreurs |
|---|---|---|---|
| `GET /api/uploads/policy` | — | `{ configured, kinds, contentTypes, maxBytes }` | 401 |
| `POST /api/uploads/presign` (60/min) | `{ kind, contentType, size }` | 201 `{ key, uploadUrl, method: "PUT", headers, readUrl, expiresAt }` | 401 · 403 (rôle) · 400 `validation` / `upload_rejected` · 429 · 503 `storage_unconfigured` |
| `GET /api/uploads/read?key=…` | clé d'objet | `{ url, expiresAt }` | 401 · 403 (clé d'une autre organisation) · 503 `storage_unconfigured` |

Droits : `item-photo` et `studio-photo` demandent `items.write` (rôle opérateur et plus) ; `avatar` est ouvert à tout membre connecté. Le futur rôle « contributeur photos » (prompt 5.15) se branchera ici.

### Côté navigateur (à faire dans `apps/web`)

```ts
const presign = await api.post("/api/uploads/presign", { kind: "item-photo", contentType: file.type, size: file.size });
await fetch(presign.uploadUrl, { method: "PUT", headers: presign.headers, body: file });
// Enregistrer `presign.key` sur l'article ; afficher avec presign.readUrl, puis GET /api/uploads/read?key=… quand elle expire.
```

Les photos sont compressées côté navigateur avant l'envoi (déjà le cas pour Studio, ~300 Ko) : la limite de 5 Mo est un garde-fou, pas une cible.

## Variables à définir (API)

Toutes facultatives. **Sans `STORAGE_ENDPOINT`, le stockage est désactivé** : `loadStorageConfig(env)` renvoie `null` et les routes répondent 503 `storage_unconfigured` (cas de la démo et des tests). Dès que l'endpoint est présent, bucket et clés deviennent obligatoires : une configuration à moitié remplie arrête le démarrage avec un message explicite.

| Variable | Défaut | Rôle |
|---|---|---|
| `STORAGE_ENDPOINT` | _(vide = désactivé)_ | URL du service S3, ex. `http://127.0.0.1:9000` (MinIO local) ou l'adresse privée de la machine via le tunnel. |
| `STORAGE_REGION` | `fr-mrs-1` | Région signée. MinIO accepte n'importe quelle valeur ; on nomme la nôtre d'après la machine de Marseille. |
| `STORAGE_BUCKET` | — | Bucket des photos (`selio-photos`). Un seul bucket ; l'isolation se fait par préfixe `org/<orgId>/`. |
| `STORAGE_ACCESS_KEY` | — | Identifiant d'accès. Placeholder dans `.env.example`, vraie valeur dans le `.env` du serveur seulement. |
| `STORAGE_SECRET_KEY` | — | Secret associé. Jamais dans Git, les journaux ni le navigateur (il ne sert qu'à signer côté API). |
| `STORAGE_FORCE_PATH_STYLE` | `true` | `true` : `endpoint/bucket/clé` (MinIO). `false` : `bucket.endpoint/clé` (S3 « virtual-hosted »). |
| `STORAGE_PRESIGN_TTL_SECONDS` | `900` | Durée de vie des URLs signées (60 s à 7 jours ; viser court). |

Important : l'URL signée contient l'hôte de `STORAGE_ENDPOINT` et le navigateur l'appelle directement. L'endpoint doit donc être **joignable par le client** (en local `127.0.0.1:9000` ; en production un sous-domaine servi par Caddy devant MinIO, par exemple `https://photos.votre-domaine.fr`, avec CORS autorisant l'origine du site pour `PUT` et `GET`). Le serveur MinIO lui-même ne garde aucun port ouvert hors du reverse proxy.

## MinIO en local (développement)

`docker-compose.yml` lance MinIO avec des identifiants de développement et crée le bucket au démarrage :

```sh
docker compose up -d minio minio-init     # API S3 sur :9000, console sur :9001
```

Puis dans `apps/api/.env` :

```
STORAGE_ENDPOINT=http://127.0.0.1:9000
STORAGE_BUCKET=selio-photos
STORAGE_ACCESS_KEY=selio-minio
STORAGE_SECRET_KEY=selio-minio-secret
```

Console web : http://127.0.0.1:9001 (mêmes identifiants) pour voir les objets. Ces identifiants ne servent **qu'en local** ; en production, créer un utilisateur MinIO dédié à l'API avec une politique limitée au bucket (`s3:PutObject`, `s3:GetObject` sur `selio-photos/*`), et non le compte racine.

Vérification manuelle d'une URL signée produite par le code, sans passer par l'API :

```sh
node --input-type=module -e "
import { loadStorageConfig, StorageClient, objectKey } from '@selio/storage';
const c = new StorageClient(loadStorageConfig({ STORAGE_ENDPOINT:'http://127.0.0.1:9000', STORAGE_BUCKET:'selio-photos', STORAGE_ACCESS_KEY:'selio-minio', STORAGE_SECRET_KEY:'selio-minio-secret' }));
console.log(c.presignUpload({ key: objectKey('11111111-1111-4111-8111-111111111111','item-photo','test','png'), contentType:'image/png', contentLength: 4 }));
"
# puis : curl -X PUT -H 'Content-Type: image/png' --data-binary 'abcd' '<uploadUrl>'
```

## Câblage dans l'API (fait)

- `apps/api/src/config.ts` fusionne `storageConfigSchema` dans le schéma d'environnement : une configuration à moitié remplie (endpoint sans bucket ou sans clés) arrête le démarrage avec un message explicite ; sans `STORAGE_ENDPOINT`, `startupNotices()` signale le stockage absent (avertissement en production, information ailleurs) et l'API démarre normalement.
- `apps/api/src/server.ts` crée le client avec `createStorageClient(loadStorageConfig(env), services.now)` (passer `services.now` permet aux tests de figer l'horloge) et enregistre `uploadsRoutes` avec `{ storage }` ; sans stockage, `/api/uploads/presign` et `/api/uploads/read` répondent 503 `storage_unconfigured`.
- `apps/api/.env.example` porte les sept variables avec des placeholders, `STORAGE_ENDPOINT` vide par défaut. Le worker n'a pas besoin du stockage aujourd'hui.
- Test d'intégration dans `apps/api/test/api.test.ts` (« téléversement : 503 sans stockage, URLs signées avec un stockage configuré, type et taille contrôlés, clés par organisation ») : 503 sans configuration ; avec une seconde instance configurée sur un endpoint factice (aucune requête réseau, la signature est pure), 201 avec une `key` au préfixe de l'organisation et une `uploadUrl` portant `X-Amz-SignedHeaders=content-length;content-type;host` ; 400 pour `image/gif` et pour 6 Mo ; 403 sur `/api/uploads/read` avec la clé de l'autre organisation ou un `..` ; droits lecteur/avatar ; une ligne `upload.presigned` dans l'audit.
- Reste côté navigateur (`apps/web`) : appel `presign` → `PUT` avec les en-têtes reçus tels quels → enregistrement de la clé sur l'article, l'annonce ou le profil ; rafraîchir l'URL de lecture via `GET /api/uploads/read` quand elle expire.

## Sécurité et exploitation

- Le secret ne quitte jamais l'API ; le navigateur ne voit que des URLs signées, limitées dans le temps, à un objet, une méthode, un type et une taille.
- Les clés n'embarquent ni nom de fichier ni donnée personnelle ; l'isolation par organisation est portée par le préfixe et vérifiée à chaque lecture.
- Pas de listing de bucket exposé : l'API ne propose aucune route de liste ; les clés sont stockées sur les objets métier (article, annonce, profil).
- Sauvegarde : le volume MinIO entre dans la sauvegarde chiffrée nocturne de la machine (prompt 5.7) ; `mc mirror` vers la machine de secours convient.
- Reste à décider ou à faire : suppression des objets orphelins (tâche worker qui compare le bucket aux clés référencées), miniatures (génération côté navigateur avant l'envoi plutôt qu'un traitement serveur), quota de stockage par plan.

## Vérifier

```sh
pnpm --filter @selio/storage typecheck
pnpm --filter @selio/storage test      # vecteur officiel AWS SigV4 + politique + clés + client
pnpm --filter @selio/api typecheck
```
