variable "project" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "network" {
  type = string
}

variable "database_version" {
  type    = string
  default = "POSTGRES_16"
}

variable "tier" {
  type    = string
  default = "db-custom-2-8192"
}

variable "availability_type" {
  type    = string
  default = "REGIONAL"

  validation {
    condition     = contains(["REGIONAL", "ZONAL"], var.availability_type)
    error_message = "availability_type must be REGIONAL or ZONAL."
  }
}

variable "disk_size_gb" {
  type    = number
  default = 20
}

variable "disk_type" {
  type    = string
  default = "PD_SSD"
}

variable "disk_autoresize_limit" {
  type    = number
  default = 0
}

variable "backup_start_time" {
  type    = string
  default = "02:00"
}

variable "backup_retention_count" {
  type    = number
  default = 7
}

variable "transaction_log_retention_days" {
  type    = number
  default = 7
}

variable "maintenance_window" {
  type = object({
    day  = number
    hour = number
  })
  default = {
    day  = 7
    hour = 3
  }
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "require_ssl" {
  type    = bool
  default = true
}

variable "max_replication_slots" {
  type    = number
  default = 10
}

variable "max_wal_senders" {
  type    = number
  default = 10
}

variable "database_flags" {
  type    = map(string)
  default = {}
}

variable "read_replica_enabled" {
  type    = bool
  default = false
}

variable "read_replica_tier" {
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
}

variable "labels" {
  type    = map(string)
  default = {}
}
