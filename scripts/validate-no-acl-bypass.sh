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

# runAsSystem, runAsServiceActor, the raw SQL primitives and interactive .$transaction( are
# all checked here — every category is relocated into bypassAcl/.
#
# Interactive .$transaction( is handled separately below: only the callback form hands out a
# `tx` client that skips the ACL extension. The array form ($transaction([...]) or a .map()
# over queries built on the extended client) does not bypass anything and may stay put.
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

# --- Interactive .$transaction( -------------------------------------------------------------
# For every `.$transaction(` outside bypassAcl/, look at the first non-blank text after the
# opening paren (which may be on a following line). `[` or `<expr>.map(` means the array form
# (allowed); anything else is a callback, i.e. an interactive transaction (violation).
tx_files=$(grep -rlE '\.\$transaction\(' "$ROOT" --include='*.ts' 2>/dev/null \
  | grep -v "$ALLOWED_DIR" \
  | grep -vE "$EXCLUDED_RE" \
  || true)
tx_hits=""
for f in $tx_files; do
  h=$(awk '
    { lines[NR] = $0 }
    END {
      for (n = 1; n <= NR; n++) {
        l = lines[n]
        if (l !~ /\.\$transaction\(/) continue
        t = l; sub(/^[ \t]+/, "", t)
        if (t ~ /^(\/\/|\*|\/\*)/) continue
        i = index(l, "$transaction(")
        rest = substr(l, i + 13)
        k = n
        while (rest ~ /^[ \t]*$/ && k < NR) { k++; rest = lines[k] }
        sub(/^[ \t]+/, "", rest)
        if (rest ~ /^\[/ || rest ~ /^[A-Za-z_.]+\.map\(/) continue
        printf "%s:%d:%s\n", FILENAME, n, l
      }
    }' "$f")
  [ -n "$h" ] && tx_hits="${tx_hits}${h}"$'\n'
done
if [ -n "$tx_hits" ]; then
  if [ "$violations" -eq 0 ]; then
    echo -e "${RED}❌ ACL bypass guard: bypass primitive used outside bypassAcl/${RESET}"
    echo ""
  fi
  violations=$((violations + 1))
  echo -e "  ${YELLOW}interactive .\$transaction( (callback form)${RESET}"
  echo "$tx_hits" | sed '/^$/d' | sed 's/^/    /'
  echo ""
fi

# --- Generic bypass handles inside bypassAcl/ -----------------------------------------------
# A bypass must be a specific, named operation that owns its logic. An exported function that
# takes a callback returning a Promise ("run this fn without ACL") is a reusable bypass handle
# anyone could call with their own code, without touching bypassAcl/ or its reviewers. Only the
# primitives in base.ts (and the generic helpers in tenantUtils.ts) may take such a callback.
cb_hits=""
cb_files=$(find "$ROOT/bypassAcl" -name '*.ts' ! -name 'base.ts' ! -name 'tenantUtils.ts' 2>/dev/null || true)
for f in $cb_files; do
  h=$(awk '
    { lines[NR] = $0 }
    END {
      for (n = 1; n <= NR; n++) {
        if (lines[n] !~ /^export[ \t]+(async[ \t]+)?(function|const)[ \t]/) continue
        buf = lines[n]; k = n
        while (buf !~ /\)[^()]*\{[ \t]*$/ && buf !~ /=>[ \t]*\{?[ \t]*$/ && k < NR && k < n + 40) { k++; buf = buf " " lines[k] }
        if (buf ~ /[A-Za-z_]+\??[ \t]*:[ \t]*\(.*\)[ \t]*=>[ \t]*(Promise|PromiseLike)/) printf "%s:%d:%s\n", FILENAME, n, lines[n]
      }
    }' "$f")
  [ -n "$h" ] && cb_hits="${cb_hits}${h}"$'\n'
done
if [ -n "$cb_hits" ]; then
  if [ "$violations" -eq 0 ]; then
    echo -e "${RED}❌ ACL bypass guard: bypass primitive used outside bypassAcl/${RESET}"
    echo ""
  fi
  violations=$((violations + 1))
  echo -e "  ${YELLOW}exported bypassAcl/ function takes a callback (generic bypass handle)${RESET}"
  echo "$cb_hits" | sed '/^$/d' | sed 's/^/    /'
  echo ""
fi

if [ "$violations" -gt 0 ]; then
  echo "These are ways to reach the database without going through the Prisma tenant ACL"
  echo "extension (apps/backend/src/database/tenant/acl-extension.ts)."
  echo "Every call site must live in apps/backend/src/bypassAcl/ as a named operation that owns its"
  echo "logic (not a function that takes a callback), importable from elsewhere —"
  echo "see /ACL_BYPASS_AUDIT.md at the repo root for why, and /BYPASS_ACL_EXAMPLES.md for the"
  echo "relocation pattern."
  echo ""
  exit 1
fi

echo -e "${GREEN}✅ ACL bypass guard: no bypass primitives found outside bypassAcl/.${RESET}"
exit 0
