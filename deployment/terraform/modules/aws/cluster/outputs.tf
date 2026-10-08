output "name" {
  value = aws_eks_cluster.this.name
}

output "arn" {
  value = aws_eks_cluster.this.arn
}

output "region" {
  value = var.region
}

output "version" {
  value = aws_eks_cluster.this.version
}

output "endpoint" {
  value = aws_eks_cluster.this.endpoint
}

output "ca_certificate" {
  value = aws_eks_cluster.this.certificate_authority[0].data
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.this.arn
}

output "oidc_provider_url" {
  value = local.oidc_host
}

output "cluster_security_group_id" {
  value = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}

output "node_role_arn" {
  value = aws_iam_role.nodes.arn
}

output "ebs_csi_role_arn" {
  value = aws_iam_role.ebs_csi.arn
}

output "node_group_names" {
  value = { for key, group in aws_eks_node_group.this : key => group.node_group_name }
}

output "node_autoscaling_groups" {
  value = { for key, group in aws_eks_node_group.this : key => group.resources[0].autoscaling_groups[0].name }
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
