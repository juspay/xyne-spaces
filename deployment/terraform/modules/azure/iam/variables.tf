variable "location" {
  type = string
}

variable "name" {
  type = string

  validation {
    condition     = length(var.name) <= 40 && can(regex("^[a-zA-Z][a-zA-Z0-9-]*$", var.name))
    error_message = "name must start with a letter and contain only letters, digits and dashes, at most 40 characters."
  }
}

variable "resource_group_name" {
  type = string
}

variable "namespace" {
  type    = string
  default = "xyne"
}

variable "oidc_issuer_url" {
  type = string
}

variable "worker_names" {
  type    = list(string)
  default = []
}

variable "container_ids" {
  type    = map(string)
  default = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
