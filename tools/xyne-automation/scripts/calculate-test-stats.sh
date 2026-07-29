#!/bin/bash
# Calculate test statistics from Cucumber JSON reports
# Usage: calculate-test-stats.sh [report_directory]
# Output format: passed:X failed:X skipped:X total:X

set -e

REPORT_DIR="${1:-xyne-automation/report}"

passed=0
failed=0
skipped=0

# reports/ accumulates one dir per run, so read only the newest gauge-status.json
# rather than summing every historical run into the current one.
latest_gauge_status=$(find "$REPORT_DIR" -name "gauge-status.json" -type f -exec ls -t {} + 2>/dev/null | head -1)
if [ -n "$latest_gauge_status" ]; then
  passed=$(jq '.passed // 0' "$latest_gauge_status" 2>/dev/null || echo 0)
  failed=$(jq '.failed // 0' "$latest_gauge_status" 2>/dev/null || echo 0)
  skipped=$(jq '.skipped // 0' "$latest_gauge_status" 2>/dev/null || echo 0)
  total=$((passed + failed + skipped))
  echo "passed:$passed failed:$failed skipped:$skipped total:$total"
  exit 0
fi

# Find all JSON report files and process them
while IFS= read -r -d '' file; do
  # Use jq to properly parse Cucumber structure:
  # features[] -> elements[] -> steps[] -> result.status
  # An element (scenario) is:
  #   - failed if any step failed
  #   - skipped if no steps or all steps skipped
  #   - passed if all steps passed
  stats=$(cat "$file" | jq -r '
    [.[] | .elements? // empty | .[]] | map(
      if (.steps? | length) == 0 then
        "skipped"
      else
        (.steps? // []) | map(.result?.status // "skipped") |
        if any(. == "failed") then
          "failed"
        elif all(. == "passed") then
          "passed"
        elif any(. == "skipped") then
          "skipped"
        else
          "skipped"
        end
      end
    ) | group_by(.) | map({key: .[0], value: length}) | from_entries
  ' 2>/dev/null || echo '{}')

  p=$(echo "$stats" | jq '.passed // 0')
  f=$(echo "$stats" | jq '.failed // 0')
  s=$(echo "$stats" | jq '.skipped // 0')

  passed=$((passed + p))
  failed=$((failed + f))
  skipped=$((skipped + s))
done < <(find "$REPORT_DIR" -name "*.json" -type f -print0 2>/dev/null || true)

total=$((passed + failed + skipped))

echo "passed:$passed failed:$failed skipped:$skipped total:$total"
