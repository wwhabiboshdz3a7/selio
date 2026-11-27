# Tutoriels d'activation en production

_Version du 20 novembre 2026, pour Ibrahim (et toute personne de l'équipe qui exploite le PC de production)._

Un tutoriel court par chose à activer ou à régler. Chacun dit **ce qu'il faut**, **les étapes exactes**, **comment vérifier** et **comment revenir en arrière**. Les noms de variables sont ceux de `apps/api/.env.example`, `apps/worker/.env.example` et du code (`apps/api/src/config.ts`, `apps/worker/src/config.ts`) ; leur description complète est dans [CLES-ET-CONFIGURATION.md](CLES-ET-CONFIGURATION.md).

## Avant de commencer : trois gestes qui reviennent partout

**Modifier la configuration du serveur.** Toutes les variables du serveur sont dans un seul fichier, `deploy/.env`, sur le PC, dans Ubuntu (WSL). L'API et le worker le lisent tous les deux (`env_file` de `deploy/docker-compose.prod.yml`) : une seule valeur suffit pour les deux.

```bash
cd ~/selio/deploy
nano .env                                             # modifier, enregistrer (Ctrl+O, Entrée), quitter (Ctrl+X)
docker compose -f docker-compose.prod.yml up -d       # recrée l'API et le worker avec la nouvelle configuration
docker compose -f docker-compose.prod.yml logs --tail=60 api worker
```

**Vérifier que tout répond.**

```bash
curl -s http://127.0.0.1:8787/api/health                     # sur le PC : {"ok":true,…}
curl -s https://seliovprod.netlify.app/api/health            # depuis Internet, à travers Netlify et Tailscale
```

**Ne jamais coller un secret ailleurs que dans `deploy/.env`** : ni dans Git, ni dans Netlify, ni dans un message. Après chaque changement de `deploy/.env`, refaire la copie chiffrée du fichier ([SAUVEGARDE.md](SAUVEGARDE.md) §1.1).

## Sommaire

| N° | Tutoriel | État par défaut |
|---|---|---|
| 1 | [Emails avec Gmail](#1-emails-avec-gmail) | désactivé (`noop`) |
| 2 | [Paiement simulé](#2-paiement-simulé-comprendre-et-forcer) | actif tant que Revolut n'est pas configuré |
| 3 | [Paiement Revolut en bac à sable](#3-paiement-revolut-en-bac-à-sable) | non configuré |
| 4 | [Paiement Revolut réel](#4-paiement-revolut-réel) | fermé (`REVOLUT_LIVE_ALLOWED=false`) |
| 5 | [Parrainage](#5-parrainage) | fermé (`REFERRAL_ENABLED=false`) |
| 6 | [Notifications push (clés VAPID)](#6-notifications-push-clés-vapid) | désactivées |
| 7 | [Alertes de supervision sur le téléphone](#7-alertes-de-supervision-sur-le-téléphone) | à brancher |
| 8 | [Ajouter un opérateur et qualifier un compte](#8-ajouter-un-opérateur-et-qualifier-un-compte) | — |
| 9 | [Créer une offre et un code promo](#9-créer-une-offre-et-un-code-promo) | aucune offre |
| 10 | [Photos : stockage S3 (MinIO)](#10-photos-stockage-s3-minio) | désactivé |
| 11 | [Mettre le PC à jour](#11-mettre-le-pc-à-jour) | — |
| 12 | [Sauvegardes](#12-sauvegardes) | à installer |
| 13 | [Adresse fixe Tailscale](#13-adresse-fixe-tailscale) | en place |
| 14 | [Nom de domaine](#14-nom-de-domaine) | provisoire (`seliovprod.netlify.app`) |
| 15 | [Vérifier ou changer un modèle d'IA](#15-vérifier-ou-changer-un-modèle-dia) | actif |
| 16 | [Selio Track en réel](#16-selio-track-en-réel) | fermé par défaut ; avis de l'avocat favorable (26 novembre 2026), **ouverture progressive** |
| 17 | [Selio Cloud](#17-selio-cloud) | fermé par défaut ; avis de l'avocat favorable (26 novembre 2026), **ouverture progressive** |
| 18 | [Achat automatique (Selio Bot)](#18-achat-automatique-selio-bot) | fermé par défaut ; avis de l'avocat favorable (26 novembre 2026), **ouverture progressive** (essai à blanc, organisations de `RADAR_AUTO_ORG_IDS`) |
| 19 | [Achat réel](#19-achat-réel) | fermé par défaut ; avis de l'avocat favorable (26 novembre 2026), **seulement après l'essai à blanc** |
| 20 | [Publicité](#20-publicité) | voir PUBLICITE.md |
| 21 | [Site Selio Admin séparé](#21-site-selio-admin-séparé) | à créer (deuxième projet Netlify) |
| 22 | [Bêta : le code BETA2026SELIO](#22-bêta-le-code-beta2026selio) | **actif** (créé par la migration 0024) |
| 23 | [Brancher Stripe](#23-brancher-stripe) | emplacement prêt, adaptateur à écrire (`PAYMENT_MODE=stripe` refusé au démarrage) |

---

## 1. Emails avec Gmail

Sert aux invitations, au mot de passe oublié, aux emails d'échec de paiement et aux alertes. Sans email, rien ne part (le journal le dit) et l'application propose des liens d'invitation à copier.

**Il faut** : un compte Google avec la validation en deux étapes activée.

**Étapes**
1. Compte Google › Sécurité › **Validation en deux étapes** : l'activer si ce n'est pas fait.
2. Compte Google › Sécurité › **Mots de passe des applications** : en créer un (nom : « Selio »). Google affiche 16 lettres en quatre groupes : les recopier **sans espaces**.
3. Dans `deploy/.env` (l'arobase de l'adresse s'écrit `%40` dans l'URL) :
   ```
   EMAIL_PROVIDER=smtp
   SMTP_URL=smtps://adresse%40gmail.com:MOTDEPASSEAPPLICATION@smtp.gmail.com:465
   EMAIL_FROM=Selio <adresse@gmail.com>
   ```
4. `docker compose -f docker-compose.prod.yml up -d`.

**Vérifier**
- `docker compose -f docker-compose.prod.yml logs --tail=80 api | grep -i email` : plus d'avertissement « EMAIL_PROVIDER=noop ».
- Sur la page de connexion du site, « Mot de passe oublié » avec votre adresse : l'email arrive (regarder aussi les indésirables).

**Revenir en arrière** : `EMAIL_PROVIDER=noop`, vider `SMTP_URL`, relancer. Pour couper l'accès de Selio au compte Google : supprimer le mot de passe d'application dans Compte Google › Sécurité.

**À savoir** : Gmail limite à environ 500 envois par jour. Au-delà, ou avec un nom de domaine (tutoriel 14), passer à un service d'email transactionnel avec SPF et DKIM sur le domaine de `EMAIL_FROM`.

---

## 2. Paiement simulé : comprendre et forcer

C'est le mode actuel. Le client choisit son offre dans Paramètres › Abonnement sans carte (« Paiement pas encore activé : aucune carte demandée, rien ne sera débité »), son essai de 14 jours court, et à la fin de l'essai son compte passe en accès de base « en attente du paiement ». Rien n'est jamais débité.

**Il faut** : rien.

**Étapes**
1. Mode automatique (par défaut) : `PAYMENT_MODE=auto` et `REVOLUT_SECRET_KEY` vide dans `deploy/.env` → paiement simulé.
2. Pour forcer le simulé même avec une clé Revolut (par exemple pendant une panne, ou pour une période d'essais gratuits) : `PAYMENT_MODE=simulated`, puis relancer.

**Vérifier**
- `curl -s http://127.0.0.1:8787/api/capabilities` : le paiement y est annoncé simulé.
- En tant que client : Paramètres › Abonnement affiche « Choisir cette offre » et le récapitulatif sans formulaire de carte.

**Gérer un compte « en attente du paiement »** : Selio Admin › Comptes › fiche du compte › **Prolonger l'essai** (1 à 90 jours) ou **Offrir l'accès** (tutoriel 8).

**Revenir en arrière** : `PAYMENT_MODE=auto` (Revolut redevient actif si la clé est présente), relancer. Une organisation encore en essai verra « Enregistrer ma carte » ; aucune migration manuelle n'est nécessaire.

---

## 3. Paiement Revolut en bac à sable

**Il faut** : un compte **Revolut Business** avec **Merchant** activé ; l'adresse fixe Tailscale de l'API (celle de la règle `/api/*` de `netlify.toml`).

**Étapes**
1. Application Revolut Business › Merchant › API : créer les clés du **bac à sable**.
2. Dans `deploy/.env` :
   ```
   PAYMENT_MODE=auto
   REVOLUT_SECRET_KEY=sk_…              # clé SECRÈTE du bac à sable
   REVOLUT_MODE=sandbox
   REVOLUT_LIVE_ALLOWED=false
   FRANCHISE_TVA=false                  # true si Selio est en franchise en base de TVA (à valider avec le comptable)
   ```
3. Relancer, puis lire le journal : « Paiement Revolut en mode bac à sable ».
4. Créer le webhook, une fois, depuis Ubuntu (jamais depuis le navigateur). L'adresse est celle de l'API suivie de `/api/billing/webhook/revolut` :
   ```bash
   read -s REVOLUT_SECRET_KEY            # coller la clé sk_… (rien ne s'affiche), Entrée
   curl -X POST https://sandbox-merchant.revolut.com/api/1.0/webhooks \
     -H "Authorization: Bearer $REVOLUT_SECRET_KEY" \
     -H "Revolut-Api-Version: 2026-08-17" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://<adresse>.ts.net/api/billing/webhook/revolut","events":["ORDER_COMPLETED","ORDER_AUTHORISED","ORDER_PAYMENT_DECLINED","ORDER_PAYMENT_FAILED","ORDER_CANCELLED"]}'
   unset REVOLUT_SECRET_KEY
   ```
5. La réponse contient `signing_secret` (`wsk_…`), montré une seule fois : le copier dans `REVOLUT_WEBHOOK_SECRET` de `deploy/.env`, relancer.

**Vérifier** (avec les cartes de test Revolut, sur un compte de l'équipe)
- Pendant l'essai : « Enregistrer ma carte » → autorisation de 1 €, annulée aussitôt ; la carte apparaît enregistrée.
- Paiement hors essai → facture `SEL-AAAA-000001` dans Paramètres › Factures.
- Carte refusée → relances J+1, J+3, J+7 (emails si le tutoriel 1 est fait) ; « Changer de carte » → débit retenté dans l'heure.
- Résiliation puis reprise.
- Le journal de démarrage ne dit plus « webhooks refusés ».

**Revenir en arrière** : vider `REVOLUT_SECRET_KEY` et `REVOLUT_WEBHOOK_SECRET` (ou `PAYMENT_MODE=simulated`), relancer : retour au paiement simulé (tutoriel 2).

---

## 4. Paiement Revolut réel

**Il faut** : le tutoriel 3 entièrement validé ; le régime de TVA et les mentions des factures validés avec le comptable ; les conditions de vente relues par l'avocat.

**Étapes**
1. Netlify › Site configuration › Environment variables : renseigner `VITE_INVOICE_ISSUER_NAME`, `VITE_INVOICE_ISSUER_ADDRESS` (lignes séparées par `|`), `VITE_INVOICE_ISSUER_SIREN`, `VITE_INVOICE_ISSUER_VAT`, `VITE_INVOICE_ISSUER_EMAIL` ; puis Deploys › Trigger deploy › **Clear cache and deploy site**.
2. Revolut Business › Merchant › API : créer les clés **live**.
3. Créer un second webhook, même commande qu'au tutoriel 3 mais vers `https://merchant.revolut.com/api/1.0/webhooks`, avec la clé live.
4. Dans `deploy/.env` :
   ```
   REVOLUT_SECRET_KEY=sk_…              # clé live
   REVOLUT_WEBHOOK_SECRET=wsk_…         # secret du webhook live
   REVOLUT_MODE=live
   REVOLUT_LIVE_ALLOWED=true
   ```
5. Relancer. Sans `REVOLUT_LIVE_ALLOWED=true`, l'API et le worker refusent de démarrer : c'est voulu.

**Vérifier** : un premier abonnement réel sur un compte de l'équipe (carte personnelle), facture sans aucun « à compléter », paiement visible dans Revolut Business.

**Revenir en arrière**
- En urgence : `PAYMENT_MODE=simulated`, relancer. Plus aucun formulaire de carte n'est proposé et le worker ne débite jamais en mode simulé ; les abonnements restent en base.
- Pour revenir au bac à sable : remettre les clés et le secret du bac à sable, `REVOLUT_MODE=sandbox`, `REVOLUT_LIVE_ALLOWED=false`.
- Une autorisation de vérification encaissée par erreur (audit `billing.unexpected_capture`) se rembourse à la main depuis Revolut Business.

---

## 5. Parrainage

« Un mois offert aux deux » : la marraine et la filleule reçoivent un mois au premier paiement **réellement encaissé** de la filleule.

**Il faut** : le paiement réel (tutoriel 4) : sans paiement encaissé, aucun mois n'est jamais crédité ; le texte des conditions du parrainage relu par l'avocat ; la décision d'Ibrahim (et le plafond : 12 mois offerts par marraine sur 12 mois).

**Étapes**
1. `REFERRAL_ENABLED=true` dans `deploy/.env` (l'API et le worker le lisent tous les deux, ce qui couvre aussi le premier paiement encaissé par le worker en fin d'essai).
2. Relancer.

**Vérifier**
- En tant que titulaire d'un compte client : Paramètres › **Parrainage** apparaît, avec un code de 6 caractères et le lien `/inscription?parrain=CODE`.
- Ouvrir ce lien dans une fenêtre privée : le champ du code est prérempli à l'inscription.
- Après le premier paiement de la filleule : facture à 0 € « Mois offert — parrainage » au renouvellement suivant, pour les deux.

**Revenir en arrière** : `REFERRAL_ENABLED=false`, relancer. La page disparaît, les routes `/api/referral*` répondent 404, un code saisi à l'inscription est ignoré avec un message (l'inscription n'est jamais bloquée). Fermer ne supprime rien en base.

---

## 6. Notifications push (clés VAPID)

Sert aux alertes de Selio Bot (bonnes affaires, paiement à valider), aux alertes de tendance de Track et aux alertes de supervision.

**Il faut** : rien d'autre que le PC. Aucun service payant : les notifications passent par les services gratuits des navigateurs.

**Étapes**
1. Générer la paire de clés, **une seule fois** :
   ```bash
   cd ~/selio
   pnpm --filter @selio/worker exec web-push generate-vapid-keys
   ```
2. Dans `deploy/.env` :
   ```
   VAPID_PUBLIC_KEY=<Public Key>
   VAPID_PRIVATE_KEY=<Private Key>        # secret
   VAPID_SUBJECT=mailto:<adresse de contact réelle>
   ```
3. Relancer.

**Vérifier**
- `docker compose -f docker-compose.prod.yml logs api worker | grep -i "web push"` : « Notifications Web Push activées (clés VAPID). » (API) et « Radar : notifications Web Push activées » (worker).
- Sur le téléphone : sur iPhone, ajouter d'abord Selio à l'écran d'accueil (Safari › Partager › Sur l'écran d'accueil) et l'ouvrir depuis son icône. Puis Paramètres › Notifications › **Activer les alertes sur ce téléphone** › **Envoyer une notification de test**.

**Revenir en arrière** : vider `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY`, relancer : les alertes restent en file et expirent après 12 h. Ne changer les clés qu'en cas de fuite : chaque appareil devrait se réabonner. Ranger les clés avec la copie chiffrée de `deploy/.env`.

---

## 7. Alertes de supervision sur le téléphone

Le worker vérifie chaque minute `/api/health` et `/api/ai/health` ; après 3 échecs, il prévient les opérateurs techniques (Web Push et email), puis toutes les 60 minutes, et quand tout revient.

**Il faut** : le tutoriel 6 (notifications), idéalement le tutoriel 1 (email).

**Étapes**
1. Générer un jeton : `openssl rand -hex 24`.
2. Dans `deploy/.env` :
   ```
   OPERATOR_EMAILS=<email d'Ibrahim>       # destinataires des alertes techniques
   AI_HEALTH_TOKEN=<jeton>                 # protège /api/ai/health (même valeur pour l'API et le worker)
   PUBLIC_API_URL=http://api:8787          # l'API vue depuis le conteneur du worker (nom du service Docker)
   ```
3. Relancer ; activer les notifications sur le téléphone de l'opérateur (tutoriel 6).

**Vérifier** : `docker compose -f docker-compose.prod.yml stop api`, attendre 3 à 4 minutes → alerte reçue ; `docker compose -f docker-compose.prod.yml start api` → « rétabli ». Selio Admin › Supervision montre les alertes des 7 derniers jours.

**Revenir en arrière** : vider `AI_HEALTH_TOKEN` (seule `/api/health` reste contrôlée) ou retirer l'adresse de `OPERATOR_EMAILS` (plus personne n'est prévenu, les pannes restent enregistrées).

**À savoir** : si tout le PC tombe, le worker ne peut prévenir personne. Une sonde externe gratuite sur `https://seliovprod.netlify.app/api/health`, ou `SUPERVISION_HEARTBEAT_URL`, couvre ce cas ([SUPERVISION.md](SUPERVISION.md)).

---

## 8. Ajouter un opérateur et qualifier un compte

**Il faut** : que la personne ait déjà créé son compte Selio (inscription normale).

**Étapes : donner l'accès à Selio Admin**
1. Dans `deploy/.env`, ajouter son adresse (plusieurs adresses : séparées par des virgules, sans espace) :
   - rôle **technique** (tout, santé, supervision, IA, interrupteurs) : `OPERATOR_EMAILS=ibrahim@…`
   - rôle **business** (croissance, comptes, offres commerciales, usage de Track) : `OPERATOR_BUSINESS_EMAILS=elias@…`
2. Relancer. Les listes sont relues à chaque requête : pas de réinscription, pas de SQL.
3. La personne se connecte sur le **site Selio Admin** (tutoriel 21) : elle arrive sur `/admin` avec le badge « Technique » ou « Business ». Le site public n'a plus aucune page ni aucun lien d'administration : un opérateur qui s'y connecte arrive sur son espace client, comme tout le monde.

**Étapes : qualifier un compte** (Selio Admin › Comptes, `/admin/comptes`, puis la fiche du compte)
- **Qualification et note interne** : client, bêta, partenaire, équipe Selio, test ou bloqué, et une note de 500 caractères au plus, jamais montrée au client.
- **Qualifier « Équipe Selio »** : qualification « Équipe Selio » et offre Agence offerte sans fin (pour les comptes d'Ibrahim et d'Elias).
- **Offrir l'accès** : une offre payante jusqu'à une date, sans débit (refusé sur un compte qui paie déjà par carte) ; **Retirer l'accès offert** le ramène à l'accès de base, données conservées.
- **Prolonger l'essai** : de 1 à 90 jours.
- **Bloquer le compte** : la connexion de ses membres est refusée (« Ce compte Selio est suspendu… »).
- **Ajouter à mon organisation** : fait entrer la personne dans votre organisation, avec le rôle choisi.

**Vérifier** : chaque action apparaît dans l'historique de la fiche.

**Revenir en arrière** : retirer l'adresse de `OPERATOR_EMAILS` / `OPERATOR_BUSINESS_EMAILS` et relancer ; changer la qualification depuis la fiche.

**Si `/admin` affiche « Le serveur n'est pas à jour : relancez la mise à jour »** : le site est plus récent que l'API, faire le tutoriel 11.

**Si le site Selio Admin affiche « Accès réservé à l'équipe Selio »** : l'adresse de connexion n'est ni dans `OPERATOR_EMAILS` ni dans `OPERATOR_BUSINESS_EMAILS` ; l'ajouter (étapes ci-dessus), puis « Se déconnecter » et se reconnecter.

---

## 9. Créer une offre et un code promo

**Il faut** : un compte opérateur (technique ou business).

**Étapes** (Selio Admin › **Offres**, `/admin/offres`)
1. **Nouvelle offre**.
2. **Nom affiché** (par exemple « Printemps »).
3. **Code promo** (facultatif) : 3 à 24 caractères, lettres, chiffres et tirets, par exemple `PRINTEMPS`.
4. Remise : **Pourcentage** (1 à 100 ; à 100 %, facture à 0 € sans débit) ou **Montant fixe** (retiré de chaque échéance, une fois sur l'échéance annuelle).
5. Forfaits concernés (aucun coché = tous).
6. **Durée de la remise** : un **nombre de mois** (1 à 36) ou tant que l'abonnement dure.
7. **Début** et **Fin (incluse)** (facultatifs), **Maximum d'utilisations** (vide : sans limite).
8. **Afficher dans le bandeau** si l'offre doit apparaître en haut de la vitrine et de l'application ; l'aperçu du bandeau se met à jour.
9. **Créer l'offre**.

**Vérifier**
- Le bandeau apparaît sur la vitrine (si coché).
- `https://seliovprod.netlify.app/inscription?code=PRINTEMPS` préremplit le champ « Code promo ».
- Côté client : Paramètres › Abonnement › **Ajouter un code promo** › **Appliquer** ; le prix remisé s'affiche à côté du prix normal.

**Revenir en arrière** : **Désactiver** l'offre (elle ne s'applique plus aux nouvelles organisations). Une offre jamais utilisée peut être supprimée ; une offre déjà utilisée est archivée (« Archiver l'offre »). Les organisations qui l'ont déjà appliquée gardent leur remise pour la durée prévue.

---

## 10. Photos : stockage local (recommandé) ou S3

**Stockage local, sur le PC (recommandé, 2 minutes).** Les photos sont écrites dans le volume Docker `photos`, partagé par l'API et le worker, et servies par l'API sous `/api/storage/…` avec des liens signés et datés. Aucun service en plus, rien d'autre d'ouvert sur Internet.

1. Générer une clé : `openssl rand -hex 32`.
2. `deploy/.env` : `STORAGE_ENDPOINT=` (vide), `STORAGE_LOCAL_DIR=/var/lib/selio-photos`, `STORAGE_PUBLIC_URL=https://seliovprod.netlify.app`, `STORAGE_SECRET_KEY=<la clé>`.
3. `docker compose -f docker-compose.prod.yml up -d --build api worker`.
4. **Vérifier** : dans l'application, Studio › « Choisir des photos » : la photo s'affiche, et `docker compose -f docker-compose.prod.yml exec api ls /var/lib/selio-photos/org` liste un dossier.
5. **Sauvegarde** : le volume `photos` s'ajoute aux sauvegardes (tutoriel 12) : `docker run --rm -v deploy_photos:/p -v "$PWD":/b alpine tar czf /b/photos.tgz -C /p .`

**Revenir en arrière** : vider `STORAGE_LOCAL_DIR` et relancer (l'envoi de photos répond de nouveau « indisponible », les photos déjà envoyées restent dans le volume).

### Variante : stockage S3 (MinIO)

Aujourd'hui, sans stockage, `/api/uploads` répond 503 et les photos restent des URL en base. Le stockage sert surtout à Selio Studio (préparation par clés de stockage, photos portées).

> **Procédure proposée, jamais essayée sur le PC** (MinIO est « à valider » dans [BUILD_STATUS.md](BUILD_STATUS.md)). La suivre sur un compte de l'équipe et noter le résultat.

**Il faut** : de la place sur le disque ; une adresse HTTPS joignable **par les navigateurs** (les URLs signées sont appelées directement) **et par l'API**.

**Étapes**
1. Lancer MinIO à côté des autres conteneurs, avec des identifiants longs (jamais ceux de développement) :
   ```bash
   MINIO_USER=selio-root-$(openssl rand -hex 4); MINIO_PASS=$(openssl rand -hex 24)
   echo "$MINIO_USER / $MINIO_PASS"     # à ranger dans le gestionnaire de mots de passe
   docker run -d --name selio-minio --restart unless-stopped \
     -p 127.0.0.1:9000:9000 -v selio_minio:/data \
     -e MINIO_ROOT_USER="$MINIO_USER" -e MINIO_ROOT_PASSWORD="$MINIO_PASS" \
     -e MINIO_API_CORS_ALLOW_ORIGIN=https://seliovprod.netlify.app \
     minio/minio server /data
   ```
2. Créer le bucket et un utilisateur limité à lui (jamais le compte racine pour l'API) :
   ```bash
   docker run --rm --network host -e MC_HOST_local="http://$MINIO_USER:$MINIO_PASS@127.0.0.1:9000" minio/mc \
     sh -c 'mc mb --ignore-existing local/selio-photos && mc anonymous set none local/selio-photos'
   ```
   Puis créer l'utilisateur de l'API (`mc admin user add`) avec une politique limitée à `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` sur `selio-photos/*` ([STOCKAGE.md](STOCKAGE.md)).
3. Publier MinIO en HTTPS avec Tailscale Funnel, sur un second port public (PowerShell sur Windows) : `tailscale funnel --bg --https=8443 9000`, puis `tailscale funnel status` pour lire l'adresse `https://<machine>.<réseau>.ts.net:8443`.
4. Dans `deploy/.env` :
   ```
   STORAGE_ENDPOINT=https://<machine>.<réseau>.ts.net:8443
   STORAGE_BUCKET=selio-photos
   STORAGE_ACCESS_KEY=<utilisateur de l'API>
   STORAGE_SECRET_KEY=<son secret>
   STORAGE_REGION=fr-mrs-1
   STORAGE_FORCE_PATH_STYLE=true
   STORAGE_PRESIGN_TTL_SECONDS=900
   ```
5. Relancer.

**Vérifier**
- Le journal de l'API ne signale plus « stockage absent ».
- Depuis le conteneur de l'API, l'adresse répond : `docker compose -f docker-compose.prod.yml exec api wget -qO- https://<machine>.<réseau>.ts.net:8443/minio/health/live; echo $?` (0 attendu).
- Dans Studio, préparer une annonce avec une photo : aucune erreur 503, et l'objet apparaît sous `org/<organisation>/` (`mc ls`).

**Revenir en arrière** : vider `STORAGE_ENDPOINT`, relancer (retour au 503 propre) ; `tailscale funnel --https=8443 off` ; `docker stop selio-minio`. Les objets restent dans le volume `selio_minio`.

**Ensuite** : ajouter les photos à la sauvegarde (`BACKUP_MINIO_SOURCE`, tutoriel 12).

---

## 11. Mettre le PC à jour

À faire **après chaque mise en ligne du site** sur Netlify : un site plus récent que l'API affiche « Le serveur n'est pas à jour » dans Selio Admin.

**Il faut** : une sauvegarde récente si la mise à jour contient une migration (tutoriel 12).

**Étapes**
```bash
cd ~/selio
git status                                   # aucun fichier modifié à la main : sinon, s'arrêter et regarder
git log --oneline -1                         # noter l'empreinte actuelle (pour revenir en arrière)
git pull
pnpm install --frozen-lockfile
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs --tail=60 migrate api worker
```

**Vérifier**
- `docker compose -f docker-compose.prod.yml ps` : `migrate` « exited (0) », `api`, `worker`, `postgres`, `redis` en marche.
- `curl -s http://127.0.0.1:8787/api/health` puis `https://seliovprod.netlify.app/api/health`.
- `/admin` n'affiche plus « Le serveur n'est pas à jour ».

**Revenir en arrière**
```bash
cd ~/selio
git checkout <empreinte notée avant>
cd deploy && docker compose -f docker-compose.prod.yml up -d --build
```
Les migrations sont additives : l'ancienne version fonctionne sur la base plus récente. Revenir ensuite sur la branche de production avec `git checkout <branche>` puis `git pull`. Ne jamais supprimer une migration déjà appliquée.

**Si `migrate` échoue** : lire son message dans le journal, ne rien forcer, corriger puis relancer `up -d --build` ([INSTALLATION-WINDOWS.md](INSTALLATION-WINDOWS.md) §11).

---

## 12. Sauvegardes

Chaque nuit à 03:30 : base PostgreSQL (et photos MinIO si réglé), chiffrées avec `age`, copiées hors du PC, gardées 30 jours. Procédure complète : [SAUVEGARDE.md](SAUVEGARDE.md).

**Il faut** : `age` et `rclone` dans Ubuntu ; une destination hors du PC (portable de secours en SFTP, disque chez un proche…) ; la clé privée `age` **seulement** sur le portable de secours et sur papier.

**Étapes**
1. Sur le portable de secours : `age-keygen -o ~/.config/selio/selio-sauvegarde.key` (noter la ligne « Public key: age1… ») ; une seconde clé imprimée et rangée.
2. Sur le PC (Ubuntu) :
   ```bash
   sudo apt-get install -y age rclone
   sudo install -d -m 700 /etc/selio /var/backups/selio
   sudo install -m 600 ~/selio/scripts/sauvegarde/backup.env.example /etc/selio/backup.env
   sudoedit /etc/selio/backup.env
   ```
   Renseigner au minimum : `BACKUP_PG_DOCKER_CONTAINER=deploy-postgres-1` (nom exact : `docker ps`), `BACKUP_PG_USER=selio`, `BACKUP_PG_DB=selio`, `BACKUP_AGE_RECIPIENT=age1…,age1…`, `BACKUP_RCLONE_REMOTE=selio-hors-machine:selio-sauvegardes`, `BACKUP_RCLONE_CONFIG=/etc/selio/rclone.conf` (et `BACKUP_MINIO_SOURCE` si le tutoriel 10 est fait).
3. Configurer la destination rclone dans `/etc/selio/rclone.conf` (`chmod 600`), avec des identifiants qui ne donnent accès qu'à ce dossier.
4. Premier lancement à la main :
   ```bash
   sudo ~/selio/scripts/sauvegarde/backup.sh; echo "code $?"
   sudo rclone --config /etc/selio/rclone.conf lsf selio-hors-machine:selio-sauvegardes
   ```
5. Planifier : `sudo crontab -e`, recopier la ligne de `scripts/sauvegarde/crontab.example` en remplaçant `/opt/selio` par le chemin réel du dépôt (`/home/<utilisateur>/selio`). Dans WSL, vérifier que `cron` tourne : `systemctl status cron` (ou `sudo service cron start`).

**Vérifier**
- Code de sortie **0** (1 : échec ; 2 : configuration invalide ; 3 : sauvegarde locale faite mais copie hors du PC absente).
- Le 1er du mois, test de restauration sur le portable : `restore-test.sh --remote` ([SAUVEGARDE.md](SAUVEGARDE.md) §6), résultat noté dans le registre.

**Revenir en arrière** : retirer la ligne de `sudo crontab -e`. Les sauvegardes déjà faites restent chiffrées et tournent sur 30 jours.

**Toute restauration** se termine par `select app_cloud_after_restore();` (obligatoire).

---

## 13. Adresse fixe Tailscale

Déjà en place : Netlify relaie `/api/*` vers une adresse `https://<machine>.<réseau>.ts.net` qui ne change jamais. À refaire seulement sur un nouveau PC ou après une réinstallation.

**Il faut** : un compte Tailscale gratuit ; Tailscale pour **Windows** (le service démarre avec le PC).

**Étapes**
1. Installer Tailscale pour Windows et se connecter.
2. Console Tailscale › DNS : activer **MagicDNS** et **HTTPS Certificates**.
3. PowerShell (utilisateur normal) : `tailscale funnel --bg 8787`, puis `tailscale funnel status`. Si un lien d'autorisation s'affiche, l'ouvrir, accepter, relancer la commande.
4. Mettre l'adresse dans `netlify.toml`, règle `from = "/api/*"` (`to = "https://<adresse>.ts.net/api/:splat"`), pousser sur la branche de production : Netlify redéploie.

**Vérifier** : `curl -s https://<adresse>.ts.net/api/health` puis `curl -s https://seliovprod.netlify.app/api/health` répondent `{"ok":true,…}`.

**Revenir en arrière** : `tailscale funnel --https=443 off` coupe l'accès public (le site affiche alors « Selio revient dans un instant »). L'ancien tunnel rapide Cloudflare reste décrit dans [INSTALLATION-WINDOWS.md](INSTALLATION-WINDOWS.md) §6.b.

**Dépannage d'une 502** : [INSTALLATION-WINDOWS.md](INSTALLATION-WINDOWS.md) §11 (veille du PC, Docker Desktop arrêté, configuration).

---

## 14. Nom de domaine

**Il faut** : un domaine acheté (registraire au choix) ; la décision d'Ibrahim sur le nom définitif.

**Étapes**
1. Netlify › Domain management › **Add a domain** : saisir le domaine, suivre les enregistrements DNS demandés (ou déléguer les serveurs DNS à Netlify). Le certificat HTTPS est automatique.
2. Dans `deploy/.env` : `PUBLIC_WEB_URL=https://<domaine>` et `CORS_ORIGINS=https://<domaine>` (garder aussi `https://seliovprod.netlify.app` dans `CORS_ORIGINS`, séparés par une virgule, pendant la transition). Relancer.
3. Netlify › Environment variables : `VITE_API_BASE_URL=https://<domaine>` ; redéployer (**Clear cache and deploy site**). La règle `/api/*` de `netlify.toml` ne change pas : elle vaut pour tous les domaines du site.
4. Dans le code, mettre le domaine à jour **ensemble** : `SITE_ORIGIN` (`apps/web/src/marketing/seo.ts`), `apps/web/public/sitemap.xml`, `apps/web/public/robots.txt` et `apps/web/index.html` (le test `seo.test.ts` vérifie qu'ils concordent), puis déclarer le sitemap dans la Search Console.
5. Avec le domaine : `EMAIL_FROM` sur une adresse du domaine (SPF et DKIM chez le service d'email), `VAPID_SUBJECT=mailto:contact@<domaine>`, `MINIO_API_CORS_ALLOW_ORIGIN` (tutoriel 10).
6. Revolut : si un webhook pointe vers l'adresse Netlify, le recréer ; un webhook vers l'adresse Tailscale ne change pas.

**Vérifier** : `https://<domaine>` s'ouvre, connexion et inscription fonctionnent (cookie bien posé), `https://<domaine>/api/health` répond, un email de mot de passe oublié contient des liens vers le domaine.

**Revenir en arrière** : remettre `PUBLIC_WEB_URL`, `CORS_ORIGINS` et `VITE_API_BASE_URL` sur `https://seliovprod.netlify.app`, relancer, redéployer. L'adresse Netlify d'origine reste valable.

---

## 15. Vérifier ou changer un modèle d'IA

Les trois modèles (Ministral 3 8B, Qwen3-VL 8B, Qwen3-Embedding 0.6B) tournent dans Ollama pour Windows. Détails : [OLLAMA-SETUP.md](OLLAMA-SETUP.md).

**Étapes : vérifier**
```bash
cd ~/selio
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=ministral-3:8b pnpm ai:diagnose
```
Les trois modèles doivent être « présent » (la ligne OCR peut rester « non configuré »). Dans l'application : Paramètres › Assistant IA › état « Opérationnel ».

**Étapes : changer un modèle**
1. PowerShell : `ollama pull <nouveau nom>` puis `ollama list`.
2. Dans `deploy/.env` : `OLLAMA_MODEL`, `OLLAMA_VISION_MODEL` ou `OLLAMA_EMBED_MODEL`. Relancer.
3. Relancer `pnpm ai:diagnose`, puis mesurer avec `pnpm ai:bench` et reporter les chiffres dans OLLAMA-SETUP.md.

**Revenir en arrière** : remettre l'ancien nom dans `deploy/.env` et relancer (l'ancien modèle reste dans `ollama list` tant qu'il n'est pas supprimé). Changer de modèle d'embeddings rend le cache de vecteurs inutile pour l'ancien modèle : il se reconstruit au fil des estimations.

---

## 16. Selio Track en réel

> **Avis de l'avocat : favorable (26 novembre 2026). Ouverture progressive :** Track d'abord en pause, puis par paliers de pages par minute ([DECISIONS.md](DECISIONS.md) D62). Tant que `TRACK_LIVE_ENABLED=false` (défaut), Track lit le simulateur, données marquées « démonstration ». Garde-fous inchangés. Procédure complète et à jour : [TRACK.md](TRACK.md) §7.

**Prérequis (tous obligatoires)**
1. [x] Avis de l'avocat favorable à la lecture des pages publiques du catalogue, annoncé par Ibrahim le 26 novembre 2026 et rangé dans [DECISIONS.md](DECISIONS.md) (D62).
2. [x] Accord daté d'Ibrahim dans DECISIONS.md (D62, 26 novembre 2026).
3. Adaptateur du catalogue vérifié à la main sur une vraie page publique, depuis un navigateur ordinaire de l'équipe (adaptateur `v2` si besoin).
4. `pnpm cloud:bench` passé sur le PC pour régler `CLOUD_MAX_BROWSERS`.
5. Migrations jusqu'à `0021_track_suivi.sql` appliquées, API et worker de la même version (tutoriel 11).
6. Selio Cloud prêt techniquement : Chromium dans le conteneur du worker, bac à sable vérifié (tutoriel 17, partie technique). L'image du worker embarque désormais Chromium (`deploy/Dockerfile.worker`, `CLOUD_CHROMIUM_PATH=/usr/local/bin/selio-chromium`) ; reste à vérifier le bac à sable sur le PC (tutoriel 17, étape 2).

**Étapes**
1. Vérifier hors ligne : `pnpm track:check -- --env-file deploy/.env --live --db` → aucune ligne `[MANQUE]`.
2. `deploy/.env` : `TRACK_LIVE_ENABLED=true`, `CLOUD_ENABLED=true`, `CLOUD_CHROMIUM_PATH=/usr/local/bin/selio-chromium`, `TRACK_MAX_PAGES_PER_MINUTE=2`, `TRACK_READ_INTERVAL_MINUTES=120`, `TRACK_SELLER_ANALYSIS_ENABLED=false`.
3. `/admin/track` › **Mettre Track en pause** (raison : « passage au réel »), puis relancer l'API et le worker.
4. Journal du worker : « Track : lecture en direct des pages publiques OUVERTE » ; `/admin/track` : « Interrupteur : Ouvert », « Source : En direct ».
5. **Reprendre** quand vous êtes prêt à observer.

**Vérifier** : `/admin/track` (dernières lectures « Lue », erreurs et blocages, ralentissement). **Un seul** CAPTCHA, blocage ou « trop de requêtes » la première semaine → retour en arrière.

**Revenir en arrière** : `/admin/track` › **Mettre Track en pause** (immédiat), puis `TRACK_LIVE_ENABLED=false` et relancer ; `CLOUD_ENABLED=false` coupe toute lecture en direct. Montée par paliers ensuite : 2 → 4 → 6 → 10 pages par minute, une semaine sans signal par palier.

---

## 17. Selio Cloud

> **Avis de l'avocat : favorable (26 novembre 2026). Ouverture progressive :** d'abord sur un compte Vinted de test de l'équipe, puis les clients ([DECISIONS.md](DECISIONS.md) D62). Tant que `CLOUD_ENABLED=false` (défaut), réglages et journal sont consultables et rien ne s'exécute. Garde-fous inchangés (aucun mot de passe Vinted gardé, pause au premier signal, coupe-circuit). Détails : [CLOUD.md](CLOUD.md) et [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md).

**Prérequis**
1. [x] Avis de l'avocat favorable au Cloud (26 novembre 2026, [DECISIONS.md](DECISIONS.md) D62) ; si le texte d'accord `CLOUD_CONSENT_TEXT` change, nouvelle `CLOUD_CONSENT_VERSION`.
2. Décisions d'Ibrahim : offre Pro (`CLOUD_PRO_OPTION`, prix), actions lourdes (`CLOUD_HEAVY_ACTIONS=false` tant que rien n'est décidé), coupe-circuit de 60 min.
3. [x] **Image du worker avec Chromium** : fait dans `deploy/Dockerfile.worker` (Debian, `playwright-core install --with-deps chromium`, polices, utilisateur `node` et jamais root), lien stable `CLOUD_CHROMIUM_PATH=/usr/local/bin/selio-chromium`. **Bac à sable** : profil seccomp `deploy/chromium-seccomp.json` déclaré dans `deploy/docker-compose.prod.yml` (`security_opt`), jamais `CLOUD_CHROMIUM_SANDBOX=false` ; à vérifier sur le PC (étape 2). Détails : [CLOUD.md](CLOUD.md) §7 et [DEPLOYMENT.md](DEPLOYMENT.md), partie « Selio Cloud ».
4. [x] Dossier de travail en mémoire vive : `CLOUD_PROFILE_DIR=/var/lib/selio-cloud`, monté en tmpfs par `docker-compose.prod.yml` (2 Go, propriétaire `node`, droits 0700). Reste le pare-feu des plages privées pour Chromium.
5. `CLOUD_CHROMIUM_PATH=… pnpm --filter @selio/cloud test` vert ; `pnpm cloud:bench` à 5, 10, 25, 50 navigateurs, `CLOUD_MAX_BROWSERS` fixé d'après la mesure.
6. Sélecteurs propres au Cloud validés sur un **compte Vinted de test de l'équipe** (adaptateur `v2`).

**Étapes (équipe d'abord)**
1. `deploy/.env` : `CLOUD_ENABLED=true`, `CLOUD_CHROMIUM_PATH=/usr/local/bin/selio-chromium`, `CLOUD_MAX_BROWSERS=<mesuré>`, `CLOUD_PROFILE_DIR=/var/lib/selio-cloud`, `CLOUD_ACTIVE_HOURS=8-23`. Relancer.
2. Journal du worker : « Cloud activé … sandbox: true » (et non « Cloud désactivé : … bac à sable »).
3. Sur le compte de test : espace `/cloud` › accepter l'accord › relier le compte Vinted › se connecter dans la fenêtre sécurisée › attendre une réponse envoyée et confirmée dans le journal ; essayer la pause, la suppression de la session, l'arrêt.

**Vérifier** : aucune frappe dans les journaux de l'API, du worker et de Redis ; journal `/cloud` complet ; aucune ligne « COUPE-CIRCUIT ».

**Revenir en arrière** : `CLOUD_ENABLED=false` puis relancer le worker (les tâches restent en file, celles de plus de 24 h sont écartées). Un compte : bouton Pause ou Arrêter (arrêter efface la session). Coupe-circuit levé à la main, après vérification seulement : `update cloud_runtime set suspended_until = null, reason = null;`.

### 17 bis. Plein automatique : lecture de la messagerie et réponses sans validation

Décision d'Ibrahim du 27 novembre 2026 ([DECISIONS.md](DECISIONS.md) D63) : le Cloud lit la messagerie Vinted et répond seul, sans dernier clic. Le client l'accepte dans le texte d'accord `2026-11-27.1` (tout le monde doit l'accepter de nouveau). Détails : [CLOUD.md](CLOUD.md) §1.8.

**Ouvrir (sur le PC de production)**
1. Dans `deploy/.env` :
   ```
   CLOUD_ENABLED=true
   CLOUD_PRO_OPTION=true          # les testeurs de la bêta sont en Pro (rien n'est facturé)
   CLOUD_INBOX_SYNC_MINUTES=10    # lecture toutes les 10 min (5 au moins ; 0 coupe la lecture)
   CLOUD_INBOX_MAX_CONVERSATIONS=5
   CLOUD_CHROMIUM_PATH=/usr/local/bin/selio-chromium
   CLOUD_PROFILE_DIR=/var/lib/selio-cloud
   ```
   Ne pas toucher à `RADAR_AUTO_ORG_IDS`.
2. Reconstruire et relancer l'API et le worker (le code a changé) :
   ```bash
   cd ~/selio/deploy
   docker compose -f docker-compose.prod.yml up -d --build api worker
   docker compose -f docker-compose.prod.yml logs --tail=60 worker
   ```
   La migration `0025_cloud_messagerie.sql` s'applique au démarrage. Journal attendu : « Cloud activé … sandbox: true ».
3. **D'abord sur le compte Vinted de test de l'équipe** : `/cloud` › accepter le nouvel accord › relier le compte › se connecter dans la fenêtre sécurisée. Dans Automatisations : activer « Répondre à un nouveau message » et « Négociation automatique », **« Validation avant envoi » désactivée** ; dans Réglages › IA, désactiver « Validation humaine avant envoi » pour que les réponses soient rédigées par l'IA (sinon le gabarit de la règle part).
4. Depuis un autre compte, écrire au compte de test, attendre 10 à 20 min (heures actives) : journal `/cloud` › « Lecture de la messagerie » (faite, avec des comptes), puis « Réponse à un message » (faite) ; la réponse apparaît dans Vinted.

**Où lire les diagnostics** : `docker compose -f docker-compose.prod.yml logs worker | grep -E "cloud.inbox|lecture de la messagerie"`.
- `cloud.inbox.read` : source de la liste (`api` ou `dom`), conversations listées, ouvertes, lues.
- `cloud.inbox.unrecognised` : la messagerie n'a pas été reconnue. La ligne ne contient que des comptes et des noms de structure (`testids`, `inboxLinks`, `payloads`…) : la copier telle quelle pour corriger l'adaptateur `packages/connectors/src/vinted/adapters/v1-inbox.ts`. Rien n'est envoyé tant que rien n'est lu.
- « messagerie non reconnue » dans le journal `/cloud` : même cause.

**Revenir en arrière** : `CLOUD_INBOX_SYNC_MINUTES=0` coupe la lecture (les réponses aux messages déjà connus continuent) ; `CLOUD_ENABLED=false` arrête tout le Cloud. Pour un client : « Validation avant envoi » sur la règle, ou Pause du compte.

---

## 18. Achat automatique (Selio Bot)

> **Avis de l'avocat : favorable (26 novembre 2026). Ouverture progressive :** d'abord en essai à blanc (`RADAR_REAL_PURCHASE=false`), réservé aux organisations listées dans `RADAR_AUTO_ORG_IDS` ([DECISIONS.md](DECISIONS.md) D62). Deux verrous serveur, fermés par défaut : `RADAR_AUTO_ENABLED=false` et `RADAR_REAL_PURCHASE=false`. Même ouvert, il reste réservé aux organisations de `RADAR_AUTO_ORG_IDS` (sécurité technique voulue, conservée) : pas activable pour les clients sur l'adresse partagée. Garde-fous inchangés (plafonds, arrêt au premier signal, coupe-circuit). Détails : [RADAR.md](RADAR.md) §6 et §10, [BOT.md](BOT.md).

**Prérequis**
1. Selio Cloud ouvert et validé (tutoriel 17), avec un compte Vinted **de l'équipe** rangé en **Achat**, relié au Cloud, accord accepté.
2. Notifications push en place (tutoriel 6) et au moins un téléphone abonné.
3. [x] Avis de l'avocat favorable à l'achat automatique (26 novembre 2026, D62).
   - [ ] Texte d'accord du Cloud étendu à la lecture des recherches et à l'achat automatique (nouvelle `CLOUD_CONSENT_VERSION`).
4. Lecture en direct essayée selon RADAR.md §10 (étapes 1 à 4), zéro blocage.

**Étapes (essai à blanc, sur l'organisation de l'équipe)**
1. Trouver l'identifiant de l'organisation de l'équipe :
   ```bash
   cd ~/selio/deploy
   docker compose -f docker-compose.prod.yml exec postgres psql -U selio -d selio -c "select id, name from organizations;"
   ```
2. `deploy/.env` : `RADAR_AUTO_ENABLED=true`, `RADAR_AUTO_ORG_IDS=<identifiant>`, `RADAR_REAL_PURCHASE=false`. Relancer (en production, `RADAR_AUTO_ENABLED=true` sans `RADAR_AUTO_ORG_IDS` arrête le démarrage).
3. Dans l'application, en titulaire de l'organisation de l'équipe : Selio Bot › **Achat automatique** (`/bot/achat-auto`) : activer, régler la note minimale (85 conseillé), le budget par jour, le prix maximal par article, le délai d'annulation et le compte Achat.

**Vérifier** : chaque achat s'arrête **avant** le bouton de paiement et est enregistré « simulé » ; le total relu correspond à la page ; le porte-monnaie Vinted est choisi ; l'annulation fonctionne.

**Revenir en arrière** : `RADAR_AUTO_ENABLED=false`, vider `RADAR_AUTO_ORG_IDS`, relancer (le passage `radar.auto` disparaît). Pour une organisation seulement : « Arrêter toutes les automatisations » dans Selio Manager › Automatisation.

---

## 19. Achat réel

> **Avis de l'avocat : favorable (26 novembre 2026). Ouverture progressive :** seulement après l'essai à blanc du tutoriel 18, **sur décision écrite d'Ibrahim, le temps d'un test sur un compte de l'équipe** (D11, D62). Fermé par défaut (`RADAR_REAL_PURCHASE=false`). Il faut `RADAR_AUTO_ENABLED=true` **et** `RADAR_REAL_PURCHASE=true` pour que le navigateur clique sur « Payer ».

**Prérequis** : tutoriel 18 validé en essai à blanc ; décision écrite d'Ibrahim (date, article, montant) ; un petit solde dans le porte-monnaie Vinted du compte de l'équipe (le porte-monnaie est imposé ; jamais la carte à sa place).

**Étapes** ([RADAR.md](RADAR.md) §10, étape 6)
1. Régler un prix maximal par article et un budget par jour bas, sur un article que l'équipe veut vraiment acheter.
2. `deploy/.env` : `RADAR_REAL_PURCHASE=true`, relancer.
3. Suivre le journal du worker pendant tout le test. Si la banque demande une validation 3-D Secure, la faire dans l'application bancaire puis toucher « J'ai validé » (délai : `CLOUD_3DS_TIMEOUT_MS`, 10 min par défaut).

**Vérifier** : la demande d'achat passe « Achetée » avec la référence de commande ; le prix d'achat est reporté dans Selio Manager ; le total payé ne dépasse pas le maximum.

**Revenir en arrière, aussitôt après le test** : `RADAR_REAL_PURCHASE=false` (et `RADAR_AUTO_ENABLED=false` si le test est fini), relancer. Un achat réel ne s'annule pas depuis Selio : une annulation éventuelle se fait dans Vinted. Tout résultat « effets inconnus » arrête l'achat automatique jusqu'à vérification dans Vinted.

---

## 20. Publicité

Les campagnes, les visuels et leur suivi sont décrits dans [PUBLICITE.md](PUBLICITE.md) ; les comptes, identifiants et réglages des régies sont dans la section « Publicité » de [CLES-ET-CONFIGURATION.md](CLES-ET-CONFIGURATION.md). Aucune promesse « zéro risque », « 100 % légal » ni « partenaire Vinted » dans une publicité ; la mention d'indépendance vis-à-vis de Vinted reste obligatoire ([VITRINE.md](VITRINE.md)).

---

## 21. Site Selio Admin séparé

Selio Admin ne fait plus partie du site public : `/admin` y renvoie la page 404 de la vitrine et le code de l'administration n'est pas dans ses fichiers. L'administration a **son propre site Netlify**, construit à partir du **même dépôt et du même `netlify.toml`**, avec la cible `VITE_APP_TARGET=admin` : une page de connexion « Selio Admin », puis `/admin` et ses pages ; la racine mène à `/admin`. Ce site n'a ni vitrine, ni espace client, ni application installable ; il n'est jamais indexé (`<meta name="robots" content="noindex, nofollow">`, en-tête `X-Robots-Tag: noindex, nofollow` par le fichier `_headers` écrit au build, `robots.txt` « Disallow: / », pas de sitemap).

**Il faut** : un compte Netlify (le même que le site public) et un compte opérateur (tutoriel 8).

**Étapes**
1. Netlify › **Add new project** › Import an existing project › le même dépôt GitHub, même branche. Ne rien changer aux réglages de build : `netlify.toml` les donne (commande `pnpm build:site`, dossier `apps/web/dist`).
2. Nommer le projet, par exemple `seliovprod-admin` : l'adresse sera `https://seliovprod-admin.netlify.app`.
3. Project configuration › Environment variables, ajouter :
   - `VITE_APP_TARGET` = `admin`
   - `VITE_API_BASE_URL` = l'adresse de **ce** site (ex. `https://seliovprod-admin.netlify.app`) : comme pour le site public, `/api/*` est relayé vers l'API du PC par `netlify.toml`, la session reste donc sur l'origine du site ;
   - facultatif : `VITE_PUBLIC_SITE_URL` = `https://seliovprod.netlify.app` (lien « Ouvrir le site Selio » et « Mot de passe oublié »).
4. Lancer le déploiement (Deploys › Trigger deploy).
5. Sur le PC, rien n'est obligatoire : derrière le relais, les appels sont de même origine. Pour que l'API connaisse aussi cette origine (WebSocket, appels directs), ajouter dans `deploy/.env` `ADMIN_WEB_URL=https://seliovprod-admin.netlify.app` (elle rejoint `CORS_ORIGINS`), puis relancer. `PUBLIC_WEB_URL` ne change pas (liens des emails : site public).
6. Site public : vérifier que son projet Netlify n'a **pas** `VITE_APP_TARGET=admin` (absente ou `public`).

**Vérifier**
```bash
curl -sI https://seliovprod-admin.netlify.app/ | grep -i x-robots-tag      # x-robots-tag: noindex, nofollow
curl -s https://seliovprod-admin.netlify.app/robots.txt                     # Disallow: /
curl -s https://seliovprod-admin.netlify.app/api/health                     # {"ok":true,…} à travers le relais
```
Puis se connecter sur le site Selio Admin avec un compte opérateur : arrivée sur `/admin`. Sur le site public, `https://seliovprod.netlify.app/admin` affiche « Page introuvable ».

**Revenir en arrière** : supprimer le projet Netlify d'administration (le site public n'est pas touché) et retirer `ADMIN_WEB_URL` de `deploy/.env`.

---

## 22. Bêta : le code BETA2026SELIO

Pour la bêta, les inscrits ne donnent pas de carte : ils saisissent **`BETA2026SELIO`** dans le champ « Code promo » de l'inscription (ou arrivent par `https://seliovprod.netlify.app/inscription?code=BETA2026SELIO`, qui préremplit le champ et affiche « Rejoindre la bêta Selio »). Majuscules, espaces et tirets ne comptent pas : `beta2026selio`, `BETA-2026-SELIO` et `Beta 2026 Selio` marchent aussi.

**Ce que le code donne** (rien à faire, la migration 0024 crée le code au déploiement) :
- **30 jours de Selio Pro**, sans carte. Pro est le forfait de l'essai (`TRIAL_PLAN`) : la bêta donne la même chose que l'essai, en plus long. Agence (10 comptes, équipe) reste une décision au cas par cas : **Offrir l'accès** dans la fiche du compte (tutoriel 8).
- Une **facture à 0,00 €** « Selio — accès bêta, 1 mois offert », numérotée comme les autres (SEL-AAAA-000001), visible dans Paramètres › Factures. Aucun prestataire de paiement n'est appelé.
- Le compte est qualifié **« Bêta »** dans Selio Admin (avec la note « Inscription avec le code bêta BETA2026SELIO »).
- Un écran animé **« Bienvenue dans la bêta Selio »** juste après l'inscription (et à la première connexion s'il n'a pas été vu), puis le Démarrage. Un badge « Bêta · jusqu'au JJ/MM/AAAA » reste dans le menu.
- Une seule fois par compte. Un code faux est signalé sous le champ avant la création du compte ; si la personne vide le champ, elle a l'essai normal de 14 jours.

**Avant la fin** : bandeau dans l'application à **J-7** puis à **J-1** (« ajoutez un moyen de paiement pour continuer »), et un email aux mêmes dates **seulement si l'envoi d'emails est configuré** (tutoriel 1 ; sinon, rien n'est envoyé).

**À la fin du mois** (tâche horaire du worker) :
- **sans moyen de paiement** : « accès bêta terminé ». L'application affiche un écran de blocage « Votre mois de bêta est terminé — ajoutez un moyen de paiement pour continuer » sur toutes les pages, sauf Paramètres › Abonnement, Factures, Données (export) et la déconnexion. L'API refuse les actions métier (création d'article, réponses, extension…) avec l'erreur **402 `beta_ended`**. **Les données sont conservées** (aucune purge) ;
- **avec un moyen de paiement** (forfait retenu sur la page de paiement en attendant Stripe, ou carte enregistrée) : pas de blocage, la suite habituelle (« en attente du paiement » tant que le paiement en ligne n'est pas ouvert).

La page « Ajouter un moyen de paiement » (`/app/paiement`) affiche « Paiement en cours d'ouverture — aucune carte n'est demandée pour l'instant » : le client choisit son forfait, confirme, rien n'est débité, et un compte bloqué est rouvert en accès de base en attendant l'ouverture du paiement en ligne. Aucun champ de carte n'y figure.

**Désactiver ou régler le code** (Selio Admin › **Offres**, ligne « Bêta Selio », crayon) : nom, code, **durée de l'accès** (1 à 90 jours, pour les prochaines inscriptions), **début / fin des inscriptions**, **maximum d'utilisations** (le compteur d'utilisations est dans la liste), **Code bêta actif**. Bouton **Désactiver** dans la liste : le code est refusé avec un message clair (« Ce code bêta n'est pas valable en ce moment »), l'inscription reste possible en essai normal ; les comptes déjà en bêta gardent leur mois.

**Prolonger ou débloquer un compte** (Selio Admin › **Comptes**, filtres « Bêta en cours » et « Bêta terminée (bloqué) », ou les chiffres « Bêta » du tableau de bord) : fiche du compte › **Prolonger l'essai** (1 à 90 jours : pendant la bêta, à partir de sa fin ; après, à partir d'aujourd'hui) ou **Offrir l'accès** jusqu'à une date. Le déblocage est immédiat (application et API).

**Vérifier**
```bash
curl -s -X POST http://127.0.0.1:8787/api/offers/check-signup -H 'content-type: application/json' -d '{"code":"beta-2026-selio"}'
# {"valid":true,"beta":{"days":30,"plan":"pro"},"message":"Code bêta valable : …"}
```
Puis créer un compte de test avec le code : écran de bienvenue, badge « Bêta », facture à 0,00 € dans Paramètres › Factures, compte « Bêta » dans Selio Admin.

**Revenir en arrière** : désactiver l'offre dans Selio Admin › Offres. La migration ne recrée jamais un code qui existe déjà (même désactivé, même renommé avec d'autres tirets).

---

## 23. Brancher Stripe

Aujourd'hui le paiement est **simulé** (tutoriel 2). Stripe remplacera Revolut ; l'emplacement est prêt, l'adaptateur reste à écrire **quand les clés arriveront** (il doit être testé contre le mode test de Stripe, ce qui n'est pas possible sans clés).

**Ce qui existe déjà**
- `PAYMENT_MODE=stripe` est une valeur connue, mais **l'API et le worker refusent de démarrer** avec ce message : « PAYMENT_MODE=stripe : l'adaptateur Stripe n'est pas encore installé dans cette version de Selio. Gardez PAYMENT_MODE=simulated (ou auto) en attendant ». Rien ne peut donc laisser croire que des paiements passent.
- L'interface `PaymentProvider` (`packages/connectors/src/payments/types.ts`) : client, moyen de paiement enregistré « pour le marchand », commande, débit à l'initiative du marchand, annulation, lecture d'une commande, webhook signé. Revolut l'implémente (`revolut.ts`) ; Stripe l'implémentera de la même façon.
- La page de paiement `/app/paiement` appelle déjà `POST /api/billing/checkout` : avec un prestataire réel, ce même bouton ouvrira son formulaire sécurisé.

**Quand les clés Stripe arrivent** (à faire par un développeur, compter une journée avec les tests)
1. Dans le tableau de bord Stripe, mode **Test** : récupérer la clé secrète `sk_test_…` et créer un point de terminaison de webhook vers `https://<adresse publique>/api/billing/webhook/stripe` (événements : `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `setup_intent.succeeded`) ; noter son secret `whsec_…`.
2. Écrire `packages/connectors/src/payments/stripe.ts` : une classe `StripeClient` qui implémente `PaymentProvider` (`name: "stripe"`), avec ses tests sur un `fetch` simulé comme `revolut.test.ts` (carte enregistrée en mode `setup`, débit `off_session`, signature `Stripe-Signature` vérifiée sur le corps brut).
3. `config.ts` : lire `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MODE` (`test` par défaut, `live` seulement avec `STRIPE_LIVE_ALLOWED=true`), retirer le refus de `PAYMENT_MODE=stripe` et construire `StripeClient` dans `createPaymentProvider`.
4. Base : ajouter `stripe` aux fournisseurs (`SUBSCRIPTION_PROVIDERS`) par une migration, et une route de webhook `POST /api/billing/webhook/stripe`.
5. Page `/app/paiement` : en mode Stripe, ouvrir le formulaire hébergé de Stripe (redirection) au lieu du récapitulatif simulé.
6. Essayer en mode test avec la carte de test de Stripe, de bout en bout (inscription bêta, fin du mois, paiement, déblocage, facture), puis seulement passer en `live`.

**Dans `deploy/.env`, le jour venu** : `PAYMENT_MODE=stripe`, `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…`, relancer (`docker compose up -d api worker`). Les comptes bêta qui avaient retenu un forfait sur la page de paiement recevront le lien pour enregistrer leur carte ; ceux qui sont bloqués seront débloqués à leur premier paiement.

**Revenir en arrière** : `PAYMENT_MODE=simulated`, relancer : plus aucun débit, la page de paiement redevient le récapitulatif sans carte.

---

_Développé par Ibrahim — Selio._
