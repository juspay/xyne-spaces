#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
TERRAFORM_DIR="$DEPLOYMENT_DIR/terraform"
ARGOCD_DIR="$DEPLOYMENT_DIR/argocd"

usage() {
  cat <<EOF
usage: validate.sh [--terraform-only] [--helm-only]

Checks everything under deployment/ that needs no cloud account and no cluster:

  terraform fmt -check -recursive over deployment/terraform
  terraform init -backend=false and terraform validate in every module and stack
  helm lint and helm template for deployment/argocd/root and every addon chart
  bash -n over deployment/scripts/*.sh

  --terraform-only  only the terraform checks
  --helm-only       only the helm checks

Prints one line per item and exits non-zero when any of them fails. Export
TF_PLUGIN_CACHE_DIR to reuse provider downloads across directories; each
directory's .terraform and .terraform.lock.hcl are removed afterwards.
EOF
}

DO_TERRAFORM=1
DO_HELM=1

while [ $# -gt 0 ]; do
  case "$1" in
    --terraform-only) DO_HELM=0; shift ;;
    --helm-only) DO_TERRAFORM=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; printf 'error: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

FAILED=0
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

export TF_IN_AUTOMATION=1
if [ -n "${TF_PLUGIN_CACHE_DIR:-}" ]; then
  mkdir -p "$TF_PLUGIN_CACHE_DIR"
  export TF_PLUGIN_CACHE_DIR
fi

rel() {
  printf '%s' "${1#"$DEPLOYMENT_DIR"/}"
}

pass() {
  printf 'ok    %s\n' "$1"
}

fail() {
  printf 'FAIL  %s\n' "$1"
  sed 's/^/      /' "$LOG" >&2
  FAILED=1
}

record() {
  local item="$1"
  shift
  if "$@" >"$LOG" 2>&1; then
    pass "$item"
  else
    fail "$item"
  fi
}

terraform_dirs() {
  local dir
  for dir in \
    "$TERRAFORM_DIR"/modules/*/ \
    "$TERRAFORM_DIR"/modules/gcp/*/ \
    "$TERRAFORM_DIR"/modules/aws/*/ \
    "$TERRAFORM_DIR"/modules/azure/*/ \
    "$TERRAFORM_DIR"/stacks/*/*/; do
    [ -d "$dir" ] || continue
    dir="${dir%/}"
    compgen -G "$dir/*.tf" >/dev/null || continue
    printf '%s\n' "$dir"
  done
}

terraform_check() {
  local dir="$1" item
  item="terraform validate $(rel "$dir")"
  if terraform -chdir="$dir" init -backend=false -input=false -no-color >"$LOG" 2>&1 &&
    terraform -chdir="$dir" validate -no-color >>"$LOG" 2>&1; then
    pass "$item"
  else
    fail "$item"
  fi
  rm -rf "$dir/.terraform" "$dir/.terraform.lock.hcl"
}

helm_template_check() {
  local chart="$1" label="$2"
  shift 2
  record "helm template $(rel "$chart") ($label)" helm template validate "$chart" --namespace argocd "$@"
}

helm_chart_check() {
  local chart="$1"
  record "helm lint $(rel "$chart")" helm lint "$chart" --quiet
  helm_template_check "$chart" defaults
}

if [ "$DO_TERRAFORM" = "1" ]; then
  command -v terraform >/dev/null 2>&1 || { printf 'error: terraform is not on PATH\n' >&2; exit 2; }
  record "terraform fmt $(rel "$TERRAFORM_DIR")" terraform fmt -check -recursive -no-color "$TERRAFORM_DIR"
  while IFS= read -r dir; do
    terraform_check "$dir"
  done < <(terraform_dirs)
fi

if [ "$DO_HELM" = "1" ]; then
  command -v helm >/dev/null 2>&1 || { printf 'error: helm is not on PATH\n' >&2; exit 2; }
  helm_chart_check "$ARGOCD_DIR/root"
  helm_template_check "$ARGOCD_DIR/root" "global.cloud=aws" --set global.cloud=aws
  for mode in gateway cloud-lb external; do
    helm_template_check "$ARGOCD_DIR/root" "ingress.mode=$mode" \
      --set global.domain=validate.example.com \
      --set infra.ingress.domain=validate.example.com \
      --set "infra.ingress.mode=$mode"
  done
  for tls in acme internal existing none; do
    helm_template_check "$ARGOCD_DIR/root" "ingress.tls=$tls" \
      --set global.domain=validate.example.com \
      --set infra.ingress.domain=validate.example.com \
      --set infra.ingress.mode=cloud-lb \
      --set "infra.ingress.tls=$tls"
  done
  for tls in acme internal; do
    helm_template_check "$ARGOCD_DIR/addons/platform-config" "gateway.tls=$tls" \
      --set "gateway.tls=$tls" --set "certManager.mode=$tls"
  done
  for tls in existing none; do
    helm_template_check "$ARGOCD_DIR/addons/platform-config" "gateway.tls=$tls" \
      --set "gateway.tls=$tls" --set certManager.enabled=false
  done
  for chart in "$ARGOCD_DIR"/addons/*/; do
    [ -f "${chart}Chart.yaml" ] || continue
    helm_chart_check "${chart%/}"
  done
fi

for script in "$SCRIPTS_DIR"/*.sh; do
  record "bash -n $(rel "$script")" bash -n "$script"
done

if [ "$FAILED" != "0" ]; then
  printf '\nvalidate: one or more checks failed\n' >&2
  exit 1
fi
printf '\nvalidate: all checks passed\n'
