output "livekit" {
  value = {
    enabled   = var.enabled
    url       = local.url
    http_url  = local.http_url
    turn_host = local.turn_host
    group     = var.enabled ? google_compute_region_instance_group_manager.server[0].name : ""
  }
}

output "livekit_keys" {
  value = {
    api_key    = var.api_key
    api_secret = var.api_secret
  }
  sensitive = true
}

output "lb_ip" {
  value = var.enabled ? google_compute_global_address.lb[0].address : ""
}

output "egress_group" {
  value = var.enabled ? google_compute_region_instance_group_manager.egress[0].name : ""
}

output "service_account_email" {
  value = var.enabled ? google_service_account.instances[0].email : ""
}

output "config_secrets" {
  value = { for role, secret in google_secret_manager_secret.config : role => secret.secret_id }
}
