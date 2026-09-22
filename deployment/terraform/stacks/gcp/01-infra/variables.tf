variable "project" {
  type = string
}

variable "region" {
  type = string
}

variable "name" {
  type    = string
  default = "xyne"
}

variable "domain" {
  type = string
}

variable "dns_zone" {
  type    = string
  default = ""
}

variable "namespace" {
  type    = string
  default = "xyne"
}

variable "worker_names" {
  type    = list(string)
  default = []
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "enable_apis" {
  type    = bool
  default = true
}

variable "subnet_cidr" {
  type    = string
  default = "10.10.0.0/20"
}

variable "pods_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "services_cidr" {
  type    = string
  default = "10.30.0.0/20"
}

variable "private_service_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "enable_iap_ssh" {
  type    = bool
  default = true
}

variable "bastion_enabled" {
  type    = bool
  default = false
}

variable "bastion_zone" {
  type    = string
  default = ""
}

variable "bastion_machine_type" {
  type    = string
  default = "e2-small"
}

variable "enable_flow_logs" {
  type    = bool
  default = false
}

variable "release_channel" {
  type    = string
  default = "REGULAR"
}

variable "kubernetes_version" {
  type    = string
  default = ""
}

variable "master_ipv4_cidr_block" {
  type    = string
  default = "172.16.0.0/28"
}

variable "master_authorized_networks" {
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  default = []
}

variable "enable_private_endpoint" {
  type    = bool
  default = false
}

variable "node_locations" {
  type    = list(string)
  default = []
}

variable "cluster_logging" {
  type    = bool
  default = true
}

variable "cluster_monitoring" {
  type    = bool
  default = true
}

variable "maintenance_window" {
  type = object({
    start_time = string
    end_time   = string
    recurrence = string
  })
  default = {
    start_time = "2026-01-01T02:00:00Z"
    end_time   = "2026-01-01T06:00:00Z"
    recurrence = "FREQ=WEEKLY;BYDAY=SA,SU"
  }
}

variable "cluster_deletion_protection" {
  type    = bool
  default = true
}

variable "node_pools" {
  type = object({
    general = optional(object({
      machine_type = optional(string)
      min_count    = optional(number)
      max_count    = optional(number)
      disk_size_gb = optional(number)
      disk_type    = optional(string)
      spot         = optional(bool)
      labels       = optional(map(string))
    }), {})
    zero = optional(object({
      machine_type    = optional(string)
      min_count       = optional(number)
      max_count       = optional(number)
      disk_size_gb    = optional(number)
      disk_type       = optional(string)
      spot            = optional(bool)
      labels          = optional(map(string))
      local_ssd_count = optional(number)
    }), {})
    vespa = optional(object({
      machine_type = optional(string)
      min_count    = optional(number)
      max_count    = optional(number)
      disk_size_gb = optional(number)
      disk_type    = optional(string)
      spot         = optional(bool)
      labels       = optional(map(string))
    }), {})
    sandbox = optional(object({
      machine_type = optional(string)
      min_count    = optional(number)
      max_count    = optional(number)
      disk_size_gb = optional(number)
      disk_type    = optional(string)
      spot         = optional(bool)
      labels       = optional(map(string))
    }), {})
  })
  default = {}
}

variable "zero_pool_enabled" {
  type    = bool
  default = false
}

variable "vespa_enabled" {
  type    = bool
  default = false
}

variable "sandbox_enabled" {
  type    = bool
  default = false
}

variable "postgres_mode" {
  type    = string
  default = "managed"

  validation {
    condition     = contains(["managed", "incluster", "external"], var.postgres_mode)
    error_message = "postgres_mode must be managed, incluster or external."
  }
}

variable "postgres_tier" {
  type    = string
  default = "db-custom-2-8192"
}

variable "postgres_availability_type" {
  type    = string
  default = "REGIONAL"
}

variable "postgres_disk_size_gb" {
  type    = number
  default = 20
}

variable "postgres_disk_autoresize_limit" {
  type    = number
  default = 0
}

variable "postgres_backup_start_time" {
  type    = string
  default = "02:00"
}

variable "postgres_backup_retention_count" {
  type    = number
  default = 7
}

variable "postgres_transaction_log_retention_days" {
  type    = number
  default = 7
}

variable "postgres_maintenance_window" {
  type = object({
    day  = number
    hour = number
  })
  default = {
    day  = 7
    hour = 3
  }
}

variable "postgres_deletion_protection" {
  type    = bool
  default = true
}

variable "postgres_require_ssl" {
  type    = bool
  default = true
}

variable "postgres_flags" {
  type    = map(string)
  default = {}
}

variable "postgres_max_replication_slots" {
  type    = number
  default = 10
}

variable "postgres_max_wal_senders" {
  type    = number
  default = 10
}

variable "postgres_read_replica" {
  type    = bool
  default = false
}

variable "postgres_read_replica_tier" {
  type    = string
  default = ""
}

variable "postgres_username" {
  type    = string
  default = "xyne"
}

variable "postgres_databases" {
  type = object({
    app       = optional(string, "xyne")
    common    = optional(string, "xyne_common")
    zero_cvr  = optional(string, "zero_cvr")
    zero_cdb  = optional(string, "zero_cdb")
    claw_auth = optional(string, "claw_auth")
  })
  default = {}
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

variable "external_postgres" {
  type = object({
    host     = optional(string, "")
    ro_host  = optional(string, "")
    port     = optional(number, 5432)
    username = optional(string, "xyne")
    sslmode  = optional(string, "require")
  })
  default = {}
}

variable "redis_mode" {
  type    = string
  default = "managed"

  validation {
    condition     = contains(["managed", "incluster", "external"], var.redis_mode)
    error_message = "redis_mode must be managed, incluster or external."
  }
}

variable "redis_tier" {
  type    = string
  default = "STANDARD_HA"
}

variable "redis_memory_size_gb" {
  type    = number
  default = 4
}

variable "redis_version" {
  type    = string
  default = "REDIS_7_2"
}

variable "redis_tls" {
  type    = bool
  default = false
}

variable "redis_maintenance_window" {
  type = object({
    day     = string
    hour    = number
    minutes = number
  })
  default = {
    day     = "SUNDAY"
    hour    = 3
    minutes = 0
  }
}

variable "redis_configs" {
  type    = map(string)
  default = {}
}

variable "external_redis" {
  type = object({
    host = optional(string, "")
    port = optional(number, 6379)
    tls  = optional(bool, false)
  })
  default = {}
}

variable "redis_auth" {
  type      = string
  sensitive = true
  default   = ""
}

variable "storage_mode" {
  type    = string
  default = "managed"

  validation {
    condition     = contains(["managed", "incluster", "external"], var.storage_mode)
    error_message = "storage_mode must be managed, incluster or external."
  }
}

variable "storage_bucket_prefix" {
  type    = string
  default = ""
}

variable "storage_bucket_names" {
  type    = map(string)
  default = {}
}

variable "storage_class" {
  type    = string
  default = "STANDARD"
}

variable "storage_versioning" {
  type    = bool
  default = false
}

variable "storage_force_destroy" {
  type    = bool
  default = false
}

variable "storage_lifecycle_rules" {
  type = list(object({
    action = object({
      type          = string
      storage_class = optional(string)
    })
    condition = object({
      age                        = optional(number)
      num_newer_versions         = optional(number)
      with_state                 = optional(string)
      days_since_noncurrent_time = optional(number)
      matches_prefix             = optional(list(string), [])
    })
  }))
  default = []
}

variable "storage_cors_origins" {
  type    = list(string)
  default = []
}

variable "external_storage" {
  type = object({
    provider = optional(string, "s3")
    endpoint = optional(string, "")
    region   = optional(string, "")
    buckets = optional(object({
      main          = optional(string, "")
      docs          = optional(string, "")
      canvas        = optional(string, "")
      recordings    = optional(string, "")
      workflows     = optional(string, "")
      transcription = optional(string, "")
      bundles       = optional(string, "")
      claw          = optional(string, "")
    }), {})
  })
  default = {}
}

variable "storage_credentials" {
  type = object({
    access_key_id     = optional(string, "")
    secret_access_key = optional(string, "")
  })
  sensitive = true
  default   = {}
}

variable "ingress_static_ip" {
  type    = bool
  default = true
}

variable "ingress_mode" {
  type    = string
  default = "gateway"

  validation {
    condition     = contains(["gateway", "cloud-lb", "external"], var.ingress_mode)
    error_message = "ingress_mode must be gateway, cloud-lb or external."
  }
}

variable "ingress_node_ports" {
  type = object({
    http   = optional(number, 30080)
    https  = optional(number, 30443)
    status = optional(number, 30021)
  })
  default = {}
}

variable "ingress_tls" {
  type    = string
  default = ""

  validation {
    condition     = var.ingress_tls == "" || contains(["acme", "internal", "existing", "none"], var.ingress_tls)
    error_message = "ingress_tls must be acme, internal, existing or none."
  }
}

variable "ingress_tls_secret" {
  type    = string
  default = "xyne-gateway-tls"
}

variable "ingress_external_traffic_policy" {
  type    = string
  default = ""

  validation {
    condition     = var.ingress_external_traffic_policy == "" || contains(["Local", "Cluster"], var.ingress_external_traffic_policy)
    error_message = "ingress_external_traffic_policy must be Local or Cluster."
  }
}

variable "ingress_certificate_ids" {
  type    = list(string)
  default = []
}

variable "ingress_certificate_pem" {
  type      = string
  sensitive = true
  default   = ""
}

variable "ingress_private_key_pem" {
  type      = string
  sensitive = true
  default   = ""
}

variable "ingress_certificate_domains" {
  type    = list(string)
  default = []
}

variable "ingress_http_redirect" {
  type    = bool
  default = true
}

variable "livekit_enabled" {
  type    = bool
  default = false
}

variable "livekit_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "livekit_api_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "livekit_server_image" {
  type    = string
  default = "livekit/livekit-server:v1.9.1"
}

variable "livekit_egress_image" {
  type    = string
  default = "livekit/egress:v1.9.1"
}

variable "livekit_vm_image" {
  type    = string
  default = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
}

variable "livekit_machine_type" {
  type    = string
  default = "n2-standard-4"
}

variable "livekit_egress_machine_type" {
  type    = string
  default = "n2-standard-4"
}

variable "livekit_disk_size_gb" {
  type    = number
  default = 50
}

variable "livekit_min_replicas" {
  type    = number
  default = 1
}

variable "livekit_max_replicas" {
  type    = number
  default = 3
}

variable "livekit_target_cpu_utilization" {
  type    = number
  default = 0.6
}

variable "livekit_egress_min_replicas" {
  type    = number
  default = 1
}

variable "livekit_egress_max_replicas" {
  type    = number
  default = 3
}

variable "livekit_port_range_start" {
  type    = number
  default = 50000
}

variable "livekit_port_range_end" {
  type    = number
  default = 60000
}

variable "livekit_turn_cert_secret" {
  type    = string
  default = ""
}
