variable "name" {
  type        = string
  description = "Environment name, used as the default bucket prefix."
}

variable "namespace" {
  type    = string
  default = "xyne"
}

variable "domain" {
  type = string
}

# ---------------------------------------------------------------------------
# Cluster
#
# Nothing here creates a cluster. Point this at one that already exists.
# modules/platform only reads cloud, name, region and network_id; endpoint and
# ca_certificate stay empty because 02-platform drives its providers from a
# kubeconfig instead.
# ---------------------------------------------------------------------------

variable "cluster_name" {
  type = string
}

variable "cluster_region" {
  type    = string
  default = "onprem"
}

# ---------------------------------------------------------------------------
# Storage (Ceph RGW)
# ---------------------------------------------------------------------------

variable "storage_endpoint" {
  type        = string
  description = "RGW S3 endpoint including scheme and port."
}

variable "storage_region" {
  type    = string
  default = "default"
}

variable "storage_credentials" {
  type = object({
    access_key_id     = string
    secret_access_key = string
  })
  sensitive   = true
  description = "Keystone EC2 credential. Create with: openstack ec2 credentials create"
}

variable "ca_bundle" {
  type        = string
  default     = ""
  description = "Path to the PEM that signed the RGW certificate. Empty uses the system trust store."
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

variable "storage_encryption" {
  type        = bool
  default     = false
  description = "Only enable once SSE-S3 is configured on the RGW cluster."
}

variable "storage_force_destroy" {
  type    = bool
  default = false
}

variable "storage_cors_origins" {
  type    = list(string)
  default = []
}

# Zero replicates its SQLite file to object storage with Litestream, and the
# view-syncers (xyne-zero, wave 2) restore their snapshot from it. Without this
# they loop on "Unable to reserve snapshot" forever. Kept in its own bucket to
# match the cloud stacks.
variable "zero_backup_enabled" {
  type    = bool
  default = true
}

variable "zero_backup_bucket_name" {
  type    = string
  default = ""
}

# ---------------------------------------------------------------------------
# Postgres
#
# Managed mode: the server exists already and this stack does not create it.
# The role must hold REPLICATION and CREATEDB before 02-platform runs, because
# the db-init Job creates four databases and Zero needs logical replication.
# ---------------------------------------------------------------------------

variable "postgres_host" {
  type = string
}

variable "postgres_ro_host" {
  type    = string
  default = ""
}

variable "postgres_direct_host" {
  type        = string
  default     = ""
  description = "Non-pooled host. Zero's logical replication must bypass any pooler. Defaults to postgres_host."
}

variable "postgres_port" {
  type    = number
  default = 5432
}

variable "postgres_username" {
  type    = string
  default = "xyne"
}

variable "postgres_sslmode" {
  type    = string
  default = "require"
}

variable "postgres_password" {
  type      = string
  sensitive = true
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

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

variable "redis_host" {
  type = string
}

variable "redis_port" {
  type    = number
  default = 6379
}

variable "redis_tls" {
  type    = bool
  default = false
}

variable "redis_auth" {
  type      = string
  sensitive = true
}

# ---------------------------------------------------------------------------
# Ingress
# ---------------------------------------------------------------------------

variable "ingress_mode" {
  type        = string
  default     = "external"
  description = "external keeps the gateway on NodePort so no cloud load balancer is needed."

  validation {
    condition     = contains(["gateway", "cloud-lb", "external"], var.ingress_mode)
    error_message = "ingress_mode must be gateway, cloud-lb or external."
  }
}

variable "ingress_service_type" {
  type    = string
  default = ""
}

variable "ingress_external_traffic_policy" {
  type    = string
  default = ""
}

variable "ingress_node_ports" {
  type    = map(number)
  default = {}
}

variable "ingress_static_ip" {
  type    = string
  default = ""
}

variable "ingress_lb_annotations" {
  type    = map(string)
  default = {}
}

variable "ingress_tls" {
  type        = string
  default     = "internal"
  description = "acme needs public reachability for http01. Use internal or existing on a private cluster."

  validation {
    condition     = contains(["acme", "internal", "existing", "none"], var.ingress_tls)
    error_message = "ingress_tls must be acme, internal, existing or none."
  }
}

variable "ingress_tls_secret" {
  type    = string
  default = "xyne-gateway-tls"
}

variable "dns_zone" {
  type    = string
  default = ""
}

# ---------------------------------------------------------------------------
# Node pools
#
# Empty selectors mean "schedule anywhere". On-prem has no pool taints unless
# an operator adds them.
# ---------------------------------------------------------------------------

variable "node_pools" {
  type = map(object({
    enabled       = optional(bool, false)
    node_selector = optional(map(string), {})
    tolerations = optional(list(object({
      key                = optional(string)
      operator           = optional(string)
      value              = optional(string)
      effect             = optional(string)
      toleration_seconds = optional(number)
    })), [])
  }))
  default = {}
}

variable "worker_names" {
  type    = list(string)
  default = []
}

# ---------------------------------------------------------------------------
# LiveKit
#
# The cloud stacks run LiveKit on VMs because WebRTC media wants a public IP per
# server and a 50000-60000 UDP range. On-prem it runs as ordinary pods behind
# STUNner, which terminates TURN on a single UDP port, so nothing here creates
# infrastructure — these values only describe where the app should find it.
#
# Signalling rides the existing Istio gateway on livekit.<domain>, which the
# wildcard already in the Gateway and certificate covers. Media does not: it goes
# to STUNner's own address.
# ---------------------------------------------------------------------------

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
