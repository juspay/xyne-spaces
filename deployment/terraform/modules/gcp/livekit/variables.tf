variable "project" {
  type = string
}

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

variable "network" {
  type = string
}

variable "subnetwork" {
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

variable "vm_image" {
  type    = string
  default = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
}

variable "machine_type" {
  type    = string
  default = "n2-standard-4"
}

variable "egress_machine_type" {
  type    = string
  default = "n2-standard-4"
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

variable "dns_zone" {
  type    = string
  default = ""
}

variable "labels" {
  type    = map(string)
  default = {}
}
