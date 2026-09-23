locals {
  keys = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]

  names = {
    for key in local.keys : key => lookup(var.bucket_names, key, "${var.prefix}-${key}")
  }

  cors_enabled = length(var.cors.origins) > 0

  network_rules_enabled = var.network_default_action == "Deny" || length(var.allowed_ip_ranges) > 0 || length(var.allowed_subnet_ids) > 0

  lifecycle_rules = [
    for rule in var.lifecycle_rules : merge(rule, {
      prefix_match = length(rule.prefixes) > 0 ? flatten([for name in values(local.names) : [for p in rule.prefixes : "${name}/${p}"]]) : values(local.names)
    })
  ]

  private_endpoint_count = var.private_endpoint_enabled ? 1 : 0
}

resource "azurerm_storage_account" "this" {
  name                = var.account_name
  location            = var.location
  resource_group_name = var.resource_group_name

  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = var.replication_type
  access_tier              = var.access_tier

  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = var.shared_access_key_enabled
  default_to_oauth_authentication = !var.shared_access_key_enabled
  public_network_access_enabled   = var.public_network_access_enabled

  blob_properties {
    versioning_enabled = var.versioning

    delete_retention_policy {
      days = var.delete_retention_days
    }

    container_delete_retention_policy {
      days = var.delete_retention_days
    }

    dynamic "cors_rule" {
      for_each = local.cors_enabled ? [1] : []
      content {
        allowed_origins    = var.cors.origins
        allowed_methods    = var.cors.methods
        allowed_headers    = var.cors.allowed_headers
        exposed_headers    = var.cors.expose_headers
        max_age_in_seconds = var.cors.max_age_seconds
      }
    }
  }

  dynamic "network_rules" {
    for_each = local.network_rules_enabled ? [1] : []
    content {
      default_action             = var.network_default_action
      bypass                     = ["AzureServices"]
      ip_rules                   = var.allowed_ip_ranges
      virtual_network_subnet_ids = var.allowed_subnet_ids
    }
  }

  tags = var.tags

  lifecycle {
    precondition {
      condition     = var.network_default_action != "Deny" || var.private_endpoint_enabled || length(var.allowed_subnet_ids) > 0 || length(var.allowed_ip_ranges) > 0
      error_message = "network_default_action is Deny with nothing allowed through, so no workload could reach the blobs. Add allowed_subnet_ids or allowed_ip_ranges, or set private_endpoint_enabled = true."
    }
  }
}

resource "azurerm_storage_container" "this" {
  for_each = local.names

  name                  = each.value
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"

  metadata = { bucket = each.key }
}

resource "azurerm_storage_management_policy" "this" {
  count = length(var.lifecycle_rules) > 0 ? 1 : 0

  storage_account_id = azurerm_storage_account.this.id

  dynamic "rule" {
    for_each = local.lifecycle_rules
    content {
      name    = rule.value.name
      enabled = rule.value.enabled

      filters {
        blob_types   = rule.value.blob_types
        prefix_match = rule.value.prefix_match
      }

      actions {
        dynamic "base_blob" {
          for_each = rule.value.tier_to_cool_after_days != null || rule.value.tier_to_archive_after_days != null || rule.value.delete_after_days != null ? [1] : []
          content {
            tier_to_cool_after_days_since_modification_greater_than    = rule.value.tier_to_cool_after_days
            tier_to_archive_after_days_since_modification_greater_than = rule.value.tier_to_archive_after_days
            delete_after_days_since_modification_greater_than          = rule.value.delete_after_days
          }
        }

        dynamic "version" {
          for_each = rule.value.version_delete_after_days != null || rule.value.version_tier_to_cool_after_days != null ? [1] : []
          content {
            change_tier_to_cool_after_days_since_creation = rule.value.version_tier_to_cool_after_days
            delete_after_days_since_creation              = rule.value.version_delete_after_days
          }
        }
      }
    }
  }

  depends_on = [azurerm_storage_container.this]
}

resource "azurerm_private_endpoint" "blob" {
  count = local.private_endpoint_count

  name                = "${var.account_name}-blob-pe"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.private_endpoint_subnet_id

  private_service_connection {
    name                           = "${var.account_name}-blob-pe"
    private_connection_resource_id = azurerm_storage_account.this.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "blob"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }

  tags = var.tags

  lifecycle {
    precondition {
      condition     = var.private_endpoint_subnet_id != "" && var.private_dns_zone_id != ""
      error_message = "private_endpoint_subnet_id and private_dns_zone_id are required when private_endpoint_enabled is true."
    }
  }
}
