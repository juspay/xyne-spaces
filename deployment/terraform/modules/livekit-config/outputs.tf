output "server_config" {
  value     = local.server_config
  sensitive = true
}

output "egress_config" {
  value     = local.egress_config
  sensitive = true
}
