variable "location" {
  type = string
}

variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "enabled" {
  type    = bool
  default = false
}

variable "subnet_id" {
  type = string
}

variable "vm_size" {
  type    = string
  default = "Standard_B2s"
}

variable "admin_username" {
  type    = string
  default = "xyne"
}

variable "ssh_public_key" {
  type    = string
  default = ""
}

variable "disk_size_gb" {
  type    = number
  default = 32
}

variable "vm_image" {
  type = object({
    publisher = optional(string, "Canonical")
    offer     = optional(string, "ubuntu-24_04-lts")
    sku       = optional(string, "server")
    version   = optional(string, "latest")
  })
  default = {}
}

variable "public_ip_enabled" {
  type    = bool
  default = false
}

variable "azure_bastion_enabled" {
  type    = bool
  default = false
}

variable "azure_bastion_subnet_id" {
  type    = string
  default = ""
}

variable "azure_bastion_sku" {
  type    = string
  default = "Basic"
}

variable "zone" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
