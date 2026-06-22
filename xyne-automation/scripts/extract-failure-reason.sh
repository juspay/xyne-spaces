#!/bin/bash
# Extract a short, human-readable failure reason from automation artifacts.
# Usage: extract-failure-reason.sh [report_directory]

set -euo pipefail

REPORT_DIR="${1:-xyne-automation/reports}"

normalize_reason() {
  tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

pick_latest_file() {
  local pattern="$1"
  [ -d "$REPORT_DIR" ] || return 0
  find "$REPORT_DIR" -name "$pattern" -type f -print 2>/dev/null | sort | tail -n 1
}

extract_from_gauge_log() {
  local gauge_log="$1"
  [ -f "$gauge_log" ] || return 1

  local reason=""

  reason=$(awk '
    /Error Message:/ {
      sub(/.*Error Message:[[:space:]]*/, "", $0)
      print
      exit
    }
  ' "$gauge_log")

  if [ -z "$reason" ]; then
    reason=$(awk '
      /Failed Step:/ {
        sub(/.*Failed Step:[[:space:]]*/, "", $0)
        print
        exit
      }
    ' "$gauge_log")
  fi

  if [ -z "$reason" ]; then
    reason=$(grep -m 1 -E 'Step implementation not found|Failed to load baseline fixture registry|Timeout .* exceeded|AssertionError|ERR_ASSERTION' "$gauge_log" || true)
  fi

  if [ -n "$reason" ]; then
    printf '%s' "$reason" | normalize_reason
    return 0
  fi

  return 1
}

extract_from_runner_summary() {
  local summary_file="$1"
  [ -f "$summary_file" ] || return 1

  local reason=""
  if ! jq empty "$summary_file" >/dev/null 2>&1; then
    return 1
  fi

  reason=$(jq -r '.steps[]? | select(.status == "failed" and (.error // "") != "") | .error' "$summary_file" 2>/dev/null | head -n 1 || true)

  if [ -n "$reason" ] && [ "$reason" != "null" ]; then
    printf '%s' "$reason" | normalize_reason
    return 0
  fi

  return 1
}

gauge_log="$(pick_latest_file 'gauge.log')"
if [ -n "${gauge_log:-}" ] && extract_from_gauge_log "$gauge_log"; then
  exit 0
fi

runner_summary="$(pick_latest_file 'runner-summary.json')"
if [ -n "${runner_summary:-}" ] && extract_from_runner_summary "$runner_summary"; then
  exit 0
fi

printf '%s' "Automation tests failed. See test report for details."
