# Deploying Xyne Spaces

**Who this is for:** an engineer with their own GCP, AWS or Azure account who wants Xyne Spaces
running under their own domain, and the maintainer who later changes that install. Read it first;
it links to everything else.

- [What you get](#what-you-get)
- [Before you start](#before-you-start)
- [Deploy Xyne Spaces in 9 steps](#deploy-xyne-spaces-in-9-steps)
- [Prerequisites](#prerequisites)
- [Guides and references](#guides-and-references)
- [Two sources, one install](#two-sources-one-install)
- [Support and limits](#support-and-limits)

## What you get

One command brings up a complete, private-network install on the cloud of your choice:

```
                       your DNS: xyne.example.com  *.xyne.example.com  livekit.  turn.
                                       │                                   │
   ┌───────────────────────────────────┼───────────────────────────────────┼─────────────┐
   │ cloud account / project           │                                   │             │
   │  ┌────────────────────────────────┼──────────────────┐   ┌────────────┼───────────┐ │
   │  │ private network (VPC / VNet)   ▼                  │   │ LiveKit VM tier        │ │
   │  │   ┌──────────────────────────────────────────┐    │   │  TLS load balancer     │ │
   │  │   │ Kubernetes cluster (GKE / EKS / AKS)     │    │   │  server group  (public │ │
   │  │   │  istio-ingress: gateway + TLS (ACME)     │    │   │    IP per VM, UDP RTC) │ │
   │  │   │  argocd: Argo CD + root Application      │    │   │  egress group (private)│ │
   │  │   │  xyne: backend · dashboard · zero (×2)   │◄───┼───┤  shares the Redis below│ │
   │  │   │        ysweet · workers · claw* · ocr*   │    │   └────────────────────────┘ │
   │  │   │        transcription-agent* · edge*      │    │                              │
   │  │   │  optional: vespa · monitoring · sandbox  │    │                              │
   │  │   │  node pools: general · zero · vespa ·    │    │                              │
   │  │   │              sandbox (nested virt)       │    │                              │
   │  │   └───┬──────────────┬──────────────┬────────┘    │                              │
   │  │       │ private IP   │ private IP   │ workload id │                              │
   │  │   ┌───▼─────┐   ┌────▼────┐   ┌─────▼───────────┐ │                              │
   │  │   │ Postgres│   │  Redis  │   │ object storage  │ │                              │
   │  │   │ (+ read │   │         │   │ 8 buckets       │ │                              │
   │  │   │ replica)│   │         │   │                 │ │                              │
   │  │   └─────────┘   └─────────┘   └─────────────────┘ │                              │
   │  │   bastion* (IAP / SSM / AAD SSH)                  │                              │
   │  └───────────────────────────────────────────────────┘                              │
   │  Terraform state bucket · DNS zone (yours)                                          │
   └─────────────────────────────────────────────────────────────────────────────────────┘
   * optional, off by default
```

| Piece | Default | Where it is created |
|---|---|---|
| Network, NAT, private subnets | always | `01-infra` |
| Kubernetes cluster, `general` node pool; `zero`, `vespa`, `sandbox` pools | `general` only | `01-infra` |
| Postgres (five databases, logical replication on), optional read replica | managed service | `01-infra`, or CloudNativePG in-cluster, or yours |
| Redis | managed service | `01-infra`, or in-cluster, or yours |
| Object storage: `main docs canvas recordings workflows transcription bundles claw` | managed buckets | `01-infra`, or MinIO in-cluster, or yours |
| Workload identities binding each app to its buckets | always | `01-infra` |
| LiveKit media servers on VMs with public IPs, egress workers, TLS load balancer | off | `01-infra` |
| Argo CD, namespaces, Kubernetes Secrets | always | `02-platform` |
| Istio (mesh + ingress gateway), cert-manager (Let's Encrypt http01), Gateway, VirtualService | always | Argo CD |
| An edge load balancer terminating TLS in front of the gateway, or your own on-prem | off | `01-infra`, see [ingress.md](docs/ingress.md) |
| Xyne apps: backend, dashboard, zero, zero-replication, ysweet, workers | on | Argo CD |
| claw, claw-auth, claw-auth-frontend, transcription-agent, lighton-ocr, dashboard-edge, dashboard-external | off | Argo CD |
| Vespa search, monitoring (VictoriaMetrics + OpenTelemetry collector), Kata sandbox runtime | off | Argo CD |

## Before you start

Five things must already be true. Nothing in this repository can create them for you, and each
one stops the install at a different point if it is missing.

| You need | Why | Check it |
|---|---|---|
| A cloud account with **billing enabled**, and a project (GCP) / account (AWS) / subscription (Azure) | every resource is billable; API calls fail before the first plan without billing | `gcloud billing projects describe <project>` · `aws sts get-caller-identity` · `az account show` |
| **Permissions** to create networks, clusters, databases, buckets, IAM roles and DNS records | the stacks create service accounts and role bindings, so read-only or developer roles are not enough | the [cloud permissions table](#cloud-permissions) below |
| A **domain you control at a registrar**, and a DNS zone for it in the cloud (or the ability to add records by hand) | the app is served over HTTPS at `xyne.example.com`; by default certificates are issued by Let's Encrypt over HTTP, which needs the name to resolve to your gateway | step 3 of your cloud guide delegates the zone's name servers at the registrar |
| A **TLS certificate**, only if you put a cloud load balancer or your own in front (`ingress_mode` other than `gateway`) | the edge terminates TLS with a certificate you supply; nothing here generates one | [ingress.md](docs/ingress.md#certificates) |
| **Quota headroom** in the region: CPUs, in-use external IPs, and NAT or Elastic IPs | a regional cluster plus a managed database asks for roughly 24 CPUs before it scales | the quota commands in step 1 of your cloud guide |
| The **secret values** you will supply: no password or key is generated for you | Terraform writes exactly what you give it, so they can be rotated and audited | [secrets.md](docs/secrets.md) lists every one and how to generate it |

Budget roughly an hour, most of it waiting for the cloud, and expect a first bill in the low
hundreds of dollars a month for the defaults (see the cost notes in each guide). Everything else
the install needs, including the Terraform state bucket, is created for you by `setup.sh`.

## Deploy Xyne Spaces in 9 steps

The steps below use GCP with the Mumbai region as the running example. Every step has a
cloud-specific version with exact commands in the cloud guide:
[GCP](docs/gcp.md) · [AWS](docs/aws.md) · [Azure](docs/azure.md).

### 1. Install the tools

```bash
brew install hashicorp/tap/terraform helm kubectl jq yq
brew install --cask google-cloud-sdk        # or awscli / azure-cli, see the cloud guide
gcloud components install gke-gcloud-auth-plugin
```

You see it worked when `terraform version` prints `Terraform v1.6.0` or newer and
`helm version --short` prints `v3.14.0` or newer. Docker and `openssl` are needed once, to
generate secrets.

### 2. Log in to the cloud and pick a project, a region and a domain

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project acme-spaces-prod
```

Decide the domain the install is served under (`xyne.example.com` below). If that domain's
zone is hosted in the same cloud account, Terraform writes the records for you; otherwise you
create four records by hand at the end.

### 3. Copy the example environment

```bash
cd xyne-spaces
cp -r deployment/environments/example-gcp deployment/environments/prod
```

`deployment/environments/` ignores every directory except `example-*/`, so `prod/` and the
secrets you are about to put in it never reach git.

### 4. Fill `env.conf` and the two `.tfvars` files

`env.conf` names the cloud and the Terraform state backend; `01-infra.tfvars` sizes the cloud
resources; `02-platform.tfvars` holds the chart version, feature switches and the application
secrets. The cloud guide shows every file fully filled in, with each required value explained.
The [configuration reference](docs/configuration.md) lists every variable.

### 5. Generate the secrets

```bash
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24          # postgres_password (>= 16 chars)
openssl rand -hex 32                                          # encryption_key, claw_auth_encryption_key (64 hex)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48            # jwt_secret, zero_auth_secret, internal_s2s_key, claw_s2s_key, transcription_agent_api_key (>= 32)
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24            # zero_admin_password (>= 16)
docker run --rm ghcr.io/juspay/y-sweet:sha-221d5af y-sweet gen-auth --json   # ysweet_auth = private_key, ysweet_server_token = server_token
```

Paste them into `02-platform.tfvars` (`app_secrets`) and `01-infra.tfvars`
(`postgres_password`). [secrets.md](docs/secrets.md) explains each one, the LiveKit keys and
the rotation procedure.

### 6. Run the doctor

```bash
deployment/scripts/doctor.sh --env prod
```

It prints a table of `PASS` / `FAIL` rows and ends with `doctor: PASS`. It fails while any
placeholder from the example files remains, while a required variable is unset, or while the
cloud CLI is not logged in.

### 7. Run the setup

```bash
deployment/scripts/setup.sh --env prod
```

The script creates the state bucket, plans `01-infra` and stops with
`Apply the 01-infra plan above? [yes/N]`; type `yes`. It fetches the kubeconfig, does the same
for `02-platform`, then prints a table of Argo CD Applications every 30 seconds until all of
them read `Synced` and `Healthy`. It ends with a block like:

```
================ prod (gcp) ================
application            https://xyne.example.com
ingress address        203.0.113.10
argo cd password       kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
argo cd ui             kubectl -n argocd port-forward svc/argocd-server 8080:80 (then http://localhost:8080, user admin)
```

followed by `setup: done`.

### 8. Run the one-time SQL and point DNS at the install

Zero replicates from Postgres through logical replication, and managed services do not hand
the application role that privilege. Run the statement for your cloud once
(GCP: `ALTER USER xyne WITH REPLICATION;`; the guide shows where to run it and the AWS
`CREATE DATABASE` statements). If `dns_zone` was empty, create the records the script
printed under `create these records at your DNS provider:`. Within a few minutes
`kubectl -n istio-ingress get certificate xyne-gateway-tls` shows `READY True`.

### 9. Open the app

```bash
curl -sS https://xyne.example.com/api/health
```

returns HTTP 200. Open `https://xyne.example.com` in a browser, register the first account and
sign in; the cloud guide's "First login" section covers the sign-in provider you must
configure for that.

## Prerequisites

### Tools

| Tool | Version | Checked by `doctor.sh` |
|---|---|---|
| `terraform` | >= 1.6.0 | yes |
| `helm` | >= 3.14.0 | yes |
| `kubectl` | a client within one minor of the cluster version | present |
| `jq`, `yq` (mikefarah v4) | any | present |
| `gcloud` + `gke-gcloud-auth-plugin` | GCP only | present + logged in |
| `aws` | AWS only, v2 | present + logged in |
| `az` + `kubelogin` | Azure only | present + logged in |
| `docker`, `openssl` | to generate secrets | no |

### Cloud permissions

| Cloud | Simplest | Least privilege (roles the stacks need) |
|---|---|---|
| GCP | `roles/owner` on the project | Compute Admin, Kubernetes Engine Admin, Cloud SQL Admin, Cloud Memorystore Redis Admin, Storage Admin, Service Account Admin, Service Account User, Project IAM Admin, Secret Manager Admin, Service Usage Admin, DNS Administrator, Service Networking Admin; IAP-secured Tunnel User to reach the bastion |
| AWS | `AdministratorAccess` | EC2, VPC, EKS, RDS, ElastiCache, S3, IAM (roles, policies, OIDC provider), Secrets Manager, ACM, Elastic Load Balancing, Auto Scaling, CloudWatch Logs, SSM, Route 53 on the hosted zone; KMS when you pass key ARNs |
| Azure | `Owner` on the subscription | `Contributor` + `User Access Administrator` on the subscription (the stack creates role assignments), plus `DNS Zone Contributor` on the zone's resource group |

Quotas that bite first installs: GCP CPUs (regional GKE uses three zones) and in-use external
IP addresses; AWS Elastic IPs (one NAT per AZ) and, for the sandbox pool, bare-metal
`.metal` capacity; Azure regional vCPU families (`Dsv5`, `Esv5`) and public IP prefixes.

## Guides and references

| Document | Read it when |
|---|---|
| [docs/gcp.md](docs/gcp.md), [docs/aws.md](docs/aws.md), [docs/azure.md](docs/azure.md) | you are installing; the complete path for one cloud |
| [docs/configuration.md](docs/configuration.md) | you need a variable, a default, or a recipe (enable claw, add a worker, pin images, in-cluster Postgres) |
| [docs/ingress.md](docs/ingress.md) | how traffic reaches the install: a cloud load balancer, the Istio gateway, or one you run on-prem |
| [docs/secrets.md](docs/secrets.md) | generating, placing and rotating secrets |
| [docs/security.md](docs/security.md) | who can reach the API server, egress, storage ACLs, encryption, and what the scanners flag |
| [docs/operations.md](docs/operations.md) | upgrades, scaling, backups, certificates, observability, destroy, troubleshooting |
| [docs/architecture.md](docs/architecture.md) | how the layers fit together and why |
| [docs/extending.md](docs/extending.md) | you maintain this tree: adding a cloud, a chart, an addon, an overlay |
| [../helm-charts/README.md](../helm-charts/README.md), [../helm-charts/CHARTS.md](../helm-charts/CHARTS.md) | the per-service charts Argo CD installs |

If you change anything under `deployment/`, run `deployment/scripts/validate.sh` before opening a
pull request. It needs no cloud account and no cluster: `terraform fmt -check`, then
`terraform init -backend=false` and `terraform validate` in every module and stack, then
`helm lint` and `helm template` for `deployment/argocd/root` (twice, the second time as AWS) and
every addon chart, then `bash -n` over the scripts. It prints one line per item, exits non-zero
on the first failure it records, and takes `--terraform-only` / `--helm-only`; export
`TF_PLUGIN_CACHE_DIR` to reuse provider downloads. `.github/workflows/deployment-ci.yml` runs the
same script on every pull request that touches `deployment/`.

## Two sources, one install

This public tree is a complete install on its own. An organisation that needs private pieces
(its own SSO front door, extra services, internal DNS, custom Argo CD sources) keeps an
environment directory in a private repository and points the scripts at it with
`--env-dir <path>`. That directory may carry an `overlay/` Terraform module, applied after
`02-platform`, and `overlay_sources` in its `02-platform.tfvars`, rendered as additional Argo CD
Applications. Nothing in this tree changes, and the public environment layout stays the single
supported one.

## Support and limits

- **Sign-in**: the application signs users in with an OAuth client you create (see the cloud
  guide's "First login"); bringing an enterprise SSO in front of the install is yours to add.
- **Backups**: managed Postgres and Redis keep the automated backups you configure through
  variables; bucket versioning is a switch. Restore procedures beyond the cloud's own are not
  scripted. In-cluster Postgres has a `ScheduledBackup` knob; in-cluster Redis and MinIO have
  none.
- **Regions**: one region, one cluster. Multi-region and cross-region failover are not covered.
- **Object storage providers**: `gcs`, `s3` and `azure` are all supported. Azure `managed` mode
  creates a Blob storage account and the apps authenticate to it with their workload identity,
  so no account key is distributed; see [docs/azure.md](docs/azure.md).
- **Sandbox (Kata)**: experimental; needs nested virtualization on the sandbox node pool and an
  agent-sandbox controller source you provide.
- **Kubernetes versions**: whatever the stacks default to (`kubernetes_version` is a variable);
  no upgrade choreography beyond changing it.
