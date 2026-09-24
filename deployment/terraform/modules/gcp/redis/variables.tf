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

variable "private_service_range_name" {
  type    = string
  default = ""
}

variable "tier" {
  type    = string
  default = "STANDARD_HA"

  validation {
    condition     = contains(["BASIC", "STANDARD_HA"], var.tier)
    error_message = "tier must be BASIC or STANDARD_HA."
  }
}

variable "memory_size_gb" {
  type    = number
  default = 4
}

variable "redis_version" {
  type    = string
  default = "REDIS_7_2"
}

variable "tls" {
  type    = bool
  default = false
}

variable "maintenance_window" {
  type = object({
    day     = string
    hour    = number
    minutes = number
  })
  default = {
    day     = "SUNDAY"
    hour    = 3
    minutes = 0
  }
}

variable "redis_configs" {
  type    = map(string)
  default = {}
}

variable "labels" {
  type    = map(string)
  default = {}
}
