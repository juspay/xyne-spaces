output "id" {
  value = azurerm_kubernetes_cluster.this.id
}

output "name" {
  value = azurerm_kubernetes_cluster.this.name
}

output "location" {
  value = azurerm_kubernetes_cluster.this.location
}

output "version" {
  value = azurerm_kubernetes_cluster.this.kubernetes_version
}

output "endpoint" {
  value = azurerm_kubernetes_cluster.this.kube_config[0].host
}

output "ca_certificate" {
  value = azurerm_kubernetes_cluster.this.kube_config[0].cluster_ca_certificate
}

output "client_certificate" {
  value     = azurerm_kubernetes_cluster.this.kube_config[0].client_certificate
  sensitive = true
}

output "client_key" {
  value     = azurerm_kubernetes_cluster.this.kube_config[0].client_key
  sensitive = true
}

output "oidc_issuer_url" {
  value = azurerm_kubernetes_cluster.this.oidc_issuer_url
}

output "identity_principal_id" {
  value = azurerm_user_assigned_identity.cluster.principal_id
}

output "identity_id" {
  value = azurerm_user_assigned_identity.cluster.id
}

output "kubelet_identity_object_id" {
  value = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}

output "kubelet_identity_client_id" {
  value = azurerm_kubernetes_cluster.this.kubelet_identity[0].client_id
}

output "node_resource_group" {
  value = azurerm_kubernetes_cluster.this.node_resource_group
}

output "node_resource_group_id" {
  value = azurerm_kubernetes_cluster.this.node_resource_group_id
}

output "log_analytics_workspace_id" {
  value = local.log_analytics_workspace_id
}

output "node_pool_names" {
  value = merge({ general = "general" }, { for key, pool in azurerm_kubernetes_cluster_node_pool.this : key => pool.name })
}

output "node_pools" {
  value = {
    for key, pool in local.pools : key => {
      enabled       = pool.enabled
      node_selector = pool.enabled ? { pool = key } : {}
      tolerations = pool.enabled ? [
        for t in concat(pool.taints, pool.spot ? [local.spot_taint] : []) : {
          key                = t.key
          operator           = "Equal"
          value              = t.value
          effect             = t.effect
          toleration_seconds = null
        }
      ] : []
    }
  }
}
