resource "google_network_connectivity_service_connection_policy" "this" {
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
  project                 = var.project
  location                = var.region
  instance_id             = var.name
  labels                  = var.labels
  engine_configs          = var.redis_configs
  mode                    = "CLUSTER_DISABLED"
  shard_count             = 1
  replica_count           = 1
  node_type               = "STANDARD_SMALL"
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
