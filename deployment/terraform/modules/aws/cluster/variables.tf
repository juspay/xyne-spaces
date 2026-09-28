variable "region" {
  type = string
}

variable "name" {
  type = string

  validation {
    condition     = length(var.name) <= 40 && can(regex("^[a-zA-Z][a-zA-Z0-9-]*$", var.name))
    error_message = "name must start with a letter and contain only letters, digits and dashes, at most 40 characters, so that node group and role names fit their limits."
  }
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "cluster_security_group_id" {
  type = string
}

variable "node_security_group_id" {
  type = string
}

variable "kubernetes_version" {
  type    = string
  default = "1.35"
}

variable "endpoint_private_access" {
  type    = bool
  default = true
}

variable "endpoint_public_access" {
  type    = bool
  default = true
}

variable "public_access_cidrs" {
  type    = list(string)
  default = []
}

variable "services_cidr" {
  type    = string
  default = ""
}

variable "cluster_log_types" {
  type    = list(string)
  default = ["api", "audit", "authenticator"]
}

variable "cluster_log_retention_days" {
  type    = number
  default = 30
}

variable "kms_key_arn" {
  type    = string
  default = ""
}

variable "support_type" {
  type    = string
  default = "STANDARD"

  validation {
    condition     = contains(["STANDARD", "EXTENDED"], var.support_type)
    error_message = "support_type must be STANDARD or EXTENDED."
  }
}

variable "deployer_principal_arn" {
  type    = string
  default = ""
}

variable "addon_versions" {
  type    = map(string)
  default = {}
}

variable "sandbox_ami_ssm_parameter" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "node_pools" {
  type = object({
    general = optional(object({
      enabled        = optional(bool, true)
      instance_type  = optional(string, "m6i.xlarge")
      instance_types = optional(list(string))
      min_count      = optional(number, 1)
      max_count      = optional(number, 5)
      desired_count  = optional(number)
      disk_size_gb   = optional(number, 100)
      disk_type      = optional(string, "gp3")
      spot           = optional(bool, false)
      labels         = optional(map(string), {})
      ami_type       = optional(string, "AL2023_x86_64_STANDARD")
    }), {})
    zero = optional(object({
      enabled             = optional(bool, false)
      instance_type       = optional(string, "r6i.xlarge")
      instance_types      = optional(list(string))
      min_count           = optional(number, 1)
      max_count           = optional(number, 3)
      desired_count       = optional(number)
      disk_size_gb        = optional(number, 100)
      disk_type           = optional(string, "gp3")
      spot                = optional(bool, false)
      labels              = optional(map(string), {})
      ami_type            = optional(string, "AL2023_x86_64_STANDARD")
      local_storage_raid0 = optional(bool, false)
    }), {})
    vespa = optional(object({
      enabled        = optional(bool, false)
      instance_type  = optional(string, "m6i.2xlarge")
      instance_types = optional(list(string))
      min_count      = optional(number, 1)
      max_count      = optional(number, 3)
      desired_count  = optional(number)
      disk_size_gb   = optional(number, 200)
      disk_type      = optional(string, "gp3")
      spot           = optional(bool, false)
      labels         = optional(map(string), {})
      ami_type       = optional(string, "AL2023_x86_64_STANDARD")
    }), {})
    sandbox = optional(object({
      enabled        = optional(bool, false)
      instance_type  = optional(string, "m5.metal")
      instance_types = optional(list(string))
      min_count      = optional(number, 1)
      max_count      = optional(number, 3)
      desired_count  = optional(number)
      disk_size_gb   = optional(number, 200)
      disk_type      = optional(string, "gp3")
      spot           = optional(bool, false)
      labels         = optional(map(string), {})
    }), {})
    gpu = optional(object({
      enabled        = optional(bool, false)
      instance_type  = optional(string, "g6.xlarge")
      instance_types = optional(list(string), ["g6.xlarge", "g5.xlarge", "g6e.xlarge", "g4dn.xlarge"])
      min_count      = optional(number, 1)
      max_count      = optional(number, 2)
      desired_count  = optional(number)
      disk_size_gb   = optional(number, 100)
      disk_type      = optional(string, "gp3")
      spot           = optional(bool, false)
      labels         = optional(map(string), {})
      ami_type       = optional(string, "AL2023_x86_64_NVIDIA")
    }), {})
  })
  default = {}

  validation {
    condition     = !var.node_pools.sandbox.enabled || endswith(var.node_pools.sandbox.instance_type, ".metal")
    error_message = "node_pools.sandbox.instance_type must be a bare-metal type (ending in .metal); nested virtualization for the sandbox runtime is only available on metal instances."
  }
}
