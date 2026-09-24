# Operations

**Who this is for:** the person running an install after day one; read it when you upgrade,
scale, back up, rotate, tear down, or when something is red.

- [Working model](#working-model)
- [Upgrading the application](#upgrading-the-application)
- [Upgrading addons and Argo CD](#upgrading-addons-and-argo-cd)
- [Scaling](#scaling)
- [Backups](#backups)
- [Restore outline](#restore-outline)
- [Certificates](#certificates)
- [Observability](#observability)
- [Argo CD access](#argo-cd-access)
- [Destroy](#destroy)
- [Troubleshooting](#troubleshooting)

## Working model

Everything is declared in the environment directory and applied by `setup.sh`. Argo CD keeps the
cluster equal to what the root Application says (`prune` and `selfHeal` are on), so a change
made with `kubectl edit` on a managed object is reverted within minutes. Change the `.tfvars`,
re-apply, and let Argo CD converge:

```bash
deployment/scripts/setup.sh --env prod --only platform     # 02-platform only: chart versions, apps, addons, secrets
deployment/scripts/setup.sh --env prod --only infra        # 01-infra only: cloud resources
deployment/scripts/setup.sh --env prod                     # both, in order
```

`--only platform` and `--only overlay` also wait for every Application to be Synced and Healthy
and print the summary. Nothing in the scripts is destructive except `destroy.sh`.

## Upgrading the application

Releases are `chart-<version>` tags of this repository; each tag's charts carry the matching
image tag as `appVersion`.

1. Pick the tag: `git ls-remote --tags https://github.com/juspay/xyne-spaces.git 'chart-*' | sed 's|.*refs/tags/||' | sort -V | tail -n5`.
2. In `02-platform.tfvars`: `chart_revision = "chart-1.360.0"`.
3. `deployment/scripts/setup.sh --env prod --only platform`.

Terraform updates the root Application's `valuesObject` (`global.chartRevision`); Argo CD
re-renders every app Application from the new tag and rolls the Deployments. Database migrations
run inside the backend at start. Watch:

```bash
kubectl -n argocd get applications -w
kubectl -n xyne rollout status deployment/xyne-backend
```

Rolling back is setting the previous tag and re-applying. Migrations are not rolled back.

`root_revision` controls the root chart and the addon charts under `deployment/argocd/`; `main`
follows this tree. Pin it to a tag for change control, and move it deliberately: a new root
revision can add or remove Applications.

With `image_registry` / `image_tag` set, mirror the new images before changing the tag.

## Upgrading addons and Argo CD

| Component | Version lives in | Change it with |
|---|---|---|
| Istio (`base`, `istiod`, `gateway`) | `addons.istio.version` (1.30.5) | `addon_values = { istio = "version: 1.31.0" }` |
| cert-manager | `addons.certManager.version` (v1.21.2) | `addon_values = { certManager = "version: v1.22.0" }` |
| aws-load-balancer-controller | `addons.lbController.version` (3.5.0) | `addon_values = { lbController = "version: 3.6.0" }` |
| CloudNativePG operator | `addons.cnpg.version` (0.29.0) | `addon_values = { cnpg = "version: 0.30.0" }` |
| MinIO chart | `addons.minio.version` (5.4.0) | `addon_values = { minio = "version: 5.5.0" }` |
| VictoriaMetrics stack, OTEL collector | `addons.monitoring.victoriaMetrics.version` (0.93.0), `addons.monitoring.otelCollector.version` (0.173.1) | `addon_values = { monitoring = "victoriaMetrics: {version: 0.94.0}" }` |
| Hindsight | `addons.hindsight.targetRevision` (v0.10.1) | `addon_values = { hindsight = "..." }` for chart values. Bumping the revision moves the upstream chart and its images together; the bundled pgvector Postgres keeps its PVC, so check upstream release notes for schema changes before jumping versions |
| kata-deploy | `addons.sandbox.kata.version` (4.1.0), `addons.sandbox.kata.shim` (`qemu`) | `addon_values = { sandbox = "kata: {version: 4.2.0}" }`. Both `qemu` and `qemu-runtime-rs` are installed, so changing `shim` moves the workload in one edit; it repoints `defaultShim` and the `SandboxTemplate` together. Drain the sandbox pool first, since running sandboxes keep the old class, and read the Docker caveat in [configuration.md](configuration.md#recipes) before moving to the Rust runtime |
| Argo CD | `argocd_chart_version` (10.9.2), `argocd_apps_chart_version` (2.0.5) | the two `02-platform` variables |
| Kubernetes | `kubernetes_version` / `release_channel` / `automatic_upgrade_channel` in `01-infra` | `setup.sh --env prod --only infra` |
| EKS addons | `addon_versions` in `01-infra` | same |

The defaults are in `deployment/argocd/root/values.yaml` at `root_revision`; a new root
revision may move them. Istio upgrades follow Istio's own rules (control plane first, then
restart sidecars: `kubectl -n xyne rollout restart deployment`). Argo CD upgrades are a Helm
upgrade performed by Terraform with a 15-minute timeout.

## Scaling

| What | Where | Notes |
|---|---|---|
| Node pools | `node_pools.<pool>.{min_count, max_count}` in `01-infra.tfvars`, then `--only infra` | the cluster autoscaler works inside those bounds; GCP counts per zone |
| Backend, dashboard, zero, claw-auth, agent replicas | `apps.<chart>.values` with `autoscaling: {minReplicas, maxReplicas, targetCPUUtilizationPercentage}` or `replicaCount` + `autoscaling.enabled: false` | Argo CD ignores `spec.replicas` drift so the HPA stays in charge |
| Workers | `workers[].values` (`replicaCount`, `resources`) | one replica per role by default |
| Resources | `apps.<chart>.values` `resources.requests/limits` | |
| zero-replication, ysweet, claw, redis, vespa, minio | single replica by design; scale vertically | see [helm-charts/CHARTS.md](../../helm-charts/CHARTS.md) |
| Postgres (`managed`) | `postgres_tier` / `postgres_instance_class` / `postgres_sku_name`, disk size, `postgres_read_replica` | a tier change restarts the instance (RDS: at the maintenance window unless `postgres_apply_immediately`) |
| Postgres (`incluster`) | `addon_values["cnpg"]`: `cluster.instances`, `cluster.storage.size`, `cluster.pooler.instances` | volume growth needs a class with expansion |
| Redis (`managed`) | `redis_memory_size_gb` / `redis_node_type` / `redis_capacity` | |
| LiveKit | `livekit_min_replicas`, `livekit_max_replicas`, `livekit_target_cpu_utilization`, `livekit_egress_min_replicas`, `livekit_egress_max_replicas`, machine size | a changed template is rolled out by an instance refresh on AWS, and only to new instances on GCP (`OPPORTUNISTIC`) and Azure. The `livekit` systemd unit re-fetches its config from the secret store at every start, so a config or key change needs a restart of the instances: GCP `gcloud compute instance-groups managed rolling-action restart xyne-livekit-server --region asia-south1`, AWS `aws autoscaling start-instance-refresh --auto-scaling-group-name xyne-livekit-server`, Azure `az vmss restart --resource-group xyne --name xyne-livekit-server`; the same for `xyne-livekit-egress` |

## Backups

| Component | Mode | What exists | Knobs |
|---|---|---|---|
| Postgres | GCP `managed` | Cloud SQL automated backups + point-in-time recovery | `postgres_backup_start_time`, `postgres_backup_retention_count` (7), `postgres_transaction_log_retention_days` (7) |
| | AWS `managed` | RDS automated backups + PITR | `postgres_backup_window`, `postgres_backup_retention_days` (7) |
| | Azure `managed` | Flexible Server backups | `postgres_backup_retention_days` (7), `postgres_geo_redundant_backup` |
| | `incluster` | CNPG `ScheduledBackup xyne-pg-daily` to an S3-compatible object store, plus continuous WAL archiving | `addon_values["cnpg"]` → `cluster.backup.{enabled, destinationPath, endpointURL, credentialsSecret, schedule, retentionPolicy}`; the Secret named by `credentialsSecret` (`xyne-pg-backup`, keys `ACCESS_KEY_ID` / `ACCESS_SECRET_KEY`) is yours to create |
| Redis | AWS `managed` | ElastiCache snapshots | `redis_snapshot_window`, `redis_snapshot_retention_days` (7) |
| | GCP / Azure `managed`, `incluster` | none configured | Redis holds queues and caches; losing it loses in-flight jobs, not data |
| Object storage | `managed` | none by default | `storage_versioning = true` on all clouds; `storage_lifecycle_rules` to expire old versions; Azure has `storage_delete_retention_days` (7) soft delete |
| | `incluster` (MinIO) | none | back the PVC up with your storage class's snapshot mechanism |
| y-sweet documents | default | on the `xyne-ysweet` PVC | same as MinIO |
| Terraform state | all | bucket versioning, enabled by `setup.sh` | |

Take a manual backup before an upgrade: `gcloud sql backups create --instance xyne-…`,
`aws rds create-db-snapshot --db-instance-identifier xyne --db-snapshot-identifier pre-upgrade`,
`az postgres flexible-server backup create --resource-group xyne --name acme-xyne-pg --backup-name pre-upgrade`.

## Restore outline

Nothing here is scripted; the sequence is:

1. Stop writers: `kubectl -n xyne scale deployment/xyne-backend deployment/xyne-zero-replication --replicas=0` and the workers.
2. Restore the database with the cloud's tooling (restore to a new instance, or in place). With a
   new instance, switch to `postgres_mode = "external"` pointing at it, or rename it into place.
3. Zero's replication slot and its `zero_cdb` / `zero_cvr` state refer to the old timeline: drop
   the slot on the restored server and truncate those two databases, then start
   `xyne-zero-replication` first and let it re-replicate before starting `xyne-zero`.
4. Restore bucket objects (versioned restore or copy) if needed.
5. `setup.sh --env prod --only platform` to reconcile Secrets and URLs, then scale back up.

Rehearse this on a non-production environment before you need it.

## Certificates

- **Which certificate is which** depends on `ingress_mode`. In `gateway` mode the certificate
  below is the one browsers see. In `cloud-lb` and `external` mode browsers see the edge
  certificate you supplied, and `xyne-gateway-tls` is only the inner leg between the edge and
  the gateway. Renewing the edge one is the cloud's job or yours; see
  [ingress.md](ingress.md#certificates).
- **Application** (`xyne-gateway-tls`): cert-manager renews automatically 30 days before expiry.
  Check `kubectl -n istio-ingress get certificate xyne-gateway-tls` and
  `kubectl -n istio-ingress describe certificaterequest`. Forcing a reissue:
  `kubectl -n istio-ingress delete secret xyne-gateway-tls` (cert-manager recreates it; the
  gateway serves the old one until then, so do this only when needed).
- **LiveKit signalling**: GCP managed certificates renew themselves; AWS ACM certificates
  renew themselves while the validation record exists; Azure Key Vault certificates renew only
  if the vault has an issuer configured, otherwise import a new version and re-run
  `setup.sh --env prod --only infra` (the Application Gateway reads the versionless secret id,
  so a new version is picked up on the gateway's next refresh; pass the versionless id in
  `livekit_certificate_secret_id` to allow that).
- **TURN bundle**: replace the secret's value in the cloud store, then roll the LiveKit server
  group (commands in [Scaling](#scaling)).

## Observability

- `enable_monitoring = true` installs `victoria-metrics-k8s-stack` (release `vm`, namespace
  `monitoring`) and an OpenTelemetry collector (`otel-collector`, OTLP on 4317/4318) that
  forwards metrics to `http://vmsingle-vm.monitoring.svc:8428/opentelemetry`. Every app receives
  `ENABLE_OTEL_METRICS=true` and `OTEL_BASE_URL=http://otel-collector.monitoring.svc:4318`;
  y-sweet gets `Y_SWEET_OTEL_ENDPOINT=…/v1/metrics`.
- Grafana is part of the VictoriaMetrics stack chart. Find it with
  `kubectl -n monitoring get svc | grep -i grafana` and port-forward it; its admin credentials are
  in the Secret the chart creates (`kubectl -n monitoring get secret | grep -i grafana`).
  Configure it through `addon_values["monitoring"]` → `values.victoriaMetrics.grafana`.
- Application logs go to stdout: `kubectl -n xyne logs deployment/xyne-backend -f`. The clouds'
  log products collect them when `cluster_logging` (GCP, Azure) or the EKS log types are on.
- Istio access logs are on (`meshConfig.accessLogFile: /dev/stdout`): the `istio-proxy` container
  of any pod shows every request.

## Argo CD access

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
kubectl -n argocd port-forward svc/argocd-server 8080:80
# http://localhost:8080  user admin
```

Argo CD is installed with `server.insecure=true` behind the port-forward and is not exposed
through the gateway. To expose it, add a route with `addon_values["platformConfig"]`
(`routes.extra`) or an overlay, and configure SSO through `argocd_values`.

Useful commands:

```bash
kubectl -n argocd get applications
kubectl -n argocd get application xyne-backend -o jsonpath='{.status.conditions}'
kubectl -n argocd describe application platform-config | sed -n '/Status:/,$p'
```

The `argocd` CLI works against the port-forward: `argocd login localhost:8080 --username admin
--plaintext`, then `argocd app sync xyne-backend`, `argocd app diff xyne-backend`.

## Destroy

`destroy.sh` removes the overlay, then `02-platform`, then `01-infra`, and leaves the state
backend and your kubeconfig context in place.

1. Turn off deletion protection where the cloud has it, and allow bucket deletion:

   ```hcl
   # 01-infra.tfvars
   cluster_deletion_protection  = false   # GCP
   postgres_deletion_protection = false   # GCP, AWS
   storage_force_destroy        = true    # GCP, AWS: delete non-empty buckets
   ```

   then `deployment/scripts/setup.sh --env prod --only infra` so the flags reach the cloud.
   `destroy.sh` warns about any flag that is not `false` and, if the cloud refuses, prints
   `destroy of 01-infra was refused by a deletion_protection setting` with these instructions.
2. Run it:

   ```bash
   deployment/scripts/destroy.sh --env prod
   # This deletes every resource of environment prod on gcp, including databases and buckets with their data.
   # Type "prod" to continue:
   ```

   `--auto-approve` skips the prompt. Deleting `02-platform` removes the root Application; its
   finalizer cascades to every child Application, which delete their resources (including the
   gateway's cloud load balancer) before Terraform proceeds to `01-infra`.
3. What remains afterwards: the state bucket (delete it by hand when you are sure), the DNS
   zone and the records Terraform did not create, the kubeconfig context
   (`kubectl config delete-context …`), cloud logs, and on Azure a soft-deleted Key Vault if
   LiveKit was on (`az keyvault purge`).

If `02-platform` cannot reach the cluster any more (cluster already gone), remove its state
objects with `terraform -chdir=deployment/terraform/stacks/<cloud>/02-platform state rm` before
re-running.

## Troubleshooting

| Symptom | Reveal it with | Cause | Fix |
|---|---|---|---|
| Application `OutOfSync` for minutes, `Missing` resources | `kubectl -n argocd get application <name> -o jsonpath='{.status.operationState.message}'` | an earlier wave is not Healthy yet, or the sync failed and is in retry backoff (10 attempts, 30s→10m) | fix the earlier wave; `kubectl -n argocd annotate application <name> argocd.argoproj.io/refresh=hard --overwrite` to retry now |
| Application `Degraded` | `kubectl -n argocd get application <name> -o jsonpath='{.status.resources[?(@.health.status=="Degraded")].name}'` then `kubectl -n xyne describe pod <pod>` | a pod is crash-looping or unschedulable | read the pod events and logs below |
| `xyne-root` `ComparisonError` mentioning `chart-…` | `kubectl -n argocd get application xyne-root -o jsonpath='{.status.conditions}'` | `chart_revision` or `root_revision` does not exist in `repo_url` | set an existing tag; `--only platform` |
| Pods `Pending`, event `0/N nodes are available: … untolerated taint` | `kubectl -n xyne get pods --field-selector=status.phase=Pending` and `kubectl -n xyne describe pod <pod> \| tail -n 20` | the pool the app is pinned to (`zero`, `vespa`, `sandbox`) is disabled in `01-infra` while the root chart still selects it, or the pool is at `max_count` | enable the pool or raise `max_count`, `--only infra`; `zero` falls back to `general` only when `infra.nodePools.zero.enabled` is false in the contract |
| Pods `Pending`, `Insufficient cpu/memory` | same | pool at `max_count` or quota exhausted | raise `max_count`, check the cloud quota |
| `xyne-zero-replication` restarts, log `must be superuser or replication role to start walsender` | `kubectl -n xyne logs deployment/xyne-zero-replication --tail=50` | the one-time SQL was not run | run it (cloud guide step 11), restart the Deployment |
| `xyne-zero-replication` log `logical decoding requires wal_level >= logical` | same | `external` server without logical WAL, or a custom flag overrode it | set `wal_level=logical` on the server |
| `xyne-zero-replication` log `database "zero_cdb" does not exist` | same | AWS: the four extra databases were not created | run the `CREATE DATABASE` statements |
| `xyne-zero-replication` log `replication slot … is active` after a restart | same | the previous pod still holds the slot | wait for the old pod to terminate (`strategy: Recreate` ensures one at a time); if stuck, `SELECT pg_drop_replication_slot(...)` |
| Certificate not issued: `READY False`, order pending | `kubectl -n istio-ingress describe certificate xyne-gateway-tls`, `kubectl -n istio-ingress get order,challenge` | DNS for `<domain>` does not resolve to the gateway address, or port 80 is not reachable (http01) | fix the record (`dig +short <domain>`), wait for the challenge to retry |
| Certificate: `too many certificates already issued` | `kubectl -n istio-ingress describe challenge` | Let's Encrypt rate limit after repeated recreations | wait a week, or point `certManager.server` at the staging ACME URL through `addon_values["certManager"]` while testing |
| Gateway Service has no `EXTERNAL-IP` (AWS) | `kubectl -n istio-ingress describe svc istio-ingressgateway \| tail -n 15`, `kubectl -n kube-system logs deployment/aws-load-balancer-controller --tail=50` | `aws-load-balancer-controller` missing or its role lacks permissions (`lb_controller_enabled = false`, or `identities.lb_controller` empty so the addon defaulted off) | `lb_controller_enabled = true` in `01-infra`, `setup.sh --env prod`; check `kubectl -n kube-system get sa aws-load-balancer-controller -o yaml` shows the `eks.amazonaws.com/role-arn` annotation |
| DNS records for `<domain>` and `*.<domain>` never appear (AWS, `dns_zone` set) | `kubectl -n external-dns logs deploy/external-dns --tail=50`, `kubectl -n external-dns get sa external-dns -o yaml`, `kubectl -n istio-ingress get svc istio-ingressgateway -o jsonpath='{.metadata.annotations}'` | the `external-dns` Application is off (`external_dns_enabled = false`, or `dns_zone` empty so `identities.external_dns` is empty and the addon defaulted off), the service account is missing its `eks.amazonaws.com/role-arn` annotation, or the role's policy does not cover that hosted zone | `external_dns_enabled = true` and `dns_zone` set in `01-infra`, `setup.sh --env prod`; the logs name every record it creates or refuses, and `AccessDenied` there means the zone id in `dns_zone` is not the one the policy allows |
| Gateway Service `EXTERNAL-IP` pending (Azure) | `kubectl -n istio-ingress describe svc istio-ingressgateway \| tail -n 15` | the cluster identity lacks `Network Contributor` on the resource group holding `xyne-ingress`, or the pip name annotation points elsewhere | `01-infra` grants the role; re-apply `--only infra` and check `az role assignment list --scope $(az group show -n xyne --query id -o tsv) -o table` |
| Gateway Service `EXTERNAL-IP` pending (GCP) | same | the reserved address is in another region than the cluster, or in-use IP quota | `gcloud compute addresses describe xyne-ingress --region asia-south1` |
| Gateway Service has no `EXTERNAL-IP` in `cloud-lb` or `external` mode | `kubectl -n istio-ingress get svc istio-ingressgateway` | nothing is wrong: the Service is a `NodePort` (an internal `LoadBalancer` on Azure) and the public address belongs to the edge | read `edge address` in the `setup.sh` summary, or `terraform -chdir=deployment/terraform/stacks/<cloud>/01-infra output -json ingress` |
| Edge answers but every request is `404` | `kubectl -n istio-ingress logs deploy/istio-ingressgateway --tail=50` | the edge is not passing the client `Host` through, so no `Gateway` host matches | GCP and AWS preserve it; on Azure set `host_name` on the backend HTTP settings rather than `pick_host_name_from_backend_address`; on your own load balancer do not rewrite `Host` |
| Edge health check never passes in `cloud-lb` or `external` mode | GCP `gcloud compute backend-services get-health <name> --global`; AWS `aws elbv2 describe-target-health --target-group-arn …`; `curl -s http://<node>:30021/healthz/ready` | the check is pointed at the traffic port instead of the status node port, or the status port is firewalled | check `GET /healthz/ready` on the status node port (30021 by default), and that only the VPC and the cloud health-check ranges may reach it |
| WebSockets drop after about a minute (`/zero/`, `/ysweet/`) | browser console; `kubectl -n xyne logs deployment/xyne-zero --tail=50` | the edge idle timeout is shorter than the connection | raise it on the edge: GCP backend service `timeout_sec`, AWS NLB is fine by default, Azure `request_timeout`, HAProxy `timeout tunnel`, nginx `proxy_read_timeout` |
| Application Gateway backend unhealthy with a TLS error (Azure, `cloud-lb`) | `az network application-gateway show-backend-health -g <rg> -n <name>` | v2 will not trust a backend certificate it has no root for | supply the certificate yourself (`ingress_tls = "existing"` plus `ingress_backend_root_certificate_pem`), or set `ingress_backend_protocol = "Http"` with `ingress_tls = "none"`; see [ingress.md](ingress.md#cloud-lb) |
| Certificate stuck `READY False` after switching to `cloud-lb` or `external` | `kubectl -n istio-ingress describe certificate xyne-gateway-tls` | `ingress_tls` is still `acme`, and Let's Encrypt cannot reach port 80 through an edge that terminates TLS | leave `ingress_tls` empty so the mode picks `internal`, or supply your own with `existing` |
| Every name lookup inside a sandbox hangs | `kubectl -n xyne exec <sandbox> -- nslookup github.com`; `kubectl -n kube-system get ds node-local-dns` | the cluster runs NodeLocal DNSCache, which binds its addresses on each node, so DNS never reaches a kube-dns pod and the NetworkPolicy's pod selector rule does not match | add both addresses from its `-localip` flag (the link-local one and the kube-dns ClusterIP) to `policy.dns.cidrs` through `addon_values["sandbox"]` |
| claw runs but remembers nothing across sessions | `kubectl -n xyne get deploy xyne-claw -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="HINDSIGHT_URL")].value}'` | no Hindsight is configured, so the memory provider is disabled: an empty `HINDSIGHT_URL` makes every retain and recall a no-op | set `enable_hindsight = true` to deploy one, or `hindsight.url` to use an existing instance, then `setup.sh --env prod --only platform` |
| Hindsight is up but stores no facts | `kubectl -n hindsight logs deploy/hindsight-api --tail=50` | it has no LLM provider key, so extraction cannot run | set `app_secrets.hindsight_llm_api_key`, and the provider, model and base URL through `addon_values["hindsight"]` (`api.env`) |
| LiveKit clients connect to signalling but get no media / time out | `kubectl -n xyne logs deployment/xyne-transcription-agent --tail=50`; on a server VM `sudo journalctl -u livekit -n 100` | UDP `livekit_port_range_start`–`end` or 3478 blocked between clients and the instance public IPs; TURN not reachable | check the firewall rules (`gcloud compute firewall-rules describe xyne-livekit-allow-rtc`, the `xyne-livekit` security group, the `livekit` NSG); corporate networks need TURN/TLS (`livekit_turn_cert_secret`) |
| LiveKit signalling `502`/`503` | GCP `gcloud compute backend-services get-health xyne-livekit-signal --global`; AWS `aws elbv2 describe-target-health --target-group-arn …`; on the VM `sudo systemctl status livekit` | the container failed to start: bad config secret, image pull, Redis unreachable (in-cluster Redis, wrong AUTH, TLS mismatch) | `sudo journalctl -u livekit`; `redis_mode` must be `managed`/`external`; after fixing, roll the group |
| Backend cannot reach Redis on GCP with `redis_tls = true` | `kubectl -n xyne logs deployment/xyne-backend --tail=50` shows TLS errors | Memorystore's server CA is not trusted by the pods | set `redis_tls = false`, or distribute the CA yourself (`terraform output` does not expose it) |
| Backend cannot reach Redis on AWS: `NOAUTH` or connection reset | same | `redis_auth` and `redis_tls` mismatch: AUTH needs TLS; `REDIS_URL` must be `rediss://` | keep `redis_tls = true` with `redis_auth`; re-run both stages after changing either |
| Backend exits with `"STORAGE_PROVIDER" must be one of [gcs, local, s3, azure]` | `kubectl -n xyne logs deployment/xyne-backend --previous` | `external_storage.provider` is a value the application does not read | set it to `gcs`, `s3` or `azure` |
| Backend with `STORAGE_PROVIDER=azure` exits with `AzureStorageConfig needs accountName, endpoint or connectionString` | `kubectl -n xyne logs deployment/xyne-backend --previous` | neither `AZURE_STORAGE_ACCOUNT` nor `AZURE_STORAGE_ENDPOINT` reached the pod: the contract's `storage.account` and `storage.endpoint` are both empty | on `managed` re-apply `01-infra` so `storage.account` is emitted; on `external` set `external_storage.account` or `external_storage.endpoint` |
| Backend `403` on bucket access | same, plus `kubectl -n xyne get sa xyne-backend -o yaml` | workload identity annotation missing, usually a `namespace` mismatch between `01-infra` and `02-platform` (a worker name missing from `worker_names` has its own row, and `02-platform` now refuses it) | make `namespace` consistent; re-run both stages |
| `02-platform` plan fails: `workers <name> have no cloud identity` | the plan error names the worker and lists the bound service accounts | a `workers[].name` in `02-platform.tfvars` has no matching entry in `worker_names` of `01-infra`, so nothing bound `xyne-worker-<name>` to the worker identity | add the name to `worker_names` in `01-infra.tfvars` and `setup.sh --env prod --only infra`, then apply `02-platform`; without the check the worker starts and fails on object storage instead |
| `setup.sh` stops at `Apply the 02-platform plan above?` with a plan destroying `helm_release.argocd` | read the plan | `argocd_namespace` or `argocd_chart_version` changed | usually intended; answer `N` if not |
| `setup.sh` ends with `N Application(s) still not Synced and Healthy after 1800s` | `kubectl -n argocd get applications` | one Application is stuck (see rows above) | fix it; rerun `setup.sh --env prod --only platform` to wait again |
| `doctor.sh` `FAIL placeholders in …` | the row shows the line | an example value is still present | replace it |
| `terraform init` asks for backend migration / `Backend configuration changed` | the plan output | `env.conf` state values changed after the first run | `-reconfigure` is already passed; if you moved the state, copy it to the new key first |
| Azure `01-infra` fails with `ssh_public_key is required` | the plan error | bastion or LiveKit enabled without a key | set `ssh_public_key` |
| Azure `01-infra` fails with `storage_account_name is required when storage_mode is managed` | the plan error | `storage_mode = "managed"` without an account name | set `storage_account_name`; it is global and 3–24 lowercase letters and digits |
| AWS `01-infra` fails with `redis_auth is required when redis_mode is managed` | the plan error | | set `redis_auth` |
