//! # Streamgres
//!
//! A sync engine: clients subscribe to read queries over a WebSocket and
//! keep receiving incremental updates to those queries as the underlying
//! data changes — instead of polling, a client gets only the delta (the
//! rows that entered or left its result set).
//!
//! The core mechanism is **Incremental View Maintenance (IVM)**: every
//! subscription is a materialized view, every write is routed to exactly
//! the views it affects, and each affected view is patched with
//! [`model::DataFrameOperation`]s rather than recomputed.
//!
//! # Module map
//!
//! | Module | What lives there |
//! |--------|------------------|
//! | [`model`] | The data model: values, schema, queries, and the row/operation wire vocabulary. What everything else speaks. |
//! | [`ivm`] | The engine: query registration, write routing (`search_impacted_queries`), delta computation (`incremental_update`), operation counters — plus the multi-table join layer ([`ivm::MultiTableIVM`]) and the read requests ([`ivm::Fetch`]) it records instead of reading storage itself. |
//! | [`sync`] | Running an engine against a source: positions, the asynchronous [`sync::Storage`] seam, the single-owner [`sync::Runtime`] that lands reads against the write stream, the two drivers ([`sync::Service`] answers on an [`sync::Event`] stream), and PostgreSQL ([`sync::pg`], whose [`sync::pg::threads`] wires feed, storage and driver into one engine side). |
//! | [`parser`] | SQL text → query model: schema-aware parsing against a [`parser::Catalog`]. |
//! | [`client`] | The client side: the WebSocket server the sync client connects to, the sync protocol, the AST translation, and each client group's view. It drives the engine only through [`sync::Service`]'s two channels. |
//! | [`log`] | The leveled log the binary and the client side write to. |
//! | [`stats`] | The server's own measurements: per-stage latency histograms and counters, served at `/stats`. |
//! | [`profile`] | Continuous CPU and heap profiling pushed to Pyroscope, when `STREAMGRES_PYROSCOPE_URL` asks for it. |
//!
//! The demo binary (`src/main.rs`) runs a scripted scenario — SQL text in,
//! routed operations out — and prints, per write, which subscriptions were
//! found and what the routing cost.
//!
//! # Roadmap
//!
//! 1. ✅ Query/value/dataframe model, IVM v1 (single table)
//! 2. ✅ SQL parser producing [`model::SingleTableReadQuery`] / [`model::WriteQuery`]
//!    (single-table; see its module docs for the v1 restrictions)
//! 3. ✅ Multi-table LEFT JOINs over the single-table engine
//!    ([`ivm::MultiTableIVM`]; programmatic specs — parser `JOIN` syntax
//!    still pending)
//! 4. ✅ `ORDER BY` / `LIMIT` windows, twin sharing, in-place condition
//!    edits, and the benchmark harness (`src/bin/bench.rs`)
//! 5. ✅ Asynchronous storage and the runtime: the engine records reads,
//!    the runtime lands them against the write stream by one rule
//!    ([`sync::Runtime`]); PostgreSQL storage positioned by WAL location
//!    or transaction id and a `test_decoding` change-feed poller
//!    ([`sync::pg`]), with live tests and a bench scenario
//! 6. ✅ `INNER` edges, the streaming `pgoutput` consumer, and the sync
//!    protocol (v51) over WebSockets ([`client`]) against an unmodified
//!    client of the protocol, with the engine reached only through [`sync::Service`]
//! 7. ✅ Windows below the root (a `related` node's `ORDER BY` / `LIMIT`
//!    as a window per parent row) and the join planner (every edge with a
//!    driver, the inner edge evaluated from either side; the driver chosen
//!    by counting, cached per tree; refusal past the limit)
//!    ([`client::plan`], [`model::Join`])
//! 8. ✅ The pipeline as threads: `Send` values and shared row images, the
//!    feed thread decoding, the engine thread routing alone, a reads pool
//!    (one round trip per read), group threads that serialize each row
//!    once and assemble pokes as bytes, translation and planning on the
//!    connection, per-stage histograms at `/stats` ([`stats`])
//! 9. History across reconnects, so a client that missed changes resumes
//!    instead of starting a fresh sync
//! 10. Batching of one write's narrowed reads, parser `JOIN` syntax,
//!     table sharding of the engine across threads

pub mod client;
pub mod ivm;
pub mod log;
pub mod metric;
pub mod model;
pub mod otel;
pub mod parser;
pub mod profile;
pub mod shutdown;
pub mod stats;
pub mod sync;
