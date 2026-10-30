# Streamgres

**A subscription-native sync engine for PostgreSQL.** Clients subscribe to SQL
queries over a WebSocket and keep receiving the *delta*: the rows that entered,
left or changed in their result, as soon as the change commits. No polling, no
re-running queries.

Every subscription is an incrementally maintained view. Each committed change
is routed to exactly the views it affects, at a cost that depends on how many
conditions the write matches, not on how many subscriptions exist.

```text
clients                       Streamgres                             PostgreSQL
  │                              │                                        │
  ├─ subscribe(SQL) ────────────>│                                        │
  │                              ├─ initial read at a consistent snapshot>│
  │<─ initial rows ──────────────┤                                        │
  │                              │<──── committed changes (logical ───────┤
  │                              │      replication, commit order)        │
  │                              ├─ which subscriptions does this touch?  │
  │<─ delta: rows added/removed ─┤                                        │
```

---

## Features

- **Write cost independent of subscriber count.** Filters are normalized and
  indexed per column, so a write reaches only the conditions it satisfies. Going
  from 100 to 10 000 subscriptions, a write still touches the same 3–4
  conditions.
- **Identical queries share work.** Subscriptions to the same query share one
  view and one copy of each row. A new subscriber is served from memory without
  a database read.
- **`ORDER BY` / `LIMIT` windows.** A client receives exactly its page and the
  changes to it. Rows leaving the page are refilled from a buffer the engine
  keeps, so most changes need no database round trip.
- **Joins.** `LEFT`, `RIGHT` and `INNER` joins at any depth, `EXISTS` anywhere
  in a filter (including inside `OR`), and per-parent limits (the top *n*
  children of each parent row). A planner picks which side of each join drives
  it from row counts, and refuses queries that would read too much.
- **Consistent by construction.** The engine sits at one position in
  PostgreSQL's write-ahead log. Initial reads use snapshots that are never ahead
  of it, and writes delivered while a read is in flight are applied to its
  result before it lands. A client never sees a row go backwards.
- **The change feed is read-only.** Startup setup creates or validates the
  mutation schema, publication and DDL triggers on the writable primary; the
  feed then follows a primary, logical replica or physical standby.
- **Live schema changes.** New tables and new columns with a constant default
  are picked up while running. Any other change to a served table stops the
  server with a message naming the change. Once restarted, by your
  orchestrator or by hand, it serves the new schema.
- **Compatible with the [Zero](https://zero.rocicorp.dev) client by Rocicorp.**
  An unmodified `@rocicorp/zero` 1.9 client (sync protocol v51) connects to it.
  Queries and mutations go through your application server's query and mutate
  endpoints.
- **Built for production.**
  - A multi-threaded pipeline with a single-threaded engine.
  - Prometheus metrics, OTLP push, and structured logs.
  - Health and readiness endpoints, and graceful shutdown.
  - A slim container image.

### Performance

From the benchmark harness and load scripts in this repository, on one Apple M4
Max:

| | |
| --- | --- |
| Routing a write | 0.9 / 1.7 / 3.7 µs at 100 / 1 000 / 10 000 subscriptions |
| Registering a subscription | 1.5–7.4 µs, flat as subscriptions grow |
| Over the wire, one channel watched by 200 clients | 1 000 updates/s (200 000 client rows/s), every row delivered, 28 ms median and 34 ms p99 commit-to-client latency, 1.2 cores |
| Over the wire, writes spread over 20 channels | 7 400 updates/s, every row delivered, 1.7 cores |

Treat these as relative numbers: they are single runs on a shared workstation.
Run `cargo run --release --bin bench` to measure on your own hardware.

---

## Quick start

### Requirements

- Rust **1.88+** (edition 2024)
- PostgreSQL with `wal_level = logical` and spare `max_replication_slots` /
  `max_wal_senders`: one slot for the change feed, plus up to three short-lived
  slots for read snapshots
- An application server exposing the query and mutate endpoints a Zero client
  uses

### 1. Prepare PostgreSQL

Set `STREAMGRES_MASTER_PG_DSN` to a writable PostgreSQL superuser connection.
At startup, Streamgres creates or validates the mutation schema, publication
and DDL trigger stack. It refuses to start if an existing object differs from
the configured app ID, shard or publication.

### 2. Configure and run

```bash
cp .env.example .env     # set STREAMGRES_PG_DSN, STREAMGRES_QUERY_URL, STREAMGRES_MUTATE_URL
cargo run --release --bin server
```

The server listens on `0.0.0.0:4848`. Point the client's `server` option at
`http://<host>:4848/sync`, which is the `STREAMGRES_BASE_PATH` from
`.env.example`. `GET /health` returns `200` once the server is ready to serve
queries.

Configuration uses `STREAMGRES_*` environment variables, each documented in
[`.env.example`](.env.example). Existing `XYNE_SYNC_*` variables are still
accepted as fallbacks; a `STREAMGRES_*` value takes precedence when both are
set. For production setup see
[`docs/deploy.md`](docs/deploy.md): sizing, PostgreSQL roles and replicas,
probes and routing. For metrics, logs and alerts see
[`docs/observability.md`](docs/observability.md).

### Docker

```bash
docker build -f docker/server/Dockerfile -t streamgres .
docker run --env-file .env -p 4848:4848 streamgres
```

---

## How it works

The engine has four parts:

1. **Routing index** (`src/ivm/index.rs`, `src/ivm/columns.rs`). Each filter is
   normalized to OR-of-ANDs. Every condition is filed in a per-column value
   index: equality maps, range maps, and set difference for `!=` / `NOT IN`.
   For a write, each column value is looked up once, which yields exactly the
   conditions it satisfies. Shared counters then fire the subscriptions whose
   conditions are all met.
2. **Shared frames** (`src/ivm/frames.rs`). Each table keeps one copy of every
   row any subscription holds, tagged with its holders. Deletes and rows that
   stop matching are found directly from those tags.
3. **Join tree** (`src/ivm/multi.rs`). A multi-table query is a tree of
   single-table subscriptions. A join is an `IN` condition over a shared set of
   join values, gaining or losing one member as rows come and go. Nothing is
   recomputed in proportion to the set's size.
4. **Runtime and storage** (`src/sync/`). The engine never reads storage
   itself. It asks for the rows it needs and keeps routing. The runtime runs
   those reads at a PostgreSQL snapshot no newer than the engine's position,
   and brings each result up to date with the writes delivered meanwhile.

Around the engine, the server (`src/client/`) runs as a pipeline of threads:

- the **change feed**, which decodes PostgreSQL's logical replication stream
- the **engine thread**, which routes
- a **read pool**, which queries PostgreSQL
- **group threads**, which keep each client's view and build the messages
- the **WebSocket server**, which handles connections

The engine never knows about clients. It emits one change per row and the list
of subscriptions it concerns, so delivering a change costs the engine the same
for one subscriber or ten thousand.

### Semantics

- An `UPDATE` reaches clients as one row upsert. A row leaving a result reaches
  them as one delete.
- Comparisons with `NULL` are false. `IS NULL` / `IS NOT NULL` are the null
  tests.
- `LEFT` keeps every parent row. `INNER` shows a parent only while a child
  matches, and a child only under a shown parent. `RIGHT` keeps every child
  row.
- Rows are identified by primary key. A large (TOASTed) value an update did
  not touch, which PostgreSQL sends as unchanged, is filled in from the row the
  server already holds, or the row is read again by key; no `REPLICA IDENTITY
  FULL` is needed.

### Limitations

- **No `LIKE` / `ILIKE`, `NOT EXISTS`, or JSON operators.** Such a query is
  refused with an error naming the reason; other queries on the connection
  are unaffected. A join on several columns (a compound `related` or
  `whereExists`) is supported; the child table needs an index on its join
  columns together, as a single-column join needs one on its column.
- **No history across server restarts.** A client that reconnects after
  missing changes starts a fresh sync, which drops its unsent mutations.
- **No projections.** Every subscription holds full rows.
- **The SQL parser accepts single-table queries only.** Multi-table queries
  come from the client protocol or are built in code.
- **Filters are not capped in size** after normalization, so a pathological
  `OR` of `AND`s can be large.
- **One engine thread.** It is the throughput limit per process. Sharding by
  table is future work.

---

## Development

```bash
cargo test                          # unit and scenario tests
cargo run --bin streamgres           # demo: SQL in, routed operations and cost counters out
cargo run --release --bin bench     # benchmarks: routing, registration, windows, joins
cargo clippy --all-targets
```

Tests against a real PostgreSQL run when `STREAMGRES_PG_DSN` is set, and report
The load bench runs the whole server over the wire under a production-shaped
load and reports its CPU, cores by thread and memory at the median, 90th and
99th percentile, beside the commit-to-client latency of every kind of row. It
needs a PostgreSQL with `wal_level = logical` and a database with `bench` in
its name, whose tables it drops and makes again:

```bash
cargo build --release --bin server
XYNE_SYNC_PG_DSN=postgresql://postgres@localhost:5432/xyne_bench \
  cargo run --release --bin load -- --connections 200 --duration 60
```

The options (clients, users, channels, write rate, rows per transaction, push
rate, churn, body sizes) are listed at the top of `src/bin/load.rs`.

Tests against a real PostgreSQL run when `XYNE_SYNC_PG_DSN` is set, and report
themselves skipped otherwise:

```bash
STREAMGRES_PG_DSN=postgresql://postgres@localhost:5432/streamgres cargo test --test pg_live
```

`scripts/` holds the end-to-end checks:

- `smoke.mjs` drives the server with a scripted client and stands in for the
  application server's query endpoint, so nothing else is needed. CI runs it
  against the built image.
- `load-protocol.mjs` and `load-smoke.mjs` are load generators.

### Using the engine as a library

```rust
use std::rc::Rc;
use streamgres::ivm::SingleTableIVM;
use streamgres::model::*;
use streamgres::parser::{parse_read, parse_write};
use streamgres::sync::{Local, MemoryStorage};

let catalog = Catalog::new(vec![DbTable::new("tickets", ["id"], vec![
    DbColumn::new("id", ValueType::Int),
    DbColumn::new("status", ValueType::String),
])]);
let storage = Rc::new(MemoryStorage::new());
let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());

let query = parse_read("SELECT * FROM tickets WHERE status = 'OPEN'", &catalog).unwrap();
let (sub, initial) = ivm.register_query(query);

let write = parse_write("INSERT INTO tickets (id, status) VALUES (1, 'OPEN')", &catalog).unwrap();
storage.apply(&write);                          // commit first,
let deltas = ivm.incremental_update(&write);    // then route
```

`tests/pg_live.rs` shows the same engine running against PostgreSQL with the
streaming change feed.

### Layout

```text
src/
  model/     values, schema, queries, rows and operations
  parser/    SQL parser for single-table reads and writes
  ivm/       the engine: routing index, frames, windows, join tree
  sync/      runtime, storage trait, in-memory store, PostgreSQL reads and change feed
  client/    the WebSocket server and Zero protocol, query planning, client groups
  bin/       server, bench and load binaries
tests/       scenario tests, live PostgreSQL tests, and a 283-query suite
             taken from a production application
scripts/     smoke, end-to-end and load scripts; CI helpers
docker/      the server image
docs/        deployment and observability guides
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, what CI checks and the code
conventions. In short:

- Run `cargo test && cargo clippy --all-targets && cargo run --bin streamgres`
  before opening a pull request. The demo must end with every check `PASS`.
- Engine behaviour lives in `src/ivm/`. A change to *what matches* belongs in
  `predicate.rs`, with a test alongside it. Routing changes are expected to
  move the counters the demo and benchmarks print; say how in the pull request.
- Model types are index keys, so changes to them ripple everywhere. Open an
  issue to discuss one first.
- Comment style: a `//!` block per file, `///` on every function and type, and
  no comments inside function bodies.

Unless you say otherwise, any contribution you submit is licensed under
Apache-2.0, as section 5 of the licence provides.

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
