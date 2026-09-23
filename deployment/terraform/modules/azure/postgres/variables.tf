variable "location" {
  type = string
}

variable "name" {
  type = string
}

variable "server_name" {
  type    = string
  default = ""
}

variable "resource_group_name" {
  type = string
}

variable "delegated_subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "engine_version" {
  type    = string
  default = "16"
}

variable "sku_name" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}

variable "storage_mb" {
  type    = number
  default = 32768
}

variable "storage_tier" {
  type    = string
  default = ""
}

variable "auto_grow_enabled" {
  type    = bool
  default = true
}

variable "high_availability" {
  type    = bool
  default = true
}

variable "zone" {
  type    = string
  default = ""
}

variable "standby_zone" {
  type    = string
  default = ""
}

variable "backup_retention_days" {
  type    = number
  default = 7

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 7 and 35."
  }
}

variable "geo_redundant_backup" {
  type    = bool
  default = false
}

variable "maintenance_window" {
  type = object({
    day_of_week  = number
    start_hour   = number
    start_minute = number
  })
  default = {
    day_of_week  = 0
    start_hour   = 3
    start_minute = 0
  }
}

variable "parameters" {
  type    = map(string)
  default = {}
}

variable "extensions" {
  type    = list(string)
  default = []
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

variable "read_replica_sku_name" {
  type    = string
  default = ""
}

variable "read_replica_zone" {
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

  validation {
    condition     = !contains(["azure_superuser", "azure_pg_admin", "admin", "administrator", "root", "guest", "public"], lower(var.username)) && !startswith(lower(var.username), "pg_")
    error_message = "username must not be a reserved Azure Database for PostgreSQL login."
  }
}

variable "password" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.password) >= 16 && length(var.password) <= 128
    error_message = "password must be between 16 and 128 characters."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
