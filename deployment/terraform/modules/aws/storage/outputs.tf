output "bucket_names" {
  value = { for key, bucket in aws_s3_bucket.this : key => bucket.id }
}

output "bucket_arns" {
  value = { for key, bucket in aws_s3_bucket.this : key => bucket.arn }
}

output "storage" {
  value = {
    mode     = "managed"
    provider = "s3"
    endpoint = ""
    region   = var.region
    buckets = {
      main          = try(aws_s3_bucket.this["main"].id, "")
      docs          = try(aws_s3_bucket.this["docs"].id, "")
      canvas        = try(aws_s3_bucket.this["canvas"].id, "")
      recordings    = try(aws_s3_bucket.this["recordings"].id, "")
      workflows     = try(aws_s3_bucket.this["workflows"].id, "")
      transcription = try(aws_s3_bucket.this["transcription"].id, "")
      bundles       = try(aws_s3_bucket.this["bundles"].id, "")
      claw          = try(aws_s3_bucket.this["claw"].id, "")
    }
  }
}

output "storage_credentials" {
  value = {
    access_key_id     = ""
    secret_access_key = ""
  }
  sensitive = true
}
