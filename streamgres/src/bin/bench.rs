//! Benchmark binary: measures the IVM engine with `std::time` alone — no
//! extra crates, and a fixed-seed xorshift PRNG so every run is
//! reproducible.
//!
//! ```bash
//! cargo run --release --bin bench
//! ```
//!
//! Six scenarios, each printed as a compact table:
//!
//! 1. **Routing scale** — `tickets` subscriptions drawn from a small
//!    filter vocabulary (so conditions are shared across subscriptions) at
//!    N = 100 / 1_000 / 10_000; 20_000 inserts and 20_000 updates routed
//!    through each. The claim under test: per-write routing cost tracks
//!    the number of *distinct* indexed conditions (flat in N), while
//!    delivery cost tracks the subscriptions actually impacted. Updates
//!    are routed twice — once through `search_impacted_queries` (routing
//!    only, no state change) and once through `incremental_update` (routing
//!    plus delivery) — to separate the two costs.
//! 2. **Registration** — cost per `register_query` at each N (measured in
//!    scenario 1's registration loop), and twin sharing: 1_000 identical
//!    registrations over existing data, served from the shared frame
//!    instead of storage.
//! 3. **Window** — one `ORDER BY points ASC LIMIT 50` subscription over
//!    100_000 storage rows under uniform writes (the published boundary
//!    rejects nearly everything) and window-targeted writes (every insert
//!    aims below the boundary, every delete hits a row on the client's
//!    page, so admissions, evictions, and refills all happen). The client
//!    receives the page of 50; the buffer of 100 behind it is the engine's.
//! 4. **LEFT JOIN** — `tickets LEFT JOIN users ON assigned_to = users.id`
//!    with 1_000 identical subscriptions plus 100 distinct ones over 1_000
//!    users: ticket inserts, ticket reassignments, and user updates.
//! 6. **Production query workload** — three dashboard query shapes over
//!    synthetic data: `browsableChannels` (an existence test
//!    inside an `OR`), `conversationMessages` under the channel-access
//!    chain (three INNER edges deep, the visibility rule with `IS NULL`),
//!    and the board view (`IS NULL`, `OR` with `IS NULL`, two LEFT edges,
//!    a page of 50 ordered by `createdAt DESC, id ASC`); one subscription
//!    per user for each, then message inserts, membership churn that moves
//!    the existence sets, and in-place ticket updates.
//! 7. **Partial images** — `conversations` rows with a 4_000-character
//!    `md` (laid out as the decoder lays them out), one subscription per
//!    even channel: updates carrying `md` against updates that leave it
//!    out (PostgreSQL's "unchanged" for an out-of-line value), on rows a
//!    subscription holds (completed from the frame) and on rows moving
//!    into a subscription that nobody holds (read again by key).
//! 5. **Postgres** (only when `STREAMGRES_PG_DSN` names a database with
//!    `wal_level = logical` and `bench` in its name, since the scenario
//!    replaces its `users` and `tickets` tables) — the same join over real tables: a
//!    registration's end-to-end latency (two positioned reads), writes
//!    committed in Postgres and streamed through the `test_decoding`
//!    poller into the runtime, and a registration whose snapshot is held
//!    open while writes flow, in both positioning modes.
//!
//! Storage is a bench-local [`Storage`] implementation with hashed row
//! lookup: the crate's `MemoryStorage` finds rows by linear scan on every
//! `apply`, which would make loading 100_000 rows quadratic. Its `select`
//! scans and evaluates the same predicates, with one shortcut a real
//! database has too — a primary-key `IN` / `=` conjunct narrows the scan
//! to those keys. It answers at once, so the engines run under the
//! synchronous [`Local`] driver and every read a registration or a join
//! crossing asks for is landed inside the timed call. Every write is
//! mirrored into storage *before* it is routed, and only the engine call
//! is timed.

use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use streamgres::ivm::{
    Fetch, IvmStats, MultiTableIVM, SingleTableIVM, complete_image, evaluate, order_rows,
};
use streamgres::model::ComparisonOperator::{EQ, GTE};
use streamgres::model::*;
use streamgres::sync::pg::{PgStorage, PgStream};
use streamgres::sync::{Local, Lsn, Runtime, Snapshot, Storage, StorageError};

/// The production-app catalog shared with the query scenario tests.
#[path = "../../tests/streamgres_queries/catalog.rs"]
#[allow(dead_code)]
mod workload;

/// The single-table engine under the synchronous driver over bench storage.
type Single = Local<SingleTableIVM, BenchStorage>;

/// The join layer under the synchronous driver over bench storage.
type Multi = Local<MultiTableIVM, BenchStorage>;

const STATUSES: [&str; 10] = [
    "NEW",
    "OPEN",
    "TODO",
    "IN_PROGRESS",
    "REVIEW",
    "BLOCKED",
    "DONE",
    "CLOSED",
    "ARCHIVED",
    "WONTFIX",
];
const PRIORITIES: [&str; 5] = ["LOWEST", "LOW", "MEDIUM", "HIGH", "URGENT"];
const TEAMS: u64 = 50;
const USERS: u64 = 1_000;
const POINTS_RANGE: u64 = 1_000;
const THRESHOLD_BASE: i64 = 900;
const THRESHOLD_STEP: i64 = 5;
const THRESHOLDS: u64 = 20;
const SEED: u64 = 0x9E37_79B9_7F4A_7C15;

const ROUTING_SIZES: [usize; 3] = [100, 1_000, 10_000];
const ROUTING_INSERTS: usize = 20_000;
const ROUTING_UPDATES: usize = 20_000;

const TWIN_ROWS: usize = 20_000;
const TWIN_COPIES: usize = 1_000;
const TWIN_STORAGE_SAMPLES: usize = 10;
const RELEASE_ROWS: usize = 200_000;
const RELEASE_SUBS: usize = 5_000;
const MEMORY_ROWS: usize = 200_000;

const WINDOW_ROWS: usize = 100_000;
const WINDOW_LIMIT: u32 = 50;
const WINDOW_WRITES: usize = 10_000;
const WINDOW_POINTS_RANGE: u64 = 1_000_000;

const PG_TICKETS: usize = 2_000;
const PG_WRITES: usize = 5_000;
const PG_WRITES_PER_TXN: usize = 100;
const PG_LOAD_WRITES: usize = 500;
const PG_SLOT: &str = "xyne_sync_bench";
const PG_PUBLICATION: &str = "xyne_sync_bench_pub";

const XY_USERS: u64 = 1_000;
const XY_CHANNELS: u64 = 500;
const XY_PUBLIC_CHANNELS: u64 = 100;
const XY_MEMBERSHIPS_PER_USER: u64 = 10;
const XY_CONVERSATIONS_PER_CHANNEL: u64 = 100;
const XY_MESSAGES_PER_CONVERSATION: u64 = 2;
const XY_THREADS_PER_USER: u64 = 5;
const XY_BOARDS: u64 = 20;
const XY_BOARD_PAGE: u32 = 50;
const XY_TICKETS: u64 = 10_000;
const XY_MESSAGE_INSERTS: usize = 5_000;
const XY_MEMBERSHIP_CHURN: usize = 1_000;
const XY_TICKET_UPDATES: usize = 2_000;

const TOAST_CHANNELS: i64 = 1_000;
const TOAST_PER_CHANNEL: i64 = 20;
const TOAST_MD_CHARS: usize = 4_000;
const TOAST_WRITES: usize = 5_000;
const PG_PARTIAL_WRITES: usize = 200;

const JOIN_TWINS: usize = 1_000;
const JOIN_DISTINCT: usize = 100;
const JOIN_INITIAL_TICKETS: usize = 2_000;
const JOIN_TICKET_INSERTS: usize = 10_000;
const JOIN_REASSIGNMENTS: usize = 5_000;
const JOIN_USER_UPDATES: usize = 5_000;

/// Xorshift64: a tiny deterministic PRNG so runs are reproducible without
/// a `rand` dependency.
struct XorShift64(u64);

impl XorShift64 {
    /// A generator seeded with `seed` (zero is nudged: it is xorshift's
    /// absorbing state).
    fn new(seed: u64) -> Self {
        XorShift64(seed.max(1))
    }

    /// The next 64 random bits.
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    /// Uniform in `0..n` (`n > 0`); the modulo bias is negligible at these
    /// ranges.
    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }

    /// A uniform index into a slice of `len` elements.
    fn index(&mut self, len: usize) -> usize {
        self.below(len as u64) as usize
    }
}

/// The `tickets(id, status, priority, assigned_to, points, team)` table.
fn tickets_table() -> DbTable {
    DbTable::new(
        "tickets",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("status", ValueType::String),
            DbColumn::new("priority", ValueType::String),
            DbColumn::new("assigned_to", ValueType::String),
            DbColumn::new("points", ValueType::Int),
            DbColumn::new("team", ValueType::Int),
        ],
    )
}

/// The `users(id, name, team)` table; `id` is the string `assigned_to`
/// references.
fn users_table() -> DbTable {
    DbTable::new(
        "users",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::String),
            DbColumn::new("name", ValueType::String),
            DbColumn::new("team", ValueType::Int),
        ],
    )
}

/// The string id of user number `n`.
fn user_id(n: u64) -> String {
    format!("u{n}")
}

/// A single-column primary key `{"id": value}`.
fn key(id: impl Into<Value>) -> DataFrameKey {
    DataFrameKey::new([("id", id.into())])
}

/// A DELETE of one row of `table`.
fn delete(table: &DbTable, key: DataFrameKey) -> WriteQuery {
    WriteQuery::DELETE(DeleteQuery {
        table: table.name.clone(),
        pkey_value: key,
    })
}

/// A subscription query on `table` with the given filter, pkey-ordered,
/// unbounded.
fn unbounded(table: &DbTable, filter: Where) -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        table.name.clone(),
        filter,
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    )
}

/// A `tickets` row in the bench's compact form; `row()` renders the full
/// image the engine requires (every column, pkey included).
#[derive(Clone)]
struct Ticket {
    id: i64,
    status: usize,
    priority: usize,
    assigned_to: u64,
    points: i64,
    team: i64,
}

impl Ticket {
    /// A uniformly random ticket with the given id.
    fn random(rng: &mut XorShift64, id: i64) -> Self {
        Ticket {
            id,
            status: rng.index(STATUSES.len()),
            priority: rng.index(PRIORITIES.len()),
            assigned_to: rng.below(USERS),
            points: rng.below(POINTS_RANGE) as i64,
            team: rng.below(TEAMS) as i64,
        }
    }

    /// The full row image.
    fn row(&self) -> DataFrameRow {
        DataFrameRow::new([
            ("id", Value::Int(self.id)),
            ("status", Value::from(STATUSES[self.status])),
            ("priority", Value::from(PRIORITIES[self.priority])),
            ("assigned_to", Value::from(user_id(self.assigned_to))),
            ("points", Value::Int(self.points)),
            ("team", Value::Int(self.team)),
        ])
    }

    /// An INSERT of this ticket.
    fn insert(&self) -> WriteQuery {
        WriteQuery::INSERT(InsertQuery {
            table: tickets_table().name,
            pkey_value: key(self.id),
            record: self.row(),
        })
    }

    /// An UPDATE carrying this ticket's full current image.
    fn update(&self) -> WriteQuery {
        WriteQuery::UPDATE(UpdateQuery {
            table: tickets_table().name,
            pkey_value: key(self.id),
            record: self.row(),
        })
    }
}

/// The full image of user `n` at name version `version`.
fn user_row(n: u64, version: u64) -> DataFrameRow {
    DataFrameRow::new([
        ("id", Value::from(user_id(n))),
        ("name", Value::from(format!("user {n} v{version}"))),
        ("team", Value::Int((n % TEAMS) as i64)),
    ])
}

/// An INSERT of user `n`.
fn user_insert(n: u64, version: u64) -> WriteQuery {
    WriteQuery::INSERT(InsertQuery {
        table: users_table().name,
        pkey_value: key(user_id(n)),
        record: user_row(n, version),
    })
}

/// An UPDATE renaming user `n` to name version `version`.
fn user_update(n: u64, version: u64) -> WriteQuery {
    WriteQuery::UPDATE(UpdateQuery {
        table: users_table().name,
        pkey_value: key(user_id(n)),
        record: user_row(n, version),
    })
}

/// `status = <one of 10>`.
fn status_atom(rng: &mut XorShift64) -> Where {
    Where::condition("status", EQ, STATUSES[rng.index(STATUSES.len())])
}

/// `priority = <one of 5>`.
fn priority_atom(rng: &mut XorShift64) -> Where {
    Where::condition("priority", EQ, PRIORITIES[rng.index(PRIORITIES.len())])
}

/// `team = <one of 50>`.
fn team_atom(rng: &mut XorShift64) -> Where {
    Where::condition("team", EQ, rng.below(TEAMS) as i64)
}

/// `points >= <one of 20 thresholds in 900..=995>` — a "big tickets"
/// filter matching 0.5–10% of rows.
fn points_atom(rng: &mut XorShift64) -> Where {
    let threshold = THRESHOLD_BASE + THRESHOLD_STEP * rng.below(THRESHOLDS) as i64;
    Where::condition("points", GTE, threshold)
}

/// One subscription filter from the shared vocabulary. The mix leans
/// toward the narrow shapes real subscriptions have (one team's tickets
/// in one status), with a few broad ones, so that the average filter
/// matches about 1% of random rows — 85 distinct atoms in total no matter
/// how many subscriptions are drawn.
fn random_filter(rng: &mut XorShift64) -> Where {
    match rng.below(100) {
        0..=44 => Where::AND(vec![team_atom(rng), status_atom(rng)]),
        45..=64 => Where::AND(vec![team_atom(rng), priority_atom(rng)]),
        65..=74 => team_atom(rng),
        75..=81 => Where::AND(vec![status_atom(rng), priority_atom(rng)]),
        82..=91 => Where::AND(vec![status_atom(rng), points_atom(rng)]),
        92..=94 => points_atom(rng),
        _ => Where::OR(vec![team_atom(rng), team_atom(rng)]),
    }
}

/// The distinct main filters of the join scenario: 50 `team = T`, then the
/// 50 `status = S AND priority = P` combinations.
fn distinct_join_filter(index: usize) -> Where {
    if index < TEAMS as usize {
        Where::condition("team", EQ, index as i64)
    } else {
        let combination = index - TEAMS as usize;
        Where::AND(vec![
            Where::condition("status", EQ, STATUSES[combination % STATUSES.len()]),
            Where::condition("priority", EQ, PRIORITIES[combination / STATUSES.len()]),
        ])
    }
}

/// Distinct atoms and DNF disjuncts seen across a registration batch —
/// the generator-side count of what the table index has to hold.
#[derive(Default)]
struct Vocabulary {
    conditions: HashSet<Condition>,
    disjuncts: HashSet<Disjunct>,
}

impl Vocabulary {
    /// Record one filter's DNF.
    fn note(&mut self, filter: &Where) {
        for disjunct in filter.to_dnf() {
            for condition in &disjunct.conditions {
                self.conditions.insert(condition.clone());
            }
            self.disjuncts.insert(disjunct);
        }
    }
}

/// One table of the bench storage: rows in insertion order plus a
/// key → position index, so mirroring a write is O(1).
#[derive(Default)]
struct BenchTable {
    rows: Vec<(DataFrameKey, DataFrameRow)>,
    positions: HashMap<DataFrameKey, usize>,
    by_value: HashMap<ColumnName, HashMap<Value, HashSet<usize>>>,
}

impl BenchTable {
    /// The value of `column` in `row`, `NULL` when the image lacks it.
    fn value_of(row: &DataFrameRow, column: &ColumnName) -> Value {
        row.data.get(column).cloned().unwrap_or(Value::Null)
    }

    /// Build the equality index of `column` on first use; every later
    /// write keeps it current.
    fn ensure_index(&mut self, column: &ColumnName) {
        if self.by_value.contains_key(column) {
            return;
        }
        let mut index: HashMap<Value, HashSet<usize>> = HashMap::new();
        for (position, (_, row)) in self.rows.iter().enumerate() {
            index
                .entry(Self::value_of(row, column))
                .or_default()
                .insert(position);
        }
        self.by_value.insert(column.clone(), index);
    }

    /// File the row at `position` under its values in every index.
    fn file(&mut self, position: usize, row: &DataFrameRow) {
        for (column, index) in self.by_value.iter_mut() {
            index
                .entry(Self::value_of(row, column))
                .or_default()
                .insert(position);
        }
    }

    /// Unfile the row at `position` from every index.
    fn unfile(&mut self, position: usize, row: &DataFrameRow) {
        for (column, index) in self.by_value.iter_mut() {
            if let Some(bucket) = index.get_mut(&Self::value_of(row, column)) {
                bucket.remove(&position);
            }
        }
    }

    /// The positions matching any of `values` in `column`, ascending.
    fn positions_of(&self, column: &ColumnName, values: &[Value]) -> Vec<usize> {
        let index = &self.by_value[column];
        let mut positions: Vec<usize> = values
            .iter()
            .filter_map(|value| index.get(value))
            .flat_map(|bucket| bucket.iter().copied())
            .collect();
        positions.sort_unstable();
        positions.dedup();
        positions
    }
}

/// The bench storage (see the module header); `position` is where the
/// driver last advanced it, which every read is positioned at.
#[derive(Default)]
struct BenchStorage {
    tables: RefCell<HashMap<TableName, BenchTable>>,
    position: Cell<Lsn>,
}

impl BenchStorage {
    /// Mirror one write: insert/update upsert by primary key (a partial
    /// image keeps the stored values of the columns it lacks, as
    /// PostgreSQL does), delete removes (swap-remove, positions and
    /// indexes patched for the moved row).
    fn apply(&self, write: &WriteQuery) {
        let mut tables = self.tables.borrow_mut();
        let table = tables.entry(write.table().clone()).or_default();
        let key = write.pkey_value();
        match (write.new_row_image(), table.positions.get(key).copied()) {
            (Some(image), Some(position)) => {
                let stored = &table.rows[position].1;
                let image = match image.data.is_partial() {
                    true => {
                        complete_image(Some(image), Some(stored)).unwrap_or_else(|| image.clone())
                    }
                    false => image.clone(),
                };
                let old = std::mem::replace(&mut table.rows[position].1, image.clone());
                table.unfile(position, &old);
                table.file(position, &image);
            }
            (Some(image), None) => {
                let position = table.rows.len();
                table.positions.insert(key.clone(), position);
                table.rows.push((key.clone(), image.clone()));
                table.file(position, image);
            }
            (None, Some(position)) => {
                table.positions.remove(key);
                let (_, gone) = table.rows.swap_remove(position);
                table.unfile(position, &gone);
                if position < table.rows.len() {
                    let (moved_key, moved_row) = table.rows[position].clone();
                    table.positions.insert(moved_key, position);
                    table.unfile(table.rows.len(), &moved_row);
                    table.file(position, &moved_row);
                }
            }
            (None, None) => {}
        }
    }
}

/// Every `=` / `IN` conjunct of the filter reachable through `AND`s only,
/// as `(column, values)`: any one of them bounds the result set.
fn equality_restrictions(filter: &Where, out: &mut Vec<(ColumnName, Vec<Value>)>) {
    match filter {
        Where::Condition(condition) => match (&condition.comparison_operator, &condition.value) {
            (ComparisonOperator::IN, Value::List(values)) => {
                out.push((condition.column.clone(), values.clone()));
            }
            (ComparisonOperator::IN, Value::Set(set)) => {
                out.push((condition.column.clone(), set.members()));
            }
            (ComparisonOperator::EQ, value) => {
                out.push((condition.column.clone(), vec![value.clone()]));
            }
            _ => {}
        },
        Where::OR(_) => {}
        Where::AND(children) => {
            for child in children {
                equality_restrictions(child, out);
            }
        }
    }
}

/// The `order_by` comparison of two rows for a limited query.
fn order_of(
    query: &SingleTableReadQuery,
    a: &(DataFrameKey, DataFrameRow),
    b: &(DataFrameKey, DataFrameRow),
) -> Ordering {
    order_rows(&query.order_by, &a.1, &b.1)
}

impl BenchStorage {
    /// Scan the table — narrowed to the smallest equality conjunct through
    /// a per-column index built on first use, the way a database would
    /// pick an index — evaluate the filter on every candidate, and for a
    /// finite limit keep the best rows in `order_by` order.
    fn rows(&self, query: &SingleTableReadQuery) -> Vec<(DataFrameKey, DataFrameRow)> {
        let mut tables = self.tables.borrow_mut();
        let Some(table) = tables.get_mut(&query.table) else {
            return Vec::new();
        };
        let mut restrictions = Vec::new();
        equality_restrictions(&query.filter, &mut restrictions);
        for (column, _) in &restrictions {
            table.ensure_index(column);
        }
        let candidates: Vec<usize> = restrictions
            .iter()
            .map(|(column, values)| table.positions_of(column, values))
            .min_by_key(Vec::len)
            .unwrap_or_else(|| (0..table.rows.len()).collect());
        let mut selected: Vec<(DataFrameKey, DataFrameRow)> = candidates
            .into_iter()
            .map(|position| &table.rows[position])
            .filter(|(_, row)| evaluate(&query.filter, &row.data, &mut 0))
            .cloned()
            .collect();
        if query.limit != u32::MAX {
            let limit = query.limit as usize;
            if selected.len() > limit {
                selected.select_nth_unstable_by(limit, |a, b| order_of(query, a, b));
                selected.truncate(limit);
            }
            selected.sort_by(|a, b| order_of(query, a, b));
        }
        selected
    }
}

impl Storage for BenchStorage {
    /// [`BenchStorage::rows`], positioned where the driver advanced the
    /// store to; ready at once.
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError> {
        Ok(Snapshot {
            rows: self.rows(query),
            at: self.position.get(),
        })
    }

    /// The store is current at `feed`.
    fn advance(&self, feed: Lsn) {
        if feed > self.position.get() {
            self.position.set(feed);
        }
    }

    /// Reads are never behind the position.
    fn floor(&self) -> Lsn {
        self.position.get()
    }
}

/// The measured cost of one batch of writes: wall time of the engine
/// calls alone, the counter movement, and how many operations (or, for a
/// routing-only pass, impacted subscriptions) came back.
struct Run {
    label: String,
    writes: u64,
    elapsed: Duration,
    stats: IvmStats,
    returned: u64,
}

impl Run {
    /// Mean microseconds per write.
    fn micros_per_write(&self) -> f64 {
        self.elapsed.as_secs_f64() * 1e6 / self.writes as f64
    }

    /// Writes per second.
    fn writes_per_second(&self) -> f64 {
        self.writes as f64 / self.elapsed.as_secs_f64()
    }

    /// A counter averaged per write.
    fn per_write(&self, counter: u64) -> f64 {
        counter as f64 / self.writes as f64
    }
}

/// Route every write through `incremental_update`, timing the engine call
/// alone.
fn route_all(ivm: &mut Single, label: &str, writes: &[WriteQuery]) -> Run {
    let before = ivm.engine().stats().clone();
    let mut returned = 0u64;
    let started = Instant::now();
    for write in writes {
        returned += ivm.incremental_update(write).len() as u64;
    }
    Run {
        label: label.to_owned(),
        writes: writes.len() as u64,
        elapsed: started.elapsed(),
        stats: ivm.engine().stats().diff(&before),
        returned,
    }
}

/// Route every write through `search_impacted_queries` — routing only, no
/// frame or window change — timing the engine call alone.
fn search_all(ivm: &mut Single, label: &str, writes: &[WriteQuery]) -> Run {
    let before = ivm.engine().stats().clone();
    let mut returned = 0u64;
    let started = Instant::now();
    for write in writes {
        returned += ivm.engine_mut().search_impacted_queries(write).len() as u64;
    }
    Run {
        label: label.to_owned(),
        writes: writes.len() as u64,
        elapsed: started.elapsed(),
        stats: ivm.engine().stats().diff(&before),
        returned,
    }
}

/// Print `rows` under `header` as a right-aligned table.
fn print_table(header: &[&str], rows: &[Vec<String>]) {
    let widths: Vec<usize> = header
        .iter()
        .enumerate()
        .map(|(column, title)| {
            rows.iter()
                .map(|row| row[column].len())
                .chain([title.len()])
                .max()
                .unwrap_or(0)
        })
        .collect();
    let render = |cells: &[String]| {
        cells
            .iter()
            .zip(&widths)
            .map(|(cell, &width)| format!("{cell:>width$}"))
            .collect::<Vec<_>>()
            .join("  ")
    };
    let titles: Vec<String> = header.iter().map(|title| (*title).to_owned()).collect();
    println!("{}", render(&titles));
    println!(
        "{}",
        widths
            .iter()
            .map(|&width| "-".repeat(width))
            .collect::<Vec<_>>()
            .join("  ")
    );
    for row in rows {
        println!("{}", render(row));
    }
}

/// `x` with one decimal.
fn one(x: f64) -> String {
    format!("{x:.1}")
}

/// `x` with two decimals.
fn two(x: f64) -> String {
    format!("{x:.2}")
}

/// `x` rounded to an integer with thousands separators.
fn whole(x: f64) -> String {
    let digits = format!("{}", x.round() as i64);
    let mut out = String::new();
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push('_');
        }
        out.push(ch);
    }
    out
}

/// Scenario 1 at one subscription count, plus scenario 2's per-N
/// registration cost.
struct RoutingReport {
    n: usize,
    vocabulary: Vocabulary,
    registration: Duration,
    registered: IvmStats,
    runs: Vec<Run>,
}

/// Register `n` vocabulary subscriptions on an empty engine, then route
/// the insert and update streams — the same streams for every `n`.
fn routing_scale(n: usize) -> RoutingReport {
    let mut subscription_rng = XorShift64::new(SEED);
    let mut data_rng = XorShift64::new(SEED ^ 1);
    let tickets_table = tickets_table();
    let mut ivm: Single = Local::new(SingleTableIVM::new(), Rc::new(BenchStorage::default()));
    let filters: Vec<Where> = (0..n)
        .map(|_| random_filter(&mut subscription_rng))
        .collect();
    let mut vocabulary = Vocabulary::default();
    for filter in &filters {
        vocabulary.note(filter);
    }
    let started = Instant::now();
    for filter in filters {
        ivm.register_query(unbounded(&tickets_table, filter));
    }
    let registration = started.elapsed();
    let registered = ivm.engine().stats().clone();

    let mut tickets: Vec<Ticket> = (0..ROUTING_INSERTS)
        .map(|id| Ticket::random(&mut data_rng, id as i64))
        .collect();
    let inserts: Vec<WriteQuery> = tickets.iter().map(Ticket::insert).collect();
    let insert_run = route_all(&mut ivm, "insert", &inserts);

    let updates: Vec<WriteQuery> = (0..ROUTING_UPDATES)
        .map(|_| {
            let ticket = &mut tickets[data_rng.index(ROUTING_INSERTS)];
            ticket.status = data_rng.index(STATUSES.len());
            ticket.points = data_rng.below(POINTS_RANGE) as i64;
            ticket.update()
        })
        .collect();
    let route_only = search_all(&mut ivm, "update (route only)", &updates);
    let update_run = route_all(&mut ivm, "update", &updates);

    RoutingReport {
        n,
        vocabulary,
        registration,
        registered,
        runs: vec![insert_run, route_only, update_run],
    }
}

/// Scenarios 1 and 2a: run [`routing_scale`] at every N and print the
/// registration and routing tables.
fn routing_and_registration() {
    println!(
        "\n== 1. single-table routing scale ({ROUTING_INSERTS} inserts + {ROUTING_UPDATES} updates per N; storage: empty) =="
    );
    let reports: Vec<RoutingReport> = ROUTING_SIZES.into_iter().map(routing_scale).collect();

    println!("\nregistration (scenario 2a):");
    let registration_rows: Vec<Vec<String>> = reports
        .iter()
        .map(|report| {
            vec![
                report.n.to_string(),
                report.vocabulary.conditions.len().to_string(),
                report.vocabulary.disjuncts.len().to_string(),
                report.registered.disjuncts_registered.to_string(),
                report.registered.conditions_indexed.to_string(),
                report.registered.snapshots_shared.to_string(),
                one(report.registration.as_secs_f64() * 1e3),
                one(report.registration.as_secs_f64() * 1e6 / report.n as f64),
            ]
        })
        .collect();
    print_table(
        &[
            "N subs",
            "distinct conds",
            "distinct disjuncts",
            "disjuncts_registered",
            "conditions_indexed",
            "snapshots_shared",
            "total ms",
            "us/register",
        ],
        &registration_rows,
    );

    println!("\nrouting (per-write averages from IvmStats::diff):");
    let routing_rows: Vec<Vec<String>> = reports
        .iter()
        .flat_map(|report| {
            report.runs.iter().map(|run| {
                vec![
                    report.n.to_string(),
                    run.label.clone(),
                    run.writes.to_string(),
                    one(run.micros_per_write()),
                    whole(run.writes_per_second()),
                    one(run.per_write(run.stats.columns_probed)),
                    one(run.per_write(run.stats.conditions_evaluated)),
                    one(run.per_write(run.stats.disjunct_increments)),
                    one(run.per_write(run.stats.disjuncts_fired)),
                    one(run.per_write(run.stats.queries_impacted)),
                    one(run.per_write(run.stats.ops_add)),
                    one(run.per_write(run.stats.ops_delete)),
                ]
            })
        })
        .collect();
    print_table(
        &[
            "N subs",
            "phase",
            "writes",
            "us/write",
            "writes/s",
            "cols",
            "cond_match",
            "disj_incr",
            "disj_fired",
            "impacted",
            "ops_add",
            "ops_del",
        ],
        &routing_rows,
    );
}

/// Scenario 2b: the storage path (fresh engine, first registration of a
/// query over existing rows) against the twin path (identical
/// registrations served from the shared frame).
fn twin_sharing() {
    println!(
        "\n== 2b. twin sharing ({TWIN_ROWS} tickets in storage; `team = 7` registered once, then {TWIN_COPIES} identical copies) =="
    );
    let mut rng = XorShift64::new(SEED ^ 2);
    let tickets_table = tickets_table();
    let storage = Rc::new(BenchStorage::default());
    for id in 0..TWIN_ROWS {
        storage.apply(&Ticket::random(&mut rng, id as i64).insert());
    }
    let query = unbounded(&tickets_table, Where::condition("team", EQ, 7));

    let mut storage_path = Duration::ZERO;
    let mut snapshot_rows = 0;
    for _ in 0..TWIN_STORAGE_SAMPLES {
        let mut fresh: Single = Local::new(SingleTableIVM::new(), storage.clone());
        let started = Instant::now();
        snapshot_rows = fresh.register_query(query.clone()).1.len();
        storage_path += started.elapsed();
    }

    let mut ivm: Single = Local::new(SingleTableIVM::new(), storage.clone());
    let (first, _) = ivm.register_query(query.clone());
    let started = Instant::now();
    for _ in 0..TWIN_COPIES {
        ivm.register_query(query.clone());
    }
    let twin_path = started.elapsed();

    print_table(
        &[
            "snapshot rows",
            "storage-path us/register",
            "twin-path us/register",
            "twins registered",
            "snapshots_shared",
            "held rows in frame",
        ],
        &[vec![
            snapshot_rows.to_string(),
            one(storage_path.as_secs_f64() * 1e6 / TWIN_STORAGE_SAMPLES as f64),
            one(twin_path.as_secs_f64() * 1e6 / TWIN_COPIES as f64),
            TWIN_COPIES.to_string(),
            ivm.engine().stats().snapshots_shared.to_string(),
            ivm.engine()
                .rows_for(first)
                .map_or(0, |rows| rows.len())
                .to_string(),
        ]],
    );
}

/// The bench's client-side view of the windowed subscription — its page
/// — rebuilt from the operation stream exactly as a real client would;
/// used to aim the targeted workload at rows the client currently shows.
#[derive(Default)]
struct Mirror {
    held: Vec<(i64, i64)>,
}

impl Mirror {
    /// The integer `id` of a key.
    fn id_of(key: &DataFrameKey) -> i64 {
        match key.pkey_value.get("id") {
            Some(Value::Int(id)) => *id,
            _ => -1,
        }
    }

    /// The `points` of a row image.
    fn points_of(row: &DataFrameRow) -> i64 {
        match row.data.get("points") {
            Some(Value::Int(points)) => *points,
            _ => 0,
        }
    }

    /// Apply operations in emitted order; returns `(adds, deletes)`.
    fn apply(&mut self, ops: &[DataFrameOperation]) -> (u64, u64) {
        let mut adds = 0;
        let mut deletes = 0;
        for op in ops {
            match op {
                DataFrameOperation::Add(key, row) => {
                    adds += 1;
                    let id = Self::id_of(key);
                    let points = Self::points_of(row);
                    match self.held.iter_mut().find(|(held, _)| *held == id) {
                        Some(entry) => entry.1 = points,
                        None => self.held.push((id, points)),
                    }
                }
                DataFrameOperation::Delete(key, _) => {
                    deletes += 1;
                    let id = Self::id_of(key);
                    self.held.retain(|(held, _)| *held != id);
                }
            }
        }
        (adds, deletes)
    }

    /// The worst (largest) `points` on the page.
    fn worst_points(&self) -> i64 {
        self.held
            .iter()
            .map(|(_, points)| *points)
            .max()
            .unwrap_or(0)
    }

    /// A uniformly chosen id on the page, if any row is shown.
    fn random_id(&self, rng: &mut XorShift64) -> Option<i64> {
        if self.held.is_empty() {
            None
        } else {
            Some(self.held[rng.index(self.held.len())].0)
        }
    }
}

/// Scenario 3 state: the engine, storage, the client mirror, and the ids
/// alive in storage.
struct WindowBench {
    ivm: Single,
    storage: Rc<BenchStorage>,
    rng: XorShift64,
    mirror: Mirror,
    alive: Vec<i64>,
    next_id: i64,
    targeted_range: u64,
}

impl WindowBench {
    /// One workload of [`WINDOW_WRITES`] writes, a coin flip between insert
    /// and delete each. Uniform: random points, random victim. Targeted:
    /// points drawn from twice the initial boundary (so about half are
    /// admitted at first), victims drawn from the rows the client's page
    /// shows (every such delete moves the page and drains the buffer).
    fn run(&mut self, label: &str, targeted: bool) -> (Run, u64, u64) {
        let tickets_table = tickets_table();
        let before = self.ivm.engine().stats().clone();
        let mut elapsed = Duration::ZERO;
        let mut adds = 0;
        let mut deletes = 0;
        let mut returned = 0;
        for _ in 0..WINDOW_WRITES {
            let victim = if targeted {
                self.mirror.random_id(&mut self.rng)
            } else {
                Some(self.alive[self.rng.index(self.alive.len())])
            };
            let write = match victim.filter(|_| self.rng.below(2) == 1) {
                Some(id) => {
                    if let Some(position) = self.alive.iter().position(|&alive| alive == id) {
                        self.alive.swap_remove(position);
                    }
                    delete(&tickets_table, key(id))
                }
                None => {
                    let mut ticket = Ticket::random(&mut self.rng, self.next_id);
                    ticket.points = if targeted {
                        self.rng.below(self.targeted_range) as i64
                    } else {
                        self.rng.below(WINDOW_POINTS_RANGE) as i64
                    };
                    self.next_id += 1;
                    self.alive.push(ticket.id);
                    ticket.insert()
                }
            };
            self.storage.apply(&write);
            let started = Instant::now();
            let updates = self.ivm.incremental_update(&write);
            elapsed += started.elapsed();
            returned += updates.len() as u64;
            let ops: Vec<DataFrameOperation> =
                updates.into_iter().map(|update| update.op).collect();
            let (added, deleted) = self.mirror.apply(&ops);
            adds += added;
            deletes += deleted;
        }
        let run = Run {
            label: label.to_owned(),
            writes: WINDOW_WRITES as u64,
            elapsed,
            stats: self.ivm.engine().stats().diff(&before),
            returned,
        };
        (run, adds, deletes)
    }
}

/// Scenario 3: one `ORDER BY points ASC LIMIT 50` subscription over
/// 100_000 rows, under uniform and window-targeted writes.
fn window() {
    println!(
        "\n== 3. ORDER BY points ASC LIMIT {WINDOW_LIMIT} over {WINDOW_ROWS} storage rows ({WINDOW_WRITES} writes per workload, ~50/50 insert/delete) =="
    );
    let mut rng = XorShift64::new(SEED ^ 3);
    let tickets_table = tickets_table();
    let storage = Rc::new(BenchStorage::default());
    let mut alive = Vec::with_capacity(WINDOW_ROWS);
    for id in 0..WINDOW_ROWS {
        let mut ticket = Ticket::random(&mut rng, id as i64);
        ticket.points = rng.below(WINDOW_POINTS_RANGE) as i64;
        storage.apply(&ticket.insert());
        alive.push(ticket.id);
    }
    let mut ivm: Single = Local::new(SingleTableIVM::new(), storage.clone());
    let query = SingleTableReadQuery::new(
        tickets_table.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        WINDOW_LIMIT,
    );
    let started = Instant::now();
    let (_window_sub, snapshot) = ivm.register_query(query);
    let registration = started.elapsed();
    let snapshot: Vec<DataFrameOperation> = snapshot.into_iter().map(|update| update.op).collect();
    let mut mirror = Mirror::default();
    mirror.apply(&snapshot);
    let buffer = SingleTableReadQuery::new(
        tickets_table.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        WINDOW_LIMIT * 2,
    );
    let initial_boundary = storage
        .rows(&buffer)
        .last()
        .map_or(0, |(_, row)| Mirror::points_of(row));
    println!(
        "registration: {} snapshot rows (the page; the engine buffers {} behind it) in {} us; initial boundary points < {initial_boundary}",
        snapshot.len(),
        WINDOW_LIMIT * 2,
        one(registration.as_secs_f64() * 1e6)
    );

    let mut bench = WindowBench {
        ivm,
        storage,
        rng,
        mirror,
        alive,
        next_id: WINDOW_ROWS as i64,
        targeted_range: (initial_boundary as u64) * 2 + 1,
    };
    let workloads = [bench.run("uniform", false), bench.run("targeted", true)];
    let rows: Vec<Vec<String>> = workloads
        .iter()
        .map(|(run, adds, deletes)| {
            vec![
                run.label.clone(),
                run.writes.to_string(),
                two(run.micros_per_write()),
                whole(run.writes_per_second()),
                adds.to_string(),
                deletes.to_string(),
                run.stats.window_evictions.to_string(),
                run.stats.window_refills.to_string(),
                one(run.per_write(run.stats.columns_probed)),
                one(run.per_write(run.stats.conditions_evaluated)),
                one(run.per_write(run.stats.queries_impacted)),
                run.returned.to_string(),
            ]
        })
        .collect();
    print_table(
        &[
            "workload",
            "writes",
            "us/write",
            "writes/s",
            "client adds",
            "client deletes",
            "evictions",
            "refills",
            "cols",
            "cond_match",
            "impacted",
            "ops returned",
        ],
        &rows,
    );
    println!(
        "final: the client's page holds {} rows, its worst points {}",
        bench.mirror.held.len(),
        bench.mirror.worst_points()
    );
}

/// Scenario 4 state: the join layer, storage, and the bench's own copy of
/// the ticket and user rows it mutates.
struct JoinBench {
    ivm: Multi,
    storage: Rc<BenchStorage>,
    rng: XorShift64,
    tickets: Vec<Ticket>,
    user_versions: Vec<u64>,
}

impl JoinBench {
    /// Route writes through the join layer, mirroring each into storage
    /// first and timing the engine call alone; returns the run plus the
    /// main-part / join-part operation split.
    fn route(&mut self, label: &str, writes: &[WriteQuery]) -> (Run, u64, u64) {
        let before = self.ivm.engine().stats().clone();
        let mut main_ops = 0;
        let mut join_ops = 0;
        let mut elapsed = Duration::ZERO;
        for write in writes {
            self.storage.apply(write);
            let started = Instant::now();
            let updates = self.ivm.incremental_update(write);
            elapsed += started.elapsed();
            for target in updates.iter().flat_map(|update| update.targets()) {
                if target.part.is_main() {
                    main_ops += 1;
                } else {
                    join_ops += 1;
                }
            }
        }
        let run = Run {
            label: label.to_owned(),
            writes: writes.len() as u64,
            elapsed,
            stats: self.ivm.engine().stats().diff(&before),
            returned: main_ops + join_ops,
        };
        (run, main_ops, join_ops)
    }

    /// [`JOIN_TICKET_INSERTS`] fresh random tickets, assigned across all
    /// users.
    fn ticket_inserts(&mut self) -> (Run, u64, u64) {
        let mut writes = Vec::with_capacity(JOIN_TICKET_INSERTS);
        for _ in 0..JOIN_TICKET_INSERTS {
            let ticket = Ticket::random(&mut self.rng, self.tickets.len() as i64);
            writes.push(ticket.insert());
            self.tickets.push(ticket);
        }
        self.route("ticket insert", &writes)
    }

    /// [`JOIN_REASSIGNMENTS`] updates moving an existing ticket to another
    /// user, every other column unchanged.
    fn reassignments(&mut self) -> (Run, u64, u64) {
        let mut writes = Vec::with_capacity(JOIN_REASSIGNMENTS);
        for _ in 0..JOIN_REASSIGNMENTS {
            let index = self.rng.index(self.tickets.len());
            self.tickets[index].assigned_to = self.rng.below(USERS);
            writes.push(self.tickets[index].update());
        }
        self.route("ticket reassign", &writes)
    }

    /// [`JOIN_USER_UPDATES`] renames of random users — an in-place replace
    /// for every subscription holding the user.
    fn user_updates(&mut self) -> (Run, u64, u64) {
        let mut writes = Vec::with_capacity(JOIN_USER_UPDATES);
        for _ in 0..JOIN_USER_UPDATES {
            let user = self.rng.below(USERS);
            self.user_versions[user as usize] += 1;
            writes.push(user_update(user, self.user_versions[user as usize]));
        }
        self.route("user update", &writes)
    }
}

/// The join spec: `tickets WHERE <main> LEFT JOIN users ON assigned_to =
/// users.id`.
fn join_spec(main: Where) -> MultiTableReadQuery {
    MultiTableReadQuery::new(
        unbounded(&tickets_table(), main),
        vec![Join::left(
            MultiTableReadQuery::single(unbounded(&users_table(), Where::AND(vec![]))),
            "assigned_to",
            "id",
        )],
    )
}

/// Scenario 4: the LEFT JOIN layer under ticket inserts, ticket
/// reassignments, and user updates.
fn left_join() {
    println!(
        "\n== 4. tickets LEFT JOIN users ({JOIN_TWINS} identical `status = 'OPEN'` subscriptions + {JOIN_DISTINCT} distinct; {USERS} users, {JOIN_INITIAL_TICKETS} initial tickets) =="
    );
    let mut rng = XorShift64::new(SEED ^ 4);
    let storage = Rc::new(BenchStorage::default());
    let user_versions = vec![0u64; USERS as usize];
    for user in 0..USERS {
        storage.apply(&user_insert(user, 0));
    }
    let tickets: Vec<Ticket> = (0..JOIN_INITIAL_TICKETS)
        .map(|id| Ticket::random(&mut rng, id as i64))
        .collect();
    for ticket in &tickets {
        storage.apply(&ticket.insert());
    }
    let mut ivm: Multi = Local::new(MultiTableIVM::new(), storage.clone());

    let started = Instant::now();
    let mut twin_ops = 0;
    for _ in 0..JOIN_TWINS {
        twin_ops += ivm
            .register_query(join_spec(Where::condition("status", EQ, "OPEN")))
            .1
            .len();
    }
    let twins = started.elapsed();
    let after_twins = ivm.engine().stats().clone();
    let started = Instant::now();
    for index in 0..JOIN_DISTINCT {
        ivm.register_query(join_spec(distinct_join_filter(index)));
    }
    let distinct = started.elapsed();
    let after_distinct = ivm.engine().stats().clone();

    println!("\nregistration:");
    print_table(
        &[
            "group",
            "subs",
            "us/register",
            "snapshot ops/sub",
            "snapshots_shared",
            "disjuncts_registered",
            "conditions_indexed",
        ],
        &[
            vec![
                "identical".to_owned(),
                JOIN_TWINS.to_string(),
                one(twins.as_secs_f64() * 1e6 / JOIN_TWINS as f64),
                one(twin_ops as f64 / JOIN_TWINS as f64),
                after_twins.snapshots_shared.to_string(),
                after_twins.disjuncts_registered.to_string(),
                after_twins.conditions_indexed.to_string(),
            ],
            vec![
                "distinct".to_owned(),
                JOIN_DISTINCT.to_string(),
                one(distinct.as_secs_f64() * 1e6 / JOIN_DISTINCT as f64),
                String::from("-"),
                (after_distinct.snapshots_shared - after_twins.snapshots_shared).to_string(),
                (after_distinct.disjuncts_registered - after_twins.disjuncts_registered)
                    .to_string(),
                (after_distinct.conditions_indexed - after_twins.conditions_indexed).to_string(),
            ],
        ],
    );

    let mut bench = JoinBench {
        ivm,
        storage,
        rng,
        tickets,
        user_versions,
    };
    let phases = [
        bench.ticket_inserts(),
        bench.reassignments(),
        bench.user_updates(),
    ];
    println!("\nrouting:");
    let rows: Vec<Vec<String>> = phases
        .iter()
        .map(|(run, main_ops, join_ops)| {
            vec![
                run.label.clone(),
                run.writes.to_string(),
                one(run.micros_per_write()),
                whole(run.writes_per_second()),
                one(run.per_write(run.stats.columns_probed)),
                one(run.per_write(run.stats.conditions_evaluated)),
                one(run.per_write(run.stats.disjunct_increments)),
                one(run.per_write(run.stats.queries_impacted)),
                one(*main_ops as f64 / run.writes as f64),
                one(*join_ops as f64 / run.writes as f64),
                run.stats.conditions_replaced.to_string(),
                one(run.per_write(run.stats.conditions_replaced)),
            ]
        })
        .collect();
    print_table(
        &[
            "phase",
            "writes",
            "us/write",
            "writes/s",
            "cols",
            "cond_match",
            "disj_incr",
            "impacted",
            "main ops",
            "join ops",
            "conditions_replaced",
            "replaced/write",
        ],
        &rows,
    );
}

/// Run the four scenarios in order.

#[global_allocator]
static ALLOCATOR: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[unsafe(export_name = "_rjem_malloc_conf")]
static MALLOC_CONF: MallocConf =
    MallocConf(c"prof:true,prof_active:false,lg_prof_sample:19".as_ptr());

#[repr(transparent)]
struct MallocConf(*const std::ffi::c_char);

unsafe impl Sync for MallocConf {}

fn main() {
    println!(
        "streamgres bench: release build, single thread, xorshift seed {SEED:#x}, tables {} / {}",
        tickets_table().name,
        users_table().name
    );
    let profiler =
        match streamgres::profile::Config::from_env().and_then(streamgres::profile::start) {
            Ok(profiler) => profiler,
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        };
    if profiler.is_some() {
        println!("profiling: on, pushed to Pyroscope");
    }
    let started = Instant::now();
    if wanted("routing") {
        routing_and_registration();
    }
    if wanted("twins") {
        twin_sharing();
    }
    if wanted("release") {
        release_cost();
    }
    if wanted("memory") {
        memory_per_row();
    }
    if wanted("window") {
        window();
    }
    if wanted("join") {
        left_join();
    }
    if wanted("xyne") {
        production_query_workload();
    }
    if wanted("toast") {
        partial_images();
    }
    if wanted("postgres") {
        match std::env::var("STREAMGRES_PG_DSN") {
            Ok(dsn) if bench_database(&dsn) => postgres(&dsn),
            Ok(dsn) => println!(
                "\n== 5. postgres: skipped ({dsn} does not name a database with `bench` in its name; the scenario drops and recreates `users` and `tickets` there) =="
            ),
            Err(_) => println!(
                "\n== 5. postgres: skipped (set STREAMGRES_PG_DSN to a database with wal_level = logical and `bench` in its name) =="
            ),
        }
    }
    println!(
        "\ntotal wall time: {}s",
        one(started.elapsed().as_secs_f64())
    );
    drop(profiler);
}

/// Whether `dsn` names a database the postgres scenario may take over: one
/// with `bench` in its name, since the scenario drops and recreates the
/// `users` and `tickets` tables there.
fn bench_database(dsn: &str) -> bool {
    dsn.rsplit('/')
        .next()
        .map(|last| last.split('?').next().unwrap_or(last))
        .is_some_and(|name| name.contains("bench"))
}

/// Whether scenario `name` runs: every scenario unless
/// `STREAMGRES_BENCH_ONLY` names some (comma-separated: `routing`,
/// `twins`, `release`, `window`, `join`, `xyne`, `toast`, `postgres`).
fn wanted(name: &str) -> bool {
    std::env::var("STREAMGRES_BENCH_ONLY")
        .map(|only| only.split(',').any(|scenario| scenario.trim() == name))
        .unwrap_or(true)
}

/// This process's resident set, in kilobytes, as `ps` reports it.
fn rss_kb() -> u64 {
    std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|text| text.trim().parse().ok())
        .unwrap_or(0)
}

/// The columns of a message-like row, in the order a decoder lays them
/// out: the key first, the rest by name.
const MESSAGE_COLUMNS: [&str; 14] = [
    "messageId",
    "content",
    "conversationId",
    "createdAt",
    "edited",
    "hasAttachment",
    "isDeleted",
    "msgType",
    "parentMessageId",
    "senderId",
    "showInChannel",
    "updatedAt",
    "visibleTo",
    "workspaceId",
];

/// A message-like row image (fourteen columns, a 160-byte body) under
/// its key, laid out on the shared `schema` the way a decoded row is.
fn message_image(
    schema: &Arc<RowSchema>,
    key_schema: &Arc<RowSchema>,
    id: usize,
) -> (DataFrameKey, DataFrameRow) {
    let text = |prefix: &str| Value::from(format!("{prefix}{id:020}"));
    let body: String = std::iter::repeat_n("the quick brown fox ", 8).collect();
    let stamp = Value::Int(1_750_000_000_000 + id as i64);
    let values = vec![
        text("m"),
        Value::from(body),
        text("c"),
        stamp.clone(),
        Value::Bool(false),
        Value::Bool(false),
        Value::Bool(false),
        Value::from("TEXT"),
        Value::Null,
        text("u"),
        Value::Bool(true),
        stamp,
        Value::Null,
        text("w"),
    ];
    let key = DataFrameKey::with_schema(key_schema.clone(), vec![text("m")]);
    (
        key,
        DataFrameRow::from(RowData::with_schema(schema.clone(), values)),
    )
}

/// Scenario 2d: what a held row costs in memory. The images of 200 000
/// message-like rows are built (what decoding a read allocates), then a
/// subscription holds them all in a frame (the ids, the tags, the
/// per-row bookkeeping on top of the shared images); the resident set is
/// read from `ps` at each step.
fn memory_per_row() {
    println!(
        "\n== 2d. memory per held row ({MEMORY_ROWS} message-like rows of fourteen columns, one subscription holding them) =="
    );
    let baseline = rss_kb();
    let schema = RowSchema::new(MESSAGE_COLUMNS.map(ColumnName::from));
    let key_schema = RowSchema::new([ColumnName::from("messageId")]);
    let images: Vec<(DataFrameKey, DataFrameRow)> = (0..MEMORY_ROWS)
        .map(|id| message_image(&schema, &key_schema, id))
        .collect();
    let with_images = rss_kb();
    let storage = Rc::new(BenchStorage::default());
    for (key, row) in &images {
        storage.apply(&WriteQuery::INSERT(InsertQuery {
            table: TableName::from("messages"),
            pkey_value: key.clone(),
            record: row.clone(),
        }));
    }
    let with_storage = rss_kb();
    let mut ivm: Single = Local::new(SingleTableIVM::new(), storage.clone());
    let query = SingleTableReadQuery::new(
        TableName::from("messages"),
        Where::AND(vec![]),
        OrderBy::new("messageId", Order::ASC),
        u32::MAX,
    );
    let (sub, ops) = ivm.register_query(query);
    let held = ops.len();
    drop(ops);
    let with_frame = rss_kb();
    let per = |from: u64, to: u64| (to.saturating_sub(from) * 1024) as f64 / MEMORY_ROWS as f64;
    print_table(
        &[
            "rows",
            "held",
            "bytes/row: image (as decoded)",
            "bytes/row: storage double's map",
            "bytes/row: frame + one subscription's tags",
            "RSS MB baseline -> images -> frame",
        ],
        &[vec![
            MEMORY_ROWS.to_string(),
            held.to_string(),
            one(per(baseline, with_images)),
            one(per(with_images, with_storage)),
            one(per(with_storage, with_frame)),
            format!(
                "{} -> {} -> {}",
                baseline / 1024,
                with_images / 1024,
                with_frame / 1024
            ),
        ]],
    );
    let _ = ivm.unregister_query(sub);
    drop(images);
}

/// Scenario 2c: what releasing a subscription costs the engine. 1 000
/// subscriptions with distinct filters (`team = t AND points >= p`) over
/// 20 000 tickets, each holding a few hundred rows shared with the
/// others on its team; every fifth is released first, while the others
/// still hold most of its rows, then the rest, whose release drops the
/// rows nobody holds any more.
fn release_cost() {
    println!(
        "\n== 2c. release cost ({RELEASE_SUBS} distinct subscriptions over {RELEASE_ROWS} tickets; every fifth released first, then the rest) =="
    );
    let mut rng = XorShift64::new(SEED ^ 5);
    let tickets_table = tickets_table();
    let storage = Rc::new(BenchStorage::default());
    for id in 0..RELEASE_ROWS {
        storage.apply(&Ticket::random(&mut rng, id as i64).insert());
    }
    let mut ivm: Single = Local::new(SingleTableIVM::new(), storage.clone());
    let mut subs = Vec::with_capacity(RELEASE_SUBS);
    let mut held = 0usize;
    let started = Instant::now();
    for i in 0..RELEASE_SUBS {
        let team = (i % TEAMS as usize) as i64;
        let points = ((i / TEAMS as usize) % POINTS_RANGE as usize) as i64;
        let query = unbounded(
            &tickets_table,
            Where::AND(vec![
                Where::condition("team", EQ, team),
                Where::condition("points", GTE, points),
            ]),
        );
        let (sub, ops) = ivm.register_query(query);
        held += ops.len();
        subs.push(sub);
    }
    let registered = started.elapsed();
    let time_releases = |ivm: &mut Single, pick: &dyn Fn(usize) -> bool| {
        let mut engine = Duration::ZERO;
        let mut freeing = Duration::ZERO;
        let mut worst = Duration::ZERO;
        let mut count = 0usize;
        for (index, sub) in subs.iter().enumerate() {
            if pick(index) {
                let started = Instant::now();
                let dead = ivm.unregister_query(*sub);
                let took = started.elapsed();
                let freed = Instant::now();
                drop(dead);
                freeing += freed.elapsed();
                engine += took;
                worst = worst.max(took);
                count += 1;
            }
        }
        let per = |total: Duration| total.as_secs_f64() * 1e6 / count.max(1) as f64;
        (per(engine), per(freeing), worst)
    };
    let (shared_us, shared_free, shared_worst) = time_releases(&mut ivm, &|index| index % 5 == 0);
    let (last_us, last_free, last_worst) = time_releases(&mut ivm, &|index| index % 5 != 0);
    print_table(
        &[
            "subs",
            "rows held/sub",
            "us/register",
            "us/release (others hold)",
            "worst",
            "us/release (last holder)",
            "worst",
            "us freeing (off-thread in the server)",
        ],
        &[vec![
            RELEASE_SUBS.to_string(),
            (held / RELEASE_SUBS).to_string(),
            one(registered.as_secs_f64() * 1e6 / RELEASE_SUBS as f64),
            one(shared_us),
            format!("{}us", shared_worst.as_micros()),
            one(last_us),
            format!("{}us", last_worst.as_micros()),
            format!("{} / {}", one(shared_free), one(last_free)),
        ]],
    );
}

/// The SQL literal of one ticket row.
fn ticket_values(ticket: &Ticket) -> String {
    format!(
        "({}, '{}', '{}', '{}', {}, {})",
        ticket.id,
        STATUSES[ticket.status],
        PRIORITIES[ticket.priority],
        user_id(ticket.assigned_to),
        ticket.points,
        ticket.team
    )
}

/// Where the wall time of one drain went.
///
/// - `poll`: awaiting the feed (the slot query plus text decoding).
/// - `reads` / `reads_run`: awaiting storage reads, and how many.
/// - `route`: inside the runtime (routing writes, landing reads).
/// - `delivered`: writes the feed delivered.
#[derive(Default)]
struct DrainCost {
    poll: Duration,
    reads: Duration,
    reads_run: usize,
    route: Duration,
    delivered: usize,
}

/// One scenario-5 measurement row.
struct PgRow {
    mode: &'static str,
    registration: Duration,
    registration_cost: DrainCost,
    twin: Duration,
    commit: Duration,
    stream: Duration,
    stream_cost: DrainCost,
    load_settle: Duration,
    load_rows: usize,
    load_refreshed: u64,
    load_dropped: u64,
}

/// The stream moved: tell the storage and learn its floor (what the
/// drivers do after every write and progress mark).
fn moved(runtime: &mut Runtime<MultiTableIVM>, storage: &PgStorage) {
    storage.advance(runtime.position());
    runtime.set_floor(storage.floor());
}

/// Run every read out against `storage`, poll `stream` to move the feed,
/// and repeat until nothing is out and `expect_writes` have been
/// delivered; returns where the time went.
async fn pg_drain(
    runtime: &mut Runtime<MultiTableIVM>,
    storage: &PgStorage,
    stream: &mut PgStream,
    mut pending: Vec<Fetch>,
    expect_writes: usize,
) -> DrainCost {
    let mut cost = DrainCost::default();
    loop {
        while !pending.is_empty() {
            let mut next = Vec::new();
            for fetch in pending.drain(..) {
                let started = Instant::now();
                let snapshot = storage.select(&fetch.query).await.expect("select");
                cost.reads += started.elapsed();
                cost.reads_run += 1;
                let started = Instant::now();
                let step = runtime.fetched(fetch.id, snapshot);
                cost.route += started.elapsed();
                next.extend(step.selects);
            }
            pending = next;
        }
        if runtime.outstanding() == 0 && cost.delivered >= expect_writes {
            return cost;
        }
        let started = Instant::now();
        let batch = stream.poll().await.expect("poll");
        cost.poll += started.elapsed();
        for (write, at) in batch.writes {
            cost.delivered += 1;
            let started = Instant::now();
            let step = runtime.write(&write, at);
            moved(runtime, storage);
            cost.route += started.elapsed();
            pending.extend(step.selects);
        }
        let started = Instant::now();
        let step = runtime.progress(batch.progress);
        moved(runtime, storage);
        cost.route += started.elapsed();
        pending.extend(step.selects);
        if pending.is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

/// Load the scenario's tables afresh: `USERS` users and `PG_TICKETS`
/// random tickets, the same rows for every mode.
async fn pg_load(admin: &tokio_postgres::Client) {
    admin
        .batch_execute(
            "DROP TABLE IF EXISTS tickets; DROP TABLE IF EXISTS users;
             CREATE TABLE users (id text PRIMARY KEY, name text, team int8);
             CREATE TABLE tickets (id int8 PRIMARY KEY, status text, priority text, assigned_to text, points int8, team int8);",
        )
        .await
        .expect("create tables");
    let users: Vec<String> = (0..USERS)
        .map(|n| format!("('{}', 'user {n} v0', {})", user_id(n), n % TEAMS))
        .collect();
    admin
        .batch_execute(&format!("INSERT INTO users VALUES {}", users.join(", ")))
        .await
        .expect("load users");
    let mut rng = XorShift64::new(SEED ^ 5);
    let tickets: Vec<String> = (0..PG_TICKETS)
        .map(|id| ticket_values(&Ticket::random(&mut rng, id as i64)))
        .collect();
    admin
        .batch_execute(&format!(
            "INSERT INTO tickets VALUES {}",
            tickets.join(", ")
        ))
        .await
        .expect("load tickets");
}

/// Scenario 5 (see [`postgres`]), over freshly loaded tables.
async fn pg_run(dsn: &str) -> PgRow {
    let catalog = Arc::new(Catalog::new(vec![tickets_table(), users_table()]));
    let (admin, connection) = tokio_postgres::connect(dsn, tokio_postgres::NoTls)
        .await
        .expect("connect");
    tokio::task::spawn_local(async move {
        let _ = connection.await;
    });
    pg_load(&admin).await;
    let mut rng = XorShift64::new(SEED ^ 6);
    let mut next_id = PG_TICKETS as i64;
    let (rng, next_id) = (&mut rng, &mut next_id);
    PgStream::drop_slot(dsn, PG_SLOT, PG_PUBLICATION)
        .await
        .expect("drop slot");
    admin
        .batch_execute(&format!(
            "CREATE PUBLICATION \"{PG_PUBLICATION}\" FOR ALL TABLES"
        ))
        .await
        .expect("publication");
    let mut stream = PgStream::open(dsn, PG_SLOT, PG_PUBLICATION, catalog.clone())
        .await
        .expect("open stream");
    let storage = PgStorage::connect(dsn, catalog.clone())
        .await
        .expect("connect");
    let mut runtime = Runtime::new(MultiTableIVM::new());
    let first = stream.poll().await.expect("poll");
    runtime.progress(first.progress);
    moved(&mut runtime, &storage);

    let started = Instant::now();
    let (_, step) = runtime.register(join_spec(Where::condition("status", EQ, "OPEN")));
    let registration_cost = pg_drain(&mut runtime, &storage, &mut stream, step.selects, 0).await;
    let registration = started.elapsed();
    let started = Instant::now();
    for _ in 0..JOIN_TWINS {
        runtime.register(join_spec(Where::condition("status", EQ, "OPEN")));
    }
    let twin = started.elapsed() / JOIN_TWINS as u32;

    let started = Instant::now();
    for _ in 0..PG_WRITES / PG_WRITES_PER_TXN {
        let values: Vec<String> = (0..PG_WRITES_PER_TXN)
            .map(|_| {
                let ticket = Ticket::random(rng, *next_id);
                *next_id += 1;
                ticket_values(&ticket)
            })
            .collect();
        admin
            .batch_execute(&format!("INSERT INTO tickets VALUES {}", values.join(", ")))
            .await
            .expect("insert");
    }
    let commit = started.elapsed();
    let started = Instant::now();
    let stream_cost = pg_drain(&mut runtime, &storage, &mut stream, Vec::new(), PG_WRITES).await;
    let stream_time = started.elapsed();

    let slow = PgStorage::connect(dsn, catalog.clone())
        .await
        .expect("connect")
        .with_read_delay(Duration::from_millis(300));
    let passed = stream.poll().await.expect("poll");
    for (write, at) in passed.writes {
        runtime.write(&write, at);
    }
    runtime.progress(passed.progress);
    storage.advance(runtime.position());
    slow.advance(runtime.position());
    runtime.set_floor(storage.floor().min(slow.floor()));
    assert!(
        slow.alias_position().is_some(),
        "one poll after connecting passes the storage's first alias"
    );
    let before = runtime.stats().clone();
    let started = Instant::now();
    let (_, step) = runtime.register(join_spec(Where::condition("team", EQ, 7i64)));
    let main = step
        .selects
        .into_iter()
        .next()
        .expect("the main part's read");
    let query = main.query.clone();
    let select = tokio::task::spawn_local(async move { slow.select(&query).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let values: Vec<String> = (0..PG_LOAD_WRITES)
        .map(|_| {
            let mut ticket = Ticket::random(rng, *next_id);
            ticket.team = 7;
            *next_id += 1;
            ticket_values(&ticket)
        })
        .collect();
    admin
        .batch_execute(&format!(
            "INSERT INTO tickets VALUES {}; UPDATE tickets SET points = points + 1 WHERE team = 7 AND id < {};",
            values.join(", "),
            PG_TICKETS
        ))
        .await
        .expect("load writes");
    let behind = stream.poll().await.expect("poll");
    let mut pending = Vec::new();
    for (write, at) in behind.writes {
        pending.extend(runtime.write(&write, at).selects);
        moved(&mut runtime, &storage);
    }
    pending.extend(runtime.progress(behind.progress).selects);
    moved(&mut runtime, &storage);
    let snapshot = select.await.expect("join").expect("select");
    let snapshot_rows = snapshot.rows.len();
    pending.extend(runtime.fetched(main.id, snapshot).selects);
    pg_drain(&mut runtime, &storage, &mut stream, pending, 0).await;
    let load_settle = started.elapsed();
    let after = runtime.stats();

    PgStream::drop_slot(dsn, PG_SLOT, PG_PUBLICATION)
        .await
        .expect("drop slot");
    PgRow {
        mode: "wal",
        registration,
        registration_cost,
        twin,
        commit,
        stream: stream_time,
        stream_cost,
        load_settle,
        load_rows: snapshot_rows,
        load_refreshed: after.rows_refreshed - before.rows_refreshed,
        load_dropped: after.rows_dropped - before.rows_dropped,
    }
}

/// Scenario 5: the runtime over Postgres.
fn postgres(dsn: &str) {
    println!(
        "\n== 5. postgres: tickets LEFT JOIN users over real tables ({USERS} users, {PG_TICKETS} tickets loaded; {PG_WRITES} inserts streamed in transactions of {PG_WRITES_PER_TXN}; {PG_LOAD_WRITES} writes behind an open snapshot) =="
    );
    let tokio = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let (rows, partial) = tokio::task::LocalSet::new().block_on(&tokio, async {
        (vec![pg_run(dsn).await], pg_partial(dsn).await)
    });
    println!(
        "\nregistration (first subscription of a spec: two reads; then {JOIN_TWINS} identical ones from the shared tree):"
    );
    print_table(
        &[
            "mode",
            "end to end ms",
            "reads",
            "in storage ms",
            "in runtime us",
            "twin us/register",
        ],
        &rows
            .iter()
            .map(|row| {
                vec![
                    row.mode.to_owned(),
                    one(row.registration.as_secs_f64() * 1e3),
                    row.registration_cost.reads_run.to_string(),
                    one(row.registration_cost.reads.as_secs_f64() * 1e3),
                    one(row.registration_cost.route.as_secs_f64() * 1e6),
                    one(row.twin.as_secs_f64() * 1e6),
                ]
            })
            .collect::<Vec<_>>(),
    );
    println!(
        "\nstreamed writes ({PG_WRITES} inserts committed in transactions of {PG_WRITES_PER_TXN}, then polled, decoded and routed to {} subscribers):",
        JOIN_TWINS + 1
    );
    print_table(
        &[
            "mode",
            "commit ms",
            "stream ms",
            "poll+decode ms",
            "narrowed reads",
            "reads ms",
            "route us/write",
            "end-to-end writes/s",
        ],
        &rows
            .iter()
            .map(|row| {
                vec![
                    row.mode.to_owned(),
                    one(row.commit.as_secs_f64() * 1e3),
                    one(row.stream.as_secs_f64() * 1e3),
                    one(row.stream_cost.poll.as_secs_f64() * 1e3),
                    row.stream_cost.reads_run.to_string(),
                    one(row.stream_cost.reads.as_secs_f64() * 1e3),
                    two(row.stream_cost.route.as_secs_f64() * 1e6
                        / row.stream_cost.delivered.max(1) as f64),
                    whole(
                        row.stream_cost.delivered as f64 / (row.commit + row.stream).as_secs_f64(),
                    ),
                ]
            })
            .collect::<Vec<_>>(),
    );
    println!(
        "\nregistration under load (snapshot held open 300 ms while {PG_LOAD_WRITES} inserts and updates of the matching rows commit and are delivered behind it):"
    );
    print_table(
        &[
            "mode",
            "settle ms",
            "snapshot rows",
            "rows refreshed",
            "rows dropped",
        ],
        &rows
            .iter()
            .map(|row| {
                vec![
                    row.mode.to_owned(),
                    one(row.load_settle.as_secs_f64() * 1e3),
                    row.load_rows.to_string(),
                    row.load_refreshed.to_string(),
                    row.load_dropped.to_string(),
                ]
            })
            .collect::<Vec<_>>(),
    );
    println!(
        "\na row an update brings into a subscription nobody else holds it for ({PG_PARTIAL_WRITES} updates each, committed one at a time; {TOAST_MD_CHARS}-character md stored out of line; time from routing the update to the client's Add, reads included):"
    );
    print_table(
        &[
            "update",
            "writes",
            "p50 us",
            "p95 us",
            "max us",
            "reads/write",
            "every add whole",
        ],
        &partial,
    );
}

/// A full row image of the xyne table `table`: every declared column,
/// `pairs` where given, `NULL` elsewhere, with its key.
fn xy_row(table: &str, pairs: &[(&str, Value)]) -> (DataFrameKey, DataFrameRow) {
    let mut data: HashMap<ColumnName, Value> = workload::columns(table)
        .iter()
        .map(|(column, _)| (ColumnName::from(*column), Value::Null))
        .collect();
    for (column, value) in pairs {
        data.insert(ColumnName::from(*column), value.clone());
    }
    let key = DataFrameKey::new([(workload::pkey(table), data[workload::pkey(table)].clone())]);
    (key, DataFrameRow::from(data))
}

/// An INSERT of one xyne row.
fn xy_insert(table: &str, pairs: &[(&str, Value)]) -> WriteQuery {
    let (pkey_value, record) = xy_row(table, pairs);
    WriteQuery::INSERT(InsertQuery {
        table: table.into(),
        pkey_value,
        record,
    })
}

/// An UPDATE carrying one xyne row's full image.
fn xy_update(table: &str, pairs: &[(&str, Value)]) -> WriteQuery {
    let (pkey_value, record) = xy_row(table, pairs);
    WriteQuery::UPDATE(UpdateQuery {
        table: table.into(),
        pkey_value,
        record,
    })
}

/// A DELETE of one xyne row by its string id.
fn xy_delete(table: &str, id: &str) -> WriteQuery {
    WriteQuery::DELETE(DeleteQuery {
        table: table.into(),
        pkey_value: DataFrameKey::new([(workload::pkey(table), Value::from(id))]),
    })
}

/// A single-table query on a xyne table, ordered by its key, unbounded.
fn xy_query(table: &str, filter: Where) -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        table,
        filter,
        OrderBy::new(workload::pkey(table), Order::ASC),
        u32::MAX,
    )
}

/// A join edge along the schema relationship `name` of `table`.
fn xy_left(table: &str, name: &str, sub: MultiTableReadQuery) -> Join {
    let rel = workload::rel(table, name);
    Join::left(sub, rel.source, rel.dest)
}

/// The INNER edge (driven from the sub) of the xyne relationship `name`
/// of `table` to `sub`.
fn xy_inner(table: &str, name: &str, sub: MultiTableReadQuery) -> Join {
    let rel = workload::rel(table, name);
    Join::inner(sub, rel.source, rel.dest)
}

/// The channel-access rule for `user`: public, or a channel the user
/// participates in, the existence test inside the `OR`.
fn xy_channel_access(user: &str) -> MultiTableReadQuery {
    MultiTableReadQuery::new(
        xy_query(
            "channels",
            Where::OR(vec![
                Where::condition("visibility", EQ, "PUBLIC"),
                Where::exists(workload::rel("channels", "participants").source, 0),
            ]),
        ),
        vec![xy_inner(
            "channels",
            "participants",
            MultiTableReadQuery::single(xy_query(
                "channel_participants",
                Where::condition("userId", EQ, user),
            )),
        )],
    )
}

/// `browsableChannels` for `user`: regular channels the user may see, with
/// their participants.
fn xy_browsable(user: &str) -> MultiTableReadQuery {
    let mut spec = xy_channel_access(user);
    spec.main_table.filter = Where::AND(vec![
        Where::condition("scopeType", EQ, "DEFAULT"),
        spec.main_table.filter,
    ]);
    spec.joins.push(xy_left(
        "channels",
        "participants",
        MultiTableReadQuery::single(xy_query("channel_participants", Where::AND(vec![]))),
    ));
    spec
}

/// `conversationMessages` for `user` on `conversation`, under the ACL:
/// the visibility rule on the messages, the conversation an INNER edge,
/// its channel another, the channel's access rule a third.
fn xy_thread(user: &str, conversation: &str) -> MultiTableReadQuery {
    MultiTableReadQuery::new(
        xy_query(
            "messages",
            Where::AND(vec![
                Where::condition("conversationId", EQ, conversation),
                Where::OR(vec![
                    Where::is_null("visibleTo"),
                    Where::condition("visibleTo", EQ, user),
                ]),
            ]),
        ),
        vec![xy_inner(
            "messages",
            "conversation",
            MultiTableReadQuery::new(
                xy_query(
                    "conversations",
                    Where::condition("conversationId", EQ, conversation),
                ),
                vec![xy_inner(
                    "conversations",
                    "channel",
                    xy_channel_access(user),
                )],
            ),
        )],
    )
}

/// The board view of `board`: a page of [`XY_BOARD_PAGE`] root,
/// non-Support tickets, newest first with `id` as the tiebreak, with
/// their assignments and stage ETAs.
fn xy_board(board: &str) -> MultiTableReadQuery {
    MultiTableReadQuery::new(
        SingleTableReadQuery::new(
            "tickets",
            Where::AND(vec![
                Where::condition("boardId", EQ, board),
                Where::is_null("rootId"),
                Where::OR(vec![
                    Where::condition("ticketType", ComparisonOperator::NEQ, "Support"),
                    Where::is_null("ticketType"),
                ]),
            ]),
            vec![
                OrderBy::new("createdAt", Order::DESC),
                OrderBy::new("id", Order::ASC),
            ],
            XY_BOARD_PAGE,
        ),
        vec![
            xy_left(
                "tickets",
                "assignments",
                MultiTableReadQuery::single(xy_query("ticket_assignments", Where::AND(vec![]))),
            ),
            xy_left(
                "tickets",
                "stageEtaEntries",
                MultiTableReadQuery::single(xy_query("ticket_stage_eta", Where::AND(vec![]))),
            ),
        ],
    )
}

/// The memberships of the synthetic workspace as `(participant id,
/// channel, user)`, and its tickets' columns.
type XyWorkspace = (Vec<(String, u64, u64)>, Vec<Vec<(&'static str, Value)>>);

/// The synthetic workspace: users, channels (public and private), each
/// user's memberships, conversations with their messages (most visible to
/// everyone, some to one user), and boards with tickets, assignments and
/// stage ETAs. Returns the memberships for the churn phase and the tickets
/// for the update phase.
fn xy_load(storage: &BenchStorage, rng: &mut XorShift64) -> XyWorkspace {
    for user in 0..XY_USERS {
        storage.apply(&xy_insert(
            "users",
            &[
                ("id", Value::from(format!("u{user}"))),
                ("name", Value::from(format!("user {user}"))),
            ],
        ));
    }
    for channel in 0..XY_CHANNELS {
        let visibility = if channel < XY_PUBLIC_CHANNELS {
            "PUBLIC"
        } else {
            "PRIVATE"
        };
        storage.apply(&xy_insert(
            "channels",
            &[
                ("id", Value::from(format!("c{channel}"))),
                ("name", Value::from(format!("channel {channel}"))),
                ("type", Value::from("DEFAULT")),
                ("scopeType", Value::from("DEFAULT")),
                ("visibility", Value::from(visibility)),
            ],
        ));
    }
    let mut memberships = Vec::new();
    for user in 0..XY_USERS {
        let mut joined: Vec<u64> = Vec::new();
        while joined.len() < XY_MEMBERSHIPS_PER_USER as usize {
            let channel = rng.below(XY_CHANNELS);
            if !joined.contains(&channel) {
                joined.push(channel);
            }
        }
        for channel in joined {
            let id = format!("cp{}", memberships.len());
            storage.apply(&xy_insert(
                "channel_participants",
                &[
                    ("id", Value::from(id.as_str())),
                    ("channelId", Value::from(format!("c{channel}"))),
                    ("userId", Value::from(format!("u{user}"))),
                    ("role", Value::from("MEMBER")),
                ],
            ));
            memberships.push((id, channel, user));
        }
    }
    let mut message = 0u64;
    for channel in 0..XY_CHANNELS {
        for slot in 0..XY_CONVERSATIONS_PER_CHANNEL {
            let conversation = channel * XY_CONVERSATIONS_PER_CHANNEL + slot;
            storage.apply(&xy_insert(
                "conversations",
                &[
                    ("conversationId", Value::from(format!("cv{conversation}"))),
                    ("channelId", Value::from(format!("c{channel}"))),
                    ("initialMessageId", Value::from(format!("m{message}"))),
                    ("createdAt", Value::Int(conversation as i64)),
                    ("lastActivityAt", Value::Int(conversation as i64)),
                ],
            ));
            for _ in 0..XY_MESSAGES_PER_CONVERSATION {
                storage.apply(&xy_message(rng, message, conversation));
                message += 1;
            }
        }
    }
    let mut tickets = Vec::with_capacity(XY_TICKETS as usize);
    for ticket in 0..XY_TICKETS {
        let columns = xy_ticket(rng, ticket, "Todo");
        storage.apply(&xy_insert("tickets", &columns));
        tickets.push(columns);
        storage.apply(&xy_insert(
            "ticket_assignments",
            &[
                ("id", Value::from(format!("a{ticket}"))),
                ("ticketId", Value::from(format!("t{ticket}"))),
                ("userId", Value::from(format!("u{}", rng.below(XY_USERS)))),
                ("userResponsibility", Value::from("ASSIGNEE")),
            ],
        ));
        storage.apply(&xy_insert(
            "ticket_stage_eta",
            &[
                ("id", Value::from(format!("e{ticket}"))),
                ("ticketId", Value::from(format!("t{ticket}"))),
                ("stageEta", Value::Int(rng.below(1_000) as i64)),
            ],
        ));
    }
    (memberships, tickets)
}

/// One message in `conversation`, visible to everyone nine times in ten
/// and to one random user otherwise.
fn xy_message(rng: &mut XorShift64, message: u64, conversation: u64) -> WriteQuery {
    let visible_to = if rng.below(10) == 0 {
        Value::from(format!("u{}", rng.below(XY_USERS)))
    } else {
        Value::Null
    };
    xy_insert(
        "messages",
        &[
            ("messageId", Value::from(format!("m{message}"))),
            ("conversationId", Value::from(format!("cv{conversation}"))),
            ("senderId", Value::from(format!("u{}", rng.below(XY_USERS)))),
            ("visibleTo", visible_to),
            ("createdAt", Value::Int(message as i64)),
            ("showInChannel", Value::Bool(true)),
            ("isDeleted", Value::Bool(false)),
        ],
    )
}

/// The columns of one ticket on a random board: untyped one time in ten,
/// Support one time in ten, a flow step under another ticket one time in
/// five.
fn xy_ticket(rng: &mut XorShift64, ticket: u64, stage: &str) -> Vec<(&'static str, Value)> {
    let ticket_type = match rng.below(10) {
        0 => Value::Null,
        1 => Value::from("Support"),
        2..=5 => Value::from("Task"),
        _ => Value::from("Bug"),
    };
    let root = if rng.below(5) == 0 {
        Value::from(format!("t{}", rng.below(XY_TICKETS)))
    } else {
        Value::Null
    };
    vec![
        ("id", Value::from(format!("t{ticket}"))),
        ("boardId", Value::from(format!("b{}", rng.below(XY_BOARDS)))),
        ("projectId", Value::from("p1")),
        ("stageName", Value::from(stage)),
        ("statusV2", Value::from("OPEN")),
        (
            "assignedTo",
            Value::from(format!("u{}", rng.below(XY_USERS))),
        ),
        ("createdAt", Value::Int(ticket as i64)),
        ("isArchived", Value::Bool(false)),
        ("ticketType", ticket_type),
        ("rootId", root),
    ]
}

/// Register `count` subscriptions built by `spec`, timing the whole batch;
/// returns the mean microseconds per registration, the snapshot
/// operations delivered, and the storage reads it took.
fn xy_register(
    ivm: &mut Multi,
    count: u64,
    mut spec: impl FnMut(u64) -> MultiTableReadQuery,
) -> (f64, u64, u64) {
    let before = ivm.engine().stats().clone();
    let started = Instant::now();
    let mut ops = 0u64;
    for index in 0..count {
        ops += ivm.register_query(spec(index)).1.len() as u64;
    }
    let elapsed = started.elapsed();
    let after = ivm.engine().stats().diff(&before);
    (
        elapsed.as_secs_f64() * 1e6 / count as f64,
        ops,
        after.storage_reads,
    )
}

/// Route `writes`, mirroring each into storage first and timing the
/// engine call alone: the run, and the client updates it produced.
fn xy_route(
    ivm: &mut Multi,
    storage: &BenchStorage,
    label: &str,
    writes: &[WriteQuery],
) -> (Run, u64) {
    let before = ivm.engine().stats().clone();
    let mut elapsed = Duration::ZERO;
    let mut delivered = 0u64;
    for write in writes {
        storage.apply(write);
        let started = Instant::now();
        let updates = ivm.incremental_update(write);
        elapsed += started.elapsed();
        delivered += updates
            .iter()
            .map(|update| update.target_count() as u64)
            .sum::<u64>();
    }
    let run = Run {
        label: label.to_owned(),
        writes: writes.len() as u64,
        elapsed,
        stats: ivm.engine().stats().diff(&before),
        returned: delivered,
    };
    (run, delivered)
}

/// Scenario 6: production-app query shapes over synthetic data.
fn production_query_workload() {
    println!(
        "\n== 6. production query workload: browsableChannels, conversationMessages under the channel ACL, the board view as a page of {XY_BOARD_PAGE} ({XY_USERS} users, {XY_CHANNELS} channels, {} conversations, {} messages, {XY_TICKETS} tickets on {XY_BOARDS} boards) ==",
        XY_CHANNELS * XY_CONVERSATIONS_PER_CHANNEL,
        XY_CHANNELS * XY_CONVERSATIONS_PER_CHANNEL * XY_MESSAGES_PER_CONVERSATION
    );
    let mut rng = XorShift64::new(SEED ^ 7);
    let storage = Rc::new(BenchStorage::default());
    let (mut memberships, mut tickets) = xy_load(&storage, &mut rng);
    let mut ivm: Multi = Local::new(MultiTableIVM::new(), storage.clone());

    let (browsable_us, browsable_ops, browsable_reads) =
        xy_register(&mut ivm, XY_USERS, |user| xy_browsable(&format!("u{user}")));
    let threads: Vec<(u64, u64)> = (0..XY_USERS)
        .flat_map(|user| {
            (0..XY_THREADS_PER_USER).map(move |slot| {
                (
                    user,
                    (user * 7 + slot * 131) % (XY_CHANNELS * XY_CONVERSATIONS_PER_CHANNEL),
                )
            })
        })
        .collect();
    let (thread_us, thread_ops, thread_reads) =
        xy_register(&mut ivm, threads.len() as u64, |index| {
            let (user, conversation) = threads[index as usize];
            xy_thread(&format!("u{user}"), &format!("cv{conversation}"))
        });
    let (board_us, board_ops, board_reads) = xy_register(&mut ivm, XY_USERS, |user| {
        xy_board(&format!("b{}", user % XY_BOARDS))
    });
    let stats = ivm.engine().stats().clone();
    println!(
        "\nregistration (one subscription per user; the board view shared by {} users per board):",
        XY_USERS / XY_BOARDS
    );
    print_table(
        &[
            "query",
            "subs",
            "trees",
            "us/register",
            "snapshot ops/sub",
            "storage reads",
        ],
        &[
            vec![
                "browsableChannels".to_owned(),
                XY_USERS.to_string(),
                XY_USERS.to_string(),
                one(browsable_us),
                one(browsable_ops as f64 / XY_USERS as f64),
                browsable_reads.to_string(),
            ],
            vec![
                "conversationMessages + ACL".to_owned(),
                threads.len().to_string(),
                threads.len().to_string(),
                one(thread_us),
                one(thread_ops as f64 / threads.len() as f64),
                thread_reads.to_string(),
            ],
            vec![
                format!("board view (page of {XY_BOARD_PAGE})"),
                XY_USERS.to_string(),
                XY_BOARDS.to_string(),
                one(board_us),
                one(board_ops as f64 / XY_USERS as f64),
                board_reads.to_string(),
            ],
        ],
    );
    println!(
        "index after registration: {} disjuncts, {} conditions, {} snapshots shared",
        stats.disjuncts_registered, stats.conditions_indexed, stats.snapshots_shared
    );

    let mut message = XY_CHANNELS * XY_CONVERSATIONS_PER_CHANNEL * XY_MESSAGES_PER_CONVERSATION;
    let mut inserts = Vec::with_capacity(XY_MESSAGE_INSERTS);
    for _ in 0..XY_MESSAGE_INSERTS {
        let conversation = rng.below(XY_CHANNELS * XY_CONVERSATIONS_PER_CHANNEL);
        inserts.push(xy_message(&mut rng, message, conversation));
        message += 1;
    }
    let mut churn = Vec::with_capacity(XY_MEMBERSHIP_CHURN);
    for step in 0..XY_MEMBERSHIP_CHURN {
        let index = rng.index(memberships.len());
        let (id, channel, user) = memberships[index].clone();
        if step % 2 == 0 {
            churn.push(xy_delete("channel_participants", &id));
            memberships.swap_remove(index);
        } else {
            let fresh = format!("cp{}", 100_000 + step);
            let channel = rng.below(XY_CHANNELS);
            churn.push(xy_insert(
                "channel_participants",
                &[
                    ("id", Value::from(fresh.as_str())),
                    ("channelId", Value::from(format!("c{channel}"))),
                    ("userId", Value::from(format!("u{user}"))),
                    ("role", Value::from("MEMBER")),
                ],
            ));
            memberships.push((fresh, channel, user));
        }
        let _ = channel;
    }
    let mut ticket_updates = Vec::with_capacity(XY_TICKET_UPDATES);
    for _ in 0..XY_TICKET_UPDATES {
        let ticket = rng.index(tickets.len());
        let stage = ["Todo", "Doing", "Review", "Done"][rng.index(4)];
        for (column, value) in tickets[ticket].iter_mut() {
            if *column == "stageName" {
                *value = Value::from(stage);
            }
        }
        ticket_updates.push(xy_update("tickets", &tickets[ticket]));
    }
    let phases = [
        xy_route(&mut ivm, &storage, "message insert", &inserts),
        xy_route(&mut ivm, &storage, "membership churn", &churn),
        xy_route(&mut ivm, &storage, "ticket update", &ticket_updates),
    ];
    println!(
        "\nrouting (to {} subscriptions):",
        XY_USERS + threads.len() as u64 + XY_USERS
    );
    let rows: Vec<Vec<String>> = phases
        .iter()
        .map(|(run, delivered)| {
            vec![
                run.label.clone(),
                run.writes.to_string(),
                one(run.micros_per_write()),
                whole(run.writes_per_second()),
                one(run.per_write(run.stats.conditions_evaluated)),
                one(run.per_write(run.stats.queries_impacted)),
                one(*delivered as f64 / run.writes as f64),
                run.stats.storage_reads.to_string(),
                run.stats.conditions_replaced.to_string(),
            ]
        })
        .collect();
    print_table(
        &[
            "phase",
            "writes",
            "us/write",
            "writes/s",
            "cond_match",
            "impacted",
            "client updates/write",
            "narrowed reads",
            "set edits",
        ],
        &rows,
    );
}

/// `conversations(id, channel, replies, md)`: `md` the large column an
/// update that leaves it alone sends as unchanged.
fn conversations_table() -> DbTable {
    DbTable::new(
        "conversations",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("channel", ValueType::Int),
            DbColumn::new("replies", ValueType::Int),
            DbColumn::new("md", ValueType::String),
        ],
    )
}

/// A write of conversation `id` as the decoder delivers it: on the
/// table's own layout with `md`, or, with `md` `None`, the partial image
/// of an update that did not touch it.
fn conversation_write(
    table: &DbTable,
    id: i64,
    channel: i64,
    replies: i64,
    md: Option<&str>,
) -> WriteQuery {
    let key = DataFrameKey::with_schema(table.key_schema().clone(), vec![Value::Int(id)]);
    let value = |name: &str| match name {
        "id" => Value::Int(id),
        "channel" => Value::Int(channel),
        "replies" => Value::Int(replies),
        _ => Value::Null,
    };
    let record = match md {
        Some(md) => DataFrameRow::from(RowData::with_schema(
            table.row_schema().clone(),
            table
                .row_schema()
                .names()
                .iter()
                .map(|name| match name.as_str() {
                    "md" => Value::String(md.to_owned()),
                    name => value(name),
                })
                .collect(),
        )),
        None => DataFrameRow::from(RowData::partial(
            ["id", "channel", "replies"]
                .into_iter()
                .map(|name| (ColumnName::from(name), value(name)))
                .collect(),
        )),
    };
    WriteQuery::UPDATE(UpdateQuery {
        table: table.name.clone(),
        pkey_value: key,
        record,
    })
}

/// Scenario 7: updates whose large column the feed left out.
fn partial_images() {
    let rows = TOAST_CHANNELS * TOAST_PER_CHANNEL;
    println!(
        "\n== 7. partial images ({rows} conversations with a {TOAST_MD_CHARS}-character md over {TOAST_CHANNELS} channels; `channel = c` registered for the {} even channels; {TOAST_WRITES} writes per workload) ==",
        TOAST_CHANNELS / 2
    );
    let table = conversations_table();
    let md = "m".repeat(TOAST_MD_CHARS);
    let storage = Rc::new(BenchStorage::default());
    for id in 0..rows {
        storage.apply(&conversation_write(
            &table,
            id,
            id / TOAST_PER_CHANNEL,
            0,
            Some(&md),
        ));
    }
    let mut ivm: Single = Local::new(SingleTableIVM::new(), storage.clone());
    let mut subs = Vec::new();
    for channel in (0..TOAST_CHANNELS).step_by(2) {
        let query = unbounded(&table, Where::condition("channel", EQ, channel));
        subs.push(ivm.register_query(query).0);
    }

    let held = |n: usize| {
        let channel = (n as i64 % (TOAST_CHANNELS / 2)) * 2;
        channel * TOAST_PER_CHANNEL + (n as i64 / (TOAST_CHANNELS / 2)) % TOAST_PER_CHANNEL
    };
    let entering = |n: usize| {
        let channel = (n as i64 % (TOAST_CHANNELS / 2)) * 2 + 1;
        channel * TOAST_PER_CHANNEL + (n as i64 / (TOAST_CHANNELS / 2)) % TOAST_PER_CHANNEL
    };
    let workloads: [(&str, Vec<WriteQuery>); 4] = [
        (
            "md carried, row held",
            (0..TOAST_WRITES)
                .map(|n| {
                    let id = held(n);
                    conversation_write(&table, id, id / TOAST_PER_CHANNEL, 1, Some(&md))
                })
                .collect(),
        ),
        (
            "md left out, row held",
            (0..TOAST_WRITES)
                .map(|n| {
                    let id = held(n);
                    conversation_write(&table, id, id / TOAST_PER_CHANNEL, 2, None)
                })
                .collect(),
        ),
        (
            "md carried, row enters",
            (0..TOAST_WRITES)
                .map(|n| {
                    let id = entering(n);
                    conversation_write(&table, id, id / TOAST_PER_CHANNEL - 1, 1, Some(&md))
                })
                .collect(),
        ),
        (
            "md left out, row enters",
            (0..TOAST_WRITES)
                .map(|n| {
                    let id = entering(n + TOAST_WRITES);
                    conversation_write(&table, id, id / TOAST_PER_CHANNEL - 1, 1, None)
                })
                .collect(),
        ),
    ];

    let mut table_rows = Vec::new();
    for (label, writes) in workloads {
        let before = ivm.engine().stats().clone();
        let before_sync = ivm.runtime().stats().clone();
        let mut elapsed = Duration::ZERO;
        let mut returned = 0u64;
        let mut all_whole = true;
        for write in &writes {
            storage.apply(write);
            let started = Instant::now();
            let updates = ivm.incremental_update(write);
            elapsed += started.elapsed();
            returned += updates.len() as u64;
            all_whole &= updates.iter().all(|delta| match &delta.op {
                DataFrameOperation::Add(_, row) => {
                    !row.data.is_partial() && row.data.get("md").is_some()
                }
                DataFrameOperation::Delete(..) => true,
            });
        }
        let run = Run {
            label: label.to_owned(),
            writes: writes.len() as u64,
            elapsed,
            stats: ivm.engine().stats().diff(&before),
            returned,
        };
        let completed = ivm.runtime().stats().rows_completed - before_sync.rows_completed;
        table_rows.push(vec![
            run.label.clone(),
            run.writes.to_string(),
            two(run.micros_per_write()),
            whole(run.writes_per_second()),
            two(run.per_write(run.stats.row_reads)),
            two(run.per_write(run.stats.storage_reads)),
            completed.to_string(),
            run.returned.to_string(),
            if all_whole { "yes" } else { "NO" }.to_owned(),
        ]);
    }
    print_table(
        &[
            "workload",
            "writes",
            "us/write",
            "writes/s",
            "row reads/write",
            "reads/write",
            "completed in reads",
            "ops returned",
            "every add whole",
        ],
        &table_rows,
    );
    let without_md = subs
        .iter()
        .filter_map(|sub| ivm.engine().rows_for(*sub))
        .flat_map(|rows| rows.into_values())
        .filter(|row| row.data.is_partial() || row.data.get("md").is_none())
        .count();
    println!("frame: {without_md} rows held without md");
}

/// Scenario 5b: a conversation an update moves into a subscription's
/// channel while nobody holds it, its large `md` either carried (the
/// update sets a new value) or left out as unchanged (stored out of line
/// and not touched, so PostgreSQL sends no value): the time from routing
/// the update to the client's `Add`, the row read again by key included.
async fn pg_partial(dsn: &str) -> Vec<Vec<String>> {
    let table = "bench_conversations";
    let catalog = Arc::new(Catalog::new(vec![DbTable::new(
        table,
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("channel", ValueType::String),
            DbColumn::new("replies", ValueType::Int),
            DbColumn::new("md", ValueType::String),
        ],
    )]));
    let (admin, connection) = tokio_postgres::connect(dsn, tokio_postgres::NoTls)
        .await
        .expect("connect");
    tokio::task::spawn_local(async move {
        let _ = connection.await;
    });
    PgStream::drop_slot(dsn, PG_SLOT, PG_PUBLICATION)
        .await
        .expect("drop slot");
    admin
        .batch_execute(&format!(
            "DROP TABLE IF EXISTS {table};
             CREATE TABLE {table} (id int8 PRIMARY KEY, channel text, replies int8, md text);
             ALTER TABLE {table} ALTER COLUMN md SET STORAGE EXTERNAL;
             INSERT INTO {table} SELECT g, 'a', 0, repeat('m', {TOAST_MD_CHARS})
                 FROM generate_series(0, {}) g;
             CREATE PUBLICATION \"{PG_PUBLICATION}\" FOR ALL TABLES",
            2 * PG_PARTIAL_WRITES - 1
        ))
        .await
        .expect("load conversations");
    let mut stream = PgStream::open(dsn, PG_SLOT, PG_PUBLICATION, catalog.clone())
        .await
        .expect("open stream");
    let storage = PgStorage::connect(dsn, catalog.clone())
        .await
        .expect("connect");
    let mut runtime = Runtime::new(MultiTableIVM::new());
    let first = stream.poll().await.expect("poll");
    runtime.progress(first.progress);
    moved(&mut runtime, &storage);
    let (_, step) = runtime.register(MultiTableReadQuery::single(SingleTableReadQuery::new(
        table,
        Where::condition("channel", EQ, "b"),
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    )));
    pg_drain(&mut runtime, &storage, &mut stream, step.selects, 0).await;

    let mut rows = Vec::new();
    for (label, carried) in [("md carried", true), ("md left out", false)] {
        let offset = if carried { 0 } else { PG_PARTIAL_WRITES };
        let mut samples: Vec<Duration> = Vec::new();
        let mut reads = 0u64;
        let mut all_whole = true;
        for n in 0..PG_PARTIAL_WRITES {
            let id = (offset + n) as i64;
            let sql = if carried {
                format!(
                    "UPDATE {table} SET channel = 'b', md = repeat('n', {TOAST_MD_CHARS}) WHERE id = {id}"
                )
            } else {
                format!("UPDATE {table} SET channel = 'b' WHERE id = {id}")
            };
            admin.batch_execute(&sql).await.expect("update");
            let batch = loop {
                let batch = stream.poll().await.expect("poll");
                if !batch.writes.is_empty() {
                    break batch;
                }
                runtime.progress(batch.progress);
                moved(&mut runtime, &storage);
                tokio::time::sleep(Duration::from_millis(2)).await;
            };
            let started = Instant::now();
            let mut updates = Vec::new();
            let mut pending = Vec::new();
            for (write, at) in batch.writes {
                let step = runtime.write(&write, at);
                moved(&mut runtime, &storage);
                updates.extend(step.updates);
                pending.extend(step.selects);
            }
            while !pending.is_empty() {
                let mut next = Vec::new();
                for fetch in pending.drain(..) {
                    reads += 1;
                    let snapshot = storage.select(&fetch.query).await.expect("select");
                    let step = runtime.fetched(fetch.id, snapshot);
                    updates.extend(step.updates);
                    next.extend(step.selects);
                }
                pending = next;
            }
            samples.push(started.elapsed());
            runtime.progress(batch.progress);
            moved(&mut runtime, &storage);
            all_whole &= updates.iter().any(|delta| match &delta.op {
                DataFrameOperation::Add(key, row) => {
                    key.pkey_value.get("id") == Some(&Value::Int(id))
                        && matches!(row.data.get("md"), Some(Value::String(md)) if md.len() == TOAST_MD_CHARS)
                }
                DataFrameOperation::Delete(..) => false,
            });
        }
        samples.sort();
        let micros = |d: Duration| one(d.as_secs_f64() * 1e6);
        rows.push(vec![
            label.to_owned(),
            samples.len().to_string(),
            micros(samples[samples.len() / 2]),
            micros(samples[samples.len() * 95 / 100]),
            micros(samples[samples.len() - 1]),
            two(reads as f64 / samples.len() as f64),
            if all_whole { "yes" } else { "NO" }.to_owned(),
        ]);
    }
    PgStream::drop_slot(dsn, PG_SLOT, PG_PUBLICATION)
        .await
        .expect("drop slot");
    let _ = admin
        .batch_execute(&format!("DROP TABLE IF EXISTS {table}"))
        .await;
    rows
}
