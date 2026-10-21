//! Multi-table subscriptions: a tree of single-table parts joined by
//! edges, maintained over the single-table engine, with one tree shared by
//! every subscription that registers the same spec.
//!
//! A [`MultiTableReadQuery`] is a tree: every node is a single-table query,
//! every edge a [`Join`], and a child is itself a full multi-table query.
//! Each node registers as one inner single-table subscription — a *part*,
//! addressed by its [`QueryPart`] path — and the client receives every
//! operation tagged with its part, keeps one frame per part, and composes
//! the join itself.
//!
//! # Driver and driven
//!
//! Every edge says who drives it ([`Join::driver`]): the driver's held
//! rows decide which join values are *referenced*, and the driven side's
//! part carries the restriction `driven_column IN <set>` inside its
//! filter. An edge the main drives (LEFT, and the inner edge evaluated from
//! the main) restricts the sub; an edge the sub drives (RIGHT, and the
//! inner edge evaluated from the sub) restricts the main. Because the
//! restriction lives inside the driven part's filter, writes on the driven
//! table route natively through the single engine: a row matching the
//! filter (restriction included) fires an `Add`, a held row moving out
//! fires a `Delete` via membership, and an unreferenced row never fires at
//! all. The join layer never inspects driven-side writes; it forwards them
//! and keeps its counts. Everything the layer does follows from the edge's
//! driver, its `is_inner`, the sub node's limit and, for a page, how the
//! planner said to read it ([`MultiTableReadQuery::page`]); no planning
//! happens here.
//!
//! The restriction is exact only while the driver's set is complete: a
//! driver read whole, or a page read whole (whose set keeps every value
//! it ever referenced: a row the page kept apart must still route the
//! write that brings it back). An inner edge driven by a **page read in
//! batches** is *loose*, and so is every inner edge the main drives below
//! it: the page drops the rows its gate rejects and reads the rest batch
//! by batch, so its set says nothing about the rows it has not read or
//! has dropped, and the driven part registers its own filter with no
//! `IN` for that edge (a driven part with a loose edge reads nothing at
//! registration: its rows come from the narrowed reads its driver's
//! references ask for). A write on the driven side then routes on the
//! part's own filter, and the layer looks at the value it carries:
//! referenced, and the row is handled as any other; unreferenced, the row
//! is not held and the driver is asked for its rows with that value
//! ([`MultiTableIVM::recall`]: one storage read of the page,
//! [`SingleTableIVM::lookup`], landing the rows better than its frontier
//! as candidates; a page read whole simply makes the rows it kept apart
//! candidates again), so a gate that opens later is noticed. The same
//! happens when a held sub row's own gate opens (its value's first match,
//! [`MultiTableIVM::matched_in`]), since the page may have dropped other
//! rows with that value while it held one.
//!
//! # Set-valued leaves, placed
//!
//! The restriction's operand is a [`SharedSet`] owned by the tree and
//! referenced by the part's filter. A zero crossing therefore adds or
//! removes **one member** ([`SingleTableIVM::set_insert`] /
//! [`SingleTableIVM::set_remove`]): the index files the leaf under that one
//! value, the filter is untouched (it holds the same set), and nothing
//! proportional to the set's size is rebuilt. Where the leaf sits is the
//! author's choice: an `EXISTS` leaf in the node's own `WHERE`
//! ([`ComparisonOperator::EXISTS`], naming one of the node's inner edges)
//! is bound in place when the sub drives that edge, so `visibility =
//! 'PUBLIC' OR EXISTS(...)` is one filter with the restriction inside its
//! `OR`; an edge no leaf names is conjoined at the top. Edges bound by a
//! leaf have a set of their own; unnamed edges driving one part on one
//! column — a LEFT parent above it and a RIGHT child below it, both on
//! `id` — share one set holding the **intersection** of their referenced
//! values. When a value leaves a set the value's held rows are
//! re-evaluated against the filter, not deleted outright, so a row another
//! branch still admits stays.
//!
//! # The gates
//!
//! A row is *shown* (delivered to clients) only under a shown parent row:
//! under every edge but a RIGHT one a child row is shown while at least
//! one shown parent row carries its join value, under a RIGHT edge always
//! (the child is preserved), and the root always. Per edge and per value
//! the layer counts the shown parent rows; a crossing of that count admits
//! (one `Add` each) or retracts (one `Delete` each) the child rows for the
//! value, and each of those rows in turn is counted on the edges below it,
//! so a chain of inner edges shows exactly the rows that reach the root.
//! Held rows that are not shown still drive: a sub-driven inner child's
//! rows are evaluated first and fill the parent's set whether or not the
//! parent row that makes them visible has arrived.
//!
//! An inner edge the **main drives** cannot restrict the main's rows (the
//! sub's values are not known before the main is read; the sub is narrowed
//! to the main's values), so the main part registers its `WHERE` with the
//! edge's `EXISTS` leaf taken as true and the leaf becomes a gate: a main
//! row is shown while its `WHERE` holds with every `EXISTS` leaf read as
//! "a held sub row carries this row's join value" (`matched`, counted per
//! value as the sub's rows arrive and depart; unnamed, the test is
//! conjoined). A crossing of that count re-evaluates the main rows
//! carrying the value and admits or retracts them, cascading below as any
//! other visibility change.
//!
//! **What a row counts for above it.** A held row of a gated node acts on
//! the edge above its node only while its own gate is open: it is a
//! *match* for the parent rows it gates, or, when its node drives that
//! edge, a *reference* filling the parent's set. A user without a profile
//! opens no ticket's gate and drives no ticket in, however long it is
//! held; a private channel the reader is no participant of drives no
//! conversation. The node records which of its rows have *risen*
//! ([`Node::risen`]), so a row leaves exactly the counts it entered,
//! whatever the counts read by the time it goes. Downwards a row
//! references its join values as soon as it is held, gate open or not:
//! those references are what fetches the sub rows its gate is decided by.
//! Existence therefore flows leaves to root through open gates and
//! visibility root to leaves through shown rows; a gate reads risen rows,
//! never shown ones, so there is no cycle. A node that drives its parent
//! is waited for until its gates are decided (its own rows and those of
//! every node gating it have arrived), so the parent registers once,
//! with the whole set.
//!
//! # A page under a gate
//!
//! A node with a `LIMIT` that drives an inner edge is a page of the rows
//! *the edge admits*: `messages WHERE id = ? LIMIT 1` under the access
//! rule's `EXISTS`, the latest conversation of each channel whose first
//! message the reader may see. Its part registers as a page of the single
//! engine ([`SingleTableIVM::register_page`]; see the `window` module):
//! every held row the engine shows the layer is a **candidate** until the
//! gate decides it, and a candidate references its sub rows as soon as it
//! is held, so a whole batch is decided by one narrowed read per driven
//! part. The layer tells the page as gates open and close
//! ([`SingleTableIVM::admit`], [`SingleTableIVM::unadmit`]) and, once none
//! of the tree's reads is out (until then a closed gate may be a sub row
//! not yet fetched), which candidates the gate closed on
//! ([`SingleTableIVM::finish_round`]): the page puts them aside — dropped,
//! or kept apart by a page read whole — and, if fewer than `L` rows are
//! admitted, takes the next batch, whose rows arrive here like any others
//! and ask for their own sub rows; the next round follows when those reads
//! have landed ([`MultiTableIVM::settle_pages`]). What a client is sent is
//! the page's first `L` admitted rows: the layer keeps that **view** per
//! page part ([`MultiTableIVM::views`]) and, at the end of every step,
//! ships the difference ([`MultiTableIVM::sync_views`]) — the rows that
//! entered it appear, with their children, the rows that left it vanish —
//! so a page row's operations reach a client from there and nowhere else.
//! The subscription is not hydrated while a round is under way.
//!
//! # Driven windows
//!
//! A driven sub node with an `ORDER BY` / `LIMIT` of its own means, as it
//! does in the client's `related`, the best *n* rows **per parent row**: the
//! latest three messages of every conversation, not three messages in
//! all. Such a node registers no single part. It is *fanned*: one inner
//! part per referenced join value, `child WHERE own_filter AND column =
//! value ORDER BY … LIMIT n`, so every value has a window of its own
//! maintained by the single engine like any other, refills included. A
//! value entering the driver's set registers that value's part (its read
//! lands like a registration's); a value leaving unregisters it, its held
//! rows departing first. Every per-value part is addressed by the same
//! [`QueryPart`], so the client sees one part whose rows happen to be
//! windowed per parent. A sub node that drives its edge is read whole, so
//! its limit is an ordinary window on that one part.
//!
//! # Sharing
//!
//! Subscriptions with an identical spec share one tree: one inner part
//! per node, one set of edges and counts, one crossing per event. A later
//! identical registration is served its snapshot from the shared parts'
//! shown rows, and every operation a part produces is emitted **once**,
//! for all the tree's subscribers together: it carries the tree's
//! subscriber list by reference ([`Subs::Many`]), so a write costs the
//! layer the same whether one subscription shares the tree or ten
//! thousand do, and resolving the list to clients is the transport's
//! work. The tree is dropped with its last subscriber.
//!
//! # Counts, crossings, cascades
//!
//! Per edge and per join value the layer keeps `left` (driver rows
//! carrying the value), `shown` (shown parent rows carrying it) and, for
//! an inner edge the main drives, `matched` (held sub rows carrying it).
//! Only zero crossings of `left` act on the set: the value's driven rows
//! are fetched (one narrowed storage query) or pruned from current data.
//! Rows a fetch brings in are **arrivals** at the driven node and rows a
//! prune removes are **departures**, and the driven node may itself drive
//! further edges, so the same handling cascades down the tree — the
//! recursion that makes nesting work with one code path. The rows of one
//! join value are found through the value index the single engine keeps
//! on every join column ([`SingleTableIVM::index_column`]), so a crossing
//! costs the matches, not the part.
//!
//! # Order
//!
//! Registration is a post-order walk: the children that drive a node
//! register first (their rows fill the sets it is restricted by), then the
//! node, then the children it drives (restricted by its rows); during that
//! walk crossings only fill sets, since every part is registered with its
//! full set. A part's rows arrive when its storage read **lands**, some
//! time after it is asked for, so the walk is driven by landings: a node
//! registers once every child that drives it is *live* (its own read
//! landed and nothing further out for it), and the children it drives
//! register once it is live itself. A part served from a twin is live at
//! once. Within one write, each part's native operations are forwarded
//! with every **driven part before its driver** — because handling a
//! driver's operation may prune the driven frame, and a stale driven
//! operation forwarded after that prune would resurrect a row on the
//! client. An in-place replacement arrives as an adjacent `Delete(old)` +
//! `Add(new)` pair and is diffed per edge, so a rewrite that keeps a join
//! value never swings its count through zero.
//!
//! Inner parts are ordinary subscriptions of the inner engine, addressed by
//! the ids it hands out and looked up in a map; the reads they ask for
//! surface through the inner engine's request list, and land back through
//! [`MultiTableIVM::land_fetch`], which cascades the landed rows' arrivals
//! exactly as it cascades a write's.

use std::cell::OnceCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use super::engine::Footprint;
use super::predicate::{evaluate, evaluate_with};
use super::stats::IvmStats;
use super::update::{Audience, Raw, Subs, fold};
use super::window::PageSpec;
use super::{
    Delta, Engine, Fetch, FetchId, FetchKind, QueryPart, SchemaChange, SingleTableIVM,
    SingleTableUpdate,
};
use crate::model::frame::SharedRow;
use crate::model::{
    ColumnName, ComparisonOperator, Condition, DataFrameKey, DataFrameOperation, DataFrameRow,
    Driver, IdMap, IdSet, Join, MultiTableReadQuery, PageRead, SharedSet, SingleTableReadQuery,
    SubId, TableName, Value, Where, WriteQuery,
};

/// One operation for one part of a tree, the join layer's own unit, folded
/// per row before it leaves the engine ([`Delta`]).
///
/// - `subs`: who it is for: every subscriber of the tree, as the tree's
///   shared list, or the one subscription a snapshot is served to.
/// - `table`: the table the operation lands on.
/// - `part`: which node of the tree produced it — kept beside the table
///   because a self-join makes the table alone ambiguous.
/// - `op`: the delta itself.
#[derive(Debug, Clone, PartialEq)]
pub struct MultiTableUpdate {
    pub subs: Subs,
    pub table: TableName,
    pub part: QueryPart,
    pub op: DataFrameOperation,
}

/// Which shared set an edge restricts its driven part through: an edge
/// bound by an `EXISTS` leaf, or fanning its child, has a set of its own;
/// unnamed edges driving one part on one column share a set holding the
/// intersection of their referenced values.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum LeafKey {
    Shared(QueryPart, ColumnName),
    Own(usize),
}

/// Per-edge counts by join value.
///
/// - `left`: how many driver rows carry the value; its zero crossings
///   move the value in and out of the driven part's set.
/// - `shown`: how many shown parent rows carry the value; its zero
///   crossings admit and retract the child rows under a gating edge.
/// - `matched`: how many held child rows carry the value, kept for an
///   inner edge the main drives; its zero crossings admit and retract the
///   parent rows the edge gates.
///
/// Entries leave the maps when they reach zero, so they only hold live
/// values.
#[derive(Default)]
struct JoinKeyCounts {
    left: HashMap<Value, u64>,
    shown: HashMap<Value, u64>,
    matched: HashMap<Value, u64>,
}

/// One join edge of a registered tree, its direction made explicit
/// through [`Edge::driven`].
///
/// - `leaf`: the set the edge's restriction reads.
/// - `bound`: the `EXISTS` leaf in the parent's own filter this edge
///   binds in place to its set, when the sub drives and the filter names
///   it; otherwise the restriction is conjoined at the top.
/// - `gate`: the `EXISTS` leaf in the parent's own filter this edge
///   answers per row from its `matched` count, when the main drives an
///   inner edge and the filter names it; unnamed, the test is conjoined.
/// - `loose`: the driver is a page read in batches, or is itself driven
///   through a loose edge, so the driven part carries no restriction for
///   this edge (see the module docs).
/// - `kept`: the driver is a page read whole, or is itself driven through
///   a kept edge, so the driven part's `IN` keeps every value ever
///   referenced: a value of a row the page kept apart, or of a row pruned
///   below it, must still route the write that brings the row back.
/// - `dropped`: for an edge a page read in batches drives, the join
///   values (in `parent_column`) of the rows the page dropped as
///   rejected — the only rows a recall of the page can bring back (a
///   lookup lands nothing behind the page's frontier, and a row ahead of
///   it is held or was dropped), so a write on the driven side with any
///   other value is not looked up. Never emptied: a value dropped once
///   costs a lookup that lands nothing at worst.
struct Edge {
    driver: Driver,
    is_inner: bool,
    parent: QueryPart,
    child: QueryPart,
    parent_column: ColumnName,
    child_column: ColumnName,
    leaf: LeafKey,
    bound: Option<Condition>,
    gate: Option<Condition>,
    loose: bool,
    kept: bool,
    counts: JoinKeyCounts,
    dropped: HashSet<Value>,
}

impl Edge {
    /// The part whose filter carries this edge's leaf.
    fn driven(&self) -> &QueryPart {
        match self.driver {
            Driver::Main => &self.child,
            Driver::Sub => &self.parent,
        }
    }

    /// The column the leaf is on.
    fn driven_column(&self) -> &ColumnName {
        match self.driver {
            Driver::Main => &self.child_column,
            Driver::Sub => &self.parent_column,
        }
    }

    /// The join column of `part`, which must be one end of the edge.
    fn column_of(&self, part: &QueryPart) -> &ColumnName {
        if *part == self.parent {
            &self.parent_column
        } else {
            &self.child_column
        }
    }

    /// Whether the child's rows are shown only under a shown parent row
    /// (every edge but a RIGHT one).
    fn gates_child(&self) -> bool {
        self.driver != Driver::Sub || self.is_inner
    }

    /// Whether the parent's rows are shown only while a child row matches
    /// them (an inner edge the main drives).
    fn gates_parent(&self) -> bool {
        self.driver == Driver::Main && self.is_inner
    }

    /// How many held child rows carry `value`: the driver count when the
    /// child drives, the matched count when the main does. What an
    /// `EXISTS` leaf reads.
    fn child_count(&self, value: &Value) -> u64 {
        let counts = match self.driver {
            Driver::Sub => &self.counts.left,
            Driver::Main => &self.counts.matched,
        };
        counts.get(value).copied().unwrap_or(0)
    }

    /// [`Edge::child_count`] for `row`'s value in `column`, the value
    /// borrowed from the row; a missing column joins like `NULL` (never).
    fn child_count_of(&self, row: &DataFrameRow, column: &ColumnName) -> u64 {
        match row.data.get(column.as_str()) {
            Some(value) => self.child_count(value),
            None => 0,
        }
    }
}

/// The inner parts behind one node: none until registration reaches it,
/// one for an ordinary node, one per referenced join value for a driven
/// window (see the module docs).
enum Parts {
    Unregistered,
    One(SubId),
    Fan(HashMap<Value, SubId>),
}

/// One node of a registered tree: its inner parts (once registered),
/// whether it is a driven window (`fanned`), whether its rows have all
/// arrived (`live`), its place among the edges, the child edges that
/// gate its own rows (`gates`, the inner edges it drives), how it is
/// read when it is a page under a gate (`page`, `None` otherwise), and,
/// for a gated node that acts on the edge above it, the keys of its rows
/// currently counted there (`risen`: held, with the gate open).
struct Node {
    parts: Parts,
    fanned: bool,
    live: bool,
    query: SingleTableReadQuery,
    parent: Option<usize>,
    children: Vec<usize>,
    gates: Vec<usize>,
    page: Option<PageRead>,
    risen: HashSet<DataFrameKey>,
}

impl Node {
    /// Whether registration has reached this node.
    fn is_registered(&self) -> bool {
        !matches!(self.parts, Parts::Unregistered)
    }

    /// Every inner part currently behind the node.
    fn inner_parts(&self) -> Vec<SubId> {
        match &self.parts {
            Parts::Unregistered => Vec::new(),
            Parts::One(inner) => vec![*inner],
            Parts::Fan(fan) => fan.values().copied().collect(),
        }
    }
}

/// One registered spec and every subscription sharing it.
///
/// - `spec`: the tree as registered.
/// - `subscribers`: the subscription ids sharing it, in registration order,
///   and `audience`, that list as every operation of the tree carries it
///   (built when first needed, dropped when the subscribers change), so an
///   operation costs the same for one subscriber and for ten thousand.
/// - `nodes`: every part by path.
/// - `edges`: every join edge; nodes refer to them by index.
/// - `leaves`: the shared set behind each leaf, by [`LeafKey`].
/// - `rank`: forwarding order of the parts, every driven part before its
///   driver (see the module docs).
/// - `post_order`: registration order of the parts, used to serve a later
///   subscriber's snapshot.
/// - `pages`: the parts that are pages under a gate (a finite limit and
///   inner edges the node drives), whose rounds are settled once the
///   tree's reads have landed.
/// - `capped`: whether one of those pages has stopped reaching further
///   (reported once, until none is capped again).
struct Tree {
    spec: Rc<MultiTableReadQuery>,
    subscribers: Vec<SubId>,
    audience: OnceCell<Subs>,
    nodes: IdMap<QueryPart, Node>,
    edges: Vec<Edge>,
    leaves: HashMap<LeafKey, SharedSet>,
    rank: IdMap<QueryPart, usize>,
    post_order: Vec<QueryPart>,
    pages: Vec<QueryPart>,
    capped: bool,
}

/// How many rounds of rejecting rows and showing more one step may take
/// for one tree before the rest waits for the next step.
const SETTLE_ROUNDS: usize = 64;

/// The join layer's handle for one shared tree; unique for the life of
/// the layer, never reused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
struct TreeId(u64);

/// The join layer. Owns the inner [`SingleTableIVM`] exclusively, so its
/// part ids cannot collide with anything registered from outside.
///
/// - `single`: the inner engine holding every part's routing and the
///   shared per-table frames.
/// - `trees`: tree id → the shared tree, and `by_spec` the tree of each
///   registered spec (one lookup per registration).
/// - `by_sub`: subscription id → the tree it subscribes to.
/// - `next_sub`: the next subscription id to hand out; never reused.
/// - `parts`: inner part id → (tree id, part), the reverse map every
///   routed operation goes through.
/// - `dirty`: the trees with a page under a gate whose rows moved or
///   whose reads landed in this step, settled before the step returns, in
///   the order queued; `queued` is the same set, so queuing a tree again
///   costs a lookup.
/// - `views`: for each inner part that is a page, the page's first `L`
///   admitted rows as of the last sync, each with the image it was sent
///   with and whether it is sent at all (under a shown parent row);
///   `synced` the window version each view was last synced at
///   ([`SingleTableIVM::window_version`]), so a page whose window has not
///   changed since is not walked again.
/// - `in_flight`: the rows the inner engine holds whose `Add` this layer
///   has not reached yet within the step being forwarded.
/// - `wanted`: the join values newly referenced in this step, per driven
///   inner part and column, asked for in one narrowed read each when the
///   step ends instead of one read per value.
/// - `capped`: the subscriptions of trees a page of which has stopped
///   reaching further, until [`Engine::take_capped`] takes them.
/// - `cause`: what the operations being forwarded come from — a write, or
///   a read a page asked for itself — and `landing`, the part whose read
///   is landing, if one is; together they say whether a gate opening
///   needs a recall (see [`Cause`]). `write_reads` are the narrowed reads
///   a write provoked, still out.
///
/// The layer knows subscriptions, not clients: whose a subscription is,
/// the transport keeps.
pub struct MultiTableIVM {
    single: SingleTableIVM,
    trees: IdMap<TreeId, Tree>,
    by_spec: HashMap<Rc<MultiTableReadQuery>, TreeId>,
    next_tree: u64,
    by_sub: IdMap<SubId, TreeId>,
    next_sub: u64,
    parts: IdMap<SubId, (TreeId, QueryPart)>,
    dirty: Vec<TreeId>,
    queued: IdSet<TreeId>,
    views: IdMap<SubId, HashMap<DataFrameKey, ViewRow>>,
    synced: IdMap<SubId, u64>,
    in_flight: HashSet<(SubId, DataFrameKey)>,
    wanted: Vec<(SubId, ColumnName, Vec<Value>)>,
    capped: Vec<SubId>,
    cause: Cause,
    landing: Option<SubId>,
    write_reads: HashSet<FetchId>,
}

/// What a step's operations come from. A gate that opens under a
/// **page**'s own reads (its snapshot, its refills, the narrowed reads
/// those provoke) decides the rows that asked for them and needs no
/// recall; a gate that opens under a **write** — the write itself, a
/// lookup, or a read a write provoked, however many reads later — may
/// concern rows the page dropped, which are recalled
/// ([`MultiTableIVM::recall`]), except at the landing of the very read
/// that edge asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Cause {
    Page,
    Write,
}

/// One row of a page's view: the image it was last sent with, and
/// whether it is sent at all — under a shown parent row; a row whose
/// parent is not shown waits in the view for the parent.
struct ViewRow {
    row: DataFrameRow,
    shown: bool,
}

/// The rows a lookup returned, sorted into the windows per parent row of
/// the node it was asked for.
type Sorted = Vec<(SubId, Vec<(DataFrameKey, DataFrameRow)>)>;

/// Whether a held row of `part` has a shown parent: the root always, a
/// child under a RIGHT edge always, a child under any other edge only
/// while a shown parent row carries its join value.
fn under_shown_parent(tree: &Tree, part: &QueryPart, row: &DataFrameRow) -> bool {
    let node = &tree.nodes[part];
    let Some(edge) = node.parent.map(|edge| &tree.edges[edge]) else {
        return true;
    };
    if !edge.gates_child() {
        return true;
    }
    let value = join_value(row, &edge.child_column);
    edge.counts
        .shown
        .get(&value)
        .is_some_and(|count| *count > 0)
}

/// Whether `part` is a page under a gate.
fn is_page(tree: &Tree, part: &QueryPart) -> bool {
    tree.nodes[part].page.is_some()
}

/// The inner part of `part` that holds `row`: its one part, or the
/// per-value part of a fanned node for the row's fanning value; `None`
/// while registration has not reached it.
fn part_inner(tree: &Tree, part: &QueryPart, row: &DataFrameRow) -> Option<SubId> {
    let node = &tree.nodes[part];
    match &node.parts {
        Parts::Unregistered => None,
        Parts::One(inner) => Some(*inner),
        Parts::Fan(fan) => {
            let edge = &tree.edges[node.parent?];
            fan.get(&join_value(row, &edge.child_column)).copied()
        }
    }
}

/// Whether the gates of `node` let `row` through: true for a node with
/// none; otherwise the node's own `WHERE` evaluated with every `EXISTS`
/// leaf read as "a held child row carries this row's join value on that
/// edge", and the unnamed gating edges conjoined.
fn gate_open(tree: &Tree, node: &Node, row: &DataFrameRow) -> bool {
    if node.gates.is_empty() {
        return true;
    }
    let exists = |leaf: &Condition| -> bool {
        let Value::Int(index) = leaf.value else {
            return false;
        };
        let Some(edge) = usize::try_from(index).ok().and_then(|index| {
            node.children
                .iter()
                .map(|edge| &tree.edges[*edge])
                .filter(|edge| edge.is_inner)
                .nth(index)
        }) else {
            return false;
        };
        edge.child_count_of(row, &edge.parent_column) > 0
    };
    if !evaluate_with(&node.query.filter, &row.data, &mut 0, &exists) {
        return false;
    }
    node.gates.iter().all(|edge| {
        let edge = &tree.edges[*edge];
        edge.gate.is_some() || edge.child_count_of(row, &edge.parent_column) > 0
    })
}

/// The row's value in `column`; a missing column joins like `NULL` (never).
fn join_value(row: &DataFrameRow, column: &ColumnName) -> Value {
    row.data
        .get(column.as_str())
        .cloned()
        .unwrap_or(Value::Null)
}

/// The leaf restricting a driven part to a shared set's members.
fn leaf_condition(column: &ColumnName, set: &SharedSet) -> Condition {
    Condition::new(
        column.clone(),
        ComparisonOperator::IN,
        Value::Set(set.clone()),
    )
}

/// Build the node, edge and leaf tables of a spec.
fn build_tree(spec: Rc<MultiTableReadQuery>) -> Tree {
    let mut tree = Tree {
        spec: spec.clone(),
        subscribers: Vec::new(),
        audience: OnceCell::new(),
        nodes: IdMap::default(),
        edges: Vec::new(),
        leaves: HashMap::new(),
        rank: IdMap::default(),
        post_order: Vec::new(),
        pages: Vec::new(),
        capped: false,
    };
    add_node(&mut tree, &spec, QueryPart::main(), None);

    let mut loose = vec![false; tree.edges.len()];
    let mut kept = vec![false; tree.edges.len()];
    for index in 0..tree.edges.len() {
        let edge = &tree.edges[index];
        let parent = &tree.nodes[&edge.parent];
        let below = edge.gates_parent() && !tree.nodes[&edge.child].fanned;
        loose[index] = below
            && (parent.page == Some(PageRead::Batched)
                || parent.parent.is_some_and(|above| loose[above]));
        kept[index] = below
            && (parent.page == Some(PageRead::Whole)
                || parent.parent.is_some_and(|above| kept[above]));
    }
    let leaves_of = |flags: &[bool]| -> HashSet<LeafKey> {
        tree.edges
            .iter()
            .zip(flags)
            .filter(|(_, flag)| **flag)
            .map(|(edge, _)| edge.leaf.clone())
            .collect()
    };
    let (loose_leaves, kept_leaves) = (leaves_of(&loose), leaves_of(&kept));
    for edge in &mut tree.edges {
        edge.loose = loose_leaves.contains(&edge.leaf);
        edge.kept = !edge.loose && kept_leaves.contains(&edge.leaf);
    }
    for edge in &tree.edges {
        tree.leaves.entry(edge.leaf.clone()).or_default();
    }
    let mut forward = Vec::new();
    forwarding_order(&tree, &QueryPart::main(), &mut forward);
    tree.rank = forward
        .into_iter()
        .enumerate()
        .map(|(rank, part)| (part, rank))
        .collect();
    let mut post = Vec::new();
    registration_order(&tree, &QueryPart::main(), &mut post);
    tree.pages = post
        .iter()
        .filter(|part| {
            let node = &tree.nodes[*part];
            !node.gates.is_empty() && windowed_limit(node.query.limit)
        })
        .copied()
        .collect();
    tree.post_order = post;
    tree
}

/// Add `spec`'s node at `part` and, recursively, its children, one edge
/// per join in order. An inner edge the node's own filter names through
/// an `EXISTS` leaf (the `i`-th inner edge) is bound in place when the
/// sub drives it and gates the node's rows when the main does.
fn add_node(tree: &mut Tree, spec: &MultiTableReadQuery, part: QueryPart, parent: Option<usize>) {
    let mut node = Node {
        parts: Parts::Unregistered,
        fanned: parent.is_some_and(|edge| {
            tree.edges[edge].driver == Driver::Main && spec.main_table.limit != u32::MAX
        }),
        live: false,
        query: spec.main_table.clone(),
        parent,
        children: Vec::new(),
        gates: Vec::new(),
        page: None,
        risen: HashSet::new(),
    };
    let mut inner_index = 0usize;
    for (index, join) in spec.joins.iter().enumerate() {
        let child = part.child(index);
        let edge = tree.edges.len();
        let named = if join.is_inner {
            let leaf = Condition::new(
                join.main_table_column.clone(),
                ComparisonOperator::EXISTS,
                Value::Int(inner_index as i64),
            );
            inner_index += 1;
            spec.main_table.filter.contains(&leaf).then_some(leaf)
        } else {
            None
        };
        let (bound, gate) = match join.driver {
            Driver::Sub => (named, None),
            Driver::Main => (None, named),
        };
        let leaf = match (&bound, join.driver) {
            (Some(_), _) => LeafKey::Own(edge),
            (None, Driver::Main) if fanned_child(join) => LeafKey::Own(edge),
            (None, Driver::Main) => LeafKey::Shared(child, join.sub_table_column.clone()),
            (None, Driver::Sub) => LeafKey::Shared(part, join.main_table_column.clone()),
        };
        tree.edges.push(Edge {
            driver: join.driver,
            is_inner: join.is_inner,
            parent: part,
            child,
            parent_column: join.main_table_column.clone(),
            child_column: join.sub_table_column.clone(),
            leaf,
            bound,
            gate,
            loose: false,
            kept: false,
            counts: JoinKeyCounts::default(),
            dropped: HashSet::new(),
        });
        node.children.push(edge);
        if join.driver == Driver::Main && join.is_inner {
            node.gates.push(edge);
        }
        add_node(tree, &join.sub, child, Some(edge));
    }
    if !node.gates.is_empty() && windowed_limit(node.query.limit) {
        node.page = Some(spec.page);
    }
    tree.nodes.insert(part, node);
}

/// Whether `limit` is a page: finite and positive.
fn windowed_limit(limit: u32) -> bool {
    limit > 0 && limit < u32::MAX
}

/// Whether `join`'s sub node is a driven window: the main drives it and
/// it has a finite limit.
fn fanned_child(join: &Join) -> bool {
    join.driver == Driver::Main && join.sub.main_table.limit != u32::MAX
}

/// Append the subtree at `part` in forwarding order: the subtrees this
/// node drives first, the node, then the subtrees that drive it.
fn forwarding_order(tree: &Tree, part: &QueryPart, out: &mut Vec<QueryPart>) {
    let node = &tree.nodes[part];
    for &edge in &node.children {
        if tree.edges[edge].driver == Driver::Main {
            forwarding_order(tree, &tree.edges[edge].child, out);
        }
    }
    out.push(*part);
    for &edge in &node.children {
        if tree.edges[edge].driver == Driver::Sub {
            forwarding_order(tree, &tree.edges[edge].child, out);
        }
    }
}

/// Append the subtree at `part` in registration order: the subtrees that
/// drive this node (which fill its sets) first, the node, then the
/// subtrees it drives.
fn registration_order(tree: &Tree, part: &QueryPart, out: &mut Vec<QueryPart>) {
    let node = &tree.nodes[part];
    for &edge in &node.children {
        if tree.edges[edge].driver == Driver::Sub {
            registration_order(tree, &tree.edges[edge].child, out);
        }
    }
    out.push(*part);
    for &edge in &node.children {
        if tree.edges[edge].driver == Driver::Main {
            registration_order(tree, &tree.edges[edge].child, out);
        }
    }
}

/// Whether every edge reading `edge`'s set currently references `value`:
/// the membership test of a shared leaf's intersection, trivially true for
/// a set of the edge's own.
fn referenced_by_all(tree: &Tree, edge: usize, value: &Value) -> bool {
    match &tree.edges[edge].leaf {
        LeafKey::Own(_) => true,
        key => tree
            .edges
            .iter()
            .filter(|other| other.leaf == *key)
            .all(|other| other.counts.left.contains_key(value)),
    }
}

/// What `part` does on each edge it touches: `(edge, drives, column)`
/// where `drives` says whether the part is the edge's driver and `column`
/// is the part's own join column on that edge.
fn edge_steps(tree: &Tree, part: &QueryPart) -> Vec<(usize, bool, ColumnName)> {
    let node = &tree.nodes[part];
    node.children
        .iter()
        .chain(node.parent.iter())
        .map(|&edge| {
            let e = &tree.edges[edge];
            (edge, e.driven() != part, e.column_of(part).clone())
        })
        .collect()
}

/// Whether `part` has everything that decides which of its rows count
/// above it: its own rows have arrived and so have those of every node
/// gating it, all the way down. A part that drives its parent is waited
/// for until then, so the parent registers once with the whole set
/// instead of fetching it value by value as the gates open.
fn settled(tree: &Tree, part: &QueryPart) -> bool {
    let node = &tree.nodes[part];
    node.live
        && node
            .gates
            .iter()
            .all(|edge| settled(tree, &tree.edges[*edge].child))
}

/// The node still waiting to register that `part` going live may
/// release: walking up through the edges `part`'s subtree gates, the
/// first unregistered parent a settled node drives.
fn waiting_above(tree: &Tree, part: &QueryPart) -> Option<QueryPart> {
    let mut current = *part;
    loop {
        let edge = &tree.edges[tree.nodes[&current].parent?];
        if edge.driver == Driver::Sub {
            return (!tree.nodes[&edge.parent].is_registered() && settled(tree, &current))
                .then_some(edge.parent);
        }
        if !edge.is_inner {
            return None;
        }
        current = edge.parent;
    }
}

/// The edges `part` drives below it, with its own join column on each.
fn downward_edges(tree: &Tree, part: &QueryPart) -> Vec<(usize, ColumnName)> {
    tree.nodes[part]
        .children
        .iter()
        .map(|&edge| (edge, &tree.edges[edge]))
        .filter(|(_, edge)| edge.driver == Driver::Main)
        .map(|(index, edge)| (index, edge.parent_column.clone()))
        .collect()
}

/// Whether the rows of `part` act on the edge above it at all.
fn acts_above(tree: &Tree, part: &QueryPart) -> bool {
    tree.nodes[part].parent.is_some_and(|index| {
        let edge = &tree.edges[index];
        edge.driver == Driver::Sub || edge.gates_parent()
    })
}

/// The edge above `part` when the part's rows act on it, with the part's
/// join column and whether the part drives the edge (a sub-driven edge,
/// whose set its values fill) or gates the parent (an inner edge the main
/// drives, whose `matched` count they feed). A LEFT edge the main drives
/// is acted on from above only.
fn upward_edge(tree: &Tree, part: &QueryPart) -> Option<(usize, ColumnName, bool)> {
    let index = tree.nodes[part].parent?;
    let edge = &tree.edges[index];
    if edge.driver == Driver::Sub {
        Some((index, edge.child_column.clone(), true))
    } else if edge.gates_parent() {
        Some((index, edge.child_column.clone(), false))
    } else {
        None
    }
}

/// The columns `part` joins on, each once: what the single engine indexes
/// by value for the part's table.
fn join_columns(tree: &Tree, part: &QueryPart) -> Vec<ColumnName> {
    let mut columns: Vec<ColumnName> = Vec::new();
    for (_, _, column) in edge_steps(tree, part) {
        if !columns.contains(&column) {
            columns.push(column);
        }
    }
    columns
}

/// `filter` with every `EXISTS` leaf that names nothing this node can
/// honor (a leaf naming a non-inner edge, or no edge) made false.
fn unbound_exists_false(filter: Where) -> Where {
    leaves_false(filter, &|condition| {
        condition.comparison_operator == ComparisonOperator::EXISTS
    })
}

/// `filter` with every leaf `is_false` accepts made false.
fn leaves_false(filter: Where, is_false: &dyn Fn(&Condition) -> bool) -> Where {
    match filter {
        Where::Condition(condition) if is_false(&condition) => Where::OR(Vec::new()),
        Where::Condition(condition) => Where::Condition(condition),
        Where::AND(children) => Where::AND(
            children
                .into_iter()
                .map(|child| leaves_false(child, is_false))
                .collect(),
        ),
        Where::OR(children) => Where::OR(
            children
                .into_iter()
                .map(|child| leaves_false(child, is_false))
                .collect(),
        ),
    }
}

/// Bring together, within one part of one tree, a row's `Delete` and the
/// `Add` that follows it from another inner part (a row moving between
/// the per-value parts of a fanned node): the `Add` is moved right behind
/// the `Delete`, so the two are handled as one replacement.
fn pair_moves(tagged: &mut Vec<(TreeId, usize, QueryPart, SingleTableUpdate)>) {
    let mut index = 0;
    while index < tagged.len() {
        let (tree_id, _, part, update) = &tagged[index];
        if let DataFrameOperation::Delete(key, _) = &update.op {
            let partner =
                tagged[index + 1..]
                    .iter()
                    .position(|(other_tree, _, other_part, other)| {
                        other_tree == tree_id && other_part == part && other.op.key() == key
                    });
            if let Some(offset) = partner
                && offset > 0
                && matches!(
                    tagged[index + 1 + offset].3.op,
                    DataFrameOperation::Add(_, _)
                )
            {
                let add = tagged.remove(index + 1 + offset);
                tagged.insert(index + 1, add);
            }
        }
        index += 1;
    }
}

impl Default for MultiTableIVM {
    /// [`MultiTableIVM::new`].
    fn default() -> Self {
        Self::new()
    }
}

impl MultiTableIVM {
    /// An empty join layer.
    pub fn new() -> Self {
        MultiTableIVM {
            single: SingleTableIVM::new(),
            trees: IdMap::default(),
            by_spec: HashMap::new(),
            next_tree: 0,
            by_sub: IdMap::default(),
            next_sub: 0,
            parts: IdMap::default(),
            dirty: Vec::new(),
            queued: IdSet::default(),
            views: IdMap::default(),
            synced: IdMap::default(),
            in_flight: HashSet::new(),
            wanted: Vec::new(),
            capped: Vec::new(),
            cause: Cause::Page,
            landing: None,
            write_reads: HashSet::new(),
        }
    }

    /// Whether a gate opening on `edge` needs the driver recalled: only
    /// under a write ([`Cause::Write`]), and not at the landing of the
    /// read the edge's driven part asked for.
    fn recalls(&self, tree_id: TreeId, edge: usize) -> bool {
        if self.cause != Cause::Write {
            return false;
        }
        let Some(landing) = self.landing else {
            return true;
        };
        let tree = &self.trees[&tree_id];
        !tree.nodes[&tree.edges[edge].child]
            .inner_parts()
            .contains(&landing)
    }

    /// The layer with `limit` as the most rows one batch of a page reads
    /// ([`SingleTableIVM::with_row_limit`]).
    pub fn with_row_limit(mut self, limit: usize) -> Self {
        self.single = self.single.with_row_limit(limit);
        self
    }

    /// Whether a held row of `part` is shown to clients: under a shown
    /// parent row ([`under_shown_parent`]) and, for a node that gates its
    /// own rows, with its gate open; for a page under a gate, among the
    /// rows of the page's view (its first `L` admitted rows, as last
    /// synced).
    fn shown_in(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        row: &DataFrameRow,
    ) -> bool {
        let tree = &self.trees[&tree_id];
        if !under_shown_parent(tree, part, row) {
            return false;
        }
        self.visible(tree_id, part, key, row)
    }

    /// Whether a held row of `part` would be shown under a shown parent:
    /// its gate open; for a page, whether the row is sent (in the page's
    /// view and under a shown parent — the view keeps that fact).
    fn visible(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        row: &DataFrameRow,
    ) -> bool {
        let tree = &self.trees[&tree_id];
        let node = &tree.nodes[part];
        if node.page.is_some() {
            return part_inner(tree, part, row)
                .and_then(|inner| self.views.get(&inner))
                .and_then(|view| view.get(key))
                .is_some_and(|entry| entry.shown);
        }
        gate_open(tree, node, row)
    }

    /// The rows of the page `part`'s views whose `column` is `value` and
    /// that are sent or not as `shown` says, with the part holding each:
    /// the page rows a parent row's showing or hiding concerns.
    fn view_rows(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        column: &ColumnName,
        value: &Value,
        shown: bool,
    ) -> Vec<(SubId, DataFrameKey, DataFrameRow)> {
        let tree = &self.trees[&tree_id];
        let node = &tree.nodes[part];
        let inners: Vec<SubId> = match &node.parts {
            Parts::Unregistered => Vec::new(),
            Parts::One(inner) => vec![*inner],
            Parts::Fan(fan) => {
                let fanning = node
                    .parent
                    .map(|edge| &tree.edges[edge].child_column)
                    .is_some_and(|fanning| fanning == column);
                if fanning {
                    fan.get(value).copied().into_iter().collect()
                } else {
                    fan.values().copied().collect()
                }
            }
        };
        let mut rows = Vec::new();
        for inner in inners {
            let Some(view) = self.views.get(&inner) else {
                continue;
            };
            for (key, entry) in view {
                if entry.shown == shown && join_value(&entry.row, column) == *value {
                    rows.push((inner, key.clone(), entry.row.clone()));
                }
            }
        }
        rows
    }

    /// Record that the page row `key` of `inner` is sent or not.
    fn mark_sent(&mut self, inner: SubId, key: &DataFrameKey, shown: bool) {
        if let Some(entry) = self
            .views
            .get_mut(&inner)
            .and_then(|view| view.get_mut(key))
        {
            entry.shown = shown;
        }
    }

    /// Register a multi-table subscription, returning its engine id and
    /// whatever of its initial snapshot is available at once, as
    /// operations. Ids are handed out by the join layer and never reused;
    /// the layer above maps a client's own ids to them. A spec already
    /// registered by another subscription is shared: the new subscriber
    /// joins that tree and is served the shared parts' current rows,
    /// touching no storage (rows still on their way reach it as they land,
    /// like every other subscriber's). A new spec registers its parts in
    /// post-order as their reads land (see the module docs), so its
    /// snapshot arrives through [`MultiTableIVM::land_fetch`].
    pub fn register_query(&mut self, query: MultiTableReadQuery) -> (SubId, Vec<MultiTableUpdate>) {
        let sub = SubId(self.next_sub);
        self.next_sub += 1;
        let mut out = Vec::new();
        if let Some(&tree_id) = self.by_spec.get(&query) {
            self.by_sub.insert(sub, tree_id);
            let served: Vec<(QueryPart, TableName, Vec<SubId>)> = {
                let tree = self.trees.get_mut(&tree_id).expect("indexed by spec");
                tree.subscribers.push(sub);
                tree.audience = OnceCell::new();
                tree.post_order
                    .iter()
                    .map(|part| {
                        let node = &tree.nodes[part];
                        (*part, node.query.table.clone(), node.inner_parts())
                    })
                    .collect()
            };
            for (part, table, inners) in &served {
                for inner in inners {
                    let Some(rows) = self.single.rows_for(*inner) else {
                        continue;
                    };
                    for (key, row) in rows {
                        if !self.shown_in(tree_id, part, &key, &row) {
                            continue;
                        }
                        out.push(MultiTableUpdate {
                            subs: Subs::One(sub),
                            table: table.clone(),
                            part: *part,
                            op: DataFrameOperation::Add(key, row),
                        });
                    }
                }
            }
            self.single.note_shared_snapshots(served.len() as u64);
            return (sub, out);
        }
        let tree_id = TreeId(self.next_tree);
        self.next_tree += 1;
        let spec = Rc::new(query);
        let mut tree = build_tree(spec.clone());
        tree.subscribers.push(sub);
        self.trees.insert(tree_id, tree);
        self.by_spec.insert(spec, tree_id);
        self.by_sub.insert(sub, tree_id);
        self.cause = Cause::Page;
        self.landing = None;
        self.register_part(tree_id, QueryPart::main(), &mut out);
        self.mark_dirty(tree_id);
        self.fetch_wanted();
        self.settle_pages(&mut out);
        (sub, out)
    }

    /// Register the subtree at `part` in post-order. Children that drive
    /// the node and are not yet live are registered first and the node
    /// waits for them: the last of them to go live comes back here through
    /// [`Self::landed`]. With every such child live the node registers
    /// itself with its full set restrictions — as a page when it is one
    /// under a gate, and reading nothing when a loose edge drives it (its
    /// rows are then fetched for the values already referenced); if its
    /// rows are all at hand (a twin's) it is live at once, otherwise it
    /// goes live when its read lands. The children it drives follow from
    /// [`Self::landed`].
    fn register_part(&mut self, tree_id: TreeId, part: QueryPart, out: &mut Vec<MultiTableUpdate>) {
        let (waiting, own, fanned, page, columns, loose) = {
            let tree = &self.trees[&tree_id];
            let node = &tree.nodes[&part];
            if node.is_registered() {
                return;
            }
            let waiting: Vec<QueryPart> = node
                .children
                .iter()
                .map(|&edge| &tree.edges[edge])
                .filter(|edge| edge.driver == Driver::Sub && !settled(tree, &edge.child))
                .map(|edge| edge.child)
                .collect();
            let loose: Vec<(ColumnName, Vec<Value>)> = tree
                .edges
                .iter()
                .filter(|edge| edge.loose && *edge.driven() == part)
                .map(|edge| {
                    (
                        edge.driven_column().clone(),
                        edge.counts.left.keys().cloned().collect(),
                    )
                })
                .collect();
            (
                waiting,
                node.query.clone(),
                node.fanned,
                node.page,
                join_columns(tree, &part),
                loose,
            )
        };
        if !waiting.is_empty() {
            for child in waiting {
                self.register_part(tree_id, child, out);
            }
            return;
        }
        for column in &columns {
            self.single.index_column(&own.table, column);
        }
        if fanned {
            let values = {
                let tree = &self.trees[&tree_id];
                let edge = tree.nodes[&part]
                    .parent
                    .expect("a fanned node has a parent");
                tree.leaves[&tree.edges[edge].leaf].members()
            };
            if let Some(node) = self
                .trees
                .get_mut(&tree_id)
                .and_then(|tree| tree.nodes.get_mut(&part))
            {
                node.parts = Parts::Fan(HashMap::new());
            }
            for value in values {
                self.register_value(tree_id, &part, value, out);
            }
        } else {
            let query = SingleTableReadQuery {
                filter: self.restricted_filter(tree_id, &part, None),
                ..own.clone()
            };
            let (inner, ops) = if !loose.is_empty() {
                (self.single.register_driven(query), Vec::new())
            } else {
                self.register_inner(query, page)
            };
            if let Some(node) = self
                .trees
                .get_mut(&tree_id)
                .and_then(|tree| tree.nodes.get_mut(&part))
            {
                node.parts = Parts::One(inner);
            }
            self.parts.insert(inner, (tree_id, part));
            for (column, values) in loose {
                if !values.is_empty() {
                    self.wanted.push((inner, column, values));
                }
            }
            for op in ops {
                self.emit(tree_id, &part, &own.table, op.clone(), out);
                if let DataFrameOperation::Add(key, row) = &op {
                    self.arrived(tree_id, &part, key, row, out);
                }
            }
        }
        if !self.part_pending(tree_id, &part) {
            self.landed(tree_id, &part, out);
        }
    }

    /// Register one inner part with the single engine: as a page read as
    /// `page` says when the node is a page under a gate, as an ordinary
    /// subscription otherwise.
    fn register_inner(
        &mut self,
        query: SingleTableReadQuery,
        page: Option<PageRead>,
    ) -> (SubId, Vec<DataFrameOperation>) {
        match page {
            Some(read) => {
                let spec = PageSpec::new(read == PageRead::Whole, query.limit);
                self.single.register_page(query, spec)
            }
            None => self.single.register_query(query),
        }
    }

    /// Register the per-value part of a fanned node for `value`: the
    /// node's own filter narrowed to `column = value`, with the node's
    /// window (a page, when the node is one under a gate), read like any
    /// registration; rows a twin holds arrive at once.
    fn register_value(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        value: Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let (query, table, page) = {
            let tree = &self.trees[&tree_id];
            let node = &tree.nodes[part];
            let edge = node.parent.expect("a fanned node has a parent");
            let column = tree.edges[edge].child_column.clone();
            let narrowed = Where::AND(vec![
                self.restricted_filter(tree_id, part, Some(edge)),
                Where::condition(column, ComparisonOperator::EQ, value.clone()),
            ]);
            (
                SingleTableReadQuery {
                    filter: narrowed,
                    ..node.query.clone()
                },
                node.query.table.clone(),
                node.page,
            )
        };
        let (inner, ops) = self.register_inner(query, page);
        if let Some(Parts::Fan(fan)) = self
            .trees
            .get_mut(&tree_id)
            .and_then(|tree| tree.nodes.get_mut(part))
            .map(|node| &mut node.parts)
        {
            fan.insert(value, inner);
        }
        self.parts.insert(inner, (tree_id, *part));
        for op in ops {
            self.emit(tree_id, part, &table, op.clone(), out);
            if let DataFrameOperation::Add(key, row) = &op {
                self.arrived(tree_id, part, key, row, out);
            }
        }
    }

    /// Unregister the per-value part of a fanned node for `value`,
    /// letting its held rows depart first (their `Delete`s went out when
    /// the value's last shown parent row left; a page's view is emptied
    /// here). If the part's read was the last one the node was waiting
    /// for, the node goes live here: the read will land into nothing, and
    /// the registration walk below the node would otherwise never
    /// continue.
    fn unregister_value(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        value: &Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let Some(inner) = self
            .trees
            .get_mut(&tree_id)
            .and_then(|tree| tree.nodes.get_mut(part))
            .and_then(|node| match &mut node.parts {
                Parts::Fan(fan) => fan.remove(value),
                _ => None,
            })
        else {
            return;
        };
        let view = self.views.remove(&inner).unwrap_or_default();
        self.synced.remove(&inner);
        let table = self.trees[&tree_id].nodes[part].query.table.clone();
        for (key, entry) in view {
            if entry.shown {
                self.emit_raw(
                    tree_id,
                    part,
                    &table,
                    DataFrameOperation::Delete(key, entry.row.clone()),
                    out,
                );
                self.vanish(tree_id, part, &entry.row, out);
            }
        }
        let rows = self.single.rows_for(inner).unwrap_or_default();
        self.single.unregister_query(inner);
        self.parts.remove(&inner);
        for (key, row) in rows {
            self.departed(tree_id, part, &key, &row, out);
        }
        let waiting = self
            .trees
            .get(&tree_id)
            .and_then(|tree| tree.nodes.get(part))
            .is_some_and(|node| !node.live);
        if waiting && !self.part_pending(tree_id, part) {
            self.landed(tree_id, part, out);
        }
    }

    /// Whether any inner part of `part` still has a read out.
    fn part_pending(&self, tree_id: TreeId, part: &QueryPart) -> bool {
        self.trees
            .get(&tree_id)
            .and_then(|tree| tree.nodes.get(part))
            .is_some_and(|node| {
                node.inner_parts()
                    .into_iter()
                    .any(|inner| self.single.is_pending(inner))
            })
    }

    /// `part`'s rows have all arrived: mark it live, register the
    /// children it drives (their sets are now filled by its rows), and, if
    /// it drives its parent and the parent is still waiting, let the parent
    /// try to register.
    fn landed(&mut self, tree_id: TreeId, part: &QueryPart, out: &mut Vec<MultiTableUpdate>) {
        let (driven_children, waiting_parent) = {
            let Some(tree) = self.trees.get_mut(&tree_id) else {
                return;
            };
            let Some(node) = tree.nodes.get_mut(part) else {
                return;
            };
            if node.live {
                return;
            }
            node.live = true;
            let node = &tree.nodes[part];
            let driven_children: Vec<QueryPart> = node
                .children
                .iter()
                .map(|&edge| &tree.edges[edge])
                .filter(|edge| edge.driver == Driver::Main)
                .map(|edge| edge.child)
                .collect();
            let waiting_parent = waiting_above(tree, part);
            (driven_children, waiting_parent)
        };
        for child in driven_children {
            self.register_part(tree_id, child, out);
        }
        if let Some(parent) = waiting_parent {
            self.register_part(tree_id, parent, out);
        }
    }

    /// Land the rows a part's storage read returned (brought up to the
    /// engine's position by the runtime): merge them through the inner
    /// engine, forward the resulting operations like a write's, letting
    /// arrivals cascade down the tree (each may reference further join
    /// values and ask for further reads), and, for each part the read
    /// served that is not yet live and has no read left out, continue the
    /// registration walk from it. A read for parts that are gone lands as
    /// nothing.
    pub fn land_fetch(
        &mut self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
    ) -> Vec<MultiTableUpdate> {
        let worst = super::frames::worst_of_full(fetch, rows);
        self.land_read(fetch, rows, worst.as_ref())
    }

    /// [`MultiTableIVM::land_fetch`] with the read's own coverage (see
    /// [`SingleTableIVM::land_read`]).
    pub fn land_read(
        &mut self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
        worst_read: Option<&DataFrameRow>,
    ) -> Vec<MultiTableUpdate> {
        let readers = self.single.readers_of(fetch);
        let applied = match self.fanned_lookup(fetch, rows) {
            Some(sorted) => {
                let mut applied = self.single.land_read(fetch, &[], None);
                for (inner, rows) in sorted {
                    applied.extend(self.single.land_lookup(inner, &rows));
                }
                applied
            }
            None => self.single.land_read(fetch, rows, worst_read),
        };
        // A row read stands in for the write whose image was partial: its
        // row arrives as that write's would have, recalls included.
        self.cause = match fetch.kind {
            FetchKind::Lookup | FetchKind::Row => Cause::Write,
            FetchKind::Narrowed if self.write_reads.remove(&fetch.id) => Cause::Write,
            _ => Cause::Page,
        };
        self.landing = (fetch.kind != FetchKind::Row).then_some(fetch.sub);
        let mut out = self.forward(applied);
        self.landing = None;
        if fetch.kind == FetchKind::Lookup {
            self.recall_above(fetch.sub, rows, &mut out);
        }
        for sub in &readers {
            if let Some((tree_id, _)) = self.parts.get(sub).cloned() {
                self.mark_dirty(tree_id);
            }
        }
        for sub in readers {
            let Some((tree_id, part)) = self.parts.get(&sub).cloned() else {
                continue;
            };
            let live = self
                .trees
                .get(&tree_id)
                .and_then(|tree| tree.nodes.get(&part))
                .is_some_and(|node| node.live);
            if !live && !self.part_pending(tree_id, &part) {
                self.landed(tree_id, &part, &mut out);
            }
        }
        self.fetch_wanted();
        self.settle_pages(&mut out);
        out
    }

    /// The rows of a lookup across a node's windows per parent row
    /// ([`Self::lookup`]), sorted into those windows by the row's fanning
    /// value (rows of a value no window is registered for are left out);
    /// `None` for any other read.
    fn fanned_lookup(
        &self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
    ) -> Option<Sorted> {
        if fetch.kind != FetchKind::Lookup {
            return None;
        }
        let (tree_id, part) = self.parts.get(&fetch.sub)?;
        let tree = self.trees.get(tree_id)?;
        let node = &tree.nodes[part];
        let Parts::Fan(fan) = &node.parts else {
            return None;
        };
        let fanning = &tree.edges[node.parent?].child_column;
        let mut sorted: Sorted = Vec::new();
        for (key, row) in rows {
            let Some(&inner) = fan.get(&join_value(row, fanning)) else {
                continue;
            };
            match sorted.iter_mut().find(|(sub, _)| *sub == inner) {
                Some((_, rows)) => rows.push((key.clone(), row.clone())),
                None => sorted.push((inner, vec![(key.clone(), row.clone())])),
            }
        }
        Some(sorted)
    }

    /// How the driven part of `edge` is restricted, as `(loose, kept)`:
    /// loose, not at all; kept, by an `IN` whose values are never unfiled;
    /// neither, by the ordinary `IN` of the referenced values (see
    /// [`Edge`]).
    fn restriction_of(&self, tree_id: TreeId, edge: usize) -> (bool, bool) {
        let e = &self.trees[&tree_id].edges[edge];
        (e.loose, e.kept)
    }

    /// The trees with a part reading `fetch`, each once.
    fn trees_reading(&self, fetch: &Fetch) -> Vec<TreeId> {
        let mut trees: Vec<TreeId> = Vec::new();
        for inner in self.single.readers_of(fetch) {
            if let Some((tree_id, _)) = self.parts.get(&inner)
                && !trees.contains(tree_id)
            {
                trees.push(*tree_id);
            }
        }
        trees
    }

    /// Take the storage reads the inner parts asked for since the last
    /// call.
    pub fn take_requests(&mut self) -> Vec<Fetch> {
        self.single.take_requests()
    }

    /// A part's registered filter: its own `WHERE` with every gate leaf
    /// taken as true (its truth is a matter of visibility, decided per
    /// row), every bound leaf replaced in place by its edge's set — or
    /// taken as true for a loose edge, whose restriction the part does
    /// not carry — one set-valued `IN` leaf conjoined per set the unnamed
    /// edges driving it read (none for a loose edge), and any `EXISTS`
    /// leaf left standing made false; `skip` leaves one edge out (a
    /// fanned node's own, whose restriction is the per-value equality
    /// instead).
    fn restricted_filter(&self, tree_id: TreeId, part: &QueryPart, skip: Option<usize>) -> Where {
        self.filter_of(tree_id, part, skip, None)
    }

    /// A part's registered filter with the restriction of `edge` — one
    /// the part carries loosely or not at all — read as false: what a row
    /// of the part must still satisfy to stay held once the edge stops
    /// admitting its join value.
    fn filter_without(&self, tree_id: TreeId, part: &QueryPart, edge: usize) -> Where {
        self.filter_of(tree_id, part, None, Some(edge))
    }

    /// [`Self::restricted_filter`] with, optionally, one edge's
    /// restriction read as false (`without`).
    fn filter_of(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        skip: Option<usize>,
        without: Option<usize>,
    ) -> Where {
        let tree = &self.trees[&tree_id];
        let node = &tree.nodes[part];
        let mut filter = node.query.filter.clone();
        let mut true_leaves: Vec<&Condition> = node
            .gates
            .iter()
            .filter_map(|edge| tree.edges[*edge].gate.as_ref())
            .collect();
        let mut false_leaves: Vec<&Condition> = Vec::new();
        let mut conjoined: Vec<LeafKey> = Vec::new();
        let mut parts = Vec::new();
        for (index, edge) in tree
            .edges
            .iter()
            .enumerate()
            .filter(|(index, edge)| edge.driven() == part && Some(*index) != skip)
        {
            let absent = Some(index) == without;
            match (&edge.bound, edge.loose || absent) {
                (Some(leaf), true) if absent => false_leaves.push(leaf),
                (Some(leaf), true) => true_leaves.push(leaf),
                (Some(unbound), false) => {
                    let bound = leaf_condition(edge.driven_column(), &tree.leaves[&edge.leaf]);
                    filter.replace_condition(unbound, &bound);
                }
                (None, true) if absent => parts.push(Where::OR(Vec::new())),
                (None, true) => {}
                (None, false) if conjoined.contains(&edge.leaf) => {}
                (None, false) => {
                    conjoined.push(edge.leaf.clone());
                    parts.push(Where::Condition(leaf_condition(
                        edge.driven_column(),
                        &tree.leaves[&edge.leaf],
                    )));
                }
            }
        }
        if !true_leaves.is_empty() {
            filter = filter.assuming_true(&|leaf| true_leaves.contains(&leaf));
        }
        if !false_leaves.is_empty() {
            filter = leaves_false(filter, &|leaf| false_leaves.contains(&leaf));
        }
        parts.insert(0, unbound_exists_false(filter));
        Where::AND(parts)
    }

    /// Remove a subscription. Its tree lives on while other subscriptions
    /// share it; with the last one gone, every inner part and the join
    /// state go too. Unknown ids are a no-op.
    pub fn unregister_query(&mut self, sub: SubId) {
        let Some(tree_id) = self.by_sub.remove(&sub) else {
            return;
        };
        let Some(tree) = self.trees.get_mut(&tree_id) else {
            return;
        };
        tree.subscribers.retain(|subscriber| *subscriber != sub);
        tree.audience = OnceCell::new();
        if !tree.subscribers.is_empty() {
            return;
        }
        let Some(tree) = self.trees.remove(&tree_id) else {
            return;
        };
        self.by_spec.remove(&tree.spec);
        for node in tree.nodes.values() {
            for inner in node.inner_parts() {
                self.single.unregister_query(inner);
                self.parts.remove(&inner);
                self.views.remove(&inner);
                self.synced.remove(&inner);
            }
        }
    }

    /// Route one write through the inner engine and forward the resulting
    /// per-part operations to every subscriber of their tree, maintaining
    /// the join state on the way (see the module docs for the order and
    /// the replace-pair diffing).
    pub fn incremental_update(&mut self, write: &WriteQuery) -> Vec<MultiTableUpdate> {
        let applied = self.single.incremental_update(write);
        self.cause = Cause::Write;
        self.landing = None;
        let mut out = self.forward(applied);
        self.fetch_wanted();
        self.settle_pages(&mut out);
        out
    }

    /// Forward the inner engine's operations to the subscribers of their
    /// trees, every driven part before its driver, diffing replace pairs
    /// and cascading arrivals and departures. The inner engine has applied
    /// the whole step before the first of its operations is handled here,
    /// so until a row's `Add` is reached the row is *in flight*: held
    /// below, not yet arrived here, and left out of what the counts'
    /// crossings re-evaluate ([`Self::rows_of_value`]). A row moving
    /// between two per-value parts of one node (its `Delete` from one, its
    /// `Add` into the other) is one replacement, like a row rewritten in
    /// place.
    fn forward(&mut self, applied: Vec<SingleTableUpdate>) -> Vec<MultiTableUpdate> {
        let mut tagged: Vec<(TreeId, usize, QueryPart, SingleTableUpdate)> = Vec::new();
        for update in applied {
            let Some((tree_id, part)) = self.parts.get(&update.query).cloned() else {
                continue;
            };
            let Some(rank) = self
                .trees
                .get(&tree_id)
                .and_then(|tree| tree.rank.get(&part).copied())
            else {
                continue;
            };
            tagged.push((tree_id, rank, part, update));
        }
        tagged.sort_by_key(|(tree_id, rank, _, _)| (*tree_id, *rank));
        pair_moves(&mut tagged);
        let arriving: Vec<(SubId, DataFrameKey)> = tagged
            .iter()
            .filter(|(tree_id, _, _, update)| {
                matches!(update.op, DataFrameOperation::Add(_, _))
                    && self
                        .trees
                        .get(tree_id)
                        .is_some_and(|tree| tree.edges.iter().any(|edge| edge.is_inner))
            })
            .map(|(_, _, _, update)| (update.query, update.op.key().clone()))
            .collect();
        self.in_flight.extend(arriving);

        let mut out = Vec::new();
        let mut updates = tagged.into_iter().peekable();
        while let Some((tree_id, _, part, update)) = updates.next() {
            let paired_add = match (&update.op, updates.peek()) {
                (DataFrameOperation::Delete(key, _), Some((next_tree, _, next_part, next)))
                    if *next_tree == tree_id
                        && *next_part == part
                        && matches!(&next.op, DataFrameOperation::Add(next_key, _) if next_key == key) =>
                {
                    let (_, _, _, next) = updates.next().expect("peeked just above");
                    self.landed_in_flight(next.query, next.op.key());
                    Some(next.op)
                }
                _ => None,
            };
            if let DataFrameOperation::Add(key, _) = &update.op {
                self.landed_in_flight(update.query, key);
            }
            let table = update.table.clone();
            match (update.op, paired_add) {
                (DataFrameOperation::Delete(key, old), Some(add)) => {
                    let new = add.row().clone();
                    self.emit(
                        tree_id,
                        &part,
                        &table,
                        DataFrameOperation::Delete(key.clone(), old.clone()),
                        &mut out,
                    );
                    self.emit(tree_id, &part, &table, add, &mut out);
                    self.replaced(tree_id, &part, &key, &old, &new, &mut out);
                }
                (op @ DataFrameOperation::Add(_, _), _) => {
                    let (key, row) = (op.key().clone(), op.row().clone());
                    self.emit(tree_id, &part, &table, op, &mut out);
                    self.arrived(tree_id, &part, &key, &row, &mut out);
                }
                (op @ DataFrameOperation::Delete(_, _), None) => {
                    let (key, row) = (op.key().clone(), op.row().clone());
                    self.emit(tree_id, &part, &table, op, &mut out);
                    self.departed(tree_id, &part, &key, &row, &mut out);
                }
            }
        }
        out
    }

    /// The rows currently shown for one part of a subscription — key →
    /// image, the client's view of the part; an inspection seam for tests
    /// and debugging. `None` for unknown ids or parts.
    pub fn rows_for(
        &self,
        sub: SubId,
        part: QueryPart,
    ) -> Option<HashMap<DataFrameKey, DataFrameRow>> {
        let tree_id = *self.by_sub.get(&sub)?;
        let tree = self.trees.get(&tree_id)?;
        let node = tree.nodes.get(&part)?;
        if !node.is_registered() {
            return None;
        }
        let mut shown = HashMap::new();
        for inner in node.inner_parts() {
            for (key, row) in self.single.rows_for(inner).unwrap_or_default() {
                if self.shown_in(tree_id, &part, &key, &row) {
                    shown.insert(key, row);
                }
            }
        }
        Some(shown)
    }

    /// The inner engine's routing counters.
    pub fn stats(&self) -> &IvmStats {
        self.single.stats()
    }

    /// A subscription's tree in words, one line per part: what is behind
    /// it (its inner parts, the rows each shows, whether a read is out)
    /// and the counts on the edge above it. A test and debugging seam.
    pub fn describe(&self, sub: SubId) -> Vec<String> {
        let Some(tree) = self.by_sub.get(&sub).and_then(|id| self.trees.get(id)) else {
            return Vec::new();
        };
        tree.post_order
            .iter()
            .map(|part| {
                let node = &tree.nodes[part];
                let parts: Vec<String> = match &node.parts {
                    Parts::Unregistered => vec!["unregistered".to_owned()],
                    Parts::One(inner) => vec![self.describe_inner(*inner, None)],
                    Parts::Fan(fan) => fan
                        .iter()
                        .map(|(value, inner)| self.describe_inner(*inner, Some(value)))
                        .collect(),
                };
                let above = node.parent.map(|edge| {
                    let counts = &tree.edges[edge].counts;
                    format!(
                        " left {:?} matched {:?} shown {:?}",
                        counts.left, counts.matched, counts.shown
                    )
                });
                format!(
                    "{part:?} {} live={} [{}]{}",
                    node.query.table,
                    node.live,
                    parts.join("; "),
                    above.unwrap_or_default()
                )
            })
            .collect()
    }

    /// One inner part in words, for [`Self::describe`].
    fn describe_inner(&self, inner: SubId, value: Option<&Value>) -> String {
        let rows = self.single.rows_for(inner).map_or(0, |rows| rows.len());
        let page = self
            .single
            .page_state(inner)
            .map(|(page, state)| {
                format!(
                    ", page {} candidates {} admitted {} rejected, round {} batch {}{}, {state}",
                    page.candidates.len(),
                    page.admitted.len(),
                    page.rejected.len(),
                    page.rounds,
                    page.batch,
                    if page.capped { " capped" } else { "" }
                )
            })
            .unwrap_or_default();
        format!(
            "{inner:?}{} shows {rows}, read out {}{page}",
            value
                .map(|value| format!(" for {value:?}"))
                .unwrap_or_default(),
            self.single.is_pending(inner)
        )
    }

    /// Check every tree's per-edge counts against the rows its parts
    /// hold, returning one line per disagreement (none when the state is
    /// consistent): `left` is the driver's rows per join value (for a
    /// driving child, the rows that have risen), `matched` the risen child
    /// rows of an inner edge the main drives, `shown` the shown parent
    /// rows, `risen` exactly the held rows of a gated node whose gate is
    /// open, and, once none of a tree's reads is out, each page decided
    /// (no candidate left, every admitted row's gate open, every row kept
    /// apart closed) with its view the first `L` admitted rows. A test
    /// seam; nothing in the engine reads it.
    pub fn audit(&self) -> Vec<String> {
        let mut problems = Vec::new();
        for (&tree_id, tree) in self.trees.iter() {
            let held = |part: &QueryPart| -> Vec<(DataFrameKey, DataFrameRow)> {
                tree.nodes[part]
                    .inner_parts()
                    .into_iter()
                    .flat_map(|inner| self.single.rows_for(inner).unwrap_or_default())
                    .collect()
            };
            for (part, node) in tree.nodes.iter() {
                if node.gates.is_empty() || upward_edge(tree, part).is_none() {
                    continue;
                }
                let open: HashSet<DataFrameKey> = held(part)
                    .into_iter()
                    .filter(|(_, row)| gate_open(tree, node, row))
                    .map(|(key, _)| key)
                    .collect();
                if open != node.risen {
                    problems.push(format!(
                        "tree {tree_id:?} part {part:?}: risen {:?}, open {:?}",
                        node.risen, open
                    ));
                }
            }
            let reading = tree.nodes.values().any(|node| {
                !node.is_registered()
                    || node
                        .inner_parts()
                        .into_iter()
                        .any(|inner| self.single.is_pending(inner))
            });
            for part in tree.pages.iter().filter(|_| !reading) {
                let node = &tree.nodes[part];
                for inner in node.inner_parts() {
                    let Some((page, state)) = self.single.page_state(inner) else {
                        continue;
                    };
                    let open = |key: &DataFrameKey| -> bool {
                        self.single
                            .row_image(inner, key)
                            .is_some_and(|row| gate_open(tree, node, &row))
                    };
                    if !page.candidates.is_empty() {
                        problems.push(format!(
                            "tree {tree_id:?} part {part:?} {inner:?}: candidates left {:?} ({state})",
                            page.candidates
                        ));
                    }
                    let closed: Vec<&DataFrameKey> =
                        page.admitted.iter().filter(|key| !open(key)).collect();
                    if !closed.is_empty() {
                        problems.push(format!(
                            "tree {tree_id:?} part {part:?} {inner:?}: admitted with the gate closed {closed:?} ({state})"
                        ));
                    }
                    let opened: Vec<&DataFrameKey> =
                        page.rejected.iter().filter(|key| open(key)).collect();
                    if !opened.is_empty() {
                        problems.push(format!(
                            "tree {tree_id:?} part {part:?} {inner:?}: kept apart with the gate open {opened:?} ({state})"
                        ));
                    }
                    let prefix: HashSet<DataFrameKey> =
                        self.single.client_prefix(inner).into_iter().collect();
                    let view: HashSet<DataFrameKey> = self
                        .views
                        .get(&inner)
                        .map(|view| view.keys().cloned().collect())
                        .unwrap_or_default();
                    if prefix != view {
                        problems.push(format!(
                            "tree {tree_id:?} part {part:?} {inner:?}: view {view:?}, the page shows {prefix:?} ({state})"
                        ));
                    }
                }
            }
            for (index, edge) in tree.edges.iter().enumerate() {
                let tally = |rows: Vec<(DataFrameKey, DataFrameRow)>, column: &ColumnName| {
                    let mut counts: HashMap<Value, u64> = HashMap::new();
                    for (_, row) in rows {
                        *counts.entry(join_value(&row, column)).or_insert(0) += 1;
                    }
                    counts
                };
                let risen_rows = |part: &QueryPart| -> Vec<(DataFrameKey, DataFrameRow)> {
                    let node = &tree.nodes[part];
                    held(part)
                        .into_iter()
                        .filter(|(key, _)| node.gates.is_empty() || node.risen.contains(key))
                        .collect()
                };
                let left = match edge.driver {
                    Driver::Main => tally(held(&edge.parent), &edge.parent_column),
                    Driver::Sub => tally(risen_rows(&edge.child), &edge.child_column),
                };
                if left != edge.counts.left {
                    problems.push(format!(
                        "tree {tree_id:?} edge {index}: left {:?}, rows give {:?}",
                        edge.counts.left, left
                    ));
                }
                if edge.gates_parent() {
                    let matched = tally(risen_rows(&edge.child), &edge.child_column);
                    if matched != edge.counts.matched {
                        problems.push(format!(
                            "tree {tree_id:?} edge {index}: matched {:?}, rows give {:?}",
                            edge.counts.matched, matched
                        ));
                    }
                }
                let shown_rows = held(&edge.parent)
                    .into_iter()
                    .filter(|(key, row)| self.shown_in(tree_id, &edge.parent, key, row))
                    .collect();
                let shown = tally(shown_rows, &edge.parent_column);
                if shown != edge.counts.shown {
                    problems.push(format!(
                        "tree {tree_id:?} edge {index}: shown {:?}, rows give {:?}",
                        edge.counts.shown, shown
                    ));
                }
            }
        }
        problems
    }

    /// Forward one part operation to every subscriber of its tree, unless
    /// the row is not shown (a child with no shown parent row, a gated row
    /// with no match). A page's rows are never forwarded from here: the
    /// page's view ships them ([`Self::sync_views`]).
    fn emit(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        table: &TableName,
        op: DataFrameOperation,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let Some(tree) = self.trees.get(&tree_id) else {
            return;
        };
        if is_page(tree, part) || !self.shown_in(tree_id, part, op.key(), op.row()) {
            return;
        }
        self.emit_raw(tree_id, part, table, op, out);
    }

    /// Forward one part operation to every subscriber of its tree at once
    /// (one update carrying the tree's shared list), the caller having
    /// decided it is shown (or was, for a retraction).
    fn emit_raw(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        table: &TableName,
        op: DataFrameOperation,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let Some(tree) = self.trees.get(&tree_id) else {
            return;
        };
        out.push(MultiTableUpdate {
            subs: tree
                .audience
                .get_or_init(|| Subs::of(&tree.subscribers))
                .clone(),
            table: table.clone(),
            part: *part,
            op,
        });
    }

    /// A row now held by `part`: reference its join value on every edge
    /// the part drives below it (a new reference asks for a read; nothing
    /// is emitted for it here), let it act on the edge above it if its own
    /// gate is open ([`Self::rise`]) and, if the row is shown, count it on
    /// the edges below it, admitting the children it uncovers. A row of a
    /// page is admitted or not as its gate stands ([`Self::sync_row`]);
    /// its view ships it. A row a page drives through an inner edge whose
    /// join value no held page row carries is not held at all
    /// ([`Self::unreferenced`]).
    fn arrived(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        if let Some((edge, inner)) = self.page_child(tree_id, part, row)
            && !self.referenced(tree_id, part, edge, row)
        {
            if self.cause == Cause::Write {
                let value = join_value(row, &self.trees[&tree_id].edges[edge].child_column);
                self.recall(tree_id, edge, &value, out);
            }
            self.single.remove_row(inner, key);
            return;
        }
        let (page, rises) = {
            let tree = &self.trees[&tree_id];
            (
                is_page(tree, part),
                acts_above(tree, part) && gate_open(tree, &tree.nodes[part], row),
            )
        };
        let shown = !page && self.shown_in(tree_id, part, key, row);
        self.touch_page(tree_id, part);
        if page {
            self.sync_row(tree_id, part, key, row);
        }
        if rises {
            self.rise(tree_id, part, key, row, out);
        }
        for (edge, column) in downward_edges(&self.trees[&tree_id], part) {
            self.reference(tree_id, edge, join_value(row, &column), out);
        }
        if shown {
            self.appear(tree_id, part, row, out);
        }
    }

    /// A row no longer held by `part`: the mirror of [`Self::arrived`]. A
    /// page row's view withdraws it.
    fn departed(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        self.touch_page(tree_id, part);
        if !is_page(&self.trees[&tree_id], part) && self.shown_in(tree_id, part, key, row) {
            self.vanish(tree_id, part, row, out);
        }
        self.sink(tree_id, part, key, row, out);
        for (edge, column) in downward_edges(&self.trees[&tree_id], part) {
            self.release(tree_id, edge, &join_value(row, &column), out);
        }
    }

    /// A row of `part` replaced in place: move references only on edges
    /// whose join value actually changed — the new value referenced first,
    /// the old released after — so a kept value never crosses zero; what
    /// the row counts for on the edge above it moves the same way, and
    /// comes or goes with its gate; the shown counts below it follow. A
    /// page row shown in its view is rewritten from here (its part's
    /// operations are not forwarded); one whose new join value no held
    /// page row carries departs and is not held.
    fn replaced(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        old: &DataFrameRow,
        new: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        if let Some((edge, inner)) = self.page_child(tree_id, part, new)
            && !self.referenced(tree_id, part, edge, new)
        {
            self.departed(tree_id, part, key, old, out);
            if self.cause == Cause::Write {
                let value = join_value(new, &self.trees[&tree_id].edges[edge].child_column);
                self.recall(tree_id, edge, &value, out);
            }
            self.single.remove_row(inner, key);
            return;
        }
        let page = is_page(&self.trees[&tree_id], part);
        let (was, is) = if page {
            let tree = &self.trees[&tree_id];
            let entry = part_inner(tree, part, new)
                .and_then(|inner| self.views.get(&inner))
                .and_then(|view| view.get(key));
            (
                entry.is_some_and(|entry| entry.shown),
                entry.is_some() && under_shown_parent(tree, part, new),
            )
        } else {
            (
                self.shown_in(tree_id, part, key, old),
                self.shown_in(tree_id, part, key, new),
            )
        };
        if page {
            let table = self.trees[&tree_id].nodes[part].query.table.clone();
            if was {
                self.emit_raw(
                    tree_id,
                    part,
                    &table,
                    DataFrameOperation::Delete(key.clone(), old.clone()),
                    out,
                );
            }
            if is {
                self.emit_raw(
                    tree_id,
                    part,
                    &table,
                    DataFrameOperation::Add(key.clone(), new.clone()),
                    out,
                );
            }
            if let Some(entry) = part_inner(&self.trees[&tree_id], part, new)
                .and_then(|inner| self.views.get_mut(&inner))
                .and_then(|view| view.get_mut(key))
            {
                entry.row = new.clone();
                entry.shown = is;
            }
        }
        self.touch_page(tree_id, part);
        for (edge, column) in downward_edges(&self.trees[&tree_id], part) {
            let old_value = join_value(old, &column);
            let new_value = join_value(new, &column);
            if old_value != new_value {
                self.reference(tree_id, edge, new_value, out);
                self.release(tree_id, edge, &old_value, out);
            }
        }
        if let Some((_, column, _)) = upward_edge(&self.trees[&tree_id], part) {
            let had = self.has_risen(tree_id, part, key);
            let open = {
                let tree = &self.trees[&tree_id];
                gate_open(tree, &tree.nodes[part], new)
            };
            let moved = join_value(old, &column) != join_value(new, &column);
            match (had, open) {
                (true, true) if moved => {
                    self.rise_value(tree_id, part, new, out);
                    self.sink_value(tree_id, part, old, out);
                }
                (true, false) => self.sink(tree_id, part, key, old, out),
                (false, true) => self.rise(tree_id, part, key, new, out),
                _ => {}
            }
        }
        for edge in self.trees[&tree_id].nodes[part].children.clone() {
            let column = self.trees[&tree_id].edges[edge].parent_column.clone();
            let old_value = join_value(old, &column);
            let new_value = join_value(new, &column);
            if was && is && old_value == new_value {
                continue;
            }
            if is {
                self.show(tree_id, edge, new_value, out);
            }
            if was {
                self.hide(tree_id, edge, &old_value, out);
            }
        }
        if page {
            self.sync_row(tree_id, part, key, new);
        }
    }

    /// When `part` is the driven side of an inner edge a page decides —
    /// from the page itself, or loose below one — and not a window per
    /// parent row: the edge, and the inner part holding `row`. A row
    /// arriving there is checked against the page ([`Self::recall`],
    /// [`Self::referenced`]).
    fn page_child(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        row: &DataFrameRow,
    ) -> Option<(usize, SubId)> {
        let tree = &self.trees[&tree_id];
        let node = &tree.nodes[part];
        let index = node.parent?;
        let edge = &tree.edges[index];
        if node.fanned || !(edge.loose || edge.kept) {
            return None;
        }
        Some((index, part_inner(tree, part, row)?))
    }

    /// The rows a lookup brought to `sub` concern the edge above its part:
    /// the driver is asked for its rows with each of their join values
    /// ([`Self::recall`]), whether or not a held driver row carries the
    /// value — the lookup was asked for because of a write below, and its
    /// effect has to climb to the page (a profile arriving for a user no
    /// ticket held: the user is looked up, then the tickets with that
    /// user). Nothing for a part that is not below a page's edge.
    fn recall_above(
        &mut self,
        sub: SubId,
        rows: &[(DataFrameKey, DataFrameRow)],
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let Some((tree_id, part)) = self.parts.get(&sub).cloned() else {
            return;
        };
        let (edge, column) = {
            let tree = &self.trees[&tree_id];
            let node = &tree.nodes[&part];
            let Some(index) = node.parent else {
                return;
            };
            let edge = &tree.edges[index];
            if node.fanned || !(edge.loose || edge.kept) {
                return;
            }
            (index, edge.child_column.clone())
        };
        let mut values: Vec<Value> = Vec::new();
        for (_, row) in rows {
            let value = join_value(row, &column);
            if !values.contains(&value) {
                values.push(value);
            }
        }
        for value in values {
            self.recall(tree_id, edge, &value, out);
        }
    }

    /// Whether `row` of `part` is to be held: a held driver row carries
    /// its join value on `edge`, or the part's own filter admits the row
    /// on another branch with the edge read as false.
    fn referenced(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        edge: usize,
        row: &DataFrameRow,
    ) -> bool {
        let e = &self.trees[&tree_id].edges[edge];
        let value = join_value(row, &e.child_column);
        if e.counts.left.contains_key(&value) {
            return true;
        }
        e.bound.is_some() && evaluate(&self.filter_without(tree_id, part, edge), &row.data, &mut 0)
    }

    /// A write on the driven side of `edge` concerns `value`: make the
    /// driver decide its rows with that value again, so a gate this write
    /// opens is noticed. A page read whole holds them all: every row it
    /// holds for the value is a candidate again (the ones it kept apart;
    /// the rest already are, or are admitted). A page read in batches
    /// dropped the ones its gate closed on, so it looks the value up in
    /// storage ([`SingleTableIVM::lookup`]; the rows it holds already come
    /// back as nothing, rows behind its frontier are not held) — one read
    /// for the node, its windows per parent row included — and only when
    /// it dropped a row with that value ([`Edge::dropped`]): for any other
    /// value the lookup would land nothing. A part below the page that
    /// holds no row for the value looks it up the same way (its rows for
    /// the value were pruned when their driver left); one that holds rows
    /// has its gate re-evaluated already.
    fn recall(
        &mut self,
        tree_id: TreeId,
        edge: usize,
        value: &Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let (column, driver, read, driver_parts) = {
            let tree = &self.trees[&tree_id];
            let e = &tree.edges[edge];
            let driver = &tree.nodes[&e.parent];
            (
                e.parent_column.clone(),
                e.parent,
                driver.page,
                driver.inner_parts(),
            )
        };
        let held_by = |this: &Self, inner: SubId| -> Vec<DataFrameKey> {
            this.single
                .rows_matching(inner, column.as_str(), value)
                .into_iter()
                .map(|(key, _)| key)
                .collect()
        };
        match read {
            Some(PageRead::Whole) => {
                for inner in driver_parts {
                    let held = held_by(self, inner);
                    if held.is_empty() {
                        continue;
                    }
                    let ops = self.single.enroll_rows(inner, &held);
                    let forwarded = self.forward(ops);
                    out.extend(forwarded);
                }
            }
            Some(PageRead::Batched) => {
                if self.trees[&tree_id].edges[edge].dropped.contains(value) {
                    self.lookup(tree_id, &driver, &column, value);
                }
            }
            None => {
                for inner in driver_parts {
                    if held_by(self, inner).is_empty() {
                        self.single
                            .lookup(inner, column.as_str(), std::slice::from_ref(value));
                    }
                }
            }
        }
    }

    /// Ask storage for the rows of the page `part` whose `column` is
    /// `value`, as one read: the part's own filter narrowed to the value
    /// (a node with a window per parent row is read across all its
    /// windows, the rows sorted into them as they land,
    /// [`Self::land_read`]). The rows land as candidates, rows behind a
    /// window's frontier not held.
    fn lookup(&mut self, tree_id: TreeId, part: &QueryPart, column: &ColumnName, value: &Value) {
        let (issuer, query) = {
            let tree = &self.trees[&tree_id];
            let node = &tree.nodes[part];
            let issuer = node.inner_parts().first().copied();
            let skip = if node.fanned { node.parent } else { None };
            let filter = Where::AND(vec![
                self.restricted_filter(tree_id, part, skip),
                Where::condition(
                    column.clone(),
                    ComparisonOperator::IN,
                    Value::List(vec![value.clone()]),
                ),
            ]);
            (
                issuer,
                SingleTableReadQuery {
                    filter,
                    limit: self.single.row_limit() as u32,
                    ..node.query.clone()
                },
            )
        };
        if let Some(issuer) = issuer {
            self.single.lookup_query(issuer, query);
        }
    }

    /// Bring a page's verdict on one of its rows in line with the row's
    /// gate: open, the row is admitted; closed, an admitted row is a
    /// candidate again. The tree is queued so the page's view is synced
    /// before the step returns.
    fn sync_row(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        row: &DataFrameRow,
    ) {
        let (inner, open) = {
            let tree = &self.trees[&tree_id];
            (
                part_inner(tree, part, row),
                gate_open(tree, &tree.nodes[part], row),
            )
        };
        let Some(inner) = inner else {
            return;
        };
        let changed = if open {
            self.single.admit(inner, key)
        } else {
            self.single.unadmit(inner, key)
        };
        if changed {
            self.mark_dirty(tree_id);
        }
    }

    /// Ship the changes of every page view of `tree_id`: for each page
    /// part, the rows that left the page's first `L` admitted rows since
    /// the last sync vanish (their children, then their `Delete`), then
    /// the rows that entered it appear (their `Add`, then their children),
    /// each under a shown parent row only — every departure of the part
    /// before any arrival, so a row moving between two windows of one
    /// part leaves with its old image before it arrives with its new one;
    /// the view keeps the image each row was sent with.
    fn sync_views(&mut self, tree_id: TreeId, out: &mut Vec<MultiTableUpdate>) {
        let pages: Vec<(QueryPart, TableName, Vec<SubId>)> = match self.trees.get(&tree_id) {
            Some(tree) => tree
                .pages
                .iter()
                .map(|part| {
                    let node = &tree.nodes[part];
                    (*part, node.query.table.clone(), node.inner_parts())
                })
                .collect(),
            None => return,
        };
        for (part, table, inners) in pages {
            let mut left: Vec<(DataFrameKey, DataFrameRow)> = Vec::new();
            let mut entered: Vec<(DataFrameKey, DataFrameRow)> = Vec::new();
            for inner in inners {
                let version = self.single.window_version(inner);
                if version.is_some() && version == self.synced.get(&inner).copied() {
                    continue;
                }
                let now = self.single.client_prefix(inner);
                let kept: HashSet<&DataFrameKey> = now.iter().collect();
                if let Some(view) = self.views.get_mut(&inner) {
                    view.retain(|key, entry| {
                        let stays = kept.contains(key);
                        if !stays && entry.shown {
                            left.push((key.clone(), entry.row.clone()));
                        }
                        stays
                    });
                }
                if let Some(version) = version {
                    self.synced.insert(inner, version);
                }
                for key in now {
                    if self
                        .views
                        .get(&inner)
                        .is_some_and(|view| view.contains_key(&key))
                    {
                        continue;
                    }
                    let Some(row) = self.single.row_image(inner, &key) else {
                        continue;
                    };
                    let shown = under_shown_parent(&self.trees[&tree_id], &part, &row);
                    self.views.entry(inner).or_default().insert(
                        key.clone(),
                        ViewRow {
                            row: row.clone(),
                            shown,
                        },
                    );
                    if shown {
                        entered.push((key, row));
                    }
                }
            }
            for (key, row) in left {
                self.emit_raw(
                    tree_id,
                    &part,
                    &table,
                    DataFrameOperation::Delete(key, row.clone()),
                    out,
                );
                self.vanish(tree_id, &part, &row, out);
            }
            for (key, row) in entered {
                self.emit_raw(
                    tree_id,
                    &part,
                    &table,
                    DataFrameOperation::Add(key, row.clone()),
                    out,
                );
                self.appear(tree_id, &part, &row, out);
            }
        }
    }

    /// The `Add` of `key` into `inner` is being handled: the row is no
    /// longer in flight.
    fn landed_in_flight(&mut self, inner: SubId, key: &DataFrameKey) {
        if !self.in_flight.is_empty() {
            self.in_flight.remove(&(inner, key.clone()));
        }
    }

    /// Note that rows of `part` moved, so the tree's pages are settled
    /// before the step returns; nothing for a tree without one.
    fn touch_page(&mut self, tree_id: TreeId, _part: &QueryPart) {
        self.mark_dirty(tree_id);
    }

    /// Queue `tree_id` for [`Self::settle_pages`] if it has a page under a
    /// gate.
    fn mark_dirty(&mut self, tree_id: TreeId) {
        let paged = self
            .trees
            .get(&tree_id)
            .is_some_and(|tree| !tree.pages.is_empty());
        if paged && self.queued.insert(tree_id) {
            self.dirty.push(tree_id);
        }
    }

    /// Settle the pages of every tree queued in this step: sync their
    /// views, then see [`Self::settle_tree`]. Forwarding what a settled
    /// page takes or puts aside may queue the tree again, so each tree is
    /// settled in rounds, up to [`SETTLE_ROUNDS`] of them per pass.
    fn settle_pages(&mut self, out: &mut Vec<MultiTableUpdate>) {
        self.cause = Cause::Page;
        self.landing = None;
        let mut passes = 0usize;
        while passes < SETTLE_ROUNDS
            && let Some(tree_id) = self.dirty.pop()
        {
            self.queued.remove(&tree_id);
            passes += 1;
            for _ in 0..SETTLE_ROUNDS {
                self.sync_views(tree_id, out);
                if !self.settle_tree(tree_id, out) {
                    break;
                }
            }
        }
    }

    /// One round for the pages of one tree, once none of its reads is out
    /// (until then a closed gate may only be a sub row not yet fetched):
    /// each page is told which of its candidates the gate closed on (the
    /// join values of those rows recorded on the edges they drove, for
    /// the writes that may concern them later), and what the page takes
    /// or puts aside in answer — the next batch, or admitted rows past its
    /// capacity — is forwarded like any other operation, the rows newly
    /// held asking for their sub rows in turn. The tree's subscriptions
    /// are handed out for reporting once a page is capped. Reports
    /// whether anything moved, in which case another round follows once
    /// those reads have landed.
    fn settle_tree(&mut self, tree_id: TreeId, out: &mut Vec<MultiTableUpdate>) -> bool {
        let Some(tree) = self.trees.get(&tree_id) else {
            return false;
        };
        let reading = tree.nodes.values().any(|node| {
            !node.is_registered()
                || node
                    .inner_parts()
                    .into_iter()
                    .any(|inner| self.single.is_pending(inner))
        });
        if reading {
            return false;
        }
        let mut verdicts: Vec<(SubId, HashSet<DataFrameKey>)> = Vec::new();
        let mut open: Vec<(SubId, DataFrameKey)> = Vec::new();
        let mut dropped: Vec<(usize, Value)> = Vec::new();
        for part in &tree.pages {
            let node = &tree.nodes[part];
            let recalled: Vec<usize> = if node.page == Some(PageRead::Batched) {
                node.children
                    .iter()
                    .copied()
                    .filter(|edge| tree.edges[*edge].loose)
                    .collect()
            } else {
                Vec::new()
            };
            for inner in node.inner_parts() {
                if self.single.page_round_idle(inner) {
                    continue;
                }
                let mut rejected = HashSet::new();
                for key in self.single.page_candidates(inner) {
                    let Some(row) = self.single.row_image(inner, &key) else {
                        continue;
                    };
                    if gate_open(tree, node, &row) {
                        open.push((inner, key));
                    } else {
                        for &edge in &recalled {
                            dropped.push((edge, join_value(&row, &tree.edges[edge].parent_column)));
                        }
                        rejected.insert(key);
                    }
                }
                verdicts.push((inner, rejected));
            }
        }
        if let Some(tree) = self.trees.get_mut(&tree_id) {
            for (edge, value) in dropped {
                tree.edges[edge].dropped.insert(value);
            }
        }
        for (inner, key) in open {
            self.single.admit(inner, &key);
        }
        let mut moved = false;
        for (inner, rejected) in verdicts {
            let ops = self.single.finish_round(inner, rejected);
            if ops.is_empty() {
                continue;
            }
            moved = true;
            let forwarded = self.forward(ops);
            out.extend(forwarded);
            self.fetch_wanted();
        }
        let capped = self.trees[&tree_id]
            .pages
            .iter()
            .flat_map(|part| self.trees[&tree_id].nodes[part].inner_parts())
            .any(|inner| self.single.page_capped(inner));
        if let Some(tree) = self.trees.get_mut(&tree_id) {
            if capped && !tree.capped {
                tree.capped = true;
                self.capped.extend(tree.subscribers.iter().copied());
            } else if !capped {
                tree.capped = false;
            }
        }
        self.sync_views(tree_id, out);
        moved
    }

    /// Whether `key` of `part` is counted on the edge above it: every held
    /// row of a node without gates, the recorded ones of a gated node.
    fn has_risen(&self, tree_id: TreeId, part: &QueryPart, key: &DataFrameKey) -> bool {
        let node = &self.trees[&tree_id].nodes[part];
        node.gates.is_empty() || node.risen.contains(key)
    }

    /// A held row of `part` whose gate is open starts acting on the edge
    /// above it: a match for the parent rows it gates, or a reference when
    /// the part drives that edge. A gated node records the key, so the
    /// row leaves exactly what it entered.
    fn rise(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        if !acts_above(&self.trees[&tree_id], part) {
            return;
        }
        let recorded = self
            .trees
            .get_mut(&tree_id)
            .and_then(|tree| tree.nodes.get_mut(part))
            .is_some_and(|node| node.gates.is_empty() || node.risen.insert(key.clone()));
        if recorded {
            self.rise_value(tree_id, part, row, out);
        }
    }

    /// The mirror of [`Self::rise`]: a row that was counted above stops
    /// being.
    fn sink(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        key: &DataFrameKey,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        if !acts_above(&self.trees[&tree_id], part) {
            return;
        }
        let recorded = self
            .trees
            .get_mut(&tree_id)
            .and_then(|tree| tree.nodes.get_mut(part))
            .is_some_and(|node| node.gates.is_empty() || node.risen.remove(key));
        if recorded {
            self.sink_value(tree_id, part, row, out);
        }
    }

    /// Count `row`'s join value on the edge above `part`.
    fn rise_value(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let Some((edge, column, drives)) = upward_edge(&self.trees[&tree_id], part) else {
            return;
        };
        let value = join_value(row, &column);
        if drives {
            self.reference(tree_id, edge, value, out);
        } else {
            self.matched_in(tree_id, edge, value, out);
        }
    }

    /// Stop counting `row`'s join value on the edge above `part`.
    fn sink_value(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let Some((edge, column, drives)) = upward_edge(&self.trees[&tree_id], part) else {
            return;
        };
        let value = join_value(row, &column);
        if drives {
            self.release(tree_id, edge, &value, out);
        } else {
            self.matched_out(tree_id, edge, &value, out);
        }
    }

    /// A shown row of `part` is in place: count it on every edge below,
    /// admitting the children its value uncovers.
    fn appear(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        for edge in self.trees[&tree_id].nodes[part].children.clone() {
            let column = self.trees[&tree_id].edges[edge].parent_column.clone();
            self.show(tree_id, edge, join_value(row, &column), out);
        }
    }

    /// A shown row of `part` is going: the mirror of [`Self::appear`].
    fn vanish(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        row: &DataFrameRow,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        for edge in self.trees[&tree_id].nodes[part].children.clone() {
            let column = self.trees[&tree_id].edges[edge].parent_column.clone();
            self.hide(tree_id, edge, &join_value(row, &column), out);
        }
    }

    /// One more shown parent row carries `value` on `edge`; on the 0 → 1
    /// crossing of a gating edge, admit the child rows held for the value.
    fn show(
        &mut self,
        tree_id: TreeId,
        edge: usize,
        value: Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let Some(counts) = self.counts_mut(tree_id, edge) else {
            return;
        };
        let count = counts.shown.entry(value.clone()).or_insert(0);
        *count += 1;
        if *count != 1 || !self.trees[&tree_id].edges[edge].gates_child() {
            return;
        }
        let (child, column) = {
            let edge = &self.trees[&tree_id].edges[edge];
            (edge.child, edge.child_column.clone())
        };
        let table = self.trees[&tree_id].nodes[&child].query.table.clone();
        if is_page(&self.trees[&tree_id], &child) {
            for (inner, key, row) in self.view_rows(tree_id, &child, &column, &value, false) {
                self.mark_sent(inner, &key, true);
                self.emit_raw(
                    tree_id,
                    &child,
                    &table,
                    DataFrameOperation::Add(key, row.clone()),
                    out,
                );
                self.appear(tree_id, &child, &row, out);
            }
            return;
        }
        for (key, row) in self.rows_of_value(tree_id, &child, &column, &value) {
            if !self.visible(tree_id, &child, &key, &row) {
                continue;
            }
            self.emit_raw(
                tree_id,
                &child,
                &table,
                DataFrameOperation::Add(key, row.clone()),
                out,
            );
            self.appear(tree_id, &child, &row, out);
        }
    }

    /// One shown parent row fewer carries `value` on `edge`; on the 1 → 0
    /// crossing of a gating edge, retract the child rows held for the
    /// value before the count drops, so their `Delete`s still pass the
    /// gate.
    fn hide(
        &mut self,
        tree_id: TreeId,
        edge: usize,
        value: &Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let crossing = self
            .trees
            .get(&tree_id)
            .and_then(|tree| tree.edges.get(edge))
            .is_some_and(|e| e.gates_child() && e.counts.shown.get(value).copied() == Some(1));
        if crossing {
            let (child, column) = {
                let edge = &self.trees[&tree_id].edges[edge];
                (edge.child, edge.child_column.clone())
            };
            let table = self.trees[&tree_id].nodes[&child].query.table.clone();
            if is_page(&self.trees[&tree_id], &child) {
                for (inner, key, row) in self.view_rows(tree_id, &child, &column, value, true) {
                    self.mark_sent(inner, &key, false);
                    self.emit_raw(
                        tree_id,
                        &child,
                        &table,
                        DataFrameOperation::Delete(key, row.clone()),
                        out,
                    );
                    self.vanish(tree_id, &child, &row, out);
                }
            } else {
                for (key, row) in self.rows_of_value(tree_id, &child, &column, value) {
                    if !self.visible(tree_id, &child, &key, &row) {
                        continue;
                    }
                    self.emit_raw(
                        tree_id,
                        &child,
                        &table,
                        DataFrameOperation::Delete(key, row.clone()),
                        out,
                    );
                    self.vanish(tree_id, &child, &row, out);
                }
            }
        }
        Self::drop_in(
            self.counts_mut(tree_id, edge)
                .map(|counts| &mut counts.shown),
            value,
        );
    }

    /// One more held child row carries `value` on `edge`, an inner edge
    /// the main drives: bump `matched`, and on the 0 → 1 crossing
    /// re-evaluate the parent rows carrying the value, admitting the ones
    /// the gate now lets through, and, when a write is behind the opening
    /// ([`Self::recalls`]), ask the driver for the rows with that value it
    /// may have dropped ([`Self::recall`]).
    fn matched_in(
        &mut self,
        tree_id: TreeId,
        edge: usize,
        value: Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let crossing = self
            .trees
            .get(&tree_id)
            .and_then(|tree| tree.edges.get(edge))
            .is_none_or(|e| !e.counts.matched.contains_key(&value));
        let bump = |this: &mut Self| {
            if let Some(counts) = this.counts_mut(tree_id, edge) {
                *counts.matched.entry(value.clone()).or_insert(0) += 1;
            }
        };
        if crossing {
            let (parent, column) = {
                let e = &self.trees[&tree_id].edges[edge];
                (e.parent, e.parent_column.clone())
            };
            self.regate(tree_id, &parent, &column, &value, out, bump);
            if self.recalls(tree_id, edge) {
                self.recall(tree_id, edge, &value, out);
            }
        } else {
            bump(self);
        }
    }

    /// One held child row fewer carries `value` on `edge`: the mirror of
    /// [`Self::matched_in`], retracting the parent rows the gate now
    /// closes on.
    fn matched_out(
        &mut self,
        tree_id: TreeId,
        edge: usize,
        value: &Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let crossing = self
            .trees
            .get(&tree_id)
            .and_then(|tree| tree.edges.get(edge))
            .is_some_and(|e| e.counts.matched.get(value).copied() == Some(1));
        let drop = |this: &mut Self| {
            Self::drop_in(
                this.counts_mut(tree_id, edge)
                    .map(|counts| &mut counts.matched),
                value,
            );
        };
        if crossing {
            let (parent, column) = {
                let e = &self.trees[&tree_id].edges[edge];
                (e.parent, e.parent_column.clone())
            };
            self.regate(tree_id, &parent, &column, value, out, drop);
        } else {
            drop(self);
        }
    }

    /// Apply `change` (a count moving across zero) and re-evaluate the
    /// rows of `part` whose `column` is `value` around it, in two passes.
    /// First what the client sees: a row the gate opens on under a shown
    /// parent is admitted (its `Add`, then its children), a row it closes
    /// on is retracted (its children, then its `Delete`) — for a page,
    /// the row is admitted to or withdrawn from the page instead
    /// ([`Self::sync_row`]) and its view ships the difference. Then what
    /// the rows count for above: a row whose gate opened rises, one whose
    /// gate closed sinks, which may open or close the gates further up
    /// (and a parent row revealed that way admits this part's rows
    /// itself, which is why the first pass comes first and reads the
    /// counts as they are before anything above has moved).
    fn regate(
        &mut self,
        tree_id: TreeId,
        part: &QueryPart,
        column: &ColumnName,
        value: &Value,
        out: &mut Vec<MultiTableUpdate>,
        change: impl FnOnce(&mut Self),
    ) {
        let page = is_page(&self.trees[&tree_id], part);
        let rows = self.rows_of_value(tree_id, part, column, value);
        let was: Vec<bool> = rows
            .iter()
            .map(|(key, row)| !page && self.shown_in(tree_id, part, key, row))
            .collect();
        change(self);
        if rows.is_empty() {
            return;
        }
        self.touch_page(tree_id, part);
        let table = self.trees[&tree_id].nodes[part].query.table.clone();
        for ((key, row), was) in rows.iter().zip(was) {
            if page {
                self.sync_row(tree_id, part, key, row);
                continue;
            }
            let is = self.shown_in(tree_id, part, key, row);
            if !was && is {
                self.emit_raw(
                    tree_id,
                    part,
                    &table,
                    DataFrameOperation::Add(key.clone(), row.clone()),
                    out,
                );
                self.appear(tree_id, part, row, out);
            } else if was && !is {
                self.emit_raw(
                    tree_id,
                    part,
                    &table,
                    DataFrameOperation::Delete(key.clone(), row.clone()),
                    out,
                );
                self.vanish(tree_id, part, row, out);
            }
        }
        if upward_edge(&self.trees[&tree_id], part).is_none() {
            return;
        }
        for (key, row) in &rows {
            let open = {
                let tree = &self.trees[&tree_id];
                gate_open(tree, &tree.nodes[part], row)
            };
            if open {
                self.rise(tree_id, part, key, row, out);
            } else {
                self.sink(tree_id, part, key, row, out);
            }
        }
    }

    /// A driver row now carries `value` on `edge`: bump `left`, and on the
    /// 0 → 1 crossing, if every edge reading the same set now references
    /// the value, add it to the set (one index filing) and ask for the
    /// value's driven rows (in the step's one narrowed read of that part,
    /// [`Self::fetch_wanted`]); when it lands
    /// ([`Self::land_fetch`]) they are forwarded and arrive at the driven
    /// node. Before the driven part is registered the set is filled
    /// directly; registration files it whole. A fanned node gains a part
    /// for the value when the edge is the one that fans it, and otherwise
    /// has the value filed once (its parts share the set) and fetched for
    /// each of its parts. When the driven part is a gated parent (the
    /// edge's test sits beside a main-driven one in its `WHERE`), the
    /// crossing also re-evaluates the parent rows already held for the
    /// value. A loose edge files nothing and fetches on every crossing; so
    /// does an edge from a page read whole, whose values stay filed after
    /// their driven rows were pruned.
    fn reference(
        &mut self,
        tree_id: TreeId,
        edge: usize,
        value: Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let crossing = self.left_count(tree_id, edge, &value) == 0;
        let bump = |this: &mut Self| this.left_bump(tree_id, edge, value.clone());
        match self.gated_driven_parent(tree_id, edge).filter(|_| crossing) {
            Some((parent, column)) => self.regate(tree_id, &parent, &column, &value, out, bump),
            None => bump(self),
        }
        if !crossing {
            return;
        }
        if !referenced_by_all(&self.trees[&tree_id], edge, &value) {
            return;
        }
        let (driven, column, key) = self.leaf_of(tree_id, edge);
        let (loose, kept) = self.restriction_of(tree_id, edge);
        let set = self.trees[&tree_id].leaves[&key].clone();
        let node = &self.trees[&tree_id].nodes[&driven];
        if !node.is_registered() {
            if !loose {
                set.insert(&value);
            }
            return;
        }
        if node.fanned && node.parent == Some(edge) {
            if set.insert(&value) {
                self.register_value(tree_id, &driven, value, out);
            }
            return;
        }
        let inners = node.inner_parts();
        let Some(first) = inners.first().copied() else {
            if !loose {
                set.insert(&value);
            }
            return;
        };
        let filed = self
            .single
            .set_insert(first, &leaf_condition(&column, &set), &value);
        if !filed && !loose && !kept {
            return;
        }
        for inner in inners {
            match self
                .wanted
                .iter_mut()
                .find(|(sub, wanted, _)| *sub == inner && *wanted == column)
            {
                Some((_, _, values)) => values.push(value.clone()),
                None => self
                    .wanted
                    .push((inner, column.clone(), vec![value.clone()])),
            }
        }
    }

    /// Ask for the rows of every join value referenced since the last
    /// call: one narrowed read per driven inner part and column, whatever
    /// the number of values. Called before a step returns and between the
    /// rounds of [`Self::settle_pages`], so a read is out as soon as the
    /// rows it will bring are waited for.
    fn fetch_wanted(&mut self) {
        for (inner, column, values) in std::mem::take(&mut self.wanted) {
            if let Some(id) = self.single.fetch(inner, column.as_str(), &values)
                && self.cause == Cause::Write
            {
                self.write_reads.insert(id);
            }
        }
    }

    /// A driver row no longer carries `value` on `edge`: drop `left`, and
    /// on the crossing to 0, if the value was in the set, remove it (one
    /// index unfiling), prune the value's held driven rows the filter no
    /// longer admits (no storage round-trip) and forward what that
    /// produces like any other operation: the `Delete`s, whose rows depart
    /// from the driven node, and, when the driven part is a page, the
    /// `Add`s of the rows that move up into it, which arrive there (and
    /// ask for their own sub rows). A loose edge has no set to unfile
    /// from, and an edge from a page read whole keeps the value filed;
    /// for both, the value's driven rows are pruned against the part's
    /// filter with the edge read as false. A gated parent's held rows are
    /// re-evaluated as in [`Self::reference`].
    fn release(
        &mut self,
        tree_id: TreeId,
        edge: usize,
        value: &Value,
        out: &mut Vec<MultiTableUpdate>,
    ) {
        let crossing = self.left_count(tree_id, edge, value) == 1;
        let drop = |this: &mut Self| this.left_drop(tree_id, edge, value);
        match self.gated_driven_parent(tree_id, edge).filter(|_| crossing) {
            Some((parent, column)) => self.regate(tree_id, &parent, &column, value, out, drop),
            None => drop(self),
        }
        if !crossing {
            return;
        }
        let (driven, column, key) = self.leaf_of(tree_id, edge);
        let unfiled = {
            let (loose, kept) = self.restriction_of(tree_id, edge);
            !loose && !kept
        };
        let set = self.trees[&tree_id].leaves[&key].clone();
        if unfiled && !set.contains(value) {
            return;
        }
        let node = &self.trees[&tree_id].nodes[&driven];
        if !node.is_registered() {
            if unfiled {
                set.remove(value);
            }
            return;
        }
        if node.fanned && node.parent == Some(edge) {
            set.remove(value);
            self.unregister_value(tree_id, &driven, value, out);
            return;
        }
        let inners = node.inner_parts();
        let table = node.query.table.clone();
        let Some(first) = inners.first().copied() else {
            if unfiled {
                set.remove(value);
            }
            return;
        };
        let keeps = if unfiled {
            if !self
                .single
                .set_remove(first, &leaf_condition(&column, &set), value)
            {
                return;
            }
            None
        } else {
            Some(self.filter_without(tree_id, &driven, edge))
        };
        for inner in inners {
            let ops = match &keeps {
                Some(keeps) => self.single.prune_rows_unless(
                    inner,
                    column.as_str(),
                    std::slice::from_ref(value),
                    keeps,
                ),
                None => self
                    .single
                    .prune_rows(inner, column.as_str(), std::slice::from_ref(value)),
            };
            let pruned: Vec<SingleTableUpdate> = ops
                .into_iter()
                .map(|op| SingleTableUpdate {
                    query: inner,
                    table: table.clone(),
                    op,
                })
                .collect();
            let forwarded = self.forward(pruned);
            out.extend(forwarded);
        }
    }

    /// When `edge` is an inner edge the sub drives into a parent that
    /// gates its own rows, that parent and its join column: the rows to
    /// re-evaluate when the edge's count crosses zero.
    fn gated_driven_parent(&self, tree_id: TreeId, edge: usize) -> Option<(QueryPart, ColumnName)> {
        let tree = &self.trees[&tree_id];
        let e = &tree.edges[edge];
        (e.driver == Driver::Sub && e.is_inner && !tree.nodes[&e.parent].gates.is_empty())
            .then(|| (e.parent, e.parent_column.clone()))
    }

    /// The driven part of `edge`, the column its leaf is on, and the set
    /// the leaf reads.
    fn leaf_of(&self, tree_id: TreeId, edge: usize) -> (QueryPart, ColumnName, LeafKey) {
        let edge = &self.trees[&tree_id].edges[edge];
        (
            *edge.driven(),
            edge.driven_column().clone(),
            edge.leaf.clone(),
        )
    }

    /// The rows `part` holds whose `column` equals `value`: the matching
    /// rows of its one part; for a fanned node, every row of its per-value
    /// part when `column` is the fanning column and the matching rows of
    /// every part otherwise; nothing while registration has not reached
    /// it.
    fn rows_of_value(
        &self,
        tree_id: TreeId,
        part: &QueryPart,
        column: &ColumnName,
        value: &Value,
    ) -> Vec<(DataFrameKey, DataFrameRow)> {
        let Some(tree) = self.trees.get(&tree_id) else {
            return Vec::new();
        };
        let Some(node) = tree.nodes.get(part) else {
            return Vec::new();
        };
        let arrived = |inner: SubId| -> Vec<(DataFrameKey, DataFrameRow)> {
            let mut rows = self
                .single
                .visible_rows_matching(inner, column.as_str(), value);
            if !self.in_flight.is_empty() {
                rows.retain(|(key, _)| !self.in_flight.contains(&(inner, key.clone())));
            }
            rows
        };
        match &node.parts {
            Parts::Unregistered => Vec::new(),
            Parts::One(inner) => arrived(*inner),
            Parts::Fan(fan) => {
                let fanning = node
                    .parent
                    .map(|edge| &tree.edges[edge].child_column)
                    .is_some_and(|fanning| fanning == column);
                if fanning {
                    fan.get(value)
                        .map(|inner| arrived(*inner))
                        .unwrap_or_default()
                } else {
                    fan.values().flat_map(|inner| arrived(*inner)).collect()
                }
            }
        }
    }

    /// `value`'s current `left` count on `edge` (zero when absent).
    fn left_count(&self, tree_id: TreeId, edge: usize, value: &Value) -> u64 {
        self.trees
            .get(&tree_id)
            .and_then(|tree| tree.edges.get(edge))
            .and_then(|edge| edge.counts.left.get(value).copied())
            .unwrap_or(0)
    }

    /// Mutable access to one edge's counts.
    fn counts_mut(&mut self, tree_id: TreeId, edge: usize) -> Option<&mut JoinKeyCounts> {
        self.trees
            .get_mut(&tree_id)
            .and_then(|tree| tree.edges.get_mut(edge))
            .map(|edge| &mut edge.counts)
    }

    /// Increment `value`'s `left` count on `edge`.
    fn left_bump(&mut self, tree_id: TreeId, edge: usize, value: Value) {
        if let Some(counts) = self.counts_mut(tree_id, edge) {
            *counts.left.entry(value).or_insert(0) += 1;
        }
    }

    /// Decrement `value`'s `left` count on `edge`, removing the entry at
    /// zero.
    fn left_drop(&mut self, tree_id: TreeId, edge: usize, value: &Value) {
        Self::drop_in(
            self.counts_mut(tree_id, edge)
                .map(|counts| &mut counts.left),
            value,
        );
    }

    /// Decrement `value` in one count map, removing the entry at zero;
    /// absent values are left alone.
    fn drop_in(counts: Option<&mut HashMap<Value, u64>>, value: &Value) {
        let Some(counts) = counts else {
            return;
        };
        let Some(count) = counts.get_mut(value) else {
            return;
        };
        *count -= 1;
        if *count == 0 {
            counts.remove(value);
        }
    }
}

impl MultiTableIVM {
    /// One step's per-part operations folded per row.
    fn folded(&self, updates: Vec<MultiTableUpdate>) -> Vec<Delta> {
        fold(
            updates
                .into_iter()
                .map(|update| Raw {
                    table: update.table,
                    audience: Audience {
                        part: update.part,
                        subs: update.subs,
                    },
                    op: update.op,
                })
                .collect(),
        )
    }
}

impl Engine for MultiTableIVM {
    type Query = MultiTableReadQuery;

    /// [`MultiTableIVM::register_query`], its snapshot as deltas.
    fn subscribe(&mut self, query: MultiTableReadQuery) -> (SubId, Vec<Delta>) {
        let (sub, updates) = self.register_query(query);
        (sub, self.folded(updates))
    }

    /// [`MultiTableIVM::unregister_query`].
    fn unsubscribe(&mut self, sub: SubId) {
        self.unregister_query(sub);
    }

    /// What the engine holds: its subscriptions, its trees and the rows
    /// in its frames per table.
    fn footprint(&self) -> Footprint {
        let mut footprint = self.single.footprint();
        footprint.trees = self.trees.len() as u64;
        footprint
    }

    /// [`SingleTableIVM::take_dead`] of the inner engine.
    fn take_dead(&mut self) -> Vec<SharedRow> {
        self.single.take_dead()
    }

    /// The subscriptions whose tree has a page that stopped reaching past
    /// its rejected rows since the last call.
    fn take_capped(&mut self) -> Vec<SubId> {
        std::mem::take(&mut self.capped)
    }

    /// Every subscription of every tree with a part reading the fetch.
    fn waiting_on(&self, fetch: &Fetch) -> Vec<SubId> {
        let mut subs = Vec::new();
        for tree_id in self.trees_reading(fetch) {
            if let Some(tree) = self.trees.get(&tree_id) {
                subs.extend(tree.subscribers.iter().copied());
            }
        }
        subs
    }

    /// Every subscription of every tree with a part reading the refused
    /// fetch, unsubscribed.
    fn refuse(&mut self, fetch: &Fetch) -> Vec<SubId> {
        self.single.forget_read(fetch);
        let mut gone = Vec::new();
        for tree_id in self.trees_reading(fetch) {
            let subs = self
                .trees
                .get(&tree_id)
                .map(|tree| tree.subscribers.clone())
                .unwrap_or_default();
            for sub in subs {
                self.unregister_query(sub);
                gone.push(sub);
            }
        }
        gone
    }

    /// [`MultiTableIVM::incremental_update`], folded per row.
    fn route(&mut self, write: &WriteQuery) -> Vec<Delta> {
        let updates = self.incremental_update(write);
        self.folded(updates)
    }

    /// [`MultiTableIVM::land_read`], folded per row.
    fn land(
        &mut self,
        fetch: &Fetch,
        rows: &[(DataFrameKey, DataFrameRow)],
        worst_read: Option<&DataFrameRow>,
    ) -> Vec<Delta> {
        let updates = self.land_read(fetch, rows, worst_read);
        self.folded(updates)
    }

    /// [`MultiTableIVM::take_requests`].
    /// The inner engine's, which holds every row.
    fn alter(&mut self, change: &SchemaChange) {
        self.single.alter(change);
    }

    fn requests(&mut self) -> Vec<Fetch> {
        self.take_requests()
    }

    /// Every part of the subscription's tree is live, with no read out.
    fn hydrated(&self, sub: SubId) -> bool {
        let Some(tree) = self
            .by_sub
            .get(&sub)
            .and_then(|tree_id| self.trees.get(tree_id))
        else {
            return false;
        };
        tree.nodes.values().all(|node| {
            node.live
                && node.is_registered()
                && node
                    .inner_parts()
                    .into_iter()
                    .all(|inner| !self.single.is_pending(inner))
        })
    }

    /// The inner engine's routing counters.
    fn stats(&self) -> &IvmStats {
        self.single.stats()
    }
}
