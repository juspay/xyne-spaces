locals {
  private_cluster_enabled = var.private_cluster_enabled || length(var.authorized_ip_ranges) == 0

  pool_fixed = {
    general = {
      taints                  = []
      os_sku                  = var.node_pools.general.os_sku
      local_storage_temp_disk = false
      sandbox = {
        taints = [
          { key = "workload", value = "sandbox", effect = "NoSchedule" },
        ]
        os_sku                  = "Ubuntu"
        local_storage_temp_disk = false
      }
    }
    zero = {
      taints = [
        { key = "storage-type", value = "local-ssd", effect = "NoSchedule" },
      ]
      os_sku                  = var.node_pools.zero.os_sku
      local_storage_temp_disk = var.node_pools.zero.local_storage_temp_disk
    }
    vespa = {
      taints = [
        { key = "pool", value = "vespa", effect = "NoSchedule" },
      ]
      os_sku                  = var.node_pools.vespa.os_sku
      local_storage_temp_disk = false
    }
  }

  spot_taint = { key = "kubernetes.azure.com/scalesetpriority", value = "spot", effect = "NoSchedule" }

  pools = {
    for key, fixed in local.pool_fixed : key => merge(
      {
        enabled      = var.node_pools[key].enabled
        vm_size      = var.node_pools[key].vm_size
        min_count    = var.node_pools[key].min_count
        max_count    = var.node_pools[key].max_count
        disk_size_gb = var.node_pools[key].disk_size_gb
        disk_type    = var.node_pools[key].disk_type
        spot         = var.node_pools[key].spot
        labels       = merge(var.node_pools[key].labels, { pool = key })
      },
      fixed,
    )
  }

  user_pools = { for key, pool in local.pools : key => pool if pool.enabled && key != "general" }

  node_resource_group = var.node_resource_group_name != "" ? var.node_resource_group_name : "${var.resource_group_name}-nodes"

  log_analytics_workspace_id = var.log_analytics_enabled ? (var.log_analytics_workspace_id != "" ? var.log_analytics_workspace_id : azurerm_log_analytics_workspace.this[0].id) : ""
}

resource "azurerm_user_assigned_identity" "cluster" {
  name                = "${var.name}-aks"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = var.tags
}

resource "azurerm_role_assignment" "cluster_network" {
  scope                            = var.vnet_id
  role_definition_name             = "Network Contributor"
  principal_id                     = azurerm_user_assigned_identity.cluster.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_log_analytics_workspace" "this" {
  count = var.log_analytics_enabled && var.log_analytics_workspace_id == "" ? 1 : 0

  name                = "${var.name}-aks"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_analytics_retention_days

  tags = var.tags
}

resource "azurerm_kubernetes_cluster" "this" {
  name                      = var.name
  location                  = var.location
  resource_group_name       = var.resource_group_name
  node_resource_group       = local.node_resource_group
  dns_prefix                = var.name
  kubernetes_version        = var.kubernetes_version != "" ? var.kubernetes_version : null
  sku_tier                  = var.sku_tier
  private_cluster_enabled   = local.private_cluster_enabled
  oidc_issuer_enabled       = true
  workload_identity_enabled = true
  local_account_disabled    = var.local_account_disabled
  automatic_upgrade_channel = var.automatic_upgrade_channel != "none" ? var.automatic_upgrade_channel : null
  node_os_upgrade_channel   = var.node_os_upgrade_channel
  image_cleaner_enabled     = true

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.cluster.id]
  }

  default_node_pool {
    name                         = "general"
    temporary_name_for_rotation  = "generaltmp"
    type                         = "VirtualMachineScaleSets"
    vm_size                      = local.pools.general.vm_size
    vnet_subnet_id               = var.subnet_id
    zones                        = length(var.zones) > 0 ? var.zones : null
    auto_scaling_enabled         = true
    min_count                    = local.pools.general.min_count
    max_count                    = local.pools.general.max_count
    node_count                   = local.pools.general.min_count
    os_disk_size_gb              = local.pools.general.disk_size_gb
    os_disk_type                 = local.pools.general.disk_type
    os_sku                       = local.pools.general.os_sku
    node_labels                  = local.pools.general.labels
    only_critical_addons_enabled = false

    upgrade_settings {
      max_surge = "10%"
    }

    tags = merge(var.tags, { pool = "general" })
  }

  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_data_plane  = "cilium"
    network_policy      = "cilium"
    load_balancer_sku   = "standard"
    outbound_type       = var.outbound_type
    pod_cidr            = var.pods_cidr
    service_cidr        = var.services_cidr
    dns_service_ip      = cidrhost(var.services_cidr, 10)
  }

  dynamic "api_server_access_profile" {
    for_each = !local.private_cluster_enabled ? [1] : []
    content {
      authorized_ip_ranges = var.authorized_ip_ranges
    }
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled     = var.azure_rbac_enabled
    admin_group_object_ids = length(var.admin_group_object_ids) > 0 ? var.admin_group_object_ids : null
  }

  dynamic "key_vault_secrets_provider" {
    for_each = var.key_vault_secrets_provider_enabled ? [1] : []
    content {
      secret_rotation_enabled = true
    }
  }

  dynamic "oms_agent" {
    for_each = var.log_analytics_enabled ? [1] : []
    content {
      log_analytics_workspace_id      = local.log_analytics_workspace_id
      msi_auth_for_monitoring_enabled = true
    }
  }

  dynamic "maintenance_window_auto_upgrade" {
    for_each = var.automatic_upgrade_channel != "none" ? [1] : []
    content {
      frequency   = "Weekly"
      interval    = 1
      duration    = var.maintenance_window.duration_hours
      day_of_week = var.maintenance_window.day_of_week
      start_time  = var.maintenance_window.start_time
      utc_offset  = var.maintenance_window.utc_offset
    }
  }

  dynamic "maintenance_window_node_os" {
    for_each = contains(["NodeImage", "SecurityPatch"], var.node_os_upgrade_channel) ? [1] : []
    content {
      frequency   = "Weekly"
      interval    = 1
      duration    = var.maintenance_window.duration_hours
      day_of_week = var.maintenance_window.day_of_week
      start_time  = var.maintenance_window.start_time
      utc_offset  = var.maintenance_window.utc_offset
    }
  }

  tags = var.tags

  lifecycle {
    ignore_changes = [default_node_pool[0].node_count]

    precondition {
      condition     = var.private_cluster_enabled || length(var.authorized_ip_ranges) > 0
      error_message = "authorized_ip_ranges is empty, so the API server would have no public endpoint and kubectl would only work from inside the VNet. List the ranges allowed to reach it, or set private_cluster_enabled = true to confirm that is what you want."
    }
  }

  depends_on = [azurerm_role_assignment.cluster_network]
}

resource "azurerm_kubernetes_cluster_node_pool" "this" {
  for_each = local.user_pools

  name                  = each.key
  kubernetes_cluster_id = azurerm_kubernetes_cluster.this.id
  mode                  = "User"
  vm_size               = each.value.vm_size
  vnet_subnet_id        = var.subnet_id
  zones                 = length(var.zones) > 0 ? var.zones : null
  auto_scaling_enabled  = true
  min_count             = each.value.min_count
  max_count             = each.value.max_count
  node_count            = each.value.min_count
  os_type               = "Linux"
  os_sku                = each.value.os_sku
  os_disk_size_gb       = each.value.disk_size_gb
  os_disk_type          = each.value.disk_type
  kubelet_disk_type     = each.value.local_storage_temp_disk ? "Temporary" : "OS"
  priority              = each.value.spot ? "Spot" : "Regular"
  eviction_policy       = each.value.spot ? "Delete" : null
  spot_max_price        = each.value.spot ? -1 : null
  node_labels           = each.value.labels
  node_taints           = [for t in each.value.taints : "${t.key}=${t.value}:${t.effect}"]

  upgrade_settings {
    max_surge = "10%"
  }

  tags = merge(var.tags, { pool = each.key })

  lifecycle {
    ignore_changes = [node_count]
  }
}
