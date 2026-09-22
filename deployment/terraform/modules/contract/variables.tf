variable "postgres_mode" {
  type = string

  validation {
    condition     = contains(["managed", "incluster", "external"], var.postgres_mode)
    error_message = "postgres_mode must be managed, incluster or external."
  }
}

variable "redis_mode" {
  type = string

  validation {
    condition     = contains(["managed", "incluster", "external"], var.redis_mode)
    error_message = "redis_mode must be managed, incluster or external."
  }
}

variable "storage_mode" {
  type = string

  validation {
    condition     = contains(["managed", "incluster", "external"], var.storage_mode)
    error_message = "storage_mode must be managed, incluster or external."
  }
}

variable "namespace" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type = string
}

variable "postgres_username" {
  type = string
}

variable "postgres_databases" {
  type = object({
    app       = optional(string, "xyne")
    common    = optional(string, "xyne_common")
    zero_cvr  = optional(string, "zero_cvr")
    zero_cdb  = optional(string, "zero_cdb")
    claw_auth = optional(string, "claw_auth")
  })
  default = {}
}

variable "external_postgres" {
  type = object({
    host     = optional(string, "")
    ro_host  = optional(string, "")
    port     = optional(number, 5432)
    username = optional(string, "xyne")
    sslmode  = optional(string, "require")
  })
  default = {}
}

variable "external_redis" {
  type = object({
    host = optional(string, "")
    port = optional(number, 6379)
    tls  = optional(bool, false)
  })
  default = {}
}

variable "external_storage" {
  type = object({
    provider = optional(string, "s3")
    endpoint = optional(string, "")
    region   = optional(string, "")
    account  = optional(string, "")
    buckets = optional(object({
      main          = optional(string, "")
      docs          = optional(string, "")
      canvas        = optional(string, "")
      recordings    = optional(string, "")
      workflows     = optional(string, "")
      transcription = optional(string, "")
      bundles       = optional(string, "")
      claw          = optional(string, "")
    }), {})
  })
  default = {}
}

variable "storage_bucket_prefix" {
  type = string
}

variable "storage_bucket_names" {
  type    = map(string)
  default = {}
}

variable "redis_auth" {
  type      = string
  sensitive = true
  default   = ""
}

variable "storage_credentials" {
  type = object({
    access_key_id     = optional(string, "")
    secret_access_key = optional(string, "")
  })
  sensitive = true
  default   = {}
}

variable "livekit_enabled" {
  type    = bool
  default = false
}

variable "managed_postgres" {
  type = object({
    mode        = string
    host        = string
    ro_host     = string
    direct_host = string
    port        = number
    username    = string
    sslmode     = string
    databases = object({
      app       = string
      common    = string
      zero_cvr  = string
      zero_cdb  = string
      claw_auth = string
    })
  })
  default = null
}

variable "managed_redis" {
  type = object({
    mode = string
    host = string
    port = number
    tls  = bool
  })
  default = null
}

variable "managed_storage" {
  type = object({
    mode     = string
    provider = string
    endpoint = string
    region   = string
    account  = optional(string, "")
    buckets = object({
      main          = string
      docs          = string
      canvas        = string
      recordings    = string
      workflows     = string
      transcription = string
      bundles       = string
      claw          = string
    })
  })
  default = null
}

variable "managed_redis_auth" {
  type      = string
  sensitive = true
  default   = null
}

variable "managed_storage_credentials" {
  type = object({
    access_key_id     = string
    secret_access_key = string
  })
  sensitive = true
  default   = null
}
