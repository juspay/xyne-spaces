# GCP c4-standard-16 Fleet Template

This creates a CPU-only LightOn OCR wrapper fleet in `xyne-spaces-sbx`, zone `asia-southeast1-a`, using `c4-standard-16`.

The wrapper calls the existing LightOn inference LB:

```text
http://10.2.0.101/v1/chat/completions
```

## Defaults

- Machine: `c4-standard-16`
- Initial MIG size: `4`
- Per instance async jobs: `OCR_ASYNC_MAX_INFLIGHT=5`
- Per instance LightOn calls: `LIGHTON_CONCURRENCY=16`
- Image chunk text cap: `IMAGE_CHUNK_MAX_TOKENS=460`
- Fleet async cap: `OCR_ASYNC_GLOBAL_MAX_INFLIGHT=20`
- Internal HTTP LB port: `80`
- Container port: `8000`

## Run

Push the Docker image to a registry reachable by the VM first, then run:

```bash
chmod +x deploy/gcp-c4-standard-16/create-fleet.sh

LIGHTON_OCR_IMAGE_URI='asia-southeast1-docker.pkg.dev/xyne-spaces-sbx/<repo>/lighton-ocr-server:final' \
REDIS_URL='redis://<redis-internal-ip>:6379/0' \
deploy/gcp-c4-standard-16/create-fleet.sh
```

Optional overrides:

```bash
TARGET_SIZE=8
OCR_ASYNC_GLOBAL_MAX_INFLIGHT=40
LB_IP=10.2.0.102
TEMPLATE_NAME=lighton-ocr-wrapper-fleet-template-v2
```

## Check

```bash
python3 /usr/local/Caskroom/gcloud-cli/532.0.0/google-cloud-sdk/lib/gcloud.py \
  compute backend-services get-health lighton-ocr-wrapper-fleet-backend \
  --region asia-southeast1 \
  --project xyne-spaces-sbx
```

```bash
python3 /usr/local/Caskroom/gcloud-cli/532.0.0/google-cloud-sdk/lib/gcloud.py \
  compute instance-groups managed list-instances lighton-ocr-wrapper-fleet-mig \
  --zone asia-southeast1-a \
  --project xyne-spaces-sbx
```

SSH into one node:

```bash
python3 /usr/local/Caskroom/gcloud-cli/532.0.0/google-cloud-sdk/lib/gcloud.py \
  compute ssh --zone asia-southeast1-a <vm-name> \
  --tunnel-through-iap \
  --project xyne-spaces-sbx \
  --command 'sudo docker ps; sudo docker logs --tail 100 lighton-ocr; curl -fsS http://127.0.0.1:8000/health'
```

## Notes

- This template intentionally does not use GPU. LightOn inference is remote.
- `REDIS_URL` must point to Redis reachable from the MIG network.
- If boot speed matters, bake Docker plus `lighton-ocr-server:final` into a golden image and change `SOURCE_IMAGE_FAMILY/SOURCE_IMAGE_PROJECT` or update the script to use that custom image.
