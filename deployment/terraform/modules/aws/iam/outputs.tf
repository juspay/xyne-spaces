output "role_arns" {
  value = { for key, role in aws_iam_role.this : key => role.arn }
}

output "identities" {
  value = {
    for key, role in aws_iam_role.this : key => {
      annotations = {
        "eks.amazonaws.com/role-arn" = role.arn
      }
      labels = {}
    }
  }
}

output "pod_identity_associations" {
  value = { for key, a in aws_eks_pod_identity_association.this : key => a.association_id }
}

output "lb_controller_role_arn" {
  value = var.lb_controller_enabled ? aws_iam_role.lb_controller[0].arn : ""
}

output "cluster_autoscaler_role_arn" {
  value = var.cluster_autoscaler_enabled ? aws_iam_role.cluster_autoscaler[0].arn : ""
}

output "external_dns_role_arn" {
  value = var.external_dns_enabled ? aws_iam_role.external_dns[0].arn : ""
}
