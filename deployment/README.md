# Deploying Xyne Spaces

**Who this is for:** an engineer who wants Xyne Spaces running in their own GCP, AWS or Azure
account under their own domain, and whoever maintains that install afterwards. Start here; every
other page is linked below.

- [What gets deployed](#what-gets-deployed)
- [How an install is built](#how-an-install-is-built)
- [Pick your path](#pick-your-path)
- [Documentation map](#documentation-map)
- [Two sources, one install](#two-sources-one-install)
- [Support and limits](#support-and-limits)

## What gets deployed

```
                      DNS: <domain>  *.<domain>  livekit.<domain>  turn.<domain>
                                 │                        │
 ┌───────────────────────────────┼────────────────────────┼─────────────────────────────┐
 │ cloud account                 │                        │                             │
 │  ┌────────────────────────────▼─────────────────┐  ┌───▼──────────────────────────┐  │
 │  │ private network                              │  │ LiveKit VM tier (optional)   │  │
 │  │  ┌─────────────────────────────────────────┐ │  │  TLS load balancer           │  │
 │  │  │ Kubernetes (GKE / EKS / AKS)            │ │  │  media servers, public IPs   │  │
 │  │  │  Istio gateway, TLS, Argo CD            │◄┼──┤  egress workers, private     │  │
 │  │  │  Xyne apps and workers                  │ │  └──────────────────────────────┘  │
 │  │  │  optional: agents and sandboxes,        │ │                                    │
 │  │  │    search, OCR, memory, monitoring      │ │                                    │
 │  │  └────┬───────────────┬───────────┬────────┘ │                                    │
 │  │   ┌───▼─────┐   ┌─────▼───┐  ┌────▼────────┐ │                                    │
 │  │   │Postgres │   │  Redis  │  │ 8 buckets   │ │                                    │
 │  │   └─────────┘   └─────────┘  └─────────────┘ │                                    │
 │  └──────────────────────────────────────────────┘                                    │
 │  Terraform state bucket · your DNS zone                                              │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

| Piece | Default | Created by |
|---|---|---|
| Network, NAT, private subnets | always | `01-infra` |
| Kubernetes cluster with a `general` node pool; optional `zero`, `vespa`, `sandbox` and (AWS) `gpu` pools | `general` only | `01-infra` |
| Postgres with logical replication, five databases, optional read replica | the cloud's managed service | `01-infra`, or CloudNativePG in the cluster, or a server you run |
| Redis | the cloud's managed service | `01-infra`, or in the cluster, or yours |
| Object storage: `main docs canvas recordings workflows transcription bundles claw` | managed buckets | `01-infra`, or MinIO in the cluster, or yours |
| A cloud identity per app, bound to its buckets | always | `01-infra` |
| LiveKit media servers on VMs | off | `01-infra` |
| Argo CD, namespaces, Kubernetes Secrets | always | `02-platform` |
| Istio, cert-manager, the gateway and its routes | always | Argo CD |
| Xyne apps: backend, dashboard, zero, zero-replication, ysweet, workers | on | Argo CD |
| Optional apps: claw, claw-auth, claw-auth-frontend, transcription-agent, lighton-ocr, lighton-model, dashboard-edge, dashboard-external | off | Argo CD |
| Optional stacks: Vespa search, Kata sandboxes, Hindsight, monitoring | off | Argo CD |

## How an install is built

An install is one environment directory (`env.conf`, `01-infra.tfvars`, `02-platform.tfvars` and
their secrets files) and one command, `deployment/scripts/setup.sh`, which runs three stages in
order:

| Stage | Tool | Creates |
|---|---|---|
| `01-infra` | Terraform | the cloud resources, and a contract of outputs every later stage reads |
| `02-platform` | Terraform | namespaces, Kubernetes Secrets, Argo CD and the root Argo CD Application |
| Argo CD | Argo CD | every addon and app, from the charts in this repository at a pinned revision |

After that, every change is an edit to the environment directory followed by `setup.sh` again,
and Argo CD keeps the cluster equal to git. [Architecture](docs/concepts/architecture.md) explains
the design.

## Pick your path

| You want to | Read |
|---|---|
| Install from scratch | [install/README.md](docs/install/README.md), then your cloud: [GCP](docs/install/gcp.md), [AWS](docs/install/aws.md), [Azure](docs/install/azure.md) |
| Turn on a feature | the feature guides under [docs/features](#documentation-map) |
| Upgrade, scale, back up, rotate, tear down | [operate/operations.md](docs/operate/operations.md) |
| Fix something that is red | [operate/troubleshooting.md](docs/operate/troubleshooting.md) |
| Look up a variable, a secret or a shape | [reference/configuration.md](docs/reference/configuration.md), [reference/secrets.md](docs/reference/secrets.md), [reference/contract.md](docs/reference/contract.md) |
| Change or extend this tree | [extending.md](docs/extending.md) |

What you need before an install (a billable account, permissions, a domain, quota, a Google
OAuth client) is listed in [install/README.md](docs/install/README.md#before-you-start); the
exact roles per cloud are on each cloud page.

## Documentation map

| Page | Read it when |
|---|---|
| [install/README.md](docs/install/README.md) | you install; the shared steps for every cloud |
| [install/gcp.md](docs/install/gcp.md), [install/aws.md](docs/install/aws.md), [install/azure.md](docs/install/azure.md) | the parts of the install specific to one cloud |
| [install/dns.md](docs/install/dns.md) | registering the domain, creating its zone, installs on subdomains |
| [features/claw-and-sandbox.md](docs/features/claw-and-sandbox.md) | agents, Kata sandboxes, the live preview |
| [features/search.md](docs/features/search.md) | Vespa search, the embedder, the ingestion worker |
| [features/calls.md](docs/features/calls.md) | LiveKit calls and transcription |
| [features/ocr.md](docs/features/ocr.md) | document OCR and the GPU pool |
| [features/memory.md](docs/features/memory.md) | Hindsight, claw's long-term memory |
| [features/monitoring.md](docs/features/monitoring.md) | metrics and Grafana |
| [features/data-services.md](docs/features/data-services.md) | in-cluster or external Postgres, Redis and storage |
| [operate/operations.md](docs/operate/operations.md) | upgrades, scaling, backups, restore, certificates, destroy |
| [operate/troubleshooting.md](docs/operate/troubleshooting.md) | something is red |
| [reference/configuration.md](docs/reference/configuration.md) | a variable's name, type, default or effect |
| [reference/secrets.md](docs/reference/secrets.md) | generating, placing and rotating secrets |
| [reference/contract.md](docs/reference/contract.md) | the shapes the layers exchange, sync waves |
| [concepts/architecture.md](docs/concepts/architecture.md) | how the layers fit together and why |
| [concepts/ingress.md](docs/concepts/ingress.md) | how traffic reaches the install and where TLS ends |
| [concepts/security.md](docs/concepts/security.md) | API access, egress, storage, encryption, sandboxes, scanner findings |
| [extending.md](docs/extending.md) | adding a cloud, a chart, an addon or an overlay; validation and CI |
| [../helm-charts/CHARTS.md](../helm-charts/CHARTS.md) | the service charts Argo CD installs |

If you change anything under `deployment/`, run `deployment/scripts/validate.sh` before opening a
pull request; CI runs the same script ([extending](docs/extending.md#validation)).

## Two sources, one install

This public tree is a complete install on its own. An organisation that needs private pieces
(its own SSO front door, extra services, internal DNS, custom Argo CD sources) keeps its
environment directory in a private repository and points the scripts at it with
`--env-dir <path>`. That directory may carry an `overlay/` Terraform module, applied after
`02-platform`, and `overlay_sources` in its `02-platform.tfvars`, rendered as additional Argo CD
Applications ([extending](docs/extending.md#using-overlays)). Nothing in this tree changes.

## Support and limits

- **Sign-in**: users sign in with a Google OAuth client you create; the backend does not start
  without one. Enterprise SSO in front of the install is yours to add.
- **Backups**: managed Postgres and Redis keep the backups you configure through variables;
  bucket versioning is a switch; in-cluster Postgres has scheduled backups. Restores are not
  scripted ([operations](docs/operate/operations.md#restoring)).
- **Regions**: one region, one cluster. Multi-region and cross-region failover are not covered.
- **GPUs**: only AWS has a GPU pool, so the OCR model server and the search embedder run on AWS
  only, or against endpoints you run elsewhere.
- **Sandboxes**: need hardware virtualization on the sandbox pool (`.metal` on AWS, nested
  virtualization on GCP and Azure) and a CNI that enforces NetworkPolicy.
- **Kubernetes versions**: whatever the stacks default to (`kubernetes_version` is a variable);
  there is no upgrade choreography beyond changing it.
