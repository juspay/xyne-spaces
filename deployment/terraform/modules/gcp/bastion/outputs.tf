output "instance_name" {
  value = var.enabled ? google_compute_instance.this[0].name : ""
}

output "zone" {
  value = local.zone
}

output "ssh_command" {
  value = var.enabled ? "gcloud compute ssh ${google_compute_instance.this[0].name} --project ${var.project} --zone ${local.zone} --tunnel-through-iap" : ""
}
