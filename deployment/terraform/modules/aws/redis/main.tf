locals {
  family = "redis${split(".", var.engine_version)[0]}"
}

resource "aws_elasticache_parameter_group" "this" {
  name   = var.name
  family = local.family

  dynamic "parameter" {
    for_each = var.parameters
    content {
      name  = parameter.key
      value = parameter.value
    }
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.name
  description          = "${var.name} redis"

  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.this.name

  num_cache_clusters         = var.replicas + 1
  automatic_failover_enabled = var.replicas > 0
  multi_az_enabled           = var.multi_az && var.replicas > 0

  subnet_group_name  = var.subnet_group_name
  security_group_ids = var.security_group_ids

  transit_encryption_enabled = var.tls
  at_rest_encryption_enabled = var.at_rest_kms
  kms_key_id                 = var.at_rest_kms && var.kms_key_arn != "" ? var.kms_key_arn : null
  auth_token                 = var.auth_token != "" ? var.auth_token : null
  auth_token_update_strategy = var.auth_token != "" ? "ROTATE" : null

  maintenance_window         = var.maintenance_window
  snapshot_window            = var.snapshot_window
  snapshot_retention_limit   = var.snapshot_retention_days
  auto_minor_version_upgrade = true
  apply_immediately          = var.apply_immediately

  tags = var.tags

  lifecycle {
    precondition {
      condition     = var.tls || var.auth_token == ""
      error_message = "ElastiCache accepts an AUTH token only with in-transit TLS enabled; set tls = true or leave auth_token empty."
    }
  }
}
