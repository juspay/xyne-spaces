output "ip" {
  value = var.enabled ? google_compute_global_address.this[0].address : ""
}

output "backend_service_id" {
  value = var.enabled ? google_compute_backend_service.this[0].id : ""
}

output "certificate_ids" {
  value = local.certificate_ids
}

output "named_port_name" {
  value = local.port_name
}
