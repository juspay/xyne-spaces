#!/usr/bin/env bash
#
# port-pr-from-bitbucket.sh — take a range of commits from a Bitbucket PR
# (identified by source/target branch, since the two repos' histories are
# unrelated after the squash/rewrite) and apply them as a new branch + PR on
# the GitHub side, via git format-patch + git am (no cross-repo remotes,
# no Bitbucket API calls).
#
# Usage:
#   scripts/port-pr-from-bitbucket.sh \
#     --bitbucket-repo /path/to/bitbucket/clone \
#     --github-repo    /path/to/github/clone \
#     --source-branch  feature/xyz \
#     --target-branch  main \
#     [--pr-link "https://bitbucket.../pull-requests/1234"] \
#     [--branch-name import/feature-xyz] \
#     [--pr-title "feat: XYNE-12345 my change"] \
#     [--base main] \
#     [--exclude-path lotus/] [--exclude-path apps/xyne-spaces/] ...
#
# --exclude-path (repeatable) drops changes under a path prefix that no
# longer belongs in the GitHub repo (e.g. dirs that were moved to a private
# repo). Per commit:
#   - if EVERY changed file in that commit falls under an excluded prefix,
#     the whole commit is skipped (not applied at all).
#   - if only SOME files are excluded, that commit's patch is applied with
#     just the excluded files' hunks stripped out — the rest of the commit's
#     real changes still land.
#
# The --pr-link is optional and used only to enrich the generated PR body
# (a "Ported from" reference) — no API call is made against it.
#
# On conflict, git am stops with the repo in a conflicted state. Resolve it
# (edit files, `git add`, `git am --continue`) or `git am --abort`, then
# re-run this script — already-applied commits are skipped automatically
# via `git am --skip`-safe re-detection is NOT automatic; re-run picks up
# from where the patch series left off if you resume with `git am --continue`
# yourself. The script itself does not loop retries.

set -euo pipefail

BITBUCKET_REPO=""
GITHUB_REPO=""
SOURCE_BRANCH=""
TARGET_BRANCH=""
PR_LINK=""
BRANCH_NAME=""
PR_TITLE=""
BASE_BRANCH="main"
EXCLUDE_PATHS=()

usage() {
  grep '^#' "$0" | sed -e 's/^#!.*//' -e 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bitbucket-repo) BITBUCKET_REPO="$2"; shift 2 ;;
    --github-repo)    GITHUB_REPO="$2"; shift 2 ;;
    --source-branch)  SOURCE_BRANCH="$2"; shift 2 ;;
    --target-branch)  TARGET_BRANCH="$2"; shift 2 ;;
    --pr-link)        PR_LINK="$2"; shift 2 ;;
    --branch-name)    BRANCH_NAME="$2"; shift 2 ;;
    --pr-title)       PR_TITLE="$2"; shift 2 ;;
    --base)           BASE_BRANCH="$2"; shift 2 ;;
    --exclude-path)   EXCLUDE_PATHS+=("$2"); shift 2 ;;
    -h|--help)        usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

for required in BITBUCKET_REPO GITHUB_REPO SOURCE_BRANCH TARGET_BRANCH; do
  if [[ -z "${!required}" ]]; then
    echo "Error: --$(echo "$required" | tr '[:upper:]_' '[:lower:]-') is required" >&2
    usage
  fi
done

[[ -d "$BITBUCKET_REPO/.git" ]] || { echo "Error: $BITBUCKET_REPO is not a git repo" >&2; exit 1; }
[[ -d "$GITHUB_REPO/.git" ]]    || { echo "Error: $GITHUB_REPO is not a git repo" >&2; exit 1; }

command -v gh >/dev/null 2>&1 || { echo "Error: gh CLI is required (for PR creation)" >&2; exit 1; }

if [[ -z "$BRANCH_NAME" ]]; then
  BRANCH_NAME="import/$(echo "$SOURCE_BRANCH" | tr '/' '-')"
fi
if [[ -z "$PR_TITLE" ]]; then
  PR_TITLE="Port: $SOURCE_BRANCH"
fi

PATCH_DIR="$(mktemp -d -t bb-port-patches)"
trap 'rm -rf "$PATCH_DIR"' EXIT

echo "==> Step 1/5: verify branches exist in Bitbucket repo"
(
  cd "$BITBUCKET_REPO"
  git rev-parse --verify "$SOURCE_BRANCH" >/dev/null 2>&1 || {
    echo "Error: source branch '$SOURCE_BRANCH' not found in $BITBUCKET_REPO" >&2
    echo "       (try: git fetch origin '$SOURCE_BRANCH')" >&2
    exit 1
  }
  git rev-parse --verify "$TARGET_BRANCH" >/dev/null 2>&1 || {
    echo "Error: target branch '$TARGET_BRANCH' not found in $BITBUCKET_REPO" >&2
    exit 1
  }
)

echo "==> Step 2/5: compute commit range ($TARGET_BRANCH..$SOURCE_BRANCH) and export patches"
(
  cd "$BITBUCKET_REPO"
  COMMIT_COUNT=$(git rev-list --count "$TARGET_BRANCH..$SOURCE_BRANCH")
  if [[ "$COMMIT_COUNT" -eq 0 ]]; then
    echo "Error: no commits found in $TARGET_BRANCH..$SOURCE_BRANCH — check branch names/direction" >&2
    exit 1
  fi
  echo "    $COMMIT_COUNT commit(s) to port:"
  git log --format='      %h %s' "$TARGET_BRANCH..$SOURCE_BRANCH"
  git format-patch --no-stat -o "$PATCH_DIR" "$TARGET_BRANCH..$SOURCE_BRANCH" >/dev/null
)

PATCH_COUNT=$(find "$PATCH_DIR" -name '*.patch' | wc -l | tr -d ' ')
echo "    exported $PATCH_COUNT patch file(s) to $PATCH_DIR"

if [[ ${#EXCLUDE_PATHS[@]} -gt 0 ]]; then
  echo "==> Step 2b: dropping excluded paths (${EXCLUDE_PATHS[*]}) from each patch"
  FILTER_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/filter-patch-paths.py"
  DROPPED=0
  STRIPPED=0
  for patch_file in "$PATCH_DIR"/*.patch; do
    set +e
    python3 "$FILTER_SCRIPT" "$patch_file" "${EXCLUDE_PATHS[@]}"
    rc=$?
    set -e
    if [[ $rc -eq 2 ]]; then
      echo "    drop (excluded-only): $(basename "$patch_file")"
      rm -f "$patch_file"
      DROPPED=$((DROPPED + 1))
    elif [[ $rc -ne 0 ]]; then
      echo "Error: failed to filter $patch_file (exit $rc)" >&2
      exit 1
    fi
  done
  REMAINING=$(find "$PATCH_DIR" -name '*.patch' | wc -l | tr -d ' ')
  echo "    dropped $DROPPED patch(es) entirely; $REMAINING remain to apply"
  if [[ "$REMAINING" -eq 0 ]]; then
    echo "Error: every commit was excluded — nothing left to port" >&2
    exit 1
  fi
fi

echo "==> Step 3/5: create branch '$BRANCH_NAME' off '$BASE_BRANCH' in GitHub repo"
(
  cd "$GITHUB_REPO"
  git fetch origin "$BASE_BRANCH" >/dev/null 2>&1 || true
  if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
    echo "Error: branch '$BRANCH_NAME' already exists in $GITHUB_REPO — pass --branch-name to pick another" >&2
    exit 1
  fi
  git checkout -B "$BRANCH_NAME" "origin/$BASE_BRANCH" 2>/dev/null \
    || git checkout -B "$BRANCH_NAME" "$BASE_BRANCH"
)

echo "==> Step 4/5: apply patch series with git am"
set +e
(
  cd "$GITHUB_REPO"
  git am --3way "$PATCH_DIR"/*.patch
)
AM_STATUS=$?
set -e

if [[ $AM_STATUS -ne 0 ]]; then
  cat >&2 <<EOF

!! git am stopped on a conflict.

   Repo:   $GITHUB_REPO
   Branch: $BRANCH_NAME

   Resolve it manually:
     cd '$GITHUB_REPO'
     git status                 # see conflicted files
     # fix conflicts, then:
     git add <fixed files>
     git am --continue
     # (or: git am --skip / git am --abort)

   Re-run this script's remaining steps yourself once 'git am' has
   fully completed (push + PR creation), e.g.:
     git push -u origin '$BRANCH_NAME'
     gh pr create --base '$BASE_BRANCH' --head '$BRANCH_NAME' --title '$PR_TITLE' --body '...'
EOF
  exit 1
fi

echo "    all patches applied cleanly"

echo "==> Step 5/5: push branch and create PR"
PR_BODY="Ported commits from Bitbucket branch \`$SOURCE_BRANCH\` (target: \`$TARGET_BRANCH\`)."
if [[ -n "$PR_LINK" ]]; then
  PR_BODY="$PR_BODY

Original PR: $PR_LINK"
fi

(
  cd "$GITHUB_REPO"
  git push -u origin "$BRANCH_NAME"
  gh pr create --base "$BASE_BRANCH" --head "$BRANCH_NAME" --title "$PR_TITLE" --body "$PR_BODY"
)

echo "==> Done."
