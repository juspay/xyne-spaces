locals {
  domain = var.domain != "" ? var.domain : var.ingress.domain

  postgres_incluster = var.postgres.mode == "incluster"
  redis_incluster    = var.redis.mode == "incluster"
  storage_incluster  = var.storage.mode == "incluster"

  pg_password = var.postgres_password
  redis_auth  = var.redis_auth

  storage_access_key = var.storage_credentials.access_key_id
  storage_secret_key = var.storage_credentials.secret_access_key
  static_credentials = local.storage_incluster || nonsensitive(var.storage_credentials.access_key_id != "")

  pg_userinfo = "${urlencode(var.postgres.username)}:${urlencode(local.pg_password)}"
  pg_query    = "sslmode=${var.postgres.sslmode}"

  pg_urls = {
    app         = "postgresql://${local.pg_userinfo}@${var.postgres.host}:${var.postgres.port}/${var.postgres.databases.app}?${local.pg_query}"
    common      = "postgresql://${local.pg_userinfo}@${var.postgres.host}:${var.postgres.port}/${var.postgres.databases.common}?${local.pg_query}"
    app_ro      = "postgresql://${local.pg_userinfo}@${var.postgres.ro_host}:${var.postgres.port}/${var.postgres.databases.app}?${local.pg_query}"
    claw_auth   = "postgresql://${local.pg_userinfo}@${var.postgres.host}:${var.postgres.port}/${var.postgres.databases.claw_auth}?${local.pg_query}"
    zero_app    = "postgresql://${local.pg_userinfo}@${var.postgres.direct_host}:${var.postgres.port}/${var.postgres.databases.app}?${local.pg_query}"
    zero_cvr    = "postgresql://${local.pg_userinfo}@${var.postgres.direct_host}:${var.postgres.port}/${var.postgres.databases.zero_cvr}?${local.pg_query}"
    zero_change = "postgresql://${local.pg_userinfo}@${var.postgres.direct_host}:${var.postgres.port}/${var.postgres.databases.zero_cdb}?${local.pg_query}"
  }

  redis_scheme   = var.redis.tls ? "rediss" : "redis"
  redis_userinfo = local.redis_auth == "" ? "" : ":${urlencode(local.redis_auth)}@"
  redis_url      = "${local.redis_scheme}://${local.redis_userinfo}${var.redis.host}:${var.redis.port}"

  livekit_api_key    = var.livekit_keys.api_key
  livekit_api_secret = var.livekit_keys.api_secret

  secret_names = concat(
    [
      "xyne-backend-secrets",
      "xyne-zero-secrets",
      "xyne-claw-secrets",
      "xyne-claw-auth-secrets",
      "xyne-ysweet-secrets",
      "xyne-transcription-agent-secrets",
    ],
    local.postgres_incluster ? ["xyne-pg-app"] : [],
    local.redis_incluster ? ["xyne-redis-auth"] : [],
    local.storage_incluster ? ["xyne-minio-root"] : [],
  )

  secret_types = {
    "xyne-pg-app" = "kubernetes.io/basic-auth"
  }

  secret_data = {
    "xyne-backend-secrets" = {
      DATABASE_URL                   = local.pg_urls.app
      COMMON_DATABASE_URL            = local.pg_urls.common
      DATABASE_READ_REPLICA_POOL_URL = local.pg_urls.app_ro
      ZERO_UPSTREAM_DB               = local.pg_urls.zero_app
      REDIS_URL                      = local.redis_url
      REDIS_PASSWORD                 = local.redis_auth
      JWT_SECRET                     = var.app_secrets.jwt_secret
      ZERO_AUTH_SECRET               = var.app_secrets.zero_auth_secret
      ENCRYPTION_KEY                 = var.app_secrets.encryption_key
      INTERNAL_S2S_KEY               = var.app_secrets.internal_s2s_key
      Y_SWEET_SERVER_TOKEN           = var.app_secrets.ysweet_server_token
      GOOGLE_CLIENT_ID               = var.app_secrets.google_client_id
      GOOGLE_CLIENT_SECRET           = var.app_secrets.google_client_secret
      AWS_ACCESS_KEY_ID              = local.storage_access_key
      AWS_SECRET_ACCESS_KEY          = local.storage_secret_key
    }
    "xyne-zero-secrets" = {
      ZERO_UPSTREAM_DB    = local.pg_urls.zero_app
      ZERO_CVR_DB         = local.pg_urls.zero_cvr
      ZERO_CHANGE_DB      = local.pg_urls.zero_change
      ZERO_AUTH_SECRET    = var.app_secrets.zero_auth_secret
      ZERO_ADMIN_PASSWORD = var.app_secrets.zero_admin_password
    }
    "xyne-claw-secrets" = {
      XYNE_CLAW_S2S_KEY = var.app_secrets.claw_s2s_key
      INTERNAL_S2S_KEY  = var.app_secrets.internal_s2s_key
      LITELLM_API_KEY   = var.app_secrets.litellm_api_key
      HINDSIGHT_API_KEY = var.app_secrets.hindsight_api_key
      REDIS_PASSWORD    = local.redis_auth
    }
    "xyne-claw-auth-secrets" = {
      DATABASE_URL         = local.pg_urls.claw_auth
      ENCRYPTION_KEY       = var.app_secrets.claw_auth_encryption_key
      XYNE_CLAW_S2S_KEY    = var.app_secrets.claw_s2s_key
      INTERNAL_S2S_KEY     = var.app_secrets.internal_s2s_key
      GOOGLE_CLIENT_ID     = var.app_secrets.google_client_id
      GOOGLE_CLIENT_SECRET = var.app_secrets.google_client_secret
      REDIS_PASSWORD       = local.redis_auth
    }
    "xyne-ysweet-secrets" = {
      Y_SWEET_AUTH          = var.app_secrets.ysweet_auth
      AWS_ACCESS_KEY_ID     = local.storage_access_key
      AWS_SECRET_ACCESS_KEY = local.storage_secret_key
    }
    "xyne-transcription-agent-secrets" = {
      LIVEKIT_API_KEY             = local.livekit_api_key
      LIVEKIT_API_SECRET          = local.livekit_api_secret
      TRANSCRIPTION_AGENT_API_KEY = var.app_secrets.transcription_agent_api_key
    }
    "xyne-pg-app" = {
      username = var.postgres.username
      password = local.pg_password
    }
    "xyne-redis-auth" = {
      password = local.redis_auth
    }
    "xyne-minio-root" = {
      rootUser     = local.storage_access_key
      rootPassword = local.storage_secret_key
    }
  }

  node_pools = {
    for name, pool in var.node_pools : name => {
      enabled      = pool.enabled
      nodeSelector = pool.node_selector
      tolerations = [
        for t in pool.tolerations : {
          for k, v in {
            key               = t.key
            operator          = t.operator
            value             = t.value
            effect            = t.effect
            tolerationSeconds = t.toleration_seconds
          } : k => v if v != null
        }
      ]
    }
  }

  apps = {
    for name, app in var.apps : name => {
      for k, v in {
        enabled  = app.enabled
        values   = app.values == "" ? null : yamldecode(app.values)
        storeUrl = app.store_url == "" ? null : app.store_url
      } : k => v if v != null
    }
  }

  workers = [
    for w in var.workers : {
      name   = w.name
      env    = w.env
      values = w.values == "" ? {} : yamldecode(w.values)
    }
  ]

  addon_enabled = {
    lbController      = var.cluster.cloud == "aws" && length(var.identities.lb_controller.annotations) > 0
    clusterAutoscaler = var.cluster.cloud == "aws" && length(var.identities.cluster_autoscaler.annotations) > 0
    externalDns       = var.ingress.mode == "gateway" && var.ingress.dns_zone != "" && length(var.identities.external_dns.annotations) > 0
    istio             = true
    certManager       = true
    cnpg              = local.postgres_incluster
    redis             = local.redis_incluster
    minio             = local.storage_incluster
    vespa             = var.enable_vespa
    monitoring        = var.enable_monitoring
    sandbox           = var.enable_sandbox
    hindsight         = var.enable_hindsight
  }

  addon_extra = merge(
    {
      certManager = {
        email  = var.acme_email
        issuer = "letsencrypt"
      }
    },
    local.hindsight_secret ? {
      hindsight = {
        namespace      = var.hindsight_namespace
        existingSecret = "hindsight-secrets"
      }
    } : {},
  )

  addons = merge(
    {
      for name, enabled in local.addon_enabled : name => merge(
        { enabled = enabled },
        lookup(local.addon_extra, name, {}),
        contains(keys(var.addon_values), name) ? { values = yamldecode(var.addon_values[name]) } : {},
      )
    },
    {
      for name, values in var.addon_values : name => { values = yamldecode(values) } if !contains(keys(local.addon_enabled), name)
    },
  )

  root_values = {
    platformRevision = var.root_revision
    global = {
      cloud         = var.cluster.cloud
      domain        = local.domain
      namespace     = var.namespace
      repoURL       = var.repo_url
      chartRevision = var.chart_revision
      imageRegistry = var.image_registry
      imageTag      = var.image_tag
    }
    infra = {
      cluster = {
        name      = var.cluster.name
        region    = var.cluster.region
        networkId = var.cluster.network_id
      }
      postgres = {
        mode       = var.postgres.mode
        host       = var.postgres.host
        roHost     = var.postgres.ro_host
        directHost = var.postgres.direct_host
        port       = var.postgres.port
        username   = var.postgres.username
        sslmode    = var.postgres.sslmode
        databases = {
          app      = var.postgres.databases.app
          common   = var.postgres.databases.common
          zeroCvr  = var.postgres.databases.zero_cvr
          zeroCdb  = var.postgres.databases.zero_cdb
          clawAuth = var.postgres.databases.claw_auth
        }
      }
      redis = {
        mode = var.redis.mode
        host = var.redis.host
        port = var.redis.port
        tls  = var.redis.tls
      }
      storage = {
        mode              = var.storage.mode
        provider          = var.storage.provider
        endpoint          = var.storage.endpoint
        region            = var.storage.region
        account           = var.storage.account
        staticCredentials = local.static_credentials
        buckets           = var.storage.buckets
      }
      identities = {
        backend           = var.identities.backend
        worker            = var.identities.worker
        dashboardEdge     = var.identities.dashboard_edge
        ysweet            = var.identities.ysweet
        claw              = var.identities.claw
        clawAuth          = var.identities.claw_auth
        transcription     = var.identities.transcription
        lbController      = var.identities.lb_controller
        clusterAutoscaler = var.identities.cluster_autoscaler
        externalDns       = var.identities.external_dns
        zero              = var.identities.zero
      }
      zero = {
        backupUrl = var.zero_backup_url
      }
      nodePools = local.node_pools
      ingress = {
        domain                = var.ingress.domain
        mode                  = var.ingress.mode
        staticIp              = var.ingress.static_ip
        lbAnnotations         = var.ingress.lb_annotations
        dnsZone               = var.ingress.dns_zone
        serviceType           = var.ingress.service_type
        externalTrafficPolicy = var.ingress.external_traffic_policy
        nodePorts             = var.ingress.node_ports
        tls                   = var.ingress.tls
        tlsSecret             = var.ingress.tls_secret
        edge = {
          ip       = var.ingress.edge.ip
          hostname = var.ingress.edge.hostname
        }
      }
      livekit = {
        enabled  = var.livekit.enabled
        url      = var.livekit.url
        httpUrl  = var.livekit.http_url
        turnHost = var.livekit.turn_host
      }
      hindsight = {
        url    = var.hindsight.url
        tenant = var.hindsight.tenant
      }
    }
    addons = local.addons
    apps   = merge(local.apps, { workers = local.workers })
    overlay = {
      sources = [
        for s in var.overlay_sources : {
          name           = s.name
          repoURL        = s.repo_url
          targetRevision = s.target_revision
          path           = s.path
          chart          = s.chart
          chartVersion   = s.chart_version
          namespace      = s.namespace
          helmValues     = s.helm_values
        }
      ]
    }
  }
}
