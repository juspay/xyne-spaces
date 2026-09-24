locals {
  keys = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]

  names = {
    for key in local.keys : key => lookup(var.bucket_names, key, "${var.prefix}-${key}")
  }

  cors_names = {
    for key, name in local.names : key => name if contains(var.cors_buckets, key) && length(var.cors.origins) > 0
  }

  lifecycle_names = length(var.lifecycle_rules) > 0 ? local.names : {}

  sse_algorithm = var.kms_key_arn != "" ? "aws:kms" : "AES256"
}

resource "aws_s3_bucket" "this" {
  for_each = local.names

  bucket        = each.value
  force_destroy = var.force_destroy

  tags = merge(var.tags, { bucket = each.key })
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = aws_s3_bucket.this

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  rule {
    bucket_key_enabled = var.kms_key_arn != ""

    apply_server_side_encryption_by_default {
      sse_algorithm     = local.sse_algorithm
      kms_master_key_id = var.kms_key_arn != "" ? var.kms_key_arn : null
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  versioning_configuration {
    status = var.versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_cors_configuration" "this" {
  for_each = local.cors_names

  bucket = aws_s3_bucket.this[each.key].id

  cors_rule {
    allowed_origins = var.cors.origins
    allowed_methods = var.cors.methods
    allowed_headers = var.cors.allowed_headers
    expose_headers  = var.cors.expose_headers
    max_age_seconds = var.cors.max_age_seconds
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  for_each = local.lifecycle_names

  bucket = aws_s3_bucket.this[each.key].id

  dynamic "rule" {
    for_each = var.lifecycle_rules
    content {
      id     = rule.value.id
      status = rule.value.enabled ? "Enabled" : "Disabled"

      filter {
        prefix = rule.value.prefix
      }

      dynamic "expiration" {
        for_each = rule.value.expiration_days != null ? [rule.value.expiration_days] : []
        content {
          days = expiration.value
        }
      }

      dynamic "noncurrent_version_expiration" {
        for_each = rule.value.noncurrent_version_expiration_days != null ? [rule.value.noncurrent_version_expiration_days] : []
        content {
          noncurrent_days = noncurrent_version_expiration.value
        }
      }

      dynamic "abort_incomplete_multipart_upload" {
        for_each = rule.value.abort_incomplete_multipart_days != null ? [rule.value.abort_incomplete_multipart_days] : []
        content {
          days_after_initiation = abort_incomplete_multipart_upload.value
        }
      }

      dynamic "transition" {
        for_each = rule.value.transitions
        content {
          days          = transition.value.days
          storage_class = transition.value.storage_class
        }
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}
