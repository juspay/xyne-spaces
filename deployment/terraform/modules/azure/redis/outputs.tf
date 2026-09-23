output "id" {
  value = azurerm_redis_cache.this.id
}

output "name" {
  value = azurerm_redis_cache.this.name
}

output "private_endpoint_ip" {
  value = azurerm_private_endpoint.this.private_service_connection[0].private_ip_address
}

output "redis" {
  value = {
    mode = "managed"
    host = azurerm_redis_cache.this.hostname
    port = azurerm_redis_cache.this.ssl_port
    tls  = true
  }
}

output "redis_auth" {
  value     = azurerm_redis_cache.this.primary_access_key
  sensitive = true
}
