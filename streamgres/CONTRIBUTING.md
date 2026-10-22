# Contributing to Streamgres

Thanks for your interest in improving Streamgres. This guide covers how to set
up a development environment, what a pull request needs before it is merged,
and the conventions the code follows.

## Before you start

- **Bugs:** open an issue with the query (or client call) involved, the write
  that produced the wrong result, what you expected and what you saw. A failing
  test is the best bug report.
- **Features and larger changes:** open an issue to discuss the design first.
  This is required for changes to the model types in `src/model/`. They are
  index keys throughout the engine, so a change to them ripples everywhere.
- **Small fixes** (typos, docs, an obvious bug with a test) can go straight to
  a pull request.
- **Security issues:** please do not open a public issue. Report them
  privately to the maintainers through GitHub's private vulnerability
  reporting on this repository.

## Development setup

You need:

- Rust **1.88+** (CI builds with 1.89.0)
- PostgreSQL with `wal_level = logical` for the live tests
- Node.js 22 for the scripts in `scripts/` (optional)
- Docker for the image (optional)

Build and test:

```bash
cargo build
cargo test                          # unit and scenario tests
cargo clippy --all-targets -- -D warnings
cargo run --bin streamgres           # Streamgres demo: every check must end in PASS
cargo run --release --bin bench     # benchmarks
cargo run --release --bin load      # the server over the wire: latency, cores, memory (needs STREAMGRES_PG_DSN)
```

The tests against a real PostgreSQL run when `STREAMGRES_PG_DSN` is set and
report themselves skipped otherwise. To run them the way CI does:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17 \
  -c wal_level=logical -c max_replication_slots=32 -c max_wal_senders=32

STREAMGRES_PG_DSN=postgresql://postgres:postgres@localhost:5432/postgres \
  cargo test --release
```

To run the server locally, follow the [Quick start](README.md#quick-start) in
the README.

## What CI checks

Every pull request runs:

| Job | What it runs |
| --- | --- |
| Lints | `cargo clippy --all-targets --locked -- -D warnings` |
| Tests | `cargo test --release --locked` against PostgreSQL 17 |
| Benchmark | `bench` on your branch and the base branch, five alternating rounds, compared by `scripts/bench-compare.py` |
| Image | builds `docker/server/Dockerfile` and drives it end to end with `scripts/smoke.mjs` |

Run at least the lints and tests locally before pushing. `--locked` means
`Cargo.lock` must be up to date. If you add or change a dependency, commit the
lock file with it.

`cargo fmt --check` is not enforced, because some older files predate the
formatter's current rules. Format the code you write, but do not reformat
unrelated files in the same pull request.

## Where changes go

| Area | Path | Notes |
| --- | --- | --- |
| What a filter matches | `src/ivm/predicate.rs` | Add a test alongside the change |
| Routing index | `src/ivm/index.rs`, `src/ivm/columns.rs` | Expect the demo and benchmark counters to move; say how in the PR |
| Windows (`ORDER BY` / `LIMIT`) | `src/ivm/` | |
| Joins | `src/ivm/multi.rs` | |
| Snapshot reads, change feed | `src/sync/`, `src/sync/pg/` | Cover with `tests/pg_live.rs` or `tests/sync_interleaving.rs` |
| Wire protocol, server, client groups | `src/client/` | Keep compatibility with the `@rocicorp/zero` 1.9 client (sync protocol v51) |
| SQL parser | `src/parser/` | |
| Model types | `src/model/` | Open an issue first |

### Tests

- Every behaviour change comes with a test that fails without it.
- Engine behaviour belongs in the scenario tests (`tests/ivm_scenarios.rs`,
  `tests/multi_table_scenarios.rs`, `tests/gated_pages.rs`).
- Anything that touches PostgreSQL, snapshots or the change feed needs a live
  test in `tests/pg_live.rs` or `tests/schema_changes.rs`.
- `tests/streamgres_queries/` is a suite of production-application queries.
  A change that makes one of them fail or get refused needs a
  reason in the pull request.

### Performance

The engine's main claim is that write cost does not grow with the number of
subscriptions. If your change touches the write path, run the benchmark before
and after and include the numbers in the pull request. A regression in the CI
comparison needs an explanation.

## Code style

- A `//!` block at the top of every file, saying what the file is for.
- `///` on every function and type.
- No comments inside function bodies. If a block needs explaining, move it
  into a named function and document that.
- Comments explain *why*, not *what*. Write in full sentences.
- Avoid new `unsafe`. Where it is unavoidable, explain why it is sound in the
  pull request.
- Data from a client or from PostgreSQL can be malformed. Return an error for
  it rather than panicking.

## Pull requests

- Keep each pull request to one change. Refactors and behaviour changes go in
  separate pull requests.
- Write the description for a reviewer who hasn't seen the issue: what
  changed, why, and how you tested it. Include benchmark numbers when relevant.
- Commit messages: a short imperative summary line (for example, "Refill
  windows from the buffer on delete"), then a body explaining why if it isn't
  obvious.
- Make sure CI is green. A maintainer will review, may ask for changes, and
  merges once approved.

## License

Streamgres is licensed under the [Apache License, Version 2.0](LICENSE). Unless
you say otherwise, any contribution you submit is licensed under the same
terms, as section 5 of the licence provides.

Code ported from other Apache-2.0 projects must keep its original attribution
comments, as `src/client/ddl_triggers.rs` does.
