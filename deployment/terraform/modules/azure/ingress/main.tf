locals {
  count = var.enabled ? 1 : 0

  backend_https = var.backend_protocol == "Https"
  backend_port  = local.backend_https ? 443 : 80

  probe_port = var.probe_port > 0 ? var.probe_port : (local.backend_https ? local.backend_port : 15021)

  root_certificate = local.backend_https && nonsensitive(var.backend_root_certificate_pem) != ""

  key_vault_certificate = var.certificate_key_vault_secret_id != ""
  pfx_certificate       = nonsensitive(var.certificate_pfx_data) != ""

  certificate_source = local.key_vault_certificate && local.pfx_certificate ? "both" : (
    local.key_vault_certificate ? "key-vault" : (local.pfx_certificate ? "pfx" : "none")
  )

  identity_count = var.enabled && local.key_vault_certificate ? 1 : 0
  role_count     = local.identity_count > 0 && var.certificate_key_vault_id != "" ? 1 : 0

  waf_count = var.enabled && var.waf_enabled && var.sku_tier == "WAF_v2" ? 1 : 0
}

resource "terraform_data" "inputs" {
  count = local.count

  input = local.certificate_source

  lifecycle {
    precondition {
      condition     = var.domain != ""
      error_message = "domain is required when the ingress application gateway is enabled."
    }

    precondition {
      condition     = var.subnet_id != ""
      error_message = "subnet_id is required when the ingress application gateway is enabled; an application gateway needs a subnet of its own."
    }

    precondition {
      condition     = var.backend_ip != ""
      error_message = "backend_ip is required when the ingress application gateway is enabled; it is the private address of the internal load balancer in front of the gateway service."
    }

    precondition {
      condition     = local.certificate_source != "none"
      error_message = "a frontend certificate is required: set certificate_key_vault_secret_id, or certificate_pfx_data together with certificate_pfx_password."
    }

    precondition {
      condition     = local.certificate_source != "both"
      error_message = "certificate_key_vault_secret_id and certificate_pfx_data are mutually exclusive; supply exactly one."
    }

    precondition {
      condition     = local.backend_https || nonsensitive(var.backend_root_certificate_pem) == ""
      error_message = "backend_root_certificate_pem only applies when backend_protocol is Https; an application gateway does not validate a certificate on a plain HTTP backend."
    }

    precondition {
      condition     = var.waf_enabled == (var.sku_tier == "WAF_v2")
      error_message = "waf_enabled and a WAF_v2 sku_tier go together; set both or neither."
    }

    precondition {
      condition     = var.sku_name == var.sku_tier
      error_message = "sku_name and sku_tier must match."
    }

    precondition {
      condition     = var.min_capacity >= 1 && var.max_capacity >= var.min_capacity
      error_message = "min_capacity must be at least 1 and max_capacity must not be below min_capacity."
    }
  }
}

resource "azurerm_user_assigned_identity" "this" {
  count = local.identity_count

  name                = "${var.name}-ingress-appgw"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = var.tags
}

resource "azurerm_role_assignment" "certificate_secrets" {
  count = local.role_count

  scope                            = var.certificate_key_vault_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.this[0].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_public_ip" "this" {
  count = local.count

  name                = "${var.name}-ingress-appgw"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = length(var.zones) > 0 ? var.zones : null
  domain_name_label   = var.domain_name_label != "" ? var.domain_name_label : null

  tags = var.tags
}

resource "azurerm_web_application_firewall_policy" "this" {
  count = local.waf_count

  name                = "${var.name}-ingress-waf"
  location            = var.location
  resource_group_name = var.resource_group_name

  policy_settings {
    enabled = true
    mode    = var.waf_mode
  }

  managed_rules {
    managed_rule_set {
      type    = "OWASP"
      version = var.waf_rule_set_version
    }
  }

  tags = var.tags
}

resource "azurerm_application_gateway" "this" {
  count = local.count

  name                = "${var.name}-ingress"
  location            = var.location
  resource_group_name = var.resource_group_name
  zones               = length(var.zones) > 0 ? var.zones : null
  http2_enabled       = true
  firewall_policy_id  = local.waf_count > 0 ? azurerm_web_application_firewall_policy.this[0].id : null

  sku {
    name = var.sku_name
    tier = var.sku_tier
  }

  autoscale_configuration {
    min_capacity = var.min_capacity
    max_capacity = var.max_capacity
  }

  dynamic "identity" {
    for_each = local.key_vault_certificate ? [1] : []
    content {
      type         = "UserAssigned"
      identity_ids = [azurerm_user_assigned_identity.this[0].id]
    }
  }

  gateway_ip_configuration {
    name      = "gateway"
    subnet_id = var.subnet_id
  }

  frontend_ip_configuration {
    name                 = "public"
    public_ip_address_id = azurerm_public_ip.this[0].id
  }

  frontend_port {
    name = "https"
    port = 443
  }

  dynamic "frontend_port" {
    for_each = var.http_redirect ? [1] : []
    content {
      name = "http"
      port = 80
    }
  }

  backend_address_pool {
    name         = "gateway"
    ip_addresses = [var.backend_ip]
  }

  dynamic "trusted_root_certificate" {
    for_each = local.root_certificate ? [1] : []
    content {
      name = "backend"
      data = base64encode(var.backend_root_certificate_pem)
    }
  }

  probe {
    name                                      = "gateway"
    protocol                                  = var.backend_protocol
    path                                      = var.probe_path
    port                                      = local.probe_port
    pick_host_name_from_backend_http_settings = true
    interval                                  = 10
    timeout                                   = 5
    unhealthy_threshold                       = 3

    match {
      status_code = var.probe_status_codes
    }
  }

  backend_http_settings {
    name                                = "gateway"
    port                                = local.backend_port
    protocol                            = var.backend_protocol
    cookie_based_affinity               = "Disabled"
    request_timeout                     = var.request_timeout
    pick_host_name_from_backend_address = false
    host_name                           = var.domain
    probe_name                          = "gateway"
    trusted_root_certificate_names      = local.root_certificate ? ["backend"] : null
  }

  ssl_certificate {
    name                = "gateway"
    key_vault_secret_id = local.key_vault_certificate ? var.certificate_key_vault_secret_id : null
    data                = local.pfx_certificate ? var.certificate_pfx_data : null
    password            = local.pfx_certificate ? var.certificate_pfx_password : null
  }

  ssl_policy {
    policy_type = "Predefined"
    policy_name = var.ssl_policy_name
  }

  http_listener {
    name                           = "https"
    frontend_ip_configuration_name = "public"
    frontend_port_name             = "https"
    protocol                       = "Https"
    ssl_certificate_name           = "gateway"
  }

  dynamic "http_listener" {
    for_each = var.http_redirect ? [1] : []
    content {
      name                           = "http"
      frontend_ip_configuration_name = "public"
      frontend_port_name             = "http"
      protocol                       = "Http"
    }
  }

  dynamic "redirect_configuration" {
    for_each = var.http_redirect ? [1] : []
    content {
      name                 = "http-to-https"
      redirect_type        = "Permanent"
      target_listener_name = "https"
      include_path         = true
      include_query_string = true
    }
  }

  request_routing_rule {
    name                       = "https"
    rule_type                  = "Basic"
    priority                   = 10
    http_listener_name         = "https"
    backend_address_pool_name  = "gateway"
    backend_http_settings_name = "gateway"
  }

  dynamic "request_routing_rule" {
    for_each = var.http_redirect ? [1] : []
    content {
      name                        = "http"
      rule_type                   = "Basic"
      priority                    = 20
      http_listener_name          = "http"
      redirect_configuration_name = "http-to-https"
    }
  }

  tags = var.tags

  depends_on = [terraform_data.inputs, azurerm_role_assignment.certificate_secrets]
}
