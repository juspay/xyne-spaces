output "resource_group_name" {
  value = local.resource_group_name
}

output "resource_group_id" {
  value = local.resource_group_id
}

output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

output "vnet_name" {
  value = azurerm_virtual_network.this.name
}

output "vnet_cidr" {
  value = var.vnet_cidr
}

output "subnet_ids" {
  value = { for key, subnet in azurerm_subnet.this : key => subnet.id }
}

output "subnet_cidrs" {
  value = { for key, subnet in local.subnets : key => subnet.cidr }
}

output "azure_bastion_subnet_id" {
  value = var.azure_bastion_enabled ? azurerm_subnet.azure_bastion[0].id : ""
}

output "nat_gateway_id" {
  value = var.nat_gateway_enabled ? azurerm_nat_gateway.this[0].id : ""
}

output "nat_public_ip_prefix" {
  value = var.nat_gateway_enabled ? azurerm_public_ip_prefix.nat[0].ip_prefix : ""
}

output "private_dns_zone_ids" {
  value = { for key, zone in azurerm_private_dns_zone.this : key => zone.id }
}

output "private_dns_zone_names" {
  value = { for key, zone in azurerm_private_dns_zone.this : key => zone.name }
}

output "network_security_group_ids" {
  value = { for key, nsg in azurerm_network_security_group.this : key => nsg.id }
}
