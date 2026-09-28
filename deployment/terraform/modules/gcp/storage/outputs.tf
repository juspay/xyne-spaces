output "bucket_names" {
  value = { for key, bucket in google_storage_bucket.this : key => bucket.name }
}

output "storage" {
  value = {
    mode     = "managed"
    provider = "gcs"
    endpoint = ""
    region   = var.location
    buckets = {
      main          = google_storage_bucket.this["main"].name
      docs          = google_storage_bucket.this["docs"].name
      canvas        = google_storage_bucket.this["canvas"].name
      recordings    = google_storage_bucket.this["recordings"].name
      workflows     = google_storage_bucket.this["workflows"].name
      transcription = google_storage_bucket.this["transcription"].name
      bundles       = google_storage_bucket.this["bundles"].name
      claw          = google_storage_bucket.this["claw"].name
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
