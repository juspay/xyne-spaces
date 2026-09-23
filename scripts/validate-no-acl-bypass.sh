set -euo pipefail

# Resolve paths relative to the repo root, not the invoking shell's cwd — this runs as a
# `prebuild` hook, and npm/pnpm invoke package scripts with cwd set to the PACKAGE directory
# (apps/backend), not the repo root, so hardcoded relative paths would silently scan nothing.
# git is the source of truth when it can answer, but this also runs inside the Docker build,
# where .dockerignore keeps .git out of the image — so fall back to the parent of scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || printf '%s' "${SCRIPT_DIR%/*}")"
ROOT="$REPO_ROOT/apps/backend/src"
ALLOWED_DIR="apps/backend/src/bypassAcl/"
EXCLUDED_RE='(^|/)(node_modules|dist|build|generated)/'

if [ -t 1 ]; then
  RED='\033[1;31m'; YELLOW='\033[1;33m'; GREEN='\033[1;32m'; RESET='\033[0m'
else
  RED=''; YELLOW=''; GREEN=''; RESET=''
fi

# runAsSystem, runAsServiceActor and the raw SQL primitives are checked here — all three
# categories are fully relocated into bypassAcl/. .$transaction( is being done as a separate PR;
# add it back once its relocation lands:
#   label ".\$transaction(",      pattern '\.\$transaction\('
#
# Each entry: human label, grep -E pattern.
declare -a LABELS=(
  "runAsSystem("
  "runAsServiceActor("
  "raw query/execute calls (incl. *Unsafe)"
)
declare -a PATTERNS=(
  'runAsSystem\('
  'runAsServiceActor\('
  '\$(query|execute)Raw(Unsafe)?'
)

violations=0

for i in "${!PATTERNS[@]}"; do
  pattern="${PATTERNS[$i]}"
  label="${LABELS[$i]}"

  hits=$(grep -rnE "$pattern" "$ROOT" --include='*.ts' 2>/dev/null \
    | grep -v "$ALLOWED_DIR" \
    | grep -vE "$EXCLUDED_RE" \
    || true)

  [ -z "$hits" ] && continue

  if [ "$violations" -eq 0 ]; then
    echo -e "${RED}❌ ACL bypass guard: bypass primitive used outside bypassAcl/${RESET}"
    echo ""
  fi
  violations=$((violations + 1))

  echo -e "  ${YELLOW}${label}${RESET}"
  echo "$hits" | sed 's/^/    /'
  echo ""
done

if [ "$violations" -gt 0 ]; then
  echo "These are ways to reach the database without going through the Prisma tenant ACL"
  echo "extension (apps/backend/src/database/tenant/acl-extension.ts). (.\$transaction( is tracked"
  echo "separately and not checked by this script for now.)"
  echo "Every call site must live in apps/backend/src/bypassAcl/, importable from elsewhere —"
  echo "see /ACL_BYPASS_AUDIT.md at the repo root for why, and /BYPASS_ACL_EXAMPLES.md for the"
  echo "relocation pattern."
  echo ""
  exit 1
fi

echo -e "${GREEN}✅ ACL bypass guard: no bypass primitives found outside bypassAcl/.${RESET}"
exit 0
