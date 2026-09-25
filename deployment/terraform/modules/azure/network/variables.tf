variable "location" {
  type = string
}

variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "create_resource_group" {
  type    = bool
  default = true
}

variable "vnet_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "aks_subnet_cidr" {
  type    = string
  default = "10.10.0.0/20"
}

variable "postgres_subnet_cidr" {
  type    = string
  default = "10.10.16.0/24"
}

variable "private_endpoints_subnet_cidr" {
  type    = string
  default = "10.10.17.0/24"
}

variable "livekit_subnet_cidr" {
  type    = string
  default = "10.10.18.0/24"
}

variable "livekit_egress_subnet_cidr" {
  type    = string
  default = "10.10.19.0/24"
}

variable "bastion_allowed_ssh_cidrs" {
  type    = list(string)
  default = []
}

variable "bastion_subnet_cidr" {
  type    = string
  default = "10.10.20.0/27"
}

variable "azure_bastion_subnet_cidr" {
  type    = string
  default = "10.10.20.64/26"
}

variable "appgw_subnet_cidr" {
  type    = string
  default = "10.10.21.0/24"
}

variable "azure_bastion_enabled" {
  type    = bool
  default = false
}

variable "nat_gateway_enabled" {
  type    = bool
  default = true
}

variable "nat_public_ip_prefix_length" {
  type    = number
  default = 30

  validation {
    condition     = var.nat_public_ip_prefix_length >= 28 && var.nat_public_ip_prefix_length <= 31
    error_message = "nat_public_ip_prefix_length must be between 28 and 31."
  }
}

variable "nat_idle_timeout_minutes" {
  type    = number
  default = 10
}

variable "aks_inbound_ports" {
  type    = list(string)
  default = ["80", "443"]
}

variable "livekit_port_range_start" {
  type    = number
  default = 50000
}

variable "livekit_port_range_end" {
  type    = number
  default = 60000
}

variable "tags" {
  type    = map(string)
  default = {}
}
