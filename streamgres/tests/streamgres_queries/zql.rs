//! A ZQL-shaped builder over the query model, so each test reads like the
//! query it mirrors: `zql("tickets").eq("channelId", "c1").related("project",
//! same).where_exists("assignments", |a| a.eq("userId", ME))`. `related`
//! becomes a LEFT edge (the client preserves the parent), `where_exists` an
//! INNER edge (the parent shows only while a child matches, the child only
//! under a shown parent), both joined on the columns the schema declares
//! for the relationship; `exists` returns the INNER edge's test as a leaf
//! to place anywhere in a predicate tree. `start` renders the client's keyset
//! cursor as the equivalent `WHERE` over the sort columns, and every
//! `order_by` column reaches the model in order. A single-table query also
//! renders to the SQL the parser accepts, which the harness uses to check
//! parser and builder agree.

use std::collections::HashMap;

use streamgres::ivm::QueryPart;
use streamgres::model::ComparisonOperator::{
    EQ, EXISTS, GT, GTE, IN, IS, IS_NOT, LT, LTE, NEQ, NOT_IN,
};
use streamgres::model::{
    ComparisonOperator, Join, MultiTableReadQuery, Order, OrderBy, SingleTableReadQuery, Value,
    Where,
};

use super::catalog::{pkey, rel};

/// A `column <op> value` leaf.
pub fn cmp(column: &str, op: ComparisonOperator, value: impl Into<Value>) -> Where {
    Where::condition(column, op, value)
}

/// A `column = value` leaf.
pub fn eq(column: &str, value: impl Into<Value>) -> Where {
    cmp(column, EQ, value)
}

/// A `column IS NULL` leaf, the client's `.where(column, 'IS', null)`.
pub fn is_null(column: &str) -> Where {
    Where::is_null(column)
}

/// A `column IS NOT NULL` leaf, the client's `.where(column, 'IS NOT', null)`.
pub fn is_not_null(column: &str) -> Where {
    Where::is_not_null(column)
}

/// An `OR` of `parts`.
pub fn or(parts: Vec<Where>) -> Where {
    Where::OR(parts)
}

/// An `AND` of `parts`.
pub fn and(parts: Vec<Where>) -> Where {
    Where::AND(parts)
}

/// A list literal of strings, the operand of `IN` / `NOT IN`.
pub fn strings(items: &[&str]) -> Value {
    Value::List(items.iter().map(|item| Value::from(*item)).collect())
}

/// The identity sub-query: `related("project", same)` attaches every
/// related row.
pub fn same(query: Q) -> Q {
    query
}

/// One node of a query tree under construction.
///
/// - `table`: the node's table.
/// - `filters`: the `where` calls, conjoined.
/// - `order`: the `order_by` columns, in order.
/// - `limit`: the row cap, `u32::MAX` for none.
/// - `left`: the `related` edges; `right`: the `where_exists` edges, each
///   with the relationship name they were declared with.
#[derive(Clone)]
pub struct Q {
    table: &'static str,
    filters: Vec<Where>,
    order: Vec<(String, Order)>,
    limit: u32,
    left: Vec<(String, Q)>,
    inner: Vec<(String, Q)>,
}

/// Start a query on `table`, like `zql.table`.
pub fn zql(table: &'static str) -> Q {
    Q {
        table,
        filters: Vec::new(),
        order: Vec::new(),
        limit: u32::MAX,
        left: Vec::new(),
        inner: Vec::new(),
    }
}

impl Q {
    /// The node's table.
    pub fn table(&self) -> &'static str {
        self.table
    }

    /// `.where(column, op, value)`.
    pub fn where_(mut self, column: &str, op: ComparisonOperator, value: impl Into<Value>) -> Q {
        self.filters.push(cmp(column, op, value));
        self
    }

    /// `.where(column, value)`: equality.
    pub fn eq(self, column: &str, value: impl Into<Value>) -> Q {
        self.where_(column, EQ, value)
    }

    /// `.where(column, 'IS', null)`.
    pub fn where_is_null(self, column: &str) -> Q {
        self.filter(is_null(column))
    }

    /// `.where(column, 'IS NOT', null)`.
    pub fn where_is_not_null(self, column: &str) -> Q {
        self.filter(is_not_null(column))
    }

    /// `.where(column, 'IN', values)`.
    pub fn in_(self, column: &str, values: &[&str]) -> Q {
        self.where_(column, IN, strings(values))
    }

    /// `.where(column, 'NOT IN', values)`.
    pub fn not_in(self, column: &str, values: &[&str]) -> Q {
        self.where_(column, NOT_IN, strings(values))
    }

    /// `.where(helpers => ...)`: any predicate tree.
    pub fn filter(mut self, filter: Where) -> Q {
        self.filters.push(filter);
        self
    }

    /// `.related(name, sub)`: a LEFT edge to the relationship's table.
    pub fn related(mut self, name: &str, sub: impl FnOnce(Q) -> Q) -> Q {
        let edge = rel(self.table, name);
        self.left.push((name.to_owned(), sub(zql(edge.dest_table))));
        self
    }

    /// `.whereExists(name, sub)`: an INNER edge to the relationship's
    /// table, conjoined with the node's filter.
    pub fn where_exists(mut self, name: &str, sub: impl FnOnce(Q) -> Q) -> Q {
        self.exists(name, sub);
        self
    }

    /// `exists(name, sub)` inside a `where` helper: an INNER edge to the
    /// relationship's table plus the `EXISTS` leaf that places it, for the
    /// caller to put anywhere in a predicate tree.
    pub fn exists(&mut self, name: &str, sub: impl FnOnce(Q) -> Q) -> Where {
        let edge = rel(self.table, name);
        self.inner
            .push((name.to_owned(), sub(zql(edge.dest_table))));
        Where::exists(edge.source, self.inner.len() - 1)
    }

    /// `.orderBy(column, direction)`; later calls add tiebreak columns.
    pub fn order_by(mut self, column: &str, direction: Order) -> Q {
        self.order.push((column.to_owned(), direction));
        self
    }

    /// `.limit(n)`.
    pub fn limit(mut self, limit: u32) -> Q {
        self.limit = limit;
        self
    }

    /// `.one()`: a limit of one.
    pub fn one(self) -> Q {
        self.limit(1)
    }

    /// `.start(row, { inclusive })`: the keyset cursor over the sort
    /// columns, as the `WHERE` it means.
    pub fn start(self, keys: &[(&str, Order, Value)], inclusive: bool) -> Q {
        self.filter(keyset(keys, inclusive))
    }

    /// The model query, and the name of every part by its path: `main`, then
    /// relationship names, an INNER edge's prefixed `has:`, nested ones
    /// dotted (`conversation.has:channel`).
    pub fn build(&self) -> (MultiTableReadQuery, HashMap<QueryPart, String>) {
        let mut names = HashMap::new();
        let query = self.node(Vec::new(), "main", &mut names);
        (query, names)
    }

    /// Build this node at `path` under the name `name`, recursing into its
    /// edges: left joins are numbered first, inner joins after them (the
    /// builder issues no right joins).
    fn node(
        &self,
        path: Vec<usize>,
        name: &str,
        names: &mut HashMap<QueryPart, String>,
    ) -> MultiTableReadQuery {
        names.insert(QueryPart::new(&path), name.to_owned());
        let order_by: Vec<OrderBy> = if self.order.is_empty() {
            vec![OrderBy::new(pkey(self.table), Order::ASC)]
        } else {
            self.order
                .iter()
                .map(|(column, direction)| OrderBy::new(column.as_str(), *direction))
                .collect()
        };
        let main_table = SingleTableReadQuery::new(
            self.table,
            normalize(collapse(self.filters.clone())),
            order_by,
            self.limit,
        );
        let child_name = |rel_name: &str| {
            if name == "main" {
                rel_name.to_owned()
            } else {
                format!("{name}.{rel_name}")
            }
        };
        let mut edges = Vec::new();
        let left = self
            .left
            .iter()
            .map(|(rel_name, child)| (rel_name.clone(), child));
        let inner = self
            .inner
            .iter()
            .map(|(rel_name, child)| (format!("has:{rel_name}"), child));
        for (index, (label, child)) in left.chain(inner).enumerate() {
            let edge = rel(self.table, label.trim_start_matches("has:"));
            let mut child_path = path.clone();
            child_path.push(index);
            let sub = child.node(child_path, &child_name(&label), names);
            edges.push(if index < self.left.len() {
                Join::left(sub, edge.source, edge.dest)
            } else {
                Join::inner(sub, edge.source, edge.dest)
            });
        }
        MultiTableReadQuery::new(main_table, edges)
    }

    /// The SQL text of a single-table query, `None` when it has edges (the
    /// parser has no join syntax yet).
    pub fn sql(&self) -> Option<String> {
        if !self.left.is_empty() || !self.inner.is_empty() {
            return None;
        }
        let filter = normalize(collapse(self.filters.clone()));
        let mut sql = format!("SELECT * FROM {}", self.table);
        if filter != Where::AND(Vec::new()) {
            sql.push_str(" WHERE ");
            sql.push_str(&render(&filter, true));
        }
        let order: Vec<(String, Order)> = if self.order.is_empty() {
            vec![(pkey(self.table).to_owned(), Order::ASC)]
        } else {
            self.order.clone()
        };
        let clauses: Vec<String> = order
            .iter()
            .map(|(column, direction)| {
                let direction = match direction {
                    Order::ASC => "ASC",
                    Order::DESC => "DESC",
                };
                format!("{column} {direction}")
            })
            .collect();
        sql.push_str(&format!(" ORDER BY {}", clauses.join(", ")));
        if self.limit != u32::MAX {
            sql.push_str(&format!(" LIMIT {}", self.limit));
        }
        Some(sql)
    }
}

/// One part is itself; several are an `AND`; none is `TRUE`.
fn collapse(mut parts: Vec<Where>) -> Where {
    if parts.len() == 1 {
        parts.pop().expect("one part")
    } else {
        Where::AND(parts)
    }
}

/// One branch is itself; several are an `OR`.
fn collapse_or(mut branches: Vec<Where>) -> Where {
    if branches.len() == 1 {
        branches.pop().expect("one branch")
    } else {
        Where::OR(branches)
    }
}

/// Unwrap every single-child `AND` / `OR`, the shape the parser produces,
/// so a built tree compares equal to its parsed rendering.
fn normalize(filter: Where) -> Where {
    match filter {
        Where::Condition(condition) => Where::Condition(condition),
        Where::AND(children) => collapse(children.into_iter().map(normalize).collect()),
        Where::OR(children) => {
            let mut children: Vec<Where> = children.into_iter().map(normalize).collect();
            if children.len() == 1 {
                children.pop().expect("one child")
            } else {
                Where::OR(children)
            }
        }
    }
}

/// Rows strictly after (or, when `inclusive`, at or after) the cursor in
/// the sort order: the row-value comparison `(k1, k2, …) > (v1, v2, …)`
/// spelled out as `k1 > v1 OR (k1 = v1 AND k2 > v2) OR …`, each `>`
/// flipped to `<` on a descending key.
fn keyset(keys: &[(&str, Order, Value)], inclusive: bool) -> Where {
    let mut branches = Vec::new();
    for (index, (column, direction, value)) in keys.iter().enumerate() {
        let op = match direction {
            Order::ASC => GT,
            Order::DESC => LT,
        };
        let mut conjuncts: Vec<Where> = keys[..index]
            .iter()
            .map(|(earlier, _, earlier_value)| eq(earlier, earlier_value.clone()))
            .collect();
        conjuncts.push(cmp(column, op, value.clone()));
        branches.push(collapse(conjuncts));
    }
    if inclusive {
        branches.push(collapse(
            keys.iter()
                .map(|(column, _, value)| eq(column, value.clone()))
                .collect(),
        ));
    }
    collapse_or(branches)
}

/// SQL text of a predicate tree; a nested group is parenthesised, the top
/// level is not.
fn render(filter: &Where, top: bool) -> String {
    match filter {
        Where::Condition(condition) if condition.comparison_operator == IS => {
            format!("{} IS NULL", condition.column.as_str())
        }
        Where::Condition(condition) if condition.comparison_operator == IS_NOT => {
            format!("{} IS NOT NULL", condition.column.as_str())
        }
        Where::Condition(condition) => {
            let op = match condition.comparison_operator {
                EQ => "=",
                NEQ => "!=",
                GT => ">",
                GTE => ">=",
                LT => "<",
                LTE => "<=",
                IN => "IN",
                NOT_IN => "NOT IN",
                IS | IS_NOT => unreachable!("rendered above"),
                EXISTS => unreachable!("a query with edges has no SQL"),
            };
            format!(
                "{} {op} {}",
                condition.column.as_str(),
                literal(&condition.value)
            )
        }
        Where::AND(children) if children.is_empty() => "TRUE".to_owned(),
        Where::OR(children) if children.is_empty() => "FALSE".to_owned(),
        Where::AND(children) => group(children, " AND ", top),
        Where::OR(children) => group(children, " OR ", top),
    }
}

/// Join rendered children with `separator`, parenthesised below the top.
fn group(children: &[Where], separator: &str, top: bool) -> String {
    let inner: Vec<String> = children.iter().map(|child| render(child, false)).collect();
    let inner = inner.join(separator);
    if top { inner } else { format!("({inner})") }
}

/// SQL text of one literal value.
fn literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_owned(),
        Value::Bool(true) => "TRUE".to_owned(),
        Value::Bool(false) => "FALSE".to_owned(),
        Value::Int(int) => int.to_string(),
        Value::Float(float) => format!("{float:?}"),
        Value::String(text) => format!("'{}'", text.replace('\'', "''")),
        Value::List(items) => {
            let items: Vec<String> = items.iter().map(literal).collect();
            format!("({})", items.join(", "))
        }
        other => panic!("no SQL spelling for {other:?}"),
    }
}
