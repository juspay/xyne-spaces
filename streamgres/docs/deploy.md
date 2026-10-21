# Deploying Streamgres

This guide covers running the sync server in production:
- what it needs from PostgreSQL and from your application server
- how to size it
- every setting and its default
- how to route traffic to it, and what to monitor

For a local first run, see the README's Quick start.

## 1. What you need

- **PostgreSQL** with `wal_level = logical`. It can be a primary, a logical
  replica, or a physical standby on PostgreSQL 16+. Section 3 has the details.
- **An application server** with two HTTP endpoints. The *query* endpoint turns
  a query name and its arguments into a query AST. The *mutate* endpoint
  applies a client's mutations. Section 4 has the details.
- **A host or container** with about 2 cores and 4 GiB of memory to start.
  Section 2 has the sizing.

## 2. Image and sizing

### The image

```bash
docker build -f docker/server/Dockerfile -t streamgres .
```

The image is a slim Debian image of about 125 MB:
- It has one binary, `/app/server`, run as the unprivileged user `streamgres`
  (uid 10001).
- It listens on port 4848 and writes JSON log lines to stderr.
- It needs no file system, except an optional writable directory for
  `STREAMGRES_PLAN_FILE` (section 5).

`.github/workflows/docker-publish.yml` publishes the image to the GitHub
Container Registry as `ghcr.io/<owner>/streamgres`. It runs on pushes to the
branches listed in that file and on `v*` tags, tagging each image with the
branch name and the short commit SHA.

### Sizing

| | starting point |
|---|---|
| CPU | 2 cores requested; limit 4 or none |
| memory | 4 GiB requested, 8 GiB limit |
| replicas | 1 |

- **CPU.** The engine runs on one thread that should never wait for a core.
  Load comes in bursts: after a restart, every client re-downloads its data at
  once. A CPU limit that throttles shows up directly as latency, so set it
  generously or not at all. In tests, 300 connections each holding 12 queries
  and opening a new one every 0.75 s used about 0.6 of a core on average.
- **Memory.** It grows with the rows clients hold: about 2 KB per row. Clients
  holding the same row share one copy. A client group's rows are kept for
  `STREAMGRES_GROUP_TTL_MS` after its last connection closes, so memory tracks
  the clients seen within that window, not just the ones connected now.
- **One replica.** State lives in memory. Every tab of one client group has to
  reach the same instance, which nothing routes for yet, so run a single
  replica and replace it on deploys rather than rolling (in Kubernetes,
  `strategy: Recreate`).
- **Restarts are safe but cost a full re-sync.** Clients reconnect, are told
  to start over, and download their data again. Deploy at quiet times.

## 3. PostgreSQL

### Requirements

- **`wal_level = logical`.**
- **Spare replication capacity.** Leave about eight free slots in
  `max_replication_slots` and `max_wal_senders`. Each server uses one slot
  for its change feed, `xyne_sync_slot_<uuid>`, plus short-lived ones,
  `xyne_sync_snap_*`, behind its read snapshots.
- **Spare connections.** Allow about 40 connections:
  `STREAMGRES_READ_CONNECTIONS`, plus the feed, plus a few more.
- **A role** with `REPLICATION` and `SELECT` on the served schemas.
- **A direct connection, not PgBouncer.** Logical replication does not pass
  through PgBouncer.

**The server writes nothing to the database it follows.** It reads rows and
the replication stream. Its position in the stream comes from each commit and
from the keepalives PostgreSQL sends anyway. So `STREAMGRES_PG_DSN` can point
at:
- the primary,
- a logical replica, or
- a physical standby (PostgreSQL 16 or later, the first version that can do
  logical decoding on a standby).

### One-time setup

1. **Create the publication** on the primary. The server checks for it at
   startup and exits if it is missing:

   ```sql
   CREATE PUBLICATION xyne_sync_pub FOR ALL TABLES;  -- needs a superuser
   ```

   The name is set by `STREAMGRES_PUBLICATION`. The publication must include
   your application's mutation-tracking tables (section 4).

2. **Install the schema-change event trigger** on the primary. The server
   refuses to start without it:

   ```bash
   psql "$DATABASE_URL" < scripts/sql/ddl-triggers.sql
   ```

   The checked-in stack is for app `xyne`, shard 0 and publication
   `xyne_sync_pub`. For another app, shard or publication, generate the
   stack with `trigger_stack_sql` in `src/client/ddl_triggers.rs`.

   This creates the event trigger `<app>_ddl_end_<shard>`. During every
   migration, inside the migration's own transaction, it records the published
   schema before and after into the WAL. The server therefore sees each schema
   change at its commit, on any topology. Use the same app id and shard you set
   in `STREAMGRES_APP_ID` and `STREAMGRES_SHARD`.

### Replication slots

- **Each server process creates its own slot** at startup, on the database
  `STREAMGRES_PG_DSN` names. On `SIGTERM` it drops the slot. A restart needs
  nothing from the previous slot.
- **A slot left behind by a crash holds WAL.** Either:
  - set `STREAMGRES_SLOT_CLEANUP_AGE_MS` so the next startup drops inactive
    `xyne_sync_slot_*` slots older than that age (needs PostgreSQL 17+, which
    records `inactive_since`), or
  - drop them by hand: `SELECT pg_drop_replication_slot('<slot name>');`
  - Either way, set `max_slot_wal_keep_size` as a safety net.
- **A process whose slot disappears while it runs stops.** It does not
  silently recreate the slot, which would skip the changes in between. The
  restarted process begins on a fresh slot and snapshot.

### Physical standbys

- A new read snapshot on a standby waits for the primary's next
  running-transactions record. A busy primary writes one every 15 s;
  `SELECT pg_log_standby_snapshot()` on the primary forces one. Until it
  arrives, reads keep using the current snapshot, so the only cost is memory,
  not correctness.
- Set `hot_standby_feedback = on` on the standby, so the primary's vacuum does
  not cancel the snapshots.

### Networking

- **Read snapshots sit on silent connections.** Each read snapshot lives on a
  connection that must stay idle inside a transaction for its whole life,
  because any command would discard the snapshot.
  - TCP keepalive (`STREAMGRES_PG_KEEPALIVE_*`) keeps these connections through
    NATs and load balancers, so keep its idle time below whatever drops silent
    connections on your network.
  - The server turns off `idle_in_transaction_session_timeout` for its own
    sessions.
- **No TLS to PostgreSQL yet.** If your database requires TLS, connect through
  a local proxy, such as the Cloud SQL proxy or a sidecar.

### What is served

- Tables without a primary key are skipped. So are columns of types the wire
  format cannot carry (`bytea`). The startup log lists both.
- Tables with large TOASTed columns need `REPLICA IDENTITY FULL`.

### Schema changes

Two kinds of change are followed while the server runs:
- **a table created** with a primary key, and
- **a column added** with no default or a constant default (`DEFAULT 'x'`,
  `DEFAULT 0`, `DEFAULT true`, `DEFAULT '{}'::jsonb`).

The rows already in memory get the new column, and the new shape is served
from the next snapshot on. Clients are sent nothing for the change.

**Any other change to a served table stops the server**, with one log line
naming the change. That includes dropping or renaming a column or table,
changing a type or key, and adding a column with an expression default such as
`now()`. Once restarted, the server loads the schema as it then is, and every
client starts over. Plan those migrations as a restart.

A client whose schema names a table or column the database does not have yet
is refused with `SchemaVersionNotSupported`. Migrate the database before
shipping a frontend that needs the change.

## 4. The application server

The server sends the client's requests to your application server:

- **Queries.** A client asks for queries by name and arguments. The server
  posts them to `STREAMGRES_QUERY_URL`, forwarding the connection's cookies
  unless `STREAMGRES_FORWARD_COOKIES=false`, and receives query ASTs back.
- **Mutations.** A client's pushes are forwarded unchanged to
  `STREAMGRES_MUTATE_URL`, with the cookies, plus `schema` and `appID`
  parameters.
- **Recording mutations.** In the same transaction as each mutation, your
  application server records the client's last mutation id in
  `<app>_<shard>.clients`. When it refuses a mutation with an application
  error, it records the result in `<app>_<shard>.mutations`. The publication
  must carry both tables: the server reads them from the change feed and
  sends them to the client together with the mutation's rows.
- **Cleanup.** When a client acknowledges its mutation results, the server
  sends the mutate endpoint a cleanup push, so the results table does not grow
  without bound.

## 5. Configuration

Everything is set by environment variables. A `.env` file in the working
directory is read first, and variables already set take precedence.
[`.env.example`](../.env.example) documents each one.

### Required

| variable | meaning |
|---|---|
| `STREAMGRES_PG_DSN` | the PostgreSQL to follow, reached directly (section 3) |
| `STREAMGRES_QUERY_URL` | the application server's query endpoint |
| `STREAMGRES_MUTATE_URL` | the application server's mutate endpoint |

### Set explicitly

These have built-in defaults. Set them anyway, so the deployment does not
depend on what the defaults happen to be:

| variable | example | meaning |
|---|---|---|
| `STREAMGRES_BASE_PATH` | `/sync` | URL path prefix clients connect under. A client's server URL ends in it |
| `STREAMGRES_APP_ID` | `xyne` | app id. With the shard, it names the `<app>_<shard>` schema of the mutation tables, the event trigger and its message prefix |
| `STREAMGRES_SHARD` | `0` | shard number |

### Recommended for production

| variable | suggested | default | why |
|---|---|---|---|
| `STREAMGRES_GROUP_TTL_MS` | `3600000` | `60000` | how long a disconnected client group's state is kept. A client back within it resumes instead of re-downloading everything |
| `STREAMGRES_GROUP_THREADS` | `2` | `1` | threads that build and send updates to clients |
| `STREAMGRES_READ_THREADS` | `4` | `2` | threads that run and decode database reads |
| `STREAMGRES_READ_CONNECTIONS` | `32` | `16` | database connections for reads |
| `STREAMGRES_ROW_LIMIT` | sized to your data | `100000` | the most rows read into memory at once. A larger read is refused, and the query named in logs and metrics |
| `STREAMGRES_PLAN_FILE` | `/var/lib/streamgres/plans.json` | unset | query shapes seen so far, planned again at startup, so the first clients after a restart are fast. Needs a writable volume |
| `STREAMGRES_LOG_FORMAT` | `json` | `text` | already set in the image |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://<collector>:4318` | unset | push metrics (and optionally logs) over OTLP. See [observability](observability.md) |

### All other settings

| variable | default | meaning |
|---|---|---|
| `STREAMGRES_ADDR` | `0.0.0.0:4848` | listen address |
| `STREAMGRES_SCHEMAS` | `public,<app>_<shard>` | schemas whose tables are served |
| `STREAMGRES_PUBLICATION` | `xyne_sync_pub` | the publication the change feed streams |
| `STREAMGRES_DDL_TRIGGER` | `<app>_ddl_end_<shard>` | the schema-change event trigger the server requires |
| `STREAMGRES_DDL_PREFIX` | `<app>/<shard>/ddl` | the prefix of that trigger's messages |
| `STREAMGRES_FORWARD_COOKIES` | `true` | forward the connection's cookies to the application server |
| `STREAMGRES_SNAPSHOT_ROTATION_MS` | `1000` | how often a fresh read snapshot is created |
| `STREAMGRES_SLOT_CLEANUP_AGE_MS` | `0` (off) | at startup, drop inactive slots of ended processes older than this (PostgreSQL 17+) |
| `STREAMGRES_READ_TIMEOUT_MS` | `10000` | longest a database read may take before it is cancelled and its query refused. `0` means no limit |
| `STREAMGRES_BACKEND_TIMEOUT_MS` | `30000` | longest a call to the application server may take. `0` means no limit |
| `STREAMGRES_PG_KEEPALIVE_IDLE_MS`, `_INTERVAL_MS`, `_RETRIES` | `30000`, `10000`, `3` | TCP keepalive on database connections. `0` idle time turns it off |
| `STREAMGRES_JOIN_PREFERRED_SIDE` | `parent` | which side drives a join when both plans cost the same |
| `STREAMGRES_PLAN_QUERY_TTL_MS` | `86400000` | how long one plan is reused for every query of the same name and join shape. `0` plans every query separately |
| `STREAMGRES_PLAN_TTL_MS`, `STREAMGRES_PLAN_CACHE` | `600000`, `10000` | how long refused plans are remembered, and how many plans are kept |
| `STREAMGRES_TRANSFORM_TTL_MS`, `STREAMGRES_TRANSFORM_CACHE` | `60000`, `20000` | how long query ASTs from the application server are cached per user, and how many |
| `STREAMGRES_WARM_START_MS` | `20000` | most time spent re-planning saved query shapes at startup |
| `STREAMGRES_PING_INTERVAL_MS`, `STREAMGRES_CLIENT_TIMEOUT_MS`, `STREAMGRES_PONG_INTERVAL_MS` | `30000`, `45000`, `3000` | connection liveness |
| `STREAMGRES_GROUP_LOG_BYTES` | `262144` | recent updates kept per client group, so a briefly disconnected tab catches up instead of starting over. `0` keeps none |
| `STREAMGRES_MAX_MESSAGE_BYTES` | `16777216` | largest message accepted from a client |
| `STREAMGRES_BYTES_PER_PART` | `768000` | bytes of serialized row changes per message part (750 KiB) |
| `STREAMGRES_LOG` | `info` | `error`, `warn`, `info` or `debug`. `debug` costs throughput |
| `STREAMGRES_SLOW_QUERY_MS` | `1000` | queries and pushes slower than this are logged at `warn` |
| `STREAMGRES_METRICS_INTERVAL_MS` | `10000` | how often process metrics are sampled |
| `STREAMGRES_METRICS_PREFIX` | `xyne_sync` | prefix for exported metric names. Keep the default for existing Grafana dashboards; set `streamgres` to use `streamgres_*` names and update dashboard queries accordingly |
| other `OTEL_*` | | see [observability](observability.md), section 5 |

## 6. Ports, probes and shutdown

- **One port, 4848.** It serves:
  - the WebSocket at `<base path>/sync/v51/connect`
  - `/health`, `/metrics` and `/stats`

  Keep `/metrics` and `/stats` private.
- **Health.** `GET /health` (also `/healthz`, `/readyz`, and each of them
  under the base path) returns `503` until the server is ready. That means
  the change feed has passed the first read snapshot, and the warm start, if
  configured, has run. After that it returns `200`. Use it for both readiness
  and liveness, and allow 60 s for startup.
- **Shutdown.** On `SIGTERM` the server closes client connections spread over
  three seconds, so clients don't all reconnect at once. It then stops the
  feed and drops its slot. All timed phases fit in 25 seconds, so give it a
  grace period of 30 seconds or more (in Kubernetes,
  `terminationGracePeriodSeconds`).
- **The proxy in front:**
  - must pass WebSocket upgrades;
  - must pass the `Sec-WebSocket-Protocol` header, which carries the client's
    first message and can be several kilobytes, so allow 128 KB of request
    headers;
  - should not close idle WebSockets in under 60 s.

## 7. Routing traffic

Clients connect to `<scheme>://<host>/<base path>`.

- **One sync server per path.** Route the base path, for example `/sync`, to
  the server's port 4848. Switching clients to or from another sync server is a
  routing change. The servers don't share state, so a client that moves
  starts a fresh sync on its own.
- **Two servers side by side.** For example, to test a new deployment:
  - give each server its own base path (`STREAMGRES_BASE_PATH`) and route
    each path to its own server;
  - build the client that uses the second path with a different local storage
    key, so the two don't overwrite each other's local data in the browser.

## 8. Monitoring

Metrics are available two ways:
- pushed over OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT`;
- served at `GET /metrics` in Prometheus format.

Logs are JSON lines on stderr. `GET /stats` returns the same figures as JSON,
including refused and heavy queries by name.

[`observability.md`](observability.md) lists every metric, every log event,
and alert rules. Alerts to start with:

| what | rule |
|---|---|
| a query is close to the row limit | `xyne_sync_read_rows_max / xyne_sync_read_row_limit >= 0.8`; `xyne_sync_query_read_rows_max{name,table}` names it |
| a query was refused | `increase(xyne_sync_queries_refused_total[5m]) > 0` |
| the engine thread is nearly saturated | `rate(xyne_sync_engine_busy_seconds_total[5m]) > 0.7` |
| changes reach clients late | p99 of `xyne_sync_end_to_end_seconds` above 0.5 s |
| the feed is behind or silent | p99 of `xyne_sync_feed_lag_seconds` above 5 s, or `xyne_sync_feed_heartbeat_age_seconds > 90` |
| reads are timing out | `increase(xyne_sync_queries_refused_total{reason="read_timeout"}[5m]) > 0` |
| memory | `xyne_sync_process_rss_bytes` above 75 % of the container's limit |
| clients built for a different schema | `increase(xyne_sync_connections_total{event="refused"}[5m]) > 0` |

**Dead connections.** The server recovers a dead feed connection by itself.
After 10 s of silence it asks PostgreSQL whether its slot is still held, and
reopens it if not. PostgreSQL notices a dead peer after `wal_sender_timeout`
(60 s by default; keep it set). The feed alert is for when that doesn't help.
On a standby whose primary writes nothing at all, the heartbeat age grows even
though nothing is wrong.

## 9. Known limits

- **Unsupported queries are refused, not run.** This covers `LIKE`/`ILIKE`,
  `NOT EXISTS`, compound join keys, and any read over `STREAMGRES_ROW_LIMIT`.
  Each one is refused by name, in `/stats.refused_queries` and in the
  `query refused` log event. The client sees that one query fail; the rest of
  the app is unaffected.
- **No history across restarts.** A client that reconnects after a restart
  starts a fresh sync, which drops its unsent mutations.
- **One replica**, with state in memory.
- **No TLS to PostgreSQL** (section 3).
