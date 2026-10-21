//! Per-table routing index: DNF disjunct counters keyed by their conditions,
//! reached through a per-column value index.
//!
//! One [`TableIndex`] holds everything needed to answer "which subscriptions
//! does this row image match" for one table. Each DNF disjunct is a single
//! [`DisjunctCounter`] shared (via `Rc<RefCell<_>>`) under every condition
//! it contains — sharing is what makes counting correct: all conditions of
//! an AND-disjunct must bump the *same* counter for it to ever reach its
//! size. The same sharing also deduplicates across subscriptions: filters
//! that normalize to an identical [`Disjunct`] reuse one counter, and a
//! single firing fans out to every subscriber. A write reaches its matching
//! conditions by looking each of its column values up in the column's
//! [`ColumnIndex`] (`O(columns · log n)`), never by evaluating the table's
//! conditions one by one; the conditions found are then counted exactly as
//! before.
//!
//! # Single-threaded by design (for now)
//!
//! The engine works on a single thread only; multithreading is a later step
//! to be thought through deliberately when it comes up. `Rc<RefCell<_>>` is
//! not a concession to threading — it is the single-threaded tool for the
//! aliasing this index needs: one counter object *owned by several map
//! entries* (`Rc`), mutated through those shared handles (`RefCell`).
//! Without it, the same counter could not sit under N condition keys at
//! all. "Shared" therefore means strictly within the one engine: across
//! condition keys and across subscriptions — never across threads, and the
//! compiler enforces exactly that: `Rc` is not `Send`, so code trying to
//! move or share the engine across threads is rejected at compile time
//! instead of racing at runtime.
//!
//! For whenever multithreading is designed, the sketch on record is table
//! sharding (one owning thread per table; no counter, frame, or epoch is
//! ever shared between tables), under which this module can stay as it is
//! per shard.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use super::columns::{ColumnIndex, CondRef};
use super::predicate::evaluate;
use super::stats::IvmStats;
use crate::model::{ColumnName, Condition, Disjunct, IdMap, RowData, SubId, Value, Where};

/// Shared handle to one disjunct's counting state; cloned under every
/// condition key the disjunct contains.
type SharedCounter = Rc<RefCell<DisjunctCounter>>;

/// One DNF disjunct's counting state plus every subscription it fires.
///
/// - `size`: number of distinct conditions in the disjunct; the counter
///   fires when `satisfied` reaches it.
/// - `epoch`: the write that `satisfied` belongs to. A stale counter is
///   reset the first time the current write touches it, so no per-write
///   sweep is needed.
/// - `satisfied`: conditions of this disjunct matched so far in `epoch`.
/// - `subscribers`: the subscriptions whose filters contain this disjunct
///   shape; all of them are impacted when the counter fires.
struct DisjunctCounter {
    size: usize,
    epoch: u64,
    satisfied: usize,
    subscribers: Vec<SubId>,
}

/// One indexed condition: the shared handle it is filed under in its
/// column's [`ColumnIndex`], and the counters of the disjuncts containing
/// it.
struct Linked {
    handle: CondRef,
    counters: Vec<SharedCounter>,
}

/// The routing index for one table.
///
/// - `by_condition`: condition → the shared counters of every disjunct
///   containing it, plus the handle the column index files it under.
/// - `columns`: column → the value index over that column's conditions;
///   the probe path of a write.
/// - `by_disjunct`: [`Disjunct`] (as produced by
///   [`crate::model::Where::to_dnf`], its conditions carried inside) → its
///   shared counter, so an identical disjunct registered again reuses the
///   counter instead of duplicating it. Disjuncts are canonical
///   ([`Disjunct::new`] sorts and dedups their conditions), so the order a
///   filter names its conditions in never splits a counter.
/// - `unconditional`: subscriptions owning an empty (vacuously true)
///   disjunct; they match every row write on the table and never appear in
///   `by_condition`.
/// - `boundaries`: per-subscription ORDER BY / LIMIT admission boundary —
///   an extra condition a fired candidate must also satisfy (unless it
///   already holds the row), published and re-published by the engine's
///   window maintenance as the boundary value moves. Kept beside the
///   disjuncts, never inside them: it changes with every admission and
///   would otherwise churn the counting structures.
/// - `by_subscriber`: each subscription's non-empty disjuncts, so that
///   releasing or editing one subscription touches its own counters and
///   not every counter of the table.
#[derive(Default)]
pub(super) struct TableIndex {
    by_condition: HashMap<Condition, Linked>,
    columns: HashMap<ColumnName, ColumnIndex>,
    by_disjunct: HashMap<Disjunct, SharedCounter>,
    unconditional: Vec<SubId>,
    boundaries: IdMap<SubId, Where>,
    by_subscriber: IdMap<SubId, Vec<Disjunct>>,
}

impl TableIndex {
    /// Index `subscriber`'s DNF disjuncts.
    ///
    /// An empty disjunct goes to `unconditional`; a disjunct already present
    /// (from another subscription, or a duplicate within this one) only
    /// gains the subscriber — no new counter, no new links, and therefore no
    /// double-counting. `conditions_indexed` counts only links actually
    /// added.
    pub(super) fn register(
        &mut self,
        subscriber: SubId,
        disjuncts: Vec<Disjunct>,
        stats: &mut IvmStats,
    ) {
        for disjunct in disjuncts {
            stats.disjuncts_registered += 1;
            let links = self.attach(subscriber, disjunct);
            stats.conditions_indexed += links;
        }
    }

    /// Attach `subscriber` to one disjunct, creating or reusing its shared
    /// counter (an empty disjunct goes to `unconditional`); returns how
    /// many condition links were actually added.
    fn attach(&mut self, subscriber: SubId, disjunct: Disjunct) -> u64 {
        if disjunct.conditions.is_empty() {
            if !self.unconditional.contains(&subscriber) {
                self.unconditional.push(subscriber);
            }
            return 0;
        }
        if let Some(existing) = self.by_disjunct.get(&disjunct) {
            let mut counter = existing.borrow_mut();
            if !counter.subscribers.contains(&subscriber) {
                counter.subscribers.push(subscriber);
                self.by_subscriber
                    .entry(subscriber)
                    .or_default()
                    .push(disjunct);
            }
            return 0;
        }
        self.by_subscriber
            .entry(subscriber)
            .or_default()
            .push(disjunct.clone());
        let counter = Rc::new(RefCell::new(DisjunctCounter {
            size: disjunct.conditions.len(),
            epoch: 0,
            satisfied: 0,
            subscribers: vec![subscriber],
        }));
        let mut links = 0;
        for condition in &disjunct.conditions {
            if !self.by_condition.contains_key(condition) {
                let handle = CondRef(Rc::new(condition.clone()));
                self.columns
                    .entry(condition.column.clone())
                    .or_default()
                    .file(&handle);
                self.by_condition.insert(
                    condition.clone(),
                    Linked {
                        handle,
                        counters: Vec::new(),
                    },
                );
            }
            if let Some(linked) = self.by_condition.get_mut(condition) {
                linked.counters.push(Rc::clone(&counter));
                links += 1;
            }
        }
        self.by_disjunct.insert(disjunct, counter);
        links
    }

    /// Drop `dead`'s link from `condition`; a condition no counter needs
    /// anymore is unfiled from its column index and forgotten.
    fn unlink(&mut self, condition: &Condition, dead: &SharedCounter) {
        let Some(linked) = self.by_condition.get_mut(condition) else {
            return;
        };
        linked
            .counters
            .retain(|candidate| !Rc::ptr_eq(candidate, dead));
        if !linked.counters.is_empty() {
            return;
        }
        let Some(linked) = self.by_condition.remove(condition) else {
            return;
        };
        if let Some(column) = self.columns.get_mut(&condition.column) {
            column.unfile(&linked.handle);
            if column.is_empty() {
                self.columns.remove(&condition.column);
            }
        }
    }

    /// Detach `subscriber` from one disjunct, dropping the counter and its
    /// condition links once no subscriber remains.
    fn detach(&mut self, disjunct: &Disjunct, subscriber: SubId) {
        if let Some(own) = self.by_subscriber.get_mut(&subscriber) {
            own.retain(|candidate| candidate != disjunct);
            if own.is_empty() {
                self.by_subscriber.remove(&subscriber);
            }
        }
        let Some(shared) = self.by_disjunct.get(disjunct) else {
            return;
        };
        shared
            .borrow_mut()
            .subscribers
            .retain(|candidate| *candidate != subscriber);
        if !shared.borrow().subscribers.is_empty() {
            return;
        }
        let Some(dead) = self.by_disjunct.remove(disjunct) else {
            return;
        };
        for condition in &disjunct.conditions {
            self.unlink(condition, &dead);
        }
    }

    /// Edit one condition of one subscriber's disjuncts **in place** — the
    /// value-list change of a join `IN`, without re-normalizing anything.
    ///
    /// Shared counters split correctly: for each of its disjuncts
    /// containing `old`, the subscriber leaves the old shape (which other
    /// subscribers keep, and which is dropped if it was the last holder)
    /// and joins — or creates — the disjunct with `new` swapped in.
    /// Counted in `conditions_replaced`; the caller owns keeping the
    /// stored filter and the held rows in step. Sound whenever the edit
    /// preserves the filter's DNF shape, which holds for a plain leaf
    /// condition.
    pub(super) fn update_condition(
        &mut self,
        subscriber: SubId,
        old: &Condition,
        new: &Condition,
        stats: &mut IvmStats,
    ) {
        let affected: Vec<Disjunct> = self
            .by_subscriber
            .get(&subscriber)
            .map(|own| {
                own.iter()
                    .filter(|disjunct| disjunct.conditions.contains(old))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        for old_disjunct in affected {
            stats.conditions_replaced += 1;
            self.detach(&old_disjunct, subscriber);
            let conditions: Vec<Condition> = old_disjunct
                .conditions
                .iter()
                .filter(|condition| *condition != old)
                .cloned()
                .chain(std::iter::once(new.clone()))
                .collect();
            self.attach(subscriber, Disjunct::new(conditions));
        }
    }

    /// A set-valued condition already indexed here gained `value`: file it
    /// under that one key (a set past the filing limit is probed instead
    /// and needs nothing). The set itself is the caller's to mutate;
    /// nothing else in the index moves. The column's index is made anew
    /// when it is gone: an empty set files nothing, so the last other
    /// condition leaving the column drops the column's index from under
    /// it.
    pub(super) fn set_insert(&mut self, condition: &Condition, value: &Value) {
        if let Some(linked) = self.by_condition.get(condition) {
            self.columns
                .entry(condition.column.clone())
                .or_default()
                .file_key(&linked.handle, value);
        }
    }

    /// A set-valued condition lost `value`: unfile it from that key.
    pub(super) fn set_remove(&mut self, condition: &Condition, value: &Value) {
        if let Some(linked) = self.by_condition.get(condition)
            && let Some(column) = self.columns.get_mut(&condition.column)
        {
            column.unfile_key(&linked.handle, value);
        }
    }

    /// Publish, move, or clear `subscriber`'s admission boundary.
    pub(super) fn set_boundary(&mut self, subscriber: SubId, boundary: Option<Where>) {
        match boundary {
            Some(boundary) => {
                self.boundaries.insert(subscriber, boundary);
            }
            None => {
                self.boundaries.remove(&subscriber);
            }
        }
    }

    /// Remove every trace of `subscriber`: its unconditional entry, its
    /// boundary, its membership in shared counters, and — once a counter
    /// has no subscribers left — the counter itself and all its condition
    /// links.
    pub(super) fn unregister(&mut self, subscriber: SubId) {
        self.unconditional
            .retain(|candidate| *candidate != subscriber);
        self.boundaries.remove(&subscriber);
        let mut dead_disjuncts: Vec<Disjunct> = Vec::new();
        for disjunct in self.by_subscriber.remove(&subscriber).unwrap_or_default() {
            let Some(counter) = self.by_disjunct.get(&disjunct) else {
                continue;
            };
            let mut counter = counter.borrow_mut();
            counter
                .subscribers
                .retain(|candidate| *candidate != subscriber);
            if counter.subscribers.is_empty() {
                dead_disjuncts.push(disjunct);
            }
        }
        for disjunct in &dead_disjuncts {
            let Some(dead) = self.by_disjunct.remove(disjunct) else {
                continue;
            };
            for condition in &disjunct.conditions {
                self.unlink(condition, &dead);
            }
        }
    }

    /// Whether the index routes nothing anymore (so the engine can drop it).
    pub(super) fn is_empty(&self) -> bool {
        self.by_disjunct.is_empty() && self.unconditional.is_empty() && self.boundaries.is_empty()
    }

    /// The subscriptions whose filters the row image satisfies **and**
    /// whose admission boundary (if any) it passes, sorted, each once.
    ///
    /// Looks each column value of the row up in that column's index, which
    /// yields exactly the conditions the value satisfies (each at most
    /// once); every one bumps the shared counters of the disjuncts
    /// containing it, and a counter reaching its size fires all of its
    /// subscribers. `epoch` must be a
    /// fresh, monotonically increased write number — it is what lazily
    /// invalidates counts left over from earlier writes. Unconditional
    /// subscribers are always included. Fired candidates are then filtered
    /// through their `boundaries` entry — except subscribers in `holders`
    /// (sorted), which already hold the written row: the boundary gates
    /// admission, not residence.
    pub(super) fn matched(
        &self,
        row: &RowData,
        epoch: u64,
        holders: &[SubId],
        stats: &mut IvmStats,
    ) -> Vec<SubId> {
        let mut fired: Vec<SubId> = Vec::new();
        let mut candidates: Vec<CondRef> = Vec::new();
        for (column, value) in row.iter() {
            if let Some(index) = self.columns.get(column.as_str()) {
                stats.columns_probed += 1;
                index.candidates(value, &mut candidates);
            }
        }
        for candidate in candidates {
            stats.conditions_evaluated += 1;
            stats.index_hits += 1;
            let Some(linked) = self.by_condition.get(&*candidate.0) else {
                continue;
            };
            for shared in &linked.counters {
                let mut counter = shared.borrow_mut();
                if counter.epoch != epoch {
                    counter.epoch = epoch;
                    counter.satisfied = 0;
                }
                counter.satisfied += 1;
                stats.disjunct_increments += 1;
                if counter.satisfied == counter.size {
                    stats.disjuncts_fired += 1;
                    fired.extend(counter.subscribers.iter().copied());
                }
            }
        }
        fired.extend(self.unconditional.iter().copied());
        fired.sort_unstable();
        fired.dedup();
        if !self.boundaries.is_empty() {
            fired.retain(|sub| {
                holders.binary_search(sub).is_ok()
                    || self
                        .boundaries
                        .get(sub)
                        .is_none_or(|boundary| evaluate(boundary, row, &mut 0))
            });
        }
        fired
    }
}
