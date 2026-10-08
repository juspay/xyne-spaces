variable "project" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "subnet_cidr" {
  type    = string
  default = "10.10.0.0/20"
}

variable "pods_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "services_cidr" {
  type    = string
  default = "10.30.0.0/20"
}

variable "pods_range_name" {
  type    = string
  default = "pods"
}

variable "services_range_name" {
  type    = string
  default = "services"
}

variable "private_service_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "enable_iap_ssh" {
  type    = bool
  default = true
}

variable "enable_flow_logs" {
  type    = bool
  default = false
}

variable "nat_log_filter" {
  type    = string
  default = "ERRORS_ONLY"
}
