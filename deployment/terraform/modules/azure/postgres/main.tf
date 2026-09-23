locals {
  server_name = var.server_name != "" ? var.server_name : "${var.name}-postgres"

  parameters = merge(
    {
      wal_level             = "logical"
      max_replication_slots = tostring(var.max_replication_slots)
      max_wal_senders       = tostring(var.max_wal_senders)
    },
    length(var.extensions) > 0 ? { "azure.extensions" = join(",", var.extensions) } : {},
    var.parameters,
  )

  databases = {
    app       = var.databases.app
    common    = var.databases.common
    zero_cvr  = var.databases.zero_cvr
    zero_cdb  = var.databases.zero_cdb
    claw_auth = var.databases.claw_auth
  }
}

resource "azurerm_postgresql_flexible_server" "primary" {
  name                = local.server_name
  location            = var.location
  resource_group_name = var.resource_group_name

  version                       = var.engine_version
  sku_name                      = var.sku_name
  storage_mb                    = var.storage_mb
  storage_tier                  = var.storage_tier != "" ? var.storage_tier : null
  auto_grow_enabled             = var.auto_grow_enabled
  zone                          = var.zone != "" ? var.zone : null
  backup_retention_days         = var.backup_retention_days
  geo_redundant_backup_enabled  = var.geo_redundant_backup
  delegated_subnet_id           = var.delegated_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  public_network_access_enabled = false

  administrator_login    = var.username
  administrator_password = var.password

  authentication {
    password_auth_enabled         = true
    active_directory_auth_enabled = false
  }

  dynamic "high_availability" {
    for_each = var.high_availability ? [1] : []
    content {
      mode                      = "ZoneRedundant"
      standby_availability_zone = var.standby_zone != "" ? var.standby_zone : null
    }
  }

  maintenance_window {
    day_of_week  = var.maintenance_window.day_of_week
    start_hour   = var.maintenance_window.start_hour
    start_minute = var.maintenance_window.start_minute
  }

  tags = var.tags

  lifecycle {
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

resource "azurerm_postgresql_flexible_server_configuration" "this" {
  for_each = local.parameters

  name      = each.key
  server_id = azurerm_postgresql_flexible_server.primary.id
  value     = each.value
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  for_each = local.databases

  name      = each.value
  server_id = azurerm_postgresql_flexible_server.primary.id
  charset   = "UTF8"
  collation = "en_US.utf8"

  depends_on = [azurerm_postgresql_flexible_server_configuration.this]
}

resource "azurerm_postgresql_flexible_server" "replica" {
  count = var.read_replica_enabled ? 1 : 0

  name                = "${local.server_name}-replica"
  location            = var.location
  resource_group_name = var.resource_group_name

  create_mode      = "Replica"
  source_server_id = azurerm_postgresql_flexible_server.primary.id

  version                       = var.engine_version
  sku_name                      = var.read_replica_sku_name != "" ? var.read_replica_sku_name : var.sku_name
  storage_mb                    = var.storage_mb
  storage_tier                  = var.storage_tier != "" ? var.storage_tier : null
  auto_grow_enabled             = var.auto_grow_enabled
  zone                          = var.read_replica_zone != "" ? var.read_replica_zone : null
  delegated_subnet_id           = var.delegated_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  public_network_access_enabled = false

  tags = var.tags

  lifecycle {
    ignore_changes = [zone, administrator_login, administrator_password, backup_retention_days, geo_redundant_backup_enabled]
  }

  depends_on = [azurerm_postgresql_flexible_server_database.this]
}
