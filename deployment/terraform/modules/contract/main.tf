locals {
  postgres_managed = var.postgres_mode == "managed"
  redis_managed    = var.redis_mode == "managed"
  storage_managed  = var.storage_mode == "managed"

  bucket_keys = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]
  bucket_names = {
    for key in local.bucket_keys : key => lookup(var.storage_bucket_names, key, "${var.storage_bucket_prefix}-${key}")
  }

  databases = {
    app       = var.postgres_databases.app
    common    = var.postgres_databases.common
    zero_cvr  = var.postgres_databases.zero_cvr
    zero_cdb  = var.postgres_databases.zero_cdb
    claw_auth = var.postgres_databases.claw_auth
  }

  postgres_by_mode = {
    managed = var.managed_postgres
    incluster = {
      mode        = "incluster"
      host        = "xyne-pg-pooler-rw.${var.namespace}.svc"
      ro_host     = "xyne-pg-pooler-ro.${var.namespace}.svc"
      direct_host = "xyne-pg-rw.${var.namespace}.svc"
      port        = 5432
      username    = var.postgres_username
      sslmode     = "require"
      databases   = local.databases
    }
    external = {
      mode        = "external"
      host        = var.external_postgres.host
      ro_host     = var.external_postgres.ro_host != "" ? var.external_postgres.ro_host : var.external_postgres.host
      direct_host = var.external_postgres.host
      port        = var.external_postgres.port
      username    = var.external_postgres.username
      sslmode     = var.external_postgres.sslmode
      databases   = local.databases
    }
  }

  redis_by_mode = {
    managed = var.managed_redis
    incluster = {
      mode = "incluster"
      host = "xyne-redis.${var.namespace}.svc"
      port = 6379
      tls  = false
    }
    external = {
      mode = "external"
      host = var.external_redis.host
      port = var.external_redis.port
      tls  = var.external_redis.tls
    }
  }

  storage_by_mode = {
    managed = var.managed_storage
    incluster = {
      mode     = "incluster"
      provider = "s3"
      endpoint = "http://xyne-minio.${var.namespace}.svc:9000"
      region   = var.region
      account  = ""
      buckets  = local.bucket_names
    }
    external = {
      mode     = "external"
      provider = var.external_storage.provider
      endpoint = var.external_storage.endpoint
      region   = var.external_storage.region
      account  = var.external_storage.account
      buckets = {
        main          = var.external_storage.buckets.main
        docs          = var.external_storage.buckets.docs
        canvas        = var.external_storage.buckets.canvas
        recordings    = var.external_storage.buckets.recordings
        workflows     = var.external_storage.buckets.workflows
        transcription = var.external_storage.buckets.transcription
        bundles       = var.external_storage.buckets.bundles
        claw          = var.external_storage.buckets.claw
      }
    }
  }

  postgres = local.postgres_by_mode[var.postgres_mode]
  redis    = local.redis_by_mode[var.redis_mode]
  storage  = local.storage_by_mode[var.storage_mode]

  redis_auth = local.redis_managed ? var.managed_redis_auth : var.redis_auth

  storage_credentials = local.storage_managed ? var.managed_storage_credentials : {
    access_key_id     = var.storage_credentials.access_key_id
    secret_access_key = var.storage_credentials.secret_access_key
  }
}

resource "terraform_data" "inputs" {
  lifecycle {
    precondition {
      condition     = !local.postgres_managed || var.managed_postgres != null
      error_message = "managed_postgres is required when postgres_mode is managed."
    }

    precondition {
      condition     = !local.redis_managed || (var.managed_redis != null && var.managed_redis_auth != null)
      error_message = "managed_redis and managed_redis_auth are required when redis_mode is managed."
    }

    precondition {
      condition     = !local.storage_managed || (var.managed_storage != null && var.managed_storage_credentials != null)
      error_message = "managed_storage and managed_storage_credentials are required when storage_mode is managed."
    }

    precondition {
      condition     = var.postgres_mode != "external" || var.external_postgres.host != ""
      error_message = "external_postgres.host is required when postgres_mode is external."
    }

    precondition {
      condition     = var.redis_mode != "external" || var.external_redis.host != ""
      error_message = "external_redis.host is required when redis_mode is external."
    }

    precondition {
      condition     = var.storage_mode != "external" || alltrue([for k, v in var.external_storage.buckets : v != ""])
      error_message = "external_storage.buckets must name all eight buckets when storage_mode is external."
    }

    precondition {
      condition     = local.storage_managed || (var.storage_credentials.access_key_id != "" && var.storage_credentials.secret_access_key != "")
      error_message = "storage_credentials are required when storage_mode is incluster or external."
    }

    precondition {
      condition     = var.redis_mode != "incluster" || var.redis_auth != ""
      error_message = "redis_auth is required when redis_mode is incluster."
    }

    precondition {
      condition     = !var.livekit_enabled || var.redis_mode != "incluster"
      error_message = "livekit_enabled requires redis_mode to be managed or external."
    }
  }
}
