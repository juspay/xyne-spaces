data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  postgres_managed = var.postgres_mode == "managed"
  redis_managed    = var.redis_mode == "managed"
  storage_managed  = var.storage_mode == "managed"

  worker_ksa_names = [for w in var.worker_names : "xyne-worker-${w}"]

  bucket_prefix = var.storage_bucket_prefix != "" ? var.storage_bucket_prefix : "${data.aws_caller_identity.current.account_id}-${var.name}"

  cors_origins = length(var.storage_cors_origins) > 0 ? var.storage_cors_origins : ["https://${var.domain}"]

  node_pools = {
    general = merge(var.node_pools.general, { enabled = true })
    zero    = merge(var.node_pools.zero, { enabled = var.zero_pool_enabled })
    vespa   = merge(var.node_pools.vespa, { enabled = var.vespa_enabled })
    sandbox = merge(var.node_pools.sandbox, { enabled = var.sandbox_enabled })
  }

  lb_annotations = {
    "service.beta.kubernetes.io/aws-load-balancer-type"                              = "external"
    "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type"                   = "ip"
    "service.beta.kubernetes.io/aws-load-balancer-scheme"                            = "internet-facing"
    "service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled" = "true"
  }

  lb_controller_identity = {
    annotations = module.iam.lb_controller_role_arn != "" ? { "eks.amazonaws.com/role-arn" = module.iam.lb_controller_role_arn } : {}
    labels      = {}
  }

  ingress_edge = var.ingress_mode == "cloud-lb"

  ingress_tls = var.ingress_tls != "" ? var.ingress_tls : (local.ingress_edge ? "internal" : "")

  ingress_service_type = var.ingress_mode == "gateway" ? "" : "NodePort"

  ingress_node_ports = var.ingress_mode == "gateway" ? {} : {
    http   = var.ingress_node_ports.http
    https  = var.ingress_node_ports.https
    status = var.ingress_node_ports.status
  }

  ingress_backend_protocol = local.ingress_tls == "none" ? "TCP" : "TLS"

  ingress_edge_node_ports = {
    http   = var.ingress_node_ports.http
    https  = local.ingress_tls == "none" ? var.ingress_node_ports.http : var.ingress_node_ports.https
    status = var.ingress_node_ports.status
  }

  ingress_certificate_domains = length(var.ingress_certificate_domains) > 0 ? var.ingress_certificate_domains : [var.domain, "*.${var.domain}"]

  ingress_lb_annotations = var.ingress_mode == "gateway" ? local.lb_annotations : {}

  external_dns_enabled = var.external_dns_enabled && var.dns_zone != "" && var.ingress_mode == "gateway"

  external_dns_identity = {
    annotations = module.iam.external_dns_role_arn != "" ? { "eks.amazonaws.com/role-arn" = module.iam.external_dns_role_arn } : {}
    labels      = {}
  }
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

resource "terraform_data" "inputs" {
  lifecycle {
    precondition {
      condition     = !local.redis_managed || var.redis_auth != ""
      error_message = "redis_auth is required when redis_mode is managed."
    }
  }
}

module "network" {
  source = "../../../modules/aws/network"

  region               = var.region
  name                 = var.name
  vpc_cidr             = var.vpc_cidr
  az_count             = var.az_count
  availability_zones   = var.availability_zones
  subnet_newbits       = var.subnet_newbits
  private_subnet_cidrs = var.private_subnet_cidrs
  public_subnet_cidrs  = var.public_subnet_cidrs
  single_nat_gateway   = var.single_nat_gateway
  enable_vpc_endpoints = var.enable_vpc_endpoints
  enable_flow_logs     = var.enable_flow_logs

  internet_egress_cidrs = var.internet_egress_cidrs

  tags = var.tags
}

module "bastion" {
  source = "../../../modules/aws/bastion"

  name               = var.name
  enabled            = var.bastion_enabled
  subnet_id          = module.network.public_subnet_ids[0]
  security_group_ids = [module.network.bastion_security_group_id]
  instance_type      = var.bastion_instance_type
  ami_ssm_parameter  = var.bastion_ami_ssm_parameter
  tags               = var.tags
}

module "cluster" {
  source = "../../../modules/aws/cluster"

  region                     = var.region
  name                       = var.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  cluster_security_group_id  = module.network.cluster_security_group_id
  node_security_group_id     = module.network.node_security_group_id
  kubernetes_version         = var.kubernetes_version
  endpoint_private_access    = true
  endpoint_public_access     = !var.enable_private_endpoint
  public_access_cidrs        = var.eks_public_access_cidrs
  services_cidr              = var.services_cidr
  cluster_log_types          = var.cluster_log_types
  cluster_log_retention_days = var.cluster_log_retention_days
  kms_key_arn                = var.cluster_kms_key_arn
  support_type               = var.cluster_support_type
  deployer_principal_arn     = var.deployer_principal_arn
  addon_versions             = var.addon_versions
  sandbox_ami_ssm_parameter  = var.sandbox_ami_ssm_parameter
  node_pools                 = local.node_pools
  tags                       = var.tags
}

module "postgres" {
  count  = local.postgres_managed ? 1 : 0
  source = "../../../modules/aws/postgres"

  name                  = var.name
  subnet_group_name     = module.network.db_subnet_group_name
  security_group_ids    = [module.network.postgres_security_group_id]
  engine_version        = var.postgres_engine_version
  instance_class        = var.postgres_instance_class
  multi_az              = var.postgres_multi_az
  disk_size_gb          = var.postgres_disk_size_gb
  disk_autoresize_limit = var.postgres_disk_autoresize_limit
  backup_window         = var.postgres_backup_window
  backup_retention_days = var.postgres_backup_retention_days
  maintenance_window    = var.postgres_maintenance_window
  performance_insights  = var.postgres_performance_insights
  deletion_protection   = var.postgres_deletion_protection
  apply_immediately     = var.postgres_apply_immediately
  parameters            = var.postgres_parameters
  max_replication_slots = var.postgres_max_replication_slots
  max_wal_senders       = var.postgres_max_wal_senders
  read_replica_enabled  = var.postgres_read_replica
  read_replica_class    = var.postgres_read_replica_class
  kms_key_arn           = var.postgres_kms_key_arn
  databases             = var.postgres_databases
  username              = var.postgres_username
  password              = var.postgres_password
  tags                  = var.tags
}

module "redis" {
  count  = local.redis_managed ? 1 : 0
  source = "../../../modules/aws/redis"

  name                    = var.name
  subnet_group_name       = module.network.elasticache_subnet_group_name
  security_group_ids      = [module.network.redis_security_group_id]
  engine_version          = var.redis_engine_version
  node_type               = var.redis_node_type
  replicas                = var.redis_replicas
  multi_az                = var.redis_multi_az
  auth_token              = var.redis_auth
  tls                     = var.redis_tls
  at_rest_kms             = var.redis_at_rest_kms
  kms_key_arn             = var.redis_kms_key_arn
  maintenance_window      = var.redis_maintenance_window
  snapshot_window         = var.redis_snapshot_window
  snapshot_retention_days = var.redis_snapshot_retention_days
  parameters              = var.redis_parameters
  apply_immediately       = var.redis_apply_immediately
  tags                    = var.tags
}

module "storage" {
  count  = local.storage_managed ? 1 : 0
  source = "../../../modules/aws/storage"

  region          = var.region
  prefix          = local.bucket_prefix
  bucket_names    = var.storage_bucket_names
  versioning      = var.storage_versioning
  force_destroy   = var.storage_force_destroy
  kms_key_arn     = var.storage_kms_key_arn
  lifecycle_rules = var.storage_lifecycle_rules
  cors = {
    origins = local.cors_origins
  }
  tags = var.tags
}

module "iam" {
  source = "../../../modules/aws/iam"

  name                  = var.name
  namespace             = var.namespace
  cluster_name          = module.cluster.name
  oidc_provider_arn     = module.cluster.oidc_provider_arn
  oidc_provider_url     = module.cluster.oidc_provider_url
  worker_names          = var.worker_names
  buckets               = local.storage_managed ? module.storage[0].bucket_names : {}
  use_pod_identity      = var.use_pod_identity
  lb_controller_enabled = var.lb_controller_enabled

  external_dns_enabled         = local.external_dns_enabled
  external_dns_hosted_zone_ids = local.external_dns_enabled ? [var.dns_zone] : []
  partition                    = data.aws_partition.current.partition

  tags = var.tags
}

module "ingress" {
  source = "../../../modules/aws/ingress"

  name                       = var.name
  domain                     = var.domain
  enabled                    = local.ingress_edge
  vpc_id                     = module.network.vpc_id
  vpc_cidr                   = module.network.vpc_cidr
  public_subnet_ids          = module.network.public_subnet_ids
  node_security_group_id     = module.network.node_security_group_id
  node_ports                 = local.ingress_edge_node_ports
  backend_autoscaling_groups = module.cluster.node_autoscaling_groups
  backend_protocol           = local.ingress_backend_protocol
  certificate_arn            = var.ingress_certificate_arn
  certificate_domains        = local.ingress_certificate_domains
  allowed_cidrs              = var.ingress_allowed_cidrs
  http_listener              = var.ingress_http_listener
  dns_zone                   = var.dns_zone
  tags                       = var.tags
}

module "livekit" {
  source = "../../../modules/aws/livekit"

  region                 = var.region
  name                   = var.name
  domain                 = var.domain
  enabled                = var.livekit_enabled
  vpc_id                 = module.network.vpc_id
  public_subnet_ids      = module.network.public_subnet_ids
  private_subnet_ids     = module.network.private_subnet_ids
  security_group_id      = module.network.livekit_security_group_id
  redis                  = module.contract.redis
  redis_auth             = module.contract.redis_auth
  api_key                = var.livekit_api_key
  api_secret             = var.livekit_api_secret
  server_image           = var.livekit_server_image
  egress_image           = var.livekit_egress_image
  ami_ssm_parameter      = var.livekit_ami_ssm_parameter
  instance_type          = var.livekit_instance_type
  egress_instance_type   = var.livekit_egress_instance_type
  disk_size_gb           = var.livekit_disk_size_gb
  min_replicas           = var.livekit_min_replicas
  max_replicas           = var.livekit_max_replicas
  target_cpu_utilization = var.livekit_target_cpu_utilization
  egress_min_replicas    = var.livekit_egress_min_replicas
  egress_max_replicas    = var.livekit_egress_max_replicas
  port_range_start       = var.livekit_port_range_start
  port_range_end         = var.livekit_port_range_end
  turn_cert_secret       = var.livekit_turn_cert_secret
  certificate_arn        = var.livekit_certificate_arn
  create_certificate     = var.livekit_create_certificate
  dns_zone               = var.dns_zone
  tags                   = var.tags
}
