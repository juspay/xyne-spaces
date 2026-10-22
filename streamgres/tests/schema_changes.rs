//! What a schema change does inside the engine side, over in-memory
//! storage: a column added reaches every row the engine holds and every
//! row that enters afterwards without it, whether routed from the feed or
//! landed from a read, with the value the migration gave the existing
//! rows, and never as a delta; a memory table takes the column the same
//! way; and the catalog the clients' side reads is switched only once the
//! storage floor has reached the change, whatever the engine has already
//! absorbed. Each is a rule the live path depends on.

use std::cell::Cell;
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::{LocalSet, spawn_local};
use streamgres::ivm::{Engine, MultiTableIVM, QueryPart, SchemaChange, SingleTableIVM};
use streamgres::model::*;
use streamgres::sync::{
    CatalogHandle, Command, Event, Lsn, MemoryStorage, Runtime, Service, Snapshot, Storage,
    StorageError, Transaction,
};

/// `tickets(id, status, points)` before the migration.
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

/// `tickets(id, owner, points, status)` after it: `owner text DEFAULT
/// 'nobody'`.
fn widened() -> DbTable {
    DbTable::new(
        "tickets",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("status", ValueType::String),
            DbColumn::new("points", ValueType::Int),
            DbColumn::new("owner", ValueType::String),
        ],
    )
}

/// The change the migration is, on the layout of [`widened`].
fn owner_added(widened: &DbTable) -> SchemaChange {
    SchemaChange::ColumnAdded {
        table: TableName::from("tickets"),
        column: DbColumn::new("owner", ValueType::String),
        value: Value::from("nobody"),
        schema: widened.row_schema().clone(),
    }
}

fn pkey(id: i64) -> HashMap<ColumnName, Value> {
    HashMap::from([("id".into(), Value::Int(id))])
}

/// A ticket row on `table`'s layout: `status`, `points`, and `owner` when
/// the layout has it and one is given.
fn ticket_row(
    table: &DbTable,
    id: i64,
    status: &str,
    points: i64,
    owner: Option<&str>,
) -> DataFrameRow {
    let values = table
        .row_schema()
        .names()
        .iter()
        .map(|name| match name.as_str() {
            "id" => Value::Int(id),
            "status" => Value::from(status),
            "points" => Value::Int(points),
            "owner" => owner.map_or(Value::Null, Value::from),
            other => panic!("unexpected column {other}"),
        })
        .collect();
    DataFrameRow::from(RowData::with_schema(table.row_schema().clone(), values))
}

/// An insert of a ticket on `table`'s layout.
fn insert(table: &DbTable, id: i64, status: &str, points: i64, owner: Option<&str>) -> WriteQuery {
    WriteQuery::INSERT(InsertQuery {
        table: TableName::from("tickets"),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: ticket_row(table, id, status, points, owner),
    })
}

/// The open tickets.
fn open_tickets() -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        "tickets",
        Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    )
}

/// Each row of a subscription by id: its `owner` cell and whether it is
/// laid out on `schema`.
fn owners(
    rows: Option<HashMap<DataFrameKey, DataFrameRow>>,
    schema: &Arc<RowSchema>,
) -> BTreeMap<i64, (Option<Value>, bool)> {
    rows.unwrap_or_default()
        .into_iter()
        .map(|(key, row)| match key.pkey_value["id"] {
            Value::Int(id) => (
                id,
                (
                    row.data.get("owner").cloned(),
                    Arc::ptr_eq(row.data.schema(), schema),
                ),
            ),
            _ => panic!("integer ids"),
        })
        .collect()
}

/// A column added reaches the rows already held, with the migration's
/// value, on the new layout; a row routed afterwards in the old shape (one
/// decoded before the migration's message in the same transaction) is
/// completed the same way and delivered complete; a row routed in the new
/// shape keeps its own value; and a read landing rows from a snapshot
/// before the change completes them too. Nothing is delivered for the
/// change itself.
#[test]
fn a_column_added_reaches_held_routed_and_landed_rows() {
    let before = tickets();
    let after = widened();
    let db = MemoryStorage::new();
    db.apply(&insert(&before, 1, "OPEN", 1, None));
    db.apply(&insert(&before, 2, "OPEN", 2, None));
    db.apply(&insert(&before, 3, "DONE", 3, None));
    db.advance(Lsn(3));
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(Lsn(3));

    let (open, step) = runtime.register(open_tickets());
    let read = step.selects[0].clone();
    let landed = runtime.fetched(
        read.id,
        Snapshot {
            rows: db.rows(&read.query),
            at: Lsn(3),
        },
    );
    assert_eq!(landed.updates.len(), 2, "1 and 2 are open");
    let held = owners(runtime.engine().rows_for(open), after.row_schema());
    assert!(
        held.values()
            .all(|(owner, on_new)| owner.is_none() && !on_new),
        "before the migration nothing has an owner: {held:?}"
    );

    let change = owner_added(&after);
    runtime.alter(&change);
    let held = owners(runtime.engine().rows_for(open), after.row_schema());
    assert_eq!(
        held,
        BTreeMap::from([
            (1, (Some(Value::from("nobody")), true)),
            (2, (Some(Value::from("nobody")), true)),
        ]),
        "every held row has the column, with the migration's value, on the new layout"
    );

    let old_shape = insert(&before, 4, "OPEN", 4, None);
    let step = runtime.write(&old_shape, Lsn(4));
    let delivered = step
        .updates
        .iter()
        .find_map(|delta| match &delta.op {
            DataFrameOperation::Add(key, row) if key.pkey_value["id"] == Value::Int(4) => {
                Some(row.clone())
            }
            _ => None,
        })
        .expect("row 4 is delivered");
    assert_eq!(
        delivered.data.get("owner"),
        Some(&Value::from("nobody")),
        "a row written before the migration's message, in the same transaction, is delivered complete"
    );
    assert!(Arc::ptr_eq(delivered.data.schema(), after.row_schema()));

    let new_shape = insert(&after, 5, "OPEN", 5, Some("meera"));
    runtime.write(&new_shape, Lsn(5));
    let held = owners(runtime.engine().rows_for(open), after.row_schema());
    assert_eq!(
        held[&5],
        (Some(Value::from("meera")), true),
        "its own value is kept"
    );
    assert_eq!(held.len(), 4);

    db.apply(&insert(&before, 6, "OPEN", 6, None));
    let (_, step) = runtime.register(SingleTableReadQuery::new(
        "tickets",
        Where::condition("points", ComparisonOperator::EQ, Value::Int(6)),
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    ));
    let read = step.selects[0].clone();
    let landed = runtime.fetched(
        read.id,
        Snapshot {
            rows: db.rows(&read.query),
            at: Lsn(5),
        },
    );
    let landed_row = landed
        .updates
        .iter()
        .find_map(|delta| match &delta.op {
            DataFrameOperation::Add(_, row) => Some(row.clone()),
            _ => None,
        })
        .expect("row 6 lands");
    assert_eq!(
        landed_row.data.get("owner"),
        Some(&Value::from("nobody")),
        "a row landed from a snapshot before the change is completed"
    );
    assert!(Arc::ptr_eq(landed_row.data.schema(), after.row_schema()));
}

/// Adding the same column twice changes nothing more, and the multi-table
/// engine hands the change to the rows it holds.
#[test]
fn the_change_is_idempotent_and_reaches_the_multi_table_engine() {
    let before = tickets();
    let after = widened();
    let mut engine = MultiTableIVM::new();
    let (sub, _) = engine.subscribe(MultiTableReadQuery::single(open_tickets()));
    let fetch = engine.requests().remove(0);
    engine.land(
        &fetch,
        &[(
            DataFrameKey::new(pkey(1)),
            ticket_row(&before, 1, "OPEN", 1, None),
        )],
        None,
    );
    let change = owner_added(&after);
    engine.alter(&change);
    engine.alter(&change);
    let held = owners(engine.rows_for(sub, QueryPart::main()), after.row_schema());
    assert_eq!(
        held,
        BTreeMap::from([(1, (Some(Value::from("nobody")), true))])
    );
}

/// A memory table takes the column: its rows are laid out again with the
/// migration's value, and a read of it returns them complete.
#[test]
fn a_memory_table_takes_the_column() {
    let before = tickets();
    let after = widened();
    let storage = MemoryStorage::new();
    storage.apply(&insert(&before, 1, "OPEN", 1, None));
    storage.alter(&owner_added(&after));
    storage.apply(&insert(&after, 2, "OPEN", 2, Some("arjun")));
    let rows = storage.rows(&open_tickets());
    let by_id: BTreeMap<i64, Option<Value>> = rows
        .iter()
        .map(|(key, row)| match key.pkey_value["id"] {
            Value::Int(id) => (id, row.data.get("owner").cloned()),
            _ => panic!("integer ids"),
        })
        .collect();
    assert_eq!(
        by_id,
        BTreeMap::from([
            (1, Some(Value::from("nobody"))),
            (2, Some(Value::from("arjun")))
        ])
    );
    assert!(
        rows.iter()
            .all(|(_, row)| Arc::ptr_eq(row.data.schema(), after.row_schema())),
        "every row is on the new layout"
    );
}

/// In-memory storage whose floor the test sets by hand, the way a
/// snapshot pool's floor trails the engine, and which records what the
/// service asked of it.
struct Trailing {
    inner: MemoryStorage,
    floor: Cell<Lsn>,
    followed: Cell<Option<Lsn>>,
    minted: Cell<usize>,
}

impl Storage for Trailing {
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError> {
        self.inner.select(query).await
    }

    fn advance(&self, feed: Lsn) {
        self.inner.advance(feed);
    }

    fn floor(&self) -> Lsn {
        self.floor.get()
    }

    fn absorb(&self, write: &WriteQuery, at: Lsn) {
        self.inner.absorb(write, at);
    }

    fn alter(&self, change: &SchemaChange) {
        self.inner.alter(change);
    }

    fn follow(&self, at: Lsn, _catalog: Arc<Catalog>) {
        self.followed.set(Some(at));
    }

    fn mint_now(&self) {
        self.minted.set(self.minted.get() + 1);
    }
}

/// Run `body` on a current-thread runtime with a local task set.
fn block_on<F: std::future::Future>(body: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    LocalSet::new().block_on(&runtime, body)
}

/// Every event the service sends within a short window.
async fn drain(events: &mut mpsc::UnboundedReceiver<Event>) -> Vec<Event> {
    let mut seen = Vec::new();
    while let Ok(Some(event)) =
        tokio::time::timeout(Duration::from_millis(200), events.recv()).await
    {
        seen.push(event);
    }
    seen
}

/// A transaction of the feed that committed at `at` carrying `changes`.
fn migration(at: Lsn, changes: Vec<SchemaChange>, catalog: Arc<Catalog>) -> Transaction {
    let mut transaction = Transaction::new(Vec::new(), at).with_schema(changes, catalog);
    transaction.committed_at_micros = 1;
    transaction
}

/// The service absorbs a migration into the engine at once, tells the
/// storage to read by the new catalog from that position and to mint a
/// snapshot now, and switches the catalog the clients' side reads only
/// once the storage floor has reached the migration's position: not on
/// the step that applied it while the floor trails, and on the first
/// later step that finds the floor there.
#[test]
fn the_clients_catalog_switches_when_the_floor_reaches_the_change() {
    block_on(async {
        let before = Arc::new(Catalog::new(vec![tickets()]));
        let after = Arc::new(Catalog::new(vec![widened()]));
        let handle = Arc::new(CatalogHandle::from_arc(before.clone()));
        let storage = Rc::new(Trailing {
            inner: MemoryStorage::new(),
            floor: Cell::new(Lsn(5)),
            followed: Cell::new(None),
            minted: Cell::new(0),
        });
        storage.inner.apply(&insert(&tickets(), 1, "OPEN", 1, None));
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (service, commands) = Service::new(MultiTableIVM::new(), storage.clone(), events_tx);
        spawn_local(service.with_catalog(handle.clone()).run());

        commands
            .send(Command::Register {
                sink: 0,
                query: MultiTableReadQuery::single(open_tickets()),
                token: 1,
            })
            .await
            .expect("send");
        drain(&mut events).await;

        let change = owner_added(after.table("tickets").expect("tickets"));
        commands
            .send(Command::Transaction(migration(
                Lsn(10),
                vec![change],
                after.clone(),
            )))
            .await
            .expect("send");
        let seen = drain(&mut events).await;
        assert!(
            seen.iter().all(
                |event| matches!(event, Event::Committed { updates, .. } if updates.is_empty())
            ),
            "a migration delivers no delta: {seen:?}"
        );
        assert_eq!(
            storage.followed.get(),
            Some(Lsn(10)),
            "the storage reads by the new catalog from 10 on"
        );
        assert_eq!(storage.minted.get(), 1, "a snapshot is minted at once");
        assert!(
            handle.holds(&before),
            "the floor (5) has not reached the change (10)"
        );

        storage.floor.set(Lsn(9));
        commands
            .send(Command::Transaction(Transaction::mark(Lsn(12))))
            .await
            .expect("send");
        drain(&mut events).await;
        assert!(handle.holds(&before), "a floor at 9 is still short of it");

        storage.floor.set(Lsn(10));
        commands
            .send(Command::Transaction(Transaction::mark(Lsn(13))))
            .await
            .expect("send");
        drain(&mut events).await;
        assert!(
            handle.holds(&after),
            "the floor reached the change: the clients' side sees it"
        );
    });
}
