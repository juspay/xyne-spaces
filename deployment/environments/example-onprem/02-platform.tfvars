namespace = "xyne"
domain    = "xyne.example.internal"

# Tag on the `deployments` branch that Argo CD tracks. Bump it to promote a
# release; nothing does this automatically. `git tag --list 'chart-*'` lists them.
chart_revision = "chart-1.418.1"
root_revision  = "main"

argocd_expose = false
argocd_host   = ""

# acme_email is only read when ingress_tls is acme.
acme_email = ""

enable_vespa      = false
enable_monitoring = false
enable_sandbox    = false
enable_hindsight  = false

# Leaving apps empty keeps the root chart's own defaults: backend, dashboard and
# ysweet on, everything else off.
apps    = {}
workers = []
