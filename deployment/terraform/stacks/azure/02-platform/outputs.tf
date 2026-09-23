output "namespace" {
  value = module.platform.namespace
}

output "argocd_namespace" {
  value = module.platform.argocd_namespace
}

output "root_application" {
  value = module.platform.root_application
}

output "secret_names" {
  value = module.platform.secret_names
}

output "root_values" {
  value = module.platform.root_values
}
