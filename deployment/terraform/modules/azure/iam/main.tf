locals {
  all_buckets = ["main", "docs", "canvas", "recordings", "workflows", "transcription", "bundles", "claw"]

  identities = {
    backend = {
      identity_name = "${var.name}-backend"
      ksa_names     = ["xyne-backend"]
      buckets       = { for b in local.all_buckets : b => "rw" }
    }
    worker = {
      identity_name = "${var.name}-worker"
      ksa_names     = [for w in var.worker_names : "xyne-worker-${w}"]
      buckets       = { for b in local.all_buckets : b => "rw" }
    }
    dashboard_edge = {
      identity_name = "${var.name}-dashboard-edge"
      ksa_names     = ["xyne-dashboard-edge"]
      buckets       = { bundles = "ro" }
    }
    ysweet = {
      identity_name = "${var.name}-ysweet"
      ksa_names     = ["xyne-ysweet"]
      buckets       = { main = "rw" }
    }
    claw = {
      identity_name = "${var.name}-claw"
      ksa_names     = ["xyne-claw"]
      buckets       = { claw = "rw" }
    }
    claw_auth = {
      identity_name = "${var.name}-claw-auth"
      ksa_names     = ["xyne-claw-auth"]
      buckets       = { claw = "rw" }
    }
    transcription = {
      identity_name = "${var.name}-transcription"
      ksa_names     = ["xyne-transcription-agent"]
      buckets       = { transcription = "rw" }
    }
  }

  federated_credentials = merge([
    for identity, spec in local.identities : {
      for ksa in spec.ksa_names : "${identity}:${ksa}" => {
        identity = identity
        ksa      = ksa
      }
    }
  ]...)

  role_names = {
    rw = "Storage Blob Data Contributor"
    ro = "Storage Blob Data Reader"
  }

  bucket_grants = merge([
    for identity, spec in local.identities : {
      for bucket, access in spec.buckets : "${identity}:${bucket}" => {
        identity = identity
        scope    = var.container_ids[bucket]
        role     = local.role_names[access]
      } if contains(keys(var.container_ids), bucket)
    }
  ]...)
}

resource "azurerm_user_assigned_identity" "this" {
  for_each = local.identities

  name                = each.value.identity_name
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = merge(var.tags, { identity = each.key })
}

resource "azurerm_federated_identity_credential" "this" {
  for_each = local.federated_credentials

  name                = each.value.ksa
  resource_group_name = var.resource_group_name
  parent_id           = azurerm_user_assigned_identity.this[each.value.identity].id
  issuer              = var.oidc_issuer_url
  subject             = "system:serviceaccount:${var.namespace}:${each.value.ksa}"
  audience            = ["api://AzureADTokenExchange"]
}

resource "azurerm_role_assignment" "buckets" {
  for_each = local.bucket_grants

  scope                            = each.value.scope
  role_definition_name             = each.value.role
  principal_id                     = azurerm_user_assigned_identity.this[each.value.identity].principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}
