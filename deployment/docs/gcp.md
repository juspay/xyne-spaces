# Deploying on Google Cloud

**Who this is for:** an engineer with a Google Cloud account, following this page top to bottom
from an empty project to the application open in a browser. Nothing is assumed beyond a billing
account and a domain you control.

- [What you will build](#what-you-will-build)
- [1. Create the project and enable the APIs](#1-create-the-project-and-enable-the-apis)
- [2. Install the tools](#2-install-the-tools)
- [3. DNS: create a zone or plan manual records](#3-dns-create-a-zone-or-plan-manual-records)
- [4. Copy the example environment](#4-copy-the-example-environment)
- [5. Fill `env.conf`](#5-fill-envconf)
- [6. Fill `01-infra.tfvars`](#6-fill-01-infratfvars)
- [7. Fill `02-platform.tfvars`](#7-fill-02-platformtfvars)
- [8. Generate the secrets](#8-generate-the-secrets)
- [9. Run the doctor](#9-run-the-doctor)
- [10. Run the setup](#10-run-the-setup)
- [11. One-time SQL](#11-one-time-sql)
- [12. DNS records](#12-dns-records)
- [13. TLS](#13-tls)
- [14. Reaching the cluster](#14-reaching-the-cluster)
- [15. First login](#15-first-login)
- [16. Verification checklist](#16-verification-checklist)
- [LiveKit on GCP](#livekit-on-gcp)
- [Cost notes](#cost-notes)
- [Known limits](#known-limits)

Throughout, the example project is `acme-spaces-prod`, the region `asia-south1` (Mumbai), the
domain `xyne.example.com`, the office network `203.0.113.0/24`, the environment `prod`.
Substitute your own.

## What you will build

| Resource | GCP product | Name |
|---|---|---|
| Network | VPC `xyne`, subnet `10.10.0.0/20`, secondary ranges for pods `10.20.0.0/16` and services `10.30.0.0/20`, Cloud NAT, private services range `10.40.0.0/16` | `xyne` |
| Cluster | GKE regional, VPC-native, Dataplane V2, private nodes, Workload Identity, release channel `REGULAR`, one node pool per enabled role | `xyne` |
| Postgres | Cloud SQL for PostgreSQL 16, private IP, `db-custom-2-8192`, `REGIONAL` HA, daily backups at 02:00 UTC (7 kept), 7 days of PITR, logical decoding on, five databases, user `xyne` | `xyne-*` |
| Redis | Memorystore for Redis 7.2, `STANDARD_HA`, 4 GB, AUTH on, TLS off | `xyne` |
| Object storage | eight Cloud Storage buckets `acme-spaces-prod-xyne-{main,docs,canvas,recordings,workflows,transcription,bundles,claw}`, `STANDARD` class, CORS for `https://xyne.example.com` | |
| Identities | one Google service account per app, bound with Workload Identity | `xyne-backend@…` etc. |
| Ingress | one reserved regional external IP for the Istio gateway, which is what `ingress_mode = "gateway"` builds; the other two modes build a global external HTTPS load balancer instead, or no load balancer at all ([ingress.md](ingress.md#the-three-modes)) | `xyne-ingress` |
| DNS | `A` records for `xyne.example.com` and `*.xyne.example.com` when `dns_zone` is set | |
| LiveKit (off by default) | two managed instance groups, global HTTPS load balancer, managed certificate, Secret Manager secrets | `xyne-livekit-*` |
| Bastion (off by default) | one `e2-small` VM reachable through IAP, OS Login on, `psql` and `redis-cli` installed | `xyne-bastion` |
| Hindsight (off by default) | claw's long-term memory: the upstream `vectorize-io/hindsight` Helm chart deployed into the cluster in its own namespace, bringing its own pgvector PostgreSQL; `hindsight.url` points claw at an instance you already run instead | `hindsight` |
| State | one Cloud Storage bucket with versioning | `acme-spaces-prod-tfstate` |

Wall-clock time: about 25–35 minutes for `01-infra` (Cloud SQL `REGIONAL` and GKE dominate),
5–10 minutes for `02-platform`, 10–20 minutes for Argo CD to converge.

## 1. Create the project and enable the APIs

Create a project and link billing (skip if you have one):

```bash
gcloud auth login
gcloud projects create acme-spaces-prod --name="Xyne Spaces"
gcloud billing projects link acme-spaces-prod --billing-account=012345-6789AB-CDEF01
gcloud config set project acme-spaces-prod
gcloud auth application-default login
```

`01-infra` enables the APIs it needs itself (`enable_apis = true`). Enabling them up front avoids
the first `terraform plan` failing on a data source before the API is on:

```bash
gcloud services enable \
  compute.googleapis.com container.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com cloudresourcemanager.googleapis.com \
  servicenetworking.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  storage.googleapis.com secretmanager.googleapis.com dns.googleapis.com \
  logging.googleapis.com monitoring.googleapis.com
```

Your account needs `roles/owner` on the project, or the roles listed in the
[prerequisites table](../README.md#cloud-permissions). Check:

```bash
gcloud projects get-iam-policy acme-spaces-prod \
  --flatten="bindings[].members" --filter="bindings.members:$(gcloud config get-value account)" \
  --format="value(bindings.role)"
```

Quota: a regional GKE cluster with the default `general` pool (`e2-standard-4`, 1–5 nodes per
zone across three zones) plus a Cloud SQL `REGIONAL` instance needs roughly 24 CPUs of quota in
`asia-south1` at the start and 60 at full scale. Check `gcloud compute regions describe
asia-south1 --format="yaml(quotas)"` and request more before running the setup if `CPUS` is
below 24.

## 2. Install the tools

macOS:

```bash
brew install hashicorp/tap/terraform helm kubectl jq yq
brew install --cask google-cloud-sdk
gcloud components install gke-gcloud-auth-plugin
```

Debian/Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates gnupg curl jq
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install -y terraform google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin kubectl
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64 && sudo chmod +x /usr/local/bin/yq
```

Docker and `openssl` are needed once, in step 8. Confirm:

```bash
terraform version   # Terraform v1.6.0 or newer
helm version --short   # v3.14.0 or newer
gcloud auth print-access-token >/dev/null && echo logged in
```

## 3. DNS: create a zone or plan manual records

The install needs four names: `xyne.example.com`, `*.xyne.example.com`, and, when LiveKit is
on, `livekit.xyne.example.com` and `turn.xyne.example.com`.

**Option A, Cloud DNS (recommended):** host the zone in this project and Terraform writes the
records.

Once `env.conf` and `domain` in `01-infra.tfvars` exist (steps 4 to 6):

```bash
deployment/scripts/dns.sh --env prod zone
# set in 01-infra.tfvars:
#   dns_zone = "xyne-example-com"
deployment/scripts/dns.sh --env prod status
```

`zone` creates the managed zone when it is missing and prints its four name servers. Set them at
your registrar, or as `NS` records in the parent zone. `dns_zone` is the zone *name*, not the DNS
name. See [dns.md](dns.md).

**Option B, DNS elsewhere:** leave `dns_zone = ""`; `setup.sh` prints the records to create in
step 12.

Either way the address is reserved before the network and the cluster are built, and `setup.sh`
prints the records and waits there, so they can be created and propagate while the slow part of
the build runs. Which address they point at is decided by `ingress_mode`, and in `external` mode
there is no cloud address to reserve at all: see
[ingress.md](ingress.md#addresses-and-dns-come-first).

## 4. Copy the example environment

```bash
cd xyne-spaces
cp -r deployment/environments/example-gcp deployment/environments/prod
ls deployment/environments/prod
# 01-infra.tfvars  02-platform.tfvars  env.conf
```

`deployment/environments/.gitignore` ignores everything except `example-*/`, so `prod/` is never
committed. Keep it in a private repository if you want it versioned, and run the scripts with
`--env-dir <that repo>/environments`.

## 5. Fill `env.conf`

`env.conf` is sourced by the scripts as shell; only `KEY=VALUE` lines with no quotes or spaces
are accepted. `CLOUD` selects the stacks. `PROJECT` is exported as `CLOUDSDK_CORE_PROJECT` for
every `gcloud` call. `STATE_BUCKET` is created if missing, in `STATE_LOCATION` (defaults to the
`region` of `01-infra.tfvars`). `STATE_PREFIX` separates environments in one bucket.

`deployment/environments/prod/env.conf`:

```
CLOUD=gcp
PROJECT=acme-spaces-prod
STATE_BUCKET=acme-spaces-prod-tfstate
STATE_LOCATION=asia-south1
STATE_PREFIX=xyne
```

## 6. Fill `01-infra.tfvars`

Only four variables have no default and must be set: `project`, `region`, `domain`,
`postgres_password`. Everything else below is the recommended first-install shape; the
[configuration reference](configuration.md#gcp-01-infra) lists all 80-odd variables.

- `project`, `region`: where everything is created. The cluster is regional (three zones).
- `name`: prefix of every resource and the cluster name; lowercase, at most 16 characters.
- `domain`: the apex the application is served under. `livekit.` and `turn.` are prefixed to it.
- `dns_zone`: the Cloud DNS managed zone *name* from step 3, or `""`.
- `ingress_mode`: what sits in front of the Istio gateway. `gateway`, the default, gives the
  gateway Service a regional external IP and terminates TLS on the gateway with cert-manager,
  which is everything this page describes. `cloud-lb` has Terraform build a global external HTTPS
  load balancer that terminates TLS with a certificate you supply and re-encrypts to the gateway.
  `external` builds no load balancer at all and leaves the gateway on fixed node ports for one you
  run yourself. See [ingress.md](ingress.md#the-three-modes).
  - in `cloud-lb` mode the edge certificate is yours: `ingress_certificate_ids` for certificates
    that already exist in the project, or `ingress_certificate_pem` with `ingress_private_key_pem`
    to upload one, or neither to have Google manage a certificate for
    `ingress_certificate_domains` (the apex alone unless you list more).
- `worker_names`: one entry per worker role you will declare in `02-platform.tfvars`; each
  becomes a Workload Identity binding for ServiceAccount `xyne-worker-<name>`.
- `master_authorized_networks`: the only networks allowed to reach the Kubernetes API. Put your
  office or VPN range here; with an empty list the API is open to the internet.
- `zero_pool_enabled`, `vespa_enabled`, `sandbox_enabled`: extra node pools. Off for a first
  install; Zero runs on the `general` pool until you turn its pool on.
- `bastion_enabled`: an IAP-reachable VM inside the VPC with `psql` and `redis-cli` already
  installed, useful for the one-time SQL and for private endpoints. Cheap; turn it on unless you
  have another way into the network.
- `postgres_mode`, `redis_mode`, `storage_mode`: `managed` uses Cloud SQL, Memorystore and
  Cloud Storage. See [architecture.md](architecture.md#component-modes) for `incluster` and
  `external`.
- `postgres_password`: at least 16 characters; the password of the `xyne` role. Generated in
  step 8.
- `postgres_read_replica`: a read replica behind `DATABASE_READ_REPLICA_POOL_URL`; off to start.
- `livekit_*`: LiveKit stays off until you have DNS in place; see [LiveKit on GCP](#livekit-on-gcp).

`deployment/environments/prod/01-infra.tfvars`:

```hcl
project = "acme-spaces-prod"
region  = "asia-south1"
name    = "xyne"
domain  = "xyne.example.com"

dns_zone     = "xyne-example-com"
worker_names = ["default"]

master_authorized_networks = [
  { cidr_block = "203.0.113.0/24", display_name = "office" },
]

zero_pool_enabled = false
vespa_enabled     = false
sandbox_enabled   = false
bastion_enabled   = true

postgres_mode         = "managed"
postgres_password     = "replace-with-24-or-more-random-characters"
postgres_read_replica = false

redis_mode = "managed"

storage_mode = "managed"

livekit_enabled    = false
livekit_api_key    = "replace-with-key-from-livekit-generate-keys"
livekit_api_secret = "replace-with-secret-from-livekit-generate-keys"
```

The LiveKit key pair is harmless while `livekit_enabled = false`; set it now so enabling LiveKit
later is a one-line change.

## 7. Fill `02-platform.tfvars`

Required: `project`, `region`, `chart_revision`, `app_secrets`. `state_bucket` and `state_prefix`
are passed by `setup.sh` from `env.conf`; the values in the file only matter when you run
`terraform` by hand.

- `namespace`: the application namespace; must match `namespace` in `01-infra.tfvars` (both
  default to `xyne`).
- `domain`: repeat the apex; leave `""` to take it from the `01-infra` outputs.
- `chart_revision`: the `chart-<version>` git tag of this repository whose Helm charts Argo CD
  installs. Pick the newest `chart-*` tag:
  `git ls-remote --tags https://github.com/juspay/xyne-spaces.git 'chart-*' | sed 's|.*refs/tags/||' | sort -V | tail -n1`.
- `root_revision`: the branch or tag the root Argo CD chart (`deployment/argocd/root`) is
  rendered from. `main` follows this tree; pin it to the same tag as `chart_revision` when you
  want reproducible installs.
- `image_registry`, `image_tag`: leave empty to pull `ghcr.io/juspay/*` at the chart's
  `appVersion`; set them to use a mirror ([recipe](configuration.md#pin-images-to-your-own-registry)).
- `acme_email`: the contact address on the Let's Encrypt account cert-manager creates.
- `enable_vespa`, `enable_monitoring`, `enable_sandbox`: the optional addons; off to start.
- `enable_hindsight`: deploy Hindsight, claw's long-term memory, from the upstream chart into its
  own `hindsight` namespace; off to start. Claw is pointed at
  `http://hindsight-api.hindsight:8888` for you.
  - The chart brings its own pgvector PostgreSQL, separate from the Postgres the rest of the
    install uses. Point it at a database of yours through `addon_values["hindsight"]`
    (`postgresql.enabled`, `postgresql.external.*`). The bundled database's default password is
    the literal `hindsight`, so change it if you keep the bundled one.
  - The LLM provider, model and base URL Hindsight extracts facts with are chart values as well:
    `api.env.HINDSIGHT_API_LLM_PROVIDER`, `api.env.HINDSIGHT_API_LLM_MODEL` and
    `api.env.HINDSIGHT_API_LLM_BASE_URL` in `addon_values["hindsight"]`.
- `hindsight`: the `url` and `tenant` of a Hindsight you already run elsewhere. A non-empty `url`
  always wins over the deployed addon. With neither set, claw's long-term memory is off, which is
  the default.
- `apps`: per-chart switches and value overrides. `xyne-claw` is off by default already; the
  entry shows the syntax.
- `workers`: one entry per worker role; `name` must appear in `worker_names` above. Without
  `env` a worker runs no role; the recipe in
  [configuration.md](configuration.md#add-a-worker-role) shows the flags.
- `app_secrets`: generated in step 8.

`deployment/environments/prod/02-platform.tfvars`:

```hcl
project      = "acme-spaces-prod"
region       = "asia-south1"
state_bucket = "acme-spaces-prod-tfstate"
state_prefix = "xyne/01-infra"

namespace      = "xyne"
domain         = "xyne.example.com"
chart_revision = "chart-1.356.0"
root_revision  = "main"
image_registry = ""
image_tag      = ""
acme_email     = "ops@example.com"

enable_vespa      = false
enable_monitoring = false
enable_sandbox    = false
enable_hindsight  = false

hindsight = {
  url    = ""
  tenant = "default"
}

apps = {
  xyne-claw = { enabled = false }
}

workers = [
  {
    name = "default"
    env = {
      ENABLE_NOTIFICATION_WORKER = "true"
      ENABLE_WORKER_SCHEDULER    = "true"
      ENABLE_WORKFLOW_RECOVERY   = "true"
    }
  },
]

app_secrets = {
  jwt_secret                  = "replace-with-32-or-more-random-characters"
  zero_auth_secret            = "replace-with-32-or-more-random-characters"
  zero_admin_password         = "replace-with-16-or-more-chars"
  encryption_key              = "replace-with-64-hex-characters"
  internal_s2s_key            = "replace-with-32-or-more-random-characters"
  claw_s2s_key                = "replace-with-32-or-more-random-characters"
  claw_auth_encryption_key    = "replace-with-64-hex-characters"
  ysweet_auth                 = "replace-with-private_key-from-y-sweet-gen-auth"
  ysweet_server_token         = "replace-with-server_token-from-y-sweet-gen-auth"
  transcription_agent_api_key = "replace-with-32-or-more-random-characters"
}
```

The values shown are examples generated for this page; never reuse them.

## 8. Generate the secrets

Each value has a minimum enforced by `02-platform` (the apply fails otherwise):

```bash
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24     # postgres_password        (>= 16)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # jwt_secret               (>= 32)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # zero_auth_secret         (>= 32)
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24     # zero_admin_password      (>= 16)
openssl rand -hex 32                                   # encryption_key           (exactly 64 hex)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # internal_s2s_key         (>= 32)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # claw_s2s_key             (>= 32)
openssl rand -hex 32                                   # claw_auth_encryption_key (exactly 64 hex)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # transcription_agent_api_key (>= 32)
docker run --rm ghcr.io/juspay/y-sweet:sha-221d5af y-sweet gen-auth --json
#   "private_key"  -> ysweet_auth
#   "server_token" -> ysweet_server_token
docker run --rm livekit/livekit-server:v1.9.1 generate-keys
#   API Key    -> livekit_api_key
#   API Secret -> livekit_api_secret
```

Paste `postgres_password` and the LiveKit pair into `01-infra.tfvars`, the rest into
`app_secrets`. [secrets.md](secrets.md) describes what each one protects and how to rotate it.

Two more entries in `app_secrets` are optional and are not generated here. `hindsight_api_key` is
the key claw presents when it calls the Hindsight API; leave it empty when the instance needs no
auth. `hindsight_llm_api_key` is the LLM provider key Hindsight itself uses to extract facts, and
applies only when you deploy Hindsight with `enable_hindsight`; without it Hindsight starts but
extracts nothing. Both may be left empty.

## 9. Run the doctor

```bash
deployment/scripts/doctor.sh --env prod
```

Expected output (abridged):

```
14:03:19 doctor: env=prod cloud=gcp dir=/…/deployment/environments/prod

STATUS  CHECK                                         DETAIL
------  --------------------------------------------  ------
PASS    env.conf                                      /…/deployment/environments/prod/env.conf
PASS    terraform >= 1.6.0                            1.9.8
PASS    helm >= 3.14.0                                3.16.2
PASS    kubectl                                       1.31.2
PASS    jq                                            1.7.1
PASS    yq                                            4.44.3
PASS    gcloud                                        499.0.0
PASS    gke-gcloud-auth-plugin                        present
PASS    gcloud auth                                   ok
PASS    01-infra.tfvars                               …
PASS    02-platform.tfvars                            …
PASS    01-infra: project                             set
PASS    01-infra: region                              set
PASS    01-infra: domain                              set
PASS    01-infra: postgres_password                   set
PASS    02-platform: project                          set
PASS    02-platform: region                           set
PASS    02-platform: state_bucket                     set
PASS    02-platform: chart_revision                   set
PASS    02-platform: app_secrets                      set
PASS    placeholders in env.conf                      none
PASS    placeholders in 01-infra.tfvars               none
PASS    placeholders in 02-platform.tfvars            none

14:03:21 doctor: PASS
```

A `FAIL` row names the file and line. The placeholder check rejects any line still containing
`replace-with-`, `example-project`, `example-account`, `example-tfstate`, `exampletfstate`,
`spaces.example.com`, `Z0123456789EXAMPLE`, `123456789012` or
`00000000-0000-0000-0000-000000000000`.

## 10. Run the setup

```bash
deployment/scripts/setup.sh --env prod
```

What happens, in order, and what you see:

1. **doctor** runs again (skip with `--skip-doctor`).
2. **state backend**: `gcloud storage buckets create gs://acme-spaces-prod-tfstate …` (only if
   missing) and `… update --versioning`. Then
   `backend for 01-infra -> …/stacks/gcp/01-infra/backend.tf`.
3. **stage 01-infra**, which begins with **stage ingress addresses**: a targeted apply reserves
   the ingress address, the records to create are printed, and the run stops at `Continue with
   the network and cluster build? [yes/N]` so DNS can propagate while everything else is built.
   `--skip-dns-gate` drops that stage and its wait. In `cloud-lb` mode a second targeted apply,
   `-target=module.cluster`, runs next on a cluster that does not exist yet, because the load
   balancer's backends are the node pools' managed instance groups. Then the stage proper:
   `terraform init`, `terraform plan -out=plan.tfplan`, a plan of roughly 120 resources, then the
   prompt `Apply the 01-infra plan above? [yes/N]`. Type `yes`. Cloud SQL takes 10–15 minutes, GKE
   about 10, Memorystore about 5, in parallel; expect 25–35 minutes.
4. **kubeconfig**: `gcloud container clusters get-credentials xyne --region asia-south1 --project acme-spaces-prod`.
5. **stage 02-platform**: the same init/plan/confirm/apply; installs Argo CD (`helm_release
   argocd`, up to 15 minutes allowed, usually 3), the two namespaces, the six Secrets and the
   `xyne-root` Application. 5–10 minutes.
6. **overlay**: `no overlay directory at …/prod/overlay, skipping`.
7. **waiting for Argo CD**: `kubectl -n argocd wait … application/xyne-root`, then every 30
   seconds a table:

   ```
   APPLICATION                              SYNC         HEALTH
   cert-manager                             Synced       Healthy
   istio-base                               Synced       Healthy
   istio-ingressgateway                     Synced       Progressing
   istiod                                   Synced       Healthy
   platform-config                          OutOfSync    Missing
   xyne-backend                             OutOfSync    Missing
   …
   14:41:02 7 Application(s) pending, checking again in 30s
   ```

   Waves apply in order, so `Missing` on wave 0 while wave -2 is `Progressing` is normal.
   `platform-config` shows `Progressing` until the `Certificate` is issued, which needs DNS
   (step 12); with `dns_zone` set the records already exist and it usually turns `Healthy`
   within five minutes. The wait gives up after `--argo-timeout` seconds (default 1800); rerun
   `setup.sh --env prod --only platform` to resume waiting, nothing is lost.
8. **summary**:

   ```
   ================ prod (gcp) ================
   application            https://xyne.example.com
   ingress mode           gateway
   ingress address        203.0.113.10
   tls terminates         on the istio gateway (cert-manager)
   argo cd password       kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
   argo cd ui             kubectl -n argocd port-forward svc/argocd-server 8080:80 (then http://localhost:8080, user admin)

   14:52:10 setup: done
   ```

   In `cloud-lb` and `external` mode the `ingress address` line is `edge address` instead, and
   `tls terminates` names the edge; `external` adds the `lb-config.sh` command to run next.

Use `--auto-approve` to skip the confirmations and `--dry-run` to print every command without
running any (no cloud login needed). `--only infra|platform|overlay` reruns one stage.

## 11. One-time SQL

Zero's replication manager opens a logical replication connection as the `xyne` role. Cloud SQL
creates the role without the `REPLICATION` attribute, so until you grant it `xyne-zero-replication`
crash-loops with `must be superuser or replication role to start walsender`. With
`postgres_mode = "managed"`, `02-platform` grants it before Argo CD starts any app, through the
`xyne-db-init` Job, which also creates any missing database; nothing is left to do by hand. The
rest of this step is for an external database, or for a Job that failed
(`kubectl -n xyne logs job/xyne-db-init`). The SQL:

```sql
ALTER USER xyne WITH REPLICATION;
```

Where to run it (the Cloud SQL instance has only a private IP):

**From inside the cluster**, no bastion needed:

```bash
DATABASE_URL="$(kubectl -n xyne get secret xyne-backend-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)"
kubectl -n xyne run psql --rm -it --restart=Never --image=postgres:16 \
  --overrides='{"metadata":{"annotations":{"sidecar.istio.io/inject":"false"}}}' \
  -- psql "$DATABASE_URL" -c 'ALTER USER xyne WITH REPLICATION;'
```

You see `ALTER ROLE` and the pod is deleted.

**From the bastion** (`bastion_enabled = true`):

```bash
# on your workstation: the private IP of the primary
terraform -chdir=deployment/terraform/stacks/gcp/01-infra output -json postgres | jq -r .host
# on the bastion
gcloud compute ssh xyne-bastion --project acme-spaces-prod --zone asia-south1-a --tunnel-through-iap
psql "host=10.40.0.3 user=xyne dbname=xyne sslmode=require" -c 'ALTER USER xyne WITH REPLICATION;'
```

The zone is `bastion_zone` if you set it, otherwise the first zone of the region. Afterwards:

```bash
kubectl -n xyne rollout restart deployment/xyne-zero-replication
kubectl -n xyne rollout status deployment/xyne-zero-replication
```

## 12. DNS records

With `dns_zone` set, `01-infra` already created these in Cloud DNS and there is nothing to do:

| Record | Type | Value |
|---|---|---|
| `xyne.example.com.` | `A` | the `xyne-ingress` address (`ingress address` in the summary) |
| `*.xyne.example.com.` | `A` | the same address |
| `livekit.xyne.example.com.` | `A` | the LiveKit global address (only with `livekit_enabled`) |
| `turn.xyne.example.com.` | `A` | the same LiveKit address |

With `dns_zone = ""`, the summary ends with `dns_zone is empty, create these records at your DNS
provider:` and the addresses to point them at; create them with TTL 300. The LiveKit address is
the `livekit_lb_ip` output, which the summary prints as `livekit address` and `livekit turn
address` (both names resolve to the same global address):

```bash
terraform -chdir=deployment/terraform/stacks/gcp/01-infra output -raw livekit_lb_ip
```

Confirm propagation with `dig +short xyne.example.com` before expecting a certificate.

The table above is `gateway` mode. In `cloud-lb` mode the apex and wildcard point at the edge load
balancer's global address instead, which Terraform knows and writes itself when `dns_zone` is set.
In `external` mode Terraform writes no record at all: both names point at the load balancer you
run. See [ingress.md](ingress.md#addresses-and-dns-come-first).

## 13. TLS

**The application** gets its certificate from cert-manager: `platform-config` creates
`ClusterIssuer letsencrypt` (ACME, `http01` solver through the Istio ingress class, account
email `acme_email`) and `Certificate istio-ingress/xyne-gateway-tls` for `xyne.example.com`.
Issuance needs the DNS record to resolve to the gateway address, then takes a minute or two:

```bash
kubectl -n istio-ingress get certificate xyne-gateway-tls
# NAME               READY   SECRET             AGE
# xyne-gateway-tls   True    xyne-gateway-tls   3m
```

Renewal is automatic. Set `addons.certManager.wildcard: true` through
`addon_values["certManager"]` only if you switch the solver, since `http01` cannot issue
wildcards.

That certificate is the one a browser sees in `gateway` mode. In `cloud-lb` and `external` mode
the browser sees the certificate you supplied to the edge instead, and `xyne-gateway-tls` becomes
a self-signed certificate covering only the inner leg between the edge and the gateway.
`ingress_tls` picks which of the two it is: `acme`, `internal`, `existing` or `none`. See
[ingress.md](ingress.md#certificates).

**LiveKit signalling** (`livekit.xyne.example.com`) is terminated by a Google-managed certificate
on the global load balancer. It becomes `ACTIVE` only after the `A` record points at the load
balancer; until then the load balancer answers with a default certificate. Check:

```bash
gcloud compute ssl-certificates describe xyne-livekit-signal --global --format='value(managed.status)'
```

**TURN over TLS** (`turn.xyne.example.com:5349`) is optional. Put a PEM bundle (certificate
chain followed by the private key) in Secret Manager and name the secret in
`livekit_turn_cert_secret`; the VMs fetch it at boot. Without it TURN runs on UDP 3478 only.

```bash
cat fullchain.pem privkey.pem > turn-bundle.pem
gcloud secrets create xyne-livekit-turn-cert --data-file=turn-bundle.pem --replication-policy=automatic
```

## 14. Reaching the cluster

```bash
gcloud container clusters get-credentials xyne --region asia-south1 --project acme-spaces-prod
kubectl get nodes
```

works from any address in `master_authorized_networks`. With `enable_private_endpoint = true`
the API has no public address: run the scripts on the bastion, or open a tunnel:

```bash
ENDPOINT="$(gcloud container clusters describe xyne --region asia-south1 --project acme-spaces-prod --format='value(privateClusterConfig.privateEndpoint)')"
gcloud compute ssh xyne-bastion --project acme-spaces-prod --zone asia-south1-a --tunnel-through-iap -- -L "8443:${ENDPOINT}:443"
```

The bastion's startup script installs `gcloud`, `kubectl`, `helm`, `psql` and `redis-cli`;
`terraform` is not installed, so for a fully private cluster run the scripts from a machine
inside the VPC that has it.

## 15. First login

The application signs users in with an OAuth client or by email and password. Email
registration sends a verification code, and sending mail is itself configured through the same
Google OAuth client plus a refresh token (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`, `EMAIL_FROM`), so create the client first:

1. In the Google Cloud console, *APIs & Services → Credentials → Create credentials → OAuth
   client ID*, type *Web application*, authorized redirect URI
   `https://xyne.example.com/api/auth/exchange`, authorized JavaScript origin
   `https://xyne.example.com`.
2. Add the client to the backend Secret and map it into the backend and worker environment.
   Append to `02-platform.tfvars`:

   ```hcl
   extra_secret_data = {
     xyne-backend-secrets = {
       GOOGLE_CLIENT_ID     = "123456789012-abcdefghijklmnop.apps.googleusercontent.com"
       GOOGLE_CLIENT_SECRET = "GOCSPX-…"
     }
   }
   ```

   and, in `apps`:

   ```hcl
   apps = {
     xyne-claw = { enabled = false }
     xyne-backend = {
       values = <<-YAML
         secretEnv:
           GOOGLE_CLIENT_ID: {name: xyne-backend-secrets, key: GOOGLE_CLIENT_ID}
           GOOGLE_CLIENT_SECRET: {name: xyne-backend-secrets, key: GOOGLE_CLIENT_SECRET}
       YAML
     }
   }
   ```

3. `deployment/scripts/setup.sh --env prod --only platform`, then
   `kubectl -n xyne rollout restart deployment/xyne-backend`.
4. Open `https://xyne.example.com`, choose the Google sign-in, sign in with an account on your
   organisation's domain (the application refuses public email domains such as `gmail.com` for
   organisation creation) and create the organisation.

`curl -sS https://xyne.example.com/api/v2/auth/providers` shows which providers are active:
`{"google":true,"microsoft":false,"email":true}`.

## 16. Verification checklist

```bash
kubectl -n argocd get applications                                      # every row Synced / Healthy
kubectl -n xyne get pods                                                # all Running, 2/2 (app + istio-proxy)
kubectl -n istio-ingress get svc istio-ingressgateway                   # EXTERNAL-IP = the xyne-ingress address
kubectl -n istio-ingress get certificate xyne-gateway-tls               # READY True
curl -sSI https://xyne.example.com/ | head -n1                          # HTTP/2 200
curl -sS https://xyne.example.com/api/health                            # 200 with a JSON body
kubectl -n xyne logs deployment/xyne-zero-replication --tail=20         # no "replication role" errors
gcloud sql instances list --project acme-spaces-prod                    # RUNNABLE
gcloud redis instances list --region asia-south1 --project acme-spaces-prod   # READY
gcloud storage ls --project acme-spaces-prod | grep acme-spaces-prod-xyne-    # eight buckets
```

The third line is `gateway` mode. In `cloud-lb` and `external` mode the gateway Service has no
`EXTERNAL-IP` and that is correct; check the edge address the summary printed instead. In
`external` mode also run `deployment/scripts/lb-config.sh --env prod --format all` and confirm
your load balancer matches what it prints ([ingress.md](ingress.md#checking-it-works)).

With Hindsight on and claw enabled, also:

```bash
kubectl -n hindsight get pods
kubectl -n xyne get deploy xyne-claw -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="HINDSIGHT_URL")].value}'
```

The first shows the API pod Running. The second prints the address claw uses, either the
in-cluster service or the `hindsight.url` you set; nothing printed means memory is off.

Argo CD UI: `kubectl -n argocd port-forward svc/argocd-server 8080:80`, then
`http://localhost:8080`, user `admin`, password from the summary command.

## LiveKit on GCP

Turn it on once DNS resolves and Redis is `managed` or `external`:

```hcl
livekit_enabled    = true
livekit_api_key    = "replace-with-key-from-livekit-generate-keys"
livekit_api_secret = "replace-with-secret-from-livekit-generate-keys"
```

then `setup.sh --env prod` (both stages: `02-platform` must re-run to pass `LIVEKIT_URL` and the
keys into the cluster). `01-infra` creates:

- Secret Manager secrets `xyne-livekit-server-config` and `xyne-livekit-egress-config` with the
  rendered YAML, readable only by the instances' service account `xyne-livekit-vm`;
- instance templates from `livekit_vm_image` (Ubuntu 24.04), `n2-standard-4`, 50 GB, shielded;
  regional MIGs `xyne-livekit-server` (public IP each, autoscaled 1–3 on 60% CPU) and
  `xyne-livekit-egress` (private);
- firewall rules `xyne-livekit-allow-lb` (TCP 7880, 5349 from Google's load-balancer ranges) and
  `xyne-livekit-allow-rtc` (TCP 7881, UDP 3478 and 50000–60000 from anywhere);
- global address `xyne-livekit`, HTTPS load balancer with managed certificate for
  `livekit.xyne.example.com`, HTTP→HTTPS redirect, and with `livekit_turn_cert_secret` a TCP
  proxy on 5349; the address is the `livekit_lb_ip` output;
- `A` records for `livekit.` and `turn.` when `dns_zone` is set.

Enable the transcription agent to use it: `apps = { xyne-transcription-agent = { enabled = true } }`.

## Cost notes

Rough monthly shape of the defaults in `asia-south1`, largest first: the `general` node pool
(three `e2-standard-4` at minimum, autoscaling to fifteen), Cloud SQL `db-custom-2-8192`
`REGIONAL` (HA doubles it), Memorystore `STANDARD_HA` 4 GB, Cloud NAT and egress, the reserved
IP, GKE's per-cluster fee, Cloud Storage by volume. LiveKit adds two `n2-standard-4` VMs plus a
global load balancer. The bastion (`e2-small`) is negligible. Turning on `postgres_read_replica`
adds a second Cloud SQL instance; `vespa_enabled` adds `n2-standard-8` nodes with `pd-ssd`.

## Known limits

- **Memorystore TLS**: `redis_tls = true` enables server-side TLS, but the instance's CA
  certificate is not handed to the applications, so they cannot verify it. Keep `redis_tls`
  false (traffic stays inside the VPC) until a CA distribution step exists.
- **LiveKit shares one address**: `livekit.` and `turn.` both point at the global address in the
  `livekit_lb_ip` output, so the TURN TCP proxy and the signalling load balancer cannot be moved
  apart.
- **Sandbox pool**: `sandbox_enabled = true` creates a pool with `UBUNTU_CONTAINERD` and nested
  virtualization; that needs an N1 or N2 machine type (`n1-standard-4` default), not E2. Secure
  boot is off on that pool. Kata itself is experimental; see
  [configuration.md](configuration.md#turn-on-vespa-monitoring-or-the-sandbox).
- **`cloud-lb` needs the node pools before the load balancer**: the backend service points at the
  node pools' managed instance groups and sets a named port on each, so on a brand-new cluster
  there is nothing to plan against. `setup.sh` applies `-target=module.cluster` first and then the
  full plan; running `terraform apply` by hand on an empty state needs the same two passes.
- **Google-managed certificates cannot issue wildcards**, so `ingress_certificate_domains`
  defaults to the apex alone. To put `*.xyne.example.com` on the edge certificate, supply your own
  through `ingress_certificate_ids` or `ingress_certificate_pem`.
- **Managed certificate for LiveKit** can take up to an hour to become `ACTIVE` after DNS
  changes; the application gateway certificate (cert-manager) does not have this delay.
- **Deletion protection** is on for the cluster and Cloud SQL; see
  [operations.md](operations.md#destroy) before tearing down.
