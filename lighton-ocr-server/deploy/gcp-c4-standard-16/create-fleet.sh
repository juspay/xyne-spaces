#!/usr/bin/env bash
set -euo pipefail

# Creates a c4-standard-16 Managed Instance Group behind an internal managed HTTP LB.
# Run from this repository root after setting LIGHTON_OCR_IMAGE_URI and REDIS_URL.

PROJECT="${PROJECT:-xyne-spaces-sbx}"
REGION="${REGION:-asia-southeast1}"
ZONE="${ZONE:-asia-southeast1-a}"
NETWORK="${NETWORK:-xyne-spaces-sbx}"
SUBNET="${SUBNET:-xyne-spaces-sbx-gpu-sebi}"

NAME="${NAME:-lighton-ocr-wrapper-fleet}"
TEMPLATE_NAME="${TEMPLATE_NAME:-${NAME}-template-v1}"
MIG_NAME="${MIG_NAME:-${NAME}-mig}"
HEALTH_CHECK_NAME="${HEALTH_CHECK_NAME:-${NAME}-hc}"
BACKEND_NAME="${BACKEND_NAME:-${NAME}-backend}"
URL_MAP_NAME="${URL_MAP_NAME:-${NAME}-urlmap}"
PROXY_NAME="${PROXY_NAME:-${NAME}-http-proxy}"
FORWARDING_RULE_NAME="${FORWARDING_RULE_NAME:-${NAME}-fr}"

MACHINE_TYPE="${MACHINE_TYPE:-c4-standard-16}"
BOOT_DISK_SIZE="${BOOT_DISK_SIZE:-100GB}"
BOOT_DISK_TYPE="${BOOT_DISK_TYPE:-pd-ssd}"
SOURCE_IMAGE_FAMILY="${SOURCE_IMAGE_FAMILY:-debian-12}"
SOURCE_IMAGE_PROJECT="${SOURCE_IMAGE_PROJECT:-debian-cloud}"
TARGET_SIZE="${TARGET_SIZE:-4}"
LB_IP="${LB_IP:-}"

LIGHTON_OCR_IMAGE_URI="${LIGHTON_OCR_IMAGE_URI:?Set LIGHTON_OCR_IMAGE_URI, for example asia-southeast1-docker.pkg.dev/xyne-spaces-sbx/ocr/lighton-ocr-server:final}"
REDIS_URL="${REDIS_URL:?Set REDIS_URL reachable from the fleet, for example redis://10.2.0.2:6379/0}"
OCR_ASYNC_GLOBAL_MAX_INFLIGHT="${OCR_ASYNC_GLOBAL_MAX_INFLIGHT:-20}"

GCLOUD="${GCLOUD:-python3 /usr/local/Caskroom/gcloud-cli/532.0.0/google-cloud-sdk/lib/gcloud.py}"

TMP_CLOUD_INIT="$(mktemp)"
trap 'rm -f "${TMP_CLOUD_INIT}"' EXIT

python3 - <<'PY' > "${TMP_CLOUD_INIT}"
import os
from pathlib import Path
from string import Template

source = Path("deploy/gcp-c4-standard-16/cloud-init.yaml").read_text()
print(
    Template(source).safe_substitute(
        LIGHTON_OCR_IMAGE_URI=os.environ["LIGHTON_OCR_IMAGE_URI"],
        REDIS_URL=os.environ["REDIS_URL"],
        OCR_ASYNC_GLOBAL_MAX_INFLIGHT=os.environ["OCR_ASYNC_GLOBAL_MAX_INFLIGHT"],
    ),
    end="",
)
PY

${GCLOUD} compute instance-templates create "${TEMPLATE_NAME}" \
  --project "${PROJECT}" \
  --machine-type "${MACHINE_TYPE}" \
  --boot-disk-size "${BOOT_DISK_SIZE}" \
  --boot-disk-type "${BOOT_DISK_TYPE}" \
  --image-family "${SOURCE_IMAGE_FAMILY}" \
  --image-project "${SOURCE_IMAGE_PROJECT}" \
  --network "projects/${PROJECT}/global/networks/${NETWORK}" \
  --subnet "projects/${PROJECT}/regions/${REGION}/subnetworks/${SUBNET}" \
  --tags "${NAME}" \
  --service-account default \
  --scopes cloud-platform \
  --metadata-from-file user-data="${TMP_CLOUD_INIT}"

${GCLOUD} compute instance-groups managed create "${MIG_NAME}" \
  --project "${PROJECT}" \
  --zone "${ZONE}" \
  --base-instance-name "${NAME}" \
  --size "${TARGET_SIZE}" \
  --template "${TEMPLATE_NAME}"

${GCLOUD} compute instance-groups managed set-named-ports "${MIG_NAME}" \
  --project "${PROJECT}" \
  --zone "${ZONE}" \
  --named-ports http:8000

${GCLOUD} compute health-checks create http "${HEALTH_CHECK_NAME}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --port 8000 \
  --request-path /health \
  --check-interval 30s \
  --timeout 10s \
  --healthy-threshold 2 \
  --unhealthy-threshold 3

${GCLOUD} compute backend-services create "${BACKEND_NAME}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --load-balancing-scheme INTERNAL_MANAGED \
  --protocol HTTP \
  --port-name http \
  --timeout 3600s \
  --health-checks "${HEALTH_CHECK_NAME}" \
  --health-checks-region "${REGION}" \
  --locality-lb-policy LEAST_REQUEST

${GCLOUD} compute backend-services add-backend "${BACKEND_NAME}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --instance-group "${MIG_NAME}" \
  --instance-group-zone "${ZONE}" \
  --balancing-mode UTILIZATION \
  --capacity-scaler 1.0

${GCLOUD} compute url-maps create "${URL_MAP_NAME}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --default-service "${BACKEND_NAME}"

${GCLOUD} compute target-http-proxies create "${PROXY_NAME}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --url-map "${URL_MAP_NAME}"

forwarding_args=(
  compute forwarding-rules create "${FORWARDING_RULE_NAME}"
  --project "${PROJECT}"
  --region "${REGION}"
  --load-balancing-scheme INTERNAL_MANAGED
  --network "projects/${PROJECT}/global/networks/${NETWORK}"
  --subnet "projects/${PROJECT}/regions/${REGION}/subnetworks/${SUBNET}"
  --ports 80
  --target-http-proxy "${PROXY_NAME}"
  --target-http-proxy-region "${REGION}"
)

if [[ -n "${LB_IP}" ]]; then
  forwarding_args+=(--address "${LB_IP}")
fi

${GCLOUD} "${forwarding_args[@]}"

echo "Created ${NAME}"
echo "MIG: ${MIG_NAME}"
echo "Backend: ${BACKEND_NAME}"
echo "Forwarding rule: ${FORWARDING_RULE_NAME}"
echo "Health:"
echo "${GCLOUD} compute backend-services get-health ${BACKEND_NAME} --region ${REGION} --project ${PROJECT}"
