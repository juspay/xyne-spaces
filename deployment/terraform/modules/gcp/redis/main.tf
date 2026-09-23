resource "google_redis_instance" "this" {
  name           = var.name
  project        = var.project
  region         = var.region
  tier           = var.tier
  memory_size_gb = var.memory_size_gb
  redis_version  = var.redis_version
  display_name   = "${var.name} redis"
  labels         = var.labels
  redis_configs  = var.redis_configs

  authorized_network = var.network
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  reserved_ip_range  = var.private_service_range_name != "" ? var.private_service_range_name : null

  auth_enabled            = true
  transit_encryption_mode = var.tls ? "SERVER_AUTHENTICATION" : "DISABLED"

  maintenance_policy {
    weekly_maintenance_window {
      day = var.maintenance_window.day
      start_time {
        hours   = var.maintenance_window.hour
        minutes = var.maintenance_window.minutes
        seconds = 0
        nanos   = 0
      }
    }
  }
}
