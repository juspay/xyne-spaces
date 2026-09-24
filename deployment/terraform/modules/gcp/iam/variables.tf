variable "project" {
  type = string
}

variable "name" {
  type = string

  validation {
    condition     = length(var.name) <= 14 && can(regex("^[a-z][a-z0-9-]*$", var.name))
    error_message = "name must be lowercase letters, digits and dashes, at most 14 characters, so that service account ids fit in 30 characters."
  }
}

variable "namespace" {
  type    = string
  default = "xyne"
}

variable "worker_names" {
  type    = list(string)
  default = []
}

variable "buckets" {
  type    = map(string)
  default = {}
}

variable "signing_identities" {
  type    = list(string)
  default = ["backend", "worker", "ysweet"]
}
