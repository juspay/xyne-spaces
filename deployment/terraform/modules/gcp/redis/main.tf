moved {
  from = google_redis_instance.this
  to   = google_redis_instance.this[0]
}

resource "google_redis_instance" "this" {
  count = var.iam_auth ? 0 : 1

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

resource "google_network_connectivity_service_connection_policy" "this" {
  count = var.iam_auth ? 1 : 0

  project       = var.project
  name          = "${var.name}-memorystore"
  location      = var.region
  service_class = "gcp-memorystore"
  network       = var.network

  psc_config {
    subnetworks = [var.subnetwork]
  }
}

resource "google_memorystore_instance" "this" {
  count = var.iam_auth ? 1 : 0

  project                 = var.project
  location                = var.region
  instance_id             = var.name
  labels                  = var.labels
  engine_configs          = var.redis_configs
  mode                    = "CLUSTER_DISABLED"
  shard_count             = 1
  replica_count           = 1
  node_type               = var.node_type
  authorization_mode      = "IAM_AUTH"
  transit_encryption_mode = "SERVER_AUTHENTICATION"

  desired_auto_created_endpoints {
    network    = var.network
    project_id = var.project
  }

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

  depends_on = [google_network_connectivity_service_connection_policy.this]
}
