locals {
  primary = one([
    for c in google_memorystore_instance.this.endpoints[0].connections : c.psc_auto_connection[0]
    if c.psc_auto_connection[0].connection_type == "CONNECTION_TYPE_PRIMARY"
  ])
}

output "instance_id" {
  value = google_memorystore_instance.this.id
}

output "redis" {
  value = {
    mode     = "managed"
    host     = local.primary.ip_address
    port     = local.primary.port
    tls      = true
    iam_auth = true
  }
}

output "redis_auth" {
  value     = ""
  sensitive = true
}

output "server_ca_certs" {
  value = flatten([for ca in google_memorystore_instance.this.managed_server_ca[0].ca_certs : ca.certificates])
}
