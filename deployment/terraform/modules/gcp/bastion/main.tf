data "google_compute_zones" "this" {
  count = var.enabled ? 1 : 0

  project = var.project
  region  = var.region
}

locals {
  zone = var.zone != "" ? var.zone : (var.enabled ? data.google_compute_zones.this[0].names[0] : "")
}

resource "google_service_account" "this" {
  count = var.enabled ? 1 : 0

  project      = var.project
  account_id   = "${var.name}-bastion"
  display_name = "${var.name} bastion"
}

resource "google_project_iam_member" "container_developer" {
  count = var.enabled ? 1 : 0

  project = var.project
  role    = "roles/container.developer"
  member  = "serviceAccount:${google_service_account.this[0].email}"
}

resource "google_project_iam_member" "log_writer" {
  count = var.enabled ? 1 : 0

  project = var.project
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.this[0].email}"
}

resource "google_compute_instance" "this" {
  count = var.enabled ? 1 : 0

  project      = var.project
  zone         = local.zone
  name         = "${var.name}-bastion"
  machine_type = var.machine_type
  labels       = merge(var.labels, { role = "bastion" })
  tags         = ["${var.name}-bastion"]

  boot_disk {
    initialize_params {
      image = var.image
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network    = var.network_self_link
    subnetwork = var.subnet_self_link
  }

  service_account {
    email  = google_service_account.this[0].email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = <<-EOT
      apt-get update
      apt-get install -y apt-transport-https ca-certificates gnupg curl
      curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
      echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list
      apt-get update
      apt-get install -y google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin kubectl postgresql-client redis-tools
      curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    EOT
  }
}

resource "google_compute_firewall" "iap_ssh" {
  count = var.enabled ? 1 : 0

  project = var.project
  name    = "${var.name}-bastion-iap-ssh"
  network = var.network_self_link

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["${var.name}-bastion"]
}
