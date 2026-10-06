#!/usr/bin/env bash
set -euo pipefail

APP_VERSION="${1:?usage: bump-chart.sh <app-version> [base-ref]}"
APP_VERSION="${APP_VERSION#v}"
BASE_REF="${2:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHARTS_DIR="${ROOT}/helm-charts/charts"
IMAGES_JSON="${ROOT}/ci/images.json"
LIBRARY_CHART="xyne-common"
UMBRELLA_CHART="xyne-spaces"

if ! printf '%s' "${APP_VERSION}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "error: '${APP_VERSION}' is not a SemVer version" >&2
  exit 1
fi

base_version() {
  local chart="$1" version
  if [ -n "${BASE_REF}" ] && git -C "${ROOT}" cat-file -e "${BASE_REF}:helm-charts/charts/${chart}/Chart.yaml" 2>/dev/null; then
    version="$(git -C "${ROOT}" show "${BASE_REF}:helm-charts/charts/${chart}/Chart.yaml" | yq eval '.version' -)"
  else
    version="$(yq eval '.version' "${CHARTS_DIR}/${chart}/Chart.yaml")"
  fi
  printf '%s' "${version%%-app.*}"
}

first_party_charts="$(jq -r '.[].charts[]' "${IMAGES_JSON}" | sort -u)"

for chart_dir in "${CHARTS_DIR}"/*/; do
  chart="$(basename "${chart_dir}")"
  chart_file="${chart_dir}Chart.yaml"
  [ -f "${chart_file}" ] || continue
  [ "${chart}" = "${LIBRARY_CHART}" ] && continue

  new_version="$(base_version "${chart}")-app.${APP_VERSION}"
  yq eval ".version = \"${new_version}\"" -i "${chart_file}"

  if printf '%s\n' "${first_party_charts}" | grep -qx "${chart}" || [ "${chart}" = "${UMBRELLA_CHART}" ]; then
    yq eval ".appVersion = \"${APP_VERSION}\"" -i "${chart_file}"
  fi
  echo "${chart}: version=${new_version} appVersion=$(yq eval '.appVersion' "${chart_file}")"
done

umbrella_file="${CHARTS_DIR}/${UMBRELLA_CHART}/Chart.yaml"
if [ -f "${umbrella_file}" ]; then
  for dep in $(yq eval '.dependencies[].name' "${umbrella_file}" | sort -u); do
    [ -f "${CHARTS_DIR}/${dep}/Chart.yaml" ] || continue
    dep_version="$(yq eval '.version' "${CHARTS_DIR}/${dep}/Chart.yaml")"
    yq eval "(.dependencies[] | select(.name == \"${dep}\")).version = \"${dep_version}\"" -i "${umbrella_file}"
  done
  echo "${UMBRELLA_CHART}: dependency versions synced"
fi
