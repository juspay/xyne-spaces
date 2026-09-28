locals {
  count = var.enabled ? 1 : 0

  redirect_count = var.enabled && var.http_redirect ? 1 : 0

  use_existing = length(var.certificate_ids) > 0
  use_supplied = !local.use_existing && var.certificate_pem != "" && var.private_key_pem != ""
  use_managed  = !local.use_existing && !local.use_supplied

  certificate_source = local.use_existing ? "existing" : (local.use_supplied ? "supplied" : "managed")

  certificate_ids = var.enabled ? (
    local.use_existing ? var.certificate_ids : concat(
      google_compute_ssl_certificate.this[*].id,
      google_compute_managed_ssl_certificate.this[*].id,
    )
  ) : []

  port_name = var.backend_port_name != "" ? var.backend_port_name : "${var.name}-ingress"

  backend_port = var.backend_protocol == "HTTPS" ? var.node_ports.https : var.node_ports.http

  instance_groups = var.enabled ? toset(var.backend_instance_groups) : toset([])

  firewall_ports = [
    tostring(var.node_ports.http),
    tostring(var.node_ports.https),
    tostring(var.node_ports.status),
  ]

  health_check_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
}

resource "terraform_data" "certificate" {
  count = local.count

  input = local.certificate_source

  lifecycle {
    precondition {
      condition     = !(length(var.certificate_ids) > 0 && (var.certificate_pem != "" || var.private_key_pem != ""))
      error_message = "certificate_ids and certificate_pem select different certificate sources; set exactly one."
    }

    precondition {
      condition     = (var.certificate_pem == "") == (var.private_key_pem == "")
      error_message = "certificate_pem and private_key_pem must be set together."
    }

    precondition {
      condition     = !local.use_managed || length(var.certificate_domains) > 0
      error_message = "certificate_domains must list at least one domain when no certificate_ids or certificate_pem is given."
    }
  }
}

resource "google_compute_global_address" "this" {
  count = local.count

  name         = "${var.name}-ingress-lb"
  project      = var.project
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
}

resource "google_compute_ssl_certificate" "this" {
  count = var.enabled && local.use_supplied ? 1 : 0

  name_prefix = "${var.name}-ingress-"
  project     = var.project
  certificate = var.certificate_pem
  private_key = var.private_key_pem

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_managed_ssl_certificate" "this" {
  count = var.enabled && local.use_managed ? 1 : 0

  name    = "${var.name}-ingress"
  project = var.project

  managed {
    domains = var.certificate_domains
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_health_check" "this" {
  count = local.count

  name                = "${var.name}-ingress"
  project             = var.project
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = var.node_ports.status
    request_path = "/healthz/ready"
  }
}

resource "google_compute_instance_group_named_port" "this" {
  for_each = local.instance_groups

  project = var.project
  zone    = regex("/zones/([^/]+)/instanceGroups/", each.key)[0]
  group   = regex("/instanceGroups/([^/]+)$", each.key)[0]
  name    = local.port_name
  port    = local.backend_port
}

resource "google_compute_backend_service" "this" {
  count = local.count

  name                  = "${var.name}-ingress"
  project               = var.project
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = var.backend_protocol
  port_name             = local.port_name
  timeout_sec           = var.timeout_sec
  session_affinity      = "NONE"
  health_checks         = [google_compute_health_check.this[0].id]

  connection_draining_timeout_sec = var.connection_draining_timeout_sec

  dynamic "backend" {
    for_each = local.instance_groups
    content {
      group           = backend.value
      balancing_mode  = "UTILIZATION"
      max_utilization = 0.8
      capacity_scaler = 1
    }
  }

  log_config {
    enable      = true
    sample_rate = var.log_sample_rate
  }

  depends_on = [google_compute_instance_group_named_port.this]
}

resource "google_compute_url_map" "this" {
  count = local.count

  name            = "${var.name}-ingress"
  project         = var.project
  default_service = google_compute_backend_service.this[0].id
}

resource "google_compute_target_https_proxy" "this" {
  count = local.count

  name             = "${var.name}-ingress"
  project          = var.project
  url_map          = google_compute_url_map.this[0].id
  ssl_certificates = local.certificate_ids

  depends_on = [terraform_data.certificate]
}

resource "google_compute_global_forwarding_rule" "https" {
  count = local.count

  name                  = "${var.name}-ingress-https"
  project               = var.project
  ip_address            = google_compute_global_address.this[0].address
  ip_protocol           = "TCP"
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.this[0].id
}

resource "google_compute_url_map" "redirect" {
  count = local.redirect_count

  name    = "${var.name}-ingress-redirect"
  project = var.project

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = local.redirect_count

  name    = "${var.name}-ingress-redirect"
  project = var.project
  url_map = google_compute_url_map.redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count = local.redirect_count

  name                  = "${var.name}-ingress-http"
  project               = var.project
  ip_address            = google_compute_global_address.this[0].address
  ip_protocol           = "TCP"
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.redirect[0].id
}

resource "google_compute_firewall" "lb" {
  count = local.count

  name          = "${var.name}-ingress-allow-lb"
  project       = var.project
  network       = var.network
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = local.health_check_ranges
  target_tags   = var.target_tags

  allow {
    protocol = "tcp"
    ports    = local.firewall_ports
  }
}
