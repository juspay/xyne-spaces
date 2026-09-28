#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<EOF
usage: lb-config.sh --env <env> [--env-dir <path>] [--format <format>]
                    [--http-port <n>] [--https-port <n>] [--status-port <n>]
                    [--node-address internal|external]

Prints what a load balancer you run yourself needs in order to send traffic to
the Istio ingress gateway: the node addresses, the node ports, the health check
and the backend protocol. Use it with ingress_mode = "external", where TLS is
terminated on your load balancer and Terraform builds nothing.

  --env <env>          environment name: the directory <env-dir>/<env>/
  --env-dir <path>     directory holding environments (default: $ENV_DIR_BASE)
  --format <format>    summary (default), haproxy, nginx, or all
  --http-port <n>      override the gateway HTTP node port
  --https-port <n>     override the gateway HTTPS node port
  --status-port <n>    override the gateway status node port
  --node-address <k>   which node address to list: internal (default) or external

Node ports and addresses are read from the cluster when kubectl can reach it,
and fall back to the defaults the chart uses. Re-run it after adding or
removing nodes, or point your load balancer at a node group that autoscales.
EOF
}

GATEWAY_NS="istio-ingress"
GATEWAY_SVC="istio-ingressgateway"
DEFAULT_HTTP=30080
DEFAULT_HTTPS=30443
DEFAULT_STATUS=30021

ENV_ARG=""
FORMAT="summary"
HTTP_PORT=""
HTTPS_PORT=""
STATUS_PORT=""
ADDRESS_KIND="internal"

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_ARG="${2:-}"; shift 2 ;;
    --env-dir) set_env_dir_base "${2:-}"; shift 2 ;;
    --format) FORMAT="${2:-}"; shift 2 ;;
    --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
    --https-port) HTTPS_PORT="${2:-}"; shift 2 ;;
    --status-port) STATUS_PORT="${2:-}"; shift 2 ;;
    --node-address) ADDRESS_KIND="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

case "$FORMAT" in
  summary|haproxy|nginx|all) ;;
  *) usage >&2; die "--format takes summary, haproxy, nginx or all" ;;
esac

case "$ADDRESS_KIND" in
  internal) ADDRESS_TYPE="InternalIP" ;;
  external) ADDRESS_TYPE="ExternalIP" ;;
  *) usage >&2; die "--node-address takes internal or external" ;;
esac

load_env "$ENV_ARG"

DOMAIN="$(tfvar_value "$INFRA_TFVARS" domain)"
[ -n "$DOMAIN" ] || DOMAIN="<domain>"
MODE="$(tfvar_value "$INFRA_TFVARS" ingress_mode)"
[ -n "$MODE" ] || MODE="gateway"

svc_node_port() {
  local name="$1"
  kubectl -n "$GATEWAY_NS" get svc "$GATEWAY_SVC" \
    -o "jsonpath={.spec.ports[?(@.name=='${name}')].nodePort}" 2>/dev/null || true
}

if need_cmd kubectl; then
  [ -n "$HTTP_PORT" ] || HTTP_PORT="$(svc_node_port http2)"
  [ -n "$HTTPS_PORT" ] || HTTPS_PORT="$(svc_node_port https)"
  [ -n "$STATUS_PORT" ] || STATUS_PORT="$(svc_node_port status-port)"
  NODES="$(kubectl get nodes -o "jsonpath={range .items[*]}{.metadata.name}{'\t'}{.status.addresses[?(@.type=='${ADDRESS_TYPE}')].address}{'\n'}{end}" 2>/dev/null || true)"
else
  NODES=""
fi

[ -n "$HTTP_PORT" ] || HTTP_PORT="$DEFAULT_HTTP"
[ -n "$HTTPS_PORT" ] || HTTPS_PORT="$DEFAULT_HTTPS"
[ -n "$STATUS_PORT" ] || STATUS_PORT="$DEFAULT_STATUS"

ADDRESSES="$(printf '%s\n' "$NODES" | awk -F '\t' 'NF > 1 && $2 != "" { print $2 }' | sort -u)"
if [ -z "$ADDRESSES" ]; then
  ADDRESSES="<node-address>"
  NODES_KNOWN=0
else
  NODES_KNOWN=1
fi

TLS_MODE="$(tfvar_value "$INFRA_TFVARS" ingress_tls)"
if [ -z "$TLS_MODE" ]; then
  case "$MODE" in
    gateway) TLS_MODE="acme" ;;
    *) TLS_MODE="internal" ;;
  esac
fi

if [ "$TLS_MODE" = "none" ]; then
  BACKEND_PORT="$HTTP_PORT"
  BACKEND_PROTO="http"
  BACKEND_NOTE="the gateway serves plain HTTP; keep this leg on a private network"
else
  BACKEND_PORT="$HTTPS_PORT"
  BACKEND_PROTO="https"
  BACKEND_NOTE="the gateway serves its own certificate; your load balancer must not verify it"
fi

print_summary() {
  printf '\n%s\n' "================ $ENV_NAME load balancer ================"
  printf '%-24s %s\n' "ingress mode" "$MODE"
  printf '%-24s %s\n' "public names" "$DOMAIN, *.$DOMAIN"
  printf '%-24s %s\n' "terminate TLS" "on your load balancer, for both names"
  printf '%-24s %s\n' "backend protocol" "$BACKEND_PROTO"
  printf '%-24s %s\n' "backend port" "$BACKEND_PORT"
  printf '%-24s %s\n' "health check" "HTTP GET /healthz/ready on port $STATUS_PORT, expect 200"
  printf '%-24s %s\n' "send Host header" "the original client Host, unmodified"
  printf '%-24s %s\n' "set headers" "X-Forwarded-For, X-Forwarded-Proto: https"
  printf '%-24s %s\n' "websockets" "required; do not buffer or time out /zero/ and /ysweet/"
  printf '\n%s\n' "backends:"
  if [ "$NODES_KNOWN" = "1" ]; then
    printf '%s\n' "$NODES" | awk -F '\t' -v p="$BACKEND_PORT" 'NF > 1 && $2 != "" { printf "  %-28s %s:%s\n", $1, $2, p }'
  else
    printf '%s\n' "  kubectl could not reach the cluster; run this again once it can,"
    printf '%s\n' "  or point your load balancer at every node on the ports above"
  fi
  printf '\n%s\n' "note: $BACKEND_NOTE"
  printf '%s\n' "note: nodes come and go, so prefer a node group or a pool your load"
  printf '%s\n' "      balancer can discover rather than a fixed list"
  printf '\n'
}

print_haproxy() {
  printf '\n%s\n\n' "----------------- haproxy.cfg -----------------"
  cat <<EOF
global
  log stdout format raw local0
  ssl-default-bind-options ssl-min-ver TLSv1.2

defaults
  mode http
  log global
  option httplog
  option forwardfor
  timeout connect 5s
  timeout client 300s
  timeout server 300s
  timeout tunnel 3600s

frontend xyne_in
  bind *:80
  bind *:443 ssl crt /etc/haproxy/certs/$DOMAIN.pem
  http-request redirect scheme https unless { ssl_fc }
  http-request set-header X-Forwarded-Proto https if { ssl_fc }
  default_backend xyne_gateway

backend xyne_gateway
  balance roundrobin
  option httpchk GET /healthz/ready
  http-check expect status 200
EOF
  if [ "$NODES_KNOWN" = "1" ]; then
    if [ "$BACKEND_PROTO" = "https" ]; then
      printf '%s\n' "$NODES" | awk -F '\t' -v p="$BACKEND_PORT" -v s="$STATUS_PORT" 'NF > 1 && $2 != "" { printf "  server %s %s:%s ssl verify none check port %s no-check-ssl\n", $1, $2, p, s }'
    else
      printf '%s\n' "$NODES" | awk -F '\t' -v p="$BACKEND_PORT" -v s="$STATUS_PORT" 'NF > 1 && $2 != "" { printf "  server %s %s:%s check port %s\n", $1, $2, p, s }'
    fi
  else
    if [ "$BACKEND_PROTO" = "https" ]; then
      printf '  server node1 <node-address>:%s ssl verify none check port %s no-check-ssl\n' "$BACKEND_PORT" "$STATUS_PORT"
    else
      printf '  server node1 <node-address>:%s check port %s\n' "$BACKEND_PORT" "$STATUS_PORT"
    fi
  fi
  printf '\n'
}

print_nginx() {
  printf '\n%s\n\n' "----------------- nginx.conf -----------------"
  cat <<EOF
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  ''      close;
}

upstream xyne_gateway {
EOF
  if [ "$NODES_KNOWN" = "1" ]; then
    printf '%s\n' "$NODES" | awk -F '\t' -v p="$BACKEND_PORT" 'NF > 1 && $2 != "" { printf "  server %s:%s max_fails=3 fail_timeout=10s;\n", $2, p }'
  else
    printf '  server <node-address>:%s max_fails=3 fail_timeout=10s;\n' "$BACKEND_PORT"
  fi
  cat <<EOF
}

server {
  listen 80;
  server_name $DOMAIN *.$DOMAIN;
  return 301 https://\$host\$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name $DOMAIN *.$DOMAIN;

  ssl_certificate     /etc/nginx/certs/$DOMAIN.crt;
  ssl_certificate_key /etc/nginx/certs/$DOMAIN.key;
  ssl_protocols       TLSv1.2 TLSv1.3;

  client_max_body_size 0;
  proxy_read_timeout   300s;
  proxy_send_timeout   300s;

  location / {
    proxy_pass $BACKEND_PROTO://xyne_gateway;
EOF
  if [ "$BACKEND_PROTO" = "https" ]; then
    cat <<EOF
    proxy_ssl_verify      off;
    proxy_ssl_server_name on;
    proxy_ssl_name        \$host;
EOF
  fi
  cat <<EOF
    proxy_http_version 1.1;
    proxy_set_header Host              \$host;
    proxy_set_header X-Real-IP         \$remote_addr;
    proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade           \$http_upgrade;
    proxy_set_header Connection        \$connection_upgrade;
  }
}
EOF
  printf '\n'
}

case "$FORMAT" in
  summary) print_summary ;;
  haproxy) print_haproxy ;;
  nginx) print_nginx ;;
  all) print_summary; print_haproxy; print_nginx ;;
esac
