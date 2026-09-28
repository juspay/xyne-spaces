locals {
  gateway_tls_supplied = var.gateway_tls.cert_pem != "" && var.gateway_tls.key_pem != ""
  gateway_tls_managed  = var.ingress.tls == "existing"
}

resource "terraform_data" "gateway_tls" {
  input = local.gateway_tls_managed

  lifecycle {
    precondition {
      condition     = !local.gateway_tls_managed || local.gateway_tls_supplied
      error_message = "ingress.tls is \"existing\", so gateway_tls.cert_pem and gateway_tls.key_pem must both be set."
    }

    precondition {
      condition     = local.gateway_tls_managed || !local.gateway_tls_supplied
      error_message = "gateway_tls is set but ingress.tls is not \"existing\"; cert-manager would overwrite the secret."
    }
  }
}

resource "kubernetes_namespace_v1" "gateway" {
  count = local.gateway_tls_managed ? 1 : 0

  metadata {
    name = var.gateway_namespace
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }

  lifecycle {
    ignore_changes = [metadata[0].annotations, metadata[0].labels]
  }
}

resource "kubernetes_secret_v1" "gateway_tls" {
  count = local.gateway_tls_managed ? 1 : 0

  metadata {
    name      = var.ingress.tls_secret
    namespace = kubernetes_namespace_v1.gateway[0].metadata[0].name
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
      "app.kubernetes.io/part-of"    = "xyne-spaces"
    }
  }

  type = "kubernetes.io/tls"

  data = {
    "tls.crt" = var.gateway_tls.cert_pem
    "tls.key" = var.gateway_tls.key_pem
  }

  depends_on = [terraform_data.gateway_tls]
}
