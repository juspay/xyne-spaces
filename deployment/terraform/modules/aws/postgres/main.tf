locals {
  family = "postgres${split(".", var.engine_version)[0]}"

  parameters = merge(
    {
      "rds.logical_replication" = "1"
      "max_replication_slots"   = tostring(var.max_replication_slots)
      "max_wal_senders"         = tostring(var.max_wal_senders)
    },
    var.parameters,
  )

  databases = {
    app       = var.databases.app
    common    = var.databases.common
    zero_cvr  = var.databases.zero_cvr
    zero_cdb  = var.databases.zero_cdb
    claw_auth = var.databases.claw_auth
  }
}

resource "aws_db_parameter_group" "this" {
  name_prefix = "${var.name}-"
  family      = local.family

  dynamic "parameter" {
    for_each = local.parameters
    content {
      name         = parameter.key
      value        = parameter.value
      apply_method = "pending-reboot"
    }
  }

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "primary" {
  identifier = var.name

  engine                     = "postgres"
  engine_version             = var.engine_version
  instance_class             = var.instance_class
  auto_minor_version_upgrade = true

  allocated_storage     = var.disk_size_gb
  max_allocated_storage = var.disk_autoresize_limit
  storage_type          = var.storage_type
  storage_encrypted     = true
  kms_key_id            = var.kms_key_arn != "" ? var.kms_key_arn : null

  db_name  = var.databases.app
  username = var.username
  password = var.password
  port     = 5432

  multi_az               = var.multi_az
  publicly_accessible    = false
  db_subnet_group_name   = var.subnet_group_name
  vpc_security_group_ids = var.security_group_ids
  parameter_group_name   = aws_db_parameter_group.this.name

  backup_retention_period = var.backup_retention_days
  backup_window           = var.backup_window
  maintenance_window      = var.maintenance_window
  copy_tags_to_snapshot   = true

  performance_insights_enabled          = var.performance_insights
  performance_insights_retention_period = var.performance_insights ? var.performance_insights_retention_days : null
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"
  apply_immediately         = var.apply_immediately

  tags = var.tags
}

resource "aws_db_instance" "replica" {
  count = var.read_replica_enabled ? 1 : 0

  identifier          = "${var.name}-replica"
  replicate_source_db = aws_db_instance.primary.identifier

  instance_class             = var.read_replica_class != "" ? var.read_replica_class : var.instance_class
  auto_minor_version_upgrade = true

  max_allocated_storage = var.disk_autoresize_limit
  storage_type          = var.storage_type

  multi_az               = false
  publicly_accessible    = false
  vpc_security_group_ids = var.security_group_ids
  parameter_group_name   = aws_db_parameter_group.this.name

  backup_retention_period = 0
  maintenance_window      = var.maintenance_window
  copy_tags_to_snapshot   = true

  performance_insights_enabled          = var.performance_insights
  performance_insights_retention_period = var.performance_insights ? var.performance_insights_retention_days : null
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  deletion_protection = var.deletion_protection
  skip_final_snapshot = true
  apply_immediately   = var.apply_immediately

  tags = var.tags
}
