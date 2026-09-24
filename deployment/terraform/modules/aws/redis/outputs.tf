output "replication_group_id" {
  value = aws_elasticache_replication_group.this.id
}

output "replication_group_arn" {
  value = aws_elasticache_replication_group.this.arn
}

output "reader_endpoint" {
  value = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "redis" {
  value = {
    mode = "managed"
    host = aws_elasticache_replication_group.this.primary_endpoint_address
    port = aws_elasticache_replication_group.this.port
    tls  = var.tls
  }
}

output "redis_auth" {
  value     = var.auth_token
  sensitive = true
}
