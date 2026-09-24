data "terraform_remote_state" "infra" {
  backend = "azurerm"

  config = {
    subscription_id      = var.subscription_id
    resource_group_name  = var.state_resource_group_name
    storage_account_name = var.state_storage_account_name
    container_name       = var.state_container_name
    key                  = var.state_key
    use_azuread_auth     = var.state_use_azuread_auth
  }
}

locals {
  infra   = data.terraform_remote_state.infra.outputs
  cluster = local.infra.cluster

  kubelogin_args = concat(
    ["get-token", "--login", var.kubelogin_login, "--server-id", var.aks_aad_server_id],
    var.kubelogin_extra_args,
  )

  kata_repositories = {
    kata-deploy = {
      name      = "kata-deploy"
      url       = "quay.io/kata-containers/kata-deploy-charts"
      type      = "helm"
      enableOCI = "true"
    }
  }

  argocd_base    = var.argocd_values == "" ? {} : yamldecode(var.argocd_values)
  argocd_configs = lookup(local.argocd_base, "configs", {})

  argocd_values = var.enable_sandbox ? yamlencode(merge(
    local.argocd_base,
    {
      configs = merge(
        local.argocd_configs,
        {
          repositories = merge(lookup(local.argocd_configs, "repositories", {}), local.kata_repositories)
        },
      )
    },
  )) : var.argocd_values
}

module "platform" {
  source = "../../../modules/platform"

  cluster             = local.cluster
  postgres            = local.infra.postgres
  postgres_password   = local.infra.postgres_password
  redis               = local.infra.redis
  redis_auth          = local.infra.redis_auth
  storage             = local.infra.storage
  storage_credentials = local.infra.storage_credentials
  identities          = local.infra.identities
  node_pools          = local.infra.node_pools
  ingress             = local.infra.ingress
  livekit             = local.infra.livekit
  livekit_keys        = local.infra.livekit_keys

  namespace                 = var.namespace
  domain                    = var.domain
  repo_url                  = var.repo_url
  chart_revision            = var.chart_revision
  root_revision             = var.root_revision
  image_registry            = var.image_registry
  image_tag                 = var.image_tag
  acme_email                = var.acme_email
  argocd_chart_version      = var.argocd_chart_version
  argocd_apps_chart_version = var.argocd_apps_chart_version
  argocd_namespace          = var.argocd_namespace
  argocd_values             = local.argocd_values
  enable_vespa              = var.enable_vespa
  enable_monitoring         = var.enable_monitoring
  enable_sandbox            = var.enable_sandbox
  enable_hindsight          = var.enable_hindsight
  hindsight                 = var.hindsight
  apps                      = var.apps
  workers                   = var.workers
  addon_values              = var.addon_values
  overlay_sources           = var.overlay_sources
  app_secrets               = var.app_secrets
  extra_secret_data         = var.extra_secret_data
}
