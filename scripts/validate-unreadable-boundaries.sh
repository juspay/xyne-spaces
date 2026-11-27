#!/usr/bin/env bash
set -euo pipefail

# Where the backend may touch an encrypted field's value. A mutator carries an unreadable value as
# an UnreadableString, decides on facts and writes it through tx.mutate; the conversions between
# CEK, DEK, facts and plaintext each have one home:
#
#   CEK -> DEK + facts   encryption provider transformRequest  zero/encryptedMutation.ts (mutators),
#                                                                middleware/encryptedRoute.ts (REST),
#                                                                services/callAi/gatewayLlm.ts (call-AI reply)
#   DEK -> facts         encryption provider deriveFacts        zero/unreadableTransaction.ts (tx.read)
#   DEK -> new DEK       encryption provider compose            services/encryption/compose.ts (composeBatch)
#   UnreadableString ->  reveal()                               zero/unreadableTransaction.ts (the write unwrap),
#   its value                                                    services/encryption/compose.ts (composeBatch)
#
# reveal is defined in @xyne/contracts, so packages/contracts/src is checked too: a helper there
# that reveals would hand the backend the value without the backend ever naming reveal. It may
# appear only where it is defined, exported, and used by the compose template runner.
# packages/shared/src may not use it at all: shared is loaded by the clients and holds no contract.
#
# This guard fails the build when any of them is reached from another file. It runs as the
# backend `prebuild` hook, so it runs in the pre-commit build, in CI and in the image build:
# skipping git hooks does not skip it.
#
# Caught, outside comments and string literals:
#   - reveal: any reference (a call, `reveal as x`, `{ reveal: x } = ...`), by name in brackets
#     (`shared['reveal']`), and any import or require of the unreadable-string module itself;
#   - the provider methods: member access (`.deriveFacts(`, `?.compose(`), by name in brackets
#     (`provider['compose']`), and one-line destructuring (`const { deriveFacts } = provider`).
#     The provider's own definitions (`async compose(...)`) are not member access.

# It also runs from the pre-commit hook, so a commit that touches only packages/contracts or
# packages/shared is checked.
#
# Paths are resolved from the repo root, not the cwd: pnpm runs `prebuild` in apps/backend, and
# the image build has no .git, so fall back to the parent of scripts/ (as validate-no-acl-bypass.sh).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || printf '%s' "${SCRIPT_DIR%/*}")"
EXCLUDED_RE='(^|/)(node_modules|dist|build|generated|__tests__)/|\.(test|spec)\.tsx?$'

# One rule per line: scanned directory | name | kind (word: any reference, and any import of the
# unreadable-string module; name: any reference only; member: a method of the provider) | allowed
# files, comma-separated, relative to the scanned directory | what to do instead.
# Adding a file needs a reason: it is a place where an encrypted value crosses one of these lines.
RULES=$(cat <<'EOF'
apps/backend/src|reveal|word|zero/unreadableTransaction.ts,services/encryption/compose.ts|Decide on facts: the mutator's `facts`, or tx.read(query, { <column>: { <fact>: derive.<fact> } }). Write the value as it is through tx.mutate, which stores what it holds.
apps/backend/src|transformRequest|member|zero/encryptedMutation.ts,middleware/encryptedRoute.ts,services/callAi/gatewayLlm.ts|A mutator gets its args transformed by defineContractMutator (encryptedMutation.ts); a REST route by encryptedRoute().
apps/backend/src|deriveFacts|member|zero/unreadableTransaction.ts|Ask for the facts with tx.read(query, { <column>: { <fact>: derive.<fact> } }).
apps/backend/src|compose|member|services/encryption/compose.ts|Build the value with composeSafe() from services/encryption/compose.ts.
packages/contracts/src|reveal|name|unreadable-string.ts,index.ts,compose.ts|Contract code carries an UnreadableString and never reads it: no helper here may reveal on the backend's behalf. The compose template runner (runComposeTemplate) is the one user.
packages/shared/src|reveal|word||Shared code is loaded by the clients and holds no contract: it never reads an UnreadableString.
EOF
)

if [ -t 1 ]; then
  RED='\033[1;31m'; GREEN='\033[1;32m'; RESET='\033[0m'
else
  RED=''; GREEN=''; RESET=''
fi

failed=0

while IFS='|' read -r dir name kind allowed hint; do
  [ -n "$name" ] || continue
  FILES=$(find "$REPO_ROOT/$dir" \( -name '*.ts' -o -name '*.tsx' \) -type f 2>/dev/null | grep -vE "$EXCLUDED_RE" | sort)
  hits=""
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    rel="${file#"$REPO_ROOT"/}"
    case ",$allowed," in *",${rel#"$dir"/},"*) continue ;; esac
    h=$(awk -v rel="$rel" -v name="$name" -v kind="$kind" '
      BEGIN { id = "[A-Za-z0-9_$]" }
      {
        line = $0
        t = line; sub(/^[ \t]+/, "", t)
        # Comment lines, including the body of a /** ... */ block.
        if (t ~ /^(\/\/|\*|\/\*)/) next
        hit = 0
        # By name in brackets, before string literals are blanked: x["name"], x[`name`].
        if (line ~ ("\\[[ \t]*[\"\047`]" name "[\"\047`][ \t]*\\]")) hit = 1
        # reveal: the module itself, from any import, export or require.
        if (kind == "word" && line ~ /unreadable-string/ && line ~ /(import|export|require|from)/) hit = 1
        # Everything else: blank string literals, drop a trailing comment, then look for the name.
        code = line
        gsub(/"([^"\\]|\\.)*"/, "\"\"", code)
        gsub(/\047([^\047\\]|\\.)*\047/, "\047\047", code)
        gsub(/`([^`\\]|\\.)*`/, "``", code)
        sub(/\/\/.*$/, "", code)
        word = "(^|[^A-Za-z0-9_$])" name "([^A-Za-z0-9_$]|$)"
        if ((kind == "word" || kind == "name") && code ~ word) hit = 1
        if (kind == "member") {
          if (code ~ ("\\.[ \t]*" name "([^A-Za-z0-9_$]|$)")) hit = 1
          if (code ~ ("\\{[^}]*" word "[^}]*\\}[ \t]*=([^=>]|$)")) hit = 1
        }
        if (hit) printf "%s:%d:%s\n", rel, NR, line
      }' "$file")
    [ -n "$h" ] && hits="${hits}${h}"$'\n'
  done <<< "$FILES"

  if [ -n "$hits" ]; then
    failed=1
    echo -e "${RED}❌ Unreadable boundary guard: ${name} used outside its files in ${dir}${RESET}"
    echo ""
    echo "$hits" | sed '/^$/d' | sed 's/^/    /'
    echo ""
    echo "  $hint"
    echo "  Allowed in ${dir}: $(echo "$allowed" | sed "s#,#, #g")"
    echo ""
  fi
done <<< "$RULES"

if [ "$failed" -ne 0 ]; then
  echo "Each of these turns an encrypted value into another form (or reads it). They stay in the files"
  echo "above so no other code can see or convert a sensitive value. See scripts/validate-unreadable-boundaries.sh."
  exit 1
fi

echo -e "${GREEN}✅ Unreadable boundary guard: reveal, transformRequest, deriveFacts and compose stay in their files (apps/backend, packages/contracts, packages/shared).${RESET}"
exit 0
