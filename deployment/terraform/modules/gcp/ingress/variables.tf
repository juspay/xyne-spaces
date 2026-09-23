variable "project" {
  type = string
}

variable "name" {
  type = string
}

variable "enabled" {
  type    = bool
  default = false
}

variable "network" {
  type = string
}

variable "target_tags" {
  type    = list(string)
  default = []
}

variable "backend_instance_groups" {
  type    = list(string)
  default = []
}

variable "node_ports" {
  type = object({
    http   = number
    https  = number
    status = number
  })
}

variable "backend_protocol" {
  type    = string
  default = "HTTPS"

  validation {
    condition     = contains(["HTTP", "HTTPS"], var.backend_protocol)
    error_message = "backend_protocol must be HTTP or HTTPS."
  }
}

variable "backend_port_name" {
  type    = string
  default = ""
}

variable "certificate_ids" {
  type    = list(string)
  default = []
}

variable "certificate_pem" {
  type      = string
  sensitive = true
  default   = ""
}

variable "private_key_pem" {
  type      = string
  sensitive = true
  default   = ""
}

variable "certificate_domains" {
  type    = list(string)
  default = []
}

variable "http_redirect" {
  type    = bool
  default = true
}

variable "timeout_sec" {
  type    = number
  default = 3600
}

variable "connection_draining_timeout_sec" {
  type    = number
  default = 300
}

variable "log_sample_rate" {
  type    = number
  default = 1
}
