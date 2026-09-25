data "azurerm_client_config" "current" {}

locals {
  location            = var.region
  resource_group_name = var.resource_group_name != "" ? var.resource_group_name : var.name

  postgres_managed = var.postgres_mode == "managed"
  redis_managed    = var.redis_mode == "managed"
  storage_managed  = var.storage_mode == "managed"

  storage_allowed_subnet_ids = [
    for key in ["aks", "livekit", "livekit_egress", "bastion"] :
    module.network.subnet_ids[key]
  ]

  worker_ksa_names = [for w in var.worker_names : "xyne-worker-${w}"]

  bucket_prefix = var.storage_bucket_prefix != "" ? var.storage_bucket_prefix : var.name

  cors_origins = length(var.storage_cors_origins) > 0 ? var.storage_cors_origins : ["https://${var.domain}"]

  node_pools = {
    general = merge(var.node_pools.general, { enabled = true })
    zero    = merge(var.node_pools.zero, { enabled = var.zero_pool_enabled })
    vespa   = merge(var.node_pools.vespa, { enabled = var.vespa_enabled })
    sandbox = merge(var.node_pools.sandbox, { enabled = var.sandbox_enabled })
  }

  deployer_principal_id = var.deployer_principal_id != "" ? var.deployer_principal_id : data.azurerm_client_config.current.object_id

  ingress_gateway_mode  = var.ingress_mode == "gateway"
  ingress_cloud_lb_mode = var.ingress_mode == "cloud-lb"
  ingress_external_mode = var.ingress_mode == "external"

  ingress_public_ip_enabled = local.ingress_gateway_mode && var.ingress_static_ip

  ingress_appgw_subnet_id = var.ingress_appgw_subnet_id != "" ? var.ingress_appgw_subnet_id : module.network.subnet_ids["appgw"]

  aks_subnet_prefix           = split("/", var.aks_subnet_cidr)[1]
  aks_subnet_network          = try(cidrhost(var.aks_subnet_cidr, 0), "")
  ingress_internal_ip_network = try(cidrhost("${var.ingress_internal_ip}/${local.aks_subnet_prefix}", 0), "")

  ingress_static_ip = local.ingress_public_ip_enabled ? azurerm_public_ip.ingress[0].ip_address : (
    local.ingress_cloud_lb_mode ? var.ingress_internal_ip : ""
  )

  ingress_service_type = local.ingress_external_mode ? "NodePort" : "LoadBalancer"

  ingress_node_ports = local.ingress_external_mode ? {
    http   = var.ingress_node_ports.http
    https  = var.ingress_node_ports.https
    status = var.ingress_node_ports.status
  } : {}

  ingress_default_tls = local.ingress_gateway_mode ? "acme" : (local.ingress_cloud_lb_mode ? "existing" : "")
  ingress_tls         = var.ingress_tls != "" ? var.ingress_tls : local.ingress_default_tls

  ingress_edge_ip       = local.ingress_cloud_lb_mode ? module.ingress.ip : ""
  ingress_edge_hostname = local.ingress_cloud_lb_mode ? module.ingress.fqdn : ""

  ingress_dns_target = local.ingress_cloud_lb_mode ? module.ingress.ip : (
    local.ingress_public_ip_enabled ? azurerm_public_ip.ingress[0].ip_address : ""
  )

  ingress_dns_records = local.dns_enabled && (local.ingress_public_ip_enabled || local.ingress_cloud_lb_mode)

  lb_annotations = local.ingress_external_mode ? {} : local.ingress_cloud_lb_mode ? {
    "service.beta.kubernetes.io/azure-load-balancer-internal"       = "true"
    "service.beta.kubernetes.io/azure-load-balancer-ipv4"           = var.ingress_internal_ip
    "service.beta.kubernetes.io/azure-load-balancer-resource-group" = module.network.resource_group_name
    } : merge(
    {
      "service.beta.kubernetes.io/azure-load-balancer-resource-group" = module.network.resource_group_name
    },
    local.ingress_public_ip_enabled ? {
      "service.beta.kubernetes.io/azure-pip-name" = azurerm_public_ip.ingress[0].name
    } : {},
  )

  dns_enabled             = var.dns_zone != ""
  dns_zone_resource_group = var.dns_zone_resource_group != "" ? var.dns_zone_resource_group : local.resource_group_name
  domain_prefix           = trimsuffix(trimsuffix(var.domain, var.dns_zone), ".")
  apex_record_name        = local.domain_prefix == "" ? "@" : local.domain_prefix
  wildcard_record_name    = local.domain_prefix == "" ? "*" : "*.${local.domain_prefix}"
}

module "contract" {
  source = "../../../modules/contract"

  postgres_mode         = var.postgres_mode
  redis_mode            = var.redis_mode
  storage_mode          = var.storage_mode
  namespace             = var.namespace
  region                = var.region
  name                  = var.name
  postgres_username     = var.postgres_username
  postgres_databases    = var.postgres_databases
  external_postgres     = var.external_postgres
  external_redis        = var.external_redis
  external_storage      = var.external_storage
  storage_bucket_prefix = local.bucket_prefix
  storage_bucket_names  = var.storage_bucket_names
  redis_auth            = var.redis_auth
  storage_credentials   = var.storage_credentials
  livekit_enabled       = var.livekit_enabled

  managed_postgres            = one(module.postgres[*].postgres)
  managed_redis               = one(module.redis[*].redis)
  managed_redis_auth          = one(module.redis[*].redis_auth)
  managed_storage             = one(module.storage[*].storage)
  managed_storage_credentials = one(module.storage[*].storage_credentials)
}

resource "terraform_data" "inputs" {
  lifecycle {
    precondition {
      condition     = !local.storage_managed || var.storage_account_name != ""
      error_message = "storage_account_name is required when storage_mode is managed; storage account names are global, 3 to 24 lowercase letters and digits."
    }

    precondition {
      condition     = !local.dns_enabled || endswith(var.domain, var.dns_zone)
      error_message = "domain must be the dns_zone name or a subdomain of it when dns_zone is set."
    }

    precondition {
      condition     = !local.ingress_cloud_lb_mode || var.ingress_internal_ip != ""
      error_message = "ingress_internal_ip is required when ingress_mode is cloud-lb; it is the fixed private address the internal load balancer in front of the gateway service takes, and the application gateway backend."
    }

    precondition {
      condition     = !local.ingress_cloud_lb_mode || var.ingress_internal_ip == "" || local.ingress_internal_ip_network == local.aks_subnet_network
      error_message = "ingress_internal_ip must be an address inside aks_subnet_cidr (${var.aks_subnet_cidr}); an internal Azure load balancer takes its frontend address from the subnet the cluster nodes sit in."
    }
  }
}

module "network" {
  source = "../../../modules/azure/network"

  location                      = local.location
  name                          = var.name
  resource_group_name           = local.resource_group_name
  create_resource_group         = var.create_resource_group
  vnet_cidr                     = var.vnet_cidr
  aks_subnet_cidr               = var.aks_subnet_cidr
  postgres_subnet_cidr          = var.postgres_subnet_cidr
  private_endpoints_subnet_cidr = var.private_endpoints_subnet_cidr
  livekit_subnet_cidr           = var.livekit_subnet_cidr
  livekit_egress_subnet_cidr    = var.livekit_egress_subnet_cidr
  bastion_subnet_cidr           = var.bastion_subnet_cidr
  bastion_allowed_ssh_cidrs     = var.bastion_allowed_ssh_cidrs
  azure_bastion_subnet_cidr     = var.azure_bastion_subnet_cidr
  appgw_subnet_cidr             = var.appgw_subnet_cidr
  azure_bastion_enabled         = var.bastion_enabled && var.azure_bastion_enabled
  nat_gateway_enabled           = var.nat_gateway_enabled
  nat_public_ip_prefix_length   = var.nat_public_ip_prefix_length
  aks_inbound_ports             = var.aks_inbound_ports
  livekit_port_range_start      = var.livekit_port_range_start
  livekit_port_range_end        = var.livekit_port_range_end
  tags                          = var.tags
}

module "bastion" {
  source = "../../../modules/azure/bastion"

  location                = local.location
  name                    = var.name
  resource_group_name     = module.network.resource_group_name
  enabled                 = var.bastion_enabled
  subnet_id               = module.network.subnet_ids["bastion"]
  vm_size                 = var.bastion_vm_size
  ssh_public_key          = var.ssh_public_key
  public_ip_enabled       = var.bastion_public_ip
  azure_bastion_enabled   = var.azure_bastion_enabled
  azure_bastion_subnet_id = module.network.azure_bastion_subnet_id
  azure_bastion_sku       = var.azure_bastion_sku
  tags                    = var.tags
}

module "cluster" {
  source = "../../../modules/azure/cluster"

  location                           = local.location
  name                               = var.name
  resource_group_name                = module.network.resource_group_name
  vnet_id                            = module.network.vnet_id
  subnet_id                          = module.network.subnet_ids["aks"]
  kubernetes_version                 = var.kubernetes_version
  sku_tier                           = var.cluster_sku_tier
  private_cluster_enabled            = var.enable_private_endpoint
  authorized_ip_ranges               = var.aks_authorized_ip_ranges
  pods_cidr                          = var.pods_cidr
  services_cidr                      = var.services_cidr
  outbound_type                      = var.nat_gateway_enabled ? "userAssignedNATGateway" : "loadBalancer"
  azure_rbac_enabled                 = var.azure_rbac_enabled
  admin_group_object_ids             = var.admin_group_object_ids
  local_account_disabled             = var.local_account_disabled
  key_vault_secrets_provider_enabled = var.key_vault_secrets_provider
  log_analytics_enabled              = var.cluster_logging
  log_analytics_workspace_id         = var.log_analytics_workspace_id
  log_analytics_retention_days       = var.cluster_log_retention_days
  automatic_upgrade_channel          = var.automatic_upgrade_channel
  node_os_upgrade_channel            = var.node_os_upgrade_channel
  maintenance_window                 = var.maintenance_window
  zones                              = var.zones
  node_pools                         = local.node_pools
  tags                               = var.tags

  depends_on = [module.network]
}

resource "azurerm_role_assignment" "deployer_cluster_user" {
  scope                = module.cluster.id
  role_definition_name = "Azure Kubernetes Service Cluster User Role"
  principal_id         = local.deployer_principal_id
}

resource "azurerm_role_assignment" "deployer_cluster_admin" {
  count = var.azure_rbac_enabled ? 1 : 0

  scope                = module.cluster.id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = local.deployer_principal_id
}

resource "azurerm_role_assignment" "bastion_cluster_user" {
  count = var.bastion_enabled ? 1 : 0

  scope                            = module.cluster.id
  role_definition_name             = "Azure Kubernetes Service Cluster User Role"
  principal_id                     = module.bastion.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

module "postgres" {
  count  = local.postgres_managed ? 1 : 0
  source = "../../../modules/azure/postgres"

  location              = local.location
  name                  = var.name
  server_name           = var.postgres_server_name
  resource_group_name   = module.network.resource_group_name
  delegated_subnet_id   = module.network.subnet_ids["postgres"]
  private_dns_zone_id   = module.network.private_dns_zone_ids["postgres"]
  engine_version        = var.postgres_engine_version
  sku_name              = var.postgres_sku_name
  storage_mb            = var.postgres_storage_mb
  storage_tier          = var.postgres_storage_tier
  auto_grow_enabled     = var.postgres_storage_autogrow
  high_availability     = var.postgres_high_availability
  zone                  = var.postgres_zone
  standby_zone          = var.postgres_standby_zone
  backup_retention_days = var.postgres_backup_retention_days
  geo_redundant_backup  = var.postgres_geo_redundant_backup
  maintenance_window    = var.postgres_maintenance_window
  parameters            = var.postgres_parameters
  extensions            = var.postgres_extensions
  max_replication_slots = var.postgres_max_replication_slots
  max_wal_senders       = var.postgres_max_wal_senders
  read_replica_enabled  = var.postgres_read_replica
  read_replica_sku_name = var.postgres_read_replica_sku_name
  read_replica_zone     = var.postgres_read_replica_zone
  databases             = var.postgres_databases
  username              = var.postgres_username
  password              = var.postgres_password
  tags                  = var.tags

  depends_on = [module.network]
}

module "redis" {
  count  = local.redis_managed ? 1 : 0
  source = "../../../modules/azure/redis"

  location                   = local.location
  name                       = var.name
  cache_name                 = var.redis_cache_name
  resource_group_name        = module.network.resource_group_name
  private_endpoint_subnet_id = module.network.subnet_ids["private_endpoints"]
  private_dns_zone_id        = module.network.private_dns_zone_ids["redis"]
  sku_name                   = var.redis_sku_name
  capacity                   = var.redis_capacity
  redis_version              = var.redis_version
  replicas_per_primary       = var.redis_replicas_per_primary
  zones                      = var.zones
  maxmemory_policy           = var.redis_maxmemory_policy
  patch_schedule             = var.redis_patch_schedule
  tags                       = var.tags

  depends_on = [module.network]
}

module "storage" {
  count  = local.storage_managed ? 1 : 0
  source = "../../../modules/azure/storage"

  location                      = local.location
  resource_group_name           = module.network.resource_group_name
  account_name                  = var.storage_account_name
  prefix                        = local.bucket_prefix
  bucket_names                  = var.storage_bucket_names
  replication_type              = var.storage_replication_type
  access_tier                   = var.storage_access_tier
  versioning                    = var.storage_versioning
  shared_access_key_enabled     = var.storage_shared_access_key_enabled
  delete_retention_days         = var.storage_delete_retention_days
  public_network_access_enabled = var.storage_public_network_access
  network_default_action        = var.storage_network_default_action
  allowed_ip_ranges             = var.storage_allowed_ip_ranges
  allowed_subnet_ids            = local.storage_allowed_subnet_ids
  private_endpoint_enabled      = var.storage_private_endpoint
  private_endpoint_subnet_id    = module.network.subnet_ids["private_endpoints"]
  private_dns_zone_id           = module.network.private_dns_zone_ids["blob"]
  lifecycle_rules               = var.storage_lifecycle_rules
  cors = {
    origins = local.cors_origins
  }
  tags = var.tags

  depends_on = [module.network]
}

module "iam" {
  source = "../../../modules/azure/iam"

  location            = local.location
  name                = var.name
  resource_group_name = module.network.resource_group_name
  namespace           = var.namespace
  oidc_issuer_url     = module.cluster.oidc_issuer_url
  worker_names        = var.worker_names
  container_ids       = local.storage_managed ? module.storage[0].container_ids : {}
  tags                = var.tags
}

module "livekit" {
  source = "../../../modules/azure/livekit"

  location                   = local.location
  name                       = var.name
  resource_group_name        = module.network.resource_group_name
  domain                     = var.domain
  enabled                    = var.livekit_enabled
  subnet_id                  = module.network.subnet_ids["livekit"]
  egress_subnet_id           = module.network.subnet_ids["livekit_egress"]
  appgw_subnet_id            = module.network.subnet_ids["appgw"]
  egress_public_ip           = !var.nat_gateway_enabled
  redis                      = module.contract.redis
  redis_auth                 = module.contract.redis_auth
  api_key                    = var.livekit_api_key
  api_secret                 = var.livekit_api_secret
  server_image               = var.livekit_server_image
  egress_image               = var.livekit_egress_image
  vm_image                   = var.livekit_vm_image
  vm_size                    = var.livekit_vm_size
  egress_vm_size             = var.livekit_egress_vm_size
  admin_username             = var.livekit_admin_username
  ssh_public_key             = var.ssh_public_key
  disk_size_gb               = var.livekit_disk_size_gb
  zones                      = var.zones
  min_replicas               = var.livekit_min_replicas
  max_replicas               = var.livekit_max_replicas
  target_cpu_utilization     = var.livekit_target_cpu_utilization
  egress_min_replicas        = var.livekit_egress_min_replicas
  egress_max_replicas        = var.livekit_egress_max_replicas
  port_range_start           = var.livekit_port_range_start
  port_range_end             = var.livekit_port_range_end
  key_vault_id               = var.livekit_key_vault_id
  key_vault_name             = var.livekit_key_vault_name
  key_vault_purge_protection = var.livekit_key_vault_purge_protection
  turn_cert_secret           = var.livekit_turn_cert_secret
  https_enabled              = var.livekit_https
  certificate_secret_id      = var.livekit_certificate_secret_id
  certificate_key_vault_id   = var.livekit_certificate_key_vault_id
  appgw_min_capacity         = var.livekit_appgw_min_capacity
  appgw_max_capacity         = var.livekit_appgw_max_capacity
  dns_zone                   = var.dns_zone
  dns_zone_resource_group    = var.dns_zone_resource_group
  tags                       = var.tags

  depends_on = [module.network]
}

module "ingress" {
  source = "../../../modules/azure/ingress"

  location                        = local.location
  name                            = var.name
  resource_group_name             = module.network.resource_group_name
  enabled                         = local.ingress_cloud_lb_mode
  domain                          = var.domain
  subnet_id                       = local.ingress_appgw_subnet_id
  backend_ip                      = var.ingress_internal_ip
  backend_protocol                = var.ingress_backend_protocol
  backend_root_certificate_pem    = var.ingress_backend_root_certificate_pem
  request_timeout                 = var.ingress_request_timeout
  probe_path                      = var.ingress_probe_path
  probe_port                      = var.ingress_probe_port
  probe_status_codes              = var.ingress_probe_status_codes
  http_redirect                   = var.ingress_http_redirect
  certificate_key_vault_secret_id = var.ingress_certificate_key_vault_secret_id
  certificate_key_vault_id        = var.ingress_certificate_key_vault_id
  certificate_pfx_data            = var.ingress_certificate_pfx_data
  certificate_pfx_password        = var.ingress_certificate_pfx_password
  sku_name                        = var.ingress_appgw_sku.name
  sku_tier                        = var.ingress_appgw_sku.tier
  min_capacity                    = var.ingress_appgw_capacity.min
  max_capacity                    = var.ingress_appgw_capacity.max
  zones                           = var.zones
  waf_enabled                     = var.ingress_waf_enabled
  domain_name_label               = var.ingress_appgw_domain_name_label
  tags                            = var.tags

  depends_on = [module.network]
}

resource "azurerm_public_ip" "ingress" {
  count = local.ingress_public_ip_enabled ? 1 : 0

  name                = "${var.name}-ingress"
  location            = local.location
  resource_group_name = module.network.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = length(var.zones) > 0 ? var.zones : null

  tags = var.tags
}

resource "azurerm_role_assignment" "cluster_ingress_network" {
  scope                            = module.network.resource_group_id
  role_definition_name             = "Network Contributor"
  principal_id                     = module.cluster.identity_principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

data "azurerm_dns_zone" "this" {
  count = local.dns_enabled ? 1 : 0

  name                = var.dns_zone
  resource_group_name = local.dns_zone_resource_group
}

resource "azurerm_dns_a_record" "apex" {
  count = local.ingress_dns_records ? 1 : 0

  name                = local.apex_record_name
  zone_name           = data.azurerm_dns_zone.this[0].name
  resource_group_name = local.dns_zone_resource_group
  ttl                 = 300
  records             = [local.ingress_dns_target]

  tags = var.tags
}

resource "azurerm_dns_a_record" "wildcard" {
  count = local.ingress_dns_records ? 1 : 0

  name                = local.wildcard_record_name
  zone_name           = data.azurerm_dns_zone.this[0].name
  resource_group_name = local.dns_zone_resource_group
  ttl                 = 300
  records             = [local.ingress_dns_target]

  tags = var.tags
}
