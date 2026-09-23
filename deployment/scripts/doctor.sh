#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<EOF
usage: doctor.sh --env <env> [--env-dir <path>] [--dry-run]

Checks that the workstation, the cloud session and the environment directory
are ready for setup.sh.

  --env <env>       environment name: the directory <env-dir>/<env>/
  --env-dir <path>  directory holding environments (default: $ENV_DIR_BASE);
                    use it for environments kept in another repository
  --dry-run         skip cloud authentication and placeholder checks and
                    report missing tools as warnings; file checks still apply

Checks: terraform >= $MIN_TERRAFORM, helm >= $MIN_HELM, kubectl, jq, yq, the
cloud CLI for CLOUD in env.conf and its authentication, env.conf,
01-infra.tfvars and 02-platform.tfvars, every required stack variable, and
that no placeholder value from the examples remains.
EOF
}

MIN_TERRAFORM="1.6.0"
MIN_HELM="3.14.0"
STATUSES=()
NAMES=()
DETAILS=()
FAILED=0

record() {
  STATUSES+=("$1")
  NAMES+=("$2")
  DETAILS+=("$3")
  if [ "$1" = "FAIL" ]; then
    FAILED=1
  fi
}

missing_status() {
  if [ "$DRY_RUN" = "1" ]; then
    printf 'WARN'
  else
    printf 'FAIL'
  fi
}

tool_version() {
  case "$1" in
    terraform) terraform version 2>/dev/null | head -n1 | sed -E 's/^Terraform v//; s/[[:space:]].*$//' ;;
    helm) helm version --short 2>/dev/null | sed -E 's/^v//; s/[+-].*$//' ;;
    kubectl) kubectl version --client 2>/dev/null | grep -E '^Client Version' | sed -E 's/.*v([0-9]+\.[0-9]+\.[0-9]+).*/\1/' ;;
    jq) jq --version 2>/dev/null | sed -E 's/^jq-//' ;;
    yq) yq --version 2>/dev/null | sed -E 's/.*version v?//; s/[[:space:]].*$//' ;;
    gcloud) gcloud version 2>/dev/null | grep -E '^Google Cloud SDK' | sed -E 's/^Google Cloud SDK //' ;;
    aws) aws --version 2>/dev/null | sed -E 's|^aws-cli/||; s/[[:space:]].*$//' ;;
    az) az version --output tsv --query '"azure-cli"' 2>/dev/null ;;
    kubelogin) kubelogin --version 2>/dev/null | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | head -n1 ;;
    *) printf 'present' ;;
  esac
}

check_tool() {
  local name="$1" min="${2:-}" version
  if ! need_cmd "$name"; then
    record "$(missing_status)" "$name" "not found in PATH"
    return 0
  fi
  version="$(tool_version "$name")"
  [ -n "$version" ] || version="present"
  if [ -n "$min" ]; then
    if version_ge "$version" "$min"; then
      record PASS "$name >= $min" "$version"
    else
      record FAIL "$name >= $min" "$version is too old"
    fi
  else
    record PASS "$name" "$version"
  fi
}

check_auth() {
  local name="$1" show="$2" detail
  shift 2
  if [ "$DRY_RUN" = "1" ]; then
    record SKIP "$name" "not checked with --dry-run"
    return 0
  fi
  if ! need_cmd "$1"; then
    record FAIL "$name" "$1 not found in PATH"
    return 0
  fi
  if detail="$("$@" 2>/dev/null)"; then
    if [ "$show" = "show" ]; then
      record PASS "$name" "$(printf '%s' "$detail" | head -n1 | cut -c1-60)"
    else
      record PASS "$name" "ok"
    fi
  else
    record FAIL "$name" "$(quote_args "$@") failed; log in first"
  fi
}

check_file() {
  if [ -f "$1" ]; then
    record PASS "$(basename "$1")" "$1"
  else
    record FAIL "$(basename "$1")" "missing: $1"
  fi
}

script_supplied() {
  case "$1" in
    state_bucket|state_prefix|state_key|state_region|profile|state_resource_group_name|state_storage_account_name|state_container_name) return 0 ;;
  esac
  return 1
}

check_required_vars() {
  local stack="$1" tfvars="$2" name label
  label="$(basename "$stack")"
  [ -f "$tfvars" ] || return 0
  for name in $(required_variables "$stack/variables.tf"); do
    if tfvar_set "$tfvars" "$name"; then
      record PASS "$label: $name" "set"
    elif script_supplied "$name"; then
      record PASS "$label: $name" "supplied by setup.sh from env.conf"
    else
      record FAIL "$label: $name" "required, not set in $(basename "$tfvars")"
    fi
  done
}

check_placeholders() {
  local file="$1" hits
  [ -f "$file" ] || return 0
  if [ "$DRY_RUN" = "1" ]; then
    record SKIP "placeholders in $(basename "$file")" "not checked with --dry-run"
    return 0
  fi
  hits="$(grep -nE 'replace-with-|example-project|example-account|example-tfstate|exampletfstate|xyneexamplestorage|acme-spaces-prod|spaces\.example\.com|Z0123456789EXAMPLE|123456789012|00000000-0000-0000-0000-000000000000' "$file" || true)"
  if [ -z "$hits" ]; then
    record PASS "placeholders in $(basename "$file")" "none"
    return 0
  fi
  printf '%s\n' "$hits" | sed -E 's/^([0-9]+):[[:space:]]*/line \1: /' > "$PLACEHOLDER_TMP"
  while IFS= read -r line; do
    record FAIL "placeholders in $(basename "$file")" "$(printf '%s' "$line" | cut -c1-70)"
  done < "$PLACEHOLDER_TMP"
}

# Reads one key from inside a named block, so a `url` nested in apps.*.values,
# addon_values or overlay_sources is not mistaken for hindsight's own.
tfvar_block_value() {
  local file="$1" block="$2" key="$3"
  [ -f "$file" ] || return 0
  awk -v block="$block" -v key="$key" '
    $0 ~ "^[[:space:]]*" block "[[:space:]]*=[[:space:]]*\\{" { inblock = 1; next }
    inblock && /^[[:space:]]*\}/ { exit }
    inblock && $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, ""); gsub(/"/, ""); sub(/[[:space:]]*$/, ""); print; exit
    }
  ' "$file"
}

check_hindsight() {
  local enabled url llm_key
  [ -f "$PLATFORM_TFVARS" ] || return 0
  enabled="$(tfvar_value "$PLATFORM_TFVARS" enable_hindsight)"
  url="$(tfvar_block_value "$PLATFORM_TFVARS" hindsight url)"

  if [ "$enabled" = "true" ]; then
    record PASS "hindsight" "deployed by this install"
    llm_key="$(tfvar_value "$PLATFORM_TFVARS" hindsight_llm_api_key)"
    if [ -n "$llm_key" ]; then
      record PASS "hindsight_llm_api_key" "set"
    else
      record WARN "hindsight_llm_api_key" "empty; Hindsight starts but cannot extract facts without an LLM key"
    fi
  elif [ -n "$url" ]; then
    record PASS "hindsight" "using an existing instance at $url"
  else
    record WARN "hindsight" "no instance: claw long-term memory stays off (enable_hindsight, or hindsight.url)"
  fi
}

check_network() {
  [ -f "$INFRA_TFVARS" ] || return 0

  case "$CLOUD" in
    gcp) tfvar_set "$INFRA_TFVARS" master_authorized_networks && record PASS "master_authorized_networks" "set" || record FAIL "master_authorized_networks" "set it, or enable_private_endpoint = true, or the API server has no public endpoint" ;;
    aws)
      tfvar_set "$INFRA_TFVARS" eks_public_access_cidrs && record PASS "eks_public_access_cidrs" "set" || record FAIL "eks_public_access_cidrs" "set it, or enable_private_endpoint = true, or the API server has no public endpoint"
      tfvar_set "$INFRA_TFVARS" internet_egress_cidrs && record PASS "internet_egress_cidrs" "set" || record FAIL "internet_egress_cidrs" "required: [\"0.0.0.0/0\"] for ordinary egress through NAT, or your proxy ranges"
      ;;
    azure) tfvar_set "$INFRA_TFVARS" aks_authorized_ip_ranges && record PASS "aks_authorized_ip_ranges" "set" || record FAIL "aks_authorized_ip_ranges" "set it, or enable_private_endpoint = true, or the API server has no public endpoint" ;;
  esac
}

check_ingress() {
  local mode tls
  [ -f "$INFRA_TFVARS" ] || return 0
  mode="$(tfvar_value "$INFRA_TFVARS" ingress_mode)"
  [ -n "$mode" ] || mode="gateway"
  case "$mode" in
    gateway|cloud-lb|external) record PASS "ingress_mode" "$mode" ;;
    *) record FAIL "ingress_mode" "$mode is not gateway, cloud-lb or external"; return 0 ;;
  esac

  tls="$(tfvar_value "$INFRA_TFVARS" ingress_tls)"
  if [ -n "$tls" ]; then
    case "$tls" in
      acme|internal|existing|none) record PASS "ingress_tls" "$tls" ;;
      *) record FAIL "ingress_tls" "$tls is not acme, internal, existing or none" ;;
    esac
    if [ "$tls" = "none" ] && [ "$mode" = "gateway" ]; then
      record FAIL "ingress_tls" "none needs ingress_mode cloud-lb or external"
    fi
    if [ "$tls" = "existing" ] && ! tfvar_set "$PLATFORM_TFVARS" gateway_tls; then
      record FAIL "gateway_tls" "ingress_tls is existing, so 02-platform must set gateway_tls"
    fi
  fi

  [ "$mode" = "cloud-lb" ] || return 0

  case "$CLOUD" in
    gcp)
      if tfvar_set "$INFRA_TFVARS" ingress_certificate_ids ||
        tfvar_set "$INFRA_TFVARS" ingress_certificate_pem ||
        tfvar_set "$INFRA_TFVARS" ingress_certificate_domains; then
        record PASS "ingress certificate" "set"
      else
        record FAIL "ingress certificate" "cloud-lb needs ingress_certificate_ids, ingress_certificate_pem or ingress_certificate_domains"
      fi
      ;;
    aws)
      if tfvar_set "$INFRA_TFVARS" ingress_certificate_arn || tfvar_set "$INFRA_TFVARS" dns_zone; then
        record PASS "ingress certificate" "set"
      else
        record FAIL "ingress certificate" "cloud-lb needs ingress_certificate_arn, or dns_zone so ACM can validate"
      fi
      ;;
    azure)
      if tfvar_set "$INFRA_TFVARS" ingress_certificate_key_vault_secret_id ||
        tfvar_set "$INFRA_TFVARS" ingress_certificate_pfx_data; then
        record PASS "ingress certificate" "set"
      else
        record FAIL "ingress certificate" "cloud-lb needs ingress_certificate_key_vault_secret_id or ingress_certificate_pfx_data"
      fi
      if tfvar_set "$INFRA_TFVARS" ingress_internal_ip; then
        record PASS "ingress_internal_ip" "set"
      else
        record FAIL "ingress_internal_ip" "cloud-lb on azure needs a private address for the internal load balancer"
      fi
      ;;
  esac
}

print_table() {
  local i
  printf '\n%-6s  %-44s  %s\n' STATUS CHECK DETAIL
  printf '%-6s  %-44s  %s\n' ------ -------------------------------------------- ------
  i=0
  while [ "$i" -lt "${#STATUSES[@]}" ]; do
    printf '%-6s  %-44s  %s\n' "${STATUSES[$i]}" "${NAMES[$i]}" "${DETAILS[$i]}"
    i=$((i + 1))
  done
  printf '\n'
}

ENV_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_ARG="${2:-}"; shift 2 ;;
    --env-dir) set_env_dir_base "${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

resolve_env "$ENV_ARG"
check_file "$ENV_CONF"
if [ ! -f "$ENV_CONF" ]; then
  print_table
  exit 1
fi
load_env "$ENV_ARG"
PLACEHOLDER_TMP="$(mktemp)"
trap 'rm -f "$PLACEHOLDER_TMP"' EXIT

log "doctor: env=$ENV_NAME cloud=$CLOUD dir=$ENV_DIR"

check_tool terraform "$MIN_TERRAFORM"
check_tool helm "$MIN_HELM"
check_tool kubectl
check_tool jq
check_tool yq

case "$CLOUD" in
  gcp)
    check_tool gcloud
    check_tool gke-gcloud-auth-plugin
    check_auth "gcloud auth" hide gcloud auth print-access-token
    ;;
  aws)
    check_tool aws
    check_auth "aws auth" show aws sts get-caller-identity --output text --query Arn
    ;;
  azure)
    check_tool az
    check_tool kubelogin
    check_auth "az auth" show az account show --output tsv --query name
    ;;
esac

check_file "$INFRA_TFVARS"
check_file "$PLATFORM_TFVARS"
check_required_vars "$INFRA_STACK" "$INFRA_TFVARS"
check_required_vars "$PLATFORM_STACK" "$PLATFORM_TFVARS"
check_network
check_ingress
check_hindsight
check_placeholders "$ENV_CONF"
check_placeholders "$INFRA_TFVARS"
check_placeholders "$PLATFORM_TFVARS"
if [ -f "$OVERLAY_TFVARS" ]; then
  check_placeholders "$OVERLAY_TFVARS"
fi

print_table

if [ "$FAILED" = "1" ]; then
  log "doctor: FAIL"
  exit 1
fi
log "doctor: PASS"
