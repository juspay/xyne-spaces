variable "location" {
  type = string
}

variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "domain" {
  type = string
}

variable "enabled" {
  type    = bool
  default = false
}

variable "subnet_id" {
  type = string
}

variable "egress_subnet_id" {
  type = string
}

variable "appgw_subnet_id" {
  type = string
}

variable "egress_public_ip" {
  type    = bool
  default = false
}

variable "redis" {
  type = object({
    mode = string
    host = string
    port = number
    tls  = bool
  })
}

variable "redis_auth" {
  type      = string
  sensitive = true
  default   = ""
}

variable "api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "api_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "server_image" {
  type    = string
  default = "livekit/livekit-server:v1.9.1"
}

variable "egress_image" {
  type    = string
  default = "livekit/egress:v1.9.1"
}

variable "vm_image" {
  type = object({
    publisher = optional(string, "Canonical")
    offer     = optional(string, "ubuntu-24_04-lts")
    sku       = optional(string, "server")
    version   = optional(string, "latest")
  })
  default = {}
}

variable "vm_size" {
  type    = string
  default = "Standard_D4s_v5"
}

variable "egress_vm_size" {
  type    = string
  default = "Standard_D4s_v5"
}

variable "admin_username" {
  type    = string
  default = "xyne"
}

variable "ssh_public_key" {
  type    = string
  default = ""
}

variable "disk_size_gb" {
  type    = number
  default = 50
}

variable "zones" {
  type    = list(string)
  default = []
}

variable "min_replicas" {
  type    = number
  default = 1
}

variable "max_replicas" {
  type    = number
  default = 3
}

variable "target_cpu_utilization" {
  type    = number
  default = 0.6

  validation {
    condition     = var.target_cpu_utilization > 0 && var.target_cpu_utilization <= 1
    error_message = "target_cpu_utilization is a fraction between 0 and 1."
  }
}

variable "egress_min_replicas" {
  type    = number
  default = 1
}

variable "egress_max_replicas" {
  type    = number
  default = 3
}

variable "port_range_start" {
  type    = number
  default = 50000
}

variable "port_range_end" {
  type    = number
  default = 60000
}

variable "key_vault_id" {
  type    = string
  default = ""
}

variable "key_vault_name" {
  type    = string
  default = ""
}

variable "key_vault_purge_protection" {
  type    = bool
  default = false
}

variable "turn_cert_secret" {
  type    = string
  default = ""
}

variable "https_enabled" {
  type    = bool
  default = true
}

variable "certificate_secret_id" {
  type    = string
  default = ""
}

variable "certificate_key_vault_id" {
  type    = string
  default = ""
}

variable "appgw_min_capacity" {
  type    = number
  default = 1
}

variable "appgw_max_capacity" {
  type    = number
  default = 3
}

variable "dns_zone" {
  type    = string
  default = ""
}

variable "dns_zone_resource_group" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
