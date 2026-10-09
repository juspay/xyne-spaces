variable "location" {
  type = string
}

variable "name" {
  type = string

  validation {
    condition     = length(var.name) <= 40 && can(regex("^[a-zA-Z][a-zA-Z0-9-]*$", var.name))
    error_message = "name must start with a letter and contain only letters, digits and dashes, at most 40 characters."
  }
}

variable "resource_group_name" {
  type = string
}

variable "node_resource_group_name" {
  type    = string
  default = ""
}

variable "vnet_id" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "kubernetes_version" {
  type    = string
  default = ""
}

variable "sku_tier" {
  type    = string
  default = "Standard"

  validation {
    condition     = contains(["Free", "Standard", "Premium"], var.sku_tier)
    error_message = "sku_tier must be Free, Standard or Premium."
  }
}

variable "private_cluster_enabled" {
  type    = bool
  default = false
}

variable "authorized_ip_ranges" {
  type    = list(string)
  default = []
}

variable "pods_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "services_cidr" {
  type    = string
  default = "10.30.0.0/20"
}

variable "outbound_type" {
  type    = string
  default = "loadBalancer"

  validation {
    condition     = contains(["loadBalancer", "userAssignedNATGateway"], var.outbound_type)
    error_message = "outbound_type must be loadBalancer or userAssignedNATGateway."
  }
}

variable "azure_rbac_enabled" {
  type    = bool
  default = true
}

variable "admin_group_object_ids" {
  type    = list(string)
  default = []
}

variable "local_account_disabled" {
  type    = bool
  default = false
}

variable "key_vault_secrets_provider_enabled" {
  type    = bool
  default = false
}

variable "log_analytics_enabled" {
  type    = bool
  default = false
}

variable "log_analytics_workspace_id" {
  type    = string
  default = ""
}

variable "log_analytics_retention_days" {
  type    = number
  default = 30
}

variable "automatic_upgrade_channel" {
  type    = string
  default = "patch"

  validation {
    condition     = contains(["none", "patch", "rapid", "stable", "node-image"], var.automatic_upgrade_channel)
    error_message = "automatic_upgrade_channel must be none, patch, rapid, stable or node-image."
  }
}

variable "node_os_upgrade_channel" {
  type    = string
  default = "NodeImage"

  validation {
    condition     = contains(["None", "Unmanaged", "NodeImage", "SecurityPatch"], var.node_os_upgrade_channel)
    error_message = "node_os_upgrade_channel must be None, Unmanaged, NodeImage or SecurityPatch."
  }
}

variable "maintenance_window" {
  type = object({
    day_of_week    = string
    start_time     = string
    duration_hours = number
    utc_offset     = string
  })
  default = {
    day_of_week    = "Sunday"
    start_time     = "02:00"
    duration_hours = 4
    utc_offset     = "+00:00"
  }
}

variable "zones" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "node_pools" {
  type = object({
    general = optional(object({
      enabled      = optional(bool, true)
      vm_size      = optional(string, "Standard_D4s_v5")
      min_count    = optional(number, 1)
      max_count    = optional(number, 5)
      disk_size_gb = optional(number, 128)
      disk_type    = optional(string, "Managed")
      spot         = optional(bool, false)
      labels       = optional(map(string), {})
      os_sku       = optional(string, "Ubuntu")
    }), {})
    zero = optional(object({
      enabled                 = optional(bool, false)
      vm_size                 = optional(string, "Standard_E4s_v5")
      min_count               = optional(number, 1)
      max_count               = optional(number, 3)
      disk_size_gb            = optional(number, 128)
      disk_type               = optional(string, "Managed")
      spot                    = optional(bool, false)
      labels                  = optional(map(string), {})
      os_sku                  = optional(string, "Ubuntu")
      local_storage_temp_disk = optional(bool, false)
    }), {})
    vespa = optional(object({
      enabled      = optional(bool, false)
      vm_size      = optional(string, "Standard_D8s_v5")
      min_count    = optional(number, 1)
      max_count    = optional(number, 3)
      disk_size_gb = optional(number, 256)
      disk_type    = optional(string, "Managed")
      spot         = optional(bool, false)
      labels       = optional(map(string), {})
      os_sku       = optional(string, "Ubuntu")
    }), {})
    sandbox = optional(object({
      enabled      = optional(bool, false)
      vm_size      = optional(string, "Standard_D4s_v3")
      min_count    = optional(number, 1)
      max_count    = optional(number, 3)
      disk_size_gb = optional(number, 256)
      disk_type    = optional(string, "Managed")
      spot         = optional(bool, false)
      labels       = optional(map(string), {})
    }), {})
  })
  default = {}

  validation {
    condition     = !var.node_pools.sandbox.enabled || can(regex("^Standard_[DE][0-9]+[a-z]*_v[34]$", var.node_pools.sandbox.vm_size))
    error_message = "node_pools.sandbox.vm_size must be a Dv3, Dsv3, Ev3, Esv3, Dv4 or Ev4 family size (for example Standard_D4s_v3); the sandbox runtime needs nested virtualization, which those families expose."
  }

  validation {
    condition     = !var.node_pools.zero.local_storage_temp_disk || can(regex("^Standard_[A-Z]+[0-9]+-?[0-9]*[a-z]*d[a-z]*_v[0-9]+$", var.node_pools.zero.vm_size))
    error_message = "node_pools.zero.local_storage_temp_disk needs a size with a local temporary disk, a 'd' size such as Standard_E4ds_v5."
  }

  validation {
    condition     = alltrue([for key in ["general", "zero", "vespa", "sandbox"] : contains(["Managed", "Ephemeral"], var.node_pools[key].disk_type)])
    error_message = "node_pools.*.disk_type must be Managed or Ephemeral."
  }

  validation {
    condition     = !var.node_pools.general.spot
    error_message = "node_pools.general is the system pool and cannot use spot capacity."
  }
}
