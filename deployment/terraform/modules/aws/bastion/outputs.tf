output "instance_id" {
  value = var.enabled ? aws_instance.this[0].id : ""
}

output "role_arn" {
  value = var.enabled ? aws_iam_role.this[0].arn : ""
}
