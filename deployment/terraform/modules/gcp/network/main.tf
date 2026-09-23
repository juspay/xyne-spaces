locals {
  private_service_address       = split("/", var.private_service_cidr)[0]
  private_service_prefix_length = tonumber(split("/", var.private_service_cidr)[1])
}

resource "google_compute_network" "this" {
  name                            = var.name
  project                         = var.project
  auto_create_subnetworks         = false
  routing_mode                    = "REGIONAL"
  delete_default_routes_on_create = false
}

resource "google_compute_subnetwork" "this" {
  name                     = "${var.name}-${var.region}"
  project                  = var.project
  region                   = var.region
  network                  = google_compute_network.this.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
  stack_type               = "IPV4_ONLY"

  secondary_ip_range {
    range_name    = var.pods_range_name
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = var.services_range_name
    ip_cidr_range = var.services_cidr
  }

  dynamic "log_config" {
    for_each = var.enable_flow_logs ? [1] : []
    content {
      aggregation_interval = "INTERVAL_5_MIN"
      flow_sampling        = 0.5
      metadata             = "INCLUDE_ALL_METADATA"
    }
  }
}

resource "google_compute_router" "this" {
  name    = "${var.name}-${var.region}"
  project = var.project
  region  = var.region
  network = google_compute_network.this.id
}

resource "google_compute_router_nat" "this" {
  name                               = "${var.name}-${var.region}"
  project                            = var.project
  region                             = var.region
  router                             = google_compute_router.this.name
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = var.nat_log_filter
  }
}

resource "google_compute_global_address" "private_services" {
  name          = "${var.name}-private-services"
  project       = var.project
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = local.private_service_address
  prefix_length = local.private_service_prefix_length
  network       = google_compute_network.this.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.this.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  deletion_policy         = "ABANDON"
}

resource "google_compute_firewall" "internal" {
  name      = "${var.name}-allow-internal"
  project   = var.project
  network   = google_compute_network.this.name
  direction = "INGRESS"
  priority  = 1000

  source_ranges = [
    var.subnet_cidr,
    var.pods_cidr,
    var.services_cidr,
  ]

  allow {
    protocol = "tcp"
  }

  allow {
    protocol = "udp"
  }

  allow {
    protocol = "icmp"
  }
}

resource "google_compute_firewall" "iap_ssh" {
  count = var.enable_iap_ssh ? 1 : 0

  name      = "${var.name}-allow-iap-ssh"
  project   = var.project
  network   = google_compute_network.this.name
  direction = "INGRESS"
  priority  = 1000

  source_ranges = ["35.235.240.0/20"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "health_checks" {
  name      = "${var.name}-allow-health-checks"
  project   = var.project
  network   = google_compute_network.this.name
  direction = "INGRESS"
  priority  = 1000

  source_ranges = [
    "130.211.0.0/22",
    "35.191.0.0/16",
  ]

  allow {
    protocol = "tcp"
  }
}
