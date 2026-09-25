variable "region" {
  type = string
}

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

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
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

variable "ami_ssm_parameter" {
  type    = string
  default = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

variable "root_device_name" {
  type    = string
  default = "/dev/sda1"
}

variable "instance_type" {
  type    = string
  default = "m6i.xlarge"
}

variable "egress_instance_type" {
  type    = string
  default = "m6i.xlarge"
}

variable "disk_size_gb" {
  type    = number
  default = 50
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

variable "turn_cert_secret" {
  type    = string
  default = ""
}

variable "certificate_arn" {
  type    = string
  default = ""
}

variable "create_certificate" {
  type    = bool
  default = true
}

variable "dns_zone" {
  type    = string
  default = ""
}

variable "secret_recovery_window_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
