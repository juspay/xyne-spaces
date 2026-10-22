//! What an engine hands the transport: **deltas**, each one row operation
//! with everything it applies to. The engine knows subscriptions, never
//! clients: which client or socket a subscription belongs to, what that
//! client already holds and what it should therefore be sent are the
//! transport's business ([`crate::client`]'s row ledger).
//!
//! Inside the engine every operation is produced per *audience*: one
//! single-table subscription, or, in the join layer, one part of a tree
//! with **every subscriber of that tree at once** ([`Subs::Many`], the
//! tree's own list behind an `Arc`, shared by every operation of the tree
//! and never copied per subscriber). The fold here groups one step's
//! operations per row: each row image leaves the engine once, tagged with
//! every audience it applies to, and an audience that lost and regained
//! the row within the step (an in-place change) appears only on the
//! `Add`, which a receiver applies as insert-or-replace. A step's cost in
//! the engine therefore grows with the rows and the trees it touches, not
//! with the number of subscribers behind them; the per-subscriber work is
//! the transport's, on its own threads.

use std::collections::HashMap;
use std::sync::Arc;

use crate::model::{DataFrameKey, DataFrameOperation, DataFrameRow, SubId, TableName};

/// Which node of a subscription's join tree a part is: the path of join
/// positions from the root. The root is the empty path; a single-table
/// subscription has only the root.
///
/// The path is kept inline, at most [`QueryPart::MAX_DEPTH`] steps of at
/// most 255 each, so a part is eight bytes, `Copy`, and hashed as one
/// integer: every delta names its part without an allocation.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct QueryPart {
    len: u8,
    path: [u8; QueryPart::MAX_DEPTH],
}

impl QueryPart {
    /// The deepest a tree may nest.
    pub const MAX_DEPTH: usize = 7;

    /// The root part.
    pub fn main() -> Self {
        QueryPart::default()
    }

    /// The root's `index`-th join.
    pub fn join(index: usize) -> Self {
        QueryPart::main().child(index)
    }

    /// The part at `path`; `None` when it nests deeper than
    /// [`QueryPart::MAX_DEPTH`] or a step is past 255.
    pub fn try_new(path: &[usize]) -> Option<Self> {
        if path.len() > Self::MAX_DEPTH {
            return None;
        }
        let mut part = QueryPart::default();
        for (slot, &step) in part.path.iter_mut().zip(path) {
            *slot = u8::try_from(step).ok()?;
        }
        part.len = path.len() as u8;
        Some(part)
    }

    /// The part at `path`.
    ///
    /// # Panics
    ///
    /// When the path nests deeper than [`QueryPart::MAX_DEPTH`] or a step
    /// is past 255 (a tree the translation would have refused).
    pub fn new(path: &[usize]) -> Self {
        Self::try_new(path).expect("a query part within the engine's depth and width")
    }

    /// The join positions from the root.
    pub fn path(&self) -> &[u8] {
        &self.path[..self.len as usize]
    }

    /// Whether this is the root.
    pub fn is_main(&self) -> bool {
        self.len == 0
    }

    /// The join index of a first-level part; `None` for the root and for
    /// nested parts.
    pub fn join_index(&self) -> Option<usize> {
        (self.len == 1).then_some(self.path[0] as usize)
    }

    /// The `index`-th child of this part.
    pub(crate) fn child(&self, index: usize) -> Self {
        let mut child = *self;
        assert!(
            (child.len as usize) < Self::MAX_DEPTH,
            "a query tree nests deeper than {} joins",
            Self::MAX_DEPTH
        );
        child.path[child.len as usize] = u8::try_from(index).expect("a node has at most 256 joins");
        child.len += 1;
        child
    }
}

impl std::hash::Hash for QueryPart {
    /// The whole path as one integer.
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let mut bytes = [0u8; 8];
        bytes[0] = self.len;
        bytes[1..].copy_from_slice(&self.path);
        state.write_u64(u64::from_le_bytes(bytes));
    }
}

impl std::fmt::Debug for QueryPart {
    /// `QueryPart([1, 0])`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "QueryPart({:?})", self.path())
    }
}

/// One subscription's part an operation applies to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Target {
    pub sub: SubId,
    pub part: QueryPart,
}

/// The subscriptions one operation applies to: a single one, or every
/// subscriber of a shared tree, as the tree's own list (shared, so an
/// operation for ten thousand subscribers costs the engine one pointer).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Subs {
    One(SubId),
    Many(Arc<[SubId]>),
}

impl Subs {
    /// The subscriptions of `list`: the one, or the shared list.
    pub fn of(list: &[SubId]) -> Self {
        match list {
            [only] => Subs::One(*only),
            _ => Subs::Many(Arc::from(list)),
        }
    }

    /// Every subscription, in the list's order.
    pub fn iter(&self) -> impl Iterator<Item = SubId> + '_ {
        let (one, many): (Option<SubId>, &[SubId]) = match self {
            Subs::One(sub) => (Some(*sub), &[]),
            Subs::Many(list) => (None, list),
        };
        one.into_iter().chain(many.iter().copied())
    }

    /// How many subscriptions.
    pub fn len(&self) -> usize {
        match self {
            Subs::One(_) => 1,
            Subs::Many(list) => list.len(),
        }
    }

    /// Whether there is none.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// What tells two audiences of one step apart: the subscription, or
    /// the shared list's address.
    fn identity(&self) -> (u8, u64) {
        match self {
            Subs::One(sub) => (0, sub.0),
            Subs::Many(list) => (1, list.as_ptr() as usize as u64),
        }
    }
}

/// The subscriptions an operation applies to under one part of their
/// query: one part of one tree with all its subscribers, or a
/// single-table subscription (the root part).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Audience {
    pub part: QueryPart,
    pub subs: Subs,
}

/// One delta: the operation, the table it lands on, and every audience it
/// applies to. The transport resolves the audiences to its clients,
/// applies the operation to each client's row ledger once and to each
/// target's membership.
#[derive(Debug, Clone, PartialEq)]
pub struct Delta {
    pub table: TableName,
    pub op: DataFrameOperation,
    pub audiences: Vec<Audience>,
}

impl Delta {
    /// Every (subscription, part) the delta applies to, audience by
    /// audience: the expanded form, for a consumer that wants it flat.
    pub fn targets(&self) -> impl Iterator<Item = Target> + '_ {
        self.audiences.iter().flat_map(|audience| {
            audience.subs.iter().map(move |sub| Target {
                sub,
                part: audience.part,
            })
        })
    }

    /// How many (subscription, part) pairs the delta applies to.
    pub fn target_count(&self) -> usize {
        self.audiences
            .iter()
            .map(|audience| audience.subs.len())
            .sum()
    }
}

/// One per-audience operation before folding.
pub(crate) struct Raw {
    pub table: TableName,
    pub audience: Audience,
    pub op: DataFrameOperation,
}

/// Where one audience stands on one row within a step: the three slots
/// the per-key ordering contract allows. `leaving`: a `Delete` before any
/// `Add` (the row leaving). `entering`: the `Add` (the row entering, or
/// its new image when it was held: the old half of an in-place change is
/// dropped). `evicted`: a `Delete` after an `Add` (admitted and evicted
/// within the step).
#[derive(Default, Clone, Copy)]
struct Standing {
    leaving: bool,
    entering: bool,
    evicted: bool,
}

/// How many audiences a row is searched through one by one before they
/// are indexed.
const SCAN: usize = 16;

/// One row's operations within a step: the image of each slot (every
/// audience of a slot sees the same one) and where each audience stands,
/// in first-appearance order.
struct Folded {
    table: TableName,
    key: DataFrameKey,
    leaving: Option<DataFrameRow>,
    entering: Option<DataFrameRow>,
    evicted: Option<DataFrameRow>,
    audiences: Vec<(Audience, Standing)>,
    index: HashMap<(QueryPart, (u8, u64)), usize>,
}

impl Folded {
    /// The position of `audience` among the row's, added when new; found
    /// by scanning while they are few, through an index past [`SCAN`].
    fn position(&mut self, audience: Audience) -> usize {
        let identity = (audience.part, audience.subs.identity());
        if self.audiences.len() < SCAN {
            if let Some(found) = self
                .audiences
                .iter()
                .position(|(known, _)| (known.part, known.subs.identity()) == identity)
            {
                return found;
            }
        } else {
            if self.index.is_empty() {
                self.index = self
                    .audiences
                    .iter()
                    .enumerate()
                    .map(|(at, (known, _))| ((known.part, known.subs.identity()), at))
                    .collect();
            }
            if let Some(&found) = self.index.get(&identity) {
                return found;
            }
            self.index.insert(identity, self.audiences.len());
        }
        self.audiences.push((audience, Standing::default()));
        self.audiences.len() - 1
    }

    /// Sort one operation of `audience` into its slot.
    fn fold(&mut self, audience: Audience, op: DataFrameOperation) {
        let at = self.position(audience);
        let standing = &mut self.audiences[at].1;
        match op {
            DataFrameOperation::Delete(_, image) if standing.entering => {
                standing.evicted = true;
                debug_assert!(
                    self.evicted.as_ref().is_none_or(|held| *held == image),
                    "one step gives every holder of a row the same image"
                );
                self.evicted.get_or_insert(image);
            }
            DataFrameOperation::Delete(_, image) => {
                standing.leaving = true;
                debug_assert!(
                    self.leaving.as_ref().is_none_or(|held| *held == image),
                    "one step gives every holder of a row the same image"
                );
                self.leaving.get_or_insert(image);
            }
            DataFrameOperation::Add(_, image) => {
                standing.leaving = false;
                standing.evicted = false;
                standing.entering = true;
                self.entering = Some(image);
            }
        }
    }

    /// The row's deltas, in the order they apply.
    fn into_deltas(self, out: &mut Vec<Delta>) {
        let Folded {
            table,
            key,
            leaving,
            entering,
            evicted,
            audiences,
            ..
        } = self;
        let mut left = Vec::new();
        let mut entered = Vec::new();
        let mut gone = Vec::new();
        for (audience, standing) in audiences {
            if standing.leaving {
                left.push(audience.clone());
            }
            if standing.evicted {
                gone.push(audience.clone());
            }
            if standing.entering {
                entered.push(audience);
            }
        }
        if let Some(image) = leaving.filter(|_| !left.is_empty()) {
            out.push(Delta {
                table: table.clone(),
                op: DataFrameOperation::Delete(key.clone(), image),
                audiences: left,
            });
        }
        if let Some(image) = entering.filter(|_| !entered.is_empty()) {
            out.push(Delta {
                table: table.clone(),
                op: DataFrameOperation::Add(key.clone(), image),
                audiences: entered,
            });
        }
        if let Some(image) = evicted.filter(|_| !gone.is_empty()) {
            out.push(Delta {
                table,
                op: DataFrameOperation::Delete(key, image),
                audiences: gone,
            });
        }
    }
}

/// How many rows a step is searched through one by one before they are
/// indexed: most steps touch one row or a handful.
const SCAN_ROWS: usize = 8;

/// Fold one step's per-audience operations per row, keeping rows in the
/// order they first appear.
pub(crate) fn fold(raw: Vec<Raw>) -> Vec<Delta> {
    let mut folded: Vec<Folded> = Vec::new();
    let mut index: HashMap<(TableName, DataFrameKey), usize> = HashMap::new();
    for Raw {
        table,
        audience,
        op,
    } in raw
    {
        let known = if folded.len() < SCAN_ROWS {
            folded
                .iter()
                .position(|row| row.key == *op.key() && row.table == table)
        } else {
            if index.is_empty() {
                index = folded
                    .iter()
                    .enumerate()
                    .map(|(at, row)| ((row.table.clone(), row.key.clone()), at))
                    .collect();
            }
            index.get(&(table.clone(), op.key().clone())).copied()
        };
        let slot = match known {
            Some(slot) => slot,
            None => {
                if folded.len() >= SCAN_ROWS {
                    index.insert((table.clone(), op.key().clone()), folded.len());
                }
                folded.push(Folded {
                    table,
                    key: op.key().clone(),
                    leaving: None,
                    entering: None,
                    evicted: None,
                    audiences: Vec::new(),
                    index: HashMap::new(),
                });
                folded.len() - 1
            }
        };
        folded[slot].fold(audience, op);
    }
    let mut out = Vec::with_capacity(folded.len());
    for row in folded {
        row.into_deltas(&mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Value;

    /// A row image with one `v` column.
    fn image(v: i64) -> DataFrameRow {
        DataFrameRow::new([("v", Value::Int(v))])
    }

    /// The key of row `id`.
    fn key(id: i64) -> DataFrameKey {
        DataFrameKey::new([("id", Value::Int(id))])
    }

    /// A raw operation of subscription `sub` (root part).
    fn raw(sub: u64, op: DataFrameOperation) -> Raw {
        Raw {
            table: TableName::from("t"),
            audience: Audience {
                part: QueryPart::main(),
                subs: Subs::One(SubId(sub)),
            },
            op,
        }
    }

    /// The subscriptions a delta applies to.
    fn subs_of(delta: &Delta) -> Vec<u64> {
        delta.targets().map(|target| target.sub.0).collect()
    }

    /// Two subscriptions holding one row: an in-place change (the pair
    /// for each) becomes one `Add` naming both; a third subscription that
    /// lost the row is one `Delete`, first.
    #[test]
    fn folds_per_row() {
        let out = fold(vec![
            raw(10, DataFrameOperation::Delete(key(1), image(1))),
            raw(10, DataFrameOperation::Add(key(1), image(2))),
            raw(11, DataFrameOperation::Delete(key(1), image(1))),
            raw(11, DataFrameOperation::Add(key(1), image(2))),
            raw(12, DataFrameOperation::Delete(key(1), image(1))),
        ]);
        assert_eq!(out.len(), 2, "{out:?}");
        assert!(matches!(&out[0].op, DataFrameOperation::Delete(_, img) if *img == image(1)));
        assert_eq!(subs_of(&out[0]), vec![12]);
        assert!(matches!(&out[1].op, DataFrameOperation::Add(_, img) if *img == image(2)));
        assert_eq!(subs_of(&out[1]), vec![10, 11]);
    }

    /// A row admitted and evicted within one step keeps its `Add` before its
    /// `Delete`, and rows keep their first-appearance order.
    #[test]
    fn keeps_admit_then_evict_and_row_order() {
        let out = fold(vec![
            raw(10, DataFrameOperation::Add(key(5), image(5))),
            raw(10, DataFrameOperation::Add(key(9), image(9))),
            raw(10, DataFrameOperation::Delete(key(9), image(9))),
        ]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].op.key(), &key(5));
        assert!(matches!(out[1].op, DataFrameOperation::Add(..)));
        assert!(matches!(out[2].op, DataFrameOperation::Delete(..)));
        assert_eq!(out[2].op.key(), &key(9));
    }

    /// A tree's subscribers travel as one shared list: one audience, one
    /// delta, however many they are, and the list is the tree's own.
    #[test]
    fn a_shared_list_is_one_audience() {
        let subscribers: Vec<SubId> = (0..1000).map(SubId).collect();
        let shared = Subs::of(&subscribers);
        let part = QueryPart::join(0);
        let operation = |op| Raw {
            table: TableName::from("t"),
            audience: Audience {
                part,
                subs: shared.clone(),
            },
            op,
        };
        let out = fold(vec![
            operation(DataFrameOperation::Delete(key(1), image(1))),
            operation(DataFrameOperation::Add(key(1), image(2))),
        ]);
        assert_eq!(out.len(), 1, "the in-place change is one Add");
        assert_eq!(out[0].audiences.len(), 1);
        assert_eq!(out[0].target_count(), 1000);
        let (Subs::Many(sent), Subs::Many(own)) = (&out[0].audiences[0].subs, &shared) else {
            panic!("a shared list");
        };
        assert!(Arc::ptr_eq(sent, own), "not copied");
        assert_eq!(Subs::of(&subscribers[..1]), Subs::One(SubId(0)));
    }

    /// Many distinct audiences on one row (a public row under a thousand
    /// readers' own trees) fold through the index, each standing on its
    /// own.
    #[test]
    fn many_audiences_on_one_row_keep_their_own_standing() {
        let mut ops = Vec::new();
        for sub in 0..200u64 {
            ops.push(raw(sub, DataFrameOperation::Delete(key(1), image(1))));
        }
        for sub in 0..100u64 {
            ops.push(raw(sub, DataFrameOperation::Add(key(1), image(2))));
        }
        let out = fold(ops);
        assert_eq!(out.len(), 2);
        assert_eq!(subs_of(&out[0]), (100..200).collect::<Vec<_>>());
        assert_eq!(subs_of(&out[1]), (0..100).collect::<Vec<_>>());
    }
}
