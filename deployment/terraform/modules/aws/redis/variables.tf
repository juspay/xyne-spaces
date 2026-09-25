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
  default = "7.1"
}

variable "node_type" {
  type    = string
  default = "cache.m6g.large"
}

variable "replicas" {
  type    = number
  default = 1

  validation {
    condition     = var.replicas >= 0 && var.replicas <= 5
    error_message = "replicas must be between 0 and 5."
  }
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "auth_token" {
  type      = string
  sensitive = true
  default   = ""

  validation {
    condition     = var.auth_token == "" || (length(var.auth_token) >= 16 && length(var.auth_token) <= 128 && can(regex("^[^@\"/ ]+$", var.auth_token)))
    error_message = "auth_token must be 16 to 128 printable characters without '@', '\"', '/' or spaces."
  }
}

variable "tls" {
  type    = bool
  default = true
}

variable "at_rest_kms" {
  type    = bool
  default = true
}

variable "kms_key_arn" {
  type    = string
  default = ""
}

variable "maintenance_window" {
  type    = string
  default = "sun:03:00-sun:04:00"
}

variable "snapshot_window" {
  type    = string
  default = "01:00-02:00"
}

variable "snapshot_retention_days" {
  type    = number
  default = 7
}

variable "parameters" {
  type    = map(string)
  default = {}
}

variable "apply_immediately" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
