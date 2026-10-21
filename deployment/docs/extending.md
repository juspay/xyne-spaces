# Extending the deployment

**Who this is for:** maintainers of this tree and organisations layering private pieces on top
of it; read it before adding a cloud, a service, an addon or an overlay.

- [Ground rules](#ground-rules)
- [Adding a cloud](#adding-a-cloud)
- [Adding an application chart](#adding-an-application-chart)
- [Adding an addon](#adding-an-addon)
- [Using overlays](#using-overlays)
- [Validation](#validation)
- [Continuous integration](#continuous-integration)

The shapes every layer exchanges are specified in [contract.md](reference/contract.md), the internal
interface reference. Change that file in the same commit as any change to a shape.

## Ground rules

- **One producer per fact.** The contract module resolves modes; the cloud module produces the
  managed resource; the platform module builds URLs and Secrets; the root chart builds app
  values. Do not duplicate a rule in a second place.
- **No comments in generated files.** Terraform, Helm values and templates under `deployment/`
  carry no comments; explanations live in these docs (and the `#cloud-config` first line of
  cloud-init files is the single exception). If something needs a comment, it needs a paragraph
  here instead.
- **No region names, product names or generated secrets in `.tf` files.** Regions are variables;
  every secret is a deployer input.
- **Public tree stays complete.** Nothing in `deployment/` may depend on a private repository.
  Private pieces go through overlays.

## Adding a cloud

A cloud is a new producer of the contract. The work, in order:

1. **Cloud modules** under `deployment/terraform/modules/<cloud>/`: `network`, `cluster`, `iam`,
   `postgres`, `redis`, `storage`, `bastion`, `livekit`. Each mirrors its siblings' inputs and
   outputs:
   - `cluster` outputs `name`, `location`/`region`, `endpoint`, `ca_certificate` and
     `node_pools` in the contract shape (`enabled`, `node_selector`, `tolerations` with the
     fixed taints `storage-type=local-ssd`, `pool=vespa`, `workload=sandbox`, and
     `nvidia.com/gpu=present` for a `gpu` pool);
   - `iam` outputs `identities` for the app identities (`backend`, `worker`, `dashboard_edge`,
     `ysweet`, `claw`, `claw_auth`, `transcription`, `zero`) with the annotations and labels the
     workload needs, bound to the fixed ServiceAccount names, plus the controller identities the
     cloud needs ([contract](reference/contract.md#identities));
   - the cluster's CNI must enforce NetworkPolicy, or the sandbox isolation is void;
   - `postgres` outputs `postgres` (`mode = "managed"`, `host`, `ro_host`, `direct_host`,
     `port`, `username`, `sslmode`, `databases`) with logical replication enabled;
   - `redis` outputs `redis` and `redis_auth`; `storage` outputs `storage` (provider `gcs`, `s3`
     or `azure`) and `storage_credentials`;
   - `livekit` calls `deployment/terraform/modules/livekit-config` for the YAML and keeps only
     the cloud-specific part: secret store write, instance template with the cloud-init from
     `templates/cloud-init.yaml.tftpl`, server and egress groups, firewall, TLS load balancer,
     DNS records; it outputs `livekit` and `livekit_keys`;
   - `ingress` is only needed for `ingress_mode = "cloud-lb"`: a public address, a load balancer
     that terminates TLS with a certificate the deployer supplies, and a backend reaching the
     Istio gateway. It outputs `ip` and, where the edge has a name rather than an address,
     `hostname`. Reading `ip` must not pull the rest of the load balancer into the graph, because
     `setup.sh` reserves the address with a targeted apply before the cluster exists. How the
     backend attaches is the cloud's business: node pool instance groups on GCP, Auto Scaling
     groups on AWS, an internal load balancer address on Azure. See [ingress.md](concepts/ingress.md).
2. **`01-infra` stack** under `deployment/terraform/stacks/<cloud>/01-infra/`: `variables.tf`
   (same names as the other clouds for everything cloud-neutral: `name`, `domain`, `dns_zone`,
   `namespace`, `worker_names`, `*_mode`, `postgres_*`, `redis_*`, `storage_*`, `external_*`,
   `livekit_*`, `ingress_*`, `node_pools`, `*_enabled`; `ingress_mode`, `ingress_tls`,
   `ingress_tls_secret`, `ingress_node_ports` and `ingress_external_traffic_policy` carry the
   same defaults on every cloud), `main.tf` calling `modules/contract` with
   `one(module.postgres[*].postgres)` and friends, `outputs.tf` with exactly the contract outputs
   (extra cloud-specific outputs are allowed and listed in reference/contract.md), `versions.tf`,
   `backend.tf.example`, `terraform.tfvars.example`. Cloud-only preconditions go in a
   `terraform_data "inputs"` block in the stack, as AWS and Azure do.
3. **`02-platform` stack** under `stacks/<cloud>/02-platform/`: `terraform_remote_state` for
   the new backend, the `kubernetes` and `helm` providers authenticated the cloud's way, the
   same application variables as the other clouds (copy `variables.tf` and change only the
   state/provider block), and the call to `modules/platform`. Add the cloud to the `cloud`
   validation in `deployment/terraform/modules/platform/variables.tf`.
4. **Scripts**: `deployment/scripts/lib.sh` needs a case for the cloud in `load_env` (required
   `env.conf` keys and exported credentials), `state_key_for`, `render_backend`,
   `bootstrap_backend_<cloud>`, `platform_var_args` and `fetch_kubeconfig`;
   `deployment/scripts/doctor.sh` needs its `check_tool` / `check_auth` case, and
   `script_supplied` must list the state variables the script passes.
5. **Root chart**: `global.cloud` is only consulted by `xyne-root.awsDefault` (load balancer
   controller and StorageClass). If the cloud needs an in-cluster controller for `LoadBalancer`
   Services or has no default StorageClass, add the equivalent toggle rather than a cloud check
   in every template.
6. **Example environment** `deployment/environments/example-<cloud>/` with `env.conf`,
   `01-infra.tfvars`, `02-platform.tfvars` using only placeholder values that `doctor.sh`'s
   placeholder check recognises (add new placeholder strings to `check_placeholders`).
7. **Guide** `deployment/docs/install/<cloud>.md` in the shape of the existing three, linked from
   step 2 of `deployment/docs/install/README.md`, and a row in every per-cloud table of
   `reference/configuration.md`, `concepts/architecture.md`, `operate/operations.md` and the
   feature guides.

## Adding an application chart

1. **Chart**: `helm-charts/charts/<chart>/` built on `xyne-common` (copy a sibling, keep
   `templates/all.yaml`, no comments in `values.yaml`). Register it in
   `helm-charts/charts/xyne-spaces/Chart.yaml` and `values.yaml` (the umbrella),
   `ci/helm/umbrella-values.yaml`, and `ci/images.json` if its image is built from this
   repository. Document it in `helm-charts/CHARTS.md`.
2. **Root chart** (`deployment/argocd/root`):
   - `values.yaml`: `apps.<chart>: {enabled: false, values: {}}`;
   - `templates/_helpers.tpl`: `define "xyne-root.appValues.<chart>"` that starts from
     `xyne-root.appBase` (image, pool, identity) and adds `env` / `secretEnv` from the shared
     helpers (`xyne-root.redisEnv`, `xyne-root.storageEnv`, `xyne-root.otelEnv`, …);
   - `templates/apps.yaml`: add the chart name to `$charts`;
   - if the app has a public route, add it to `deployment/argocd/addons/platform-config`
     (`routes.*`, `services.*`, `templates/virtualservice.yaml`) and wire the switch in
     `templates/platform-config.yaml`.
3. **Secrets**: if the app needs its own Secret, add it to `secret_names` and `secret_data` in
   `deployment/terraform/modules/platform/locals.tf`, the fields to `app_secrets` in
   `modules/platform/variables.tf` **and** every `stacks/*/02-platform/variables.tf`, and the
   tables in reference/contract.md and reference/secrets.md.
4. **Identity**: if it reads a bucket, add the identity to all three `modules/<cloud>/iam` with
   its ServiceAccount name and bucket grants, to the `identities` object in
   `modules/platform/variables.tf`, to `root_values.infra.identities` in `locals.tf`, and use
   `"identity" "<key>"` in the helper.
5. **Reference**: a row in reference/configuration.md's `apps.<chart>` table, and a feature guide
   under `deployment/docs/features/` when the app is an optional feature.

## Adding an addon

An addon is anything that is not a Xyne service: an operator, a data service, a policy object.

1. `deployment/argocd/root/values.yaml`: an `addons.<name>` block with `enabled`, the chart
   `version`, its `namespace`, the knobs you want to expose, and `values: {}` for pass-through.
2. `deployment/argocd/root/templates/<name>.yaml`: build the values with `xyne-root.merge`
   (base dict, then `.values`), then
   `include "xyne-root.application" (dict "root" $ "name" … "namespace" … "wave" … "source" (include "xyne-root.helmSource" …))`.
   Pick the wave from the table in reference/contract.md: -3/-2 for things the apps need, 1 for
   things the apps use at run time.
3. `templates/project.yaml`: add the addon's namespace to the `$namespaces` list so the
   AppProject may deploy there.
4. If the addon has its own Kubernetes objects rather than an upstream chart, put a small chart
   under `deployment/argocd/addons/<name>/` (as `platform-config`, `pg-cluster`, `sandbox`) and
   source it with `"path" "deployment/argocd/addons/<name>" "targetRevision" .Values.platformRevision`.
5. If Terraform should switch it, add `enable_<name>` to `modules/platform/variables.tf` and
   every `02-platform/variables.tf`, and a line in `addon_enabled` in `locals.tf`; `addon_values`
   already reaches any addon by name without code changes.
6. Document the block in reference/configuration.md's `addon_values` table.

## Using overlays

Two mechanisms, usable together, let an organisation add private pieces without touching this
tree.

### `overlay_sources` (Argo CD)

In `02-platform.tfvars`:

```hcl
overlay_sources = [
  {
    name            = "acme-sso-proxy"
    repo_url        = "https://github.com/example-org/xyne-private.git"
    target_revision = "main"
    path            = "argocd/sso-proxy"
    helm_values     = <<-YAML
      domain: xyne.example.com
    YAML
  },
]
```

Each entry becomes an Application in wave 2, project `xyne`, destination `namespace`, synced
automatically with prune and self-heal. `helm_values` non-empty means a Helm chart at `path`
with `releaseName = name`; empty means plain manifests. Private repositories need credentials in
Argo CD: pass `configs.repositories` / `configs.credentialTemplates` through `argocd_values`.

### `<env>/overlay/` (Terraform)

A Terraform module in the environment directory, applied by `setup.sh` after `02-platform` and
destroyed first by `destroy.sh`. It must declare:

```hcl
variable "infra" {
  type = any
}

variable "namespace" {
  type = string
}
```

`infra` is the complete `01-infra` output map (`cluster`, `postgres`, `redis`, `storage`,
`identities`, `node_pools`, `ingress`, `livekit`, plus the sensitive values and the cloud's
extra outputs), `namespace` the application namespace. `setup.sh` writes both into a temporary
`.tfvars.json` and adds `<env>/overlay.tfvars` when present. The overlay's `backend.tf` is
generated next to the stacks' from the same `backend.tf.example`, key `<STATE_PREFIX>/overlay`.
Provider configuration is the overlay's own; the usual pattern copies the provider block of the
cloud's `02-platform/main.tf` and reads `var.infra.cluster.endpoint` /
`var.infra.cluster.ca_certificate`.

Layout of a private environments repository:

```
environments/
└── prod/
    ├── env.conf
    ├── 01-infra.tfvars
    ├── 02-platform.tfvars        # may set overlay_sources
    ├── overlay.tfvars            # optional
    └── overlay/
        ├── main.tf               # variable "infra", variable "namespace", your resources
        └── versions.tf
```

Run with `deployment/scripts/setup.sh --env prod --env-dir /path/to/private/environments`.
`doctor.sh` checks `overlay.tfvars` for placeholders too.

## Validation

Everything under `deployment/`, with no cloud account and no cluster:

```bash
deployment/scripts/validate.sh                    # terraform fmt and validate, helm lint and template, bash -n
deployment/scripts/validate.sh --terraform-only
deployment/scripts/validate.sh --helm-only
```

It prints one line per check and exits non-zero if any failed. Export `TF_PLUGIN_CACHE_DIR` to
reuse provider downloads. Run it on a checkout without the `backend.tf` files `setup.sh`
generates next to the stacks: with them, `terraform init` reaches for the real state.

The Vespa application package chart is outside `deployment/`, so check it by hand:

```bash
helm lint vespa-core/vespa
helm template xyne-vespa-app vespa-core/vespa -n xyne-apps >/dev/null
```

Every Application with its wave, to compare with the table in
[reference/contract.md](reference/contract.md#sync-waves) after changing templates:

```bash
helm template xyne-root deployment/argocd/root -n argocd \
  --set global.cloud=aws --set infra.identities.lbController.annotations.x=y \
  --set addons.cnpg.enabled=true --set addons.redis.enabled=true --set addons.minio.enabled=true \
  --set addons.vespa.enabled=true --set addons.monitoring.enabled=true --set addons.sandbox.enabled=true \
  --set 'apps.workers[0].name=default' --set apps.xyne-claw.enabled=true --set apps.xyne-claw-auth.enabled=true \
  --set apps.xyne-claw-auth-frontend.enabled=true --set apps.xyne-transcription-agent.enabled=true \
  --set apps.xyne-lighton-ocr.enabled=true --set apps.xyne-dashboard-external.enabled=true \
  --set apps.xyne-dashboard-edge.enabled=true \
  | grep -E '^  name:|sync-wave' | paste - - | sort -k4 -n
```

The service charts:

```bash
ci/scripts/lint-charts.sh                 # lint + render every chart with defaults and ci/helm/all-features-values.yaml
ci/scripts/lint-charts.sh xyne-backend    # one chart
OUT_DIR=/tmp/rendered ci/scripts/lint-charts.sh   # keep the rendered YAML
```

The scripts:

```bash
deployment/scripts/doctor.sh --env example-gcp --dry-run
deployment/scripts/setup.sh --env example-aws --dry-run --skip-doctor
deployment/scripts/destroy.sh --env example-azure --dry-run
```

`--dry-run` prints every command the scripts would run, including the generated `backend.tf`,
without cloud credentials; use it to review a change to `lib.sh`.

## Continuous integration

| Workflow | Trigger | Runs |
|---|---|---|
| `.github/workflows/deployment-ci.yml` | pull requests touching `deployment/**` or the workflow | `deployment/scripts/validate.sh` |
| `.github/workflows/helm-charts-ci.yml` | pull requests touching `helm-charts/**`, `ci/helm/**`, `ci/scripts/bump-chart.sh` or the workflow | `ci/scripts/lint-charts.sh` on every chart, then a version-stamp dry run (`bump-chart.sh 0.0.0-ci.1`) and the lint again |
| `.github/workflows/publish-images.yml` | run by hand (inputs `image`, `version`, `sync_charts`) or a `publish-images` repository dispatch, by an allow-listed actor | builds every image in `ci/images.json`, or the one named, and pushes `ghcr.io/<owner>/<image>:<version>` |
| `.github/workflows/sync-chart-version.yml` | called by the above, by hand, or by repository dispatch | stamps the charts, tags `chart-<version>`, pushes packaged charts to `oci://ghcr.io/<owner>/charts` |
| `.github/workflows/rca-check.yml` | pull requests (opened, edited, synchronized, labelled) and the merge queue | a fix pull request (branch `fix/…`, title `fix:`, the Bugfix box, or the `bugfix` label) must have a `Root Cause` section of at least 150 characters |

An image built from this repository needs an entry in `ci/images.json` (`name`, `image`,
`dockerfile`, `context`, `charts`); the publish workflow picks it up with no other change.
