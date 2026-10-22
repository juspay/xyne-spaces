//! The seam between an engine and the runtime that feeds it: the engine
//! never reads storage itself. Where it needs rows it does not hold (a
//! registration's initial result set, a join edge's newly referenced
//! value, a drained window's refill, a row a write brought in with
//! columns the feed left out) it records a [`Fetch`] request and
//! carries on; the runtime runs the read, brings its result up to the
//! point the engine has reached, and lands the rest through
//! [`Engine::land`]. Positions never enter the engine: what lands is
//! current by construction. [`Engine`] is what the two engines
//! (single-table and join tree) expose to that runtime. An engine knows
//! subscriptions and nothing of the clients behind them: every delta it
//! emits names the subscriptions it applies to ([`super::Delta`]), and
//! whose they are is the transport's business.

use std::fmt;
use std::sync::Arc;

use super::Delta;
use crate::model::frame::SharedRow;
use crate::model::{
    ColumnName, DataFrameKey, DataFrameRow, DbColumn, DbTable, RowData, RowSchema,
    SingleTableReadQuery, SubId, TableName, Value, WriteQuery,
};

/// A migration the engine absorbs while it runs (the seam's vocabulary
/// for it, whichever source noticed the change).
///
/// - `TableAdded`: a table the catalog now has; the engine holds no row of
///   it yet.
/// - `ColumnAdded`: `column` joined `table`; `value` is what every row
///   the database already had holds for it (its default, or `NULL`), and
///   `schema` the table's row layout with the column in it, so rewritten
///   rows share one layout with the rows that arrive from now on.
#[derive(Debug, Clone, PartialEq)]
pub enum SchemaChange {
    TableAdded {
        table: DbTable,
    },
    ColumnAdded {
        table: TableName,
        column: DbColumn,
        value: Value,
        schema: Arc<RowSchema>,
    },
}

impl fmt::Display for SchemaChange {
    /// One line for the log: what was added where, and what the rows hold.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SchemaChange::TableAdded { table } => write!(
                f,
                "table `{}` added ({} columns, key {:?})",
                table.name,
                table.columns.len(),
                table.pkey
            ),
            SchemaChange::ColumnAdded {
                table,
                column,
                value,
                ..
            } => write!(
                f,
                "column `{}` ({:?}) added to `{table}`, existing rows {value:?}",
                column.name, column.r#type
            ),
        }
    }
}

/// `image` laid out on `schema` with the `added` columns it lacks given
/// their values, or `None` when it already carries them all: the fast
/// path is one pointer comparison (a row decoded on the table's current
/// layout shares the layout's allocation), the slow one a lookup per
/// added column, and a rebuild only for a row from before the change.
pub fn conform(
    image: &DataFrameRow,
    schema: &Arc<RowSchema>,
    added: &[(ColumnName, Value)],
) -> Option<DataFrameRow> {
    if Arc::ptr_eq(image.data.schema(), schema)
        || added
            .iter()
            .all(|(column, _)| image.data.contains_key(column))
    {
        return None;
    }
    let values = schema
        .names()
        .iter()
        .map(|name| match image.data.get(name) {
            Some(value) => value.clone(),
            None => added
                .iter()
                .find(|(column, _)| column == name)
                .map_or(Value::Null, |(_, value)| value.clone()),
        })
        .collect();
    Some(DataFrameRow::from(RowData::with_schema(
        schema.clone(),
        values,
    )))
}

/// The engine's handle for one storage read it asked for; unique for the
/// life of the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FetchId(pub u64);

/// Why a read was asked for. Every kind runs the same way, in the
/// background while writes keep flowing; the subscription routes natively
/// meanwhile and the runtime brings the result up to the engine before it
/// lands.
///
/// - `Snapshot`: a registration's initial result set.
/// - `Narrowed`: the subscription's filter narrowed to one join value a
///   driving edge started referencing.
/// - `Refill`: a window drained to its limit, read again from its
///   frontier.
/// - `Lookup`: a page asked for the rows of one join value it dropped
///   earlier, because a write on the driven side concerns them; the rows
///   land like a write's and the frontier is left where it was.
/// - `Row`: one row read again by primary key, because the only image at
///   hand of a row its readers need is partial (the feed left columns out
///   of a write's image and no complete copy is held); the row lands like
///   the write's own `Add` would have, and the frontier is left where it
///   was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchKind {
    Snapshot,
    Narrowed,
    Refill,
    Lookup,
    Row,
}

/// One storage read an engine wants run on its behalf.
///
/// - `id`: the engine's handle for it.
/// - `sub`: the (inner) subscription whose rows the read feeds.
/// - `kind`: why it was asked for.
/// - `query`: exactly what to run; its `limit` is what the window
///   bookkeeping treats as the requested row count. Shared, so the read
///   travels to the runtime, the driver and the storage's task without
///   the filter tree being copied.
#[derive(Debug, Clone, PartialEq)]
pub struct Fetch {
    pub id: FetchId,
    pub sub: SubId,
    pub kind: FetchKind,
    pub query: Arc<SingleTableReadQuery>,
}

/// What an engine exposes to the runtime: subscribe, route, land reads,
/// hand over the reads it wants run.
pub trait Engine {
    /// The subscription spec this engine registers.
    type Query;

    /// Register a subscription: its id, and whatever of its initial
    /// result set is available at once (a twin's rows; nothing when a read
    /// was requested instead).
    fn subscribe(&mut self, query: Self::Query) -> (SubId, Vec<Delta>);

    /// Remove a subscription; reads still in flight for it land as no-ops.
    fn unsubscribe(&mut self, sub: SubId);

    /// The read `fetch` will never be served: remove every subscription
    /// that was waiting on it (all of a shared tree's) and name them, so
    /// the owner of each can be told.
    fn refuse(&mut self, fetch: &Fetch) -> Vec<SubId>;

    /// The subscriptions whose first rows may complete when `fetch` lands
    /// (all of a shared tree's), so a consumer checks those and not every
    /// subscription still hydrating.
    fn waiting_on(&self, fetch: &Fetch) -> Vec<SubId>;

    /// The rows dropped since the last call (their last holder released
    /// them), handed out so the caller can free them off this thread.
    fn take_dead(&mut self) -> Vec<SharedRow>;

    /// The subscriptions one of whose pages has stopped reaching past the
    /// rows its join gate rejects since the last call (the page then holds
    /// fewer rows than asked for): queries to report by name. None for an
    /// engine without joins.
    fn take_capped(&mut self) -> Vec<SubId> {
        Vec::new()
    }

    /// What the engine holds right now: its subscriptions, its shared
    /// trees and the rows in its frames per table.
    fn footprint(&self) -> Footprint;

    /// Route one write to every subscription it affects, grouped per
    /// client.
    fn route(&mut self, write: &WriteQuery) -> Vec<Delta>;

    /// Land the rows a requested read returned, already brought up to the
    /// engine's position by the runtime: each row is adopted into the
    /// shared frame if the frame does not hold it and tagged for the
    /// reading subscription. A partial row (a write since the snapshot
    /// brought it in with columns the feed left out) is never adopted: a
    /// held row is tagged with the frame's image, and one nobody holds is
    /// read again ([`FetchKind::Row`]), the subscription waiting on it.
    /// `worst_read` is the worst row the read returned when it came back
    /// full, before it was brought up to date (`None` when it came back
    /// short): what a window's frontier is set from.
    fn land(
        &mut self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
        worst_read: Option<&DataFrameRow>,
    ) -> Vec<Delta>;

    /// Take the reads recorded since the last call, in the order they were
    /// asked for.
    fn requests(&mut self) -> Vec<Fetch>;

    /// A migration grew the schema: a table the engine may see rows of
    /// from now on (nothing to do for it, its frame is made on first use),
    /// or a column added to a table, which every row the engine holds of
    /// that table gets with the value the database gave the existing rows,
    /// and every row that enters later without it gets on entry. No delta
    /// comes of it: what the clients hold is theirs on their own schema.
    fn alter(&mut self, change: &SchemaChange) {
        let _ = change;
    }

    /// Whether every row of `sub`'s initial result has arrived: no read it
    /// waits on is still out and, for a tree, every part is live. False
    /// for a subscription the engine does not know.
    fn hydrated(&self, sub: SubId) -> bool;

    /// The engine's routing counters.
    fn stats(&self) -> &super::IvmStats;
}

/// What an engine holds: subscriptions (parts, for a multi-table
/// engine), shared trees, and the rows in the shared frames per table.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Footprint {
    pub subscriptions: u64,
    pub trees: u64,
    pub rows_by_table: Vec<(String, u64)>,
}
