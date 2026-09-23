output "server_id" {
  value = azurerm_postgresql_flexible_server.primary.id
}

output "server_name" {
  value = azurerm_postgresql_flexible_server.primary.name
}

output "replica_server_id" {
  value = var.read_replica_enabled ? azurerm_postgresql_flexible_server.replica[0].id : ""
}

output "databases" {
  value = local.databases
}

output "postgres" {
  value = {
    mode        = "managed"
    host        = azurerm_postgresql_flexible_server.primary.fqdn
    ro_host     = var.read_replica_enabled ? azurerm_postgresql_flexible_server.replica[0].fqdn : azurerm_postgresql_flexible_server.primary.fqdn
    direct_host = azurerm_postgresql_flexible_server.primary.fqdn
    port        = 5432
    username    = var.username
    sslmode     = "require"
    databases   = local.databases
  }
}
