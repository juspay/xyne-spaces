# Architecture

**Who this is for:** anyone who wants to know what `setup.sh` builds and why, before changing it.
The exact shapes the layers exchange are in the [contract](../reference/contract.md); this page
explains the design.

- [The picture](#the-picture)
- [Layers](#layers)
- [What runs where](#what-runs-where)
- [How values flow](#how-values-flow)
- [Networking](#networking)
- [Identities and secrets](#identities-and-secrets)
- [Terraform state](#terraform-state)
- [Design decisions](#design-decisions)

## The picture

```
                      DNS: <domain>  *.<domain>  livekit.<domain>  turn.<domain>
                                 │                        │
 ┌───────────────────────────────┼────────────────────────┼──────────────────────────────┐
 │ cloud account                 │                        │                              │
 │  ┌────────────────────────────▼─────────────────┐  ┌───▼──────────────────────────┐  │
 │  │ private network                              │  │ LiveKit VM tier (optional)   │  │
 │  │  ┌─────────────────────────────────────────┐ │  │  TLS load balancer           │  │
 │  │  │ Kubernetes (GKE / EKS / AKS)            │ │  │  media servers, public IPs   │  │
 │  │  │  istio-ingress: gateway, TLS            │ │  │  egress workers, private     │  │
 │  │  │  argocd: Argo CD, root Application      │◄┼──┤  share the Redis below       │  │
 │  │  │  xyne-apps: backend, dashboard, zero,   │ │  └──────────────────────────────┘  │
 │  │  │    ysweet, workers, and the optional    │ │                                    │
 │  │  │    apps: claw, OCR, transcription, …    │ │                                    │
 │  │  │  optional stacks: Vespa, sandboxes,     │ │                                    │
 │  │  │    monitoring, Hindsight                │ │                                    │
 │  │  │  pools: general · zero · vespa ·        │ │                                    │
 │  │  │         sandbox · gpu                   │ │                                    │
 │  │  └────┬───────────────┬───────────┬────────┘ │                                    │
 │  │   ┌───▼─────┐   ┌─────▼───┐  ┌────▼────────┐ │                                    │
 │  │   │Postgres │   │  Redis  │  │ 8 buckets   │ │                                    │
 │  │   └─────────┘   └─────────┘  └─────────────┘ │                                    │
 │  └──────────────────────────────────────────────┘                                    │
 │  Terraform state bucket                                                              │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

## Layers

```
 environments/<env>/     env.conf · 01-infra.tfvars · 02-platform.tfvars · *.secrets.tfvars · overlay/
        │
 scripts/setup.sh        doctor → state backend → ingress addresses → 01-infra → kubeconfig
        │                → 02-platform → overlay → wait for Argo CD
        ├──► stacks/<cloud>/01-infra      cloud resources; outputs the contract
        ├──► stacks/<cloud>/02-platform   namespaces, Secrets, Argo CD, the root Application
        └──► <env>/overlay                 your private Terraform (optional)
                    │
 argocd/root             rendered by Argo CD from this repository at root_revision
        ├──► addons       Istio, cert-manager, platform-config, cloud controllers, data services,
        │                 Vespa, monitoring, Kata and sandboxes, Hindsight
        ├──► apps         one Application per chart in helm-charts/charts at chart_revision
        └──► overlay      one Application per overlay source
```

| Layer | Path | Owns | Changes when |
|---|---|---|---|
| Environment | `deployment/environments/<env>/` | every value of one install | you change sizes, switches, secrets, versions |
| Scripts | `deployment/scripts/` | order of operations, state backend, waiting | rarely |
| `01-infra` | `deployment/terraform/stacks/<cloud>/01-infra` | cloud resources and the contract | a cloud resource changes |
| Shared modules | `deployment/terraform/modules/{contract,livekit-config}` | rules every cloud shares | a cross-cloud rule changes |
| Cloud modules | `deployment/terraform/modules/<cloud>/*` | how one cloud provides a piece | that cloud's way changes |
| `02-platform` and `modules/platform` | `deployment/terraform/stacks/<cloud>/02-platform`, `modules/platform` | Secrets, Argo CD, root values | a secret or root value is added |
| Root chart | `deployment/argocd/root` | which Applications exist, their waves and values | an app or addon is added |
| Addon charts | `deployment/argocd/addons/{platform-config,pg-cluster,sandbox}` | cluster objects that are not a service | ingress, in-cluster Postgres or sandbox policy changes |
| Vespa application | `vespa-core/vespa` | the Vespa schemas and topology, and their deployment | the schemas change |
| Service charts | `helm-charts/charts/*` | how one service runs | the service changes |

## What runs where

| Namespace | Contents |
|---|---|
| `xyne-apps` (`namespace`) | every Xyne app and worker, the Secrets, Vespa, the sandbox router, egress proxy and sandboxes, in-cluster data services |
| `argocd` | Argo CD, `xyne-root` and every child Application |
| `istio-system`, `istio-ingress` | the Istio control plane; the ingress gateway, `Gateway xyne-gateway`, `Certificate xyne-gateway-tls` |
| `cert-manager` | cert-manager |
| `kube-system` | AWS: `aws-load-balancer-controller`, `cluster-autoscaler`; with the GPU pool: the NVIDIA device plugin; with sandboxes: `kata-deploy` |
| `external-dns` | AWS with `dns_zone` |
| `agent-sandbox-system` | the agent-sandbox controller |
| `cnpg-system` | the CloudNativePG operator, in-cluster Postgres only |
| `monitoring` | VictoriaMetrics, Grafana, the OpenTelemetry collector |
| `hindsight` | Hindsight and its own Postgres |

Outside the cluster: Postgres, Redis and the buckets on the private network, the LiveKit VM
groups and their load balancers, the bastion.

## How values flow

```
01-infra outputs ──remote state──► 02-platform ──► modules/platform: root_values
                                                    (contract + switches + secretChecksums)
                                                             │
                                          helm_release xyne-root (argocd-apps)
                                                             │
                                deployment/argocd/root/values.yaml ◄── merged under it
                                                             │
                     _helpers.tpl builds each app's values: image, pool, identity, env, secretEnv,
                     checksum/secrets; then mergeOverwrite(built, apps.<chart>.values, worker values)
                                                             │
                              Application <chart>: helm.values (a YAML string) ──► the service chart
```

- `apps.<chart>.values` is deep-merged over what the root chart computed, so you override a leaf
  without restating the rest.
- Contract keys are `snake_case` in Terraform and `camelCase` in the root values, converted once in
  `modules/platform/locals.tf`.
- The root chart is rendered from `repo_url` at `root_revision`; the service charts at
  `chart_revision`. Changing them and re-applying is how upgrades happen.
- Child Applications carry values as a string so `null` overrides survive server-side apply.

## Networking

- Nodes are private; egress goes through NAT. The API endpoint is private unless you name the
  networks allowed to reach it ([security](security.md)).
- One Istio ingress gateway does all host and path routing; there is no Kubernetes `Ingress` and no
  second controller. `ingress_mode` chooses what sits in front and where TLS ends
  ([ingress](ingress.md)).
- `platform-config` renders the `Gateway`, the certificate, a `STRICT` mTLS `PeerAuthentication`
  for the namespace, and the `VirtualService xyne` below.
- `argocd.<domain>` goes to Argo CD when `argocd_expose` is on; `routes.extra` in
  `addon_values["platformConfig"]` prepends your own routes.
- Apps call each other by Service name: `http://xyne-backend`, `http://xyne-claw:8081`,
  `http://xyne-claw-auth:3003`, `http://vespa-feed:8080`, `http://vespa-search:8080`,
  `http://otel-collector.monitoring.svc:4318`.
- Workloads outside the mesh (the Vespa config server and content nodes, the embedder, sandboxes,
  migration Jobs) talk plain HTTP; the workloads they call accept that on the specific port.

| Path | Destination | When |
|---|---|---|
| `/api/` | `xyne-backend:80` (timeout 50 s) | always |
| `/zero/` | `xyne-zero:80`, rewritten to `/` | always |
| `/ysweet/` | `xyne-ysweet:8080` | always |
| `/external/` | `xyne-dashboard-external:80` | that app is on |
| `/claw/api/`, `/claw/health` | `xyne-claw-auth:3003` | `xyne-claw-auth` is on |
| `/claw/`, `/claw` | `xyne-claw-auth-frontend:80` | `xyne-claw-auth-frontend` is on |
| `/claw-preview/` | `xyne-sandbox-router:8080` | sandboxes and claw are on |
| `/` | `xyne-dashboard:80` | always |

## Identities and secrets

Each app that touches cloud resources has its own cloud identity, bound to its ServiceAccount by
name: Workload Identity on GCP and Azure, IRSA on AWS. The list is in the
[contract](../reference/contract.md#identities). `worker_names` in `01-infra.tfvars` must list
every worker in `02-platform.tfvars`, because the binding is by ServiceAccount name.

| Cloud | Mechanism | What the root chart puts on the workload |
|---|---|---|
| GCP | Workload Identity: a Google service account `<name>-<identity>@<project>` with `roles/iam.workloadIdentityUser` for `<project>.svc.id.goog[<namespace>/<ksa>]` and per-bucket `roles/storage.objectAdmin` / `objectViewer` | ServiceAccount annotation `iam.gke.io/gcp-service-account` |
| AWS | IRSA: an IAM role per identity trusting the cluster's OIDC provider for that ServiceAccount, with an S3 policy per bucket; `use_pod_identity = true` adds EKS Pod Identity associations too | ServiceAccount annotation `eks.amazonaws.com/role-arn` |
| Azure | Workload Identity: a user-assigned managed identity per app with a federated credential on the AKS OIDC issuer and `Storage Blob Data Contributor` / `Reader` on its containers | annotation `azure.workload.identity/client-id` and pod label `azure.workload.identity/use: "true"` |

Storage credentials are empty in `managed` mode on every cloud; the SDKs pick up the identity. In
`incluster` and `external` modes the apps get S3 keys from their Secrets instead.

Nothing is generated inside Terraform or the cluster: every secret is an input, written by
`02-platform` into Kubernetes Secrets the charts reference ([secrets](../reference/secrets.md)).

## Terraform state

`setup.sh` creates the backend if missing and writes `backend.tf` next to each stack (ignored by
git):

| Cloud | Backend | Keys |
|---|---|---|
| GCP | GCS bucket `STATE_BUCKET`, versioning on | prefixes `<STATE_PREFIX>/01-infra`, `/02-platform`, `/overlay` |
| AWS | S3 bucket `STATE_BUCKET` in `STATE_REGION`, versioning, public access blocked, SSE-S3, lock file | `<STATE_PREFIX>/<stage>/terraform.tfstate` |
| Azure | container `STATE_CONTAINER` in storage account `STATE_STORAGE_ACCOUNT` (ZRS, versioning), Entra ID auth | `<STATE_PREFIX>/<stage>/terraform.tfstate` |

`STATE_PREFIX` defaults to `xyne`; give each environment its own when several share a bucket.
`02-platform` reads `01-infra` through `terraform_remote_state`; the script passes the bucket and
key on the command line, so the `state_*` values in `02-platform.tfvars` only matter when you run
`terraform` by hand.

## Design decisions

- **LiveKit runs on VMs**: WebRTC needs a public IP per media server and a 10,000-port UDP range,
  which a Kubernetes Service cannot expose well ([calls](../features/calls.md#why-virtual-machines)).
- **Zero connects to Postgres directly**: logical replication cannot go through a pooler
  ([data services](../features/data-services.md#why-zero-needs-a-direct-postgres-connection)).
- **Argo CD owns everything in the cluster**: Terraform installs Argo CD and one Application; the
  rest is reconciled from git, so drift is reverted and upgrades are a revision change.
- **Secrets are inputs, never generated**: every value is reviewable, rotatable and survives a
  rebuild.
- **The public tree is complete**: private additions go through overlays, never into this tree
  ([extending](../extending.md#using-overlays)).
