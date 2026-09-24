output "instance_id" {
  value = google_redis_instance.this.id
}

output "redis" {
  value = {
    mode = "managed"
    host = google_redis_instance.this.host
    port = google_redis_instance.this.port
    tls  = var.tls
  }
}

output "redis_auth" {
  value     = google_redis_instance.this.auth_string
  sensitive = true
}

output "server_ca_certs" {
  value = [for c in google_redis_instance.this.server_ca_certs : c.cert]
}
