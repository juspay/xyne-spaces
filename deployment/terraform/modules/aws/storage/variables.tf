variable "region" {
  type = string
}

variable "prefix" {
  type = string
}

variable "bucket_names" {
  type    = map(string)
  default = {}
}

variable "keys" {
  type    = list(string)
  default = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]
}

variable "versioning" {
  type    = bool
  default = false
}

variable "force_destroy" {
  type    = bool
  default = false
}

variable "kms_key_arn" {
  type    = string
  default = ""
}

variable "lifecycle_rules" {
  type = list(object({
    id                                 = string
    enabled                            = optional(bool, true)
    prefix                             = optional(string, "")
    expiration_days                    = optional(number)
    noncurrent_version_expiration_days = optional(number)
    abort_incomplete_multipart_days    = optional(number)
    transitions = optional(list(object({
      days          = number
      storage_class = string
    })), [])
  }))
  default = []
}

variable "cors" {
  type = object({
    origins         = list(string)
    methods         = optional(list(string), ["GET", "HEAD", "PUT", "POST", "DELETE"])
    allowed_headers = optional(list(string), ["*"])
    expose_headers  = optional(list(string), ["ETag", "Content-Length", "Content-Type"])
    max_age_seconds = optional(number, 3600)
  })
  default = {
    origins = []
  }
}

variable "cors_buckets" {
  type    = list(string)
  default = ["main", "docs", "canvas", "bundles"]
}

variable "tags" {
  type    = map(string)
  default = {}
}
