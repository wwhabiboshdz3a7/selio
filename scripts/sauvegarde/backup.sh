#!/usr/bin/env bash
# Sauvegarde nocturne de Selio (voir docs/SAUVEGARDE.md).
#
#  1. PostgreSQL : pg_dump --format=custom, dans un instantané partagé avec le comptage des lignes
#     de chaque table : le manifeste décrit exactement ce que contient la sauvegarde.
#  2. Photos : copie des objets MinIO avec rclone (source S3), archivée en tar.
#  3. Chiffrement de chaque fichier avec age (clé publique BACKUP_AGE_RECIPIENT ; la clé privée
#     n'est jamais sur la machine) ou, à défaut, gpg symétrique (BACKUP_PASSPHRASE_FILE).
#     Rien n'est jamais écrit en clair sur le disque, sauf le petit LISEZMOI.txt sans donnée.
#  4. Sommes SHA-256 ; le dossier daté n'apparaît que quand il est complet.
#  5. Copie hors machine avec rclone (BACKUP_RCLONE_REMOTE), puis vérification de la copie.
#  6. Rotation : BACKUP_KEEP_DAYS jours (30 par défaut), au moins BACKUP_KEEP_MIN sauvegardes
#     locales (3) gardées quoi qu'il arrive.
#
# Codes de sortie : 0 réussite · 1 échec (aucune sauvegarde incomplète n'est gardée) ·
#                   2 configuration invalide · 3 sauvegarde locale faite, copie hors machine
#                   absente ou en échec.
#
# Usage : backup.sh [--env FICHIER]    (défaut : /etc/selio/backup.env s'il existe)
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

# Aide : le bloc de commentaires en tête de ce fichier.
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

ENV_FILE="${BACKUP_ENV_FILE:-}"
while (($#)); do
  case "$1" in
    --env)
      ENV_FILE="${2:?--env attend un fichier}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die 2 "argument inconnu : $1 (voir --help)" ;;
  esac
done
if [[ -n "$ENV_FILE" ]]; then
  load_env_file "$ENV_FILE"
elif [[ -f /etc/selio/backup.env ]]; then
  load_env_file /etc/selio/backup.env
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/selio}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
BACKUP_KEEP_MIN="${BACKUP_KEEP_MIN:-3}"
BACKUP_PG_USER="${BACKUP_PG_USER:-selio}"
BACKUP_PG_DB="${BACKUP_PG_DB:-selio}"
# Délai maximal d'attente d'une réponse de PostgreSQL pendant le comptage (secondes).
BACKUP_PG_TIMEOUT_S="${BACKUP_PG_TIMEOUT_S:-3600}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
LOG_FILE="${BACKUP_LOG_FILE:-$BACKUP_DIR/backup.log}"

# ------------------------------------------------------------------ configuration

[[ "$BACKUP_KEEP_DAYS" =~ ^[1-9][0-9]*$ ]] || die 2 "BACKUP_KEEP_DAYS doit être un nombre de jours (≥ 1)"
[[ "$BACKUP_KEEP_MIN" =~ ^[1-9][0-9]*$ ]] || die 2 "BACKUP_KEEP_MIN doit être un nombre (≥ 1)"
[[ "$BACKUP_PG_TIMEOUT_S" =~ ^[1-9][0-9]*$ ]] || die 2 "BACKUP_PG_TIMEOUT_S doit être un nombre de secondes"

validate_crypto
EXT="$(crypto_ext)"
require_cmd sha256sum tar flock find sort awk sed date stat hostname

if [[ -n "${BACKUP_PG_DOCKER_CONTAINER:-}" ]]; then
  # PostgreSQL dans Docker (deploy/docker-compose.prod.yml, port non publié) : les outils du
  # conteneur sont utilisés, connexion locale au conteneur, aucun mot de passe à fournir.
  require_cmd docker
  PG_MODE="docker"
  PG_LABEL="conteneur $BACKUP_PG_DOCKER_CONTAINER, base $BACKUP_PG_DB, rôle $BACKUP_PG_USER"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  require_cmd pg_dump psql
  PG_MODE="url"
  PG_LABEL="$(mask_url "$DATABASE_URL")"
else
  die 2 "DATABASE_URL (rôle propriétaire « selio », jamais selio_app) ou BACKUP_PG_DOCKER_CONTAINER requis"
fi

if [[ -n "${BACKUP_MINIO_SOURCE:-}" || -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  require_cmd rclone
  build_rclone_args
fi

# pg_cmd <outil> [arguments…] : exécute un outil PostgreSQL sur la base à sauvegarder.
pg_cmd() {
  local tool="$1"
  shift
  if [[ "$PG_MODE" == "docker" ]]; then
    docker exec -i "$BACKUP_PG_DOCKER_CONTAINER" "$tool" -U "$BACKUP_PG_USER" -d "$BACKUP_PG_DB" "$@"
  else
    "$tool" --no-password -d "$DATABASE_URL" "$@"
  fi
}

# ------------------------------------------------------------------ verrou et dossiers

exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || die 1 "une sauvegarde est déjà en cours (verrou $BACKUP_DIR/.backup.lock)"

STAMP="$(date -u +%Y-%m-%d_%H%M%SZ)"
NAME="selio-$STAMP"
WORK="$BACKUP_DIR/.$NAME.partial"
STAGE="$BACKUP_DIR/.$NAME.photos"
FINAL="$BACKUP_DIR/$NAME"
STEP="démarrage"
DONE_LOCAL=0
START="$(date +%s)"
MANIFEST=""
PSQL_COPROC_PID=""

# shellcheck disable=SC2329 # appelée par « trap … EXIT »
cleanup() {
  local code=$?
  if [[ -n "$PSQL_COPROC_PID" ]] && kill -0 "$PSQL_COPROC_PID" 2>/dev/null; then
    kill "$PSQL_COPROC_PID" 2>/dev/null || true
  fi
  rm -rf "$STAGE"
  if ((DONE_LOCAL == 0)); then
    rm -rf "$WORK"
    code="$(normalized_exit_code "$code")"
    # Le code 3 veut dire « sauvegarde locale faite » : jamais avant qu'elle le soit.
    ((code == 3)) && code=1
    if ((code != 0)); then
      err "sauvegarde $NAME : ÉCHEC à l'étape « $STEP » (code $code) ; aucune sauvegarde incomplète n'est gardée"
    fi
  elif ((code != 0 && code != 3)); then
    code="$(normalized_exit_code "$code")"
    err "sauvegarde $NAME : la sauvegarde locale est faite ($FINAL) mais l'étape « $STEP » a échoué (code $code)"
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mkdir -m 700 "$WORK"
log "sauvegarde $NAME : début (base : $PG_LABEL ; chiffrement : $EXT ; rotation : $BACKUP_KEEP_DAYS jours)"

# ------------------------------------------------------------------ 1. PostgreSQL

dump_postgres() {
  STEP="contrôle des droits PostgreSQL"
  local priv
  priv="$(pg_cmd psql -X -q -A -t -v ON_ERROR_STOP=1 \
    -c "select (rolsuper or rolbypassrls)::text from pg_roles where rolname = current_user")"
  if [[ "$priv" != "true" ]]; then
    die 2 "le rôle de sauvegarde doit être superutilisateur ou BYPASSRLS (les tables ont une RLS forcée) : utilisez le rôle propriétaire « selio », jamais selio_app"
  fi

  # Une session psql garde ouverte une transaction en lecture seule dont l'instantané est partagé
  # avec pg_dump : les comptes de lignes du manifeste et le contenu du dump sont identiques.
  STEP="instantané PostgreSQL"
  coproc PSQL { pg_cmd psql -X -q -A -t -v ON_ERROR_STOP=1; }
  PSQL_COPROC_PID="$PSQL_PID"
  local to_psql="${PSQL[1]}" from_psql="${PSQL[0]}"
  printf '%s\n' "begin transaction isolation level repeatable read, read only;" \
    "select pg_export_snapshot();" >&"$to_psql"
  local snapshot=""
  read -r -t 120 snapshot <&"$from_psql" || die 1 "PostgreSQL n'a pas fourni d'instantané (connexion refusée ?)"
  [[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || die 1 "instantané PostgreSQL illisible"

  STEP="pg_dump"
  local t0
  t0="$(date +%s)"
  pg_cmd pg_dump --format=custom --snapshot="$snapshot" | encrypt_to "$WORK/db.dump.$EXT"
  log "PostgreSQL : db.dump.$EXT ($(human_bytes "$(stat -c %s "$WORK/db.dump.$EXT")"), $(elapsed_since "$t0"))"

  STEP="comptage des lignes"
  printf '%s\n' \
    "select 'server_version|' || current_setting('server_version');" \
    "select 'schema_version|' || coalesce(max(name), '') from schema_migrations;" \
    "select format('select %L || count(*) from %I.%I;', 'table|' || table_name || '|', table_schema, table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name \\gexec" \
    "select '__FIN__';" >&"$to_psql"
  local line tables=0 rows=0
  while true; do
    read -r -t "$BACKUP_PG_TIMEOUT_S" line <&"$from_psql" || die 1 "comptage des lignes interrompu"
    [[ "$line" == "__FIN__" ]] && break
    MANIFEST+="$line"$'\n'
    if [[ "$line" == table\|* ]]; then
      tables=$((tables + 1))
      rows=$((rows + ${line##*|}))
    fi
  done
  printf '%s\n' "commit;" '\q' >&"$to_psql"
  wait "$PSQL_COPROC_PID" 2>/dev/null || true
  PSQL_COPROC_PID=""
  ((tables > 0)) || die 1 "aucune table trouvée dans la base : mauvaise base ou droits insuffisants"
  log "PostgreSQL : $tables tables, $rows lignes au moment de l'instantané"
}

# ------------------------------------------------------------------ 2. Photos (MinIO)

backup_photos() {
  if [[ -z "${BACKUP_MINIO_SOURCE:-}" ]]; then
    warn "photos NON sauvegardées : BACKUP_MINIO_SOURCE est vide (MinIO pas encore en service ?)"
    MANIFEST+="photos|absentes"$'\n'
    return 0
  fi
  STEP="copie des photos (rclone)"
  local t0 count bytes
  t0="$(date +%s)"
  mkdir -m 700 "$STAGE"
  rclone copy "${RCLONE_ARGS[@]}" "$BACKUP_MINIO_SOURCE" "$STAGE"
  count="$(find "$STAGE" -type f | wc -l | tr -d ' ')"
  bytes="$(find "$STAGE" -type f -printf '%s\n' | awk '{ s += $1 } END { print s + 0 }')"

  STEP="archive chiffrée des photos"
  tar -C "$STAGE" --numeric-owner -cf - . | encrypt_to "$WORK/photos.tar.$EXT"
  rm -rf "$STAGE"
  MANIFEST+="photos|$count|$bytes"$'\n'
  log "photos : $count objets ($(human_bytes "$bytes")) → photos.tar.$EXT, $(elapsed_since "$t0")"
}

# ------------------------------------------------------------------ 3. Manifeste, LISEZMOI, sommes

write_manifest() {
  STEP="manifeste"
  {
    printf 'format|selio-sauvegarde-1\n'
    printf 'name|%s\n' "$NAME"
    printf 'created_at|%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'host|%s\n' "$(hostname)"
    printf 'crypto|%s\n' "$EXT"
    printf '%s' "$MANIFEST"
  } | encrypt_to "$WORK/manifest.txt.$EXT"

  local crypto_label
  if [[ "$EXT" == "age" ]]; then
    crypto_label="age, pour les clés publiques : $(printf '%s' "$BACKUP_AGE_RECIPIENT" | tr ',' '\n' | sed -E 's/^[[:space:]]+//; s/^(.{10}).*(.{6})$/\1…\2/' | paste -sd ' ' -)"
  else
    crypto_label="gpg symétrique (AES-256), phrase de passe gardée à part"
  fi
  # Seul fichier en clair : aucune donnée, seulement de quoi s'y retrouver.
  cat >"$WORK/LISEZMOI.txt" <<EOF
Sauvegarde Selio $NAME
Créée le $(date -u +%Y-%m-%dT%H:%M:%SZ) sur $(hostname).
Chiffrement : $crypto_label.
Fichiers : db.dump.$EXT (PostgreSQL, pg_dump --format=custom), manifest.txt.$EXT (lignes par
table, version du schéma, photos), photos.tar.$EXT (objets MinIO, si présents), SHA256SUMS.
Vérifier : sha256sum -c SHA256SUMS
Restaurer : docs/SAUVEGARDE.md du dépôt Selio (scripts/sauvegarde/restore-test.sh pour un test).
EOF

  STEP="sommes SHA-256"
  local -a files=()
  local f
  for f in "$WORK"/*; do
    [[ "$(basename "$f")" == "SHA256SUMS" ]] && continue
    files+=("$(basename "$f")")
  done
  (cd "$WORK" && sha256sum -- "${files[@]}" >SHA256SUMS && sha256sum --quiet --strict -c SHA256SUMS)

  if [[ "$EXT" == "age" ]]; then
    for f in "$WORK"/*.age; do
      [[ "$(head -c 21 "$f")" == "age-encryption.org/v1" ]] || die 1 "fichier chiffré inattendu : $(basename "$f")"
    done
  fi
}

# ------------------------------------------------------------------ 4. Rotation

rotate_local() {
  STEP="rotation locale"
  local now cutoff name epoch i=0 removed=0
  now="$(date -u +%s)"
  cutoff=$((now - BACKUP_KEEP_DAYS * 86400))
  local -a dirs=()
  mapfile -t dirs < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'selio-*' -printf '%f\n' | sort -r)
  for name in "${dirs[@]}"; do
    i=$((i + 1))
    ((i <= BACKUP_KEEP_MIN)) && continue
    if [[ ! "$name" =~ ^selio-([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]]; then
      warn "rotation : dossier ignoré (nom inattendu) : $name"
      continue
    fi
    epoch="$(date -u -d "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}:${BASH_REMATCH[3]}:${BASH_REMATCH[4]}" +%s)"
    if ((epoch < cutoff)); then
      rm -rf -- "${BACKUP_DIR:?}/$name"
      removed=$((removed + 1))
    fi
  done
  # Restes d'une exécution tuée brutalement (plus d'un jour).
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \( -name '.selio-*.partial' -o -name '.selio-*.photos' \) \
    -mmin +1440 -exec rm -rf {} +
  log "rotation locale : $removed sauvegarde(s) de plus de $BACKUP_KEEP_DAYS jours supprimée(s), ${#dirs[@]} avant rotation"
}

rotate_remote() {
  STEP="rotation hors machine"
  rclone delete "${RCLONE_ARGS[@]}" --min-age "${BACKUP_KEEP_DAYS}d" --include "/selio-*/**" "$BACKUP_RCLONE_REMOTE"
  rclone rmdirs "${RCLONE_ARGS[@]}" --leave-root "$BACKUP_RCLONE_REMOTE"
  log "rotation hors machine : fichiers de plus de $BACKUP_KEEP_DAYS jours supprimés"
}

# ------------------------------------------------------------------ déroulé

dump_postgres
backup_photos
write_manifest

STEP="finalisation"
mv "$WORK" "$FINAL"
DONE_LOCAL=1
TOTAL_BYTES="$(find "$FINAL" -type f -printf '%s\n' | awk '{ s += $1 } END { print s + 0 }')"
log "sauvegarde locale prête : $FINAL ($(human_bytes "$TOTAL_BYTES"))"

rotate_local

STATUS=0
if [[ -z "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  err "copie hors machine NON faite : BACKUP_RCLONE_REMOTE est vide. Une sauvegarde restée sur la machine ne protège ni d'une panne de disque, ni d'un vol, ni d'un incendie."
  STATUS=3
else
  STEP="copie hors machine"
  t0="$(date +%s)"
  if rclone copy "${RCLONE_ARGS[@]}" "$FINAL" "$BACKUP_RCLONE_REMOTE/$NAME" \
    && rclone check "${RCLONE_ARGS[@]}" --one-way "$FINAL" "$BACKUP_RCLONE_REMOTE/$NAME"; then
    log "copie hors machine vérifiée ($(elapsed_since "$t0"))"
    rotate_remote || warn "rotation hors machine en échec : à vérifier (la sauvegarde du jour est bien copiée)"
  else
    err "copie hors machine en ÉCHEC : la sauvegarde du jour n'existe que sur cette machine"
    STATUS=3
  fi
fi

if ((STATUS == 0)); then
  log "sauvegarde $NAME terminée en $(elapsed_since "$START")"
else
  warn "sauvegarde $NAME terminée en $(elapsed_since "$START") SANS copie hors machine (code 3)"
fi
exit "$STATUS"
