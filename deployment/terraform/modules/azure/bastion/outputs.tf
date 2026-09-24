output "vm_id" {
  value = var.enabled ? azurerm_linux_virtual_machine.this[0].id : ""
}

output "vm_name" {
  value = var.enabled ? azurerm_linux_virtual_machine.this[0].name : ""
}

output "principal_id" {
  value = var.enabled ? azurerm_linux_virtual_machine.this[0].identity[0].principal_id : ""
}

output "private_ip" {
  value = var.enabled ? azurerm_network_interface.this[0].private_ip_address : ""
}

output "public_ip" {
  value = local.public_ip_count > 0 ? azurerm_public_ip.vm[0].ip_address : ""
}

output "azure_bastion_dns_name" {
  value = local.azure_bastion_count > 0 ? azurerm_bastion_host.this[0].dns_name : ""
}
