# Platform contract

**Who this is for:** maintainers changing a stack, a module, the platform module or the root
chart; read it when a shape passed between layers changes. Deployers start at
[../README.md](../README.md) instead.

Every cloud stack produces the same outputs, and everything that runs inside the cluster consumes
only these. A new cloud, or a different way of providing a component, is a new producer of this
contract and nothing else changes.

## Stacks

Each cloud has two Terraform stacks with separate state:

| Stack | Path | Does |
|---|---|---|
| `01-infra` | `deployment/terraform/stacks/<cloud>/01-infra` | network, cluster, node pools, Postgres, Redis, object storage, identities |
| `02-platform` | `deployment/terraform/stacks/<cloud>/02-platform` | reads `01-infra` remote state, configures the `kubernetes` / `helm` providers for that cloud, calls `deployment/terraform/modules/platform` |

`modules/platform` is cloud-neutral. It creates namespaces and Kubernetes Secrets, installs Argo CD
and creates the root Argo CD Application with the contract as its Helm values.

## Shared modules

Logic that every cloud needs lives in exactly one place. A cloud stack contains only what is
specific to that cloud: provider resources, the managed-service modules and the cloud's own
preconditions.

| Module | Path | Owns |
|---|---|---|
| `contract` | `deployment/terraform/modules/contract` | mode resolution for Postgres, Redis and storage; the fixed in-cluster service names; bucket name derivation (`<prefix>-<key>` with `storage_bucket_names` overrides); the common input preconditions |
| `livekit-config` | `deployment/terraform/modules/livekit-config` | the LiveKit server and egress YAML rendered from the contract's Redis, the API keys, the RTC port range and the TURN settings |

Neither module has a provider. Each `01-infra` calls `contract` with its variables and the
results of its managed-service modules (`one(module.postgres[*].postgres)` and so on, null when
that mode is not `managed`), then exposes `module.contract.*` as the contract outputs. The three
cloud `livekit` modules call `livekit-config` and only keep what differs: the secret-store write,
the instance template, the cloud-init and the load balancer.

`contract` checks what applies to every cloud: the external host per `external` mode, all eight
external bucket names, storage credentials outside `managed`, `redis_auth` for `incluster`, and
that LiveKit does not run against in-cluster Redis. Cloud-specific checks stay in the stack:
AWS requires `redis_auth` for `managed` (the ElastiCache auth token is an input), and Azure
requires `storage_account_name` for `managed` and an SSH public key for any virtual machine.

All three `storage.provider` values are usable by the application. Azure `managed` emits
`storage.provider = "azure"` and `storage.account`, which the root chart turns into
`STORAGE_PROVIDER=azure` and `AZURE_STORAGE_ACCOUNT`; the SDK's default credential chain then
uses the workload identity bound to each ServiceAccount, so no account key is needed.

## Component modes

`postgres_mode`, `redis_mode`, `storage_mode` each take:

| Mode | Meaning |
|---|---|
| `managed` | the cloud's managed service, created by `01-infra` (default) |
| `incluster` | CloudNativePG, Redis or MinIO, installed by Argo CD; `01-infra` creates nothing and emits the in-cluster service names |
| `external` | something that already exists; connection details come from `external_*` variables |

## `01-infra` outputs

All stacks expose these output names and shapes. A stack may add outputs beyond this set for
things an operator needs from that cloud; nothing under `modules/platform` or `deployment/argocd`
reads them.

| Stack | Additional outputs |
|---|---|
| `gcp` | `livekit_lb_ip` (the global address both `livekit.<domain>` and `turn.<domain>` point at) |
| `aws` | `bastion_instance_id`, `livekit_lb_dns_names` (`signal`, `turn`) |
| `azure` | `cluster_auth` (sensitive client certificate and key), `resource_group_name`, `node_resource_group`, `bastion` (`vm_name`, `private_ip`, `public_ip`, `azure_bastion_dns_name`), `livekit_ips` (`signal`, `turn`), `livekit_key_vault` (`id`, `name`), `nat_public_ip_prefix` |

### `cluster`

```hcl
{
  cloud     = "gcp" | "aws" | "azure"
  name      = string
  region    = string
  endpoint  = string
  ca_certificate = string   # base64
  network_id = string       # VPC / VNet / network id the cluster runs in
}
```

### `postgres` and `postgres_password` (sensitive)

```hcl
postgres = {
  mode     = "managed" | "incluster" | "external"
  host     = string          # read-write endpoint
  ro_host  = string          # read pool / replica endpoint, equals host when there is none
  port     = number
  username = string
  sslmode  = "require" | "disable"
  databases = {
    app       = "xyne"
    common    = "xyne_common"
    zero_cvr  = "zero_cvr"
    zero_cdb  = "zero_cdb"
    claw_auth = "claw_auth"
  }
}
```

In-cluster service names are fixed: `host = "xyne-pg-pooler-rw.<namespace>.svc"`,
`ro_host = "xyne-pg-pooler-ro.<namespace>.svc"`, and the direct (non-pooled) primary used for
logical replication is `xyne-pg-rw.<namespace>.svc`, emitted as `postgres.direct_host`. Managed
and external modes set `direct_host = host`.

### `redis` and `redis_auth` (sensitive, may be empty)

```hcl
redis = {
  mode = "managed" | "incluster" | "external"
  host = string              # incluster: "xyne-redis.<namespace>.svc"
  port = number
  tls  = bool
}
```

### `storage` and `storage_credentials` (sensitive)

```hcl
storage = {
  mode     = "managed" | "incluster" | "external"
  provider = "gcs" | "s3" | "azure"     # incluster MinIO is "s3"
  endpoint = string                      # empty for the cloud default
  region   = string
  account  = string                      # the Azure storage account name; empty on GCP and AWS
  buckets  = {
    main          = string
    docs          = string
    canvas        = string
    recordings    = string
    workflows     = string
    transcription = string
    bundles       = string
    claw          = string
  }
}
storage_credentials = {
  access_key_id     = string   # empty when workload identity is used
  secret_access_key = string
}
```

### `identities`

Service account metadata that binds a workload to its cloud identity. Keys are fixed; a cloud
that needs no annotation emits empty maps. The root chart puts `annotations` on the workload's
ServiceAccount and `labels` on its pod template, so Azure's `azure.workload.identity/use: "true"`
reaches the pods.

```hcl
identities = {
  backend       = { annotations = map(string), labels = map(string) }
  worker        = { annotations = map(string), labels = map(string), ksa_names = list(string) }
  dashboard_edge = { ... }
  ysweet        = { ... }
  claw          = { ... }
  claw_auth     = { ... }
  transcription = { ... }
  lb_controller = { ... }
  external_dns  = { ... }
}
```

`lb_controller` is the identity of the in-cluster controller that turns a `LoadBalancer`
Service into a cloud load balancer. AWS emits `eks.amazonaws.com/role-arn` for the
`aws-load-balancer-controller` service account in `kube-system`; GCP and Azure have the
controller built into the cluster and emit empty maps.

`external_dns` is the identity of the external-dns controller, which writes the application's
DNS records from the gateway Service. Only AWS emits it: `eks.amazonaws.com/role-arn` for the
`external-dns` service account in the `external-dns` namespace, scoped to the hosted zone in
`ingress.dns_zone`, and only when `external_dns_enabled` is true and `dns_zone` is set. GCP and
Azure create the records in `01-infra` and emit empty maps.

`worker.ksa_names` are the worker service accounts `01-infra` actually bound to the worker
identity, one `xyne-worker-<name>` per entry in that stack's `worker_names`. `modules/platform`
checks every `workers[].name` against this list and refuses to apply when a worker would run
without an identity, which is otherwise only visible later as storage permission errors in that
worker's pods. The fix is to add the name to `worker_names` in `01-infra.tfvars` and apply
`01-infra` again. The list is empty when a cloud binds no worker identity, and the check is
skipped when the worker identity carries no annotations at all.

### `node_pools`

Scheduling facts per pool. `enabled = false` when the pool was not created.

```hcl
node_pools = {
  general = { enabled = bool, node_selector = map(string), tolerations = list(object) }
  zero    = { ... }
  vespa   = { ... }
  sandbox = { ... }
}
```

### `livekit` and `livekit_keys` (sensitive)

LiveKit runs on virtual machines with public addresses, never inside the cluster: WebRTC needs a
routable IP per media server and UDP port ranges that a Kubernetes Service cannot expose well.
`01-infra` creates an instance template (cloud-init that runs the LiveKit server container with
TURN enabled and `use_external_ip`), an autoscaling group for the servers and one for egress
workers, per-instance public IPs, firewall rules, a TLS load balancer for signaling and the DNS
record `livekit.<domain>`. The servers share state through the contract's Redis, so LiveKit
requires `redis_mode` to be `managed` or `external`.

```hcl
livekit = {
  enabled   = bool
  url       = string     # wss://livekit.<domain>, empty when disabled
  http_url  = string     # https://livekit.<domain>, empty when disabled
  turn_host = string     # turn.<domain>, empty when disabled
  group     = string     # MIG / ASG / VMSS name, empty when disabled
}
livekit_keys = {
  api_key    = string
  api_secret = string
}
```

`modules/platform` writes the keys into `xyne-transcription-agent-secrets` and adds
`LIVEKIT_URL` to the app values; `xyne-livekit-keys` is not created.

### `ingress`

```hcl
ingress = {
  domain         = string              # apex the install is served under
  static_ip      = string              # address bound to the gateway Service, empty if none
  lb_annotations = map(string)         # annotations for the gateway Service
  dns_zone       = string              # managed zone / hosted zone id, empty if DNS is external

  mode                    = string     # gateway | cloud-lb | external
  service_type            = string     # LoadBalancer | NodePort | ClusterIP, empty for the chart default
  external_traffic_policy = string     # Local | Cluster, empty for the cluster default
  node_ports              = map(number) # http, https, status; empty unless the Service is a NodePort
  tls                     = string     # acme | internal | existing | none, empty to follow the mode
  tls_secret              = string     # the Secret the gateway reads its certificate from
  edge = {
    ip       = string                  # public address of the edge load balancer, empty if none
    hostname = string                  # its DNS name, empty if none
  }
}
```

The five original keys are unchanged and every new key has a neutral value, so
a `01-infra` state written before this contract still satisfies it: `mode`
defaults to `gateway`, and empty `service_type` and `tls` let the chart pick
per mode.

`mode` is the only key a deployer sets directly; the rest are derived from it
per cloud. `gateway` keeps the gateway Service a `LoadBalancer` and terminates
TLS on it. `cloud-lb` has the stack build the edge, which terminates TLS and
re-encrypts to the gateway. `external` builds nothing and leaves the edge to
the operator. [ingress.md](ingress.md) describes all three.

`static_ip` is the address the gateway Service itself binds, which is public in
`gateway` mode and private on Azure in `cloud-lb` mode. `edge` is the address
the public resolves to. DNS points at `edge.ip` or `edge.hostname` when either
is set, and at `static_ip` otherwise.

A separate `ingress_addresses` output carries just the reserved addresses:

```hcl
ingress_addresses = {
  gateway = string                     # the gateway Service's reserved address, empty if none
  edge    = string                     # the edge load balancer's address, empty if none
}
```

It exists so `setup.sh` can reserve and print the addresses with a targeted
apply, before the network and the cluster are built, and must therefore depend
on nothing but the address resources.

## Root Argo CD application values

`modules/platform` passes this to `deployment/argocd/root`:

```yaml
global:
  cloud: gcp
  domain: spaces.example.com
  namespace: xyne
  repoURL: https://github.com/juspay/xyne-spaces.git
  chartRevision: chart-1.356.0
  imageRegistry: ""
  imageTag: ""
infra:
  cluster: {name: "", region: "", networkId: ""}
  postgres: {}       # contract object, camelCase keys
  redis: {}
  storage: {}
  identities: {}     # includes lbController and externalDns
  nodePools: {}
  ingress: {}                     # domain, mode, staticIp, lbAnnotations, dnsZone, serviceType,
                                  # externalTrafficPolicy, nodePorts, tls, tlsSecret, edge
  livekit: {enabled: false, url: "", httpUrl: "", turnHost: ""}
addons:
  lbController: {enabled: null}   # null means "when global.cloud is aws"
  externalDns: {enabled: null}    # null means "when the gateway Service is a LoadBalancer and
                                  # ingress.dnsZone and identities.externalDns are set"
  istio: {enabled: true}
  certManager: {enabled: true, email: "", issuer: letsencrypt}
  platformConfig: {storageClass: {enabled: null}}
  cnpg: {enabled: false}
  redis: {enabled: false}
  minio: {enabled: false}
  vespa: {enabled: false}
  monitoring: {enabled: false}
  sandbox: {enabled: false}
apps: {}             # per-chart enabled, values and storeUrl
overlay:
  sources: []        # extra Argo CD sources rendered as additional Applications
```

`apps.<chart>` takes `enabled`, `values` and `storeUrl`, from `apps.<x>.enabled`,
`apps.<x>.values` and `apps.<x>.store_url` in `02-platform`. `store_url` is the URL that chart
serves its downloadable clients from; it is omitted from the values when empty so the chart's
own default stands.

`overlay.sources[]` carries `name`, `repoURL`, `targetRevision`, `path`, `chart`,
`chartVersion`, `namespace` and `helmValues`, from `overlay_sources[]` in `02-platform`.
`namespace` is the destination namespace of the Application the root chart renders for that
source; empty means the install namespace (`global.namespace`).

An entry sets exactly one of `path` or `chart`. With `path`, `repoURL` is a git repository and
`path` the directory in it at `targetRevision`. With `chart`, `repoURL` is a Helm or OCI chart
repository, `chart` the chart name in it and `chart_version` the version to install; the root
chart renders that as a chart source and Argo CD needs the repository registered (a
`repositories` entry in its `configs`, `type: helm` and `enableOCI: "true"` for an OCI
registry).

`addons.cnpg`, `addons.redis` and `addons.minio` follow the component modes: they are enabled
exactly when the matching mode is `incluster`.

`addons.lbController` installs `aws-load-balancer-controller` in `kube-system` with
`clusterName`, `region` and `vpcId` from `infra.cluster` and the service account annotated from
`identities.lbController`. `modules/platform` enables it when the cloud is `aws` and the
identity carries a role; the chart's own default is the cloud check alone, and either can be
overridden. `addons.platformConfig.storageClass` makes `platform-config` create a default
`gp3` StorageClass (`ebs.csi.aws.com`, `WaitForFirstConsumer`, expansion allowed); the default is
the same cloud check, since GKE and AKS ship a default class and EKS does not.

`addons.externalDns` installs `external-dns` from
`https://kubernetes-sigs.github.io/external-dns/` in the `external-dns` namespace, filtered to
`global.domain` and to the zone in `infra.ingress.dnsZone`, with the service account annotated
from `identities.externalDns`. Its default (`enabled: null`) is on exactly when the gateway
Service is a `LoadBalancer`, that zone is set and that identity carries an annotation, which
today means AWS in `gateway` mode with a hosted zone; the same condition makes
`modules/platform` enable it and makes `istio.yaml` put
`external-dns.alpha.kubernetes.io/hostname: <domain>,*.<domain>` on the gateway Service, which
is the record source external-dns reads. In `cloud-lb` mode the record points at the edge load
balancer, which Terraform knows, so the stack writes it and external-dns stays off. In
`external` mode DNS is the operator's.

### Sync waves

| Wave | Applications |
|---|---|
| -10 | AppProject |
| -4 | `aws-load-balancer-controller` |
| -3 | `istio-base`, `istiod`, `cert-manager`, `external-dns` |
| -2 | `istio-ingressgateway`, `platform-config`, `cnpg-operator`, `minio`, `xyne-redis` |
| -1 | `pg-cluster` |
| 0 | apps and workers |
| 1 | Vespa, monitoring, sandbox |
| 2 | overlay sources |

The gateway's `LoadBalancer` Service is one wave after the load balancer controller so the
controller exists before the Service is reconciled.

## Secrets created by `modules/platform`

Nothing is generated. Every secret value is an input the deployer supplies (`app_secrets`,
`postgres_password`, `redis_auth`, `storage_credentials`, `livekit_keys`), validated for length
and format, and placed as-is. The module only assembles connection URLs from the contract and
writes the Kubernetes Secrets below.

`app_secrets` fields: `jwt_secret`, `zero_auth_secret`, `zero_admin_password`, `encryption_key`
(64 hex), `internal_s2s_key`, `claw_s2s_key`, `claw_auth_encryption_key` (64 hex), `ysweet_auth` and `ysweet_server_token` (the `private_key`
and `server_token` printed by `y-sweet gen-auth --json`; the server holds the private key, the
backend presents the derived token), `transcription_agent_api_key`, and optional
`litellm_api_key`, `google_client_id`, `google_client_secret`. `extra_secret_data` merges
additional keys into any named Secret.

Names and keys match what the charts reference. `google_client_id` and `google_client_secret`
are written into both `xyne-backend-secrets` and `xyne-claw-auth-secrets`: the backend and the
claw auth service each run their own Google sign-in flow and read the pair from their own Secret.

| Secret | Keys |
|---|---|
| `xyne-backend-secrets` | `DATABASE_URL`, `COMMON_DATABASE_URL`, `DATABASE_READ_REPLICA_POOL_URL`, `ZERO_UPSTREAM_DB`, `REDIS_URL`, `REDIS_PASSWORD`, `JWT_SECRET`, `ZERO_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_S2S_KEY`, `Y_SWEET_SERVER_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `xyne-zero-secrets` | `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`, `ZERO_CHANGE_DB`, `ZERO_AUTH_SECRET`, `ZERO_ADMIN_PASSWORD` |
| `xyne-claw-secrets` | `XYNE_CLAW_S2S_KEY`, `INTERNAL_S2S_KEY`, `LITELLM_API_KEY`, `REDIS_PASSWORD` |
| `xyne-claw-auth-secrets` | `DATABASE_URL`, `ENCRYPTION_KEY`, `XYNE_CLAW_S2S_KEY`, `INTERNAL_S2S_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `REDIS_PASSWORD` |
| `xyne-ysweet-secrets` | `Y_SWEET_AUTH`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `xyne-transcription-agent-secrets` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TRANSCRIPTION_AGENT_API_KEY` |
| `xyne-pg-app` | `username`, `password` (CloudNativePG bootstrap, `incluster` only) |
| `xyne-redis-auth` | `password` (`incluster` only) |
| `xyne-minio-root` | `rootUser`, `rootPassword` (`incluster` only) |

Zero replicates through logical replication, so `ZERO_UPSTREAM_DB` always uses
`postgres.direct_host`, never a pooler.

## Conventions

Terraform, Helm values and templates under `deployment/` carry no comments; what needs
explaining is written here. The one exception is the `#cloud-config` first line of a cloud-init
document (`templates/cloud-init.yaml*` in the bastion and LiveKit modules), which cloud-init
requires to recognise the file.

Region names, product names and generated secrets never appear in `.tf` files: regions are
variables, and every secret is an input the deployer supplies.

## Overlay

An overlay adds private pieces without the public tree knowing what they are:

- `overlay.sources` in the root values: extra Argo CD sources, each rendered as an Application
  at sync wave 2. A source is either a git path (`repo_url` + `path`) or a chart from a Helm or
  OCI repository (`repo_url` + `chart` + `chart_version`), so an overlay can install a private
  chart and a third-party one without the public tree knowing either.
- `<env>/overlay/` in the environment directory: an extra Terraform directory that
  `deployment/scripts/setup.sh` applies after `02-platform`. It must declare
  `variable "infra"` and `variable "namespace"`; the script passes the `01-infra` outputs and
  the namespace through a temporary `.tfvars.json`, plus `<env>/overlay.tfvars` when present.
  Its backend is generated next to the stacks' (same bucket, key `<prefix>/overlay`).
- `--env-dir <path>`: the environment directory may live outside the public tree, so a private
  repository can hold `environments/<env>/` with its overlay and values without copying anything
  into this one.
