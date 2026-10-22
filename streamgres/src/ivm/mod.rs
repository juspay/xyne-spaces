//! Incremental View Maintenance (IVM) — the core of the engine.
//!
//! Clients subscribe with [`SingleTableReadQuery`]s and get back an engine
//! id ([`SubId`]); every incoming [`WriteQuery`] is routed to the
//! subscriptions it affects, and each affected subscription receives the
//! minimal [`DataFrameOperation`]s that bring its result set up to date,
//! folded per row with every subscription they apply to ([`Delta`]).
//!
//! # Shared frames
//!
//! The engine keeps **one materialized frame per table**, not per
//! subscription: each row carries the set of subscriptions currently
//! holding it. A row wanted by many queries is stored once; a new
//! subscriber to data already present just tags itself onto the rows. A
//! subscription's own view (what its client holds) is exactly the rows
//! tagged with its id — mirrored in a per-subscription **held-key index**
//! (subscription → row keys), so a view is enumerated in time proportional
//! to its own size, never by scanning the table. Every tag change reaches
//! that client as an `Add` or `Delete` — engine tags and client frames
//! stay in lockstep.
//!
//! Registration exploits the sharing: a query **structurally identical**
//! to one already registered is served straight from the shared frame —
//! the twin's current rows are tagged for the new subscription and
//! returned as its snapshot, with no storage query. A twin whose own read
//! is still out donates what it holds so far, and the read, when it
//! lands, serves every subscription of its query, so a burst of identical
//! registrations costs one storage read.
//!
//! # How a write is routed
//!
//! A write can affect a subscription in exactly two ways, and the engine
//! checks for both:
//!
//! 1. **The new row matches the query** (insert, or update moving a row in /
//!    changing it in place) — decided by *DNF counting*. At registration a
//!    query's `Where` is normalized to disjunctive normal form
//!    ([`crate::model::Where::to_dnf`]): an OR of **disjuncts**, each an AND
//!    of leaf conditions. Each distinct condition on the write's table is
//!    evaluated against the row image exactly once; every condition that
//!    matches bumps the shared counter of each disjunct containing it, and
//!    a counter reaching its size **fires** every subscription whose filter
//!    contains that disjunct — identical disjunct shapes share one counter
//!    across subscriptions. Firing is exact (there is no verification pass)
//!    and the bookkeeping after evaluation is proportional to the
//!    *matching* links only, not to the number of registered subscriptions.
//!    A disjunct with no conditions (no `WHERE` at all, or shapes like
//!    `x OR TRUE`) is invisible to the condition index and fires on every
//!    same-table row write. The machinery lives in one `TableIndex` per
//!    table (see the `index` module). A single condition whose value list
//!    changes — the join layer's `IN` gaining or losing a value — is
//!    edited **in place**, in the stored filter and inside this
//!    subscription's indexed disjuncts alone
//!    ([`SingleTableIVM::replace_condition`]; shared counters split
//!    correctly), with no DNF re-normalization. Windowed candidates not
//!    already holding the row are additionally checked against the
//!    window's admission boundary (see the `window` module) — admission
//!    only, never residence: a held row worsening in place keeps its slot
//!    until a better arrival evicts it.
//! 2. **The query currently holds the row** (delete, or update moving a row
//!    out) — found by checking whether the shared row is tagged with the
//!    subscription. A delete carries no column values, so predicate
//!    matching cannot find these.
//!
//! From `matches_after` (1) and `present_before` (2) the operation follows:
//!
//! | `matches_after` | `present_before` | emitted operation(s)                           |
//! |-----------------|------------------|------------------------------------------------|
//! | yes             | no               | `Add` (row enters)                             |
//! | yes             | yes              | `Delete(old)` + `Add(new)` (replaced in place) |
//! | no              | yes              | `Delete(old)` (row leaves)                     |
//! | no              | no               | not impacted                                   |
//!
//! Every emitted operation is self-contained: a `Delete` carries the row
//! image it removed, and an in-place replacement is the adjacent
//! `Delete(old)` + `Add(new)` pair inside the engine (the join layer diffs
//! it); leaving the engine the pair folds into the one `Add` (see the
//! `update` module).
//!
//! # Scope notes
//!
//! - A finite `limit` is enforced through a per-subscription **window**
//!   (see the `window` module): the engine buffers twice the requested
//!   limit (storage reads are issued with the doubled limit), admits new
//!   rows past a full buffer only when they beat the worst held value,
//!   evicts past capacity, and asks for a refill from storage when a
//!   removal drains the buffer to the requested limit. `order_by` decides
//!   *which* rows the window keeps — it does not order the operation
//!   stream (clients sort their own frames). A query without a finite
//!   limit keeps every matching row; a `LIMIT 0` subscription is
//!   permanently empty (its registration reads nothing and later writes
//!   never admit).
//! - The engine **never reads storage itself**. Frames fill four ways:
//!   the initial result set of a registration, writes seen afterwards,
//!   the narrowed reads the join layer asks for when a join value
//!   becomes referenced ([`SingleTableIVM::fetch`]), and a row read
//!   again by primary key when the only image of it at hand is partial
//!   (`FetchKind::Row`). A frame never holds a partial image. Each read is
//!   recorded as a [`Fetch`] request (see the `engine` module) and landed
//!   later by the runtime through [`Engine::land`]; between the two the
//!   subscription's routing is live, its window publishes no admission
//!   boundary (so nothing the read will miss is turned away), and it is
//!   skipped as a twin donor. **Positions never enter the engine**: the
//!   runtime brings every read up to the point the engine has reached
//!   before landing it (a delivered write past the read's snapshot is
//!   applied to the result first), so a landed row is current, and a row
//!   the frame already holds is simply tagged. The whole engine sits at
//!   one position at every moment.
//! - DNF can blow up exponentially for adversarial filters; a size cap with
//!   a tree-evaluation fallback is deliberately deferred (see
//!   [`crate::model::Where::to_dnf`]).
//! - The engine is **single-threaded by design** for now, enforced at
//!   compile time (the index's shared counter handles are not `Send`).
//!   Multithreading is a later, deliberate step — see the `index` module
//!   header.

mod columns;
mod engine;
mod frames;
mod index;
mod multi;
mod predicate;
mod registry;
mod stats;
mod update;
mod window;

pub use crate::model::SubId;
pub use engine::{Engine, Fetch, FetchId, FetchKind, Footprint, SchemaChange, conform};
pub use multi::{MultiTableIVM, MultiTableUpdate};
pub use predicate::{eval_condition, evaluate, evaluate_with};
pub use stats::IvmStats;
pub use update::{Audience, Delta, QueryPart, Subs, Target};
pub use window::{PAGE_FIRST_BATCH, PAGE_ROUNDS, PageSpec, order_cmp, order_rows};

/// The most rows one batch of a page reads when no other limit is set:
/// the same number the server's `STREAMGRES_ROW_LIMIT` defaults to.
pub const DEFAULT_ROW_LIMIT: usize = 100_000;

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use crate::model::frame::{RowId, SharedRow, TableFrame};
use crate::model::{
    ColumnName, DataFrameKey, DataFrameOperation, DataFrameRow, IdMap, IdSet, RowData, RowSchema,
    SingleTableReadQuery, TableName, Value, WriteQuery,
};
use index::TableIndex;
use update::{Raw, fold};
use window::Window;

/// One operation for one single-table subscription — what
/// [`SingleTableIVM::incremental_update`] emits; the join layer consumes
/// these for its parts, and the [`Engine`] impl folds them per row.
///
/// - `query`: which subscription (the engine id `register_query` returned).
/// - `table`: the table the operation lands on — the written table, which
///   is also the subscription's table.
/// - `op`: the delta itself.
#[derive(Debug, Clone, PartialEq)]
pub struct SingleTableUpdate {
    pub query: SubId,
    pub table: TableName,
    pub op: DataFrameOperation,
}

/// The engine. One instance maintains all subscriptions over one logical
/// database, one subscription per single-table query; multi-table joins
/// are layered on top by [`MultiTableIVM`].
///
/// - `select_queries`: subscription id → its query. Ids are `u64`s the
///   engine hands out at registration; the transport maps client ids to
///   them.
/// - `by_query`: query → the subscriptions registered with exactly that
///   query, the one-lookup twin index; re-keyed whenever a stored query
///   changes shape.
/// - `frames`: ONE shared frame per table, rows tagged with their
///   subscribers' ids (see the module header).
/// - `held`: subscription → the row ids of the shared rows it currently
///   holds — the forward mirror of the rows' subscriber tags, kept in
///   lockstep with them, so a subscription's view is enumerable without
///   scanning its table's frame. A (subscription, row) pair is two small
///   integers, one in each direction.
/// - `windows`: subscription → its ORDER BY / LIMIT window (finite-limit
///   queries only): the order-value → row-key map whose worst entry is
///   the admission boundary, published into the table's routing index
///   whenever it moves (see the `window` module).
/// - `tables`: one routing index per table — the condition →
///   shared-disjunct-counter machinery (see the `index` module).
/// - `pending`: subscription → how many storage reads it is waiting on,
///   its own and its twins' (a read serves every subscription of its
///   query); while nonzero the subscription publishes no admission
///   boundary and asks for no refill.
/// - `readers`: read out → the subscriptions it will land into: the one
///   that asked and every subscription of its query, joined by twins
///   registered while it is out.
/// - `requests`: the reads asked for since the runtime last took them.
/// - `rows_out`: the rows being read again by primary key
///   ([`FetchKind::Row`]), by table and key: one read per row, which a
///   subscription needing the row meanwhile joins instead of asking again.
/// - `write_epoch`: monotonic write number; disjunct counters are lazily
///   invalidated by comparing against it, so no per-write reset sweep is
///   needed.
/// - `next_sub`: the next subscription id to hand out; never reused.
/// - `next_fetch`: the next read id to hand out; never reused.
/// - `graveyard`: rows dropped since the last [`Engine::take_dead`], so
///   that freeing them (a hash map and its strings per row) happens off
///   the engine's thread; a release of a large subscription is otherwise
///   spent in the allocator.
/// - `layouts`: for each table a migration widened while the engine ran,
///   its row layout now and the columns added with their values, so a
///   row that enters without them is completed ([`Engine::alter`]).
///   Empty until a column is added, which is what keeps the check off the
///   write path until then.
/// - `row_limit`: the most rows one read of a page's batch asks for (the
///   storage refuses reads past it, so no batch is sized past it).
/// - `stats`: operation counters; not part of the sync state.
pub struct SingleTableIVM {
    select_queries: IdMap<SubId, SingleTableReadQuery>,
    by_query: HashMap<SingleTableReadQuery, BTreeSet<SubId>>,
    frames: HashMap<TableName, TableFrame>,
    layouts: HashMap<TableName, Layout>,
    held: IdMap<SubId, IdSet<RowId>>,
    windows: IdMap<SubId, Window>,
    tables: HashMap<TableName, TableIndex>,
    pending: IdMap<SubId, u32>,
    readers: IdMap<FetchId, Vec<SubId>>,
    requests: Vec<Fetch>,
    rows_out: HashMap<(TableName, DataFrameKey), FetchId>,
    write_epoch: u64,
    next_sub: u64,
    next_fetch: u64,
    graveyard: Vec<SharedRow>,
    row_limit: usize,
    stats: IvmStats,
}

/// A table's row layout after a migration added columns to it, and those
/// columns with the value every earlier row was given.
struct Layout {
    schema: Arc<RowSchema>,
    added: Vec<(ColumnName, Value)>,
}

/// One confirmed impact of a write on a subscription, with the two facts
/// that determine which operation to emit.
///
/// - `matches_after`: does the post-write row image satisfy the query's
///   `Where`? Always `false` for deletes.
/// - `present_before`: was the shared row tagged with this subscription
///   before the write?
struct Impact {
    sub: SubId,
    matches_after: bool,
    present_before: bool,
}

impl Default for SingleTableIVM {
    /// [`SingleTableIVM::new`].
    fn default() -> Self {
        Self::new()
    }
}

impl SingleTableIVM {
    /// An empty engine.
    pub fn new() -> Self {
        SingleTableIVM {
            select_queries: IdMap::default(),
            by_query: HashMap::new(),
            frames: HashMap::new(),
            layouts: HashMap::new(),
            held: IdMap::default(),
            windows: IdMap::default(),
            tables: HashMap::new(),
            pending: IdMap::default(),
            readers: IdMap::default(),
            requests: Vec::new(),
            rows_out: HashMap::new(),
            write_epoch: 0,
            next_sub: 0,
            next_fetch: 0,
            graveyard: Vec::new(),
            row_limit: DEFAULT_ROW_LIMIT,
            stats: IvmStats::default(),
        }
    }

    /// The engine with `limit` as the most rows one batch of a page
    /// reads: the storage's row limit, so that no read is sized past what
    /// it would refuse.
    pub fn with_row_limit(mut self, limit: usize) -> Self {
        self.row_limit = limit.max(1);
        self
    }

    /// The most rows one batch of a page reads.
    pub fn row_limit(&self) -> usize {
        self.row_limit
    }

    /// Take the storage reads recorded since the last call, oldest first.
    pub fn take_requests(&mut self) -> Vec<Fetch> {
        std::mem::take(&mut self.requests)
    }

    /// Whether a storage read `sub` is waiting on is still out.
    pub fn is_pending(&self, sub: SubId) -> bool {
        self.pending.get(&sub).is_some_and(|count| *count > 0)
    }

    /// The subscriptions a read out will land into (the one that asked
    /// and its twins); a read the engine does not know lands into the one
    /// that asked.
    pub fn readers_of(&self, fetch: &Fetch) -> Vec<SubId> {
        self.readers
            .get(&fetch.id)
            .cloned()
            .unwrap_or_else(|| vec![fetch.sub])
    }

    /// Which registered subscriptions does this write affect?
    ///
    /// Returns subscription ids in deterministic (sorted) order. Records
    /// routing counters in [`SingleTableIVM::stats`].
    pub fn search_impacted_queries(&mut self, write_query: &WriteQuery) -> Vec<SubId> {
        self.analyze(
            write_query.table(),
            write_query.pkey_value(),
            write_query.new_row_image(),
        )
        .into_iter()
        .map(|impact| impact.sub)
        .collect()
    }

    /// Route a write: find the impacted subscriptions, emit one
    /// [`SingleTableUpdate`] per self-contained operation, and bring the
    /// shared frame's data and tags in line.
    ///
    /// Per impacted subscription: a holder of the row's pre-image gets
    /// `Delete(key, old)`, a subscription the new image fires gets
    /// `Add(key, new)`, and one in both camps gets the adjacent pair — the
    /// in-place replacement row of the module header's table. The shared
    /// row's data is written once; each firing subscription tags itself,
    /// each no-longer-matching holder untags itself, and the row is
    /// dropped when its last tag goes.
    ///
    /// A partial image (the feed left a large unchanged value out) is
    /// completed from the frame's image of the row. When nobody holds the
    /// row there is nothing to complete it from: no subscription is sent
    /// it and the frame does not take it; the row is read again by
    /// primary key for the subscriptions it enters
    /// ([`SingleTableIVM::read_row`]) and reaches them when that read
    /// lands.
    pub fn incremental_update(&mut self, write_query: &WriteQuery) -> Vec<SingleTableUpdate> {
        self.stats.writes_processed += 1;
        let table = write_query.table().clone();
        let key = write_query.pkey_value().clone();
        let old_data = self
            .frames
            .get(&table)
            .and_then(|frame| frame.get(&key))
            .map(|row| row.data.clone());
        let completed = complete_image(write_query.new_row_image(), old_data.as_ref());
        let row_image = completed.as_ref().or(write_query.new_row_image());
        let unconformed = row_image;
        let conformed = row_image.and_then(|image| self.conform(&table, image));
        let row_image = conformed.as_ref().or(row_image);
        let impacts = self.analyze(&table, &key, row_image);
        if old_data.is_none()
            && !impacts.is_empty()
            && unconformed.is_some_and(|image| image.data.is_partial())
        {
            let entering: Vec<SubId> = impacts.iter().map(|impact| impact.sub).collect();
            self.read_row(&table, &key, &entering);
            return Vec::new();
        }

        let mut ops: Vec<SingleTableUpdate> = Vec::new();
        for impact in &impacts {
            if impact.present_before {
                let data = old_data
                    .clone()
                    .expect("present_before is only true when the shared row is materialized");
                self.stats.ops_delete += 1;
                ops.push(SingleTableUpdate {
                    query: impact.sub,
                    table: table.clone(),
                    op: DataFrameOperation::Delete(key.clone(), data),
                });
            }
            if impact.matches_after {
                let row = row_image
                    .expect("matches_after is only true when the write has a row image")
                    .clone();
                self.stats.ops_add += 1;
                ops.push(SingleTableUpdate {
                    query: impact.sub,
                    table: table.clone(),
                    op: DataFrameOperation::Add(key.clone(), row),
                });
            }
        }

        if !impacts.is_empty() {
            let frame = self.frames.entry(table).or_default();
            let matched_any = impacts.iter().any(|impact| impact.matches_after);
            if let Some(image) = row_image.filter(|_| matched_any) {
                let (id, _) = frame.entry(&key, || image.clone());
                frame.replace_image(id, image.clone());
            }
            for impact in &impacts {
                if impact.matches_after {
                    let id = frame.id_of(&key).expect("materialized just above");
                    if let Some(row) = frame.row_mut(id) {
                        row.subscribers.insert(impact.sub);
                    }
                    self.held.entry(impact.sub).or_default().insert(id);
                } else if let Some(id) = frame.id_of(&key) {
                    if let Some(row) = frame.row_mut(id) {
                        row.subscribers.remove(&impact.sub);
                    }
                    if let Some(ids) = self.held.get_mut(&impact.sub) {
                        ids.remove(&id);
                    }
                }
            }
            if let Some(id) = frame.id_of(&key)
                && let Some(dead) = frame.take_if_unheld(id)
            {
                self.graveyard.push(dead);
            }
        }

        let mut window_ops = Vec::new();
        for impact in &impacts {
            window_ops.extend(self.maintain_window(
                impact.sub,
                &key,
                row_image,
                impact.matches_after,
                impact.present_before,
            ));
        }
        ops.append(&mut window_ops);

        let impacted: Vec<SubId> = impacts.iter().map(|impact| impact.sub).collect();
        self.gate_updates(&impacted, ops)
    }

    /// `image` completed with the columns a migration added to `table`
    /// that it lacks ([`engine::conform`]); `None` when it has them all,
    /// which is every row once the tables' layouts have never changed.
    pub(super) fn conform(&self, table: &TableName, image: &DataFrameRow) -> Option<DataFrameRow> {
        if self.layouts.is_empty() {
            return None;
        }
        let layout = self.layouts.get(table)?;
        engine::conform(image, &layout.schema, &layout.added)
    }

    /// A column joined `table`: every held row of the table that lacks it
    /// is laid out again on `schema` with `value` in it, and rows entering
    /// from now on are completed the same way. No delta comes of it.
    /// Adding a column already added changes nothing.
    pub fn add_column(
        &mut self,
        table: &TableName,
        column: ColumnName,
        value: Value,
        schema: Arc<RowSchema>,
    ) {
        let layout = self.layouts.entry(table.clone()).or_insert_with(|| Layout {
            schema: schema.clone(),
            added: Vec::new(),
        });
        layout.schema = schema;
        if !layout.added.iter().any(|(added, _)| *added == column) {
            layout.added.push((column, value));
        }
        let Some(frame) = self.frames.get_mut(table) else {
            return;
        };
        let rewritten: Vec<(RowId, DataFrameRow)> = frame
            .rows()
            .filter_map(|(id, row)| {
                engine::conform(&row.data, &layout.schema, &layout.added).map(|image| (id, image))
            })
            .collect();
        for (id, image) in rewritten {
            frame.replace_image(id, image);
        }
    }

    /// Tag `sub` onto the frame row `key` of `table` (which must be
    /// materialized), emitting its `Add` with `image` (the frame's image);
    /// nothing when it already holds the row. The caller maintains the
    /// window.
    pub(super) fn tag_row(
        &mut self,
        sub: SubId,
        table: &TableName,
        key: &DataFrameKey,
        image: &DataFrameRow,
    ) -> Option<SingleTableUpdate> {
        let frame = self.frames.get_mut(table)?;
        let id = frame.id_of(key)?;
        let row = frame.row_mut(id)?;
        if !row.subscribers.insert(sub) {
            return None;
        }
        self.held.entry(sub).or_default().insert(id);
        self.stats.ops_add += 1;
        Some(SingleTableUpdate {
            query: sub,
            table: table.clone(),
            op: DataFrameOperation::Add(key.clone(), image.clone()),
        })
    }

    /// Wrap bare operations of `sub` into updates, for the runtime seam.
    fn tagged(&self, sub: SubId, ops: Vec<DataFrameOperation>) -> Vec<SingleTableUpdate> {
        let Some(query) = self.select_queries.get(&sub) else {
            return Vec::new();
        };
        let table = query.table.clone();
        ops.into_iter()
            .map(|op| SingleTableUpdate {
                query: sub,
                table: table.clone(),
                op,
            })
            .collect()
    }

    /// One step's per-subscription updates folded per row: what the
    /// [`Engine`] seam hands out.
    fn folded(&self, updates: Vec<SingleTableUpdate>) -> Vec<Delta> {
        fold(
            updates
                .into_iter()
                .map(|update| Raw {
                    table: update.table,
                    audience: Audience {
                        part: QueryPart::main(),
                        subs: Subs::One(update.query),
                    },
                    op: update.op,
                })
                .collect(),
        )
    }

    /// Number of registered subscriptions.
    pub fn query_count(&self) -> usize {
        self.select_queries.len()
    }

    /// The engine's operation counters, accumulated since creation or the
    /// last [`SingleTableIVM::reset_stats`].
    pub fn stats(&self) -> &IvmStats {
        &self.stats
    }

    /// Reset all operation counters to zero; sync state is untouched.
    pub fn reset_stats(&mut self) {
        self.stats = IvmStats::default();
    }

    /// The single source of truth for "is this subscription impacted, and
    /// how" by a row of `table_name` identified by `key` taking the image
    /// `row_image` (`None` for a delete) — every routing entry point
    /// builds on it.
    ///
    /// Way 1 (row matches after the write) delegates to the table's routing
    /// index under a freshly bumped write epoch — the index itself also
    /// applies each candidate's admission boundary, exempting holders;
    /// deletes carry no row image and skip it entirely. Way 2 (row held
    /// before the write) reads the shared row's subscriber tags — catches
    /// updates moving a row out, and deletes. Both come sorted and are
    /// merged, so every returned [`Impact`] has at least one of the two
    /// facts set and the impacts are in id order.
    fn analyze(
        &mut self,
        table_name: &TableName,
        key: &DataFrameKey,
        row_image: Option<&DataFrameRow>,
    ) -> Vec<Impact> {
        let holding: Vec<SubId> = self
            .frames
            .get(table_name)
            .and_then(|frame| frame.get(key))
            .map(|row| {
                row.subscribers
                    .iter()
                    .copied()
                    .filter(|sub| self.select_queries.contains_key(sub))
                    .collect()
            })
            .unwrap_or_default();
        self.stats.membership_probes += holding.len() as u64;
        self.stats.membership_hits += holding.len() as u64;

        let mut matched: Vec<SubId> = Vec::new();
        if let Some(row) = row_image {
            debug_assert!(
                key.pkey_value
                    .iter()
                    .all(|(column, value)| row.data.get(column) == Some(value)),
                "a write's record must carry its own primary-key values"
            );
            self.write_epoch += 1;
            if let Some(table_index) = self.tables.get(table_name) {
                matched =
                    table_index.matched(&row.data, self.write_epoch, &holding, &mut self.stats);
            }
        }

        let mut impacts = Vec::with_capacity(matched.len() + holding.len());
        let (mut m, mut h) = (0usize, 0usize);
        while m < matched.len() || h < holding.len() {
            let (sub, matches_after, present_before) = match (matched.get(m), holding.get(h)) {
                (Some(a), Some(b)) if a == b => {
                    m += 1;
                    h += 1;
                    (*a, true, true)
                }
                (Some(a), Some(b)) if a < b => {
                    m += 1;
                    (*a, true, false)
                }
                (Some(_), Some(b)) => {
                    h += 1;
                    (*b, false, true)
                }
                (Some(a), None) => {
                    m += 1;
                    (*a, true, false)
                }
                (None, Some(b)) => {
                    h += 1;
                    (*b, false, true)
                }
                (None, None) => break,
            };
            self.stats.queries_impacted += 1;
            impacts.push(Impact {
                sub,
                matches_after,
                present_before,
            });
        }
        impacts
    }
}

/// The new image of a write completed from an earlier image of the same
/// row (the one the frame holds, or the one a read brought): a column the
/// feed left out (one PostgreSQL reported unchanged, a large value the
/// update did not touch) takes its earlier value, so the row the
/// subscribers see stays whole. The result is laid out like `old` when
/// `old` has every column `new` has (the table's own layout, for a row
/// decoded from the feed or from storage), and is partial only when
/// `old` was. `None` when nothing was missing or there is no earlier
/// image, and the write's own image serves.
pub fn complete_image(
    new: Option<&DataFrameRow>,
    old: Option<&DataFrameRow>,
) -> Option<DataFrameRow> {
    let (new, old) = (new?, old?);
    if Arc::ptr_eq(new.data.schema(), old.data.schema())
        || old.data.keys().all(|column| new.data.contains_key(column))
    {
        return None;
    }
    if new.data.keys().all(|column| old.data.contains_key(column)) {
        let values = old
            .data
            .iter()
            .map(|(column, value)| new.data.get(column).unwrap_or(value).clone())
            .collect();
        return Some(DataFrameRow::from(RowData::with_schema(
            old.data.schema().clone(),
            values,
        )));
    }
    let mut data = old.data.to_map();
    for (column, value) in new.data.iter() {
        data.insert(column.clone(), value.clone());
    }
    Some(DataFrameRow::from(if old.data.is_partial() {
        RowData::partial(data)
    } else {
        RowData::from(data)
    }))
}

impl Engine for SingleTableIVM {
    type Query = SingleTableReadQuery;

    /// [`SingleTableIVM::register_query`], its snapshot as deltas.
    fn subscribe(&mut self, query: SingleTableReadQuery) -> (SubId, Vec<Delta>) {
        let (sub, ops) = self.register_query(query);
        let updates = self.tagged(sub, ops);
        (sub, self.folded(updates))
    }

    /// [`SingleTableIVM::unregister_query`].
    fn unsubscribe(&mut self, sub: SubId) {
        self.unregister_query(sub);
    }

    /// [`SingleTableIVM::readers_of`].
    fn waiting_on(&self, fetch: &Fetch) -> Vec<SubId> {
        self.readers_of(fetch)
    }

    /// What the engine holds: its subscriptions, its trees and the rows
    /// in its frames per table.
    fn footprint(&self) -> Footprint {
        let mut rows_by_table: Vec<(String, u64)> = self
            .frames
            .iter()
            .map(|(table, frame)| (table.to_string(), frame.len() as u64))
            .collect();
        rows_by_table.sort();
        Footprint {
            subscriptions: self.select_queries.len() as u64,
            trees: 0,
            rows_by_table,
        }
    }

    /// The rows dropped since the last call, to be freed elsewhere.
    fn take_dead(&mut self) -> Vec<SharedRow> {
        std::mem::take(&mut self.graveyard)
    }

    /// Every reader of the refused fetch, unsubscribed.
    fn refuse(&mut self, fetch: &Fetch) -> Vec<SubId> {
        self.forget_read(fetch);
        let gone = self.readers_of(fetch);
        for sub in &gone {
            self.unregister_query(*sub);
        }
        gone
    }

    /// [`SingleTableIVM::incremental_update`], folded per row.
    fn route(&mut self, write: &WriteQuery) -> Vec<Delta> {
        let updates = self.incremental_update(write);
        self.folded(updates)
    }

    /// [`SingleTableIVM::land_read`], folded per row.
    fn land(
        &mut self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
        worst_read: Option<&DataFrameRow>,
    ) -> Vec<Delta> {
        let updates = self.land_read(fetch, rows, worst_read);
        self.folded(updates)
    }

    /// [`SingleTableIVM::take_requests`].
    fn requests(&mut self) -> Vec<Fetch> {
        self.take_requests()
    }

    /// [`SingleTableIVM::add_column`] for a column added; nothing for a
    /// table added.
    fn alter(&mut self, change: &SchemaChange) {
        if let SchemaChange::ColumnAdded {
            table,
            column,
            value,
            schema,
        } = change
        {
            self.add_column(table, column.name.clone(), value.clone(), schema.clone());
        }
    }

    /// Registered, with no read out.
    fn hydrated(&self, sub: SubId) -> bool {
        self.select_queries.contains_key(&sub) && !self.is_pending(sub)
    }

    /// [`SingleTableIVM::stats`].
    fn stats(&self) -> &IvmStats {
        &self.stats
    }
}
