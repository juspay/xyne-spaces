# Security posture

What this tree does about the things infrastructure scanners look for, which
defaults are deliberate, and how to tighten the ones that are left to you.

- [Reaching the Kubernetes API](#reaching-the-kubernetes-api)
- [Outbound internet](#outbound-internet)
- [Object storage](#object-storage)
- [Encryption](#encryption)
- [Sandboxes](#sandboxes)
- [Workload hardening](#workload-hardening)
- [Secrets in the documentation](#secrets-in-the-documentation)
- [Running the scanners yourself](#running-the-scanners-yourself)
- [Accepted findings](#accepted-findings)

## Reaching the Kubernetes API

All three clouds follow the same rule: **the API server is private unless you
name the networks allowed to reach it.** There is no permissive default.

| Cloud | Variable | Effect when empty |
|---|---|---|
| GCP | `master_authorized_networks` | `enable_private_endpoint` becomes true; the control plane has no public endpoint |
| AWS | `eks_public_access_cidrs` | the public endpoint is switched off; only the VPC endpoint remains |
| Azure | `aks_authorized_ip_ranges` | `private_cluster_enabled` becomes true |

Set the variable and you get a public endpoint restricted to exactly those
ranges. Leave it empty and you get a private cluster, which means `setup.sh`
has to run from inside the network, normally through the bastion.

Each module also refuses to plan if it would end up with a public endpoint and
no ranges, so an open API server cannot be reached by accident.

Nodes are always private on all three clouds. That is not configurable.

## Outbound internet

On AWS there is no default outbound rule. `internet_egress_cidrs` names where
the nodes, the bastion and the LiveKit instances may reach, and the module
refuses to plan while it is empty.

For an ordinary install that is the whole internet, through NAT:

```hcl
internet_egress_cidrs = ["0.0.0.0/0"]
```

They do need somewhere to go. Container images come from registries outside the
cloud, the bastion installs `psql` and `redis-cli` from distribution
repositories, and the VPC endpoint set covers only `ecr.api`, `ecr.dkr`, `sts`
and `logs`, so every other AWS API call goes out the same way.

If you run an egress proxy or a filtering firewall, list its ranges here
instead and the security groups narrow to match. Whatever you choose is written
down in your tfvars rather than buried in a module default.

Inbound is restricted everywhere regardless: security groups and network
security groups admit only the ports each tier needs, from the ranges you
named.

GCP and Azure route egress through Cloud NAT and a NAT gateway respectively,
which are not expressed as security group rules.

## Object storage

Buckets are private on every cloud: uniform or bucket-level access only, public
access prevention enforced on GCP, `allow_nested_items_to_be_public = false` and
TLS 1.2 minimum on Azure, public access blocked on AWS.

The Azure storage account also denies network access by default. Only the
cluster, bastion and LiveKit subnets are allowed through, using the
`Microsoft.Storage` service endpoint those subnets carry. Containers are
created through the Resource Manager API rather than the data plane, so this
does not get in Terraform's way.

Anything reaching the blobs from outside the VNet needs its address added, a CI
runner that uploads dashboard bundles being the usual case:

```hcl
storage_allowed_ip_ranges = ["203.0.113.0/24"]
```

To take the account off the public internet entirely:

```hcl
storage_private_endpoint = true
```

The module refuses to plan if the default action is `Deny` with no subnet, no
address range and no private endpoint, because nothing would be able to read
the blobs.

## Encryption

Everything is encrypted at rest with the cloud's own keys by default. To use a
customer-managed key instead, supply one:

| What | Variable |
|---|---|
| EKS secrets, EBS volumes, RDS | `cluster_kms_key_arn`, `postgres_kms_key_arn` |
| GCP and Azure | managed by the platform; no CMEK knob is wired yet |

Supplying `cluster_kms_key_arn` also turns on EKS secrets envelope encryption,
which scanners flag as missing when it is absent. Nothing in this tree creates
a key for you.

In transit: Postgres requires TLS on GCP and Azure, Redis uses TLS and an auth
token, and the mesh runs `PeerAuthentication` in `STRICT` mode so pod-to-pod
traffic is mutually authenticated.

There is one deliberate exception. The Vespa config server and content nodes
run outside the mesh and read the feed and search containers' state over plain
HTTP on port 8080, so those two workloads get their own `PeerAuthentication`:
`STRICT`, with port 8080 `PERMISSIVE`. The backend and workers still reach them
over mTLS; only that one port also accepts plain traffic from inside the
cluster.

## Sandboxes

The sandbox addon runs code an agent wrote, so each sandbox is fenced in:

- **Egress only through the proxy.** The `sandbox-workspaces` NetworkPolicy lets
  a sandbox reach cluster DNS and `xyne-egress-proxy` on 3128, and nothing
  else: no internet, no other pod, no cloud metadata endpoint. The proxy only
  allows `CONNECT` to the hosts in its `squid.allowedHosts` list.
- **Only the router and claw connect in.** The same policy admits ingress from
  `xyne-sandbox-router` and `xyne-claw` only.
- **No cloud identity.** Sandboxes run as the `xyne-sandbox` ServiceAccount,
  which carries no cloud role and mounts no token.
- **Our policy, not the controller's.** The `SandboxTemplate` sets
  `networkPolicyManagement: Unmanaged` while `policy.enabled` is on. In the
  agent-sandbox controller's default `Managed` mode it adds its own policy that
  allows direct internet egress and rewrites pod DNS to public resolvers, which
  would bypass the proxy.

All of this depends on the CNI enforcing NetworkPolicy. GKE Dataplane V2 and
AKS with Cilium do. EKS does only when the VPC CNI's network policy agent is on,
so the AWS cluster module sets `enableNetworkPolicy` on the `vpc-cni` addon.

The workspace server inside a sandbox runs commands and reads and writes files
for claw by design. CodeQL flags that as command and path injection; those
alerts were dismissed as "won't fix", because the protection is the boundary
above, not the code. [claw-and-sandbox](../features/claw-and-sandbox.md#network-isolation)
has the checks that prove the fence holds.

## Workload hardening

Service charts built on `xyne-common` take a `securityContext` and
`podSecurityContext`. The ones this tree publishes set them where the image
allows. `xyne-tei-batch-proxy`, for example, runs as uid and gid 10001 with
`runAsNonRoot`, a read-only root filesystem, no privilege escalation, every
capability dropped and the `RuntimeDefault` seccomp profile; its image sets
`USER 10001:10001`.

## Secrets in the documentation

Every example value in the guides and the example environments is an obvious
placeholder beginning with `replace-with-`. None of them is a working
credential, and none should be copied into a real install.

[secrets](../reference/secrets.md) lists each secret and the command that
generates it. Terraform writes exactly what you give it and generates nothing,
so every value is yours to rotate and audit.

## Running the scanners yourself

```bash
gitleaks dir deployment --config .gitleaks.toml --no-banner
trivy fs --scanners misconfig deployment
```

Both run in CI. The Trivy job fails the build on `CRITICAL` findings and
reports everything else without blocking.

## Accepted findings

**None.** There is no Trivy ignore file and nothing is suppressed. The
`deployment/` tree scans clean at `CRITICAL`, which is the level the CI gate
fails on.

That is the bar to keep. If a new `CRITICAL` appears, fix it rather than
suppressing it. The pattern that removed the last of them was to delete the
permissive default and make the deployer name what is allowed, which is why
`eks_public_access_cidrs`, `internet_egress_cidrs`,
`master_authorized_networks` and `aks_authorized_ip_ranges` all start empty and
fail the plan with an explanation rather than quietly opening something.

One `HIGH` remains by design: EKS secrets envelope encryption is off until you
supply `cluster_kms_key_arn`, and nothing here creates a key for you.

Outside `deployment/`, the CodeQL alerts on the sandbox workspace server
(`claw-deployments/kata-infra/agent-workspace/src/main.ts`) are dismissed as
"won't fix": that server executes agent commands and file operations by design,
and is protected by the sandbox boundary described in [Sandboxes](#sandboxes).
