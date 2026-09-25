resource "kubernetes_secret_v1" "this" {
  for_each = toset(local.secret_names)

  metadata {
    name      = each.key
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
      "app.kubernetes.io/part-of"    = "xyne-spaces"
    }
  }

  type = lookup(local.secret_types, each.key, "Opaque")

  data = merge(
    local.secret_data[each.key],
    lookup(var.extra_secret_data, each.key, {}),
  )
}
