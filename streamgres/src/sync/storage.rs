//! The storage boundary: where rows the engine does not yet hold are read
//! from. Every read is asynchronous and reports, with its rows, the WAL
//! location its snapshot reflects every commit up to. A source is told how
//! far the write stream has been delivered ([`Storage::advance`]) and may
//! only answer reads from snapshots at or below that point, so a read is
//! never ahead of what the engine has applied; it also says the lowest
//! location a read may be positioned at from now on ([`Storage::floor`]),
//! which is how far back the runtime keeps delivered writes to bring a
//! read up. The in-process [`MemoryStorage`] is always at the stream
//! position (it holds the current rows, no bring-up needed); a source that
//! mints snapshots ahead of time (see `pg`) flips to a newer snapshot only
//! once the stream has passed it.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::ivm::{SchemaChange, complete_image, conform, evaluate, evaluate_with, order_rows};
use crate::model::{Catalog, ComparisonOperator, Condition, MultiTableReadQuery, Snapshot, Value};
use crate::model::{DataFrameKey, DataFrameRow, Lsn, SingleTableReadQuery, TableName, WriteQuery};

/// A failed storage read; the runtime parks the read and hands it out
/// again once the stream moves, unless the read was refused (the message
/// begins with [`REFUSED`]): that read will never succeed, and the
/// subscriptions depending on it are told why instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageError(pub String);

/// The prefix of a refusal's message.
pub const REFUSED: &str = "refused: ";

impl StorageError {
    /// A read that will never succeed, with the reason a client can be told.
    pub fn refused(reason: impl Into<String>) -> Self {
        StorageError(format!("{REFUSED}{}", reason.into()))
    }

    /// The reason, when the read was refused rather than merely failed.
    pub fn refusal(&self) -> Option<&str> {
        self.0.strip_prefix(REFUSED)
    }
}

impl fmt::Display for StorageError {
    /// The message.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StorageError {}

/// Read-only access to the source of truth for row data.
///
/// The engine and its runtime are single-threaded by design, so the
/// returned futures need not be `Send`; a driver awaits them on the thread
/// that owns the engine.
#[allow(async_fn_in_trait)]
pub trait Storage {
    /// Rows of `query.table` whose full row image satisfies `query.filter`,
    /// read from **one consistent snapshot** of the source, as (identity,
    /// image) pairs, together with the position that snapshot reflects.
    /// That position must not exceed the last [`Storage::advance`]: the
    /// snapshot may be behind the stream (the runtime brings its rows up),
    /// never ahead of it. When `limit` is finite the result must honor
    /// `order_by` and `limit` (window maintenance depends on getting the
    /// *best* rows); an unlimited query may return rows in any order.
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError>;

    /// [`Storage::select`] for a query already shared: a source that runs
    /// the read as a task of its own takes the handle instead of copying
    /// the query. The default reads through the handle.
    async fn select_shared(
        &self,
        query: Arc<SingleTableReadQuery>,
    ) -> Result<Snapshot, StorageError> {
        self.select(&query).await
    }

    /// How many rows of `query`'s main table satisfy its filter with every
    /// `EXISTS` leaf answered by the inner edge it names — a row of the
    /// sub carrying the row's join value and satisfying the sub's own
    /// filter the same way, all the way down; an `EXISTS` naming no inner
    /// edge is false, an inner edge no leaf names is required, and an
    /// outer edge plays no part — counted no further than `cap`: the
    /// answer is exact below `cap`, and `cap` itself means "at least that
    /// many". A planner asks this before it registers a join, once on a
    /// node alone (its `EXISTS` leaves already taken as true) and once
    /// with its subtree, to learn how small the node is by itself and how
    /// small its subs make it; a source that can stop counting early does,
    /// and the default reads the rows of every node and counts them
    /// ([`count_by_select`]).
    async fn count(&self, query: &MultiTableReadQuery, cap: u64) -> Result<u64, StorageError> {
        count_by_select(self, query, cap).await
    }

    /// The stream has been delivered (and applied by the engine) up to
    /// `feed`: a snapshot at or below it may now serve reads.
    fn advance(&self, feed: Lsn);

    /// The lowest location a read issued from now on can be positioned
    /// at; the runtime keeps every delivered write above it.
    fn floor(&self) -> Lsn;

    /// A write the stream delivered at `at`, before it is routed: a source
    /// mirroring tables in memory applies it. No-op by default.
    fn absorb(&self, write: &WriteQuery, at: Lsn) {
        let _ = (write, at);
    }

    /// A migration grew the schema: a source mirroring tables in memory
    /// gives its rows the column. No-op by default.
    fn alter(&self, change: &SchemaChange) {
        let _ = change;
    }

    /// From the snapshot at or past `at` on, read with `catalog`: what a
    /// schema change committed at `at` asks of a source whose reads
    /// describe the tables in SQL. A source answering from memory has no
    /// use for it. No-op by default.
    fn follow(&self, at: Lsn, catalog: Arc<Catalog>) {
        let _ = (at, catalog);
    }

    /// Mint a read snapshot now rather than at the next rotation, for a
    /// source that mints ahead: what a schema change asks for, so that a
    /// snapshot holding it is current as soon as the feed reaches it.
    /// No-op by default.
    fn mint_now(&self) {}
}

/// [`Storage::count`] done by reading: the rows of `query`'s main table
/// (its filter as it stands, no `LIMIT`), kept when the filter holds with
/// each `EXISTS` leaf answered from the join values the sub it names
/// produces, the sub read the same way. Every node of the tree is read
/// whole, which suits a source that holds its rows in memory; a source
/// that would read many rows answers [`Storage::count`] itself.
pub async fn count_by_select<S: Storage + ?Sized>(
    storage: &S,
    query: &MultiTableReadQuery,
    cap: u64,
) -> Result<u64, StorageError> {
    let rows = matching_rows(storage, query).await?;
    Ok((rows.len() as u64).min(cap))
}

/// The rows a node contributes to a count, still being read.
type Matching<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<(DataFrameKey, DataFrameRow)>, StorageError>> + 'a>>;

/// The rows of `node`'s main table [`count_by_select`] counts, boxed so
/// the tree is walked recursively: each inner sub's matching rows give
/// the join values a row of the node may carry, and a row is kept when
/// its filter holds with the `EXISTS` leaves answered from them and it
/// carries a value of every inner edge no leaf names.
fn matching_rows<'a, S: Storage + ?Sized>(
    storage: &'a S,
    node: &'a MultiTableReadQuery,
) -> Matching<'a> {
    Box::pin(async move {
        let unlimited = SingleTableReadQuery {
            limit: u32::MAX,
            ..node.main_table.clone()
        };
        let snapshot = storage.select(&unlimited).await?;
        let mut values: Vec<HashSet<Value>> = Vec::with_capacity(node.joins.len());
        for join in &node.joins {
            let mut carried = HashSet::new();
            if join.is_inner {
                for (_, row) in matching_rows(storage, &join.sub).await? {
                    if let Some(value) = row.data.get(&join.sub_table_column)
                        && !value.is_null()
                    {
                        carried.insert(value.clone());
                    }
                }
            }
            values.push(carried);
        }
        let inner: Vec<usize> = node.inner_positions().collect();
        let named: Vec<usize> = node
            .main_table
            .filter
            .leaf_conditions()
            .into_iter()
            .filter(|leaf| leaf.comparison_operator == ComparisonOperator::EXISTS)
            .filter_map(|leaf| exists_position(&inner, &leaf.value))
            .collect();
        let rows = snapshot
            .rows
            .into_iter()
            .filter(|(_, row)| {
                let carries = |position: usize| {
                    let join = &node.joins[position];
                    row.data
                        .get(&join.main_table_column)
                        .is_some_and(|value| values[position].contains(value))
                };
                let exists =
                    |leaf: &Condition| exists_position(&inner, &leaf.value).is_some_and(carries);
                evaluate_with(&node.main_table.filter, &row.data, &mut 0, &exists)
                    && inner
                        .iter()
                        .filter(|position| !named.contains(position))
                        .all(|&position| carries(position))
            })
            .collect();
        Ok(rows)
    })
}

/// The position in `joins` of the inner edge an `EXISTS` leaf's operand
/// names, given the positions of the inner edges in order; `None` when it
/// names none.
fn exists_position(inner: &[usize], operand: &Value) -> Option<usize> {
    match operand {
        Value::Int(index) => usize::try_from(*index)
            .ok()
            .and_then(|index| inner.get(index).copied()),
        _ => None,
    }
}

/// In-process storage: plain tables of rows, kept in insertion order so
/// selects (and therefore the operations they lead to) are deterministic.
/// Reads answer immediately and are positioned at the stream position the
/// store was last advanced to: the store holds exactly the rows the
/// engine's position implies, so nothing needs bringing up.
///
/// Interior mutability lets tests hold a shared handle and mirror every
/// write into storage *before* routing it, the same order of events a
/// real database produces (commit first, change feed second).
#[derive(Default)]
pub struct MemoryStorage {
    tables: RefCell<HashMap<TableName, Vec<(DataFrameKey, DataFrameRow)>>>,
    position: Cell<Lsn>,
}

impl MemoryStorage {
    /// An empty store at location zero.
    pub fn new() -> Self {
        Self::default()
    }

    /// Mirror one write into the store: insert/update upsert the row by
    /// primary key (full-row-image semantics, like the engine), delete
    /// removes it. A partial image (columns the feed left out as
    /// unchanged) keeps the stored values of the columns it lacks, as
    /// PostgreSQL does.
    pub fn apply(&self, write: &WriteQuery) {
        let mut tables = self.tables.borrow_mut();
        let rows = tables.entry(write.table().clone()).or_default();
        let position = rows.iter().position(|(key, _)| key == write.pkey_value());
        match write.new_row_image() {
            Some(image) => {
                let stored = position
                    .filter(|_| image.data.is_partial())
                    .map(|index| &rows[index].1);
                let image = complete_image(Some(image), stored).unwrap_or_else(|| image.clone());
                let entry = (write.pkey_value().clone(), image);
                match position {
                    Some(index) => rows[index] = entry,
                    None => rows.push(entry),
                }
            }
            None => {
                if let Some(index) = position {
                    rows.remove(index);
                }
            }
        }
    }

    /// Put a table's rows in place (a warm-up from another source),
    /// upserting by primary key.
    pub fn load(&self, table: &TableName, rows: Vec<(DataFrameKey, DataFrameRow)>) {
        let mut tables = self.tables.borrow_mut();
        let held = tables.entry(table.clone()).or_default();
        for (key, row) in rows {
            match held.iter().position(|(existing, _)| *existing == key) {
                Some(index) => held[index] = (key, row),
                None => held.push((key, row)),
            }
        }
    }

    /// The location the store was last advanced to.
    pub fn position(&self) -> Lsn {
        self.position.get()
    }

    /// The rows `query` selects right now: a linear scan of the table,
    /// filtering by the query's `Where` via the same predicate evaluation
    /// the engine routes with. A finite `limit` sorts by the `order_by`
    /// columns in turn (via the window module's total order) and
    /// truncates; an unlimited query keeps insertion order.
    pub fn rows(&self, query: &SingleTableReadQuery) -> Vec<(DataFrameKey, DataFrameRow)> {
        let tables = self.tables.borrow();
        let Some(rows) = tables.get(&query.table) else {
            return Vec::new();
        };
        let mut selected: Vec<(DataFrameKey, DataFrameRow)> = rows
            .iter()
            .filter(|(_, row)| evaluate(&query.filter, &row.data, &mut 0))
            .cloned()
            .collect();
        if query.limit != u32::MAX {
            selected.sort_by(|(_, a), (_, b)| order_rows(&query.order_by, a, b));
            selected.truncate(query.limit as usize);
        }
        selected
    }
}

impl Storage for MemoryStorage {
    /// [`MemoryStorage::rows`], positioned at the store's position; ready
    /// immediately.
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

    /// Apply the write and move the position to it.
    fn absorb(&self, write: &WriteQuery, at: Lsn) {
        self.apply(write);
        self.advance(at);
    }

    /// A column added: every row of the table is laid out again with it.
    fn alter(&self, change: &SchemaChange) {
        let SchemaChange::ColumnAdded {
            table,
            column,
            value,
            schema,
        } = change
        else {
            return;
        };
        let mut tables = self.tables.borrow_mut();
        let Some(rows) = tables.get_mut(table) else {
            return;
        };
        let added = [(column.name.clone(), value.clone())];
        for (_, row) in rows.iter_mut() {
            if let Some(image) = conform(row, schema, &added) {
                *row = image;
            }
        }
    }
}
