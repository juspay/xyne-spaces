#!/usr/bin/env bash
# =============================================================================
# reset-local.sh — wipe this repo's container state and start over.
#
#   pnpm run reset          # shows what it will remove, then asks
#   pnpm run reset -y       # no prompt
#
# Removes, scoped to this checkout's compose project only:
#   - every container compose started here (all profiles, all four compose
#     files — including docker-compose.sandbox.yml, whose shared infra runs
#     under this same project name; per-sandbox stacks under .sandboxes/ are a
#     separate project and are only warned about, never touched)
#   - every named volume in the project namespace — including orphans from
#     compose revisions that no longer declare them (claw_auth_postgres_data,
#     common_postgres_data, ...), which `compose down -v` silently skips
#   - the compose networks
#   - vespa-core/deployment/vespa-data (Vespa bind-mounts it on the host)
#
# Images are deliberately left alone: rebuilding them is the slow part, and
# nothing in them is state. For the machine-wide nuke that also drops images
# and re-inits the podman machine, use `pnpm run cleanup`.
#
# Containers only — host dev servers (pnpm run dev) are not touched.
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        -y|--yes) ASSUME_YES=1 ;;
        *) echo -e "${RED}Unknown option: $arg${NC}"; echo "Usage: pnpm run reset [-y|--yes]"; exit 1 ;;
    esac
done

# -----------------------------------------------------------------------------
# Detect container runtime (same order as scripts/start-services.sh)
# -----------------------------------------------------------------------------
RUNTIME=""
COMPOSE_CMD=""

if command -v docker &> /dev/null && docker info > /dev/null 2>&1; then
    RUNTIME="docker"
    if docker compose version > /dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    else
        COMPOSE_CMD="docker-compose"
    fi
elif command -v podman &> /dev/null; then
    RUNTIME="podman"
    if command -v podman-compose &> /dev/null; then
        COMPOSE_CMD="podman-compose"
    else
        COMPOSE_CMD="podman compose"
    fi
    # Unlike the docker branch above, reaching here does not prove the runtime
    # answers. A stopped podman machine makes every ps/volume/network call fail,
    # and since those failures are swallowed the script would otherwise die
    # mid-inventory with nothing on screen but the banner.
    if ! podman info > /dev/null 2>&1; then
        echo -e "${RED}Podman is installed but not responding.${NC}"
        echo -e "${YELLOW}Start it first:  ${BLUE}podman machine start${NC}"
        exit 1
    fi
else
    echo -e "${RED}No running container runtime found (tried Docker, then Podman).${NC}"
    exit 1
fi

# The compose files interpolate ${COMPOSE_PROJECT_NAME:-xyne} into container_name,
# so exporting it keeps -p and the container names in agreement.
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$REPO_ROOT")}"
export COMPOSE_PROJECT_NAME="$PROJECT"

COMPOSE_FILES=()
for f in docker-compose.dev.yml docker-compose.local.yml docker-compose.sandbox.yml vespa-core/deployment/docker-compose.dev.yml; do
    [ -f "$f" ] && COMPOSE_FILES+=("$f")
done

VESPA_DATA="$REPO_ROOT/vespa-core/deployment/vespa-data"

echo -e "${BLUE}🧨 Reset — project ${CYAN}${PROJECT}${BLUE} (${RUNTIME})${NC}"
echo ""

# -----------------------------------------------------------------------------
# Inventory. Containers/networks by compose label (exact); volumes by label plus
# name prefix, because the prefix catches volumes whose service is long gone.
# -----------------------------------------------------------------------------
list_containers() {
    $RUNTIME ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}' 2>/dev/null | sort -u
}
list_volumes() {
    {
        $RUNTIME volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}' 2>/dev/null
        # Literal prefix match. A grep pattern would treat a '.' in the project
        # name (a checkout at xyne-spaces.bak, a dotted worktree) as "any char"
        # and reach into a neighbouring project's volumes.
        $RUNTIME volume ls --format '{{.Name}}' 2>/dev/null | while read -r v; do
            case "$v" in "${PROJECT}_"*) echo "$v" ;; esac
        done
    } | sort -u
}
list_networks() {
    $RUNTIME network ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}' 2>/dev/null | sort -u
}

# `|| true` on every one of these: a bare `X="$(f)"` is not exempt from set -e,
# so a runtime that stops answering part-way through teardown would kill the
# script before it reports what it failed to remove.
CONTAINERS="$(list_containers || true)"
VOLUMES="$(list_volumes || true)"
NETWORKS="$(list_networks || true)"

print_block() {
    local title="$1" items="$2"
    if [ -n "$items" ]; then
        echo -e "${YELLOW}${title}${NC}"
        echo "$items" | sed 's/^/    /'
        echo ""
    fi
}

print_block "Containers to remove ($(echo "$CONTAINERS" | grep -c . || true)):" "$CONTAINERS"
print_block "Volumes to delete — all data in them is gone ($(echo "$VOLUMES" | grep -c . || true)):" "$VOLUMES"
print_block "Networks to remove:" "$NETWORKS"
[ -d "$VESPA_DATA" ] && print_block "Host directory to delete:" "vespa-core/deployment/vespa-data"

if [ -z "$CONTAINERS" ] && [ -z "$VOLUMES" ] && [ -z "$NETWORKS" ] && [ ! -d "$VESPA_DATA" ]; then
    echo -e "${GREEN}Nothing to reset — this project has no containers, volumes or networks.${NC}"
    exit 0
fi

echo -e "${CYAN}Images are kept.${NC}"

# Sandboxes share this project's infra (scripts/sandbox.sh starts
# docker-compose.sandbox.yml with no -p) but each sandbox's own containers live
# in .sandboxes/<name>/, a separate compose project this script cannot see. So a
# reset takes the postgres/redis out from under them and leaves them running
# against nothing.
LIVE_SANDBOXES=""
if [ -d "$REPO_ROOT/.sandboxes" ]; then
    LIVE_SANDBOXES="$(ls -1 "$REPO_ROOT/.sandboxes" 2>/dev/null || true)"
fi
if [ -n "$LIVE_SANDBOXES" ]; then
    echo ""
    echo -e "${YELLOW}⚠ Sandboxes exist and share the infra listed above:${NC}"
    echo "$LIVE_SANDBOXES" | sed 's/^/    /'
    echo -e "${YELLOW}  Their own containers are a separate compose project and will survive${NC}"
    echo -e "${YELLOW}  this reset, pointing at a database that no longer exists.${NC}"
    echo -e "${YELLOW}  Destroy them first:  ${BLUE}pnpm run sandbox destroy <name>${NC}"
fi
echo ""

if [ "$ASSUME_YES" != "1" ]; then
    if [ ! -t 0 ]; then
        echo -e "${RED}Not a TTY and --yes not given — refusing to reset.${NC}"
        exit 1
    fi
    read -r -p "$(echo -e "${YELLOW}This wipes every local database and bucket listed above. Type 'reset' to continue: ${NC}")" REPLY
    if [ "$REPLY" != "reset" ]; then
        echo -e "${BLUE}Aborted — nothing was touched.${NC}"
        exit 0
    fi
    echo ""
fi

# -----------------------------------------------------------------------------
# Tear down
# -----------------------------------------------------------------------------
# ${arr[@]+"${arr[@]}"} — bash 3.2 (stock macOS) treats an empty array as an
# unset variable under set -u and would abort here.
for f in ${COMPOSE_FILES[@]+"${COMPOSE_FILES[@]}"}; do
    echo -e "${BLUE}compose down -v  ${CYAN}${f}${NC}"
    $COMPOSE_CMD -f "$f" \
        --profile transcription --profile egress --profile search --profile monitoring \
        down -v --remove-orphans > /dev/null 2>&1 || true
done
echo ""

# Whatever compose left behind: containers it no longer declares, and the
# orphaned volumes that `down -v` never looks at.
LEFTOVER_CONTAINERS="$(list_containers || true)"
if [ -n "$LEFTOVER_CONTAINERS" ]; then
    echo -e "${BLUE}Removing leftover containers...${NC}"
    echo "$LEFTOVER_CONTAINERS" | while read -r c; do
        [ -n "$c" ] && $RUNTIME rm -f "$c" > /dev/null 2>&1 || true
    done
fi

LEFTOVER_VOLUMES="$(list_volumes || true)"
if [ -n "$LEFTOVER_VOLUMES" ]; then
    echo -e "${BLUE}Removing leftover volumes...${NC}"
    echo "$LEFTOVER_VOLUMES" | while read -r v; do
        [ -n "$v" ] && $RUNTIME volume rm "$v" > /dev/null 2>&1 || true
    done
fi

LEFTOVER_NETWORKS="$(list_networks || true)"
if [ -n "$LEFTOVER_NETWORKS" ]; then
    echo -e "${BLUE}Removing leftover networks...${NC}"
    echo "$LEFTOVER_NETWORKS" | while read -r n; do
        [ -n "$n" ] && $RUNTIME network rm "$n" > /dev/null 2>&1 || true
    done
fi

if [ -d "$VESPA_DATA" ]; then
    echo -e "${BLUE}Removing vespa-core/deployment/vespa-data...${NC}"
    rm -rf "$VESPA_DATA"
fi

# -----------------------------------------------------------------------------
# Report what survived, if anything
# -----------------------------------------------------------------------------
echo ""
REMAINING_C="$(list_containers || true)"
REMAINING_V="$(list_volumes || true)"
REMAINING_N="$(list_networks || true)"
if [ -n "${REMAINING_C}${REMAINING_V}${REMAINING_N}" ]; then
    echo -e "${YELLOW}⚠ Some resources could not be removed:${NC}"
    print_block "Containers:" "$REMAINING_C"
    print_block "Volumes:" "$REMAINING_V"
    print_block "Networks:" "$REMAINING_N"
    echo -e "${YELLOW}Something outside this project is still holding them — a container${NC}"
    echo -e "${YELLOW}mounting the volume, or attached to the network.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Reset complete — containers, volumes and networks gone, images intact.${NC}"
echo ""
echo -e "${BLUE}Next:${NC}"
echo -e "  ${CYAN}pnpm run services${NC}   # recreate the containers (databases start empty)"
echo -e "  ${CYAN}pnpm run dev:all${NC}    # then bring the app up"
