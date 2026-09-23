locals {
  cache_name = var.cache_name != "" ? var.cache_name : "${var.name}-redis"
  premium    = var.sku_name == "Premium"
  family     = local.premium ? "P" : "C"
}

resource "azurerm_redis_cache" "this" {
  name                = local.cache_name
  location            = var.location
  resource_group_name = var.resource_group_name

  sku_name             = var.sku_name
  family               = local.family
  capacity             = var.capacity
  redis_version        = var.redis_version
  replicas_per_primary = local.premium ? var.replicas_per_primary : null
  zones                = local.premium && length(var.zones) > 0 ? var.zones : null

  minimum_tls_version           = "1.2"
  non_ssl_port_enabled          = false
  public_network_access_enabled = false

  redis_configuration {
    authentication_enabled                  = true
    active_directory_authentication_enabled = false
    maxmemory_policy                        = var.maxmemory_policy
  }

  patch_schedule {
    day_of_week    = var.patch_schedule.day_of_week
    start_hour_utc = var.patch_schedule.start_hour_utc
  }

  tags = var.tags
}

resource "azurerm_private_endpoint" "this" {
  name                = "${local.cache_name}-pe"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.private_endpoint_subnet_id

  private_service_connection {
    name                           = "${local.cache_name}-pe"
    private_connection_resource_id = azurerm_redis_cache.this.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "redis"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }

  tags = var.tags
}
