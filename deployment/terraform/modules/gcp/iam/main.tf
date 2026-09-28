locals {
  all_buckets = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]

  identities = {
    backend = {
      account_id = "${var.name}-backend"
      ksa_names  = ["xyne-backend"]
      buckets    = { for b in local.all_buckets : b => "roles/storage.objectAdmin" }
    }
    worker = {
      account_id = "${var.name}-worker"
      ksa_names  = [for w in var.worker_names : "xyne-worker-${w}"]
      buckets    = { for b in local.all_buckets : b => "roles/storage.objectAdmin" }
    }
    dashboard_edge = {
      account_id = "${var.name}-dashboard-edge"
      ksa_names  = ["xyne-dashboard-edge"]
      buckets    = { bundles = "roles/storage.objectViewer" }
    }
    ysweet = {
      account_id = "${var.name}-ysweet"
      ksa_names  = ["xyne-ysweet"]
      buckets    = { main = "roles/storage.objectAdmin" }
    }
    claw = {
      account_id = "${var.name}-claw"
      ksa_names  = ["xyne-claw"]
      buckets    = { claw = "roles/storage.objectAdmin" }
    }
    claw_auth = {
      account_id = "${var.name}-claw-auth"
      ksa_names  = ["xyne-claw-auth"]
      buckets    = { claw = "roles/storage.objectAdmin" }
    }
    transcription = {
      account_id = "${var.name}-transcription"
      ksa_names  = ["xyne-transcription-agent"]
      buckets    = { transcription = "roles/storage.objectAdmin" }
    }
  }

  bucket_bindings = merge([
    for identity, spec in local.identities : {
      for bucket, role in spec.buckets : "${identity}:${bucket}" => {
        identity = identity
        bucket   = var.buckets[bucket]
        role     = role
      } if contains(keys(var.buckets), bucket)
    }
  ]...)

  workload_bindings = merge([
    for identity, spec in local.identities : {
      for ksa in spec.ksa_names : "${identity}:${ksa}" => {
        identity = identity
        ksa      = ksa
      }
    }
  ]...)
}

resource "google_service_account" "this" {
  for_each = local.identities

  project      = var.project
  account_id   = each.value.account_id
  display_name = "xyne ${each.key}"
}

resource "google_storage_bucket_iam_member" "this" {
  for_each = local.bucket_bindings

  bucket = each.value.bucket
  role   = each.value.role
  member = google_service_account.this[each.value.identity].member
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each = local.workload_bindings

  service_account_id = google_service_account.this[each.value.identity].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project}.svc.id.goog[${var.namespace}/${each.value.ksa}]"
}

resource "google_service_account_iam_member" "token_creator" {
  for_each = toset([for i in var.signing_identities : i if contains(keys(local.identities), i)])

  service_account_id = google_service_account.this[each.key].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.this[each.key].member
}
