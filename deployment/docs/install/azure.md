# Azure

The Azure-specific parts of the [install guide](README.md). Follow that page; it sends you here
for the subscription, the files and the checks that only exist on Azure.

- [What gets built](#what-gets-built)
- [Prepare the subscription](#prepare-the-subscription)
- [`env.conf`](#envconf)
- [`01-infra.tfvars`](#01-infratfvars)
- [DNS on Azure](#dns-on-azure)
- [Certificates](#certificates)
- [`02-platform.tfvars` on Azure](#02-platformtfvars-on-azure)
- [What setup does on Azure](#what-setup-does-on-azure)
- [The databases](#the-databases)
- [Reaching the cluster](#reaching-the-cluster)
- [LiveKit on Azure](#livekit-on-azure)
- [Azure checks](#azure-checks)
- [Cost](#cost)
- [Known limits](#known-limits)

Examples use region `centralindia`, resource group `xyne` and office network `203.0.113.0/24`.

## What gets built

| Piece | Azure product |
|---|---|
| Resource group | created by `01-infra` (`create_resource_group = true`); nodes in `xyne-nodes` |
| Network | VNet `10.10.0.0/16` with subnets for AKS, Postgres (delegated), private endpoints, LiveKit, LiveKit egress, bastion, Azure Bastion and Application Gateway; an NSG per subnet; a NAT gateway with a public IP prefix; private DNS zones for Postgres, Redis and Blob |
| Cluster | AKS with Azure CNI overlay and Cilium (enforces NetworkPolicy; pods `10.20.0.0/16`, services `10.30.0.0/20`), `Standard` tier, Azure RBAC, workload identity and the OIDC issuer, automatic `patch` upgrades, a weekly maintenance window, one node pool per enabled pool (`Standard_D4s_v5` 1 to 5 for `general`, zones 1 to 3) |
| Postgres | Flexible Server 16, `GP_Standard_D2ds_v5`, 32 GB with autogrow, zone-redundant HA, 7-day backups, `wal_level=logical`, the five databases, admin `xyne` |
| Redis | Azure Cache for Redis 6, `Standard` C1, TLS on 6380, a private endpoint; the access key is the AUTH token |
| Object storage | one storage account (`Standard_ZRS`, TLS 1.2, no public blob access, 7-day soft delete) with a private container per bucket; each app's identity gets `Storage Blob Data Contributor` or `Reader` on its containers, so no account key is handed out |
| Identities | one user-assigned managed identity per app with a federated credential on the AKS OIDC issuer |
| Ingress | in the default `gateway` mode, a `Standard` static public IP `xyne-ingress` for the gateway Service, and `Network Contributor` for the cluster identity on the resource group; `cloud-lb` builds an Application Gateway in front of an internal load balancer, `external` builds none |
| DNS | `A` records for the apex and wildcard in your Azure DNS zone when `dns_zone` is set |
| Bastion (off by default) | one `Standard_B2s` VM with `psql`, `redis-cli`, `az`, `kubectl`, `kubelogin` and `helm`, reached through Azure Bastion or over SSH from `bastion_allowed_ssh_cidrs` |
| LiveKit (off by default) | two VM scale sets, an Application Gateway with a Key Vault certificate, public IPs, a Key Vault for the configuration ([below](#livekit-on-azure)) |
| State | a storage account (ZRS, versioning) with a container |

Wall-clock time: 30 to 45 minutes for `01-infra` (Flexible Server with HA 15 to 20, Azure Cache
for Redis 15 to 20, AKS about 10, in parallel), 5 to 10 minutes for `02-platform`, 10 to 20 for
Argo CD.

## Prepare the subscription

The Azure CLI and `kubelogin`, on macOS `brew install azure-cli Azure/kubelogin/kubelogin`, on
Debian or Ubuntu:

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
sudo az aks install-cli --install-location /usr/local/bin/kubectl --kubelogin-install-location /usr/local/bin/kubelogin
```

Then:

```bash
az login
az account set --subscription <subscription id>
az account show --output table
az ad signed-in-user show --query id --output tsv      # your object id
```

**Permissions.** `Owner` on the subscription, or `Contributor` plus `User Access Administrator`:
`01-infra` creates role assignments (cluster user and admin for you, `Network Contributor` for the
cluster identity, Storage Blob Data roles for the app identities, Key Vault roles for LiveKit).
Add `DNS Zone Contributor` on the zone's resource group.

**Resource providers**, once per subscription:

```bash
for ns in Microsoft.ContainerService Microsoft.DBforPostgreSQL Microsoft.Cache Microsoft.Storage \
          Microsoft.Network Microsoft.Compute Microsoft.KeyVault Microsoft.ManagedIdentity \
          Microsoft.OperationalInsights Microsoft.Authorization; do
  az provider register --namespace "$ns"
done
az provider list --query "[?registrationState!='Registered' && namespace in ['Microsoft.ContainerService','Microsoft.DBforPostgreSQL','Microsoft.Cache']].namespace" -o tsv   # empty when done
```

**Quota**: `Standard DSv5 Family vCPUs` for the `general` pool, `Standard DDSv5` for Postgres, and
a public IP prefix for NAT: `az vm list-usage --location centralindia --output table | grep -i dsv5`.

**SSH key**: Azure requires one on every Linux VM, so the bastion and LiveKit need
`ssh_public_key` even though sign-in uses Entra ID:
`ssh-keygen -t ed25519 -f ~/.ssh/xyne-prod -N ''`.

## `env.conf`

```
CLOUD=azure
SUBSCRIPTION_ID=<subscription id>
LOCATION=centralindia
STATE_RESOURCE_GROUP=acme-tfstate
STATE_STORAGE_ACCOUNT=acmexynetfstate
STATE_CONTAINER=tfstate
STATE_PREFIX=xyne
```

`SUBSCRIPTION_ID` is exported as `ARM_SUBSCRIPTION_ID` and selected with `az account set`. The
state resource group, storage account (`Standard_ZRS`, TLS 1.2, no public blob access,
versioning) and container are created in `LOCATION` if missing. Storage account names are global:
3 to 24 lowercase letters and digits.

## `01-infra.tfvars`

```hcl
subscription_id     = "<subscription id>"
region              = "centralindia"
resource_group_name = "xyne"
name                = "xyne"
domain              = "xyne.example.com"

namespace               = "xyne-apps"
dns_zone                = "xyne.example.com"
dns_zone_resource_group = "acme-dns"
worker_names            = ["default"]
zones                   = ["1", "2", "3"]
ssh_public_key          = "ssh-ed25519 AAAA… ops@example.com"

aks_authorized_ip_ranges = ["203.0.113.0/24"]

postgres_mode        = "managed"
postgres_server_name = "acme-xyne-pg"
redis_mode           = "managed"
redis_cache_name     = "acme-xyne-redis"
storage_mode         = "managed"
storage_account_name = "acmexynestorage"
```

The variables that only exist on Azure, or behave differently here:

| Variable | Meaning |
|---|---|
| `aks_authorized_ip_ranges` | who may reach the Kubernetes API. Empty makes the cluster private |
| `dns_zone`, `dns_zone_resource_group` | the zone *name* and its resource group, which must exist before `01-infra` |
| `postgres_server_name`, `redis_cache_name`, `storage_account_name` | globally unique names. The defaults derive from `name` and are usually taken, so set them |
| `ssh_public_key` | required with the bastion or LiveKit |
| `storage_network_default_action`, `storage_allowed_ip_ranges`, `storage_private_endpoint` | the storage account denies network access except from the install's subnets; add any outside address that needs the blobs, such as a CI runner uploading dashboard bundles, or take the account off the internet with a private endpoint ([security](../concepts/security.md#object-storage)) |
| `storage_shared_access_key_enabled` | `false` is safe: the apps sign in with their workload identity (`STORAGE_PROVIDER=azure`, `AZURE_STORAGE_ACCOUNT`) |
| `resource_group_name`, `create_resource_group`, `zones`, `tags` | the resource group (defaults to `name`, created unless told otherwise), the availability zones for node pools, Postgres HA and the ingress IP, and tags on every resource |
| `nat_gateway_enabled` | outbound through a NAT gateway; with `false` AKS uses its load balancer and LiveKit egress VMs get public IPs |
| `bastion_enabled`, `azure_bastion_enabled`, `azure_bastion_sku`, `bastion_allowed_ssh_cidrs` | the bastion VM's SSH port is open only inside the VNet, so reaching it means Azure Bastion (`Standard` SKU for `az network bastion ssh`), or listing office or VPN ranges in `bastion_allowed_ssh_cidrs` for direct SSH |
| `deployer_principal_id`, `admin_group_object_ids` | who gets cluster user and admin; empty means the identity running Terraform |
| `node_pools` | a `zero` pool with `local_storage_temp_disk = true` needs a `d` size (`Standard_E4ds_v5`); the `sandbox` pool needs a v3/v4 D or E size |
| `ingress_internal_ip` | required in `cloud-lb` mode: the private address, inside `aks_subnet_cidr`, of the internal load balancer the Application Gateway targets |
| `ingress_certificate_key_vault_secret_id` (with `ingress_certificate_key_vault_id`), or `ingress_certificate_pfx_data` and `ingress_certificate_pfx_password` | the edge certificate in `cloud-lb` mode |

There is no GPU pool on Azure yet. The
[configuration reference](../reference/configuration.md#azure-01-infra) lists every variable.

## `02-platform.tfvars` on Azure

Besides the shared variables and the state settings `setup.sh` fills in, Azure has
`kubelogin_login`: how the Terraform providers authenticate to AKS. `azurecli` (the default)
reuses your `az login`; `spn`, `msi` or `workloadidentity` suit automation, with their flags in
`kubelogin_extra_args`. `aks_aad_server_id` rarely needs changing.

## DNS on Azure

With `dns_zone` set, `01-infra` writes `A` records `@` and `*` (or `<prefix>` and `*.<prefix>`
when `domain` is a subdomain of the zone) to the `xyne-ingress` IP and, with LiveKit, `livekit.`
and `turn.`. `domain` must equal the zone or be under it. `dns.sh` creates the zone and prints its
name servers:

```bash
az group create --name acme-dns --location centralindia
deployment/scripts/dns.sh --env prod zone
deployment/scripts/dns.sh --env prod status
```

Without `dns_zone`, `setup.sh` prints the records to create; the LiveKit addresses are in
`terraform -chdir=deployment/terraform/stacks/azure/01-infra output livekit_ips`. In `cloud-lb`
mode the apex and wildcard point at the Application Gateway's public IP, which Terraform writes
itself when `dns_zone` is set.

## Certificates

- **The application**: cert-manager issues `xyne-gateway-tls` once `domain` resolves to the
  gateway IP. In `cloud-lb` mode the edge is an Application Gateway, which **will not trust a
  backend certificate it has no root for**, so `ingress_tls` defaults to `existing` there: give
  the inner certificate as `gateway_tls` in `02-platform.tfvars` and its root as
  `ingress_backend_root_certificate_pem`, or drop the inner TLS with
  `ingress_backend_protocol = "Http"` and `ingress_tls = "none"`
  ([ingress](../concepts/ingress.md#cloud-lb)).
- **LiveKit signalling** needs a certificate in Key Vault *before* `01-infra` runs:

  ```bash
  az keyvault create --name acme-xyne-livekit --resource-group xyne --location centralindia --enable-rbac-authorization true
  az role assignment create --assignee "$(az ad signed-in-user show --query id -o tsv)" \
    --role "Key Vault Certificates Officer" --scope "$(az keyvault show --name acme-xyne-livekit --query id -o tsv)"
  az keyvault certificate import --vault-name acme-xyne-livekit --name livekit-signal --file livekit.pfx
  az keyvault certificate show --vault-name acme-xyne-livekit --name livekit-signal --query sid --output tsv
  ```

  and set `livekit_key_vault_id` (the vault's resource id) and `livekit_certificate_secret_id`
  (the versionless id, so a renewed version is picked up). The Application Gateway's identity
  gets `Key Vault Secrets User` on that vault. `livekit_https = false` runs signalling on plain
  `ws://` without a certificate, for testing only.
- **TURN over TLS** is optional: store the PEM bundle as a secret in the LiveKit vault and name it
  in `livekit_turn_cert_secret` ([calls](../features/calls.md#turn-over-tls)).

## What setup does on Azure

The steps in [step 10](README.md#10-run-the-setup), with the Azure specifics:

1. **State backend**: `az account set`, then `az group create`, `az storage account create`, blob
   versioning and `az storage container create --auth-mode login`, as needed.
2. **Ingress addresses**: a targeted apply reserves the ingress public IP, the records are
   printed and the run waits for DNS; in `external` mode it prints the names and waits.
3. **01-infra**: a plan of roughly 130 resources; Flexible Server HA and the Redis cache are the
   slow ones.
4. **kubeconfig**: `az aks get-credentials --resource-group xyne --name xyne --overwrite-existing`
   and `kubelogin convert-kubeconfig -l azurecli`.
5. **Waiting for Argo CD**: `platform-config` turns `Healthy` once the certificate is issued, a
   few minutes after the gateway gets its IP when `dns_zone` is set.

## The databases

Flexible Server creates the five databases, but the admin role lacks `REPLICATION`. The
`xyne-db-init` Job in `02-platform` grants it (`ALTER ROLE CURRENT_USER WITH REPLICATION`) before
any app starts.

With an external database, or when the Job failed
(`kubectl -n xyne-apps logs job/xyne-db-init`), run it yourself, from inside the cluster:

```bash
DATABASE_URL="$(kubectl -n xyne-apps get secret xyne-backend-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d)"
kubectl -n xyne-apps run psql --rm -it --restart=Never --image=postgres:16 \
  --overrides='{"metadata":{"annotations":{"sidecar.istio.io/inject":"false"}}}' \
  -- psql "$DATABASE_URL" -c 'ALTER ROLE xyne WITH REPLICATION;'
```

or from the bastion (`bastion_enabled`, `azure_bastion_enabled`, `azure_bastion_sku = "Standard"`):

```bash
VM_ID="$(az vm show --resource-group xyne --name xyne-bastion --query id --output tsv)"
az network bastion ssh --name xyne-azure-bastion --resource-group xyne \
  --target-resource-id "$VM_ID" --auth-type ssh-key --username xyne --ssh-key ~/.ssh/xyne-prod
psql "host=acme-xyne-pg.postgres.database.azure.com user=xyne dbname=xyne sslmode=require" -c 'ALTER ROLE xyne WITH REPLICATION;'
```

Then `kubectl -n xyne-apps rollout restart deploy/xyne-zero-replication`.

## Reaching the cluster

```bash
az aks get-credentials --resource-group xyne --name xyne --overwrite-existing
kubelogin convert-kubeconfig -l azurecli
kubectl get nodes
```

works from `aks_authorized_ip_ranges`, as the identity that applied `01-infra`
(`deployer_principal_id`) or a member of `admin_group_object_ids`. With a private cluster, use the
bastion (it has `az`, `kubectl`, `kubelogin`, `helm` and the `Azure Kubernetes Service Cluster
User Role` on the cluster) through Azure Bastion (`Standard` SKU for `az network bastion ssh`),
SSH from `bastion_allowed_ssh_cidrs`, or a VPN into the VNet.

## LiveKit on Azure

Prerequisites: `ssh_public_key`, `redis_mode` `managed` or `external`, and the certificate from
[Certificates](#certificates). With `livekit_enabled = true` ([calls](../features/calls.md)),
`01-infra`:

- writes `xyne-livekit-server-config` and `xyne-livekit-egress-config` as Key Vault secrets,
  readable by the instances' managed identity. Leaving `livekit_key_vault_id = ""` makes it create
  a vault named `livekit_key_vault_name` (default `xyne-livekit-kv`, globally unique);
- creates the VM scale sets `xyne-livekit-server` (`Standard_D4s_v5`, a public IP per instance, 1
  to 3 on 60% CPU, in `livekit_subnet_cidr`) and `xyne-livekit-egress` (in
  `livekit_egress_subnet_cidr`, public IPs only when `nat_gateway_enabled = false`);
- opens NSG rules for TCP 7880 and 7881, UDP 3478 and 50000–60000;
- builds an Application Gateway (`livekit_appgw_min_capacity` to `livekit_appgw_max_capacity`)
  with a public IP, and DNS records when `dns_zone` is set.

`livekit_ips` in the outputs carries the signalling and TURN addresses, `livekit_key_vault` the
vault. After a configuration change, restart the scale sets
([calls](../features/calls.md#changing-the-configuration-or-the-keys)).

## Azure checks

After [step 11](README.md#11-check-the-install-and-sign-in):

```bash
kubectl -n xyne-apps exec deploy/xyne-backend -- printenv STORAGE_PROVIDER AZURE_STORAGE_ACCOUNT
kubectl -n istio-ingress get svc istio-ingressgateway      # EXTERNAL-IP is xyne-ingress
az postgres flexible-server show --resource-group xyne --name acme-xyne-pg --query state -o tsv   # Ready
az redis show --resource-group xyne --name acme-xyne-redis --query provisioningState -o tsv       # Succeeded
```

## Cost

Largest first, for the defaults: the `general` pool, Flexible Server with zone-redundant HA (two
servers' worth), Azure Cache for Redis Standard C1, the AKS `Standard` tier fee, the NAT gateway,
Blob storage, the public IPs. LiveKit adds two `Standard_D4s_v5` VMs and an Application Gateway
v2 (a fixed hourly charge plus capacity units), the most expensive optional line. Azure Bastion
`Standard` has an hourly charge; turn it off when you no longer need it.

## Known limits

- **Redis AUTH is the cache's access key**; rotating it means re-running both stages.
- **The sandbox pool** must be a `Dv3`, `Dsv3`, `Ev3`, `Esv3`, `Dv4` or `Ev4` size, the families
  with nested virtualization.
- **No GPU pool** yet on Azure.
- **The LiveKit certificate must exist in Key Vault** first; nothing issues it for you.
- **Global names** for the Postgres server, Redis cache and storage account.
