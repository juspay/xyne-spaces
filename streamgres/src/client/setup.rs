use std::collections::BTreeMap;

use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use tokio_postgres::{NoTls, Transaction};

use super::Config;
use super::ddl_triggers::{self, FunctionSpec};
use crate::sync::pg::sql::quote_ident;

const SETUP_LOCK: i64 = 0x5354_524d_4752_4553;

pub async fn ensure(master_dsn: &str, config: &Config) -> Result<(), String> {
    let schema = config.upstream_schema();
    if !config.schemas.contains(&schema) {
        return Err(format!(
            "STREAMGRES_SCHEMAS must include mutation schema `{schema}`"
        ));
    }

    let (mut client, connection) = tokio_postgres::connect(master_dsn, NoTls)
        .await
        .map_err(|error| format!("connecting to primary database: {error}"))?;
    let connection = tokio::spawn(connection);
    let result = async {
        let tx = client
            .transaction()
            .await
            .map_err(|error| format!("starting database setup: {error}"))?;
        tx.batch_execute("SET LOCAL statement_timeout = '60s'; SET LOCAL lock_timeout = '15s'")
            .await
            .map_err(|error| format!("setting database setup timeouts: {error}"))?;
        tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&SETUP_LOCK])
            .await
            .map_err(|error| format!("waiting for database setup lock: {error}"))?;
        tx.query_one(
            "SELECT pg_advisory_xact_lock($1)",
            &[&ddl_triggers::DDL_LOCK],
        )
        .await
        .map_err(|error| format!("waiting for DDL setup lock: {error}"))?;
        ensure_locked(&tx, config, &schema).await?;
        tx.commit()
            .await
            .map_err(|error| format!("committing database setup: {error}"))
    }
    .await;
    drop(client);
    let _ = connection.await;
    result
}

async fn ensure_locked(tx: &Transaction<'_>, config: &Config, schema: &str) -> Result<(), String> {
    let exists = tx
        .query_opt("SELECT 1 FROM pg_namespace WHERE nspname = $1", &[&schema])
        .await
        .map_err(|error| format!("checking schema `{schema}`: {error}"))?
        .is_some();
    if exists {
        for table in ["clients", "mutations", "publishedSchema"] {
            validate_table(tx, schema, table).await?;
        }
        let tables = tx
            .query(
                "SELECT relname FROM pg_class WHERE relnamespace =
                 (SELECT oid FROM pg_namespace WHERE nspname = $1) AND relkind IN ('r', 'p')",
                &[&schema],
            )
            .await
            .map_err(|error| format!("checking schema `{schema}` tables: {error}"))?
            .into_iter()
            .map(|row| row.get::<_, String>(0))
            .collect::<std::collections::BTreeSet<_>>();
        if tables
            != ["clients", "mutations", "publishedSchema"]
                .map(str::to_owned)
                .into()
        {
            return Err(format!(
                "schema `{schema}` has unexpected tables: {tables:?}"
            ));
        }
    } else {
        let schema_name = quote_ident(schema);
        tx.batch_execute(&format!(
            "CREATE SCHEMA {schema_name};
             CREATE TABLE {schema_name}.\"clients\" (
               \"clientGroupID\" text NOT NULL,
               \"clientID\" text NOT NULL,
               \"lastMutationID\" bigint NOT NULL,
               \"userID\" text,
               PRIMARY KEY (\"clientGroupID\", \"clientID\")
             );
             CREATE TABLE {schema_name}.\"mutations\" (
               \"clientGroupID\" text NOT NULL,
               \"clientID\" text NOT NULL,
               \"mutationID\" bigint NOT NULL,
               \"result\" json NOT NULL,
               PRIMARY KEY (\"clientGroupID\", \"clientID\", \"mutationID\")
             );
             CREATE TABLE {schema_name}.\"publishedSchema\" (
               current json,
               exists boolean NOT NULL DEFAULT true PRIMARY KEY CHECK (exists)
             )"
        ))
        .await
        .map_err(|error| format!("creating schema `{schema}`: {error}"))?;
    }

    for served in &config.schemas {
        if tx
            .query_opt("SELECT 1 FROM pg_namespace WHERE nspname = $1", &[served])
            .await
            .map_err(|error| format!("checking served schema `{served}`: {error}"))?
            .is_none()
        {
            return Err(format!("served schema `{served}` does not exist"));
        }
    }

    let publication = &config.publication;
    let existing = tx
        .query_opt(
            "SELECT puballtables, pubinsert, pubupdate, pubdelete, pubtruncate, pubviaroot
             FROM pg_publication WHERE pubname = $1",
            &[publication],
        )
        .await
        .map_err(|error| format!("checking publication `{publication}`: {error}"))?;
    if let Some(row) = existing {
        let flags = [
            row.get::<_, bool>(0),
            row.get::<_, bool>(1),
            row.get::<_, bool>(2),
            row.get::<_, bool>(3),
            row.get::<_, bool>(4),
            row.get::<_, bool>(5),
        ];
        let actual = tx
            .query(
                "SELECT n.nspname FROM pg_publication_namespace pn
                 JOIN pg_namespace n ON n.oid = pn.pnnspid
                 WHERE pn.pnpubid = (SELECT oid FROM pg_publication WHERE pubname = $1)",
                &[publication],
            )
            .await
            .map_err(|error| format!("checking publication `{publication}` schemas: {error}"))?
            .into_iter()
            .map(|row| row.get::<_, String>(0))
            .collect::<std::collections::BTreeSet<_>>();
        let wanted = config.schemas.iter().cloned().collect();
        let explicit: i64 = tx
            .query_one(
                "SELECT count(*) FROM pg_publication_rel
                 WHERE prpubid = (SELECT oid FROM pg_publication WHERE pubname = $1)",
                &[publication],
            )
            .await
            .map_err(|error| format!("checking publication `{publication}` tables: {error}"))?
            .get(0);
        if flags != [false, true, true, true, true, false] || actual != wanted || explicit != 0 {
            return Err(format!(
                "publication `{publication}` differs: expected schema scopes {wanted:?}, all change types, no explicit tables; found scopes {actual:?}, flags {flags:?}, {explicit} explicit tables"
            ));
        }
    } else {
        let schemas = config
            .schemas
            .iter()
            .map(|schema| quote_ident(schema))
            .collect::<Vec<_>>()
            .join(", ");
        tx.batch_execute(&format!(
            "CREATE PUBLICATION {} FOR TABLES IN SCHEMA {schemas}",
            quote_ident(publication)
        ))
        .await
        .map_err(|error| format!("creating publication `{publication}`: {error}"))?;
    }

    ensure_triggers(tx, config, schema).await?;
    Ok(())
}

async fn ensure_triggers(
    tx: &Transaction<'_>,
    config: &Config,
    schema: &str,
) -> Result<(), String> {
    let specs = ddl_triggers::function_specs(&config.app_id, config.shard, &[&config.publication]);
    if specs.len() != 7 {
        return Err(format!(
            "internal error: expected seven DDL trigger functions, found {}",
            specs.len()
        ));
    }
    let start = format!("{}_ddl_start_{}", config.app_id, config.shard);
    let end = format!("{}_ddl_end_{}", config.app_id, config.shard);
    let mut present = false;
    for spec in &specs {
        let signature = function_signature(schema, spec);
        let exists: bool = tx
            .query_one("SELECT to_regprocedure($1) IS NOT NULL", &[&signature])
            .await
            .map_err(|error| format!("checking DDL function `{signature}`: {error}"))?
            .get(0);
        present |= exists;
    }
    for trigger in [&start, &end] {
        let exists = tx
            .query_opt(
                "SELECT 1 FROM pg_event_trigger WHERE evtname = $1",
                &[trigger],
            )
            .await
            .map_err(|error| format!("checking DDL event trigger `{trigger}`: {error}"))?
            .is_some();
        present |= exists;
    }

    if present {
        validate_triggers(tx, schema, &specs, &start, &end).await?;
    } else {
        let snapshot_populated: bool = tx
            .query_opt(
                &format!(
                    "SELECT current IS NOT NULL FROM {}.\"publishedSchema\"",
                    quote_ident(schema)
                ),
                &[],
            )
            .await
            .map_err(|error| format!("checking published schema baseline: {error}"))?
            .is_some_and(|row| row.get(0));
        if snapshot_populated {
            return Err(format!(
                "schema `{schema}` has a published schema snapshot but no DDL trigger stack; refusing to replace the snapshot"
            ));
        }
        tx.batch_execute(&ddl_triggers::trigger_stack_sql(
            &config.app_id,
            config.shard,
            &[&config.publication],
        ))
        .await
        .map_err(|error| format!("installing DDL event triggers: {error}"))?;
        validate_triggers(tx, schema, &specs, &start, &end).await?;
    }
    Ok(())
}

fn function_signature(schema: &str, spec: &FunctionSpec) -> String {
    format!(
        "{}.{}({})",
        quote_ident(schema),
        quote_ident(&spec.name),
        spec.args.join(", ")
    )
}

async fn validate_triggers(
    tx: &Transaction<'_>,
    schema: &str,
    specs: &[FunctionSpec],
    start: &str,
    end: &str,
) -> Result<(), String> {
    for spec in specs {
        let signature = function_signature(schema, spec);
        let row = tx
            .query_opt(
                "SELECT p.prosrc, p.provolatile::text, l.lanname,
                        pg_get_function_result(p.oid)
                 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
                 WHERE p.oid = to_regprocedure($1)",
                &[&signature],
            )
            .await
            .map_err(|error| format!("validating DDL function `{signature}`: {error}"))?
            .ok_or_else(|| format!("DDL trigger stack is incomplete: missing `{signature}`"))?;
        let result = match spec.name.as_str() {
            "get_trigger_context" => "record",
            "notice_ignore" | "update_schemas" => "void",
            "schema_specs" => "json",
            "emit_ddl_start" | "emit_ddl_end" => "event_trigger",
            _ => unreachable!("function specs come from the trigger template"),
        };
        let volatility = if spec.name == "schema_specs" {
            "s"
        } else {
            "v"
        };
        if row.get::<_, String>(0) != spec.body
            || row.get::<_, String>(1) != volatility
            || row.get::<_, String>(2) != spec.language
            || row.get::<_, String>(3) != result
        {
            return Err(format!(
                "DDL function `{signature}` differs from the expected Streamgres definition"
            ));
        }
    }

    let start_tags = [
        "ALTER PUBLICATION",
        "ALTER SCHEMA",
        "ALTER TABLE",
        "CREATE INDEX",
        "CREATE TABLE",
        "DROP INDEX",
        "DROP TABLE",
    ];
    let end_tags = [
        "ALTER PUBLICATION",
        "ALTER SCHEMA",
        "ALTER TABLE",
        "COMMENT",
        "CREATE INDEX",
        "CREATE TABLE",
        "DROP INDEX",
        "DROP TABLE",
    ];
    for (name, event, function, expected_tags) in [
        (
            start,
            "ddl_command_start",
            "emit_ddl_start",
            &start_tags[..],
        ),
        (end, "ddl_command_end", "emit_ddl_end", &end_tags[..]),
    ] {
        let row = tx
            .query_opt(
                "SELECT t.evtevent, t.evtenabled::text, t.evttags,
                        n.nspname, p.proname,
                        p.oid = to_regprocedure($2) AS expected_function
                 FROM pg_event_trigger t
                 JOIN pg_proc p ON p.oid = t.evtfoid
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE t.evtname = $1",
                &[
                    &name,
                    &format!("{}.{}()", quote_ident(schema), quote_ident(function)),
                ],
            )
            .await
            .map_err(|error| format!("validating DDL event trigger `{name}`: {error}"))?
            .ok_or_else(|| format!("DDL trigger stack is incomplete: missing `{name}`"))?;
        let mut actual_tags = row.get::<_, Option<Vec<String>>>(2).unwrap_or_default();
        actual_tags.sort();
        if row.get::<_, String>(0) != event
            || row.get::<_, String>(1) != "O"
            || actual_tags
                != expected_tags
                    .iter()
                    .map(|tag| (*tag).to_owned())
                    .collect::<Vec<_>>()
            || row.get::<_, String>(3) != schema
            || row.get::<_, String>(4) != function
            || !row.get::<_, bool>(5)
        {
            return Err(format!(
                "DDL event trigger `{name}` differs from the expected Streamgres definition"
            ));
        }
    }
    let baseline = tx
        .query_opt(
            &format!(
                "SELECT current::text, {}.schema_specs()::text
                 FROM {}.\"publishedSchema\"",
                quote_ident(schema),
                quote_ident(schema)
            ),
            &[],
        )
        .await
        .map_err(|error| format!("validating published schema baseline: {error}"))?;
    let matches = match baseline {
        Some(row) => {
            let current: Option<String> = row.get(0);
            current
                .map(|current| {
                    schema_snapshots_match(&current, &row.get::<_, String>(1))
                        .map_err(|error| format!("comparing published schema baseline: {error}"))
                })
                .transpose()?
                .unwrap_or(false)
        }
        None => false,
    };
    if !matches {
        return Err(format!(
            "schema `{schema}` has a missing or stale published schema snapshot"
        ));
    }
    Ok(())
}

#[derive(Deserialize, PartialEq)]
struct SchemaSnapshot {
    tables: Vec<TableSnapshot>,
    indexes: Vec<IndexSnapshot>,
    #[serde(flatten)]
    fields: BTreeMap<String, Value>,
}

#[derive(Deserialize, PartialEq)]
struct TableSnapshot {
    schema: String,
    name: String,
    #[serde(flatten)]
    fields: BTreeMap<String, Value>,
}

#[derive(Deserialize, PartialEq)]
struct IndexSnapshot {
    schema: String,
    #[serde(rename = "tableName")]
    table_name: String,
    name: String,
    columns: OrderedObject,
    #[serde(flatten)]
    fields: BTreeMap<String, Value>,
}

#[derive(PartialEq)]
struct OrderedObject(Vec<(String, Value)>);

impl<'de> Deserialize<'de> for OrderedObject {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct OrderedObjectVisitor;

        impl<'de> Visitor<'de> for OrderedObjectVisitor {
            type Value = OrderedObject;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("an object with unique keys")
            }

            fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut entries = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, Value>()? {
                    if entries.iter().any(|(existing, _)| existing == &key) {
                        return Err(de::Error::custom(format!("duplicate key `{key}`")));
                    }
                    entries.push((key, value));
                }
                Ok(OrderedObject(entries))
            }
        }

        deserializer.deserialize_map(OrderedObjectVisitor)
    }
}

fn schema_snapshots_match(current: &str, expected: &str) -> Result<bool, String> {
    let mut current: SchemaSnapshot = serde_json::from_str(current)
        .map_err(|error| format!("unreadable stored schema snapshot: {error}"))?;
    let mut expected: SchemaSnapshot = serde_json::from_str(expected)
        .map_err(|error| format!("unreadable current schema snapshot: {error}"))?;
    current.tables.sort_by(|a, b| (&a.schema, &a.name).cmp(&(&b.schema, &b.name)));
    expected.tables.sort_by(|a, b| (&a.schema, &a.name).cmp(&(&b.schema, &b.name)));
    current.indexes.sort_by(|a, b| {
        (&a.schema, &a.table_name, &a.name).cmp(&(&b.schema, &b.table_name, &b.name))
    });
    expected.indexes.sort_by(|a, b| {
        (&a.schema, &a.table_name, &a.name).cmp(&(&b.schema, &b.table_name, &b.name))
    });
    if current
        .tables
        .windows(2)
        .any(|pair| pair[0].schema == pair[1].schema && pair[0].name == pair[1].name)
        || expected
            .tables
            .windows(2)
            .any(|pair| pair[0].schema == pair[1].schema && pair[0].name == pair[1].name)
        || current.indexes.windows(2).any(|pair| {
            pair[0].schema == pair[1].schema
                && pair[0].table_name == pair[1].table_name
                && pair[0].name == pair[1].name
        })
        || expected.indexes.windows(2).any(|pair| {
            pair[0].schema == pair[1].schema
                && pair[0].table_name == pair[1].table_name
                && pair[0].name == pair[1].name
        })
    {
        return Err("duplicate table or index identity".to_owned());
    }
    Ok(current == expected)
}

async fn validate_table(tx: &Transaction<'_>, schema: &str, table: &str) -> Result<(), String> {
    let name = format!("{}.{}", quote_ident(schema), quote_ident(table));
    let rows = tx
        .query(
            "SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                    pg_get_expr(d.adbin, d.adrelid)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
             WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'
                   AND c.relpersistence = 'p'
             ORDER BY a.attnum",
            &[&schema, &table],
        )
        .await
        .map_err(|error| format!("checking table {name}: {error}"))?;
    let actual = rows
        .iter()
        .map(|row| {
            (
                row.get::<_, String>(0),
                row.get::<_, String>(1),
                row.get::<_, bool>(2),
                row.get::<_, Option<String>>(3),
            )
        })
        .collect::<Vec<_>>();
    let expected = match table {
        "clients" => vec![
            ("clientGroupID", "text", true, None),
            ("clientID", "text", true, None),
            ("lastMutationID", "bigint", true, None),
            ("userID", "text", false, None),
        ],
        "mutations" => vec![
            ("clientGroupID", "text", true, None),
            ("clientID", "text", true, None),
            ("mutationID", "bigint", true, None),
            ("result", "json", true, None),
        ],
        _ => vec![
            ("current", "json", false, None),
            ("exists", "boolean", true, Some("true")),
        ],
    };
    if actual
        != expected
            .iter()
            .map(|(name, kind, required, default)| {
                (
                    (*name).to_owned(),
                    (*kind).to_owned(),
                    *required,
                    default.map(str::to_owned),
                )
            })
            .collect::<Vec<_>>()
    {
        return Err(format!(
            "table {name} has incompatible columns: expected {expected:?}, found {actual:?}"
        ));
    }

    let constraints = tx
        .query(
            "SELECT contype::text, pg_get_constraintdef(oid)
             FROM pg_constraint WHERE conrelid = to_regclass($1) AND contype IN ('p', 'c')",
            &[&name],
        )
        .await
        .map_err(|error| format!("checking table {name} constraints: {error}"))?
        .into_iter()
        .map(|row| (row.get::<_, String>(0), row.get::<_, String>(1)))
        .collect::<Vec<_>>();
    let key = match table {
        "clients" => "PRIMARY KEY (\"clientGroupID\", \"clientID\")",
        "mutations" => "PRIMARY KEY (\"clientGroupID\", \"clientID\", \"mutationID\")",
        _ => "PRIMARY KEY (\"exists\")",
    };
    if constraints.len() != if table == "publishedSchema" { 2 } else { 1 }
        || !constraints
            .iter()
            .any(|(kind, definition)| kind == "p" && definition == key)
        || (table == "publishedSchema"
            && !constraints
                .iter()
                .any(|(kind, definition)| kind == "c" && definition == "CHECK (\"exists\")"))
    {
        return Err(format!(
            "table {name} has incompatible constraints: expected primary key {key}, found {constraints:?}"
        ));
    }
    let indexes: i64 = tx
        .query_one(
            "SELECT count(*) FROM pg_index WHERE indrelid = to_regclass($1)",
            &[&name],
        )
        .await
        .map_err(|error| format!("checking table {name} indexes: {error}"))?
        .get(0);
    if indexes != 1 {
        return Err(format!(
            "table {name} has {indexes} indexes; expected only its primary key"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_snapshot_comparison_ignores_object_and_collection_order() {
        let stored = r#"{"indexes":[{"schema":"public","tableName":"b","name":"b_idx","unique":false,"columns":{"id":"ASC"}},{"columns":{"id":"ASC"},"name":"a_idx","tableName":"a","schema":"public","unique":false}],"tables":[{"schema":"public","name":"b","primaryKey":["id"],"columns":{"id":{"pos":1,"dataType":"int8"}}},{"columns":{"id":{"dataType":"int8","pos":1}},"primaryKey":["id"],"name":"a","schema":"public"}]}"#;
        let actual = r#"{"tables":[{"name":"a","schema":"public","columns":{"id":{"pos":1,"dataType":"int8"}},"primaryKey":["id"]},{"columns":{"id":{"dataType":"int8","pos":1}},"name":"b","primaryKey":["id"],"schema":"public"}],"indexes":[{"unique":false,"name":"a_idx","columns":{"id":"ASC"},"tableName":"a","schema":"public"},{"name":"b_idx","schema":"public","columns":{"id":"ASC"},"unique":false,"tableName":"b"}]}"#;
        assert!(schema_snapshots_match(stored, actual).unwrap());
    }

    #[test]
    fn schema_snapshot_comparison_preserves_key_and_index_column_order() {
        let stored = r#"{"tables":[{"schema":"public","name":"items","primaryKey":["tenantId","id"],"columns":{}}],"indexes":[{"schema":"public","tableName":"items","name":"items_idx","columns":{"tenantId":"ASC","id":"DESC"}}]}"#;
        let reordered_primary_key = r#"{"tables":[{"schema":"public","name":"items","primaryKey":["id","tenantId"],"columns":{}}],"indexes":[{"schema":"public","tableName":"items","name":"items_idx","columns":{"tenantId":"ASC","id":"DESC"}}]}"#;
        let reordered_index_columns = r#"{"tables":[{"schema":"public","name":"items","primaryKey":["tenantId","id"],"columns":{}}],"indexes":[{"schema":"public","tableName":"items","name":"items_idx","columns":{"id":"DESC","tenantId":"ASC"}}]}"#;
        assert!(!schema_snapshots_match(stored, reordered_primary_key).unwrap());
        assert!(!schema_snapshots_match(stored, reordered_index_columns).unwrap());
    }

    #[tokio::test]
    async fn fresh_setup_is_repeatable_and_existing_tables_are_validated() {
        let Ok(dsn) = std::env::var("STREAMGRES_SETUP_TEST_DSN") else {
            return;
        };
        let app = format!("sgtest{}", uuid::Uuid::new_v4().simple());
        let schema = format!("{app}_0");
        let publication = format!("{app}_pub");
        let schemas = format!("public,{schema}");
        let config = Config::from_lookup(|name| match name {
            "STREAMGRES_PG_DSN" | "STREAMGRES_MASTER_PG_DSN" => Some(dsn.clone()),
            "STREAMGRES_QUERY_URL" => Some("http://localhost/query".to_owned()),
            "STREAMGRES_MUTATE_URL" => Some("http://localhost/push".to_owned()),
            "STREAMGRES_APP_ID" => Some(app.clone()),
            "STREAMGRES_SCHEMAS" => Some(schemas.clone()),
            "STREAMGRES_PUBLICATION" => Some(publication.clone()),
            _ => None,
        })
        .unwrap();
        let (first, second) = tokio::join!(ensure(&dsn, &config), ensure(&dsn, &config));
        first.unwrap();
        second.unwrap();
        ensure(&dsn, &config).await.unwrap();

        let (client, connection) = tokio_postgres::connect(&dsn, NoTls).await.unwrap();
        let connection = tokio::spawn(connection);
        client
            .batch_execute(&format!(
                "UPDATE {}.\"publishedSchema\" SET current = json_build_object(
                   'indexes', (SELECT COALESCE(json_agg(item ORDER BY item->>'schema' DESC, item->>'tableName' DESC, item->>'name' DESC), '[]'::json)
                              FROM json_array_elements(current->'indexes') AS i(item)),
                   'tables', (SELECT COALESCE(json_agg(item ORDER BY item->>'schema' DESC, item->>'name' DESC), '[]'::json)
                              FROM json_array_elements(current->'tables') AS t(item))
                 )",
                quote_ident(&schema)
            ))
            .await
            .unwrap();
        ensure(&dsn, &config).await.unwrap();

        let probe = format!("{}.ddl_probe", quote_ident(&schema));
        client
            .batch_execute(&format!(
                "CREATE TABLE {probe} (id bigint PRIMARY KEY, value text);
                 ALTER TABLE {probe} ADD COLUMN probe_added text DEFAULT 'ok';"
            ))
            .await
            .unwrap();
        let added: bool = client
            .query_one(
                &format!(
                    "SELECT EXISTS (
                       SELECT 1 FROM {}.\"publishedSchema\",
                            LATERAL jsonb_array_elements(current::jsonb->'tables') AS t(item)
                       WHERE item->>'schema' = $1 AND item->>'name' = 'ddl_probe'
                         AND item->'columns' ? 'probe_added'
                     )",
                    quote_ident(&schema)
                ),
                &[&schema],
            )
            .await
            .unwrap()
            .get(0);
        assert!(added);
        let index = format!("{}.ddl_probe_idx", quote_ident(&schema));
        client
            .batch_execute(&format!("CREATE INDEX ddl_probe_idx ON {probe} (probe_added)"))
            .await
            .unwrap();
        let index_added: bool = client
            .query_one(
                &format!(
                    "SELECT EXISTS (
                       SELECT 1 FROM {}.\"publishedSchema\",
                            LATERAL jsonb_array_elements(current::jsonb->'indexes') AS i(item)
                       WHERE item->>'schema' = $1 AND item->>'name' = 'ddl_probe_idx'
                     )",
                    quote_ident(&schema)
                ),
                &[&schema],
            )
            .await
            .unwrap()
            .get(0);
        assert!(index_added);
        client
            .batch_execute(&format!("DROP INDEX {index}; DROP TABLE {probe}"))
            .await
            .unwrap();

        client
            .batch_execute(&format!(
                "ALTER PUBLICATION {} SET (publish = 'insert')",
                quote_ident(&publication)
            ))
            .await
            .unwrap();
        assert!(
            ensure(&dsn, &config)
                .await
                .unwrap_err()
                .contains("publication")
        );
        client
            .batch_execute(&format!(
                "ALTER PUBLICATION {} SET (publish = 'insert, update, delete, truncate')",
                quote_ident(&publication)
            ))
            .await
            .unwrap();
        let mut conflicting = config.clone();
        conflicting.app_id.push('x');
        let other_schema = conflicting.upstream_schema();
        conflicting.schemas = vec!["public".to_owned(), other_schema.clone()];
        assert!(
            ensure(&dsn, &conflicting)
                .await
                .unwrap_err()
                .contains("publication")
        );
        assert!(
            client
                .query_opt(
                    "SELECT 1 FROM pg_namespace WHERE nspname = $1",
                    &[&other_schema]
                )
                .await
                .unwrap()
                .is_none()
        );
        client
            .batch_execute(&format!(
                "ALTER TABLE {}.\"clients\" ADD COLUMN extra text",
                quote_ident(&schema)
            ))
            .await
            .unwrap();
        assert!(
            ensure(&dsn, &config)
                .await
                .unwrap_err()
                .contains("incompatible columns")
        );
        client
            .batch_execute(&format!(
                "DROP PUBLICATION {}; DROP SCHEMA {} CASCADE",
                quote_ident(&publication),
                quote_ident(&schema)
            ))
            .await
            .unwrap();
        drop(client);
        connection.await.unwrap().unwrap();
    }
}
