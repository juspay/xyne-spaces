variable "api_key" {
  type      = string
  sensitive = true
}

variable "api_secret" {
  type      = string
  sensitive = true
}

variable "domain" {
  type = string
}

variable "ws_url" {
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

variable "port_range_start" {
  type    = number
  default = 50000
}

variable "port_range_end" {
  type    = number
  default = 60000
}

variable "turn" {
  type = object({
    tls       = optional(bool, false)
    tls_port  = optional(number, 5349)
    cert_file = optional(string, "/etc/livekit/turn/cert.pem")
    key_file  = optional(string, "/etc/livekit/turn/key.pem")
  })
  default = {}
}
