variable "project" {
  type = string
}

variable "region" {
  type = string
}

variable "zone" {
  type    = string
  default = ""
}

variable "name" {
  type = string
}

variable "enabled" {
  type    = bool
  default = false
}

variable "network_self_link" {
  type = string
}

variable "subnet_self_link" {
  type = string
}

variable "machine_type" {
  type    = string
  default = "e2-small"
}

variable "image" {
  type    = string
  default = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
}

variable "disk_size_gb" {
  type    = number
  default = 20
}

variable "cluster_name" {
  type = string
}

variable "labels" {
  type    = map(string)
  default = {}
}
