output "cluster" {
  value = {
    cloud = "onprem"
    name  = var.cluster_name
    # modules/platform never reads endpoint or ca_certificate; 02-platform builds
    # its kubernetes and helm providers from a kubeconfig instead.
    region         = var.cluster_region
    endpoint       = ""
    ca_certificate = ""
    network_id     = ""
  }
}

output "postgres" {
  value = module.contract.postgres
}

output "postgres_password" {
  value     = var.postgres_password
  sensitive = true
}

output "redis" {
  value = module.contract.redis
}

output "redis_auth" {
  value     = module.contract.redis_auth
  sensitive = true
}

output "storage" {
  value = module.contract.storage
}

output "storage_credentials" {
  value     = module.contract.storage_credentials
  sensitive = true
}

output "bucket_names" {
  value = module.storage.bucket_names
}

output "identities" {
  value = local.identities
}

output "node_pools" {
  value = local.node_pools
}

output "ingress" {
  value = {
    domain                  = var.domain
    static_ip               = var.ingress_static_ip
    lb_annotations          = var.ingress_lb_annotations
    dns_zone                = var.dns_zone
    mode                    = var.ingress_mode
    service_type            = var.ingress_service_type
    external_traffic_policy = var.ingress_external_traffic_policy
    node_ports              = var.ingress_node_ports
    tls                     = var.ingress_tls
    tls_secret              = var.ingress_tls_secret
    edge = {
      ip       = ""
      hostname = ""
    }
  }
}

# Mirrors the shape the cloud livekit modules produce, but describes an in-cluster
# deployment rather than creating one. turn_host stays empty because STUNner is
# the TURN server and LiveKit advertises it through rtc.turn_servers instead.
output "livekit" {
  value = {
    enabled   = var.livekit_enabled
    url       = var.livekit_enabled ? "wss://livekit.${var.domain}" : ""
    http_url  = var.livekit_enabled ? "https://livekit.${var.domain}" : ""
    turn_host = ""
    group     = ""
  }
}

output "livekit_keys" {
  value = {
    api_key    = var.livekit_api_key
    api_secret = var.livekit_api_secret
  }
  sensitive = true
}

output "zero_backup_url" {
  value = var.zero_backup_enabled ? "s3://${module.zero_backup[0].bucket_names.zero}/replica" : ""
}
