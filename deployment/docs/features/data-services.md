# Data services: managed, in-cluster or external

Postgres, Redis and object storage each come in three modes, chosen independently in
`01-infra.tfvars`. Whatever you pick, the apps see the same connection shape.

- [The three modes](#the-three-modes)
- [Postgres in the cluster (CloudNativePG)](#postgres-in-the-cluster-cloudnativepg)
- [An external Postgres](#an-external-postgres)
- [Redis in the cluster](#redis-in-the-cluster)
- [MinIO instead of cloud buckets](#minio-instead-of-cloud-buckets)
- [External S3-compatible storage](#external-s3-compatible-storage)
- [Why Zero needs a direct Postgres connection](#why-zero-needs-a-direct-postgres-connection)

## The three modes

| Mode | `01-infra` creates | Argo CD installs | The apps connect to |
|---|---|---|---|
| `managed` (default) | the cloud's service on the private network, the databases, users, buckets and IAM | nothing | the private endpoint; buckets `<prefix>-<key>` through workload identity |
| `incluster` | nothing for that component | CloudNativePG + `pg-cluster`, `xyne-redis`, or MinIO | `xyne-pg-pooler-rw.<ns>.svc`, `xyne-redis.<ns>.svc`, `http://xyne-minio.<ns>.svc:9000` |
| `external` | nothing | nothing | the hosts and buckets you give in `external_*` |

Switching an existing install between modes moves no data.

Bucket names are `<prefix>-<key>` for the keys `main`, `docs`, `canvas`, `recordings`,
`workflows`, `transcription`, `bundles` and `claw`. The prefix defaults to `<project>-<name>` on
GCP, `<account id>-<name>` on AWS and `<name>` on Azure; `storage_bucket_prefix` overrides it and
`storage_bucket_names` overrides single keys.

## Postgres in the cluster (CloudNativePG)

```hcl
# 01-infra.tfvars
postgres_mode = "incluster"

# 02-platform.tfvars, optional
addon_values = {
  cnpg = <<-YAML
    cluster:
      instances: 3
      storage: {size: 100Gi}
      backup:
        enabled: true
        destinationPath: s3://acme-xyne-backups/pg
        credentialsSecret: xyne-pg-backup
        schedule: "0 0 2 * * *"
        retentionPolicy: 30d
  YAML
}
```

Argo CD installs the operator (wave -2) and `pg-cluster` (wave -1): a `Cluster xyne-pg` with
`wal_level=logical`, the five databases, the replication role, and transaction-mode poolers
`xyne-pg-pooler-rw` and `xyne-pg-pooler-ro`. The apps use the poolers; Zero uses `xyne-pg-rw`
directly. `postgres_password` seeds `xyne-pg-app`, and no database-init Job is needed. Backups
need a Secret `xyne-pg-backup` with `ACCESS_KEY_ID` and `ACCESS_SECRET_KEY`, which you create
(or an overlay does). Pick the volume class with `cluster.storage.storageClass`.

## An external Postgres

```hcl
postgres_mode = "external"
external_postgres = {
  host     = "pg.internal.example.com"
  ro_host  = "pg-ro.internal.example.com"
  port     = 5432
  username = "xyne"
  sslmode  = "require"
}
```

The server must be reachable from the cluster network and have `wal_level=logical`, enough
replication slots and WAL senders (10 each is plenty), the five databases (`xyne`, `xyne_common`,
`zero_cvr`, `zero_cdb`, `claw_auth`) and the role with `REPLICATION`.

## Redis in the cluster

```hcl
redis_mode = "incluster"
```

Argo CD installs `helm-charts/charts/xyne-redis` (single node, 10 GiB) as
`xyne-redis.<namespace>.svc:6379`, without TLS; `redis_auth` (written by `secrets.sh`) becomes its
password (`xyne-redis-auth`) and every app's `REDIS_PASSWORD`. LiveKit cannot use it, because
the LiveKit VMs are outside the cluster.

## MinIO instead of cloud buckets

```hcl
storage_mode = "incluster"
```

`secrets.sh` writes `storage_credentials` (the MinIO root user and password). `01-infra` creates
no buckets and no bucket IAM; Argo CD installs the `minio` chart 5.4.0 (standalone, one 200 GiB
volume, buckets `<prefix>-<key>` created at start) as `http://xyne-minio.<namespace>.svc:9000`.
The apps see provider `s3` with `S3_ENDPOINT` set and the credentials as `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` from their Secrets. Size it with `addon_values["minio"]`
(`persistence.size`, `persistence.storageClass`, `resources`).

## External S3-compatible storage

```hcl
storage_mode = "external"
external_storage = {
  provider = "s3"
  endpoint = "https://s3.internal.example.com"
  region   = "ap-south-1"
  buckets = {
    main = "acme-xyne-main", docs = "acme-xyne-docs", canvas = "acme-xyne-canvas",
    recordings = "acme-xyne-recordings", workflows = "acme-xyne-workflows",
    transcription = "acme-xyne-transcription", bundles = "acme-xyne-bundles", claw = "acme-xyne-claw"
  }
}
```

All eight buckets and `storage_credentials` are required; `endpoint = ""` means the cloud's own
S3. `provider = "gcs"` points at existing Cloud Storage buckets, whose IAM for the app identities
you grant yourself. `provider = "azure"` points at existing Blob containers: set `account` (the
storage account name, which reaches the apps as `AZURE_STORAGE_ACCOUNT`) or `endpoint`, and grant
the identities the container roles yourself; `storage_credentials` stay a required input, but the
Azure adapter does not read them.

## Why Zero needs a direct Postgres connection

Zero's replication manager (`xyne-zero-replication`) subscribes to Postgres changes over a
logical replication slot and streams them to the view-syncers (`xyne-zero`). Two things follow:

1. **The server must allow it.** Every managed module turns logical replication on, and the
   `xyne-db-init` Job gives the application role `REPLICATION`, which managed services do not
   grant through their APIs. CloudNativePG does both itself.
2. **The connection must not go through a pooler**, which cannot carry replication. The contract
   exposes `postgres.direct_host`, equal to `host` except in `incluster` mode, where it is
   `xyne-pg-rw.<namespace>.svc` instead of the pooler. The `ZERO_*_DB` URLs always use it.

`postgres_read_replica = true` gives the apps a real read replica through
`DATABASE_READ_REPLICA_POOL_URL`.
