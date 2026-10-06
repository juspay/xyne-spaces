locals {
  keys = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]

  names = {
    for key in local.keys : key => lookup(var.bucket_names, key, "${var.prefix}-${key}")
  }
}

resource "google_storage_bucket" "this" {
  for_each = local.names

  name                        = each.value
  project                     = var.project
  location                    = var.location
  storage_class               = var.storage_class
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = var.force_destroy
  labels                      = merge(var.labels, { bucket = each.key })

  versioning {
    enabled = var.versioning
  }

  dynamic "cors" {
    for_each = contains(var.cors_buckets, each.key) && length(var.cors.origins) > 0 ? [var.cors] : []
    content {
      origin          = cors.value.origins
      method          = cors.value.methods
      response_header = cors.value.response_headers
      max_age_seconds = cors.value.max_age_seconds
    }
  }

  dynamic "lifecycle_rule" {
    for_each = var.lifecycle_rules
    content {
      action {
        type          = lifecycle_rule.value.action.type
        storage_class = lifecycle_rule.value.action.storage_class
      }
      condition {
        age                        = lifecycle_rule.value.condition.age
        num_newer_versions         = lifecycle_rule.value.condition.num_newer_versions
        with_state                 = lifecycle_rule.value.condition.with_state
        days_since_noncurrent_time = lifecycle_rule.value.condition.days_since_noncurrent_time
        matches_prefix             = lifecycle_rule.value.condition.matches_prefix
      }
    }
  }
}
