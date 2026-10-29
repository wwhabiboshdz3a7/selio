#!/usr/bin/env bash
# Test de restauration de Selio, à lancer chaque mois (voir docs/SAUVEGARDE.md).
#
# Restaure la dernière sauvegarde dans une base temporaire (selio_restore_test), applique l'étape
# obligatoire de toute restauration (Selio Cloud : comptes en pause « restored », sessions effacées,
# tâches Cloud annulées — app_cloud_after_restore), compte les lignes de chaque table, compare avec le
# manifeste écrit au moment de la sauvegarde (même instantané que le dump), vérifie la version du
# schéma et l'archive des photos, puis supprime la base.
#
# Où le lancer : de préférence sur l'ordinateur portable de secours. C'est là que se trouve la clé
# privée age (jamais sur la machine de production), et c'est une répétition de la bascule. Avec le
# chiffrement gpg, il peut aussi tourner sur la machine elle-même.
#
# Codes de sortie : 0 réussite · 1 échec (écart avec le manifeste, fichier abîmé, restauration
#                   impossible) · 2 configuration invalide.
#
# Usage : restore-test.sh [--env FICHIER] [--remote] [DOSSIER_DE_SAUVEGARDE]
#   --remote  prend la dernière sauvegarde de la copie hors machine (BACKUP_RCLONE_REMOTE)
#             au lieu du dossier local BACKUP_DIR.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

# Aide : le bloc de commentaires en tête de ce fichier.
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

ENV_FILE="${BACKUP_ENV_FILE:-}"
FROM_REMOTE=0
SRC=""
while (($#)); do
  case "$1" in
    --env)
      ENV_FILE="${2:?--env attend un fichier}"
      shift 2
      ;;
    --remote)
      FROM_REMOTE=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die 2 "argument inconnu : $1 (voir --help)" ;;
    *)
      SRC="$1"
      shift
      ;;
  esac
done
if [[ -n "$ENV_FILE" ]]; then
  load_env_file "$ENV_FILE"
elif [[ -f /etc/selio/backup.env ]]; then
  load_env_file /etc/selio/backup.env
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/selio}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-selio_restore_test}"
RESTORE_CHECK_PHOTOS="${RESTORE_CHECK_PHOTOS:-true}"
if [[ -n "${BACKUP_LOG_FILE:-}" ]]; then
  LOG_FILE="$BACKUP_LOG_FILE"
elif [[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]]; then
  LOG_FILE="$BACKUP_DIR/restore-test.log"
fi

# ------------------------------------------------------------------ configuration

# Garde-fou : la base de test porte toujours ce préfixe ; la base de production n'est jamais visée.
[[ "$RESTORE_DB_NAME" =~ ^selio_restore_test[a-z0-9_]*$ ]] \
  || die 2 "RESTORE_DB_NAME doit commencer par selio_restore_test (garde-fou : jamais la base de production)"
[[ -n "${RESTORE_DATABASE_URL:-}" ]] \
  || die 2 "RESTORE_DATABASE_URL requis : connexion d'administration (superutilisateur) à la base « postgres » du serveur de test, ex. postgres://selio@127.0.0.1:5432/postgres"
require_cmd psql pg_restore createdb dropdb sha256sum tar find sort awk mktemp

STEP="démarrage"
DB_CREATED=0
START="$(date +%s)"
WORK="$(mktemp -d "${RESTORE_WORK_DIR:-${TMPDIR:-/tmp}}/selio-restore.XXXXXX")"

drop_test_db() {
  PGOPTIONS="-c client_min_messages=warning" \
    dropdb --no-password --if-exists --force --maintenance-db="$RESTORE_DATABASE_URL" "$RESTORE_DB_NAME"
}

cleanup() {
  local code=$?
  if ((DB_CREATED == 1)); then
    drop_test_db || warn "la base $RESTORE_DB_NAME n'a pas pu être supprimée : à faire à la main (dropdb)"
  fi
  rm -rf "$WORK"
  code="$(normalized_exit_code "$code")"
  if ((code != 0)); then
    err "test de restauration : ÉCHEC à l'étape « $STEP » (code $code)"
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

psql_admin() {
  psql --no-password -X -q -A -t -v ON_ERROR_STOP=1 -d "$RESTORE_DATABASE_URL" "$@"
}

# ------------------------------------------------------------------ 1. Choisir la sauvegarde

NAME_RE='^selio-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}Z$'
DOWNLOAD_S=0
if [[ -n "$SRC" ]]; then
  [[ -d "$SRC" ]] || die 2 "dossier de sauvegarde introuvable : $SRC"
  SRC="$(cd "$SRC" && pwd)"
elif ((FROM_REMOTE == 1)); then
  [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]] || die 2 "--remote demande BACKUP_RCLONE_REMOTE"
  require_cmd rclone
  build_rclone_args
  STEP="recherche de la dernière sauvegarde hors machine"
  name="$( (rclone lsf "${RCLONE_ARGS[@]}" --dirs-only "$BACKUP_RCLONE_REMOTE" || true) | sed 's#/$##' | { grep -E "$NAME_RE" || true; } | sort | tail -n 1)"
  [[ -n "$name" ]] || die 1 "aucune sauvegarde trouvée dans la copie hors machine"
  STEP="téléchargement de $name"
  t0="$(date +%s)"
  rclone copy "${RCLONE_ARGS[@]}" "$BACKUP_RCLONE_REMOTE/$name" "$WORK/$name"
  DOWNLOAD_S=$(($(date +%s) - t0))
  SRC="$WORK/$name"
  log "copie hors machine : $name téléchargée en ${DOWNLOAD_S}s"
else
  STEP="recherche de la dernière sauvegarde locale"
  [[ -d "$BACKUP_DIR" ]] || die 2 "BACKUP_DIR introuvable : $BACKUP_DIR"
  name="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'selio-*' -printf '%f\n' | { grep -E "$NAME_RE" || true; } | sort | tail -n 1)"
  [[ -n "$name" ]] || die 1 "aucune sauvegarde dans $BACKUP_DIR"
  SRC="$BACKUP_DIR/$name"
fi
NAME="$(basename "$SRC")"
log "test de restauration : sauvegarde $NAME → base temporaire $RESTORE_DB_NAME ($(mask_url "$RESTORE_DATABASE_URL"))"

# ------------------------------------------------------------------ 2. Intégrité et manifeste

STEP="sommes SHA-256"
[[ -f "$SRC/SHA256SUMS" ]] || die 1 "SHA256SUMS absent : sauvegarde incomplète"
(cd "$SRC" && sha256sum --quiet --strict -c SHA256SUMS) || die 1 "sommes SHA-256 incorrectes : sauvegarde abîmée ou modifiée"

if [[ -f "$SRC/manifest.txt.age" ]]; then
  EXT="age"
  require_cmd age
elif [[ -f "$SRC/manifest.txt.gpg" ]]; then
  EXT="gpg"
  require_cmd gpg
else
  die 1 "manifeste chiffré absent (manifest.txt.age ou .gpg)"
fi
[[ -f "$SRC/db.dump.$EXT" ]] || die 1 "db.dump.$EXT absent"

STEP="déchiffrement du manifeste"
decrypt_file "$SRC/manifest.txt.$EXT" >"$WORK/manifest.txt"

declare -A EXPECTED=()
EXPECTED_SCHEMA=""
PHOTOS_EXPECTED=""
while IFS='|' read -r key a b; do
  case "$key" in
    table) EXPECTED["$a"]="$b" ;;
    schema_version) EXPECTED_SCHEMA="$a" ;;
    photos) PHOTOS_EXPECTED="$a" ;;
  esac
done <"$WORK/manifest.txt"
((${#EXPECTED[@]} > 0)) || die 1 "manifeste sans table : sauvegarde inutilisable"

# ------------------------------------------------------------------ 3. Serveur de test

STEP="contrôle du serveur de test"
priv="$(psql_admin -c "select (rolsuper or rolbypassrls)::text from pg_roles where rolname = current_user")"
[[ "$priv" == "true" ]] \
  || die 2 "RESTORE_DATABASE_URL : il faut un rôle superutilisateur ou BYPASSRLS (les tables ont une RLS forcée)"
app_role="$(psql_admin -c "select count(*) from pg_roles where rolname = 'selio_app'")"
[[ "$app_role" == "1" ]] \
  || die 2 "le rôle selio_app n'existe pas sur ce serveur (les politiques RLS de la sauvegarde le citent). À créer une fois : create role selio_app nologin nobypassrls; (voir docs/SAUVEGARDE.md)"

STEP="création de la base temporaire"
drop_test_db # reste d'un test interrompu
createdb --no-password --maintenance-db="$RESTORE_DATABASE_URL" "$RESTORE_DB_NAME"
DB_CREATED=1
TARGET="$(conninfo_with_db "$RESTORE_DATABASE_URL" "$RESTORE_DB_NAME")"

# ------------------------------------------------------------------ 4. Restauration

STEP="déchiffrement de la base"
t0="$(date +%s)"
decrypt_file "$SRC/db.dump.$EXT" >"$WORK/db.dump"
STEP="pg_restore"
pg_restore --no-password --no-owner --exit-on-error -d "$TARGET" "$WORK/db.dump"
rm -f "$WORK/db.dump"
RESTORE_S=$(($(date +%s) - t0))
log "base restaurée en ${RESTORE_S}s (déchiffrement compris)"

# Étape obligatoire de toute restauration (docs/SAUVEGARDE.md §7) : rien de ce que les clients avaient
# arrêté ou supprimé depuis la sauvegarde ne doit reprendre. Les comptes Cloud passent en pause
# « restored », toutes les sessions sont effacées, les tâches et fenêtres Cloud annulées. Les lignes ne
# sont que modifiées : la comparaison avec le manifeste reste valable. Sauvegarde antérieure à la
# migration 0011 : rien à faire.
STEP="neutralisation du Cloud restauré"
cloud_touched="$(psql --no-password -X -q -A -t -v ON_ERROR_STOP=1 -d "$TARGET" -c "select case when to_regproc('public.app_cloud_after_restore') is null then -1 else 0 end")"
if [[ "$cloud_touched" == "0" ]]; then
  cloud_touched="$(psql --no-password -X -q -A -t -v ON_ERROR_STOP=1 -d "$TARGET" -c "select app_cloud_after_restore()")"
  log "Cloud : $cloud_touched compte(s) mis en pause « restored », sessions effacées"
else
  log "Cloud : fonction app_cloud_after_restore absente (sauvegarde antérieure à la migration 0011)"
fi

# ------------------------------------------------------------------ 5. Comparaison avec le manifeste

STEP="comptage des lignes"
psql --no-password -X -q -A -t -v ON_ERROR_STOP=1 -d "$TARGET" >"$WORK/actual.txt" <<'SQL'
select format('select %L || count(*) from %I.%I;', 'table|' || table_name || '|', table_schema, table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name \gexec
select 'schema_version|' || coalesce(max(name), '') from schema_migrations;
SQL

declare -A ACTUAL=()
ACTUAL_SCHEMA=""
while IFS='|' read -r key a b; do
  case "$key" in
    table) ACTUAL["$a"]="$b" ;;
    schema_version) ACTUAL_SCHEMA="$a" ;;
  esac
done <"$WORK/actual.txt"

GAPS=0
TOTAL_ROWS=0
mapfile -t TABLES < <(printf '%s\n' "${!EXPECTED[@]}" | sort)
for t in "${TABLES[@]}"; do
  TOTAL_ROWS=$((TOTAL_ROWS + ${EXPECTED[$t]}))
  if [[ -z "${ACTUAL[$t]+x}" ]]; then
    err "table $t absente de la base restaurée"
    GAPS=$((GAPS + 1))
  elif [[ "${ACTUAL[$t]}" != "${EXPECTED[$t]}" ]]; then
    err "table $t : ${ACTUAL[$t]} lignes restaurées, ${EXPECTED[$t]} attendues"
    GAPS=$((GAPS + 1))
  fi
done
for t in "${!ACTUAL[@]}"; do
  [[ -n "${EXPECTED[$t]+x}" ]] || warn "table $t présente dans la base restaurée mais pas dans le manifeste"
done
if [[ "$ACTUAL_SCHEMA" != "$EXPECTED_SCHEMA" ]]; then
  err "version du schéma : « $ACTUAL_SCHEMA » restaurée, « $EXPECTED_SCHEMA » attendue"
  GAPS=$((GAPS + 1))
fi
log "tables comparées : ${#TABLES[@]} ($TOTAL_ROWS lignes attendues), schéma $EXPECTED_SCHEMA"

# ------------------------------------------------------------------ 6. Photos

PHOTOS_LABEL="non sauvegardées (MinIO non configuré lors de la sauvegarde)"
if [[ -n "$PHOTOS_EXPECTED" && "$PHOTOS_EXPECTED" != "absentes" ]]; then
  if [[ "$RESTORE_CHECK_PHOTOS" != "true" ]]; then
    PHOTOS_LABEL="non vérifiées (RESTORE_CHECK_PHOTOS=$RESTORE_CHECK_PHOTOS)"
  elif [[ ! -f "$SRC/photos.tar.$EXT" ]]; then
    err "photos.tar.$EXT absent alors que le manifeste annonce $PHOTOS_EXPECTED objets"
    GAPS=$((GAPS + 1))
  else
    STEP="archive des photos"
    decrypt_file "$SRC/photos.tar.$EXT" | tar -tvf - >"$WORK/photos.list"
    photos_found="$(grep -c '^-' "$WORK/photos.list" || true)"
    if [[ "$photos_found" != "$PHOTOS_EXPECTED" ]]; then
      err "photos : $photos_found fichiers dans l'archive, $PHOTOS_EXPECTED attendus"
      GAPS=$((GAPS + 1))
    fi
    PHOTOS_LABEL="$photos_found objets lus dans l'archive"
  fi
fi

# ------------------------------------------------------------------ 7. Nettoyage et résultat

STEP="suppression de la base temporaire"
drop_test_db
DB_CREATED=0

if ((GAPS > 0)); then
  STEP="comparaison avec le manifeste"
  die 1 "test de restauration ÉCHOUÉ : $GAPS écart(s) avec le manifeste de $NAME"
fi
log "test de restauration RÉUSSI : $NAME — ${#TABLES[@]} tables, $TOTAL_ROWS lignes, photos : $PHOTOS_LABEL — téléchargement ${DOWNLOAD_S}s, restauration ${RESTORE_S}s, total $(elapsed_since "$START")"
