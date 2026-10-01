# On-prem 01-infra creates buckets on an S3-compatible object store and nothing
# else. The cluster, Postgres and Redis already exist; they are described here so
# 02-platform can wire the app to them.
#
# Before applying, the Postgres role named below must already hold REPLICATION
# and CREATEDB, and the server must run with wal_level = logical. The db-init Job
# in 02-platform creates four databases, and Zero replicates logically.

name      = "example"
namespace = "xyne"
domain    = "xyne.example.internal"

cluster_name   = "example-cluster"
cluster_region = "onprem"

# ---------------------------------------------------------------------------
# Object store
#
# Credentials go in 01-infra.secrets.tfvars, not here.
# ---------------------------------------------------------------------------

storage_endpoint      = "https://s3.example.internal:7442"
storage_region        = "default"
storage_bucket_prefix = "example"

# PEM that signed the endpoint's certificate. Leave empty for a publicly
# trusted certificate.
ca_bundle = ""

# Ceph RGW only answers PutBucketEncryption once SSE-S3 is configured on the
# cluster, so leave this off unless the operator confirms it.
storage_encryption = false
storage_versioning = false

# Browser uploads need CORS. Defaults to https://<domain> when unset.
storage_cors_origins = []

# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------

postgres_host = "postgres-rw.xyne.svc.cluster.local"
postgres_ro_host = "postgres-ro.xyne.svc.cluster.local"

# Zero's logical replication must not go through a pooler. Point this at the
# primary directly if one is in front.
postgres_direct_host = "postgres-rw.xyne.svc.cluster.local"

postgres_port     = 5432
postgres_username = "xyne"
postgres_sslmode  = "require"

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

redis_host = "redis.xyne.svc.cluster.local"
redis_port = 6379
redis_tls  = false

# ---------------------------------------------------------------------------
# Ingress
#
# external keeps the Istio gateway on NodePort, so no cloud load balancer is
# required. internal TLS issues certificates from the in-cluster issuer; acme
# cannot work unless the cluster is reachable from the public internet.
# ---------------------------------------------------------------------------

ingress_mode = "external"
ingress_tls  = "internal"
dns_zone     = ""
