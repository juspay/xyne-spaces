output "postgres" {
  value = local.postgres
}

output "redis" {
  value = local.redis
}

output "storage" {
  value = local.storage
}

output "redis_auth" {
  value     = local.redis_auth
  sensitive = true
}

output "storage_credentials" {
  value     = local.storage_credentials
  sensitive = true
}

output "bucket_names" {
  value = local.bucket_names
}
