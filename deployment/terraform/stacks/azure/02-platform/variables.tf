variable "subscription_id" {
  type = string
}

variable "region" {
  type = string
}

variable "state_resource_group_name" {
  type = string
}

variable "state_storage_account_name" {
  type = string
}

variable "state_container_name" {
  type    = string
  default = "tfstate"
}

variable "state_key" {
  type    = string
  default = "xyne/01-infra/terraform.tfstate"
}

variable "state_use_azuread_auth" {
  type    = bool
  default = true
}

variable "kubelogin_login" {
  type    = string
  default = "azurecli"

  validation {
    condition     = contains(["azurecli", "azd", "devicecode", "interactive", "msi", "spn", "workloadidentity"], var.kubelogin_login)
    error_message = "kubelogin_login must be one of azurecli, azd, devicecode, interactive, msi, spn or workloadidentity."
  }
}

variable "kubelogin_extra_args" {
  type    = list(string)
  default = []
}

variable "aks_aad_server_id" {
  type    = string
  default = "6dae42f8-4368-4678-94ff-3960e28e3630"
}

variable "namespace" {
  type    = string
  default = "xyne"
}

variable "domain" {
  type    = string
  default = ""
}

variable "repo_url" {
  type    = string
  default = "https://github.com/juspay/xyne-spaces.git"
}

variable "chart_revision" {
  type = string
}

variable "root_revision" {
  type    = string
  default = "main"
}

variable "image_registry" {
  type    = string
  default = ""
}

variable "image_tag" {
  type    = string
  default = ""
}

variable "acme_email" {
  type    = string
  default = ""
}

variable "argocd_chart_version" {
  type    = string
  default = "10.9.2"
}

variable "argocd_apps_chart_version" {
  type    = string
  default = "2.0.5"
}

variable "argocd_namespace" {
  type    = string
  default = "argocd"
}

variable "argocd_values" {
  type    = string
  default = ""
}

variable "enable_vespa" {
  type    = bool
  default = false
}

variable "enable_monitoring" {
  type    = bool
  default = false
}

variable "enable_sandbox" {
  type    = bool
  default = false
}

variable "enable_hindsight" {
  type    = bool
  default = false
}

variable "hindsight" {
  type = object({
    url    = optional(string, "")
    tenant = optional(string, "default")
  })
  default = {}
}

variable "apps" {
  type = map(object({
    enabled   = optional(bool)
    values    = optional(string, "")
    store_url = optional(string, "")
  }))
  default = {}
}

variable "workers" {
  type = list(object({
    name   = string
    env    = optional(map(string), {})
    values = optional(string, "")
  }))
  default = []
}

variable "addon_values" {
  type    = map(string)
  default = {}
}

variable "overlay_sources" {
  type = list(object({
    name            = string
    repo_url        = string
    target_revision = string
    path            = optional(string, "")
    chart           = optional(string, "")
    chart_version   = optional(string, "")
    namespace       = optional(string, "")
    helm_values     = optional(string, "")
  }))
  default = []
}

variable "app_secrets" {
  type = object({
    jwt_secret                  = string
    zero_auth_secret            = string
    zero_admin_password         = string
    encryption_key              = string
    internal_s2s_key            = string
    claw_s2s_key                = string
    claw_auth_encryption_key    = string
    ysweet_auth                 = string
    ysweet_server_token         = string
    transcription_agent_api_key = string
    litellm_api_key             = optional(string, "")
    hindsight_api_key           = optional(string, "")
    hindsight_llm_api_key       = optional(string, "")
    google_client_id            = optional(string, "")
    google_client_secret        = optional(string, "")
  })
  sensitive = true
}

variable "extra_secret_data" {
  type      = map(map(string))
  sensitive = true
  default   = {}
}
