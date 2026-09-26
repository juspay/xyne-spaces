# Deploying on Azure

**Who this is for:** an engineer with an Azure subscription, following this page top to bottom
from an empty subscription to the application open in a browser. Nothing is assumed beyond a
subscription with billing and a domain you control.

- [What you will build](#what-you-will-build)
- [1. Prepare the subscription](#1-prepare-the-subscription)
- [2. Install the tools](#2-install-the-tools)
- [3. DNS: create a zone or plan manual records](#3-dns-create-a-zone-or-plan-manual-records)
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
- [LiveKit on Azure](#livekit-on-azure)
- [Cost notes](#cost-notes)
- [Known limits](#known-limits)

Throughout, the example subscription is `3f2c1a9e-7b4d-4e6a-9c1f-2d5e8a7b6c4d`, the region
`centralindia` (the India region with availability zones; the example environment uses it too),
the resource group `xyne`, the domain `xyne.example.com`, the office network `203.0.113.0/24`,
the environment `prod`. Substitute your own.

## What you will build

| Resource | Azure product | Name |
|---|---|---|
| Resource group | created by `01-infra` (`create_resource_group = true`) | `xyne`; nodes in `xyne-nodes` |
| Network | VNet `10.10.0.0/16` with subnets for AKS, Postgres (delegated), private endpoints, LiveKit, LiveKit egress, bastion, Azure Bastion, Application Gateway; one NSG per subnet; NAT gateway with a public IP prefix; private DNS zones for Postgres, Redis and Blob | `xyne` |
| Cluster | AKS with Azure CNI overlay and Cilium data plane (pods `10.20.0.0/16`, services `10.30.0.0/20`), `Standard` tier, Azure RBAC, workload identity + OIDC issuer, automatic `patch` upgrades, weekly maintenance window, one node pool per enabled role (`Standard_D4s_v5` 1–5 for `general`, zones 1–3) | `xyne` |
| Postgres | Azure Database for PostgreSQL Flexible Server 16, `GP_Standard_D2ds_v5`, 32 GB with autogrow, zone-redundant HA, 7-day backups, `wal_level=logical`, five databases, admin `xyne` | `postgres_server_name` |
| Redis | Azure Cache for Redis 6, `Standard` C1, TLS on port 6380, private endpoint; the access key is the AUTH token | `redis_cache_name` |
| Object storage | one Azure Blob storage account (`Standard_ZRS`, TLS 1.2, no public blob access, 7-day soft delete) with one private container per bucket; each app's managed identity gets `Storage Blob Data Contributor` or `Reader` on the containers it uses | `storage_account_name` |
| Identities | one user-assigned managed identity per app with a federated credential on the AKS OIDC issuer | `xyne-backend` etc. |
| Ingress | one `Standard` static public IP for the Istio gateway, which is what `ingress_mode = "gateway"` builds; the cluster identity gets `Network Contributor` on the resource group. The other two modes build an Application Gateway in front of an internal load balancer instead, or no load balancer at all ([ingress.md](ingress.md#the-three-modes)) | `xyne-ingress` |
| DNS | `A` records for the apex and wildcard in your Azure DNS zone when `dns_zone` is set | |
| LiveKit (off by default) | two orchestrated VM scale sets, an Application Gateway with a Key Vault certificate, public IPs, a Key Vault for the config | `xyne-livekit-*` |
| Bastion (off by default) | one `Standard_B2s` VM (`psql`, `redis-cli`, `az`, `kubectl`, `kubelogin`, `helm`) reachable through Azure Bastion, or over SSH from `bastion_allowed_ssh_cidrs` | `xyne-bastion`, `xyne-azure-bastion` |
| Hindsight (off by default) | claw's long-term memory: the upstream `vectorize-io/hindsight` Helm chart deployed into the cluster in its own namespace, bringing its own pgvector PostgreSQL; `hindsight.url` points claw at an instance you already run instead | `hindsight` |
| State | one storage account (ZRS, versioning) with a container | `acmespacestfstate` / `tfstate` |

Wall-clock time: 30–45 minutes for `01-infra` (Flexible Server with HA 15–20, Azure Cache for
Redis 15–20, AKS about 10, in parallel), 5–10 minutes for `02-platform`, 10–20 minutes for
Argo CD.

## 1. Prepare the subscription

```bash
az login
az account set --subscription 3f2c1a9e-7b4d-4e6a-9c1f-2d5e8a7b6c4d
az account show --output table
az ad signed-in-user show --query id --output tsv      # your object id, used below
```

Your identity needs `Owner` on the subscription, or `Contributor` plus `User Access
Administrator`: `01-infra` creates role assignments (cluster user and admin for you, Network
Contributor for the cluster identity, Storage Blob Data roles for the app identities, Key Vault
roles for LiveKit). Register the resource providers once:

```bash
for ns in Microsoft.ContainerService Microsoft.DBforPostgreSQL Microsoft.Cache Microsoft.Storage \
          Microsoft.Network Microsoft.Compute Microsoft.KeyVault Microsoft.ManagedIdentity \
          Microsoft.OperationalInsights Microsoft.Authorization; do
  az provider register --namespace "$ns"
done
az provider list --query "[?registrationState!='Registered' && namespace in ['Microsoft.ContainerService','Microsoft.DBforPostgreSQL','Microsoft.Cache']].namespace" -o tsv   # empty when done
```

Quota: the defaults need `Standard DSv5 Family vCPUs` for the `general` pool (4–20) and
`Standard DDSv5` for Postgres, plus a public IP prefix for NAT. Check with
`az vm list-usage --location centralindia --output table | grep -i dsv5`.

You also need an SSH public key if you enable the bastion or LiveKit (Azure Linux VMs require
one at creation, even though sign-in goes through the AAD SSH extension):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/xyne-prod -N '' -C ops@example.com
cat ~/.ssh/xyne-prod.pub
```

## 2. Install the tools

macOS:

```bash
brew install hashicorp/tap/terraform helm kubectl jq yq azure-cli Azure/kubelogin/kubelogin
```

Debian/Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates gnupg curl jq
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
sudo az aks install-cli --install-location /usr/local/bin/kubectl --kubelogin-install-location /usr/local/bin/kubelogin
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64 && sudo chmod +x /usr/local/bin/yq
```

Docker and `openssl` are needed once, in step 8. Confirm:

```bash
terraform version      # Terraform v1.6.0 or newer
helm version --short   # v3.14.0 or newer
kubelogin --version
az account show --query name --output tsv
```

## 3. DNS: create a zone or plan manual records

**Option A, Azure DNS (recommended):** the zone may live in any resource group of the
subscription; Terraform reads it and writes the records.

The resource group must exist before `01-infra`. Once `env.conf` exists, and `domain` and
`dns_zone_resource_group` are set in `01-infra.tfvars` (steps 4 to 6):

```bash
az group create --name acme-dns --location centralindia
deployment/scripts/dns.sh --env prod zone
# set in 01-infra.tfvars:
#   dns_zone                = "xyne.example.com"
#   dns_zone_resource_group = "acme-dns"
deployment/scripts/dns.sh --env prod status
```

`zone` creates the zone when it is missing and prints its name servers. Set them at your
registrar. See [dns.md](dns.md).
`domain` must equal the zone name or be a subdomain of it; the stack computes the record names
relative to the zone (`@` and `*` here).

**Option B, DNS elsewhere:** `dns_zone = ""`; `setup.sh` prints the records in step 12.

Either way the address is reserved before the network and the cluster are built, and `setup.sh`
prints the records and waits there, so they can be created and propagate while the slow part of
the build runs. Which address they point at is decided by `ingress_mode`, and in `external` mode
there is no cloud address to reserve at all: see
[ingress.md](ingress.md#addresses-and-dns-come-first).

## 4. Copy the example environment

```bash
cd xyne-spaces
cp -r deployment/environments/example-azure deployment/environments/prod
ls deployment/environments/prod
# 01-infra.tfvars  02-platform.tfvars  env.conf
```

`deployment/environments/.gitignore` ignores everything except `example-*/`.

## 5. Fill `env.conf`

Only `KEY=VALUE` lines, no quotes, no spaces. `SUBSCRIPTION_ID` is exported as
`ARM_SUBSCRIPTION_ID` for Terraform and selected with `az account set`. The state resource
group, storage account (`Standard_ZRS`, TLS 1.2, no public blob access, versioning) and
container are created in `LOCATION` if missing. Storage account names are global: 3–24
lowercase letters and digits.

`deployment/environments/prod/env.conf`:

```
CLOUD=azure
SUBSCRIPTION_ID=3f2c1a9e-7b4d-4e6a-9c1f-2d5e8a7b6c4d
LOCATION=centralindia
STATE_RESOURCE_GROUP=acme-tfstate
STATE_STORAGE_ACCOUNT=acmespacestfstate
STATE_CONTAINER=tfstate
STATE_PREFIX=xyne
```

## 6. Fill `01-infra.tfvars`

Required (no default): `subscription_id`, `region`, `domain`, `postgres_password`. The Azure
stack additionally requires `ssh_public_key` when the bastion or LiveKit is enabled, and
`storage_account_name` when `storage_mode = "managed"`. The
[configuration reference](configuration.md#azure-01-infra) lists every variable.

- `subscription_id`, `region`: where everything goes. `zones` lists the availability zones the
  node pools, Postgres HA and the ingress IP spread over.
- `resource_group_name`: created unless `create_resource_group = false`; defaults to `name`.
- `name`: prefix of every resource and the cluster name.
- `domain`, `dns_zone`, `dns_zone_resource_group`: from step 3.
- `namespace`: the application namespace, used in the federated credentials; keep `xyne`.
- `worker_names`: one per worker role in `02-platform.tfvars`.
- `ssh_public_key`: from step 1.
- `tags`: applied to every resource.
- `nat_gateway_enabled`: outbound through a NAT gateway (`userAssignedNATGateway`); with
  `false` AKS uses its load balancer for egress and LiveKit egress VMs get public IPs.
- `bastion_enabled`, `azure_bastion_enabled`, `azure_bastion_sku`: the VM's SSH port is open
  only from inside the VNet, so reaching it means Azure Bastion; the `Standard` SKU is needed
  for the `az network bastion ssh` command used in step 11.
- `bastion_allowed_ssh_cidrs`: empty by default. Each CIDR listed gets TCP 22 to the bastion
  subnet, which is how you SSH to the VM's public IP directly instead of through Azure Bastion.
  List office or VPN ranges only.
- `aks_authorized_ip_ranges`: who may reach the API server. Empty means everyone.
- `deployer_principal_id`: the object id given the cluster user and admin roles; `""` means the
  identity running Terraform. `admin_group_object_ids` adds Entra groups as cluster admins.
- `node_pools`: sizes per pool. The `zero` pool with `local_storage_temp_disk = true` needs a
  `d` size (`Standard_E4ds_v5`); the `sandbox` pool needs a `v3`/`v4` D or E size for nested
  virtualization.
- `postgres_server_name`, `redis_cache_name`: globally unique names; `""` derives `xyne-postgres` and
  `xyne-redis` from `name`, which usually collides. Set them.
- `postgres_password`: at least 16 characters; admin password of `xyne`.
- `storage_mode`: **`managed`**, as in the example environment: one Azure Blob storage account
  with a container per bucket. `storage_account_name` is global and must be 3–24 lowercase
  letters and digits. The apps reach it with `STORAGE_PROVIDER=azure` and
  `AZURE_STORAGE_ACCOUNT`, authenticating with the workload identity bound to their
  ServiceAccount, so no account key is handed out and
  `storage_shared_access_key_enabled = false` is safe. `incluster` (MinIO) and `external`
  (an S3-compatible endpoint, with `storage_credentials`) still work.
- `storage_allowed_ip_ranges`: the storage account denies network access by default and lets the
  cluster, bastion and LiveKit subnets through. Add any address outside the VNet that needs the
  blobs, such as a CI runner uploading dashboard bundles. Setting
  `storage_network_default_action = "Allow"` removes the firewall instead, and
  `storage_private_endpoint = true` takes the account off the public internet.
  See [security.md](security.md#object-storage).
- `ingress_static_ip`: reserve a static IP for the gateway and pin the Service to it.
- `ingress_mode`: what sits in front of the Istio gateway. `gateway`, the default, gives the
  gateway Service the static public IP above and terminates TLS on the gateway with cert-manager,
  which is everything this page describes. `cloud-lb` has Terraform build an Application Gateway
  on a static public IP that terminates TLS with a certificate you supply and re-encrypts to the
  gateway; its backend pool takes addresses and not node pools, so the gateway Service becomes an
  *internal* load balancer on a private address instead. `external` builds no load balancer at
  all and leaves the gateway on fixed node ports for one you run yourself. See
  [ingress.md](ingress.md#the-three-modes).
  - in `cloud-lb` mode the edge certificate is yours:
    `ingress_certificate_key_vault_secret_id` for one already in a Key Vault (with
    `ingress_certificate_key_vault_id`), or `ingress_certificate_pfx_data` with
    `ingress_certificate_pfx_password` to pass the PFX directly.
  - `ingress_internal_ip` is required in `cloud-lb` mode. It is the fixed private address the
    internal load balancer takes and the Application Gateway's backend, and it must sit inside
    `aks_subnet_cidr`.
- `livekit_*`: off until DNS and a certificate exist; see [LiveKit on Azure](#livekit-on-azure).

`deployment/environments/prod/01-infra.tfvars`:

```hcl
subscription_id     = "3f2c1a9e-7b4d-4e6a-9c1f-2d5e8a7b6c4d"
region              = "centralindia"
resource_group_name = "xyne"
name                = "xyne"
domain              = "xyne.example.com"

dns_zone                = "xyne.example.com"
dns_zone_resource_group = "acme-dns"
namespace               = "xyne"
worker_names            = ["default"]
zones                   = ["1", "2", "3"]
ssh_public_key          = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGQ3Y2NhZGZlYmFjZTQ1NjdhYmNkZWYwMTIzNDU2Nzg5 ops@example.com"

tags = {
  environment = "production"
}

vnet_cidr           = "10.10.0.0/16"
pods_cidr           = "10.20.0.0/16"
services_cidr       = "10.30.0.0/20"
nat_gateway_enabled = true
bastion_enabled     = true
azure_bastion_enabled = true
azure_bastion_sku   = "Standard"
bastion_vm_size     = "Standard_B2s"

kubernetes_version       = ""
cluster_sku_tier         = "Standard"
enable_private_endpoint  = false
aks_authorized_ip_ranges = ["203.0.113.0/24"]
deployer_principal_id    = ""
admin_group_object_ids   = []
azure_rbac_enabled       = true

node_pools = {
  general = { vm_size = "Standard_D4s_v5", min_count = 2, max_count = 6 }
  zero    = { vm_size = "Standard_E4ds_v5", local_storage_temp_disk = true }
  vespa   = { vm_size = "Standard_D8s_v5", max_count = 3 }
  sandbox = { vm_size = "Standard_D4s_v3", max_count = 2 }
}

zero_pool_enabled = false
vespa_enabled     = false
sandbox_enabled   = false

postgres_mode              = "managed"
postgres_server_name       = "acme-xyne-pg"
postgres_sku_name          = "GP_Standard_D2ds_v5"
postgres_high_availability = true
postgres_read_replica      = false
postgres_username          = "xyne"
postgres_password          = "replace-with-24-or-more-random-characters"

redis_mode       = "managed"
redis_cache_name = "acme-xyne-redis"
redis_sku_name   = "Standard"
redis_capacity   = 1

storage_mode             = "managed"
storage_account_name     = "acmexynestorage"
storage_bucket_prefix    = "xyne"
storage_replication_type = "ZRS"

ingress_static_ip = true

livekit_enabled               = false
livekit_api_key               = "replace-with-key-from-livekit-generate-keys"
livekit_api_secret            = "replace-with-secret-from-livekit-generate-keys"
livekit_key_vault_name        = "acme-xyne-livekit"
livekit_certificate_secret_id = ""
livekit_turn_cert_secret      = ""
```

## 7. Fill `02-platform.tfvars`

Required: `subscription_id`, `region`, `chart_revision`, `app_secrets`. The `state_*` values are
passed by `setup.sh` from `env.conf`. `kubelogin_login` is how the Terraform providers
authenticate to AKS (`azurecli` reuses your `az login`; `spn`, `msi`, `workloadidentity` for
automation, with `kubelogin_extra_args` for their flags).

- `namespace`: must match `namespace` in `01-infra.tfvars`.
- `domain`: repeat the apex, or `""` to take it from the outputs.
- `chart_revision`: the `chart-<version>` tag;
  `git ls-remote --tags https://github.com/juspay/xyne-spaces.git 'chart-*' | sed 's|.*refs/tags/||' | sort -V | tail -n1`.
- `root_revision`: branch or tag for the root chart.
- `image_registry`, `image_tag`: empty pulls `ghcr.io/juspay/*`.
- `acme_email`: Let's Encrypt account contact.
- `enable_vespa`, `enable_monitoring`, `enable_sandbox`: off to start.
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
- `apps`, `workers`: as on the other clouds; `name` must be in `worker_names`.
- `app_secrets`: generated in step 8.

`deployment/environments/prod/02-platform.tfvars`:

```hcl
subscription_id            = "3f2c1a9e-7b4d-4e6a-9c1f-2d5e8a7b6c4d"
region                     = "centralindia"
state_resource_group_name  = "acme-tfstate"
state_storage_account_name = "acmespacestfstate"
state_container_name       = "tfstate"
state_key                  = "xyne/01-infra/terraform.tfstate"

kubelogin_login = "azurecli"

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
openssl rand -base64 24 | tr -d '/+=' | cut -c1-24     # postgres_password        (>= 16)
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

`redis_auth` is not an input on Azure with `redis_mode = "managed"`: the cache's primary access
key is used. [secrets.md](secrets.md) has the details and the rotation procedure.

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
PASS    az                                            2.67.0
PASS    kubelogin                                     0.1.4
PASS    az auth                                       Acme Production
PASS    01-infra.tfvars                               …
PASS    02-platform.tfvars                            …
PASS    01-infra: subscription_id                     set
PASS    01-infra: region                              set
PASS    01-infra: domain                              set
PASS    01-infra: postgres_password                   set
PASS    02-platform: subscription_id                  set
PASS    02-platform: region                           set
PASS    02-platform: state_resource_group_name        supplied by setup.sh from env.conf
PASS    02-platform: state_storage_account_name       supplied by setup.sh from env.conf
PASS    02-platform: chart_revision                   set
PASS    02-platform: app_secrets                      set
PASS    placeholders in env.conf                      none
PASS    placeholders in 01-infra.tfvars               none
PASS    placeholders in 02-platform.tfvars            none

doctor: PASS
```

The placeholder check rejects lines containing `replace-with-`, `example-tfstate`,
`exampletfstate`, `spaces.example.com`, `00000000-0000-0000-0000-000000000000` and the other
example strings.

## 10. Run the setup

```bash
deployment/scripts/setup.sh --env prod
```

1. **doctor**.
2. **state backend**: `az account set`, then `az group create`, `az storage account create`,
   blob versioning, `az storage container create --auth-mode login` as needed.
   `backend for 01-infra -> …/stacks/azure/01-infra/backend.tf`.
3. **stage 01-infra**, which begins with **stage ingress addresses**: a targeted apply reserves
   the ingress public IP, the records to create are printed, and the run stops at `Continue with
   the network and cluster build? [yes/N]` so DNS can propagate while everything else is built.
   In `external` mode the names are printed and the same prompt appears without anything being
   reserved. `--skip-dns-gate` drops that stage and its wait. Then the stage proper: plan of
   roughly 130 resources, `Apply the 01-infra plan above? [yes/N]`, type `yes`. 30–45 minutes;
   Flexible Server HA and the Redis cache are the slow ones.
4. **kubeconfig**: `az aks get-credentials --resource-group xyne --name xyne --overwrite-existing`
   and `kubelogin convert-kubeconfig -l azurecli`.
5. **stage 02-platform**: plan, confirm, apply: Argo CD, namespaces, Secrets, `xyne-root`.
   5–10 minutes.
6. **overlay**: `no overlay directory at …/prod/overlay, skipping`.
7. **waiting for Argo CD**: a table every 30 seconds. `platform-config` turns `Healthy` once the
   certificate is issued, which with `dns_zone` set is a few minutes after the gateway gets
   its IP.
8. **summary**:

   ```
   ================ prod (azure) ================
   application            https://xyne.example.com
   ingress mode           gateway
   ingress address        20.204.0.10
   tls terminates         on the istio gateway (cert-manager)
   argo cd password       kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
   argo cd ui             kubectl -n argocd port-forward svc/argocd-server 8080:80 (then http://localhost:8080, user admin)

   setup: done
   ```

   In `cloud-lb` and `external` mode the `ingress address` line is `edge address` instead, and
   `tls terminates` names the edge; `external` adds the `lb-config.sh` command to run next.

## 11. One-time SQL

Flexible Server creates the five databases but the admin role lacks `REPLICATION`. With
`postgres_mode = "managed"`, `02-platform` grants it before Argo CD starts any app, through the
`xyne-db-init` Job; nothing is left to do by hand. The rest of this step is for an external
database, or for a Job that failed (`kubectl -n xyne logs job/xyne-db-init`). The SQL:

```sql
ALTER ROLE xyne WITH REPLICATION;
```

**From inside the cluster** (no bastion needed):

```bash
DATABASE_URL="$(kubectl -n xyne get secret xyne-backend-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)"
kubectl -n xyne run psql --rm -it --restart=Never --image=postgres:16 \
  --overrides='{"metadata":{"annotations":{"sidecar.istio.io/inject":"false"}}}' \
  -- psql "$DATABASE_URL" -c 'ALTER ROLE xyne WITH REPLICATION;'
```

**From the bastion** (`bastion_enabled`, `azure_bastion_enabled`, `azure_bastion_sku =
"Standard"`; `psql` is preinstalled):

```bash
VM_ID="$(az vm show --resource-group xyne --name xyne-bastion --query id --output tsv)"
az network bastion ssh --name xyne-azure-bastion --resource-group xyne \
  --target-resource-id "$VM_ID" --auth-type ssh-key --username xyne --ssh-key ~/.ssh/xyne-prod
psql "host=acme-xyne-pg.postgres.database.azure.com user=xyne dbname=xyne sslmode=require" -c 'ALTER ROLE xyne WITH REPLICATION;'
```

Then `kubectl -n xyne rollout restart deployment/xyne-zero-replication`.

## 12. DNS records

With `dns_zone` set, `01-infra` created `A` records `@` and `*` (or `<prefix>` and `*.<prefix>`
when `domain` is a subdomain of the zone) pointing at the `xyne-ingress` IP, and the LiveKit
records when enabled. Nothing to do.

With `dns_zone = ""`, the summary prints:

```
dns_zone is empty, create these records at your DNS provider:
  xyne.example.com             -> 20.204.0.10
  *.xyne.example.com           -> 20.204.0.10
```

and, with LiveKit, `livekit.xyne.example.com` and `turn.xyne.example.com` to the addresses in
`terraform -chdir=deployment/terraform/stacks/azure/01-infra output livekit_ips`.

Both paragraphs above are `gateway` mode. In `cloud-lb` mode the apex and wildcard point at the
Application Gateway's public IP instead, which Terraform knows and writes itself when `dns_zone`
is set. In `external` mode Terraform writes no record at all: both names point at the load
balancer you run. See [ingress.md](ingress.md#addresses-and-dns-come-first).

## 13. TLS

**The application**: cert-manager, `ClusterIssuer letsencrypt`, `http01` through the Istio
ingress class, `Certificate istio-ingress/xyne-gateway-tls`:

```bash
kubectl -n istio-ingress get certificate xyne-gateway-tls    # READY True after DNS resolves
```

That certificate is the one a browser sees in `gateway` mode. In `cloud-lb` and `external` mode
the browser sees the certificate you supplied to the edge instead, and `xyne-gateway-tls` covers
only the inner leg between the edge and the gateway. `ingress_tls` picks which of the two it is:
`acme`, `internal`, `existing` or `none`. See [ingress.md](ingress.md#certificates).

Azure has one constraint the other clouds do not. Application Gateway v2 refuses to talk HTTPS to
a backend whose certificate it has no root for, and Terraform cannot know a certificate
cert-manager has not issued yet, so a self-signed inner certificate is no use here and
`ingress_tls` defaults to `existing` in `cloud-lb` mode. Supply the inner certificate yourself as
`gateway_tls` (`cert_pem` and `key_pem`) in `02-platform.tfvars` and the same root in
`ingress_backend_root_certificate_pem` in `01-infra.tfvars`. The alternative is to drop the inner
TLS session with `ingress_backend_protocol = "Http"` and `ingress_tls = "none"`, which is only
sound because the Application Gateway subnet and the cluster subnet are on the same private
network in this layout.

**LiveKit signalling** (`livekit.xyne.example.com`) is terminated by an Application Gateway
whose listener takes the certificate from Key Vault. Because `01-infra` needs the certificate's
secret id *before* it can create anything, prepare it in a Key Vault you own:

```bash
az keyvault create --name acme-xyne-livekit --resource-group xyne --location centralindia --enable-rbac-authorization true
az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Key Vault Certificates Officer" --scope "$(az keyvault show --name acme-xyne-livekit --query id -o tsv)"
az keyvault certificate import --vault-name acme-xyne-livekit --name livekit-signal --file livekit.pfx
az keyvault certificate show --vault-name acme-xyne-livekit --name livekit-signal --query sid --output tsv
# https://acme-xyne-livekit.vault.azure.net/secrets/livekit-signal/0123456789abcdef…
```

Then in `01-infra.tfvars`:

```hcl
livekit_key_vault_id          = "/subscriptions/3f2c1a9e-…/resourceGroups/xyne/providers/Microsoft.KeyVault/vaults/acme-xyne-livekit"
livekit_certificate_secret_id = "https://acme-xyne-livekit.vault.azure.net/secrets/livekit-signal/0123456789abcdef…"
```

The Application Gateway's identity receives `Key Vault Secrets User` on that vault. Set
`livekit_https = false` to run the signalling listener on plain HTTP (`ws://`) without a
certificate; only for testing.

**TURN over TLS** (`turn.xyne.example.com:5349`): store a PEM bundle (chain then private key)
as a Key Vault *secret* in the LiveKit vault and name it in `livekit_turn_cert_secret`:

```bash
cat fullchain.pem privkey.pem > turn-bundle.pem
az keyvault secret set --vault-name acme-xyne-livekit --name livekit-turn-cert --file turn-bundle.pem
```

## 14. Reaching the cluster

```bash
az aks get-credentials --resource-group xyne --name xyne --overwrite-existing
kubelogin convert-kubeconfig -l azurecli
kubectl get nodes
```

from any address in `aks_authorized_ip_ranges`, as the identity that applied `01-infra`
(`deployer_principal_id`) or a member of `admin_group_object_ids`. With
`enable_private_endpoint = true` the API is private: use the bastion (it has `az`, `kubectl`,
`kubelogin`, `helm`, and the `Azure Kubernetes Service Cluster User Role` on the cluster) or a
VPN into the VNet.

## 15. First login

The application signs users in with an OAuth client or by email and password; email
registration sends a verification code through the same OAuth client plus a refresh token
(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `EMAIL_FROM`). Create the
client first:

1. In the Google Cloud console, *APIs & Services → Credentials → Create credentials → OAuth
   client ID*, type *Web application*, authorized redirect URI
   `https://xyne.example.com/api/auth/exchange`, authorized JavaScript origin
   `https://xyne.example.com`.
2. In `02-platform.tfvars`:

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
4. Open `https://xyne.example.com`, sign in with an account on your organisation's domain and
   create the organisation.

`curl -sS https://xyne.example.com/api/v2/auth/providers` shows
`{"google":true,"microsoft":false,"email":true}` when the client is picked up.

## 16. Verification checklist

```bash
kubectl -n argocd get applications                                      # every row Synced / Healthy
kubectl -n xyne get pods                                                # all Running, 2/2
kubectl -n xyne exec deployment/xyne-backend -- printenv STORAGE_PROVIDER AZURE_STORAGE_ACCOUNT
kubectl -n istio-ingress get svc istio-ingressgateway                   # EXTERNAL-IP = xyne-ingress
kubectl -n istio-ingress get certificate xyne-gateway-tls               # READY True
curl -sSI https://xyne.example.com/ | head -n1                          # HTTP/2 200
curl -sS https://xyne.example.com/api/health                            # 200 with a JSON body
kubectl -n xyne logs deployment/xyne-zero-replication --tail=20         # no replication errors
az postgres flexible-server show --resource-group xyne --name acme-xyne-pg --query state -o tsv   # Ready
az redis show --resource-group xyne --name acme-xyne-redis --query provisioningState -o tsv       # Succeeded
```

The fourth line is `gateway` mode. In `cloud-lb` and `external` mode the gateway Service has no
public `EXTERNAL-IP` and that is correct: in `cloud-lb` it is an internal load balancer holding
`ingress_internal_ip`, in `external` it is a `NodePort` with no address at all. Check the edge
address the summary printed instead. In `external` mode also run
`deployment/scripts/lb-config.sh --env prod --format all` and confirm your load balancer matches
what it prints ([ingress.md](ingress.md#checking-it-works)).

With Hindsight on and claw enabled, also:

```bash
kubectl -n hindsight get pods
kubectl -n xyne get deploy xyne-claw -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="HINDSIGHT_URL")].value}'
```

The first shows the API pod Running. The second prints the address claw uses, either the
in-cluster service or the `hindsight.url` you set; nothing printed means memory is off.

Argo CD UI: `kubectl -n argocd port-forward svc/argocd-server 8080:80`, then
`http://localhost:8080`, user `admin`.

## LiveKit on Azure

Prerequisites: `ssh_public_key`, `redis_mode` `managed` or `external`, the certificate from
[TLS](#13-tls). Then:

```hcl
livekit_enabled               = true
livekit_key_vault_id          = "/subscriptions/…/vaults/acme-xyne-livekit"
livekit_certificate_secret_id = "https://acme-xyne-livekit.vault.azure.net/secrets/livekit-signal/…"
```

and `setup.sh --env prod`. `01-infra` writes `xyne-livekit-server-config` and
`xyne-livekit-egress-config` as Key Vault secrets (readable by the instances' managed identity),
creates orchestrated VM scale sets `xyne-livekit-server` (`Standard_D4s_v5`, public IP per
instance, 1–3 on 60% CPU, in `livekit_subnet_cidr`) and `xyne-livekit-egress` (in
`livekit_egress_subnet_cidr`, public IPs only when `nat_gateway_enabled = false`), NSG rules for
TCP 7880/7881, UDP 3478 and 50000–60000, an Application Gateway (`livekit_appgw_min_capacity`–
`livekit_appgw_max_capacity`) with a public IP, and DNS records when `dns_zone` is set.
`livekit_ips` in the outputs carries the signalling and TURN addresses; `livekit_key_vault` the
vault. Leaving `livekit_key_vault_id = ""` makes the stack create a vault named
`livekit_key_vault_name` (default `xyne-livekit-kv`; must be globally unique).

Enable the transcription agent to use it: `apps = { xyne-transcription-agent = { enabled = true } }`.

## Cost notes

Rough monthly shape of the defaults in `centralindia`, largest first: the `general` pool
(`Standard_D4s_v5`, 2–6 in the example), Flexible Server `GP_Standard_D2ds_v5` with zone-redundant
HA (two servers' worth), Azure Cache for Redis Standard C1, the AKS `Standard` tier fee, the NAT
gateway and its data, Blob storage (pay per GB stored and per transaction), the
public IPs. LiveKit adds two `Standard_D4s_v5` VMs and an Application Gateway v2 (a fixed hourly
charge plus capacity units), the most expensive optional line. Azure Bastion `Standard` has a
fixed hourly charge; turn it off after the one-time SQL if you do not need it.

## Known limits

- **Bastion access is Azure Bastion by default**: the VM's NSG allows SSH from the VNet only, and
  `az network bastion ssh` needs the `Standard` SKU. `bastion_allowed_ssh_cidrs` opens TCP 22 on
  the bastion subnet to the CIDRs you list, for SSH straight to the VM's public IP instead.
- **Redis AUTH is the access key**, rotated by Azure; rotating it means re-running `01-infra`
  and `02-platform` (the module reads the primary key).
- **Sandbox pool**: `node_pools.sandbox.vm_size` must be a `Dv3`/`Dsv3`/`Ev3`/`Esv3`/`Dv4`/`Ev4`
  size (`Standard_D4s_v3` default); those families expose nested virtualization. Kata is
  experimental.
- **Application Gateway v2 will not trust a backend certificate it has no root for**, so in
  `ingress_mode = "cloud-lb"` a self-signed inner certificate cannot be used. `ingress_tls`
  defaults to `existing` there: supply the inner certificate as `gateway_tls` in
  `02-platform.tfvars` and its root in `ingress_backend_root_certificate_pem`, or set
  `ingress_backend_protocol = "Http"` with `ingress_tls = "none"` (step 13).
- **LiveKit certificate must pre-exist** in Key Vault (step 13); there is no automatic issuance
  on Azure.
- **Postgres server and Redis cache names are global**; the empty defaults derive from `name`
  and will usually be taken.
