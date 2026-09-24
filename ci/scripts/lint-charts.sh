#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHARTS_DIR="${ROOT}/helm-charts/charts"
ALL_FEATURES="${ROOT}/ci/helm/all-features-values.yaml"
UMBRELLA_FEATURES="${ROOT}/ci/helm/umbrella-values.yaml"
LIBRARY_CHART="xyne-common"
UMBRELLA_CHART="xyne-spaces"
OUT_DIR="${OUT_DIR:-}"

if [ "$#" -gt 0 ]; then
  charts=("$@")
else
  charts=()
  for dir in "${CHARTS_DIR}"/*/; do
    name="$(basename "${dir}")"
    if [ "${name}" != "${LIBRARY_CHART}" ] && [ "${name}" != "${UMBRELLA_CHART}" ]; then
      charts+=("${name}")
    fi
  done
  if [ -d "${CHARTS_DIR}/${UMBRELLA_CHART}" ]; then
    charts+=("${UMBRELLA_CHART}")
  fi
fi

render() {
  local chart="$1" label="$2"
  shift 2
  if [ -n "${OUT_DIR}" ]; then
    mkdir -p "${OUT_DIR}"
    helm template ci "${CHARTS_DIR}/${chart}" --namespace xyne-apps "$@" > "${OUT_DIR}/${chart}.${label}.yaml"
  else
    helm template ci "${CHARTS_DIR}/${chart}" --namespace xyne-apps "$@" > /dev/null
  fi
}

failed=0
for chart in "${charts[@]}"; do
  echo "==> ${chart}"
  helm dependency update "${CHARTS_DIR}/${chart}" > /dev/null
  if [ "${chart}" = "${UMBRELLA_CHART}" ]; then
    features="${UMBRELLA_FEATURES}"
  else
    features="${ALL_FEATURES}"
  fi
  if ! helm lint "${CHARTS_DIR}/${chart}" --quiet; then
    failed=1
  fi
  if ! render "${chart}" default; then
    failed=1
  fi
  if [ -f "${features}" ] && ! render "${chart}" all-features -f "${features}"; then
    failed=1
  fi
done

if [ "${failed}" -ne 0 ]; then
  echo "error: one or more charts failed" >&2
  exit 1
fi
echo "All charts OK"
