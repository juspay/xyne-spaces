//! Zero's query AST, as the application server returns it, translated
//! into the engine's query tree: `related` edges become LEFT joins,
//! `EXISTS` subqueries in the filter become INNER joins driven from the
//! sub (the planner may flip them) with an `EXISTS` leaf in their place, a
//! keyset `start` becomes the `WHERE` it means, the
//! root's `limit` becomes its window and a `related` node's `limit` its
//! window per parent row (the engine's driven windows), the primary key is
//! appended to the ordering when absent so pages are deterministic, and
//! every literal is coerced to its column's catalog type. Subqueries Zero
//! marks as permission checks are registered but their parts are not
//! shipped to the client, the way zero-cache withholds them. Two `EXISTS`
//! tests beside each other under a node's `AND`, on the same to-one
//! relationship, are one test of both conditions ([`merge_exists`]).

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::Value as Json;

use crate::ivm::QueryPart;
use crate::model::ComparisonOperator::{EQ, GT, GTE, IN, LT, LTE, NEQ, NOT_IN};
use crate::model::{
    Catalog, ComparisonOperator, DbTable, Join, MultiTableReadQuery, Order, OrderBy,
    SingleTableReadQuery, Value, ValueType, Where,
};

/// One query node.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ast {
    pub table: String,
    #[serde(default, rename = "where")]
    pub filter: Option<Box<Condition>>,
    #[serde(default)]
    pub related: Vec<CorrelatedSubquery>,
    #[serde(default)]
    pub limit: Option<f64>,
    #[serde(default)]
    pub order_by: Vec<(String, String)>,
    #[serde(default)]
    pub start: Option<Bound>,
}

/// A keyset cursor: the row to start after (or at).
#[derive(Debug, Clone, Deserialize)]
pub struct Bound {
    pub row: serde_json::Map<String, Json>,
    #[serde(default)]
    pub exclusive: bool,
}

/// A predicate node.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Condition {
    Simple {
        op: String,
        left: Operand,
        right: Operand,
    },
    And {
        conditions: Vec<Condition>,
    },
    Or {
        conditions: Vec<Condition>,
    },
    CorrelatedSubquery {
        related: CorrelatedSubquery,
        op: String,
    },
}

/// One side of a comparison.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Operand {
    Literal {
        value: Json,
    },
    Column {
        name: String,
    },
    Static {
        #[serde(default)]
        anchor: Option<String>,
        #[serde(default)]
        field: Json,
    },
}

/// A subquery joined to its parent on one column pair.
#[derive(Debug, Clone, Deserialize)]
pub struct CorrelatedSubquery {
    pub correlation: Correlation,
    pub subquery: Box<Ast>,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(default)]
    pub system: Option<String>,
}

/// The join columns of a subquery.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Correlation {
    pub parent_field: Vec<String>,
    pub child_field: Vec<String>,
}

/// One to-one relationship an `EXISTS` tests, as [`merge_exists`] groups
/// them: the parent column, the child column and the child table.
type Relationship<'a> = (&'a str, &'a str, &'a str);

/// A translated query: the tree to register, and the parts whose rows
/// stay on the server (permission subqueries).
#[derive(Debug, Clone)]
pub struct Translated {
    pub query: MultiTableReadQuery,
    pub hidden: HashSet<QueryPart>,
}

/// Translate `ast` against `catalog`; an error says what the engine
/// cannot run.
pub fn translate(ast: &Ast, catalog: &Catalog) -> Result<Translated, String> {
    let mut hidden = HashSet::new();
    let query = node(ast, Vec::new(), false, catalog, &mut hidden)?;
    Ok(Translated { query, hidden })
}

/// Build the tree below `ast` at `path`.
fn node(
    ast: &Ast,
    path: Vec<usize>,
    concealed: bool,
    catalog: &Catalog,
    hidden: &mut HashSet<QueryPart>,
) -> Result<MultiTableReadQuery, String> {
    let table = catalog
        .table(&ast.table)
        .ok_or_else(|| format!("unknown table `{}`", ast.table))?;
    let part = QueryPart::try_new(&path).ok_or_else(|| {
        format!(
            "the query nests deeper than {} joins under `{}`",
            QueryPart::MAX_DEPTH,
            ast.table
        )
    })?;
    if concealed {
        hidden.insert(part);
    }
    let merged = ast
        .filter
        .as_deref()
        .map(|condition| merge_exists(condition, catalog));
    let mut inner: Vec<&CorrelatedSubquery> = Vec::new();
    let filter = match &merged {
        Some(condition) => translate_condition(condition, table, &mut inner)?,
        None => Where::AND(Vec::new()),
    };
    let mut order = Vec::with_capacity(ast.order_by.len() + table.pkey.len());
    for (column, direction) in &ast.order_by {
        if table.column(column).is_none() {
            return Err(format!(
                "unknown column `{}.{column}` in ORDER BY",
                ast.table
            ));
        }
        let direction = match direction.as_str() {
            "asc" => Order::ASC,
            "desc" => Order::DESC,
            other => return Err(format!("unknown sort direction `{other}`")),
        };
        order.push(OrderBy::new(column.as_str(), direction));
    }
    for key in &table.pkey {
        if !order.iter().any(|clause| clause.column == *key) {
            order.push(OrderBy::new(key.clone(), Order::ASC));
        }
    }
    let filter = match &ast.start {
        Some(bound) => {
            let cursor = keyset(bound, &order, table)?;
            if matches!(&filter, Where::AND(children) if children.is_empty()) {
                cursor
            } else {
                collapse(vec![filter, cursor])
            }
        }
        None => filter,
    };
    let limit = match ast.limit {
        Some(limit) => limit.max(0.0).min(u32::MAX as f64) as u32,
        None => u32::MAX,
    };
    let main_table = SingleTableReadQuery::new(table.name.clone(), normalize(filter), order, limit);
    let left_count = ast.related.len();
    let mut joins = Vec::with_capacity(left_count + inner.len());
    for (index, sub) in ast.related.iter().enumerate() {
        let mut child_path = path.clone();
        child_path.push(index);
        joins.push(edge(sub, child_path, concealed, false, catalog, hidden)?);
    }
    for (offset, sub) in inner.iter().enumerate() {
        let mut child_path = path.clone();
        child_path.push(left_count + offset);
        joins.push(edge(sub, child_path, concealed, true, catalog, hidden)?);
    }
    Ok(MultiTableReadQuery::new(main_table, joins))
}

/// `condition` with the `EXISTS` tests that are direct children of its
/// `AND` merged wherever two or more test the same to-one relationship:
/// the same parent column, the same child table and the same child
/// column, that column being the child table's single-column primary
/// key. Each parent row reaches exactly one child row there, so "a
/// channel that is a DM exists" and "a channel I may see exists" are one
/// test, "a channel that is a DM and I may see exists", whose count is
/// what the two share rather than either alone, and whose rows the
/// engine reads once. A test inside an `OR`, one on a one-to-many
/// relationship, or two with different correlations are left as they
/// are; so is a condition that is not an `AND`. Merged before
/// translation, so the leaf numbering, the part paths and the hidden
/// parts all follow from the merged tree.
fn merge_exists<'a>(condition: &'a Condition, catalog: &Catalog) -> Cow<'a, Condition> {
    let Condition::And { conditions } = condition else {
        return Cow::Borrowed(condition);
    };
    let mut groups: Vec<(Relationship<'a>, Vec<usize>)> = Vec::new();
    for (index, child) in conditions.iter().enumerate() {
        let Some(sub) = exists_of(child).filter(|sub| to_one(sub, catalog)) else {
            continue;
        };
        let key = (
            sub.correlation.parent_field[0].as_str(),
            sub.correlation.child_field[0].as_str(),
            sub.subquery.table.as_str(),
        );
        match groups.iter_mut().find(|(held, _)| *held == key) {
            Some((_, members)) => members.push(index),
            None => groups.push((key, vec![index])),
        }
    }
    if groups.iter().all(|(_, members)| members.len() < 2) {
        return Cow::Borrowed(condition);
    }
    let mut merged: HashMap<usize, Condition> = HashMap::new();
    let mut dropped: HashSet<usize> = HashSet::new();
    for (_, members) in groups.iter().filter(|(_, members)| members.len() >= 2) {
        let subs: Vec<&CorrelatedSubquery> = members
            .iter()
            .filter_map(|&index| exists_of(&conditions[index]))
            .collect();
        merged.insert(
            members[0],
            Condition::CorrelatedSubquery {
                related: merge(&subs),
                op: "EXISTS".to_owned(),
            },
        );
        dropped.extend(members[1..].iter().copied());
    }
    Cow::Owned(Condition::And {
        conditions: conditions
            .iter()
            .enumerate()
            .filter(|(index, _)| !dropped.contains(index))
            .map(|(index, child)| merged.remove(&index).unwrap_or_else(|| child.clone()))
            .collect(),
    })
}

/// The subquery of an `EXISTS` condition.
fn exists_of(condition: &Condition) -> Option<&CorrelatedSubquery> {
    match condition {
        Condition::CorrelatedSubquery { related, op } if op == "EXISTS" => Some(related),
        _ => None,
    }
}

/// Whether `sub` joins its parent to at most one row: one column pair,
/// the child's column its table's single-column primary key, and the
/// subquery a plain test (no page, order or cursor, as an `EXISTS` never
/// has).
fn to_one(sub: &CorrelatedSubquery, catalog: &Catalog) -> bool {
    let (correlation, subquery) = (&sub.correlation, &sub.subquery);
    correlation.parent_field.len() == 1
        && correlation.child_field.len() == 1
        && subquery.limit.is_none()
        && subquery.order_by.is_empty()
        && subquery.start.is_none()
        && catalog.table(&subquery.table).is_some_and(|table| {
            table.pkey.len() == 1 && table.pkey[0].as_str() == correlation.child_field[0]
        })
}

/// One `EXISTS` for `members`, tests of the same to-one relationship:
/// the conjunction of their filters, their nested edges in order, hidden
/// only when every one of them is, and of the system they all share. A
/// member that was a permission check while the merged test is not keeps
/// its own nested subqueries marked as permission checks, so what it
/// withheld from the client stays withheld; the merged rows themselves
/// are shipped, as the member that was not a permission check shipped a
/// superset of them.
fn merge(members: &[&CorrelatedSubquery]) -> CorrelatedSubquery {
    let first = members[0];
    let system = members
        .iter()
        .map(|member| member.system.as_deref())
        .reduce(|shared, next| if shared == next { shared } else { None })
        .flatten()
        .map(str::to_owned);
    let mut filters = Vec::with_capacity(members.len());
    let mut related = Vec::new();
    for member in members {
        let mut subquery = (*member.subquery).clone();
        if system.is_none() && member.system.as_deref() == Some("permissions") {
            conceal(&mut subquery);
        }
        if let Some(filter) = subquery.filter.take() {
            filters.push(*filter);
        }
        related.append(&mut subquery.related);
    }
    let filter = match filters.len() {
        0 => None,
        1 => filters.pop(),
        _ => Some(Condition::And {
            conditions: filters,
        }),
    };
    CorrelatedSubquery {
        correlation: first.correlation.clone(),
        subquery: Box::new(Ast {
            table: first.subquery.table.clone(),
            filter: filter.map(Box::new),
            related,
            limit: None,
            order_by: Vec::new(),
            start: None,
        }),
        hidden: members
            .iter()
            .all(|member| member.hidden == Some(true))
            .then_some(true),
        system,
    }
}

/// Mark every subquery directly under `ast` as a permission check (the
/// translation conceals everything under one).
fn conceal(ast: &mut Ast) {
    for sub in &mut ast.related {
        sub.system = Some("permissions".to_owned());
    }
    if let Some(filter) = ast.filter.as_deref_mut() {
        conceal_condition(filter);
    }
}

/// [`conceal`] for the subqueries inside a condition.
fn conceal_condition(condition: &mut Condition) {
    match condition {
        Condition::Simple { .. } => {}
        Condition::And { conditions } | Condition::Or { conditions } => {
            conditions.iter_mut().for_each(conceal_condition);
        }
        Condition::CorrelatedSubquery { related, .. } => {
            related.system = Some("permissions".to_owned());
        }
    }
}

/// One join edge and the subtree under it: a LEFT edge for `related`, an
/// INNER edge driven from the sub for `EXISTS`.
fn edge(
    sub: &CorrelatedSubquery,
    child_path: Vec<usize>,
    concealed_parent: bool,
    is_inner: bool,
    catalog: &Catalog,
    hidden: &mut HashSet<QueryPart>,
) -> Result<Join, String> {
    let (Some(parent_column), Some(child_column)) = (
        sub.correlation.parent_field.first(),
        sub.correlation.child_field.first(),
    ) else {
        return Err("a join without columns".to_owned());
    };
    if sub.correlation.parent_field.len() != 1 || sub.correlation.child_field.len() != 1 {
        return Err("compound join keys are not supported".to_owned());
    }
    let concealed = concealed_parent || sub.system.as_deref() == Some("permissions");
    let child = node(&sub.subquery, child_path, concealed, catalog, hidden)?;
    Ok(if is_inner {
        Join::inner(child, parent_column.as_str(), child_column.as_str())
    } else {
        Join::left(child, parent_column.as_str(), child_column.as_str())
    })
}

/// A predicate node as a `Where`; `EXISTS` subqueries are collected into
/// `inner`, numbered in order of appearance.
fn translate_condition<'a>(
    condition: &'a Condition,
    table: &DbTable,
    inner: &mut Vec<&'a CorrelatedSubquery>,
) -> Result<Where, String> {
    match condition {
        Condition::Simple { op, left, right } => simple(op, left, right, table),
        Condition::And { conditions } => Ok(Where::AND(
            conditions
                .iter()
                .map(|child| translate_condition(child, table, inner))
                .collect::<Result<_, _>>()?,
        )),
        Condition::Or { conditions } => Ok(Where::OR(
            conditions
                .iter()
                .map(|child| translate_condition(child, table, inner))
                .collect::<Result<_, _>>()?,
        )),
        Condition::CorrelatedSubquery { related, op } => match op.as_str() {
            "EXISTS" => {
                let column = related
                    .correlation
                    .parent_field
                    .first()
                    .ok_or("an EXISTS without a join column")?;
                if table.column(column).is_none() {
                    return Err(format!(
                        "unknown column `{}.{column}` in EXISTS",
                        table.name
                    ));
                }
                let index = inner.len();
                inner.push(related);
                Ok(Where::exists(column.as_str(), index))
            }
            "NOT EXISTS" => Err("NOT EXISTS is not supported".to_owned()),
            other => Err(format!("unknown subquery operator `{other}`")),
        },
    }
}

/// One `column op literal` leaf.
fn simple(op: &str, left: &Operand, right: &Operand, table: &DbTable) -> Result<Where, String> {
    let Operand::Column { name } = left else {
        return Err("only a column can be compared".to_owned());
    };
    let column = table
        .column(name)
        .ok_or_else(|| format!("unknown column `{}.{name}`", table.name))?;
    let literal = match right {
        Operand::Literal { value } => value,
        Operand::Static { .. } => {
            return Err(format!(
                "an unresolved parameter reached the engine in a condition on `{name}`"
            ));
        }
        Operand::Column { .. } => {
            return Err("column-to-column comparisons are not supported".to_owned());
        }
    };
    let operator = match op {
        "=" => EQ,
        "!=" => NEQ,
        "<" => LT,
        ">" => GT,
        "<=" => LTE,
        ">=" => GTE,
        "IN" => IN,
        "NOT IN" => NOT_IN,
        "IS" => {
            return Ok(if literal.is_null() {
                Where::is_null(name.as_str())
            } else {
                Where::condition(name.as_str(), EQ, literal_value(literal, &column.r#type)?)
            });
        }
        "IS NOT" => {
            return Ok(if literal.is_null() {
                Where::is_not_null(name.as_str())
            } else {
                Where::condition(name.as_str(), NEQ, literal_value(literal, &column.r#type)?)
            });
        }
        "LIKE" | "ILIKE" | "NOT LIKE" | "NOT ILIKE" => {
            return Err(format!("{op} is not supported (a condition on `{name}`)"));
        }
        other => return Err(format!("unknown operator `{other}`")),
    };
    let value = if matches!(
        operator,
        ComparisonOperator::IN | ComparisonOperator::NOT_IN
    ) {
        let Json::Array(items) = literal else {
            return Err(format!("{op} on `{name}` needs a list"));
        };
        Value::List(
            items
                .iter()
                .map(|item| literal_value(item, &column.r#type))
                .collect::<Result<_, _>>()?,
        )
    } else {
        literal_value(literal, &column.r#type)?
    };
    Ok(Where::condition(name.as_str(), operator, value))
}

/// A JSON literal as the value a column of type `declared` compares
/// against. A JSON column's cells are the text `jsonb` writes, so a literal
/// against one, whatever its kind, is that text: the string `x` is `"x"`,
/// a number its digits, an object its canonical form.
fn literal_value(literal: &Json, declared: &ValueType) -> Result<Value, String> {
    Ok(match (literal, declared) {
        (Json::Null, _) => Value::Null,
        (Json::String(text), ValueType::Json) if text.contains('\0') => {
            return Err("a text value contains a NUL byte".to_owned());
        }
        (_, ValueType::Json) => Value::String(crate::sync::pg::text::jsonb_text(literal)),
        (Json::Bool(flag), _) => Value::Bool(*flag),
        (Json::Number(number), ValueType::Float) => {
            Value::Float(number.as_f64().unwrap_or(f64::NAN))
        }
        (Json::Number(number), ValueType::String) => Value::String(number.to_string()),
        (Json::Number(number), _) => match number.as_i64() {
            Some(int) => Value::Int(int),
            None => Value::Float(number.as_f64().unwrap_or(f64::NAN)),
        },
        (Json::String(text), _) if text.contains('\0') => {
            return Err("a text value contains a NUL byte".to_owned());
        }
        (Json::String(text), ValueType::Int | ValueType::Timestamp) => text
            .parse::<i64>()
            .map(Value::Int)
            .map_err(|_| format!("`{text}` is not a number"))?,
        (Json::String(text), ValueType::Float) => text
            .parse::<f64>()
            .map(Value::Float)
            .map_err(|_| format!("`{text}` is not a number"))?,
        (Json::String(text), _) => Value::String(text.clone()),
        (Json::Array(items), ValueType::List(inner)) => Value::List(
            items
                .iter()
                .map(|item| literal_value(item, inner))
                .collect::<Result<_, _>>()?,
        ),
        (Json::Array(items), _) => Value::List(
            items
                .iter()
                .map(|item| literal_value(item, declared))
                .collect::<Result<_, _>>()?,
        ),
        (Json::Object(_), _) => return Err("an object literal in a comparison".to_owned()),
    })
}

/// The `WHERE` a keyset cursor means over `order`: one branch per sort
/// column the cursor names (a cursor may stop short of the trailing
/// columns, the appended primary key in particular, and is then compared
/// on the prefix it has), earlier columns tied and the column itself
/// strictly past the cursor, plus the cursor row itself when inclusive.
fn keyset(bound: &Bound, order: &[OrderBy], table: &DbTable) -> Result<Where, String> {
    let mut keys = Vec::with_capacity(order.len());
    for clause in order {
        let name = clause.column.as_str();
        let Some(literal) = bound.row.get(name) else {
            break;
        };
        let declared = &table
            .column(name)
            .ok_or_else(|| format!("unknown column `{name}`"))?
            .r#type;
        keys.push((name, clause.direction, literal_value(literal, declared)?));
    }
    if keys.is_empty() {
        return Err("the cursor names none of the sort columns".to_owned());
    }
    let mut branches = Vec::with_capacity(keys.len() + 1);
    for (index, (column, direction, value)) in keys.iter().enumerate() {
        let op = match direction {
            Order::ASC => GT,
            Order::DESC => LT,
        };
        let mut conjuncts: Vec<Where> = keys[..index]
            .iter()
            .map(|(earlier, _, earlier_value)| {
                Where::condition(*earlier, EQ, earlier_value.clone())
            })
            .collect();
        conjuncts.push(Where::condition(*column, op, value.clone()));
        branches.push(collapse(conjuncts));
    }
    if !bound.exclusive {
        branches.push(collapse(
            keys.iter()
                .map(|(column, _, value)| Where::condition(*column, EQ, value.clone()))
                .collect(),
        ));
    }
    Ok(if branches.len() == 1 {
        branches.pop().expect("one branch")
    } else {
        Where::OR(branches)
    })
}

/// One part is itself; several are an `AND`; none is `TRUE`.
fn collapse(mut parts: Vec<Where>) -> Where {
    if parts.len() == 1 {
        parts.pop().expect("one part")
    } else {
        Where::AND(parts)
    }
}

/// Unwrap every single-child `AND` / `OR`.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DbColumn, DbTable};

    /// A small catalog: messages in conversations in channels, with
    /// participants.
    fn catalog() -> Catalog {
        Catalog::new(vec![
            DbTable::new(
                "messages",
                ["messageId"],
                vec![
                    DbColumn::new("messageId", ValueType::String),
                    DbColumn::new("conversationId", ValueType::String),
                    DbColumn::new("createdAt", ValueType::Timestamp),
                    DbColumn::new("visibleTo", ValueType::String),
                    DbColumn::new("metadata", ValueType::Json),
                ],
            ),
            DbTable::new(
                "conversations",
                ["conversationId"],
                vec![
                    DbColumn::new("conversationId", ValueType::String),
                    DbColumn::new("channelId", ValueType::String),
                ],
            ),
            DbTable::new(
                "channel_participants",
                ["id"],
                vec![
                    DbColumn::new("id", ValueType::String),
                    DbColumn::new("channelId", ValueType::String),
                    DbColumn::new("userId", ValueType::String),
                ],
            ),
            DbTable::new(
                "channels",
                ["id"],
                vec![
                    DbColumn::new("id", ValueType::String),
                    DbColumn::new("scopeType", ValueType::String),
                    DbColumn::new("visibility", ValueType::String),
                ],
            ),
            DbTable::new(
                "channel_stats",
                ["channelId"],
                vec![
                    DbColumn::new("channelId", ValueType::String),
                    DbColumn::new("lastActivityAt", ValueType::Int),
                ],
            ),
        ])
    }

    /// The DM list's root as the application server returns it: the
    /// app's test that the channel is a DM, and the permission rule's
    /// test that it is public or the reader is in it, both `EXISTS` on
    /// `channels` through `channelId = id`, with `acl` wrapping the rule
    /// as given (a plain sibling, or inside an `OR`).
    fn dm_list(acl: &str) -> Ast {
        serde_json::from_str(&format!(r#"{{
            "table": "channel_stats",
            "where": {{"type": "and", "conditions": [
                {{"type": "correlatedSubquery", "op": "EXISTS", "related": {{
                    "correlation": {{"parentField": ["channelId"], "childField": ["id"]}},
                    "subquery": {{"table": "channels", "where": {{"type": "or", "conditions": [
                        {{"type": "simple", "op": "=", "left": {{"type": "column", "name": "scopeType"}}, "right": {{"type": "literal", "value": "DM"}}}},
                        {{"type": "simple", "op": "=", "left": {{"type": "column", "name": "scopeType"}}, "right": {{"type": "literal", "value": "GROUP_DM"}}}}
                    ]}}}}
                }}}},
                {acl}
            ]}},
            "orderBy": [["lastActivityAt", "desc"]],
            "limit": 10
        }}"#)).expect("an AST")
    }

    /// The permission rule's `EXISTS` on channels.
    const ACL: &str = r#"{"type": "correlatedSubquery", "op": "EXISTS", "related": {
        "correlation": {"parentField": ["channelId"], "childField": ["id"]},
        "system": "permissions",
        "subquery": {"table": "channels", "where": {"type": "or", "conditions": [
            {"type": "simple", "op": "=", "left": {"type": "column", "name": "visibility"}, "right": {"type": "literal", "value": "PUBLIC"}},
            {"type": "correlatedSubquery", "op": "EXISTS", "related": {
                "correlation": {"parentField": ["id"], "childField": ["channelId"]},
                "subquery": {"table": "channel_participants", "where": {"type": "simple", "op": "=", "left": {"type": "column", "name": "userId"}, "right": {"type": "literal", "value": "me"}}}
            }}
        ]}}
    }}"#;

    /// Two `EXISTS` on `channels` through `channelId = id`, the channel's
    /// primary key, under the root's `AND` become one: one inner edge
    /// whose filter is the `AND` of both tests and whose subtree carries
    /// the rule's nested edge; the merged channels are shipped (the app's
    /// test needs them), the rule's memberships stay hidden.
    #[test]
    fn sibling_exists_on_a_to_one_relationship_merge() {
        let translated = translate(&dm_list(ACL), &catalog()).unwrap();
        let root = &translated.query;
        assert_eq!(root.joins.len(), 1, "one edge for both tests: {root:?}");
        let channels = &root.joins[0];
        assert!(channels.is_inner);
        assert_eq!(channels.sub.main_table.table.as_str(), "channels");
        let Where::AND(both) = &channels.sub.main_table.filter else {
            panic!(
                "the AND of both tests: {:?}",
                channels.sub.main_table.filter
            );
        };
        assert_eq!(both.len(), 2, "{both:?}");
        assert!(
            matches!(&both[0], Where::OR(_)),
            "the app's scope test: {:?}",
            both[0]
        );
        assert!(
            matches!(&both[1], Where::OR(_)),
            "the rule's visibility test: {:?}",
            both[1]
        );
        assert_eq!(channels.sub.joins.len(), 1, "the rule's memberships edge");
        assert_eq!(
            channels.sub.joins[0].sub.main_table.table.as_str(),
            "channel_participants"
        );
        assert!(
            !translated.hidden.contains(&QueryPart::join(0)),
            "the merged channels are shipped"
        );
        assert!(
            translated.hidden.contains(&QueryPart::new(&[0, 0])),
            "the rule's memberships stay hidden"
        );
        let rendered = format!("{:?}", root.main_table.filter);
        assert_eq!(
            rendered.matches("EXISTS").count(),
            1,
            "one leaf: {rendered}"
        );
    }

    /// The same rule inside an `OR` at the root is not a sibling test and
    /// is left alone: two edges, the rule's hidden whole.
    #[test]
    fn an_exists_inside_an_or_is_not_merged() {
        let inside_or = format!(
            r#"{{"type": "or", "conditions": [
                {{"type": "simple", "op": "=", "left": {{"type": "column", "name": "lastActivityAt"}}, "right": {{"type": "literal", "value": 0}}}},
                {ACL}
            ]}}"#
        );
        let translated = translate(&dm_list(&inside_or), &catalog()).unwrap();
        assert_eq!(translated.query.joins.len(), 2, "{:?}", translated.query);
        assert!(translated.hidden.contains(&QueryPart::join(1)));
        assert!(!translated.hidden.contains(&QueryPart::join(0)));
    }

    /// Two tests on a one-to-many relationship (participants through the
    /// channel's id, not the participants' key) each reach many rows, so
    /// they are not one test and are not merged.
    #[test]
    fn exists_on_a_one_to_many_relationship_are_not_merged() {
        let participant = |user: &str| {
            format!(
                r#"{{"type": "correlatedSubquery", "op": "EXISTS", "related": {{
                "correlation": {{"parentField": ["id"], "childField": ["channelId"]}},
                "subquery": {{"table": "channel_participants", "where": {{"type": "simple", "op": "=", "left": {{"type": "column", "name": "userId"}}, "right": {{"type": "literal", "value": "{user}"}}}}}}
            }}}}"#
            )
        };
        let ast: Ast = serde_json::from_str(&format!(
            r#"{{"table": "channels", "where": {{"type": "and", "conditions": [{}, {}]}}}}"#,
            participant("me"),
            participant("you")
        ))
        .unwrap();
        let translated = translate(&ast, &catalog()).unwrap();
        assert_eq!(translated.query.joins.len(), 2, "{:?}", translated.query);
    }

    /// A message thread with a visibility rule, a related conversation,
    /// an EXISTS on participants, a compound order with a cursor and a
    /// limit, translated end to end.
    #[test]
    fn translates_a_thread_query() {
        let ast: Ast = serde_json::from_str(r#"{
            "table": "messages",
            "where": {"type": "and", "conditions": [
                {"type": "simple", "op": "=", "left": {"type": "column", "name": "conversationId"}, "right": {"type": "literal", "value": "cv1"}},
                {"type": "or", "conditions": [
                    {"type": "simple", "op": "IS", "left": {"type": "column", "name": "visibleTo"}, "right": {"type": "literal", "value": null}},
                    {"type": "simple", "op": "=", "left": {"type": "column", "name": "visibleTo"}, "right": {"type": "literal", "value": "me"}}
                ]},
                {"type": "correlatedSubquery", "op": "EXISTS", "related": {
                    "correlation": {"parentField": ["conversationId"], "childField": ["conversationId"]},
                    "system": "permissions",
                    "subquery": {"table": "conversations", "where": {"type": "correlatedSubquery", "op": "EXISTS", "related": {
                        "correlation": {"parentField": ["channelId"], "childField": ["channelId"]},
                        "subquery": {"table": "channel_participants", "where": {"type": "simple", "op": "=", "left": {"type": "column", "name": "userId"}, "right": {"type": "literal", "value": "me"}}}
                    }}}
                }}
            ]},
            "related": [{"correlation": {"parentField": ["conversationId"], "childField": ["conversationId"]}, "subquery": {"table": "conversations", "limit": 1}}],
            "orderBy": [["createdAt", "desc"]],
            "start": {"row": {"createdAt": 1000, "messageId": "m9"}, "exclusive": true},
            "limit": 20
        }"#).unwrap();
        let translated = translate(&ast, &catalog()).unwrap();
        let root = &translated.query;
        assert_eq!(root.main_table.limit, 20);
        assert_eq!(
            root.main_table.order_by.len(),
            2,
            "the primary key is appended"
        );
        assert_eq!(root.joins.len(), 2);
        assert!(!root.joins[0].is_inner, "related is a LEFT edge");
        assert!(root.joins[1].is_inner, "EXISTS is an INNER edge");
        assert_eq!(
            root.joins[1].driver,
            crate::model::Driver::Sub,
            "as translated, the sub drives an EXISTS"
        );
        assert_eq!(
            root.joins[0].sub.main_table.limit, 1,
            "a related limit is kept, as a window per parent row"
        );
        assert_eq!(root.joins[1].sub.joins.len(), 1, "nested EXISTS");
        assert!(
            translated.hidden.contains(&QueryPart::join(1)),
            "the permission part is hidden"
        );
        assert!(
            translated.hidden.contains(&QueryPart::new(&[1, 0])),
            "and its subtree"
        );
        assert!(!translated.hidden.contains(&QueryPart::join(0)));
        let rendered = format!("{:?}", root.main_table.filter);
        assert!(
            rendered.contains("EXISTS"),
            "the EXISTS leaf sits in the filter: {rendered}"
        );
        assert!(
            rendered.contains("LT") && rendered.contains("GT"),
            "the cursor is a WHERE: {rendered}"
        );
    }

    /// A cursor that stops short of the appended primary key is compared
    /// on the columns it has; one that names no sort column is refused.
    #[test]
    fn cursors_compare_on_their_prefix() {
        let ast: Ast = serde_json::from_str(r#"{"table": "messages", "orderBy": [["createdAt", "desc"]], "start": {"row": {"createdAt": 1000}, "exclusive": true}, "limit": 5}"#).unwrap();
        let translated = translate(&ast, &catalog()).unwrap();
        assert_eq!(
            translated.query.main_table.filter,
            Where::condition("createdAt", LT, Value::Int(1000))
        );
        let empty: Ast = serde_json::from_str(r#"{"table": "messages", "orderBy": [["createdAt", "desc"]], "start": {"row": {"other": 1}, "exclusive": true}}"#).unwrap();
        assert!(
            translate(&empty, &catalog())
                .unwrap_err()
                .contains("none of the sort columns")
        );
    }

    /// What the engine cannot run is refused by name.
    /// A text argument with a NUL byte is refused at translation: the
    /// database's text cannot hold it, and a read carrying it would fail
    /// on every attempt.
    #[test]
    fn refuses_a_nul_byte_in_a_text_argument() {
        let nul: Ast = serde_json::from_str(r#"{"table": "messages", "where": {"type": "simple", "op": "=", "left": {"type": "column", "name": "visibleTo"}, "right": {"type": "literal", "value": "a\u0000b"}}}"#).unwrap();
        assert!(
            translate(&nul, &catalog())
                .unwrap_err()
                .contains("NUL byte")
        );
    }

    #[test]
    fn refuses_what_it_cannot_run() {
        let like: Ast = serde_json::from_str(r#"{"table": "messages", "where": {"type": "simple", "op": "ILIKE", "left": {"type": "column", "name": "visibleTo"}, "right": {"type": "literal", "value": "%x%"}}}"#).unwrap();
        assert!(translate(&like, &catalog()).unwrap_err().contains("ILIKE"));
        let unknown: Ast = serde_json::from_str(r#"{"table": "nope"}"#).unwrap();
        assert!(
            translate(&unknown, &catalog())
                .unwrap_err()
                .contains("nope")
        );
        let not_exists: Ast = serde_json::from_str(r#"{"table": "messages", "where": {"type": "correlatedSubquery", "op": "NOT EXISTS", "related": {"correlation": {"parentField": ["conversationId"], "childField": ["conversationId"]}, "subquery": {"table": "conversations"}}}}"#).unwrap();
        assert!(
            translate(&not_exists, &catalog())
                .unwrap_err()
                .contains("NOT EXISTS")
        );
    }

    /// A literal compared with a JSON column is the text `jsonb` writes
    /// for it, whatever its kind, because that is what the column's cells
    /// hold: the support desk filters `actualFieldValue = "high"`, and the
    /// cell of a matching row is `"high"` with its quotes.
    #[test]
    fn a_literal_against_a_json_column_is_jsonb_text() {
        let json = ValueType::Json;
        let value = |literal: Json| literal_value(&literal, &json).expect("a value");
        assert_eq!(value(serde_json::json!("high")), Value::from("\"high\""));
        assert_eq!(value(serde_json::json!(5)), Value::from("5"));
        assert_eq!(value(serde_json::json!(true)), Value::from("true"));
        assert_eq!(
            value(serde_json::json!({"b": [1, 2], "a": "x"})),
            Value::from("{\"a\": \"x\", \"b\": [1, 2]}")
        );
        assert_eq!(value(Json::Null), Value::Null);
        assert!(literal_value(&serde_json::json!("a\u{0}b"), &json).is_err());
        assert_eq!(
            literal_value(&serde_json::json!("high"), &ValueType::String).expect("a value"),
            Value::from("high"),
            "a text column still compares with the bare text"
        );
        assert_eq!(
            literal_value(&serde_json::json!(["a", 1]), &json).expect("a value"),
            Value::from("[\"a\", 1]"),
            "an array against a JSON column is one JSON value, not a list of them"
        );
    }
}
