variable "region" {
  type = string
}

variable "profile" {
  type    = string
  default = ""
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

variable "tags" {
  type    = map(string)
  default = {}
}

variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "az_count" {
  type    = number
  default = 3
}

variable "availability_zones" {
  type    = list(string)
  default = []
}

variable "subnet_newbits" {
  type    = number
  default = 4
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = []
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = []
}

variable "services_cidr" {
  type    = string
  default = ""
}

variable "single_nat_gateway" {
  type    = bool
  default = false
}

variable "enable_vpc_endpoints" {
  type    = bool
  default = true
}

variable "enable_flow_logs" {
  type    = bool
  default = false
}

variable "bastion_enabled" {
  type    = bool
  default = false
}

variable "bastion_instance_type" {
  type    = string
  default = "t4g.micro"
}

variable "bastion_ami_ssm_parameter" {
  type    = string
  default = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

variable "kubernetes_version" {
  type    = string
  default = "1.31"
}

variable "enable_private_endpoint" {
  type    = bool
  default = false
}

variable "eks_public_access_cidrs" {
  type    = list(string)
  default = []
}

variable "internet_egress_cidrs" {
  type    = list(string)
  default = []
}

variable "deployer_principal_arn" {
  type    = string
  default = ""
}

variable "cluster_log_types" {
  type    = list(string)
  default = ["api", "audit", "authenticator"]
}

variable "cluster_log_retention_days" {
  type    = number
  default = 30
}

variable "cluster_kms_key_arn" {
  type    = string
  default = ""
}

variable "cluster_support_type" {
  type    = string
  default = "STANDARD"
}

variable "addon_versions" {
  type    = map(string)
  default = {}
}

variable "sandbox_ami_ssm_parameter" {
  type    = string
  default = ""
}

variable "node_pools" {
  type = object({
    general = optional(object({
      instance_type = optional(string)
      min_count     = optional(number)
      max_count     = optional(number)
      desired_count = optional(number)
      disk_size_gb  = optional(number)
      disk_type     = optional(string)
      spot          = optional(bool)
      labels        = optional(map(string))
      ami_type      = optional(string)
    }), {})
    zero = optional(object({
      instance_type       = optional(string)
      min_count           = optional(number)
      max_count           = optional(number)
      desired_count       = optional(number)
      disk_size_gb        = optional(number)
      disk_type           = optional(string)
      spot                = optional(bool)
      labels              = optional(map(string))
      ami_type            = optional(string)
      local_storage_raid0 = optional(bool)
    }), {})
    vespa = optional(object({
      instance_type = optional(string)
      min_count     = optional(number)
      max_count     = optional(number)
      desired_count = optional(number)
      disk_size_gb  = optional(number)
      disk_type     = optional(string)
      spot          = optional(bool)
      labels        = optional(map(string))
      ami_type      = optional(string)
    }), {})
    sandbox = optional(object({
      instance_type = optional(string)
      min_count     = optional(number)
      max_count     = optional(number)
      desired_count = optional(number)
      disk_size_gb  = optional(number)
      disk_type     = optional(string)
      spot          = optional(bool)
      labels        = optional(map(string))
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

variable "postgres_engine_version" {
  type    = string
  default = "16"
}

variable "postgres_instance_class" {
  type    = string
  default = "db.m6g.large"
}

variable "postgres_multi_az" {
  type    = bool
  default = true
}

variable "postgres_disk_size_gb" {
  type    = number
  default = 20
}

variable "postgres_disk_autoresize_limit" {
  type    = number
  default = 0
}

variable "postgres_backup_window" {
  type    = string
  default = "02:00-03:00"
}

variable "postgres_backup_retention_days" {
  type    = number
  default = 7
}

variable "postgres_maintenance_window" {
  type    = string
  default = "sun:03:00-sun:04:00"
}

variable "postgres_performance_insights" {
  type    = bool
  default = true
}

variable "postgres_deletion_protection" {
  type    = bool
  default = true
}

variable "postgres_apply_immediately" {
  type    = bool
  default = false
}

variable "postgres_parameters" {
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

variable "postgres_read_replica_class" {
  type    = string
  default = ""
}

variable "postgres_kms_key_arn" {
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

variable "redis_engine_version" {
  type    = string
  default = "7.1"
}

variable "redis_node_type" {
  type    = string
  default = "cache.m6g.large"
}

variable "redis_replicas" {
  type    = number
  default = 1
}

variable "redis_multi_az" {
  type    = bool
  default = true
}

variable "redis_tls" {
  type    = bool
  default = true
}

variable "redis_at_rest_kms" {
  type    = bool
  default = true
}

variable "redis_kms_key_arn" {
  type    = string
  default = ""
}

variable "redis_maintenance_window" {
  type    = string
  default = "sun:03:00-sun:04:00"
}

variable "redis_snapshot_window" {
  type    = string
  default = "01:00-02:00"
}

variable "redis_snapshot_retention_days" {
  type    = number
  default = 7
}

variable "redis_parameters" {
  type    = map(string)
  default = {}
}

variable "redis_apply_immediately" {
  type    = bool
  default = false
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

variable "storage_versioning" {
  type    = bool
  default = false
}

variable "storage_force_destroy" {
  type    = bool
  default = false
}

variable "storage_kms_key_arn" {
  type    = string
  default = ""
}

variable "storage_lifecycle_rules" {
  type = list(object({
    id                                 = string
    enabled                            = optional(bool, true)
    prefix                             = optional(string, "")
    expiration_days                    = optional(number)
    noncurrent_version_expiration_days = optional(number)
    abort_incomplete_multipart_days    = optional(number)
    transitions = optional(list(object({
      days          = number
      storage_class = string
    })), [])
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

variable "use_pod_identity" {
  type    = bool
  default = false
}

variable "external_dns_enabled" {
  type    = bool
  default = true
}

variable "lb_controller_enabled" {
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

variable "ingress_external_traffic_policy" {
  type    = string
  default = ""

  validation {
    condition     = contains(["", "Local", "Cluster"], var.ingress_external_traffic_policy)
    error_message = "ingress_external_traffic_policy must be Local or Cluster, or empty for the chart default."
  }
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

variable "ingress_certificate_arn" {
  type    = string
  default = ""
}

variable "ingress_certificate_domains" {
  type    = list(string)
  default = []
}

variable "ingress_allowed_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "ingress_http_listener" {
  type    = bool
  default = false
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

variable "livekit_ami_ssm_parameter" {
  type    = string
  default = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

variable "livekit_instance_type" {
  type    = string
  default = "m6i.xlarge"
}

variable "livekit_egress_instance_type" {
  type    = string
  default = "m6i.xlarge"
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

variable "livekit_certificate_arn" {
  type    = string
  default = ""
}

variable "livekit_create_certificate" {
  type    = bool
  default = true
}
