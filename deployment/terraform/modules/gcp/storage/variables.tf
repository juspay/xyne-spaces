variable "project" {
  type = string
}

variable "location" {
  type = string
}

variable "prefix" {
  type = string
}

variable "bucket_names" {
  type    = map(string)
  default = {}
}

variable "storage_class" {
  type    = string
  default = "STANDARD"
}

variable "versioning" {
  type    = bool
  default = false
}

variable "force_destroy" {
  type    = bool
  default = false
}

variable "lifecycle_rules" {
  type = list(object({
    action = object({
      type          = string
      storage_class = optional(string)
    })
    condition = object({
      age                        = optional(number)
      num_newer_versions         = optional(number)
      with_state                 = optional(string)
      days_since_noncurrent_time = optional(number)
      matches_prefix             = optional(list(string), [])
    })
  }))
  default = []
}

variable "cors" {
  type = object({
    origins          = list(string)
    methods          = optional(list(string), ["GET", "HEAD", "PUT", "POST", "DELETE"])
    response_headers = optional(list(string), ["*"])
    max_age_seconds  = optional(number, 3600)
  })
  default = {
    origins = []
  }
}

variable "cors_buckets" {
  type    = list(string)
  default = ["main", "docs", "canvas", "bundles"]
}

variable "labels" {
  type    = map(string)
  default = {}
}
