# Google Cloud

The GCP-specific parts of the [install guide](README.md). Follow that page; it sends you here for
the project, the files and the checks that only exist on GCP.

- [What gets built](#what-gets-built)
- [Prepare the project](#prepare-the-project)
- [`env.conf`](#envconf)
- [`01-infra.tfvars`](#01-infratfvars)
- [DNS on GCP](#dns-on-gcp)
- [Certificates](#certificates)
- [The databases](#the-databases)
- [Reaching the cluster](#reaching-the-cluster)
- [GCP checks](#gcp-checks)
- [Cost](#cost)
- [Known limits](#known-limits)

Examples use project `acme-spaces-prod`, region `asia-south1` and office network
`203.0.113.0/24`.

## What gets built

| Piece | GCP product |
|---|---|
| Network | VPC with subnet `10.10.0.0/20`, secondary ranges for pods `10.20.0.0/16` and services `10.30.0.0/20`, Cloud NAT, private services range `10.40.0.0/16` |
| Cluster | regional GKE, VPC-native, Dataplane V2 (enforces NetworkPolicy), private nodes, Workload Identity, release channel `REGULAR`, one node pool per enabled pool |
| Postgres | Cloud SQL for PostgreSQL 16 on a private IP, `db-custom-2-8192`, `REGIONAL` HA, daily backups at 02:00 UTC (7 kept), 7 days of point-in-time recovery, logical decoding on, the five databases, user `xyne` |
| Redis | Memorystore for Redis 7.2, `STANDARD_HA`, 4 GB, AUTH on, TLS off |
| Object storage | eight Cloud Storage buckets `<project>-xyne-{main,docs,canvas,recordings,workflows,transcription,bundles,claw}`, `STANDARD` class, CORS for `https://<domain>` |
| Identities | one Google service account per app, bound with Workload Identity |
| Ingress | in the default `gateway` mode, a reserved regional address `xyne-ingress` pinned to the gateway Service; `cloud-lb` builds a global external HTTPS load balancer instead, `external` builds none |
| DNS | `A` records for `domain` and `*.domain` when `dns_zone` is set |
| Bastion (off by default) | one `e2-small` VM reached through IAP, OS Login on, with `gcloud`, `kubectl`, `helm`, `psql` and `redis-cli` |
| LiveKit (off by default) | two managed instance groups, a global HTTPS load balancer with a managed certificate, Secret Manager secrets ([below](#livekit-on-gcp)) |
| State | a Cloud Storage bucket with versioning |

Wall-clock time: 25 to 35 minutes for `01-infra` (Cloud SQL 10 to 15, GKE about 10, Memorystore
about 5, in parallel), 5 to 10 minutes for `02-platform`, 10 to 20 for Argo CD.

## Prepare the project

The Google Cloud CLI and its GKE auth plugin, on macOS:

```bash
brew install --cask google-cloud-sdk
gcloud components install gke-gcloud-auth-plugin
```

on Debian or Ubuntu:

```bash
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install -y google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin
```

Then create the project, link billing and sign in:

```bash

gcloud auth login
gcloud projects create acme-spaces-prod --name="Xyne Spaces"          # skip if it exists
gcloud billing projects link acme-spaces-prod --billing-account=<billing account id>
gcloud config set project acme-spaces-prod
gcloud auth application-default login
```

`01-infra` enables the APIs it needs (`enable_apis = true`); enabling them first avoids the first
plan failing on a data source:

```bash
gcloud services enable compute.googleapis.com container.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com cloudresourcemanager.googleapis.com servicenetworking.googleapis.com \
  sqladmin.googleapis.com redis.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  dns.googleapis.com logging.googleapis.com monitoring.googleapis.com
```

**Permissions.** `roles/owner` on the project is simplest. The least-privilege set: Compute
Admin, Kubernetes Engine Admin, Cloud SQL Admin, Cloud Memorystore Redis Admin, Storage Admin,
Service Account Admin, Service Account User, Project IAM Admin, Secret Manager Admin, Service
Usage Admin, DNS Administrator, Service Networking Admin; IAP-secured Tunnel User for the bastion.

**Quota.** A regional cluster with the default pool plus a `REGIONAL` Cloud SQL instance needs
about 24 vCPUs at the start and 60 at full scale:

```bash
gcloud compute regions describe asia-south1 --format="yaml(quotas)" | grep -B1 -A1 -E "CPUS|IN_USE_ADDRESSES"
```

## `env.conf`

```
CLOUD=gcp
PROJECT=acme-spaces-prod
STATE_BUCKET=acme-spaces-prod-tfstate
STATE_LOCATION=asia-south1
STATE_PREFIX=xyne
```

`PROJECT` is exported as `CLOUDSDK_CORE_PROJECT` for every `gcloud` call. `STATE_LOCATION`
defaults to the region in `01-infra.tfvars`.

## `01-infra.tfvars`

```hcl
project = "acme-spaces-prod"
region  = "asia-south1"
name    = "xyne"
domain  = "xyne.example.com"

namespace    = "xyne-apps"
dns_zone     = "xyne-example-com"
worker_names = ["default"]

master_authorized_networks = [
  { cidr_block = "203.0.113.0/24", display_name = "office" },
]

postgres_mode = "managed"
redis_mode    = "managed"
storage_mode  = "managed"
```

The variables that only exist on GCP, or behave differently here:

| Variable | Meaning |
|---|---|
| `project` | the project id; required |
| `master_authorized_networks` | who may reach the Kubernetes API. Empty makes the control plane private, and `kubectl` then runs from inside the VPC |
| `dns_zone` | the Cloud DNS managed zone *name* (`xyne-example-com`), not the DNS name |
| `ingress_static_ip` | default `true`: reserve `xyne-ingress` and pin the gateway Service to it |
| `redis_tls` | keep `false`; the Memorystore CA is not handed to the apps ([Known limits](#known-limits)) |
| `sandbox_enabled` | a pool with `UBUNTU_CONTAINERD` and nested virtualization on N1/N2 machines |

GCP has no GPU pool yet, so the [OCR](../features/ocr.md) model server and the
[search](../features/search.md) embedder cannot run here; point OCR at a model server you run
elsewhere. The [configuration reference](../reference/configuration.md#gcp-01-infra) lists every
variable.

## DNS on GCP

With `dns_zone` set, `01-infra` writes `A` records for `domain` and `*.domain` to the reserved
address, and for `livekit.` and `turn.` to the LiveKit address. `dns.sh` creates the managed zone
and prints its name servers for your registrar:

```bash
deployment/scripts/dns.sh --env prod zone        # prints dns_zone = "xyne-example-com"
deployment/scripts/dns.sh --env prod status
```

| Record | Type | Value |
|---|---|---|
| `xyne.example.com.` | `A` | the `xyne-ingress` address (`ingress address` in the summary) |
| `*.xyne.example.com.` | `A` | the same address |
| `livekit.xyne.example.com.` | `A` | the LiveKit global address (with `livekit_enabled`) |
| `turn.xyne.example.com.` | `A` | the same LiveKit address |

Without `dns_zone`, `setup.sh` prints the records to create at its DNS gate (TTL 300 is fine);
the LiveKit address is
`terraform -chdir=deployment/terraform/stacks/gcp/01-infra output -raw livekit_lb_ip`. Confirm
propagation with `dig +short xyne.example.com` before expecting a certificate. In `cloud-lb` mode
the apex and wildcard point at the edge load balancer's global address instead, which Terraform
writes itself when `dns_zone` is set.

## Certificates

- **The application**: cert-manager issues `xyne-gateway-tls` once `domain` resolves to the
  gateway address. In `cloud-lb` mode the edge certificate is a Google-managed certificate for
  `ingress_certificate_domains`, or yours through `ingress_certificate_ids` or
  `ingress_certificate_pem`. Google-managed certificates cannot cover a wildcard, so
  `ingress_certificate_domains` defaults to the apex alone. Renewal of the application
  certificate is automatic; `addons.certManager.wildcard: true` only makes sense with a solver
  other than `http01`, which cannot issue wildcards.
- **LiveKit signalling** uses a Google-managed certificate on the global load balancer. It turns
  `ACTIVE` only after `livekit.<domain>` points at the load balancer, which can take up to an hour:
  `gcloud compute ssl-certificates describe xyne-livekit-signal --global --format='value(managed.status)'`.
- **TURN over TLS** is optional: store the PEM bundle in Secret Manager and name it in
  `livekit_turn_cert_secret` ([calls](../features/calls.md#turn-over-tls)).

## What setup does on GCP

The steps in [step 10](README.md#10-run-the-setup), with the GCP specifics:

1. **State backend**: `gcloud storage buckets create gs://<STATE_BUCKET>` if missing, then
   versioning.
2. **Ingress addresses**: a targeted apply reserves `xyne-ingress`, the records are printed and the
   run waits for DNS. In `cloud-lb` mode a second targeted apply, `-target=module.cluster`, follows
   ([Known limits](#known-limits)).
3. **01-infra**: a plan of roughly 120 resources.
4. **kubeconfig**: `gcloud container clusters get-credentials xyne --region <region> --project <project>`.
5. **02-platform**: Argo CD (up to 15 minutes allowed, usually 3), the namespaces, the Secrets and
   the root Application.

## The databases

Cloud SQL creates the five databases, but the `xyne` role lacks `REPLICATION`, which Zero needs;
until it has it, `xyne-zero-replication` crash-loops with
`must be superuser or replication role to start walsender`. The `xyne-db-init` Job in
`02-platform` grants it (`ALTER ROLE CURRENT_USER WITH REPLICATION`) before any app starts.

With an external database, or when the Job failed
(`kubectl -n xyne-apps logs job/xyne-db-init`), run it yourself. The Cloud SQL instance has only a
private IP, so from inside the cluster:

```bash
DATABASE_URL="$(kubectl -n xyne-apps get secret xyne-backend-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)"
kubectl -n xyne-apps run psql --rm -it --restart=Never --image=postgres:16 \
  --overrides='{"metadata":{"annotations":{"sidecar.istio.io/inject":"false"}}}' \
  -- psql "$DATABASE_URL" -c 'ALTER USER xyne WITH REPLICATION;'
```

or from the bastion (`bastion_enabled = true`), whose zone is `bastion_zone` or the region's first
zone:

```bash
terraform -chdir=deployment/terraform/stacks/gcp/01-infra output -json postgres | jq -r .host
gcloud compute ssh xyne-bastion --project acme-spaces-prod --zone asia-south1-a --tunnel-through-iap
psql "host=<the private IP> user=xyne dbname=xyne sslmode=require" -c 'ALTER USER xyne WITH REPLICATION;'
```

Then `kubectl -n xyne-apps rollout restart deploy/xyne-zero-replication`.

## Reaching the cluster

```bash
gcloud container clusters get-credentials xyne --region asia-south1 --project acme-spaces-prod
kubectl get nodes
```

works from any address in `master_authorized_networks`. With `enable_private_endpoint = true`,
use the bastion (`bastion_enabled = true`, which installs `gcloud`, `kubectl`, `helm`, `psql` and
`redis-cli`) through IAP:

```bash
gcloud compute ssh xyne-bastion --project acme-spaces-prod --zone asia-south1-a --tunnel-through-iap
```

or open a tunnel to the private endpoint from your workstation:

```bash
ENDPOINT="$(gcloud container clusters describe xyne --region asia-south1 --project acme-spaces-prod --format='value(privateClusterConfig.privateEndpoint)')"
gcloud compute ssh xyne-bastion --project acme-spaces-prod --zone asia-south1-a --tunnel-through-iap -- -L "8443:${ENDPOINT}:443"
```

The bastion has no `terraform`, so for a fully private cluster run the scripts from a machine
inside the VPC that has it.

## LiveKit on GCP

With `livekit_enabled = true` ([calls](../features/calls.md)), `01-infra` creates:

- Secret Manager secrets `xyne-livekit-server-config` and `xyne-livekit-egress-config`, readable
  only by the instances' service account `xyne-livekit-vm`;
- instance templates from `livekit_vm_image` (Ubuntu 24.04), `n2-standard-4`, 50 GB, shielded;
  regional managed instance groups `xyne-livekit-server` (a public IP each, 1 to 3 on 60% CPU) and
  `xyne-livekit-egress` (private);
- firewall rules `xyne-livekit-allow-lb` (TCP 7880 and 5349 from Google's load balancer ranges)
  and `xyne-livekit-allow-rtc` (TCP 7881, UDP 3478 and 50000–60000 from anywhere);
- the global address `xyne-livekit` with an HTTPS load balancer and a managed certificate for
  `livekit.<domain>`, an HTTP to HTTPS redirect, and with `livekit_turn_cert_secret` a TCP proxy
  on 5349; the address is the `livekit_lb_ip` output;
- `A` records for `livekit.` and `turn.` when `dns_zone` is set.

New instance templates apply to new instances only; restart the groups after a configuration
change ([calls](../features/calls.md#changing-the-configuration-or-the-keys)).

## GCP checks

After [step 11](README.md#11-check-the-install-and-sign-in):

```bash
kubectl -n istio-ingress get svc istio-ingressgateway      # EXTERNAL-IP is the xyne-ingress address
gcloud sql instances list --project acme-spaces-prod       # RUNNABLE
gcloud redis instances list --region asia-south1 --project acme-spaces-prod   # READY
gcloud storage ls --project acme-spaces-prod | grep -- -xyne-                  # eight buckets
```

## Cost

Largest first, for the defaults: the `general` pool (three `e2-standard-4` at minimum), Cloud SQL
`REGIONAL` (HA doubles it), Memorystore `STANDARD_HA`, Cloud NAT and egress, the reserved address,
the GKE cluster fee, Cloud Storage by volume. LiveKit adds two `n2-standard-4` VMs and a global
load balancer; Vespa adds `n2-standard-8` nodes with `pd-ssd`; `postgres_read_replica` adds a
second Cloud SQL instance. The bastion (`e2-small`) is negligible.

## Known limits

- **Memorystore TLS**: `redis_tls = true` turns server TLS on, but the apps are not given its CA
  and cannot verify it. Keep `false`; traffic stays inside the VPC.
- **No GPU pool** yet on GCP.
- **The sandbox pool** needs an N1 or N2 machine type (`n1-standard-4` default), not E2, and has
  secure boot off.
- **`cloud-lb` builds the node pools first**: the load balancer's backends are the pools' instance
  groups. `setup.sh` applies `-target=module.cluster` before the full plan; by hand you need the
  same two passes.
- **LiveKit shares one address** for `livekit.` and `turn.`.
- **Deletion protection** is on for the cluster and Cloud SQL; see
  [destroy](../operate/operations.md#destroy).
