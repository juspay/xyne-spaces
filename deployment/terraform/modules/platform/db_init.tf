locals {
  db_init_enabled = var.postgres.mode == "managed"

  db_init_grant = var.cluster.cloud == "aws" ? "GRANT rds_replication TO CURRENT_USER;" : "ALTER ROLE CURRENT_USER WITH REPLICATION;"

  db_init_databases = distinct(compact([
    var.postgres.databases.common,
    var.postgres.databases.zero_cvr,
    var.postgres.databases.zero_cdb,
    var.postgres.databases.claw_auth,
  ]))

  db_init_script = <<-SH
    set -e
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
    ${local.db_init_grant}
    SELECT format('CREATE DATABASE %I OWNER %I', d, current_user)
    FROM unnest(ARRAY[${join(",", [for d in local.db_init_databases : "'${d}'"])}]) AS d
    WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = d)\gexec
    SQL
  SH
}

resource "kubernetes_job_v1" "db_init" {
  count = local.db_init_enabled ? 1 : 0

  metadata {
    name      = "xyne-db-init"
    namespace = kubernetes_namespace_v1.app.metadata[0].name
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
      "app.kubernetes.io/part-of"    = "xyne-spaces"
    }
  }

  spec {
    backoff_limit = 4

    template {
      metadata {
        annotations = {
          "sidecar.istio.io/inject" = "false"
        }
      }

      spec {
        restart_policy = "Never"

        container {
          name    = "psql"
          image   = var.db_init_image
          command = ["/bin/sh", "-c", local.db_init_script]

          env {
            name = "DATABASE_URL"
            value_from {
              secret_key_ref {
                name = kubernetes_secret_v1.this["xyne-backend-secrets"].metadata[0].name
                key  = "DATABASE_URL"
              }
            }
          }
        }
      }
    }
  }

  wait_for_completion = true

  timeouts {
    create = "10m"
    update = "10m"
  }
}
