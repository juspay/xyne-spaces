#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<EOF
usage: setup.sh --env <env> [--env-dir <path>] [--skip-infra] [--skip-platform]
                [--only infra|platform|overlay] [--auto-approve] [--dry-run]
                [--skip-doctor] [--skip-dns-gate] [--argo-timeout <seconds>]

Brings up one environment end to end: doctor, state backend, the ingress
addresses, 01-infra, kubeconfig, 02-platform, the optional overlay, then waits
for Argo CD and prints how to reach the install.

The ingress addresses are reserved before the network and the cluster are
built, so the records can be created and propagate while the slow part of the
build runs. See docs/ingress.md.

  --env <env>              environment name: the directory <env-dir>/<env>/ with
                           env.conf, 01-infra.tfvars, 02-platform.tfvars and the
                           optional overlay/ directory and overlay.tfvars
  --env-dir <path>         directory holding environments (default: $ENV_DIR_BASE);
                           use it for environments kept in another repository
  --skip-infra             do not plan or apply 01-infra
  --skip-platform          do not plan or apply 02-platform
  --only <stage>           run a single stage: infra, platform or overlay
  --auto-approve           apply every plan without asking
  --dry-run                print every command instead of running it; doctor runs
                           without cloud authentication and placeholder checks
  --skip-doctor            do not run doctor.sh first
  --skip-dns-gate          do not reserve the ingress addresses first and do
                           not wait for the DNS records to be created
  --argo-timeout <seconds> how long to wait for every Argo CD Application to be
                           Synced and Healthy (default: $ARGO_TIMEOUT)

Terraform state lives in the backend described by env.conf; each stack's
backend.tf is written from its backend.tf.example and is never committed.
EOF
}

ARGO_TIMEOUT=1800
ENV_ARG=""
SKIP_DOCTOR=0
DNS_GATE=1
DO_INFRA=1
DO_PLATFORM=1
DO_OVERLAY=1

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_ARG="${2:-}"; shift 2 ;;
    --env-dir) set_env_dir_base "${2:-}"; shift 2 ;;
    --skip-infra) DO_INFRA=0; shift ;;
    --skip-platform) DO_PLATFORM=0; shift ;;
    --only)
      case "${2:-}" in
        infra) DO_INFRA=1; DO_PLATFORM=0; DO_OVERLAY=0 ;;
        platform) DO_INFRA=0; DO_PLATFORM=1; DO_OVERLAY=0 ;;
        overlay) DO_INFRA=0; DO_PLATFORM=0; DO_OVERLAY=1 ;;
        *) usage >&2; die "--only takes infra, platform or overlay" ;;
      esac
      shift 2
      ;;
    --auto-approve) AUTO_APPROVE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-doctor) SKIP_DOCTOR=1; shift ;;
    --skip-dns-gate) DNS_GATE=0; shift ;;
    --argo-timeout) ARGO_TIMEOUT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

load_env "$ENV_ARG"
log "setup: env=$ENV_NAME cloud=$CLOUD dir=$ENV_DIR dry_run=$DRY_RUN"

if [ "$SKIP_DOCTOR" != "1" ]; then
  DOCTOR_ARGS=(--env "$ENV_NAME" --env-dir "$ENV_DIR_BASE")
  if [ "$DRY_RUN" = "1" ]; then
    DOCTOR_ARGS+=(--dry-run)
  fi
  "$SCRIPTS_DIR/doctor.sh" "${DOCTOR_ARGS[@]}"
fi

bootstrap_backend

address_targets() {
  local mode="$1"
  case "$CLOUD:$mode" in
    gcp:gateway) printf '%s\n' google_compute_address.ingress ;;
    gcp:cloud-lb) printf '%s\n' module.ingress.google_compute_global_address.this ;;
    aws:cloud-lb) printf '%s\n' module.ingress.aws_eip.this ;;
    azure:gateway) printf '%s\n' azurerm_public_ip.ingress ;;
    azure:cloud-lb) printf '%s\n' module.ingress.azurerm_public_ip.this ;;
  esac
}

reserve_addresses() {
  local mode domain zone args target addresses gateway edge dns
  mode="$(tfvar_value "$INFRA_TFVARS" ingress_mode)"
  [ -n "$mode" ] || mode="gateway"
  domain="$(tfvar_value "$INFRA_TFVARS" domain)"
  [ -n "$domain" ] || domain="<domain>"
  zone="$(tfvar_value "$INFRA_TFVARS" dns_zone)"

  log "stage ingress addresses"

  if [ "$mode" = "external" ]; then
    printf '\n%s\n' "ingress_mode is external, so no address is reserved here."
    printf '%s\n' "point these names at the load balancer you run:"
    printf '  %-28s -> %s\n' "$domain" "<your load balancer>"
    printf '  %-28s -> %s\n' "*.$domain" "<your load balancer>"
    printf '%s\n\n' "configure it with: $SCRIPTS_DIR/lb-config.sh --env $ENV_NAME --env-dir $ENV_DIR_BASE --format all"
    confirm "Continue with the network and cluster build?" || die "stopped before 01-infra"
    return 0
  fi

  args=()
  while IFS= read -r target; do
    [ -n "$target" ] || continue
    args+=(-target "$target")
  done <<EOF
$(address_targets "$mode")
EOF

  if [ "${#args[@]}" -eq 0 ]; then
    log "no reservable address on $CLOUD in $mode mode, continuing"
    return 0
  fi
  infra_var_args
  args=("${INFRA_ARGS[@]}" "${args[@]}")

  tf "$INFRA_STACK" init -reconfigure -input=false
  confirm "Reserve the public address(es) for $domain now?" || die "stopped before reserving addresses"
  tf "$INFRA_STACK" apply -input=false -auto-approve "${args[@]}"

  addresses="$(tf_capture '{"gateway":"<gateway address>","edge":"<edge address>"}' "$INFRA_STACK" output -json ingress_addresses)"
  gateway="$(printf '%s' "$addresses" | jq -r '.gateway // ""')"
  edge="$(printf '%s' "$addresses" | jq -r '.edge // ""')"
  dns="$edge"
  [ -n "$dns" ] || dns="$gateway"

  if [ -z "$dns" ]; then
    log "no address reserved for this mode, continuing"
    return 0
  fi

  if [ -n "$zone" ]; then
    printf '\n%s\n' "01-infra writes these records in zone $zone:"
  else
    printf '\n%s\n' "create these records now, the build continues once they resolve:"
  fi
  printf '  %-28s -> %s\n' "$domain" "$dns"
  printf '  %-28s -> %s\n\n' "*.$domain" "$dns"

  confirm "Continue with the network and cluster build?" || die "stopped before 01-infra"
}

build_cluster_first() {
  local mode
  mode="$(tfvar_value "$INFRA_TFVARS" ingress_mode)"
  [ "$mode" = "cloud-lb" ] || return 0
  [ "$CLOUD" = "gcp" ] || return 0
  if [ "$DRY_RUN" != "1" ] && terraform -chdir="$INFRA_STACK" state list module.cluster >/dev/null 2>&1; then
    return 0
  fi

  log "stage cluster (cloud-lb on gcp needs the node pools before the load balancer)"
  tf "$INFRA_STACK" init -reconfigure -input=false
  infra_var_args
  tf "$INFRA_STACK" apply -input=false -auto-approve "${INFRA_ARGS[@]}" -target module.cluster
}

if [ "$DO_INFRA" = "1" ]; then
  write_backend "$INFRA_STACK" 01-infra
  if [ "$DNS_GATE" = "1" ]; then
    reserve_addresses
  fi
  build_cluster_first
  log "stage 01-infra"
  infra_var_args
  tf_plan_apply "$INFRA_STACK" 01-infra "${INFRA_ARGS[@]}"
fi

if [ "$DO_PLATFORM" = "1" ] || [ "$DO_OVERLAY" = "1" ]; then
  fetch_kubeconfig
fi

if [ "$DO_PLATFORM" = "1" ]; then
  log "stage 02-platform"
  write_backend "$PLATFORM_STACK" 02-platform
  platform_var_args
  tf_plan_apply "$PLATFORM_STACK" 02-platform "${PLATFORM_ARGS[@]}"
fi

if [ "$DO_OVERLAY" = "1" ]; then
  if [ -d "$OVERLAY_DIR" ]; then
    log "stage overlay ($OVERLAY_DIR)"
    write_backend "$OVERLAY_DIR" overlay
    overlay_var_args
    tf_plan_apply "$OVERLAY_DIR" overlay "${OVERLAY_ARGS[@]}"
  else
    log "no overlay directory at $OVERLAY_DIR, skipping"
  fi
fi

wait_for_argo() {
  local ns="$1" deadline now rows pending
  run kubectl -n "$ns" wait --for="jsonpath={.status.health.status}=Healthy" application/xyne-root --timeout=600s
  printf '+ %s\n' "kubectl -n $ns get applications -o json | jq -r '.items[] | [.metadata.name, .status.sync.status, .status.health.status] | @tsv'"
  if [ "$DRY_RUN" = "1" ]; then
    log "would poll every 30s until every Application is Synced and Healthy or ${ARGO_TIMEOUT}s pass"
    return 0
  fi
  deadline=$(( $(date +%s) + ARGO_TIMEOUT ))
  while :; do
    rows="$(kubectl -n "$ns" get applications -o json | jq -r '.items[] | [.metadata.name, (.status.sync.status // "Unknown"), (.status.health.status // "Unknown")] | @tsv')"
    printf '\n%-40s %-12s %s\n' APPLICATION SYNC HEALTH
    printf '%s\n' "$rows" | awk -F '\t' '{ printf "%-40s %-12s %s\n", $1, $2, $3 }'
    pending="$(printf '%s\n' "$rows" | awk -F '\t' '$2 != "Synced" || $3 != "Healthy" { c++ } END { print c + 0 }')"
    if [ "$pending" = "0" ]; then
      log "all Argo CD Applications are Synced and Healthy"
      return 0
    fi
    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
      die "$pending Application(s) still not Synced and Healthy after ${ARGO_TIMEOUT}s"
    fi
    log "$pending Application(s) pending, checking again in 30s"
    sleep 30
  done
}

ARGOCD_NS="argocd"
if [ "$DO_PLATFORM" = "1" ] || [ "$DO_OVERLAY" = "1" ]; then
  ARGOCD_NS="$(tf_capture argocd "$PLATFORM_STACK" output -raw argocd_namespace)"
  log "waiting for Argo CD in namespace $ARGOCD_NS"
  wait_for_argo "$ARGOCD_NS"
fi

PLANNED_DOMAIN="$(tfvar_value "$INFRA_TFVARS" domain)"
[ -n "$PLANNED_DOMAIN" ] || PLANNED_DOMAIN="<domain>"
PLANNED_DNS_ZONE="$(tfvar_value "$INFRA_TFVARS" dns_zone)"
PLANNED_LIVEKIT="$(tfvar_value "$INFRA_TFVARS" livekit_enabled)"
case "$PLANNED_LIVEKIT" in true|false) ;; *) PLANNED_LIVEKIT=false ;; esac

PLANNED_MODE="$(tfvar_value "$INFRA_TFVARS" ingress_mode)"
[ -n "$PLANNED_MODE" ] || PLANNED_MODE="gateway"

INGRESS_JSON="$(tf_capture "$(jq -nc --arg domain "$PLANNED_DOMAIN" --arg zone "$PLANNED_DNS_ZONE" --arg mode "$PLANNED_MODE" '{domain: $domain, static_ip: "", dns_zone: $zone, mode: $mode, edge: {ip: "", hostname: ""}}')" "$INFRA_STACK" output -json ingress)"
LIVEKIT_JSON="$(tf_capture "$(jq -nc --arg domain "$PLANNED_DOMAIN" --argjson on "$PLANNED_LIVEKIT" '{enabled: $on, url: (if $on then "wss://livekit." + $domain else "" end), turn_host: (if $on then "turn." + $domain else "" end)}')" "$INFRA_STACK" output -json livekit)"
DOMAIN="$(printf '%s' "$INGRESS_JSON" | jq -r .domain)"
STATIC_IP="$(printf '%s' "$INGRESS_JSON" | jq -r '.static_ip // ""')"
DNS_ZONE="$(printf '%s' "$INGRESS_JSON" | jq -r '.dns_zone // ""')"
INGRESS_MODE="$(printf '%s' "$INGRESS_JSON" | jq -r '.mode // "gateway"')"
EDGE_IP="$(printf '%s' "$INGRESS_JSON" | jq -r '.edge.ip // ""')"
EDGE_HOSTNAME="$(printf '%s' "$INGRESS_JSON" | jq -r '.edge.hostname // ""')"
LIVEKIT_ENABLED="$(printf '%s' "$LIVEKIT_JSON" | jq -r '.enabled // false')"
LIVEKIT_URL="$(printf '%s' "$LIVEKIT_JSON" | jq -r '.url // ""')"
LIVEKIT_TURN="$(printf '%s' "$LIVEKIT_JSON" | jq -r '.turn_host // ""')"
LIVEKIT_SIGNAL_ADDRESS=""
LIVEKIT_TURN_ADDRESS=""
if [ "$LIVEKIT_ENABLED" = "true" ]; then
  case "$CLOUD" in
    gcp)
      LIVEKIT_SIGNAL_ADDRESS="$(tf_capture '"<livekit lb ip>"' "$INFRA_STACK" output -json livekit_lb_ip | jq -r '. // ""')"
      LIVEKIT_TURN_ADDRESS="$LIVEKIT_SIGNAL_ADDRESS"
      ;;
    aws)
      LIVEKIT_ADDRESSES="$(tf_capture '{"signal":"<signal lb dns name>","turn":"<turn lb dns name>"}' "$INFRA_STACK" output -json livekit_lb_dns_names)"
      LIVEKIT_SIGNAL_ADDRESS="$(printf '%s' "$LIVEKIT_ADDRESSES" | jq -r '.signal // ""')"
      LIVEKIT_TURN_ADDRESS="$(printf '%s' "$LIVEKIT_ADDRESSES" | jq -r '.turn // ""')"
      ;;
    azure)
      LIVEKIT_ADDRESSES="$(tf_capture '{"signal":"<signal ip>","turn":"<turn ip>"}' "$INFRA_STACK" output -json livekit_ips)"
      LIVEKIT_SIGNAL_ADDRESS="$(printf '%s' "$LIVEKIT_ADDRESSES" | jq -r '.signal // ""')"
      LIVEKIT_TURN_ADDRESS="$(printf '%s' "$LIVEKIT_ADDRESSES" | jq -r '.turn // ""')"
      ;;
  esac
fi
GATEWAY_ADDRESS="$STATIC_IP"
if [ "$INGRESS_MODE" = "gateway" ] && { [ "$DO_PLATFORM" = "1" ] || [ "$DO_OVERLAY" = "1" ]; }; then
  GATEWAY_ADDRESS="$(capture '<gateway address>' kubectl -n istio-ingress get svc istio-ingressgateway -o 'jsonpath={.status.loadBalancer.ingress[0].ip}{.status.loadBalancer.ingress[0].hostname}' || true)"
  [ -n "$GATEWAY_ADDRESS" ] || GATEWAY_ADDRESS="$STATIC_IP"
fi

PUBLIC_ADDRESS="$GATEWAY_ADDRESS"
if [ -n "$EDGE_IP" ]; then
  PUBLIC_ADDRESS="$EDGE_IP"
elif [ -n "$EDGE_HOSTNAME" ]; then
  PUBLIC_ADDRESS="$EDGE_HOSTNAME"
fi

printf '\n%s\n' "================ $ENV_NAME ($CLOUD) ================"
printf '%-22s %s\n' "application" "https://$DOMAIN"
printf '%-22s %s\n' "ingress mode" "$INGRESS_MODE"
case "$INGRESS_MODE" in
  cloud-lb)
    printf '%-22s %s\n' "edge address" "${PUBLIC_ADDRESS:-pending}"
    printf '%-22s %s\n' "tls terminates" "on the cloud load balancer, re-encrypted to the gateway"
    ;;
  external)
    printf '%-22s %s\n' "edge address" "your load balancer"
    printf '%-22s %s\n' "tls terminates" "on the load balancer you run"
    printf '%-22s %s\n' "load balancer config" "$SCRIPTS_DIR/lb-config.sh --env $ENV_NAME --env-dir $ENV_DIR_BASE --format all"
    ;;
  *)
    printf '%-22s %s\n' "ingress address" "${GATEWAY_ADDRESS:-pending}"
    printf '%-22s %s\n' "tls terminates" "on the istio gateway (cert-manager)"
    ;;
esac
if [ "$LIVEKIT_ENABLED" = "true" ]; then
  printf '%-22s %s\n' "livekit" "$LIVEKIT_URL"
  printf '%-22s %s\n' "livekit address" "${LIVEKIT_SIGNAL_ADDRESS:-pending}"
  printf '%-22s %s\n' "livekit turn" "$LIVEKIT_TURN"
  printf '%-22s %s\n' "livekit turn address" "${LIVEKIT_TURN_ADDRESS:-pending}"
fi
printf '%-22s %s\n' "argo cd password" "kubectl -n $ARGOCD_NS get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
printf '%-22s %s\n' "argo cd ui" "kubectl -n $ARGOCD_NS port-forward svc/argocd-server 8080:80 (then http://localhost:8080, user admin)"
DNS_TARGET="${PUBLIC_ADDRESS:-<ingress address>}"
if [ "$INGRESS_MODE" = "external" ]; then
  printf '\n%s\n' "ingress_mode is external, point these records at your load balancer:"
  printf '  %-28s -> %s\n' "$DOMAIN" "<your load balancer>"
  printf '  %-28s -> %s\n' "*.$DOMAIN" "<your load balancer>"
  printf '%s\n' "then configure it: $SCRIPTS_DIR/lb-config.sh --env $ENV_NAME --env-dir $ENV_DIR_BASE --format all"
elif [ -z "$DNS_ZONE" ]; then
  printf '\n%s\n' "dns_zone is empty, create these records at your DNS provider:"
  printf '  %-28s -> %s\n' "$DOMAIN" "$DNS_TARGET"
  printf '  %-28s -> %s\n' "*.$DOMAIN" "$DNS_TARGET"
  if [ "$LIVEKIT_ENABLED" = "true" ]; then
    printf '  %-28s -> %s\n' "livekit.$DOMAIN" "${LIVEKIT_SIGNAL_ADDRESS:-<livekit signal address>}"
    printf '  %-28s -> %s\n' "$LIVEKIT_TURN" "${LIVEKIT_TURN_ADDRESS:-<livekit turn address>}"
  fi
elif [ "$CLOUD" = "aws" ] && [ "$INGRESS_MODE" = "gateway" ]; then
  printf '\n%s\n' "external-dns keeps these records in hosted zone $DNS_ZONE from the gateway Service:"
  printf '  %-28s -> %s\n' "$DOMAIN" "$DNS_TARGET"
  printf '  %-28s -> %s\n' "*.$DOMAIN" "$DNS_TARGET"
  printf '%s\n' "if they do not appear: kubectl -n external-dns logs deploy/external-dns"
else
  printf '\n%s\n' "01-infra created these records in zone $DNS_ZONE:"
  printf '  %-28s -> %s\n' "$DOMAIN" "$DNS_TARGET"
  printf '  %-28s -> %s\n' "*.$DOMAIN" "$DNS_TARGET"
fi
printf '\n'
log "setup: done"
