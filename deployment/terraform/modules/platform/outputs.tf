output "namespace" {
  value = kubernetes_namespace_v1.app.metadata[0].name
}

output "argocd_namespace" {
  value = kubernetes_namespace_v1.argocd.metadata[0].name
}

output "root_application" {
  value = "xyne-root"
}

output "secret_names" {
  value = local.secret_names
}

output "root_values" {
  value = local.root_values
}
