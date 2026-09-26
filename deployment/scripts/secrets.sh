#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<EOF
usage: secrets.sh --env <env> [--env-dir <path>] [--dry-run] [--force]
                  [--only infra|platform]

Generates the secret values an environment needs and writes them, readable
only by you, to

  <env-dir>/<env>/01-infra.secrets.tfvars
  <env-dir>/<env>/02-platform.secrets.tfvars

setup.sh and destroy.sh pass each file after its stack's tfvars. No value is
printed. The secrets stay out of 01-infra.tfvars and 02-platform.tfvars, so
those can be reviewed and versioned while the secrets files are not.

  --env <env>       environment name: the directory <env-dir>/<env>/
  --env-dir <path>  directory holding environments (default: $ENV_DIR_BASE)
  --dry-run         list what would be written, with every value masked
  --force           replace existing secrets files; this rotates every value
                    in them, see docs/secrets.md#rotation first
  --only <stack>    write only 01-infra.secrets.tfvars (infra) or only
                    02-platform.secrets.tfvars (platform)

01-infra:    postgres_password, redis_auth, storage_credentials when
             storage_mode is incluster, livekit_api_key and
             livekit_api_secret when livekit_enabled is true
02-platform: every required field of app_secrets; the y-sweet pair comes from
             the y-sweet image the charts pin, run with docker or podman; the
             Google sign-in client is asked for (or read from GOOGLE_CLIENT_ID
             and GOOGLE_CLIENT_SECRET), with the steps to create one

Optional values (litellm_api_key, hindsight_*) are yours to add to app_secrets
in 02-platform.secrets.tfvars. A file that exists is left unchanged unless
--force is given.
EOF
}

FORCE=0
ONLY=""
ENV_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_ARG="${2:-}"; shift 2 ;;
    --env-dir) set_env_dir_base "${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

case "$ONLY" in
  ""|infra|platform) ;;
  *) usage >&2; die "--only takes infra or platform" ;;
esac

load_env "$ENV_ARG"
need_cmd openssl || die "openssl not found in PATH"
[ -f "$INFRA_TFVARS" ] || die "missing $INFRA_TFVARS"
[ -f "$PLATFORM_TFVARS" ] || die "missing $PLATFORM_TFVARS"

YSWEET_CHART="$DEPLOYMENT_DIR/../helm-charts/charts/xyne-ysweet/Chart.yaml"

rand() {
  openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"
}

hex64() {
  openssl rand -hex 32
}

container_runtime() {
  if need_cmd docker && docker info >/dev/null 2>&1; then
    printf 'docker'
  elif need_cmd podman; then
    printf 'podman'
  fi
}

google_steps() {
  local domain="$1"
  cat >&2 <<EOF

Sign-in uses a Google OAuth client. Create one (any Google Cloud project):
  1. https://console.cloud.google.com/apis/credentials/consent
     configure the OAuth consent screen (Internal for a Workspace org, else External)
  2. https://console.cloud.google.com/apis/credentials
     Create credentials > OAuth client ID > Web application
       Authorized JavaScript origin:  https://$domain
       Authorized redirect URI:       https://$domain/api/auth/exchange
  3. Copy the client ID and client secret.
See docs/secrets.md#google-sign-in.

EOF
}

google_client() {
  local domain
  GOOGLE_ID="${GOOGLE_CLIENT_ID:-}"
  GOOGLE_SECRET="${GOOGLE_CLIENT_SECRET:-}"
  [ -n "$GOOGLE_ID" ] && [ -n "$GOOGLE_SECRET" ] && return 0
  domain="$(tfvar_value "$PLATFORM_TFVARS" domain)"
  [ -n "$domain" ] || domain="$(tfvar_value "$INFRA_TFVARS" domain)"
  google_steps "${domain:-<domain>}"
  if [ "$DRY_RUN" != "1" ] && [ -t 0 ]; then
    printf 'Google client ID: ' >&2
    read -r GOOGLE_ID
    printf 'Google client secret: ' >&2
    read -rs GOOGLE_SECRET
    printf '\n' >&2
  fi
  if [ -z "$GOOGLE_ID" ] || [ -z "$GOOGLE_SECRET" ]; then
    log "no Google client given: writing placeholders; the doctor fails until you replace them" >&2
    GOOGLE_ID="replace-with-google-client-id"
    GOOGLE_SECRET="replace-with-google-client-secret"
  fi
}

ysweet_pair() {
  local runtime tag
  runtime="$(container_runtime)"
  [ -n "$runtime" ] || die "the y-sweet key pair needs docker or podman running"
  tag="$(awk '/^appVersion:/ { gsub(/"/, "", $2); print $2 }' "$YSWEET_CHART")"
  [ -n "$tag" ] || die "no appVersion in $YSWEET_CHART"
  log "generating the y-sweet key pair with ghcr.io/juspay/y-sweet:$tag ($runtime)" >&2
  "$runtime" run --rm "ghcr.io/juspay/y-sweet:$tag" y-sweet gen-auth --json
}

refuse_duplicates() {
  local file="$1" secrets="$2" name found=""
  shift 2
  for name in "$@"; do
    if tfvar_set "$file" "$name"; then
      found="$found $name"
    fi
  done
  [ -z "$found" ] || die "$(basename "$file") sets${found}; delete those lines, they belong in $(basename "$secrets")"
}

should_write() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return 0
  fi
  if [ "$FORCE" != "1" ]; then
    log "$(basename "$file") exists, left unchanged (--force replaces it)"
    return 1
  fi
  confirm_typed "$ENV_NAME" "Replace $(basename "$file")? Every value in it changes, and an install that already uses them must be updated in the same apply." ||
    die "aborted before replacing $(basename "$file")"
}

emit() {
  local file="$1" content="$2"
  if [ "$DRY_RUN" = "1" ]; then
    log "would write $file:"
    printf '%s\n' "$content" | sed -E 's/=([[:space:]]*)"[^"]*"/=\1"********"/; s/^/    /'
    return 0
  fi
  (umask 077 && printf '%s\n' "$content" > "$file")
  chmod 600 "$file"
  log "wrote $file (mode 600)"
}

infra_secrets() {
  local storage livekit content names=(postgres_password redis_auth)
  storage="$(tfvar_value "$INFRA_TFVARS" storage_mode)"
  livekit="$(tfvar_value "$INFRA_TFVARS" livekit_enabled)"
  [ "$storage" = "incluster" ] && names+=(storage_credentials)
  [ "$livekit" = "true" ] && names+=(livekit_api_key livekit_api_secret)
  refuse_duplicates "$INFRA_TFVARS" "$INFRA_SECRETS" "${names[@]}"
  should_write "$INFRA_SECRETS" || return 0

  content="postgres_password = \"$(rand 32)\"
redis_auth        = \"$(rand 48)\""
  if [ "$storage" = "incluster" ]; then
    content="$content

storage_credentials = {
  access_key_id     = \"$(rand 20)\"
  secret_access_key = \"$(rand 40)\"
}"
  fi
  if [ "$livekit" = "true" ]; then
    content="$content

livekit_api_key    = \"API$(rand 12)\"
livekit_api_secret = \"$(rand 48)\""
  fi
  emit "$INFRA_SECRETS" "$content"
}

platform_secrets() {
  local pair ysweet_auth ysweet_token content
  refuse_duplicates "$PLATFORM_TFVARS" "$PLATFORM_SECRETS" app_secrets
  should_write "$PLATFORM_SECRETS" || return 0

  if [ "$DRY_RUN" = "1" ]; then
    ysweet_auth="<y-sweet private_key>"
    ysweet_token="<y-sweet server_token>"
  else
    pair="$(ysweet_pair)"
    ysweet_auth="$(printf '%s' "$pair" | jq -r '.private_key // empty')"
    ysweet_token="$(printf '%s' "$pair" | jq -r '.server_token // empty')"
    [ -n "$ysweet_auth" ] && [ -n "$ysweet_token" ] || die "y-sweet gen-auth returned no key pair"
  fi
  google_client

  content="app_secrets = {
  jwt_secret                  = \"$(rand 48)\"
  zero_auth_secret            = \"$(rand 48)\"
  zero_admin_password         = \"$(rand 24)\"
  encryption_key              = \"$(hex64)\"
  internal_s2s_key            = \"$(rand 48)\"
  claw_s2s_key                = \"$(rand 48)\"
  claw_auth_encryption_key    = \"$(hex64)\"
  ysweet_auth                 = \"$ysweet_auth\"
  ysweet_server_token         = \"$ysweet_token\"
  transcription_agent_api_key = \"$(rand 48)\"
  google_client_id            = \"$GOOGLE_ID\"
  google_client_secret        = \"$GOOGLE_SECRET\"
}"
  emit "$PLATFORM_SECRETS" "$content"
}

log "secrets: env=$ENV_NAME cloud=$CLOUD dir=$ENV_DIR"
[ "$ONLY" = "platform" ] || infra_secrets
[ "$ONLY" = "infra" ] || platform_secrets
