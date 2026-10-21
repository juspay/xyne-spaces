# AWS

The AWS-specific parts of the [install guide](README.md). Follow that page; it sends you here for
the account, the files and the checks that only exist on AWS.

- [What gets built](#what-gets-built)
- [Prepare the account](#prepare-the-account)
- [`env.conf`](#envconf)
- [`01-infra.tfvars`](#01-infratfvars)
- [DNS on AWS](#dns-on-aws)
- [Certificates](#certificates)
- [What setup does on AWS](#what-setup-does-on-aws)
- [The databases](#the-databases)
- [Reaching the cluster](#reaching-the-cluster)
- [LiveKit on AWS](#livekit-on-aws)
- [AWS checks](#aws-checks)
- [Cost](#cost)
- [Known limits](#known-limits)

Examples use account `210987654321`, region `ap-south-1` and office network `203.0.113.0/24`.

## What gets built

| Piece | AWS product |
|---|---|
| Network | VPC `10.10.0.0/16` across three AZs, a public and a private subnet per AZ, NAT gateways (one per AZ, or one with `single_nat_gateway`), interface endpoints for `ecr.api`, `ecr.dkr`, `sts`, `logs` |
| Cluster | EKS 1.35 with private nodes, a public endpoint limited to `eks_public_access_cidrs`, the `vpc-cni` (NetworkPolicy enforcement on), `kube-proxy`, `coredns`, `eks-pod-identity-agent`, `aws-ebs-csi-driver` and `metrics-server` addons, control-plane logs `api`, `audit`, `authenticator` kept 30 days, one managed node group per enabled pool (AL2023, `m6i.xlarge` 1 to 5 for `general`) |
| Postgres | RDS for PostgreSQL 16, `db.m6g.large`, Multi-AZ, 20 GB, backups 02:00–03:00 UTC kept 7 days, Performance Insights, `rds.logical_replication=1`, master user `xyne` |
| Redis | ElastiCache for Redis 7.1, `cache.m6g.large` with one replica, Multi-AZ, TLS and an AUTH token, encryption at rest, snapshots 01:00–02:00 kept 7 days |
| Object storage | eight S3 buckets `<account>-xyne-{main,docs,canvas,recordings,workflows,transcription,bundles,claw}`, CORS for `https://<domain>` |
| Identities | one IAM role per app, trusted through the cluster's OIDC provider (IRSA); roles for the load balancer controller, the cluster autoscaler and, with `dns_zone`, external-dns |
| Ingress | in the default `gateway` mode, a Network Load Balancer created from inside the cluster by `aws-load-balancer-controller` (IP targets, internet-facing, cross-zone); `cloud-lb` has Terraform build an NLB with Elastic IPs instead, `external` builds none |
| In-cluster extras on AWS | `aws-load-balancer-controller`, `cluster-autoscaler`, a default `gp3` StorageClass, and external-dns when `dns_zone` is set |
| Bastion (off by default) | one `t4g.micro` Amazon Linux 2023 instance in a public subnet, reached through SSM only, with `psql` and `redis-cli` |
| LiveKit (off by default) | two Auto Scaling groups, an ALB with an ACM certificate, an optional NLB for TURN, Secrets Manager secrets ([below](#livekit-on-aws)) |
| State | an S3 bucket with versioning, public access blocked, SSE-S3 |

Wall-clock time: 30 to 40 minutes for `01-infra` (EKS about 12, RDS Multi-AZ 15 to 20,
ElastiCache about 10, in parallel), 5 to 10 minutes for `02-platform`, 10 to 20 for Argo CD.

## Prepare the account

Install the AWS CLI v2 (`brew install awscli` on macOS; on Linux
`curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip -q awscliv2.zip && sudo ./aws/install`).
For SSM sessions to the bastion, also install the Session Manager plugin
(`brew install --cask session-manager-plugin`). Then sign in with an identity that has
`AdministratorAccess`, or the services listed in [Permissions](#permissions):

```bash
aws configure sso          # or: aws configure --profile acme-prod
aws sso login
aws sts get-caller-identity
```

Note the ARN it prints: the identity that applies `01-infra` becomes a cluster admin
automatically (`bootstrap_cluster_creator_admin_permissions`). Any other principal that needs
admin, such as a CI role, goes in `deployer_principal_arn`, which creates an EKS access entry with
`AmazonEKSClusterAdminPolicy`.

**IAM Identity Center sessions.** The CLI and Terraform renew SSO credentials by themselves until
the Identity Center session ends, 8 hours after `aws sso login` by default. A run that outlives it
fails with `InvalidGrantException`: run `aws sso login` again and rerun `setup.sh`, which resumes
from state. Administrators set the session length under *Settings → Authentication → Session
duration* (up to 90 days).

**Quotas a first install hits:**

```bash
aws service-quotas get-service-quota --service-code ec2 --quota-code L-0263D0A3 --query 'Quota.Value'   # Elastic IPs: three NAT gateways need three
aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A --query 'Quota.Value'   # On-Demand Standard vCPUs
aws service-quotas get-service-quota --service-code ec2 --quota-code L-DB2E81BA --query 'Quota.Value'   # G and VT vCPUs, for the GPU pool
```

The sandbox pool needs `.metal` instances and the GPU pool needs G-family instances; the doctor
checks both are offered in your region's zones.

### Permissions

`AdministratorAccess` is simplest. The least-privilege set: EC2, VPC, EKS, RDS, ElastiCache, S3,
IAM (roles, policies, the OIDC provider), Secrets Manager, ACM, Elastic Load Balancing, Auto
Scaling, CloudWatch Logs, SSM, and Route 53 on the hosted zone; KMS when you pass key ARNs.

## `env.conf`

```
CLOUD=aws
STATE_BUCKET=acme-xyne-tfstate
STATE_REGION=ap-south-1
STATE_PREFIX=xyne
PROFILE=
DNS_DOMAIN=example.com
```

`PROFILE` is optional: set it to a named profile, or leave it empty to use your current
credentials (check them with `aws sts get-caller-identity` first). When set, it is exported as
`AWS_PROFILE`, written into the generated `backend.tf`, and passed to `02-platform` so its
remote-state read uses it. `STATE_BUCKET` is created in `STATE_REGION` if missing. `DNS_DOMAIN` is only needed
when the install lives on a subdomain of a zone you share ([dns.md](dns.md)).

## `01-infra.tfvars`

```hcl
region = "ap-south-1"
name   = "xyne"
domain = "xyne.example.com"

namespace    = "xyne-apps"
dns_zone     = "Z08ACMEXYNE1234"
worker_names = ["default"]

eks_public_access_cidrs = ["203.0.113.0/24"]
internet_egress_cidrs   = ["0.0.0.0/0"]
single_nat_gateway      = false

postgres_mode = "managed"
redis_mode    = "managed"
storage_mode  = "managed"
```

The variables that only exist on AWS, or behave differently here:

| Variable | Meaning |
|---|---|
| `eks_public_access_cidrs` | who may reach the Kubernetes API. Empty removes the public endpoint, and then `kubectl` only works from inside the VPC |
| `internet_egress_cidrs` | where nodes, the bastion and the LiveKit VMs may connect outbound. **Required**; the plan fails while it is empty. `["0.0.0.0/0"]` is normal egress through NAT; list your proxy's ranges to filter it ([security](../concepts/security.md#outbound-internet)) |
| `single_nat_gateway` | one NAT gateway instead of one per AZ: cheaper, not zone-redundant |
| `deployer_principal_arn` | an extra IAM principal given cluster admin |
| `redis_auth` | the ElastiCache AUTH token; required with `redis_mode = "managed"`, written by `secrets.sh` |
| `external_dns_enabled` | default `true`; with `dns_zone` it lets external-dns write the application records |
| `sandbox_enabled`, `gpu_enabled`, `vespa_enabled`, `zero_pool_enabled` | the optional node pools; see the feature pages |

The [configuration reference](../reference/configuration.md#aws-01-infra) lists every variable.

## DNS on AWS

With `dns_zone` set to a Route 53 hosted zone id, nothing about DNS is manual:

- **the application records** (`domain` and `*.domain`) are written by external-dns from inside
  the cluster, because the NLB's hostname only exists after the gateway Service is created.
  external-dns runs with an IAM role limited to that zone;
- **the LiveKit records and certificate validation** are written by Terraform.

`dns.sh` can register a new domain in Route 53 and find or create the hosted zone:

```bash
deployment/scripts/dns.sh --env prod check      # availability and price of a new domain
deployment/scripts/dns.sh --env prod register   # buy it (asks you to type the domain)
deployment/scripts/dns.sh --env prod zone       # prints dns_zone = "Z…"
deployment/scripts/dns.sh --env prod status
```

After setup, the records appear a minute after the gateway gets its NLB:

```bash
dig +short xyne.example.com
kubectl -n external-dns logs deploy/external-dns
```

**Without `dns_zone`**, create the records yourself. The apex cannot be a CNAME, so use an alias:

```bash
NLB="$(kubectl -n istio-ingress get svc istio-ingressgateway -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
NLB_ZONE="$(aws elbv2 describe-load-balancers --query "LoadBalancers[?DNSName=='${NLB}'].CanonicalHostedZoneId" --output text)"
cat > /tmp/xyne-dns.json <<EOF
{"Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"xyne.example.com","Type":"A",
   "AliasTarget":{"HostedZoneId":"${NLB_ZONE}","DNSName":"${NLB}","EvaluateTargetHealth":false}}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"*.xyne.example.com","Type":"A",
   "AliasTarget":{"HostedZoneId":"${NLB_ZONE}","DNSName":"${NLB}","EvaluateTargetHealth":false}}}
]}
EOF
aws route53 change-resource-record-sets --hosted-zone-id <zone id> --change-batch file:///tmp/xyne-dns.json
```

At another DNS provider, make the apex an ALIAS/ANAME to `$NLB` and `*.xyne.example.com` a CNAME
to it.

With LiveKit on and `dns_zone` set, Terraform writes `livekit.<domain>` (to the ALB) and, with
`livekit_turn_cert_secret`, `turn.<domain>` (to the TURN NLB) as aliases. Without `dns_zone`, read
their targets from
`terraform -chdir=deployment/terraform/stacks/aws/01-infra output livekit_lb_dns_names`.

In `cloud-lb` mode Terraform builds the load balancer, so it writes the records itself and
external-dns is not installed; in `external` mode no record is written
([ingress](../concepts/ingress.md)).

## Certificates

- **The application**: cert-manager issues `xyne-gateway-tls` from Let's Encrypt once `domain`
  resolves to the NLB; `kubectl -n istio-ingress get certificate xyne-gateway-tls` shows
  `READY True` a minute or two later. In `cloud-lb` mode, the edge is a Network Load Balancer
  (an ALB has no static IP) whose TLS listener uses an ACM certificate: `ingress_certificate_arn`,
  or one Terraform requests for `ingress_certificate_domains` (default `domain` and `*.domain`)
  and validates in `dns_zone`.
- **LiveKit signalling** (`livekit.<domain>`, the ALB on 443) needs an ACM certificate:

  | Setting | Behaviour |
  |---|---|
  | `livekit_certificate_arn = "arn:aws:acm:…"` | that certificate as is |
  | `livekit_certificate_arn = ""`, `livekit_create_certificate = true` (default), `dns_zone` set | Terraform requests one for `livekit.<domain>` and validates it in Route 53 |
  | neither | `01-infra` fails with `livekit_certificate_arn is required when livekit_enabled is true, unless dns_zone is set …` |
- **TURN over TLS** is optional: store the PEM bundle in Secrets Manager and name it in
  `livekit_turn_cert_secret` ([calls](../features/calls.md#turn-over-tls)).

## What setup does on AWS

The steps in [step 10](README.md#10-run-the-setup), with the AWS specifics:

1. **State backend**: `aws s3api create-bucket` in `STATE_REGION` if missing, then versioning,
   the public-access block and default encryption.
2. **Ingress addresses**: in `cloud-lb` mode a targeted apply reserves the Elastic IPs and the run
   waits for DNS; in `external` mode it prints the names and waits; in `gateway` mode there is
   nothing to reserve (the NLB hostname comes from the cluster later) and it continues.
3. **01-infra**: a plan of roughly 150 resources.
4. **kubeconfig**: `aws eks update-kubeconfig --name xyne --region <region>`.
5. **Waiting for Argo CD**: `aws-load-balancer-controller` (wave -4), external-dns and the Istio
   control plane turn `Healthy` first; the gateway Service gets its NLB hostname a minute or two
   later. `platform-config` stays `Progressing` until the records resolve and the certificate is
   issued.
6. **Summary**: with `dns_zone` set it says external-dns keeps the apex and wildcard records in
   the hosted zone, pointing at the NLB hostname; without it, it lists the records to create.

## The databases

RDS creates only the `xyne` database and gives the master user no replication privilege.
`02-platform` fixes both before any app starts: the `xyne-db-init` Job, connected as `xyne` to
the `xyne` database, runs

```sql
GRANT rds_replication TO CURRENT_USER;
CREATE DATABASE xyne_common OWNER xyne;
CREATE DATABASE zero_cvr OWNER xyne;
CREATE DATABASE zero_cdb OWNER xyne;
CREATE DATABASE claw_auth OWNER xyne;
```

skipping databases that exist, and `setup.sh` waits for it. Nothing is manual. Until it has run,
`xyne-zero-replication` fails with `database "zero_cdb" does not exist` and then
`must be superuser or replication role to start walsender`.

With `postgres_mode = "external"`, or when the Job failed
(`kubectl -n xyne-apps logs job/xyne-db-init` says why), run the same statements yourself. From
inside the cluster:

```bash
DATABASE_URL="$(kubectl -n xyne-apps get secret xyne-backend-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)"
kubectl -n xyne-apps run psql --rm -it --restart=Never --image=postgres:16 \
  --overrides='{"metadata":{"annotations":{"sidecar.istio.io/inject":"false"}}}' \
  -- psql "$DATABASE_URL" \
  -c 'GRANT rds_replication TO xyne;' \
  -c 'CREATE DATABASE xyne_common OWNER xyne;' -c 'CREATE DATABASE zero_cvr OWNER xyne;' \
  -c 'CREATE DATABASE zero_cdb OWNER xyne;' -c 'CREATE DATABASE claw_auth OWNER xyne;'
```

or from the bastion (`bastion_enabled = true`, `psql` preinstalled):

```bash
terraform -chdir=deployment/terraform/stacks/aws/01-infra output -json postgres | jq -r .host
aws ssm start-session --target "$(terraform -chdir=deployment/terraform/stacks/aws/01-infra output -raw bastion_instance_id)"
psql "host=<the RDS endpoint> user=xyne dbname=xyne sslmode=require"
```

Then `kubectl -n xyne-apps rollout restart deploy/xyne-zero-replication deploy/xyne-zero deploy/xyne-backend`.

## Reaching the cluster

```bash
aws eks update-kubeconfig --name xyne --region ap-south-1
kubectl get nodes
```

works from any address in `eks_public_access_cidrs`, as the identity that applied `01-infra` or
`deployer_principal_arn`. Other principals need their own access entry
(`aws eks create-access-entry`, `associate-access-policy`). With `enable_private_endpoint = true`
the API is reachable only from the VPC: start an SSM session on the bastion
(`bastion_enabled = true`) and run `kubectl` there. Its image carries `aws` but not `kubectl`,
`helm` or `terraform`; install what you need.

## LiveKit on AWS

With `livekit_enabled = true` ([calls](../features/calls.md)), `01-infra` creates:

- Secrets Manager secrets `<name>/livekit/server-config` and `<name>/livekit/egress-config` with the
  rendered configuration, and an instance role that may read them;
- launch templates from the Ubuntu 24.04 image (`livekit_ami_ssm_parameter`) on `m6i.xlarge`
  (`livekit_instance_type`, `livekit_egress_instance_type`);
- the Auto Scaling group `xyne-livekit-server` in the public subnets (a public IP per instance,
  1 to 3 on 60% CPU, replaced when the ALB health check fails) and `xyne-livekit-egress` in the
  private subnets;
- security group rules for TCP 7880 from the ALB, TCP 7881, UDP 3478 and UDP 50000–60000;
- an ALB with the ACM certificate and an HTTP to HTTPS redirect, an NLB on 5349 when
  `livekit_turn_cert_secret` is set, and the Route 53 aliases with `dns_zone`.

`livekit_lb_dns_names` in the `01-infra` outputs carries the ALB and TURN NLB names. Each launch
template carries a hash of the rendered configuration, so a changed key or setting rolls the
groups through an instance refresh.

## AWS checks

After [step 11](README.md#11-check-the-install-and-sign-in):

```bash
kubectl -n kube-system get deploy aws-load-balancer-controller cluster-autoscaler
kubectl -n istio-ingress get svc istio-ingressgateway          # EXTERNAL-IP is the NLB hostname
aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus]' --output table
aws elasticache describe-replication-groups --query 'ReplicationGroups[].[ReplicationGroupId,Status]' --output table
aws s3 ls | grep -- -xyne-                                     # eight buckets
```

## Cost

Largest first, for the defaults: the `general` node group (`m6i.xlarge`, 1 to 5), RDS Multi-AZ
(two instances' worth), ElastiCache with a replica, three NAT gateways and their data processing
(`single_nat_gateway = true` for non-production), the EKS cluster fee, the NLB, four interface
endpoints, S3 by volume. Optional features add: `m5.metal` sandbox nodes (the most expensive line,
always at least one), GPU nodes (one per GPU workload), an `m6i.2xlarge` Vespa node, two
`m6i.xlarge` LiveKit VMs and an ALB. `postgres_read_replica` adds a third RDS instance; the
bastion is negligible.

## Known limits

- **ElastiCache AUTH needs TLS.** `redis_auth` is required and `redis_tls` must stay `true`.
- **The sandbox pool must be `.metal`**, x86_64, and offered in the region (`m5.metal` by default;
  `m5zn.metal` is not offered in ap-south-1). It is the only way to get hardware virtualization on
  EC2. `aws ec2 describe-instance-type-offerings --filters Name=instance-type,Values=<type>` lists
  where a type is offered. The node joins the cluster through
  `deployment/terraform/modules/aws/cluster/templates/sandbox-user-data.yaml.tftpl`, which uses
  `nodeadm` or `/etc/eks/bootstrap.sh`, whichever the image ships.
- **Application DNS is never Terraform's in `gateway` mode**: the NLB hostname only exists after
  the gateway Service is reconciled, so external-dns (with `dns_zone`) or you write the records.
- **GPU capacity is often short.** The GPU pool tries `g6.xlarge`, `g5.xlarge`, `g6e.xlarge` and
  `g4dn.xlarge` in that order and places each type only in zones that offer it.
- **The load balancer controller is required** in `gateway` mode; with
  `lb_controller_enabled = false` you must run it yourself.
- **Deletion protection** is on for RDS, and buckets are not force-destroyed; see
  [destroy](../operate/operations.md#destroy).
