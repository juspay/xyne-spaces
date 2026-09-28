resource "helm_release" "argocd" {
  name       = "argocd"
  namespace  = kubernetes_namespace_v1.argocd.metadata[0].name
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = var.argocd_chart_version
  timeout    = 900
  wait       = true

  values = compact([
    yamlencode({
      fullnameOverride = "argocd"
      configs = {
        params = {
          "server.insecure" = true
        }
      }
    }),
    var.argocd_values,
  ])
}

resource "helm_release" "root" {
  name       = "xyne-root"
  namespace  = kubernetes_namespace_v1.argocd.metadata[0].name
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argocd-apps"
  version    = var.argocd_apps_chart_version
  timeout    = 300

  values = [
    yamlencode({
      applications = {
        "xyne-root" = {
          namespace = kubernetes_namespace_v1.argocd.metadata[0].name
          project   = "default"
          finalizers = [
            "resources-finalizer.argocd.argoproj.io",
          ]
          source = {
            repoURL        = var.repo_url
            targetRevision = var.root_revision
            path           = "deployment/argocd/root"
            helm = {
              releaseName  = "xyne-root"
              valuesObject = local.root_values
            }
          }
          destination = {
            server    = "https://kubernetes.default.svc"
            namespace = kubernetes_namespace_v1.argocd.metadata[0].name
          }
          syncPolicy = {
            automated = {
              prune    = true
              selfHeal = true
            }
            syncOptions = [
              "CreateNamespace=true",
              "ServerSideApply=true",
            ]
            retry = {
              limit = 10
              backoff = {
                duration    = "30s"
                factor      = 2
                maxDuration = "10m"
              }
            }
          }
        }
      }
    }),
  ]

  depends_on = [
    helm_release.argocd,
    kubernetes_secret_v1.this,
  ]
}
