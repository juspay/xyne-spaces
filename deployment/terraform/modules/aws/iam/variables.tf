variable "name" {
  type = string

  validation {
    condition     = length(var.name) <= 40 && can(regex("^[a-zA-Z][a-zA-Z0-9-]*$", var.name))
    error_message = "name must start with a letter and contain only letters, digits and dashes, at most 40 characters, so that role names fit in 64 characters."
  }
}

variable "namespace" {
  type    = string
  default = "xyne"
}

variable "cluster_name" {
  type = string
}

variable "oidc_provider_arn" {
  type = string
}

variable "oidc_provider_url" {
  type = string
}

variable "worker_names" {
  type    = list(string)
  default = []
}

variable "buckets" {
  type    = map(string)
  default = {}
}

variable "use_pod_identity" {
  type    = bool
  default = false
}

variable "lb_controller_enabled" {
  type    = bool
  default = true
}

variable "lb_controller_namespace" {
  type    = string
  default = "kube-system"
}

variable "lb_controller_service_account" {
  type    = string
  default = "aws-load-balancer-controller"
}

variable "cluster_autoscaler_enabled" {
  type    = bool
  default = true
}

variable "cluster_autoscaler_namespace" {
  type    = string
  default = "kube-system"
}

variable "cluster_autoscaler_service_account" {
  type    = string
  default = "cluster-autoscaler"
}

variable "external_dns_enabled" {
  type    = bool
  default = false
}

variable "external_dns_namespace" {
  type    = string
  default = "external-dns"
}

variable "external_dns_service_account" {
  type    = string
  default = "external-dns"
}

variable "external_dns_hosted_zone_ids" {
  type    = list(string)
  default = []
}

variable "partition" {
  type    = string
  default = "aws"
}

variable "tags" {
  type    = map(string)
  default = {}
}
