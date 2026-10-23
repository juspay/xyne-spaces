//! Schema changes as the schema-change event trigger's messages report
//! them. Its end trigger (`<app>_ddl_end_<shard>`, on `ddl_command_end`)
//! writes a logical message into the WAL inside the migration's own
//! transaction, with prefix `<app>/<shard>/ddl`, whenever the published
//! schema changed; the feed receives it at the position of the change,
//! ahead of any row of the same transaction. The payload is the whole published
//! schema before and after the command (`previousSchema`, `schema`): every
//! table with its columns (name, type name, type class, default text) and
//! its key. This module parses it, tells what happened from the two
//! schemas against the catalog the server holds, and turns what the
//! server absorbs into [`SchemaChange`]s: a table added, a column added
//! with no default or a constant one, together with the catalog those
//! changes make. Anything else a migration did to a table's shape is a
//! reason to stop, and the server stops.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use tokio_postgres::Client;

use super::catalog::{scalar_type, table_name};
use super::text;
use crate::ivm::SchemaChange;
use crate::model::{Catalog, DbColumn, DbTable, TableName, Value, ValueType};
use crate::sync::catalog::{with_column, with_table};
use crate::sync::storage::StorageError;

/// Where the feed hears of schema changes: the prefix of the trigger's
/// messages, and the schemas whose tables the catalog serves (a table
/// added elsewhere is not carried).
#[derive(Debug, Clone)]
pub struct DdlSource {
    pub prefix: String,
    pub schemas: Vec<String>,
}

/// What one message meant: the changes to absorb, in the order they
/// apply, and the catalog they make. A column added carries the row
/// layout of that catalog's table, the one every row decoded from then on
/// shares, so a row on it is known complete at a glance.
#[derive(Debug)]
pub struct Classified {
    pub changes: Vec<SchemaChange>,
    pub catalog: Catalog,
}

/// One message of the trigger, as much of it as the server reads.
#[derive(Debug, Deserialize)]
pub struct DdlMessage {
    #[serde(rename = "type")]
    pub kind: String,
    pub event: Option<DdlEvent>,
    pub schema: Option<PublishedSchema>,
    #[serde(rename = "previousSchema")]
    pub previous: Option<PublishedSchema>,
}

/// The command that fired the trigger.
#[derive(Debug, Deserialize)]
pub struct DdlEvent {
    pub tag: String,
}

/// The published schema at one moment: its tables (indexes are not read).
#[derive(Debug, Deserialize)]
pub struct PublishedSchema {
    pub tables: Vec<PublishedTable>,
}

/// One published table: its schema and name, its columns by name, and its
/// primary key in order.
#[derive(Debug, Deserialize)]
pub struct PublishedTable {
    pub schema: String,
    pub name: String,
    pub columns: HashMap<String, PublishedColumn>,
    #[serde(rename = "primaryKey", default)]
    pub primary_key: Vec<String>,
}

/// One published column: its type as `pg_type` names it (an array as
/// `text[]`), the type's class (`e` for an enum), and its default
/// expression's text when it has one.
#[derive(Debug, Deserialize)]
pub struct PublishedColumn {
    #[serde(rename = "dataType")]
    pub data_type: String,
    #[serde(rename = "pgTypeClass")]
    pub pg_type_class: Option<String>,
    pub dflt: Option<String>,
}

impl DdlMessage {
    /// The message parsed from its text.
    pub fn parse(text: &str) -> Result<DdlMessage, String> {
        serde_json::from_str(text).map_err(|error| format!("unreadable DDL message: {error}"))
    }

    /// Whether the message carries a schema after a change (`ddlUpdate`,
    /// or the `schemaSnapshot` a comment on the publication produces);
    /// `ddlStart` does not.
    pub fn is_update(&self) -> bool {
        matches!(self.kind.as_str(), "ddlUpdate" | "schemaSnapshot") && self.schema.is_some()
    }

    /// The command tag, for the log.
    pub fn tag(&self) -> &str {
        self.event.as_ref().map_or("?", |event| event.tag.as_str())
    }
}

impl PublishedTable {
    /// The catalog name of the table.
    pub fn catalog_name(&self) -> String {
        table_name(&self.schema, &self.name)
    }

    /// The table as the catalog would carry it: its carriable columns and
    /// its key; `None` when it has no key or a key column is not carriable,
    /// with the reason.
    pub fn to_db_table(&self) -> Result<DbTable, String> {
        if self.primary_key.is_empty() {
            return Err(format!("{}: no primary key", self.catalog_name()));
        }
        let mut columns = Vec::with_capacity(self.columns.len());
        for (name, column) in &self.columns {
            match column_type(column) {
                Some(r#type) => columns.push(DbColumn::new(name.as_str(), r#type)),
                None if self.primary_key.iter().any(|key| key == name) => {
                    return Err(format!(
                        "{}: key column `{name}` has an uncarried type {}",
                        self.catalog_name(),
                        column.data_type
                    ));
                }
                None => {}
            }
        }
        Ok(DbTable::new(
            self.catalog_name(),
            self.primary_key.iter().map(String::as_str),
            columns,
        ))
    }
}

/// The engine's type for a published column, mapped as the startup
/// catalog maps `information_schema`: an array is a list of its element's
/// type, an enum is a string, `bytea` is not carried.
pub fn column_type(column: &PublishedColumn) -> Option<ValueType> {
    if let Some(element) = column.data_type.strip_suffix("[]") {
        let element = element.trim_end_matches("[]");
        return Some(ValueType::List(Box::new(
            scalar_type(element).unwrap_or(ValueType::String),
        )));
    }
    if column.pg_type_class.as_deref() == Some("e") {
        return Some(ValueType::String);
    }
    scalar_type(&column.data_type)
}

/// The value every existing row holds for a column added with default
/// `text`, when it can be known from the text alone: no default is
/// `NULL`; a constant (a quoted literal with or without a cast, a number,
/// `true`, `false`, `NULL`) is that value in the column's type. `None`
/// for an expression (`now()`, `gen_random_uuid()`, `nextval(…)`, and
/// anything else the parser does not recognise), whose value only the
/// database's rows hold.
pub fn parse_default(text: Option<&str>, declared: &ValueType) -> Option<Value> {
    let Some(text) = text else {
        return Some(Value::Null);
    };
    let literal = strip_cast(text.trim());
    if literal.eq_ignore_ascii_case("null") {
        return Some(Value::Null);
    }
    if let Some(quoted) = quoted_literal(literal) {
        return typed(&quoted, declared);
    }
    match literal {
        "true" | "false" => match declared {
            ValueType::Bool => Some(Value::Bool(literal == "true")),
            ValueType::String => Some(Value::String(literal.to_owned())),
            _ => None,
        },
        _ if literal
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'-' || byte == b'.')
            && literal.bytes().any(|byte| byte.is_ascii_digit()) =>
        {
            typed(literal, declared)
        }
        _ => None,
    }
}

/// `text` without the trailing cast PostgreSQL writes on a default
/// (`'x'::text`, `'{}'::jsonb`, `0::bigint`, `'a'::character varying`),
/// and without one pair of parentheses around it.
fn strip_cast(text: &str) -> &str {
    let mut text = text;
    loop {
        let trimmed = text.trim();
        let unwrapped = trimmed
            .strip_prefix('(')
            .and_then(|inner| inner.strip_suffix(')'))
            .filter(|inner| !inner.contains(['(', ')']))
            .unwrap_or(trimmed);
        let uncast = match quoted_end(unwrapped) {
            Some(end) => match unwrapped[end..].strip_prefix("::") {
                Some(rest) if is_type_name(rest) => &unwrapped[..end],
                _ => unwrapped,
            },
            None => match unwrapped.find("::") {
                Some(at)
                    if is_type_name(&unwrapped[at + 2..])
                        && !unwrapped[..at].contains(['(', ' ']) =>
                {
                    &unwrapped[..at]
                }
                _ => unwrapped,
            },
        };
        if uncast == text {
            return text;
        }
        text = uncast;
    }
}

/// Whether `text` is nothing but a type name as a cast writes it:
/// `text`, `character varying(20)`, `timestamp with time zone`, `text[]`.
fn is_type_name(text: &str) -> bool {
    let text = text.trim();
    !text.is_empty()
        && text
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'"')
        && text.bytes().all(|b| {
            b.is_ascii_alphanumeric()
                || matches!(
                    b,
                    b'_' | b' ' | b'(' | b')' | b',' | b'[' | b']' | b'"' | b'.'
                )
        })
}

/// Where the quoted literal `text` starts with ends (the index after its
/// closing quote), honouring doubled quotes.
fn quoted_end(text: &str) -> Option<usize> {
    let mut bytes = text.bytes().enumerate();
    bytes.next().filter(|(_, byte)| *byte == b'\'')?;
    while let Some((index, byte)) = bytes.next() {
        if byte == b'\'' {
            match text.as_bytes().get(index + 1) {
                Some(b'\'') => {
                    bytes.next();
                }
                _ => return Some(index + 1),
            }
        }
    }
    None
}

/// The content of a whole quoted literal, doubled quotes undoubled.
fn quoted_literal(text: &str) -> Option<String> {
    let end = quoted_end(text)?;
    (end == text.len()).then(|| text[1..end - 1].replace("''", "'"))
}

/// A literal's text as a value of `declared`, or `None` when it does not
/// read as one.
fn typed(text: &str, declared: &ValueType) -> Option<Value> {
    Some(match declared {
        ValueType::String => Value::String(text.to_owned()),
        ValueType::Json => Value::String(text::json_as_jsonb(text)),
        ValueType::Int => Value::Int(text.parse().ok()?),
        ValueType::Float => Value::Float(text.parse().ok()?),
        ValueType::Bool => Value::Bool(match text {
            "t" | "true" | "1" => true,
            "f" | "false" | "0" => false,
            _ => return None,
        }),
        ValueType::Timestamp => Value::Int(text::epoch_millis(text)?),
        ValueType::List(inner) => match text::array_literal(text, inner) {
            Value::List(items) => Value::List(items),
            _ => return None,
        },
        ValueType::Date | ValueType::Datetime | ValueType::Map(_, _) => return None,
    })
}

/// What a message means against `catalog`, for the tables of `schemas`:
/// the changes to absorb with the catalog they make, or the reason the
/// server must stop. A message that changes nothing the catalog carries
/// classifies as no change and the catalog as it was.
pub fn classify(
    catalog: &Catalog,
    schemas: &[String],
    message: &DdlMessage,
) -> Result<Classified, String> {
    let Some(after) = &message.schema else {
        return Ok(Classified {
            changes: Vec::new(),
            catalog: catalog.clone(),
        });
    };
    let served = |table: &PublishedTable| schemas.contains(&table.schema);
    let before: HashMap<String, &PublishedTable> = message
        .previous
        .iter()
        .flat_map(|schema| schema.tables.iter())
        .filter(|table| served(table))
        .map(|table| (table.catalog_name(), table))
        .collect();
    let mut changes = Vec::new();
    let mut catalog_now = catalog.clone();
    let mut present: HashSet<String> = HashSet::new();
    for table in after.tables.iter().filter(|table| served(table)) {
        let name = table.catalog_name();
        present.insert(name.clone());
        match catalog.table(&name) {
            None => {
                if before.contains_key(&name) {
                    continue;
                }
                match table.to_db_table() {
                    Ok(added) => {
                        catalog_now = with_table(&catalog_now, added.clone());
                        changes.push(SchemaChange::TableAdded { table: added });
                    }
                    Err(reason) => crate::log::log_warn!("new table not carried: {reason}"),
                }
            }
            Some(held) => {
                for change in column_changes(held, table)? {
                    if let SchemaChange::ColumnAdded { column, .. } = &change
                        && let Some(current) = catalog_now.table(&name)
                    {
                        catalog_now =
                            with_table(&catalog_now, with_column(current, column.clone()));
                    }
                    changes.push(change);
                }
            }
        }
    }
    for (name, _) in before {
        if !present.contains(&name) && catalog.table(&name).is_some() {
            return Err(format!("table `{name}` was removed or renamed"));
        }
    }
    let changes = changes
        .into_iter()
        .map(|change| match change {
            SchemaChange::ColumnAdded {
                table,
                column,
                value,
                ..
            } => {
                let schema = catalog_now
                    .table(table.as_str())
                    .map(|held| held.row_schema().clone())
                    .expect("the widened table is in the catalog built above");
                SchemaChange::ColumnAdded {
                    table,
                    column,
                    value,
                    schema,
                }
            }
            other => other,
        })
        .collect();
    Ok(Classified {
        changes,
        catalog: catalog_now,
    })
}

/// The columns `published` has that `held` lacks, as additions; an error
/// for a column `held` has that `published` lacks or carries as another
/// kind, for a key that changed, and for an addition whose default is an
/// expression.
fn column_changes(held: &DbTable, published: &PublishedTable) -> Result<Vec<SchemaChange>, String> {
    let name = held.name.clone();
    let key: Vec<&str> = published.primary_key.iter().map(String::as_str).collect();
    let held_key: Vec<&str> = held.pkey.iter().map(|column| column.as_str()).collect();
    if key != held_key {
        return Err(format!(
            "the primary key of `{name}` changed from ({}) to ({})",
            held_key.join(", "),
            key.join(", ")
        ));
    }
    for (column_name, column) in &held.columns {
        match published.columns.get(column_name.as_str()) {
            None => {
                return Err(format!(
                    "column `{column_name}` of `{name}` was removed or renamed"
                ));
            }
            Some(after) => {
                let now = column_type(after);
                if now.as_ref() != Some(&column.r#type) {
                    return Err(format!(
                        "column `{column_name}` of `{name}` changed type to {} ({:?} from {:?})",
                        after.data_type, now, column.r#type
                    ));
                }
            }
        }
    }
    let mut added: Vec<(&String, &PublishedColumn)> = published
        .columns
        .iter()
        .filter(|(column_name, _)| held.column(column_name.as_str()).is_none())
        .collect();
    added.sort_by(|a, b| a.0.cmp(b.0));
    let mut changes = Vec::new();
    for (column_name, column) in added {
        let Some(r#type) = column_type(column) else {
            crate::log::log_warn!(
                "new column `{column_name}` of `{name}` is not carried: {}",
                column.data_type
            );
            continue;
        };
        let Some(value) = parse_default(column.dflt.as_deref(), &r#type) else {
            return Err(format!(
                "column `{column_name}` of `{name}` was added with an expression default ({})",
                column.dflt.as_deref().unwrap_or("")
            ));
        };
        changes.push(SchemaChange::ColumnAdded {
            table: TableName::from(name.as_str()),
            column: DbColumn::new(column_name.as_str(), r#type),
            value,
            schema: held.row_schema().clone(),
        });
    }
    Ok(changes)
}

/// Whether the event trigger `name` exists on `ddl_command_end` and is
/// enabled; what the server insists on before it serves.
pub async fn trigger_present(client: &Client, name: &str) -> Result<bool, StorageError> {
    let row = client
        .query_opt(
            "SELECT evtenabled::text FROM pg_event_trigger WHERE evtname = $1 AND evtevent = 'ddl_command_end'",
            &[&name],
        )
        .await?;
    Ok(row.is_some_and(|row| row.get::<_, String>(0) != "D"))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::model::{DbColumn, DbTable, ValueType};

    /// A `ddlUpdate` as the trigger writes it, cut down to the fields read.
    fn message(previous: &str, after: &str) -> DdlMessage {
        DdlMessage::parse(&format!(
            r#"{{"type": "ddlUpdate", "version": 1, "event": {{"tag": "ALTER TABLE"}},
                 "context": {{"query": "alter table"}},
                 "previousSchema": {{"tables": [{previous}], "indexes": []}},
                 "schema": {{"tables": [{after}], "indexes": []}}}}"#
        ))
        .expect("a message")
    }

    /// One table of the payload.
    fn published(name: &str, columns: &[(&str, &str, Option<&str>)], key: &[&str]) -> String {
        let columns: Vec<String> = columns
            .iter()
            .map(|(column, data_type, dflt)| {
                format!(
                    r#""{column}": {{"pos": 1, "dataType": "{data_type}", "pgTypeClass": "b", "typeOID": 1, "notNull": false, "dflt": {}}}"#,
                    dflt.map_or("null".to_owned(), |text| format!("\"{}\"", text.replace('"', "\\\"")))
                )
            })
            .collect();
        let key: Vec<String> = key.iter().map(|k| format!("\"{k}\"")).collect();
        format!(
            r#"{{"oid": 1, "schema": "public", "name": "{name}", "columns": {{{}}}, "primaryKey": [{}], "publications": {{}}}}"#,
            columns.join(", "),
            key.join(", ")
        )
    }

    /// The catalog before the migration: tickets(id, status).
    fn catalog() -> Catalog {
        Catalog::new(vec![DbTable::new(
            "tickets",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("status", ValueType::String),
            ],
        )])
    }

    const TICKETS: &[(&str, &str, Option<&str>)] =
        &[("id", "int8", None), ("status", "text", None)];

    /// The defaults PostgreSQL writes: a constant is read in the column's
    /// type, no default is `NULL`, an expression is unknown.
    #[test]
    fn defaults_are_read_when_constant() {
        let text = |t: &str| parse_default(Some(t), &ValueType::String);
        assert_eq!(text("'PENDING'::text"), Some(Value::from("PENDING")));
        assert_eq!(
            text("'it''s'::character varying"),
            Some(Value::from("it's"))
        );
        assert_eq!(text("'x'"), Some(Value::from("x")));
        assert_eq!(parse_default(None, &ValueType::String), Some(Value::Null));
        assert_eq!(
            parse_default(Some("NULL::text"), &ValueType::Int),
            Some(Value::Null)
        );
        assert_eq!(
            parse_default(Some("false"), &ValueType::Bool),
            Some(Value::Bool(false))
        );
        assert_eq!(
            parse_default(Some("0"), &ValueType::Int),
            Some(Value::Int(0))
        );
        assert_eq!(
            parse_default(Some("'42'::bigint"), &ValueType::Int),
            Some(Value::Int(42))
        );
        assert_eq!(
            parse_default(Some("(-1)"), &ValueType::Int),
            Some(Value::Int(-1))
        );
        assert_eq!(
            parse_default(Some("1.5"), &ValueType::Float),
            Some(Value::Float(1.5))
        );
        assert_eq!(
            parse_default(Some("'{\"b\": 1, \"a\": [1.50]}'::jsonb"), &ValueType::Json),
            Some(Value::from("{\"a\": [1.5], \"b\": 1}")),
            "a JSON default in the standard form"
        );
        assert_eq!(
            parse_default(
                Some("'{a,b}'::text[]"),
                &ValueType::List(Box::new(ValueType::String))
            ),
            Some(Value::List(vec![Value::from("a"), Value::from("b")]))
        );
        assert_eq!(
            parse_default(
                Some("'2026-01-02 03:04:05+00'::timestamp with time zone"),
                &ValueType::Timestamp
            ),
            Some(Value::Int(
                text::epoch_millis("2026-01-02 03:04:05+00").unwrap()
            ))
        );
        for expression in [
            "now()",
            "CURRENT_TIMESTAMP",
            "(gen_random_uuid())::text",
            "nextval('t_id_seq'::regclass)",
            "(1 + 2)",
            "'x'::text || 'y'",
        ] {
            assert_eq!(
                parse_default(Some(expression), &ValueType::String),
                None,
                "{expression}"
            );
        }
        assert_eq!(
            parse_default(Some("'abc'"), &ValueType::Int),
            None,
            "not a number"
        );
    }

    /// Published types map as the startup catalog maps them.
    #[test]
    fn published_types_map_like_the_catalog() {
        let column = |data_type: &str, class: &str| PublishedColumn {
            data_type: data_type.to_owned(),
            pg_type_class: Some(class.to_owned()),
            dflt: None,
        };
        assert_eq!(column_type(&column("int8", "b")), Some(ValueType::Int));
        assert_eq!(
            column_type(&column("timestamptz", "b")),
            Some(ValueType::Timestamp)
        );
        assert_eq!(column_type(&column("jsonb", "b")), Some(ValueType::Json));
        assert_eq!(
            column_type(&column("TicketStatus", "e")),
            Some(ValueType::String)
        );
        assert_eq!(
            column_type(&column("text[]", "b")),
            Some(ValueType::List(Box::new(ValueType::String)))
        );
        assert_eq!(column_type(&column("bytea", "b")), None);
    }

    /// A column added with a constant default, a table added, both
    /// together; the rest of the schema unchanged is nothing.
    #[test]
    fn additions_are_absorbed() {
        let wider = published(
            "tickets",
            &[
                ("id", "int8", None),
                ("status", "text", None),
                ("owner", "text", Some("'nobody'::text")),
            ],
            &["id"],
        );
        let classified = classify(
            &catalog(),
            &["public".into()],
            &message(&published("tickets", TICKETS, &["id"]), &wider),
        )
        .unwrap();
        let changes = &classified.changes;
        assert_eq!(changes.len(), 1);
        let SchemaChange::ColumnAdded {
            table,
            column,
            value,
            schema,
        } = &changes[0]
        else {
            panic!("{changes:?}");
        };
        assert_eq!(table.as_str(), "tickets");
        assert_eq!(column.name.as_str(), "owner");
        assert_eq!(*value, Value::from("nobody"));
        assert_eq!(
            schema
                .names()
                .iter()
                .map(|c| c.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "owner", "status"],
            "the layout with the column in it"
        );
        let next = &classified.catalog;
        assert!(next.table("tickets").unwrap().column("owner").is_some());
        assert!(
            Arc::ptr_eq(schema, next.table("tickets").unwrap().row_schema()),
            "the change carries the layout the new catalog's rows share"
        );

        let users = published(
            "users",
            &[("id", "text", None), ("name", "text", None)],
            &["id"],
        );
        let both = format!("{wider}, {users}");
        let classified = classify(
            &catalog(),
            &["public".into()],
            &message(&published("tickets", TICKETS, &["id"]), &both),
        )
        .unwrap();
        assert_eq!(classified.changes.len(), 2);
        assert!(
            matches!(&classified.changes[1], SchemaChange::TableAdded { table } if table.name.as_str() == "users")
        );
        assert_eq!(classified.catalog.tables().count(), 2);

        let same = message(
            &published("tickets", TICKETS, &["id"]),
            &published("tickets", TICKETS, &["id"]),
        );
        assert!(
            classify(&catalog(), &["public".into()], &same)
                .unwrap()
                .changes
                .is_empty()
        );
        let elsewhere = message("", &published("users", &[("id", "text", None)], &["id"]));
        assert!(
            classify(&catalog(), &["other".into()], &elsewhere)
                .unwrap()
                .changes
                .is_empty(),
            "a schema not served is not looked at"
        );
        let keyless = message("", &published("notes", &[("id", "text", None)], &[]));
        assert!(
            classify(&catalog(), &["public".into()], &keyless)
                .unwrap()
                .changes
                .is_empty()
        );
    }

    /// Everything else stops the server, with the reason.
    #[test]
    fn other_changes_are_refused_by_name() {
        let before = published("tickets", TICKETS, &["id"]);
        let cases: Vec<(&str, String)> = vec![
            (
                "removed or renamed",
                published("tickets", &[("id", "int8", None)], &["id"]),
            ),
            (
                "removed or renamed",
                published(
                    "tickets",
                    &[("id", "int8", None), ("state", "text", None)],
                    &["id"],
                ),
            ),
            (
                "changed type",
                published(
                    "tickets",
                    &[("id", "int8", None), ("status", "jsonb", None)],
                    &["id"],
                ),
            ),
            ("primary key", published("tickets", TICKETS, &["status"])),
            (
                "expression default",
                published(
                    "tickets",
                    &[
                        ("id", "int8", None),
                        ("status", "text", None),
                        ("at", "timestamptz", Some("now()")),
                    ],
                    &["id"],
                ),
            ),
        ];
        for (expected, after) in cases {
            let error =
                classify(&catalog(), &["public".into()], &message(&before, &after)).unwrap_err();
            assert!(error.contains(expected), "{error}");
        }
        let dropped = message(&before, "");
        let error = classify(&catalog(), &["public".into()], &dropped).unwrap_err();
        assert!(
            error.contains("`tickets` was removed or renamed"),
            "{error}"
        );
        let retyped_within_kind = published(
            "tickets",
            &[("id", "int4", None), ("status", "varchar", None)],
            &["id"],
        );
        assert!(
            classify(
                &catalog(),
                &["public".into()],
                &message(&before, &retyped_within_kind)
            )
            .unwrap()
            .changes
            .is_empty()
        );
    }

    /// A start message and a message without a schema mean nothing.
    #[test]
    fn only_updates_count() {
        let start = DdlMessage::parse(r#"{"type": "ddlStart", "version": 1, "event": {"tag": "ALTER TABLE"}, "context": {"query": "x"}, "previousSchema": null, "schema": {"tables": [], "indexes": []}}"#).unwrap();
        assert!(!start.is_update());
        assert_eq!(start.tag(), "ALTER TABLE");
        let update = message("", "");
        assert!(update.is_update());
    }
}
