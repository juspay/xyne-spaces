//! The query model: read (subscription) queries, write queries, and the
//! predicate tree (`Where` / `Condition`) shared by both.
//!
//! This is deliberately the engine's own representation rather than raw SQL
//! strings: predicates must be inspectable (to index them) and comparable
//! (to route writes), neither of which text allows. The SQL parser
//! (`crate::parser`) produces these types from query text.

use super::frame::{DataFrameKey, DataFrameRow};
use super::schema::{ColumnName, TableName};
use super::value::Value;

/// A subscription query: `SELECT * FROM table WHERE … ORDER BY … LIMIT …`.
///
/// `Eq` + `Hash` let structurally identical queries be compared and deduped
/// — registration uses this to serve an identical already-registered query
/// straight from the shared frame instead of re-running it; the IVM
/// forward index itself is keyed by subscription uuid.
///
/// - `table`: table name, resolved against the [`super::schema::Catalog`].
/// - `filter`: the `WHERE` predicate tree.
/// - `order_by`: the `ORDER BY` clause, one or more columns compared in
///   turn; the parser defaults it to the first declared pkey column,
///   ascending.
/// - `limit`: the `LIMIT` row cap; `u32::MAX` is the parser's spelling of
///   "no limit".
///
/// `order_by` and `limit` take part in the structural equality that twin
/// sharing matches on, so programmatic queries must reproduce the parser's
/// conventions exactly to share materialization with parsed ones.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SingleTableReadQuery {
    pub table: TableName,
    pub filter: Where,
    pub order_by: Vec<OrderBy>,
    pub limit: u32,
}

/// The engine's handle for one registered subscription: a `u64` handed out
/// by `register_query`, unique for the life of the engine and never reused.
/// The layer above the engine (the transport) maps a client's own
/// subscription ids to it; the engine never sees client ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SubId(pub u64);

impl std::fmt::Display for SubId {
    /// The bare number.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Which side of a join edge drives it: whose held rows decide the join
/// values that are *referenced*. The other side, the driven one, holds
/// only rows matching a referenced value (its filter carries
/// `driven_column IN <referenced values>`), so it is never read whole.
///
/// - `Main`: the enclosing node's rows pick the sub rows (the client's
///   `related`, a LEFT join, and an inner join evaluated from the parent).
/// - `Sub`: the sub rows pick the enclosing node's rows (a RIGHT join, and
///   an inner join evaluated from the child, `whereExists` as
///   translated).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Driver {
    Main,
    Sub,
}

/// One join edge of a [`MultiTableReadQuery`]: rows of `sub`'s main table
/// attach to rows of the enclosing node where
/// `sub.<sub_table_column> = enclosing.<main_table_column>`.
///
/// `sub` is a full multi-table query, so a leaf is a node whose `joins`
/// are empty and nesting costs nothing. Two flags spell the edge out:
///
/// - `driver`: which side's rows decide the referenced join values; the
///   other side holds only rows matching one of them.
/// - `is_inner`: whether the driver's rows need a match to be shown. An
///   outer edge keeps them (the other side being null is fine for the
///   driver's row); an inner edge shows a driver row only while a driven
///   row carries its join value.
///
/// | `driver` | `is_inner` | Reads as | Meaning |
/// |---|---|---|---|
/// | `Main` | `false` | LEFT | main rows stand; sub rows exist for referenced values and are shown under a shown main row |
/// | `Sub` | `false` | RIGHT | sub rows stand; main rows exist only for values some sub row carries |
/// | `Sub` | `true` | INNER, from the sub | main rows exist only for values some sub row carries; sub rows shown under a shown main row |
/// | `Main` | `true` | INNER, from the main | sub rows exist for referenced values; a main row is shown only while a sub row matches it |
///
/// The two inner forms show the client the same rows and differ only in
/// which side is read whole, which is the choice a planner makes by
/// flipping `driver`; nothing else in the tree moves when it does. An
/// inner edge's test may be placed anywhere in the enclosing node's
/// `WHERE` through a [`ComparisonOperator::EXISTS`] leaf naming it;
/// unnamed, it is conjoined. Below the root, the sub node of an edge the
/// main drives may carry an `order_by` / `limit` of its own: it is a
/// window **per enclosing row**, the best *n* sub rows for each value the
/// enclosing rows reference (`related` with a limit, in the client's terms). A
/// sub node that drives its edge is read whole, so its limit is an
/// ordinary window on that node. A `NULL` (or missing) join value never
/// matches, consistent with the engine's NULL semantics.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Join {
    pub sub: MultiTableReadQuery,
    pub main_table_column: ColumnName,
    pub sub_table_column: ColumnName,
    pub driver: Driver,
    pub is_inner: bool,
}

impl Join {
    /// Builds an edge attaching `sub` on
    /// `enclosing.<main_table_column> = sub.<sub_table_column>`, driven
    /// by `driver`, inner or outer.
    pub fn new(
        sub: MultiTableReadQuery,
        main_table_column: impl Into<ColumnName>,
        sub_table_column: impl Into<ColumnName>,
        driver: Driver,
        is_inner: bool,
    ) -> Self {
        Join {
            sub,
            main_table_column: main_table_column.into(),
            sub_table_column: sub_table_column.into(),
            driver,
            is_inner,
        }
    }

    /// A LEFT edge: the main rows drive and stand on their own.
    pub fn left(
        sub: MultiTableReadQuery,
        main_table_column: impl Into<ColumnName>,
        sub_table_column: impl Into<ColumnName>,
    ) -> Self {
        Join::new(
            sub,
            main_table_column,
            sub_table_column,
            Driver::Main,
            false,
        )
    }

    /// A RIGHT edge: the sub rows drive and stand on their own.
    pub fn right(
        sub: MultiTableReadQuery,
        main_table_column: impl Into<ColumnName>,
        sub_table_column: impl Into<ColumnName>,
    ) -> Self {
        Join::new(sub, main_table_column, sub_table_column, Driver::Sub, false)
    }

    /// An INNER edge evaluated from the sub: the sub rows drive and are
    /// shown only under a shown main row (`whereExists`).
    pub fn inner(
        sub: MultiTableReadQuery,
        main_table_column: impl Into<ColumnName>,
        sub_table_column: impl Into<ColumnName>,
    ) -> Self {
        Join::new(sub, main_table_column, sub_table_column, Driver::Sub, true)
    }

    /// An INNER edge evaluated from the main: the main rows drive and are
    /// shown only while a sub row matches them.
    pub fn inner_from_main(
        sub: MultiTableReadQuery,
        main_table_column: impl Into<ColumnName>,
        sub_table_column: impl Into<ColumnName>,
    ) -> Self {
        Join::new(sub, main_table_column, sub_table_column, Driver::Main, true)
    }

    /// Whether the main rows drive the edge (the sub is the driven side).
    pub fn main_drives(&self) -> bool {
        self.driver == Driver::Main
    }
}

/// How a node with a `LIMIT` that drives an inner edge — a page whose
/// rows the edge admits or rejects — is read. The server always reads a
/// page `Batched`, whatever its count (the planner leaves the value as
/// translated); `Whole` is the engine's to support for trees built by
/// hand. For every other node the value has no effect.
///
/// - `Whole`: every row the node's filter matches is read in one go and
///   held; the `LIMIT` is applied in memory. The rows the edge rejects
///   stay held, so the driven side keeps its `IN` restriction exactly.
/// - `Batched`: the window is read in batches that double from one round
///   to the next; the rows the edge rejects are dropped, and the driven
///   side routes on its own filter, looking the driver up when a write
///   concerns a dropped row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum PageRead {
    Whole,
    #[default]
    Batched,
}

/// A multi-table subscription: a tree whose every node is a single-table
/// query and every edge a [`Join`]. The root is the query the client
/// subscribed to; its `order_by` / `limit` apply to the root's rows. A
/// node's parts are numbered by the position of their edge in `joins`.
/// `page` says how the node is read when it is a page that drives an
/// inner edge ([`PageRead`]). Structurally identical trees compare equal,
/// the basis of sharing; two trees that differ only in an edge's `driver`
/// or a node's `page` are two trees.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MultiTableReadQuery {
    pub main_table: SingleTableReadQuery,
    pub joins: Vec<Join>,
    pub page: PageRead,
}

impl MultiTableReadQuery {
    /// A tree of one node: `main_table` with no joins.
    pub fn single(main_table: SingleTableReadQuery) -> Self {
        MultiTableReadQuery {
            main_table,
            joins: Vec::new(),
            page: PageRead::default(),
        }
    }

    /// A tree of `main_table` with `joins` under it.
    pub fn new(main_table: SingleTableReadQuery, joins: Vec<Join>) -> Self {
        MultiTableReadQuery {
            main_table,
            joins,
            page: PageRead::default(),
        }
    }

    /// The node at `path` (the join positions from the root).
    pub fn node_at(&self, path: &[usize]) -> Option<&MultiTableReadQuery> {
        let mut node = self;
        for &step in path {
            node = &node.joins.get(step)?.sub;
        }
        Some(node)
    }

    /// The node at `path` (the join positions from the root), mutably.
    pub fn node_at_mut(&mut self, path: &[usize]) -> Option<&mut MultiTableReadQuery> {
        let mut node = self;
        for &step in path {
            node = &mut node.joins.get_mut(step)?.sub;
        }
        Some(node)
    }

    /// Whether the tree has any edge.
    pub fn has_joins(&self) -> bool {
        !self.joins.is_empty()
    }

    /// The positions in `joins` of the node's inner edges, in order: what
    /// an `EXISTS` leaf's index counts through.
    pub fn inner_positions(&self) -> impl Iterator<Item = usize> + '_ {
        self.joins
            .iter()
            .enumerate()
            .filter(|(_, join)| join.is_inner)
            .map(|(position, _)| position)
    }

    /// The node's `index`-th inner edge: the one an `EXISTS` leaf with
    /// that index names.
    pub fn inner_join(&self, index: usize) -> Option<&Join> {
        self.joins.iter().filter(|join| join.is_inner).nth(index)
    }

    /// Every table of the tree, the node's own first and then each sub's
    /// in join order, depth first; a table used by two nodes is listed
    /// twice.
    pub fn tables(&self) -> Vec<&TableName> {
        let mut out = vec![&self.main_table.table];
        for join in &self.joins {
            out.extend(join.sub.tables());
        }
        out
    }
}

/// A write against a table — exactly one of insert / update / delete.
///
/// Writes speak the same vocabulary as the operations the engine emits: the
/// affected row is identified by a [`DataFrameKey`] and its new image
/// carried as a [`DataFrameRow`] — there is no separate record type.
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, PartialEq)]
pub enum WriteQuery {
    UPDATE(UpdateQuery),
    DELETE(DeleteQuery),
    INSERT(InsertQuery),
}

/// Update the row identified by `pkey_value`.
///
/// v1 constraint: `record` must carry the **complete new row image** —
/// every column, primary-key columns included, never just the changed
/// ones. Predicates are evaluated against it, so a partial image would
/// silently mis-evaluate conditions on omitted columns. The one exception:
/// a column the change feed reports unchanged (a large value the update
/// did not touch) may be absent, in an image marked partial
/// ([`crate::model::RowData::partial`]). The engine completes it from the
/// image it holds when it holds the row, a read being brought up
/// completes it from the read's image, and a row with no whole image at
/// hand is read again by primary key before anyone is sent it. General
/// partial updates (any column left out) are not supported.
#[derive(Debug, Clone, PartialEq)]
pub struct UpdateQuery {
    pub table: TableName,
    pub pkey_value: DataFrameKey,
    pub record: DataFrameRow,
}

/// Delete the row identified by `pkey_value`. Carries no row data — only
/// identity — so it can never move a row *into* a result set, only out.
#[derive(Debug, Clone, PartialEq)]
pub struct DeleteQuery {
    pub table: TableName,
    pub pkey_value: DataFrameKey,
}

/// Insert a new row (upsert semantics in v1: inserting an existing key
/// replaces the row). `record` carries the complete row image — every
/// column, primary-key columns included.
#[derive(Debug, Clone, PartialEq)]
pub struct InsertQuery {
    pub table: TableName,
    pub pkey_value: DataFrameKey,
    pub record: DataFrameRow,
}

/// A leaf predicate: `column <op> value`.
///
/// This is the key of the IVM reverse index, hence `Eq` + `Hash`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Condition {
    pub column: ColumnName,
    pub comparison_operator: ComparisonOperator,
    pub value: Value,
}

impl PartialOrd for Condition {
    /// Delegates to [`Ord`].
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Condition {
    /// The canonical order of conditions inside a [`Disjunct`]: by column,
    /// then operator, then [`Value::canonical_cmp`]; consistent with `Eq`.
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.column
            .cmp(&other.column)
            .then_with(|| self.comparison_operator.cmp(&other.comparison_operator))
            .then_with(|| self.value.canonical_cmp(&other.value))
    }
}

/// A predicate tree of [`Condition`]s combined with `AND` / `OR`.
///
/// `AND(vec![])` is vacuously true (a query with no filter — a full-table
/// subscription); `OR(vec![])` is vacuously false, matching SQL conventions.
///
/// This is the *raw* shape, exactly as the user's query states it. The
/// engine routes on the derived DNF shape instead — see [`Where::to_dnf`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Where {
    Condition(Condition),
    AND(Vec<Where>),
    OR(Vec<Where>),
}

/// One conjunctive clause of a DNF-normalized filter: the disjunct matches a
/// row iff **every** condition in it matches. A disjunct with no conditions
/// is vacuously true.
///
/// A full filter in DNF is an OR of disjuncts — represented simply as
/// `Vec<Disjunct>`, where the empty vec is vacuously false (`OR` of
/// nothing). Produced by [`Where::to_dnf`]; the IVM indexes and counts these
/// rather than walking `Where` trees per write.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Disjunct {
    pub conditions: Vec<Condition>,
}

impl Disjunct {
    /// A disjunct from its conditions in **canonical form**: duplicates
    /// removed and the rest sorted by [`Condition`]'s order, so two filters
    /// naming the same conditions in any order produce equal disjuncts and
    /// share one counter in the routing index.
    pub fn new(mut conditions: Vec<Condition>) -> Self {
        conditions.sort();
        conditions.dedup();
        Disjunct { conditions }
    }
}

/// The comparison operator of a leaf [`Condition`]: equality, ordering,
/// set-membership and null tests. Negation lives here (`NEQ`, `NOT_IN`,
/// `IS_NOT`) — the [`Where`] tree has no `NOT` node.
///
/// `IS` and `IS_NOT` are SQL's `IS [NOT] NULL`: the operand must be
/// `Null` (the parser accepts nothing else after `IS`); with any other
/// operand the condition follows the convention of `= NULL` and is simply
/// never true. `IS` holds for a `NULL` or absent column, `IS_NOT` for a
/// present, non-`NULL` one.
///
/// `EXISTS` is the existence test of a multi-table query, placed where the
/// author wants it in the tree: `column EXISTS Int(i)` names the node's
/// `i`-th inner edge (counting the edges with `is_inner` set, in the order
/// of `joins`; the count is unchanged by which side drives), whose
/// `main_table_column` must be `column`. At registration the join layer
/// honors it by the edge's driver: bound in place into `column IN <set>`,
/// the set of join values the sub currently produces, when the sub drives;
/// evaluated as "a sub row matches this row" when the main drives. Unbound,
/// or with any other operand, it is never true.
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ComparisonOperator {
    EQ,
    NEQ,
    GT,
    GTE,
    LT,
    LTE,
    IN,
    NOT_IN,
    IS,
    IS_NOT,
    EXISTS,
}

/// One `column ASC|DESC` of an `ORDER BY`; a query's clause is a list of
/// these, later columns breaking the earlier ones' ties.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OrderBy {
    pub column: ColumnName,
    pub direction: Order,
}

impl From<OrderBy> for Vec<OrderBy> {
    /// A one-column clause.
    fn from(order_by: OrderBy) -> Self {
        vec![order_by]
    }
}

/// Sort direction of an [`OrderBy`] clause: ascending or descending.
#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Order {
    ASC,
    DESC,
}

impl Condition {
    /// Builds a `column <op> value` leaf condition.
    pub fn new(
        column: impl Into<ColumnName>,
        comparison_operator: ComparisonOperator,
        value: impl Into<Value>,
    ) -> Self {
        Condition {
            column: column.into(),
            comparison_operator,
            value: value.into(),
        }
    }
}

impl Where {
    /// Convenience for a single-condition filter.
    pub fn condition(
        column: impl Into<ColumnName>,
        op: ComparisonOperator,
        value: impl Into<Value>,
    ) -> Self {
        Where::Condition(Condition::new(column, op, value))
    }

    /// `column IS NULL`.
    pub fn is_null(column: impl Into<ColumnName>) -> Self {
        Where::condition(column, ComparisonOperator::IS, Value::Null)
    }

    /// `column IS NOT NULL`.
    pub fn is_not_null(column: impl Into<ColumnName>) -> Self {
        Where::condition(column, ComparisonOperator::IS_NOT, Value::Null)
    }

    /// The existence test of the node's `index`-th inner edge, on the
    /// node's join column `column`; see [`ComparisonOperator::EXISTS`].
    pub fn exists(column: impl Into<ColumnName>, index: usize) -> Self {
        Where::condition(column, ComparisonOperator::EXISTS, Value::Int(index as i64))
    }

    /// Whether `condition` is one of the tree's leaves.
    pub fn contains(&self, condition: &Condition) -> bool {
        self.leaf_conditions()
            .into_iter()
            .any(|leaf| leaf == condition)
    }

    /// Whether the tree requires `condition`: the leaf stands on a path
    /// of `AND`s from the root, so no row satisfies the tree without it.
    /// A leaf only found under an `OR` is not required (another branch
    /// may hold instead).
    pub fn requires(&self, condition: &Condition) -> bool {
        match self {
            Where::Condition(leaf) => leaf == condition,
            Where::AND(children) => children.iter().any(|child| child.requires(condition)),
            Where::OR(_) => false,
        }
    }

    /// All leaf [`Condition`]s of the tree, in depth-first order — the raw
    /// syntactic leaves, duplicates and dead branches included.
    ///
    /// Note this is *not* what drives routing: the IVM indexes the
    /// [`Where::to_dnf`] disjunct conditions instead, which collapse
    /// duplicates and drop conditions in unsatisfiable branches (for
    /// `a = 1 AND FALSE`, this returns `a = 1` while the DNF is empty and
    /// nothing gets indexed).
    pub fn leaf_conditions(&self) -> Vec<&Condition> {
        let mut out = Vec::new();
        self.collect_leaves(&mut out);
        out
    }

    /// Recursive worker for [`Where::leaf_conditions`]: pushes every leaf of
    /// this subtree onto `out` in depth-first order.
    fn collect_leaves<'a>(&'a self, out: &mut Vec<&'a Condition>) {
        match self {
            Where::Condition(c) => out.push(c),
            Where::AND(children) | Where::OR(children) => {
                for child in children {
                    child.collect_leaves(out);
                }
            }
        }
    }

    /// Replace every leaf equal to `old` with `new`, in place — the seam
    /// for editing one condition's value list (a join's `IN`) without
    /// rebuilding the tree.
    pub fn replace_condition(&mut self, old: &Condition, new: &Condition) {
        match self {
            Where::Condition(condition) => {
                if condition == old {
                    *condition = new.clone();
                }
            }
            Where::AND(children) | Where::OR(children) => {
                for child in children {
                    child.replace_condition(old, new);
                }
            }
        }
    }

    /// The tree with every leaf `is_true` accepts taken as true: an `OR`
    /// holding one is true, a clause that became true drops out of its
    /// `AND`, and a tree that is nothing but true is the empty `AND`.
    pub fn assuming_true(&self, is_true: &dyn Fn(&Condition) -> bool) -> Where {
        self.assume(is_true)
            .unwrap_or_else(|| Where::AND(Vec::new()))
    }

    /// [`Where::assuming_true`]'s recursion; `None` is "true".
    fn assume(&self, is_true: &dyn Fn(&Condition) -> bool) -> Option<Where> {
        match self {
            Where::Condition(condition) => {
                (!is_true(condition)).then(|| Where::Condition(condition.clone()))
            }
            Where::AND(children) => {
                let kept: Vec<Where> = children
                    .iter()
                    .filter_map(|child| child.assume(is_true))
                    .collect();
                (!kept.is_empty()).then_some(Where::AND(kept))
            }
            Where::OR(children) => {
                let mut kept = Vec::with_capacity(children.len());
                for child in children {
                    kept.push(child.assume(is_true)?);
                }
                Some(Where::OR(kept))
            }
        }
    }

    /// Can this tree evaluate to `true` with *zero* leaf conditions
    /// matching? True for `AND(vec![])` (no filter at all) and for shapes
    /// like `x OR TRUE`. Equivalent to `to_dnf` containing an empty
    /// disjunct, without building the DNF.
    pub fn vacuously_satisfiable(&self) -> bool {
        match self {
            Where::Condition(_) => false,
            Where::AND(children) => children.iter().all(Where::vacuously_satisfiable),
            Where::OR(children) => children.iter().any(Where::vacuously_satisfiable),
        }
    }

    /// Normalize to disjunctive normal form: an OR of [`Disjunct`]s (each an
    /// AND of leaf conditions), logically equivalent to this tree.
    ///
    /// There is no `NOT` node in `Where` (negation lives inside leaf
    /// operators like `NEQ` / `NOT_IN`), so this is plain distribution of
    /// AND over OR. Identities fall out naturally: `AND(vec![])` becomes one
    /// empty disjunct (always true), `OR(vec![])` becomes zero disjuncts
    /// (never true), and a duplicated condition within one disjunct is
    /// collapsed so each disjunct's length is its exact match requirement.
    ///
    /// The result can be exponential in the alternation depth of the tree —
    /// `(a1 OR b1) AND … AND (an OR bn)` yields `2^n` disjuncts. Typical
    /// subscription filters (ANDs with small OR/IN sprinkles) stay tiny;
    /// a size cap with a tree-evaluation fallback is deliberately deferred
    /// until real workloads show the need.
    /// Every disjunct comes out in canonical form ([`Disjunct::new`]), so
    /// condition order in the source filter never affects identity.
    ///
    /// The `AND` arm folds the cross product starting from TRUE (one empty
    /// disjunct); an always-false child empties the accumulator, making the
    /// whole AND false.
    pub fn to_dnf(&self) -> Vec<Disjunct> {
        match self {
            Where::Condition(condition) => vec![Disjunct::new(vec![condition.clone()])],
            Where::OR(children) => children.iter().flat_map(Where::to_dnf).collect(),
            Where::AND(children) => {
                let mut accumulated = vec![Disjunct::new(Vec::new())];
                for child in children {
                    let child_dnf = child.to_dnf();
                    let mut next = Vec::with_capacity(accumulated.len() * child_dnf.len());
                    for left in &accumulated {
                        for right in &child_dnf {
                            let mut conditions = left.conditions.clone();
                            conditions.extend(right.conditions.iter().cloned());
                            next.push(Disjunct::new(conditions));
                        }
                    }
                    accumulated = next;
                }
                accumulated
            }
        }
    }
}

impl OrderBy {
    /// Builds an `ORDER BY column direction` clause.
    pub fn new(column: impl Into<ColumnName>, direction: Order) -> Self {
        OrderBy {
            column: column.into(),
            direction,
        }
    }
}

impl SingleTableReadQuery {
    /// Builds a subscription query from its four clauses; `order_by`
    /// takes one [`OrderBy`] or a list of them.
    pub fn new(
        table: impl Into<TableName>,
        filter: Where,
        order_by: impl Into<Vec<OrderBy>>,
        limit: u32,
    ) -> Self {
        SingleTableReadQuery {
            table: table.into(),
            filter,
            order_by: order_by.into(),
            limit,
        }
    }
}

impl WriteQuery {
    /// The name of the table this write targets.
    pub fn table(&self) -> &TableName {
        match self {
            WriteQuery::UPDATE(q) => &q.table,
            WriteQuery::DELETE(q) => &q.table,
            WriteQuery::INSERT(q) => &q.table,
        }
    }

    /// The identity of the affected row.
    pub fn pkey_value(&self) -> &DataFrameKey {
        match self {
            WriteQuery::UPDATE(q) => &q.pkey_value,
            WriteQuery::DELETE(q) => &q.pkey_value,
            WriteQuery::INSERT(q) => &q.pkey_value,
        }
    }

    /// The complete row image *after* this write — the record exactly as
    /// carried, which must hold every column, primary-key columns included
    /// (see [`UpdateQuery`]); nothing is merged in here. `None` for
    /// deletes, which carry no row data.
    ///
    /// Predicates are evaluated against this image, so a record missing a
    /// column would silently mis-evaluate conditions on it.
    pub fn new_row_image(&self) -> Option<&DataFrameRow> {
        match self {
            WriteQuery::UPDATE(q) => Some(&q.record),
            WriteQuery::INSERT(q) => Some(&q.record),
            WriteQuery::DELETE(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ComparisonOperator::EQ;

    /// Shorthand for a single `column = value` leaf [`Where`].
    fn c(column: &str, value: i32) -> Where {
        Where::condition(column, EQ, value)
    }

    /// Builds the expected [`Disjunct`] of `column = value` conditions.
    fn disjunct(pairs: &[(&str, i32)]) -> Disjunct {
        Disjunct {
            conditions: pairs
                .iter()
                .map(|(column, value)| Condition::new(*column, EQ, *value))
                .collect(),
        }
    }

    /// A lone leaf condition normalizes to exactly one one-condition disjunct.
    #[test]
    fn single_condition_is_one_singleton_disjunct() {
        assert_eq!(c("a", 1).to_dnf(), vec![disjunct(&[("a", 1)])]);
    }

    /// OR children concatenate their disjuncts, and AND distributes over OR:
    /// `(a OR b) AND (c OR d)` yields the cross product `ac, ad, bc, bd`.
    #[test]
    fn or_concatenates_and_distributes_over_and() {
        let or = Where::OR(vec![c("a", 1), c("b", 2)]);
        assert_eq!(
            or.to_dnf(),
            vec![disjunct(&[("a", 1)]), disjunct(&[("b", 2)])]
        );

        let cross = Where::AND(vec![
            Where::OR(vec![c("a", 1), c("b", 2)]),
            Where::OR(vec![c("c", 3), c("d", 4)]),
        ]);
        assert_eq!(
            cross.to_dnf(),
            vec![
                disjunct(&[("a", 1), ("c", 3)]),
                disjunct(&[("a", 1), ("d", 4)]),
                disjunct(&[("b", 2), ("c", 3)]),
                disjunct(&[("b", 2), ("d", 4)]),
            ]
        );
    }

    /// The boolean identities: TRUE (`AND(vec![])`) is one empty disjunct,
    /// FALSE (`OR(vec![])`) is no disjuncts, `x AND FALSE` annihilates to
    /// FALSE, and `x OR TRUE` keeps its vacuous disjunct.
    #[test]
    fn identities_true_false_and_annihilation() {
        assert_eq!(Where::AND(vec![]).to_dnf(), vec![disjunct(&[])]);
        assert_eq!(Where::OR(vec![]).to_dnf(), Vec::<Disjunct>::new());
        assert_eq!(
            Where::AND(vec![c("x", 1), Where::OR(vec![])]).to_dnf(),
            Vec::<Disjunct>::new()
        );
        assert_eq!(
            Where::OR(vec![c("x", 1), Where::AND(vec![])]).to_dnf(),
            vec![disjunct(&[("x", 1)]), disjunct(&[])]
        );
    }

    /// `a AND a` must require ONE match, not two — the disjunct's length is
    /// the engine's exact firing threshold.
    #[test]
    fn duplicate_condition_in_a_conjunction_collapses() {
        assert_eq!(
            Where::AND(vec![c("a", 1), c("a", 1)]).to_dnf(),
            vec![disjunct(&[("a", 1)])]
        );
    }
}
