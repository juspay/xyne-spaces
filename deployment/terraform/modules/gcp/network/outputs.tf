output "network_id" {
  value = google_compute_network.this.id
}

output "network_name" {
  value = google_compute_network.this.name
}

output "network_self_link" {
  value = google_compute_network.this.self_link
}

output "subnet_id" {
  value = google_compute_subnetwork.this.id
}

output "subnet_name" {
  value = google_compute_subnetwork.this.name
}

output "subnet_self_link" {
  value = google_compute_subnetwork.this.self_link
}

output "subnet_cidr" {
  value = google_compute_subnetwork.this.ip_cidr_range
}

output "pods_range_name" {
  value = var.pods_range_name
}

output "services_range_name" {
  value = var.services_range_name
}

output "private_service_range_name" {
  value = google_compute_global_address.private_services.name
}

output "private_service_connection" {
  value = google_service_networking_connection.private_services.id
}
