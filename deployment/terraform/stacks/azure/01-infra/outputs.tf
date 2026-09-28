output "cluster" {
  value = {
    cloud          = "azure"
    name           = module.cluster.name
    region         = module.cluster.location
    endpoint       = module.cluster.endpoint
    ca_certificate = module.cluster.ca_certificate
    network_id     = module.network.vnet_id
  }
}

output "cluster_auth" {
  value = {
    client_certificate = module.cluster.client_certificate
    client_key         = module.cluster.client_key
  }
  sensitive = true
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
    lb_annotations          = local.lb_annotations
    dns_zone                = var.dns_zone
    mode                    = var.ingress_mode
    service_type            = local.ingress_service_type
    external_traffic_policy = var.ingress_external_traffic_policy
    node_ports              = local.ingress_node_ports
    tls                     = local.ingress_tls
    tls_secret              = var.ingress_tls_secret
    edge = {
      ip       = local.ingress_edge_ip
      hostname = local.ingress_edge_hostname
    }
  }
}

output "ingress_addresses" {
  value = {
    gateway = local.ingress_public_ip_enabled ? azurerm_public_ip.ingress[0].ip_address : ""
    edge    = module.ingress.ip
  }
}

output "livekit" {
  value = module.livekit.livekit
}

output "livekit_keys" {
  value     = module.livekit.livekit_keys
  sensitive = true
}

output "resource_group_name" {
  value = module.network.resource_group_name
}

output "node_resource_group" {
  value = module.cluster.node_resource_group
}

output "bastion" {
  value = {
    vm_name                = module.bastion.vm_name
    private_ip             = module.bastion.private_ip
    public_ip              = module.bastion.public_ip
    azure_bastion_dns_name = module.bastion.azure_bastion_dns_name
  }
}

output "livekit_ips" {
  value = {
    signal = module.livekit.signal_ip
    turn   = module.livekit.turn_ip
  }
}

output "livekit_key_vault" {
  value = {
    id   = module.livekit.key_vault_id
    name = module.livekit.key_vault_name
  }
}

output "nat_public_ip_prefix" {
  value = module.network.nat_public_ip_prefix
}
