output "livekit" {
  value = {
    enabled   = var.enabled
    url       = local.url
    http_url  = local.http_url
    turn_host = local.turn_host
    group     = var.enabled ? aws_autoscaling_group.server[0].name : ""
  }
}

output "livekit_keys" {
  value = {
    api_key    = var.api_key
    api_secret = var.api_secret
  }
  sensitive = true
}

output "signal_lb_dns_name" {
  value = var.enabled ? aws_lb.signal[0].dns_name : ""
}

output "turn_lb_dns_name" {
  value = local.turn_count > 0 ? aws_lb.turn[0].dns_name : ""
}

output "certificate_arn" {
  value = local.certificate_arn
}

output "egress_group" {
  value = var.enabled ? aws_autoscaling_group.egress[0].name : ""
}

output "instance_role_arn" {
  value = var.enabled ? aws_iam_role.instances[0].arn : ""
}

output "config_secrets" {
  value = { for role, secret in aws_secretsmanager_secret.config : role => secret.name }
}
