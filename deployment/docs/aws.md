# Deploying on AWS

**Who this is for:** an engineer with an AWS account, following this page top to bottom from an
empty account to the application open in a browser. Nothing is assumed beyond a payment method
and a domain you control.

- [What you will build](#what-you-will-build)
- [1. Prepare the account](#1-prepare-the-account)
- [2. Install the tools](#2-install-the-tools)
- [3. DNS: create a hosted zone or plan manual records](#3-dns-create-a-hosted-zone-or-plan-manual-records)
- [4. Copy the example environment](#4-copy-the-example-environment)
- [5. Fill `env.conf`](#5-fill-envconf)
- [6. Fill `01-infra.tfvars`](#6-fill-01-infratfvars)
- [7. Fill `02-platform.tfvars`](#7-fill-02-platformtfvars)
- [8. Generate the secrets](#8-generate-the-secrets)
- [9. Run the doctor](#9-run-the-doctor)
- [10. Run the setup](#10-run-the-setup)
- [11. One-time SQL](#11-one-time-sql)
- [12. DNS records](#12-dns-records)
- [13. TLS](#13-tls)
- [14. Reaching the cluster](#14-reaching-the-cluster)
- [15. First login](#15-first-login)
- [16. Verification checklist](#16-verification-checklist)
- [LiveKit on AWS](#livekit-on-aws)
- [Cost notes](#cost-notes)
- [Known limits](#known-limits)

Throughout, the example account is `210987654321`, the region `ap-south-1` (Mumbai), the domain
`xyne.example.com`, the office network `203.0.113.0/24`, the environment `prod`. Substitute your
own.

## What you will build

| Resource | AWS product | Name |
|---|---|---|
| Network | VPC `10.10.0.0/16` across three AZs, one public and one private subnet per AZ, one NAT gateway per AZ, interface endpoints for `ecr.api`, `ecr.dkr`, `sts`, `logs` | `xyne` |
| Cluster | EKS 1.35, private nodes, public endpoint restricted to `eks_public_access_cidrs`, addons `vpc-cni`, `kube-proxy`, `coredns`, `eks-pod-identity-agent`, `aws-ebs-csi-driver`, control-plane logs `api`, `audit`, `authenticator` (30 days), one managed node group per enabled pool (AL2023, `m6i.xlarge` 1–5 for `general`) | `xyne` |
| Postgres | RDS for PostgreSQL 16, `db.m6g.large`, Multi-AZ, 20 GB, backups 02:00–03:00 UTC kept 7 days, Performance Insights, `rds.logical_replication=1`, database `xyne`, master user `xyne` | `xyne` |
| Redis | ElastiCache for Redis 7.1, `cache.m6g.large`, 1 replica, Multi-AZ, in-transit TLS and AUTH token, at-rest encryption, snapshots 01:00–02:00 kept 7 days | `xyne` |
| Object storage | eight S3 buckets `210987654321-xyne-{main,docs,canvas,recordings,workflows,transcription,bundles,claw}`, CORS for `https://xyne.example.com` | |
| Identities | one IAM role per app trusting the cluster OIDC provider (IRSA); a role for the load balancer controller and, with `dns_zone`, one for external-dns | `xyne-backend` etc. |
| Ingress | an NLB created by `aws-load-balancer-controller` for the Istio gateway (`ip` targets, internet-facing, cross-zone), which is what `ingress_mode = "gateway"` builds; the other two modes have Terraform build an NLB with Elastic IPs instead, or no load balancer at all ([ingress.md](ingress.md#the-three-modes)) | `k8s-istioing-…` |
| DNS | LiveKit records from Terraform; the application records from external-dns in the cluster, or yours without `dns_zone` (step 12) | |
| LiveKit (off by default) | two Auto Scaling groups, an ALB with an ACM certificate, optional NLB for TURN, Secrets Manager secrets | `xyne-livekit-*` |
| Bastion (off by default) | one `t4g.micro` (Amazon Linux 2023) in a public subnet reachable through SSM only, `psql` and `redis-cli` installed | `xyne-bastion` |
| Hindsight (off by default) | claw's long-term memory: the upstream `vectorize-io/hindsight` Helm chart deployed into the cluster in its own namespace, bringing its own pgvector PostgreSQL; `hindsight.url` points claw at an instance you already run instead | `hindsight` |
| State | one S3 bucket with versioning, public access blocked, SSE-S3 | `acme-spaces-tfstate` |

Wall-clock time: 30–40 minutes for `01-infra` (EKS about 12, RDS Multi-AZ 15–20, ElastiCache
about 10, in parallel), 5–10 minutes for `02-platform`, 10–20 minutes for Argo CD.

## 1. Prepare the account

Log in with an identity that has `AdministratorAccess` (or the services listed in the
[prerequisites table](../README.md#cloud-permissions)):

```bash
aws configure --profile acme-prod          # access key, secret, region ap-south-1, output json
export AWS_PROFILE=acme-prod
aws sts get-caller-identity
# { "Account": "210987654321", "Arn": "arn:aws:iam::210987654321:user/alice", … }
```

Note the ARN: the identity that runs `terraform apply` becomes cluster admin automatically
(`bootstrap_cluster_creator_admin_permissions`). Any *other* principal that must administer the
cluster goes in `deployer_principal_arn`, which creates an EKS access entry with
`AmazonEKSClusterAdminPolicy`.

Quotas that a first install hits: Elastic IPs (three, one per NAT gateway; `single_nat_gateway
= true` needs one), `Running On-Demand Standard instances` vCPUs (the `general` pool alone is
4–20), and for the sandbox pool `.metal` capacity in the region. Check:

```bash
aws service-quotas get-service-quota --service-code ec2 --quota-code L-0263D0A3 --query 'Quota.Value'   # EIPs
aws service-quotas get-service-quota --service-code ec2 --quota-code L-1216C47A --query 'Quota.Value'   # On-Demand Standard vCPUs
```

## 2. Install the tools

macOS:

```bash
brew install hashicorp/tap/terraform helm kubectl jq yq awscli
```

Debian/Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates gnupg curl unzip jq
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip -q awscliv2.zip && sudo ./aws/install
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
curl -fsSLO "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && sudo install -m 0755 kubectl /usr/local/bin/kubectl
sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64 && sudo chmod +x /usr/local/bin/yq
```

For SSM sessions to the bastion, also install the Session Manager plugin
(`brew install --cask session-manager-plugin` on macOS). Docker and `openssl` are needed once,
in step 8. Confirm:

```bash
terraform version      # Terraform v1.6.0 or newer
helm version --short   # v3.14.0 or newer
aws sts get-caller-identity --query Arn --output text
```

## 3. DNS: create a hosted zone or plan manual records

The install needs `xyne.example.com`, `*.xyne.example.com`, and with LiveKit
`livekit.xyne.example.com` and `turn.xyne.example.com`.

**Option A, Route 53 (recommended):** Terraform then creates the LiveKit records and validates
the LiveKit ACM certificate on its own, and external-dns creates the application records from
inside the cluster once the gateway Service has its NLB hostname (step 12). Nothing about DNS
is manual. `dns.sh` needs `env.conf` and `domain` in `01-infra.tfvars` (steps 4 to 6), so
write those first and come back here.

```bash
deployment/scripts/dns.sh --env prod check      # a new domain: is it free, what it costs
deployment/scripts/dns.sh --env prod register   # a new domain: register it with Route 53
deployment/scripts/dns.sh --env prod zone       # create or find the hosted zone
# set in 01-infra.tfvars:
#   dns_zone = "Z08ACMEXYNE1234"
deployment/scripts/dns.sh --env prod status     # delegation matches the zone
```

For a domain registered elsewhere, `zone` prints the name servers to set at your registrar. Set
`DNS_DOMAIN` in `env.conf` to run the install on a subdomain of a zone you share. See
[dns.md](dns.md).

**Option B, DNS elsewhere:** `dns_zone = ""`. LiveKit then needs a certificate you issue
yourself (`livekit_certificate_arn`), see [TLS](#13-tls).

`ingress_mode` decides which address the application records point at, and `setup.sh` now settles
that before the network and the cluster are built. In `cloud-lb` mode it reserves the Elastic IPs,
prints the records and waits there, so they can be created and propagate while the slow part of
the build runs; in `external` mode it prints the names and waits without reserving anything. In
`gateway` mode there is nothing to reserve, because the NLB hostname comes from the cluster
(step 12), so the stage says so and continues. See
[ingress.md](ingress.md#addresses-and-dns-come-first).

## 4. Copy the example environment

```bash
cd xyne-spaces
cp -r deployment/environments/example-aws deployment/environments/prod
ls deployment/environments/prod
# 01-infra.tfvars  02-platform.tfvars  env.conf
```

`deployment/environments/.gitignore` ignores everything except `example-*/`; `prod/` is never
committed.

## 5. Fill `env.conf`

Only `KEY=VALUE` lines, no quotes, no spaces. `STATE_BUCKET` is created in `STATE_REGION` if
missing. `PROFILE` is optional: when set it is exported as `AWS_PROFILE`, written into the
generated `backend.tf` and passed to `02-platform` so the remote-state read uses it; leave the
value empty to use the ambient credentials. `STATE_PREFIX` separates environments in one
bucket.

`deployment/environments/prod/env.conf`:

```
CLOUD=aws
STATE_BUCKET=acme-spaces-tfstate
STATE_REGION=ap-south-1
STATE_PREFIX=xyne
PROFILE=acme-prod
```

## 6. Fill `01-infra.tfvars`

Required (no default): `region`, `domain`, `postgres_password`. The AWS stack additionally
requires `redis_auth` whenever `redis_mode = "managed"`, because the ElastiCache AUTH token is
an input. The rest below is the recommended first-install shape; the
[configuration reference](configuration.md#aws-01-infra) lists every variable.

- `region`: everything is created here, across `az_count` (3) availability zones.
- `name`: prefix of every resource and the cluster name.
- `domain`: the apex the application is served under.
- `dns_zone`: the Route 53 hosted zone id from step 3, or `""`.
- `external_dns_enabled`: default `true`. With `dns_zone` set and `ingress_mode = "gateway"` it
  gives external-dns an IRSA role over that hosted zone, and external-dns then creates the
  application records (step 12). Set it to `false` to keep the records manual. It does nothing
  when `dns_zone` is `""`, or in the other two ingress modes.
- `ingress_mode`: what sits in front of the Istio gateway. `gateway`, the default, lets the load
  balancer controller give the gateway Service an NLB and terminates TLS on the gateway with
  cert-manager, which is everything this page describes. `cloud-lb` has Terraform build a Network
  Load Balancer with Elastic IPs and a TLS listener that terminates TLS with a certificate you
  supply and re-encrypts to the gateway's node port; it is an NLB and not an ALB because an ALB
  has no static IP. `external` builds no load balancer at all and leaves the gateway on fixed node
  ports for one you run yourself. See [ingress.md](ingress.md#the-three-modes).
  - in `cloud-lb` mode the edge certificate is yours: `ingress_certificate_arn` when it already
    exists in ACM, or, with `dns_zone` set and no ARN, one Terraform requests for
    `ingress_certificate_domains` and validates with a Route 53 record.
- `worker_names`: one per worker role in `02-platform.tfvars`; each becomes an IRSA trust for
  ServiceAccount `xyne-worker-<name>`. `02-platform` refuses to apply when a worker there has no
  matching name here.
- `eks_public_access_cidrs`: who may reach the Kubernetes API over the internet. There is no
  default. Leave it empty and the API server has no public endpoint at all, so `kubectl` only
  works from inside the VPC through the bastion.
- `internet_egress_cidrs`: where the nodes, the bastion and the LiveKit instances may reach
  outbound. There is no default and the plan fails while it is empty, because nothing could pull
  an image. `["0.0.0.0/0"]` is ordinary egress through NAT; narrow it to your proxy's ranges if
  you filter egress. See [security.md](security.md#outbound-internet).
- `deployer_principal_arn`: an extra IAM principal (a CI role, a colleague) that gets cluster
  admin through an access entry. `""` if the applying identity is the only admin.
- `zero_pool_enabled`, `vespa_enabled`, `sandbox_enabled`: extra node groups; off to start.
  The sandbox group must be a `.metal` instance type.
- `bastion_enabled`: an SSM-only VM with `psql` and `redis-cli`; useful for step 11.
- `postgres_password`: at least 16 characters, master password of the `xyne` user. RDS refuses
  `/`, `@`, `"` and spaces.
- `redis_auth`: the ElastiCache AUTH token: 16–128 printable characters excluding `/`, `@`, `"`.
- `postgres_read_replica`: a read replica behind `DATABASE_READ_REPLICA_POOL_URL`; off to start.
- `livekit_*`: off until DNS is in place; see [LiveKit on AWS](#livekit-on-aws).

`deployment/environments/prod/01-infra.tfvars`:

```hcl
region = "ap-south-1"
name   = "xyne"
domain = "xyne.example.com"

dns_zone     = "Z08ACMEXYNE1234"
worker_names = ["default"]

eks_public_access_cidrs = ["203.0.113.0/24"]
internet_egress_cidrs   = ["0.0.0.0/0"]
deployer_principal_arn  = "arn:aws:iam::210987654321:role/platform-deployer"

zero_pool_enabled = false
vespa_enabled     = false
sandbox_enabled   = false
bastion_enabled   = true

postgres_mode         = "managed"
postgres_password     = "replace-with-24-or-more-random-characters"
postgres_read_replica = false

redis_mode = "managed"
redis_auth = "replace-with-24-or-more-random-characters"

storage_mode = "managed"

livekit_enabled    = false
livekit_api_key    = "replace-with-key-from-livekit-generate-keys"
livekit_api_secret = "replace-with-secret-from-livekit-generate-keys"
```

## 7. Fill `02-platform.tfvars`

Required: `region`, `chart_revision`, `app_secrets`. `state_bucket`, `state_key`, `state_region`
and `profile` are passed by `setup.sh` from `env.conf`.

- `namespace`: must match `namespace` in `01-infra.tfvars` (both default `xyne`).
- `domain`: repeat the apex, or `""` to take it from the `01-infra` outputs.
- `chart_revision`: the `chart-<version>` tag whose charts Argo CD installs;
  `git ls-remote --tags https://github.com/juspay/xyne-spaces.git 'chart-*' | sed 's|.*refs/tags/||' | sort -V | tail -n1`.
- `root_revision`: branch or tag the root chart is rendered from (`main`, or pin to a tag).
- `image_registry`, `image_tag`: empty pulls `ghcr.io/juspay/*` at the chart `appVersion`.
- `acme_email`: contact address for the Let's Encrypt account.
- `enable_vespa`, `enable_monitoring`, `enable_sandbox`: optional addons; off to start.
- `enable_hindsight`: deploy Hindsight, claw's long-term memory, from the upstream chart into its
  own `hindsight` namespace; off to start. Claw is pointed at
  `http://hindsight-api.hindsight:8888` for you.
  - The chart brings its own pgvector PostgreSQL, separate from the Postgres the rest of the
    install uses. Point it at a database of yours through `addon_values["hindsight"]`
    (`postgresql.enabled`, `postgresql.external.*`). The bundled database's default password is
    the literal `hindsight`, so change it if you keep the bundled one.
  - The LLM provider, model and base URL Hindsight extracts facts with are chart values as well:
    `api.env.HINDSIGHT_API_LLM_PROVIDER`, `api.env.HINDSIGHT_API_LLM_MODEL` and
    `api.env.HINDSIGHT_API_LLM_BASE_URL` in `addon_values["hindsight"]`.
- `hindsight`: the `url` and `tenant` of a Hindsight you already run elsewhere. A non-empty `url`
  always wins over the deployed addon. With neither set, claw's long-term memory is off, which is
  the default.
- `apps`: per-chart switches and value overrides.
- `workers`: one per role; `name` must be in `worker_names`. The `env` flags choose the role.
- `app_secrets`: generated in step 8.

`deployment/environments/prod/02-platform.tfvars`:

```hcl
region       = "ap-south-1"
state_bucket = "acme-spaces-tfstate"
state_key    = "xyne/01-infra/terraform.tfstate"

namespace      = "xyne"
domain         = "xyne.example.com"
chart_revision = "chart-1.356.0"
root_revision  = "main"
image_registry = ""
image_tag      = ""
acme_email     = "ops@example.com"

enable_vespa      = false
enable_monitoring = false
enable_sandbox    = false
enable_hindsight  = false

hindsight = {
  url    = ""
  tenant = "default"
}

apps = {
  xyne-claw = { enabled = false }
}

workers = [
  {
    name = "default"
    env = {
      ENABLE_NOTIFICATION_WORKER = "true"
      ENABLE_WORKER_SCHEDULER    = "true"
      ENABLE_WORKFLOW_RECOVERY   = "true"
    }
  },
]

app_secrets = {
  jwt_secret                  = "replace-with-32-or-more-random-characters"
  zero_auth_secret            = "replace-with-32-or-more-random-characters"
  zero_admin_password         = "replace-with-16-or-more-chars"
  encryption_key              = "replace-with-64-hex-characters"
  internal_s2s_key            = "replace-with-32-or-more-random-characters"
  claw_s2s_key                = "replace-with-32-or-more-random-characters"
  claw_auth_encryption_key    = "replace-with-64-hex-characters"
  ysweet_auth                 = "replace-with-private_key-from-y-sweet-gen-auth"
  ysweet_server_token         = "replace-with-server_token-from-y-sweet-gen-auth"
  transcription_agent_api_key = "replace-with-32-or-more-random-characters"
}
```

The values shown are examples generated for this page; never reuse them.

## 8. Generate the secrets

```bash
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24     # postgres_password        (>= 16, no / @ " space)
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24     # redis_auth               (16-128, no / @ ")
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # jwt_secret               (>= 32)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # zero_auth_secret         (>= 32)
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24     # zero_admin_password      (>= 16)
openssl rand -hex 32                                   # encryption_key           (exactly 64 hex)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # internal_s2s_key         (>= 32)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # claw_s2s_key             (>= 32)
openssl rand -hex 32                                   # claw_auth_encryption_key (exactly 64 hex)
openssl rand -base64 48 | tr -d '/+=' | cut -c1-48     # transcription_agent_api_key (>= 32)
docker run --rm ghcr.io/juspay/y-sweet:sha-221d5af y-sweet gen-auth --json
#   "private_key"  -> ysweet_auth
#   "server_token" -> ysweet_server_token
docker run --rm livekit/livekit-server:v1.9.1 generate-keys
#   API Key    -> livekit_api_key
#   API Secret -> livekit_api_secret
```

`postgres_password`, `redis_auth` and the LiveKit pair go into `01-infra.tfvars`, the rest into
`app_secrets`. [secrets.md](secrets.md) has the details and the rotation procedure.

Two more entries in `app_secrets` are optional and are not generated here. `hindsight_api_key` is
the key claw presents when it calls the Hindsight API; leave it empty when the instance needs no
auth. `hindsight_llm_api_key` is the LLM provider key Hindsight itself uses to extract facts, and
applies only when you deploy Hindsight with `enable_hindsight`; without it Hindsight starts but
extracts nothing. Both may be left empty.

## 9. Run the doctor

```bash
deployment/scripts/doctor.sh --env prod
```

Expected (abridged):

```
STATUS  CHECK                                         DETAIL
------  --------------------------------------------  ------
PASS    env.conf                                      …/prod/env.conf
PASS    terraform >= 1.6.0                            1.9.8
PASS    helm >= 3.14.0                                3.16.2
PASS    kubectl                                       1.31.2
PASS    jq                                            1.7.1
PASS    yq                                            4.44.3
PASS    aws                                           2.22.0
PASS    aws auth                                      arn:aws:iam::210987654321:user/alice
PASS    01-infra.tfvars                               …
PASS    02-platform.tfvars                            …
PASS    01-infra: region                              set
PASS    01-infra: domain                              set
PASS    01-infra: postgres_password                   set
PASS    02-platform: region                           set
PASS    02-platform: state_bucket                     set
PASS    02-platform: chart_revision                   set
PASS    02-platform: app_secrets                      set
PASS    placeholders in env.conf                      none
PASS    placeholders in 01-infra.tfvars               none
PASS    placeholders in 02-platform.tfvars            none

doctor: PASS
```

`aws auth` runs `aws sts get-caller-identity`. The placeholder check rejects lines containing
`replace-with-`, `example-account`, `example-tfstate`, `spaces.example.com`,
`Z0123456789EXAMPLE`, `123456789012` and the other example strings.

## 10. Run the setup

```bash
deployment/scripts/setup.sh --env prod
```

1. **doctor**.
2. **state backend**: `aws s3api create-bucket --bucket acme-spaces-tfstate --region ap-south-1
   --create-bucket-configuration LocationConstraint=ap-south-1` if missing, then versioning,
   public-access block and default encryption. `backend for 01-infra -> …/stacks/aws/01-infra/backend.tf`.
3. **stage 01-infra**, which begins with **stage ingress addresses**: in `cloud-lb` mode a
   targeted apply reserves the Elastic IPs, the records to create are printed, and the run stops
   at `Continue with the network and cluster build? [yes/N]` so DNS can propagate while everything
   else is built; in `external` mode the names are printed and the same prompt appears; in
   `gateway` mode there is no address to reserve and the run continues. `--skip-dns-gate` drops
   that stage and its wait. Then the stage proper: plan of roughly 150 resources, `Apply the
   01-infra plan above? [yes/N]`, type `yes`. 30–40 minutes.
4. **kubeconfig**: `aws eks update-kubeconfig --name xyne --region ap-south-1`.
5. **stage 02-platform**: plan, confirm, apply: Argo CD, namespaces, Secrets, `xyne-root`.
   5–10 minutes.
6. **overlay**: `no overlay directory at …/prod/overlay, skipping`.
7. **waiting for Argo CD**: a table every 30 seconds. On AWS the first rows to turn `Healthy`
   are `aws-load-balancer-controller` (wave -4), external-dns and the Istio control plane; the
   gateway Service gets its NLB hostname a minute or two later. `platform-config` stays
   `Progressing` until the records resolve and the certificate is issued (step 12); the wait
   continues regardless (default `--argo-timeout 1800`), and everything else converges.
8. **summary**:

   ```
   ================ prod (aws) ================
   application            https://xyne.example.com
   ingress mode           gateway
   ingress address        k8s-istioing-istioing-0123456789-abcdef0123456789.elb.ap-south-1.amazonaws.com
   tls terminates         on the istio gateway (cert-manager)
   argo cd password       kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
   argo cd ui             kubectl -n argocd port-forward svc/argocd-server 8080:80 (then http://localhost:8080, user admin)

   external-dns keeps these records in hosted zone Z08ACMEXYNE1234 from the gateway Service:
     xyne.example.com             -> k8s-istioing-istioing-0123456789-abcdef0123456789.elb.ap-south-1.amazonaws.com
     *.xyne.example.com           -> k8s-istioing-istioing-0123456789-abcdef0123456789.elb.ap-south-1.amazonaws.com
   if they do not appear: kubectl -n external-dns logs deploy/external-dns

   setup: done
   ```

   With `dns_zone = ""` the same block lists the records to create at your own provider, LiveKit
   included. In `cloud-lb` and `external` mode the `ingress address` line is `edge address`
   instead, and `tls terminates` names the edge; `external` adds the `lb-config.sh` command to
   run next.

If the wait times out with `platform-config` the only pending Application, check step 12 and
run `setup.sh --env prod --only platform` to watch it turn `Healthy`.

## 11. One-time SQL

RDS creates only the `xyne` database (`db_name`) and gives the master user no replication
privilege. With `postgres_mode = "managed"`, `02-platform` fixes both before Argo CD starts
any app: the `xyne-db-init` Job in `namespace` runs the SQL below, skipping databases that
exist, and `setup.sh` waits for it. Nothing is left to do by hand. The rest of this step is for
`postgres_mode = "external"`, or for a Job that failed (`kubectl -n xyne logs job/xyne-db-init`).

The SQL, connected as `xyne` to database `xyne`:

```sql
GRANT rds_replication TO xyne;
CREATE DATABASE xyne_common OWNER xyne;
CREATE DATABASE zero_cvr OWNER xyne;
CREATE DATABASE zero_cdb OWNER xyne;
CREATE DATABASE claw_auth OWNER xyne;
```

(Use the names from `postgres_databases` if you changed them.) Until this runs,
`xyne-zero-replication` fails with `database "zero_cdb" does not exist` and then
`must be superuser or replication role to start walsender`.

**From inside the cluster**:

```bash
DATABASE_URL="$(kubectl -n xyne get secret xyne-backend-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)"
kubectl -n xyne run psql --rm -it --restart=Never --image=postgres:16 \
  --overrides='{"metadata":{"annotations":{"sidecar.istio.io/inject":"false"}}}' \
  -- psql "$DATABASE_URL" \
  -c 'GRANT rds_replication TO xyne;' \
  -c 'CREATE DATABASE xyne_common OWNER xyne;' \
  -c 'CREATE DATABASE zero_cvr OWNER xyne;' \
  -c 'CREATE DATABASE zero_cdb OWNER xyne;' \
  -c 'CREATE DATABASE claw_auth OWNER xyne;'
```

**From the bastion** (`bastion_enabled = true`; `psql` is preinstalled):

```bash
terraform -chdir=deployment/terraform/stacks/aws/01-infra output -json postgres | jq -r .host     # the RDS endpoint
aws ssm start-session --target "$(terraform -chdir=deployment/terraform/stacks/aws/01-infra output -raw bastion_instance_id)"
psql "host=<the RDS endpoint printed above> user=xyne dbname=xyne sslmode=require"
```

Then:

```bash
kubectl -n xyne rollout restart deployment/xyne-zero-replication deployment/xyne-zero deployment/xyne-backend
```

## 12. DNS records

Terraform does not create the application records on AWS: the NLB hostname is assigned by the
load balancer controller inside the cluster, after `01-infra` is long finished.

**With `dns_zone` set**, nothing here is manual. external-dns runs in the cluster, reads the
`external-dns.alpha.kubernetes.io/hostname: xyne.example.com,*.xyne.example.com` annotation that
the root chart puts on the gateway Service, and keeps both records in that hosted zone as
aliases to the NLB. It is installed by the root chart with an IRSA role scoped to the zone, and
`setup.sh` says so in its summary instead of printing records to create. Give it a minute after
the gateway Service gets its hostname, then:

```bash
dig +short xyne.example.com
dig +short console.xyne.example.com
kubectl -n external-dns logs deploy/external-dns
```

The logs name every record it creates or refuses; see
[operations.md](operations.md#troubleshooting) when they stay empty. Set
`external_dns_enabled = false` in `01-infra.tfvars` to keep the records under your own control,
and then follow the manual steps below.

**Without `dns_zone`** (or with `external_dns_enabled = false`), read the NLB hostname and create
two alias records yourself (an apex cannot be a CNAME):

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
aws route53 change-resource-record-sets --hosted-zone-id Z08ACMEXYNE1234 --change-batch file:///tmp/xyne-dns.json
```

With DNS elsewhere, create `xyne.example.com` as an ALIAS/ANAME (or A records to the NLB's
addresses from `dig +short "$NLB"`) and `*.xyne.example.com` as a CNAME to `$NLB`.

LiveKit records, when enabled and `dns_zone` is set, are created by Terraform as aliases:
`livekit.xyne.example.com` → the ALB, `turn.xyne.example.com` → the TURN NLB (only with
`livekit_turn_cert_secret`). Without `dns_zone`, read them from
`terraform -chdir=deployment/terraform/stacks/aws/01-infra output livekit_lb_dns_names`.

Everything above is `gateway` mode, the only mode external-dns is used in. In `cloud-lb` mode the
records point at the edge load balancer, which Terraform builds and therefore knows: with
`dns_zone` set it writes the Route 53 alias records itself, and external-dns is not installed.
In `external` mode Terraform writes no record at all: both names point at the load balancer you
run. See [ingress.md](ingress.md#addresses-and-dns-come-first).

## 13. TLS

**The application**: cert-manager, `ClusterIssuer letsencrypt` with the `http01` solver through
the Istio ingress class, `Certificate istio-ingress/xyne-gateway-tls`. A minute or two after the
record in step 12 resolves:

```bash
kubectl -n istio-ingress get certificate xyne-gateway-tls
# NAME               READY   SECRET             AGE
# xyne-gateway-tls   True    xyne-gateway-tls   2m
```

That certificate is the one a browser sees in `gateway` mode. In `cloud-lb` and `external` mode
the browser sees the certificate you supplied to the edge instead, and `xyne-gateway-tls` becomes
a self-signed certificate covering only the inner leg between the edge and the gateway.
`ingress_tls` picks which of the two it is: `acme`, `internal`, `existing` or `none`. See
[ingress.md](ingress.md#certificates).

**LiveKit signalling** (`livekit.xyne.example.com`, ALB port 443) uses an ACM certificate, one
of:

| Setting | Behaviour |
|---|---|
| `livekit_certificate_arn = "arn:aws:acm:ap-south-1:210987654321:certificate/…"` | use this certificate as is |
| `livekit_certificate_arn = ""`, `livekit_create_certificate = true` (default), `dns_zone` set | Terraform requests a certificate for `livekit.xyne.example.com` and validates it with a Route 53 record |
| neither | `01-infra` fails with `livekit_certificate_arn is required when livekit_enabled is true, unless dns_zone is set …` |

**TURN over TLS** (`turn.xyne.example.com:5349`, an NLB in TCP pass-through) is optional: store
a PEM bundle (chain then private key) in Secrets Manager and name it in
`livekit_turn_cert_secret`.

```bash
cat fullchain.pem privkey.pem > turn-bundle.pem
aws secretsmanager create-secret --name xyne/livekit/turn-cert --secret-string file://turn-bundle.pem
```

## 14. Reaching the cluster

```bash
aws eks update-kubeconfig --name xyne --region ap-south-1
kubectl get nodes
```

from any address in `eks_public_access_cidrs`, as the identity that applied `01-infra` or the
`deployer_principal_arn`. Other principals need their own access entry (`aws eks
create-access-entry` + `associate-access-policy`). With `enable_private_endpoint = true` the
API is reachable only from the VPC: start an SSM session on the bastion and run `kubectl` there
(the AMI carries `aws` but not `kubectl`, `helm` or `terraform`; install what you need).

## 15. First login

The application signs users in with an OAuth client or by email and password; email
registration sends a verification code through the same OAuth client plus a refresh token
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `EMAIL_FROM`). Create the
client first:

1. In the Google Cloud console, *APIs & Services → Credentials → Create credentials → OAuth
   client ID*, type *Web application*, authorized redirect URI
   `https://xyne.example.com/api/auth/exchange`, authorized JavaScript origin
   `https://xyne.example.com`. (Any Google account can do this; it does not require a GCP
   install.)
2. Add it to the backend Secret and map it into the backend environment. In `02-platform.tfvars`:

   ```hcl
   extra_secret_data = {
     xyne-backend-secrets = {
       GOOGLE_CLIENT_ID     = "123456789012-abcdefghijklmnop.apps.googleusercontent.com"
       GOOGLE_CLIENT_SECRET = "GOCSPX-…"
     }
   }

   apps = {
     xyne-claw = { enabled = false }
     xyne-backend = {
       values = <<-YAML
         secretEnv:
           GOOGLE_CLIENT_ID: {name: xyne-backend-secrets, key: GOOGLE_CLIENT_ID}
           GOOGLE_CLIENT_SECRET: {name: xyne-backend-secrets, key: GOOGLE_CLIENT_SECRET}
       YAML
     }
   }
   ```

3. `deployment/scripts/setup.sh --env prod --only platform`, then
   `kubectl -n xyne rollout restart deployment/xyne-backend`.
4. Open `https://xyne.example.com`, sign in with an account on your organisation's domain
   (public email domains are refused for organisation creation) and create the organisation.

`curl -sS https://xyne.example.com/api/v2/auth/providers` shows
`{"google":true,"microsoft":false,"email":true}` when the client is picked up.

## 16. Verification checklist

```bash
kubectl -n argocd get applications                                      # every row Synced / Healthy
kubectl -n kube-system get deploy aws-load-balancer-controller          # 2/2
kubectl -n xyne get pods                                                # all Running, 2/2
kubectl -n istio-ingress get svc istio-ingressgateway                   # EXTERNAL-IP = NLB hostname
kubectl -n istio-ingress get certificate xyne-gateway-tls               # READY True
curl -sSI https://xyne.example.com/ | head -n1                          # HTTP/2 200
curl -sS https://xyne.example.com/api/health                            # 200 with a JSON body
kubectl -n xyne logs deployment/xyne-zero-replication --tail=20         # no replication errors
aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus]' --output table   # available
aws elasticache describe-replication-groups --query 'ReplicationGroups[].[ReplicationGroupId,Status]' --output table   # available
aws s3 ls | grep 210987654321-xyne-                                     # eight buckets
```

The fourth line is `gateway` mode. In `cloud-lb` and `external` mode the gateway Service has no
`EXTERNAL-IP` and that is correct; check the edge address the summary printed instead. In
`external` mode also run `deployment/scripts/lb-config.sh --env prod --format all` and confirm
your load balancer matches what it prints ([ingress.md](ingress.md#checking-it-works)).

With Hindsight on and claw enabled, also:

```bash
kubectl -n hindsight get pods
kubectl -n xyne get deploy xyne-claw -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="HINDSIGHT_URL")].value}'
```

The first shows the API pod Running. The second prints the address claw uses, either the
in-cluster service or the `hindsight.url` you set; nothing printed means memory is off.

Argo CD UI: `kubectl -n argocd port-forward svc/argocd-server 8080:80`, then
`http://localhost:8080`, user `admin`.

## LiveKit on AWS

With `dns_zone` set, enabling LiveKit is:

```hcl
livekit_enabled    = true
livekit_api_key    = "replace-with-key-from-livekit-generate-keys"
livekit_api_secret = "replace-with-secret-from-livekit-generate-keys"
```

then `setup.sh --env prod` (both stages). `01-infra` creates Secrets Manager secrets
`xyne/livekit/server-config` and `xyne/livekit/egress-config`, an instance role that may read
them, launch templates from the Ubuntu 24.04 AMI (`livekit_ami_ssm_parameter`) on `m6i.xlarge`,
an Auto Scaling group `xyne-livekit-server` in the public subnets (public IP per instance,
1–3 on 60% CPU) and `xyne-livekit-egress` in the private subnets, the security group rules for
TCP 7880/7881, UDP 3478 and 50000–60000, an ALB with the ACM certificate and an HTTP→HTTPS
redirect, and the Route 53 aliases. `livekit_lb_dns_names` in the outputs carries the ALB and
TURN NLB names.

Enable the transcription agent to use it: `apps = { xyne-transcription-agent = { enabled = true } }`.

## Cost notes

Rough monthly shape of the defaults in `ap-south-1`, largest first: the `general` node group
(`m6i.xlarge`, 1–5), RDS `db.m6g.large` Multi-AZ (two instances' worth), ElastiCache
`cache.m6g.large` ×2 nodes, three NAT gateways plus their data processing (set
`single_nat_gateway = true` for a non-production install), the EKS cluster fee, the NLB, four
interface endpoints (hourly each), S3 by volume. LiveKit adds two `m6i.xlarge` and an ALB. The
bastion (`t4g.micro`) is negligible. `postgres_read_replica` adds a third RDS instance;
`sandbox_enabled` adds `m5zn.metal` nodes, by far the most expensive line if used.

## Known limits

- **Application DNS is never Terraform's** on AWS in `gateway` mode: the NLB hostname only exists
  after the gateway Service is reconciled. With `dns_zone` set, external-dns does it from inside
  the cluster (step 12); without one, or with `external_dns_enabled = false`, the records are
  yours. In `cloud-lb` mode Terraform builds the edge and writes the records itself, and in
  `external` mode it writes none.
- **ElastiCache AUTH needs TLS**: `redis_auth` is required and `redis_tls` must stay `true`;
  the module refuses `auth_token` without in-transit encryption. Do not set `redis_tls = false`
  with `redis_mode = "managed"`.
- **RDS creates one database**: the other four are the SQL in step 11.
- **`.metal` for the sandbox**: `node_pools.sandbox.instance_type` must end in `.metal`
  (`m5zn.metal` default), the only way to get nested virtualization on EC2. Kata itself is
  experimental.
- **Load balancer controller**: the gateway depends on it. If you set `lb_controller_enabled =
  false` in `01-infra` you must provide the controller yourself before the gateway Service can
  get an address.
- **Deletion protection** is on for RDS; the bucket `force_destroy` is off. See
  [operations.md](operations.md#destroy).
