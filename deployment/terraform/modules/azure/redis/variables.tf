variable "location" {
  type = string
}

variable "name" {
  type = string
}

variable "cache_name" {
  type    = string
  default = ""
}

variable "resource_group_name" {
  type = string
}

variable "private_endpoint_subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "sku_name" {
  type    = string
  default = "Standard"

  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.sku_name)
    error_message = "sku_name must be Basic, Standard or Premium."
  }
}

variable "capacity" {
  type    = number
  default = 1
}

variable "redis_version" {
  type    = string
  default = "6"
}

variable "replicas_per_primary" {
  type    = number
  default = 1
}

variable "zones" {
  type    = list(string)
  default = []
}

variable "maxmemory_policy" {
  type    = string
  default = "volatile-lru"
}

variable "patch_schedule" {
  type = object({
    day_of_week    = string
    start_hour_utc = number
  })
  default = {
    day_of_week    = "Sunday"
    start_hour_utc = 3
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
