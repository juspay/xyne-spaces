locals {
  primary = var.iam_auth ? one([
    for c in google_memorystore_instance.this[0].endpoints[0].connections : c.psc_auto_connection[0]
    if c.psc_auto_connection[0].connection_type == "CONNECTION_TYPE_PRIMARY"
  ]) : null
}

output "instance_id" {
  value = var.iam_auth ? google_memorystore_instance.this[0].id : google_redis_instance.this[0].id
}

output "redis" {
  value = {
    mode     = "managed"
    host     = var.iam_auth ? local.primary.ip_address : google_redis_instance.this[0].host
    port     = var.iam_auth ? local.primary.port : google_redis_instance.this[0].port
    tls      = var.iam_auth || var.tls
    iam_auth = var.iam_auth
  }
}

output "redis_auth" {
  value     = var.iam_auth ? "" : google_redis_instance.this[0].auth_string
  sensitive = true
}

output "server_ca_certs" {
  value = var.iam_auth ? flatten([for ca in google_memorystore_instance.this[0].managed_server_ca[0].ca_certs : ca.certificates]) : [for c in google_redis_instance.this[0].server_ca_certs : c.cert]
}
