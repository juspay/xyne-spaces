output "ip" {
  value = local.eip_count > 0 ? aws_eip.this[0].public_ip : ""
}

output "ips" {
  value = aws_eip.this[*].public_ip
}

output "hostname" {
  value = local.count > 0 ? aws_lb.this[0].dns_name : ""
}

output "zone_id" {
  value = local.count > 0 ? aws_lb.this[0].zone_id : ""
}

output "certificate_arn" {
  value = local.certificate_arn
}

output "target_group_arns" {
  value = {
    https = local.count > 0 ? aws_lb_target_group.https[0].arn : ""
    http  = local.http_count > 0 ? aws_lb_target_group.http[0].arn : ""
  }
}
