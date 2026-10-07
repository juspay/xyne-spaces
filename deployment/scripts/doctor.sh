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
01-infra.tfvars and 02-platform.tfvars, every required stack variable, that
dns_zone exists and the domain is delegated to it, and that no placeholder
value from the examples remains.
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

check_aws_sso() {
  local profile session start_url minutes file
  [ "$DRY_RUN" = "1" ] && return 0
  need_cmd aws || return 0
  profile="${PROFILE:-default}"
  session="$(aws configure get sso_session --profile "$profile" 2>/dev/null || true)"
  if [ -n "$session" ]; then
    start_url="$(awk -v s="[sso-session $session]" '$0 == s { f = 1; next } /^\[/ { f = 0 } f && $1 == "sso_start_url" { print $3; exit }' "${AWS_CONFIG_FILE:-$HOME/.aws/config}")"
  else
    start_url="$(aws configure get sso_start_url --profile "$profile" 2>/dev/null || true)"
  fi
  [ -n "$start_url" ] || return 0
  minutes=""
  refreshable=""
  for file in "$HOME"/.aws/sso/cache/*.json; do
    [ -f "$file" ] || continue
    minutes="$(jq -r --arg u "$start_url" 'select(.startUrl == $u and .expiresAt != null) | ((.expiresAt | sub("\\.[0-9]+"; "") | fromdateiso8601) - now) / 60 | floor' "$file" 2>/dev/null || true)"
    refreshable="$(jq -r --arg u "$start_url" 'select(.startUrl == $u) | (.refreshToken != null)' "$file" 2>/dev/null || true)"
    [ -n "$minutes" ] && break
  done
  if [ -z "$minutes" ]; then
    record FAIL "aws sso session" "no SSO login found for $start_url; run: aws sso login"
  elif [ "$refreshable" = "true" ]; then
    record PASS "aws sso session" "refreshable until the Identity Center session ends (8h after aws sso login by default); on InvalidGrantException run aws sso login"
  elif [ "$minutes" -le 0 ]; then
    record FAIL "aws sso session" "expired; run: aws sso login (Terraform cannot refresh it, even while the CLI still works)"
  elif [ "$minutes" -lt 120 ]; then
    record WARN "aws sso session" "expires in ${minutes} min; run aws sso login before a long setup"
  else
    record PASS "aws sso session" "valid for $((minutes / 60))h"
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
  local stack="$1" tfvars="$2" secrets="$3" name label
  label="$(basename "$stack")"
  [ -f "$tfvars" ] || return 0
  for name in $(required_variables "$stack/variables.tf"); do
    if tfvar_set "$tfvars" "$name" && tfvar_set "$secrets" "$name"; then
      record FAIL "$label: $name" "set in both $(basename "$tfvars") and $(basename "$secrets"); keep it in one"
    elif tfvar_set "$tfvars" "$name"; then
      record PASS "$label: $name" "set"
    elif tfvar_set "$secrets" "$name"; then
      record PASS "$label: $name" "set in $(basename "$secrets")"
    elif script_supplied "$name"; then
      record PASS "$label: $name" "supplied by setup.sh from env.conf"
    else
      record FAIL "$label: $name" "required, not set in $(basename "$tfvars"); secrets.sh generates the secret ones"
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
    [ -n "$llm_key" ] || llm_key="$(tfvar_value "$PLATFORM_SECRETS" hindsight_llm_api_key)"
    if [ -n "$llm_key" ]; then
      record PASS "hindsight_llm_api_key" "set"
    else
      record FAIL "hindsight_llm_api_key" "required with enable_hindsight: hindsight-api exits at start without it (HINDSIGHT_API_LLM_API_KEY)"
    fi
  elif [ -n "$url" ]; then
    record PASS "hindsight" "using an existing instance at $url"
  else
    record WARN "hindsight" "no instance: claw long-term memory stays off (enable_hindsight, or hindsight.url)"
  fi
}

check_google() {
  local file id secret found=""
  for file in "$PLATFORM_SECRETS" "$PLATFORM_TFVARS"; do
    [ -f "$file" ] || continue
    id="$(tfvar_block_value "$file" app_secrets google_client_id)"
    secret="$(tfvar_block_value "$file" app_secrets google_client_secret)"
    if [ -n "$id$secret" ]; then
      found="$(basename "$file")"
      break
    fi
  done
  if [ -z "$found" ] || [ -z "$id" ] || [ -z "$secret" ]; then
    record FAIL "google sign-in client" "google_client_id and google_client_secret are required in app_secrets; see docs/reference/secrets.md#google-sign-in"
  elif printf '%s %s' "$id" "$secret" | grep -q 'replace-with-'; then
    record FAIL "google sign-in client" "still a placeholder in $found; see docs/reference/secrets.md#google-sign-in"
  elif ! printf '%s' "$id" | grep -qE '\.apps\.googleusercontent\.com$'; then
    record WARN "google sign-in client" "google_client_id in $found does not end in .apps.googleusercontent.com; sign-in will fail"
  else
    record PASS "google sign-in client" "set in $found"
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
      if [ -n "$(tfvar_value "$INFRA_TFVARS" ingress_certificate_arn)" ]; then
        record PASS "ingress certificate" "ingress_certificate_arn"
      elif [ -n "$(tfvar_value "$INFRA_TFVARS" dns_zone)" ]; then
        record PASS "ingress certificate" "ACM, validated in dns_zone"
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

check_kubernetes_version() {
  local version support status
  [ "$CLOUD" = "aws" ] || return 0
  [ -f "$INFRA_TFVARS" ] || return 0
  if [ "$DRY_RUN" = "1" ]; then
    record SKIP "kubernetes_version" "not checked with --dry-run"
    return 0
  fi
  version="$(tfvar_value "$INFRA_TFVARS" kubernetes_version)"
  [ -n "$version" ] || version="$(awk '/^variable "kubernetes_version"/ { f = 1 } f && /default/ { gsub(/"/, "", $3); print $3; exit }' "$INFRA_STACK/variables.tf")"
  support="$(tfvar_value "$INFRA_TFVARS" cluster_support_type)"
  [ -n "$support" ] || support="STANDARD"
  status="$(aws eks describe-cluster-versions --cluster-versions "$version" --query 'clusterVersions[0].versionStatus' --output text 2>/dev/null || true)"
  case "$status" in
    STANDARD_SUPPORT) record PASS "kubernetes_version" "$version, standard support" ;;
    EXTENDED_SUPPORT)
      if [ "$support" = "EXTENDED" ]; then
        record WARN "kubernetes_version" "$version is in extended support, billed extra"
      else
        record FAIL "kubernetes_version" "$version is only in extended support; raise kubernetes_version, or set cluster_support_type = \"EXTENDED\""
      fi
      ;;
    ""|None) record FAIL "kubernetes_version" "EKS does not offer $version (aws eks describe-cluster-versions)" ;;
    *) record WARN "kubernetes_version" "$version: $status" ;;
  esac
}

check_pool_capacity() {
  local pool="$1" flag="$2" default_type="$3" hint="$4" type region offered
  [ "$CLOUD" = "aws" ] || return 0
  [ "$(tfvar_value "$INFRA_TFVARS" "$flag")" = "true" ] || return 0
  if [ "$DRY_RUN" = "1" ]; then
    record SKIP "$pool instance type" "not checked with --dry-run"
    return 0
  fi
  type="$(tfvar_block_value "$INFRA_TFVARS" "$pool" instance_type)"
  [ -n "$type" ] || type="$default_type"
  region="$(tfvar_value "$INFRA_TFVARS" region)"
  offered="$(aws ec2 describe-instance-type-offerings --region "$region" --location-type availability-zone --filters "Name=instance-type,Values=$type" --query 'length(InstanceTypeOfferings)' --output text 2>/dev/null || true)"
  if [ -z "$offered" ] || [ "$offered" = "0" ]; then
    record FAIL "$pool instance type" "$type is not offered in $region; set node_pools.$pool.instance_type to $hint that is"
  else
    record PASS "$pool instance type" "$type, offered in $offered zone(s) of $region"
  fi
}

check_sandbox_capacity() {
  check_pool_capacity sandbox sandbox_enabled m5.metal "an x86_64 .metal type"
  check_pool_capacity gpu gpu_enabled g6.xlarge "an NVIDIA GPU type (g4dn, g5, g6, ...)"
}

check_vespa() {
  [ -f "$PLATFORM_TFVARS" ] || return 0
  [ "$(tfvar_value "$PLATFORM_TFVARS" enable_vespa)" = "true" ] || return 0
  if [ "$(tfvar_value "$INFRA_TFVARS" vespa_enabled)" = "true" ]; then
    record PASS "vespa pool" "vespa_enabled"
  else
    record WARN "vespa pool" "vespa_enabled is off: the Vespa roles (about 22 GiB of requests) land on the general pool"
  fi
  if grep -Eq 'embedder:[[:space:]]*\{[[:space:]]*enabled:[[:space:]]*false' "$PLATFORM_TFVARS"; then
    record PASS "vespa embedder" "disabled; point values.app.embedder at your own OpenAI-compatible endpoint"
  elif [ "$(tfvar_value "$INFRA_TFVARS" gpu_enabled)" = "true" ]; then
    record PASS "vespa embedder" "runs on the gpu pool"
  else
    record FAIL "vespa embedder" "the embedder needs a GPU node: set gpu_enabled = true in 01-infra.tfvars"
  fi
  if grep -q 'ENABLE_VESPA_WORKER' "$PLATFORM_TFVARS"; then
    record PASS "vespa ingestion worker" "a worker sets ENABLE_VESPA_WORKER"
  else
    record WARN "vespa ingestion worker" "no worker sets ENABLE_VESPA_WORKER, so nothing is indexed into Vespa (docs/features/search.md#turn-it-on)"
  fi
}

check_dns() {
  local zone domain zone_json zone_name zone_ns live rg
  [ -f "$INFRA_TFVARS" ] || return 0
  zone="$(tfvar_value "$INFRA_TFVARS" dns_zone)"
  domain="$(tfvar_value "$INFRA_TFVARS" domain)"
  if [ -z "$zone" ]; then
    record PASS "dns_zone" "empty: setup.sh prints the records to create by hand"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    record SKIP "dns_zone" "not checked with --dry-run"
    return 0
  fi

  case "$CLOUD" in
    aws)
      zone_json="$(aws route53 get-hosted-zone --id "$zone" --output json 2>/dev/null | jq -c '{name: .HostedZone.Name, ns: .DelegationSet.NameServers}' || true)"
      ;;
    gcp)
      zone_json="$(gcloud dns managed-zones describe "$zone" --project "$PROJECT" --format json 2>/dev/null | jq -c '{name: .dnsName, ns: .nameServers}' || true)"
      ;;
    azure)
      rg="$(tfvar_value "$INFRA_TFVARS" dns_zone_resource_group)"
      if [ -z "$rg" ]; then
        record WARN "dns_zone" "not checked: dns_zone_resource_group is empty, so the zone would have to live in the resource group 01-infra creates"
        return 0
      fi
      zone_json="$(az network dns zone show --resource-group "$rg" --name "$zone" --output json 2>/dev/null | jq -c '{name: .name, ns: .nameServers}' || true)"
      ;;
  esac
  if [ -z "$zone_json" ]; then
    record FAIL "dns_zone" "$zone not found; create it with dns.sh --env $ENV_NAME zone"
    return 0
  fi

  zone_name="$(printf '%s' "$zone_json" | jq -r '.name | ascii_downcase | sub("\\.$"; "")')"
  case "$domain" in
    "$zone_name"|*".$zone_name") record PASS "dns_zone" "$zone ($zone_name)" ;;
    *) record FAIL "dns_zone" "domain $domain is not $zone_name or a name under it"; return 0 ;;
  esac

  zone_ns="$(printf '%s' "$zone_json" | jq -r '.ns[] | ascii_downcase | sub("\\.$"; "")' | sort -u)"
  live="$(dig +short NS "$zone_name" 2>/dev/null | tr '[:upper:]' '[:lower:]' | sed -E 's/\.$//' | grep -v '^$' | sort -u || true)"
  if [ -z "$live" ]; then
    record WARN "dns delegation" "$zone_name has no public NS yet; certificates cannot be issued until it does (dns.sh --env $ENV_NAME status)"
  elif [ "$live" = "$zone_ns" ]; then
    record PASS "dns delegation" "$zone_name points at the zone"
  else
    record WARN "dns delegation" "$zone_name points at other name servers; fix with dns.sh --env $ENV_NAME zone"
  fi
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
    check_aws_sso
    ;;
  azure)
    check_tool az
    check_tool kubelogin
    check_auth "az auth" show az account show --output tsv --query name
    ;;
esac

check_file "$INFRA_TFVARS"
check_file "$PLATFORM_TFVARS"
check_required_vars "$INFRA_STACK" "$INFRA_TFVARS" "$INFRA_SECRETS"
check_required_vars "$PLATFORM_STACK" "$PLATFORM_TFVARS" "$PLATFORM_SECRETS"
check_network
check_ingress
check_kubernetes_version
check_sandbox_capacity
check_vespa
check_dns
check_google
check_hindsight
check_placeholders "$ENV_CONF"
check_placeholders "$INFRA_TFVARS"
check_placeholders "$PLATFORM_TFVARS"
check_placeholders "$INFRA_SECRETS"
check_placeholders "$PLATFORM_SECRETS"
if [ -f "$OVERLAY_TFVARS" ]; then
  check_placeholders "$OVERLAY_TFVARS"
fi

print_table

if [ "$FAILED" = "1" ]; then
  log "doctor: FAIL"
  exit 1
fi
log "doctor: PASS"
