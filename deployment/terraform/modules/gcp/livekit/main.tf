locals {
  count = var.enabled ? 1 : 0

  url       = var.enabled ? "wss://livekit.${var.domain}" : ""
  http_url  = var.enabled ? "https://livekit.${var.domain}" : ""
  turn_host = var.enabled ? "turn.${var.domain}" : ""
  turn_tls  = var.turn_cert_secret != ""

  tag = "${var.name}-livekit"

  lb_source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]

  roles = {
    server = {
      config_secret  = "${var.name}-livekit-server-config"
      image          = var.server_image
      docker_flags   = "-v /etc/livekit:/etc/livekit:ro"
      container_args = "--config /etc/livekit/config.yaml"
      turn_cert      = var.turn_cert_secret
      machine_type   = var.machine_type
      external_ip    = true
    }
    egress = {
      config_secret  = "${var.name}-livekit-egress-config"
      image          = var.egress_image
      docker_flags   = "--cap-add SYS_ADMIN -e EGRESS_CONFIG_FILE=/etc/livekit/config.yaml -v /etc/livekit:/etc/livekit:ro"
      container_args = ""
      turn_cert      = ""
      machine_type   = var.egress_machine_type
      external_ip    = false
    }
  }

  enabled_roles = { for role, spec in local.roles : role => spec if var.enabled }

  configs = {
    server = module.config.server_config
    egress = module.config.egress_config
  }
}

module "config" {
  source = "../../livekit-config"

  api_key          = var.api_key
  api_secret       = var.api_secret
  domain           = var.domain
  ws_url           = local.url
  redis            = var.redis
  redis_auth       = var.redis_auth
  port_range_start = var.port_range_start
  port_range_end   = var.port_range_end
  turn = {
    tls = local.turn_tls
  }
}

data "google_compute_zones" "available" {
  count = local.count

  project = var.project
  region  = var.region
  status  = "UP"
}

data "google_dns_managed_zone" "this" {
  count = var.enabled && var.dns_zone != "" ? 1 : 0

  project = var.project
  name    = var.dns_zone
}

resource "google_service_account" "instances" {
  count = local.count

  project      = var.project
  account_id   = "${var.name}-livekit-vm"
  display_name = "LiveKit instances for ${var.name}"
}

resource "google_project_iam_member" "instances" {
  for_each = toset(var.enabled ? ["roles/logging.logWriter", "roles/monitoring.metricWriter"] : [])

  project = var.project
  role    = each.key
  member  = google_service_account.instances[0].member
}

resource "google_secret_manager_secret" "config" {
  for_each = local.enabled_roles

  project   = var.project
  secret_id = each.value.config_secret
  labels    = var.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "config" {
  for_each = local.enabled_roles

  secret      = google_secret_manager_secret.config[each.key].id
  secret_data = local.configs[each.key]
}

resource "google_secret_manager_secret_iam_member" "config" {
  for_each = local.enabled_roles

  project   = var.project
  secret_id = google_secret_manager_secret.config[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.instances[0].member
}

resource "google_secret_manager_secret_iam_member" "turn_cert" {
  count = var.enabled && local.turn_tls ? 1 : 0

  project   = var.project
  secret_id = var.turn_cert_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.instances[0].member
}

resource "google_compute_instance_template" "this" {
  for_each = local.enabled_roles

  name_prefix  = "${var.name}-livekit-${each.key}-"
  project      = var.project
  region       = var.region
  machine_type = each.value.machine_type
  tags         = [local.tag, "${local.tag}-${each.key}"]
  labels       = merge(var.labels, { role = "livekit-${each.key}" })

  disk {
    source_image = var.vm_image
    auto_delete  = true
    boot         = true
    disk_size_gb = var.disk_size_gb
    disk_type    = "pd-balanced"
  }

  network_interface {
    network    = var.network
    subnetwork = var.subnetwork

    dynamic "access_config" {
      for_each = each.value.external_ip ? [1] : []
      content {
        network_tier = "PREMIUM"
      }
    }
  }

  metadata = {
    enable-oslogin = "TRUE"
    user-data = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
      project          = var.project
      role             = each.key
      config_secret    = each.value.config_secret
      turn_cert_secret = each.value.turn_cert
      image            = each.value.image
      docker_flags     = each.value.docker_flags
      container_args   = each.value.container_args
    })
  }

  service_account {
    email  = google_service_account.instances[0].email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_secret_manager_secret_version.config]
}

resource "google_compute_health_check" "server" {
  count = local.count

  name                = "${var.name}-livekit-server"
  project             = var.project
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 7880
    request_path = "/"
  }
}

resource "google_compute_region_instance_group_manager" "server" {
  count = local.count

  name               = "${var.name}-livekit-server"
  project            = var.project
  region             = var.region
  base_instance_name = "${var.name}-livekit-server"

  distribution_policy_zones = data.google_compute_zones.available[0].names

  version {
    instance_template = google_compute_instance_template.this["server"].id
  }

  named_port {
    name = "signal"
    port = 7880
  }

  named_port {
    name = "turn-tls"
    port = 5349
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.server[0].id
    initial_delay_sec = 300
  }

  update_policy {
    type                         = "OPPORTUNISTIC"
    minimal_action               = "REPLACE"
    max_surge_fixed              = length(data.google_compute_zones.available[0].names)
    max_unavailable_fixed        = 0
    instance_redistribution_type = "PROACTIVE"
  }

  lifecycle {
    ignore_changes = [target_size]

    precondition {
      condition     = var.redis.mode != "incluster"
      error_message = "LiveKit shares state through Redis reachable from outside the cluster; redis_mode must be managed or external when livekit_enabled is true."
    }

    precondition {
      condition     = var.api_key != "" && var.api_secret != ""
      error_message = "livekit_api_key and livekit_api_secret are required when livekit_enabled is true."
    }

    precondition {
      condition     = var.domain != ""
      error_message = "domain is required when livekit_enabled is true."
    }
  }
}

resource "google_compute_region_autoscaler" "server" {
  count = local.count

  name    = "${var.name}-livekit-server"
  project = var.project
  region  = var.region
  target  = google_compute_region_instance_group_manager.server[0].id

  autoscaling_policy {
    min_replicas    = var.min_replicas
    max_replicas    = var.max_replicas
    cooldown_period = 120

    cpu_utilization {
      target = var.target_cpu_utilization
    }
  }
}

resource "google_compute_region_instance_group_manager" "egress" {
  count = local.count

  name               = "${var.name}-livekit-egress"
  project            = var.project
  region             = var.region
  base_instance_name = "${var.name}-livekit-egress"

  distribution_policy_zones = data.google_compute_zones.available[0].names

  version {
    instance_template = google_compute_instance_template.this["egress"].id
  }

  update_policy {
    type                         = "OPPORTUNISTIC"
    minimal_action               = "REPLACE"
    max_surge_fixed              = length(data.google_compute_zones.available[0].names)
    max_unavailable_fixed        = 0
    instance_redistribution_type = "PROACTIVE"
  }

  lifecycle {
    ignore_changes = [target_size]
  }
}

resource "google_compute_region_autoscaler" "egress" {
  count = local.count

  name    = "${var.name}-livekit-egress"
  project = var.project
  region  = var.region
  target  = google_compute_region_instance_group_manager.egress[0].id

  autoscaling_policy {
    min_replicas    = var.egress_min_replicas
    max_replicas    = var.egress_max_replicas
    cooldown_period = 120

    cpu_utilization {
      target = var.target_cpu_utilization
    }
  }
}

resource "google_compute_firewall" "lb" {
  count = local.count

  name          = "${var.name}-livekit-allow-lb"
  project       = var.project
  network       = var.network
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = local.lb_source_ranges
  target_tags   = ["${local.tag}-server"]

  allow {
    protocol = "tcp"
    ports    = ["7880", "5349"]
  }
}

resource "google_compute_firewall" "rtc" {
  count = local.count

  name          = "${var.name}-livekit-allow-rtc"
  project       = var.project
  network       = var.network
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["${local.tag}-server"]

  allow {
    protocol = "tcp"
    ports    = ["7881"]
  }

  allow {
    protocol = "udp"
    ports    = ["3478", "${var.port_range_start}-${var.port_range_end}"]
  }
}

resource "google_compute_global_address" "lb" {
  count = local.count

  name         = "${var.name}-livekit"
  project      = var.project
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
}

resource "google_compute_backend_service" "signal" {
  count = local.count

  name                  = "${var.name}-livekit-signal"
  project               = var.project
  protocol              = "HTTP"
  port_name             = "signal"
  timeout_sec           = 3600
  load_balancing_scheme = "EXTERNAL_MANAGED"
  session_affinity      = "NONE"
  health_checks         = [google_compute_health_check.server[0].id]

  connection_draining_timeout_sec = 300

  backend {
    group           = google_compute_region_instance_group_manager.server[0].instance_group
    balancing_mode  = "UTILIZATION"
    max_utilization = 0.8
    capacity_scaler = 1
  }

  log_config {
    enable      = true
    sample_rate = 0.1
  }
}

resource "google_compute_url_map" "https" {
  count = local.count

  name            = "${var.name}-livekit-https"
  project         = var.project
  default_service = google_compute_backend_service.signal[0].id
}

resource "google_compute_managed_ssl_certificate" "signal" {
  count = local.count

  name    = "${var.name}-livekit-signal"
  project = var.project

  managed {
    domains = ["livekit.${var.domain}"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "signal" {
  count = local.count

  name             = "${var.name}-livekit-signal"
  project          = var.project
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.signal[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count = local.count

  name                  = "${var.name}-livekit-https"
  project               = var.project
  ip_address            = google_compute_global_address.lb[0].address
  ip_protocol           = "TCP"
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.signal[0].id
}

resource "google_compute_url_map" "redirect" {
  count = local.count

  name    = "${var.name}-livekit-redirect"
  project = var.project

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count = local.count

  name    = "${var.name}-livekit-redirect"
  project = var.project
  url_map = google_compute_url_map.redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count = local.count

  name                  = "${var.name}-livekit-http"
  project               = var.project
  ip_address            = google_compute_global_address.lb[0].address
  ip_protocol           = "TCP"
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.redirect[0].id
}

resource "google_compute_backend_service" "turn" {
  count = var.enabled && local.turn_tls ? 1 : 0

  name                  = "${var.name}-livekit-turn"
  project               = var.project
  protocol              = "TCP"
  port_name             = "turn-tls"
  timeout_sec           = 3600
  load_balancing_scheme = "EXTERNAL_MANAGED"
  health_checks         = [google_compute_health_check.server[0].id]

  connection_draining_timeout_sec = 300

  backend {
    group           = google_compute_region_instance_group_manager.server[0].instance_group
    balancing_mode  = "UTILIZATION"
    max_utilization = 0.8
    capacity_scaler = 1
  }
}

resource "google_compute_target_tcp_proxy" "turn" {
  count = var.enabled && local.turn_tls ? 1 : 0

  name            = "${var.name}-livekit-turn"
  project         = var.project
  backend_service = google_compute_backend_service.turn[0].id
  proxy_header    = "NONE"
}

resource "google_compute_global_forwarding_rule" "turn" {
  count = var.enabled && local.turn_tls ? 1 : 0

  name                  = "${var.name}-livekit-turn"
  project               = var.project
  ip_address            = google_compute_global_address.lb[0].address
  ip_protocol           = "TCP"
  port_range            = "5349"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_tcp_proxy.turn[0].id
}

resource "google_dns_record_set" "signal" {
  count = var.enabled && var.dns_zone != "" ? 1 : 0

  project      = var.project
  managed_zone = data.google_dns_managed_zone.this[0].name
  name         = "livekit.${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb[0].address]
}

resource "google_dns_record_set" "turn" {
  count = var.enabled && var.dns_zone != "" ? 1 : 0

  project      = var.project
  managed_zone = data.google_dns_managed_zone.this[0].name
  name         = "turn.${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb[0].address]
}
