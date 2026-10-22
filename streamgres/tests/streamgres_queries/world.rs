//! The harness: the join engine under the synchronous driver over
//! in-process storage, with the production application catalog. Rows are built as full
//! images (every column present, unset ones `NULL`, `workspaceId` defaulting
//! to the caller's workspace), every subscription gets the ACL's tenant
//! backstop (`workspaceId = <caller's>` on a workspace-scoped root, `apps`
//! excepted) the way `defineQuery` adds it, and updates are rendered as
//! compact tags, one per targeted part: `q/main+t1` is an `Add` of row
//! `t1` to the root part of subscription `q`, `q/assignments-a1` a
//! `Delete` from its `assignments` part, a `where_exists` part prefixed
//! `has:`, nested parts dotted (`q/conversation.has:channel+c1`). Every
//! subscription is its own client, so a row two subscriptions hold shows
//! one tag per subscription. A subscription
//! without edges also round-trips through the SQL parser, so every filter
//! shape the queries use is known to parse.

use std::collections::HashMap;
use std::rc::Rc;

use streamgres::ivm::{Delta, MultiTableIVM, QueryPart, SubId};
use streamgres::model::{
    Catalog, ColumnName, DataFrameKey, DataFrameOperation, DataFrameRow, DeleteQuery, InsertQuery,
    UpdateQuery, Value, WriteQuery,
};
use streamgres::parser::parse_read;
use streamgres::sync::{Local, MemoryStorage};

use super::catalog::{catalog, columns, pkey};
use super::zql::Q;

/// The caller: `ctx.userID`.
pub const ME: &str = "u-me";

/// The caller's workspace: `ctx.workspaceId`.
pub const WS: &str = "ws-1";

/// `base` with `changes` applied: a changed or an added column per pair.
pub fn with<'a>(base: &[(&'a str, Value)], changes: &[(&'a str, Value)]) -> Vec<(&'a str, Value)> {
    let mut merged: Vec<(&'a str, Value)> = base
        .iter()
        .filter(|(column, _)| !changes.iter().any(|(changed, _)| changed == column))
        .cloned()
        .collect();
    merged.extend(changes.iter().cloned());
    merged
}

/// The expected tags of a step, in canonical (sorted) order.
pub fn ops<const N: usize>(tags: [&str; N]) -> Vec<String> {
    let mut tags: Vec<String> = tags.iter().map(|tag| (*tag).to_owned()).collect();
    tags.sort();
    tags
}

/// The engine, its storage, the catalog, and the directory from test names
/// to subscriptions and from parts to their names.
pub struct World {
    ivm: Local<MultiTableIVM, MemoryStorage>,
    storage: Rc<MemoryStorage>,
    catalog: Catalog,
    subs: HashMap<String, SubId>,
    parts: HashMap<SubId, (String, HashMap<QueryPart, String>)>,
}

impl World {
    /// An empty world.
    pub fn new() -> World {
        let storage = Rc::new(MemoryStorage::new());
        World {
            ivm: Local::new(MultiTableIVM::new(), storage.clone()),
            storage,
            catalog: catalog(),
            subs: HashMap::new(),
            parts: HashMap::new(),
        }
    }

    /// Put a row into storage without routing it: data that existed before
    /// anyone subscribed.
    pub fn seed(&mut self, table: &str, pairs: &[(&str, Value)]) {
        self.storage.apply(&insert(table, pairs));
    }

    /// Register `query` under `name` and return its snapshot as tags. A
    /// query without edges is also parsed from its SQL rendering, which
    /// must agree with the builder.
    pub fn subscribe(&mut self, name: &str, query: &Q) -> Vec<String> {
        let scoped = scope(query.clone());
        if let Some(sql) = scoped.sql() {
            let parsed =
                parse_read(&sql, &self.catalog).unwrap_or_else(|error| panic!("{sql}: {error}"));
            assert_eq!(
                parsed,
                scoped.build().0.main_table,
                "parser and builder disagree on {sql}"
            );
        }
        let (spec, parts) = scoped.build();
        let (sub, updates) = self.ivm.register_query(spec);
        self.subs.insert(name.to_owned(), sub);
        self.parts.insert(sub, (name.to_owned(), parts));
        self.tags(&updates)
    }

    /// Drop the subscription registered under `name`.
    pub fn unsubscribe(&mut self, name: &str) {
        let sub = self
            .subs
            .remove(name)
            .unwrap_or_else(|| panic!("no subscription `{name}`"));
        self.parts.remove(&sub);
        self.ivm.unregister_query(sub);
    }

    /// Commit an insert and route it.
    pub fn insert(&mut self, table: &str, pairs: &[(&str, Value)]) -> Vec<String> {
        self.write(insert(table, pairs))
    }

    /// Commit an update carrying the full new image built from `pairs`
    /// and route it.
    pub fn update(&mut self, table: &str, pairs: &[(&str, Value)]) -> Vec<String> {
        let (pkey_value, record) = row(table, pairs);
        self.write(WriteQuery::UPDATE(UpdateQuery {
            table: table.into(),
            pkey_value,
            record,
        }))
    }

    /// Commit a delete of the row keyed `id` and route it.
    pub fn delete(&mut self, table: &str, id: &str) -> Vec<String> {
        self.write(WriteQuery::DELETE(DeleteQuery {
            table: table.into(),
            pkey_value: key(table, Value::from(id)),
        }))
    }

    /// The number of rows subscription `name` holds in `part`.
    pub fn rows(&self, name: &str, part: &str) -> usize {
        self.held(name, part).len()
    }

    /// The row identities subscription `name` holds in `part`, sorted.
    pub fn held(&self, name: &str, part: &str) -> Vec<String> {
        let sub = self.subs[name];
        let (_, parts) = &self.parts[&sub];
        let path = parts
            .iter()
            .find(|(_, candidate)| candidate.as_str() == part)
            .map(|(path, _)| *path)
            .unwrap_or_else(|| panic!("no part `{part}` in `{name}`"));
        let mut ids: Vec<String> = self
            .ivm
            .engine()
            .rows_for(sub, path)
            .map(|rows| rows.keys().map(ident).collect())
            .unwrap_or_default();
        ids.sort();
        ids
    }

    /// Mirror a write into storage, route it, and render the updates.
    fn write(&mut self, write: WriteQuery) -> Vec<String> {
        self.storage.apply(&write);
        let updates = self.ivm.incremental_update(&write);
        self.tags(&updates)
    }

    /// Render updates as sorted tags, one per targeted part.
    fn tags(&self, updates: &[Delta]) -> Vec<String> {
        let mut tags: Vec<String> = updates
            .iter()
            .flat_map(|update| update.targets().map(move |target| (update, target)))
            .map(|(update, target)| {
                let (name, parts) = &self.parts[&target.sub];
                let part = &parts[&target.part];
                let (sign, key) = match &update.op {
                    DataFrameOperation::Add(key, _) => ("+", key),
                    DataFrameOperation::Delete(key, _) => ("-", key),
                };
                format!("{name}/{part}{sign}{}", ident(key))
            })
            .collect();
        tags.sort();
        tags
    }
}

/// The ACL's tenant backstop: root rows of a workspace-scoped table are
/// restricted to the caller's workspace; `apps` owns its own visibility.
fn scope(query: Q) -> Q {
    let scoped = query.table() != "apps"
        && columns(query.table())
            .iter()
            .any(|(column, _)| *column == "workspaceId");
    if scoped {
        query.eq("workspaceId", WS)
    } else {
        query
    }
}

/// An INSERT of the full image built from `pairs`.
fn insert(table: &str, pairs: &[(&str, Value)]) -> WriteQuery {
    let (pkey_value, record) = row(table, pairs);
    WriteQuery::INSERT(InsertQuery {
        table: table.into(),
        pkey_value,
        record,
    })
}

/// The identity of the row keyed `value` on `table`.
fn key(table: &str, value: Value) -> DataFrameKey {
    DataFrameKey::new([(pkey(table), value)])
}

/// A full row image of `table`: every declared column, `pairs` where given,
/// the caller's workspace for `workspaceId`, `NULL` elsewhere.
///
/// # Panics
///
/// On a column the table does not declare, or a missing primary key.
fn row(table: &str, pairs: &[(&str, Value)]) -> (DataFrameKey, DataFrameRow) {
    let declared = columns(table);
    for (name, _) in pairs {
        assert!(
            declared.iter().any(|(column, _)| column == name),
            "no column `{name}` on `{table}`"
        );
    }
    let data: HashMap<ColumnName, Value> = declared
        .iter()
        .map(|(column, _)| {
            let value = pairs
                .iter()
                .find(|(name, _)| name == column)
                .map(|(_, value)| value.clone())
                .unwrap_or_else(|| {
                    if *column == "workspaceId" {
                        Value::from(WS)
                    } else {
                        Value::Null
                    }
                });
            (ColumnName::from(*column), value)
        })
        .collect();
    let key_value = data[pkey(table)].clone();
    assert!(
        !key_value.is_null(),
        "a row of `{table}` needs its `{}`",
        pkey(table)
    );
    (key(table, key_value), DataFrameRow::from(data))
}

/// The bare text of a one-column identity.
fn ident(key: &DataFrameKey) -> String {
    match key.pkey_value.values().next() {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Int(int)) => int.to_string(),
        other => format!("{other:?}"),
    }
}
