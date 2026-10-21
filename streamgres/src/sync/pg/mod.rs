//! Postgres as a source. [`PgStorage`] answers the engine's reads from
//! one `REPEATABLE READ` snapshot each, positioned by the exported
//! snapshot of a temporary logical replication slot.
//!
//! A background task keeps minting *aliases*: a temporary logical slot
//! created with `EXPORT_SNAPSHOT`, whose exported snapshot and consistent
//! point Postgres pairs exactly (everything visible in the snapshot
//! committed at or below the point, everything after it is not visible).
//! A freshly minted alias only becomes the **current** one once the write
//! stream has been delivered past its consistent point
//! ([`Storage::advance`]); until then the older alias stays current. So
//! every read is positioned at or below what the engine has applied,
//! never ahead of it, and the runtime brings the read's rows up from
//! there. Each read imports the current alias's snapshot with
//! `SET TRANSACTION SNAPSHOT`; an alias lives as long as the replication
//! connection that minted it, held until the last read that adopted it
//! has finished.
//!
//! # One round trip, on the reads pool
//!
//! A read is one simple-query batch, `BEGIN … READ ONLY; SET TRANSACTION
//! SNAPSHOT '…'; SELECT …; COMMIT`, so the rows are back after a single
//! round trip; the columns arrive as text, cast by the `SELECT` to the
//! forms the feed already decodes, and are decoded the same way. The
//! rendering of the SQL, the connection I/O and the decoding all run as
//! tasks of the runtime the storage was opened on (a small pool of
//! threads in the server, the caller's own runtime in tests), never on
//! the engine's thread, which only awaits the result. The storage is
//! `Send + Sync`, so the same handle answers the engine's reads, the
//! planner's counts from a connection task and a plain query.
//!
//! # A read that does not come back
//!
//! A read is given [`PgStorage::with_read_timeout`] to finish, counted
//! from the moment it holds a connection permit (the wait for a permit is
//! the server's own queue, not PostgreSQL's time). Two clocks run: the
//! connections the pool opens carry the limit as their session's
//! `statement_timeout`, so PostgreSQL stops working on a statement it has
//! been running that long, and the pool stops waiting after the same
//! time, which covers what PostgreSQL cannot cancel (a connection that
//! will not open, a network that went silent). Either way the read is
//! **refused**, naming the table: reading it again would load a database
//! that is already slow, so the query that needed it is told, by name,
//! and asked for again later by the client. The connection is dropped.
//!
//! [`stream::PgStream`] delivers the change feed from a permanent logical
//! slot over a replication connection and positions every write at the
//! end of its commit record, the same scale the aliases' consistent
//! points are on.

pub mod catalog;
pub mod ddl;
pub mod replication;
pub mod sql;
pub mod stream;
pub mod text;
pub mod threads;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::runtime::Handle;
use tokio::sync::{Notify, Semaphore};
use tokio_postgres::error::SqlState;
use tokio_postgres::{Client, Config, NoTls, SimpleQueryMessage, SimpleQueryRow};

use super::storage::{Storage, StorageError};
use crate::log::{log_info, log_warn};
use crate::model::{
    Catalog, DataFrameKey, DataFrameRow, DbTable, Lsn, MultiTableReadQuery, RowData,
    SingleTableReadQuery, Snapshot, Value, ValueType,
};
use replication::ReplicationConnection;

pub use catalog::load_catalog;
pub use stream::{Batch, Feed, PgStream, Transport};
pub use threads::{Settings, Started};

/// How many minted aliases wait for the stream to pass them before the
/// minter pauses (each holds a slot and a connection).
const WAITING_ALIASES: usize = 2;

/// How many reads may hold a connection at once unless
/// [`PgStorage::with_read_connections`] says otherwise; further reads wait
/// their turn instead of opening connections the server would refuse.
const DEFAULT_READ_CONNECTIONS: usize = 16;

/// The most rows one read may bring back before it is refused, unless
/// `STREAMGRES_ROW_LIMIT` says otherwise. Older `STREAMGRES_READ_ROW_LIMIT`,
/// `STREAMGRES_JOIN_LIMIT`, and `XYNE_SYNC_ROW_LIMIT`/`XYNE_SYNC_READ_ROW_LIMIT`/
/// `XYNE_SYNC_JOIN_LIMIT` names remain accepted: a query
/// without a `LIMIT` over a large table would otherwise be buffered whole,
/// and one such query is enough to take the process down. The planner reads
/// whole no side of a join past the same number, so a side it calls small is
/// one a read returns.
const DEFAULT_READ_ROW_LIMIT: usize = 100_000;

/// [`DEFAULT_READ_ROW_LIMIT`], or the environment's override.
pub fn read_row_limit() -> usize {
    [
        "STREAMGRES_ROW_LIMIT",
        "STREAMGRES_SYNC_ROW_LIMIT",
        "XYNE_SYNC_ROW_LIMIT",
        "STREAMGRES_READ_ROW_LIMIT",
        "STREAMGRES_SYNC_READ_ROW_LIMIT",
        "XYNE_SYNC_READ_ROW_LIMIT",
        "STREAMGRES_JOIN_LIMIT",
        "STREAMGRES_SYNC_JOIN_LIMIT",
        "XYNE_SYNC_JOIN_LIMIT",
    ]
        .iter()
        .find_map(|name| std::env::var(name).ok())
        .and_then(|value| value.trim().parse().ok())
        .filter(|limit| *limit > 0)
        .unwrap_or(DEFAULT_READ_ROW_LIMIT)
}

/// How the kernel probes a connection to the database while it is silent,
/// so that whatever is between (a NAT, a load balancer) does not drop it as
/// idle. Applied to every connection the storage opens; it matters most to
/// the minters', which is silent for as long as its alias lives and takes
/// the alias's snapshot with it when it goes.
///
/// - `idle`: how long without a byte either way before the first probe;
///   zero turns the probing off.
/// - `interval`: how long after an unanswered probe the next one goes
///   out; zero leaves the kernel's default.
/// - `retries`: how many probes in a row may go unanswered before the
///   kernel gives the connection up; zero leaves the kernel's default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Keepalive {
    pub idle: Duration,
    pub interval: Duration,
    pub retries: u32,
}

impl Keepalive {
    /// Put these settings on `config`, for every connection opened from
    /// it: tokio-postgres applies them to the connections it opens, and
    /// [`replication::ReplicationConnection::open`] to the one it opens.
    pub fn apply(self, config: &mut Config) {
        if self.idle.is_zero() {
            config.keepalives(false);
            return;
        }
        config.keepalives(true).keepalives_idle(self.idle);
        if !self.interval.is_zero() {
            config.keepalives_interval(self.interval);
        }
        if self.retries > 0 {
            config.keepalives_retries(self.retries);
        }
    }
}

/// One minted alias: an exported snapshot and the consistent point it
/// was built at, alive as long as the replication connection that created
/// its temporary slot.
pub struct Alias {
    pub snapshot: String,
    pub lsn: Lsn,
    _minter: ReplicationConnection,
}

/// Aliases minted by this process, for unique slot names.
static MINTED: AtomicU64 = AtomicU64::new(0);

/// The compact base-36 spelling of an unsigned counter. A `u64` needs at
/// most 13 digits in this base.
fn base36(mut number: u64) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut text = [b'0'; 13];
    let mut at = text.len();
    loop {
        at -= 1;
        text[at] = DIGITS[(number % 36) as usize];
        number /= 36;
        if number == 0 {
            return std::str::from_utf8(&text[at..])
                .expect("base-36 digits are ASCII")
                .to_owned();
        }
    }
}

/// A snapshot slot name says which attempt this process is minting, followed
/// by a fresh UUID. The count is base 36: even a whole `u64` needs at most 13
/// bytes, so this always fits PostgreSQL's 63-byte slot-name limit alongside
/// the descriptive prefix and 32-byte UUID. The UUID makes names from
/// concurrent processes distinct.
fn snapshot_slot_name() -> String {
    let count = MINTED.fetch_add(1, Ordering::Relaxed);
    format!(
        "xyne_sync_snap_{}_{}",
        base36(count),
        uuid::Uuid::new_v4().simple()
    )
}

/// Mint one alias: open a replication connection and create a temporary
/// logical slot exporting its snapshot. Slot creation waits for every
/// transaction open at that moment to finish, so a long-running
/// transaction delays the mint (never the reads, which keep the current
/// alias).
pub async fn mint(config: &Config) -> Result<Alias, StorageError> {
    let mut minter = ReplicationConnection::open(config).await?;
    let slot = snapshot_slot_name();
    let rows = minter
        .simple_query(&format!(
            "CREATE_REPLICATION_SLOT \"{slot}\" TEMPORARY LOGICAL pgoutput EXPORT_SNAPSHOT"
        ))
        .await?;
    let unreadable = || StorageError("CREATE_REPLICATION_SLOT returned no usable row".to_owned());
    let row = rows.first().ok_or_else(unreadable)?;
    let lsn = parse_lsn(
        row.get(1)
            .and_then(|column| column.as_deref())
            .ok_or_else(unreadable)?,
    )?;
    let snapshot = row
        .get(2)
        .and_then(|column| column.clone())
        .ok_or_else(unreadable)?;
    Ok(Alias {
        snapshot,
        lsn,
        _minter: minter,
    })
}

impl From<tokio_postgres::Error> for StorageError {
    /// The driver's message followed by its causes, so a server refusal
    /// (`FATAL: sorry, too many clients already`) reads as such. A read
    /// the database will never run as written (a data error, SQLSTATE
    /// class 22, or a syntax or type error, class 42, other than the ones
    /// a schema change can cure; a text value with a NUL byte the driver
    /// cannot encode) is refused rather than parked and retried forever,
    /// with a reason that quotes no data; the message itself is logged.
    /// A snapshot that is no longer there (the connection that exported
    /// it ended) is a data error by its code and is not one: the next
    /// alias cures it, so that read is parked like any transient failure.
    fn from(error: tokio_postgres::Error) -> Self {
        let mut text = error.to_string();
        let mut source = std::error::Error::source(&error);
        while let Some(inner) = source {
            text.push_str(": ");
            text.push_str(&inner.to_string());
            source = inner.source();
        }
        match error.as_db_error() {
            Some(db) if permanent(db.code().code()) && !snapshot_gone(db.message()) => {
                log_warn!("a read the database will not run as written: {text}");
                StorageError::refused(format!(
                    "the database will not run this query as written (SQLSTATE {})",
                    db.code().code()
                ))
            }
            None if text.contains("embedded null") => StorageError::refused(
                "a text value contains a NUL byte, which the database's text cannot hold",
            ),
            _ => StorageError(text),
        }
    }
}

/// Whether a SQLSTATE names an error no retry of the same statement can
/// cure: data errors (class 22) and syntax or type errors (class 42),
/// except the class-42 codes a schema change or a grant can cure, which
/// stay transient.
fn permanent(code: &str) -> bool {
    const CURABLE: [&str; 6] = ["42501", "42P01", "42703", "42883", "42704", "42P02"];
    code.len() >= 2 && matches!(&code[..2], "22" | "42") && !CURABLE.contains(&code)
}

/// Whether a server message says the exported snapshot a read asked for
/// no longer exists.
fn snapshot_gone(message: &str) -> bool {
    message.starts_with("invalid snapshot identifier")
}

/// The refusal of `what` (a read on a table, a count, a statement) that
/// did not finish within `limit`.
fn timed_out(what: &str, limit: Duration) -> StorageError {
    log_warn!("{what} took longer than {} ms; refused", limit.as_millis());
    StorageError::refused(format!("{what} took longer than {} ms", limit.as_millis()))
}

/// The aliases: the current one, and the newer ones minted since, oldest
/// first, waiting for the stream to pass their consistent points; and the
/// catalog reads on the current one describe their tables by. The alias
/// and the catalog change together under one lock: a schema change
/// committed at some position hands in the catalog from then on
/// (`upcoming`), and the alias that first reaches that position brings it
/// into force, so a read never pairs a snapshot with a catalog from the
/// other side of a migration.
struct Aliases {
    current: Option<Arc<Alias>>,
    waiting: VecDeque<Arc<Alias>>,
    catalog: Arc<Catalog>,
    /// Catalogs handed in for positions the current alias has not reached,
    /// each with the position it applies from, in order.
    upcoming: VecDeque<(Lsn, Arc<Catalog>)>,
}

impl Aliases {
    /// No alias yet, reads to describe their tables by `catalog`.
    fn new(catalog: Arc<Catalog>) -> Self {
        Aliases {
            current: None,
            waiting: VecDeque::new(),
            catalog,
            upcoming: VecDeque::new(),
        }
    }

    /// Everything, moved out; what stays behind holds no alias.
    fn take(&mut self) -> Self {
        Aliases {
            current: self.current.take(),
            waiting: std::mem::take(&mut self.waiting),
            catalog: self.catalog.clone(),
            upcoming: std::mem::take(&mut self.upcoming),
        }
    }

    /// Make the newest waiting alias at or below `feed` current, dropping
    /// the older ones it supersedes, and bring into force every catalog
    /// handed in for a position the current alias has reached.
    fn advance(&mut self, feed: Lsn) {
        while self.waiting.front().is_some_and(|alias| alias.lsn <= feed) {
            self.current = self.waiting.pop_front();
        }
        let Some(current) = &self.current else {
            return;
        };
        while self
            .upcoming
            .front()
            .is_some_and(|(at, _)| *at <= current.lsn)
        {
            if let Some((_, catalog)) = self.upcoming.pop_front() {
                self.catalog = catalog;
            }
        }
    }
}

/// What every read shares: the connection settings, the pooled idle
/// connections, the permits, the aliases and the runtime the work runs on.
///
/// - `config`: how to connect; one connection is opened per read in
///   flight and kept for reuse in `idle`, since each read is its own
///   transaction.
/// - `permits`: how many reads may be in flight at once; the rest queue
///   here rather than at the server's connection limit.
/// - `aliases`: the current alias and the ones waiting to become it, and
///   the catalog (the tables' declared columns, which the `SELECT` casts
///   to and the rows decode by) in force on the current one; a read
///   clones both and keeps them until it is done.
/// - `rotation`: how often a fresh alias is minted, in milliseconds.
/// - `wake`: rung to mint at once rather than at the next tick.
/// - `first`: the consistent point of the first alias minted, which is
///   where the feed starts.
/// - `timeout`: how long a read may take, in milliseconds; zero for no
///   limit.
/// - `alive`: cleared when the storage drops, which ends the minting task.
/// - `runtime`: where the reads, the connections and the minter run.
struct Pool {
    config: Config,
    idle: Mutex<Vec<Client>>,
    permits: Arc<Semaphore>,
    /// The most rows one read may return before it is refused.
    row_limit: AtomicUsize,
    aliases: Mutex<Aliases>,
    rotation: AtomicU64,
    wake: Notify,
    first: AtomicU64,
    timeout: AtomicU64,
    alive: AtomicBool,
    runtime: Handle,
}

/// Read access to a Postgres database; see the module docs.
///
/// - `pool`: what the reads share (cloned into every read task).
/// - `delay`: a test hook: hold every snapshot open this long before
///   reading, so writes can be committed behind it deliberately.
pub struct PgStorage {
    pool: Arc<Pool>,
    delay: Option<Duration>,
}

impl Drop for PgStorage {
    /// End the minting task.
    fn drop(&mut self) {
        self.pool.alive.store(false, Ordering::Relaxed);
    }
}

impl PgStorage {
    /// Connect on the current runtime; see [`PgStorage::connect_on`].
    pub async fn connect(dsn: &str, catalog: Arc<Catalog>) -> Result<Self, StorageError> {
        Self::connect_on(dsn, catalog, Handle::current()).await
    }

    /// Connect once (validating `dsn`) and keep that connection for the
    /// first read; mint the first alias (it becomes current with the first
    /// [`Storage::advance`] past its point) and keep minting one every
    /// [`PgStorage::with_rotation`] interval (250 ms by default). Every
    /// read, connection and mint from then on runs as a task of `runtime`.
    pub async fn connect_on(
        dsn: &str,
        catalog: Arc<Catalog>,
        runtime: Handle,
    ) -> Result<Self, StorageError> {
        Self::connect_configured(dsn.parse()?, catalog, runtime).await
    }

    /// Connect as [`PgStorage::connect_on`] does, from a `config` already
    /// parsed and, say, given a [`Keepalive`]: every connection the storage
    /// opens, the reads' and the minters', is opened from it.
    pub async fn connect_configured(
        config: Config,
        catalog: Arc<Catalog>,
        runtime: Handle,
    ) -> Result<Self, StorageError> {
        let client = open(&config, &runtime).await?;
        let pool = Arc::new(Pool {
            config,
            idle: Mutex::new(vec![client]),
            permits: Arc::new(Semaphore::new(DEFAULT_READ_CONNECTIONS)),
            row_limit: AtomicUsize::new(read_row_limit()),
            aliases: Mutex::new(Aliases::new(catalog)),
            rotation: AtomicU64::new(250),
            wake: Notify::new(),
            first: AtomicU64::new(0),
            timeout: AtomicU64::new(0),
            alive: AtomicBool::new(true),
            runtime,
        });
        let first = Arc::new(mint(&pool.config).await?);
        pool.first.store(first.lsn.0, Ordering::Relaxed);
        pool.lock_aliases().waiting.push_back(first);
        rotate(pool.clone());
        Ok(PgStorage { pool, delay: None })
    }

    /// Refuse a read past `limit` rows instead of the environment's budget
    /// (tests; at least one).
    pub fn with_read_row_limit(self, limit: usize) -> Self {
        self.pool.row_limit.store(limit.max(1), Ordering::Relaxed);
        self
    }

    /// Hold every snapshot open for `delay` before reading (tests).
    pub fn with_read_delay(mut self, delay: Duration) -> Self {
        self.delay = Some(delay);
        self
    }

    /// Let at most `limit` reads hold a connection at once (at least one).
    pub fn with_read_connections(self, limit: usize) -> Self {
        let pool = Arc::new(Pool {
            config: self.pool.config.clone(),
            idle: Mutex::new(std::mem::take(&mut *self.pool.lock_idle())),
            permits: Arc::new(Semaphore::new(limit.max(1))),
            row_limit: AtomicUsize::new(self.pool.row_limit.load(Ordering::Relaxed)),
            aliases: Mutex::new(self.pool.lock_aliases().take()),
            rotation: AtomicU64::new(self.pool.rotation.load(Ordering::Relaxed)),
            wake: Notify::new(),
            first: AtomicU64::new(self.pool.first.load(Ordering::Relaxed)),
            timeout: AtomicU64::new(self.pool.timeout.load(Ordering::Relaxed)),
            alive: AtomicBool::new(true),
            runtime: self.pool.runtime.clone(),
        });
        rotate(pool.clone());
        let delay = self.delay;
        drop(self);
        PgStorage { pool, delay }
    }

    /// Give a read `timeout` to finish before it is refused (zero: as
    /// long as it takes). The connections opened so far carry no limit of
    /// their own, so they are let go and the next reads open theirs.
    pub fn with_read_timeout(self, timeout: Duration) -> Self {
        let millis = u64::try_from(timeout.as_millis()).unwrap_or(u64::MAX);
        self.pool.timeout.store(millis, Ordering::Relaxed);
        self.pool.lock_idle().clear();
        self
    }

    /// Mint a fresh alias every `every`.
    pub fn with_rotation(self, every: Duration) -> Self {
        self.pool
            .rotation
            .store(every.as_millis().max(1) as u64, Ordering::Relaxed);
        self
    }

    /// The consistent point of the first alias minted: everything the
    /// storage will ever read is at or past it, so it is where the feed
    /// starts.
    pub fn first_position(&self) -> Lsn {
        Lsn(self.pool.first.load(Ordering::Relaxed))
    }

    /// Mint an alias now, without waiting for the rotation's next tick.
    pub fn mint_now(&self) {
        self.pool.wake.notify_one();
    }

    /// The current alias's consistent point, for inspection; `None` until
    /// the stream has passed the first alias.
    pub fn alias_position(&self) -> Option<Lsn> {
        self.pool
            .lock_aliases()
            .current
            .as_ref()
            .map(|alias| alias.lsn)
    }

    /// Run one plain statement (no snapshot, autocommit) on a pooled
    /// connection and return its rows as text; for the few reads that are
    /// not the engine's (a client's mutation ids at connect time).
    pub async fn simple_query(&self, sql: &str) -> Result<Vec<SimpleQueryRow>, StorageError> {
        let pool = self.pool.clone();
        let sql = sql.to_owned();
        run_on(&self.pool.runtime, async move {
            pool.run("a statement", &sql).await
        })
        .await
    }
}

impl Storage for PgStorage {
    /// One `REPEATABLE READ`, read-only transaction importing the current
    /// alias's exported snapshot; the `SELECT` runs against that snapshot
    /// and is positioned at the alias's consistent point.
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError> {
        self.select_shared(Arc::new(query.clone())).await
    }

    /// The read as a task of the pool, the shared query moved into it.
    async fn select_shared(
        &self,
        query: Arc<SingleTableReadQuery>,
    ) -> Result<Snapshot, StorageError> {
        let pool = self.pool.clone();
        let delay = self.delay;
        run_on(&self.pool.runtime, async move {
            let (alias, catalog) = pool.current_alias()?;
            let table = table_of(&catalog, &query)?;
            let row_limit = pool.row_limit.load(Ordering::Relaxed);
            let mut sql = sql::select_sql(&query, table);
            if query.limit == u32::MAX {
                sql.push_str(&format!(" LIMIT {}", row_limit + 1));
            }
            let what = format!("a read on `{}`", query.table);
            let rows = pool.read(&alias, &what, &sql, delay).await?;
            if rows.len() > row_limit {
                log_warn!(
                    "read on `{}` returned more than {} rows; refused",
                    query.table,
                    row_limit
                );
                return Err(StorageError::refused(format!(
                    "a read on `{}` returned more than {} rows",
                    query.table, row_limit
                )));
            }
            if rows.len() >= row_limit / 5 {
                log_info!("read on `{}` returned {} rows", query.table, rows.len());
            }
            if let Some(stats) = crate::stats::Stats::global() {
                stats.note_read(rows.len() as u64);
            }
            let rows = rows
                .iter()
                .map(|row| decode_row(row, table))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Snapshot {
                rows,
                at: alias.lsn,
            })
        })
        .await
    }

    /// `SELECT count(*)` over at most `cap` matching rows, the tree's
    /// inner edges as `EXISTS` subqueries, on the same snapshot a read
    /// would use.
    async fn count(&self, query: &MultiTableReadQuery, cap: u64) -> Result<u64, StorageError> {
        let pool = self.pool.clone();
        let query = query.clone();
        run_on(&self.pool.runtime, async move {
            let (alias, catalog) = pool.current_alias()?;
            let sql = sql::count_sql(&query, &catalog, cap).map_err(StorageError)?;
            let what = format!("counting the rows of `{}`", query.main_table.table);
            let rows = pool.read(&alias, &what, &sql, None).await?;
            let text = rows
                .first()
                .and_then(|row| row.get(0))
                .ok_or_else(|| StorageError("the count returned no row".to_owned()))?;
            let count: i64 = text
                .parse()
                .map_err(|_| StorageError(format!("`{text}` is not a count")))?;
            Ok(count.max(0) as u64)
        })
        .await
    }

    /// Flip to the newest minted alias the stream has passed.
    fn advance(&self, feed: Lsn) {
        self.pool.lock_aliases().advance(feed);
    }

    /// Reads on the alias that first reaches `at`, and every later one,
    /// describe their tables by `catalog`.
    fn follow(&self, at: Lsn, catalog: Arc<Catalog>) {
        self.pool.lock_aliases().upcoming.push_back((at, catalog));
    }

    /// [`PgStorage::mint_now`].
    fn mint_now(&self) {
        self.pool.wake.notify_one();
    }

    /// The current alias's consistent point; zero while there is none.
    fn floor(&self) -> Lsn {
        self.alias_position().unwrap_or_default()
    }
}

impl Pool {
    /// The aliases, read through a poisoned lock (the state is only ever
    /// changed whole).
    fn lock_aliases(&self) -> std::sync::MutexGuard<'_, Aliases> {
        self.aliases
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The idle connections, likewise.
    fn lock_idle(&self) -> std::sync::MutexGuard<'_, Vec<Client>> {
        self.idle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The current alias with the catalog in force on it, or an error
    /// while the stream has not passed the first one yet (the runtime
    /// parks the read and asks again).
    fn current_alias(&self) -> Result<(Arc<Alias>, Arc<Catalog>), StorageError> {
        let aliases = self.lock_aliases();
        let alias = aliases.current.clone().ok_or_else(|| {
            StorageError("no snapshot at or below the stream's position yet".to_owned())
        })?;
        Ok((alias, aliases.catalog.clone()))
    }

    /// A permit to hold a connection; the wait for one, when every
    /// connection is taken, is measured as `read_pool_wait`.
    async fn permit(&self) -> Result<tokio::sync::OwnedSemaphorePermit, StorageError> {
        let started = Instant::now();
        let permit = self
            .permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| StorageError("the read pool is closed".to_owned()));
        if let Some(stats) = crate::stats::Stats::global() {
            stats.read_pool_wait.record(started.elapsed());
        }
        permit
    }

    /// An idle connection that is still open, or a new one. A connection
    /// that ended while it sat idle (the server restarted, the network
    /// lost it and the keepalive probes found out) is let go here rather
    /// than handed to a read that would wait on it.
    async fn acquire(&self) -> Result<Client, StorageError> {
        loop {
            let idle = self.lock_idle().pop();
            match idle {
                Some(client) if client.is_closed() => continue,
                Some(client) => return Ok(client),
                None => return open(&self.read_config(), &self.runtime).await,
            }
        }
    }

    /// How long a read may take, when a limit is set.
    fn timeout(&self) -> Option<Duration> {
        match self.timeout.load(Ordering::Relaxed) {
            0 => None,
            millis => Some(Duration::from_millis(millis)),
        }
    }

    /// How a read's connection is opened: `config` (which carries the
    /// [`Keepalive`] the storage was given, if any, so the kernel probes
    /// the connection while it sits idle in the pool), and the read
    /// timeout as both the time the connection may take to open and the
    /// session's `statement_timeout`, after whatever options the
    /// connection string already carries.
    fn read_config(&self) -> Config {
        let mut config = self.config.clone();
        if let Some(limit) = self.timeout() {
            config.connect_timeout(limit);
            let ours = format!("-c statement_timeout={}", limit.as_millis());
            let options = match config.get_options() {
                Some(theirs) => format!("{theirs} {ours}"),
                None => ours,
            };
            config.options(&options);
        }
        config
    }

    /// Run one simple-query batch on a pooled connection, within the read
    /// timeout, and return the rows of its last statement that had any.
    /// `what` names the work in the refusal of a batch that did not
    /// finish in time: PostgreSQL cancelled it, or the wait ended first.
    async fn run(&self, what: &str, batch: &str) -> Result<Vec<SimpleQueryRow>, StorageError> {
        let _permit = self.permit().await?;
        let limit = self.timeout();
        let work = async {
            let client = self.acquire().await?;
            match client.simple_query(batch).await {
                Ok(messages) => {
                    self.release(client);
                    Ok(rows_of(messages))
                }
                Err(error) => match limit {
                    Some(limit) if error.code() == Some(&SqlState::QUERY_CANCELED) => {
                        Err(timed_out(what, limit))
                    }
                    _ => Err(error.into()),
                },
            }
        };
        match limit {
            None => work.await,
            Some(limit) => match tokio::time::timeout(limit, work).await {
                Ok(outcome) => outcome,
                Err(_) => Err(timed_out(what, limit)),
            },
        }
    }

    /// Return a connection after a successful statement; a failed one's
    /// connection is dropped instead, in case it is broken or mid-abort.
    fn release(&self, client: Client) {
        self.lock_idle().push(client);
    }

    /// Run one positioned statement as a single simple-query batch: the
    /// read-only transaction opened, the alias's exported snapshot
    /// imported as its first statement, `sql` run against it, and the
    /// transaction committed, all in one round trip ([`Pool::run`]); the
    /// rows of `sql` come back as text.
    async fn read(
        &self,
        alias: &Alias,
        what: &str,
        sql: &str,
        delay: Option<Duration>,
    ) -> Result<Vec<SimpleQueryRow>, StorageError> {
        let mut batch = format!(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '{}';",
            alias.snapshot.replace('\'', "''")
        );
        if let Some(delay) = delay {
            batch.push_str(&format!(" SELECT pg_sleep({});", delay.as_secs_f64()));
        }
        batch.push(' ');
        batch.push_str(sql);
        batch.push_str("; COMMIT");
        self.run(what, &batch).await
    }
}

/// Run `work` as a task of `runtime` and wait for its result here.
async fn run_on<T: Send + 'static>(
    runtime: &Handle,
    work: impl std::future::Future<Output = Result<T, StorageError>> + Send + 'static,
) -> Result<T, StorageError> {
    match runtime.spawn(work).await {
        Ok(outcome) => outcome,
        Err(error) => Err(StorageError(format!("the read task ended: {error}"))),
    }
}

/// The data rows of the last statement of a simple-query batch that
/// returned any (the positioned `SELECT`; a `pg_sleep` before it returns a
/// row of its own, and the `COMMIT` after it returns none).
fn rows_of(messages: Vec<SimpleQueryMessage>) -> Vec<SimpleQueryRow> {
    let mut rows = Vec::new();
    for message in messages {
        match message {
            SimpleQueryMessage::RowDescription(_) => rows.clear(),
            SimpleQueryMessage::Row(row) => rows.push(row),
            _ => {}
        }
    }
    rows
}

/// The table of `query` in `catalog`.
fn table_of<'a>(
    catalog: &'a Catalog,
    query: &SingleTableReadQuery,
) -> Result<&'a DbTable, StorageError> {
    catalog
        .table(query.table.as_str())
        .ok_or_else(|| StorageError(format!("table `{}` is not in the catalog", query.table)))
}

/// Keep minting aliases every rotation interval until the storage drops,
/// pausing while enough are already waiting for the stream, and at once
/// when rung ([`PgStorage::mint_now`], whatever is waiting); a failed mint
/// is reported and tried again at the next tick.
fn rotate(pool: Arc<Pool>) {
    let runtime = pool.runtime.clone();
    runtime.spawn(async move {
        while pool.alive.load(Ordering::Relaxed) {
            let every = Duration::from_millis(pool.rotation.load(Ordering::Relaxed));
            let rung = tokio::select! {
                _ = tokio::time::sleep(every) => false,
                _ = pool.wake.notified() => true,
            };
            if !pool.alive.load(Ordering::Relaxed) {
                break;
            }
            if !rung && pool.lock_aliases().waiting.len() >= WAITING_ALIASES {
                continue;
            }
            match mint(&pool.config).await {
                Ok(fresh) => pool.lock_aliases().waiting.push_back(Arc::new(fresh)),
                Err(error) => {
                    log_warn!("snapshot minting failed, keeping the current alias: {error}")
                }
            }
        }
    });
}

/// Open one connection and drive it as a task of `runtime`.
async fn open(config: &Config, runtime: &Handle) -> Result<Client, StorageError> {
    let (client, connection) = config.connect(NoTls).await?;
    runtime.spawn(async move {
        if let Err(error) = connection.await {
            log_warn!("postgres connection ended: {error}");
        }
    });
    Ok(client)
}

/// Parse Postgres's `X/Y`.
pub fn parse_lsn(text: &str) -> Result<Lsn, StorageError> {
    Lsn::parse(text).ok_or_else(|| StorageError(format!("unreadable WAL location `{text}`")))
}

/// One result row, in [`sql::select_columns`] order, as the engine's
/// (identity, image) pair; the names come from the catalog, so no name is
/// allocated per row.
fn decode_row(
    row: &SimpleQueryRow,
    table: &DbTable,
) -> Result<(DataFrameKey, DataFrameRow), StorageError> {
    let schema = table.row_schema().clone();
    let mut values = Vec::with_capacity(schema.len());
    for (index, column) in schema.names().iter().enumerate() {
        let declared = &table.columns[column].r#type;
        let value = match row.get(index) {
            Some(text) => decode_text(text, declared)?,
            None => Value::Null,
        };
        values.push(value);
    }
    let data = RowData::with_schema(schema, values);
    let key = DataFrameKey::with_schema(
        table.key_schema().clone(),
        table
            .pkey
            .iter()
            .map(|column| data[column].clone())
            .collect(),
    );
    Ok((key, DataFrameRow::from(data)))
}

/// One column of a result row in its text form, decoded by the cast its
/// declared type was read with ([`sql::select_expr`]): a time column
/// arrives as its epoch milliseconds, a JSON column as the text of its
/// `jsonb` (kept in the standard form, [`text::standard_json`]), a list
/// or map column as JSON text, the rest in Postgres's text form for the
/// cast type.
fn decode_text(text: &str, declared: &ValueType) -> Result<Value, StorageError> {
    let unreadable = || StorageError(format!("`{text}` is not a {declared:?}"));
    Ok(match declared {
        ValueType::Int | ValueType::Timestamp => {
            Value::Int(text.parse().map_err(|_| unreadable())?)
        }
        ValueType::Float => Value::Float(text.parse().map_err(|_| unreadable())?),
        ValueType::Json => Value::String(text::standard_json(text).into_owned()),
        ValueType::String | ValueType::Map(_, _) => Value::String(text.to_owned()),
        ValueType::List(inner) => text::json_list(text, inner),
        ValueType::Bool => Value::Bool(match text {
            "t" | "true" => true,
            "f" | "false" => false,
            _ => return Err(unreadable()),
        }),
        ValueType::Date => Value::Date(
            chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| unreadable())?,
        ),
        ValueType::Datetime => Value::Datetime(
            chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S%.f")
                .or_else(|_| chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S"))
                .map_err(|_| unreadable())?,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base36_keeps_any_snapshot_count_within_thirteen_digits() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
        assert_eq!(base36(u64::MAX).len(), 13);
    }

    #[test]
    fn snapshot_slot_names_fit_and_are_globally_unique() {
        let first = snapshot_slot_name();
        let second = snapshot_slot_name();
        assert!(first.len() <= 63, "PostgreSQL caps slot names at 63 bytes");
        assert_ne!(first, second);
        let fields: Vec<_> = first.split('_').collect();
        assert_eq!(fields.len(), 5, "xyne, sync, snap, count and UUID");
        assert_eq!(fields[..3], ["xyne", "sync", "snap"]);
        assert!(u64::from_str_radix(fields[3], 36).is_ok());
        assert!(
            fields[3].len() <= 13,
            "a u64 takes at most 13 base-36 digits"
        );
        assert_eq!(fields[4].len(), 32);
    }
    use crate::model::DbColumn;

    /// A keepalive goes onto the connection settings whole; an idle time
    /// of zero turns the probing off, and a zero interval or count leaves
    /// the kernel's default in place.
    #[test]
    fn keepalive_settings_reach_the_connection_config() {
        let mut config = Config::new();
        Keepalive {
            idle: Duration::from_secs(30),
            interval: Duration::from_secs(10),
            retries: 3,
        }
        .apply(&mut config);
        assert!(config.get_keepalives());
        assert_eq!(config.get_keepalives_idle(), Duration::from_secs(30));
        assert_eq!(
            config.get_keepalives_interval(),
            Some(Duration::from_secs(10))
        );
        assert_eq!(config.get_keepalives_retries(), Some(3));

        let mut config = Config::new();
        Keepalive {
            idle: Duration::from_secs(5),
            interval: Duration::ZERO,
            retries: 0,
        }
        .apply(&mut config);
        assert_eq!(config.get_keepalives_idle(), Duration::from_secs(5));
        assert_eq!(config.get_keepalives_interval(), None);
        assert_eq!(config.get_keepalives_retries(), None);

        let mut config = Config::new();
        Keepalive {
            idle: Duration::ZERO,
            interval: Duration::from_secs(10),
            retries: 3,
        }
        .apply(&mut config);
        assert!(!config.get_keepalives());
    }

    /// Data and syntax errors are permanent; the class-42 codes a schema
    /// change or a grant can cure, and everything else, are not.
    #[test]
    fn permanent_errors_are_the_ones_no_retry_cures() {
        assert!(permanent("22P02"));
        assert!(permanent("22001"));
        assert!(permanent("42601"));
        assert!(!permanent("42P01"), "an undefined table may be created");
        assert!(!permanent("42501"), "a missing grant may be given");
        assert!(!permanent("53300"), "too many connections is transient");
        assert!(!permanent("08006"));
        assert!(!permanent(""));
    }

    /// A snapshot that is gone is cured by the next alias, whatever class
    /// its code is in; a read past its time is a refusal naming the work.
    #[test]
    fn a_gone_snapshot_is_transient_and_a_timeout_is_a_refusal() {
        assert!(snapshot_gone(
            "invalid snapshot identifier: \"00000004-0000001B-1\""
        ));
        assert!(!snapshot_gone("invalid input syntax for type json"));
        let refusal = timed_out("a read on `messages`", Duration::from_secs(10));
        assert_eq!(
            refusal.refusal(),
            Some("a read on `messages` took longer than 10000 ms")
        );
    }

    /// A minted alias becomes current only once the feed passes its
    /// point, and a newer alias the feed has passed supersedes older ones
    /// in one step.
    #[test]
    fn aliases_flip_only_behind_the_feed() {
        let alias = |lsn: u64| {
            Arc::new(Alias {
                snapshot: format!("snap-{lsn}"),
                lsn: Lsn(lsn),
                _minter: ReplicationConnection::detached(),
            })
        };
        let mut aliases = Aliases::new(Arc::new(Catalog::default()));
        aliases.waiting.push_back(alias(10));
        aliases.waiting.push_back(alias(20));
        aliases.waiting.push_back(alias(30));
        aliases.advance(Lsn(5));
        assert!(aliases.current.is_none());
        aliases.advance(Lsn(25));
        assert_eq!(aliases.current.as_ref().map(|a| a.lsn), Some(Lsn(20)));
        assert_eq!(aliases.waiting.len(), 1);
        aliases.advance(Lsn(25));
        assert_eq!(aliases.current.as_ref().map(|a| a.lsn), Some(Lsn(20)));
        aliases.advance(Lsn(30));
        assert_eq!(aliases.current.as_ref().map(|a| a.lsn), Some(Lsn(30)));
        assert!(aliases.waiting.is_empty());
    }

    /// A catalog handed in for a position comes into force with the first
    /// alias at or past that position, never with an earlier one, and the
    /// alias and the catalog flip in the same step.
    #[test]
    fn catalogs_come_into_force_with_the_alias_that_reaches_them() {
        let alias = |lsn: u64| {
            Arc::new(Alias {
                snapshot: format!("snap-{lsn}"),
                lsn: Lsn(lsn),
                _minter: ReplicationConnection::detached(),
            })
        };
        let table =
            |name: &str| DbTable::new(name, ["id"], vec![DbColumn::new("id", ValueType::Int)]);
        let before = Arc::new(Catalog::new(vec![table("a")]));
        let after = Arc::new(Catalog::new(vec![table("a"), table("b")]));
        let mut aliases = Aliases::new(before.clone());
        aliases.upcoming.push_back((Lsn(15), after.clone()));
        aliases.waiting.push_back(alias(10));
        aliases.waiting.push_back(alias(20));
        aliases.advance(Lsn(12));
        assert_eq!(aliases.current.as_ref().map(|a| a.lsn), Some(Lsn(10)));
        assert!(
            Arc::ptr_eq(&aliases.catalog, &before),
            "10 is before the change at 15"
        );
        aliases.advance(Lsn(20));
        assert_eq!(aliases.current.as_ref().map(|a| a.lsn), Some(Lsn(20)));
        assert!(Arc::ptr_eq(&aliases.catalog, &after));
        assert!(aliases.upcoming.is_empty());
    }

    /// The text forms the casts produce decode to the engine's values.
    #[test]
    fn text_columns_decode_by_declared_type() {
        assert_eq!(decode_text("42", &ValueType::Int).unwrap(), Value::Int(42));
        assert_eq!(
            decode_text("1700000000123", &ValueType::Timestamp).unwrap(),
            Value::Int(1_700_000_000_123)
        );
        assert_eq!(
            decode_text("1.5", &ValueType::Float).unwrap(),
            Value::Float(1.5)
        );
        assert!(
            matches!(decode_text("NaN", &ValueType::Float).unwrap(), Value::Float(f) if f.is_nan())
        );
        assert_eq!(
            decode_text("t", &ValueType::Bool).unwrap(),
            Value::Bool(true)
        );
        assert_eq!(
            decode_text("[1,2]", &ValueType::List(Box::new(ValueType::Int))).unwrap(),
            Value::List(vec![Value::Int(1), Value::Int(2)])
        );
        assert_eq!(
            decode_text("2026-09-11", &ValueType::Date).unwrap(),
            Value::Date(chrono::NaiveDate::from_ymd_opt(2026, 9, 11).unwrap())
        );
        assert!(matches!(
            decode_text("2026-09-11 10:00:00.5", &ValueType::Datetime).unwrap(),
            Value::Datetime(_)
        ));
        assert_eq!(
            decode_text("{\"a\": 1.50}", &ValueType::Json).unwrap(),
            Value::String("{\"a\": 1.5}".into()),
            "a JSON cell is kept in the standard form"
        );
        assert!(decode_text("x", &ValueType::Int).is_err());
    }
}
