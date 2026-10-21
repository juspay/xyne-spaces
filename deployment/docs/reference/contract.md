# Platform contract

**Who this is for:** maintainers changing a stack, a module, the platform module or the root
chart. It is the specification of every shape passed between the layers; change it in the same
commit as any change to a shape. Deployers start at [../install/README.md](../install/README.md).

Every cloud stack produces the same outputs, and everything that runs inside the cluster consumes
only these. A new cloud, or a different way of providing a component, is a new producer of this
contract and nothing else changes.

- [Stacks and shared modules](#stacks-and-shared-modules)
- [`01-infra` outputs](#01-infra-outputs)
- [Root Argo CD values](#root-argo-cd-values)
- [How the root chart renders Applications](#how-the-root-chart-renders-applications)
- [Sync waves](#sync-waves)
- [Secrets created by `modules/platform`](#secrets-created-by-modulesplatform)
- [Overlay](#overlay)
- [Conventions](#conventions)

## Stacks and shared modules

| Piece | Path | Does |
|---|---|---|
| `01-infra` | `terraform/stacks/<cloud>/01-infra` | network, cluster, node pools, Postgres, Redis, storage, identities, LiveKit, ingress edge |
| `02-platform` | `terraform/stacks/<cloud>/02-platform` | reads `01-infra` remote state, configures the `kubernetes` and `helm` providers, calls `modules/platform` |
| `modules/platform` | `terraform/modules/platform` | cloud-neutral: namespaces, Kubernetes Secrets, the `xyne-db-init` Job, Argo CD, the root Application with the contract as its values |
| `modules/contract` | `terraform/modules/contract` | mode resolution for Postgres, Redis and storage, fixed in-cluster service names, bucket naming, the checks every cloud shares |
| `modules/livekit-config` | `terraform/modules/livekit-config` | the LiveKit server and egress YAML: keys, Redis, RTC ports, TURN, room defaults and the webhook |

Neither shared module has a provider. Each `01-infra` calls `contract` with its variables and its
managed-service modules' results (`one(module.postgres[*].postgres)` and so on, null outside
`managed` mode), then exposes `module.contract.*` as the outputs. The three cloud `livekit`
modules call `livekit-config` and keep only what differs: the secret-store write, the instance
template and cloud-init, and the load balancer.

`contract` checks what applies to every cloud: the external host for each `external` mode, all
eight external bucket names, storage credentials outside `managed`, `redis_auth` for `incluster`,
and that LiveKit does not run against in-cluster Redis. Cloud-only checks stay in the stack: AWS
requires `redis_auth` for managed Redis, Azure requires `storage_account_name` for managed storage
and an SSH key for any VM.

All three `storage.provider` values work in the application. Azure `managed` emits
`provider = "azure"` and `storage.account`, which the root chart turns into
`STORAGE_PROVIDER=azure` and `AZURE_STORAGE_ACCOUNT`; the SDK's default credential chain then uses
the workload identity, so no account key is needed.

## `01-infra` outputs

All stacks expose these names and shapes. A stack may add outputs for operators; nothing under
`modules/platform` or `deployment/argocd` reads them:

| Stack | Additional outputs |
|---|---|
| `gcp` | `livekit_lb_ip` |
| `aws` | `bastion_instance_id`, `livekit_lb_dns_names` (`signal`, `turn`) |
| `azure` | `cluster_auth` (sensitive), `resource_group_name`, `node_resource_group`, `bastion`, `livekit_ips`, `livekit_key_vault`, `nat_public_ip_prefix` |

### `cluster`

```hcl
{ cloud = "gcp" | "aws" | "azure", name, region, endpoint, ca_certificate, network_id }
```

### `postgres`, `postgres_password` (sensitive)

```hcl
postgres = {
  mode        = "managed" | "incluster" | "external"
  host        = string   # read-write endpoint; the rw pooler in incluster mode
  ro_host     = string   # read endpoint; equals host when there is no replica
  direct_host = string   # the primary itself, for logical replication; equals host except incluster
  port        = number
  username    = string
  sslmode     = "require" | "disable"
  databases   = { app = "xyne", common = "xyne_common", zero_cvr = "zero_cvr", zero_cdb = "zero_cdb", claw_auth = "claw_auth" }
}
```

In-cluster names are fixed: `xyne-pg-pooler-rw.<ns>.svc`, `xyne-pg-pooler-ro.<ns>.svc`, and
`xyne-pg-rw.<ns>.svc` for `direct_host`.

### `redis`, `redis_auth` (sensitive, may be empty)

```hcl
redis = { mode, host, port, tls }   # incluster host: xyne-redis.<ns>.svc
```

### `storage`, `storage_credentials` (sensitive)

```hcl
storage = {
  mode     = "managed" | "incluster" | "external"
  provider = "gcs" | "s3" | "azure"            # incluster MinIO is "s3"
  endpoint = string                             # empty for the cloud default
  region   = string
  account  = string                             # the Azure storage account; empty elsewhere
  buckets  = { main, docs, canvas, recordings, workflows, transcription, bundles, claw }
}
storage_credentials = { access_key_id, secret_access_key }   # empty with workload identity
```

### `identities`

What binds a workload to its cloud identity. The root chart puts `annotations` on the workload's
ServiceAccount and `labels` on its pods (Azure's `azure.workload.identity/use: "true"`). A cloud
that needs nothing emits empty maps.

| Key | ServiceAccount | For |
|---|---|---|
| `backend` | `xyne-backend` | all eight buckets |
| `worker` | `xyne-worker-<name>` per `worker_names`, listed in `ksa_names` | all eight buckets |
| `dashboard_edge` | `xyne-dashboard-edge` | `bundles`, read-only |
| `ysweet` | `xyne-ysweet` | `main` |
| `claw`, `claw_auth` | `xyne-claw`, `xyne-claw-auth` | `claw` |
| `transcription` | `xyne-transcription-agent` | `transcription` |
| `zero` | the Zero workloads | Zero's Litestream replica backups (`ZERO_LITESTREAM_BACKUP_URL`) |
| `lb_controller` | `aws-load-balancer-controller` | AWS only: Elastic Load Balancing |
| `cluster_autoscaler` | `cluster-autoscaler` | AWS only: Auto Scaling |
| `external_dns` | `external-dns` | AWS only, with `dns_zone`: that hosted zone |

`modules/platform` checks every `workers[].name` against `worker.ksa_names` and refuses to apply
when a worker would run without an identity.

### `node_pools`

A map keyed by pool (`general`, `zero`, `vespa`, `sandbox`, and `gpu` on AWS):

```hcl
node_pools = { <pool> = { enabled = bool, node_selector = map(string), tolerations = list(object) } }
```

The root chart schedules onto a pool only when it is enabled and falls back to `general`.

### `livekit`, `livekit_keys` (sensitive)

```hcl
livekit      = { enabled, url = "wss://livekit.<domain>", http_url, turn_host, group }
livekit_keys = { api_key, api_secret }
```

`modules/platform` writes the keys into `xyne-backend-secrets` and
`xyne-transcription-agent-secrets`, and the root chart sets `LIVEKIT_URL` on both apps.

### `ingress`, `ingress_addresses`

```hcl
ingress = {
  domain, static_ip, lb_annotations, dns_zone,
  mode                    = "gateway" | "cloud-lb" | "external"
  service_type            = string      # LoadBalancer | NodePort | ClusterIP; empty for the chart default
  external_traffic_policy = string
  node_ports              = map(number) # http, https, status
  tls                     = string      # acme | internal | existing | none; empty follows the mode
  tls_secret              = string
  edge                    = { ip, hostname }
}
ingress_addresses = { gateway, edge }   # reserved addresses only; no dependency on the cluster
```

`mode` is the only key a deployer sets; the rest are derived from it per cloud. Every key added
after the first five has a neutral value, so an older `01-infra` state still satisfies the
contract (`mode` defaults to `gateway`, empty `service_type` and `tls` let the chart pick).
`static_ip` is the address the gateway Service binds (public in `gateway` mode, private on Azure
in `cloud-lb` mode); `edge` is what the public resolves to. DNS points at `edge.ip` or
`edge.hostname` when set, and at `static_ip` otherwise.
`ingress_addresses` exists so `setup.sh` can reserve and print addresses with a targeted apply
before the cluster exists. [ingress](../concepts/ingress.md) describes the modes.

## Root Argo CD values

`modules/platform` passes this to `deployment/argocd/root` as the `xyne-root` Application's
values, merged over the chart's `values.yaml`:

```yaml
platformRevision: <root_revision>
argocd:
  expose: {enabled: false, host: ""}
global:
  cloud: aws
  domain: xyne.example.com
  namespace: xyne-apps
  repoURL: https://github.com/juspay/xyne-spaces.git
  chartRevision: chart-1.399.2
  imageRegistry: ""
  imageTag: ""
  secretChecksums: {xyne-backend-secrets: 1a2b…, …}   # a short hash per Secret it wrote
infra:
  cluster: {name, region, networkId}
  postgres: {}        # the contract objects, camelCase keys (ro_host -> roHost)
  redis: {}
  storage: {}
  identities: {}
  nodePools: {}
  ingress: {}
  livekit: {enabled, url, httpUrl, turnHost}
addons:
  lbController: {enabled: null}         # null: when global.cloud is aws
  clusterAutoscaler: {enabled: null}    # null: when global.cloud is aws
  nvidiaDevicePlugin: {enabled: null}   # null: when the gpu pool is enabled
  externalDns: {enabled: null}          # null: gateway mode with a zone and an identity
  istio: {enabled: true}
  certManager: {enabled: true, email: ""}
  platformConfig: {}
  cnpg: {enabled: false}                # these three follow the component modes
  redis: {enabled: false}
  minio: {enabled: false}
  vespa: {enabled: false}
  monitoring: {enabled: false}
  sandbox: {enabled: false}
  hindsight: {enabled: false}
apps: {}              # per chart: enabled, values, storeUrl
overlay:
  sources: []
```

`apps.<chart>` takes `enabled`, `values` (merged over what the root chart computes) and
`storeUrl` (the URL that chart serves downloadable clients from; left out when empty so the
chart's default stands).

`overlay.sources[]` carries `name`, `repoURL`, `targetRevision`, `path` or `chart` with
`chartVersion`, `namespace` (empty means the install namespace) and `helmValues`. An entry sets
exactly one of `path` (a git directory) or `chart` (a chart in a Helm or OCI repository, which Argo
CD must have registered: a `repositories` entry in its `configs`, `type: helm`, and
`enableOCI: "true"` for OCI).

`addons.lbController` installs `aws-load-balancer-controller` with `clusterName`, `region` and
`vpcId` from `infra.cluster`. `addons.platformConfig.storageClass` makes `platform-config` create a
default `gp3` StorageClass (`ebs.csi.aws.com`, `WaitForFirstConsumer`, expansion allowed), since
EKS ships none. `addons.externalDns` installs `external-dns` filtered to `global.domain` and the
zone in `infra.ingress.dnsZone`; the same condition makes the root chart annotate the gateway
Service with `external-dns.alpha.kubernetes.io/hostname: <domain>,*.<domain>`, the only record
source it reads. In `cloud-lb` mode the stack writes the records itself, and in `external` mode
DNS is the operator's.

## How the root chart renders Applications

- `deployment/argocd/root/templates/_helpers.tpl` builds each app's values: image, pool, identity, environment and
  `secretEnv` references, then merges `apps.<chart>.values` over them.
- Every Application carries its chart values as a `helm.values` **string**, not
  `helm.valuesObject`. Server-side apply deletes `null` fields from structured data, and some
  overrides rely on `null` to remove a chart default (the Vespa roles do).
- Each app's pods get a `checksum/secrets` annotation built from `global.secretChecksums` for the
  Secrets that app reads (its own `<chart>-secrets` plus any `secretEnv` or `envFromSecrets`
  reference), so a changed Secret rolls exactly its readers.
- Every Application has `automated: {prune: true, selfHeal: true}`, `CreateNamespace=true`,
  `ServerSideApply=true`, and 10 retries with backoff from 30 s to 10 min. Deployments ignore
  `/spec/replicas` so HPAs own it; StatefulSets ignore the defaults the API server adds to
  `volumeClaimTemplates`.

## Sync waves

Argo CD applies the children of `xyne-root` in wave order and waits for each wave to be healthy.

| Wave | Applications |
|---|---|
| -10 | the `xyne` AppProject |
| -4 | `aws-load-balancer-controller`, `cluster-autoscaler` |
| -3 | `istio-base`, `istiod`, `cert-manager`, `external-dns`, `nvidia-device-plugin` |
| -2 | `istio-ingressgateway`, `platform-config`, `cnpg-operator`, `minio`, `xyne-redis` |
| -1 | `pg-cluster` |
| 0 | `xyne-zero-replication` |
| 1 | the apps and workers, and the optional stacks: Vespa (all roles, embedder, proxy, `xyne-vespa-app`), monitoring, `kata-deploy`, `agent-sandbox-controller`, `xyne-sandbox-router`, `xyne-egress-proxy`, `hindsight` |
| 2 | `xyne-zero`, `sandbox`, every `overlay.sources` entry |

`xyne-zero-replication` comes before the apps because the view-syncers (`xyne-zero`, wave 2) and
the backend need the replica it builds. `sandbox` follows the controller that owns its CRDs.

## Secrets created by `modules/platform`

Every value is an input; the module only assembles connection URLs from the contract.
[secrets](secrets.md) has every field, its constraint and the full Secret list.

`app_secrets` fields: `jwt_secret`, `zero_auth_secret`, `zero_admin_password`, `encryption_key`,
`internal_s2s_key`, `claw_s2s_key`, `claw_auth_encryption_key`, `ysweet_auth`,
`ysweet_server_token`, `transcription_agent_api_key`, `google_client_id`, `google_client_secret`,
and optional `litellm_api_key`, `hindsight_api_key`, `hindsight_llm_api_key`.
`extra_secret_data` merges keys into any of the nine Secrets.

`ZERO_UPSTREAM_DB`, `ZERO_CVR_DB` and `ZERO_CHANGE_DB` always use `postgres.direct_host`.

## Overlay

- `overlay.sources` in the root values: extra Argo CD Applications at wave 2, from a git path or a
  Helm/OCI chart.
- `<env>/overlay/`: an extra Terraform directory `setup.sh` applies after `02-platform`. It must
  declare `variable "infra"` and `variable "namespace"`; the script passes the `01-infra` outputs
  and the namespace through a temporary `.tfvars.json`, plus `<env>/overlay.tfvars`. Its state key
  is `<prefix>/overlay`.
- `--env-dir <path>` lets a private repository hold `environments/<env>/`.

## Conventions

Terraform, Helm values and templates under `deployment/` carry no comments; explanations live in
these docs. The one exception is the `#cloud-config` first line cloud-init requires. Region
names, product names and generated secrets never appear in `.tf` files.
