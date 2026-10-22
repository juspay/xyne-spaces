//! The client's schema judged against the server's catalog, as zero-cache
//! judges it (`checkClientSchema`): a client is served only when every
//! table it names is one the server carries, every column it names exists
//! there, each of those columns reaches it as the type it declares, and
//! the primary key it declares is the one the server identifies rows by.
//! Anything else is a client built for another database, and it is told
//! so with `SchemaVersionNotSupported`, on which a Zero client reloads for
//! a build that fits. What the server has beyond the client's schema is no
//! mismatch: rows go out whole and a client ignores a column it does not
//! know, as with zero-cache.
//!
//! Two places differ from zero-cache, both because the judgment is about
//! what this server can serve. zero-cache accepts any non-null unique
//! index as the client's primary key and keys its row patches by it; this
//! server keys every `del` by the table's own primary key, so that is the
//! only key it accepts. And a column of a type zero-cache cannot carry but
//! this server sends as text (`interval`, `xml`) is served to a client
//! that declares it a string.

use serde_json::Value as Json;

use super::protocol::ClientSchema;
use crate::model::{Catalog, ValueType};

/// The error kind of the Zero protocol for a client schema the server
/// cannot serve.
pub const KIND: &str = "SchemaVersionNotSupported";

/// The type a Zero client sees for a column the catalog declares so:
/// times travel as epoch milliseconds, lists and maps as JSON.
pub fn client_type(declared: &ValueType) -> &'static str {
    match declared {
        ValueType::String => "string",
        ValueType::Int
        | ValueType::Float
        | ValueType::Date
        | ValueType::Datetime
        | ValueType::Timestamp => "number",
        ValueType::Bool => "boolean",
        ValueType::Json | ValueType::List(_) | ValueType::Map(_, _) => "json",
    }
}

/// Everything in `schema` this server cannot serve as the client expects,
/// one line each, tables and columns in name order; empty when the client
/// can be served.
pub fn mismatches(catalog: &Catalog, schema: &ClientSchema) -> Vec<String> {
    let mut found = Vec::new();
    let mut tables: Vec<_> = schema.tables.iter().collect();
    tables.sort_by(|(a, _), (b, _)| a.cmp(b));
    for (name, spec) in tables {
        let Some(table) = catalog.table(name) else {
            found.push(format!(
                "The \"{name}\" table does not exist on the server, or has no primary key \
                 and cannot be synced."
            ));
            continue;
        };
        let mut columns: Vec<_> = spec.columns.iter().collect();
        columns.sort_by(|(a, _), (b, _)| a.cmp(b));
        for (column, declared) in columns {
            let Some(known) = table.column(column) else {
                found.push(format!(
                    "The \"{name}\".\"{column}\" column does not exist on the server, or is \
                     of a type that cannot be synced."
                ));
                continue;
            };
            let wanted = declared.get("type").and_then(Json::as_str).unwrap_or("");
            let served = client_type(&known.r#type);
            if wanted != served {
                found.push(format!(
                    "The \"{name}\".\"{column}\" column's upstream type \"{served}\" does \
                     not match the client type \"{wanted}\"."
                ));
            }
        }
        if spec.primary_key.is_empty() {
            found.push(format!(
                "The \"{name}\" table's client schema does not specify a primary key."
            ));
            continue;
        }
        let mut wanted: Vec<&str> = spec.primary_key.iter().map(String::as_str).collect();
        let mut served: Vec<&str> = table.pkey.iter().map(|column| column.as_str()).collect();
        wanted.sort_unstable();
        wanted.dedup();
        served.sort_unstable();
        if wanted != served {
            found.push(format!(
                "The \"{name}\" table's primaryKey <{}> is not the key the server \
                 identifies its rows by, <{}>.",
                spec.primary_key.join(","),
                served.join(",")
            ));
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DbColumn, DbTable};

    /// A catalog of one table with a column of every kind the wire
    /// carries.
    fn catalog() -> Catalog {
        Catalog::new([DbTable::new(
            "tickets",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::String),
                DbColumn::new("points", ValueType::Int),
                DbColumn::new("score", ValueType::Float),
                DbColumn::new("open", ValueType::Bool),
                DbColumn::new("createdAt", ValueType::Timestamp),
                DbColumn::new("meta", ValueType::Json),
                DbColumn::new("labels", ValueType::List(Box::new(ValueType::String))),
                DbColumn::new("serverOnly", ValueType::String),
            ],
        )])
    }

    /// A client schema from its JSON, as `initConnection` carries it.
    fn schema(json: serde_json::Value) -> ClientSchema {
        serde_json::from_value(json).expect("a client schema")
    }

    /// A schema that names a subset of what the server has, each column as
    /// the type it travels as, is served; what the server has beyond it is
    /// no mismatch.
    #[test]
    fn a_fitting_schema_is_served() {
        let fitting = schema(serde_json::json!({"tables": {"tickets": {
            "columns": {
                "id": {"type": "string"}, "points": {"type": "number"},
                "score": {"type": "number"}, "open": {"type": "boolean"},
                "createdAt": {"type": "number"}, "meta": {"type": "json"},
                "labels": {"type": "json"}
            },
            "primaryKey": ["id"]
        }}}));
        assert_eq!(mismatches(&catalog(), &fitting), Vec::<String>::new());
        assert_eq!(
            mismatches(&catalog(), &ClientSchema::default()),
            Vec::<String>::new()
        );
    }

    /// Each of zero-cache's four refusals: a table the server lacks, a
    /// column it lacks, a column of another type, a primary key that is
    /// not the table's (or none at all); every finding is reported, in
    /// name order.
    #[test]
    fn every_mismatch_is_reported() {
        let ahead = schema(serde_json::json!({"tables": {
            "sdlc_repos": {"columns": {"id": {"type": "string"}}, "primaryKey": ["id"]},
            "tickets": {
                "columns": {
                    "id": {"type": "string"},
                    "pullRequestId": {"type": "string"},
                    "createdAt": {"type": "string"},
                    "open": {"type": "number"}
                },
                "primaryKey": ["points"]
            }
        }}));
        let found = mismatches(&catalog(), &ahead);
        assert_eq!(found.len(), 5, "{found:#?}");
        assert!(found[0].contains("\"sdlc_repos\" table does not exist"));
        assert!(found[1].contains("\"createdAt\" column's upstream type \"number\""));
        assert!(found[1].contains("client type \"string\""));
        assert!(found[2].contains("\"open\" column's upstream type \"boolean\""));
        assert!(found[3].contains("\"pullRequestId\" column does not exist"));
        assert!(found[4].contains("primaryKey <points>"));

        let keyless = schema(serde_json::json!({"tables": {"tickets": {
            "columns": {"id": {"type": "string"}}
        }}}));
        let found = mismatches(&catalog(), &keyless);
        assert_eq!(found.len(), 1);
        assert!(found[0].contains("does not specify a primary key"));
    }

    /// A compound key is compared as a set, as zero-cache compares it.
    #[test]
    fn a_compound_key_matches_in_any_order() {
        let catalog = Catalog::new([DbTable::new(
            "members",
            ["channelId", "userId"],
            vec![
                DbColumn::new("channelId", ValueType::String),
                DbColumn::new("userId", ValueType::String),
            ],
        )]);
        let client = schema(serde_json::json!({"tables": {"members": {
            "columns": {"userId": {"type": "string"}, "channelId": {"type": "string"}},
            "primaryKey": ["userId", "channelId"]
        }}}));
        assert_eq!(mismatches(&catalog, &client), Vec::<String>::new());
    }
}
