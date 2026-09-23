variable "subscription_id" {
  type = string
}

variable "region" {
  type = string
}

variable "resource_group_name" {
  type    = string
  default = ""
}

variable "create_resource_group" {
  type    = bool
  default = true
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

variable "dns_zone_resource_group" {
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

variable "tags" {
  type    = map(string)
  default = {}
}

variable "zones" {
  type    = list(string)
  default = []
}

variable "ssh_public_key" {
  type    = string
  default = ""
}

variable "vnet_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "aks_subnet_cidr" {
  type    = string
  default = "10.10.0.0/20"
}

variable "postgres_subnet_cidr" {
  type    = string
  default = "10.10.16.0/24"
}

variable "private_endpoints_subnet_cidr" {
  type    = string
  default = "10.10.17.0/24"
}

variable "livekit_subnet_cidr" {
  type    = string
  default = "10.10.18.0/24"
}

variable "livekit_egress_subnet_cidr" {
  type    = string
  default = "10.10.19.0/24"
}

variable "bastion_subnet_cidr" {
  type    = string
  default = "10.10.20.0/27"
}

variable "azure_bastion_subnet_cidr" {
  type    = string
  default = "10.10.20.64/26"
}

variable "appgw_subnet_cidr" {
  type    = string
  default = "10.10.21.0/24"
}

variable "pods_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "services_cidr" {
  type    = string
  default = "10.30.0.0/20"
}

variable "nat_gateway_enabled" {
  type    = bool
  default = true
}

variable "nat_public_ip_prefix_length" {
  type    = number
  default = 30
}

variable "aks_inbound_ports" {
  type    = list(string)
  default = ["80", "443"]
}

variable "bastion_enabled" {
  type    = bool
  default = false
}

variable "bastion_vm_size" {
  type    = string
  default = "Standard_B2s"
}

variable "bastion_allowed_ssh_cidrs" {
  type    = list(string)
  default = []
}

variable "bastion_public_ip" {
  type    = bool
  default = false
}

variable "azure_bastion_enabled" {
  type    = bool
  default = false
}

variable "azure_bastion_sku" {
  type    = string
  default = "Basic"
}

variable "kubernetes_version" {
  type    = string
  default = ""
}

variable "cluster_sku_tier" {
  type    = string
  default = "Standard"
}

variable "enable_private_endpoint" {
  type    = bool
  default = false
}

variable "aks_authorized_ip_ranges" {
  type    = list(string)
  default = []
}

variable "deployer_principal_id" {
  type    = string
  default = ""
}

variable "admin_group_object_ids" {
  type    = list(string)
  default = []
}

variable "azure_rbac_enabled" {
  type    = bool
  default = true
}

variable "local_account_disabled" {
  type    = bool
  default = false
}

variable "key_vault_secrets_provider" {
  type    = bool
  default = false
}

variable "cluster_logging" {
  type    = bool
  default = false
}

variable "cluster_log_retention_days" {
  type    = number
  default = 30
}

variable "log_analytics_workspace_id" {
  type    = string
  default = ""
}

variable "automatic_upgrade_channel" {
  type    = string
  default = "patch"
}

variable "node_os_upgrade_channel" {
  type    = string
  default = "NodeImage"
}

variable "maintenance_window" {
  type = object({
    day_of_week    = string
    start_time     = string
    duration_hours = number
    utc_offset     = string
  })
  default = {
    day_of_week    = "Sunday"
    start_time     = "02:00"
    duration_hours = 4
    utc_offset     = "+00:00"
  }
}

variable "node_pools" {
  type = object({
    general = optional(object({
      vm_size      = optional(string)
      min_count    = optional(number)
      max_count    = optional(number)
      disk_size_gb = optional(number)
      disk_type    = optional(string)
      spot         = optional(bool)
      labels       = optional(map(string))
      os_sku       = optional(string)
    }), {})
    zero = optional(object({
      vm_size                 = optional(string)
      min_count               = optional(number)
      max_count               = optional(number)
      disk_size_gb            = optional(number)
      disk_type               = optional(string)
      spot                    = optional(bool)
      labels                  = optional(map(string))
      os_sku                  = optional(string)
      local_storage_temp_disk = optional(bool)
    }), {})
    vespa = optional(object({
      vm_size      = optional(string)
      min_count    = optional(number)
      max_count    = optional(number)
      disk_size_gb = optional(number)
      disk_type    = optional(string)
      spot         = optional(bool)
      labels       = optional(map(string))
      os_sku       = optional(string)
    }), {})
    sandbox = optional(object({
      vm_size      = optional(string)
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

variable "postgres_server_name" {
  type    = string
  default = ""
}

variable "postgres_engine_version" {
  type    = string
  default = "16"
}

variable "postgres_sku_name" {
  type    = string
  default = "GP_Standard_D2ds_v5"
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768
}

variable "postgres_storage_tier" {
  type    = string
  default = ""
}

variable "postgres_storage_autogrow" {
  type    = bool
  default = true
}

variable "postgres_high_availability" {
  type    = bool
  default = true
}

variable "postgres_zone" {
  type    = string
  default = ""
}

variable "postgres_standby_zone" {
  type    = string
  default = ""
}

variable "postgres_backup_retention_days" {
  type    = number
  default = 7
}

variable "postgres_geo_redundant_backup" {
  type    = bool
  default = false
}

variable "postgres_maintenance_window" {
  type = object({
    day_of_week  = number
    start_hour   = number
    start_minute = number
  })
  default = {
    day_of_week  = 0
    start_hour   = 3
    start_minute = 0
  }
}

variable "postgres_parameters" {
  type    = map(string)
  default = {}
}

variable "postgres_extensions" {
  type    = list(string)
  default = []
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

variable "postgres_read_replica_sku_name" {
  type    = string
  default = ""
}

variable "postgres_read_replica_zone" {
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

variable "redis_cache_name" {
  type    = string
  default = ""
}

variable "redis_sku_name" {
  type    = string
  default = "Standard"
}

variable "redis_capacity" {
  type    = number
  default = 1
}

variable "redis_version" {
  type    = string
  default = "6"
}

variable "redis_replicas_per_primary" {
  type    = number
  default = 1
}

variable "redis_maxmemory_policy" {
  type    = string
  default = "volatile-lru"
}

variable "redis_patch_schedule" {
  type = object({
    day_of_week    = string
    start_hour_utc = number
  })
  default = {
    day_of_week    = "Sunday"
    start_hour_utc = 3
  }
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

variable "storage_account_name" {
  type    = string
  default = ""
}

variable "storage_bucket_prefix" {
  type    = string
  default = ""
}

variable "storage_bucket_names" {
  type    = map(string)
  default = {}
}

variable "storage_replication_type" {
  type    = string
  default = "ZRS"
}

variable "storage_access_tier" {
  type    = string
  default = "Hot"
}

variable "storage_versioning" {
  type    = bool
  default = false
}

variable "storage_shared_access_key_enabled" {
  type    = bool
  default = true
}

variable "storage_delete_retention_days" {
  type    = number
  default = 7
}

variable "storage_public_network_access" {
  type    = bool
  default = true
}

variable "storage_network_default_action" {
  type    = string
  default = "Deny"
}

variable "storage_allowed_ip_ranges" {
  type    = list(string)
  default = []
}

variable "storage_private_endpoint" {
  type    = bool
  default = false
}

variable "storage_lifecycle_rules" {
  type = list(object({
    name                            = string
    enabled                         = optional(bool, true)
    prefixes                        = optional(list(string), [])
    blob_types                      = optional(list(string), ["blockBlob"])
    tier_to_cool_after_days         = optional(number)
    tier_to_archive_after_days      = optional(number)
    delete_after_days               = optional(number)
    version_delete_after_days       = optional(number)
    version_tier_to_cool_after_days = optional(number)
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

variable "ingress_internal_ip" {
  type    = string
  default = ""
}

variable "ingress_certificate_key_vault_secret_id" {
  type    = string
  default = ""
}

variable "ingress_certificate_key_vault_id" {
  type    = string
  default = ""
}

variable "ingress_certificate_pfx_data" {
  type      = string
  sensitive = true
  default   = ""
}

variable "ingress_certificate_pfx_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "ingress_backend_protocol" {
  type    = string
  default = "Https"

  validation {
    condition     = contains(["Https", "Http"], var.ingress_backend_protocol)
    error_message = "ingress_backend_protocol must be Https or Http."
  }
}

variable "ingress_backend_root_certificate_pem" {
  type      = string
  sensitive = true
  default   = ""
}

variable "ingress_appgw_subnet_id" {
  type    = string
  default = ""
}

variable "ingress_appgw_sku" {
  type = object({
    name = optional(string, "Standard_v2")
    tier = optional(string, "Standard_v2")
  })
  default = {}
}

variable "ingress_appgw_capacity" {
  type = object({
    min = optional(number, 1)
    max = optional(number, 3)
  })
  default = {}
}

variable "ingress_appgw_domain_name_label" {
  type    = string
  default = ""
}

variable "ingress_waf_enabled" {
  type    = bool
  default = false
}

variable "ingress_http_redirect" {
  type    = bool
  default = true
}

variable "ingress_request_timeout" {
  type    = number
  default = 3600
}

variable "ingress_probe_path" {
  type    = string
  default = "/healthz/ready"
}

variable "ingress_probe_port" {
  type    = number
  default = 0
}

variable "ingress_probe_status_codes" {
  type    = list(string)
  default = ["200-399"]
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
  type = object({
    publisher = optional(string, "Canonical")
    offer     = optional(string, "ubuntu-24_04-lts")
    sku       = optional(string, "server")
    version   = optional(string, "latest")
  })
  default = {}
}

variable "livekit_vm_size" {
  type    = string
  default = "Standard_D4s_v5"
}

variable "livekit_egress_vm_size" {
  type    = string
  default = "Standard_D4s_v5"
}

variable "livekit_admin_username" {
  type    = string
  default = "xyne"
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

variable "livekit_key_vault_id" {
  type    = string
  default = ""
}

variable "livekit_key_vault_name" {
  type    = string
  default = ""
}

variable "livekit_key_vault_purge_protection" {
  type    = bool
  default = false
}

variable "livekit_turn_cert_secret" {
  type    = string
  default = ""
}

variable "livekit_https" {
  type    = bool
  default = true
}

variable "livekit_certificate_secret_id" {
  type    = string
  default = ""
}

variable "livekit_certificate_key_vault_id" {
  type    = string
  default = ""
}

variable "livekit_appgw_min_capacity" {
  type    = number
  default = 1
}

variable "livekit_appgw_max_capacity" {
  type    = number
  default = 3
}
