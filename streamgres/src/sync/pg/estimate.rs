//! Sizing a tree from PostgreSQL's estimates instead of counting it
//! ([`Storage::estimate`](crate::sync::Storage::estimate)): one round
//! trip of `EXPLAIN`s and a read of `pg_stats`, nothing executed.
//!
//! A count ([`super::sql::count_sql`]) nests every inner edge as a
//! correlated `EXISTS`. Under an `OR`, PostgreSQL cannot make that a
//! join: it walks the node's table and probes the sub once per row, which
//! is the cost the planner is deciding whether to avoid. Its own estimate
//! of that shape is no better: an `EXISTS` under an `OR` is taken to hold
//! for half the rows. So the tree is sized here the way it is read, one
//! table at a time, from the leaves up:
//!
//! - **A node by itself** is PostgreSQL's estimate of its own filter,
//!   `EXPLAIN SELECT 1 FROM t WHERE …`: the same statistics the planner
//!   runs on (most common values, histograms, null fractions), nothing
//!   read.
//! - **An inner edge** is a variable: the node's rows whose join value is
//!   among the values the sub's rows carry. The sub is sized first; the
//!   distinct values its rows carry are estimated from the column's
//!   distinct count (Yao's formula: `k` rows of `T`, `T/D` rows per value,
//!   reach `D·(1 − (1 − k/T)^(T/D))` of the `D` values), and the share of
//!   the node's rows reached is that many of its own column's distinct
//!   values, less its `NULL`s — the containment PostgreSQL assumes for a
//!   semi-join, and Zero's fan-out from `sqlite_stat4`.
//! - **The node with its subs** is its filter under every assignment of
//!   those variables, each assignment's filter estimated by `EXPLAIN` and
//!   weighted by the chance of the assignment, the variables taken as
//!   independent of each other and of the rest of the filter. A filter
//!   `userId = me OR EXISTS channel(…)` is so `rows(userId = me)` while
//!   the edge is false and the whole table while it is true: the reader's
//!   own rows plus the rows the channels reach.
//!
//! The `EXPLAIN`s of the tree, deduplicated, and the statistics query go
//! out as one batch ([`batch`]); [`parse`] reads the answers and
//! [`Estimation::evaluate`] sizes the tree from them. Each statement and
//! each column's statistics stands alone, so the storage remembers them
//! one by one and asks only for those no earlier tree asked (see
//! [`super::estimate_cache`]). A tree that cannot be sized this way — a node with more
//! than [`MAX_EDGES`] inner edges, a join column PostgreSQL has no
//! statistics for (a table never analyzed) — is an error, and the caller
//! counts it instead.

use std::collections::HashMap;

use tokio_postgres::SimpleQueryMessage;

use super::sql;
use crate::model::{Catalog, ComparisonOperator, MultiTableReadQuery, Value, Where};

/// The most inner edges one node may have: its filter is estimated under
/// every assignment of them, `2^n`, though most come out the same.
pub const MAX_EDGES: usize = 8;

/// How one assignment of a node's edges leaves its filter.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Term {
    /// Never true: no row.
    False,
    /// The rows the statement at this index estimates (the whole table's
    /// statement when the filter is true).
    Rows(usize),
}

/// One node of the tree being sized.
///
/// - `table`: its table.
/// - `total`: the statement estimating the whole table.
/// - `edges`: its inner edges, in the order `EXISTS` leaves name them.
/// - `terms`: one per assignment of the edges, bit `i` of the index the
///   value of edge `i`.
#[derive(Debug)]
struct Node {
    table: String,
    total: usize,
    edges: Vec<Edge>,
    terms: Vec<Term>,
}

/// An inner edge: the node's `main_column` against the sub's
/// `sub_column`.
#[derive(Debug)]
struct Edge {
    main_column: String,
    sub_column: String,
    sub: Node,
}

/// What `pg_stats` says of one column: the share of its rows that are
/// `NULL`, and its distinct values (a negative number is minus their
/// share of the rows, as PostgreSQL keeps it).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ColumnStats {
    pub null_frac: f64,
    pub n_distinct: f64,
}

/// The statistics of join columns by `(table, column)`.
pub type Statistics = HashMap<(String, String), ColumnStats>;

/// The statements sizing one tree, each with the table it estimates, the
/// join columns whose statistics it needs, and the tree they size.
#[derive(Debug)]
pub struct Estimation {
    statements: Vec<(String, String)>,
    columns: Vec<(String, String)>,
    root: Node,
}

impl Estimation {
    /// The statements sizing `query`'s main table with every inner edge
    /// answered by its sub, as [`super::sql::count_sql`] counts it: an
    /// `EXISTS` naming no inner edge is false, an inner edge no leaf names
    /// is required, an outer edge plays no part. A table the catalog does
    /// not describe, or a node with more than [`MAX_EDGES`] inner edges, is
    /// the error.
    pub fn new(query: &MultiTableReadQuery, catalog: &Catalog) -> Result<Self, String> {
        let mut building = Building {
            catalog,
            statements: Vec::new(),
            index: HashMap::new(),
            columns: Vec::new(),
        };
        let root = building.node(query)?;
        Ok(Estimation {
            statements: building.statements,
            columns: building.columns,
            root,
        })
    }

    /// Every statement and join column of the tree as one batch.
    pub fn batch(&self) -> String {
        let statements: Vec<&str> = self.statements.iter().map(|(_, sql)| sql.as_str()).collect();
        let columns: Vec<(&str, &str)> = self
            .columns
            .iter()
            .map(|(table, column)| (table.as_str(), column.as_str()))
            .collect();
        batch(&statements, &columns)
    }

    /// The statements, in the order [`Estimation::evaluate`] takes their
    /// estimates: each `(table, EXPLAIN)`.
    pub fn statements(&self) -> &[(String, String)] {
        &self.statements
    }

    /// The join columns whose statistics the tree needs, `(table, column)`.
    pub fn columns(&self) -> &[(String, String)] {
        &self.columns
    }

    /// The rows [`Estimation::batch`]'s answer puts the tree at, no higher
    /// than `cap`.
    pub fn rows(&self, messages: Vec<SimpleQueryMessage>, cap: u64) -> Result<u64, String> {
        let (explained, stats) = parse(messages, self.statements.len(), !self.columns.is_empty())?;
        Ok(capped(self.evaluate(&explained, &stats)?, cap))
    }

    /// The tree's rows from the statements' estimates (in statement order)
    /// and the join columns' statistics.
    pub fn evaluate(
        &self,
        explained: &[f64],
        stats: &Statistics,
    ) -> Result<f64, String> {
        node_rows(&self.root, explained, stats)
    }
}

/// `statements` (`EXPLAIN`s), then the statistics of `columns` (`(table,
/// column)`, none: no statistics query), as one simple-query batch.
pub fn batch(statements: &[&str], columns: &[(&str, &str)]) -> String {
    let mut batch = statements.join("; ");
    if !columns.is_empty() {
        let pairs: Vec<String> = columns
            .iter()
            .map(|(table, column)| {
                format!("({}, {})", sql::quote_literal(table), sql::quote_literal(column))
            })
            .collect();
        if !batch.is_empty() {
            batch.push_str("; ");
        }
        batch.push_str(&format!(
            "SELECT tablename, attname, null_frac, n_distinct FROM pg_stats \
             WHERE schemaname = ANY (current_schemas(false)) \
             AND (tablename, attname) IN ({}) ORDER BY inherited",
            pairs.join(", ")
        ));
    }
    batch
}

/// The answer to a [`batch`] of `statements` `EXPLAIN`s and, when
/// `columns`, a statistics query: each statement's estimated rows, in
/// order, and the statistics of the columns `pg_stats` has (a column it
/// lacks is absent).
pub fn parse(
    messages: Vec<SimpleQueryMessage>,
    statements: usize,
    columns: bool,
) -> Result<(Vec<f64>, Statistics), String> {
    let results = split(messages);
    if results.len() != statements + usize::from(columns) {
        return Err(format!(
            "{} results for {statements} statements",
            results.len()
        ));
    }
    let explained = results[..statements]
        .iter()
        .map(|rows| plan_rows(rows))
        .collect::<Result<Vec<f64>, String>>()?;
    let mut stats = HashMap::new();
    if let Some(rows) = results.get(statements) {
        for row in rows {
            let field = |index: usize| row.get(index).unwrap_or_default();
            let number = |index: usize| {
                field(index)
                    .parse::<f64>()
                    .map_err(|_| format!("`{}` is not a number", field(index)))
            };
            stats
                .entry((field(0).to_owned(), field(1).to_owned()))
                .or_insert(ColumnStats {
                    null_frac: number(2)?,
                    n_distinct: number(3)?,
                });
        }
    }
    Ok((explained, stats))
}

/// `rows`, estimated, as a count no higher than `cap`.
pub fn capped(rows: f64, cap: u64) -> u64 {
    (rows.round().max(0.0) as u64).min(cap)
}

/// The state of [`Estimation::new`]: the statements so far, each once,
/// and the join columns whose statistics are wanted.
struct Building<'a> {
    catalog: &'a Catalog,
    statements: Vec<(String, String)>,
    index: HashMap<String, usize>,
    columns: Vec<(String, String)>,
}

impl Building<'_> {
    /// The index of `filter`'s estimate over `table`, adding the statement
    /// the first time.
    fn statement(&mut self, table: &str, filter: &Where) -> Result<usize, String> {
        let declared = self
            .catalog
            .table(table)
            .ok_or_else(|| format!("table `{table}` is not in the catalog"))?;
        let statement = sql::explain_sql(table, declared, filter);
        if let Some(&index) = self.index.get(&statement) {
            return Ok(index);
        }
        self.statements.push((table.to_owned(), statement.clone()));
        self.index.insert(statement, self.statements.len() - 1);
        Ok(self.statements.len() - 1)
    }

    /// `column` of `table` among the statistics wanted.
    fn column(&mut self, table: &str, column: &str) {
        let pair = (table.to_owned(), column.to_owned());
        if !self.columns.contains(&pair) {
            self.columns.push(pair);
        }
    }

    /// The node `query` and everything below it.
    fn node(&mut self, query: &MultiTableReadQuery) -> Result<Node, String> {
        let table = query.main_table.table.as_str().to_owned();
        let total = self.statement(&table, &Where::AND(Vec::new()))?;
        let inner: Vec<&crate::model::Join> =
            query.joins.iter().filter(|join| join.is_inner).collect();
        if inner.len() > MAX_EDGES {
            return Err(format!(
                "`{table}` has {} inner edges, more than {MAX_EDGES}",
                inner.len()
            ));
        }
        let filter = &query.main_table.filter;
        let named: Vec<bool> = (0..inner.len())
            .map(|index| {
                filter.leaf_conditions().into_iter().any(|leaf| {
                    leaf.comparison_operator == ComparisonOperator::EXISTS
                        && exists_index(&leaf.value) == Some(index)
                })
            })
            .collect();
        let mut terms = Vec::with_capacity(1 << inner.len());
        for assignment in 0..(1usize << inner.len()) {
            let holds = |index: usize| index < inner.len() && assignment & (1 << index) != 0;
            let required = (0..inner.len()).all(|index| named[index] || holds(index));
            let term = match required.then(|| substitute(filter, &holds)) {
                None | Some(Truth::False) => Term::False,
                Some(Truth::True) => Term::Rows(total),
                Some(Truth::Filter(rest)) => Term::Rows(self.statement(&table, &rest)?),
            };
            terms.push(term);
        }
        let mut edges = Vec::with_capacity(inner.len());
        for join in inner {
            self.column(&table, join.main_table_column.as_str());
            self.column(
                join.sub.main_table.table.as_str(),
                join.sub_table_column.as_str(),
            );
            edges.push(Edge {
                main_column: join.main_table_column.as_str().to_owned(),
                sub_column: join.sub_table_column.as_str().to_owned(),
                sub: self.node(&join.sub)?,
            });
        }
        Ok(Node {
            table,
            total,
            edges,
            terms,
        })
    }
}

/// A filter with its `EXISTS` leaves decided: always true, never true, or
/// what is left of it.
#[derive(Debug, Clone, PartialEq)]
enum Truth {
    True,
    False,
    Filter(Where),
}

/// `filter` with every `EXISTS` leaf naming inner edge `i` replaced by
/// `holds(i)`, and one naming none by false, simplified.
fn substitute(filter: &Where, holds: &dyn Fn(usize) -> bool) -> Truth {
    match filter {
        Where::Condition(condition) if condition.comparison_operator == ComparisonOperator::EXISTS => {
            match exists_index(&condition.value) {
                Some(index) if holds(index) => Truth::True,
                _ => Truth::False,
            }
        }
        Where::Condition(condition) => Truth::Filter(Where::Condition(condition.clone())),
        Where::AND(children) => {
            let mut kept = Vec::new();
            for child in children {
                match substitute(child, holds) {
                    Truth::True => {}
                    Truth::False => return Truth::False,
                    Truth::Filter(rest) => kept.push(rest),
                }
            }
            match kept.len() {
                0 => Truth::True,
                1 => Truth::Filter(kept.remove(0)),
                _ => Truth::Filter(Where::AND(kept)),
            }
        }
        Where::OR(children) => {
            let mut kept = Vec::new();
            for child in children {
                match substitute(child, holds) {
                    Truth::True => return Truth::True,
                    Truth::False => {}
                    Truth::Filter(rest) => kept.push(rest),
                }
            }
            match kept.len() {
                0 => Truth::False,
                1 => Truth::Filter(kept.remove(0)),
                _ => Truth::Filter(Where::OR(kept)),
            }
        }
    }
}

/// The inner edge an `EXISTS` leaf's operand names, if it names one.
fn exists_index(operand: &Value) -> Option<usize> {
    match operand {
        Value::Int(index) => usize::try_from(*index).ok(),
        _ => None,
    }
}

/// The rows of `node` with its edges answered by its subs: the sum over
/// every assignment of the edges of its chance times the rows its filter
/// keeps under it.
fn node_rows(
    node: &Node,
    explained: &[f64],
    stats: &Statistics,
) -> Result<f64, String> {
    let total = explained[node.total].max(1.0);
    let mut shares = Vec::with_capacity(node.edges.len());
    for edge in &node.edges {
        let sub_rows = node_rows(&edge.sub, explained, stats)?;
        let sub_total = explained[edge.sub.total].max(1.0);
        let main = column_stats(stats, &node.table, &edge.main_column)?;
        let sub = column_stats(stats, &edge.sub.table, &edge.sub_column)?;
        shares.push(reached(sub_rows, sub_total, sub, total, main));
    }
    let mut rows = 0.0;
    for (assignment, term) in node.terms.iter().enumerate() {
        let Term::Rows(statement) = term else { continue };
        let chance: f64 = shares
            .iter()
            .enumerate()
            .map(|(index, share)| {
                if assignment & (1 << index) != 0 {
                    *share
                } else {
                    1.0 - share
                }
            })
            .product();
        rows += chance * explained[*statement];
    }
    Ok(rows.min(total))
}

/// The statistics of `table.column`, or the error that it has none.
fn column_stats(
    stats: &Statistics,
    table: &str,
    column: &str,
) -> Result<ColumnStats, String> {
    stats
        .get(&(table.to_owned(), column.to_owned()))
        .copied()
        .ok_or_else(|| format!("no statistics for `{table}`.`{column}` (never analyzed?)"))
}

/// The distinct values of a column of `stats` over a table of `total`
/// rows, at least one.
fn distinct(stats: ColumnStats, total: f64) -> f64 {
    let values = if stats.n_distinct < 0.0 {
        -stats.n_distinct * total
    } else {
        stats.n_distinct
    };
    values.max(1.0)
}

/// The share of a node's rows (`total` of them, the join column's
/// statistics `main`) whose join value is among those carried by
/// `sub_rows` of the sub's `sub_total` rows (its join column's statistics
/// `sub`).
fn reached(sub_rows: f64, sub_total: f64, sub: ColumnStats, total: f64, main: ColumnStats) -> f64 {
    if main.null_frac >= 1.0 || sub.null_frac >= 1.0 {
        return 0.0;
    }
    let sub_values = distinct(sub, sub_total);
    let per_value = (sub_total * (1.0 - sub.null_frac) / sub_values).max(1.0);
    let taken = (sub_rows / sub_total).clamp(0.0, 1.0);
    let keys = sub_values * (1.0 - (1.0 - taken).powf(per_value));
    let main_values = distinct(main, total);
    ((keys / main_values).min(1.0) * (1.0 - main.null_frac)).clamp(0.0, 1.0)
}

/// The rows of each statement of a batch, in order: one entry per
/// statement that completed.
fn split(messages: Vec<SimpleQueryMessage>) -> Vec<Vec<tokio_postgres::SimpleQueryRow>> {
    let mut results = Vec::new();
    let mut rows = Vec::new();
    for message in messages {
        match message {
            SimpleQueryMessage::Row(row) => rows.push(row),
            SimpleQueryMessage::CommandComplete(_) => results.push(std::mem::take(&mut rows)),
            _ => {}
        }
    }
    results
}

/// The `Plan Rows` of an `EXPLAIN (FORMAT JSON)`'s top node.
fn plan_rows(rows: &[tokio_postgres::SimpleQueryRow]) -> Result<f64, String> {
    let text = rows
        .first()
        .and_then(|row| row.get(0))
        .ok_or_else(|| "an EXPLAIN returned no plan".to_owned())?;
    let plan: serde_json::Value =
        serde_json::from_str(text).map_err(|error| format!("an EXPLAIN's plan: {error}"))?;
    plan.pointer("/0/Plan/Plan Rows")
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| "an EXPLAIN's plan has no `Plan Rows`".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        DbColumn, DbTable, Join, Order, OrderBy, SingleTableReadQuery, ValueType,
    };

    /// A catalog of `(table, columns)`, every column a string, `id` the key.
    fn catalog(tables: &[(&str, &[&str])]) -> Catalog {
        Catalog::new(tables.iter().map(|(name, columns)| {
            let columns = columns
                .iter()
                .map(|column| DbColumn::new(*column, ValueType::String))
                .collect();
            DbTable::new(*name, ["id"], columns)
        }))
    }

    fn node(table: &str, filter: Where) -> SingleTableReadQuery {
        SingleTableReadQuery::new(table, filter, OrderBy::new("id", Order::ASC), u32::MAX)
    }

    fn eq(column: &str, value: &str) -> Where {
        Where::condition(column, ComparisonOperator::EQ, value)
    }

    fn stats(entries: &[(&str, &str, f64, f64)]) -> Statistics {
        entries
            .iter()
            .map(|(table, column, null_frac, n_distinct)| {
                (
                    (table.to_string(), column.to_string()),
                    ColumnStats {
                        null_frac: *null_frac,
                        n_distinct: *n_distinct,
                    },
                )
            })
            .collect()
    }

    /// participants: `userId = me OR EXISTS channel_members(userId = me)`
    /// on `channelId`.
    fn participants_by_channel() -> MultiTableReadQuery {
        MultiTableReadQuery::new(
            node(
                "participants",
                Where::OR(vec![
                    eq("userId", "me"),
                    Where::exists("channelId", 0),
                ]),
            ),
            vec![Join::inner(
                MultiTableReadQuery::single(node("channel_members", eq("userId", "me"))),
                "channelId",
                "channelId",
            )],
        )
    }

    fn probe_catalog() -> Catalog {
        catalog(&[
            ("participants", &["id", "userId", "channelId"]),
            ("channel_members", &["id", "userId", "channelId"]),
        ])
    }

    /// A node alone is one statement: its own filter.
    #[test]
    fn a_node_without_edges_is_its_filter() {
        let query = MultiTableReadQuery::single(node("participants", eq("userId", "me")));
        let estimation = Estimation::new(&query, &probe_catalog()).expect("estimation");
        assert_eq!(estimation.statements().len(), 2, "the whole table and the filter");
        assert_eq!(estimation.statements()[1].0, "participants");
        assert!(estimation.statements()[1].1.contains(r#""userId" = 'me'"#));
        let rows = estimation
            .evaluate(&[1_500_000.0, 709.0], &HashMap::new())
            .expect("rows");
        assert_eq!(rows, 709.0);
    }

    /// `A OR EXISTS`: the filter is `A` while the edge is false and the
    /// whole table while it is true; the channel members' 549 channels,
    /// of 29 572 the participants carry (half of them `NULL`), reach
    /// 549/29 572 of the participants with a channel. The numbers are the
    /// 2026-10-13 probe's medium user's true counts (709 participants of
    /// their own, 549 memberships, 14 638 participants counted), so the
    /// formula alone is under test.
    #[test]
    fn an_edge_under_or_weighs_the_table_by_the_rows_it_reaches() {
        let estimation =
            Estimation::new(&participants_by_channel(), &probe_catalog()).expect("estimation");
        // participants whole, participants userId = me, channel_members
        // whole, channel_members userId = me.
        assert_eq!(estimation.statements().len(), 4);
        assert_eq!(estimation.root.terms, vec![Term::Rows(1), Term::Rows(0)]);
        let explained = [1_500_000.0, 709.0, 591_039.0, 549.0];
        let stats = stats(&[
            ("participants", "channelId", 0.4994, 29_572.0),
            ("channel_members", "channelId", 0.0, 29_129.0),
        ]);
        let rows = estimation.evaluate(&explained, &stats).expect("rows");
        assert!((14_000.0..15_000.0).contains(&rows), "{rows}");
    }

    /// An inner edge no leaf names is required: an assignment where it is
    /// false keeps nothing.
    #[test]
    fn an_unnamed_edge_is_required() {
        let mut query = participants_by_channel();
        query.main_table.filter = eq("userId", "me");
        let estimation = Estimation::new(&query, &probe_catalog()).expect("estimation");
        assert_eq!(estimation.root.terms, vec![Term::False, Term::Rows(1)]);
    }

    /// An `EXISTS` naming no inner edge is false, as the count has it.
    #[test]
    fn an_exists_naming_no_edge_is_false() {
        let mut query = participants_by_channel();
        query.main_table.filter =
            Where::OR(vec![eq("userId", "me"), Where::exists("channelId", 3)]);
        let estimation = Estimation::new(&query, &probe_catalog()).expect("estimation");
        // edge 0 unnamed (required); `EXISTS 3` false whatever edge 0 is.
        assert_eq!(estimation.root.terms, vec![Term::False, Term::Rows(1)]);
        assert!(estimation.statements()[1].1.ends_with(r#"WHERE "userId" = 'me'"#));
        let required = Where::AND(vec![eq("userId", "me"), Where::exists("channelId", 70)]);
        assert_eq!(substitute(&required, &|index| index < 1), Truth::False);
    }

    /// Yao: every row of a unique column carries its own value; a column
    /// of few values is covered long before every row is taken.
    #[test]
    fn the_values_a_sub_carries_follow_its_column() {
        let unique = ColumnStats {
            null_frac: 0.0,
            n_distinct: -1.0,
        };
        // 300 of 1 000 sub rows, a unique sub column, against a unique main
        // column of 1 000 rows: 300 of them.
        let share = reached(300.0, 1_000.0, unique, 1_000.0, unique);
        assert!((share - 0.3).abs() < 1e-9, "{share}");
        // 300 of 1 000 sub rows over 10 values: all 10 are carried.
        let few = ColumnStats {
            null_frac: 0.0,
            n_distinct: 10.0,
        };
        let share = reached(300.0, 1_000.0, few, 10.0, few);
        assert!(share > 0.99, "{share}");
    }

    /// A join column with no statistics is the error: the caller counts.
    #[test]
    fn a_column_without_statistics_is_the_error() {
        let estimation =
            Estimation::new(&participants_by_channel(), &probe_catalog()).expect("estimation");
        let error = estimation
            .evaluate(&[1.0, 1.0, 1.0, 1.0], &HashMap::new())
            .expect_err("no stats");
        assert!(error.contains("no statistics"), "{error}");
    }

    /// The batch is the statements, then one statistics query naming
    /// every join column.
    #[test]
    fn the_batch_asks_the_join_columns_statistics() {
        let estimation =
            Estimation::new(&participants_by_channel(), &probe_catalog()).expect("estimation");
        let batch = estimation.batch();
        assert_eq!(batch.matches("EXPLAIN (FORMAT JSON)").count(), 4);
        assert!(batch.contains("('participants', 'channelId'), ('channel_members', 'channelId')"));
        assert_eq!(
            estimation.columns(),
            [
                ("participants".to_owned(), "channelId".to_owned()),
                ("channel_members".to_owned(), "channelId".to_owned())
            ]
        );
        let only_stats = super::batch(&[], &[("participants", "channelId")]);
        assert!(only_stats.starts_with("SELECT tablename"), "{only_stats}");
    }
}
