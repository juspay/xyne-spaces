resource "kubernetes_namespace_v1" "app" {
  metadata {
    name = var.namespace
    labels = {
      "istio-injection"              = "enabled"
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }

  lifecycle {
    ignore_changes = [metadata[0].annotations]
  }
}

resource "kubernetes_namespace_v1" "argocd" {
  metadata {
    name = var.argocd_namespace
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }

  lifecycle {
    ignore_changes = [metadata[0].annotations]
  }
}
