//! Frame surgery and inspection: tagging rows into and out of the shared
//! per-table frames ([`crate::model::frame::TableFrame`]) for one
//! subscription at a time — the row-level seams the join layer maintains
//! its driven parts with — plus the storage-read seam (asking for rows,
//! landing them) and the read-only views tests and callers inspect. Tags
//! and the held index store compact ids ([`crate::model::SubId`],
//! [`crate::model::frame::RowId`]) and are always changed together.

use std::collections::HashMap;
use std::sync::Arc;

use super::predicate::evaluate;
use super::window::Window;
use super::{Fetch, FetchId, FetchKind, SingleTableIVM, SingleTableUpdate, window};
use crate::model::{
    ColumnName, ComparisonOperator, Condition, DataFrameKey, DataFrameOperation, DataFrameRow,
    SingleTableReadQuery, SubId, TableName, Value, Where,
};

impl SingleTableIVM {
    /// Ask for the rows of subscription `sub` matching its own filter
    /// narrowed to `column IN values`: one recorded storage read, landed
    /// later through [`SingleTableIVM::land_fetch`]. Until it lands the
    /// subscription publishes no admission boundary; the read serves every
    /// subscription of its query, twins registered meanwhile included. A
    /// set-valued `IN` leaf of the filter on the same column is replaced
    /// by the narrowed values in the read's filter: the values are members
    /// of that set (the caller inserted them just before), so the rows are
    /// the same, and the read renders a handful of literals instead of the
    /// whole set. Unknown subscriptions are a no-op.
    pub fn fetch(&mut self, sub: SubId, column: &str, values: &[Value]) -> Option<FetchId> {
        self.read_narrowed(sub, column, values, FetchKind::Narrowed)
    }

    /// Ask a page for the rows of `values` on `column` it dropped earlier
    /// (a write on the driven side concerns them): the same narrowed read
    /// as [`SingleTableIVM::fetch`], landed as a [`FetchKind::Lookup`] —
    /// only the rows better than the frontier are held, as candidates,
    /// and the frontier stays where it is.
    pub fn lookup(&mut self, sub: SubId, column: &str, values: &[Value]) {
        self.stats.page_lookups += 1;
        self.read_narrowed(sub, column, values, FetchKind::Lookup);
    }

    /// Ask for `query` as a [`FetchKind::Lookup`] on behalf of `sub`: the
    /// join layer's read across the windows of a node with one per parent
    /// row, whose rows it sorts into the windows itself when they land
    /// ([`SingleTableIVM::land_lookup`]).
    pub fn lookup_query(&mut self, sub: SubId, query: SingleTableReadQuery) {
        if !self.select_queries.contains_key(&sub) {
            return;
        }
        self.stats.page_lookups += 1;
        self.issue(sub, query, FetchKind::Lookup);
        self.sync_boundary(sub);
    }

    /// Record the narrowed read of `sub` to `column IN values`, of `kind`;
    /// its id, when one was recorded.
    fn read_narrowed(
        &mut self,
        sub: SubId,
        column: &str,
        values: &[Value],
        kind: FetchKind,
    ) -> Option<FetchId> {
        let query = self.select_queries.get(&sub)?;
        let narrowed = Where::Condition(Condition::new(
            column,
            ComparisonOperator::IN,
            Value::List(values.to_vec()),
        ));
        let narrowed = SingleTableReadQuery {
            filter: Where::AND(vec![
                narrow_set_leaves(&query.filter, column, &narrowed),
                narrowed,
            ]),
            limit: window::storage_limit(query, self.windows.get(&sub)),
            ..query.clone()
        };
        let id = self.issue(sub, narrowed, kind);
        self.sync_boundary(sub);
        id
    }

    /// Read the row `key` of `table` again by primary key
    /// ([`FetchKind::Row`]) for `subs` and their twins, each of which
    /// waits on it as on a read of its own: the only image of the row at
    /// hand is partial and the frame holds no whole one. The read selects
    /// the key alone, with no filter or limit of a subscription's (a row a
    /// write just brought into a filter is not in it at an older
    /// snapshot), and lands into each subscription through its own filter
    /// and window. One read per row: a subscription that needs a row
    /// already being read joins that read. No subscriptions, no read.
    pub(super) fn read_row(&mut self, table: &TableName, key: &DataFrameKey, subs: &[SubId]) {
        let mut readers: Vec<SubId> = Vec::new();
        for sub in subs {
            for reader in self.query_group(*sub) {
                if !readers.contains(&reader) {
                    readers.push(reader);
                }
            }
        }
        let Some(&first) = readers.first() else {
            return;
        };
        match self.rows_out.get(&(table.clone(), key.clone())) {
            Some(&id) => {
                let waiting = self.readers.entry(id).or_default();
                readers.retain(|reader| !waiting.contains(reader));
                waiting.extend(readers.iter().copied());
            }
            None => {
                let id = FetchId(self.next_fetch);
                self.next_fetch += 1;
                self.stats.storage_reads += 1;
                self.stats.row_reads += 1;
                self.readers.insert(id, readers.clone());
                self.rows_out.insert((table.clone(), key.clone()), id);
                self.requests.push(Fetch {
                    id,
                    sub: first,
                    kind: FetchKind::Row,
                    query: Arc::new(SingleTableReadQuery {
                        table: table.clone(),
                        filter: key_filter(key),
                        order_by: Vec::new(),
                        limit: u32::MAX,
                    }),
                });
            }
        }
        for reader in readers {
            *self.pending.entry(reader).or_default() += 1;
            self.sync_boundary(reader);
        }
    }

    /// `fetch` is landing or will never land (refused): if it is a row
    /// read, it no longer stands for its row, and the next subscription
    /// that needs the row asks again.
    pub(super) fn forget_read(&mut self, fetch: &Fetch) {
        if fetch.kind == FetchKind::Row {
            self.rows_out.retain(|_, id| *id != fetch.id);
        }
    }

    /// Record one storage read for `sub`, counted as pending by `sub` and
    /// every subscription of its query, all of which it will land into,
    /// and return its id; a read for no rows at all (`LIMIT 0`) is not
    /// worth a round trip and is dropped.
    pub(super) fn issue(
        &mut self,
        sub: SubId,
        query: SingleTableReadQuery,
        kind: FetchKind,
    ) -> Option<FetchId> {
        if query.limit == 0 {
            return None;
        }
        let id = FetchId(self.next_fetch);
        self.next_fetch += 1;
        let readers = self.query_group(sub);
        for reader in &readers {
            *self.pending.entry(*reader).or_default() += 1;
        }
        self.readers.insert(id, readers);
        self.stats.storage_reads += 1;
        self.requests.push(Fetch {
            id,
            sub,
            kind,
            query: std::sync::Arc::new(query),
        });
        Some(id)
    }

    /// `sub` and every other subscription with its query, in id order;
    /// `sub` alone if it is not registered or shares with no one (a
    /// driven part reading nothing at registration is keyed with no
    /// twins, whatever its filter).
    fn query_group(&self, sub: SubId) -> Vec<SubId> {
        self.select_queries
            .get(&sub)
            .and_then(|query| self.by_query.get(query))
            .filter(|group| group.contains(&sub))
            .map(|group| group.iter().copied().collect())
            .unwrap_or_else(|| vec![sub])
    }

    /// Land the rows a recorded read returned, for every subscription the
    /// read serves ([`SingleTableIVM::readers_of`]: the one that asked and
    /// its twins). The runtime has brought the rows up to the engine's
    /// position, so each is current: a row the frame does not hold is
    /// adopted with the read's image, a row it holds keeps the frame's
    /// (equal) image, and each subscription is tagged onto it if it was
    /// not already (rows the stream routed to it while the read was out
    /// already are). Per subscription, the window's frontier is sized
    /// from the whole result, overflow is evicted, a refill is asked for
    /// if the window drained while the read was out, and the boundary is
    /// republished. Returns those subscriptions' `Add`s and evictions; no
    /// other is touched. A read whose subscriptions are all gone lands as
    /// nothing.
    pub fn land_fetch(
        &mut self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
    ) -> Vec<SingleTableUpdate> {
        let worst = worst_of_full(fetch, rows);
        self.land_read(fetch, rows, worst.as_ref())
    }

    /// [`SingleTableIVM::land_fetch`] with the read's own coverage:
    /// `worst_read` is the worst row a read that came back full returned,
    /// before the runtime brought the result up to date (`None` for a
    /// read that came back short). A window's frontier is set from it, so
    /// a full read some of whose rows a later write took out is not taken
    /// for storage running dry.
    pub fn land_read(
        &mut self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
        worst_read: Option<&DataFrameRow>,
    ) -> Vec<SingleTableUpdate> {
        self.forget_read(fetch);
        let readers = self
            .readers
            .remove(&fetch.id)
            .unwrap_or_else(|| vec![fetch.sub]);
        let mut updates = Vec::new();
        for sub in readers {
            updates.extend(self.land_for(sub, fetch, rows, worst_read));
        }
        updates
    }

    /// [`SingleTableIVM::land_fetch`] for one of the read's subscriptions.
    fn land_for(
        &mut self,
        sub: SubId,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
        worst_read: Option<&DataFrameRow>,
    ) -> Vec<SingleTableUpdate> {
        if !self.select_queries.contains_key(&sub) {
            return Vec::new();
        }
        let mut updates = self.land_rows(sub, fetch.kind, rows, worst_read);
        let outstanding = match self.pending.get_mut(&sub) {
            Some(count) => {
                *count = count.saturating_sub(1);
                *count
            }
            None => 0,
        };
        if outstanding == 0 {
            self.pending.remove(&sub);
        }
        let evictions = self.evict_overflow(sub);
        updates.extend(self.tagged(sub, evictions));
        if outstanding == 0
            && self
                .windows
                .get(&sub)
                .is_some_and(super::window::Window::needs_refill)
        {
            self.refill(sub);
        }
        self.sync_boundary(sub);
        self.gate_updates(&[sub], updates)
    }

    /// Land the rows of a read of `kind` into `sub`: each adopted and
    /// tagged ([`SingleTableIVM::land_row`]) — a lookup's or a row read's
    /// rows only when the window admits them — then tracked in the window,
    /// as candidates of a page unless a page read whole is taking its
    /// snapshot, and the window told what the read covered (a lookup or a
    /// row read covers nothing new). Returns the `Add`s.
    fn land_rows(
        &mut self,
        sub: SubId,
        kind: FetchKind,
        rows: &[(DataFrameKey, DataFrameRow)],
        worst_read: Option<&DataFrameRow>,
    ) -> Vec<SingleTableUpdate> {
        let Some(query) = self.select_queries.get(&sub).cloned() else {
            return Vec::new();
        };
        let table = query.table.clone();
        let lookup = matches!(kind, FetchKind::Lookup | FetchKind::Row);
        let mut updates = Vec::new();
        let mut landed: Vec<(Vec<Value>, DataFrameKey)> = Vec::new();
        for (key, row) in rows {
            let beyond = lookup
                && self
                    .windows
                    .get(&sub)
                    .is_some_and(|window| !window.admits(&window.order_value(row)));
            if beyond {
                continue;
            }
            let Some((update, image)) = self.land_row(sub, &table, &query.filter, key, row) else {
                continue;
            };
            if let Some(window) = self.windows.get(&sub) {
                landed.push((window.order_value(&image), key.clone()));
            }
            updates.push(update);
        }
        if let Some(window) = self.windows.get_mut(&sub) {
            let candidates = kind != FetchKind::Snapshot || !window.is_whole();
            let keys: Vec<DataFrameKey> = landed.iter().map(|(_, key)| key.clone()).collect();
            window.insert_many(landed);
            if candidates {
                for key in &keys {
                    window.enroll(key);
                }
            }
            if !lookup {
                window.note_fetch(worst_read);
            }
            if kind == FetchKind::Refill {
                window.note_refill(updates.len());
            }
        }
        updates
    }

    /// Land the rows a lookup returned for `sub`, a window of a node with
    /// one per parent row, which the join layer sorted out of the node's
    /// one read ([`SingleTableIVM::lookup_query`]): as a lookup's rows land
    /// ([`SingleTableIVM::land_rows`]), overflow evicted and the boundary
    /// republished; no read of `sub`'s own is accounted for. Returns the
    /// subscription's operations.
    pub fn land_lookup(
        &mut self,
        sub: SubId,
        rows: &[(DataFrameKey, DataFrameRow)],
    ) -> Vec<SingleTableUpdate> {
        if !self.select_queries.contains_key(&sub) {
            return Vec::new();
        }
        let mut updates = self.land_rows(sub, FetchKind::Lookup, rows, None);
        let evictions = self.evict_overflow(sub);
        updates.extend(self.tagged(sub, evictions));
        self.sync_boundary(sub);
        self.gate_updates(&[sub], updates)
    }

    /// Adopt one landed row for `sub`, whose filter is `filter`: the frame
    /// row is materialized with the read's image if absent (the frame's
    /// image is current, and so is the read's, so an existing row keeps
    /// what it has), and `sub` is tagged onto it and sent the `Add` unless
    /// it already held it or the image does not satisfy its filter.
    /// Returns the `Add` and the image tagged; the caller tracks it in the
    /// window.
    ///
    /// A partial row (a write since the read's snapshot brought it in
    /// with columns the feed left out) is never adopted: a held row is
    /// tagged with the frame's whole image, and one nobody holds that the
    /// filter admits is read again for `sub`
    /// ([`SingleTableIVM::read_row`]), which waits on it.
    fn land_row(
        &mut self,
        sub: SubId,
        table: &TableName,
        filter: &Where,
        key: &DataFrameKey,
        row: &DataFrameRow,
    ) -> Option<(SingleTableUpdate, DataFrameRow)> {
        let partial = row.data.is_partial();
        if partial
            && self
                .frames
                .get(table)
                .is_none_or(|frame| frame.get(key).is_none())
        {
            if evaluate(filter, &row.data, &mut 0) {
                self.read_row(table, key, &[sub]);
            }
            return None;
        }
        let conformed = if partial {
            None
        } else {
            self.conform(table, row)
        };
        let row = conformed.as_ref().unwrap_or(row);
        let frame = self.frames.entry(table.clone()).or_default();
        let (id, shared) = frame.entry(key, || row.clone());
        debug_assert!(
            partial || shared.data == *row,
            "a read brought up to the engine's position agrees with the frame"
        );
        if shared.held_by(sub) {
            return None;
        }
        let image = shared.data.clone();
        if !evaluate(filter, &image.data, &mut 0) {
            frame.drop_if_unheld(id);
            return None;
        }
        let update = self.tag_row(sub, table, key, &image)?;
        Some((update, image))
    }

    /// The image of a row `sub` holds, `None` when it does not hold it.
    pub(super) fn row_image(&self, sub: SubId, key: &DataFrameKey) -> Option<DataFrameRow> {
        let query = self.select_queries.get(&sub)?;
        let frame = self.frames.get(&query.table)?;
        let row = frame.get(key)?;
        row.held_by(sub).then(|| row.data.clone())
    }

    /// Untag one row from `sub` (dropping it when nobody holds it) and
    /// take it out of the window. Returns the `Delete` — carrying the
    /// image `sub` held — to forward, or `None` if the subscription did
    /// not hold it.
    pub fn remove_row(&mut self, sub: SubId, key: &DataFrameKey) -> Option<DataFrameOperation> {
        let op = self.untag_row(sub, key)?;
        if let Some(window) = self.windows.get_mut(&sub) {
            window.remove(key);
        }
        Some(op)
    }

    /// Untag one row from `sub` (dropping it when nobody holds it),
    /// leaving the window to the caller. Returns the `Delete` carrying the
    /// image `sub` held, or `None` if the subscription did not hold it.
    pub(super) fn untag_row(
        &mut self,
        sub: SubId,
        key: &DataFrameKey,
    ) -> Option<DataFrameOperation> {
        let table = self.select_queries.get(&sub)?.table.clone();
        let frame = self.frames.get_mut(&table)?;
        let id = frame.id_of(key)?;
        let row = frame.row_mut(id)?;
        if !row.subscribers.remove(&sub) {
            return None;
        }
        let removed = row.data.clone();
        if let Some(ids) = self.held.get_mut(&sub) {
            ids.remove(&id);
        }
        frame.drop_if_unheld(id);
        Some(DataFrameOperation::Delete(key.clone(), removed))
    }

    /// Untag every row `sub` holds whose `column` equals one of `values`.
    /// Returns the `Delete` operations.
    pub fn delete_rows(
        &mut self,
        sub: SubId,
        column: &str,
        values: &[Value],
    ) -> Vec<DataFrameOperation> {
        let ops = self.remove_rows_where(sub, column, values, |_| true);
        self.gate_window(sub, ops)
    }

    /// Untag every row `sub` holds whose `column` equals one of `values`
    /// and that its filter no longer matches: the prune after a set-valued
    /// leaf lost those values. A row another branch of the filter still
    /// admits stays. Returns the `Delete` operations and, for a windowed
    /// subscription, the `Add`s of the rows that move up into its page; a
    /// window drained to its limit asks for its refill.
    pub fn prune_rows(
        &mut self,
        sub: SubId,
        column: &str,
        values: &[Value],
    ) -> Vec<DataFrameOperation> {
        let Some(filter) = self
            .select_queries
            .get(&sub)
            .map(|query| query.filter.clone())
        else {
            return Vec::new();
        };
        self.prune_rows_unless(sub, column, values, &filter)
    }

    /// Untag every row `sub` holds whose `column` equals one of `values`
    /// and that `keeps` does not admit: the prune after a join edge lost
    /// those values when the restriction is not in the registered filter
    /// (`keeps` is then the part's own filter with the edge's leaf taken
    /// as false). Otherwise as [`SingleTableIVM::prune_rows`].
    pub fn prune_rows_unless(
        &mut self,
        sub: SubId,
        column: &str,
        values: &[Value],
        keeps: &Where,
    ) -> Vec<DataFrameOperation> {
        let ops = self.remove_rows_where(sub, column, values, |row| {
            !evaluate(keeps, &row.data, &mut 0)
        });
        if !ops.is_empty() {
            if self.windows.get(&sub).is_some_and(Window::needs_refill) {
                self.refill(sub);
            }
            self.sync_boundary(sub);
        }
        self.gate_window(sub, ops)
    }

    /// Untag the rows `sub` holds whose `column` equals one of `values`
    /// and that `doomed` selects; the `Delete` operations.
    fn remove_rows_where(
        &mut self,
        sub: SubId,
        column: &str,
        values: &[Value],
        doomed: impl Fn(&DataFrameRow) -> bool,
    ) -> Vec<DataFrameOperation> {
        let doomed: Vec<DataFrameKey> = self
            .rows_matching_any(sub, column, values)
            .into_iter()
            .filter(|(_, row)| doomed(row))
            .map(|(key, _)| key)
            .collect();
        let mut ops = Vec::new();
        for key in doomed {
            if let Some(op) = self.remove_row(sub, &key) {
                ops.push(op);
            }
        }
        ops
    }

    /// The rows `sub` holds whose `column` equals `value`, as the layer
    /// above sees the subscription: for a windowed one only the rows of
    /// its prefix, since the buffer below it was never shown to anyone.
    pub fn visible_rows_matching(
        &self,
        sub: SubId,
        column: &str,
        value: &Value,
    ) -> Vec<(DataFrameKey, DataFrameRow)> {
        let rows = self.rows_matching(sub, column, value);
        match self.windows.get(&sub) {
            Some(window) => rows
                .into_iter()
                .filter(|(key, _)| window.in_span(key))
                .collect(),
            None => rows,
        }
    }

    /// The rows `sub` holds whose `column` equals `value`.
    pub fn rows_matching(
        &self,
        sub: SubId,
        column: &str,
        value: &Value,
    ) -> Vec<(DataFrameKey, DataFrameRow)> {
        self.rows_matching_any(sub, column, std::slice::from_ref(value))
    }

    /// Index `column` of `table`'s frame by value from now on, so the rows
    /// of one join value are found without a scan; the join layer asks
    /// this for every column a part joins on.
    pub fn index_column(&mut self, table: &TableName, column: &ColumnName) {
        self.frames
            .entry(table.clone())
            .or_default()
            .index_column(column);
    }

    /// The rows `sub` holds whose `column` equals one of `values`: from
    /// the column's value index when the frame has one (the matches, not
    /// the view), otherwise walked off the subscription's held index, so
    /// the cost scales with its own view, never with the table.
    fn rows_matching_any(
        &self,
        sub: SubId,
        column: &str,
        values: &[Value],
    ) -> Vec<(DataFrameKey, DataFrameRow)> {
        let Some(query) = self.select_queries.get(&sub) else {
            return Vec::new();
        };
        let Some(frame) = self.frames.get(&query.table) else {
            return Vec::new();
        };
        let Some(ids) = self.held.get(&sub) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for value in values {
            let Some(with_value) = frame.rows_with(column, value) else {
                return ids
                    .iter()
                    .filter_map(|id| frame.row(*id))
                    .filter(|row| {
                        row.data
                            .data
                            .get(column)
                            .is_some_and(|v| values.contains(v))
                    })
                    .map(|row| (row.key.clone(), row.data.clone()))
                    .collect();
            };
            for id in with_value {
                if !ids.contains(&id) {
                    continue;
                }
                if let Some(row) = frame.row(id) {
                    out.push((row.key.clone(), row.data.clone()));
                }
            }
        }
        out
    }

    /// The subscription's current view — every shared row it holds, as
    /// key → image, enumerated from its held index. An inspection seam for
    /// tests and debugging, not a sync mechanism: clients build their
    /// frames from the operation stream. `None` for unknown subscriptions.
    pub fn rows_for(&self, sub: SubId) -> Option<HashMap<DataFrameKey, DataFrameRow>> {
        let query = self.select_queries.get(&sub)?;
        let frame = self.frames.get(&query.table);
        let window = self.windows.get(&sub);
        Some(
            self.held
                .get(&sub)
                .into_iter()
                .flatten()
                .filter_map(|id| frame.and_then(|frame| frame.row(*id)))
                .filter(|row| window.is_none_or(|window| window.in_span(&row.key)))
                .map(|row| (row.key.clone(), row.data.clone()))
                .collect(),
        )
    }

    /// The subscriptions currently holding one shared row — its subscriber
    /// tags, in sorted order; empty when the row is not materialized. The
    /// "which query sets is this row subscribed to" inspection view.
    pub fn holders_of(&self, table: &TableName, key: &DataFrameKey) -> Vec<SubId> {
        self.frames
            .get(table)
            .and_then(|frame| frame.get(key))
            .map(|row| row.subscribers.iter().copied().collect())
            .unwrap_or_default()
    }
}

/// The worst of `rows` under the read's order when the read came back
/// full (as many rows as it asked for): what a caller that lands a
/// result as storage returned it passes for the read's coverage.
pub(super) fn worst_of_full(
    fetch: &Fetch,
    rows: &[(DataFrameKey, DataFrameRow)],
) -> Option<DataFrameRow> {
    if fetch.query.limit == u32::MAX || rows.len() < fetch.query.limit as usize {
        return None;
    }
    rows.iter()
        .map(|(_, row)| row)
        .max_by(|a, b| window::order_rows(&fetch.query.order_by, a, b))
        .cloned()
}

/// The filter selecting the one row `key` names: its primary-key
/// columns, each equal to the key's value.
fn key_filter(key: &DataFrameKey) -> Where {
    let mut conditions: Vec<Where> = key
        .pkey_value
        .iter()
        .map(|(column, value)| {
            Where::Condition(Condition::new(
                column.clone(),
                ComparisonOperator::EQ,
                value.clone(),
            ))
        })
        .collect();
    if conditions.len() == 1 {
        return conditions.remove(0);
    }
    Where::AND(conditions)
}

/// `filter` with every set-valued `IN` leaf on `column` replaced by
/// `narrowed` (the `column IN values` a narrowed read restricts itself
/// to); every other leaf stands.
fn narrow_set_leaves(filter: &Where, column: &str, narrowed: &Where) -> Where {
    match filter {
        Where::Condition(condition)
            if condition.column == column
                && condition.comparison_operator == ComparisonOperator::IN
                && matches!(condition.value, Value::Set(_)) =>
        {
            narrowed.clone()
        }
        Where::Condition(condition) => Where::Condition(condition.clone()),
        Where::AND(children) => Where::AND(
            children
                .iter()
                .map(|child| narrow_set_leaves(child, column, narrowed))
                .collect(),
        ),
        Where::OR(children) => Where::OR(
            children
                .iter()
                .map(|child| narrow_set_leaves(child, column, narrowed))
                .collect(),
        ),
    }
}
