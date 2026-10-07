output "ip" {
  value = var.enabled ? azurerm_public_ip.this[0].ip_address : ""
}

output "fqdn" {
  value = var.enabled && var.domain_name_label != "" ? azurerm_public_ip.this[0].fqdn : ""
}

output "id" {
  value = var.enabled ? azurerm_application_gateway.this[0].id : ""
}

output "public_ip_id" {
  value = var.enabled ? azurerm_public_ip.this[0].id : ""
}
