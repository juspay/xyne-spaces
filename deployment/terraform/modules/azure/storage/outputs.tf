output "account_id" {
  value = azurerm_storage_account.this.id
}

output "account_name" {
  value = azurerm_storage_account.this.name
}

output "blob_endpoint" {
  value = azurerm_storage_account.this.primary_blob_endpoint
}

output "bucket_names" {
  value = { for key, container in azurerm_storage_container.this : key => container.name }
}

output "container_ids" {
  value = { for key, container in azurerm_storage_container.this : key => container.resource_manager_id }
}

output "storage" {
  value = {
    mode     = "managed"
    provider = "azure"
    endpoint = azurerm_storage_account.this.primary_blob_endpoint
    region   = var.location
    account  = azurerm_storage_account.this.name
    buckets = {
      main          = azurerm_storage_container.this["main"].name
      docs          = azurerm_storage_container.this["docs"].name
      canvas        = azurerm_storage_container.this["canvas"].name
      recordings    = azurerm_storage_container.this["recordings"].name
      workflows     = azurerm_storage_container.this["workflows"].name
      transcription = azurerm_storage_container.this["transcription"].name
      bundles       = azurerm_storage_container.this["bundles"].name
      claw          = azurerm_storage_container.this["claw"].name
    }
  }
}

output "storage_credentials" {
  value = {
    access_key_id     = var.shared_access_key_enabled ? azurerm_storage_account.this.name : ""
    secret_access_key = var.shared_access_key_enabled ? azurerm_storage_account.this.primary_access_key : ""
  }
  sensitive = true
}
