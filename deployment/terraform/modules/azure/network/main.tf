locals {
  resource_group_name = var.create_resource_group ? azurerm_resource_group.this[0].name : data.azurerm_resource_group.this[0].name
  resource_group_id   = var.create_resource_group ? azurerm_resource_group.this[0].id : data.azurerm_resource_group.this[0].id

  subnets = {
    aks               = { name = "${var.name}-aks", cidr = var.aks_subnet_cidr }
    postgres          = { name = "${var.name}-postgres", cidr = var.postgres_subnet_cidr }
    private_endpoints = { name = "${var.name}-private-endpoints", cidr = var.private_endpoints_subnet_cidr }
    livekit           = { name = "${var.name}-livekit", cidr = var.livekit_subnet_cidr }
    livekit_egress    = { name = "${var.name}-livekit-egress", cidr = var.livekit_egress_subnet_cidr }
    bastion           = { name = "${var.name}-bastion", cidr = var.bastion_subnet_cidr }
    appgw             = { name = "${var.name}-appgw", cidr = var.appgw_subnet_cidr }
  }

  subnet_service_endpoints = {
    aks            = ["Microsoft.Storage"]
    livekit        = ["Microsoft.Storage"]
    livekit_egress = ["Microsoft.Storage"]
    bastion        = ["Microsoft.Storage"]
  }

  nat_subnets = var.nat_gateway_enabled ? ["aks", "livekit_egress", "bastion"] : []

  private_dns_zones = {
    postgres = "privatelink.postgres.database.azure.com"
    redis    = "privatelink.redis.cache.windows.net"
    blob     = "privatelink.blob.core.windows.net"
  }

  nsgs = ["aks", "postgres", "private_endpoints", "livekit", "livekit_egress", "bastion", "appgw"]

  data_clients = [var.aks_subnet_cidr, var.livekit_subnet_cidr, var.livekit_egress_subnet_cidr, var.bastion_subnet_cidr]
}

resource "azurerm_resource_group" "this" {
  count = var.create_resource_group ? 1 : 0

  name     = var.resource_group_name
  location = var.location

  tags = var.tags
}

data "azurerm_resource_group" "this" {
  count = var.create_resource_group ? 0 : 1

  name = var.resource_group_name
}

resource "azurerm_virtual_network" "this" {
  name                = var.name
  location            = var.location
  resource_group_name = local.resource_group_name
  address_space       = [var.vnet_cidr]

  tags = var.tags
}

resource "azurerm_subnet" "this" {
  for_each = local.subnets

  name                 = each.value.name
  resource_group_name  = local.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [each.value.cidr]

  private_endpoint_network_policies = each.key == "private_endpoints" ? "Disabled" : "Enabled"
  service_endpoints                 = lookup(local.subnet_service_endpoints, each.key, null)

  dynamic "delegation" {
    for_each = each.key == "postgres" ? [1] : []
    content {
      name = "postgres-flexible-server"

      service_delegation {
        name    = "Microsoft.DBforPostgreSQL/flexibleServers"
        actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
      }
    }
  }
}

resource "azurerm_subnet" "azure_bastion" {
  count = var.azure_bastion_enabled ? 1 : 0

  name                 = "AzureBastionSubnet"
  resource_group_name  = local.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.azure_bastion_subnet_cidr]
}

resource "azurerm_public_ip_prefix" "nat" {
  count = var.nat_gateway_enabled ? 1 : 0

  name                = "${var.name}-nat"
  location            = var.location
  resource_group_name = local.resource_group_name
  sku                 = "Standard"
  prefix_length       = var.nat_public_ip_prefix_length

  tags = var.tags
}

resource "azurerm_nat_gateway" "this" {
  count = var.nat_gateway_enabled ? 1 : 0

  name                    = "${var.name}-nat"
  location                = var.location
  resource_group_name     = local.resource_group_name
  sku_name                = "Standard"
  idle_timeout_in_minutes = var.nat_idle_timeout_minutes

  tags = var.tags
}

resource "azurerm_nat_gateway_public_ip_prefix_association" "this" {
  count = var.nat_gateway_enabled ? 1 : 0

  nat_gateway_id      = azurerm_nat_gateway.this[0].id
  public_ip_prefix_id = azurerm_public_ip_prefix.nat[0].id
}

resource "azurerm_subnet_nat_gateway_association" "this" {
  for_each = toset(local.nat_subnets)

  subnet_id      = azurerm_subnet.this[each.key].id
  nat_gateway_id = azurerm_nat_gateway.this[0].id

  depends_on = [azurerm_nat_gateway_public_ip_prefix_association.this]
}

resource "azurerm_private_dns_zone" "this" {
  for_each = local.private_dns_zones

  name                = each.value
  resource_group_name = local.resource_group_name

  tags = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  for_each = local.private_dns_zones

  name                  = "${var.name}-${each.key}"
  resource_group_name   = local.resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.this[each.key].name
  virtual_network_id    = azurerm_virtual_network.this.id
  registration_enabled  = false

  tags = var.tags
}

resource "azurerm_network_security_group" "this" {
  for_each = toset(local.nsgs)

  name                = "${var.name}-${replace(each.key, "_", "-")}"
  location            = var.location
  resource_group_name = local.resource_group_name

  tags = var.tags
}

resource "azurerm_subnet_network_security_group_association" "this" {
  for_each = toset(local.nsgs)

  subnet_id                 = azurerm_subnet.this[each.key].id
  network_security_group_id = azurerm_network_security_group.this[each.key].id
}

resource "azurerm_network_security_rule" "aks_inbound" {
  for_each = toset(var.aks_inbound_ports)

  name                        = "allow-internet-${each.key}"
  priority                    = 100 + index(var.aks_inbound_ports, each.key)
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = each.key
  source_address_prefix       = "Internet"
  destination_address_prefix  = var.aks_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["aks"].name
}

resource "azurerm_network_security_rule" "postgres_clients" {
  name                        = "allow-postgres-clients"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "5432"
  source_address_prefixes     = local.data_clients
  destination_address_prefix  = var.postgres_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["postgres"].name
}

resource "azurerm_network_security_rule" "postgres_others" {
  name                        = "deny-postgres-others"
  priority                    = 200
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "5432"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = var.postgres_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["postgres"].name
}

resource "azurerm_network_security_rule" "redis_clients" {
  name                        = "allow-redis-clients"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "6380"
  source_address_prefixes     = local.data_clients
  destination_address_prefix  = var.private_endpoints_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["private_endpoints"].name
}

resource "azurerm_network_security_rule" "redis_others" {
  name                        = "deny-redis-others"
  priority                    = 200
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "6380"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = var.private_endpoints_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["private_endpoints"].name
}

resource "azurerm_network_security_rule" "blob_clients" {
  name                        = "allow-blob-clients"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = var.private_endpoints_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["private_endpoints"].name
}

resource "azurerm_network_security_rule" "livekit_signal" {
  name                        = "allow-signal-from-appgw"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "7880"
  source_address_prefix       = var.appgw_subnet_cidr
  destination_address_prefix  = var.livekit_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["livekit"].name
}

resource "azurerm_network_security_rule" "livekit_turn_tls" {
  name                        = "allow-turn-tls"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "5349"
  source_address_prefix       = "Internet"
  destination_address_prefix  = var.livekit_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["livekit"].name
}

resource "azurerm_network_security_rule" "livekit_rtc_tcp" {
  name                        = "allow-rtc-tcp"
  priority                    = 120
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "7881"
  source_address_prefix       = "Internet"
  destination_address_prefix  = var.livekit_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["livekit"].name
}

resource "azurerm_network_security_rule" "livekit_turn_udp" {
  name                        = "allow-turn-udp"
  priority                    = 130
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Udp"
  source_port_range           = "*"
  destination_port_range      = "3478"
  source_address_prefix       = "Internet"
  destination_address_prefix  = var.livekit_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["livekit"].name
}

resource "azurerm_network_security_rule" "livekit_rtc_udp" {
  name                        = "allow-rtc-udp"
  priority                    = 140
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Udp"
  source_port_range           = "*"
  destination_port_range      = "${var.livekit_port_range_start}-${var.livekit_port_range_end}"
  source_address_prefix       = "Internet"
  destination_address_prefix  = var.livekit_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["livekit"].name
}

resource "azurerm_network_security_rule" "bastion_ssh" {
  name                        = "allow-ssh-from-vnet"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefix       = "VirtualNetwork"
  destination_address_prefix  = var.bastion_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["bastion"].name
}

resource "azurerm_network_security_rule" "bastion_ssh_public" {
  count = length(var.bastion_allowed_ssh_cidrs) > 0 ? 1 : 0

  name                        = "allow-ssh-from-allowlist"
  priority                    = 101
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefixes     = var.bastion_allowed_ssh_cidrs
  destination_address_prefix  = var.bastion_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["bastion"].name
}

resource "azurerm_network_security_rule" "appgw_manager" {
  name                        = "allow-gateway-manager"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "65200-65535"
  source_address_prefix       = "GatewayManager"
  destination_address_prefix  = "*"
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["appgw"].name
}

resource "azurerm_network_security_rule" "appgw_internet" {
  name                        = "allow-internet-web"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_ranges     = ["80", "443"]
  source_address_prefix       = "Internet"
  destination_address_prefix  = var.appgw_subnet_cidr
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["appgw"].name
}

resource "azurerm_network_security_rule" "appgw_lb" {
  name                        = "allow-azure-load-balancer"
  priority                    = 120
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "AzureLoadBalancer"
  destination_address_prefix  = "*"
  resource_group_name         = local.resource_group_name
  network_security_group_name = azurerm_network_security_group.this["appgw"].name
}
