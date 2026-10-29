# Sauvegarde, restauration et bascule

Ce document dit ce qui est sauvegardé, où, comment c'est chiffré, combien de temps c'est gardé, comment on vérifie chaque mois qu'une restauration marche, et comment basculer sur l'ordinateur portable de secours si la machine de Marseille tombe.

Scripts : `scripts/sauvegarde/` (`backup.sh`, `restore-test.sh`, `common.sh`, `backup.env.example`, `crontab.example`). Ils sont sans dépendance au code de Selio : bash, outils PostgreSQL, `age` (ou `gpg`) et `rclone`.

> **État au 29 octobre 2026.** Les deux scripts ont été exécutés de bout en bout (et de nouveau après l'ajout de l'étape `app_cloud_after_restore()` : sauvegarde age d'une base de test de 36 tables et 798 lignes, restauration, 54 comptes Cloud mis en pause « restored », comparaison au manifeste réussie) dans le conteneur de développement, sur une base PostgreSQL 16 jetable remplie avec les données de démonstration (35 tables, 147 lignes, 3 photos factices) : sauvegarde age puis gpg, test de restauration depuis le dossier local et depuis la « copie hors machine », fichier altéré détecté, écart avec le manifeste détecté, rotation, verrou, erreurs de configuration. `rclone` était remplacé par une **doublure de test** (copie de dossiers locaux) et le mode Docker (`BACKUP_PG_DOCKER_CONTAINER`) n'a pas pu être essayé (pas de Docker dans le conteneur) : **les deux sont à vérifier sur la machine** au premier lancement. Aucune durée n'est mesurée en conditions réelles.

## En bref

- **Chaque nuit à 03:30** : base PostgreSQL et photos MinIO, chiffrées avec **age**, sommes SHA-256, copie **hors de la machine** avec rclone, rotation **30 jours**.
- **Le 1er de chaque mois** : **test de restauration** automatique dans une base temporaire, comparé à un manifeste, de préférence **sur le portable de secours** (c'est là qu'est la clé privée, et c'est une répétition de la bascule).
- **Les secrets (`.env`) ne sont pas dans la sauvegarde automatique** : procédure manuelle, ci-dessous.
- Perte de données possible en cas de sinistre : **jusqu'à 24 h** (depuis la dernière sauvegarde de la nuit).
- **Toute restauration est suivie de `select app_cloud_after_restore();`** (étape obligatoire, §7) : comptes Cloud en pause « restored », sessions effacées, tâches Cloud annulées. Rien de ce qu'un client avait arrêté ou supprimé depuis la sauvegarde ne reprend tout seul.

## 1. Quoi

| Élément | Sauvegardé ? | Comment |
|---|---|---|
| Base PostgreSQL `selio` : comptes, organisations, articles, commandes, messages, abonnements, factures, journal Cloud, **sessions Cloud chiffrées**, audit | Oui, chaque nuit | `pg_dump --format=custom` dans un **instantané** partagé avec le comptage des lignes de chaque table : le manifeste décrit exactement le contenu du dump |
| Photos (bucket MinIO `selio-photos`) | Oui, chaque nuit, si `BACKUP_MINIO_SOURCE` est réglé | Copie complète des objets avec rclone (source S3), archivée en `tar` |
| Fichiers `.env` / `/etc/selio/*.env` (clés et mots de passe), `SECRETS_ENCRYPTION_KEY` | **Non** (volontairement) | Procédure manuelle (§1.1) |
| Clé privée age, `rclone.conf` | **Non** | Procédure manuelle (§1.1) |
| Redis (files BullMQ) | Non | Ne contient pas de données métier : l'état des tâches est dans la table `jobs`, et le worker recrée ses planifications au démarrage. Redis garde déjà son fichier AOF sur la machine |
| Modèles Ollama | Non | Retéléchargeables (`ollama pull`, voir OLLAMA-SETUP.md) |
| Profils Chromium du Cloud | Non, jamais | Temporaires, supprimés après chaque action |

**Sessions Cloud et rotation.** Les sessions chiffrées font partie de la base, donc des sauvegardes. Quand un client supprime sa session ou arrête le Cloud, elle disparaît de la base tout de suite, mais **reste dans les sauvegardes jusqu'à leur rotation (30 jours)**, toujours chiffrée et lisible seulement avec `SECRETS_ENCRYPTION_KEY`. Elle n'est **jamais réutilisée** : après une restauration, `app_cloud_after_restore()` efface toutes les sessions et met tous les comptes Cloud en pause. Le texte d'accord du Cloud (version `2026-10-29.2`) le dit au client.
| Code | Non | Il est sur GitHub |

### 1.1 Procédure manuelle pour les secrets

La sauvegarde automatique ne contient aucun secret de configuration. Ainsi, quelqu'un qui volerait une sauvegarde **et** sa clé de déchiffrement n'aurait toujours pas les clés de l'API, du paiement ou du chiffrement des sessions.

1. À chaque changement d'un fichier `/etc/selio/*.env` ou `deploy/.env`, Ibrahim en fait une copie **chiffrée**, par exemple `age -r <clé publique de secours> -o selio-env-AAAA-MM-JJ.age /etc/selio/api.env`, et la range **à part** des sauvegardes : gestionnaire de mots de passe, clé USB chiffrée chez lui.
2. `SECRETS_ENCRYPTION_KEY` est en plus notée dans le gestionnaire de mots de passe. **Sans elle, les sessions Cloud et les secrets de connexion de la base restaurée sont illisibles** : les clients devraient se reconnecter dans la fenêtre sécurisée. C'est voulu.
3. La clé privée age existe en deux exemplaires, jamais sur la machine de production : sur le portable de secours (fichier en `chmod 600`) et sur papier ou clé USB dans un lieu sûr.
4. Vérification trimestrielle : ouvrir la copie des `.env` sur le portable et vérifier qu'elle est à jour.

## 2. Où

- **Sur la machine** : `BACKUP_DIR` (défaut `/var/backups/selio`, droits 0700), un dossier par sauvegarde : `selio-AAAA-MM-JJ_HHMMSSZ` (heure UTC). Idéalement sur un autre disque que celui de PostgreSQL.
- **Hors de la machine** : `BACKUP_RCLONE_REMOTE`, une destination rclone. Le choix est **à faire avec Ibrahim** : portable de secours en SFTP, disque chez un proche, stockage en France. Aucun service payant sans son accord. Tant qu'elle n'est pas réglée, la sauvegarde se termine avec le **code 3**, pour que l'oubli se voie.

Contenu d'un dossier :

| Fichier | Contenu | Chiffré |
|---|---|---|
| `db.dump.age` | PostgreSQL (format custom, compressé) | oui |
| `photos.tar.age` | objets MinIO (si configuré) | oui |
| `manifest.txt.age` | version du schéma, nombre de lignes de chaque table, nombre et poids des photos, date, machine | oui |
| `LISEZMOI.txt` | date, mode de chiffrement, début et fin des clés publiques, comment restaurer | non (aucune donnée) |
| `SHA256SUMS` | sommes SHA-256 des fichiers ci-dessus | non |

Le dossier n'apparaît qu'une fois complet (il est préparé sous un nom caché `.selio-….partial`). Une sauvegarde ratée ne laisse rien.

## 3. Chiffrement

- **age** (conseillé) : `BACKUP_AGE_RECIPIENT` contient une ou plusieurs **clés publiques** séparées par des virgules, sans espace. La machine ne peut que chiffrer : même quelqu'un qui en prend le contrôle ne peut pas relire les sauvegardes déjà copiées hors de la machine. Une clé privée collée par erreur dans `BACKUP_AGE_RECIPIENT` est refusée.

  ```bash
  # Sur le portable de secours (une fois) :
  age-keygen -o ~/.config/selio/selio-sauvegarde.key   # affiche « Public key: age1… »
  chmod 600 ~/.config/selio/selio-sauvegarde.key
  # Seconde clé, imprimée et rangée hors de la machine :
  age-keygen -o selio-sauvegarde-papier.key
  # Sur la machine : BACKUP_AGE_RECIPIENT=age1…(portable),age1…(papier)
  ```

- **gpg symétrique** (à défaut) : `BACKUP_PASSPHRASE_FILE`, fichier en `chmod 600` qui contient la phrase de passe (AES-256). Plus faible : la phrase est sur la machine, donc qui contrôle la machine peut déchiffrer les sauvegardes. Dans ce cas, garder aussi une copie de la phrase hors de la machine, sinon les sauvegardes sont perdues avec elle.
- **Jamais en clair** : le dump et l'archive des photos passent directement de l'outil au chiffrement, sans fichier intermédiaire. Les photos transitent par un dossier temporaire (0700), supprimé aussitôt.

## 4. Rotation

- Locale : les sauvegardes de plus de `BACKUP_KEEP_DAYS` jours (30) sont supprimées, mais les `BACKUP_KEEP_MIN` plus récentes (3) sont toujours gardées, même si les sauvegardes se sont arrêtées pendant des semaines.
- Hors machine : `rclone delete --min-age 30d` sur les dossiers `selio-*`, seulement après une copie du jour réussie et vérifiée (`rclone check`).
- Taille : chaque sauvegarde contient **toutes** les photos. Avec 30 jours gardés, l'espace occupé vaut environ 30 fois le volume des photos. À surveiller dès que MinIO est en service. Si le volume devient gênant, une copie incrémentale des photos est possible ; c'est une décision à prendre.

## 5. Installation sur la machine

1. **Outils** : `sudo apt-get install age rclone` (plus `postgresql-client-16` si PostgreSQL n'est pas dans Docker, et `gpg` en mode symétrique).
2. **Configuration** :

   ```bash
   sudo install -d -m 700 /etc/selio /var/backups/selio
   sudo install -m 600 scripts/sauvegarde/backup.env.example /etc/selio/backup.env
   sudoedit /etc/selio/backup.env
   ```

   - PostgreSQL dans Docker Compose (cas de `deploy/docker-compose.prod.yml`, port non publié) : `BACKUP_PG_DOCKER_CONTAINER=<nom du conteneur postgres>` (voir `docker ps`). Les outils du conteneur sont utilisés, sans mot de passe.
   - PostgreSQL installé sur la machine : `DATABASE_URL=postgres://selio@127.0.0.1:5432/selio`, avec le mot de passe dans `/root/.pgpass` (`chmod 600`) plutôt que dans l'adresse.
   - **Rôle propriétaire obligatoire** (superutilisateur ou `BYPASSRLS`), jamais `selio_app`. Les tables ont une RLS forcée : avec `selio_app`, la sauvegarde serait vide ou refusée. Le script le vérifie et s'arrête avec le code 2.
3. **rclone** (`/etc/selio/rclone.conf`, `chmod 600`) :
   - une source `selio-minio` de type `s3`, fournisseur `Minio`, adresse `http://127.0.0.1:9000`, avec une **clé MinIO en lecture seule** sur le bucket (`mc admin user add` puis une politique `readonly`), jamais le compte racine. Puis `BACKUP_MINIO_SOURCE=selio-minio:selio-photos`.
   - une destination `selio-hors-machine` (par exemple `sftp` vers le portable ou un disque chez un proche), avec des identifiants **dédiés** qui ne donnent accès qu'à ce dossier. Puis `BACKUP_RCLONE_REMOTE=selio-hors-machine:selio-sauvegardes`.
   - `mc mirror` (client MinIO) ferait le même travail que rclone pour les photos. rclone est retenu parce qu'il sert déjà à la copie hors machine : un seul outil à installer et à configurer.
4. **Premier lancement à la main**, puis vérifier le code de sortie et la copie distante :

   ```bash
   sudo /opt/selio/scripts/sauvegarde/backup.sh; echo "code $?"
   sudo rclone --config /etc/selio/rclone.conf lsf selio-hors-machine:selio-sauvegardes
   ```

5. **Planification** : recopier `scripts/sauvegarde/crontab.example` avec `sudo crontab -e` (03:30 chaque nuit). La sortie va dans le journal système (`journalctl -t selio-sauvegarde`) et dans `/var/backups/selio/backup.log`.

Codes de sortie de `backup.sh` : **0** réussite · **1** échec (rien d'incomplet n'est gardé) · **2** configuration invalide · **3** sauvegarde locale faite, mais copie hors machine absente ou en échec.

## 6. Test de restauration mensuel

`restore-test.sh` prend la dernière sauvegarde, locale ou hors machine (`--remote`), et :

1. vérifie les sommes SHA-256 ;
2. déchiffre le manifeste ;
3. vérifie que le serveur de test a un rôle superutilisateur et le rôle `selio_app` (les politiques RLS de la sauvegarde le citent) ;
4. crée la base temporaire `selio_restore_test`. Le nom doit commencer ainsi : la base de production ne peut pas être visée ;
5. déchiffre et restaure le dump (`pg_restore --no-owner --exit-on-error`), puis applique l'étape obligatoire de toute restauration, `app_cloud_after_restore()` (comptes Cloud en pause « restored », sessions effacées, tâches Cloud annulées ; les lignes sont modifiées, pas supprimées, la comparaison reste valable) ;
6. compte les lignes de **chaque table** et compare avec le manifeste, ainsi que la version du schéma (`schema_migrations`) ;
7. lit l'archive des photos et compare le nombre de fichiers ;
8. supprime la base temporaire et les fichiers déchiffrés, même en cas d'échec ;
9. écrit le résultat avec les durées (téléchargement, restauration, total) sur la sortie d'erreur, et dans `BACKUP_LOG_FILE` ou, à défaut, `restore-test.log` du dossier `BACKUP_DIR` s'il existe.

Codes de sortie : **0** réussite · **1** échec (écart, fichier abîmé, restauration impossible) · **2** configuration invalide.

**Où le lancer.** Avec age, la clé privée n'est pas sur la machine : le test tourne sur le **portable de secours**, depuis la copie hors machine. C'est aussi une répétition de la bascule (§7) : si ce test passe, le portable sait restaurer. Prérequis sur le portable : `age`, `rclone` (même destination, en lecture), `postgresql-client-16` et un PostgreSQL 16 de test. Par exemple :

```bash
docker run -d --name selio-restore-pg -p 127.0.0.1:55432:5432 -e POSTGRES_USER=selio -e POSTGRES_PASSWORD=<mot de passe local> postgres:16-alpine
psql postgres://selio@127.0.0.1:55432/postgres -c "create role selio_app nologin nobypassrls"
# ~/.config/selio/backup.env (chmod 600) :
#   RESTORE_DATABASE_URL=postgres://selio@127.0.0.1:55432/postgres   (mot de passe dans ~/.pgpass)
#   BACKUP_AGE_IDENTITY=$HOME/.config/selio/selio-sauvegarde.key
#   BACKUP_RCLONE_REMOTE=selio-hors-machine:selio-sauvegardes
~/selio/scripts/sauvegarde/restore-test.sh --env ~/.config/selio/backup.env --remote
```

Le portable n'étant pas toujours allumé, préférer `anacron` ou un minuteur systemd `Persistent=true` à cron (voir `crontab.example`). Avec gpg, le test peut tourner sur la machine elle-même le 1er du mois.

Registre des tests (à tenir à jour) :

| Date | Sauvegarde testée | Où | Tables / lignes | Photos | Téléchargement | Restauration | Résultat |
|---|---|---|---|---|---|---|---|
| à faire | | portable | | | | | |

## 7. Bascule sur l'ordinateur portable

À utiliser quand la machine de Marseille est indisponible pour longtemps : panne matérielle, disque, coupure prolongée. **C'est Ibrahim qui décide la bascule.** Le portable n'a pas la carte graphique de la machine : le service y tourne **en mode dégradé**.

### 7.1 Préparer le portable (avant tout incident)

- Docker et Docker Compose, le dépôt Selio cloné, `age`, `rclone`, `postgresql-client-16`.
- La clé privée age (§3) et l'accès en lecture à la copie hors machine.
- La dernière copie chiffrée des `.env` (§1.1).
- Le test de restauration mensuel qui passe : c'est la preuve que tout ce qui précède fonctionne.
- Baisser à l'avance la durée de cache (TTL) de l'enregistrement DNS de l'API, par exemple 300 s, pour que le changement d'adresse soit pris en compte vite.

### 7.2 Basculer

1. **S'assurer que la machine de Marseille est vraiment arrêtée**, ou au moins que son API et son worker le sont. Deux workers en même temps pourraient débiter deux fois un renouvellement d'abonnement, ou envoyer deux fois une action Cloud. Ne jamais faire tourner les deux.
2. **Récupérer la dernière sauvegarde** et la vérifier :

   ```bash
   rclone copy selio-hors-machine:selio-sauvegardes/<dernier dossier> ~/selio-restore/
   cd ~/selio-restore && sha256sum -c SHA256SUMS
   ```

3. **Variables** : déchiffrer la copie des `.env` dans `deploy/.env` (`chmod 600`). Puis, sur le portable :
   - `OLLAMA_BASE_URL` : pas d'Ollama ni de carte graphique de 16 Go sur le portable. **Laisser `AI_PROVIDER=ollama`** : l'IA répond « indisponible » et l'interface le dit. Ne jamais passer à `mock` (refusé en production, et ce serait présenter un texte simulé comme une vraie réponse). Mon IA perso, Studio et l'estimation des prix sont donc **indisponibles** pendant la bascule, et on l'annonce aux clients.
   - `CLOUD_ENABLED=false` : le portable n'a pas la même adresse IP que la machine. Vinted pourrait réagir à des connexions venues d'une nouvelle adresse, et la capacité n'est pas mesurée sur le portable. Les comptes Cloud restent en attente ; on l'annonce aussi. Toute autre décision revient à Ibrahim.
   - `SECRETS_ENCRYPTION_KEY`, clés Revolut, `PUBLIC_WEB_URL`, `CORS_ORIGINS` : **inchangés**.
4. **PostgreSQL** : démarrer la base seule, créer le rôle applicatif, restaurer :

   ```bash
   cd deploy
   docker compose -f docker-compose.prod.yml up -d postgres redis
   PG=$(docker compose -f docker-compose.prod.yml ps -q postgres)
   docker exec -i "$PG" psql -U selio -d selio -c "create role selio_app login nobypassrls"
   age -d -i ~/.config/selio/selio-sauvegarde.key ~/selio-restore/db.dump.age > /tmp/selio.dump   # fichier à supprimer ensuite
   docker cp /tmp/selio.dump "$PG":/tmp/selio.dump && rm -f /tmp/selio.dump
   docker exec "$PG" pg_restore -U selio -d selio --no-owner --exit-on-error /tmp/selio.dump
   docker exec "$PG" rm -f /tmp/selio.dump
   # ÉTAPE OBLIGATOIRE, avant de démarrer l'API et le worker : rien du Cloud ne reprend tout seul.
   docker exec "$PG" psql -U selio -d selio -v ON_ERROR_STOP=1 -c "select app_cloud_after_restore();"
   docker compose -f docker-compose.prod.yml up -d --build   # « migrate » règle le mot de passe de selio_app, puis API et worker
   ```

   **Pourquoi l'étape `app_cloud_after_restore()`.** La sauvegarde date de la nuit. Entre-temps, un client a pu arrêter le Cloud, supprimer sa session ou déconnecter son compte Vinted, et des tâches Cloud ont pu être exécutées par la machine. Restaurées telles quelles, ces lignes feraient agir de nouveau un compte que le client avait arrêté, avec une session qu'il avait supprimée, et pourraient renvoyer un message déjà envoyé. La fonction (migration 0011, exécutée par le rôle propriétaire, superutilisateur ou `BYPASSRLS` comme pour la sauvegarde) : met tous les comptes Cloud non arrêtés en **pause « restored »**, **efface toutes les sessions**, libère les verrous, ferme les fenêtres de connexion ouvertes, **annule les tâches Cloud** en file ou en cours et lève le coupe-circuit. Chaque client doit se reconnecter dans la fenêtre sécurisée puis reprendre le Cloud lui-même. Le test mensuel (§6) l'exécute aussi.

5. **Photos** (si MinIO est utilisé) : démarrer MinIO sur le portable (`docker compose up -d minio` à la racine du dépôt, avec des identifiants de production, pas ceux de développement), puis :

   ```bash
   mkdir -m 700 ~/selio-photos
   age -d -i ~/.config/selio/selio-sauvegarde.key ~/selio-restore/photos.tar.age | tar -x -C ~/selio-photos
   rclone copy ~/selio-photos selio-minio-portable:selio-photos && rm -rf ~/selio-photos
   ```

6. **Réseau** : faire pointer l'adresse publique de l'API vers le portable. Selon le choix fait pour la machine : changer l'enregistrement DNS (TTL court), ou déplacer l'extrémité du tunnel chiffré (WireGuard ou Tailscale) et Caddy sur le portable. Le site Netlify ne change pas, puisque `VITE_API_BASE_URL` garde le même nom d'hôte. Les webhooks Revolut suivent le même nom d'hôte : rien à changer chez Revolut.
7. **Vérifier** : `GET /api/health`, connexion d'un compte de test, une page de stock, journaux du worker (`docker compose logs -f worker`). `pnpm ai:diagnose` doit dire « indisponible » : c'est attendu.
8. **Prévenir les clients** : service rétabli en mode dégradé (mon IA perso et Cloud en pause), données arrêtées à la sauvegarde de la nuit précédente.

### 7.3 Revenir sur la machine

1. Arrêter l'API et le worker du portable.
2. Faire une sauvegarde sur le portable (`backup.sh` avec un `backup.env` adapté au portable), ou un `pg_dump -Fc` chiffré.
3. Restaurer sur la machine de Marseille (étapes 4 et 5 ci-dessus, **`app_cloud_after_restore()` compris**), relancer, remettre le réseau (étape 6), puis `CLOUD_ENABLED` et l'IA comme avant. Les comptes Cloud restent en pause « restored » sans session : prévenir les clients qu'ils doivent se reconnecter puis reprendre.
4. Faire un test de restauration dans la semaine.

## 8. Temps estimés — à mesurer

Aucune durée n'est mesurée sur la machine ni sur le portable. Le seul repère vient du conteneur de développement (base de démonstration de 147 lignes et 3 photos factices : moins d'une seconde par étape). Il ne dit rien de la production. À remplir après les premiers lancements réels, avec les durées écrites par les scripts dans leurs journaux :

| Mesure | Valeur | Source |
|---|---|---|
| Durée de la sauvegarde nocturne (base + photos + copie) | à mesurer | `backup.log` |
| Taille d'une sauvegarde (base / photos) | à mesurer | `backup.log` |
| Durée de la copie hors machine | à mesurer (dépend du débit montant) | `backup.log` |
| Durée du test de restauration (téléchargement / restauration) | à mesurer | `restore-test.log` |
| Durée d'une bascule complète sur le portable | à mesurer lors d'un exercice | chronomètre |
| Données perdues au pire en cas de sinistre | jusqu'à 24 h (une sauvegarde par nuit) | conception |

Pour perdre moins que 24 h, il faudrait archiver en continu les journaux de transactions de PostgreSQL (WAL, restauration à la minute). C'est **non mis en place**, à décider si besoin.

## 9. Limites connues

- rclone réel et mode Docker non essayés dans le conteneur de développement (voir l'encadré d'état) : premier lancement à surveiller sur la machine.
- Copie complète des photos chaque nuit (§4).
- Perte possible jusqu'à 24 h (§8).
- Secrets hors sauvegarde automatique : la procédure manuelle (§1.1) doit être tenue.
- Le test de restauration vérifie que **toutes les lignes** reviennent et que le schéma est le bon. Il ne démarre pas l'application sur la base restaurée : c'est l'exercice de bascule (§7) qui le fait.
- Une session Cloud supprimée reste dans les sauvegardes jusqu'à leur rotation (30 jours), chiffrée ; elle n'est jamais réutilisée (§1). Raccourcir ce délai voudrait dire garder moins de sauvegardes : décision d'Ibrahim.
- Après une restauration, tous les clients du Cloud doivent se reconnecter (§7.2) : c'est voulu.
