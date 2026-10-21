//! Live Postgres scenarios: the runtime over `PgStorage` and the
//! `test_decoding` change feed, with writes committed deliberately behind
//! an open snapshot; the asynchronous service end to end with one table
//! mirrored in memory; and schema changes followed through the
//! schema-change trigger stack. They run only when `STREAMGRES_PG_DSN` names a
//! database with `wal_level = logical` (and free replication slots), and
//! report themselves skipped otherwise; each scenario uses its own tables
//! and slot, so they can run in parallel.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::mpsc;
use tokio::task::{LocalSet, spawn_local};
use tokio_postgres::{Client, NoTls};
use streamgres::ivm::{Delta, Engine, Fetch, MultiTableIVM, QueryPart};
use streamgres::model::*;
use streamgres::client::ddl_triggers::trigger_stack_sql;
use streamgres::sync::pg::ddl::DdlSource;
use streamgres::sync::pg::{PgStorage, PgStream};
use streamgres::sync::{
    CatalogHandle, Command, Event, Lsn, Runtime, Service, Sources, Storage, SubId, Transaction,
};

/// The database under test, if any.
fn dsn() -> Option<String> {
    let dsn = std::env::var("STREAMGRES_PG_DSN").ok();
    if dsn.is_none() {
        eprintln!("STREAMGRES_PG_DSN not set: live Postgres scenario skipped");
    }
    dsn
}

/// Run `body` on a current-thread runtime with a local task set (the
/// engine and its storage are single-threaded).
fn block_on<F: std::future::Future>(body: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    LocalSet::new().block_on(&runtime, body)
}

/// One scenario's names: its tables (`extra` is one a scenario creates
/// while it runs), and its slot.
struct Names {
    tickets: String,
    users: String,
    extra: String,
    slot: String,
    publication: String,
}

impl Names {
    /// Names suffixed with `tag`.
    fn new(tag: &str) -> Self {
        Names {
            tickets: format!("live_{tag}_tickets"),
            users: format!("live_{tag}_users"),
            extra: format!("live_{tag}_extra"),
            slot: format!("xyne_sync_live_{tag}"),
            publication: format!("xyne_sync_live_{tag}_pub"),
        }
    }

    /// The catalog of the two tables.
    fn catalog(&self) -> Catalog {
        Catalog::new(vec![
            DbTable::new(
                self.tickets.as_str(),
                ["id"],
                vec![
                    DbColumn::new("id", ValueType::Int),
                    DbColumn::new("status", ValueType::String),
                    DbColumn::new("assigned_to", ValueType::Int),
                    DbColumn::new("points", ValueType::Int),
                ],
            ),
            DbTable::new(
                self.users.as_str(),
                ["id"],
                vec![
                    DbColumn::new("id", ValueType::Int),
                    DbColumn::new("name", ValueType::String),
                ],
            ),
        ])
    }

    /// `OPEN` tickets LEFT JOIN users on `assigned_to = users.id`.
    fn spec(&self) -> MultiTableReadQuery {
        MultiTableReadQuery::new(
            SingleTableReadQuery::new(
                self.tickets.as_str(),
                Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                OrderBy::new("id", Order::ASC),
                u32::MAX,
            ),
            vec![Join::left(
                MultiTableReadQuery::single(SingleTableReadQuery::new(
                    self.users.as_str(),
                    Where::AND(vec![]),
                    OrderBy::new("id", Order::ASC),
                    u32::MAX,
                )),
                "assigned_to",
                "id",
            )],
        )
    }
}

/// An administrative connection.
async fn admin(dsn: &str) -> Client {
    let (client, connection) = tokio_postgres::connect(dsn, NoTls).await.expect("connect");
    spawn_local(async move {
        let _ = connection.await;
    });
    client
}

/// Fresh tables (three OPEN tickets on users 7, 7, 8; users 7 and 8) and
/// no leftover slot.
async fn prepare(dsn: &str, names: &Names) -> Client {
    let client = admin(dsn).await;
    PgStream::drop_slot(dsn, &names.slot, &names.publication)
        .await
        .expect("drop slot");
    client
        .batch_execute(&format!(
            "DROP TABLE IF EXISTS {t}; DROP TABLE IF EXISTS {u}; DROP TABLE IF EXISTS {e};
             CREATE TABLE {t} (id int8 PRIMARY KEY, status text, assigned_to int8, points int8);
             CREATE TABLE {u} (id int8 PRIMARY KEY, name text);
             CREATE PUBLICATION \"{p}\" FOR ALL TABLES;
             INSERT INTO {u} VALUES (7, 'meera'), (8, 'arjun');
             INSERT INTO {t} VALUES (1, 'OPEN', 7, 1), (2, 'OPEN', 7, 2), (3, 'OPEN', 8, 3);",
            t = names.tickets,
            u = names.users,
            e = names.extra,
            p = names.publication
        ))
        .await
        .expect("prepare");
    client
}

/// Drop the scenario's tables and slot.
async fn cleanup(dsn: &str, client: &Client, names: &Names) {
    let _ = client
        .batch_execute(&format!(
            "DROP TABLE IF EXISTS {}; DROP TABLE IF EXISTS {}; DROP TABLE IF EXISTS {};",
            names.tickets, names.users, names.extra
        ))
        .await;
    let _ = PgStream::drop_slot(dsn, &names.slot, &names.publication).await;
}

/// The ids `sql` returns.
async fn truth(client: &Client, sql: &str) -> BTreeSet<i64> {
    client
        .query(sql, &[])
        .await
        .expect("truth")
        .iter()
        .map(|row| row.get::<_, i64>(0))
        .collect()
}

/// The ids of one part's rows.
fn ids(rows: Option<HashMap<DataFrameKey, DataFrameRow>>) -> BTreeSet<i64> {
    rows.unwrap_or_default()
        .keys()
        .map(|key| match key.pkey_value["id"] {
            Value::Int(id) => id,
            _ => panic!("integer ids"),
        })
        .collect()
}

/// The stream moved: tell every storage and learn the floor (what the
/// drivers do after each write and progress mark).
fn moved(runtime: &mut Runtime<MultiTableIVM>, storages: &[&PgStorage]) {
    for storage in storages {
        storage.advance(runtime.position());
    }
    if let Some(floor) = storages.iter().map(|storage| storage.floor()).min() {
        runtime.set_floor(floor);
    }
}

/// Poll the feed and move the runtime until every storage has a current
/// alias (the stream has passed its first consistent point).
async fn catch_up(
    runtime: &mut Runtime<MultiTableIVM>,
    stream: &mut PgStream,
    storages: &[&PgStorage],
) -> Vec<Fetch> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut pending = Vec::new();
    loop {
        let batch = stream.poll().await.expect("poll");
        for (write, at) in batch.writes {
            pending.extend(runtime.write(&write, at).selects);
            moved(runtime, storages);
        }
        pending.extend(runtime.progress(batch.progress).selects);
        moved(runtime, storages);
        if storages
            .iter()
            .all(|storage| storage.alias_position().is_some())
        {
            return pending;
        }
        assert!(
            Instant::now() < deadline,
            "the stream never passed the first alias"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Run every read out, poll the feed to move the stream, and repeat until
/// nothing is out; the deltas, in order.
async fn drain(
    runtime: &mut Runtime<MultiTableIVM>,
    storage: &PgStorage,
    stream: &mut PgStream,
    mut pending: Vec<Fetch>,
) -> Vec<Delta> {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut updates = Vec::new();
    loop {
        let mut next = Vec::new();
        for fetch in pending.drain(..) {
            let snapshot = storage.select(&fetch.query).await.expect("select");
            let step = runtime.fetched(fetch.id, snapshot);
            updates.extend(step.updates);
            next.extend(step.selects);
        }
        pending = next;
        if pending.is_empty() && runtime.outstanding() == 0 {
            return updates;
        }
        let batch = stream.poll().await.expect("poll");
        for (write, at) in batch.writes {
            let step = runtime.write(&write, at);
            moved(runtime, &[storage]);
            updates.extend(step.updates);
            pending.extend(step.selects);
        }
        let step = runtime.progress(batch.progress);
        moved(runtime, &[storage]);
        updates.extend(step.updates);
        pending.extend(step.selects);
        assert!(
            Instant::now() < deadline,
            "the runtime did not settle: {} reads out",
            runtime.outstanding()
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// The registration scenario: the main part's snapshot is held open while
/// writes commit behind it, including one from a transaction that was
/// already open when the snapshot was taken; the snapshot is behind the
/// stream when it lands, is brought up from the delivered writes, and the
/// frames end equal to what Postgres holds without adopting any stale
/// image.
#[test]
fn registration_behind_open_snapshot() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("wal");
        let client = prepare(&dsn, &names).await;
        let catalog = Arc::new(names.catalog());
        let mut stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let slow = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect")
            .with_read_delay(Duration::from_millis(1500));
        let fast = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect");
        let mut runtime = Runtime::new(MultiTableIVM::new());
        catch_up(&mut runtime, &mut stream, &[&slow, &fast]).await;
        assert!(
            slow.floor() <= runtime.position(),
            "an alias flips only behind the stream"
        );

        let open_before = admin(&dsn).await;
        open_before
            .batch_execute(&format!(
                "BEGIN; UPDATE {} SET status = 'DONE' WHERE id = 3;",
                names.tickets
            ))
            .await
            .expect("open transaction");

        let (sub, step) = runtime.register(names.spec());
        assert_eq!(step.selects.len(), 1);
        let main = step.selects[0].clone();
        let query = main.query.clone();
        let select = spawn_local(async move { slow.select(&query).await });
        tokio::time::sleep(Duration::from_millis(400)).await;
        client
            .batch_execute(&format!(
                "UPDATE {t} SET status = 'DONE' WHERE id = 1;
                 DELETE FROM {t} WHERE id = 2;
                 INSERT INTO {t} VALUES (4, 'OPEN', 8, 4);
                 UPDATE {t} SET points = 99 WHERE id = 4;",
                t = names.tickets
            ))
            .await
            .expect("writes behind the snapshot");
        open_before
            .batch_execute("COMMIT;")
            .await
            .expect("commit the open transaction");

        let behind = stream.poll().await.expect("poll");
        assert_eq!(
            behind.writes.len(),
            5,
            "every write committed behind the snapshot is delivered before it lands"
        );
        let mut pending = Vec::new();
        for (write, at) in behind.writes {
            pending.extend(runtime.write(&write, at).selects);
            moved(&mut runtime, &[&fast]);
        }
        runtime.progress(behind.progress);
        moved(&mut runtime, &[&fast]);

        let snapshot = select.await.expect("join").expect("select");
        assert_eq!(snapshot.rows.len(), 3, "the snapshot predates every write");
        assert!(snapshot.at < runtime.position());
        let step = runtime.fetched(main.id, snapshot);
        assert!(
            step.updates.is_empty(),
            "every snapshot row was overtaken, got {:?}",
            step.updates
        );
        pending.extend(step.selects);

        drain(&mut runtime, &fast, &mut stream, pending).await;

        let open = truth(
            &client,
            &format!("SELECT id FROM {} WHERE status = 'OPEN'", names.tickets),
        )
        .await;
        assert_eq!(open, BTreeSet::from([4]));
        assert_eq!(ids(runtime.engine().rows_for(sub, QueryPart::main())), open);
        assert_eq!(
            ids(runtime.engine().rows_for(sub, QueryPart::join(0))),
            BTreeSet::from([8])
        );
        let main_rows = runtime.engine().rows_for(sub, QueryPart::main()).unwrap();
        let points: BTreeMap<i64, Value> = main_rows
            .iter()
            .map(|(key, row)| match key.pkey_value["id"] {
                Value::Int(id) => (id, row.data["points"].clone()),
                _ => panic!(),
            })
            .collect();
        assert_eq!(
            points[&4],
            Value::Int(99),
            "the stream's image, not an older one"
        );
        assert_eq!(
            runtime.stats().rows_dropped,
            3,
            "every snapshot row was overtaken: 1 moved out, 2 deleted, 3 moved out by the transaction open at snapshot time"
        );
        cleanup(&dsn, &client, &names).await;
    });
}

/// The asynchronous service end to end, with the users table mirrored in
/// memory: the poller feeds commands, the service warms the mirror, runs
/// reads (the join's narrowed reads inline) and pushes per-client deltas;
/// a client frame built from the deltas alone converges to what Postgres
/// holds, and the mirror follows the stream.
#[test]
fn service_streams_end_to_end() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("service");
        let client = prepare(&dsn, &names).await;
        let catalog = Arc::new(names.catalog());
        let mut stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let pg = Arc::new(
            PgStorage::connect(&dsn, catalog.clone())
                .await
                .expect("connect"),
        );
        let sources = Rc::new(Sources::new(
            pg,
            catalog.clone(),
            [TableName::from(names.users.as_str())],
        ));
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (service, commands) = Service::new(MultiTableIVM::new(), sources.clone(), events_tx);
        let service = spawn_local(service.run());

        let deadline = Instant::now() + Duration::from_secs(10);
        while sources.floor() == Lsn(0) {
            let batch = stream.poll().await.expect("poll");
            for (write, at) in batch.writes {
                commands
                    .send(Command::Transaction(Transaction::new(vec![write], at)))
                    .await
                    .expect("send");
            }
            commands
                .send(Command::Transaction(Transaction {
                    writes: Vec::new(),
                    at: batch.progress,
                    progress: batch.progress,
                    watched: Vec::new(),
                    schema: Vec::new(),
                    catalog: None,
                    received: Instant::now(),
                    committed_at_micros: 0,
                    decode: std::time::Duration::ZERO,
                }))
                .await
                .expect("send");
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(
                Instant::now() < deadline,
                "the stream never passed the first alias"
            );
        }
        assert_eq!(
            sources.warm().await.expect("warm"),
            2,
            "both users mirrored"
        );
        let poller = spawn_local(stream.run(Duration::from_millis(50), commands.clone()));

        commands
            .send(Command::Register {
                sink: 0,
                query: names.spec(),
                token: 1,
            })
            .await
            .expect("send");
        let sub: SubId = loop {
            match events.recv().await.expect("service ended") {
                Event::Registered { token, sub, .. } => {
                    assert_eq!(token, 1, "the token comes back unchanged");
                    break sub;
                }
                _ => continue,
            }
        };

        client
            .batch_execute(&format!(
                "INSERT INTO {t} VALUES (10, 'OPEN', 9, 10), (11, 'OPEN', 8, 11);
                 INSERT INTO {u} VALUES (9, 'late');
                 UPDATE {t} SET status = 'DONE' WHERE id = 1;
                 DELETE FROM {t} WHERE id = 2;",
                t = names.tickets,
                u = names.users
            ))
            .await
            .expect("writes");

        let expected_main = truth(
            &client,
            &format!("SELECT id FROM {} WHERE status = 'OPEN'", names.tickets),
        )
        .await;
        let expected_users = truth(
            &client,
            &format!(
                "SELECT DISTINCT u.id FROM {u} u JOIN {t} t ON t.assigned_to = u.id WHERE t.status = 'OPEN'",
                t = names.tickets,
                u = names.users
            ),
        )
        .await;

        let mut frames: HashMap<QueryPart, HashMap<DataFrameKey, DataFrameRow>> = HashMap::new();
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            match tokio::time::timeout(Duration::from_millis(200), events.recv()).await {
                Ok(Some(
                    Event::Landed { updates: batch }
                    | Event::Committed { updates: batch, .. }
                    | Event::Registered { updates: batch, .. },
                )) => {
                    for update in batch {
                        for target in update.targets() {
                            assert_eq!(target.sub, sub);
                            let frame = frames.entry(target.part).or_default();
                            match &update.op {
                                DataFrameOperation::Add(key, row) => {
                                    frame.insert(key.clone(), row.clone());
                                }
                                DataFrameOperation::Delete(key, _) => {
                                    frame.remove(key);
                                }
                            }
                        }
                    }
                }
                Ok(Some(_)) => {}
                Ok(None) => panic!("service ended"),
                Err(_) => {}
            }
            let main = ids(frames.get(&QueryPart::main()).cloned());
            let users = ids(frames.get(&QueryPart::join(0)).cloned());
            if main == expected_main && users == expected_users {
                tokio::time::sleep(Duration::from_millis(300)).await;
                break;
            }
            assert!(
                Instant::now() < deadline,
                "client frames did not converge: main {main:?} vs {expected_main:?}, users {users:?} vs {expected_users:?}"
            );
        }
        let mirrored = sources.memory().rows(&SingleTableReadQuery::new(
            names.users.as_str(),
            Where::AND(vec![]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        ));
        assert_eq!(mirrored.len(), 3, "the mirror absorbed the late user");
        poller.abort();
        drop(commands);
        let runtime = service.await.expect("service");
        assert_eq!(runtime.outstanding(), 0);
        assert!(runtime.stats().reads_landed >= 2);
        cleanup(&dsn, &client, &names).await;
    });
}

/// A mutation result travels the feed as the client side reads it: the
/// application server's insert into its results table arrives with the
/// group, client and mutation and the result as JSON text, and its
/// cleanup (the `DELETE … <= upTo` it runs when a client acknowledges its
/// results) as a delete carrying that key — what the group thread turns
/// into `mutationsPatch` entries.
#[test]
fn mutation_results_travel_the_feed() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("results");
        let client = prepare(&dsn, &names).await;
        let results = names.extra.clone();
        client
            .batch_execute(&format!(
                r#"CREATE TABLE {results} (
                     "clientGroupID" text NOT NULL,
                     "clientID" text NOT NULL,
                     "mutationID" bigint NOT NULL,
                     "result" json NOT NULL,
                     PRIMARY KEY ("clientGroupID", "clientID", "mutationID"))"#
            ))
            .await
            .expect("create the results table");
        let mut tables: Vec<DbTable> = names.catalog().tables().cloned().collect();
        tables.push(DbTable::new(
            results.as_str(),
            ["clientGroupID", "clientID", "mutationID"],
            vec![
                DbColumn::new("clientGroupID", ValueType::String),
                DbColumn::new("clientID", ValueType::String),
                DbColumn::new("mutationID", ValueType::Int),
                DbColumn::new("result", ValueType::Json),
            ],
        ));
        let mut stream = PgStream::open(
            &dsn,
            &names.slot,
            &names.publication,
            Arc::new(Catalog::new(tables)),
        )
        .await
        .expect("open stream");

        client
            .batch_execute(&format!(
                r#"INSERT INTO {results} VALUES ('g1', 'c1', 7, '{{"error": "app", "message": "Conversation not found"}}');
                   DELETE FROM {results} WHERE "clientGroupID" = 'g1' AND "clientID" = 'c1' AND "mutationID" <= 7;"#
            ))
            .await
            .expect("record and clean up a result");

        let table = TableName::from(results.as_str());
        let mut seen: Vec<WriteQuery> = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(15);
        while seen.len() < 2 {
            let batch = stream.poll().await.expect("poll");
            seen.extend(
                batch
                    .writes
                    .into_iter()
                    .map(|(write, _)| write)
                    .filter(|write| write.table() == &table),
            );
            assert!(
                Instant::now() < deadline,
                "the result's writes never arrived: {seen:?}"
            );
        }
        let text = |row: &RowData, column: &str| match row.get(column) {
            Some(Value::String(text)) => text.clone(),
            other => panic!("{column}: {other:?}"),
        };
        let WriteQuery::INSERT(recorded) = &seen[0] else {
            panic!("the result is inserted first: {seen:?}");
        };
        let image = &recorded.record.data;
        assert_eq!(text(image, "clientGroupID"), "g1");
        assert_eq!(text(image, "clientID"), "c1");
        assert_eq!(image.get("mutationID"), Some(&Value::Int(7)));
        let result: serde_json::Value =
            serde_json::from_str(&text(image, "result")).expect("the result is JSON text");
        assert_eq!(
            result,
            serde_json::json!({"error": "app", "message": "Conversation not found"})
        );
        let WriteQuery::DELETE(cleaned) = &seen[1] else {
            panic!("then cleaned up: {seen:?}");
        };
        let key = &cleaned.pkey_value.pkey_value;
        assert_eq!(text(key, "clientGroupID"), "g1");
        assert_eq!(text(key, "clientID"), "c1");
        assert_eq!(key.get("mutationID"), Some(&Value::Int(7)));
        cleanup(&dsn, &client, &names).await;
    });
}

/// The read bound: with two permits and each read holding its snapshot
/// for 400 ms, six concurrent reads take three rounds rather than six
/// connections, and every one of them succeeds.
#[test]
fn reads_queue_at_the_connection_bound() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("pool");
        let client = prepare(&dsn, &names).await;
        let catalog = Arc::new(names.catalog());
        let mut stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let storage = Rc::new(
            PgStorage::connect(&dsn, catalog.clone())
                .await
                .expect("connect")
                .with_read_delay(Duration::from_millis(400))
                .with_read_connections(2),
        );
        let mut runtime = Runtime::new(MultiTableIVM::new());
        catch_up(&mut runtime, &mut stream, &[storage.as_ref()]).await;
        let (_, step) = runtime.register(names.spec());
        let query = step.selects[0].query.clone();
        let started = Instant::now();
        let reads: Vec<_> = (0..6)
            .map(|_| {
                let storage = storage.clone();
                let query = query.clone();
                spawn_local(async move { storage.select(&query).await })
            })
            .collect();
        for read in reads {
            read.await.expect("join").expect("read");
        }
        let elapsed = started.elapsed();
        assert!(
            elapsed >= Duration::from_millis(1100),
            "six reads over two permits take three rounds, took {elapsed:?}"
        );
        assert!(
            elapsed < Duration::from_millis(2000),
            "two permits run two reads at a time, took {elapsed:?}"
        );
        drop(stream);
        drop(storage);
        cleanup(&dsn, &client, &names).await;
    });
}

/// A count runs on the same snapshot a read would, and stops at the cap:
/// three OPEN tickets count as 2 under a cap of 2 and as 3 under a cap of
/// 10, so a planner learns whether a side fits without scanning it whole.
#[test]
fn a_count_stops_at_the_cap_on_the_snapshot() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("count");
        let client = prepare(&dsn, &names).await;
        let catalog = Arc::new(names.catalog());
        let mut stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let storage = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect");
        let mut runtime = Runtime::new(MultiTableIVM::new());
        catch_up(&mut runtime, &mut stream, &[&storage]).await;

        let open = names.spec().main_table;
        let alone = MultiTableReadQuery::single(open.clone());
        assert_eq!(storage.count(&alone, 2).await.expect("count"), 2);
        assert_eq!(storage.count(&alone, 10).await.expect("count"), 3);
        let none = MultiTableReadQuery::single(SingleTableReadQuery {
            filter: Where::condition("status", ComparisonOperator::EQ, "GONE"),
            ..open.clone()
        });
        assert_eq!(storage.count(&none, 10).await.expect("count"), 0);
        let under = |filter: Where, name: &str| {
            MultiTableReadQuery::new(
                SingleTableReadQuery {
                    filter,
                    ..open.clone()
                },
                vec![Join::inner(
                    MultiTableReadQuery::single(SingleTableReadQuery::new(
                        names.users.as_str(),
                        Where::condition("name", ComparisonOperator::EQ, name),
                        OrderBy::new("id", Order::ASC),
                        u32::MAX,
                    )),
                    "assigned_to",
                    "id",
                )],
            )
        };
        let open_and = |name: &str| {
            under(
                Where::AND(vec![
                    Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                    Where::exists("assigned_to", 0),
                ]),
                name,
            )
        };
        assert_eq!(
            storage.count(&open_and("meera"), 10).await.expect("count"),
            2,
            "the tree is counted through its EXISTS on the database"
        );
        assert_eq!(
            storage.count(&open_and("arjun"), 10).await.expect("count"),
            1
        );
        assert_eq!(
            storage.count(&open_and("nobody"), 10).await.expect("count"),
            0
        );
        let points_or = under(
            Where::OR(vec![
                Where::condition("points", ComparisonOperator::EQ, 3),
                Where::exists("assigned_to", 0),
            ]),
            "meera",
        );
        assert_eq!(
            storage.count(&points_or, 10).await.expect("count"),
            3,
            "an EXISTS under an OR counts where it stands"
        );
        let unnamed = under(
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
            "arjun",
        );
        assert_eq!(
            storage.count(&unnamed, 10).await.expect("count"),
            1,
            "an inner edge no leaf names is conjoined"
        );
        cleanup(&dsn, &client, &names).await;
    });
}

/// A read past the row budget is refused, not buffered: the query without
/// a limit over a table of thirty rows is refused at a budget of ten, and
/// the same table read through a window of five is served, because the
/// window bounds it before the budget does.
#[test]
fn a_read_past_the_row_budget_is_refused() {
    let Some(dsn) = dsn() else {
        return;
    };
    block_on(async {
        let names = Names::new("budget");
        let client = prepare(&dsn, &names).await;
        client
            .batch_execute(&format!(
                "INSERT INTO {t} SELECT g, 'OPEN', 7, g FROM generate_series(4, 30) AS g;",
                t = names.tickets
            ))
            .await
            .expect("fill");
        let catalog = Arc::new(names.catalog());
        let mut stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let storage = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect")
            .with_read_row_limit(10);
        let mut runtime = Runtime::new(MultiTableIVM::new());
        catch_up(&mut runtime, &mut stream, &[&storage]).await;
        let whole = SingleTableReadQuery::new(
            names.tickets.as_str(),
            Where::AND(vec![]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        );
        let refused = storage.select(&whole).await;
        assert!(
            matches!(&refused, Err(error) if error.refusal().is_some()),
            "thirty rows over a budget of ten are refused, got {refused:?}"
        );
        let page = SingleTableReadQuery::new(
            names.tickets.as_str(),
            Where::AND(vec![]),
            OrderBy::new("id", Order::ASC),
            5,
        );
        let served = storage.select(&page).await.expect("a page is served");
        assert_eq!(served.rows.len(), 5, "the window bounds the read first");
        cleanup(&dsn, &client, &names).await;
    });
}

/// A JSON column is filtered by value on the database as the engine
/// filters it in memory: a `jsonb` and a `json` column are both read and
/// counted by a string, a number, a boolean and an object, however the
/// stored value was spelled (a padded fraction, an exponent, spacing, the
/// order of keys, a key repeated), and every cell, whether a read brought
/// it or the change feed did, is the one text a literal of the same value
/// is given, so the two compare equal in the engine as they do in
/// Postgres. This is the support desk's `actualFieldValue = value`, which
/// Postgres used to refuse.
#[test]
fn a_json_column_is_filtered_by_value() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let table = "live_json_values";
        let slot = "xyne_sync_live_json";
        let publication = "xyne_sync_live_json_pub";
        let client = admin(&dsn).await;
        PgStream::drop_slot(&dsn, slot, publication)
            .await
            .expect("drop slot");
        client
            .batch_execute(&format!(
                "DROP TABLE IF EXISTS {table};
                 CREATE TABLE {table} (id int8 PRIMARY KEY, fixed jsonb, loose json);
                 CREATE PUBLICATION \"{publication}\" FOR ALL TABLES;
                 INSERT INTO {table} VALUES
                   (1, '\"high\"', '\"high\"'), (2, '5', '5'), (3, 'true', 'true'),
                   (4, '{{\"b\": [1, 2], \"a\": \"x\"}}', '{{\"b\":[1,2],   \"a\":\"x\"}}'), (5, NULL, NULL),
                   (6, '1.50', '1.50'),
                   (7, '{{\"n\": 2.0, \"list\": [0.10, 1e2]}}', '{{ \"list\":[0.10,1e2], \"n\":7, \"n\": 2.0 }}');",
                publication = publication
            ))
            .await
            .expect("prepare");
        let catalog = Arc::new(Catalog::new(vec![DbTable::new(
            table,
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("fixed", ValueType::Json),
                DbColumn::new("loose", ValueType::Json),
            ],
        )]));
        let mut stream = PgStream::open(&dsn, slot, publication, catalog.clone())
            .await
            .expect("open stream");
        let storage = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect");
        let mut runtime = Runtime::new(MultiTableIVM::new());
        catch_up(&mut runtime, &mut stream, &[&storage]).await;

        let by = |column: &'static str, literal: serde_json::Value| {
            SingleTableReadQuery::new(
                table,
                Where::condition(
                    column,
                    ComparisonOperator::EQ,
                    streamgres::sync::pg::text::jsonb_text(&literal).as_str(),
                ),
                OrderBy::new("id", Order::ASC),
                u32::MAX,
            )
        };
        let ids = |snapshot: &streamgres::model::Snapshot| -> Vec<i64> {
            snapshot
                .rows
                .iter()
                .filter_map(
                    |(key, _)| match key.pkey_value.get(&ColumnName::from("id")) {
                        Some(Value::Int(id)) => Some(*id),
                        _ => None,
                    },
                )
                .collect()
        };
        for column in ["fixed", "loose"] {
            for (literal, expected) in [
                (serde_json::json!("high"), 1),
                (serde_json::json!(5), 2),
                (serde_json::json!(true), 3),
                (serde_json::json!({"a": "x", "b": [1, 2]}), 4),
                (serde_json::json!(1.5), 6),
                (serde_json::json!({"list": [0.1, 100], "n": 2}), 7),
            ] {
                let query = by(column, literal.clone());
                let read = storage.select(&query).await.expect("the read is served");
                assert_eq!(ids(&read), vec![expected], "{column} = {literal}");
                let alone = MultiTableReadQuery::single(query.clone());
                assert_eq!(storage.count(&alone, 10).await.expect("count"), 1);
                assert_eq!(
                    read.rows[0].1.data.get(&ColumnName::from(column)),
                    Some(&Value::from(
                        streamgres::sync::pg::text::jsonb_text(&literal).as_str()
                    )),
                    "the {column} cell a read brings back is the text the literal was given"
                );
            }
            let none = by(column, serde_json::json!("low"));
            assert_eq!(
                ids(&storage.select(&none).await.expect("served")),
                Vec::<i64>::new()
            );
        }
        let object = storage
            .select(&by("fixed", serde_json::json!({"b": [1, 2], "a": "x"})))
            .await
            .expect("served");
        let cell = object.rows[0]
            .1
            .data
            .get(&ColumnName::from("fixed"))
            .cloned();
        assert_eq!(
            cell,
            Some(Value::from("{\"a\": \"x\", \"b\": [1, 2]}")),
            "the cell a read brings back is the text the literal was given"
        );
        let whole = SingleTableReadQuery::new(
            table,
            Where::AND(vec![]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        );
        let read = storage.select(&whole).await.expect("the table is read");
        client
            .batch_execute(&format!("UPDATE {table} SET fixed = fixed"))
            .await
            .expect("every row is written again");
        let fed = stream.poll().await.expect("poll");
        assert_eq!(fed.writes.len(), read.rows.len());
        for (write, _) in &fed.writes {
            let image = write.new_row_image().expect("an update has an image");
            let (_, as_read) = read
                .rows
                .iter()
                .find(|(key, _)| key == write.pkey_value())
                .expect("the row was read");
            for column in ["fixed", "loose"] {
                let column = ColumnName::from(column);
                assert_eq!(
                    image.data.get(&column),
                    as_read.data.get(&column),
                    "the feed and a read bring {column} as the same text"
                );
            }
        }
        let _ = client
            .batch_execute(&format!("DROP TABLE IF EXISTS {table};"))
            .await;
        let _ = PgStream::drop_slot(&dsn, slot, publication).await;
    });
}

/// A read is given the read timeout and no more: one that PostgreSQL is
/// still working on when the time is up is cancelled there and refused
/// here, naming the table, well before it would have finished; the
/// connection settings that carry the limit leave an ordinary read
/// alone, and a count is held to the same time.
#[test]
fn a_read_past_its_time_is_refused() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("timeout");
        let client = prepare(&dsn, &names).await;
        let catalog = Arc::new(names.catalog());
        let mut stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let slow = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect")
            .with_read_timeout(Duration::from_millis(400))
            .with_read_delay(Duration::from_secs(5));
        let quick = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect")
            .with_read_timeout(Duration::from_millis(400));
        let mut runtime = Runtime::new(MultiTableIVM::new());
        catch_up(&mut runtime, &mut stream, &[&slow, &quick]).await;
        let whole = SingleTableReadQuery::new(
            names.tickets.as_str(),
            Where::AND(vec![]),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        );
        let started = Instant::now();
        let refused = slow.select(&whole).await.expect_err("a read past its time");
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "the read was given up after the timeout, not after it finished: {:?}",
            started.elapsed()
        );
        assert_eq!(
            refused.refusal(),
            Some(format!("a read on `{}` took longer than 400 ms", names.tickets).as_str()),
            "{refused}"
        );
        let served = quick
            .select(&whole)
            .await
            .expect("an ordinary read is served");
        assert!(!served.rows.is_empty());
        let alone = MultiTableReadQuery::single(whole.clone());
        assert!(quick.count(&alone, 10).await.expect("an ordinary count") > 0);
        let again = slow.select(&whole).await.expect_err("and again");
        assert!(again.refusal().is_some(), "{again}");
        cleanup(&dsn, &client, &names).await;
    });
}

/// The feed writes nothing and still moves: with no transaction of ours,
/// the server's keepalives carry its position past the first snapshot,
/// the service is told the position without a transaction to carry it,
/// the snapshot comes into use and the service says where it and the
/// storage are, which is what a server waits for before it serves.
#[test]
fn an_idle_feed_brings_the_first_snapshot_into_use() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("idle");
        let client = prepare(&dsn, &names).await;
        let catalog = Arc::new(names.catalog());
        let stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let pg = Arc::new(
            PgStorage::connect(&dsn, catalog.clone())
                .await
                .expect("connect")
                .with_rotation(Duration::from_millis(100)),
        );
        let storage = Rc::new(Sources::new(pg.clone(), catalog.clone(), Vec::new()));
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (service, commands) = Service::new(MultiTableIVM::new(), storage, events_tx);
        let running = spawn_local(service.run());
        let feeding = spawn_local(stream.run(Duration::from_millis(50), commands.clone()));
        let covered = tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(event) = events.recv().await {
                if let Event::Committed {
                    position, floor, ..
                } = event
                    && floor > Lsn(0)
                    && position >= floor
                {
                    return Some((position, floor));
                }
            }
            None
        })
        .await
        .expect("the service is ready within ten seconds of an idle feed");
        let (position, floor) = covered.expect("the service is still running");
        assert!(position >= floor && floor > Lsn(0));
        assert_eq!(pg.alias_position(), Some(floor));
        feeding.abort();
        drop(commands);
        let _ = running.await;
        cleanup(&dsn, &client, &names).await;
    });
}

/// Events until one satisfies `done`, that one included; fails after ten
/// seconds.
async fn events_until(
    events: &mut mpsc::UnboundedReceiver<Event>,
    done: impl Fn(&Event) -> bool,
) -> Vec<Event> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = tokio::time::timeout(remaining, events.recv())
            .await
            .unwrap_or_else(|_| panic!("the awaited event did not come; seen {seen:?}"))
            .expect("the service is alive");
        let finished = done(&event);
        seen.push(event);
        if finished {
            return seen;
        }
    }
}

/// Poll `ready` every 50 ms until it holds; fails after ten seconds.
async fn wait_until(what: &str, ready: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ready() {
        assert!(Instant::now() < deadline, "{what} did not happen in time");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// The rows `table` gained in `events`, by id: their `owner` cell.
fn owners_added(events: &[Event], table: &str) -> BTreeMap<i64, Option<Value>> {
    let mut out = BTreeMap::new();
    for event in events {
        let updates: &[Delta] = match event {
            Event::Registered { updates, .. }
            | Event::Landed { updates }
            | Event::Committed { updates, .. } => updates,
            _ => &[],
        };
        for update in updates {
            if update.table.as_str() != table {
                continue;
            }
            if let DataFrameOperation::Add(key, row) = &update.op
                && let Some(Value::Int(id)) = key.pkey_value.get(&ColumnName::from("id"))
            {
                out.insert(*id, row.data.get("owner").cloned());
            }
        }
    }
    out
}

/// Schema changes arrive through the schema-change trigger stack and are
/// followed live, the feed and the service wired as the server wires
/// them: a column added with a constant default reaches the rows the
/// engine holds and the rows written after it, a row of the migration's
/// own transaction included; a table created becomes queryable, and the
/// catalog the clients' side reads switches, once a snapshot has the
/// change; and a change the server cannot follow ends the feed with the
/// reason.
#[test]
fn schema_changes_follow_the_trigger() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("ddl");
        let client = prepare(&dsn, &names).await;
        let catalog = Arc::new(names.catalog());
        let handle = Arc::new(CatalogHandle::from_arc(catalog.clone()));
        let source = DdlSource {
            prefix: "xslive/0/ddl".to_owned(),
            schemas: vec!["public".to_owned()],
        };
        let stream = PgStream::open_with(
            &dsn,
            &names.slot,
            &names.publication,
            catalog.clone(),
            source,
        )
        .await
        .expect("open stream");
        client
            .batch_execute(&trigger_stack_sql(
                "xslive",
                0,
                &[names.publication.as_str()],
            ))
            .await
            .expect("install the schema-change trigger stack");
        let pg = Arc::new(
            PgStorage::connect(&dsn, catalog.clone())
                .await
                .expect("connect"),
        );
        let sources = Rc::new(Sources::new(
            pg,
            catalog.clone(),
            [TableName::from(names.users.as_str())],
        ));
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (service, commands) = Service::new(MultiTableIVM::new(), sources.clone(), events_tx);
        spawn_local(service.with_catalog(handle.clone()).run());
        let (transport, mut feed) = stream.split();
        let (out, mut transactions) = mpsc::channel(64);
        let forward = commands.clone();
        spawn_local(async move {
            while let Some(transaction) = transactions.recv().await {
                if forward
                    .send(Command::Transaction(transaction))
                    .await
                    .is_err()
                {
                    return;
                }
            }
        });
        let streaming = spawn_local(async move {
            transport
                .stream(Duration::from_millis(50), &mut feed, &[], out)
                .await
        });
        wait_until("the first snapshot became current", || {
            sources.floor() > Lsn(0)
        })
        .await;

        commands
            .send(Command::Register {
                sink: 0,
                query: names.spec(),
                token: 1,
            })
            .await
            .expect("send");
        let opened = events_until(&mut events, |event| matches!(event, Event::Hydrated(_))).await;
        assert_eq!(
            owners_added(&opened, &names.tickets),
            BTreeMap::from([(1, None), (2, None), (3, None)]),
            "three open tickets, no owner column yet"
        );

        client
            .batch_execute(&format!(
                "BEGIN;
                 ALTER TABLE {t} ADD COLUMN owner text DEFAULT 'nobody';
                 INSERT INTO {t} (id, status, assigned_to, points, owner) VALUES (20, 'OPEN', 7, 20, 'meera');
                 COMMIT;",
                t = names.tickets
            ))
            .await
            .expect("the first migration");
        let migrated = events_until(&mut events, |event| {
            !owners_added(std::slice::from_ref(event), &names.tickets).is_empty()
        })
        .await;
        assert_eq!(
            owners_added(&migrated, &names.tickets),
            BTreeMap::from([(20, Some(Value::from("meera")))]),
            "the migration's own row arrives with its owner, and nothing else is delivered for the change"
        );
        wait_until("the clients' catalog gained the column", || {
            handle
                .load()
                .table(&names.tickets)
                .is_some_and(|table| table.column("owner").is_some())
        })
        .await;

        commands
            .send(Command::Register {
                sink: 0,
                query: names.spec(),
                token: 2,
            })
            .await
            .expect("send");
        let twin = events_until(&mut events, |event| matches!(event, Event::Hydrated(_))).await;
        assert!(
            twin.iter()
                .any(|event| matches!(event, Event::Registered { token: 2, .. })),
            "{twin:?}"
        );
        assert_eq!(
            owners_added(&twin, &names.tickets),
            BTreeMap::from([
                (1, Some(Value::from("nobody"))),
                (2, Some(Value::from("nobody"))),
                (3, Some(Value::from("nobody"))),
                (20, Some(Value::from("meera"))),
            ]),
            "the rows held from before the migration carry the default; the new row its own value"
        );

        client
            .batch_execute(&format!(
                "CREATE TABLE {e} (id int8 PRIMARY KEY, label text);
                 INSERT INTO {e} VALUES (1, 'one');",
                e = names.extra
            ))
            .await
            .expect("the second migration");
        wait_until("the clients' catalog gained the table", || {
            handle.load().table(&names.extra).is_some()
        })
        .await;
        commands
            .send(Command::Register {
                sink: 0,
                query: MultiTableReadQuery::single(SingleTableReadQuery::new(
                    names.extra.as_str(),
                    Where::AND(vec![]),
                    OrderBy::new("id", Order::ASC),
                    u32::MAX,
                )),
                token: 3,
            })
            .await
            .expect("send");
        let extra = events_until(&mut events, |event| matches!(event, Event::Hydrated(_))).await;
        let extra_ids: Vec<i64> = extra
            .iter()
            .flat_map(|event| match event {
                Event::Registered { updates, .. } | Event::Landed { updates } => updates.as_slice(),
                _ => &[],
            })
            .filter_map(|delta| match &delta.op {
                DataFrameOperation::Add(key, _) if delta.table.as_str() == names.extra => {
                    match key.pkey_value.get(&ColumnName::from("id")) {
                        Some(Value::Int(id)) => Some(*id),
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect();
        assert_eq!(
            extra_ids,
            vec![1],
            "the new table is read on a snapshot that has it"
        );
        assert!(
            !extra
                .iter()
                .any(|event| matches!(event, Event::Refused { .. })),
            "{extra:?}"
        );

        client
            .batch_execute(&format!(
                "ALTER TABLE {t} DROP COLUMN points",
                t = names.tickets
            ))
            .await
            .expect("the third migration");
        let outcome = streaming.await.expect("the feed task");
        let error = outcome.expect_err("a dropped column stops the feed");
        assert!(error.0.contains("cannot follow"), "{error}");
        assert!(error.0.contains("`points`"), "{error}");

        let _ = client
            .batch_execute(
                "DROP EVENT TRIGGER IF EXISTS xslive_ddl_start_0;
                 DROP EVENT TRIGGER IF EXISTS xslive_ddl_end_0;
                 DROP SCHEMA IF EXISTS xslive_0 CASCADE;",
            )
            .await;
        cleanup(&dsn, &client, &names).await;
    });
}

/// A large value PostgreSQL stores out of line arrives as "unchanged" when
/// an update leaves it alone. A reply that updates a conversation while
/// the registration's read is held open behind it, and an update that
/// moves a conversation into the channel, never reach the subscriber or
/// the frame without `md`: the frame ends equal to what Postgres holds.
#[test]
fn unchanged_out_of_line_values_are_never_lost() {
    let Some(dsn) = dsn() else { return };
    block_on(async {
        let names = Names::new("toast");
        let table = names.extra.clone();
        let client = prepare(&dsn, &names).await;
        client
            .batch_execute(&format!(
                "CREATE TABLE {table} (id int8 PRIMARY KEY, channel text, replies int8, md text);
                 ALTER TABLE {table} ALTER COLUMN md SET STORAGE EXTERNAL;
                 INSERT INTO {table} VALUES
                     (1, 'a', 0, repeat('x', 4000)), (2, 'b', 0, repeat('y', 4000));"
            ))
            .await
            .expect("conversations");
        let catalog = Arc::new(Catalog::new(vec![DbTable::new(
            table.as_str(),
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("channel", ValueType::String),
                DbColumn::new("replies", ValueType::Int),
                DbColumn::new("md", ValueType::String),
            ],
        )]));
        let mut stream = PgStream::open(&dsn, &names.slot, &names.publication, catalog.clone())
            .await
            .expect("open stream");
        let slow = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect")
            .with_read_delay(Duration::from_millis(1500));
        let fast = PgStorage::connect(&dsn, catalog.clone())
            .await
            .expect("connect");
        let mut runtime = Runtime::new(MultiTableIVM::new());
        catch_up(&mut runtime, &mut stream, &[&slow, &fast]).await;

        let (sub, step) = runtime.register(MultiTableReadQuery::single(SingleTableReadQuery::new(
            table.as_str(),
            Where::condition("channel", ComparisonOperator::EQ, "a"),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        )));
        assert_eq!(step.selects.len(), 1);
        let main = step.selects[0].clone();
        let query = main.query.clone();
        let select = spawn_local(async move { slow.select(&query).await });
        tokio::time::sleep(Duration::from_millis(400)).await;
        client
            .batch_execute(&format!("UPDATE {table} SET replies = 1 WHERE id = 1;"))
            .await
            .expect("reply");

        let behind = stream.poll().await.expect("poll");
        assert_eq!(behind.writes.len(), 1);
        let image = behind.writes[0].0.new_row_image().expect("an update");
        assert!(
            image.data.is_partial() && image.data.get("md").is_none(),
            "PostgreSQL sent md as unchanged: {image:?}"
        );
        let mut updates = Vec::new();
        let mut pending = Vec::new();
        for (write, at) in behind.writes {
            let step = runtime.write(&write, at);
            moved(&mut runtime, &[&fast]);
            assert!(step.updates.is_empty(), "no partial row sent");
            pending.extend(step.selects);
        }
        runtime.progress(behind.progress);
        moved(&mut runtime, &[&fast]);
        assert_eq!(pending.len(), 1, "the row is read again");

        let snapshot = select.await.expect("join").expect("select");
        assert!(
            snapshot.at < runtime.position(),
            "the read is behind the reply"
        );
        let step = runtime.fetched(main.id, snapshot);
        updates.extend(step.updates);
        pending.extend(step.selects);
        updates.extend(drain(&mut runtime, &fast, &mut stream, pending).await);

        client
            .batch_execute(&format!("UPDATE {table} SET channel = 'a' WHERE id = 2;"))
            .await
            .expect("move");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut pending = Vec::new();
        loop {
            let batch = stream.poll().await.expect("poll");
            let arrived = !batch.writes.is_empty();
            for (write, at) in batch.writes {
                let step = runtime.write(&write, at);
                moved(&mut runtime, &[&fast]);
                updates.extend(step.updates);
                pending.extend(step.selects);
            }
            let step = runtime.progress(batch.progress);
            moved(&mut runtime, &[&fast]);
            updates.extend(step.updates);
            pending.extend(step.selects);
            if arrived {
                break;
            }
            assert!(Instant::now() < deadline, "the move never arrived");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        updates.extend(drain(&mut runtime, &fast, &mut stream, pending).await);

        for delta in &updates {
            if let DataFrameOperation::Add(_, row) = &delta.op {
                assert!(
                    !row.data.is_partial()
                        && matches!(row.data.get("md"), Some(Value::String(md)) if md.len() == 4000),
                    "a row without md was sent: {row:?}"
                );
            }
        }
        let held: BTreeMap<i64, (Value, Value)> = runtime
            .engine()
            .rows_for(sub, QueryPart::main())
            .unwrap_or_default()
            .into_iter()
            .map(|(key, row)| match key.pkey_value["id"] {
                Value::Int(id) => (id, (row.data["replies"].clone(), row.data["md"].clone())),
                _ => panic!("integer ids"),
            })
            .collect();
        let stored: BTreeMap<i64, (Value, Value)> = client
            .query(
                &format!("SELECT id, replies, md FROM {table} WHERE channel = 'a'"),
                &[],
            )
            .await
            .expect("truth")
            .iter()
            .map(|row| {
                (
                    row.get::<_, i64>(0),
                    (
                        Value::Int(row.get::<_, i64>(1)),
                        Value::String(row.get::<_, String>(2)),
                    ),
                )
            })
            .collect();
        assert_eq!(stored.len(), 2);
        assert_eq!(held, stored, "the frame holds what Postgres holds");
        assert!(runtime.engine().hydrated(sub));
        assert_eq!(
            runtime.engine().stats().row_reads,
            2,
            "the reply and the move"
        );
        assert!(
            runtime.stats().rows_completed >= 1,
            "the held-open read completed the reply"
        );
        cleanup(&dsn, &client, &names).await;
    });
}
