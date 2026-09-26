# Configuration reference

**Who this is for:** anyone editing an environment directory; read it when you need a variable's
exact name, type, default or effect, or a recipe for a common change.

- [Environment directory](#environment-directory)
- [`env.conf`](#envconf)
- [Script flags](#script-flags)
- [GCP `01-infra`](#gcp-01-infra)
- [AWS `01-infra`](#aws-01-infra)
- [Azure `01-infra`](#azure-01-infra)
- [`02-platform` (all clouds)](#02-platform-all-clouds)
- [Root Argo CD values](#root-argo-cd-values)
- [Node pool sizing](#node-pool-sizing)
- [Recipes](#recipes)

Every variable below exists in `deployment/terraform/stacks/<cloud>/<stack>/variables.tf`.
**Required** means no default: the doctor fails when it is missing. Objects with `optional(...)`
attributes accept partial values; unspecified attributes take the defaults shown.

## Environment directory

```
deployment/environments/<env>/
├── env.conf              cloud and state backend (shell KEY=VALUE)
├── 01-infra.tfvars       variables of stacks/<cloud>/01-infra
├── 02-platform.tfvars    variables of stacks/<cloud>/02-platform
├── overlay/              optional Terraform module applied after 02-platform (see extending.md)
└── overlay.tfvars        optional variables for overlay/
```

Only `example-*` directories are tracked; everything else under `deployment/environments/` is
ignored by git. `--env-dir <path>` points the scripts at another base directory.

## `env.conf`

Lines must match `KEY=VALUE` with values made of `A-Za-z0-9_./@:-` (no quotes, no spaces). The
scripts `source` the file and export every key.

| Key | Clouds | Required | Meaning |
|---|---|---|---|
| `CLOUD` | all | yes | `gcp`, `aws` or `azure`; selects `stacks/<cloud>/` |
| `STATE_PREFIX` | all | no (`xyne`) | prefix of the state keys: `<prefix>/01-infra`, `<prefix>/02-platform`, `<prefix>/overlay` (GCS prefixes; `…/terraform.tfstate` appended on S3 and Azure) |
| `PROJECT` | gcp | yes | project id; exported as `CLOUDSDK_CORE_PROJECT` |
| `STATE_BUCKET` | gcp, aws | yes | state bucket, created if missing |
| `STATE_LOCATION` | gcp | no (`region` from `01-infra.tfvars`) | location of the state bucket |
| `STATE_REGION` | aws | yes | region of the state bucket |
| `PROFILE` | aws | no | named profile; exported as `AWS_PROFILE`, written into `backend.tf`, passed as `-var profile=` to `02-platform`. Empty uses the default credentials: confirm the account with `aws sts get-caller-identity` first |
| `DNS_DOMAIN` | all | no (`domain`) | the zone `dns.sh` registers and creates; `domain` must be it or a name under it. See [dns.md](dns.md) |
| `SUBSCRIPTION_ID` | azure | yes | exported as `ARM_SUBSCRIPTION_ID`; `az account set` |
| `LOCATION` | azure | yes | location of the state resource group and storage account |
| `STATE_RESOURCE_GROUP` | azure | yes | created if missing |
| `STATE_STORAGE_ACCOUNT` | azure | yes | 3–24 lowercase letters and digits, global; created if missing (`Standard_ZRS`, TLS 1.2, versioning) |
| `STATE_CONTAINER` | azure | yes | created if missing |

## Script flags

`deployment/scripts/setup.sh`:

| Flag | Effect |
|---|---|
| `--env <env>` | required; directory `<env-dir>/<env>/` |
| `--env-dir <path>` | base directory (default `deployment/environments`) |
| `--skip-infra`, `--skip-platform` | do not plan/apply that stack |
| `--only infra\|platform\|overlay` | run exactly one stage (the overlay stage still fetches the kubeconfig and waits for Argo CD) |
| `--auto-approve` | apply every plan without the `[yes/N]` prompt |
| `--dry-run` | print every command; no cloud login, doctor reports missing tools as `WARN` |
| `--skip-doctor` | do not run `doctor.sh` first |
| `--argo-timeout <seconds>` | how long to wait for all Applications to be Synced and Healthy (default `1800`) |

`DRY_RUN=1` and `AUTO_APPROVE=1` in the environment are equivalent to the flags.

`deployment/scripts/doctor.sh`: `--env`, `--env-dir`, `--dry-run`. Checks terraform >= 1.6.0,
helm >= 3.14.0, kubectl, jq, yq, the cloud CLI and its login, the three files, every required
stack variable, and placeholders in `env.conf`, both `.tfvars` and `overlay.tfvars`.

`deployment/scripts/destroy.sh`: `--env`, `--env-dir`, `--auto-approve` (skips the typed
confirmation of the environment name), `--dry-run`. See
[operations.md](operations.md#destroy).

## GCP `01-infra`

`deployment/terraform/stacks/gcp/01-infra/variables.tf`.

### Project, naming, DNS

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `project` | string | **required** | project id |
| `region` | string | **required** | region; the cluster is regional |
| `name` | string | `xyne` | resource prefix and cluster name; lowercase, digits, dashes, at most 16 characters |
| `domain` | string | **required** | apex the install is served under |
| `dns_zone` | string | `""` | Cloud DNS managed zone **name**; when set, `A` records for `domain`, `*.domain` (with `ingress_static_ip`) and the LiveKit names are created |
| `namespace` | string | `xyne` | application namespace, used in Workload Identity bindings; must match `02-platform` |
| `worker_names` | list(string) | `[]` | worker roles; ServiceAccount `xyne-worker-<name>` gets the `worker` identity |
| `labels` | map(string) | `{}` | labels on every resource |
| `enable_apis` | bool | `true` | enable the 13 required APIs (`compute`, `container`, `iam`, `iamcredentials`, `cloudresourcemanager`, `servicenetworking`, `sqladmin`, `redis`, `storage`, `secretmanager`, `dns`, `logging`, `monitoring`) |

### Network

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `subnet_cidr` | string | `10.10.0.0/20` | node subnet |
| `pods_cidr` | string | `10.20.0.0/16` | secondary range for pods |
| `services_cidr` | string | `10.30.0.0/20` | secondary range for services |
| `private_service_cidr` | string | `10.40.0.0/16` | private services range for Cloud SQL and Memorystore |
| `enable_iap_ssh` | bool | `true` | firewall rule allowing SSH from IAP (`35.235.240.0/20`) |
| `enable_flow_logs` | bool | `false` | VPC flow logs on the subnet |
| `bastion_enabled` | bool | `false` | one VM with OS Login, IAP-only SSH, `gcloud`/`kubectl`/`helm` installed at boot |
| `bastion_zone` | string | `""` | zone of the bastion; first zone of the region when empty |
| `bastion_machine_type` | string | `e2-small` | |

### Cluster

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `release_channel` | string | `REGULAR` | `RAPID`, `REGULAR`, `STABLE`, `EXTENDED` |
| `kubernetes_version` | string | `""` | `min_master_version`; channel default when empty |
| `master_ipv4_cidr_block` | string | `172.16.0.0/28` | control plane range |
| `master_authorized_networks` | list(object{cidr_block, display_name}) | `[]` | networks allowed to reach the API server. Empty makes the control plane private, so `kubectl` then has to run from inside the VPC. See [security.md](security.md#reaching-the-kubernetes-api) |
| `enable_private_endpoint` | bool | `false` | remove the public API endpoint |
| `node_locations` | list(string) | `[]` | zones for nodes; all zones of the region when empty |
| `cluster_logging`, `cluster_monitoring` | bool | `true` | Cloud Logging / Monitoring for the cluster |
| `maintenance_window` | object{start_time, end_time, recurrence} | Sat/Sun 02:00–06:00 UTC weekly | GKE maintenance window (RFC 5545 recurrence) |
| `cluster_deletion_protection` | bool | `true` | must be `false` before `destroy.sh` |
| `node_pools` | object | `{}` | per-pool overrides, see [Node pool sizing](#node-pool-sizing) |
| `zero_pool_enabled` | bool | `false` | create the `zero` pool (taint `storage-type=local-ssd:NoSchedule`) |
| `vespa_enabled` | bool | `false` | create the `vespa` pool (taint `pool=vespa:NoSchedule`) |
| `sandbox_enabled` | bool | `false` | create the `sandbox` pool (`UBUNTU_CONTAINERD`, nested virtualization, taint `workload=sandbox:NoSchedule`) |

### Postgres

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `postgres_mode` | string | `managed` | `managed` (Cloud SQL), `incluster`, `external` |
| `postgres_tier` | string | `db-custom-2-8192` | machine tier |
| `postgres_availability_type` | string | `REGIONAL` | `REGIONAL` (HA) or `ZONAL` |
| `postgres_disk_size_gb` | number | `20` | |
| `postgres_disk_autoresize_limit` | number | `0` | upper bound for automatic growth; `0` = unlimited |
| `postgres_backup_start_time` | string | `02:00` | daily backup window start (UTC) |
| `postgres_backup_retention_count` | number | `7` | backups kept |
| `postgres_transaction_log_retention_days` | number | `7` | point-in-time recovery window |
| `postgres_maintenance_window` | object{day, hour} | `{day = 7, hour = 3}` | Sunday 03:00 UTC |
| `postgres_deletion_protection` | bool | `true` | must be `false` before `destroy.sh` |
| `postgres_require_ssl` | bool | `true` | |
| `postgres_flags` | map(string) | `{}` | extra database flags (logical decoding, `max_replication_slots`, `max_wal_senders` are always set) |
| `postgres_max_replication_slots`, `postgres_max_wal_senders` | number | `10` | |
| `postgres_read_replica` | bool | `false` | create a read replica; `ro_host` points at it |
| `postgres_read_replica_tier` | string | `""` | replica tier; primary's when empty |
| `postgres_username` | string | `xyne` | application role |
| `postgres_databases` | object{app, common, zero_cvr, zero_cdb, claw_auth} | `xyne`, `xyne_common`, `zero_cvr`, `zero_cdb`, `claw_auth` | database names |
| `postgres_password` | string, sensitive | **required** | at least 16 characters |
| `external_postgres` | object{host, ro_host, port=5432, username=xyne, sslmode=require} | `{}` | used when `postgres_mode = "external"`; `host` required |

### Redis

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `redis_mode` | string | `managed` | `managed` (Memorystore), `incluster`, `external` |
| `redis_tier` | string | `STANDARD_HA` | `BASIC` or `STANDARD_HA` |
| `redis_memory_size_gb` | number | `4` | |
| `redis_version` | string | `REDIS_7_2` | |
| `redis_tls` | bool | `false` | server TLS (`SERVER_AUTHENTICATION`); the CA is not distributed to the apps, keep false |
| `redis_maintenance_window` | object{day, hour, minutes} | Sunday 03:00 | |
| `redis_configs` | map(string) | `{}` | Redis configuration parameters |
| `external_redis` | object{host, port=6379, tls=false} | `{}` | for `external` mode |
| `redis_auth` | string, sensitive | `""` | required for `incluster` and `external` with AUTH; ignored for `managed` (Memorystore generates the AUTH string) |

### Storage

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `storage_mode` | string | `managed` | `managed` (Cloud Storage), `incluster` (MinIO), `external` |
| `storage_bucket_prefix` | string | `""` | bucket name prefix; `<project>-<name>` when empty |
| `storage_bucket_names` | map(string) | `{}` | full names per key (`main`, `docs`, `canvas`, `recordings`, `workflows`, `transcription`, `bundles`, `claw`) |
| `storage_class` | string | `STANDARD` | |
| `storage_versioning` | bool | `false` | object versioning |
| `storage_force_destroy` | bool | `false` | allow `destroy` to delete non-empty buckets |
| `storage_lifecycle_rules` | list(object{action{type, storage_class}, condition{age, num_newer_versions, with_state, days_since_noncurrent_time, matches_prefix}}) | `[]` | |
| `storage_cors_origins` | list(string) | `[]` | `https://<domain>` when empty |
| `external_storage` | object{provider=s3, endpoint, region, buckets{…}} | `{}` | for `external` mode; all eight bucket names required |
| `storage_credentials` | object{access_key_id, secret_access_key}, sensitive | `{}` | required for `incluster` and `external` |

### Ingress

These five are the same on all three clouds. See [ingress.md](ingress.md).

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `ingress_mode` | string | `gateway` | `gateway`, `cloud-lb` or `external`; picks what sits in front of the Istio gateway and where TLS ends |
| `ingress_tls` | string | `""` | `acme`, `internal`, `existing` or `none`; empty lets the mode choose (`acme` for `gateway`, `internal` otherwise, `existing` for Azure `cloud-lb`) |
| `ingress_tls_secret` | string | `xyne-gateway-tls` | the Secret in `gateway_namespace` the gateway reads its certificate from |
| `ingress_node_ports` | object{http, https, status} | `{30080, 30443, 30021}` | node ports the gateway listens on when the Service is a `NodePort` |
| `ingress_external_traffic_policy` | string | `""` | `Local` keeps the client IP but drops nodes with no gateway pod from the edge's backends; empty leaves the cluster default |

GCP-specific:

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `ingress_static_ip` | bool | `true` | in `gateway` mode, reserve `<name>-ingress` (regional, PREMIUM) and pin the gateway Service to it; ignored in the other modes |
| `ingress_certificate_ids` | list(string) | `[]` | existing SSL certificates for the edge, used as-is |
| `ingress_certificate_pem`, `ingress_private_key_pem` | string, sensitive | `""` | a certificate you supply, uploaded as a self-managed certificate |
| `ingress_certificate_domains` | list(string) | `[]` | domains for a Google-managed certificate; `[domain]` when empty. Google-managed certificates cannot issue a wildcard, so widen this yourself or use one of the two above |
| `ingress_http_redirect` | bool | `true` | also create the port 80 forwarding rule that redirects to 443 |

Exactly one certificate source must resolve in `cloud-lb` mode, checked by a precondition.

### LiveKit

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `livekit_enabled` | bool | `false` | create the LiveKit tier; needs `redis_mode` `managed` or `external` |
| `livekit_api_key`, `livekit_api_secret` | string, sensitive | `""` | from `livekit-server generate-keys`; required when enabled |
| `livekit_server_image` | string | `livekit/livekit-server:v1.9.1` | |
| `livekit_egress_image` | string | `livekit/egress:v1.9.1` | |
| `livekit_vm_image` | string | `projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64` | |
| `livekit_machine_type`, `livekit_egress_machine_type` | string | `n2-standard-4` | |
| `livekit_disk_size_gb` | number | `50` | |
| `livekit_min_replicas`, `livekit_max_replicas` | number | `1`, `3` | server autoscaler bounds |
| `livekit_target_cpu_utilization` | number | `0.6` | autoscaler target (both groups) |
| `livekit_egress_min_replicas`, `livekit_egress_max_replicas` | number | `1`, `3` | |
| `livekit_port_range_start`, `livekit_port_range_end` | number | `50000`, `60000` | RTC UDP range, opened in the firewall |
| `livekit_turn_cert_secret` | string | `""` | Secret Manager secret id holding the TURN PEM bundle; enables TURN/TLS on 5349 |

## AWS `01-infra`

`deployment/terraform/stacks/aws/01-infra/variables.tf`.

### Account, naming, DNS

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `region` | string | **required** | |
| `profile` | string | `""` | named profile for the provider (set by `setup.sh` from `PROFILE`) |
| `name` | string | `xyne` | resource prefix and cluster name |
| `domain` | string | **required** | |
| `dns_zone` | string | `""` | Route 53 hosted zone **id**; enables the LiveKit alias records, ACM DNS validation and external-dns. Terraform never creates the application records on AWS |
| `external_dns_enabled` | bool | `true` | with `dns_zone`, create the IRSA role for external-dns scoped to that zone and emit `identities.external_dns`, which turns the `externalDns` addon on and makes it write the apex and wildcard records from the gateway Service. No effect without `dns_zone` |
| `namespace` | string | `xyne` | |
| `worker_names` | list(string) | `[]` | one IRSA trust for ServiceAccount `xyne-worker-<name>` each; `02-platform` refuses to apply a worker with no name here |
| `tags` | map(string) | `{}` | |

### Network

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `vpc_cidr` | string | `10.10.0.0/16` | |
| `az_count` | number | `3` | AZs used when `availability_zones` is empty |
| `availability_zones` | list(string) | `[]` | explicit AZ names |
| `subnet_newbits` | number | `4` | subnet size relative to the VPC (`/20` by default) |
| `private_subnet_cidrs`, `public_subnet_cidrs` | list(string) | `[]` | explicit subnet CIDRs, one per AZ |
| `services_cidr` | string | `""` | Kubernetes service range; EKS default when empty |
| `single_nat_gateway` | bool | `false` | one NAT gateway instead of one per AZ |
| `enable_vpc_endpoints` | bool | `true` | interface endpoints `ecr.api`, `ecr.dkr`, `sts`, `logs` |
| `internet_egress_cidrs` | list(string) | `[]` | **required**: where the nodes, the bastion and the LiveKit instances may reach outbound. `["0.0.0.0/0"]` for ordinary egress through NAT, or your proxy's ranges. Empty fails the plan. See [security.md](security.md#outbound-internet) |
| `enable_flow_logs` | bool | `false` | |
| `bastion_enabled` | bool | `false` | SSM-only instance in a public subnet with `psql` and `redis-cli` |
| `bastion_instance_type` | string | `t4g.micro` | |
| `bastion_ami_ssm_parameter` | string | `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` | |

### Cluster

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `kubernetes_version` | string | `1.35` | must be in EKS standard support unless `cluster_support_type = "EXTENDED"` (billed extra); `aws eks describe-cluster-versions` lists each version's status |
| `enable_private_endpoint` | bool | `false` | disable the public API endpoint |
| `eks_public_access_cidrs` | list(string) | `[]` | who may reach the public endpoint. Empty switches the public endpoint off, so `kubectl` then has to run from inside the VPC. See [security.md](security.md#reaching-the-kubernetes-api) |
| `deployer_principal_arn` | string | `""` | extra principal given `AmazonEKSClusterAdminPolicy` through an access entry |
| `cluster_log_types` | list(string) | `["api", "audit", "authenticator"]` | control plane logs |
| `cluster_log_retention_days` | number | `30` | |
| `cluster_kms_key_arn` | string | `""` | envelope encryption of secrets |
| `cluster_support_type` | string | `STANDARD` | `STANDARD` or `EXTENDED` |
| `addon_versions` | map(string) | `{}` | pin versions of `vpc-cni`, `kube-proxy`, `coredns`, `eks-pod-identity-agent`, `aws-ebs-csi-driver` |
| `sandbox_ami_ssm_parameter` | string | `""` | AMI for the sandbox pool; Canonical's EKS Ubuntu 24.04 for the cluster version when empty |
| `node_pools` | object | `{}` | see [Node pool sizing](#node-pool-sizing) |
| `zero_pool_enabled`, `vespa_enabled`, `sandbox_enabled` | bool | `false` | create those node groups; the sandbox group requires a `.metal` instance type |
| `use_pod_identity` | bool | `false` | add EKS Pod Identity associations next to IRSA |
| `lb_controller_enabled` | bool | `true` | create the IAM role for `aws-load-balancer-controller` (without it the gateway gets no NLB) |

### Postgres

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `postgres_mode` | string | `managed` | `managed` (RDS), `incluster`, `external` |
| `postgres_engine_version` | string | `16` | |
| `postgres_instance_class` | string | `db.m6g.large` | |
| `postgres_multi_az` | bool | `true` | |
| `postgres_disk_size_gb` | number | `20` | |
| `postgres_disk_autoresize_limit` | number | `0` | `max_allocated_storage`; `0` disables autoscaling |
| `postgres_backup_window` | string | `02:00-03:00` | UTC |
| `postgres_backup_retention_days` | number | `7` | |
| `postgres_maintenance_window` | string | `sun:03:00-sun:04:00` | |
| `postgres_performance_insights` | bool | `true` | |
| `postgres_deletion_protection` | bool | `true` | must be `false` before `destroy.sh` |
| `postgres_apply_immediately` | bool | `false` | apply modifications outside the maintenance window |
| `postgres_parameters` | map(string) | `{}` | extra parameter-group entries |
| `postgres_max_replication_slots`, `postgres_max_wal_senders` | number | `10` | |
| `postgres_read_replica` | bool | `false` | |
| `postgres_read_replica_class` | string | `""` | primary's class when empty |
| `postgres_kms_key_arn` | string | `""` | storage encryption key |
| `postgres_username` | string | `xyne` | master user |
| `postgres_databases` | object | as GCP | only `app` is created by RDS; the rest by hand |
| `postgres_password` | string, sensitive | **required** | at least 16; RDS forbids `/`, `@`, `"`, space |
| `external_postgres` | object | `{}` | as GCP |

### Redis

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `redis_mode` | string | `managed` | `managed` (ElastiCache), `incluster`, `external` |
| `redis_engine_version` | string | `7.1` | |
| `redis_node_type` | string | `cache.m6g.large` | |
| `redis_replicas` | number | `1` | replicas per shard |
| `redis_multi_az` | bool | `true` | |
| `redis_tls` | bool | `true` | in-transit encryption; required while `redis_auth` is set |
| `redis_at_rest_kms` | bool | `true` | at-rest encryption |
| `redis_kms_key_arn` | string | `""` | |
| `redis_maintenance_window` | string | `sun:03:00-sun:04:00` | |
| `redis_snapshot_window` | string | `01:00-02:00` | |
| `redis_snapshot_retention_days` | number | `7` | |
| `redis_parameters` | map(string) | `{}` | |
| `redis_apply_immediately` | bool | `false` | |
| `external_redis` | object | `{}` | |
| `redis_auth` | string, sensitive | `""` | **required when `redis_mode = "managed"`** (the AUTH token, 16–128 characters, no `/ @ "`), and for `incluster` |

### Storage

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `storage_mode` | string | `managed` | `managed` (S3), `incluster`, `external` |
| `storage_bucket_prefix` | string | `""` | `<account id>-<name>` when empty |
| `storage_bucket_names` | map(string) | `{}` | |
| `storage_versioning` | bool | `false` | |
| `storage_force_destroy` | bool | `false` | |
| `storage_kms_key_arn` | string | `""` | SSE-KMS instead of SSE-S3 |
| `storage_lifecycle_rules` | list(object{id, enabled, prefix, expiration_days, noncurrent_version_expiration_days, abort_incomplete_multipart_days, transitions[{days, storage_class}]}) | `[]` | |
| `storage_cors_origins` | list(string) | `[]` | |
| `external_storage`, `storage_credentials` | | | as GCP |

### Ingress

The five shared variables are described under [GCP](#ingress). AWS has no
`ingress_static_ip`: in `gateway` mode the NLB comes from the load balancer
controller and has a hostname, not an address.

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `ingress_certificate_arn` | string | `""` | an existing ACM certificate for the edge listener |
| `ingress_certificate_domains` | list(string) | `[]` | domains for a certificate Terraform requests from ACM with DNS validation; `[domain, *.domain]` when empty. Needs `dns_zone` |
| `ingress_allowed_cidrs` | list(string) | `["0.0.0.0/0"]` | who may reach the gateway's http and https node ports. An internet-facing NLB with instance targets preserves the client IP, so this is the real client range, not the load balancer's |
| `ingress_http_listener` | bool | `false` | also listen on port 80 and forward plain TCP to the gateway's http node port |

In `cloud-lb` mode AWS builds a Network Load Balancer with one Elastic IP per
public subnet and a TLS listener, because an Application Load Balancer has no
static address. Istio still does all HTTP routing, so nothing is lost by the
edge being L4. external-dns is switched off in this mode, since Terraform knows
the load balancer and writes the records itself.

### LiveKit

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `livekit_enabled`, `livekit_api_key`, `livekit_api_secret`, `livekit_server_image`, `livekit_egress_image`, `livekit_disk_size_gb`, `livekit_min_replicas`, `livekit_max_replicas`, `livekit_target_cpu_utilization`, `livekit_egress_min_replicas`, `livekit_egress_max_replicas`, `livekit_port_range_start`, `livekit_port_range_end` | | | as GCP |
| `livekit_ami_ssm_parameter` | string | `/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id` | |
| `livekit_instance_type`, `livekit_egress_instance_type` | string | `m6i.xlarge` | |
| `livekit_turn_cert_secret` | string | `""` | Secrets Manager secret name/ARN with the TURN PEM bundle |
| `livekit_certificate_arn` | string | `""` | ACM certificate for the ALB listener |
| `livekit_create_certificate` | bool | `true` | request and DNS-validate a certificate when `livekit_certificate_arn` is empty and `dns_zone` is set |

## Azure `01-infra`

`deployment/terraform/stacks/azure/01-infra/variables.tf`.

### Subscription, naming, DNS

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `subscription_id` | string | **required** | |
| `region` | string | **required** | Azure location |
| `resource_group_name` | string | `""` | `name` when empty |
| `create_resource_group` | bool | `true` | |
| `name` | string | `xyne` | |
| `domain` | string | **required** | must equal `dns_zone` or be a subdomain of it when `dns_zone` is set |
| `dns_zone` | string | `""` | Azure DNS zone **name** |
| `dns_zone_resource_group` | string | `""` | the zone's resource group; the install's when empty |
| `namespace` | string | `xyne` | |
| `worker_names` | list(string) | `[]` | |
| `tags` | map(string) | `{}` | |
| `zones` | list(string) | `[]` | availability zones for node pools, the ingress IP and Redis |
| `ssh_public_key` | string | `""` | required when `bastion_enabled` or `livekit_enabled` |

### Network

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `vnet_cidr` | string | `10.10.0.0/16` | |
| `aks_subnet_cidr` | string | `10.10.0.0/20` | |
| `postgres_subnet_cidr` | string | `10.10.16.0/24` | delegated to Flexible Server |
| `private_endpoints_subnet_cidr` | string | `10.10.17.0/24` | Redis and Blob private endpoints |
| `livekit_subnet_cidr`, `livekit_egress_subnet_cidr` | string | `10.10.18.0/24`, `10.10.19.0/24` | |
| `bastion_subnet_cidr` | string | `10.10.20.0/27` | |
| `azure_bastion_subnet_cidr` | string | `10.10.20.64/26` | `AzureBastionSubnet` |
| `appgw_subnet_cidr` | string | `10.10.21.0/24` | Application Gateway (LiveKit) |
| `pods_cidr`, `services_cidr` | string | `10.20.0.0/16`, `10.30.0.0/20` | overlay pod range, service range |
| `nat_gateway_enabled` | bool | `true` | outbound through a NAT gateway; AKS `outboundType` follows it |
| `nat_public_ip_prefix_length` | number | `30` | prefix size for the NAT gateway |
| `aks_inbound_ports` | list(string) | `["80", "443"]` | ports the AKS NSG admits from the internet |
| `bastion_enabled` | bool | `false` | one VM with the AAD SSH extension; SSH allowed from the VNet only |
| `bastion_vm_size` | string | `Standard_B2s` | |
| `bastion_public_ip` | bool | `false` | attach a public IP to the VM (the NSG still restricts SSH to the VNet unless `bastion_allowed_ssh_cidrs` is set) |
| `bastion_allowed_ssh_cidrs` | list(string) | `[]` | extra NSG rule admitting TCP 22 to `bastion_subnet_cidr` from these CIDRs, for SSH straight to `bastion_public_ip` instead of through Azure Bastion |
| `azure_bastion_enabled` | bool | `false` | create an Azure Bastion host in `AzureBastionSubnet` |
| `azure_bastion_sku` | string | `Basic` | `Standard` enables tunnelling (`az network bastion ssh`) |

### Cluster

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `kubernetes_version` | string | `""` | latest when empty |
| `cluster_sku_tier` | string | `Standard` | `Free`, `Standard`, `Premium` |
| `enable_private_endpoint` | bool | `false` | private cluster |
| `aks_authorized_ip_ranges` | list(string) | `[]` | API server authorized ranges. Empty makes the cluster private, so `kubectl` then has to run from inside the VNet. See [security.md](security.md#reaching-the-kubernetes-api) |
| `deployer_principal_id` | string | `""` | object id given cluster user/admin roles; the current identity when empty |
| `admin_group_object_ids` | list(string) | `[]` | Entra groups as AKS admins |
| `azure_rbac_enabled` | bool | `true` | Azure RBAC for Kubernetes authorization |
| `local_account_disabled` | bool | `false` | |
| `key_vault_secrets_provider` | bool | `false` | AKS Key Vault CSI addon |
| `cluster_logging` | bool | `false` | Container Insights |
| `cluster_log_retention_days` | number | `30` | |
| `log_analytics_workspace_id` | string | `""` | existing workspace; created when empty and logging is on |
| `automatic_upgrade_channel` | string | `patch` | `none`, `patch`, `rapid`, `stable`, `node-image` |
| `node_os_upgrade_channel` | string | `NodeImage` | `None`, `Unmanaged`, `NodeImage`, `SecurityPatch` |
| `maintenance_window` | object{day_of_week, start_time, duration_hours, utc_offset} | Sunday 02:00, 4h, `+00:00` | |
| `node_pools` | object | `{}` | see [Node pool sizing](#node-pool-sizing) |
| `zero_pool_enabled`, `vespa_enabled`, `sandbox_enabled` | bool | `false` | |

### Postgres

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `postgres_mode` | string | `managed` | `managed` (Flexible Server), `incluster`, `external` |
| `postgres_server_name` | string | `""` | global name; `<name>-postgres` when empty |
| `postgres_engine_version` | string | `16` | |
| `postgres_sku_name` | string | `GP_Standard_D2ds_v5` | |
| `postgres_storage_mb` | number | `32768` | |
| `postgres_storage_tier` | string | `""` | |
| `postgres_storage_autogrow` | bool | `true` | |
| `postgres_high_availability` | bool | `true` | zone-redundant standby |
| `postgres_zone`, `postgres_standby_zone` | string | `""` | |
| `postgres_backup_retention_days` | number | `7` | |
| `postgres_geo_redundant_backup` | bool | `false` | |
| `postgres_maintenance_window` | object{day_of_week, start_hour, start_minute} | Sunday 03:00 | |
| `postgres_parameters` | map(string) | `{}` | server parameters |
| `postgres_extensions` | list(string) | `[]` | `azure.extensions` allow-list |
| `postgres_max_replication_slots`, `postgres_max_wal_senders` | number | `10` | |
| `postgres_read_replica` | bool | `false` | |
| `postgres_read_replica_sku_name`, `postgres_read_replica_zone` | string | `""` | |
| `postgres_username` | string | `xyne` | admin login |
| `postgres_databases` | object | as GCP | all five are created |
| `postgres_password` | string, sensitive | **required** | |
| `external_postgres` | object | `{}` | |

### Redis

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `redis_mode` | string | `managed` | `managed` (Azure Cache for Redis), `incluster`, `external` |
| `redis_cache_name` | string | `""` | global name; `<name>-redis` when empty |
| `redis_sku_name` | string | `Standard` | `Basic`, `Standard`, `Premium` |
| `redis_capacity` | number | `1` | C-size |
| `redis_version` | string | `6` | |
| `redis_replicas_per_primary` | number | `1` | Premium only |
| `redis_maxmemory_policy` | string | `volatile-lru` | |
| `redis_patch_schedule` | object{day_of_week, start_hour_utc} | Sunday 03:00 | |
| `external_redis` | object | `{}` | |
| `redis_auth` | string, sensitive | `""` | for `incluster`/`external`; `managed` uses the cache's primary access key |

### Storage

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `storage_mode` | string | `managed` | `managed` (Blob, provider `azure`), `incluster` (MinIO), `external` |
| `storage_account_name` | string | `""` | required for `managed`; global, 3–24 lowercase alphanumerics; reaches the apps as `AZURE_STORAGE_ACCOUNT` |
| `storage_bucket_prefix` | string | `""` | `<name>` when empty |
| `storage_bucket_names` | map(string) | `{}` | container names |
| `storage_replication_type` | string | `ZRS` | |
| `storage_access_tier` | string | `Hot` | |
| `storage_versioning` | bool | `false` | |
| `storage_shared_access_key_enabled` | bool | `true` | when true the account key is emitted as `storage_credentials`; `false` is safe, the apps sign with their workload identity |
| `storage_delete_retention_days` | number | `7` | soft delete |
| `storage_public_network_access` | bool | `true` | |
| `storage_network_default_action` | string | `Deny` | the cluster, bastion and LiveKit subnets are allowed through automatically; set `Allow` to drop the firewall entirely |
| `storage_allowed_ip_ranges` | list(string) | `[]` | addresses outside the VNet that may reach the blobs, such as a CI runner uploading dashboard bundles. See [security.md](security.md#object-storage) |
| `storage_private_endpoint` | bool | `false` | private endpoint in `private_endpoints_subnet_cidr` |
| `storage_lifecycle_rules` | list(object{name, enabled, prefixes, blob_types, tier_to_cool_after_days, tier_to_archive_after_days, delete_after_days, version_delete_after_days, version_tier_to_cool_after_days}) | `[]` | |
| `storage_cors_origins`, `external_storage`, `storage_credentials` | | | as GCP |

### Ingress

The five shared variables are described under [GCP](#ingress). Azure differs
from the other two in `cloud-lb` mode: an Application Gateway backend pool
takes addresses, not node pools, so the gateway Service stays a `LoadBalancer`
and becomes an internal one on `ingress_internal_ip`, which is then the
backend. `ingress_node_ports` is unused there.

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `ingress_static_ip` | bool | `true` | in `gateway` mode, `Standard` static public IP `<name>-ingress`; the gateway Service is annotated with the resource group and pip name |
| `ingress_internal_ip` | string | `""` | required in `cloud-lb` mode: a free private address inside the cluster subnet for the internal load balancer |
| `ingress_certificate_key_vault_secret_id` | string | `""` | versionless Key Vault secret id of the frontend certificate |
| `ingress_certificate_key_vault_id` | string | `""` | the vault's ARM id, needed to scope the gateway identity's role assignment |
| `ingress_certificate_pfx_data`, `ingress_certificate_pfx_password` | string, sensitive | `""` | a PFX you supply instead of a Key Vault certificate |
| `ingress_backend_protocol` | string | `Https` | `Https` or `Http` for the leg to the gateway |
| `ingress_backend_root_certificate_pem` | string, sensitive | `""` | the root of the gateway's certificate, so an `Https` backend is trusted. Not needed when that certificate comes from a public CA |
| `ingress_appgw_subnet_id` | string | `""` | a dedicated subnet; the existing `appgw` subnet when empty, shared with the LiveKit gateway, which Azure permits between two v2 gateways |
| `ingress_appgw_sku` | object{name, tier} | `Standard_v2` | set both to `WAF_v2` to use `ingress_waf_enabled` |
| `ingress_appgw_capacity` | object{min, max} | `{1, 3}` | autoscale bounds |
| `ingress_appgw_domain_name_label` | string | `""` | gives the public IP an `*.cloudapp.azure.com` name |
| `ingress_waf_enabled` | bool | `false` | attach a WAF policy; needs the `WAF_v2` sku |
| `ingress_http_redirect` | bool | `true` | also listen on 80 and redirect to the HTTPS listener |
| `ingress_request_timeout` | number | `3600` | backend request timeout; keep it high for WebSockets |
| `ingress_probe_path` | string | `/healthz/ready` | answered directly by the gateway, which `platform-config` adds as a route whenever the edge terminates TLS |
| `ingress_probe_port` | number | `0` | `15021` for an `Http` backend and the backend port otherwise |
| `ingress_probe_status_codes` | list(string) | `["200-399"]` | |

Application Gateway v2 will not trust a backend certificate it has no root
for, which is why `ingress_tls` defaults to `existing` here rather than
`internal`. Supply the certificate through `gateway_tls` in `02-platform` and
its root through `ingress_backend_root_certificate_pem`, or set
`ingress_backend_protocol = "Http"` with `ingress_tls = "none"`.

### LiveKit

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `livekit_enabled`, `livekit_api_key`, `livekit_api_secret`, `livekit_server_image`, `livekit_egress_image`, `livekit_disk_size_gb`, `livekit_min_replicas`, `livekit_max_replicas`, `livekit_target_cpu_utilization`, `livekit_egress_min_replicas`, `livekit_egress_max_replicas`, `livekit_port_range_start`, `livekit_port_range_end` | | | as GCP |
| `livekit_vm_image` | object{publisher=Canonical, offer=ubuntu-24_04-lts, sku=server, version=latest} | `{}` | |
| `livekit_vm_size`, `livekit_egress_vm_size` | string | `Standard_D4s_v5` | |
| `livekit_admin_username` | string | `xyne` | |
| `livekit_key_vault_id` | string | `""` | existing vault for the config secrets; one is created when empty |
| `livekit_key_vault_name` | string | `""` | name of the created vault; `<name>-livekit-kv` when empty; 3–24 characters, global |
| `livekit_key_vault_purge_protection` | bool | `false` | |
| `livekit_turn_cert_secret` | string | `""` | Key Vault **secret name** (in the LiveKit vault) with the TURN PEM bundle |
| `livekit_https` | bool | `true` | HTTPS listener on the Application Gateway; `false` gives `ws://` |
| `livekit_certificate_secret_id` | string | `""` | Key Vault certificate secret id; **required** when `livekit_https` |
| `livekit_certificate_key_vault_id` | string | `""` | vault of that certificate when different from the LiveKit vault |
| `livekit_appgw_min_capacity`, `livekit_appgw_max_capacity` | number | `1`, `3` | Application Gateway v2 autoscale |

## `02-platform` (all clouds)

`deployment/terraform/stacks/<cloud>/02-platform/variables.tf`. The application variables are
identical on the three clouds; only the state and provider variables differ.

### State and provider (set by `setup.sh` from `env.conf`)

| Cloud | Variables |
|---|---|
| GCP | `project` (**required**), `region` (**required**), `state_bucket` (**required**), `state_prefix` (`xyne/01-infra`) |
| AWS | `region` (**required**), `profile` (`""`), `state_bucket` (**required**), `state_key` (`xyne/01-infra/terraform.tfstate`), `state_region` (`""` = `region`) |
| Azure | `subscription_id` (**required**), `region` (**required**), `state_resource_group_name` (**required**), `state_storage_account_name` (**required**), `state_container_name` (`tfstate`), `state_key` (`xyne/01-infra/terraform.tfstate`), `state_use_azuread_auth` (`true`), `kubelogin_login` (`azurecli`; one of `azurecli`, `azd`, `devicecode`, `interactive`, `msi`, `spn`, `workloadidentity`), `kubelogin_extra_args` (`[]`), `aks_aad_server_id` (`6dae42f8-4368-4678-94ff-3960e28e3630`) |

### Install

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `namespace` | string | `xyne` | application namespace; set the same value in `01-infra`. **Use `xyne-apps` with the published images**: the dashboard's nginx and the claw tools address `xyne-backend.xyne-apps` and `xyne-claw-auth.xyne-apps`, so in any other namespace the dashboard does not start |
| `domain` | string | `""` | apex; `ingress.domain` from `01-infra` when empty |
| `repo_url` | string | `https://github.com/juspay/xyne-spaces.git` | repository Argo CD reads charts from |
| `chart_revision` | string | **required** | revision of `helm-charts/charts/*` (a `chart-<version>` tag) |
| `root_revision` | string | `main` | revision of `deployment/argocd/root` and `deployment/argocd/addons` |
| `image_registry` | string | `""` | replaces `ghcr.io` for every Xyne image and sets `global.imageRegistry` |
| `image_tag` | string | `""` | tag for images built from this repository (`xyneImage` charts); the chart `appVersion` when empty |
| `acme_email` | string | `""` | Let's Encrypt account email; used when `ingress_tls` resolves to `acme` |
| `gateway_namespace` | string | `istio-ingress` | namespace the ingress gateway and its TLS Secret live in |
| `gateway_tls` | object{cert_pem, key_pem}, sensitive | `{}` | the gateway's certificate, required when `ingress_tls = "existing"` and rejected otherwise; Terraform writes it to `xyne-gateway-tls` instead of cert-manager. See [ingress.md](ingress.md#certificates) |
| `argocd_chart_version` | string | `10.9.2` | `argo-cd` Helm chart version |
| `argocd_apps_chart_version` | string | `2.0.5` | `argocd-apps` Helm chart version |
| `argocd_namespace` | string | `argocd` | |
| `argocd_values` | string (YAML) | `""` | extra values for the `argo-cd` chart (merged after `fullnameOverride: argocd`, `configs.params.server.insecure: true`) |
| `enable_vespa` | bool | `false` | `addons.vespa.enabled` |
| `enable_hindsight` | bool | `false` | `addons.hindsight.enabled`; deploys the upstream Hindsight chart and points claw's long-term memory at it |
| `hindsight` | object{url, tenant} | `{}` | point claw at a Hindsight you run elsewhere instead. `url` wins over the deployed addon; empty with the addon off disables memory entirely |
| `enable_monitoring` | bool | `false` | `addons.monitoring.enabled` |
| `enable_sandbox` | bool | `false` | `addons.sandbox.enabled`; also registers the `quay.io/kata-containers/kata-deploy-charts` OCI repository in Argo CD |
| `apps` | map(object{enabled, values}) | `{}` | per-chart switch and YAML value overrides, see below |
| `workers` | list(object{name, env, values}) | `[]` | worker installs, see below |
| `addon_values` | map(string YAML) | `{}` | per-addon value overrides, keyed by addon name |
| `overlay_sources` | list(object{name, repo_url, target_revision, path, helm_values}) | `[]` | extra Argo CD Applications (wave 2) |
| `app_secrets` | object, sensitive | **required** | see [secrets.md](secrets.md) |
| `extra_secret_data` | map(map(string)), sensitive | `{}` | extra keys merged into the named Secrets |

## Root Argo CD values

`02-platform` turns its variables into the `valuesObject` of the `xyne-root` Application,
merged over `deployment/argocd/root/values.yaml`. What you can influence from `.tfvars`:

### `apps.<chart>`

| Chart | Default | Notes |
|---|---|---|
| `xyne-backend` | on | |
| `xyne-dashboard` | on | |
| `xyne-zero` | on | view-syncers |
| `xyne-zero-replication` | on | the replication manager (chart `xyne-zero` with fixed overrides) |
| `xyne-ysweet` | on | persistence on a PVC unless `storeUrl` is set in the root values |
| `xyne-dashboard-external` | off | adds the `/external/` route |
| `xyne-dashboard-edge` | off | bundle-serving edge, reads the `bundles` bucket |
| `xyne-claw` | off | agent runtime; sets `XYNE_CLAW_URL` on the backend |
| `xyne-claw-auth` | off | sets `XYNE_CLAW_AUTH_URL` on the backend |
| `xyne-claw-auth-frontend` | off | adds the `/claw/` route; needs `xyne-claw-auth` |
| `xyne-transcription-agent` | off | needs LiveKit |
| `xyne-lighton-ocr` | off | sets `DOCLING_SERVICE_URL` on the backend |

`apps = { "<chart>" = { enabled = bool, values = "<YAML>", store_url = "<URL>" } }`. `values` is
deep-merged over the values the root chart computes for that chart; any key of the service chart
is allowed (`resources`, `autoscaling`, `env`, `secretEnv`, `replicaCount`, `image`, …).
`store_url` reaches the chart as `storeUrl` and is left out of the values when empty, so the
chart's own default stands; `xyne-ysweet` uses it to persist to an object store instead of a
PVC. See [helm-charts/CHARTS.md](../../helm-charts/CHARTS.md) for what each chart expects.

### `workers`

Each entry becomes Application `xyne-worker-<name>` from chart `xyne-worker` with
`fullnameOverride: <name>`, the backend's environment and Secret references, plus `env`
(a map of strings, typically the `ENABLE_*_WORKER` flags) and `values` (YAML, merged last).
The `worker` cloud identity is bound to ServiceAccount `xyne-worker-<name>` only when `<name>`
is in `worker_names` of `01-infra`, and `02-platform` refuses to apply when it is not: the
worker would otherwise start and fail on object storage. The bound names travel in
`identities.worker.ksa_names`; see [contract.md](contract.md#identities).

### `addon_values`

Keys are the addon names of the root values: `lbController`, `externalDns`, `istio`,
`platformConfig`, `certManager`, `cnpg`, `redis`, `minio`, `vespa`, `monitoring`, `sandbox`. The YAML string is
merged into that addon's block, so both the addon's own switches and its chart `values` are
reachable:

| Addon | Block keys (root `values.yaml`) |
|---|---|
| `lbController` | `enabled` (null = when cloud is aws), `version` 3.5.0, `namespace` kube-system, `serviceAccountName`, `values` |
| `externalDns` | `enabled` (null = when `infra.ingress.dnsZone` and `identities.externalDns.annotations` are both set), `version` 1.19.0, `namespace` external-dns, `serviceAccountName`, `provider` aws, `policy` sync, `sources` `[service]`, `values` |
| `istio` | `enabled`, `version` 1.30.5, `namespace` istio-system, `gatewayNamespace` istio-ingress, `peerAuthentication` STRICT (`""` disables), `values.base`, `values.istiod`, `values.gateway` |
| `platformConfig` | `storageClass.enabled` (null = when cloud is aws), `values` (any `platform-config` chart value: `gateway.extraHosts`, `routes.extra`, `routes.apiTimeout`, `certManager.server`, `storageClass.*`) |
| `certManager` | `enabled`, `version` v1.21.2, `namespace`, `email`, `issuer` letsencrypt, `server` (ACME URL), `wildcard`, `values` |
| `cnpg` | `enabled`, `version` 0.29.0, `namespace` cnpg-system, `cluster.instances` 2, `cluster.imageName`, `cluster.storage.size` 50Gi, `cluster.storage.storageClass`, `cluster.pooler.{instances 2, maxClientConn 1000, defaultPoolSize 20}`, `cluster.backup.{enabled, destinationPath, endpointURL, credentialsSecret xyne-pg-backup, schedule, retentionPolicy 14d}`, `values` |
| `redis` | `enabled`, `persistence.size` 10Gi, `persistence.storageClass`, `values` |
| `minio` | `enabled`, `version` 5.4.0, `persistence.size` 200Gi, `persistence.storageClass`, `resources.requests.memory` 2Gi, `values` |
| `hindsight` | `enabled`, `repoURL` github.com/vectorize-io/hindsight, `targetRevision` v0.10.1, `path` helm/hindsight, `namespace` hindsight, `service` hindsight-api, `port` 8888, `values` (any upstream chart value: `postgresql.*`, `worker.*`, `tei.*`, `api.env`, `existingSecret`) |
| `vespa` | `enabled`, `image.{registry, repository vespaengine/vespa, tag}`, `proxyImage.{registry, repository, tag}`, `storageClass`, `configserverStorage` 50Gi, `contentStorage` 200Gi, `embedder.enabled` true, `values.{configserver, content, feed, search, embedder, proxy}` |
| `monitoring` | `enabled`, `namespace` monitoring, `metricsEndpoint`, `victoriaMetrics.version` 0.93.0, `otelCollector.version` 0.173.1, `values.{victoriaMetrics, otelCollector}` |
| `sandbox` | `enabled`, `kata.{version 4.1.0, imageTag 4.1.0, namespace kube-system, shim qemu, shims [qemu, qemu-runtime-rs], hypervisorAnnotations}`, `controller.{repoURL, targetRevision v0.4.5, path helm, namespace, image, tag, values}`, `template.{name, image, vcpus, memory, resources}`, `warmPool.replicas`, `policy.{allowedEgress, dns.cidrs}`, `values.{kata, policy, router, egressProxy}` |

`cnpg`, `redis` and `minio` are switched on by the component modes, not by hand. `externalDns`
follows `dns_zone` and `external_dns_enabled` in `01-infra`, which today means AWS only; the same
condition adds `external-dns.alpha.kubernetes.io/hostname: <domain>,*.<domain>` to the gateway
Service, and that annotation is the only record source it reads.

### `overlay_sources`

Each `{name, repo_url, target_revision, path, namespace, helm_values}` renders an Application in
wave 2, with `helm.releaseName = name` and `helm.values = helm_values` when the latter is
non-empty (plain manifests otherwise). `namespace` is that Application's destination namespace
and defaults to `""`, which means the install namespace; the namespace is created if missing,
and one that is not a destination of the AppProject is refused by Argo CD: the project allows the
install namespace, the Argo CD namespace and the addon namespaces, plus
`argocd.extraDestinations` in the root chart's own values. The repository must be reachable by
Argo CD (`argocd_values` can add `configs.repositories` / `configs.credentialTemplates`).

### `extra_secret_data`

`{ "<secret name>" = { KEY = "value" } }` for any of the nine Secret names; keys are added or
overwritten. Referencing a new key from a chart is done with `secretEnv` in `apps.<chart>.values`.

## Node pool sizing

`node_pools` in `01-infra.tfvars` is an object with keys `general`, `zero`, `vespa`, `sandbox`;
every attribute is optional. Fixed per pool: the label `pool=<key>`, and the taints below on the
three optional pools. The root chart schedules each app on `general` (or `zero` for the Zero
pods, `vespa` for Vespa, the sandbox pool for Kata) and falls back to `general` when that pool is
disabled.

| Pool | Taint | GCP default | AWS default | Azure default |
|---|---|---|---|---|
| `general` | none | `e2-standard-4`, 1–5, 100 GB `pd-balanced` | `m6i.xlarge`, 1–5, 100 GB `gp3`, `AL2023_x86_64_STANDARD` | `Standard_D4s_v5`, 1–5, 128 GB `Managed`, `Ubuntu` |
| `zero` | `storage-type=local-ssd:NoSchedule` | `e2-highmem-4`, 1–3, `local_ssd_count` 0 (needs N2/N2D/C2 when > 0) | `r6i.xlarge`, 1–3, `local_storage_raid0` false | `Standard_E4s_v5`, 1–3, `local_storage_temp_disk` false (needs a `d` size) |
| `vespa` | `pool=vespa:NoSchedule` | `n2-standard-8`, 1–3, 200 GB `pd-ssd` | `m6i.2xlarge`, 1–3, 200 GB | `Standard_D8s_v5`, 1–3, 256 GB |
| `sandbox` | `workload=sandbox:NoSchedule` | `n1-standard-4`, 1–5, `UBUNTU_CONTAINERD`, nested virtualization | `m5zn.metal`, 1–3, Ubuntu EKS AMI (must end in `.metal`) | `Standard_D4s_v3`, 1–3 (must be a v3/v4 D or E size) |

Common attributes: `min_count`, `max_count`, `disk_size_gb`, `disk_type`, `spot`, `labels`;
plus `machine_type` (GCP), `instance_type`, `desired_count`, `ami_type` (AWS), `vm_size`,
`os_sku` (Azure; `general` cannot be spot). Example:

```hcl
node_pools = {
  general = { machine_type = "n2-standard-4", min_count = 2, max_count = 8 }
  zero    = { machine_type = "n2-highmem-4", local_ssd_count = 1 }
}
zero_pool_enabled = true
```

## Recipes

### Enable claw (agents)

`01-infra.tfvars` needs nothing new (the `claw` and `claw_auth` identities always exist).
`02-platform.tfvars`:

```hcl
apps = {
  xyne-claw               = { enabled = true }
  xyne-claw-auth          = { enabled = true }
  xyne-claw-auth-frontend = { enabled = true }
}

app_secrets = {
  # … existing keys …
  litellm_api_key      = "sk-…"                    # model access for claw
  google_client_id     = "…apps.googleusercontent.com"   # claw-auth OAuth
  google_client_secret = "GOCSPX-…"
}
```

Then `setup.sh --env prod --only platform`. The backend gets `XYNE_CLAW_URL=http://xyne-claw:8081`
and `XYNE_CLAW_AUTH_URL=http://xyne-claw-auth:3003`; the gateway gains the `/claw/` route.
Sandboxed execution additionally needs the [sandbox addon](#turn-on-vespa-monitoring-or-the-sandbox).

### Add a worker role

`01-infra.tfvars`:

```hcl
worker_names = ["default", "vespa-ingestion"]
```

`02-platform.tfvars`:

```hcl
workers = [
  { name = "default", env = { ENABLE_NOTIFICATION_WORKER = "true", ENABLE_WORKER_SCHEDULER = "true", ENABLE_WORKFLOW_RECOVERY = "true" } },
  {
    name = "vespa-ingestion"
    env  = { ENABLE_VESPA_WORKER = "true", VESPA_WORKER_QUEUE_NAME = "vespa-ingestion" }
    values = <<-YAML
      replicaCount: 2
      resources:
        requests: {cpu: 500m, memory: 1Gi}
    YAML
  },
]
```

Run `setup.sh --env prod` (both stages: the identity binding lives in `01-infra`). Applying
`02-platform` alone fails on a precondition naming the worker that has no identity yet. The role
flags and their exclusivity rules are in
[helm-charts/CHARTS.md](../../helm-charts/CHARTS.md#xyne-worker); `ENABLE_WORKER_SCHEDULER`
and `ENABLE_WORKFLOW_RECOVERY` must be true on exactly one worker.

### Pin images to your own registry

Mirror `ghcr.io/juspay/<image>:<tag>` for every image in `ci/images.json` plus
`ghcr.io/juspay/y-sweet`, then:

```hcl
image_registry = "registry.example.com/xyne"
image_tag      = "1.356.0"
```

`image_registry` replaces the registry of every chart image (through `image.registry` and
`global.imageRegistry`); `image_tag` applies to images built from this repository (backend,
worker, dashboards, claw, claw-auth, transcription-agent, ocr) and must match a tag that
`chart_revision`'s charts can run. Vespa and the batch proxy take their tags from
`addon_values["vespa"]`. If the mirror needs a pull secret, create it in `namespace` yourself
(`kubectl create secret docker-registry …` or an overlay; `extra_secret_data` only writes the
nine known Secrets) and reference it with `imagePullSecrets` in `apps.<chart>.values`.

### Turn on Vespa, monitoring or the sandbox

```hcl
# 01-infra.tfvars
vespa_enabled   = true      # the vespa node pool (Vespa nodes are pinned to it)
sandbox_enabled = true      # the sandbox node pool

# 02-platform.tfvars
enable_vespa      = true
enable_monitoring = true
enable_sandbox    = true

addon_values = {
  vespa = <<-YAML
    image: {tag: "8.520.9"}
    proxyImage: {registry: ghcr.io/juspay, tag: "1.356.0"}
    storageClass: premium-rwo
    embedder: {enabled: false}
  YAML
  monitoring = <<-YAML
    values:
      victoriaMetrics:
        grafana: {enabled: true}
  YAML
  sandbox = <<-YAML
    controller: {repoURL: https://github.com/example-org/agent-sandbox-manifests.git, targetRevision: main, path: config/default}
    template: {image: registry.example.com/xyne/kata-workspace:1.0.0}
    policy: {allowedEgress: []}
  YAML
}
```

- **Vespa** installs four `xyne-vespa` roles, and with `embedder.enabled` a GPU embedder plus
  the batching proxy. `image.tag` is required (the chart's `appVersion` is a placeholder). The
  backend receives `VESPA_FEED_URL`, `VESPA_QUERY_URL`, `VESPA_CONFIG_SERVER_URL`. Schemas are
  deployed separately (`vespa-core/`).
- **Monitoring** installs `victoria-metrics-k8s-stack` (release `vm`) and an OpenTelemetry
  collector in `monitoring`; every app gets `ENABLE_OTEL_METRICS=true` and
  `OTEL_BASE_URL=http://otel-collector.monitoring.svc:4318`.
- **Sandbox** installs `kata-deploy` on the sandbox pool. `kata.shims` lists the shims to
  install (`qemu` and `qemu-runtime-rs`) and `kata.shim` picks which one the workload runs,
  defaulting to `qemu`, the Go runtime. That single value sets kata-deploy's `defaultShim` and
  the `SandboxTemplate`'s `runtimeClassName` to `kata-<shim>` together, so the two cannot drift
  and switching runtime is a one-field edit. The Rust runtime is installed but unused by
  default: the sandbox image runs dockerd inside the microVM, and upstream tests Docker only
  against QEMU. `kata.hypervisorAnnotations` is the allowlist of
  `io.katacontainers.config.hypervisor.*` annotations a sandbox may set; an annotation missing
  from it is silently rejected and the microVM boots at kata's own defaults rather than the
  `template.vcpus` and `template.memory` you asked for. It also installs the agent-sandbox
  controller and its four CRDs from the upstream chart at `controller.repoURL` (pinned to
  `v0.4.5`, with `controller.extensions` on so the `SandboxTemplate`, `SandboxWarmPool` and
  `SandboxClaim` workers run; clear `repoURL` if you install it yourself), the `SandboxTemplate`, warm pool,
  NetworkPolicy and RBAC from `deployment/argocd/addons/sandbox`. `policy.dns.cidrs` is empty
  by default and only matters when the cluster runs NodeLocal DNSCache: that DaemonSet binds
  its addresses on every node, so a lookup never reaches a kube-dns pod and the pod selector
  rule never matches. Put both addresses from its `-localip` flag in `policy.dns.cidrs`, the
  link-local one and the kube-dns ClusterIP, or every name lookup inside a sandbox hangs. Read
  them with
  `kubectl -n kube-system get ds node-local-dns -o jsonpath='{.spec.template.spec.containers[0].args}'`.
  It also installs `xyne-sandbox-router` and
  `xyne-egress-proxy`. `xyne-claw` then gets `KATA_ROUTER_URL`, `KATA_NAMESPACE`,
  `KATA_TEMPLATE` and a mounted ServiceAccount token. `template.image` is required.

### Switch Postgres to in-cluster (CloudNativePG)

```hcl
# 01-infra.tfvars
postgres_mode     = "incluster"
postgres_password = "…"          # becomes xyne-pg-app

# 02-platform.tfvars (optional)
addon_values = {
  cnpg = <<-YAML
    cluster:
      instances: 3
      storage: {size: 100Gi, storageClass: premium-rwo}
      backup:
        enabled: true
        destinationPath: s3://acme-spaces-prod-xyne-backups/pg
        credentialsSecret: xyne-pg-backup
        schedule: "0 0 2 * * *"
        retentionPolicy: 30d
  YAML
}
```

`01-infra` creates no database; Argo CD installs the operator (wave -2) and `pg-cluster`
(wave -1): a `Cluster xyne-pg` with `wal_level=logical`, the five databases, `ALTER ROLE xyne
REPLICATION`, and `Pooler`s `xyne-pg-pooler-rw` / `xyne-pg-pooler-ro` (transaction mode). Apps
use the poolers; Zero uses `xyne-pg-rw`. No one-time SQL is needed. Backups need a Secret
`xyne-pg-backup` with `ACCESS_KEY_ID` / `ACCESS_SECRET_KEY` (create it yourself or through an
overlay). Switching an existing install migrates no data.

### Switch Postgres to an external server

```hcl
postgres_mode     = "external"
postgres_password = "…"
external_postgres = {
  host     = "pg.internal.example.com"
  ro_host  = "pg-ro.internal.example.com"   # optional
  port     = 5432
  username = "xyne"
  sslmode  = "require"
}
```

The server must have `wal_level=logical`, enough replication slots and WAL senders, the five
databases, and the role with `REPLICATION`; it must be reachable from the cluster network.

### Switch Redis to in-cluster

```hcl
redis_mode = "incluster"
redis_auth = "…"     # required; becomes xyne-redis-auth and REDIS_PASSWORD
```

Argo CD installs `helm-charts/charts/xyne-redis` (single node, 10 GiB PVC by default) as
`xyne-redis.<namespace>.svc:6379` without TLS. Not compatible with `livekit_enabled`.

### MinIO instead of buckets

```hcl
storage_mode = "incluster"
storage_credentials = {
  access_key_id     = "xyne-minio"      # MinIO root user
  secret_access_key = "…"               # MinIO root password
}
```

`01-infra` creates no buckets and no bucket IAM; Argo CD installs the `minio` chart 5.4.0
(standalone, one 200 GiB PVC, buckets `<prefix>-<key>` created at start) as
`http://xyne-minio.<namespace>.svc:9000`. The apps see provider `s3`, `S3_ENDPOINT` set, and the
credentials as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from their Secrets
(`staticCredentials: true`). Size it with `addon_values["minio"]`
(`persistence.size`, `persistence.storageClass`, `resources`).

### External S3-compatible storage

```hcl
storage_mode = "external"
external_storage = {
  provider = "s3"
  endpoint = "https://s3.internal.example.com"   # "" for the cloud's own S3
  region   = "ap-south-1"
  buckets = {
    main = "acme-xyne-main", docs = "acme-xyne-docs", canvas = "acme-xyne-canvas",
    recordings = "acme-xyne-recordings", workflows = "acme-xyne-workflows",
    transcription = "acme-xyne-transcription", bundles = "acme-xyne-bundles", claw = "acme-xyne-claw"
  }
}
storage_credentials = { access_key_id = "…", secret_access_key = "…" }
```

All eight names and both credentials are required. `provider = "gcs"` is accepted for an
existing set of Cloud Storage buckets on GCP, in which case the identities still need bucket IAM
you grant yourself. `provider = "azure"` is accepted for existing Blob containers; set `account`
to the storage account name so the apps get `AZURE_STORAGE_ACCOUNT`, or `endpoint` to the blob
endpoint, and grant the identities the container roles yourself. `storage_credentials` stay a
required input in `external` mode, but the Azure adapter does not read them.
