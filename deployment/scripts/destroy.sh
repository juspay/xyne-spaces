#!/usr/bin/env bash
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<EOF
usage: destroy.sh --env <env> [--env-dir <path>] [--auto-approve] [--dry-run]

Tears one environment down in reverse order: the overlay (when
<env-dir>/<env>/overlay/ exists), then 02-platform, then 01-infra.
The state backend itself is left in place.

  --env <env>       environment name: the directory <env-dir>/<env>/
  --env-dir <path>  directory holding environments (default: $ENV_DIR_BASE);
                    use it for environments kept in another repository
  --auto-approve    do not ask for the typed confirmation
  --dry-run         print every command instead of running it

Before destroying, set every deletion protection flag in 01-infra.tfvars to
false (cluster_deletion_protection and postgres_deletion_protection on the
clouds that have them) and apply 01-infra once with
setup.sh --env <env> --only infra; the cloud refuses to delete protected
resources otherwise and this script stops at the first such error.
EOF
}

ENV_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_ARG="${2:-}"; shift 2 ;;
    --env-dir) set_env_dir_base "${2:-}"; shift 2 ;;
    --auto-approve) AUTO_APPROVE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

load_env "$ENV_ARG"
log "destroy: env=$ENV_NAME cloud=$CLOUD dir=$ENV_DIR dry_run=$DRY_RUN"

for flag in cluster_deletion_protection postgres_deletion_protection; do
  if grep -qE "^variable \"${flag}\"" "$INFRA_STACK/variables.tf" && [ "$(tfvar_value "$INFRA_TFVARS" "$flag")" != "false" ]; then
    printf 'warning: %s is not false in %s; 01-infra will refuse to delete that resource until it is applied with the flag off\n' "$flag" "$INFRA_TFVARS"
  fi
done

confirm_typed "$ENV_NAME" "This deletes every resource of environment $ENV_NAME on $CLOUD, including databases and buckets with their data." || die "aborted"

if [ -d "$OVERLAY_DIR" ]; then
  log "stage overlay ($OVERLAY_DIR)"
  write_backend "$OVERLAY_DIR" overlay
  overlay_var_args
  tf_destroy "$OVERLAY_DIR" overlay "${OVERLAY_ARGS[@]}"
fi

log "stage 02-platform"
write_backend "$PLATFORM_STACK" 02-platform
platform_var_args
tf_destroy "$PLATFORM_STACK" 02-platform "${PLATFORM_ARGS[@]}"

log "stage 01-infra"
write_backend "$INFRA_STACK" 01-infra
tf_destroy "$INFRA_STACK" 01-infra -var-file "$INFRA_TFVARS"

log "destroy: done; the state backend and the kubeconfig context were left in place"
