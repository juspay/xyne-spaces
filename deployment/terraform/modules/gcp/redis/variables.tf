variable "project" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "network" {
  type = string
}

variable "subnetwork" {
  type = string
}

variable "maintenance_window" {
  type = object({
    day     = string
    hour    = number
    minutes = number
  })
  default = {
    day     = "SUNDAY"
    hour    = 3
    minutes = 0
  }
}

variable "redis_configs" {
  type    = map(string)
  default = {}
}

variable "labels" {
  type    = map(string)
  default = {}
}
