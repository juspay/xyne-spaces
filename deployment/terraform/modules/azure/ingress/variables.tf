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

variable "domain" {
  type = string
}

variable "subnet_id" {
  type    = string
  default = ""
}

variable "backend_ip" {
  type    = string
  default = ""
}

variable "backend_protocol" {
  type    = string
  default = "Https"

  validation {
    condition     = contains(["Https", "Http"], var.backend_protocol)
    error_message = "backend_protocol must be Https or Http."
  }
}

variable "backend_root_certificate_pem" {
  type      = string
  sensitive = true
  default   = ""
}

variable "request_timeout" {
  type    = number
  default = 3600
}

variable "probe_path" {
  type    = string
  default = "/healthz/ready"
}

variable "probe_port" {
  type    = number
  default = 0
}

variable "probe_status_codes" {
  type    = list(string)
  default = ["200-399"]
}

variable "http_redirect" {
  type    = bool
  default = true
}

variable "certificate_key_vault_secret_id" {
  type    = string
  default = ""
}

variable "certificate_key_vault_id" {
  type    = string
  default = ""
}

variable "certificate_pfx_data" {
  type      = string
  sensitive = true
  default   = ""
}

variable "certificate_pfx_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "sku_name" {
  type    = string
  default = "Standard_v2"

  validation {
    condition     = contains(["Standard_v2", "WAF_v2"], var.sku_name)
    error_message = "sku_name must be Standard_v2 or WAF_v2."
  }
}

variable "sku_tier" {
  type    = string
  default = "Standard_v2"

  validation {
    condition     = contains(["Standard_v2", "WAF_v2"], var.sku_tier)
    error_message = "sku_tier must be Standard_v2 or WAF_v2."
  }
}

variable "min_capacity" {
  type    = number
  default = 1
}

variable "max_capacity" {
  type    = number
  default = 3
}

variable "zones" {
  type    = list(string)
  default = []
}

variable "ssl_policy_name" {
  type    = string
  default = "AppGwSslPolicy20220101"
}

variable "waf_enabled" {
  type    = bool
  default = false
}

variable "waf_mode" {
  type    = string
  default = "Prevention"

  validation {
    condition     = contains(["Prevention", "Detection"], var.waf_mode)
    error_message = "waf_mode must be Prevention or Detection."
  }
}

variable "waf_rule_set_version" {
  type    = string
  default = "3.2"
}

variable "domain_name_label" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
