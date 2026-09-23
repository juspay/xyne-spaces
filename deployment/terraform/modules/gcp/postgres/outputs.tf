output "instance_name" {
  value = google_sql_database_instance.primary.name
}

output "connection_name" {
  value = google_sql_database_instance.primary.connection_name
}

output "replica_instance_name" {
  value = var.read_replica_enabled ? google_sql_database_instance.replica[0].name : ""
}

output "postgres" {
  value = {
    mode        = "managed"
    host        = google_sql_database_instance.primary.private_ip_address
    ro_host     = var.read_replica_enabled ? google_sql_database_instance.replica[0].private_ip_address : google_sql_database_instance.primary.private_ip_address
    direct_host = google_sql_database_instance.primary.private_ip_address
    port        = 5432
    username    = google_sql_user.app.name
    sslmode     = "require"
    databases   = local.databases
  }
}
