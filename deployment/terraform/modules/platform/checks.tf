locals {
  worker_identity_checked = length(var.identities.worker.annotations) > 0

  workers_without_identity = local.worker_identity_checked ? [
    for w in var.workers : w.name
    if !contains(var.identities.worker.ksa_names, "xyne-worker-${w.name}")
  ] : []
}

resource "terraform_data" "worker_identities" {
  input = local.workers_without_identity

  lifecycle {
    precondition {
      condition     = length(local.workers_without_identity) == 0
      error_message = "workers without a cloud identity: ${join(", ", local.workers_without_identity)}. 01-infra bound ${length(var.identities.worker.ksa_names) == 0 ? "no worker service account at all" : join(", ", var.identities.worker.ksa_names)}, so ${join(", ", [for name in local.workers_without_identity : "xyne-worker-${name}"])} would run with none. Add ${join(", ", local.workers_without_identity)} to worker_names in 01-infra.tfvars and apply 01-infra again before applying 02-platform."
    }
  }
}
