//! ORDER BY / LIMIT maintenance: the per-subscription window state and
//! the engine hooks that keep it — and its **boundary condition** in the
//! routing index — in lockstep with the held rows.
//!
//! A query with a finite `LIMIT L` is maintained as a **doubled buffer**:
//! storage queries are issued with `2·L`, and the subscription keeps a
//! [`Window`] — its held rows' order values, best → worst, plus the
//! **frontier**: the worst order value known to be *covered* from
//! storage, meaning every matching row strictly better than it is held.
//! Storage reads set the frontier (the worst value fetched when a read
//! returned as many rows as it asked for; absent when it returned fewer,
//! since storage is then exhausted and every matching row is held), and
//! evictions pull it in (an evicted row is back in storage unheld, so the
//! covered prefix ends at its value). Three behaviors derive from it:
//!
//! - **admission boundary**: the strict condition "better than the
//!   frontier" (`<` for ASC, `>` for DESC), whether or not the buffer is
//!   full; absent while storage is exhausted. It is *pushed into the
//!   table's routing index* ([`SingleTableIVM::sync_boundary`]) whenever
//!   it changes, so `matched()` itself drops candidates the boundary
//!   rejects — a write beyond the frontier never even reaches the engine,
//!   and rows are never admitted unboundedly. The boundary gates
//!   **admission only**: a row the subscription already holds is exempt
//!   (it keeps its slot when its value worsens, until a better arrival
//!   evicts it).
//! - **eviction** ([`SingleTableIVM::evict_overflow`]): rows past
//!   capacity are untagged worst-first, each emitting its `Delete` and
//!   becoming the frontier.
//! - **refill** ([`SingleTableIVM::refill`]): when a removal drains the
//!   buffer to `L`, one storage read is asked for from the frontier
//!   *inclusive* (`>=` for ASC, `<=` for DESC), sized for the missing rows
//!   plus the held rows the threshold returns again (they dedup on
//!   upsert), back up to capacity; when it lands the frontier moves to
//!   the worst value fetched. When the order is unique (it ends in the
//!   row key) and the frontier is a read's worst row, the read starts
//!   strictly past it: that row was read and decided; an evicted row at
//!   the frontier is read again. Anchoring both the boundary and the
//!   refill at the frontier rather than at the worst *held* row is what
//!   keeps the top-`L` exact: a row admitted while the buffer had room
//!   can never push the refill threshold past storage rows that were
//!   never fetched, and rows tying the frontier stay reachable.
//!
//! `ORDER BY` may name several columns, compared in turn. The order value
//! of a row is then a tuple, the frontier one too, and the boundary and
//! refill threshold become the lexicographic comparison spelled out as a
//! predicate: for `ORDER BY a ASC, b ASC` and frontier `(fa, fb)` the
//! admission boundary is `a < fa OR (a = fa AND b < fb)`, one branch per
//! column with the earlier columns tied, each branch strict in its own
//! direction; the refill threshold is the same shape with the operators
//! reversed and the last column inclusive. A frontier with a `NULL` or
//! `NaN` in any column is unenforceable, as for one column.
//!
//! **What the client sees.** The buffer is the engine's; the client is sent
//! exactly the best `L` rows. After every step that touched a windowed
//! subscription its raw operations are narrowed
//! ([`SingleTableIVM::gate_window`]) to the difference between the previous
//! and the current best-`L` prefix: a row entering the prefix is an `Add`
//! (whether it arrived from storage or a write, or moved up from the
//! buffer), a row leaving it a `Delete` (whether it left the buffer or was
//! pushed down into it), a shown row rewritten in place its own operations
//! (the `Delete` + `Add` pair the join layer diffs, one `Add` at the
//! client); buffer rows below the prefix produce nothing. A twin registration and
//! [`SingleTableIVM::rows_for`] see the same prefix.
//!
//! **A page under a gate.** In the join layer a windowed part may drive an
//! inner edge, and the rows that edge rejects (no sub row matches them)
//! must not take a place in the page: the page is the best `L` rows *the
//! gate lets through*, as `Take` above `Exists` computes it in the client.
//! Such a part registers its window as a **page**
//! ([`SingleTableIVM::register_page`]), and the window then tells held
//! rows apart: a **candidate** is a held row the gate has not decided
//! yet, an **admitted** row one the gate let through, and what the layer
//! above sees (the prefix the operations are narrowed to) is the
//! candidates and the admitted rows together, so every candidate's sub
//! rows are asked for as soon as it is held. A client is sent the first
//! `L` admitted rows only ([`Window::client_prefix`]); the layer keeps
//! that view and ships its changes. The page reaches in **rounds**: a
//! round decides a batch of candidates (the layer tells the window which
//! ones its gate closed on, [`SingleTableIVM::finish_round`], once the
//! reads that could open them have landed), and when fewer than `L` rows
//! are admitted after that the next batch follows — twice the size of the
//! last, no larger than the engine's row limit, the first
//! `max(10·L, 100)` rows. A page **read whole** holds every row of its
//! filter from its one read, takes its batches from the rows it holds and
//! keeps the rows the gate rejected, held apart, so that a write opening
//! one's gate finds it in memory; a page **read in batches** reads each
//! batch from its frontier, and drops the rejected rows outright (they
//! are behind the frontier, never read again). The page keeps `2·L`
//! admitted rows with their sub rows; admitted rows past those are
//! demoted (back to waiting in memory, or evicted behind the frontier).
//! After [`PAGE_ROUNDS`] rounds without filling, the page is **capped**:
//! it reaches no further (its page then holds fewer than `L` rows;
//! `window_capped` counts it, and the join layer names the subscriptions)
//! until one of its admitted rows leaves, which starts the rounds over.
//!
//! A storage read lands some time after it is asked for, and writes route
//! in between. While one is out the window publishes **no boundary** (so
//! no write the read will not return is turned away; arrivals are
//! admitted and, past capacity, evicted, each eviction pulling the
//! frontier in as usual) and asks for no further refill; a read that
//! covers the whole filter (a registration's snapshot, a refill) also
//! clears the frontier when asked for, since what storage holds beyond
//! the held rows is unknown until it lands. Landing then re-derives the
//! frontier: a full result covers up to its worst value, pulled in by any
//! eviction that happened meanwhile; a short result leaves it where the
//! evictions put it (absent if there were none, meaning storage is
//! exhausted). A **lookup** ([`SingleTableIVM::lookup`]) is the exception:
//! it asks for the rows of one join value, lands only those better than
//! the frontier and leaves the frontier alone.
//!
//! Rows are ordered with [`order_cmp`], a total order extending
//! [`crate::model::Value::compare`]: `NaN` sorts above every other
//! numeric and `Null` above everything (Postgres's convention that both
//! are "largest"), and remaining incomparable pairs fall back to a fixed
//! variant rank. A `Null`/`NaN` **frontier** is unenforceable as a
//! predicate (comparisons touching them are always false), so the window
//! then publishes no boundary rather than reject everything — admission
//! falls back to accept-then-evict, and refills run unthresholded, sized
//! to capacity (re-fetched held rows dedup harmlessly). Ties are broken
//! arbitrarily, like SQL. A `LIMIT 0` subscription publishes an
//! always-false boundary (`IN ()`), so it stays permanently empty.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use super::{FetchKind, SingleTableIVM, SingleTableUpdate};
use crate::model::{
    ComparisonOperator, Condition, DataFrameKey, DataFrameOperation, DataFrameRow, Order, OrderBy,
    SingleTableReadQuery, SubId, TableName, Value, Where,
};

/// The fewest rows a page under a gate reads at first and reaches by in a
/// round: ten times its limit when that is more.
pub const PAGE_FIRST_BATCH: u32 = 100;

/// How many rounds of reaching further a short page takes before it is
/// capped.
pub const PAGE_ROUNDS: u32 = 10;

/// How a page under a gate is to be read, as the join layer asks for it
/// when it registers the part: whole (every row of the filter in one
/// read, the batches taken from memory) or in batches read from the
/// frontier, and the size of the first batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageSpec {
    pub whole: bool,
    pub first_batch: u32,
}

impl PageSpec {
    /// The spec for a page of `limit` rows: the first batch is ten times
    /// the limit, at least [`PAGE_FIRST_BATCH`].
    pub fn new(whole: bool, limit: u32) -> Self {
        PageSpec {
            whole,
            first_batch: limit.saturating_mul(10).max(PAGE_FIRST_BATCH),
        }
    }
}

/// What the next round of a page is: a storage read of `Read` rows from
/// the frontier (for a window that is not a page, the rows missing from
/// its buffer), `Promoted` rows taken from memory, the page `Capped`
/// after [`PAGE_ROUNDS`] rounds, or `Nothing` (capped already, or nothing
/// left to take).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Round {
    Read(u32),
    Promoted(usize),
    Capped,
    Nothing,
}

/// The rows a page holds, by what the gate has made of them, and its
/// rounds: an audit's and a description's view of the page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PageState {
    pub whole: bool,
    pub candidates: HashSet<DataFrameKey>,
    pub admitted: HashSet<DataFrameKey>,
    pub rejected: HashSet<DataFrameKey>,
    pub rounds: u32,
    pub batch: usize,
    pub capped: bool,
}

/// The state of a page under a gate (see the module header): how it is
/// read, the batch the next round takes, the rounds taken since the page
/// was last full and whether it is capped, and its held rows sorted by
/// the gate's verdict — candidates (undecided), admitted (gate open),
/// rejected (gate closed; kept only by a page read whole) — every other
/// held row waiting in memory for a round to take it. The prefix a
/// client is sent, the first `L` admitted rows, is read off the entries
/// when asked for ([`Window::client_prefix`]).
struct Page {
    whole: bool,
    batch: usize,
    row_limit: usize,
    rounds: u32,
    capped: bool,
    candidates: HashSet<DataFrameKey>,
    admitted: HashSet<DataFrameKey>,
    rejected: HashSet<DataFrameKey>,
}

/// A held row's order value, one per `ORDER BY` column, shared between
/// the sorted entries and the index by key.
type OrderValue = Rc<[Value]>;

/// How few new rows a landing may bring for them to be inserted one by
/// one (a binary search and a shift each) rather than by sorting them and
/// merging them into the entries in one pass.
const MERGE_FROM: usize = 32;

/// The ORDER BY / LIMIT state of one subscription: its held rows' order
/// values (one per `ORDER BY` column), best → worst, the same values by
/// key (`held`, so whether a row is held and where it sits cost a lookup
/// and a binary search, never a walk), the storage frontier the boundary
/// and the refill threshold are anchored at, the keys last delivered to
/// the layer above (the prefix at the last step), whether the last
/// refill brought nothing new (`stalled`: no further refill is asked for
/// until the held rows change), whether the order is unique (`unique`:
/// it ends in the row key, so no row ties the frontier), whether the
/// frontier row itself is still to be read (`inclusive`: an evicted row
/// sits at the frontier, unheld; a read's worst row was decided already),
/// and, for a page under a gate, the page's state.
pub(super) struct Window {
    order: Vec<OrderBy>,
    user_limit: usize,
    entries: Vec<(OrderValue, DataFrameKey)>,
    held: HashMap<DataFrameKey, OrderValue>,
    frontier: Option<Vec<Value>>,
    inclusive: bool,
    shown: Vec<DataFrameKey>,
    stalled: bool,
    unique: bool,
    page: Option<Page>,
    version: u64,
}

impl Window {
    /// An empty window for `query`; `None` when the query has no finite,
    /// positive limit (`LIMIT 0` is handled by an always-false boundary
    /// instead — see the module header).
    pub(super) fn for_query(query: &SingleTableReadQuery) -> Option<Self> {
        if !windowed(query) {
            return None;
        }
        Some(Window {
            order: query.order_by.clone(),
            user_limit: query.limit as usize,
            entries: Vec::new(),
            held: HashMap::new(),
            frontier: None,
            inclusive: false,
            shown: Vec::new(),
            stalled: false,
            unique: false,
            page: None,
            version: 0,
        })
    }

    /// A count of the changes to what the window holds and what its page
    /// admits: the layer above compares it with the count it last synced
    /// its view at, and an unchanged window costs it nothing.
    pub(super) fn version(&self) -> u64 {
        self.version
    }

    /// Note a change to the held rows or the page's verdicts.
    fn touched(&mut self) {
        self.version = self.version.wrapping_add(1);
    }

    /// Learn from the first key held whether the order is unique: it is
    /// when it names every column of the row key (the client's queries end
    /// their `ORDER BY` in the primary key), and no row can then tie the
    /// frontier.
    fn learn(&mut self, key: &DataFrameKey) {
        if self.entries.is_empty() {
            self.unique = key
                .pkey_value
                .keys()
                .all(|column| self.order.iter().any(|clause| clause.column == *column));
        }
    }

    /// An empty page window for `query`, read as `spec` says, its batches
    /// never larger than `row_limit`.
    pub(super) fn for_page(
        query: &SingleTableReadQuery,
        spec: PageSpec,
        row_limit: usize,
    ) -> Option<Self> {
        let mut window = Self::for_query(query)?;
        window.page = Some(Page {
            whole: spec.whole,
            batch: (spec.first_batch as usize).clamp(1, row_limit.max(1)),
            row_limit: row_limit.max(1),
            rounds: 0,
            capped: false,
            candidates: HashSet::new(),
            admitted: HashSet::new(),
            rejected: HashSet::new(),
        });
        Some(window)
    }

    /// The page spec this window was built with, if it is a page — what a
    /// rebuild carries over.
    fn page_spec(&self) -> Option<(PageSpec, usize)> {
        self.page.as_ref().map(|page| {
            (
                PageSpec {
                    whole: page.whole,
                    first_batch: page.batch as u32,
                },
                page.row_limit,
            )
        })
    }

    /// Whether the window is a page under a gate.
    pub(super) fn is_page(&self) -> bool {
        self.page.is_some()
    }

    /// Whether the window is a page read whole.
    pub(super) fn is_whole(&self) -> bool {
        self.page.as_ref().is_some_and(|page| page.whole)
    }

    /// The limit of the window's first storage read: the page's first
    /// batch, the engine's row limit for a page read whole (the planner
    /// counted it smaller), twice the user's limit otherwise.
    pub(super) fn read_limit(&self) -> u32 {
        match &self.page {
            Some(page) if page.whole => page.row_limit as u32,
            Some(page) => page.batch as u32,
            None => (self.user_limit as u32).saturating_mul(2),
        }
    }

    /// How many held rows count toward capacity: the admitted rows of a
    /// page, every held row otherwise.
    fn settled(&self) -> usize {
        match &self.page {
            Some(page) => page.admitted.len(),
            None => self.entries.len(),
        }
    }

    /// The buffer capacity in settled rows: twice the user's limit.
    fn capacity(&self) -> usize {
        self.user_limit * 2
    }

    /// The order value of a row image: one value per `ORDER BY` column
    /// (`Null` where the column is absent).
    pub(super) fn order_value(&self, row: &DataFrameRow) -> Vec<Value> {
        self.order
            .iter()
            .map(|clause| row.data.get(&clause.column).cloned().unwrap_or(Value::Null))
            .collect()
    }

    /// Insert one row's order value, keeping best → worst order; ties land
    /// after their equals (stable). Idempotent: a key already present is
    /// re-inserted at its new value's position, never duplicated, and
    /// keeps what the gate made of it.
    pub(super) fn insert(&mut self, value: Vec<Value>, key: DataFrameKey) {
        self.learn(&key);
        self.detach(&key);
        self.place(Rc::from(value), key);
        self.stalled = false;
    }

    /// Put a row that is not held at its value's position: after every
    /// entry at or better than its value, found by binary search.
    fn place(&mut self, value: OrderValue, key: DataFrameKey) {
        let order = &self.order;
        let position = self
            .entries
            .partition_point(|(existing, _)| !is_worse(existing, &value, order));
        self.held.insert(key.clone(), value.clone());
        self.entries.insert(position, (value, key));
        self.touched();
    }

    /// Insert many rows at once (a storage read landing): a few are placed
    /// one by one, more are sorted and merged into the entries in one
    /// pass. Keys already held keep their place and what the gate made of
    /// them.
    pub(super) fn insert_many(&mut self, rows: Vec<(Vec<Value>, DataFrameKey)>) {
        let Some((_, first)) = rows.first() else {
            return;
        };
        self.learn(first);
        let mut fresh: Vec<(OrderValue, DataFrameKey)> = rows
            .into_iter()
            .filter(|(_, key)| !self.held.contains_key(key))
            .map(|(value, key)| (Rc::from(value), key))
            .collect();
        if fresh.is_empty() {
            return;
        }
        self.stalled = false;
        if fresh.len() < MERGE_FROM {
            for (value, key) in fresh {
                self.place(value, key);
            }
            return;
        }
        fresh.sort_by(|(a, _), (b, _)| order_values(a, b, &self.order));
        for (value, key) in &fresh {
            self.held.insert(key.clone(), value.clone());
        }
        let existing = std::mem::take(&mut self.entries);
        let mut merged = Vec::with_capacity(existing.len() + fresh.len());
        let mut fresh = fresh.into_iter().peekable();
        for entry in existing {
            while let Some(next) = fresh.peek() {
                if is_worse(&entry.0, &next.0, &self.order) {
                    merged.push(fresh.next().expect("peeked"));
                } else {
                    break;
                }
            }
            merged.push(entry);
        }
        merged.extend(fresh);
        self.entries = merged;
        self.touched();
    }

    /// Where `key` sits among the entries, `None` when it is not held: a
    /// binary search to the entries tying its value, then the few of
    /// those (ties are rare: the order usually ends in the row key).
    fn position_of(&self, key: &DataFrameKey) -> Option<usize> {
        let value = self.held.get(key)?;
        let order = &self.order;
        let from = self
            .entries
            .partition_point(|(existing, _)| is_worse(value, existing, order));
        self.entries[from..]
            .iter()
            .take_while(|(existing, _)| !is_worse(existing, value, order))
            .position(|(_, existing)| existing == key)
            .map(|offset| from + offset)
    }

    /// Whether `key` is held.
    fn holds(&self, key: &DataFrameKey) -> bool {
        self.held.contains_key(key)
    }

    /// Take one key out of the entries, leaving its page state as it is
    /// (an in-place re-insertion is about to put it back).
    fn detach(&mut self, key: &DataFrameKey) {
        if let Some(index) = self.position_of(key) {
            self.entries.remove(index);
            self.held.remove(key);
            self.touched();
        }
    }

    /// Carry the page `previous` last delivered over to this window, so
    /// the next gate ships the difference from what the layer holds
    /// rather than the whole prefix again, and the gate's verdicts on the
    /// rows still held.
    pub(super) fn adopt_page(&mut self, previous: Window) {
        self.shown = previous.shown;
        if let (Some(page), Some(before)) = (&mut self.page, previous.page) {
            let held = &self.held;
            let kept = |keys: HashSet<DataFrameKey>| -> HashSet<DataFrameKey> {
                keys.into_iter()
                    .filter(|key| held.contains_key(key))
                    .collect()
            };
            page.candidates = kept(before.candidates);
            page.admitted = kept(before.admitted);
            page.rejected = kept(before.rejected);
            page.rounds = before.rounds;
            page.capped = before.capped;
        }
        self.touched();
    }

    /// The keys of the prefix the layer above sees: for a page its
    /// candidates and admitted rows, in order; otherwise the best `L`
    /// held rows.
    pub(super) fn shown_prefix(&self) -> Vec<DataFrameKey> {
        match &self.page {
            Some(page) => self
                .entries
                .iter()
                .map(|(_, key)| key)
                .filter(|key| page.candidates.contains(key) || page.admitted.contains(key))
                .cloned()
                .collect(),
            None => self
                .entries
                .iter()
                .take(self.user_limit)
                .map(|(_, key)| key.clone())
                .collect(),
        }
    }

    /// Whether `key` is in the prefix the layer above sees.
    pub(super) fn in_span(&self, key: &DataFrameKey) -> bool {
        match &self.page {
            Some(page) => page.candidates.contains(key) || page.admitted.contains(key),
            None => self
                .position_of(key)
                .is_some_and(|position| position < self.user_limit),
        }
    }

    /// The keys a client is sent: for a page the first `L` admitted rows,
    /// read off the entries now; otherwise the prefix itself.
    pub(super) fn client_prefix(&self) -> Vec<DataFrameKey> {
        match &self.page {
            Some(page) => self
                .entries
                .iter()
                .map(|(_, key)| key)
                .filter(|key| page.admitted.contains(key))
                .take(self.user_limit)
                .cloned()
                .collect(),
            None => self.shown_prefix(),
        }
    }

    /// Make a held row a candidate: a row that needs the gate's verdict (a
    /// row a read or a write brought, a rejected row a write concerns).
    /// Nothing for a row already admitted or not held.
    pub(super) fn enroll(&mut self, key: &DataFrameKey) {
        let held = self.holds(key);
        let Some(page) = &mut self.page else {
            return;
        };
        if !held || page.admitted.contains(key) {
            return;
        }
        page.rejected.remove(key);
        page.candidates.insert(key.clone());
        self.touched();
    }

    /// The candidates, best first: a few are sorted by their positions,
    /// many are picked out of the entries in one walk.
    pub(super) fn candidates(&self) -> Vec<DataFrameKey> {
        let Some(page) = &self.page else {
            return Vec::new();
        };
        if page.candidates.len() * 8 < self.entries.len() {
            let mut placed: Vec<(usize, &DataFrameKey)> = page
                .candidates
                .iter()
                .filter_map(|key| self.position_of(key).map(|position| (position, key)))
                .collect();
            placed.sort_unstable_by_key(|(position, _)| *position);
            return placed.into_iter().map(|(_, key)| key.clone()).collect();
        }
        self.entries
            .iter()
            .map(|(_, key)| key)
            .filter(|key| page.candidates.contains(key))
            .cloned()
            .collect()
    }

    /// The gate let `key` through: it counts toward the page from now on.
    /// Reports whether that changed anything.
    pub(super) fn admit(&mut self, key: &DataFrameKey) -> bool {
        let held = self.holds(key);
        let Some(page) = &mut self.page else {
            return false;
        };
        if !held || !page.admitted.insert(key.clone()) {
            return false;
        }
        page.candidates.remove(key);
        page.rejected.remove(key);
        self.touched();
        true
    }

    /// The gate closed on an admitted row: it is a candidate again until
    /// the round decides it, and the page's rounds start over (a place
    /// came free). Reports whether that changed anything.
    pub(super) fn unadmit(&mut self, key: &DataFrameKey) -> bool {
        let Some(page) = &mut self.page else {
            return false;
        };
        if !page.admitted.remove(key) {
            return false;
        }
        page.candidates.insert(key.clone());
        page.rounds = 0;
        page.capped = false;
        self.touched();
        true
    }

    /// The gate closed on a candidate and the round is over: a page read
    /// whole keeps the row apart as rejected; for one read in batches the
    /// caller removes the row.
    fn reject(&mut self, key: &DataFrameKey) {
        if let Some(page) = &mut self.page {
            page.candidates.remove(key);
            if page.whole {
                page.rejected.insert(key.clone());
            }
            self.touched();
        }
    }

    /// Drop one row from the window; reports whether it was present. The
    /// frontier is untouched: a removal does not change what storage
    /// covers. An admitted row leaving starts a page's rounds over.
    pub(super) fn remove(&mut self, key: &DataFrameKey) -> bool {
        match self.position_of(key) {
            Some(index) => {
                self.entries.remove(index);
                self.held.remove(key);
                self.forget(key);
                self.stalled = false;
                self.touched();
                true
            }
            None => false,
        }
    }

    /// Drop many rows at once (a round's rejected rows): one pass.
    pub(super) fn remove_many(&mut self, keys: &HashSet<DataFrameKey>) {
        if keys.is_empty() {
            return;
        }
        self.entries.retain(|(_, key)| !keys.contains(key));
        for key in keys {
            self.held.remove(key);
            self.forget(key);
        }
        self.stalled = false;
        self.touched();
    }

    /// Take `key` out of every page set; an admitted row leaving starts
    /// the rounds over.
    fn forget(&mut self, key: &DataFrameKey) {
        if let Some(page) = &mut self.page {
            page.candidates.remove(key);
            page.rejected.remove(key);
            if page.admitted.remove(key) {
                page.rounds = 0;
                page.capped = false;
            }
        }
    }

    /// The worst held row past capacity, removed from the window and
    /// recorded as the frontier (it is back in storage, unheld) — the
    /// engine untags it and emits its `Delete`. A page read whole never
    /// evicts (it demotes, [`Window::demote_overflow`]); a page read in
    /// batches evicts from the tail until no more than `2·L` admitted
    /// rows are held.
    pub(super) fn pop_overflow(&mut self) -> Option<DataFrameKey> {
        if self.is_whole() || self.settled() <= self.capacity() {
            return None;
        }
        let (value, key) = self.entries.pop()?;
        self.held.remove(&key);
        self.forget(&key);
        self.cover(value.to_vec(), true);
        self.touched();
        Some(key)
    }

    /// For a page read whole: the admitted rows past the `2·L` best go
    /// back to waiting in memory (their sub rows are released). Returns
    /// the demoted keys.
    pub(super) fn demote_overflow(&mut self) -> Vec<DataFrameKey> {
        let capacity = self.capacity();
        let Some(page) = &mut self.page else {
            return Vec::new();
        };
        if !page.whole || page.admitted.len() <= capacity {
            return Vec::new();
        }
        let mut kept = 0usize;
        let mut demoted = Vec::new();
        for (_, key) in &self.entries {
            if !page.admitted.contains(key) {
                continue;
            }
            if kept < capacity {
                kept += 1;
            } else {
                demoted.push(key.clone());
            }
        }
        for key in &demoted {
            page.admitted.remove(key);
        }
        if !demoted.is_empty() {
            self.touched();
        }
        demoted
    }

    /// Pull the frontier in to `value` unless the current frontier is
    /// already at or better than it: the covered prefix only ever shrinks
    /// here (a held row that worsened in place past the frontier and is
    /// then evicted must not widen it). `inclusive` says whether the row
    /// at `value` is still to be read (an evicted row) or was read and
    /// decided already (a read's worst row).
    fn cover(&mut self, value: Vec<Value>, inclusive: bool) {
        let standing = self.frontier.as_ref().map(|frontier| {
            if is_worse(frontier, &value, &self.order) {
                Ordering::Greater
            } else if is_worse(&value, frontier, &self.order) {
                Ordering::Less
            } else {
                Ordering::Equal
            }
        });
        match standing {
            None | Some(Ordering::Greater) => {
                self.frontier = Some(value);
                self.inclusive = inclusive;
            }
            Some(Ordering::Equal) => self.inclusive |= inclusive,
            Some(Ordering::Less) => {}
        }
    }

    /// Whether a row with order value `value` may be held: strictly better
    /// than the frontier, or anything while storage is exhausted.
    pub(super) fn admits(&self, value: &[Value]) -> bool {
        match &self.frontier {
            None => true,
            Some(frontier) => is_worse(frontier, value, &self.order),
        }
    }

    /// Record a landed storage read. `worst_read` is the worst row the
    /// read returned when it came back full, as storage returned it and
    /// before the runtime brought the result up to date: rows beyond it
    /// exist unheld, so the frontier pulls in to it (from absent, it is
    /// set). `None` is a read that came back short, which says nothing
    /// beyond what evictions already recorded. A read of the whole filter
    /// cleared the frontier when it was asked for, so for it a full
    /// result sets the frontier to its worst value (pulled in by any
    /// eviction meanwhile) and a short one leaves storage exhausted. The
    /// rows that land may be fewer than the read returned (a write since
    /// took some out): fullness is the read's, not theirs.
    pub(super) fn note_fetch(&mut self, worst_read: Option<&DataFrameRow>) {
        if let Some(worst) = worst_read {
            let value = self.order_value(worst);
            self.cover(value, false);
        }
    }

    /// The current frontier — what a twin registration inherits.
    pub(super) fn frontier(&self) -> Option<Vec<Value>> {
        self.frontier.clone()
    }

    /// Adopt a frontier wholesale (a twin's, whose held rows this window
    /// was just rebuilt from).
    pub(super) fn set_frontier(&mut self, frontier: Option<Vec<Value>>) {
        self.frontier = frontier;
        self.inclusive = true;
    }

    /// The admission boundary: strictly better than the frontier, column
    /// by column (`<` for ASC, `>` for DESC, the earlier columns tied).
    /// Absent while storage is exhausted, and absent for an unenforceable
    /// frontier (`Null`/`NaN` in any column).
    pub(super) fn boundary_condition(&self) -> Option<Where> {
        let frontier = self.frontier.as_ref()?;
        if !enforceable(frontier) {
            return None;
        }
        Some(lexicographic(
            &self.order,
            frontier,
            |direction, _| match direction {
                Order::ASC => ComparisonOperator::LT,
                Order::DESC => ComparisonOperator::GT,
            },
        ))
    }

    /// The refill read for `wanted` rows as (limit, threshold): `None`
    /// when storage is exhausted (nothing left to fetch). Otherwise the
    /// threshold is "at or worse than the frontier" (`>` / `<` by
    /// direction with the earlier columns tied, inclusive on the last
    /// column, so rows tying the frontier stay reachable) — strictly
    /// worse when the order is unique (it ends in the row key: no row can
    /// tie the frontier) and the frontier row was read already (a read's
    /// worst row, not an evicted one) — and the limit is `wanted` plus the
    /// held rows the threshold returns again, which the upsert dedups; an
    /// unenforceable frontier yields an unthresholded read sized to
    /// capacity.
    pub(super) fn refill_plan(&self, wanted: u32) -> Option<(u32, Option<Where>)> {
        let frontier = self.frontier.as_ref()?;
        if !enforceable(frontier) {
            return Some((self.capacity().max(wanted as usize) as u32, None));
        }
        let strict = self.unique && !self.inclusive;
        let order = &self.order;
        let within = if strict {
            self.entries
                .partition_point(|(value, _)| !is_worse(value, frontier, order))
        } else {
            self.entries
                .partition_point(|(value, _)| is_worse(frontier, value, order))
        };
        let held_beyond = self.entries.len() - within;
        let limit = (wanted as usize + held_beyond) as u32;
        let threshold = lexicographic(&self.order, frontier, |direction, last| {
            match (direction, last && !strict) {
                (Order::ASC, false) => ComparisonOperator::GT,
                (Order::ASC, true) => ComparisonOperator::GTE,
                (Order::DESC, false) => ComparisonOperator::LT,
                (Order::DESC, true) => ComparisonOperator::LTE,
            }
        });
        Some((limit, Some(threshold)))
    }

    /// Whether at least `wanted` settled rows lie strictly inside the
    /// frontier, where every matching row of storage is known to be held
    /// (every settled row does when storage is exhausted). The rows inside
    /// the frontier are a prefix of the entries, found by binary search; a
    /// page counts the admitted ones among them, stopping at `wanted`. A
    /// held row whose value worsened in place past the frontier keeps its
    /// slot but is not among them: storage may hold better rows that were
    /// never fetched.
    fn covers(&self, wanted: usize) -> bool {
        let Some(frontier) = &self.frontier else {
            return self.settled() >= wanted;
        };
        let order = &self.order;
        let inside = self
            .entries
            .partition_point(|(value, _)| is_worse(frontier, value, order));
        match &self.page {
            None => inside >= wanted,
            Some(page) => {
                self.entries[..inside]
                    .iter()
                    .filter(|(_, key)| page.admitted.contains(key))
                    .nth(wanted.saturating_sub(1))
                    .is_some()
                    || wanted == 0
            }
        }
    }

    /// The refill trigger: the settled rows have drained to the user's
    /// limit, or fewer than the limit of them are inside the frontier
    /// (the page would otherwise reach into rows that worsened in place
    /// past it, over better rows storage still holds). Not while the last
    /// refill brought nothing new; for a page, not while it is capped or
    /// a round is still deciding candidates, and not before the settled
    /// rows fall short of the limit.
    pub(super) fn needs_refill(&self) -> bool {
        if self.stalled {
            return false;
        }
        match &self.page {
            Some(page) => {
                !page.capped
                    && page.candidates.is_empty()
                    && (page.admitted.len() < self.user_limit || !self.covers(self.user_limit))
            }
            None => self.settled() <= self.user_limit || !self.covers(self.user_limit),
        }
    }

    /// Record that a landed refill tagged `added` new rows: none means
    /// storage has nothing the window lacks, and asking again would ask
    /// for the same rows.
    pub(super) fn note_refill(&mut self, added: usize) {
        if added == 0 {
            self.stalled = true;
        }
    }

    /// Start the next round (see [`Round`]): for a window that is not a
    /// page, a read of the rows missing from its buffer; for a page, once
    /// [`PAGE_ROUNDS`] rounds have not filled it, the cap; otherwise one
    /// more round of the current batch — the next `batch` waiting rows
    /// promoted to candidates for a page read whole, a read of `batch`
    /// rows from the frontier for one read in batches — and the batch
    /// doubled for the round after, up to the row limit.
    pub(super) fn next_round(&mut self) -> Round {
        let capacity = self.capacity();
        let exhausted = self.frontier.is_none();
        let Some(page) = &mut self.page else {
            let missing = capacity.saturating_sub(self.entries.len()) as u32;
            return Round::Read(missing);
        };
        if page.capped || (!page.whole && exhausted) {
            return Round::Nothing;
        }
        let waiting: Vec<DataFrameKey> = if page.whole {
            self.entries
                .iter()
                .map(|(_, key)| key)
                .filter(|key| {
                    !page.candidates.contains(key)
                        && !page.admitted.contains(key)
                        && !page.rejected.contains(key)
                })
                .take(page.batch)
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        if page.whole && waiting.is_empty() {
            self.stalled = true;
            return Round::Nothing;
        }
        if page.rounds >= PAGE_ROUNDS {
            page.capped = true;
            return Round::Capped;
        }
        page.rounds += 1;
        let batch = page.batch;
        page.batch = batch.saturating_mul(2).min(page.row_limit);
        if !page.whole {
            return Round::Read(batch as u32);
        }
        let promoted = waiting.len();
        page.candidates.extend(waiting);
        self.touched();
        Round::Promoted(promoted)
    }

    /// For a page read whole: the waiting rows that rank before the page's
    /// `L`-th admitted row become candidates, so a row demoted while the
    /// page was fuller is decided again once admitted rows above it have
    /// left (a short page takes its waiting rows in rounds instead).
    /// Returns how many were promoted.
    pub(super) fn promote_due(&mut self) -> usize {
        let limit = self.user_limit;
        let Some(page) = &mut self.page else {
            return 0;
        };
        if !page.whole || page.admitted.len() < limit {
            return 0;
        }
        let mut admitted = 0usize;
        let mut promoted = 0usize;
        for (_, key) in &self.entries {
            if page.admitted.contains(key) {
                admitted += 1;
                if admitted == limit {
                    break;
                }
                continue;
            }
            if page.candidates.contains(key) || page.rejected.contains(key) {
                continue;
            }
            page.candidates.insert(key.clone());
            promoted += 1;
        }
        if promoted > 0 {
            self.touched();
        }
        promoted
    }

    /// A round is over for a page: the rows the gate closed on are put
    /// aside (kept as rejected by a page read whole; the caller removes
    /// them from one read in batches), and a page full again starts its
    /// count of rounds over. Returns the keys the caller removes.
    pub(super) fn finish_round(
        &mut self,
        rejected: &HashSet<DataFrameKey>,
    ) -> HashSet<DataFrameKey> {
        let limit = self.user_limit;
        let whole = self.is_whole();
        for key in rejected {
            self.reject(key);
        }
        let dropped: HashSet<DataFrameKey> = if whole {
            HashSet::new()
        } else {
            rejected.clone()
        };
        if let Some(page) = &mut self.page
            && page.admitted.len() >= limit
        {
            page.rounds = 0;
        }
        dropped
    }

    /// Whether a round of the page would do nothing: no candidate to
    /// decide, no refill due, nothing past capacity, and no waiting row
    /// for a page read whole to promote (the layer then skips the round).
    pub(super) fn round_idle(&self) -> bool {
        match &self.page {
            None => true,
            Some(page) => {
                page.candidates.is_empty()
                    && !page.whole
                    && !self.needs_refill()
                    && self.settled() <= self.capacity()
            }
        }
    }

    /// Whether the page is capped.
    pub(super) fn capped(&self) -> bool {
        self.page.as_ref().is_some_and(|page| page.capped)
    }

    /// The page's state, for an audit or a description; `None` for a
    /// window that is not a page.
    pub(super) fn page_state(&self) -> Option<PageState> {
        self.page.as_ref().map(|page| PageState {
            whole: page.whole,
            candidates: page.candidates.clone(),
            admitted: page.admitted.clone(),
            rejected: page.rejected.clone(),
            rounds: page.rounds,
            batch: page.batch,
            capped: page.capped,
        })
    }
}

/// Whether a query is windowed: a finite, positive limit.
pub(super) fn windowed(query: &SingleTableReadQuery) -> bool {
    query.limit > 0 && query.limit < u32::MAX
}

/// The limit a storage query should carry for a subscription whose window
/// is `window`: the window's first read limit, or the query's own when it
/// has no window.
pub(super) fn storage_limit(query: &SingleTableReadQuery, window: Option<&Window>) -> u32 {
    match window {
        Some(window) => window.read_limit(),
        None if windowed(query) => query.limit.saturating_mul(2),
        None => query.limit,
    }
}

/// Whether a frontier can be enforced as a predicate — comparisons
/// touching `Null` or `NaN` are always false, so a condition built from
/// one would reject or fetch nothing.
fn enforceable(values: &[Value]) -> bool {
    values
        .iter()
        .all(|value| !value.is_null() && !matches!(value, Value::Float(f) if f.is_nan()))
}

/// Whether `existing` sorts strictly worse than `candidate` under `order`:
/// the first column that differs decides, worse being greater for ASC and
/// less for DESC; a full tie is not worse.
fn is_worse(existing: &[Value], candidate: &[Value], order: &[OrderBy]) -> bool {
    for (index, clause) in order.iter().enumerate() {
        let ordering = order_cmp(
            existing.get(index).unwrap_or(&Value::Null),
            candidate.get(index).unwrap_or(&Value::Null),
        );
        if ordering == Ordering::Equal {
            continue;
        }
        return match clause.direction {
            Order::ASC => ordering == Ordering::Greater,
            Order::DESC => ordering == Ordering::Less,
        };
    }
    false
}

/// The order of two order values under `order`, as a total order: the
/// first differing column decides, reversed for DESC; a full tie is
/// `Equal`.
fn order_values(a: &[Value], b: &[Value], order: &[OrderBy]) -> Ordering {
    if is_worse(a, b, order) {
        Ordering::Greater
    } else if is_worse(b, a, order) {
        Ordering::Less
    } else {
        Ordering::Equal
    }
}

/// The lexicographic comparison against `frontier` as a predicate: one
/// branch per column, the earlier columns tied and the column itself
/// compared with the operator `operator_for` picks from its direction and
/// whether it is the last; a single column is the bare condition.
fn lexicographic(
    order: &[OrderBy],
    frontier: &[Value],
    operator_for: impl Fn(Order, bool) -> ComparisonOperator,
) -> Where {
    let branches: Vec<Where> = order
        .iter()
        .enumerate()
        .map(|(index, clause)| {
            let mut conjuncts: Vec<Where> = order[..index]
                .iter()
                .zip(frontier)
                .map(|(tied, value)| {
                    Where::Condition(Condition::new(
                        tied.column.clone(),
                        ComparisonOperator::EQ,
                        value.clone(),
                    ))
                })
                .collect();
            conjuncts.push(Where::Condition(Condition::new(
                clause.column.clone(),
                operator_for(clause.direction, index + 1 == order.len()),
                frontier.get(index).cloned().unwrap_or(Value::Null),
            )));
            if conjuncts.len() == 1 {
                conjuncts.pop().expect("one conjunct")
            } else {
                Where::AND(conjuncts)
            }
        })
        .collect();
    if branches.len() == 1 {
        branches.into_iter().next().expect("one branch")
    } else {
        Where::OR(branches)
    }
}

/// The order of two rows under `order`: the first differing column
/// decides, reversed for DESC; a full tie is `Equal`. The comparison the
/// storage doubles sort by.
pub fn order_rows(order: &[OrderBy], a: &DataFrameRow, b: &DataFrameRow) -> Ordering {
    for clause in order {
        let ordering = order_cmp(
            a.data.get(&clause.column).unwrap_or(&Value::Null),
            b.data.get(&clause.column).unwrap_or(&Value::Null),
        );
        if ordering == Ordering::Equal {
            continue;
        }
        return match clause.direction {
            Order::ASC => ordering,
            Order::DESC => ordering.reverse(),
        };
    }
    Ordering::Equal
}

/// Total order over [`Value`]s for window and storage sorting: delegates
/// to [`Value::compare`] where defined; `NaN` sorts above every other
/// numeric (all `NaN`s equal) and `Null` above everything — Postgres's
/// convention — and remaining incomparable pairs fall back to a fixed
/// variant rank. Deterministic and transitive, if semantically arbitrary
/// across types.
pub fn order_cmp(a: &Value, b: &Value) -> Ordering {
    if let Some(ordering) = a.compare(b) {
        return ordering;
    }
    let a_nan = matches!(a, Value::Float(f) if f.is_nan());
    let b_nan = matches!(b, Value::Float(f) if f.is_nan());
    let a_numeric = matches!(a, Value::Int(_) | Value::Float(_));
    let b_numeric = matches!(b, Value::Int(_) | Value::Float(_));
    if a_nan && b_numeric && !b_nan {
        return Ordering::Greater;
    }
    if b_nan && a_numeric && !a_nan {
        return Ordering::Less;
    }
    rank(a).cmp(&rank(b))
}

/// The variant rank backing [`order_cmp`]'s cross-type fallback; `Null`
/// last, per the module header.
fn rank(value: &Value) -> u8 {
    match value {
        Value::Bool(_) => 0,
        Value::Int(_) | Value::Float(_) => 1,
        Value::String(_) => 2,
        Value::Date(_) => 3,
        Value::Datetime(_) => 4,
        Value::List(_) => 5,
        Value::Map(_) | Value::Set(_) => 6,
        Value::Null => 7,
    }
}

impl SingleTableIVM {
    /// Publish the subscription's current admission boundary into its
    /// table's routing index — the `boundaries` side table `matched()`
    /// filters candidates through. Called after every change that can
    /// move the boundary; a `LIMIT 0` query publishes the always-false
    /// `OR()`, and a subscription with a storage read out publishes none.
    pub(super) fn sync_boundary(&mut self, sub: SubId) {
        let Some(query) = self.select_queries.get(&sub) else {
            return;
        };
        let table = query.table.clone();
        let boundary = if query.limit == 0 {
            Some(Where::OR(Vec::new()))
        } else if self.is_pending(sub) {
            None
        } else {
            self.windows
                .get(&sub)
                .and_then(|window| window.boundary_condition())
        };
        self.tables
            .entry(table)
            .or_default()
            .set_boundary(sub, boundary);
    }

    /// (Re)derive a subscription's window entries from the rows it
    /// currently holds, with no frontier yet — the caller records the
    /// storage read or twin the rows came from — keeping the prefix the
    /// layer above was last sent and the page's state, if there was a
    /// window before; queries without a finite positive limit carry no
    /// window.
    pub(super) fn rebuild_window(&mut self, sub: SubId) {
        let previous = self.windows.remove(&sub);
        let Some(query) = self.select_queries.get(&sub) else {
            return;
        };
        let built = match previous.as_ref().and_then(Window::page_spec) {
            Some((spec, row_limit)) => Window::for_page(query, spec, row_limit),
            None => Window::for_query(query),
        };
        let Some(mut window) = built else {
            return;
        };
        if let Some(ids) = self.held.get(&sub)
            && let Some(frame) = self.frames.get(&query.table)
        {
            let rows: Vec<(Vec<Value>, DataFrameKey)> = ids
                .iter()
                .filter_map(|id| frame.row(*id))
                .map(|row| (window.order_value(&row.data), row.key.clone()))
                .collect();
            window.insert_many(rows);
        }
        if let Some(previous) = previous {
            window.adopt_page(previous);
        }
        self.windows.insert(sub, window);
    }

    /// The change count of `sub`'s window ([`Window::version`]); `None`
    /// for a subscription without one.
    pub(super) fn window_version(&self, sub: SubId) -> Option<u64> {
        self.windows.get(&sub).map(Window::version)
    }

    /// Whether a round of `sub`'s page would do nothing
    /// ([`Window::round_idle`]).
    pub(super) fn page_round_idle(&self, sub: SubId) -> bool {
        self.windows.get(&sub).is_none_or(Window::round_idle)
    }

    /// Whether `sub`'s page has stopped reaching further.
    pub(super) fn page_capped(&self, sub: SubId) -> bool {
        self.windows.get(&sub).is_some_and(Window::capped)
    }

    /// The state of `sub`'s page, and the window's in words (held rows,
    /// frontier, whether a read is out): what an audit of the join layer
    /// compares its gates with. `None` for a subscription that is not a
    /// page.
    pub(super) fn page_state(&self, sub: SubId) -> Option<(PageState, String)> {
        let window = self.windows.get(&sub)?;
        Some((
            window.page_state()?,
            format!(
                "{} held, frontier {:?}, stalled {}, read out {}",
                window.entries.len(),
                window.frontier,
                window.stalled,
                self.is_pending(sub)
            ),
        ))
    }

    /// The candidates of `sub`'s page, best first: the held rows whose
    /// gate the layer above has yet to decide.
    pub(super) fn page_candidates(&self, sub: SubId) -> Vec<DataFrameKey> {
        self.windows
            .get(&sub)
            .map(Window::candidates)
            .unwrap_or_default()
    }

    /// The gate of `sub`'s page let `key` through; reports whether that
    /// changed anything.
    pub(super) fn admit(&mut self, sub: SubId, key: &DataFrameKey) -> bool {
        self.windows
            .get_mut(&sub)
            .is_some_and(|window| window.admit(key))
    }

    /// The gate of `sub`'s page closed on an admitted row; reports whether
    /// that changed anything.
    pub(super) fn unadmit(&mut self, sub: SubId, key: &DataFrameKey) -> bool {
        self.windows
            .get_mut(&sub)
            .is_some_and(|window| window.unadmit(key))
    }

    /// Make the held rows `keys` of `sub`'s page candidates again (rows a
    /// page read whole had rejected, which a write now concerns), so the
    /// next round decides them; the rows enter the prefix the layer sees
    /// and ask for their sub rows. Returns the operations.
    pub(super) fn enroll_rows(
        &mut self,
        sub: SubId,
        keys: &[DataFrameKey],
    ) -> Vec<SingleTableUpdate> {
        let Some(window) = self.windows.get_mut(&sub) else {
            return Vec::new();
        };
        for key in keys {
            window.enroll(key);
        }
        let ops = self.gate_window(sub, Vec::new());
        self.tagged(sub, ops)
    }

    /// The keys a client of `sub` is sent, in order: for a page its first
    /// `L` admitted rows; for any other window its prefix; every held row
    /// for a subscription without a window.
    pub(super) fn client_prefix(&self, sub: SubId) -> Vec<DataFrameKey> {
        match self.windows.get(&sub) {
            Some(window) => window.client_prefix(),
            None => self
                .rows_for(sub)
                .map(|rows| rows.into_keys().collect())
                .unwrap_or_default(),
        }
    }

    /// A round of `sub`'s page is over: the layer above found the gate
    /// closed on `rejected` among the candidates (the rest it admitted as
    /// their sub rows arrived). A page read whole keeps them as rejected
    /// and makes candidates again of the waiting rows that now rank
    /// within its first `L` admitted; one read in batches drops them
    /// (untagged, no `cover`: they are behind the frontier and are never
    /// read again). Then admitted rows past `2·L` are demoted or evicted,
    /// the next round is started if the page is still short, the
    /// boundary is republished, and the difference in the prefix the
    /// layer sees comes back as operations. Nothing for a subscription
    /// that is not a page.
    pub fn finish_round(
        &mut self,
        sub: SubId,
        rejected: HashSet<DataFrameKey>,
    ) -> Vec<SingleTableUpdate> {
        let Some(window) = self.windows.get_mut(&sub) else {
            return Vec::new();
        };
        if !window.is_page() {
            return Vec::new();
        }
        self.stats.window_rejections += rejected.len() as u64;
        let dropped = window.finish_round(&rejected);
        window.remove_many(&dropped);
        window.promote_due();
        let mut ops = Vec::new();
        for key in &dropped {
            if let Some(op) = self.untag_row(sub, key) {
                ops.push(op);
            }
        }
        ops.extend(self.evict_overflow(sub));
        if self.windows.get(&sub).is_some_and(Window::needs_refill) {
            self.refill(sub);
        }
        self.sync_boundary(sub);
        let ops = self.gate_window(sub, ops);
        self.tagged(sub, ops)
    }

    /// Untag worst-held rows until the subscription is back at buffer
    /// capacity, returning their `Delete`s; each eviction pulls the
    /// frontier in to the evicted value. A page read whole demotes its
    /// admitted rows past capacity instead, which leave the prefix the
    /// layer sees but stay held.
    pub(super) fn evict_overflow(&mut self, sub: SubId) -> Vec<DataFrameOperation> {
        if let Some(window) = self.windows.get_mut(&sub) {
            let demoted = window.demote_overflow();
            self.stats.window_evictions += demoted.len() as u64;
        }
        let mut ops = Vec::new();
        while let Some(evicted) = self
            .windows
            .get_mut(&sub)
            .and_then(|window| window.pop_overflow())
        {
            self.stats.window_evictions += 1;
            if let Some(op) = self.untag_row(sub, &evicted) {
                ops.push(op);
            }
        }
        ops
    }

    /// Ask for a drained buffer's refill back to capacity, or a page's
    /// next round: one storage read from the frontier inclusive
    /// (unthresholded for an unenforceable one; nothing at all when
    /// storage is exhausted, or while another read is out), ordered,
    /// sized by the window's refill plan — or, for a page read whole, the
    /// next batch of its held rows promoted to candidates, no read at
    /// all. The frontier is cleared until a read lands (see the module
    /// header); landing tags the rows in and re-derives it.
    pub(super) fn refill(&mut self, sub: SubId) {
        if self.is_pending(sub) {
            return;
        }
        let Some(query) = self.select_queries.get(&sub).cloned() else {
            return;
        };
        let Some(window) = self.windows.get_mut(&sub) else {
            return;
        };
        let paged = window.is_page();
        let wanted = match window.next_round() {
            Round::Read(wanted) => wanted,
            Round::Promoted(_) => {
                self.stats.page_rounds += 1;
                return;
            }
            Round::Capped => {
                self.stats.window_capped += 1;
                return;
            }
            Round::Nothing => return,
        };
        let Some((limit, threshold)) = window.refill_plan(wanted) else {
            return;
        };
        if limit == 0 {
            return;
        }
        let mut parts = vec![query.filter.clone()];
        parts.extend(threshold);
        let refill_query = SingleTableReadQuery {
            table: query.table.clone(),
            filter: Where::AND(parts),
            order_by: query.order_by.clone(),
            limit,
        };
        window.set_frontier(None);
        self.stats.window_refills += 1;
        if paged {
            self.stats.page_rounds += 1;
        }
        self.issue(sub, refill_query, FetchKind::Refill);
    }

    /// Window bookkeeping for one impacted subscription after a routed
    /// write: track the row's arrival/departure in the window (a page
    /// makes an arrival a candidate), evict past capacity, ask for a
    /// refill when a removal drained the buffer to the user's limit, and
    /// republish the boundary. A no-op for subscriptions without a
    /// window.
    pub(super) fn maintain_window(
        &mut self,
        sub: SubId,
        key: &DataFrameKey,
        row_image: Option<&DataFrameRow>,
        matches_after: bool,
        present_before: bool,
    ) -> Vec<SingleTableUpdate> {
        let drained = {
            let Some(window) = self.windows.get_mut(&sub) else {
                return Vec::new();
            };
            if present_before {
                window.remove(key);
            }
            if matches_after {
                let row = row_image.expect("matches_after implies a row image");
                let value = window.order_value(row);
                window.insert(value, key.clone());
                window.enroll(key);
            }
            present_before && !matches_after && window.needs_refill()
        };
        let table = match self.select_queries.get(&sub) {
            Some(query) => query.table.clone(),
            None => return Vec::new(),
        };
        let ops = self.evict_overflow(sub);
        if drained {
            self.refill(sub);
        }
        self.sync_boundary(sub);
        ops.into_iter()
            .map(|op| SingleTableUpdate {
                query: sub,
                table: table.clone(),
                op,
            })
            .collect()
    }

    /// Narrow one windowed subscription's raw operations to the view of
    /// the layer above: the difference between the prefix delivered last
    /// time and the prefix now, plus the raw operations of a row that
    /// stays in the prefix (a rewrite's `Delete` + `Add` pair, which the
    /// join layer diffs; see the module header). A row leaving carries the
    /// image it was last delivered with (the step's first `Delete` of it:
    /// a row rewritten and pushed out in one step leaves with its old
    /// image, the one the layer above counted its join values from), a
    /// row entering its newest. A subscription without a window passes
    /// its operations through.
    pub(super) fn gate_window(
        &mut self,
        sub: SubId,
        raw: Vec<DataFrameOperation>,
    ) -> Vec<DataFrameOperation> {
        let (previous, current) = match self.windows.get_mut(&sub) {
            Some(window) => {
                let current = window.shown_prefix();
                let previous = std::mem::replace(&mut window.shown, current.clone());
                (previous, current)
            }
            None => return raw,
        };
        let frame = self
            .select_queries
            .get(&sub)
            .and_then(|query| self.frames.get(&query.table));
        let held = |key: &DataFrameKey| -> Option<DataFrameRow> {
            frame
                .and_then(|frame| frame.get(key))
                .map(|row| row.data.clone())
        };
        let mut by_key: HashMap<&DataFrameKey, Vec<&DataFrameOperation>> = HashMap::new();
        for op in &raw {
            by_key.entry(op.key()).or_default().push(op);
        }
        let entering = |key: &DataFrameKey| -> Option<DataFrameRow> {
            by_key
                .get(key)
                .and_then(|ops| {
                    ops.iter().rev().find_map(|op| match op {
                        DataFrameOperation::Add(_, row) => Some(row.clone()),
                        _ => None,
                    })
                })
                .or_else(|| held(key))
        };
        let leaving = |key: &DataFrameKey| -> Option<DataFrameRow> {
            by_key
                .get(key)
                .and_then(|ops| {
                    ops.iter().find_map(|op| match op {
                        DataFrameOperation::Delete(_, row) => Some(row.clone()),
                        _ => None,
                    })
                })
                .or_else(|| held(key))
        };
        let was: HashSet<&DataFrameKey> = previous.iter().collect();
        let now: HashSet<&DataFrameKey> = current.iter().collect();
        let mut out = Vec::new();
        for key in previous.iter().filter(|key| !now.contains(key)) {
            if let Some(image) = leaving(key) {
                out.push(DataFrameOperation::Delete(key.clone(), image));
            }
        }
        for key in &current {
            if !was.contains(key) {
                if let Some(image) = entering(key) {
                    out.push(DataFrameOperation::Add(key.clone(), image));
                }
            } else if let Some(ops) = by_key.get(key) {
                out.extend(ops.iter().map(|op| (*op).clone()));
            }
        }
        out
    }

    /// Gate the windowed subscriptions among `subs` in `updates`: their
    /// raw operations are replaced by [`SingleTableIVM::gate_window`]'s
    /// result, every other update passes through in order.
    pub(super) fn gate_updates(
        &mut self,
        subs: &[SubId],
        updates: Vec<SingleTableUpdate>,
    ) -> Vec<SingleTableUpdate> {
        let mut windowed: Vec<SubId> = subs
            .iter()
            .copied()
            .filter(|sub| self.windows.contains_key(sub))
            .collect();
        windowed.sort_unstable();
        windowed.dedup();
        if windowed.is_empty() {
            return updates;
        }
        let mut out = Vec::new();
        let mut raw: Vec<(SubId, TableName, Vec<DataFrameOperation>)> = windowed
            .iter()
            .filter_map(|sub| {
                self.select_queries
                    .get(sub)
                    .map(|query| (*sub, query.table.clone(), Vec::new()))
            })
            .collect();
        let slots: HashMap<SubId, usize> = raw
            .iter()
            .enumerate()
            .map(|(slot, (sub, _, _))| (*sub, slot))
            .collect();
        for update in updates {
            match slots.get(&update.query) {
                Some(&slot) => raw[slot].2.push(update.op),
                None => out.push(update),
            }
        }
        for (sub, table, ops) in raw {
            for op in self.gate_window(sub, ops) {
                out.push(SingleTableUpdate {
                    query: sub,
                    table: table.clone(),
                    op,
                });
            }
        }
        out
    }
}
