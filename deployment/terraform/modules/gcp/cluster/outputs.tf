output "name" {
  value = google_container_cluster.this.name
}

output "location" {
  value = google_container_cluster.this.location
}

output "endpoint" {
  value = google_container_cluster.this.endpoint
}

output "ca_certificate" {
  value = google_container_cluster.this.master_auth[0].cluster_ca_certificate
}

output "workload_pool" {
  value = google_container_cluster.this.workload_identity_config[0].workload_pool
}

output "node_service_accounts" {
  value = { for key, sa in google_service_account.nodes : key => sa.email }
}

output "node_instance_groups" {
  value = { for key, pool in google_container_node_pool.this : key => pool.managed_instance_group_urls }
}

output "node_pools" {
  value = {
    for key, pool in local.pools : key => {
      enabled       = pool.enabled
      node_selector = pool.enabled ? { pool = key } : {}
      tolerations = pool.enabled ? [
        for t in pool.taints : {
          key                = t.key
          operator           = "Equal"
          value              = t.value
          effect             = local.effect_names[t.effect]
          toleration_seconds = null
        }
      ] : []
    }
  }
}
