terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.20"
    }
  }
}

provider "google" {
  project = var.project
  region  = var.region
}
