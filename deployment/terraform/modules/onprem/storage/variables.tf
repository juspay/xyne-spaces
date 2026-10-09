variable "endpoint" {
  type        = string
  description = "S3 endpoint of the Ceph RGW, including scheme and port."
}

variable "region" {
  type    = string
  default = "default"
}

variable "credentials" {
  type = object({
    access_key_id     = string
    secret_access_key = string
  })
  sensitive   = true
  description = "Keystone EC2 credential. Created out of band; RGW does not issue one per bucket."
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

# RGW only answers PutBucketEncryption once SSE-S3 is configured on the cluster,
# so this stays off unless the operator confirms it.
variable "encryption" {
  type    = bool
  default = false
}

variable "lifecycle_rules" {
  type = list(object({
    id                                 = string
    enabled                            = optional(bool, true)
    prefix                             = optional(string, "")
    expiration_days                    = optional(number)
    noncurrent_version_expiration_days = optional(number)
    abort_incomplete_multipart_days    = optional(number)
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
