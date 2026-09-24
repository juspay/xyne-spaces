variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "account_name" {
  type = string

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.account_name))
    error_message = "account_name must be 3 to 24 lowercase letters and digits and globally unique."
  }
}

variable "prefix" {
  type = string
}

variable "bucket_names" {
  type    = map(string)
  default = {}
}

variable "replication_type" {
  type    = string
  default = "ZRS"

  validation {
    condition     = contains(["LRS", "ZRS", "GRS", "RAGRS", "GZRS", "RAGZRS"], var.replication_type)
    error_message = "replication_type must be LRS, ZRS, GRS, RAGRS, GZRS or RAGZRS."
  }
}

variable "access_tier" {
  type    = string
  default = "Hot"
}

variable "versioning" {
  type    = bool
  default = false
}

variable "shared_access_key_enabled" {
  type    = bool
  default = true
}

variable "delete_retention_days" {
  type    = number
  default = 7
}

variable "public_network_access_enabled" {
  type    = bool
  default = true
}

variable "network_default_action" {
  type    = string
  default = "Deny"

  validation {
    condition     = contains(["Allow", "Deny"], var.network_default_action)
    error_message = "network_default_action must be Allow or Deny."
  }
}

variable "allowed_ip_ranges" {
  type    = list(string)
  default = []
}

variable "allowed_subnet_ids" {
  type    = list(string)
  default = []
}

variable "private_endpoint_enabled" {
  type    = bool
  default = false
}

variable "private_endpoint_subnet_id" {
  type    = string
  default = ""
}

variable "private_dns_zone_id" {
  type    = string
  default = ""
}

variable "lifecycle_rules" {
  type = list(object({
    name                            = string
    enabled                         = optional(bool, true)
    prefixes                        = optional(list(string), [])
    blob_types                      = optional(list(string), ["blockBlob"])
    tier_to_cool_after_days         = optional(number)
    tier_to_archive_after_days      = optional(number)
    delete_after_days               = optional(number)
    version_delete_after_days       = optional(number)
    version_tier_to_cool_after_days = optional(number)
  }))
  default = []
}

variable "cors" {
  type = object({
    origins         = list(string)
    methods         = optional(list(string), ["GET", "HEAD", "PUT", "POST", "DELETE", "OPTIONS"])
    allowed_headers = optional(list(string), ["*"])
    expose_headers  = optional(list(string), ["ETag", "Content-Length", "Content-Type", "x-ms-request-id"])
    max_age_seconds = optional(number, 3600)
  })
  default = {
    origins = []
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
