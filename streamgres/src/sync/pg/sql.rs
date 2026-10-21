//! Rendering the query model as Postgres SQL: a [`SingleTableReadQuery`]
//! becomes one `SELECT` whose columns are cast to the types the catalog
//! declares (so every result decodes the same way), whose `WHERE` is the
//! filter tree rendered so that it selects exactly the rows the engine's
//! two-valued evaluation would (the tree has no `NOT`, so a comparison
//! touching `NULL`, unknown to SQL, excludes the row under `AND` and `OR`
//! just as the engine's `false` does; an empty `IN` list is false, a
//! `NOT IN` with a `NULL` member is never true), and every leaf is left
//! as the bare comparison PostgreSQL can serve from an index: wrapping a
//! leaf in `IS TRUE` turns an index condition into a filter over a whole
//! scan. `ORDER BY` / `LIMIT` are emitted only for a finite limit. A
//! count ([`count_sql`]) takes a whole tree: each node gets an alias its
//! columns are qualified with, and an `EXISTS` leaf naming an inner edge
//! becomes `EXISTS (SELECT 1 FROM sub WHERE sub.col = node.col AND …)`,
//! the sub's filter rendered the same way, so the count is the join
//! result at the node — what the node holds when its subs drive it.

use std::cell::Cell;
use std::fmt::Write;

use crate::model::{
    Catalog, ComparisonOperator, Condition, DbTable, MultiTableReadQuery, Order,
    SingleTableReadQuery, Value, ValueType, Where,
};

/// The `SELECT` for `query` over `table`'s declared columns, in the
/// column order [`select_columns`] returns.
pub fn select_sql(query: &SingleTableReadQuery, table: &DbTable) -> String {
    let mut sql = String::from("SELECT ");
    let columns = select_columns(table);
    for (index, column) in columns.iter().enumerate() {
        if index > 0 {
            sql.push_str(", ");
        }
        let declared = &table.columns[*column].r#type;
        sql.push_str(&select_expr(column.as_str(), declared));
    }
    let _ = write!(
        sql,
        " FROM {} WHERE {}",
        quote_ident(query.table.as_str()),
        render_where(&query.filter, &Scope::plain(table))
    );
    if query.limit != u32::MAX {
        let clauses: Vec<String> = query
            .order_by
            .iter()
            .map(|clause| {
                let direction = match clause.direction {
                    Order::ASC => "ASC NULLS LAST",
                    Order::DESC => "DESC NULLS FIRST",
                };
                format!("{} {direction}", quote_ident(clause.column.as_str()))
            })
            .collect();
        let _ = write!(
            sql,
            " ORDER BY {} LIMIT {}",
            clauses.join(", "),
            query.limit
        );
    }
    sql
}

/// `SELECT count(*)` of the rows of `query`'s main table matching its
/// filter, stopping at `cap`: the count runs over `LIMIT cap` rows, so
/// the scan ends as soon as the cap is reached. Every node is aliased
/// (`t0` the main, then one per sub in the order they are reached), an
/// `EXISTS` leaf naming an inner edge is the correlated `EXISTS` on the
/// sub's table under the sub's own filter, rendered the same way all the
/// way down, an inner edge no leaf names is conjoined the same, an
/// `EXISTS` naming no inner edge is false and an outer edge is left out;
/// `ORDER BY` and `LIMIT` play no part. A table the catalog does not
/// describe is the error.
pub fn count_sql(
    query: &MultiTableReadQuery,
    catalog: &Catalog,
    cap: u64,
) -> Result<String, String> {
    if let Some(missing) = query
        .tables()
        .into_iter()
        .find(|table| catalog.table(table.as_str()).is_none())
    {
        return Err(format!("table `{missing}` is not in the catalog"));
    }
    let aliases = Cell::new(0);
    let scope = Scope::counted(query, catalog, &aliases)
        .ok_or_else(|| format!("table `{}` is not in the catalog", query.main_table.table))?;
    Ok(format!(
        "SELECT count(*) FROM (SELECT 1 FROM {} AS {} WHERE {} LIMIT {cap}) AS capped",
        quote_ident(query.main_table.table.as_str()),
        scope.alias,
        scope.render_node()
    ))
}

/// What a filter's columns refer to while it is rendered: the table (for
/// the columns' types) and, in a count, the alias the columns are
/// qualified with, the node whose inner edges an `EXISTS` leaf may name,
/// the catalog describing the subs' tables and the counter the next
/// alias is taken from. A plain `SELECT` has none of those: its columns
/// are bare and an `EXISTS` leaf is false.
struct Scope<'a> {
    table: &'a DbTable,
    alias: String,
    node: Option<&'a MultiTableReadQuery>,
    catalog: Option<&'a Catalog>,
    aliases: Option<&'a Cell<usize>>,
}

impl<'a> Scope<'a> {
    /// The scope of a plain `SELECT` over `table`.
    fn plain(table: &'a DbTable) -> Self {
        Scope {
            table,
            alias: String::new(),
            node: None,
            catalog: None,
            aliases: None,
        }
    }

    /// The scope of `node` in a count: the next alias, taken from
    /// `aliases`; `None` when `catalog` does not describe `node`'s table
    /// (which [`count_sql`] rules out before rendering).
    fn counted(
        node: &'a MultiTableReadQuery,
        catalog: &'a Catalog,
        aliases: &'a Cell<usize>,
    ) -> Option<Self> {
        let table = catalog.table(node.main_table.table.as_str())?;
        let index = aliases.get();
        aliases.set(index + 1);
        Some(Scope {
            table,
            alias: format!("t{index}"),
            node: Some(node),
            catalog: Some(catalog),
            aliases: Some(aliases),
        })
    }

    /// The node's filter rendered in this scope, with the correlated
    /// `EXISTS` of every inner edge no leaf names conjoined to it.
    fn render_node(&self) -> String {
        let Some(node) = self.node else {
            return "FALSE".to_owned();
        };
        let named: Vec<usize> = node
            .main_table
            .filter
            .leaf_conditions()
            .into_iter()
            .filter(|leaf| leaf.comparison_operator == ComparisonOperator::EXISTS)
            .filter_map(|leaf| exists_index(&leaf.value))
            .collect();
        let mut parts = vec![render_where(&node.main_table.filter, self)];
        for (index, join) in node.joins.iter().filter(|join| join.is_inner).enumerate() {
            if !named.contains(&index) {
                parts.push(self.semi_join(join));
            }
        }
        if parts.len() == 1 {
            parts.remove(0)
        } else {
            format!("({})", parts.join(" AND "))
        }
    }

    /// An `EXISTS` leaf in this scope: the correlated `EXISTS` on the
    /// inner edge it names, `FALSE` when it names none or the scope is a
    /// plain `SELECT`.
    fn exists(&self, condition: &Condition) -> String {
        self.node
            .zip(exists_index(&condition.value))
            .and_then(|(node, index)| node.inner_join(index))
            .map_or_else(|| "FALSE".to_owned(), |join| self.semi_join(join))
    }

    /// `EXISTS (SELECT 1 FROM sub AS tN WHERE tN.sub_col = alias.main_col
    /// AND <sub's filter>)` for `join`, the sub rendered in a scope of its
    /// own.
    fn semi_join(&self, join: &crate::model::Join) -> String {
        let (Some(catalog), Some(aliases)) = (self.catalog, self.aliases) else {
            return "FALSE".to_owned();
        };
        let Some(sub) = Scope::counted(&join.sub, catalog, aliases) else {
            return "FALSE".to_owned();
        };
        format!(
            "EXISTS (SELECT 1 FROM {} AS {} WHERE ({}.{} = {}.{} AND {}))",
            quote_ident(join.sub.main_table.table.as_str()),
            sub.alias,
            sub.alias,
            quote_ident(join.sub_table_column.as_str()),
            self.alias,
            quote_ident(join.main_table_column.as_str()),
            sub.render_node()
        )
    }

    /// `column` qualified with the scope's alias when it has one.
    fn qualified(&self, column: &str) -> String {
        if self.alias.is_empty() {
            quote_ident(column)
        } else {
            format!("{}.{}", self.alias, quote_ident(column))
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

/// The table's columns in a fixed order: primary-key columns first (in
/// declaration order), then the rest sorted by name.
pub fn select_columns(table: &DbTable) -> Vec<&crate::model::ColumnName> {
    table.row_schema().names().iter().collect()
}

/// The Postgres type every column of a declared type is cast to on the
/// way out, so decoding is uniform whatever the column's own type.
pub fn cast_of(declared: &ValueType) -> &'static str {
    match declared {
        ValueType::Int | ValueType::Timestamp => "int8",
        ValueType::Float => "float8",
        ValueType::String | ValueType::Json => "text",
        ValueType::Bool => "bool",
        ValueType::Date => "date",
        ValueType::Datetime => "timestamp",
        ValueType::List(_) | ValueType::Map(_, _) => "text",
    }
}

/// The SQL reading one column in the form the engine keeps it: a time
/// column as epoch milliseconds, a JSON column as the text of its `jsonb`
/// (the cast is nothing for a `jsonb` column, and gives a `json` column's
/// stored text the one spelling `jsonb` has), an array or map column as
/// JSON text, every other cast to its declared type's Postgres form.
pub fn select_expr(column: &str, declared: &ValueType) -> String {
    let quoted = quote_ident(column);
    match declared {
        ValueType::Timestamp => epoch_millis(&quoted),
        ValueType::Json => format!("{quoted}::jsonb::text"),
        ValueType::List(_) | ValueType::Map(_, _) => format!("to_json({quoted})::text"),
        other => format!("{quoted}::{}", cast_of(other)),
    }
}

/// `expr` as milliseconds since the epoch; `extract` is numeric, so the
/// rounding to `int8` keeps the millisecond a `timestamp(3)` column has.
fn epoch_millis(expr: &str) -> String {
    format!("(extract(epoch from {expr}) * 1000)::int8")
}

/// A column as the SQL its conditions compare it by: the bare column
/// (qualified by the scope's alias in a count), so an index on it answers
/// the comparison; a time column's literal is converted instead
/// ([`literal_as`]). A JSON column is compared as `jsonb`, which a `json`
/// column has to be turned into (it has no equality of its own) and a
/// `jsonb` column already is: the cast of a `jsonb` column is the bare
/// column, index and all.
fn column_expr(column: &str, scope: &Scope<'_>) -> String {
    match scope.table.column(column).map(|declared| &declared.r#type) {
        Some(ValueType::Json) => format!("{}::jsonb", scope.qualified(column)),
        _ => scope.qualified(column),
    }
}

/// A literal compared against a column of `declared` type: the engine
/// keeps a time as milliseconds since the epoch, so against a time
/// column the number becomes the timestamp it names, and the column
/// itself stays bare for the index; against a JSON column the text the
/// engine holds is the `jsonb` it names.
fn literal_as(value: &Value, declared: Option<&ValueType>) -> String {
    if let (Value::String(text), Some(ValueType::Json)) = (value, declared) {
        return format!("{}::jsonb", quote_literal(text));
    }
    let millis = match (value, declared) {
        (Value::Int(millis), Some(ValueType::Timestamp)) => *millis,
        (Value::Float(millis), Some(ValueType::Timestamp)) if millis.is_finite() => *millis as i64,
        _ => return literal(value),
    };
    format!("(TIMESTAMP 'epoch' + {millis} * INTERVAL '1 millisecond')")
}

/// A double-quoted identifier.
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The filter tree as a boolean expression in `scope`.
fn render_where(filter: &Where, scope: &Scope<'_>) -> String {
    match filter {
        Where::Condition(condition) => render_condition(condition, scope),
        Where::AND(children) if children.is_empty() => "TRUE".to_owned(),
        Where::OR(children) if children.is_empty() => "FALSE".to_owned(),
        Where::AND(children) => {
            let parts: Vec<String> = children
                .iter()
                .map(|child| render_where(child, scope))
                .collect();
            format!("({})", parts.join(" AND "))
        }
        Where::OR(children) => {
            let parts: Vec<String> = children
                .iter()
                .map(|child| render_where(child, scope))
                .collect();
            format!("({})", parts.join(" OR "))
        }
    }
}

/// One leaf, with the engine's `NULL` and list semantics made explicit.
fn render_condition(condition: &Condition, scope: &Scope<'_>) -> String {
    use ComparisonOperator::*;
    let column = column_expr(condition.column.as_str(), scope);
    let declared = scope
        .table
        .column(condition.column.as_str())
        .map(|declared| &declared.r#type);
    match condition.comparison_operator {
        IN | NOT_IN => {
            let members = members_of(&condition.value);
            let negated = condition.comparison_operator == NOT_IN;
            if negated && members.iter().any(Value::is_null) {
                return "FALSE".to_owned();
            }
            let literals: Vec<String> = members
                .iter()
                .filter(|value| !value.is_null())
                .map(|value| literal_as(value, declared))
                .collect();
            if literals.is_empty() {
                return if negated { "TRUE" } else { "FALSE" }.to_owned();
            }
            let keyword = if negated { "NOT IN" } else { "IN" };
            format!("{column} {keyword} ({})", literals.join(", "))
        }
        EXISTS => scope.exists(condition),
        IS if condition.value.is_null() => format!("{column} IS NULL"),
        IS_NOT if condition.value.is_null() => format!("{column} IS NOT NULL"),
        _ if condition.value.is_null() => "FALSE".to_owned(),
        IS | IS_NOT => "FALSE".to_owned(),
        EQ => format!("{column} = {}", literal_as(&condition.value, declared)),
        NEQ => format!("{column} <> {}", literal_as(&condition.value, declared)),
        GT => format!("{column} > {}", literal_as(&condition.value, declared)),
        GTE => format!("{column} >= {}", literal_as(&condition.value, declared)),
        LT => format!("{column} < {}", literal_as(&condition.value, declared)),
        LTE => format!("{column} <= {}", literal_as(&condition.value, declared)),
    }
}

/// The members of an `IN` / `NOT IN` operand: a literal list's items, a
/// shared set's current members, or the lone value itself.
fn members_of(value: &Value) -> Vec<Value> {
    match value {
        Value::List(items) => items.clone(),
        Value::Set(set) => set.members(),
        other => vec![other.clone()],
    }
}

/// A value as a SQL literal.
fn literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_owned(),
        Value::String(text) => quote_literal(text),
        Value::Int(int) => int.to_string(),
        Value::Float(float) if float.is_nan() => "'NaN'::float8".to_owned(),
        Value::Float(float) if float.is_infinite() && *float > 0.0 => {
            "'Infinity'::float8".to_owned()
        }
        Value::Float(float) if float.is_infinite() => "'-Infinity'::float8".to_owned(),
        Value::Float(float) => format!("{float:?}::float8"),
        Value::Bool(true) => "TRUE".to_owned(),
        Value::Bool(false) => "FALSE".to_owned(),
        Value::Date(date) => format!("DATE '{}'", date.format("%Y-%m-%d")),
        Value::Datetime(datetime) => {
            format!("TIMESTAMP '{}'", datetime.format("%Y-%m-%d %H:%M:%S%.6f"))
        }
        Value::List(_) | Value::Map(_) | Value::Set(_) => "NULL".to_owned(),
    }
}

/// A single-quoted string literal, quotes doubled.
pub fn quote_literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DbColumn, Join, OrderBy, SharedSet};

    /// `tickets(id, status, points)`.
    fn tickets() -> DbTable {
        DbTable::new(
            "tickets",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("status", ValueType::String),
                DbColumn::new("points", ValueType::Int),
            ],
        )
    }

    /// Columns are cast, the filter is parenthesized, and an unbounded
    /// query carries no ORDER BY / LIMIT.
    #[test]
    fn renders_a_filtered_select() {
        let query = SingleTableReadQuery::new(
            "tickets",
            Where::AND(vec![
                Where::condition("status", ComparisonOperator::EQ, "it's open"),
                Where::condition("points", ComparisonOperator::GTE, 8),
            ]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        );
        assert_eq!(
            select_sql(&query, &tickets()),
            "SELECT \"id\"::int8, \"points\"::int8, \"status\"::text FROM \"tickets\" WHERE (\"status\" = 'it''s open' AND \"points\" >= 8)"
        );
    }

    /// A finite limit orders (nulls last, Postgres's default for ASC) and
    /// limits; a set-valued IN renders its current members; an empty IN
    /// is FALSE; a NULL comparison is FALSE; a NOT IN with a NULL member
    /// is FALSE.
    /// The null tests render as SQL's own; an `IS` with another operand
    /// is never true.
    /// A leaf is the bare comparison PostgreSQL can serve from an index:
    /// nothing wraps it, and in a plain `SELECT` an `EXISTS` leaf (the
    /// engine's own test) is false; a count of a node alone, its
    /// `EXISTS` leaves taken as true beforehand, is the bare filter.
    #[test]
    fn leaves_are_bare_and_a_select_never_joins() {
        let query = SingleTableReadQuery::new(
            crate::model::TableName::from("tickets"),
            Where::AND(vec![
                Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                Where::Condition(Condition::new(
                    "team",
                    ComparisonOperator::EXISTS,
                    Value::Int(1),
                )),
            ]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        );
        let sql = select_sql(&query, &tickets());
        assert!(!sql.contains("IS TRUE"), "{sql}");
        assert!(sql.contains("(\"status\" = 'OPEN' AND FALSE)"), "{sql}");
        let alone = SingleTableReadQuery {
            filter: query
                .filter
                .assuming_true(&|leaf| leaf.comparison_operator == ComparisonOperator::EXISTS),
            ..query
        };
        let catalog = Catalog::new([tickets()]);
        let count = count_sql(&MultiTableReadQuery::single(alone), &catalog, 100).expect("known");
        assert_eq!(
            count,
            "SELECT count(*) FROM (SELECT 1 FROM \"tickets\" AS t0 WHERE (t0.\"status\" = 'OPEN') LIMIT 100) AS capped"
        );
    }

    /// A count of a tree joins its inner edges: an `EXISTS` leaf is the
    /// correlated `EXISTS` on the sub it names, where the leaf stands (an
    /// `OR` branch here), the sub's own leaves nested the same way, an
    /// inner edge no leaf names conjoined, a LEFT edge left out, each
    /// node under an alias of its own so two nodes on one table stay
    /// apart; a table the catalog lacks is the error.
    #[test]
    fn a_count_joins_the_tree_through_its_exists() {
        let members = DbTable::new(
            "members",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("teamId", ValueType::Int),
                DbColumn::new("userId", ValueType::String),
            ],
        );
        let teams = DbTable::new(
            "teams",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("name", ValueType::String),
            ],
        );
        let ticket_teams = DbTable::new(
            "ticket_teams",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("ticketId", ValueType::Int),
                DbColumn::new("teamId", ValueType::Int),
            ],
        );
        let catalog = Catalog::new([tickets(), teams.clone(), members, ticket_teams]);
        let node = |table: &str, filter: Where| {
            SingleTableReadQuery::new(table, filter, OrderBy::new("id", Order::ASC), u32::MAX)
        };
        let my_teams = MultiTableReadQuery::new(
            node("teams", Where::exists("id", 0)),
            vec![Join::inner(
                MultiTableReadQuery::single(node(
                    "members",
                    Where::condition("userId", ComparisonOperator::EQ, "me"),
                )),
                "id",
                "teamId",
            )],
        );
        let query = MultiTableReadQuery::new(
            node(
                "tickets",
                Where::OR(vec![
                    Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                    Where::exists("id", 1),
                ]),
            ),
            vec![
                Join::left(
                    MultiTableReadQuery::single(node("teams", Where::AND(Vec::new()))),
                    "id",
                    "id",
                ),
                Join::inner(
                    MultiTableReadQuery::single(node(
                        "ticket_teams",
                        Where::condition("teamId", ComparisonOperator::GT, 0),
                    )),
                    "id",
                    "ticketId",
                ),
                Join::inner(my_teams, "id", "id"),
            ],
        );
        let count = count_sql(&query, &catalog, 50).expect("known");
        assert_eq!(
            count,
            "SELECT count(*) FROM (SELECT 1 FROM \"tickets\" AS t0 WHERE (\
             (t0.\"status\" = 'OPEN' OR \
             EXISTS (SELECT 1 FROM \"teams\" AS t1 WHERE (t1.\"id\" = t0.\"id\" AND \
             EXISTS (SELECT 1 FROM \"members\" AS t2 WHERE (t2.\"teamId\" = t1.\"id\" AND t2.\"userId\" = 'me'))))) AND \
             EXISTS (SELECT 1 FROM \"ticket_teams\" AS t3 WHERE (t3.\"ticketId\" = t0.\"id\" AND t3.\"teamId\" > 0))\
             ) LIMIT 50) AS capped"
        );
        let unknown = MultiTableReadQuery::new(
            node("tickets", Where::exists("id", 0)),
            vec![Join::inner(
                MultiTableReadQuery::single(node("nowhere", Where::AND(Vec::new()))),
                "id",
                "ticketId",
            )],
        );
        assert_eq!(
            count_sql(&unknown, &catalog, 50).expect_err("unknown table"),
            "table `nowhere` is not in the catalog"
        );
    }

    /// A time condition compares the bare column against the timestamp
    /// the millisecond literal names, so an index on the column answers
    /// it; the projection still returns milliseconds.
    #[test]
    fn a_time_condition_compares_the_column_itself() {
        let table = DbTable::new(
            "events",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("createdAt", ValueType::Timestamp),
            ],
        );
        let query = SingleTableReadQuery::new(
            crate::model::TableName::from("events"),
            Where::AND(vec![
                Where::condition("createdAt", ComparisonOperator::GT, 1_750_000_000_000i64),
                Where::Condition(Condition::new(
                    "createdAt",
                    ComparisonOperator::IN,
                    Value::List(vec![Value::Int(1_000), Value::Float(2_000.0)]),
                )),
            ]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        );
        let sql = select_sql(&query, &table);
        assert!(
            sql.contains(
                "\"createdAt\" > (TIMESTAMP 'epoch' + 1750000000000 * INTERVAL '1 millisecond')"
            ),
            "{sql}"
        );
        assert!(
            sql.contains("\"createdAt\" IN ((TIMESTAMP 'epoch' + 1000 * INTERVAL '1 millisecond'), (TIMESTAMP 'epoch' + 2000 * INTERVAL '1 millisecond'))"),
            "{sql}"
        );
        assert!(
            sql.contains("(extract(epoch from \"createdAt\") * 1000)::int8"),
            "the projection still reads milliseconds: {sql}"
        );
    }

    #[test]
    fn renders_null_tests() {
        let query = SingleTableReadQuery::new(
            "tickets",
            Where::AND(vec![
                Where::is_null("status"),
                Where::is_not_null("points"),
                Where::condition("points", ComparisonOperator::IS, 3),
            ]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        );
        let sql = select_sql(&query, &tickets());
        assert!(
            sql.contains("(\"status\" IS NULL AND \"points\" IS NOT NULL AND FALSE)"),
            "{sql}"
        );
    }

    #[test]
    fn renders_windows_sets_and_null_semantics() {
        let set = SharedSet::default();
        set.insert(&Value::Int(7));
        set.insert(&Value::Int(9));
        let query = SingleTableReadQuery::new(
            "tickets",
            Where::OR(vec![
                Where::Condition(Condition::new(
                    "points",
                    ComparisonOperator::IN,
                    Value::Set(set),
                )),
                Where::Condition(Condition::new(
                    "points",
                    ComparisonOperator::IN,
                    Value::List(Vec::new()),
                )),
                Where::Condition(Condition::new(
                    "status",
                    ComparisonOperator::EQ,
                    Value::Null,
                )),
                Where::Condition(Condition::new(
                    "status",
                    ComparisonOperator::NOT_IN,
                    Value::List(vec!["a".into(), Value::Null]),
                )),
            ]),
            OrderBy::new("points", Order::DESC),
            5,
        );
        let sql = select_sql(&query, &tickets());
        assert!(
            sql.contains("\"points\" IN (7, 9)") || sql.contains("\"points\" IN (9, 7)"),
            "{sql}"
        );
        assert!(sql.contains(" OR FALSE OR FALSE OR FALSE)"), "{sql}");
        assert!(
            sql.ends_with("ORDER BY \"points\" DESC NULLS FIRST LIMIT 5"),
            "{sql}"
        );
    }

    /// A JSON column is compared as `jsonb` with the literal cast to it,
    /// in a condition, in a list and in a count, so neither a `json`
    /// column (which has no equality) nor a text literal (which is not
    /// JSON) makes Postgres refuse the statement.
    #[test]
    fn a_json_column_is_compared_as_jsonb() {
        let values = DbTable::new(
            "form_entity_values",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::String),
                DbColumn::new("fieldId", ValueType::String),
                DbColumn::new("actualFieldValue", ValueType::Json),
            ],
        );
        let query = SingleTableReadQuery::new(
            "form_entity_values",
            Where::AND(vec![
                Where::condition("fieldId", ComparisonOperator::EQ, "f1"),
                Where::OR(vec![
                    Where::condition("actualFieldValue", ComparisonOperator::EQ, "\"high\""),
                    Where::condition(
                        "actualFieldValue",
                        ComparisonOperator::IN,
                        Value::List(vec![Value::from("5"), Value::from("true")]),
                    ),
                ]),
            ]),
            OrderBy::new("id", crate::model::Order::ASC),
            u32::MAX,
        );
        let sql = select_sql(&query, &values);
        assert!(
            sql.contains("\"actualFieldValue\"::jsonb = '\"high\"'::jsonb"),
            "{sql}"
        );
        assert!(
            sql.contains("\"actualFieldValue\"::jsonb IN ('5'::jsonb, 'true'::jsonb)"),
            "{sql}"
        );
        assert!(
            sql.contains("\"fieldId\" = 'f1'"),
            "a text column stays bare: {sql}"
        );
        assert!(
            sql.starts_with("SELECT \"id\"::text, \"actualFieldValue\"::jsonb::text,"),
            "the cell is read as the text of its jsonb: {sql}"
        );
        let catalog = Catalog::new([values]);
        let count = count_sql(&MultiTableReadQuery::single(query), &catalog, 100).expect("known");
        assert!(count.contains("'\"high\"'::jsonb"), "{count}");
    }
}
