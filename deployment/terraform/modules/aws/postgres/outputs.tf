output "instance_id" {
  value = aws_db_instance.primary.id
}

output "instance_arn" {
  value = aws_db_instance.primary.arn
}

output "replica_instance_id" {
  value = var.read_replica_enabled ? aws_db_instance.replica[0].id : ""
}

output "parameter_group_name" {
  value = aws_db_parameter_group.this.name
}

output "databases" {
  value = local.databases
}

output "postgres" {
  value = {
    mode        = "managed"
    host        = aws_db_instance.primary.address
    ro_host     = var.read_replica_enabled ? aws_db_instance.replica[0].address : aws_db_instance.primary.address
    direct_host = aws_db_instance.primary.address
    port        = aws_db_instance.primary.port
    username    = var.username
    sslmode     = "require"
    databases   = local.databases
  }
}
