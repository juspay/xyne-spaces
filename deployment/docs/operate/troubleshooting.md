# Troubleshooting

Find the symptom, run the check, apply the fix. Commands use the namespace `xyne-apps`; use your
`namespace`.

- [First look](#first-look)
- [Setup and Terraform](#setup-and-terraform)
- [Argo CD](#argo-cd)
- [Pods and scheduling](#pods-and-scheduling)
- [Ingress, DNS and certificates](#ingress-dns-and-certificates)
- [Database and Zero](#database-and-zero)
- [Redis and storage](#redis-and-storage)
- [Sign-in and secrets](#sign-in-and-secrets)
- [Calls (LiveKit)](#calls-livekit)
- [Search (Vespa)](#search-vespa)
- [OCR and GPUs](#ocr-and-gpus)
- [Sandboxes](#sandboxes)
- [Memory (Hindsight)](#memory-hindsight)

## First look

```bash
kubectl -n argocd get applications                     # which Application is not Synced/Healthy
kubectl -n argocd get application <name> -o json | jq '.status.operationState.message, [.status.resources[] | select(.status!="Synced" or .health.status!="Healthy") | {kind,name,status,health:.health.status}]'
kubectl -n xyne-apps get pods | grep -v Running
kubectl -n xyne-apps describe pod <pod> | tail -n 20   # events: scheduling, pulls, probes
kubectl -n xyne-apps logs <pod> --previous --tail=50   # why the last container exited
```

## Setup and Terraform

| Symptom | Cause | Fix |
|---|---|---|
| `doctor.sh` fails `placeholders in …` | an example value (`replace-with-…`) is still in a file | replace it; the row names the file and line |
| `02-platform` plan fails `workers <name> have no cloud identity` | a worker in `02-platform.tfvars` is missing from `worker_names` in `01-infra` | add it to `worker_names`, run `--only infra`, then `02-platform` |
| AWS plan fails `redis_auth is required when redis_mode is managed` | no ElastiCache token | run `secrets.sh --env <env>`, which appends what is missing |
| Azure plan fails `ssh_public_key is required` or `storage_account_name is required` | the bastion or LiveKit is on without a key; managed storage without an account name | set them |
| A run on AWS fails with `InvalidGrantException` | the IAM Identity Center session ended (8 hours by default) | `aws sso login`, rerun `setup.sh`; it resumes from state |
| `setup.sh` ends `N Application(s) still not Synced and Healthy after 1800s` | one Application is stuck; the table printed the reasons | fix it with the sections below, then `setup.sh --env <env> --only platform` to wait again |
| `setup.sh` shows a plan destroying `helm_release.argocd` | `argocd_namespace` or `argocd_chart_version` changed | usually intended; answer `N` if not |
| `Backend configuration changed` on `terraform init` | the state settings in `env.conf` changed after the first run | copy the state to the new key first if you moved it |
| CI's `validate.sh` fails `terraform fmt` | a `.tf` file is not formatted | `terraform fmt -recursive deployment/terraform` and commit the result |

## Argo CD

| Symptom | Cause | Fix |
|---|---|---|
| An Application stays `OutOfSync` or `Missing` for minutes | an earlier wave is not Healthy yet, or its sync failed and waits in retry backoff (10 attempts, 30 s to 10 min) | fix the earlier wave; `kubectl -n argocd annotate application <name> argocd.argoproj.io/refresh=hard --overwrite` retries now |
| `xyne-root` shows `Failed … Operation terminated` and never syncs the new commit | automated sync does not retry a commit whose sync failed | `setup.sh --env <env> --only platform` queues a fresh root sync |
| An Application keeps retrying a sync of an **old** spec after you pushed a fix | a sync operation started before your push keeps its retries | stop it: `kubectl -n argocd patch application <name> --type merge -p '{"status":{"operationState":{"phase":"Terminating"}}}'`; automated sync then applies the current spec |
| `xyne-root` `ComparisonError` mentioning `chart-…` | `chart_revision` or `root_revision` does not exist in `repo_url` | set an existing tag; `--only platform` |
| An Application is `OutOfSync` on a `StatefulSet` right after a healthy sync | the API server fills defaults into `volumeClaimTemplates`; the root chart ignores those fields for the apps it knows | add the same ignore rule (`xyne-root.statefulSetClaimIgnore`) to the new Application |
| `aws-load-balancer-controller` is always `OutOfSync` on its TLS Secret and webhooks | the chart generates a new webhook certificate on every render | handled by the root chart's `generatedCertIgnore`; if it returns, the ignore rule was dropped |
| A value set to `null` in the root chart has no effect | the Application carried values as `helm.valuesObject`, and server-side apply deletes `null` fields | the root chart passes values as a `helm.values` string; keep it that way |
| A pod did not restart after a Secret changed | nothing changed in its pod template | the root chart stamps `checksum/secrets` from the Terraform-managed Secrets it reads; a Secret you created yourself needs `kubectl rollout restart` |

## Pods and scheduling

| Symptom | Cause | Fix |
|---|---|---|
| `Pending` with `untolerated taint` or `didn't match node selector` | the pool the app is pinned to (`zero`, `vespa`, `sandbox`, `gpu`) is not enabled in `01-infra` | enable it and run `--only infra` |
| `Pending` with `Insufficient cpu/memory/nvidia.com/gpu` | the pool is at `max_count`, or the cloud quota is exhausted | raise `max_count`; check quota. On AWS the cluster autoscaler adds nodes within the bounds |
| A GPU pod stays `Pending` after an update while the old pod still runs | a rolling update starts the new pod before the old one frees the only GPU | GPU charts use `strategy: Recreate`; delete the old ReplicaSet to unblock a rollout already stuck |
| A StatefulSet pod stays on an old, failing revision after a fix | with ordered updates, a pod that is not Ready is never replaced | `kubectl -n xyne-apps delete pod <name>`; the volume stays and the pod comes back on the new revision |
| `Error` with exit code `137`, reason not `OOMKilled` | the liveness probe killed it | the container starts too slowly for its probes; give it a startup probe |
| The dashboard does not start in a namespace other than `xyne-apps` | the published dashboard image addresses `xyne-backend.xyne-apps` | use `namespace = "xyne-apps"` |

## Ingress, DNS and certificates

| Symptom | Cause | Fix |
|---|---|---|
| Certificate `READY False`, order pending | `domain` does not resolve to the gateway yet, or port 80 is not reachable (`http01`) | `dig +short <domain>`; fix the record; it retries |
| `too many certificates already issued` | Let's Encrypt rate limit after repeated recreations | wait, or point `certManager.server` at the staging URL while testing |
| Gateway Service has no `EXTERNAL-IP` (AWS) | `aws-load-balancer-controller` missing or without its role | `lb_controller_enabled = true`; check the ServiceAccount's `eks.amazonaws.com/role-arn` annotation |
| Records for `<domain>` never appear (AWS, `dns_zone` set) | external-dns off, without its role, or the zone id is not the one its policy allows | `kubectl -n external-dns logs deploy/external-dns` names every record it writes or refuses |
| Gateway `EXTERNAL-IP` pending (Azure) | the cluster identity lacks `Network Contributor` on the IP's resource group | re-apply `--only infra`; check with `az role assignment list --scope $(az group show -n xyne --query id -o tsv) -o table` |
| Gateway `EXTERNAL-IP` pending (GCP) | the reserved address is in another region than the cluster, or the in-use address quota is exhausted | `gcloud compute addresses describe xyne-ingress --region <region>` |
| Edge health check never passes (`cloud-lb`, `external`) | the check points at the traffic port instead of the status node port, or the status port is firewalled | check `GET /healthz/ready` on the status node port (30021 by default): `curl -s http://<node>:30021/healthz/ready`; only the VPC and the cloud's health-check ranges may reach it |
| Application Gateway backend unhealthy with a TLS error (Azure, `cloud-lb`) | Application Gateway v2 does not trust a backend certificate it has no root for | `ingress_tls = "existing"` with `ingress_backend_root_certificate_pem`, or `ingress_backend_protocol = "Http"` with `ingress_tls = "none"` ([ingress](../concepts/ingress.md#cloud-lb)); `az network application-gateway show-backend-health -g <rg> -n <name>` shows it |
| No `EXTERNAL-IP` in `cloud-lb` or `external` mode | nothing is wrong: the Service is a `NodePort` (internal on Azure) | use the `edge address` from the summary |
| Edge answers, every request `404` | the edge does not pass the client `Host` through | do not rewrite `Host` ([ingress](../concepts/ingress.md#checking-it-works)) |
| WebSockets drop after about a minute | the edge idle timeout is shorter than the connection | raise it on the edge |
| Certificate stuck after switching to `cloud-lb` or `external` | `ingress_tls` is still `acme` behind an edge that terminates TLS | leave `ingress_tls` empty so the mode picks |
| The site resets connections from one network but works from others | that network filters the domain | test from another network or from inside the cluster before changing anything |

## Database and Zero

| Symptom | Cause | Fix |
|---|---|---|
| `xyne-zero-replication` logs `must be superuser or replication role to start walsender` | the role lacks `REPLICATION` | managed Postgres: `kubectl -n xyne-apps logs job/xyne-db-init`; external: run the grant ([install](../install/README.md)) |
| `database "zero_cdb" does not exist` | the extra databases were not created | same Job; on external servers create them |
| `logical decoding requires wal_level >= logical` | an external server without logical WAL | set `wal_level=logical` |
| `replication slot … is active` after a restart | the previous pod still holds the slot | wait for it to terminate; if stuck, `SELECT pg_drop_replication_slot(...)` |

## Redis and storage

| Symptom | Cause | Fix |
|---|---|---|
| Backend TLS errors to Redis on GCP with `redis_tls = true` | the Memorystore CA is not given to the pods | `redis_tls = false` |
| `NOAUTH` or resets to Redis on AWS | AUTH needs TLS; `REDIS_URL` must be `rediss://` | keep `redis_tls = true` with `redis_auth`; re-run both stages |
| Backend `403` on bucket access | the workload identity annotation is missing, usually a `namespace` mismatch between the stages | make `namespace` equal in both; re-run both |
| A worker gets AWS `AccessDenied` although its role exists | the worker's ServiceAccount name does not match the role's trust (`xyne-worker-<name>`) | the root chart names workers `xyne-worker-<name>`; check `kubectl -n xyne-apps get sa` |
| `"STORAGE_PROVIDER" must be one of [gcs, local, s3, azure]` | `external_storage.provider` is something else | set `gcs`, `s3` or `azure` |
| Backend with `STORAGE_PROVIDER=azure` exits with `AzureStorageConfig needs accountName, endpoint or connectionString` | neither `AZURE_STORAGE_ACCOUNT` nor `AZURE_STORAGE_ENDPOINT` reached the pod | on `managed`, re-apply `01-infra` so `storage.account` is emitted; on `external`, set `external_storage.account` or `external_storage.endpoint` |

## Sign-in and secrets

| Symptom | Cause | Fix |
|---|---|---|
| The backend exits at start mentioning Google | `google_client_id` / `google_client_secret` missing | set them in `app_secrets` ([secrets](../reference/secrets.md#google-sign-in)) |
| An app still uses the old value after a rotation | it read the Secret before Terraform rewrote it | Argo CD rolls apps whose Terraform Secrets changed; otherwise `kubectl -n xyne-apps rollout restart deploy/<app>` |

## Calls (LiveKit)

| Symptom | Cause | Fix |
|---|---|---|
| "Failed to initiate call"; backend logs `api-key and api-secret must be set` | the backend has no LiveKit keys, or its pods started before the Secret had them | re-apply `02-platform`; the backend restarts on the Secret change |
| `https://livekit.<domain>` returns `502`/`503`, VMs replaced every few minutes | the LiveKit service fails at boot, so the load balancer health check fails | on a VM: `sudo journalctl -u livekit -n 100`, `sudo tail /var/log/cloud-init-output.log`; typical causes: config not fetched, Redis unreachable, bad key |
| Calls connect but no call-ended events reach the app | the server has no webhook, or VMs still run an old config | the config has a webhook to `https://<domain>/api/livekit/webhook`; replace the VMs ([calls](../features/calls.md#changing-the-configuration-or-the-keys)) |
| Clients get signalling but no media | UDP 50000 to 60000 or 3478 blocked between the client and the VMs | check the firewall rules; corporate networks need TURN over TLS |
| No transcripts | no speech-to-text provider or key | [calls](../features/calls.md#transcription) |

## Search (Vespa)

| Symptom | Cause | Fix |
|---|---|---|
| The app shows `Vespa search error: fetch failed` | Vespa is not deployed | [search](../features/search.md#turn-it-on) |
| Nothing is found although Vespa is healthy | no worker has `ENABLE_VESPA_WORKER`, so nothing is fed | add the ingestion worker |
| `xyne-vespa-app-deploy` keeps `waiting for services to converge`, containers at generation `-1` | the config server cannot read feed/search on 8080 through the mesh | the root chart adds a PeerAuthentication with 8080 `PERMISSIVE`; check it exists |
| `prepareandactivate` fails with an unknown host | feed/search pod names do not resolve | the `vespa-feed-hosts` / `vespa-search-hosts` headless Services must exist and be the StatefulSets' `serviceName` |
| Feed/search Services fail to sync: `clusterIP … may not change` | an override that should remove the chart's headless default was lost | values must reach Helm as a string ([Argo CD](#argo-cd)) |
| `vespa-content-0` never Ready | it got the config server's readiness probe after an override was lost | same cause; then delete the pod once |
| Embedder `Pending` with `Insufficient nvidia.com/gpu` | no free GPU: the pool is at its maximum | raise `node_pools.gpu.max_count`, or wait for capacity |
| Embedder stuck at `Starting Bert model on Cuda`, then restarted | first boot compiles GPU kernels; the probes killed it | the chart's startup probe allows 30 minutes; check it is there |

## OCR and GPUs

| Symptom | Cause | Fix |
|---|---|---|
| OCR requests hang, the OCR log shows `ocr_error attempt=1/3 elapsed=62s` | the model is slower than the client timeout, or emits garbage | run the capped model check in [ocr](../features/ocr.md#check-it-works) |
| The model answers `locklocklock…` (`finish_reason: length`) | fp16 on a GPU without bf16 | the chart uses float32 there; check `serving with --dtype` in the model server log |
| vLLM fails to import `PixtralRotaryEmbedding` | vLLM `v0.30.0` | keep `v0.29.0` |
| GPU node group fails with `InsufficientInstanceCapacity` | no capacity for that type in the region | the pool tries four types; extend `node_pools.gpu.instance_types` |
| A GPU instance type is not offered in a zone | not every zone has every type | the node groups use only zones that offer the type |

## Sandboxes

| Symptom | Cause | Fix |
|---|---|---|
| Sandboxes reach the internet directly, or the proxy name does not resolve | the template is in `Managed` mode, or the CNI enforces no NetworkPolicy | the template sets `Unmanaged`; on EKS the VPC CNI runs with `enableNetworkPolicy`; replace old sandboxes |
| Every lookup in a sandbox hangs | NodeLocal DNSCache | put its addresses in `policy.dns.cidrs` |
| A sandbox has AWS credentials | it runs as a ServiceAccount with a cloud role | sandboxes run as `xyne-sandbox`; delete sandboxes created before that |
| No sandbox template or warm pool exists | `template.image` resolves empty (no `image_tag`) | set `image_tag`, or `template.image` |
| The sandbox node never joins (AWS) | not a `.metal` type, or not offered in the zones | the doctor checks; pick another `.metal` type |
| `/claw-preview/…` shows the dashboard | the preview route is missing | it exists when both the sandbox addon and `xyne-claw` are on |

## Memory (Hindsight)

| Symptom | Cause | Fix |
|---|---|---|
| claw remembers nothing across sessions | no Hindsight configured | `enable_hindsight` or `hindsight.url` |
| `hindsight-api` exits at start | no `hindsight_llm_api_key` | set it; the doctor fails without it |
| Hindsight runs but stores no facts | wrong LLM provider, model or endpoint | `kubectl -n hindsight logs deploy/hindsight-api` |
