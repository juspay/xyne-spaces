terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.20"
    }
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

provider "google" {
  project = var.project
  region  = var.region
}

provider "kubernetes" {
  host                   = "https://${local.cluster.endpoint}"
  cluster_ca_certificate = base64decode(local.cluster.ca_certificate)
  token                  = data.google_client_config.current.access_token
}

provider "helm" {
  kubernetes {
    host                   = "https://${local.cluster.endpoint}"
    cluster_ca_certificate = base64decode(local.cluster.ca_certificate)
    token                  = data.google_client_config.current.access_token
  }
}
