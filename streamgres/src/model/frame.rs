//! Row identities, row images, the delta operations shipped to clients,
//! and the shared frame those deltas are computed against.
//!
//! Two layers live here. The **wire vocabulary** — [`DataFrameKey`] (which
//! row), [`DataFrameRow`] (its image), [`DataFrameOperation`] (what
//! happened to it) — is what crosses the boundary: clients only ever
//! receive operations, never a frame. The **shared frame** —
//! [`TableFrame`] of [`SharedRow`]s — is the engine's materialization: one
//! frame per table, each row stored once and tagged with every
//! subscription holding it; it never crosses the boundary.
//!
//! Inside the engine the operation stream's ordering contract is per key:
//! operations on the same key are applied in stream order — a row changing
//! in place is `Delete(old)` immediately followed by `Add(new)`, and a row
//! admitted and then evicted within one step ships its `Add` before its
//! `Delete`. Operations on different rows commute. What leaves the engine
//! is the per-row fold of that stream (see `ivm::Delta`), where an
//! in-place change has collapsed to the one `Add` a receiver applies as
//! insert-or-replace.

use std::collections::HashMap;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use super::ids::{IdMap, IdSet};
use super::query::SubId;
use super::row::RowData;
use super::row::RowSchema;
use super::schema::ColumnName;
use super::value::{Value, unordered_pairs_hash};

/// The identity of a row: its primary-key values — deliberately nothing
/// else.
///
/// The table is encoded by location (the engine keys its shared frames by
/// table name), which queries hold the row is fan-out metadata kept beside
/// the row (the engine's per-row subscriber tags), and which subscription
/// an operation addresses rides in the envelope around the operation.
/// Putting any of those into the key would either repeat them per row and
/// per wire operation, or — for a query id — split one shared row into
/// many identities and undo the sharing.
///
/// The values are immutable once built and shared: a clone is a reference
/// count, so a key travels to every subscription and client of a row
/// without being copied. The order-independent hash of the map (a
/// `HashMap` field has order-independent equality, so the hash must be
/// too — see `unordered_map_hash` in `model::value`) is computed once at
/// construction and carried, so hashing a key is hashing one integer.
#[derive(Clone)]
pub struct DataFrameKey {
    pub pkey_value: Arc<RowData>,
    hash: u64,
}

impl DataFrameKey {
    /// A key laid out on `schema` (a table's key columns, shared by every
    /// row decoded from it) with `values` in that order.
    pub fn with_schema(schema: Arc<RowSchema>, values: Vec<Value>) -> Self {
        let pkey_value = RowData::with_schema(schema, values);
        DataFrameKey {
            hash: unordered_pairs_hash(pkey_value.iter()),
            pkey_value: Arc::new(pkey_value),
        }
    }
}

impl PartialEq for DataFrameKey {
    /// Equal primary-key maps; the carried hash rejects most unequal
    /// pairs without touching the maps.
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.pkey_value, &other.pkey_value)
            || (self.hash == other.hash && self.pkey_value == other.pkey_value)
    }
}

impl Eq for DataFrameKey {}

impl Hash for DataFrameKey {
    /// The hash computed at construction.
    fn hash<H: Hasher>(&self, state: &mut H) {
        state.write_u64(self.hash);
    }
}

impl fmt::Debug for DataFrameKey {
    /// The primary-key map alone.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DataFrameKey")
            .field("pkey_value", &*self.pkey_value)
            .finish()
    }
}

impl From<HashMap<ColumnName, Value>> for DataFrameKey {
    /// A key over a finished primary-key map (a layout of its own).
    fn from(pkey_value: HashMap<ColumnName, Value>) -> Self {
        let pkey_value = RowData::from(pkey_value);
        DataFrameKey {
            hash: unordered_pairs_hash(pkey_value.iter()),
            pkey_value: Arc::new(pkey_value),
        }
    }
}

/// One full row image. v1 has no column projection
/// (`SingleTableReadQuery` selects whole rows), so this is the whole row.
///
/// The image is immutable once built and shared: a clone is a reference
/// count. A row decoded from the feed or from storage is allocated once
/// and that one allocation is what the frame holds and what every
/// subscription, client and poke of the row refers to.
#[derive(Clone, PartialEq)]
pub struct DataFrameRow {
    pub data: Arc<RowData>,
}

impl DataFrameRow {
    /// Builds a row image from `(column, value)` pairs.
    pub fn new(pairs: impl IntoIterator<Item = (impl Into<ColumnName>, Value)>) -> Self {
        DataFrameRow::from(
            pairs
                .into_iter()
                .map(|(column, value)| (column.into(), value))
                .collect::<HashMap<_, _>>(),
        )
    }

    /// An image the change feed left the other columns out of
    /// ([`RowData::partial`]), from the `(column, value)` pairs it did
    /// carry.
    pub fn partial(pairs: impl IntoIterator<Item = (impl Into<ColumnName>, Value)>) -> Self {
        DataFrameRow::from(RowData::partial(
            pairs
                .into_iter()
                .map(|(column, value)| (column.into(), value))
                .collect(),
        ))
    }
}

impl From<HashMap<ColumnName, Value>> for DataFrameRow {
    /// An image over a finished column map (a schema of its own).
    fn from(data: HashMap<ColumnName, Value>) -> Self {
        DataFrameRow {
            data: Arc::new(RowData::from(data)),
        }
    }
}

impl From<RowData> for DataFrameRow {
    /// An image over a row already laid out (a decoder's, on the table's
    /// shared schema).
    fn from(data: RowData) -> Self {
        DataFrameRow {
            data: Arc::new(data),
        }
    }
}

impl fmt::Debug for DataFrameRow {
    /// The column map alone.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DataFrameRow")
            .field("data", &*self.data)
            .finish()
    }
}

/// The unit of an incremental update — self-contained, with no pre-image
/// side channel:
///
/// - `Add(key, row)`: the row enters the result set with this image; a
///   receiver applies it as insert-or-replace.
/// - `Delete(key, row)`: the row leaves, and it carries the removed image —
///   a bare key would say nothing about the values that just vanished,
///   which downstream consumers (join maintenance, clients) need.
#[derive(Debug, Clone, PartialEq)]
pub enum DataFrameOperation {
    Delete(DataFrameKey, DataFrameRow),
    Add(DataFrameKey, DataFrameRow),
}

/// The engine's compact id for one row of one table's frame: handed out
/// once when the row first enters the frame and retired, never reused,
/// when its last holder leaves. Per table, so never globally unique.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RowId(pub u64);

/// One row of a shared frame: its identity, its current image, and the
/// subscriptions holding it — the "which query sets is this row subscribed
/// to" index that membership routing reads. The image is the current one
/// for every holder: the runtime brings every read up to the engine's
/// position before landing it, so no holder ever sees a different image.
pub struct SharedRow {
    pub key: DataFrameKey,
    pub data: DataFrameRow,
    pub subscribers: Holders,
}

/// The subscriptions holding one row, as a sorted vector: most rows have
/// one to a few holders, and a set's node per row cost more than the
/// row's own key.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Holders(Vec<SubId>);

impl Holders {
    /// No holders.
    pub fn new() -> Self {
        Holders(Vec::new())
    }

    /// Add `sub`; whether it was new.
    pub fn insert(&mut self, sub: SubId) -> bool {
        match self.0.binary_search(&sub) {
            Ok(_) => false,
            Err(at) => {
                self.0.insert(at, sub);
                true
            }
        }
    }

    /// Remove `sub`; whether it was there.
    pub fn remove(&mut self, sub: &SubId) -> bool {
        match self.0.binary_search(sub) {
            Ok(at) => {
                self.0.remove(at);
                true
            }
            Err(_) => false,
        }
    }

    /// Whether `sub` holds the row.
    pub fn contains(&self, sub: &SubId) -> bool {
        self.0.binary_search(sub).is_ok()
    }

    /// Whether nobody holds the row.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// How many hold the row.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// The holders, ascending.
    pub fn iter(&self) -> std::slice::Iter<'_, SubId> {
        self.0.iter()
    }
}

impl SharedRow {
    /// Whether `sub` holds this row.
    pub fn held_by(&self, sub: SubId) -> bool {
        self.subscribers.contains(&sub)
    }
}

/// The one shared frame of a table: row identity → row id → shared row.
///
/// Engine state, not wire vocabulary — a subscription's view of it is the
/// rows tagged with its id, and reaches the client only as operations.
/// Every (subscription, row) pair is stored as two small integers (a tag
/// on the row, an entry in the subscription's held index), never as a
/// copy of the key or the subscription's name. Columns the engine asks
/// for ([`TableFrame::index_column`], the join columns) are indexed by
/// value, so the rows carrying one join value are found without a scan;
/// the indexes follow every row in, every image change and every row out.
#[derive(Default)]
pub struct TableFrame {
    ids: IdMap<DataFrameKey, RowId>,
    rows: IdMap<RowId, SharedRow>,
    indexes: HashMap<ColumnName, HashMap<Value, IdSet<RowId>>>,
    next_id: u64,
}

impl TableFrame {
    /// The row id of `key`, if the frame holds the row.
    pub fn id_of(&self, key: &DataFrameKey) -> Option<RowId> {
        self.ids.get(key).copied()
    }

    /// The shared row of `key`.
    pub fn get(&self, key: &DataFrameKey) -> Option<&SharedRow> {
        self.rows.get(self.ids.get(key)?)
    }

    /// The shared row under `id`.
    pub fn row(&self, id: RowId) -> Option<&SharedRow> {
        self.rows.get(&id)
    }

    /// Every row the frame holds, with its id, in no particular order.
    pub fn rows(&self) -> impl Iterator<Item = (RowId, &SharedRow)> {
        self.rows.iter().map(|(id, row)| (*id, row))
    }

    /// The shared row under `id`, mutably, for its subscriber tags; an
    /// image changes through [`TableFrame::replace_image`], which keeps
    /// the value indexes in step.
    pub fn row_mut(&mut self, id: RowId) -> Option<&mut SharedRow> {
        self.rows.get_mut(&id)
    }

    /// The row for `key`, materialized with `data` and no holders if the
    /// frame did not hold it yet; returns its id and the row.
    pub fn entry(
        &mut self,
        key: &DataFrameKey,
        data: impl FnOnce() -> DataFrameRow,
    ) -> (RowId, &mut SharedRow) {
        let id = match self.ids.get(key) {
            Some(id) => *id,
            None => {
                let id = RowId(self.next_id);
                self.next_id += 1;
                let data = data();
                self.ids.insert(key.clone(), id);
                self.index_row(id, &data);
                self.rows.insert(
                    id,
                    SharedRow {
                        key: key.clone(),
                        data,
                        subscribers: Holders::new(),
                    },
                );
                id
            }
        };
        (id, self.rows.get_mut(&id).expect("inserted or found above"))
    }

    /// Give the row under `id` the image `data`, moving it between value
    /// buckets where an indexed column changed; the same image (the same
    /// allocation) changes nothing. Reports whether the row exists.
    pub fn replace_image(&mut self, id: RowId, data: DataFrameRow) -> bool {
        let Some(row) = self.rows.get(&id) else {
            return false;
        };
        if Arc::ptr_eq(&row.data.data, &data.data) {
            return true;
        }
        let old = row.data.clone();
        self.unindex_row(id, &old);
        self.index_row(id, &data);
        if let Some(row) = self.rows.get_mut(&id) {
            row.data = data;
        }
        true
    }

    /// Drop the row under `id` if no subscription holds it; reports
    /// whether it was dropped. The id is retired.
    pub fn drop_if_unheld(&mut self, id: RowId) -> bool {
        self.take_if_unheld(id).is_some()
    }

    /// `sub` lets go of the row under `id`: untag it, and if no
    /// subscription holds it any more take it out (the id retired) and
    /// hand it back, so a caller releasing many rows can free them off
    /// the engine's thread. One lookup per row.
    pub fn release(&mut self, id: RowId, sub: SubId) -> Option<SharedRow> {
        let row = self.rows.get_mut(&id)?;
        row.subscribers.remove(&sub);
        if !row.subscribers.is_empty() {
            return None;
        }
        let row = self.rows.remove(&id)?;
        self.ids.remove(&row.key);
        self.unindex_row(id, &row.data);
        Some(row)
    }

    /// [`TableFrame::drop_if_unheld`], handing the row out instead of
    /// freeing it, so a caller releasing many rows can free them off the
    /// engine's thread. The id is retired either way.
    pub fn take_if_unheld(&mut self, id: RowId) -> Option<SharedRow> {
        let unheld = self
            .rows
            .get(&id)
            .is_some_and(|row| row.subscribers.is_empty());
        if !unheld {
            return None;
        }
        let row = self.rows.remove(&id)?;
        self.ids.remove(&row.key);
        self.unindex_row(id, &row.data);
        Some(row)
    }

    /// Index `column` by value from now on (and over the rows already
    /// held); asking again for an indexed column changes nothing.
    pub fn index_column(&mut self, column: &ColumnName) {
        if self.indexes.contains_key(column) {
            return;
        }
        let mut by_value: HashMap<Value, IdSet<RowId>> = HashMap::new();
        for (id, row) in &self.rows {
            if let Some(value) = row.data.data.get(column) {
                by_value.entry(value.clone()).or_default().insert(*id);
            }
        }
        self.indexes.insert(column.clone(), by_value);
    }

    /// The ids of the rows whose `column` is `value`, from the column's
    /// index; `None` when the column is not indexed (the caller scans).
    pub fn rows_with(&self, column: &str, value: &Value) -> Option<Vec<RowId>> {
        let by_value = self.indexes.get(column)?;
        Some(
            by_value
                .get(value)
                .map(|ids| ids.iter().copied().collect())
                .unwrap_or_default(),
        )
    }

    /// File `id` under `data`'s value in every indexed column.
    fn index_row(&mut self, id: RowId, data: &DataFrameRow) {
        for (column, by_value) in self.indexes.iter_mut() {
            if let Some(value) = data.data.get(column) {
                by_value.entry(value.clone()).or_default().insert(id);
            }
        }
    }

    /// Unfile `id` from `data`'s value in every indexed column.
    fn unindex_row(&mut self, id: RowId, data: &DataFrameRow) {
        for (column, by_value) in self.indexes.iter_mut() {
            let Some(value) = data.data.get(column) else {
                continue;
            };
            if let Some(ids) = by_value.get_mut(value) {
                ids.remove(&id);
                if ids.is_empty() {
                    by_value.remove(value);
                }
            }
        }
    }

    /// Whether the frame holds no rows.
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// How many rows the frame holds.
    pub fn len(&self) -> usize {
        self.rows.len()
    }
}

impl DataFrameKey {
    /// Builds a row identity from `(primary-key column, value)` pairs.
    pub fn new(pkey_value: impl IntoIterator<Item = (impl Into<ColumnName>, Value)>) -> Self {
        DataFrameKey::from(
            pkey_value
                .into_iter()
                .map(|(column, value)| (column.into(), value))
                .collect::<HashMap<_, _>>(),
        )
    }
}

impl DataFrameOperation {
    /// The identity of the row this operation touches.
    pub fn key(&self) -> &DataFrameKey {
        match self {
            DataFrameOperation::Add(key, _) => key,
            DataFrameOperation::Delete(key, _) => key,
        }
    }

    /// The row image this operation carries — the new image for an `Add`,
    /// the removed image for a `Delete`.
    pub fn row(&self) -> &DataFrameRow {
        match self {
            DataFrameOperation::Add(_, row) => row,
            DataFrameOperation::Delete(_, row) => row,
        }
    }
}
