# ---------------------------------------------------------------------------
# Cluster access
#
# The cloud stacks read a token from their provider. On-prem the operator
# supplies a kubeconfig instead.
# ---------------------------------------------------------------------------

variable "kubeconfig" {
  type        = string
  description = "Path to the kubeconfig for the target cluster."
}

variable "kube_context" {
  type        = string
  default     = ""
  description = "Context within the kubeconfig. Empty uses its current-context."
}

# ---------------------------------------------------------------------------
# 01-infra remote state
# ---------------------------------------------------------------------------

variable "state_bucket" {
  type = string
}

variable "state_key" {
  type    = string
  default = "xyne/01-infra/terraform.tfstate"
}

variable "state_region" {
  type    = string
  default = "default"
}

variable "state_endpoint" {
  type        = string
  description = "S3 endpoint holding the state bucket, typically the same Ceph RGW."
}

# ---------------------------------------------------------------------------
# Platform
# ---------------------------------------------------------------------------

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

variable "argocd_expose" {
  type    = bool
  default = false
}

variable "argocd_host" {
  type    = string
  default = ""
}

variable "argocd_values" {
  type    = string
  default = ""
}

# Namespaces the AppProject may deploy into, beyond those derived from the
# built-in addons. Any overlay_sources entry targeting its own namespace needs
# to be listed here or ArgoCD rejects it as an invalid destination.
variable "argocd_extra_destinations" {
  type    = list(string)
  default = []
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
