variable "name" {
  type = string
}

variable "domain" {
  type = string
}

variable "enabled" {
  type    = bool
  default = false
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "node_security_group_id" {
  type = string
}

variable "node_ports" {
  type = object({
    http   = number
    https  = number
    status = number
  })
}

variable "backend_autoscaling_groups" {
  type    = any
  default = {}
}

variable "backend_protocol" {
  type    = string
  default = "TLS"

  validation {
    condition     = contains(["TLS", "TCP"], var.backend_protocol)
    error_message = "backend_protocol must be TLS or TCP."
  }
}

variable "certificate_arn" {
  type    = string
  default = ""
}

variable "certificate_domains" {
  type    = list(string)
  default = []
}

variable "ssl_policy" {
  type    = string
  default = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "allowed_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "http_listener" {
  type    = bool
  default = false
}

variable "preserve_client_ip" {
  type    = bool
  default = true
}

variable "dns_zone" {
  type    = string
  default = ""
}

variable "create_dns_records" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
