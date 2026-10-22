//! Subscription lifecycle: registering, replacing, and removing
//! subscriptions on the [`SingleTableIVM`], including twin sharing (an
//! identical query served from the shared frame, found through a
//! query-keyed index) and the in-place condition edits the join layer
//! uses for its set-valued `IN` leaves.

use super::index::TableIndex;
use super::window::{PageSpec, Window};
use super::{FetchKind, SingleTableIVM, SingleTableUpdate, window};
use crate::model::frame::RowId;
use crate::model::{Condition, DataFrameOperation, SingleTableReadQuery, SubId, TableName, Value};

impl SingleTableIVM {
    /// Register a subscription, returning its engine id and whatever of
    /// its initial result set is available at once, as `Add` operations.
    /// Ids are handed out by the engine and never reused; the layer above
    /// maps a client's own ids to them.
    ///
    /// The query's `Where` is normalized to DNF and indexed in the table's
    /// routing index (a `WHERE FALSE` query has no disjuncts and touches no
    /// index at all), so the subscription routes from this moment on. A
    /// query **structurally identical** to one already registered is
    /// served from the shared frame — the twin's current rows, no storage
    /// read, counted in `snapshots_shared` — found through the query-keyed
    /// index in one lookup; a twin whose own read is still out donates
    /// what it holds so far, and that read serves the new subscription
    /// too when it lands. A query with no twin records one storage read
    /// ([`super::FetchKind::Snapshot`]) that the runtime runs and lands
    /// later through [`SingleTableIVM::land_fetch`]; until then the
    /// returned operations are empty. Rows already shared with other
    /// subscriptions are tagged rather than duplicated.
    pub fn register_query(
        &mut self,
        select_query: SingleTableReadQuery,
    ) -> (SubId, Vec<DataFrameOperation>) {
        self.register_with(select_query, None)
    }

    /// Register a page under a gate (see the `window` module): as
    /// [`SingleTableIVM::register_query`], its window a page read as
    /// `spec` says and its first read sized by the spec. A page read in
    /// batches drops the rows its gate rejects, so it takes no twin's rows
    /// (a twin may have dropped rows this page has to decide for itself)
    /// and reads for itself; a page read whole shares like any query.
    pub fn register_page(
        &mut self,
        select_query: SingleTableReadQuery,
        spec: PageSpec,
    ) -> (SubId, Vec<DataFrameOperation>) {
        self.register_with(select_query, Some(spec))
    }

    /// Register a subscription that reads nothing at registration: its
    /// filter routes from this moment on, and its rows come from the
    /// narrowed reads asked for later ([`SingleTableIVM::fetch`]) and
    /// the writes that route to it. The join layer registers the driven
    /// part of an edge whose driver is a page read in batches this way:
    /// the part's filter carries no `IN` restriction, so reading it whole
    /// would read the table. Never a twin donor (it holds only what its
    /// driver referenced), and never served from one.
    pub fn register_driven(&mut self, select_query: SingleTableReadQuery) -> SubId {
        let sub = SubId(self.next_sub);
        self.next_sub += 1;
        self.stats.queries_registered += 1;
        let dnf = select_query.filter.to_dnf();
        if !dnf.is_empty() {
            self.tables
                .entry(select_query.table.clone())
                .or_default()
                .register(sub, dnf, &mut self.stats);
        }
        self.select_queries.insert(sub, select_query);
        sub
    }

    /// [`SingleTableIVM::register_query`] and
    /// [`SingleTableIVM::register_page`] in one: `page` says whether the
    /// window is a page and how it is read.
    fn register_with(
        &mut self,
        select_query: SingleTableReadQuery,
        page: Option<PageSpec>,
    ) -> (SubId, Vec<DataFrameOperation>) {
        let sub = SubId(self.next_sub);
        self.next_sub += 1;
        self.stats.queries_registered += 1;

        let dnf = select_query.filter.to_dnf();
        if !dnf.is_empty() {
            self.tables
                .entry(select_query.table.clone())
                .or_default()
                .register(sub, dnf, &mut self.stats);
        }
        let shares = page.is_none_or(|spec| spec.whole);
        let twin = shares
            .then(|| self.identical_subscription(&select_query, sub))
            .flatten();
        if shares {
            self.by_query
                .entry(select_query.clone())
                .or_default()
                .insert(sub);
        }
        if let Some(spec) = page
            && let Some(window) = Window::for_page(&select_query, spec, self.row_limit)
        {
            self.windows.insert(sub, window);
        }
        self.select_queries.insert(sub, select_query);

        let mut ops = Vec::new();
        match twin {
            Some(twin) => {
                self.stats.snapshots_shared += 1;
                let table = self.select_queries[&sub].table.clone();
                ops.extend(
                    self.share_rows(sub, twin, &table)
                        .into_iter()
                        .map(|update| update.op),
                );
                self.rebuild_window(sub);
                let inherited = self.windows.get(&twin).and_then(Window::frontier);
                if let Some(window) = self.windows.get_mut(&sub) {
                    window.set_frontier(inherited);
                }
                self.join_reads(sub, twin);
            }
            None => {
                self.rebuild_window(sub);
                let storage_query = self.storage_query(sub);
                self.issue(sub, storage_query, FetchKind::Snapshot);
            }
        }
        ops.extend(self.evict_overflow(sub));
        self.sync_boundary(sub);
        let ops = self.gate_window(sub, ops);
        (sub, ops)
    }

    /// Edit one condition of a subscription's filter **in place**: the
    /// stored filter's matching leaves are rewritten and the routing index
    /// swaps the condition inside this subscription's disjuncts only
    /// (splitting shared counters correctly) — no DNF re-normalization, no
    /// unregister/re-register churn.
    ///
    /// As with [`SingleTableIVM::replace_query`], the caller owns
    /// reconciling held rows with the new condition before it returns to
    /// the runtime: a fetch for what widened in (its pending read keeps
    /// the subscription from donating a twin snapshot until it lands), a
    /// prune of what narrowed out in the same call. Unknown subscriptions
    /// and identical conditions are no-ops.
    pub fn replace_condition(&mut self, sub: SubId, old: &Condition, new: Condition) {
        let Some(query) = self.select_queries.get_mut(&sub) else {
            return;
        };
        if *old == new {
            return;
        }
        let before = query.clone();
        query.filter.replace_condition(old, &new);
        let after = query.clone();
        self.move_query_key(sub, &before, after);
        if let Some(table_index) = self.tables.get_mut(&before.table) {
            table_index.update_condition(sub, old, &new, &mut self.stats);
        }
    }

    /// Add `value` to the set behind `condition`, a set-valued `IN` leaf of
    /// `sub`'s filter, and file the leaf under it in the index: the O(1)
    /// form of a join edge gaining a value. The stored filter needs no
    /// rewrite, since it holds the same set, and the query's identity does
    /// not change. As with [`SingleTableIVM::replace_condition`], the
    /// caller fetches the value's rows in the same call. Reports whether
    /// the set changed; a member already present, an unknown
    /// subscription, or a condition that is not set-valued changes
    /// nothing.
    pub fn set_insert(&mut self, sub: SubId, condition: &Condition, value: &Value) -> bool {
        let Value::Set(set) = &condition.value else {
            return false;
        };
        let Some(query) = self.select_queries.get(&sub) else {
            return false;
        };
        if !set.insert(value) {
            return false;
        }
        let table = query.table.clone();
        if let Some(table_index) = self.tables.get_mut(&table) {
            table_index.set_insert(condition, value);
        }
        self.stats.conditions_replaced += 1;
        true
    }

    /// Remove `value` from the set behind `condition` and unfile the leaf
    /// from it: the O(1) form of a join edge losing a value. The caller
    /// prunes the value's held rows in the same call. Reports whether the
    /// set changed.
    pub fn set_remove(&mut self, sub: SubId, condition: &Condition, value: &Value) -> bool {
        let Value::Set(set) = &condition.value else {
            return false;
        };
        let Some(query) = self.select_queries.get(&sub) else {
            return false;
        };
        if !set.remove(value) {
            return false;
        }
        let table = query.table.clone();
        if let Some(table_index) = self.tables.get_mut(&table) {
            table_index.set_remove(condition, value);
        }
        self.stats.conditions_replaced += 1;
        true
    }

    /// Count `count` snapshots served by an outer layer from rows this
    /// engine already holds (the join layer serving an identical tree from
    /// its shared parts), so `snapshots_shared` stays the one number for
    /// "registrations that touched no storage".
    pub(super) fn note_shared_snapshots(&mut self, count: u64) {
        self.stats.snapshots_shared += count;
    }

    /// The storage-facing form of a registered subscription's query:
    /// identical except for its limit, which is what its window's first
    /// read takes (twice the limit for an ordinary window, a page's first
    /// batch, everything for a page read whole).
    fn storage_query(&self, sub: SubId) -> SingleTableReadQuery {
        let query = &self.select_queries[&sub];
        SingleTableReadQuery {
            limit: window::storage_limit(query, self.windows.get(&sub)),
            ..query.clone()
        }
    }

    /// Remove a subscription: its routing-index entries and its tag on
    /// every shared row it holds — walked off its held index, not by
    /// scanning the table — dropping rows nobody holds anymore (the frame
    /// itself stays, with the value indexes asked of it). A table index
    /// that routes nothing afterwards is dropped too; a read not yet
    /// taken by the runtime passes to a twin waiting on it or is
    /// withdrawn, and a read already out lands for the twins waiting on
    /// it or as a no-op. Unknown subscriptions are a no-op.
    pub fn unregister_query(&mut self, sub: SubId) {
        let Some(query) = self.select_queries.remove(&sub) else {
            return;
        };
        if self.pending.remove(&sub).is_some() {
            self.readers.retain(|_, readers| {
                readers.retain(|reader| *reader != sub);
                !readers.is_empty()
            });
        }
        let readers = &self.readers;
        let mut withdrawn = Vec::new();
        self.requests.retain_mut(|fetch| {
            if fetch.sub != sub {
                return true;
            }
            match readers.get(&fetch.id).and_then(|readers| readers.first()) {
                Some(&next) => {
                    fetch.sub = next;
                    true
                }
                None => {
                    withdrawn.push(fetch.clone());
                    false
                }
            }
        });
        for fetch in &withdrawn {
            self.forget_read(fetch);
        }
        if let Some(twins) = self.by_query.get_mut(&query) {
            twins.remove(&sub);
            if twins.is_empty() {
                self.by_query.remove(&query);
            }
        }
        if let Some(table_index) = self.tables.get_mut(&query.table) {
            table_index.unregister(sub);
        }
        if self
            .tables
            .get(&query.table)
            .is_some_and(TableIndex::is_empty)
        {
            self.tables.remove(&query.table);
        }
        self.windows.remove(&sub);
        let ids = self.held.remove(&sub).unwrap_or_default();
        if let Some(frame) = self.frames.get_mut(&query.table) {
            for id in ids {
                if let Some(dead) = frame.release(id, sub) {
                    self.graveyard.push(dead);
                }
            }
        }
    }

    /// Swap the registered query of `sub` for `select_query`, reindexing
    /// its routing while leaving its frame tags untouched.
    ///
    /// The caller owns keeping held rows consistent with the new filter —
    /// this is the general reseat seam (for a single value change of a
    /// set-valued leaf, [`SingleTableIVM::set_insert`] is the cheap edit).
    /// That must happen before control returns to the runtime: a widened
    /// filter needs a fetch, whose pending read keeps the subscription
    /// from donating a twin snapshot until it lands; a narrowed one a
    /// prune in the same call; a swap both. A registration served from a
    /// subscription whose filter is ahead of its rows would inherit the
    /// gap permanently. The table must stay the same (a cross-table swap
    /// is refused); unknown subscriptions and identical queries are
    /// no-ops.
    pub fn replace_query(&mut self, sub: SubId, select_query: SingleTableReadQuery) {
        let Some(existing) = self.select_queries.get_mut(&sub) else {
            return;
        };
        if *existing == select_query || existing.table != select_query.table {
            return;
        }
        let table = select_query.table.clone();
        let before = existing.clone();
        *existing = select_query.clone();
        self.move_query_key(sub, &before, select_query.clone());
        if let Some(table_index) = self.tables.get_mut(&table) {
            table_index.unregister(sub);
        }
        let dnf = select_query.filter.to_dnf();
        if !dnf.is_empty() {
            self.tables
                .entry(table.clone())
                .or_default()
                .register(sub, dnf, &mut self.stats);
        }
        if self.tables.get(&table).is_some_and(TableIndex::is_empty) {
            self.tables.remove(&table);
        }
        self.rebuild_window(sub);
        self.sync_boundary(sub);
    }

    /// Make `sub` a reader of every read `twin` is waiting on: the rows
    /// they bring are the rows `sub` lacks too.
    fn join_reads(&mut self, sub: SubId, twin: SubId) {
        let mut joined = 0u32;
        for readers in self.readers.values_mut() {
            if readers.contains(&twin) && !readers.contains(&sub) {
                readers.push(sub);
                joined += 1;
            }
        }
        if joined > 0 {
            *self.pending.entry(sub).or_default() += joined;
        }
    }

    /// Re-key `sub` in the query-keyed index after its stored query
    /// changed shape (a swap or a literal in-place edit).
    fn move_query_key(
        &mut self,
        sub: SubId,
        before: &SingleTableReadQuery,
        after: SingleTableReadQuery,
    ) {
        if let Some(twins) = self.by_query.get_mut(before) {
            twins.remove(&sub);
            if twins.is_empty() {
                self.by_query.remove(before);
            }
        }
        self.by_query.entry(after).or_default().insert(sub);
    }

    /// Another registered subscription with a structurally identical
    /// query, if any — the sharing seam of registration, one lookup in the
    /// query-keyed index. A twin with a read still out qualifies: the read
    /// serves the new subscription too.
    fn identical_subscription(
        &self,
        select_query: &SingleTableReadQuery,
        exclude: SubId,
    ) -> Option<SubId> {
        self.by_query
            .get(select_query)?
            .iter()
            .find(|twin| **twin != exclude)
            .copied()
    }

    /// Tag `sub` onto every row `from` holds, in one walk of `from`'s held
    /// index, and return the `Add`s with the frame's images: what a twin
    /// registration is served instead of a storage result.
    fn share_rows(&mut self, sub: SubId, from: SubId, table: &TableName) -> Vec<SingleTableUpdate> {
        let ids: Vec<RowId> = self
            .held
            .get(&from)
            .map(|ids| ids.iter().copied().collect())
            .unwrap_or_default();
        let Some(frame) = self.frames.get_mut(table) else {
            return Vec::new();
        };
        let held = self.held.entry(sub).or_default();
        let mut updates = Vec::with_capacity(ids.len());
        for id in ids {
            let Some(row) = frame.row_mut(id) else {
                continue;
            };
            if !row.subscribers.insert(sub) {
                continue;
            }
            held.insert(id);
            self.stats.ops_add += 1;
            updates.push(SingleTableUpdate {
                query: sub,
                table: table.clone(),
                op: DataFrameOperation::Add(row.key.clone(), row.data.clone()),
            });
        }
        updates
    }
}
