variable "cluster" {
  type = object({
    cloud          = string
    name           = string
    region         = string
    endpoint       = string
    ca_certificate = string
    network_id     = optional(string, "")
  })

  validation {
    condition     = contains(["gcp", "aws", "azure"], var.cluster.cloud)
    error_message = "cluster.cloud must be gcp, aws or azure."
  }
}

variable "postgres" {
  type = object({
    mode        = string
    host        = string
    ro_host     = string
    direct_host = string
    port        = number
    username    = string
    sslmode     = string
    databases = object({
      app       = string
      common    = string
      zero_cvr  = string
      zero_cdb  = string
      claw_auth = string
    })
  })

  validation {
    condition     = contains(["managed", "incluster", "external"], var.postgres.mode)
    error_message = "postgres.mode must be managed, incluster or external."
  }
}

variable "postgres_password" {
  type      = string
  sensitive = true

  validation {
    condition     = length(var.postgres_password) >= 16
    error_message = "postgres_password must be at least 16 characters."
  }
}

variable "app_secrets" {
  type = object({
    jwt_secret                  = string
    zero_auth_secret            = string
    zero_admin_password         = string
    encryption_key              = string
    internal_s2s_key            = string
    claw_s2s_key                = string
    claw_auth_encryption_key    = string
    ysweet_auth                 = string
    ysweet_server_token         = string
    transcription_agent_api_key = string
    litellm_api_key             = optional(string, "")
    hindsight_api_key           = optional(string, "")
    hindsight_llm_api_key       = optional(string, "")
    google_client_id            = optional(string, "")
    google_client_secret        = optional(string, "")
  })
  sensitive = true

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.app_secrets.encryption_key)) && can(regex("^[0-9a-f]{64}$", var.app_secrets.claw_auth_encryption_key))
    error_message = "encryption_key and claw_auth_encryption_key must be 32 bytes as 64 hex characters."
  }

  validation {
    condition = alltrue([
      length(var.app_secrets.jwt_secret) >= 32,
      length(var.app_secrets.zero_auth_secret) >= 32,
      length(var.app_secrets.zero_admin_password) >= 16,
      length(var.app_secrets.internal_s2s_key) >= 32,
      length(var.app_secrets.claw_s2s_key) >= 32,
      length(var.app_secrets.transcription_agent_api_key) >= 32,
    ])
    error_message = "jwt_secret, zero_auth_secret, internal_s2s_key, claw_s2s_key and transcription_agent_api_key need at least 32 characters; zero_admin_password at least 16."
  }

  validation {
    condition     = var.app_secrets.ysweet_auth != "" && var.app_secrets.ysweet_server_token != ""
    error_message = "ysweet_auth and ysweet_server_token are the private_key and server_token printed by `y-sweet gen-auth --json`."
  }
}

variable "redis" {
  type = object({
    mode = string
    host = string
    port = number
    tls  = bool
  })

  validation {
    condition     = contains(["managed", "incluster", "external"], var.redis.mode)
    error_message = "redis.mode must be managed, incluster or external."
  }
}

variable "redis_auth" {
  type      = string
  sensitive = true
  default   = ""
}

variable "storage" {
  type = object({
    mode     = string
    provider = string
    endpoint = string
    region   = string
    account  = optional(string, "")
    buckets = object({
      main          = string
      docs          = string
      canvas        = string
      recordings    = string
      workflows     = string
      transcription = string
      bundles       = string
      claw          = string
    })
  })

  validation {
    condition     = contains(["managed", "incluster", "external"], var.storage.mode)
    error_message = "storage.mode must be managed, incluster or external."
  }

  validation {
    condition     = contains(["gcs", "s3", "azure"], var.storage.provider)
    error_message = "storage.provider must be gcs, s3 or azure."
  }
}

variable "storage_credentials" {
  type = object({
    access_key_id     = string
    secret_access_key = string
  })
  sensitive = true
  default = {
    access_key_id     = ""
    secret_access_key = ""
  }
}

variable "identities" {
  type = object({
    backend            = object({ annotations = map(string), labels = map(string) })
    worker             = object({ annotations = map(string), labels = map(string), ksa_names = optional(list(string), []) })
    dashboard_edge     = object({ annotations = map(string), labels = map(string) })
    ysweet             = object({ annotations = map(string), labels = map(string) })
    claw               = object({ annotations = map(string), labels = map(string) })
    claw_auth          = object({ annotations = map(string), labels = map(string) })
    transcription      = object({ annotations = map(string), labels = map(string) })
    lb_controller      = optional(object({ annotations = map(string), labels = map(string) }), { annotations = {}, labels = {} })
    cluster_autoscaler = optional(object({ annotations = map(string), labels = map(string) }), { annotations = {}, labels = {} })
    external_dns       = optional(object({ annotations = map(string), labels = map(string) }), { annotations = {}, labels = {} })
    zero               = optional(object({ annotations = map(string), labels = map(string) }), { annotations = {}, labels = {} })
  })
}

variable "zero_backup_url" {
  type    = string
  default = ""
}

variable "node_pools" {
  type = map(object({
    enabled       = bool
    node_selector = map(string)
    tolerations = list(object({
      key                = optional(string)
      operator           = optional(string)
      value              = optional(string)
      effect             = optional(string)
      toleration_seconds = optional(number)
    }))
  }))

  validation {
    condition     = length(setsubtract(["general", "zero", "vespa", "sandbox"], keys(var.node_pools))) == 0
    error_message = "node_pools must define general, zero, vespa and sandbox."
  }
}

variable "ingress" {
  type = object({
    domain                  = string
    static_ip               = string
    lb_annotations          = map(string)
    dns_zone                = string
    mode                    = optional(string, "gateway")
    service_type            = optional(string, "")
    external_traffic_policy = optional(string, "")
    node_ports              = optional(map(number), {})
    tls                     = optional(string, "")
    tls_secret              = optional(string, "xyne-gateway-tls")
    edge = optional(object({
      ip       = optional(string, "")
      hostname = optional(string, "")
    }), {})
  })

  validation {
    condition     = contains(["gateway", "cloud-lb", "external"], var.ingress.mode)
    error_message = "ingress.mode must be gateway, cloud-lb or external."
  }

  validation {
    condition     = var.ingress.tls == "" || contains(["acme", "internal", "existing", "none"], var.ingress.tls)
    error_message = "ingress.tls must be acme, internal, existing or none."
  }
}

variable "namespace" {
  type    = string
  default = "xyne"
}

variable "domain" {
  type    = string
  default = ""
}

variable "repo_url" {
  type    = string
  default = "https://github.com/juspay/xyne-spaces.git"
}

variable "chart_revision" {
  type = string
}

variable "root_revision" {
  type    = string
  default = "main"
}

variable "image_registry" {
  type    = string
  default = ""
}

variable "image_tag" {
  type    = string
  default = ""
}

variable "acme_email" {
  type    = string
  default = ""
}

variable "gateway_namespace" {
  type    = string
  default = "istio-ingress"
}

variable "gateway_tls" {
  type = object({
    cert_pem = optional(string, "")
    key_pem  = optional(string, "")
  })
  default   = {}
  sensitive = true
}

variable "argocd_chart_version" {
  type    = string
  default = "10.9.2"
}

variable "argocd_apps_chart_version" {
  type    = string
  default = "2.0.5"
}

variable "db_init_image" {
  type    = string
  default = "docker.io/library/postgres:16"
}

variable "argocd_namespace" {
  type    = string
  default = "argocd"
}

variable "argocd_values" {
  type    = string
  default = ""
}

variable "enable_vespa" {
  type    = bool
  default = false
}

variable "enable_hindsight" {
  type    = bool
  default = false
}

variable "enable_monitoring" {
  type    = bool
  default = false
}

variable "enable_sandbox" {
  type    = bool
  default = false
}

variable "apps" {
  type = map(object({
    enabled   = optional(bool)
    values    = optional(string, "")
    store_url = optional(string, "")
  }))
  default = {}
}

variable "workers" {
  type = list(object({
    name   = string
    env    = optional(map(string), {})
    values = optional(string, "")
  }))
  default = []
}

variable "addon_values" {
  type    = map(string)
  default = {}
}

variable "overlay_sources" {
  type = list(object({
    name            = string
    repo_url        = string
    target_revision = string
    path            = optional(string, "")
    chart           = optional(string, "")
    chart_version   = optional(string, "")
    namespace       = optional(string, "")
    helm_values     = optional(string, "")
  }))
  default = []

  validation {
    condition     = alltrue([for s in var.overlay_sources : (s.path != "") != (s.chart != "")])
    error_message = "each overlay_sources entry sets exactly one of path (a git path in repo_url) or chart (a chart name in the Helm/OCI repository repo_url)."
  }

  validation {
    condition     = alltrue([for s in var.overlay_sources : s.chart == "" || s.chart_version != ""])
    error_message = "overlay_sources entries with chart set also need chart_version."
  }
}

variable "extra_secret_data" {
  type      = map(map(string))
  sensitive = true
  default   = {}
}

variable "livekit" {
  type = object({
    enabled   = bool
    url       = string
    http_url  = string
    turn_host = string
    group     = string
  })
  default = {
    enabled   = false
    url       = ""
    http_url  = ""
    turn_host = ""
    group     = ""
  }
}

variable "hindsight_namespace" {
  type    = string
  default = "hindsight"
}

variable "hindsight" {
  type = object({
    url    = optional(string, "")
    tenant = optional(string, "default")
  })
  default = {}

  validation {
    condition     = var.hindsight.url == "" || can(regex("^https?://", var.hindsight.url))
    error_message = "hindsight.url must be an http(s) URL."
  }
}

variable "livekit_keys" {
  type = object({
    api_key    = string
    api_secret = string
  })
  sensitive = true
  default = {
    api_key    = ""
    api_secret = ""
  }
}
