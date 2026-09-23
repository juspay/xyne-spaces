# Security posture

What this tree does about the things infrastructure scanners look for, which
defaults are deliberate, and how to tighten the ones that are left to you.

- [Reaching the Kubernetes API](#reaching-the-kubernetes-api)
- [Outbound internet](#outbound-internet)
- [Object storage](#object-storage)
- [Encryption](#encryption)
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

## Secrets in the documentation

Every example value in the guides and the example environments is an obvious
placeholder beginning with `replace-with-`. None of them is a working
credential, and none should be copied into a real install.

`deployment/docs/secrets.md` lists each secret and the command that generates
it. Terraform writes exactly what you give it and generates nothing, so every
value is yours to rotate and audit.

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
