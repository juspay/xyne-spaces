locals {
  bucket_prefix = var.storage_bucket_prefix != "" ? var.storage_bucket_prefix : var.name

  node_pool_keys = ["general", "zero", "vespa", "sandbox", "gpu"]

  node_pools = {
    for key in local.node_pool_keys : key => {
      enabled       = try(var.node_pools[key].enabled, false)
      node_selector = try(var.node_pools[key].node_selector, {})
      tolerations   = try(var.node_pools[key].tolerations, [])
    }
  }

  # No cloud identity provider on-prem, so every workload runs with a plain
  # service account and storage is reached with static credentials.
  empty_identity = { annotations = {}, labels = {} }

  identities = {
    backend            = local.empty_identity
    worker             = merge(local.empty_identity, { ksa_names = [for name in var.worker_names : "xyne-worker-${name}"] })
    dashboard_edge     = local.empty_identity
    ysweet             = local.empty_identity
    claw               = local.empty_identity
    claw_auth          = local.empty_identity
    transcription      = local.empty_identity
    lb_controller      = local.empty_identity
    cluster_autoscaler = local.empty_identity
    external_dns       = local.empty_identity
    zero               = local.empty_identity
  }
}

module "storage" {
  source = "../../../modules/onprem/storage"

  endpoint      = var.storage_endpoint
  region        = var.storage_region
  credentials   = var.storage_credentials
  prefix        = local.bucket_prefix
  bucket_names  = var.storage_bucket_names
  versioning    = var.storage_versioning
  encryption    = var.storage_encryption
  force_destroy = var.storage_force_destroy

  cors = {
    origins = length(var.storage_cors_origins) > 0 ? var.storage_cors_origins : ["https://${var.domain}"]
  }

  tags = {
    environment = var.name
    managed-by  = "terraform"
  }
}

module "zero_backup" {
  count  = var.zero_backup_enabled ? 1 : 0
  source = "../../../modules/onprem/storage"

  endpoint      = var.storage_endpoint
  region        = var.storage_region
  credentials   = var.storage_credentials
  prefix        = local.bucket_prefix
  keys          = ["zero"]
  bucket_names  = var.zero_backup_bucket_name != "" ? { zero = var.zero_backup_bucket_name } : {}
  versioning    = false
  encryption    = var.storage_encryption
  force_destroy = var.storage_force_destroy

  tags = {
    environment = var.name
    managed-by  = "terraform"
    purpose     = "zero-litestream"
  }
}

module "contract" {
  source = "../../../modules/contract"

  name      = var.name
  namespace = var.namespace
  region    = var.storage_region

  postgres_mode = "managed"
  redis_mode    = "managed"
  storage_mode  = "managed"

  postgres_username  = var.postgres_username
  postgres_databases = var.postgres_databases

  storage_bucket_prefix = local.bucket_prefix
  storage_bucket_names  = var.storage_bucket_names

  managed_postgres = {
    mode        = "managed"
    host        = var.postgres_host
    ro_host     = var.postgres_ro_host != "" ? var.postgres_ro_host : var.postgres_host
    direct_host = var.postgres_direct_host != "" ? var.postgres_direct_host : var.postgres_host
    port        = var.postgres_port
    username    = var.postgres_username
    sslmode     = var.postgres_sslmode
    databases = {
      app       = var.postgres_databases.app
      common    = var.postgres_databases.common
      zero_cvr  = var.postgres_databases.zero_cvr
      zero_cdb  = var.postgres_databases.zero_cdb
      claw_auth = var.postgres_databases.claw_auth
    }
  }

  managed_redis = {
    mode = "managed"
    host = var.redis_host
    port = var.redis_port
    tls  = var.redis_tls
  }

  managed_redis_auth = var.redis_auth

  managed_storage             = module.storage.storage
  managed_storage_credentials = module.storage.storage_credentials

  # Guards the precondition that LiveKit cannot run against an in-cluster Redis:
  # the media servers need to reach it from outside the cluster's own services.
  livekit_enabled = var.livekit_enabled
}
