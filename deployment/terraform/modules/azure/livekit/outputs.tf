output "livekit" {
  value = {
    enabled   = var.enabled
    url       = local.url
    http_url  = local.http_url
    turn_host = local.turn_host
    group     = var.enabled ? azurerm_orchestrated_virtual_machine_scale_set.this["server"].name : ""
  }
}

output "livekit_keys" {
  value = {
    api_key    = var.api_key
    api_secret = var.api_secret
  }
  sensitive = true
}

output "signal_ip" {
  value = var.enabled ? azurerm_public_ip.signal[0].ip_address : ""
}

output "turn_ip" {
  value = local.turn_count > 0 ? azurerm_public_ip.turn[0].ip_address : ""
}

output "egress_group" {
  value = var.enabled ? azurerm_orchestrated_virtual_machine_scale_set.this["egress"].name : ""
}

output "key_vault_id" {
  value = local.key_vault_id
}

output "key_vault_name" {
  value = var.enabled ? local.key_vault_name : ""
}

output "instances_identity_id" {
  value = var.enabled ? azurerm_user_assigned_identity.instances[0].id : ""
}

output "config_secrets" {
  value = { for role, secret in azurerm_key_vault_secret.config : role => secret.name }
}
