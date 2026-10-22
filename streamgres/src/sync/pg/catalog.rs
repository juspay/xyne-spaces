//! The catalog read from the database itself: every table of the chosen
//! schemas that has a primary key, its columns mapped onto the engine's
//! value types the way the sync protocol maps them for its clients (times as epoch
//! milliseconds, JSON and arrays as JSON, enums and uuids as strings,
//! `bytea` left out), so a server needs no hand-written schema. Tables of
//! the `public` schema keep their bare names; any other table is named
//! `schema.table`, which is also how the change feed matches it.

use std::collections::BTreeMap;

use tokio_postgres::Client;

use super::StorageError;
use crate::model::{Catalog, DbColumn, DbTable, ValueType};

/// What the load left out and why, one line per table or column.
pub type Notes = Vec<String>;

/// Read the catalog of `schemas` through `client`.
pub async fn load_catalog(
    client: &Client,
    schemas: &[String],
) -> Result<(Catalog, Notes), StorageError> {
    let columns = client
        .query(
            "SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema = c.table_schema AND t.table_name = c.table_name
             WHERE t.table_type = 'BASE TABLE' AND c.table_schema = ANY($1)
             ORDER BY c.table_schema, c.table_name, c.ordinal_position",
            &[&schemas],
        )
        .await?;
    let keys = client
        .query(
            "SELECT tc.table_schema, tc.table_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON kcu.constraint_name = tc.constraint_name
              AND kcu.constraint_schema = tc.constraint_schema
              AND kcu.table_name = tc.table_name
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = ANY($1)
             ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position",
            &[&schemas],
        )
        .await?;
    let mut pkeys: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for row in &keys {
        let schema: String = row.get(0);
        let table: String = row.get(1);
        let column: String = row.get(2);
        pkeys.entry((schema, table)).or_default().push(column);
    }
    let mut declared: BTreeMap<(String, String), Vec<DbColumn>> = BTreeMap::new();
    let mut notes = Vec::new();
    for row in &columns {
        let schema: String = row.get(0);
        let table: String = row.get(1);
        let column: String = row.get(2);
        let data_type: String = row.get(3);
        let udt_name: String = row.get(4);
        match value_type(&data_type, &udt_name) {
            Some(r#type) => declared
                .entry((schema, table))
                .or_default()
                .push(DbColumn::new(column, r#type)),
            None => notes.push(format!(
                "{}.{}.{}: {} is not carried",
                schema, table, column, data_type
            )),
        }
    }
    let mut tables = Vec::new();
    for ((schema, table), columns) in declared {
        let Some(pkey) = pkeys.get(&(schema.clone(), table.clone())) else {
            notes.push(format!("{schema}.{table}: no primary key, left out"));
            continue;
        };
        if pkey
            .iter()
            .any(|key| !columns.iter().any(|column| column.name == key.as_str()))
        {
            notes.push(format!(
                "{schema}.{table}: a key column has an uncarried type, left out"
            ));
            continue;
        }
        tables.push(DbTable::new(
            table_name(&schema, &table),
            pkey.iter().map(String::as_str),
            columns,
        ));
    }
    Ok((Catalog::new(tables), notes))
}

/// The catalog name of a table: bare in `public`, schema-qualified
/// elsewhere.
pub fn table_name(schema: &str, table: &str) -> String {
    if schema == "public" {
        table.to_owned()
    } else {
        format!("{schema}.{table}")
    }
}

/// The engine's type for a Postgres column, from `information_schema`'s
/// `data_type` and `udt_name`; `None` for a type the wire cannot carry.
pub fn value_type(data_type: &str, udt_name: &str) -> Option<ValueType> {
    match data_type {
        "ARRAY" => {
            let element = udt_name.strip_prefix('_').unwrap_or(udt_name);
            Some(ValueType::List(Box::new(
                scalar_type(element).unwrap_or(ValueType::String),
            )))
        }
        "USER-DEFINED" => Some(scalar_type(udt_name).unwrap_or(ValueType::String)),
        other => scalar_type(other).or_else(|| scalar_type(udt_name)),
    }
}

/// The engine's type for a scalar Postgres type name (`information_schema`'s
/// `data_type` or `pg_type`'s name alike); `None` for one the wire cannot
/// carry.
pub fn scalar_type(name: &str) -> Option<ValueType> {
    let name = name.to_ascii_lowercase();
    let name = name.split('(').next().unwrap_or("").trim();
    Some(match name {
        "smallint" | "integer" | "bigint" | "int2" | "int4" | "int8" | "serial" | "bigserial"
        | "smallserial" | "oid" => ValueType::Int,
        "numeric" | "decimal" | "real" | "double precision" | "float4" | "float8" | "money" => {
            ValueType::Float
        }
        "boolean" | "bool" => ValueType::Bool,
        "json" | "jsonb" => ValueType::Json,
        "timestamp without time zone"
        | "timestamp with time zone"
        | "timestamp"
        | "timestamptz"
        | "date" => ValueType::Timestamp,
        "text"
        | "character varying"
        | "character"
        | "varchar"
        | "bpchar"
        | "char"
        | "uuid"
        | "citext"
        | "name"
        | "time without time zone"
        | "time with time zone"
        | "time"
        | "timetz"
        | "interval"
        | "inet"
        | "cidr"
        | "macaddr"
        | "xml"
        | "tsvector" => ValueType::String,
        "bytea" => return None,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mapping follows the protocol's: times are numbers, json and arrays are
    /// json, enums are strings, bytea is left out.
    #[test]
    fn types_map_like_the_protocol() {
        assert_eq!(
            value_type("timestamp without time zone", "timestamp"),
            Some(ValueType::Timestamp)
        );
        assert_eq!(value_type("date", "date"), Some(ValueType::Timestamp));
        assert_eq!(value_type("jsonb", "jsonb"), Some(ValueType::Json));
        assert_eq!(
            value_type("ARRAY", "_text"),
            Some(ValueType::List(Box::new(ValueType::String)))
        );
        assert_eq!(
            value_type("USER-DEFINED", "TicketStatus"),
            Some(ValueType::String)
        );
        assert_eq!(value_type("bigint", "int8"), Some(ValueType::Int));
        assert_eq!(value_type("numeric", "numeric"), Some(ValueType::Float));
        assert_eq!(value_type("bytea", "bytea"), None);
        assert_eq!(table_name("public", "tickets"), "tickets");
        assert_eq!(table_name("xyne_0", "clients"), "xyne_0.clients");
    }
}
