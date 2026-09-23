locals {
  flags = merge(
    {
      "cloudsql.logical_decoding" = "on"
      "max_replication_slots"     = tostring(var.max_replication_slots)
      "max_wal_senders"           = tostring(var.max_wal_senders)
    },
    var.database_flags,
  )

  ssl_mode = var.require_ssl ? "ENCRYPTED_ONLY" : "ALLOW_UNENCRYPTED_AND_ENCRYPTED"

  databases = {
    app       = var.databases.app
    common    = var.databases.common
    zero_cvr  = var.databases.zero_cvr
    zero_cdb  = var.databases.zero_cdb
    claw_auth = var.databases.claw_auth
  }
}

resource "google_sql_database_instance" "primary" {
  name                = var.name
  project             = var.project
  region              = var.region
  database_version    = var.database_version
  deletion_protection = var.deletion_protection

  settings {
    tier                  = var.tier
    edition               = "ENTERPRISE"
    availability_type     = var.availability_type
    disk_size             = var.disk_size_gb
    disk_type             = var.disk_type
    disk_autoresize       = true
    disk_autoresize_limit = var.disk_autoresize_limit
    user_labels           = var.labels

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network
      ssl_mode                                      = local.ssl_mode
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = var.backup_start_time
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = var.transaction_log_retention_days

      backup_retention_settings {
        retained_backups = var.backup_retention_count
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = var.maintenance_window.day
      hour         = var.maintenance_window.hour
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
    }

    dynamic "database_flags" {
      for_each = local.flags
      content {
        name  = database_flags.key
        value = database_flags.value
      }
    }
  }
}

resource "google_sql_database_instance" "replica" {
  count = var.read_replica_enabled ? 1 : 0

  name                 = "${var.name}-replica"
  project              = var.project
  region               = var.region
  database_version     = var.database_version
  master_instance_name = google_sql_database_instance.primary.name
  deletion_protection  = var.deletion_protection

  replica_configuration {
    failover_target = false
  }

  settings {
    tier              = var.read_replica_tier != "" ? var.read_replica_tier : var.tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = var.disk_size_gb
    disk_type         = var.disk_type
    disk_autoresize   = true
    user_labels       = var.labels

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network
      ssl_mode                                      = local.ssl_mode
      enable_private_path_for_google_cloud_services = true
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
    }

    dynamic "database_flags" {
      for_each = local.flags
      content {
        name  = database_flags.key
        value = database_flags.value
      }
    }
  }
}

resource "google_sql_database" "this" {
  for_each = local.databases

  name     = each.value
  project  = var.project
  instance = google_sql_database_instance.primary.name
}

resource "google_sql_user" "app" {
  name     = var.username
  project  = var.project
  instance = google_sql_database_instance.primary.name
  password = var.password
  type     = "BUILT_IN"
}
