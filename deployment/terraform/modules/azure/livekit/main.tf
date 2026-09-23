locals {
  count = var.enabled ? 1 : 0

  scheme    = var.https_enabled ? "wss" : "ws"
  url       = var.enabled ? "${local.scheme}://livekit.${var.domain}" : ""
  http_url  = var.enabled ? "${var.https_enabled ? "https" : "http"}://livekit.${var.domain}" : ""
  turn_host = var.enabled ? "turn.${var.domain}" : ""
  turn_tls  = var.turn_cert_secret != ""

  turn_count  = var.enabled && local.turn_tls ? 1 : 0
  https_count = var.enabled && var.https_enabled ? 1 : 0
  dns_count   = var.enabled && var.dns_zone != "" ? 1 : 0

  create_key_vault = var.enabled && var.key_vault_id == ""
  key_vault_count  = local.create_key_vault ? 1 : 0
  key_vault_name   = var.key_vault_id != "" ? basename(var.key_vault_id) : (var.key_vault_name != "" ? var.key_vault_name : "${var.name}-livekit-kv")
  key_vault_id     = var.key_vault_id != "" ? var.key_vault_id : (local.create_key_vault ? azurerm_key_vault.this[0].id : "")

  certificate_key_vault_id = var.certificate_key_vault_id != "" ? var.certificate_key_vault_id : local.key_vault_id

  dns_zone_resource_group = var.dns_zone_resource_group != "" ? var.dns_zone_resource_group : var.resource_group_name
  domain_prefix           = trimsuffix(trimsuffix(var.domain, var.dns_zone), ".")
  signal_record_name      = local.domain_prefix == "" ? "livekit" : "livekit.${local.domain_prefix}"
  turn_record_name        = local.domain_prefix == "" ? "turn" : "turn.${local.domain_prefix}"

  roles = {
    server = {
      config_secret  = "${var.name}-livekit-server-config"
      image          = var.server_image
      docker_flags   = "-v /etc/livekit:/etc/livekit:ro"
      container_args = "--config /etc/livekit/config.yaml"
      turn_cert      = var.turn_cert_secret
      vm_size        = var.vm_size
      subnet_id      = var.subnet_id
      public_ip      = true
      min_replicas   = var.min_replicas
      max_replicas   = var.max_replicas
    }
    egress = {
      config_secret  = "${var.name}-livekit-egress-config"
      image          = var.egress_image
      docker_flags   = "--cap-add SYS_ADMIN -e EGRESS_CONFIG_FILE=/etc/livekit/config.yaml -v /etc/livekit:/etc/livekit:ro"
      container_args = ""
      turn_cert      = ""
      vm_size        = var.egress_vm_size
      subnet_id      = var.egress_subnet_id
      public_ip      = var.egress_public_ip
      min_replicas   = var.egress_min_replicas
      max_replicas   = var.egress_max_replicas
    }
  }

  enabled_roles = { for role, spec in local.roles : role => spec if var.enabled }

  configs = {
    server = module.config.server_config
    egress = module.config.egress_config
  }

  cloud_init = {
    for role, spec in local.enabled_roles : role => templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
      client_id        = azurerm_user_assigned_identity.instances[0].client_id
      vault_name       = local.key_vault_name
      role             = role
      config_secret    = spec.config_secret
      turn_cert_secret = spec.turn_cert
      image            = spec.image
      docker_flags     = spec.docker_flags
      container_args   = spec.container_args
    })
  }

  appgw_backend_pool_id = var.enabled ? "${azurerm_application_gateway.signal[0].id}/backendAddressPools/servers" : ""
}

module "config" {
  source = "../../livekit-config"

  api_key          = var.api_key
  api_secret       = var.api_secret
  domain           = var.domain
  ws_url           = local.url
  redis            = var.redis
  redis_auth       = var.redis_auth
  port_range_start = var.port_range_start
  port_range_end   = var.port_range_end
  turn = {
    tls = local.turn_tls
  }
}

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "this" {
  count = local.key_vault_count

  name                          = local.key_vault_name
  location                      = var.location
  resource_group_name           = var.resource_group_name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  rbac_authorization_enabled    = true
  soft_delete_retention_days    = 7
  purge_protection_enabled      = var.key_vault_purge_protection
  public_network_access_enabled = true

  tags = var.tags

  lifecycle {
    precondition {
      condition     = can(regex("^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$", local.key_vault_name))
      error_message = "livekit_key_vault_name must be 3 to 24 letters, digits and dashes, starting with a letter and globally unique."
    }
  }
}

resource "azurerm_role_assignment" "deployer_secrets" {
  count = local.key_vault_count

  scope                = azurerm_key_vault.this[0].id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_secret" "config" {
  for_each = local.enabled_roles

  name         = each.value.config_secret
  key_vault_id = local.key_vault_id
  value        = local.configs[each.key]
  content_type = "application/yaml"

  tags = merge(var.tags, { role = "livekit-${each.key}" })

  depends_on = [azurerm_role_assignment.deployer_secrets]
}

resource "azurerm_user_assigned_identity" "instances" {
  count = local.count

  name                = "${var.name}-livekit-instances"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = var.tags
}

resource "azurerm_role_assignment" "instances_secrets" {
  count = local.count

  scope                            = local.key_vault_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.instances[0].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_user_assigned_identity" "appgw" {
  count = local.https_count

  name                = "${var.name}-livekit-appgw"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = var.tags
}

resource "azurerm_role_assignment" "appgw_secrets" {
  count = local.https_count

  scope                            = local.certificate_key_vault_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.appgw[0].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_public_ip" "signal" {
  count = local.count

  name                = "${var.name}-livekit-signal"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = length(var.zones) > 0 ? var.zones : null

  tags = var.tags
}

resource "azurerm_application_gateway" "signal" {
  count = local.count

  name                = "${var.name}-livekit-signal"
  location            = var.location
  resource_group_name = var.resource_group_name
  zones               = length(var.zones) > 0 ? var.zones : null
  http2_enabled       = true

  sku {
    name = "Standard_v2"
    tier = "Standard_v2"
  }

  autoscale_configuration {
    min_capacity = var.appgw_min_capacity
    max_capacity = var.appgw_max_capacity
  }

  dynamic "identity" {
    for_each = var.https_enabled ? [1] : []
    content {
      type         = "UserAssigned"
      identity_ids = [azurerm_user_assigned_identity.appgw[0].id]
    }
  }

  gateway_ip_configuration {
    name      = "gateway"
    subnet_id = var.appgw_subnet_id
  }

  frontend_ip_configuration {
    name                 = "public"
    public_ip_address_id = azurerm_public_ip.signal[0].id
  }

  frontend_port {
    name = "http"
    port = 80
  }

  dynamic "frontend_port" {
    for_each = var.https_enabled ? [1] : []
    content {
      name = "https"
      port = 443
    }
  }

  backend_address_pool {
    name = "servers"
  }

  probe {
    name                = "signal"
    protocol            = "Http"
    host                = "127.0.0.1"
    path                = "/"
    port                = 7880
    interval            = 10
    timeout             = 5
    unhealthy_threshold = 3

    match {
      status_code = ["200-399"]
    }
  }

  backend_http_settings {
    name                  = "signal"
    port                  = 7880
    protocol              = "Http"
    cookie_based_affinity = "Disabled"
    request_timeout       = 3600
    probe_name            = "signal"
  }

  dynamic "ssl_certificate" {
    for_each = var.https_enabled ? [1] : []
    content {
      name                = "signal"
      key_vault_secret_id = var.certificate_secret_id
    }
  }

  dynamic "ssl_policy" {
    for_each = var.https_enabled ? [1] : []
    content {
      policy_type = "Predefined"
      policy_name = "AppGwSslPolicy20220101"
    }
  }

  dynamic "http_listener" {
    for_each = var.https_enabled ? [1] : []
    content {
      name                           = "https"
      frontend_ip_configuration_name = "public"
      frontend_port_name             = "https"
      protocol                       = "Https"
      ssl_certificate_name           = "signal"
    }
  }

  http_listener {
    name                           = "http"
    frontend_ip_configuration_name = "public"
    frontend_port_name             = "http"
    protocol                       = "Http"
  }

  dynamic "redirect_configuration" {
    for_each = var.https_enabled ? [1] : []
    content {
      name                 = "http-to-https"
      redirect_type        = "Permanent"
      target_listener_name = "https"
      include_path         = true
      include_query_string = true
    }
  }

  dynamic "request_routing_rule" {
    for_each = var.https_enabled ? [1] : []
    content {
      name                       = "https"
      rule_type                  = "Basic"
      priority                   = 10
      http_listener_name         = "https"
      backend_address_pool_name  = "servers"
      backend_http_settings_name = "signal"
    }
  }

  request_routing_rule {
    name                        = "http"
    rule_type                   = "Basic"
    priority                    = 20
    http_listener_name          = "http"
    redirect_configuration_name = var.https_enabled ? "http-to-https" : null
    backend_address_pool_name   = var.https_enabled ? null : "servers"
    backend_http_settings_name  = var.https_enabled ? null : "signal"
  }

  tags = var.tags

  depends_on = [azurerm_role_assignment.appgw_secrets]
}

resource "azurerm_public_ip" "turn" {
  count = local.turn_count

  name                = "${var.name}-livekit-turn"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = length(var.zones) > 0 ? var.zones : null

  tags = var.tags
}

resource "azurerm_lb" "turn" {
  count = local.turn_count

  name                = "${var.name}-livekit-turn"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  frontend_ip_configuration {
    name                 = "public"
    public_ip_address_id = azurerm_public_ip.turn[0].id
  }

  tags = var.tags
}

resource "azurerm_lb_backend_address_pool" "turn" {
  count = local.turn_count

  name            = "servers"
  loadbalancer_id = azurerm_lb.turn[0].id
}

resource "azurerm_lb_probe" "turn" {
  count = local.turn_count

  name                = "signal"
  loadbalancer_id     = azurerm_lb.turn[0].id
  protocol            = "Http"
  port                = 7880
  request_path        = "/"
  interval_in_seconds = 10
  number_of_probes    = 3
}

resource "azurerm_lb_rule" "turn" {
  count = local.turn_count

  name                           = "turn-tls"
  loadbalancer_id                = azurerm_lb.turn[0].id
  protocol                       = "Tcp"
  frontend_port                  = 5349
  backend_port                   = 5349
  frontend_ip_configuration_name = "public"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.turn[0].id]
  probe_id                       = azurerm_lb_probe.turn[0].id
  idle_timeout_in_minutes        = 30
  disable_outbound_snat          = true
}

resource "azurerm_orchestrated_virtual_machine_scale_set" "this" {
  for_each = local.enabled_roles

  name                        = "${var.name}-livekit-${each.key}"
  location                    = var.location
  resource_group_name         = var.resource_group_name
  platform_fault_domain_count = 1
  single_placement_group      = false
  zones                       = length(var.zones) > 0 ? var.zones : null
  zone_balance                = length(var.zones) > 1 ? true : null
  sku_name                    = each.value.vm_size
  instances                   = each.value.min_replicas
  network_api_version         = "2020-11-01"

  os_profile {
    custom_data = base64encode(local.cloud_init[each.key])

    linux_configuration {
      admin_username                  = var.admin_username
      computer_name_prefix            = "lk-${each.key}"
      disable_password_authentication = true

      admin_ssh_key {
        username   = var.admin_username
        public_key = var.ssh_public_key
      }
    }
  }

  source_image_reference {
    publisher = var.vm_image.publisher
    offer     = var.vm_image.offer
    sku       = var.vm_image.sku
    version   = var.vm_image.version
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = var.disk_size_gb
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.instances[0].id]
  }

  boot_diagnostics {}

  network_interface {
    name                          = "primary"
    primary                       = true
    enable_accelerated_networking = true

    ip_configuration {
      name                                         = "primary"
      primary                                      = true
      subnet_id                                    = each.value.subnet_id
      version                                      = "IPv4"
      application_gateway_backend_address_pool_ids = each.key == "server" ? [local.appgw_backend_pool_id] : null
      load_balancer_backend_address_pool_ids       = each.key == "server" && local.turn_tls ? [azurerm_lb_backend_address_pool.turn[0].id] : null

      dynamic "public_ip_address" {
        for_each = each.value.public_ip ? [1] : []
        content {
          name                    = "public"
          sku_name                = "Standard_Regional"
          idle_timeout_in_minutes = 15
        }
      }
    }
  }

  tags = merge(var.tags, { role = "livekit-${each.key}" })

  lifecycle {
    ignore_changes = [instances]

    precondition {
      condition     = var.redis.mode != "incluster"
      error_message = "LiveKit shares state through Redis reachable from outside the cluster; redis_mode must be managed or external when livekit_enabled is true."
    }

    precondition {
      condition     = var.api_key != "" && var.api_secret != ""
      error_message = "livekit_api_key and livekit_api_secret are required when livekit_enabled is true."
    }

    precondition {
      condition     = var.domain != ""
      error_message = "domain is required when livekit_enabled is true."
    }

    precondition {
      condition     = var.ssh_public_key != ""
      error_message = "ssh_public_key is required when livekit_enabled is true; Azure Linux virtual machines need an SSH public key at creation."
    }

    precondition {
      condition     = !var.https_enabled || var.certificate_secret_id != ""
      error_message = "livekit_certificate_secret_id (the Key Vault certificate or secret id for livekit.<domain>) is required when livekit_enabled is true and livekit_https is true."
    }

    precondition {
      condition     = var.dns_zone == "" || endswith(var.domain, var.dns_zone)
      error_message = "domain must be the dns_zone name or a subdomain of it when dns_zone is set."
    }
  }

  depends_on = [azurerm_key_vault_secret.config, azurerm_role_assignment.instances_secrets]
}

resource "azurerm_monitor_autoscale_setting" "this" {
  for_each = local.enabled_roles

  name                = "${var.name}-livekit-${each.key}"
  location            = var.location
  resource_group_name = var.resource_group_name
  target_resource_id  = azurerm_orchestrated_virtual_machine_scale_set.this[each.key].id
  enabled             = true

  profile {
    name = "cpu"

    capacity {
      minimum = each.value.min_replicas
      maximum = each.value.max_replicas
      default = each.value.min_replicas
    }

    rule {
      metric_trigger {
        metric_name        = "Percentage CPU"
        metric_resource_id = azurerm_orchestrated_virtual_machine_scale_set.this[each.key].id
        metric_namespace   = "microsoft.compute/virtualmachinescalesets"
        time_grain         = "PT1M"
        statistic          = "Average"
        time_window        = "PT5M"
        time_aggregation   = "Average"
        operator           = "GreaterThan"
        threshold          = var.target_cpu_utilization * 100
      }

      scale_action {
        direction = "Increase"
        type      = "ChangeCount"
        value     = 1
        cooldown  = "PT5M"
      }
    }

    rule {
      metric_trigger {
        metric_name        = "Percentage CPU"
        metric_resource_id = azurerm_orchestrated_virtual_machine_scale_set.this[each.key].id
        metric_namespace   = "microsoft.compute/virtualmachinescalesets"
        time_grain         = "PT1M"
        statistic          = "Average"
        time_window        = "PT10M"
        time_aggregation   = "Average"
        operator           = "LessThan"
        threshold          = var.target_cpu_utilization * 50
      }

      scale_action {
        direction = "Decrease"
        type      = "ChangeCount"
        value     = 1
        cooldown  = "PT10M"
      }
    }
  }

  tags = var.tags
}

data "azurerm_dns_zone" "this" {
  count = local.dns_count

  name                = var.dns_zone
  resource_group_name = local.dns_zone_resource_group
}

resource "azurerm_dns_a_record" "signal" {
  count = local.dns_count

  name                = local.signal_record_name
  zone_name           = data.azurerm_dns_zone.this[0].name
  resource_group_name = local.dns_zone_resource_group
  ttl                 = 300
  records             = [azurerm_public_ip.signal[0].ip_address]

  tags = var.tags
}

resource "azurerm_dns_a_record" "turn" {
  count = local.dns_count > 0 && local.turn_tls ? 1 : 0

  name                = local.turn_record_name
  zone_name           = data.azurerm_dns_zone.this[0].name
  resource_group_name = local.dns_zone_resource_group
  ttl                 = 300
  records             = [azurerm_public_ip.turn[0].ip_address]

  tags = var.tags
}
