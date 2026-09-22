# Xyne Spaces Helm charts

One chart per service, all built on a shared library chart so every service ships the same
set of objects.

```
helm-charts/charts/
├── xyne-common/               library: every shared template lives here
├── xyne-backend/              API server
├── xyne-worker/               background workers (one install per worker role)
├── xyne-dashboard/            web app (nginx)
├── xyne-dashboard-external/   external/guest web app, served under /external
├── xyne-dashboard-edge/       bundle-serving edge proxy with routing rules
├── xyne-zero/                 Zero cache (view-syncer or replication-manager)
├── xyne-ysweet/               y-sweet collaboration server
├── xyne-claw/                 agent runtime
├── xyne-claw-auth/            agent auth service
├── xyne-claw-auth-frontend/   agent auth UI (nginx)
├── xyne-transcription-agent/  LiveKit transcription worker
├── xyne-lighton-ocr/          OCR server
├── xyne-vespa/                Vespa node - one install per role
├── xyne-vespa-embedder/       GPU text-embeddings-inference server
├── xyne-tei-batch-proxy/      batching proxy in front of the embedder
└── xyne-spaces/               umbrella: installs the above together
```

PostgreSQL, Redis, object storage, LiveKit and the Kata sandbox stack are not charted here;
point the services at your own through `env` / `secretEnv`.

## What every chart renders

| Object | Values key | Default |
|---|---|---|
| Deployment *or* StatefulSet | `workloadKind`, plus `replicaCount`, `strategy`, `resources`, probes, `securityContext`, ... | on |
| Service | `service` | on |
| ServiceAccount | `serviceAccount` | on, token not mounted |
| ConfigMap | `env` (plain key/values, loaded with `envFrom`) | on when `env` is set |
| HorizontalPodAutoscaler (`autoscaling/v2`) | `autoscaling` | per chart |
| PodDisruptionBudget (`policy/v1`) | `pdb` | per chart |
| Ingress | `ingress` | off |
| Istio VirtualService + DestinationRule | `istio` | off |
| NetworkPolicy | `networkPolicy` | off |
| ServiceMonitor | `serviceMonitor` | off |
| PersistentVolumeClaim *or* `volumeClaimTemplates` | `persistence` | off |
| anything else | `extraObjects` (rendered with `tpl`) | none |

A chart's `templates/all.yaml` is the single line `{{- include "xyne-common.all" . }}`; the
object set is defined once in the library. Service-specific objects (the edge rules ConfigMap,
the claw RBAC) sit next to it as ordinary templates.

Values files carry no comments; per-chart install notes are in [CHARTS.md](CHARTS.md).

### Conventions

- **Secrets are never created by the charts.** Reference them by name:
  `secretEnv: {ENV_NAME: {name: <secret>, key: <key>}}` for single keys, `envFromSecrets` for
  whole Secrets. Create them with kubectl, External Secrets, sealed-secrets - your call.
- **`fullname` defaults to the chart name**, not `<release>-<chart>`, so in-cluster URLs such
  as `http://xyne-backend` hold whatever the release is called. Install a chart twice in one
  namespace by giving the second install a `fullnameOverride`.
- **Image**: `image.registry` / `image.repository` / `image.tag`; the tag defaults to the
  chart `appVersion`. `global.imageRegistry` overrides the registry for a whole umbrella install.
- **Versioned workloads**: `versionedName: true` names the Deployment, ConfigMap, HPA and PDB
  `<name>-<version>` and adds `version` to their selectors, while the Service keeps selecting
  on `app` only. Pods always carry `app` and `version` labels, and the DestinationRule publishes
  a subset per version, which is what Istio traffic splitting keys off.
- **PDBs on single-replica workloads block node drains.** Charts that default to one replica
  ship with `pdb.enabled: false` or `maxUnavailable: 1`.
- **`workloadKind`** is `Deployment` (the default) or `StatefulSet`. On a StatefulSet the
  `statefulset` block adds `serviceName`, `podManagementPolicy`, `updateStrategy` and
  `persistentVolumeClaimRetentionPolicy`, and `persistence` renders a `volumeClaimTemplate`
  named `data` instead of a standalone PVC - same `mountPath`, same `existingClaim` escape
  hatch. `serviceName` defaults to the chart's own Service; set `service.clusterIP: None` on
  charts whose clients need per-pod DNS. Keep `versionedName: false` on StatefulSets:
  renaming the workload orphans its volumes.

## Install

```bash
# one service, straight from a release tag
git clone --branch chart-1.349.0 https://github.com/juspay/xyne-spaces.git
helm install xyne-backend xyne-spaces/helm-charts/charts/xyne-backend -n xyne -f my-values.yaml

# or from GHCR
helm install xyne-backend oci://ghcr.io/juspay/charts/xyne-backend --version 0.1.0-app.1.349.0 -n xyne

# everything
helm install xyne oci://ghcr.io/juspay/charts/xyne-spaces --version 0.1.0-app.1.349.0 -n xyne -f my-values.yaml
```

Layering value files (later files win) is how environment overrides are meant to be applied:

```bash
helm template xyne-backend helm-charts/charts/xyne-backend \
  -f infra-values.yaml \      # registry, resources, scheduling, Istio
  -f deployment-values.yaml   # env, secretEnv
```

## Versions and releases

Two numbers, like juspay/hyperswitch-helm:

- **Chart `version` on `main`** (`0.1.0`) is maintained by hand. Bump it when templates or
  defaults change.
- **Release versions** exist only on the `deployments` branch and its tags. A release stamps
  every chart as `<main version>-app.<app version>` and sets `appVersion` on the charts whose
  image is built from this repo.

Flow (`ci/` + `.github/workflows/`):

1. **Publish Images** (`publish-images.yml`) - run by someone on the `IMAGE_BUILDERS`
   allow-list, on a `vX.Y.Z` tag. Builds every image in `ci/images.json` and pushes
   `ghcr.io/<owner>/<image>:X.Y.Z` and `:sha-<commit>`.
2. **Sync Chart Version** (`sync-chart-version.yml`) - called by step 1 (or run on its own).
   Merges `main` into `deployments`, runs `ci/scripts/bump-chart.sh X.Y.Z origin/main`, vendors
   chart dependencies, commits, tags **`chart-X.Y.Z`**, pushes, and pushes the packaged charts
   to `oci://ghcr.io/<owner>/charts`. It refuses to run if an image for that version is missing
   or the tag already exists.
3. The private infra repo pins `chart-X.Y.Z`. Its deploy pipeline can start this whole flow
   with a `repository_dispatch` (`publish-images`, payload `{version_tag}`).

Setup needed once in the GitHub repo: the `IMAGE_BUILDERS` Actions variable, and - only if
`deployments` is a protected branch - a `CHART_RELEASE_TOKEN` secret allowed to push to it.

## Working on charts

```bash
ci/scripts/lint-charts.sh                 # lint + render every chart, defaults and all-features
ci/scripts/lint-charts.sh xyne-backend    # just one
OUT_DIR=/tmp/rendered ci/scripts/lint-charts.sh   # keep the rendered YAML
ci/scripts/bump-chart.sh 1.349.0          # what a release does to Chart.yaml (needs yq, jq)
```

Adding a service: copy an existing chart directory, change `Chart.yaml` and `values.yaml`,
keep `templates/all.yaml`, add it to `xyne-spaces/Chart.yaml`, `xyne-spaces/values.yaml`
and `ci/helm/umbrella-values.yaml`, and - if its image is built here - to `ci/images.json`.
The library dereferences every top-level values key, so keep the full key set even when a
feature is off.
