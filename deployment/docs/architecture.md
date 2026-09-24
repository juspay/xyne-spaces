# Architecture

**Who this is for:** anyone who wants to know what `setup.sh` actually builds and why, before
changing it; read it after the first install, or before extending the tree.

- [Layers](#layers)
- [What runs where](#what-runs-where)
- [Sync waves](#sync-waves)
- [How values flow](#how-values-flow)
- [Component modes](#component-modes)
- [Why LiveKit runs on virtual machines](#why-livekit-runs-on-virtual-machines)
- [Why Zero needs logical replication and the direct host](#why-zero-needs-logical-replication-and-the-direct-host)
- [Identities](#identities)
- [Secrets](#secrets)
- [Networking and ingress](#networking-and-ingress)
- [Terraform state](#terraform-state)

The exact shape of every object the layers pass between each other is written down in
[contract.md](contract.md), the internal interface reference. This page explains the design;
that page is the spec.

## Layers

```
 environments/<env>/          env.conf · 01-infra.tfvars · 02-platform.tfvars · overlay/ (optional)
        │
        ▼
 scripts/setup.sh             doctor → state backend → ingress addresses → 01-infra → kubeconfig → 02-platform → overlay → wait for Argo CD
        │
        ├──► terraform/stacks/<cloud>/01-infra      cloud resources; calls modules/<cloud>/* and modules/contract
        │           │
        │           ▼  remote state outputs (the contract: cluster, postgres, redis, storage, identities, node_pools, ingress, livekit)
        │
        ├──► terraform/stacks/<cloud>/02-platform   kubernetes/helm providers for that cloud; calls modules/platform
        │           │
        │           ▼  namespaces, Kubernetes Secrets, Argo CD (Helm), the root Application with the contract as values
        │
        └──► environments/<env>/overlay              your private Terraform, given `infra` and `namespace`
                    │
                    ▼
 argocd/root (Helm chart, rendered by Argo CD from this repository at `root_revision`)
        │
        ├──► addons: istio-base · istiod · istio-ingressgateway · cert-manager · platform-config
        │            aws-load-balancer-controller · cnpg-operator · pg-cluster · xyne-redis · minio
        │            vespa (×4 + embedder + proxy) · victoria-metrics · otel-collector · kata-deploy · sandbox · router · egress-proxy
        │
        ├──► apps: one Application per chart under helm-charts/charts/ at `chart_revision`
        │
        └──► overlay.sources: one Application per entry, wave 2
```

| Layer | Path | Owns | Changes when |
|---|---|---|---|
| Environment | `deployment/environments/<env>/` | every value specific to one install | you change sizes, switches, secrets, versions |
| Scripts | `deployment/scripts/` | order of operations, state backend, confirmations, waiting | rarely |
| `01-infra` | `deployment/terraform/stacks/<cloud>/01-infra` | cloud resources and the contract outputs | a cloud resource changes |
| Shared modules | `deployment/terraform/modules/contract`, `modules/livekit-config` | mode resolution, bucket naming, preconditions, LiveKit YAML | a rule that applies to every cloud changes |
| Cloud modules | `deployment/terraform/modules/<cloud>/*` | network, cluster, iam, postgres, redis, storage, bastion, livekit | the way one cloud provides a piece changes |
| `02-platform` | `deployment/terraform/stacks/<cloud>/02-platform` | provider wiring, remote state read | a cloud's auth mechanism changes |
| Platform module | `deployment/terraform/modules/platform` | namespaces, Secrets, Argo CD, root Application values | a secret or root value is added |
| Root chart | `deployment/argocd/root` | which Applications exist, their waves, their values | an addon or app is added |
| Addon charts | `deployment/argocd/addons/{platform-config,pg-cluster,sandbox}` | Kubernetes objects that are not a service | ingress, in-cluster Postgres or sandbox policy changes |
| Service charts | `helm-charts/charts/*` | how one service runs | the service changes |

## What runs where

| Namespace | Contents | Created by |
|---|---|---|
| `xyne` (`namespace`) | every Xyne app, workers, the Secrets, `pg-cluster`, `xyne-redis`, `minio`, Vespa, sandbox objects, `PeerAuthentication` | `02-platform` (label `istio-injection: enabled`) |
| `argocd` (`argocd_namespace`) | Argo CD, `xyne-root` and every child Application | `02-platform` |
| `istio-system` | `istio-base`, `istiod` | Argo CD |
| `istio-ingress` | the ingress gateway Deployment and its `LoadBalancer` Service, `Gateway xyne-gateway`, `Certificate xyne-gateway-tls` | Argo CD |
| `cert-manager` | cert-manager and its CRDs | Argo CD |
| `kube-system` | `aws-load-balancer-controller` (AWS), `kata-deploy` (sandbox) | Argo CD |
| `cnpg-system` | the CloudNativePG operator (`postgres_mode = "incluster"`) | Argo CD |
| `monitoring` | `victoria-metrics-k8s-stack`, `otel-collector` (`enable_monitoring`) | Argo CD |
| `hindsight` | the upstream Hindsight chart and its own pgvector Postgres (`enable_hindsight`); claw's long-term memory, or point `hindsight.url` at one you already run | Argo CD |
| `agent-sandbox-system` | the agent-sandbox controller when `addons.sandbox.controller.repoURL` is set | Argo CD |

Outside the cluster: Postgres, Redis and the buckets on the cloud's private network; LiveKit
server and egress VM groups with their load balancers; the bastion.

## Sync waves

Argo CD applies the children of `xyne-root` in wave order and waits for each wave to be healthy
before starting the next.

| Wave | Applications | Why here |
|---|---|---|
| -10 | `AppProject xyne` | every other Application belongs to it |
| -4 | `aws-load-balancer-controller` | must exist before a `LoadBalancer` Service is reconciled |
| -3 | `istio-base`, `istiod`, `cert-manager` | CRDs and the control plane |
| -2 | `istio-ingressgateway`, `platform-config`, `cnpg-operator`, `minio`, `xyne-redis` | the gateway Service (one wave after the controller), the ClusterIssuer/Gateway/VirtualService, the data services the apps need |
| -1 | `pg-cluster` | the CNPG `Cluster` needs the operator |
| 0 | `xyne-backend`, `xyne-dashboard`, `xyne-zero`, `xyne-zero-replication`, `xyne-ysweet`, `xyne-worker-<name>`, and the optional apps | the application |
| 1 | `xyne-vespa`, `xyne-vespa-content`, `xyne-vespa-feed`, `xyne-vespa-search`, `xyne-vespa-embedder`, `xyne-tei-batch-proxy`, `victoria-metrics`, `otel-collector`, `kata-deploy`, `agent-sandbox-controller`, `xyne-sandbox-router`, `xyne-egress-proxy`, `hindsight` | optional, consumed by the apps at run time, never a prerequisite |
| 2 | `sandbox` | the `SandboxTemplate` and `SandboxWarmPool`, one wave after the controller that owns their CRDs |
| 2 | every `overlay.sources` entry | private additions see a finished install |

Every Application has `automated: {prune: true, selfHeal: true}`, `CreateNamespace=true`,
`ServerSideApply=true` and a retry policy of 10 attempts with exponential backoff from 30s to
10m. Deployments ignore `/spec/replicas` so HPAs own the replica count.

## How values flow

```
01-infra outputs ──(remote state)──► 02-platform ──► modules/platform local.root_values
                                                            │
                                                            ▼
                                       helm_release "xyne-root" (argocd-apps chart)
                                       applications.xyne-root.source.helm.valuesObject = root_values
                                                            │
                                                            ▼
                             deployment/argocd/root/values.yaml  ◄── merged under the valuesObject
                                                            │
                     templates/_helpers.tpl "xyne-root.appValues.<chart>" builds per-app values:
                       image (registry/tag) · nodeSelector/tolerations (pool) · serviceAccount annotations (identity)
                       env (URLs, Redis, storage, OTEL, Vespa, LiveKit) · secretEnv (keys of the Terraform Secrets)
                                                            │
                     mergeOverwrite( built values , apps.<chart>.values , worker.values )
                                                            │
                                                            ▼
                             Application <chart>.spec.source.helm.valuesObject ──► helm-charts/charts/<chart>
```

Three facts follow from this:

- `apps.<chart>.values` (a YAML string in `02-platform.tfvars`) is deep-merged **over** what the
  root chart computed, so you can add keys or override single leaves without restating the rest.
- Contract keys are `snake_case` in Terraform and `camelCase` in the root values
  (`ro_host` → `roHost`, `lb_controller` → `lbController`), converted once in
  `modules/platform/locals.tf`.
- The root chart is rendered by Argo CD from `repo_url` at `root_revision` (default `main`);
  the service charts from the same repository at `chart_revision` (a `chart-<version>` tag).
  Changing either revision in `02-platform.tfvars` and re-applying is how upgrades happen.

## Component modes

`postgres_mode`, `redis_mode` and `storage_mode` are independent and each takes one of three
values. The contract module resolves the mode into the same output shape whichever you pick.

| Mode | `01-infra` creates | Argo CD installs | Host / endpoint the apps see | Credentials |
|---|---|---|---|---|
| `managed` (default) | the cloud's service on the private network, the databases, users, buckets, IAM bindings | nothing extra | private IP / private FQDN; `sslmode=require`; buckets `<prefix>-<key>` | `postgres_password` from you; Redis AUTH from the service (AWS: `redis_auth` from you); storage through workload identity (`storage_credentials` empty) |
| `incluster` | nothing for that component | `cnpg-operator` + `pg-cluster` (2 instances, `rw`/`ro` poolers) / `xyne-redis` / `minio` (standalone, one PVC) | `xyne-pg-pooler-rw.<ns>.svc`, `xyne-pg-pooler-ro.<ns>.svc`, direct `xyne-pg-rw.<ns>.svc` / `xyne-redis.<ns>.svc` / `http://xyne-minio.<ns>.svc:9000` | `postgres_password` seeds `xyne-pg-app`; `redis_auth` seeds `xyne-redis-auth`; `storage_credentials` seed `xyne-minio-root` and are handed to the apps as S3 keys |
| `external` | nothing | nothing | `external_postgres.*`, `external_redis.*`, `external_storage.*` (all eight bucket names required) | `postgres_password`, `redis_auth`, `storage_credentials` from you |

The bucket prefix defaults to `<project>-<name>` on GCP, `<account id>-<name>` on AWS and
`<name>` on Azure; `storage_bucket_prefix` overrides it and `storage_bucket_names` overrides
single keys.

## Why LiveKit runs on virtual machines

WebRTC media needs a routable public IP per media server and a wide UDP port range
(`livekit_port_range_start`–`livekit_port_range_end`, 50000–60000 by default) plus TURN on
UDP 3478. A Kubernetes `LoadBalancer` Service cannot expose a per-pod public address or a
10,000-port UDP range well on any of the three clouds. So `01-infra` creates:

- an instance template whose cloud-init installs Docker and runs `livekit/livekit-server`
  with `use_external_ip: true`, TURN enabled, and the API key from
  `livekit_api_key` / `livekit_api_secret`;
- an autoscaling group of servers (`livekit_min_replicas`–`livekit_max_replicas`, CPU target
  `livekit_target_cpu_utilization`) with a public IP each, and a private group of `livekit/egress`
  workers;
- a TLS load balancer for the signalling WebSocket at `livekit.<domain>` (GCP: global HTTPS LB
  with a managed certificate; AWS: ALB with an ACM certificate; Azure: Application Gateway with a
  Key Vault certificate), and, when a TURN certificate bundle is supplied, a TCP pass-through on
  5349 at `turn.<domain>`;
- the config YAML in the cloud's secret store (Secret Manager / Secrets Manager / Key Vault),
  fetched by the VM at boot.

The servers share room state through Redis, which is why `livekit_enabled = true` requires
`redis_mode` to be `managed` or `external`: an in-cluster Redis is not reachable from a VM.
The cluster receives only `livekit.url`, `livekit.http_url` and `livekit.turn_host`, and the
keys land in `xyne-transcription-agent-secrets`.

## Why Zero needs logical replication and the direct host

Zero (`xyne-zero-replication`) subscribes to Postgres changes with a logical replication slot
and streams them to the view-syncers (`xyne-zero`). Two consequences shape the install:

1. **The server must allow it.** Every managed module sets the flags
   (`cloudsql.logical_decoding=on` on GCP, `rds.logical_replication=1` on AWS,
   `wal_level=logical` on Azure) and `max_replication_slots` / `max_wal_senders`
   (`postgres_max_replication_slots`, `postgres_max_wal_senders`, default 10). The application
   *role* must also hold the `REPLICATION` attribute, which managed services do not grant through
   their APIs; that is the one-time SQL in each cloud guide. The CNPG bootstrap runs
   `ALTER ROLE xyne REPLICATION` itself.
2. **The connection must not go through a pooler.** A transaction-mode pooler cannot carry a
   replication connection. The contract therefore exposes `postgres.direct_host`: the primary's
   own address. In `managed` and `external` modes it equals `host`; in `incluster` mode it is
   `xyne-pg-rw.<namespace>.svc` while `host` is the `rw` pooler. `ZERO_UPSTREAM_DB`,
   `ZERO_CVR_DB` and `ZERO_CHANGE_DB` are always built from `direct_host`; every other URL uses
   `host` or `ro_host`.

`postgres_read_replica = true` gives `ro_host` a real replica and
`DATABASE_READ_REPLICA_POOL_URL` points at it; otherwise `ro_host = host`.

## Identities

Each app that touches object storage gets its own cloud identity, bound to its Kubernetes
ServiceAccount by name, with access to only the buckets it needs:

| Identity | Kubernetes ServiceAccount | Buckets |
|---|---|---|
| `backend` | `xyne-backend` | all eight, read-write |
| `worker` | `xyne-worker-<name>` for each of `worker_names` | all eight, read-write |
| `dashboard_edge` | `xyne-dashboard-edge` | `bundles`, read-only |
| `ysweet` | `xyne-ysweet` | `main`, read-write |
| `claw` | `xyne-claw` | `claw`, read-write |
| `claw_auth` | `xyne-claw-auth` | `claw`, read-write |
| `transcription` | `xyne-transcription-agent` | `transcription`, read-write |
| `lb_controller` | `aws-load-balancer-controller` in `kube-system` | none; AWS ELB permissions |

`worker_names` in `01-infra.tfvars` must list every worker you declare in `workers` in
`02-platform.tfvars`, because the binding is by ServiceAccount name.

| Cloud | Mechanism | What the root chart puts on the workload |
|---|---|---|
| GCP | Workload Identity: a Google service account `<name>-<identity>@<project>` with `roles/iam.workloadIdentityUser` for `<project>.svc.id.goog[<namespace>/<ksa>]` and per-bucket `roles/storage.objectAdmin` / `objectViewer` | ServiceAccount annotation `iam.gke.io/gcp-service-account` |
| AWS | IRSA: an IAM role per identity trusting the cluster's OIDC provider for that ServiceAccount, with an S3 policy per bucket; `use_pod_identity = true` adds EKS Pod Identity associations as well | ServiceAccount annotation `eks.amazonaws.com/role-arn` |
| Azure | Workload Identity: a user-assigned managed identity per app with a federated credential on the AKS OIDC issuer and `Storage Blob Data Contributor` / `Reader` on the containers | annotation `azure.workload.identity/client-id` and pod label `azure.workload.identity/use: "true"` |

Storage credentials are empty in `managed` mode on every cloud; the SDKs pick up the identity.
In `incluster` and `external` modes `storage.staticCredentials` becomes true and the S3 keys are
injected from the Secrets.

## Secrets

Nothing is generated inside Terraform or the cluster. You supply every secret value in
`.tfvars`; `modules/platform` validates lengths and formats, assembles connection URLs from the
contract, and writes Kubernetes Secrets in `namespace`. The charts never create Secrets; they
reference these names.

| Secret | Keys | Read by |
|---|---|---|
| `xyne-backend-secrets` | `DATABASE_URL`, `COMMON_DATABASE_URL`, `DATABASE_READ_REPLICA_POOL_URL`, `ZERO_UPSTREAM_DB`, `REDIS_URL`, `REDIS_PASSWORD`, `JWT_SECRET`, `ZERO_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_S2S_KEY`, `Y_SWEET_SERVER_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | backend, workers, dashboard-edge (S3 keys) |
| `xyne-zero-secrets` | `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`, `ZERO_CHANGE_DB`, `ZERO_AUTH_SECRET`, `ZERO_ADMIN_PASSWORD` | zero, zero-replication |
| `xyne-claw-secrets` | `XYNE_CLAW_S2S_KEY`, `INTERNAL_S2S_KEY`, `LITELLM_API_KEY`, `REDIS_PASSWORD` | claw |
| `xyne-claw-auth-secrets` | `DATABASE_URL`, `ENCRYPTION_KEY`, `XYNE_CLAW_S2S_KEY`, `INTERNAL_S2S_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `REDIS_PASSWORD` | claw-auth |
| `xyne-ysweet-secrets` | `Y_SWEET_AUTH`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | ysweet |
| `xyne-transcription-agent-secrets` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TRANSCRIPTION_AGENT_API_KEY` | transcription-agent |
| `xyne-pg-app` (`kubernetes.io/basic-auth`) | `username`, `password` | CNPG bootstrap, `incluster` only |
| `xyne-redis-auth` | `password` | `xyne-redis`, `incluster` only |
| `xyne-minio-root` | `rootUser`, `rootPassword` | MinIO, `incluster` only |

`extra_secret_data` merges additional keys into any of these by name, which is how you add an
OAuth client id or a model-provider key without changing the tree. [secrets.md](secrets.md) has
the generation and rotation procedures.

## Networking and ingress

- The cluster's nodes are private; egress goes through NAT (Cloud NAT / NAT gateways / Azure NAT
  gateway). The API endpoint is public but restricted by `master_authorized_networks`,
  `eks_public_access_cidrs` or `aks_authorized_ip_ranges`; `enable_private_endpoint = true`
  removes the public endpoint entirely (then you deploy from the bastion).
- One Istio ingress gateway in `istio-ingress` does all host and path routing. There is no
  Kubernetes `Ingress` object anywhere in this tree and no second ingress controller.
  `ingress_mode` chooses what sits in front of it and where TLS ends; see
  [ingress.md](ingress.md) for the three modes and how to pick one.
- `ingress_mode = "gateway"` (the default) gives the gateway a `LoadBalancer` Service and
  terminates TLS on the gateway. GCP and Azure reserve a static address (`ingress_static_ip`,
  default true) and pin the Service to it; AWS gets an NLB from the load balancer controller
  (`lb_annotations` in the contract), whose hostname is known only after the Service exists,
  which is why external-dns writes the AWS records from inside the cluster.
- `ingress_mode = "cloud-lb"` has Terraform build the edge instead: a global external HTTPS
  load balancer on GCP, an NLB with Elastic IPs and a TLS listener on AWS, an Application
  Gateway on Azure. The edge terminates TLS with a certificate you supply and re-encrypts to
  the gateway, which moves to a `NodePort` (to an internal `LoadBalancer` on Azure, whose
  backend pool takes addresses rather than node pools).
- `ingress_mode = "external"` builds no load balancer at all. The gateway sits on fixed node
  ports and `scripts/lb-config.sh` prints what to configure on the one you run. This is the
  on-prem path.
- `platform-config` renders `Gateway istio-ingress/xyne-gateway` for `<domain>` (plus
  `*.<domain>` when `addons.certManager.wildcard` is true and any `gateway.extraHosts`) with an
  HTTP→HTTPS redirect (off when the edge already terminated TLS), a `ClusterIssuer` that is
  ACME with the `http01` solver through the `istio` ingress class or self-signed depending on
  `ingress_tls`, a `Certificate xyne-gateway-tls`, a `PeerAuthentication` in `namespace`
  (`STRICT` mTLS by default) and the `VirtualService xyne`:

| Path prefix | Destination | Notes |
|---|---|---|
| `/api/` | `xyne-backend:80` | timeout `routes.apiTimeout` (50s) |
| `/zero/` | `xyne-zero:80` | rewritten to `/`, no timeout (WebSockets) |
| `/ysweet/` | `xyne-ysweet:8080` | no timeout |
| `/external/` | `xyne-dashboard-external:80` | only when that app is enabled |
| `/claw/` | `xyne-claw-auth-frontend:80` | only when that app is enabled |
| `/` | `xyne-dashboard:80` | catch-all |

`routes.extra` (through `addon_values["platformConfig"]`) prepends your own `http` entries.
On AWS `platform-config` also creates the default `gp3` StorageClass, because EKS ships none.

- Apps talk to each other by Service name inside `namespace`: `http://xyne-backend`,
  `http://xyne-claw:8081`, `http://xyne-claw-auth:3003`, `http://xyne-zero-replication:80`,
  `http://xyne-ysweet:8080`, `http://vespa-feed:8080`, `http://vespa-search:8080`,
  `http://otel-collector.monitoring.svc:4318`.

## Terraform state

`setup.sh` creates the backend if it does not exist and writes `backend.tf` next to each stack
from its `backend.tf.example` (both are gitignored):

| Cloud | Backend | `01-infra` | `02-platform` | overlay |
|---|---|---|---|---|
| GCP | `gcs` bucket `STATE_BUCKET` in `STATE_LOCATION` (defaults to `region`), versioning on | prefix `<STATE_PREFIX>/01-infra` | `<STATE_PREFIX>/02-platform` | `<STATE_PREFIX>/overlay` |
| AWS | `s3` bucket `STATE_BUCKET` in `STATE_REGION`, versioning, public access blocked, SSE-S3, `use_lockfile = true` | key `<STATE_PREFIX>/01-infra/terraform.tfstate` | `<STATE_PREFIX>/02-platform/terraform.tfstate` | `<STATE_PREFIX>/overlay/terraform.tfstate` |
| Azure | `azurerm` container `STATE_CONTAINER` in storage account `STATE_STORAGE_ACCOUNT` (ZRS, TLS 1.2, versioning) in `STATE_RESOURCE_GROUP`, `use_azuread_auth = true` | key `<STATE_PREFIX>/01-infra/terraform.tfstate` | `<STATE_PREFIX>/02-platform/terraform.tfstate` | `<STATE_PREFIX>/overlay/terraform.tfstate` |

`STATE_PREFIX` defaults to `xyne`; give each environment its own prefix (or bucket) when several
share an account. `02-platform` reads `01-infra` through `terraform_remote_state`; the script
passes the bucket and key on the command line, so the values in `02-platform.tfvars` for
`state_*` are only fallbacks for running `terraform` by hand.
