locals {
  enable_private_endpoint = var.enable_private_endpoint || length(var.master_authorized_networks) == 0

  pool_fixed = {
    general = {
      image_type            = "COS_CONTAINERD"
      taints                = []
      nested_virtualization = false
      local_ssd_count       = 0
    }
    zero = {
      image_type = "COS_CONTAINERD"
      taints = [
        { key = "storage-type", value = "local-ssd", effect = "NO_SCHEDULE" },
      ]
      nested_virtualization = false
      local_ssd_count       = var.node_pools.zero.local_ssd_count
    }
    vespa = {
      image_type = "COS_CONTAINERD"
      taints = [
        { key = "pool", value = "vespa", effect = "NO_SCHEDULE" },
      ]
      nested_virtualization = false
      local_ssd_count       = 0
    }
    sandbox = {
      image_type = "UBUNTU_CONTAINERD"
      taints = [
        { key = "workload", value = "sandbox", effect = "NO_SCHEDULE" },
      ]
      nested_virtualization = true
      local_ssd_count       = 0
    }
  }

  pools = {
    for key, fixed in local.pool_fixed : key => merge(
      {
        enabled      = var.node_pools[key].enabled
        machine_type = var.node_pools[key].machine_type
        min_count    = var.node_pools[key].min_count
        max_count    = var.node_pools[key].max_count
        disk_size_gb = var.node_pools[key].disk_size_gb
        disk_type    = var.node_pools[key].disk_type
        spot         = var.node_pools[key].spot
        labels       = merge(var.node_pools[key].labels, { pool = key })
      },
      fixed,
    )
  }

  enabled_pools = { for key, pool in local.pools : key => pool if pool.enabled }

  node_roles = [
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/artifactregistry.reader",
  ]

  node_role_bindings = {
    for pair in setproduct(keys(local.enabled_pools), local.node_roles) :
    "${pair[0]}:${pair[1]}" => { pool = pair[0], role = pair[1] }
  }

  effect_names = {
    NO_SCHEDULE        = "NoSchedule"
    PREFER_NO_SCHEDULE = "PreferNoSchedule"
    NO_EXECUTE         = "NoExecute"
  }
}

resource "google_service_account" "nodes" {
  for_each = local.enabled_pools

  project      = var.project
  account_id   = "${var.name}-${each.key}-nodes"
  display_name = "GKE ${var.name} ${each.key} node pool"
}

resource "google_project_iam_member" "nodes" {
  for_each = local.node_role_bindings

  project = var.project
  role    = each.value.role
  member  = google_service_account.nodes[each.value.pool].member
}

resource "google_container_cluster" "this" {
  name     = var.name
  project  = var.project
  location = var.region

  node_locations = length(var.node_locations) > 0 ? var.node_locations : null

  network    = var.network
  subnetwork = var.subnetwork

  networking_mode   = "VPC_NATIVE"
  datapath_provider = "ADVANCED_DATAPATH"

  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = var.deletion_protection
  enable_shielded_nodes    = true
  min_master_version       = var.kubernetes_version != "" ? var.kubernetes_version : null
  resource_labels          = var.labels

  release_channel {
    channel = var.release_channel
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = var.pods_range_name
    services_secondary_range_name = var.services_range_name
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = local.enable_private_endpoint
    master_ipv4_cidr_block  = var.master_ipv4_cidr_block

    master_global_access_config {
      enabled = true
    }
  }

  dynamic "master_authorized_networks_config" {
    for_each = [1]
    content {
      dynamic "cidr_blocks" {
        for_each = var.master_authorized_networks
        content {
          cidr_block   = cidr_blocks.value.cidr_block
          display_name = cidr_blocks.value.display_name
        }
      }
    }
  }

  workload_identity_config {
    workload_pool = "${var.project}.svc.id.goog"
  }

  logging_config {
    enable_components = var.logging_enabled ? ["SYSTEM_COMPONENTS", "WORKLOADS"] : []
  }

  monitoring_config {
    enable_components = var.monitoring_enabled ? ["SYSTEM_COMPONENTS"] : []

    managed_prometheus {
      enabled = var.monitoring_enabled
    }
  }

  maintenance_policy {
    recurring_window {
      start_time = var.maintenance_window.start_time
      end_time   = var.maintenance_window.end_time
      recurrence = var.maintenance_window.recurrence
    }
  }

  addons_config {
    http_load_balancing {
      disabled = false
    }

    horizontal_pod_autoscaling {
      disabled = false
    }

    gce_persistent_disk_csi_driver_config {
      enabled = true
    }
  }

  vertical_pod_autoscaling {
    enabled = false
  }

  lifecycle {
    ignore_changes = [node_config, initial_node_count]

    precondition {
      condition     = var.enable_private_endpoint || length(var.master_authorized_networks) > 0
      error_message = "master_authorized_networks is empty, so the control plane would have no public endpoint and kubectl would only work from inside the VPC. List the networks allowed to reach it, or set enable_private_endpoint = true to confirm that is what you want."
    }
  }
}

resource "google_container_node_pool" "this" {
  for_each = local.enabled_pools

  name     = each.key
  project  = var.project
  location = var.region
  cluster  = google_container_cluster.this.name

  node_locations = length(var.node_locations) > 0 ? var.node_locations : null

  autoscaling {
    total_min_node_count = each.value.min_count
    total_max_node_count = each.value.max_count
    location_policy      = "BALANCED"
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  upgrade_settings {
    strategy        = "SURGE"
    max_surge       = 1
    max_unavailable = 0
  }

  node_config {
    machine_type    = each.value.machine_type
    disk_size_gb    = each.value.disk_size_gb
    disk_type       = each.value.disk_type
    image_type      = each.value.image_type
    spot            = each.value.spot
    labels          = each.value.labels
    tags            = ["${var.name}-node", "${var.name}-${each.key}-node"]
    service_account = google_service_account.nodes[each.key].email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    metadata = {
      disable-legacy-endpoints = "true"
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    shielded_instance_config {
      enable_secure_boot          = !each.value.nested_virtualization
      enable_integrity_monitoring = true
    }

    dynamic "taint" {
      for_each = each.value.taints
      content {
        key    = taint.value.key
        value  = taint.value.value
        effect = taint.value.effect
      }
    }

    dynamic "advanced_machine_features" {
      for_each = each.value.nested_virtualization ? [1] : []
      content {
        threads_per_core             = 0
        enable_nested_virtualization = true
      }
    }

    dynamic "local_nvme_ssd_block_config" {
      for_each = each.value.local_ssd_count > 0 ? [1] : []
      content {
        local_ssd_count = each.value.local_ssd_count
      }
    }
  }

  lifecycle {
    ignore_changes = [node_config[0].resource_labels]
  }
}
