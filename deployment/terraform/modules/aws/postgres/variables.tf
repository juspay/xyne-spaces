variable "name" {
  type = string
}

variable "subnet_group_name" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

variable "engine_version" {
  type    = string
  default = "16"
}

variable "instance_class" {
  type    = string
  default = "db.m6g.large"
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "disk_size_gb" {
  type    = number
  default = 20
}

variable "disk_autoresize_limit" {
  type    = number
  default = 0
}

variable "storage_type" {
  type    = string
  default = "gp3"
}

variable "backup_window" {
  type    = string
  default = "02:00-03:00"
}

variable "backup_retention_days" {
  type    = number
  default = 7

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35; logical replication and point-in-time recovery need automated backups."
  }
}

variable "maintenance_window" {
  type    = string
  default = "sun:03:00-sun:04:00"
}

variable "performance_insights" {
  type    = bool
  default = true
}

variable "performance_insights_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "apply_immediately" {
  type    = bool
  default = false
}

variable "parameters" {
  type    = map(string)
  default = {}
}

variable "max_replication_slots" {
  type    = number
  default = 10
}

variable "max_wal_senders" {
  type    = number
  default = 10
}

variable "read_replica_enabled" {
  type    = bool
  default = false
}

variable "read_replica_class" {
  type    = string
  default = ""
}

variable "databases" {
  type = object({
    app       = optional(string, "xyne")
    common    = optional(string, "xyne_common")
    zero_cvr  = optional(string, "zero_cvr")
    zero_cdb  = optional(string, "zero_cdb")
    claw_auth = optional(string, "claw_auth")
  })
  default = {}
}

variable "username" {
  type    = string
  default = "xyne"
}

variable "password" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.password) >= 16
    error_message = "password must be at least 16 characters."
  }

  validation {
    condition     = !can(regex("[/@\" ]", var.password))
    error_message = "password must not contain '/', '@', '\"' or spaces; RDS rejects them."
  }
}

variable "kms_key_arn" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
