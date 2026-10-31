# shellcheck shell=bash
# Fonctions communes à backup.sh et restore-test.sh (sauvegarde de Selio).
# Ce fichier est chargé par `source` : il ne fait rien tout seul.
#
# Règles : aucune valeur secrète n'est écrite dans un journal (adresse de base masquée, aucun mot de
# passe, aucune phrase de passe) ; tout ce qui sort de la machine est chiffré (age ou gpg).

# Journal : horodatage ISO (UTC), sortie d'erreur et, si possible, le fichier LOG_FILE.
LOG_FILE="${LOG_FILE:-}"

_log() {
  local level="$1"
  shift
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [$level] $*"
  printf '%s\n' "$line" >&2
  if [[ -n "$LOG_FILE" ]]; then
    printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null || true
  fi
}
log() { _log "info" "$@"; }
warn() { _log "attention" "$@"; }
err() { _log "ERREUR" "$@"; }

# Arrêt immédiat avec un code de sortie (1 par défaut). DIE_CODE garde le code voulu : les scripts
# ramènent à 1 tout autre code (celui d'un outil comme psql ou rclone n'a pas leur sens).
DIE_CODE=""
die() {
  local code=1
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    code="$1"
    shift
  fi
  DIE_CODE="$code"
  err "$@"
  exit "$code"
}

# Code de sortie normalisé : 0, 130 (interruption), le code de die(), sinon 1.
normalized_exit_code() {
  local code="$1"
  if ((code == 0 || code == 130)); then
    printf '%s' "$code"
  elif [[ -n "$DIE_CODE" ]]; then
    printf '%s' "$DIE_CODE"
  else
    printf '1'
  fi
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die 2 "commande introuvable : $c (à installer sur cette machine)"
  done
}

# Adresse de base sans mot de passe, pour le journal : postgres://selio:***@hôte/base.
mask_url() {
  printf '%s' "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#; s#(password=)[^ ]*#\1***#g'
}

# Même connexion, autre base : postgres://…/postgres → postgres://…/postgres?dbname=<base>
# (libpq applique le dernier dbname), ou « … dbname=<base> » pour la forme clé=valeur.
conninfo_with_db() {
  local url="$1" db="$2"
  if [[ "$url" =~ ^postgres(ql)?:// ]]; then
    if [[ "$url" == *\?* ]]; then
      printf '%s&dbname=%s' "$url" "$db"
    else
      printf '%s?dbname=%s' "$url" "$db"
    fi
  else
    printf '%s dbname=%s' "$url" "$db"
  fi
}

# Charge un fichier de variables (KEY=valeur) s'il est sûr : fichier ordinaire, ni modifiable par le
# groupe ni par les autres (il peut contenir une adresse de base). Sinon : arrêt.
load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || die 2 "fichier de configuration introuvable : $file"
  local mode
  mode="$(stat -c '%a' "$file")"
  if (( (8#$mode & 8#022) != 0 )); then
    die 2 "$file est modifiable par d'autres utilisateurs (droits $mode) : chmod 600 $file"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
}

# Mode de chiffrement : « age » (BACKUP_AGE_RECIPIENT, clé publique ; la clé privée n'est jamais sur
# la machine) sinon « gpg » (BACKUP_PASSPHRASE_FILE, chiffrement symétrique). Jamais en clair.
crypto_mode() {
  if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
    printf 'age'
  elif [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
    printf 'gpg'
  else
    printf 'none'
  fi
}

check_passphrase_file() {
  local file="$1"
  [[ -f "$file" && -s "$file" ]] || die 2 "BACKUP_PASSPHRASE_FILE : fichier absent ou vide"
  local mode
  mode="$(stat -c '%a' "$file")"
  if (( (8#$mode & 8#077) != 0 )); then
    die 2 "BACKUP_PASSPHRASE_FILE lisible par d'autres utilisateurs (droits $mode) : chmod 600"
  fi
}

# Destinataires age : une ou plusieurs clés publiques (age1… ou ssh-ed25519 …) séparées par des
# virgules. Conseil : deux clés (portable de secours + clé papier rangée hors de la machine).
# Remplit AGE_ARGS (-r clé …) dans le shell courant ; arrêt si une valeur n'est pas une clé publique.
AGE_ARGS=()
build_age_args() {
  AGE_ARGS=()
  local r
  local -a recips=()
  IFS=',' read -r -a recips <<<"${BACKUP_AGE_RECIPIENT:-}"
  for r in "${recips[@]}"; do
    r="$(printf '%s' "$r" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
    [[ -z "$r" ]] && continue
    if [[ "$r" == AGE-SECRET-KEY-* ]]; then
      die 2 "BACKUP_AGE_RECIPIENT contient une clé PRIVÉE age : elle ne doit jamais être sur cette machine. Mettez la clé publique (age1…), puis effacez ce fichier de partout où il a été copié."
    fi
    if [[ ! "$r" =~ ^(age1[0-9a-z]{20,}|ssh-(ed25519|rsa)[[:space:]].+)$ ]]; then
      die 2 "BACKUP_AGE_RECIPIENT : une des valeurs n'est pas une clé publique age (age1…) ni ssh"
    fi
    AGE_ARGS+=(-r "$r")
  done
  ((${#AGE_ARGS[@]} > 0)) || die 2 "BACKUP_AGE_RECIPIENT ne contient aucune clé publique"
}

# Vérifie le chiffrement configuré (à appeler une fois, avant tout travail).
validate_crypto() {
  case "$(crypto_mode)" in
    age)
      require_cmd age
      build_age_args
      ;;
    gpg)
      require_cmd gpg
      check_passphrase_file "$BACKUP_PASSPHRASE_FILE"
      ;;
    *) die 2 "aucun chiffrement configuré : BACKUP_AGE_RECIPIENT (clé publique age, conseillé) ou BACKUP_PASSPHRASE_FILE (gpg). Rien n'est jamais sauvegardé en clair." ;;
  esac
}

# Extension des fichiers chiffrés selon le mode.
crypto_ext() {
  case "$(crypto_mode)" in
    age) printf 'age' ;;
    gpg) printf 'gpg' ;;
    *) die 2 "aucun chiffrement configuré : BACKUP_AGE_RECIPIENT (conseillé) ou BACKUP_PASSPHRASE_FILE" ;;
  esac
}

# Chiffre l'entrée standard vers le fichier $1.
encrypt_to() {
  local out="$1"
  case "$(crypto_mode)" in
    age)
      ((${#AGE_ARGS[@]} > 0)) || build_age_args
      age "${AGE_ARGS[@]}" -o "$out"
      ;;
    gpg)
      gpg --batch --yes --quiet --no-tty --pinentry-mode loopback \
        --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
        --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 \
        --compress-algo none -o "$out"
      ;;
    *) die 2 "aucun chiffrement configuré" ;;
  esac
}

# Déchiffre le fichier $1 vers la sortie standard, selon son extension.
#   .age : BACKUP_AGE_IDENTITY (fichier de clé privée age, apporté pour le test ou sur le portable)
#   .gpg : BACKUP_PASSPHRASE_FILE
decrypt_file() {
  local in="$1"
  case "$in" in
    *.age)
      [[ -n "${BACKUP_AGE_IDENTITY:-}" && -f "${BACKUP_AGE_IDENTITY}" ]] \
        || die 2 "BACKUP_AGE_IDENTITY : fichier de clé privée age introuvable (il n'est jamais sur la machine de production)"
      age -d -i "$BACKUP_AGE_IDENTITY" "$in"
      ;;
    *.gpg)
      check_passphrase_file "${BACKUP_PASSPHRASE_FILE:-}"
      gpg --batch --quiet --no-tty --pinentry-mode loopback \
        --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt "$in"
      ;;
    *) die 2 "format chiffré inconnu : $in" ;;
  esac
}

# Durée lisible depuis un horodatage (secondes epoch).
elapsed_since() {
  local start="$1" now
  now="$(date +%s)"
  printf '%ss' "$((now - start))"
}

human_bytes() {
  local b="$1"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec-i --suffix=o "$b"
  else
    printf '%s o' "$b"
  fi
}

# Arguments rclone communs (fichier de configuration éventuel, nouvelles tentatives) dans RCLONE_ARGS.
RCLONE_ARGS=()
build_rclone_args() {
  RCLONE_ARGS=(--retries 3 --low-level-retries 10)
  if [[ -n "${BACKUP_RCLONE_CONFIG:-}" ]]; then
    RCLONE_ARGS+=(--config "$BACKUP_RCLONE_CONFIG")
  fi
}
