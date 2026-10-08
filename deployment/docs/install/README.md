# Install Xyne Spaces

**Who this is for:** an engineer installing Xyne Spaces into their own GCP, AWS or Azure account.
Follow this page from top to bottom; it sends you to your cloud's page for the steps that differ.

- [What you will have at the end](#what-you-will-have-at-the-end)
- [Before you start](#before-you-start)
- [1. Install the tools](#1-install-the-tools)
- [2. Prepare your cloud account](#2-prepare-your-cloud-account)
- [3. Create the environment directory](#3-create-the-environment-directory)
- [4. Fill `env.conf`](#4-fill-envconf)
- [5. Fill `01-infra.tfvars`](#5-fill-01-infratfvars)
- [6. Fill `02-platform.tfvars`](#6-fill-02-platformtfvars)
- [7. Set up DNS](#7-set-up-dns)
- [8. Generate the secrets](#8-generate-the-secrets)
- [9. Run the doctor](#9-run-the-doctor)
- [10. Run the setup](#10-run-the-setup)
- [11. Check the install and sign in](#11-check-the-install-and-sign-in)
- [Next steps](#next-steps)

Examples use the environment name `prod`, the domain `xyne.example.com` and the namespace
`xyne-apps`. Substitute your own.

## What you will have at the end

A private network with a Kubernetes cluster, a managed Postgres, Redis and object storage, Argo
CD, and the Xyne apps served over HTTPS at `https://xyne.example.com`. Optional features (agents
with sandboxes, search, calls, OCR, memory, monitoring) are off at first and each is switched on
later with a few lines; see [Next steps](#next-steps).

Three stages build it, and `setup.sh` runs them in order:

| Stage | Tool | Creates |
|---|---|---|
| `01-infra` | Terraform | network, cluster and node pools, Postgres, Redis, buckets, cloud identities, optional LiveKit VMs |
| `02-platform` | Terraform | namespaces, Kubernetes Secrets, Argo CD, and the root Argo CD Application |
| Argo CD | Argo CD | Istio, cert-manager and the gateway, then every Xyne app, from this repository |

Budget about an hour, most of it waiting for the cloud: `01-infra` takes 25 to 45 minutes,
`02-platform` 5 to 10, and Argo CD 10 to 20 more.

## Before you start

| You need | Why |
|---|---|
| A cloud account with billing enabled | every resource is billable; API calls fail before the first plan without billing |
| Permissions to create networks, clusters, databases, buckets, IAM roles and DNS records | the stacks create service accounts and role bindings; your cloud page lists the roles |
| A domain you control | the app is served at `https://<domain>`; certificates need the name to resolve |
| Quota headroom in the region: vCPUs, public IPs, NAT addresses | a first install asks for roughly 24 vCPUs; your cloud page has the quota commands |
| A Google OAuth client | users sign in with Google, and the backend does not start without one ([step 8](#8-generate-the-secrets)) |

## 1. Install the tools

| Tool | Version | Needed for |
|---|---|---|
| `terraform` | 1.6.0 or newer | both Terraform stages |
| `helm` | 3.14.0 or newer | validation and troubleshooting |
| `kubectl` | within one minor version of the cluster | the Argo CD wait and troubleshooting |
| `jq`, `yq` (mikefarah v4) | any | the scripts |
| your cloud's CLI | see your cloud page | login, kubeconfig, state backend |
| `docker` or `podman` | any | generating the y-sweet key pair once |

On macOS:

```bash
brew install hashicorp/tap/terraform helm kubectl jq yq
```

On Debian or Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates gnupg curl unzip jq
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
curl -fsSLO "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && sudo install -m 0755 kubectl /usr/local/bin/kubectl
sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64 && sudo chmod +x /usr/local/bin/yq
```

then the cloud CLI from your cloud page. `terraform version` and `helm version --short` confirm
the versions; the doctor in step 9 checks them again.

## 2. Prepare your cloud account

Sign in, pick the region, check quotas and register what the cloud needs registered. This is the
only step that is different on every cloud:

- [GCP](gcp.md#prepare-the-project)
- [AWS](aws.md#prepare-the-account)
- [Azure](azure.md#prepare-the-subscription)

## 3. Create the environment directory

An environment is a directory with three files. Start from the example for your cloud:

```bash
cd xyne-spaces
cp -r deployment/environments/example-aws deployment/environments/prod
ls deployment/environments/prod
# 01-infra.tfvars  02-platform.tfvars  env.conf
```

Only `example-*` directories are tracked by git; `prod/` and the secrets you put in it never
reach a commit. To version an environment, keep it in a private repository and pass
`--env-dir <that repository>/environments` to every script.

## 4. Fill `env.conf`

`env.conf` names the cloud and where Terraform keeps its state. Lines are `KEY=VALUE` with no
quotes and no spaces; the scripts create the state bucket if it does not exist.

```
CLOUD=aws
STATE_BUCKET=acme-xyne-tfstate
STATE_REGION=ap-south-1
STATE_PREFIX=xyne
```

The keys differ by cloud (`PROJECT` on GCP, `SUBSCRIPTION_ID` and the storage account on
Azure); your cloud page has the complete file and the
[configuration reference](../reference/configuration.md#envconf) lists every key.

## 5. Fill `01-infra.tfvars`

This file sizes the cloud resources. The variables every cloud shares:

| Variable | Set it to |
|---|---|
| `region` | where everything is created |
| `name` | resource prefix and cluster name; keep `xyne` unless several installs share an account |
| `domain` | the host the app is served at, `xyne.example.com` |
| `dns_zone` | the zone you create in [step 7](#7-set-up-dns), or `""` to write DNS records yourself |
| `namespace` | `xyne-apps` (see the note in step 6) |
| `worker_names` | one name per worker in `02-platform.tfvars`, usually `["default"]` |
| `postgres_mode`, `redis_mode`, `storage_mode` | `managed` for the cloud's own services; see [data services](../features/data-services.md) for the alternatives |

Plus who may reach the Kubernetes API, which has no permissive default on any cloud: the API is
private unless you name the networks allowed to reach it
([security](../concepts/security.md#reaching-the-kubernetes-api)). Your cloud page shows a complete
file and the cloud-only variables.

Secret values such as `postgres_password` do not go in this file; step 8 writes them to
`01-infra.secrets.tfvars` next to it.

## 6. Fill `02-platform.tfvars`

This file picks what runs in the cluster. It is the same on every cloud apart from the state and
provider variables at the top, which `setup.sh` fills from `env.conf`.

```hcl
namespace      = "xyne-apps"
domain         = "xyne.example.com"
chart_revision = "chart-1.399.2"
root_revision  = "v1.399.2"
image_tag      = ""
acme_email     = "ops@example.com"

workers = [
  { name = "default" },
]
```

| Variable | Meaning |
|---|---|
| `namespace` | must equal `namespace` in `01-infra.tfvars`. Use `xyne-apps`: the published dashboard image and the claw tools address `xyne-backend.xyne-apps` and `xyne-claw-auth.xyne-apps`, so in another namespace the dashboard does not start |
| `chart_revision` | the `chart-<version>` tag whose service charts Argo CD installs. The newest: `git ls-remote --tags https://github.com/juspay/xyne-spaces.git 'chart-*' \| sed 's\|.*refs/tags/\|\|' \| sort -V \| tail -n1` |
| `root_revision` | the tag or branch the root Argo CD chart and the addons come from; pin it to the matching `v<version>` tag |
| `image_tag` | empty uses each chart's `appVersion`; set it to run a different published image tag |
| `acme_email` | contact address for the Let's Encrypt account |
| `workers` | one entry per worker role; every `name` must be in `worker_names` of `01-infra` |

Everything optional (`enable_*`, `apps`, `addon_values`) stays off for the first install.

## 7. Set up DNS

The install answers on `domain` and `*.domain`, and with LiveKit on `livekit.domain` and
`turn.domain`. The simplest path is a public zone in the same cloud, named in `dns_zone`: then
Terraform (or, on AWS, external-dns inside the cluster) writes every record, and nothing about
DNS is manual.

```bash
deployment/scripts/dns.sh --env prod zone      # create or find the zone; prints the dns_zone value
deployment/scripts/dns.sh --env prod status    # confirms the domain is delegated to it
```

`zone` prints the name servers to set at your registrar. On AWS, `dns.sh` can also register a new
domain. [dns.md](dns.md) covers registration, subdomain installs and DNS kept outside the cloud.

## 8. Generate the secrets

The example files you copied still hold placeholder lines for the secret values. Delete them
first, because they belong in the secrets files and `secrets.sh` refuses to run while they are
there (the doctor also fails a value set in both places):

- from `01-infra.tfvars`: `postgres_password`, `redis_auth`, `livekit_api_key`,
  `livekit_api_secret`, and `storage_credentials` if present;
- from `02-platform.tfvars`: the whole `app_secrets = { … }` block.

Then:

```bash
deployment/scripts/secrets.sh --env prod
```

It generates every required value on your workstation and writes them, readable only by you, to
`01-infra.secrets.tfvars` and `02-platform.secrets.tfvars` in the environment directory. No value
is printed. `setup.sh` passes each file after its stack's tfvars.

It also asks for the **Google OAuth client** users sign in with, and prints how to create one:

1. <https://console.cloud.google.com/apis/credentials/consent>: configure the consent screen
   (*Internal* when every user is in your Google Workspace, otherwise *External*).
2. <https://console.cloud.google.com/apis/credentials>: *Create credentials → OAuth client ID →
   Web application*, with origin `https://xyne.example.com` and redirect URI
   `https://xyne.example.com/api/auth/exchange`.

The client can live in any Google Cloud project, whatever cloud you install on.
[secrets.md](../reference/secrets.md) lists every value, its constraint and where it ends up.

## 9. Run the doctor

```bash
deployment/scripts/doctor.sh --env prod
```

It prints one `PASS`, `WARN` or `FAIL` row per check and ends with `doctor: PASS`. It checks the
tool versions, your cloud login, every required variable, leftover `replace-with-` placeholders,
the Google client, DNS delegation when `dns_zone` is set, on AWS whether the sandbox and GPU
instance types are offered in the region, and the prerequisites of Vespa and Hindsight when you
switch them on. Fix every
`FAIL` before going on; `setup.sh` runs the doctor again first.

A `FAIL` row names the file and line. The placeholder check rejects any line in `env.conf`, the
tfvars and `overlay.tfvars` still containing `replace-with-`, `example-project`,
`example-account`, `example-tfstate`, `exampletfstate`, `xyneexamplestorage`,
`acme-spaces-prod`, `spaces.example.com`, `Z0123456789EXAMPLE`, `123456789012` or
`00000000-0000-0000-0000-000000000000`, so the example values on these pages cannot slip through.

## 10. Run the setup

```bash
deployment/scripts/setup.sh --env prod
```

What happens, in order:

1. **doctor**, then the **state backend**: the bucket from `env.conf` is created if missing,
   with versioning.
2. **ingress addresses**: where the cloud allows it, the public address is reserved first and the
   DNS records are printed, and the run waits at `Continue with the network and cluster build?
   [yes/N]` so DNS propagates while the slow part runs. With `dns_zone` set the records are
   written for you. See [ingress](../concepts/ingress.md#addresses-and-dns-come-first).
3. **01-infra**: a plan of 120 to 150 resources, then `Apply the 01-infra plan above? [yes/N]`.
   Type `yes`. 25 to 45 minutes.
4. **kubeconfig** for the new cluster.
5. **02-platform**: plan, confirm, apply. Argo CD, the namespaces, the Secrets, the root
   Application, and on managed Postgres the `xyne-db-init` Job that grants the replication role
   and creates the databases. 5 to 10 minutes.
6. **overlay**, only when the environment has an `overlay/` directory
   ([extending](../extending.md#using-overlays)).
7. **waiting for Argo CD**: a table of Applications every 30 seconds until all are `Synced` and
   `Healthy`. Waves apply in order, so later waves show `Missing` while earlier ones are
   `Progressing`; that is normal. `platform-config` stays `Progressing` until the certificate is
   issued, which needs DNS.
8. **summary**: the app URL, the ingress address, where TLS terminates, and how to reach Argo CD.

`--auto-approve` skips the confirmations, `--only infra|platform|overlay` reruns one stage, and
`--dry-run` prints every command without running any. If the wait gives up (after
`--argo-timeout`, 1800 seconds by default), fix what the table shows and rerun
`setup.sh --env prod --only platform`; nothing is lost.

## 11. Check the install and sign in

```bash
kubectl -n argocd get applications                       # every row Synced and Healthy
kubectl -n xyne-apps get pods                            # all Running
kubectl -n istio-ingress get certificate xyne-gateway-tls   # READY True
curl -sS https://xyne.example.com/api/health             # HTTP 200
```

Open `https://xyne.example.com`, sign in with Google using an account on your organisation's
domain (public email domains cannot create an organisation), and create the organisation.

Argo CD's UI is at `kubectl -n argocd port-forward svc/argocd-server 8080:80`, user `admin`,
password from
`kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d`.
Set `argocd_expose = true` to serve it at `argocd.<domain>` instead.

If something is red, [troubleshooting](../operate/troubleshooting.md) is organised by symptom.

## Next steps

Each feature below is off in a first install and is switched on by editing the two tfvars files
and running `setup.sh` again.

| Feature | What it adds | Guide |
|---|---|---|
| Agents and sandboxes | claw, claw-auth, Kata microVM sandboxes with a live browser preview | [claw-and-sandbox.md](../features/claw-and-sandbox.md) |
| Search | Vespa with a GPU embedder, and the ingestion worker | [search.md](../features/search.md) |
| Calls | LiveKit media servers on VMs, call webhooks, the transcription agent | [calls.md](../features/calls.md) |
| Document OCR | the OCR service and a GPU model server | [ocr.md](../features/ocr.md) |
| Long-term memory | Hindsight for claw | [memory.md](../features/memory.md) |
| Monitoring | VictoriaMetrics, Grafana and an OpenTelemetry collector | [monitoring.md](../features/monitoring.md) |
| In-cluster or external data services | CloudNativePG, Redis or MinIO in the cluster, or your own servers | [data-services.md](../features/data-services.md) |

Day-two work (upgrades, scaling, backups, rotation, teardown) is in
[operations](../operate/operations.md).
