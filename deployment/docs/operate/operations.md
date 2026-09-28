# Operations

**Who this is for:** whoever runs an install after day one. Read it to upgrade, scale, back up,
rotate or tear down. When something is red, go to [troubleshooting](troubleshooting.md).

- [How changes are made](#how-changes-are-made)
- [Upgrading the application](#upgrading-the-application)
- [Upgrading addons, Argo CD and Kubernetes](#upgrading-addons-argo-cd-and-kubernetes)
- [Scaling](#scaling)
- [Rotating secrets](#rotating-secrets)
- [Backups](#backups)
- [Restoring](#restoring)
- [Certificates](#certificates)
- [Logs and metrics](#logs-and-metrics)
- [Argo CD access](#argo-cd-access)
- [Destroy](#destroy)

## How changes are made

Everything is declared in the environment directory and applied by `setup.sh`. Argo CD keeps the
cluster equal to what the root Application says (`prune` and `selfHeal` are on), so a
`kubectl edit` on a managed object is reverted within minutes. Change the tfvars, re-apply, and
let Argo CD converge:

```bash
deployment/scripts/setup.sh --env prod --only platform     # 02-platform: charts, apps, addons, secrets
deployment/scripts/setup.sh --env prod --only infra        # 01-infra: cloud resources
deployment/scripts/setup.sh --env prod                     # both, in order
```

Each run refreshes every Argo CD Application, stops any sync still pinned to an older commit, and
waits until everything is `Synced` and `Healthy`. Only `destroy.sh` deletes anything on purpose.

## Upgrading the application

Releases are `v<version>` tags; the matching `chart-<version>` tag carries the service charts,
whose `appVersion` is the image tag.

1. Pick the version:
   `git ls-remote --tags https://github.com/juspay/xyne-spaces.git 'chart-*' | sed 's|.*refs/tags/||' | sort -V | tail -n5`.
2. In `02-platform.tfvars`, set `chart_revision = "chart-<version>"` and
   `root_revision = "v<version>"`.
3. `deployment/scripts/setup.sh --env prod --only platform`.

Argo CD re-renders every Application from the new revisions and rolls the workloads. Database
migrations run as a hook before the backend and claw-auth roll. Watch with
`kubectl -n argocd get applications -w`.

Rolling back is setting the previous tags and re-applying; migrations are not rolled back, so take
a database backup first. With `image_registry` set, mirror the new images before changing the tag.

## Upgrading addons, Argo CD and Kubernetes

| Component | Default | Change it with |
|---|---|---|
| Istio (`base`, `istiod`, `gateway`) | 1.30.5 | `addon_values = { istio = "version: 1.31.0" }`; then restart the sidecars: `kubectl -n xyne-apps rollout restart deploy` |
| cert-manager | v1.21.2 | `addon_values = { certManager = "version: …" }` |
| aws-load-balancer-controller | 3.5.0 | `addon_values = { lbController = "version: …" }` |
| cluster-autoscaler (AWS) | 9.59.0 | `addon_values = { clusterAutoscaler = "version: …" }` |
| NVIDIA device plugin | 0.20.1 | `addon_values = { nvidiaDevicePlugin = "version: …" }` |
| CloudNativePG | 0.29.0 | `addon_values = { cnpg = "version: …" }` |
| MinIO | 5.4.0 | `addon_values = { minio = "version: …" }` |
| VictoriaMetrics, OpenTelemetry collector | 0.93.0, 0.173.1 | `addon_values = { monitoring = "victoriaMetrics: {version: …}" }` |
| Vespa | 8.754.14 | `addon_values = { vespa = "image: {tag: …}" }` |
| Hindsight | v0.10.1 | `addon_values = { hindsight = "targetRevision: …" }`; its bundled Postgres keeps its volume, so read upstream's notes first |
| Kata | 4.1.0 | `addon_values = { sandbox = "kata: {version: …}" }`; drain the sandbox pool first |
| Argo CD | chart 10.9.2, apps chart 2.0.5 | `argocd_chart_version`, `argocd_apps_chart_version`; Terraform runs the Helm upgrade with a 15-minute timeout |
| Kubernetes | per cloud | `kubernetes_version` (and `release_channel` on GCP, `automatic_upgrade_channel` on Azure), `--only infra` |
| EKS addons | latest compatible | `addon_versions` in `01-infra`, `--only infra` |

The defaults live in `deployment/argocd/root/values.yaml` at `root_revision`, so a new root
revision can move them. Istio upgrades go control plane first, then the sidecars restart.

## Scaling

| What | Where |
|---|---|
| Node pools | `node_pools.<pool>.{min_count, max_count}` in `01-infra.tfvars`, `--only infra`. The autoscaler works inside those bounds (GKE and AKS built in, the `cluster-autoscaler` addon on EKS); GKE counts per zone |
| App replicas | `apps.<chart>.values`: `autoscaling: {minReplicas, maxReplicas}` or `replicaCount`. Argo CD ignores replica drift so the HPA stays in charge |
| Workers | `workers[].values` (`replicaCount`, `resources`) |
| Resources | `apps.<chart>.values`: `resources.requests/limits` |
| Single-replica services | `xyne-zero-replication`, `xyne-ysweet`, `xyne-transcription-agent`, Redis, MinIO and the Vespa config server run one replica by design; scale them vertically |
| Managed Postgres | the tier or instance class, disk, `postgres_read_replica`; a tier change restarts the instance |
| Managed Redis | the memory size, node type or capacity |
| LiveKit | `livekit_min_replicas`, `livekit_max_replicas`, `livekit_target_cpu_utilization`, the machine size; [calls](../features/calls.md#changing-the-configuration-or-the-keys) covers rolling the VMs |
| Vespa | [search](../features/search.md#sizing) |

## Rotating secrets

Change the value in the secrets file and re-apply the stage that owns it. Argo CD restarts every
app whose Terraform-managed Secret changed. What is left to do by hand, and the values that need a
maintenance window, are in [secrets](../reference/secrets.md#rotation).

## Backups

| Component | What exists | Settings |
|---|---|---|
| Postgres, GCP | Cloud SQL daily backups and point-in-time recovery | `postgres_backup_start_time`, `postgres_backup_retention_count`, `postgres_transaction_log_retention_days` |
| Postgres, AWS | RDS automated backups and point-in-time recovery | `postgres_backup_window`, `postgres_backup_retention_days` |
| Postgres, Azure | Flexible Server backups | `postgres_backup_retention_days`, `postgres_geo_redundant_backup` |
| Postgres, in-cluster | CNPG scheduled backups and WAL archiving to object storage | `addon_values["cnpg"]` → `cluster.backup.*`; the `xyne-pg-backup` Secret is yours |
| Redis, AWS | ElastiCache snapshots | `redis_snapshot_window`, `redis_snapshot_retention_days` |
| Redis, elsewhere | none | Redis holds queues and caches; losing it loses in-flight jobs, not data |
| Object storage | none by default | `storage_versioning = true`, `storage_lifecycle_rules`; Azure soft delete (`storage_delete_retention_days`) |
| y-sweet documents, MinIO, Vespa | on persistent volumes | your storage class's snapshots |
| Terraform state | bucket versioning, on from `setup.sh` | |

Before an upgrade take a manual database backup:
`gcloud sql backups create --instance <instance>`,
`aws rds create-db-snapshot --db-instance-identifier xyne --db-snapshot-identifier pre-upgrade`, or
`az postgres flexible-server backup create --resource-group xyne --name <server> --backup-name pre-upgrade`.

## Restoring

Nothing is scripted. The sequence:

1. Stop writers: scale `xyne-backend`, `xyne-zero-replication` and the workers to 0.
2. Restore the database with the cloud's tooling. With a new instance, switch to
   `postgres_mode = "external"` pointing at it, or rename it into place.
3. Zero's replication slot and its `zero_cdb` / `zero_cvr` databases refer to the old timeline:
   drop the slot on the restored server, truncate those two databases, start
   `xyne-zero-replication` and let it re-replicate before starting `xyne-zero`.
4. Restore bucket objects if needed.
5. `setup.sh --env prod --only platform`, then scale back up.

Rehearse this on a non-production environment.

## Certificates

- **In `gateway` mode** browsers see `xyne-gateway-tls`, which cert-manager renews 30 days before
  expiry. `kubectl -n istio-ingress get certificate xyne-gateway-tls` shows its state; deleting the
  Secret forces a reissue.
- **In `cloud-lb` and `external` modes** browsers see the edge certificate; renewing it is the
  cloud's job or yours ([ingress](../concepts/ingress.md#certificates)).
- **LiveKit signalling**: GCP and ACM certificates renew themselves; on Azure import a new version
  into Key Vault (the Application Gateway follows the versionless id).
- **TURN**: replace the bundle in the secret store, then roll the LiveKit servers.

## Logs and metrics

Application logs go to stdout: `kubectl -n xyne-apps logs deploy/xyne-backend -f`. The cloud's
log product collects them when cluster logging is on. Istio access logs are on, in the
`istio-proxy` container of each pod. Metrics and Grafana: [monitoring](../features/monitoring.md).

## Argo CD access

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
kubectl -n argocd port-forward svc/argocd-server 8080:80        # http://localhost:8080, user admin
```

`argocd_expose = true` serves the UI at `argocd.<domain>` (or `argocd_host`) through the install's
gateway and certificate. That puts the login on the internet: change the admin password, or
configure SSO through `argocd_values`. Argo CD runs with `server.insecure=true` because TLS ends
at the gateway or the port-forward.

Useful commands:

```bash
kubectl -n argocd get applications
kubectl -n argocd get application xyne-backend -o jsonpath='{.status.conditions}'
kubectl -n argocd describe application platform-config | sed -n '/Status:/,$p'
```

The `argocd` CLI works against the port-forward: `argocd login localhost:8080 --username admin
--plaintext`, then `argocd app sync xyne-backend` or `argocd app diff xyne-backend`.

## Destroy

`destroy.sh` removes the overlay, then `02-platform`, then `01-infra`, and leaves the state bucket.

1. Allow deletion, then apply it:

   ```hcl
   # 01-infra.tfvars
   cluster_deletion_protection  = false   # GCP
   postgres_deletion_protection = false   # GCP, AWS
   storage_force_destroy        = true    # GCP, AWS: delete non-empty buckets
   ```

   `deployment/scripts/setup.sh --env prod --only infra`. `destroy.sh` warns about any of these
   that is not set, and if the cloud refuses it prints
   `destroy of 01-infra was refused by a deletion_protection setting` with these instructions.
2. `deployment/scripts/destroy.sh --env prod`, and type the environment name to confirm
   (`--auto-approve` skips the prompt). Deleting `02-platform` removes the root Application, whose
   finalizer deletes every child Application and their cloud load balancers before `01-infra` is
   destroyed.
3. Left behind: the state bucket, the DNS zone and records Terraform did not create, your
   kubeconfig context, cloud logs, and on Azure a soft-deleted Key Vault when LiveKit was on
   (`az keyvault purge`).

If the cluster is already gone, remove `02-platform`'s state objects with
`terraform -chdir=deployment/terraform/stacks/<cloud>/02-platform state rm <address>` and run
`destroy.sh` again.
