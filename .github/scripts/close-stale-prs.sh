#!/usr/bin/env bash
# Closes open pull requests whose most recent commit is older than STALE_DAYS.
# Staleness is measured by the head commit date, not PR activity (comments,
# labels), so a PR with chatter but no new commits is still closed.
#
# Env:
#   GH_TOKEN     token with pull-requests: write (provided by Actions)
#   REPO         owner/name (default: $GITHUB_REPOSITORY)
#   STALE_DAYS   age threshold in days (default: 30)
#   DRY_RUN      "true" to only list what would be closed (default: false)
#   PR_NUMBERS   optional space/comma-separated PR numbers; when set, only
#                these PRs are considered (default: all open PRs)
set -euo pipefail

REPO="${REPO:-${GITHUB_REPOSITORY:?REPO or GITHUB_REPOSITORY must be set}}"
STALE_DAYS="${STALE_DAYS:-30}"
DRY_RUN="${DRY_RUN:-false}"
PR_NUMBERS="${PR_NUMBERS:-}"

OWNER="${REPO%%/*}"
NAME="${REPO##*/}"
cutoff=$(date -u -d "-${STALE_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)
echo "Repo: $REPO | cutoff: $cutoff | dry-run: $DRY_RUN | only: ${PR_NUMBERS:-all}"

query='
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        commits(last: 1) { nodes { commit { committedDate } } }
      }
    }
  }
}'

count=0
after=""
while :; do
  args=(-f query="$query" -f owner="$OWNER" -f name="$NAME")
  [ -n "$after" ] && args+=(-f after="$after")
  page=$(gh api graphql "${args[@]}")

  # ISO-8601 UTC timestamps compare correctly as strings.
  stale=$(jq -r --arg cutoff "$cutoff" --arg only "$PR_NUMBERS" '
    ($only | [scan("[0-9]+") | tonumber]) as $list
    | .data.repository.pullRequests.nodes[]
    | select(($list | length) == 0 or (.number as $n | $list | index($n)))
    | select(.commits.nodes[0].commit.committedDate < $cutoff)
    | "\(.number)\t\(.commits.nodes[0].commit.committedDate)"' <<<"$page")

  while IFS=$'\t' read -r number last_commit; do
    [ -z "$number" ] && continue
    if [ "$DRY_RUN" = "true" ]; then
      echo "[dry-run] would close #$number (last commit $last_commit)"
    else
      gh pr close "$number" --repo "$REPO" \
        --comment "Closing automatically: no commits in the last ${STALE_DAYS} days (last commit: ${last_commit}). Feel free to reopen and push new commits."
      echo "Closed #$number (last commit $last_commit)"
    fi
    count=$((count + 1))
  done <<<"$stale"

  [ "$(jq -r '.data.repository.pullRequests.pageInfo.hasNextPage' <<<"$page")" = "true" ] || break
  after=$(jq -r '.data.repository.pullRequests.pageInfo.endCursor' <<<"$page")
done

if [ "$DRY_RUN" = "true" ]; then
  echo "Done. Stale PRs found (not closed): $count"
else
  echo "Done. Stale PRs closed: $count"
fi
