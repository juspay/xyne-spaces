terraform {
  required_version = ">= 1.6.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}

# The cloud stacks mint a short-lived token from their provider. On-prem there is
# no such API, so authentication comes from a kubeconfig the operator already has.
provider "kubernetes" {
  config_path    = var.kubeconfig
  config_context = var.kube_context != "" ? var.kube_context : null
}

provider "helm" {
  kubernetes {
    config_path    = var.kubeconfig
    config_context = var.kube_context != "" ? var.kube_context : null
  }
}
