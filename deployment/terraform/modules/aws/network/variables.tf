variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "az_count" {
  type    = number
  default = 3

  validation {
    condition     = var.az_count >= 1 && var.az_count <= 6
    error_message = "az_count must be between 1 and 6."
  }
}

variable "availability_zones" {
  type    = list(string)
  default = []
}

variable "subnet_newbits" {
  type    = number
  default = 4
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = []
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = []
}

variable "single_nat_gateway" {
  type    = bool
  default = false
}

variable "enable_vpc_endpoints" {
  type    = bool
  default = true
}

variable "enable_flow_logs" {
  type    = bool
  default = false
}

variable "flow_logs_retention_days" {
  type    = number
  default = 30
}

variable "internet_egress_cidrs" {
  type    = list(string)
  default = []

  validation {
    condition     = length(var.internet_egress_cidrs) > 0
    error_message = "internet_egress_cidrs is empty, so the nodes, the bastion and the LiveKit instances would have no outbound path and the install would fail on the first image pull. Set [\"0.0.0.0/0\"] for ordinary internet egress through NAT, or list the ranges your egress proxy and registries use."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
