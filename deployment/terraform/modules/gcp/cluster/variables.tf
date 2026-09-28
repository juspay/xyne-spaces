variable "project" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type = string

  validation {
    condition     = length(var.name) <= 16 && can(regex("^[a-z][a-z0-9-]*$", var.name))
    error_message = "name must be lowercase letters, digits and dashes, at most 16 characters, so that node service account ids fit in 30 characters."
  }
}

variable "network" {
  type = string
}

variable "subnetwork" {
  type = string
}

variable "pods_range_name" {
  type = string
}

variable "services_range_name" {
  type = string
}

variable "node_locations" {
  type    = list(string)
  default = []
}

variable "release_channel" {
  type    = string
  default = "REGULAR"

  validation {
    condition     = contains(["RAPID", "REGULAR", "STABLE", "EXTENDED"], var.release_channel)
    error_message = "release_channel must be RAPID, REGULAR, STABLE or EXTENDED."
  }
}

variable "kubernetes_version" {
  type    = string
  default = ""
}

variable "master_ipv4_cidr_block" {
  type    = string
  default = "172.16.0.0/28"
}

variable "master_authorized_networks" {
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  default = []
}

variable "enable_private_endpoint" {
  type    = bool
  default = false
}

variable "logging_enabled" {
  type    = bool
  default = true
}

variable "monitoring_enabled" {
  type    = bool
  default = true
}

variable "maintenance_window" {
  type = object({
    start_time = string
    end_time   = string
    recurrence = string
  })
  default = {
    start_time = "2026-01-01T02:00:00Z"
    end_time   = "2026-01-01T06:00:00Z"
    recurrence = "FREQ=WEEKLY;BYDAY=SA,SU"
  }
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "node_pools" {
  type = object({
    general = optional(object({
      enabled      = optional(bool, true)
      machine_type = optional(string, "e2-standard-4")
      min_count    = optional(number, 1)
      max_count    = optional(number, 5)
      disk_size_gb = optional(number, 100)
      disk_type    = optional(string, "pd-balanced")
      spot         = optional(bool, false)
      labels       = optional(map(string), {})
    }), {})
    zero = optional(object({
      enabled         = optional(bool, false)
      machine_type    = optional(string, "e2-highmem-4")
      min_count       = optional(number, 1)
      max_count       = optional(number, 3)
      disk_size_gb    = optional(number, 100)
      disk_type       = optional(string, "pd-balanced")
      spot            = optional(bool, false)
      labels          = optional(map(string), {})
      local_ssd_count = optional(number, 0)
    }), {})
    vespa = optional(object({
      enabled      = optional(bool, false)
      machine_type = optional(string, "n2-standard-8")
      min_count    = optional(number, 1)
      max_count    = optional(number, 3)
      disk_size_gb = optional(number, 200)
      disk_type    = optional(string, "pd-ssd")
      spot         = optional(bool, false)
      labels       = optional(map(string), {})
    }), {})
    sandbox = optional(object({
      enabled      = optional(bool, false)
      machine_type = optional(string, "n1-standard-4")
      min_count    = optional(number, 1)
      max_count    = optional(number, 5)
      disk_size_gb = optional(number, 100)
      disk_type    = optional(string, "pd-balanced")
      spot         = optional(bool, false)
      labels       = optional(map(string), {})
    }), {})
  })
  default = {}

  validation {
    condition     = var.node_pools.zero.local_ssd_count == 0 || !startswith(var.node_pools.zero.machine_type, "e2-")
    error_message = "E2 machine types do not support local SSD; set node_pools.zero.machine_type to an N2, N2D or C2 type when local_ssd_count is greater than 0."
  }
}
