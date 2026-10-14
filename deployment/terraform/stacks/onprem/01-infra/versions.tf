terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

# The aws provider talks to Ceph RGW, not AWS. Path-style addressing is required
# because RGW has no wildcard DNS for virtual-host style bucket names.
provider "aws" {
  access_key = var.storage_credentials.access_key_id
  secret_key = var.storage_credentials.secret_access_key
  region     = var.storage_region

  s3_use_path_style           = true
  custom_ca_bundle            = var.ca_bundle != "" ? var.ca_bundle : null
  skip_credentials_validation = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true

  endpoints {
    s3 = var.storage_endpoint
  }
}
