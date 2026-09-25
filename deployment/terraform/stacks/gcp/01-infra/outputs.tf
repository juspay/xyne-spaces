output "cluster" {
  value = {
    cloud          = "gcp"
    name           = module.cluster.name
    region         = module.cluster.location
    endpoint       = module.cluster.endpoint
    ca_certificate = module.cluster.ca_certificate
    network_id     = module.network.network_id
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

output "identities" {
  value = merge(module.iam.identities, {
    worker = merge(module.iam.identities.worker, {
      ksa_names = local.worker_ksa_names
    })
    lb_controller = {
      annotations = {}
      labels      = {}
    }
    external_dns = {
      annotations = {}
      labels      = {}
    }
  })
}

output "node_pools" {
  value = module.cluster.node_pools
}

output "ingress" {
  value = {
    domain                  = var.domain
    static_ip               = local.ingress_static_ip
    lb_annotations          = {}
    dns_zone                = var.dns_zone
    mode                    = var.ingress_mode
    service_type            = local.ingress_service_type
    external_traffic_policy = var.ingress_external_traffic_policy
    node_ports              = local.ingress_node_ports
    tls                     = local.ingress_tls
    tls_secret              = var.ingress_tls_secret
    edge = {
      ip       = local.ingress_edge_ip
      hostname = ""
    }
  }
}

output "ingress_addresses" {
  value = {
    gateway = local.ingress_static_ip
    edge    = local.ingress_edge_ip
  }
}

output "livekit" {
  value = module.livekit.livekit
}

output "livekit_lb_ip" {
  value = module.livekit.lb_ip
}

output "livekit_keys" {
  value     = module.livekit.livekit_keys
  sensitive = true
}
