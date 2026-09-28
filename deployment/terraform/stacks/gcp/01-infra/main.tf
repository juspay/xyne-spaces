locals {
  services = var.enable_apis ? [
    "compute.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "dns.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ] : []

  postgres_managed = var.postgres_mode == "managed"
  redis_managed    = var.redis_mode == "managed"
  storage_managed  = var.storage_mode == "managed"

  worker_ksa_names = [for w in var.worker_names : "xyne-worker-${w}"]

  bucket_prefix = var.storage_bucket_prefix != "" ? var.storage_bucket_prefix : "${var.project}-${var.name}"

  cors_origins = length(var.storage_cors_origins) > 0 ? var.storage_cors_origins : ["https://${var.domain}"]

  node_pools = {
    general = merge(var.node_pools.general, { enabled = true })
    zero    = merge(var.node_pools.zero, { enabled = var.zero_pool_enabled })
    vespa   = merge(var.node_pools.vespa, { enabled = var.vespa_enabled })
    sandbox = merge(var.node_pools.sandbox, { enabled = var.sandbox_enabled })
  }

  ingress_gateway  = var.ingress_mode == "gateway"
  ingress_cloud_lb = var.ingress_mode == "cloud-lb"

  ingress_regional_ip = local.ingress_gateway && var.ingress_static_ip

  ingress_static_ip = local.ingress_regional_ip ? google_compute_address.ingress[0].address : ""

  ingress_edge_ip = local.ingress_cloud_lb ? module.ingress.ip : ""

  ingress_service_type = local.ingress_gateway ? "" : "NodePort"

  ingress_tls = var.ingress_tls != "" ? var.ingress_tls : (local.ingress_cloud_lb ? "internal" : "")

  ingress_backend_protocol = local.ingress_tls == "none" ? "HTTP" : "HTTPS"

  ingress_all_node_ports = {
    http   = var.ingress_node_ports.http
    https  = var.ingress_node_ports.https
    status = var.ingress_node_ports.status
  }

  ingress_node_ports = { for key, port in local.ingress_all_node_ports : key => port if !local.ingress_gateway }

  ingress_certificate_domains = length(var.ingress_certificate_domains) > 0 ? var.ingress_certificate_domains : [var.domain]

  ingress_dns_target = local.ingress_gateway ? local.ingress_static_ip : local.ingress_edge_ip

  ingress_dns_records = local.dns_enabled && (local.ingress_gateway ? var.ingress_static_ip : local.ingress_cloud_lb)

  dns_enabled = var.dns_zone != ""
}

module "contract" {
  source = "../../../modules/contract"

  postgres_mode         = var.postgres_mode
  redis_mode            = var.redis_mode
  storage_mode          = var.storage_mode
  namespace             = var.namespace
  region                = var.region
  name                  = var.name
  postgres_username     = var.postgres_username
  postgres_databases    = var.postgres_databases
  external_postgres     = var.external_postgres
  external_redis        = var.external_redis
  external_storage      = var.external_storage
  storage_bucket_prefix = local.bucket_prefix
  storage_bucket_names  = var.storage_bucket_names
  redis_auth            = var.redis_auth
  storage_credentials   = var.storage_credentials
  livekit_enabled       = var.livekit_enabled

  managed_postgres            = one(module.postgres[*].postgres)
  managed_redis               = one(module.redis[*].redis)
  managed_redis_auth          = one(module.redis[*].redis_auth)
  managed_storage             = one(module.storage[*].storage)
  managed_storage_credentials = one(module.storage[*].storage_credentials)
}

resource "google_project_service" "this" {
  for_each = toset(local.services)

  project            = var.project
  service            = each.key
  disable_on_destroy = false
}

module "network" {
  source = "../../../modules/gcp/network"

  project              = var.project
  region               = var.region
  name                 = var.name
  subnet_cidr          = var.subnet_cidr
  pods_cidr            = var.pods_cidr
  services_cidr        = var.services_cidr
  private_service_cidr = var.private_service_cidr
  enable_iap_ssh       = var.enable_iap_ssh
  enable_flow_logs     = var.enable_flow_logs

  depends_on = [google_project_service.this]
}

module "bastion" {
  source = "../../../modules/gcp/bastion"

  project           = var.project
  region            = var.region
  zone              = var.bastion_zone
  name              = var.name
  enabled           = var.bastion_enabled
  machine_type      = var.bastion_machine_type
  network_self_link = module.network.network_self_link
  subnet_self_link  = module.network.subnet_self_link
  cluster_name      = module.cluster.name
  labels            = var.labels

  depends_on = [google_project_service.this]
}

module "cluster" {
  source = "../../../modules/gcp/cluster"

  project                    = var.project
  region                     = var.region
  name                       = var.name
  network                    = module.network.network_self_link
  subnetwork                 = module.network.subnet_self_link
  pods_range_name            = module.network.pods_range_name
  services_range_name        = module.network.services_range_name
  node_locations             = var.node_locations
  release_channel            = var.release_channel
  kubernetes_version         = var.kubernetes_version
  master_ipv4_cidr_block     = var.master_ipv4_cidr_block
  master_authorized_networks = var.master_authorized_networks
  enable_private_endpoint    = var.enable_private_endpoint
  logging_enabled            = var.cluster_logging
  monitoring_enabled         = var.cluster_monitoring
  maintenance_window         = var.maintenance_window
  deletion_protection        = var.cluster_deletion_protection
  labels                     = var.labels
  node_pools                 = local.node_pools

  depends_on = [google_project_service.this]
}

module "postgres" {
  count  = local.postgres_managed ? 1 : 0
  source = "../../../modules/gcp/postgres"

  project                        = var.project
  region                         = var.region
  name                           = var.name
  network                        = module.network.network_id
  tier                           = var.postgres_tier
  availability_type              = var.postgres_availability_type
  disk_size_gb                   = var.postgres_disk_size_gb
  disk_autoresize_limit          = var.postgres_disk_autoresize_limit
  backup_start_time              = var.postgres_backup_start_time
  backup_retention_count         = var.postgres_backup_retention_count
  transaction_log_retention_days = var.postgres_transaction_log_retention_days
  maintenance_window             = var.postgres_maintenance_window
  deletion_protection            = var.postgres_deletion_protection
  require_ssl                    = var.postgres_require_ssl
  database_flags                 = var.postgres_flags
  max_replication_slots          = var.postgres_max_replication_slots
  max_wal_senders                = var.postgres_max_wal_senders
  read_replica_enabled           = var.postgres_read_replica
  read_replica_tier              = var.postgres_read_replica_tier
  databases                      = var.postgres_databases
  username                       = var.postgres_username
  password                       = var.postgres_password
  labels                         = var.labels

  depends_on = [module.network]
}

module "redis" {
  count  = local.redis_managed ? 1 : 0
  source = "../../../modules/gcp/redis"

  project                    = var.project
  region                     = var.region
  name                       = var.name
  network                    = module.network.network_id
  private_service_range_name = module.network.private_service_range_name
  tier                       = var.redis_tier
  memory_size_gb             = var.redis_memory_size_gb
  redis_version              = var.redis_version
  tls                        = var.redis_tls
  maintenance_window         = var.redis_maintenance_window
  redis_configs              = var.redis_configs
  labels                     = var.labels

  depends_on = [module.network]
}

module "storage" {
  count  = local.storage_managed ? 1 : 0
  source = "../../../modules/gcp/storage"

  project         = var.project
  location        = var.region
  prefix          = local.bucket_prefix
  bucket_names    = var.storage_bucket_names
  storage_class   = var.storage_class
  versioning      = var.storage_versioning
  force_destroy   = var.storage_force_destroy
  lifecycle_rules = var.storage_lifecycle_rules
  cors = {
    origins = local.cors_origins
  }
  labels = var.labels

  depends_on = [google_project_service.this]
}

module "iam" {
  source = "../../../modules/gcp/iam"

  project      = var.project
  name         = var.name
  namespace    = var.namespace
  worker_names = var.worker_names
  buckets      = local.storage_managed ? module.storage[0].bucket_names : {}

  depends_on = [google_project_service.this]
}

module "livekit" {
  source = "../../../modules/gcp/livekit"

  project                = var.project
  region                 = var.region
  name                   = var.name
  domain                 = var.domain
  enabled                = var.livekit_enabled
  network                = module.network.network_self_link
  subnetwork             = module.network.subnet_self_link
  redis                  = module.contract.redis
  redis_auth             = module.contract.redis_auth
  api_key                = var.livekit_api_key
  api_secret             = var.livekit_api_secret
  server_image           = var.livekit_server_image
  egress_image           = var.livekit_egress_image
  vm_image               = var.livekit_vm_image
  machine_type           = var.livekit_machine_type
  egress_machine_type    = var.livekit_egress_machine_type
  disk_size_gb           = var.livekit_disk_size_gb
  min_replicas           = var.livekit_min_replicas
  max_replicas           = var.livekit_max_replicas
  target_cpu_utilization = var.livekit_target_cpu_utilization
  egress_min_replicas    = var.livekit_egress_min_replicas
  egress_max_replicas    = var.livekit_egress_max_replicas
  port_range_start       = var.livekit_port_range_start
  port_range_end         = var.livekit_port_range_end
  turn_cert_secret       = var.livekit_turn_cert_secret
  dns_zone               = var.dns_zone
  labels                 = var.labels

  depends_on = [google_project_service.this]
}

resource "google_compute_address" "ingress" {
  count = local.ingress_regional_ip ? 1 : 0

  name         = "${var.name}-ingress"
  project      = var.project
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"

  depends_on = [google_project_service.this]
}

module "ingress" {
  source = "../../../modules/gcp/ingress"

  project                 = var.project
  name                    = var.name
  enabled                 = local.ingress_cloud_lb
  network                 = module.network.network_self_link
  target_tags             = ["${var.name}-node"]
  backend_instance_groups = flatten(values(module.cluster.node_instance_groups))
  node_ports              = local.ingress_all_node_ports
  backend_protocol        = local.ingress_backend_protocol
  certificate_ids         = var.ingress_certificate_ids
  certificate_pem         = var.ingress_certificate_pem
  private_key_pem         = var.ingress_private_key_pem
  certificate_domains     = local.ingress_certificate_domains
  http_redirect           = var.ingress_http_redirect

  depends_on = [google_project_service.this]
}

data "google_dns_managed_zone" "this" {
  count = local.dns_enabled ? 1 : 0

  project = var.project
  name    = var.dns_zone

  depends_on = [google_project_service.this]
}

resource "google_dns_record_set" "apex" {
  count = local.ingress_dns_records ? 1 : 0

  project      = var.project
  managed_zone = data.google_dns_managed_zone.this[0].name
  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [local.ingress_dns_target]
}

resource "google_dns_record_set" "wildcard" {
  count = local.ingress_dns_records ? 1 : 0

  project      = var.project
  managed_zone = data.google_dns_managed_zone.this[0].name
  name         = "*.${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [local.ingress_dns_target]
}
