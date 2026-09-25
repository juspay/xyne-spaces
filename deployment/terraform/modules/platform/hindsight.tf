locals {
  hindsight_llm_key_set = var.app_secrets.hindsight_llm_api_key != ""
  hindsight_secret      = var.enable_hindsight && local.hindsight_llm_key_set
}

resource "kubernetes_namespace_v1" "hindsight" {
  count = local.hindsight_secret ? 1 : 0

  metadata {
    name = var.hindsight_namespace
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }

  lifecycle {
    ignore_changes = [metadata[0].annotations, metadata[0].labels]
  }
}

resource "kubernetes_secret_v1" "hindsight" {
  count = local.hindsight_secret ? 1 : 0

  metadata {
    name      = "hindsight-secrets"
    namespace = kubernetes_namespace_v1.hindsight[0].metadata[0].name
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
      "app.kubernetes.io/part-of"    = "xyne-spaces"
    }
  }

  data = {
    HINDSIGHT_API_LLM_API_KEY = var.app_secrets.hindsight_llm_api_key
  }
}
