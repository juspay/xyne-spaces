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
      main          = aws_s3_bucket.this["main"].id
      docs          = aws_s3_bucket.this["docs"].id
      canvas        = aws_s3_bucket.this["canvas"].id
      recordings    = aws_s3_bucket.this["recordings"].id
      workflows     = aws_s3_bucket.this["workflows"].id
      transcription = aws_s3_bucket.this["transcription"].id
      bundles       = aws_s3_bucket.this["bundles"].id
      claw          = aws_s3_bucket.this["claw"].id
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
