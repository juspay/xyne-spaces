# Observability: what the server measures and logs, and how it stays out of the way

The server serves three kinds of work, and the question for each is the
same: how much of its time is ours (compute), how much is someone else's
(the application server, PostgreSQL, the network), how much work went
through, and what it holds. This document is the catalogue of what is
measured and logged, the way it is recorded without slowing the threads
that do the work, and how to read it.

## 1. The shape

|  | compute (ours) | IO (theirs) | counts | rows |
| --- | --- | --- | --- | --- |
| **select**: transform | – | the application server's round trip | asked, served from cache, errored | – |
| **select**: plan | the decision | the counts on PostgreSQL | from cache, counted, refused | – |
| **select**: IVM | register step, landing step, release step | the read's round trip | reads issued, landed, refused, served by a twin | rows per read, rows held |
| **select**: client | flush, socket write | – | pokes, frames | rows serialized, rows shared |
| **update**: feed | decoding a transaction | commit → arrival (replication lag) | transactions, writes | – |
| **update**: IVM | the engine's step | waiting for the engine (inbox) | subscriptions impacted, narrowed reads | client updates |
| **update**: client | flush, socket write | – | pokes | rows serialized |
| **mutation** | – | the push's round trip; push → acknowledgement | pushes ok / failed, results, cleanups | – |
| **memory** | | | connections, groups, clients, subscriptions, trees, caches | rows held per table, RSS |

Every cell is a metric below; the rows of the table are the labels.

## 2. How it is recorded

- **Metrics are atomics.** A histogram is 257 `AtomicU64` buckets (four
  per power of two) plus count, sum and max: one `fetch_add` per sample,
  no lock, no allocation, on whichever thread does the work. Counters are
  one `fetch_add`. Gauges are stores. Nothing on the engine, group, read
  or feed threads waits for anything to be observed.
- **Reading is elsewhere.** `/stats` (JSON, the load harness's format),
  `/metrics` (Prometheus exposition, for scraping) and the periodic
  summary line are rendered on the request task or the metrics thread
  from the atomics; percentiles are computed at read time.
- **Sampling is a thread.** `streamgres-metrics` wakes every
  `STREAMGRES_METRICS_INTERVAL_MS` (10 s), reads what only sampling can
  give (the process's resident set, each thread's CPU time by name from
  `/proc`, the queues' depths, the caches' sizes) into gauges, and every
  sixth wake-up writes the summary line.
- **Logs are a queue and a thread.** A log call checks its level first
  (a load of one atomic), formats only if enabled, and hands the line to
  a bounded queue; `streamgres-log` drains the queue to stderr in
  batches. A full queue drops the line and counts the drop; the count is
  a metric and appears in the summary, so a flood is visible without
  ever blocking the thread that logged. Format is `text` or `json`
  (`STREAMGRES_LOG_FORMAT`); every line carries its time, level, the
  thread that wrote it and, for structured events, its fields.
- **One catalogue, two carriers.** The measurements are listed once
  (`Stats::metrics`, `src/metric.rs`) and written out as Prometheus text
  for whoever scrapes `/metrics`, and as OTLP for the collector the
  server pushes to: the same names, labels and values either way.
- **Pushing is a thread, configured as the reference server's is.** `streamgres-otel`
  (`src/otel.rs`) reads the standard `OTEL_*` variables the reference server reads
  (section 5): every `OTEL_METRIC_EXPORT_INTERVAL` it posts the catalogue
  to the collector over OTLP/HTTP as JSON, the reference server's own default
  protocol, as cumulative sums, gauges and explicit-bounds histograms;
  and when the logs exporter is on, the log thread hands every line it
  has written to a bounded queue the exporter drains in batches, beside
  stderr, as the reference server tees its log. A collector that is slow or gone
  costs a dropped batch, a counted failure and one warn line a minute,
  never a wait on a thread that serves clients. Traces are not produced.

## 3. The metrics

Names as `/metrics` exposes them (`/stats` has the same numbers under the
older names); durations are histograms in seconds with `_bucket`, `_sum`
and `_count`; counts are `_total` counters; the rest are gauges.
The names below use the default `xyne_sync` prefix for compatibility with
existing dashboards. Set `STREAMGRES_METRICS_PREFIX` to another Prometheus
name prefix (for example, `streamgres`) to rename all exported series in both
Prometheus and OTLP. A custom prefix requires updating Grafana queries to use
that prefix; leaving it unset preserves existing dashboards. The `/stats`
JSON field names are unchanged by this setting.

### Select

| metric | what |
| --- | --- |
| `xyne_sync_transform_seconds` | one round trip to the application server for a desired-queries change's ASTs (IO) |
| `xyne_sync_transforms_total{result=hit,miss,error}` | queries answered from the transform cache, sent to the application server, errored there |
| `xyne_sync_plan_seconds` | translating and planning one query (a cache hit is microseconds) |
| `xyne_sync_count_seconds` | one planner count on PostgreSQL (IO) |
| `xyne_sync_hydrate_seconds{kind=cold,warm}` | registration sent → rows present, per query; cold read storage, warm was served from held frames |
| `xyne_sync_engine_step_seconds{step=register,land,unregister}` | the engine's own compute per step |
| `xyne_sync_read_seconds` | a storage read from issue to its rows back on the engine thread (queue + PostgreSQL + decode) |
| `xyne_sync_read_rows` | rows per storage read (histogram over counts) |
| `xyne_sync_read_row_limit` | the most rows one storage read may return, and the planner reads whole, as configured (`STREAMGRES_ROW_LIMIT`) |
| `xyne_sync_read_rows_max` | the largest storage read of the last minute or two (a window closed every minute, the one before kept), so the ratio to the limit is one division |
| `xyne_sync_reads_near_limit_total{over=50,80}` | storage reads that returned at least half, and at least four fifths, of the row limit; exact, where the histogram's bounds are coarse |
| `xyne_sync_query_read_rows_max{name,table}`, `xyne_sync_query_heavy_reads_total{name}` | per query name, for queries whose subscriptions waited on a read of at least half the limit: the largest such read with its table, and how many; at most 256 names, also `/stats.heavy_queries` |
| `xyne_sync_reads_total{outcome=issued,landed,refused,shared}` | storage reads, and registrations served from a twin without one |
| `xyne_sync_subscriptions`, `xyne_sync_trees` | what the engine holds |
| `xyne_sync_queries_refused_total{reason=unsupported,plan_limit,read_limit,read_timeout,other}` | queries the server refused, by why: the translation cannot express it (`LIKE`, `NOT EXISTS`), the planner found no side of a join small enough to read, a read came back over the row limit, a read or a count ran past `STREAMGRES_READ_TIMEOUT_MS`, anything else |
| `xyne_sync_plans_total{kind=page_drives}` | plans in which a node with a `LIMIT` drives an inner edge (the page is kept to the rows the edge admits) |
| `xyne_sync_page_rows_rejected_total`, `xyne_sync_pages_capped_total` | rows a join gate rejected inside a page (dropped by a page read in batches, kept apart by one read whole); pages that stopped reaching further after ten rounds without filling |
| `xyne_sync_page_rounds_total`, `xyne_sync_page_lookups_total` | rounds pages took past their first batch, each a batch twice the last (a read from the frontier, or a promotion from the rows a page read whole holds); reads pages asked for of one join value they had dropped, because a write on the driven side concerned it |
| `xyne_sync_queries_short_total{reason=page_capped}` | subscriptions served a page short of its limit because it was capped |
| `xyne_sync_window_refills_total` | refill reads asked for by drained windows |

### Update

| metric | what |
| --- | --- |
| `xyne_sync_feed_decode_seconds` | the feed thread decoding one transaction (compute) |
| `xyne_sync_feed_lag_seconds` | PostgreSQL's commit time → the engine taking the transaction up (replication + queue) |
| `xyne_sync_feed_to_engine_seconds` | decoded → taken up by the engine (the inbox's wait) |
| `xyne_sync_engine_step_seconds{step=write}` | routing one transaction |
| `xyne_sync_engine_to_groups_seconds`, `xyne_sync_groups_flush_seconds`, `xyne_sync_groups_to_socket_seconds`, `xyne_sync_end_to_end_seconds` | the client side's stages and the whole path inside the server |
| `xyne_sync_feed_transactions_total`, `xyne_sync_feed_writes_total` | what came through the feed |
| `xyne_sync_writes_impacting_total`, `xyne_sync_client_updates_total{op=add,delete}`, `xyne_sync_narrowed_reads_total` | routing counters |
| `xyne_sync_pokes_total`, `xyne_sync_frames_total`, `xyne_sync_rows_serialized_total`, `xyne_sync_rows_shared_total` | the client side's output |
| `xyne_sync_partial_images_total`, `xyne_sync_partial_rows_sent_total` | update images the feed decoded with a large value left out (PostgreSQL sent it as unchanged); such images that reached a client as a row, which should stay 0, since the engine completes them or reads the row again |
| `xyne_sync_row_reads_total`, `xyne_sync_rows_completed_total` | rows read again by primary key because the only image at hand was partial; partial images completed from a read's row while it was brought up |
| `xyne_sync_feed_lsn`, `xyne_sync_feed_heartbeat_age_seconds` | where the feed is, and how long since PostgreSQL was last heard on the replication connection (a transaction, or a keepalive saying how far its log has been gone through; nothing is written to the database to be heard). On a primary the read snapshots alone keep it under their rotation |
| `xyne_sync_engine_inbox`, `xyne_sync_groups_inbox{shard}` | queue depths, sampled |

### Mutation

| metric | what |
| --- | --- |
| `xyne_sync_push_seconds` | the application server's push round trip (IO) |
| `xyne_sync_pushes_total{result=ok,failed}` | pushes forwarded and their outcome |
| `xyne_sync_mutation_ack_seconds` | push → the `lastMutationIDChanges` poke that acknowledges it to the client (the commit's way back through PostgreSQL, the feed and the engine) |
| `xyne_sync_mutation_results_total` | results of refused mutations recorded in, or cleaned up from, `<app>_<shard>.mutations`, taken by a client group held here for its next poke's `mutationsPatch` |
| `xyne_sync_mutation_cleanups_total` | cleanup-results pushes the application server accepted, sent when a client acknowledged its results or clients were deleted (a refusal is a `WARN` log line) |

### Memory and process

| metric | what |
| --- | --- |
| `xyne_sync_process_rss_bytes` | resident set, sampled |
| `xyne_sync_thread_cpu_seconds_total{thread}` | CPU by thread name (engine, groups, reads, server, feed, reaper, log, metrics), sampled; the engine's rate is its utilisation |
| `xyne_sync_core_cpu_seconds_total{core}` | CPU by core: each thread's time since the last sample attributed to the core it was sampled on (`processor` in `/proc`); a core's rate is the process's use of that core. A thread that moves cores inside an interval is charged to the core it ended on, so a shorter `STREAMGRES_METRICS_INTERVAL_MS` sharpens it |
| `xyne_sync_thread_core_cpu_seconds_total{thread,core}` | the same seconds kept by thread name and core, so which thread burned a core is known; sums over `thread` to `xyne_sync_core_cpu_seconds_total`. Cardinality is threads × cores the node exposes (about 8 × 8 on a prod pod) |
| `xyne_sync_thread_core{thread,tid}` | the core each thread was on at the last sample (a pool's threads told apart by `tid`); a snapshot, not a history |
| `xyne_sync_thread_migrations_total{thread}` | moves between cores by thread name since the sampler started (`se.nr_migrations` in `/proc/<tid>/sched`, summed over a pool's threads, absent where the kernel does not count them); the honesty check for the two above: a thread that moves many times an interval has its time smeared across cores, so read its per-core split with that rate in mind |
| `xyne_sync_rows_held{table}` | rows in the shared frames per table |
| `xyne_sync_connects_total{owed=nothing,state,log,start_over}` | connections by what they were owed since their cookie: nothing (the usual reconnect: a group with no connection stands still), the group's whole state (a tab without a cookie joining a group under way), the logged pokes after an older cookie, or told to start over and sync afresh; `start_over` climbing is clients paying a full download |
| `xyne_sync_connections_open`, `xyne_sync_connections_total{event=opened,closed,refused}` | sockets; `event="refused",reason="client_schema"` counts clients whose schema the server cannot serve, which climbs when a client build is deployed ahead of its database |
| `xyne_sync_client_groups`, `xyne_sync_clients` | what the group threads hold |
| `xyne_sync_plan_cache_entries`, `xyne_sync_transform_cache_entries`, `xyne_sync_warm_shapes` | the caches |
| `xyne_sync_log_dropped_total` | lines the log queue refused |
| `xyne_sync_uptime_seconds` | since start |

## 4. The logs

Text: `HH:MM:SS.mmm LEVEL [thread] message key=value ...`. JSON: one
object per line, `{"ts","level","thread","msg", ...fields}`.

| event | level | fields |
| --- | --- | --- |
| server up, feed connected, ready, warm start, drain | info | address, slot, position, shapes planned |
| connection opened / closed | info | wsid, group, client, whether authenticated, origin; on close: seconds open and the close reason (client, error, server) |
| client told to start over | info | wsid, group, the cookie it offered and why it cannot be caught up from it (no state for the group, a cookie the log no longer reaches, a cookie this server never wrote); the client drops its store and syncs afresh |
| connection caught up from the group's state / from the group's log | info | wsid, group, the cookies it went from and to, and the rows and queries, or the pokes, it was sent: a tab that joined a group under way without a cookie, or returned behind it |
| connection refused | warn | wsid, group, client, kind (`SchemaVersionNotSupported`), how many mismatches and the first three: the client's schema names a table, column, column type or primary key the server cannot serve, and the client was told so and closed, as the reference server does (what the server has beyond the client's schema is no mismatch) |
| heavy read | info, warn from 80 % | name, hash, group, table, rows, limit, percent: a read the query waited on returned at least half the row limit; once per read, under the query that waited on it |
| telemetry export started / failed | info / warn, at most once a minute | the endpoints and the interval; the signal, the error and the failures so far |
| query hydrated | debug | group, name, hash, kind (cold or warm), ms from registration to rows present |
| slow query | warn | the same, when hydration exceeds `STREAMGRES_SLOW_QUERY_MS` (1 000) |
| query refused | warn | name, hash, kind (`unsupported`, `plan_limit`, `read_limit`, `read_timeout`, `other`), at (`plan`: before it registered; `read`: a read it depended on), group, connection, the reason in full |
| query planned | debug | name, the root's table, whether a page drives an inner edge, ms |
| page capped | warn | name, hash, group: a page of the query stopped reaching past the rows its join rejects; it is served, short of its limit |
| transaction routed | debug | position, writes, client updates, reads asked, ms |
| feed lag | warn | when commit → engine exceeds 5 s, once per minute |
| change feed silent, connection given up / dropped, reopening the slot | warn | nothing heard for 10 s and PostgreSQL says no walsender holds the slot any more: the connection died without either end being told; the slot is reopened and resumes after the last confirmed position |
| read past its time | warn | what ran (a read on a table, a count, a statement) and the limit; the query that needed it is refused with `kind=read_timeout` |
| push forwarded | debug (warn when failed or slower than the slow threshold) | wsid, group, mutations, ms, failed |
| summary | info, every minute | connections, groups, clients, subscriptions, rows held, RSS, engine busy %, feed lag, transform and plan hit rates, registrations/s, transactions/s, pokes/s, queries refused and page rows rejected since the last line, log drops |

**The queries to rewrite.** `/stats` carries `refused_queries`: every
query *name* the server has refused since it started, most refused first,
with its class, how often, when last, and the last reason in full (the
first 256 names; the counters count the rest); a query served with a
capped page is listed there too, as `page_capped`. A query that is
refused is one the application should not be asking as written: a whole
knowledge base with every file in it to show a count, a search by
`LIKE` over a JSON text. The list is the application's to-do, read from
the server that pays for the queries.

The reference server's equivalents, for whoever reads both: its `slow hydrate`
warnings (its slow-hydrate threshold), its sync, replication and server
OpenTelemetry instruments, and its
JSON log with `component` and `worker` fields map onto the rows above.

## 5. Configuration

| variable | default | meaning |
| --- | --- | --- |
| `STREAMGRES_LOG` | `info` | level |
| `STREAMGRES_LOG_FORMAT` | `text` | `text` or `json` |
| `STREAMGRES_SLOW_QUERY_MS` | `1000` | a query hydrating slower than this is logged at warn |
| `STREAMGRES_METRICS_INTERVAL_MS` | `10000` | the sampler's period; the summary line every sixth sample; `0` turns the sampler off |

The push to a collector is configured by the variables the reference server is
configured by, read as it and the OpenTelemetry specification read them;
the sandbox's block for the reference server works unchanged:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_TRACES_EXPORTER=none
OTEL_METRIC_EXPORT_INTERVAL=5000
```

| variable | default | meaning |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | the collector's OTLP/HTTP base URL; `/v1/metrics` and `/v1/logs` are appended. Setting it turns both signals on |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | unset | one signal's full URL, used as it is; setting one turns that signal on |
| `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | `otlp` once anything above is set | `otlp` or `none`; setting one to `otlp` with no endpoint sends to `http://localhost:4318` |
| `OTEL_TRACES_EXPORTER` | | accepted and ignored: no traces are produced |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json` | what is spoken is OTLP/HTTP with JSON, whatever is asked; a collector's HTTP receiver takes JSON and protobuf on the same port, and `grpc` is answered with a note at startup |
| `OTEL_EXPORTER_OTLP_HEADERS` (and `_METRICS_HEADERS`, `_LOGS_HEADERS`) | none | `k=v,k=v`, values percent-decoded: a tenant or an authorization header |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | `10000` | one request's time limit, ms |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | the metrics period, ms (the sandbox runs the reference server at 5000) |
| `OTEL_BLRP_SCHEDULE_DELAY`, `OTEL_BLRP_MAX_EXPORT_BATCH_SIZE`, `OTEL_BLRP_MAX_QUEUE_SIZE` | `1000`, `512`, `2048` | the log batch: its longest wait, its size, and the queue past which records are dropped and counted |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | `streamgres`, none | the resource; `service.version` (the crate's, with the image's `SOURCE_COMMIT`) and `service.instance.id` / `host.name` (from `HOSTNAME`, the pod) are added |
| `OTEL_SDK_DISABLED` | `false` | `true` turns the push off whatever else is set |

The exporter reports on itself: `xyne_sync_otel_metric_exports_total`,
`xyne_sync_otel_log_exports_total`, `xyne_sync_otel_export_failures_total`
and `xyne_sync_otel_logs_dropped_total`, and the events
`telemetry export started` and `telemetry export failed`.

### Alerts worth having

```
# A query is within a fifth of the read limit: narrow it before it is refused.
xyne_sync_read_rows_max / xyne_sync_read_row_limit >= 0.8
increase(xyne_sync_reads_near_limit_total{over="80"}[5m]) > 0
# Which one: the label names it; the `heavy read` log event has the hash and the group.
max by (name, table) (xyne_sync_query_read_rows_max) / scalar(xyne_sync_read_row_limit) >= 0.8
# A query was refused outright.
increase(xyne_sync_queries_refused_total[5m]) > 0
# The engine thread, the one that does not scale out, is running out of core.
rate(xyne_sync_engine_busy_seconds_total[5m]) > 0.7
# Writes reach clients late.
histogram_quantile(0.99, sum by (le) (rate(xyne_sync_end_to_end_seconds_bucket[5m]))) > 0.5
# The feed is behind PostgreSQL, or silent.
histogram_quantile(0.99, sum by (le) (rate(xyne_sync_feed_lag_seconds_bucket[5m]))) > 5
xyne_sync_feed_heartbeat_age_seconds > 90
# Storage reads are running past the read timeout.
increase(xyne_sync_queries_refused_total{reason="read_timeout"}[5m]) > 0
# Memory against the container's limit (set the number to 75 % of it).
xyne_sync_process_rss_bytes > 6e9
# Clients built for another database are being turned away.
increase(xyne_sync_connections_total{event="refused"}[5m]) > 0
```

## 6. What it costs, measured

### Locally (Apple M4 Max, the server over the wire, `scripts/load-sweep.sh`)

The same sweep as the paper's table of 2026-09-18 (200 protocol
clients holding the chat screen's queries, rows committed straight into
PostgreSQL), on the observability build with JSON logs on and the
sampler at its default; raw results in
`paper/load-2026-09-19/sweep-observability/`.

| shape | rows/s | delivery p50 / p99 (ms) | server end to end p50 / p99 (ms) | cores | 2026-09-18: p50 / p99 / server / cores |
| --- | --- | --- | --- | --- | --- |
| one channel | 200 | 22 / 26 | 2.6 / 4.1 | 0.30 | 28 / 35 / 4.1 / 0.38 |
| one channel | 400 | 26 / 31 | 5.1 / 7.2 | 0.50 | 36 / 68 / 7.2 / 0.65 |
| one channel | 800 | 28 / 35 | 6.1 / 8.2 | 0.40 | 30 / 37 / 5.1 / 0.95 (at 40 tx/s) |
| twenty channels | 1 000 | 22 / 26 | 1.5 / 2.0 | 0.17 | 29 / 36 / 2.6 / 0.21 |
| twenty channels | 4 000 | 32 / 37 | 5.1 / 6.1 | 0.51 | 43 / 50 / 7.2 / 0.67 |
| twenty channels | 8 000 | 45 / 56 | 8.2 / 10.2 | 0.98 | 94 / 129 / 20.5 / 1.68 (at 7 400) |

Hydration of 200 / 400 / 800 clients: 136 / 211 / 408 ms at the median.
Nothing got slower; the day's engine fixes made most of it faster. The
800-row one-channel run delivered two thirds of its rows inside the
window for the same reason as on the rig: the single Node driver parsing
160 000 rows a second, with the server's own path at 6 ms.

During the sweep the log wrote 1 840 connection-opened and 1 632
connection-closed lines (all closed by the client), zero slow-query
warnings, and dropped nothing; the gauges read 208 sockets open (200
subscribers and 8 writers), 208 groups, 492 MB resident.

### On the rig (the production-shaped database, `prod-scale-2026-09-19.md`'s setup)

The same hot ladder as section 3 of that report, seed 7 so the queries
and arguments repeat this morning's runs, with JSON logs on and the
sampler at its default:

| clients | steady select p50 / p90 / p99 | first screen p50 / p99 | this morning, same seed, before the transform cache and this layer |
| --- | --- | --- | --- |
| 100 | 9 / 20 / 26 ms | 22 / 40 ms | 10 / 22 / 31 |
| 200 | 15 / 30 / 51 ms | 22 / 83 ms | 21 / 45 / 84 |
| 300 | 41 / 122 / 364 ms | 39 / 700 ms | 139 / 436 / 1 081 |

The 300 rung is three times better than this morning's because the
transform cache takes a third of the registrations off the
development-mode backend, whose round trip is 16 ms at the median here
where it was 65; nothing else changed on that path. At every rung the
warnings were the known refusals (the row budget's, the planner's, the
`LIKE` queries, the harness's own bad arguments), one line per refused
registration, and no line was dropped.

Our own driver's update ladder (200 clients, rows committed into one
channel, then over twenty) delivered every row at the same latencies as
before the layer: 156 / 153 / 176 ms at the median for 50 / 200 / 400
committed rows a second (10 000 to 80 000 delivered a second), 155 and
162 ms over twenty channels at 1 000 and 4 000. The log wrote 18 330 JSON
lines over the hour without dropping one; the thread CPU seconds the
sampler read from `/proc` put the engine at 178 s, the reads at 112, the
server tasks at 54 and the group threads at 43 for the whole sequence,
which is the engine's share said directly. The one thing the layer found
was not the layer's cost but the caches': the process stood at 9.9 GB
with nothing held, which is what holding thirty thousand ASTs as parsed
trees costs. Both caches keep JSON text now (commit 523cf36), and the
same three rungs on a fresh process read:

| clients | resident set after the rung | with the caches as parsed trees | this morning, without the caches | steady select p50 / p90 / p99 |
| --- | --- | --- | --- | --- |
| 100 | 1.3 GB (11 000 transforms, 8 600 shapes kept) | 2.9 GB | 1.25 GB | 9 / 20 / 27 ms |
| 200 | 2.5 GB (20 000 transforms, 10 000 shapes) | 5.5 GB | 2.2 GB | 14 / 30 / 49 ms |
| 300 | 3.6 GB | 7.8 GB | 3.2 GB | 40 / 124 / 325 ms |

The caches now cost about 0.3 GB at their full size; the latencies are
the same as with the trees.

## 7. What it costs, by construction

Nothing on the hot paths that was not already there: the histograms
existed; the new counters are one atomic add each at points that already
did more (a read's rows were already counted, a push already awaited);
the log calls that are new are at debug (checked and skipped at info)
or at events that happen once per connection. The measurement that
proves it is the one every change here is held to: the bench, the local
load sweep and the rig's ladder before and after (section 7 of
`prod-scale-2026-09-19.md` has the before).
