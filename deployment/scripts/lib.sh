SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
STACKS_DIR="$DEPLOYMENT_DIR/terraform/stacks"
ENV_DIR_BASE="$DEPLOYMENT_DIR/environments"

DRY_RUN="${DRY_RUN:-0}"
AUTO_APPROVE="${AUTO_APPROVE:-0}"
ENV_NAME=""
ENV_DIR=""
CLOUD=""
STATE_PREFIX="xyne"

log() {
  printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

quote_args() {
  local out="" a
  for a in "$@"; do
    case "$a" in
      *[!A-Za-z0-9_./:=@,+-]*|"") out="$out '$(printf '%s' "$a" | sed "s/'/'\\\\''/g")'" ;;
      *) out="$out $a" ;;
    esac
  done
  printf '%s' "${out# }"
}

run() {
  printf '+ %s\n' "$(quote_args "$@")"
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  "$@"
}

capture() {
  local placeholder="$1"
  shift
  printf '+ %s\n' "$(quote_args "$@")" >&2
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s' "$placeholder"
    return 0
  fi
  "$@"
}

probe() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '+ %s || create as follows\n' "$(quote_args "$@")"
    return 1
  fi
  "$@" >/dev/null 2>&1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

confirm() {
  local prompt="$1" answer
  if [ "$AUTO_APPROVE" = "1" ] || [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  printf '%s [yes/N] ' "$prompt"
  read -r answer
  [ "$answer" = "yes" ]
}

confirm_typed() {
  local expected="$1" prompt="$2" answer
  if [ "$AUTO_APPROVE" = "1" ] || [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  printf '%s\nType "%s" to continue: ' "$prompt" "$expected"
  read -r answer
  [ "$answer" = "$expected" ]
}

tfvar_value() {
  local file="$1" name="$2"
  [ -f "$file" ] || return 0
  { grep -E "^[[:space:]]*${name}[[:space:]]*=" "$file" || true; } | head -n1 | sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"[[:space:]]*$//'
}

tfvar_set() {
  local file="$1" name="$2"
  [ -f "$file" ] && grep -qE "^[[:space:]]*${name}[[:space:]]*=" "$file"
}

required_variables() {
  awk '
    /^variable "/ { name=$2; gsub(/"/, "", name); depth=0; hasdef=0; inblock=1 }
    inblock {
      n=gsub(/{/, "{"); m=gsub(/}/, "}"); depth+=n-m
      if ($0 ~ /^[[:space:]]*default[[:space:]]*=/) hasdef=1
      if (depth==0 && name!="") { if (!hasdef) print name; name=""; inblock=0 }
    }
  ' "$1"
}

set_env_dir_base() {
  [ -d "$1" ] || die "environment base directory not found: $1"
  ENV_DIR_BASE="$(cd "$1" && pwd)"
}

resolve_env() {
  ENV_NAME="$1"
  [ -n "$ENV_NAME" ] || die "--env <env> is required"
  case "$ENV_NAME" in
    */*|.|..) die "--env takes a directory name under $ENV_DIR_BASE, not a path" ;;
  esac
  ENV_DIR="$ENV_DIR_BASE/$ENV_NAME"
  [ -d "$ENV_DIR" ] || die "environment directory not found: $ENV_DIR"
  ENV_CONF="$ENV_DIR/env.conf"
  INFRA_TFVARS="$ENV_DIR/01-infra.tfvars"
  PLATFORM_TFVARS="$ENV_DIR/02-platform.tfvars"
  OVERLAY_DIR="$ENV_DIR/overlay"
  OVERLAY_TFVARS="$ENV_DIR/overlay.tfvars"
}

load_env() {
  resolve_env "$1"
  [ -f "$ENV_CONF" ] || die "missing $ENV_CONF"
  if grep -vE '^[[:space:]]*$|^#|^[A-Z_][A-Z0-9_]*=[A-Za-z0-9_./@:-]*$' "$ENV_CONF" >/dev/null; then
    die "$ENV_CONF must contain only KEY=VALUE lines"
  fi
  set -a
  . "$ENV_CONF"
  set +a
  case "${CLOUD:-}" in
    gcp|aws|azure) ;;
    *) die "CLOUD must be gcp, aws or azure in $ENV_CONF" ;;
  esac
  STATE_PREFIX="${STATE_PREFIX:-xyne}"
  INFRA_STACK="$STACKS_DIR/$CLOUD/01-infra"
  PLATFORM_STACK="$STACKS_DIR/$CLOUD/02-platform"
  case "$CLOUD" in
    gcp)
      [ -n "${STATE_BUCKET:-}" ] || die "STATE_BUCKET is required in $ENV_CONF"
      [ -n "${PROJECT:-}" ] || die "PROJECT is required in $ENV_CONF"
      STATE_LOCATION="${STATE_LOCATION:-$(tfvar_value "$INFRA_TFVARS" region)}"
      export CLOUDSDK_CORE_PROJECT="$PROJECT"
      ;;
    aws)
      [ -n "${STATE_BUCKET:-}" ] || die "STATE_BUCKET is required in $ENV_CONF"
      [ -n "${STATE_REGION:-}" ] || die "STATE_REGION is required in $ENV_CONF"
      if [ -n "${PROFILE:-}" ]; then
        export AWS_PROFILE="$PROFILE"
      fi
      ;;
    azure)
      [ -n "${STATE_RESOURCE_GROUP:-}" ] || die "STATE_RESOURCE_GROUP is required in $ENV_CONF"
      [ -n "${STATE_STORAGE_ACCOUNT:-}" ] || die "STATE_STORAGE_ACCOUNT is required in $ENV_CONF"
      [ -n "${STATE_CONTAINER:-}" ] || die "STATE_CONTAINER is required in $ENV_CONF"
      [ -n "${SUBSCRIPTION_ID:-}" ] || die "SUBSCRIPTION_ID is required in $ENV_CONF"
      [ -n "${LOCATION:-}" ] || die "LOCATION is required in $ENV_CONF"
      export ARM_SUBSCRIPTION_ID="$SUBSCRIPTION_ID"
      ;;
  esac
}

tf() {
  local dir="$1"
  shift
  run terraform -chdir="$dir" "$@"
}

tf_capture() {
  local placeholder="$1" dir="$2"
  shift 2
  capture "$placeholder" terraform -chdir="$dir" "$@"
}

state_key_for() {
  case "$CLOUD" in
    gcp) printf '%s/%s' "$STATE_PREFIX" "$1" ;;
    aws|azure) printf '%s/%s/terraform.tfstate' "$STATE_PREFIX" "$1" ;;
  esac
}

render_backend() {
  local stack="$1" key
  key="$(state_key_for "$stack")"
  case "$CLOUD" in
    gcp)
      sed -E "s|^([[:space:]]*bucket[[:space:]]*=[[:space:]]*).*|\1\"$STATE_BUCKET\"|; s|^([[:space:]]*prefix[[:space:]]*=[[:space:]]*).*|\1\"$key\"|" "$INFRA_STACK/backend.tf.example"
      ;;
    aws)
      sed -E "s|^([[:space:]]*bucket[[:space:]]*=[[:space:]]*).*|\1\"$STATE_BUCKET\"|; s|^([[:space:]]*key[[:space:]]*=[[:space:]]*).*|\1\"$key\"|; s|^([[:space:]]*region[[:space:]]*=[[:space:]]*).*|\1\"$STATE_REGION\"|" "$INFRA_STACK/backend.tf.example" |
        if [ -n "${PROFILE:-}" ]; then
          sed -E "s|^([[:space:]]*use_lockfile[[:space:]]*=[[:space:]]*).*|\1true\\
    profile      = \"$PROFILE\"|"
        else
          cat
        fi
      ;;
    azure)
      sed -E "s|^([[:space:]]*resource_group_name[[:space:]]*=[[:space:]]*).*|\1\"$STATE_RESOURCE_GROUP\"|; s|^([[:space:]]*storage_account_name[[:space:]]*=[[:space:]]*).*|\1\"$STATE_STORAGE_ACCOUNT\"|; s|^([[:space:]]*container_name[[:space:]]*=[[:space:]]*).*|\1\"$STATE_CONTAINER\"|; s|^([[:space:]]*key[[:space:]]*=[[:space:]]*).*|\1\"$key\"|; s|^([[:space:]]*use_azuread_auth[[:space:]]*=[[:space:]]*).*|\1true\\
    subscription_id      = \"$SUBSCRIPTION_ID\"|" "$INFRA_STACK/backend.tf.example"
      ;;
  esac
}

write_backend() {
  local dir="$1" stack="$2" content
  content="$(render_backend "$stack")"
  log "backend for $stack -> $dir/backend.tf"
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "$content" | sed 's/^/    /'
    return 0
  fi
  printf '%s\n' "$content" > "$dir/backend.tf"
}

bootstrap_backend_gcp() {
  if probe gcloud storage buckets describe "gs://$STATE_BUCKET" --project="$PROJECT"; then
    log "state bucket gs://$STATE_BUCKET exists"
  else
    run gcloud storage buckets create "gs://$STATE_BUCKET" --project="$PROJECT" --location="$STATE_LOCATION" --uniform-bucket-level-access
  fi
  run gcloud storage buckets update "gs://$STATE_BUCKET" --project="$PROJECT" --versioning
}

bootstrap_backend_aws() {
  if probe aws s3api head-bucket --bucket "$STATE_BUCKET" --region "$STATE_REGION"; then
    log "state bucket s3://$STATE_BUCKET exists"
  else
    if [ "$STATE_REGION" = "us-east-1" ]; then
      run aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$STATE_REGION"
    else
      run aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$STATE_REGION" --create-bucket-configuration "LocationConstraint=$STATE_REGION"
    fi
  fi
  run aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" --region "$STATE_REGION" --versioning-configuration Status=Enabled
  run aws s3api put-public-access-block --bucket "$STATE_BUCKET" --region "$STATE_REGION" --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  run aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" --region "$STATE_REGION" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
}

bootstrap_backend_azure() {
  run az account set --subscription "$SUBSCRIPTION_ID"
  if probe az group show --name "$STATE_RESOURCE_GROUP"; then
    log "resource group $STATE_RESOURCE_GROUP exists"
  else
    run az group create --name "$STATE_RESOURCE_GROUP" --location "$LOCATION"
  fi
  if probe az storage account show --name "$STATE_STORAGE_ACCOUNT" --resource-group "$STATE_RESOURCE_GROUP"; then
    log "storage account $STATE_STORAGE_ACCOUNT exists"
  else
    run az storage account create --name "$STATE_STORAGE_ACCOUNT" --resource-group "$STATE_RESOURCE_GROUP" --location "$LOCATION" --sku Standard_ZRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
  fi
  run az storage account blob-service-properties update --account-name "$STATE_STORAGE_ACCOUNT" --resource-group "$STATE_RESOURCE_GROUP" --enable-versioning true
  if probe az storage container show --name "$STATE_CONTAINER" --account-name "$STATE_STORAGE_ACCOUNT" --auth-mode login; then
    log "container $STATE_CONTAINER exists"
  else
    run az storage container create --name "$STATE_CONTAINER" --account-name "$STATE_STORAGE_ACCOUNT" --auth-mode login
  fi
}

bootstrap_backend() {
  log "bootstrapping state backend ($CLOUD)"
  "bootstrap_backend_$CLOUD"
}

platform_var_args() {
  PLATFORM_ARGS=(-var-file "$PLATFORM_TFVARS")
  case "$CLOUD" in
    gcp)
      PLATFORM_ARGS+=(-var "state_bucket=$STATE_BUCKET" -var "state_prefix=$(state_key_for 01-infra)")
      ;;
    aws)
      PLATFORM_ARGS+=(-var "state_bucket=$STATE_BUCKET" -var "state_key=$(state_key_for 01-infra)" -var "state_region=$STATE_REGION")
      if [ -n "${PROFILE:-}" ]; then
        PLATFORM_ARGS+=(-var "profile=$PROFILE")
      fi
      ;;
    azure)
      PLATFORM_ARGS+=(-var "state_resource_group_name=$STATE_RESOURCE_GROUP" -var "state_storage_account_name=$STATE_STORAGE_ACCOUNT" -var "state_container_name=$STATE_CONTAINER" -var "state_key=$(state_key_for 01-infra)")
      ;;
  esac
}

overlay_var_args() {
  local namespace infra_json
  OVERLAY_VARS_DIR="$(mktemp -d)"
  trap 'rm -rf "$OVERLAY_VARS_DIR"' EXIT
  OVERLAY_VARS_FILE="$OVERLAY_VARS_DIR/infra.tfvars.json"
  namespace="$(tf_capture xyne "$PLATFORM_STACK" output -raw namespace)"
  infra_json="$(tf_capture '{}' "$INFRA_STACK" output -json | jq -c 'map_values(.value)')"
  log "writing overlay variables infra (01-infra outputs) and namespace=$namespace to $OVERLAY_VARS_FILE"
  jq -n --argjson infra "$infra_json" --arg namespace "$namespace" '{infra: $infra, namespace: $namespace}' > "$OVERLAY_VARS_FILE"
  OVERLAY_ARGS=(-var-file "$OVERLAY_VARS_FILE")
  if [ -f "$OVERLAY_TFVARS" ]; then
    OVERLAY_ARGS+=(-var-file "$OVERLAY_TFVARS")
  fi
}

fetch_kubeconfig() {
  local cluster name region rg
  cluster="$(tf_capture '{"name":"<cluster.name>","region":"<cluster.region>"}' "$INFRA_STACK" output -json cluster)"
  name="$(printf '%s' "$cluster" | jq -r .name)"
  region="$(printf '%s' "$cluster" | jq -r .region)"
  log "fetching kubeconfig for $name ($region)"
  case "$CLOUD" in
    gcp)
      run gcloud container clusters get-credentials "$name" --region "$region" --project "$PROJECT"
      ;;
    aws)
      run aws eks update-kubeconfig --name "$name" --region "$region"
      ;;
    azure)
      rg="$(tf_capture '<resource_group_name>' "$INFRA_STACK" output -raw resource_group_name)"
      run az aks get-credentials --resource-group "$rg" --name "$name" --overwrite-existing
      run kubelogin convert-kubeconfig -l azurecli
      ;;
  esac
}

tf_plan_apply() {
  local dir="$1" label="$2"
  shift 2
  tf "$dir" init -reconfigure -input=false
  tf "$dir" plan -input=false -out=plan.tfplan "$@"
  if [ "$AUTO_APPROVE" != "1" ] && [ "$DRY_RUN" != "1" ]; then
    confirm "Apply the $label plan above?" || die "aborted before applying $label"
  fi
  tf "$dir" apply -input=false plan.tfplan
  if [ "$DRY_RUN" != "1" ]; then
    rm -f "$dir/plan.tfplan"
  fi
}

tf_destroy() {
  local dir="$1" label="$2" logfile status
  shift 2
  tf "$dir" init -reconfigure -input=false
  if [ "$DRY_RUN" = "1" ]; then
    tf "$dir" destroy -input=false -auto-approve "$@"
    return 0
  fi
  logfile="$(mktemp)"
  set +e
  run terraform -chdir="$dir" destroy -input=false -auto-approve "$@" 2>&1 | tee "$logfile"
  status="${PIPESTATUS[0]}"
  set -e
  if [ "$status" != "0" ]; then
    if grep -qiE 'deletion.?protection' "$logfile"; then
      printf '\n%s\n%s\n%s\n' \
        "destroy of $label was refused by a deletion_protection setting." \
        "Set the deletion protection flags to false in $INFRA_TFVARS (cluster_deletion_protection, postgres_deletion_protection where the cloud has them)," \
        "apply 01-infra once with setup.sh --only infra, then run destroy.sh again." >&2
    fi
    rm -f "$logfile"
    die "destroy of $label failed"
  fi
  rm -f "$logfile"
}
