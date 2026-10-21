//! Reads routed by table: some tables are mirrored in memory (fed by the
//! same write stream and read without a round trip), the rest are read
//! from Postgres. Which tables live in memory is configuration
//! (`STREAMGRES_MEMORY_TABLES`, a comma-separated list; the old
//! `STREAMGRES_SYNC_MEMORY_TABLES` and `XYNE_SYNC_MEMORY_TABLES` names remain
//! accepted); by default every
//! read goes to Postgres.

use std::collections::HashSet;
use std::rc::Rc;
use std::sync::Arc;

use super::pg::PgStorage;
use super::storage::{MemoryStorage, Storage, StorageError};
use crate::ivm::SchemaChange;
use crate::model::{
    Catalog, Lsn, MultiTableReadQuery, Order, OrderBy, SingleTableReadQuery, Snapshot, TableName,
    Where, WriteQuery,
};

/// The environment variable naming the tables to mirror in memory.
pub const MEMORY_TABLES_VAR: &str = "STREAMGRES_MEMORY_TABLES";

/// One [`Storage`] over two: the in-memory mirror for the cached tables,
/// Postgres for everything else.
///
/// - `memory`: the mirror; fed by [`Storage::absorb`] and warmed from
///   Postgres by [`Sources::warm`].
/// - `pg`: the database, shared with whoever else reads it (the planner's
///   counts, the connect-time reads).
/// - `cached`: the tables the mirror answers for.
/// - `catalog`: the tables' declared shapes, for the warm-up reads.
pub struct Sources {
    memory: Rc<MemoryStorage>,
    pg: Arc<PgStorage>,
    cached: HashSet<TableName>,
    catalog: Arc<Catalog>,
}

impl Sources {
    /// Postgres for every table but `cached`, which the memory mirror
    /// answers for once warmed.
    pub fn new(
        pg: Arc<PgStorage>,
        catalog: Arc<Catalog>,
        cached: impl IntoIterator<Item = TableName>,
    ) -> Self {
        Sources {
            memory: Rc::new(MemoryStorage::new()),
            pg,
            cached: cached.into_iter().collect(),
            catalog,
        }
    }

    /// The tables named in `STREAMGRES_MEMORY_TABLES` (or the legacy
    /// `STREAMGRES_SYNC_MEMORY_TABLES` or `XYNE_SYNC_MEMORY_TABLES`; empty
    /// when unset).
    pub fn cached_from_env() -> Vec<TableName> {
        std::env::var(MEMORY_TABLES_VAR)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                std::env::var("STREAMGRES_SYNC_MEMORY_TABLES")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                std::env::var("XYNE_SYNC_MEMORY_TABLES")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(TableName::from)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Whether `table` is answered from memory.
    pub fn is_cached(&self, table: &TableName) -> bool {
        self.cached.contains(table)
    }

    /// The memory mirror.
    pub fn memory(&self) -> &Rc<MemoryStorage> {
        &self.memory
    }

    /// Load every cached table from Postgres into the mirror, reading each
    /// whole at the current snapshot; returns the rows loaded. Call once
    /// the stream position is known (after the first [`Storage::advance`]);
    /// writes the stream delivers afterwards keep the mirror current
    /// through [`Storage::absorb`], and a write the snapshot already
    /// contained re-applies harmlessly.
    pub async fn warm(&self) -> Result<usize, StorageError> {
        let mut loaded = 0;
        for name in &self.cached {
            let table = self
                .catalog
                .table(name.as_str())
                .ok_or_else(|| StorageError(format!("table `{name}` is not in the catalog")))?;
            let order = table
                .pkey_columns()
                .next()
                .map(|column| column.name.clone())
                .ok_or_else(|| StorageError(format!("table `{name}` has no primary key")))?;
            let whole = SingleTableReadQuery::new(
                name.clone(),
                Where::AND(Vec::new()),
                OrderBy::new(order, Order::ASC),
                u32::MAX,
            );
            let snapshot = self.pg.select(&whole).await?;
            loaded += snapshot.rows.len();
            self.memory.load(name, snapshot.rows);
        }
        Ok(loaded)
    }
}

impl Storage for Sources {
    /// The mirror for a cached table, Postgres otherwise.
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError> {
        if self.is_cached(&query.table) {
            self.memory.select(query).await
        } else {
            self.pg.select(query).await
        }
    }

    /// The mirror for a cached table, Postgres (taking the handle) otherwise.
    async fn select_shared(
        &self,
        query: Arc<SingleTableReadQuery>,
    ) -> Result<Snapshot, StorageError> {
        if self.is_cached(&query.table) {
            self.memory.select(&query).await
        } else {
            self.pg.select_shared(query).await
        }
    }

    /// The count from the mirror when it holds every table of the tree,
    /// from Postgres (which holds them all) otherwise.
    async fn count(&self, query: &MultiTableReadQuery, cap: u64) -> Result<u64, StorageError> {
        if query
            .tables()
            .into_iter()
            .all(|table| self.is_cached(table))
        {
            self.memory.count(query, cap).await
        } else {
            self.pg.count(query, cap).await
        }
    }

    /// Both sources move.
    fn advance(&self, feed: Lsn) {
        self.memory.advance(feed);
        self.pg.advance(feed);
    }

    /// The lower of the two floors: a Postgres read can be as far back as
    /// its snapshot, a memory read is always current.
    fn floor(&self) -> Lsn {
        self.pg.floor().min(self.memory.floor())
    }

    /// A write on a cached table goes into the mirror.
    fn absorb(&self, write: &WriteQuery, at: Lsn) {
        if self.is_cached(write.table()) {
            self.memory.absorb(write, at);
        }
    }

    /// A column added to a cached table reaches the mirror.
    fn alter(&self, change: &SchemaChange) {
        if let SchemaChange::ColumnAdded { table, .. } = change
            && self.is_cached(table)
        {
            self.memory.alter(change);
        }
    }

    /// Postgres reads by the catalog.
    fn follow(&self, at: Lsn, catalog: Arc<Catalog>) {
        self.pg.follow(at, catalog);
    }

    /// Postgres mints.
    fn mint_now(&self) {
        self.pg.mint_now();
    }
}
