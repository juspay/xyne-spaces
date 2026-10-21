//! Deterministic interleavings of storage reads with the write stream,
//! driven through the runtime state machine directly: the test decides
//! where each read's snapshot is positioned (never ahead of what the
//! runtime has applied, the storage's contract), which writes stream past
//! before it lands, and checks the runtime's one rule: a read's result is
//! brought up to the engine's position before the engine sees it, whether
//! the writes it missed were delivered before or after the read was
//! issued.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use streamgres::ivm::{Engine, Fetch, MultiTableIVM, QueryPart, SingleTableIVM, SubId};
use streamgres::model::*;
use streamgres::sync::{Lsn, MemoryStorage, Runtime, Snapshot, Step};

/// `tickets(id, status, assigned_to, points)`.
fn tickets_table() -> DbTable {
    DbTable::new(
        "tickets",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("status", ValueType::String),
            DbColumn::new("assigned_to", ValueType::Int),
            DbColumn::new("points", ValueType::Int),
        ],
    )
}

/// `users(id, name)`.
fn users_table() -> DbTable {
    DbTable::new(
        "users",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("name", ValueType::String),
        ],
    )
}

fn pkey(id: i64) -> HashMap<ColumnName, Value> {
    HashMap::from([("id".into(), Value::Int(id))])
}

/// Collects `(column, value)` pairs plus the `id` primary key into a full
/// row image.
fn full_row(id: i64, pairs: &[(&str, Value)]) -> DataFrameRow {
    let mut data: HashMap<ColumnName, Value> = pairs
        .iter()
        .map(|(column, value)| ((*column).into(), value.clone()))
        .collect();
    data.insert("id".into(), Value::Int(id));
    DataFrameRow::from(data)
}

fn insert(table: &str, id: i64, pairs: &[(&str, Value)]) -> WriteQuery {
    WriteQuery::INSERT(InsertQuery {
        table: TableName::from(table),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: full_row(id, pairs),
    })
}

fn update(table: &str, id: i64, pairs: &[(&str, Value)]) -> WriteQuery {
    WriteQuery::UPDATE(UpdateQuery {
        table: TableName::from(table),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: full_row(id, pairs),
    })
}

fn delete(table: &str, id: i64) -> WriteQuery {
    WriteQuery::DELETE(DeleteQuery {
        table: TableName::from(table),
        pkey_value: DataFrameKey::new(pkey(id)),
    })
}

/// A ticket row: `status`, `assigned_to`, `points`.
fn ticket(id: i64, status: &str, user: i64, points: i64) -> WriteQuery {
    insert(
        "tickets",
        id,
        &[
            ("status", status.into()),
            ("assigned_to", Value::Int(user)),
            ("points", Value::Int(points)),
        ],
    )
}

/// A ticket update carrying a full row image.
fn ticket_update(id: i64, status: &str, user: i64, points: i64) -> WriteQuery {
    update(
        "tickets",
        id,
        &[
            ("status", status.into()),
            ("assigned_to", Value::Int(user)),
            ("points", Value::Int(points)),
        ],
    )
}

fn user(id: i64, name: &str) -> WriteQuery {
    insert("users", id, &[("name", name.into())])
}

/// An unbounded single-table query.
fn query(table: &DbTable, filter: Where) -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        table.name.clone(),
        filter,
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    )
}

/// `OPEN` tickets.
fn open_tickets() -> SingleTableReadQuery {
    query(
        &tickets_table(),
        Where::condition("status", ComparisonOperator::EQ, "OPEN"),
    )
}

/// The database of the test: the store the reads are answered from, and a
/// WAL clock. Every commit lands in the store and takes the next WAL
/// location; a snapshot is the store's rows right now, positioned at the
/// last commit.
struct Db {
    storage: MemoryStorage,
    lsn: u64,
}

impl Db {
    /// An empty database whose WAL is at `lsn`.
    fn at(lsn: u64) -> Self {
        Db {
            storage: MemoryStorage::new(),
            lsn,
        }
    }

    /// Commit a write: apply it to the store and position it at the next
    /// WAL location.
    fn commit(&mut self, write: &WriteQuery) -> Lsn {
        self.storage.apply(write);
        self.lsn += 1;
        Lsn(self.lsn)
    }

    /// Seed rows before any subscription exists (committed, positioned,
    /// never streamed to the runtime).
    fn seed(&mut self, writes: &[WriteQuery]) {
        for write in writes {
            self.commit(write);
        }
    }

    /// Run a read against the store as it is now, positioned at the last
    /// commit.
    fn snapshot(&self, fetch: &Fetch) -> Snapshot {
        Snapshot {
            rows: self.storage.rows(&fetch.query),
            at: Lsn(self.lsn),
        }
    }

    /// The current WAL location.
    fn head(&self) -> Lsn {
        Lsn(self.lsn)
    }
}

/// The ids of a subscription's rows, sorted.
fn ids(rows: Option<HashMap<DataFrameKey, DataFrameRow>>) -> BTreeSet<i64> {
    rows.unwrap_or_default()
        .keys()
        .map(|key| match key.pkey_value["id"] {
            Value::Int(id) => id,
            _ => panic!("integer ids"),
        })
        .collect()
}

/// The ids of a subscription's rows with one column's value, sorted by id.
fn column_of(
    rows: Option<HashMap<DataFrameKey, DataFrameRow>>,
    column: &str,
) -> BTreeMap<i64, Value> {
    rows.unwrap_or_default()
        .into_iter()
        .map(|(key, row)| match key.pkey_value["id"] {
            Value::Int(id) => (id, row.data[column].clone()),
            _ => panic!("integer ids"),
        })
        .collect()
}

/// Run every read a step handed out against the database as it is right
/// now and land it, repeating until nothing is out; the updates of every
/// step, in order.
fn settle<E: Engine>(runtime: &mut Runtime<E>, db: &Db, step: Step) -> Vec<streamgres::ivm::Delta> {
    let mut updates = step.updates;
    let mut queue = step.selects;
    while !queue.is_empty() {
        let fetch = queue.remove(0);
        let landed = runtime.fetched(fetch.id, db.snapshot(&fetch));
        updates.extend(landed.updates);
        queue.extend(landed.selects);
    }
    updates
}

/// Exactly one read was handed out.
fn only(step: &Step) -> Fetch {
    assert_eq!(
        step.selects.len(),
        1,
        "one read expected, got {:?}",
        step.selects
    );
    step.selects[0].clone()
}

/// Route `write` after committing it, and move the floor up to the
/// runtime's position the way a driver over an in-process store does.
fn stream<E: Engine>(runtime: &mut Runtime<E>, db: &mut Db, write: &WriteQuery) -> Step {
    let at = db.commit(write);
    runtime.write(write, at)
}

/// A registration's snapshot is taken at some point, and writes stream
/// past before it lands: the result is brought up to the engine first,
/// so rows a later write moved out or deleted are dropped and a row it
/// rewrote takes the newer image, which the frame already holds from the
/// write's own routing; a row inserted after the snapshot was routed
/// natively and is held.
#[test]
fn registration_result_is_brought_up_to_the_engine() {
    let mut db = Db::at(0);
    db.seed(&[
        ticket(1, "OPEN", 7, 1),
        ticket(2, "OPEN", 7, 2),
        ticket(3, "OPEN", 7, 3),
    ]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());

    let (sub, step) = runtime.register(open_tickets());
    assert!(
        step.updates.is_empty(),
        "nothing is at hand until the read lands"
    );
    let read = only(&step);
    let snapshot = db.snapshot(&read);
    assert_eq!(snapshot.rows.len(), 3);

    let mut native = stream(&mut runtime, &mut db, &ticket_update(1, "DONE", 7, 1)).updates;
    native.extend(stream(&mut runtime, &mut db, &delete("tickets", 2)).updates);
    native.extend(stream(&mut runtime, &mut db, &ticket_update(3, "OPEN", 7, 33)).updates);
    native.extend(stream(&mut runtime, &mut db, &ticket(4, "OPEN", 7, 4)).updates);
    assert_eq!(
        native.len(),
        2,
        "the rewrite and the insert route natively as adds, got {native:?}"
    );

    let landed = runtime.fetched(read.id, snapshot);
    assert!(
        landed.updates.is_empty(),
        "every snapshot row was overtaken, got {:?}",
        landed.updates
    );
    assert_eq!(runtime.stats().rows_dropped, 2, "1 moved out, 2 deleted");
    assert_eq!(runtime.stats().rows_refreshed, 1, "3 rewritten");
    assert_eq!(ids(runtime.engine().rows_for(sub)), BTreeSet::from([3, 4]));
    assert_eq!(
        column_of(runtime.engine().rows_for(sub), "points")[&3],
        Value::Int(33),
        "the natively routed image, not the snapshot's"
    );
    assert_eq!(runtime.outstanding(), 0);
}

/// Writes the snapshot already reflects (committed before it, delivered
/// after the read was asked for) are not applied again: the landing adds
/// only the rows nothing routed yet.
#[test]
fn covered_writes_are_adopted_without_duplicate_operations() {
    let mut db = Db::at(0);
    db.seed(&[ticket(1, "OPEN", 7, 1), ticket(2, "OPEN", 7, 2)]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());

    let (sub, step) = runtime.register(open_tickets());
    let read = only(&step);

    let touched = ticket_update(1, "OPEN", 7, 99);
    let arrived = ticket(3, "OPEN", 7, 3);
    let touched_at = db.commit(&touched);
    let arrived_at = db.commit(&arrived);
    let snapshot = db.snapshot(&read);
    assert_eq!(snapshot.rows.len(), 3, "taken after both commits");

    runtime.write(&touched, touched_at);
    runtime.write(&arrived, arrived_at);
    let landed = runtime.fetched(read.id, snapshot);
    let landed_ids: BTreeSet<i64> = landed
        .updates
        .iter()
        .map(|update| match &update.op {
            DataFrameOperation::Add(key, _) => match key.pkey_value["id"] {
                Value::Int(id) => id,
                _ => panic!(),
            },
            other => panic!("landing only adds, got {other:?}"),
        })
        .collect();
    assert_eq!(
        landed_ids,
        BTreeSet::from([2]),
        "1 and 3 were already held identically"
    );
    assert_eq!(runtime.stats().rows_dropped, 0);
    assert_eq!(runtime.stats().rows_refreshed, 0);
    assert_eq!(
        ids(runtime.engine().rows_for(sub)),
        BTreeSet::from([1, 2, 3])
    );
    assert_eq!(
        column_of(runtime.engine().rows_for(sub), "points")[&1],
        Value::Int(99)
    );
}

/// A read positioned behind writes that were delivered *before* it was
/// issued (the storage's snapshot lags the stream, as a rotating alias
/// does): the buffer of delivered writes reaches back to the floor, so
/// the result is still brought up; once the floor passes them the buffer
/// is trimmed.
#[test]
fn a_read_behind_earlier_writes_is_brought_up_from_the_floor() {
    let mut db = Db::at(0);
    db.seed(&[
        ticket(1, "OPEN", 7, 1),
        ticket(2, "OPEN", 7, 2),
        ticket(3, "OPEN", 7, 3),
    ]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let stale_rows = db.storage.rows(&open_tickets());
    let stale_at = db.head();

    stream(&mut runtime, &mut db, &ticket_update(1, "DONE", 7, 1));
    stream(&mut runtime, &mut db, &delete("tickets", 2));
    assert_eq!(runtime.buffered(), 2, "kept: the floor is still at zero");

    let (sub, step) = runtime.register(open_tickets());
    let read = only(&step);
    let landed = runtime.fetched(
        read.id,
        Snapshot {
            rows: stale_rows,
            at: stale_at,
        },
    );
    assert_eq!(
        landed.updates.len(),
        1,
        "only 3 survives, got {:?}",
        landed.updates
    );
    assert_eq!(runtime.stats().rows_dropped, 2);
    assert_eq!(ids(runtime.engine().rows_for(sub)), BTreeSet::from([3]));

    runtime.set_floor(db.head());
    assert_eq!(
        runtime.buffered(),
        0,
        "nothing can be positioned below the floor anymore"
    );
    stream(&mut runtime, &mut db, &ticket(4, "OPEN", 7, 4));
    assert_eq!(
        runtime.buffered(),
        1,
        "a write above the floor is kept until the floor passes it"
    );
    runtime.set_floor(db.head());
    assert_eq!(runtime.buffered(), 0);
}

/// A join crossing's narrowed read is out while the driven table is
/// written: a row the read returns that a later write rewrote lands with
/// the newer image the frame already holds, and a row the write removed
/// stays gone.
#[test]
fn narrowed_join_fetch_defers_to_later_writes() {
    let mut db = Db::at(0);
    db.seed(&[
        user(7, "meera"),
        user(8, "old"),
        user(9, "gone"),
        ticket(1, "OPEN", 7, 1),
    ]);
    let mut runtime = Runtime::new(MultiTableIVM::new());
    runtime.progress(db.head());
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::left(
            MultiTableReadQuery::single(query(&users_table(), Where::AND(vec![]))),
            "assigned_to",
            "id",
        )],
    );
    let (sub, step) = runtime.register(spec);
    settle(&mut runtime, &db, step);
    assert_eq!(
        ids(runtime.engine().rows_for(sub, QueryPart::join(0))),
        BTreeSet::from([7])
    );

    let step = stream(&mut runtime, &mut db, &ticket(2, "OPEN", 8, 2));
    let read = only(&step);
    assert_eq!(read.query.table, "users");
    let snapshot = db.snapshot(&read);
    assert_eq!(snapshot.rows.len(), 1);

    let native = stream(&mut runtime, &mut db, &user(8, "new")).updates;
    assert_eq!(
        native.len(),
        1,
        "the newly referenced user routes natively, got {native:?}"
    );
    let landed = runtime.fetched(read.id, snapshot);
    assert!(
        landed.updates.is_empty(),
        "the frame already holds the newer image, got {:?}",
        landed.updates
    );
    assert_eq!(runtime.stats().rows_refreshed, 1);
    assert_eq!(
        column_of(runtime.engine().rows_for(sub, QueryPart::join(0)), "name"),
        BTreeMap::from([(7, "meera".into()), (8, "new".into())])
    );

    let step = stream(&mut runtime, &mut db, &ticket(3, "OPEN", 9, 3));
    let read = only(&step);
    let snapshot = db.snapshot(&read);
    stream(&mut runtime, &mut db, &delete("users", 9));
    let landed = runtime.fetched(read.id, snapshot);
    assert!(landed.updates.is_empty());
    assert_eq!(
        ids(runtime.engine().rows_for(sub, QueryPart::join(0))),
        BTreeSet::from([7, 8])
    );
}

/// A refill is out while the window's table is written: the boundary is
/// open meanwhile, so rows the refill will not return are buffered (and
/// evicted past capacity once it lands), landing re-derives the frontier
/// so the buffer holds exactly the best rows and rejects worse ones again,
/// and the client sees nothing but its page move.
#[test]
fn refill_in_flight_keeps_the_window_exact() {
    let mut db = Db::at(0);
    db.seed(
        &[10, 20, 30, 40, 50, 60]
            .iter()
            .map(|points| ticket(*points, "OPEN", 7, *points))
            .collect::<Vec<_>>(),
    );
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let windowed = SingleTableReadQuery::new(
        tickets_table().name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        2,
    );
    let (sub, step) = runtime.register(windowed);
    settle(&mut runtime, &db, step);
    assert_eq!(
        ids(runtime.engine().rows_for(sub)),
        BTreeSet::from([10, 20])
    );

    stream(&mut runtime, &mut db, &delete("tickets", 10));
    let step = stream(&mut runtime, &mut db, &delete("tickets", 20));
    let refill = only(&step);
    assert_eq!(
        refill.query.limit, 3,
        "two missing plus the held row at the frontier"
    );
    let snapshot = db.snapshot(&refill);
    assert_eq!(snapshot.rows.len(), 3, "40, 50, 60");

    let admitted = stream(&mut runtime, &mut db, &ticket(45, "OPEN", 7, 45)).updates;
    assert!(
        admitted.is_empty(),
        "boundary open while the refill is out: buffered behind the page of 30, 40, got {admitted:?}"
    );
    let admitted = stream(&mut runtime, &mut db, &ticket(100, "OPEN", 7, 100)).updates;
    assert!(
        admitted.is_empty(),
        "even a row far beyond the old frontier is buffered for now, got {admitted:?}"
    );

    let landed = runtime.fetched(refill.id, snapshot);
    assert_eq!(
        ids(runtime.engine().rows_for(sub)),
        BTreeSet::from([30, 40])
    );
    assert!(
        landed.updates.is_empty(),
        "the page did not move, got {:?}",
        landed.updates
    );
    assert_eq!(
        runtime.engine().stats().window_evictions,
        2,
        "60 and 100 evicted past capacity"
    );

    assert!(
        stream(&mut runtime, &mut db, &ticket(70, "OPEN", 7, 70))
            .updates
            .is_empty(),
        "the boundary is back: worse than the frontier is rejected"
    );
    let step = stream(&mut runtime, &mut db, &ticket(35, "OPEN", 7, 35));
    assert_eq!(
        step.updates.len(),
        2,
        "35 enters the page and 40 leaves it, got {:?}",
        step.updates
    );
    assert_eq!(
        ids(runtime.engine().rows_for(sub)),
        BTreeSet::from([30, 35])
    );
    assert_eq!(runtime.outstanding(), 0);

    stream(&mut runtime, &mut db, &delete("tickets", 30));
    let step = stream(&mut runtime, &mut db, &delete("tickets", 35));
    assert_eq!(
        ids(runtime.engine().rows_for(sub)),
        BTreeSet::from([40, 45]),
        "the 45 buffered while the refill was out surfaces from the buffer"
    );
    only(&step);
}

/// Identical registrations arriving while the first one's read is out
/// share that read: the later ones are served the donor's rows so far
/// (none yet) and issue nothing, a write streamed meanwhile reaches all
/// of them, and the one landing completes all of them.
#[test]
fn registrations_while_the_read_is_out_share_it() {
    let mut db = Db::at(0);
    db.seed(&[
        ticket(1, "OPEN", 7, 1),
        ticket(2, "OPEN", 7, 2),
        ticket(3, "CLOSED", 7, 3),
    ]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let (a, step) = runtime.register(open_tickets());
    let read = only(&step);
    let (b, step) = runtime.register(open_tickets());
    assert!(
        step.selects.is_empty(),
        "no second read, got {:?}",
        step.selects
    );
    assert!(step.updates.is_empty());
    let (c, step) = runtime.register(open_tickets());
    assert!(step.selects.is_empty());

    let snapshot = db.snapshot(&read);
    let streamed = stream(&mut runtime, &mut db, &ticket(4, "OPEN", 7, 4)).updates;
    assert_eq!(streamed.len(), 1, "one delta for the one row");
    assert_eq!(
        streamed[0].target_count(),
        3,
        "routed natively to all three while the read is out"
    );

    let landed = runtime.fetched(read.id, snapshot);
    for sub in [a, b, c] {
        assert_eq!(
            ids(runtime.engine().rows_for(sub)),
            BTreeSet::from([1, 2, 4])
        );
    }
    assert_eq!(landed.updates.len(), 2, "rows 1 and 2");
    assert!(
        landed
            .updates
            .iter()
            .all(|update| update.target_count() == 3),
        "each for all three"
    );
    assert_eq!(runtime.stats().reads_issued, 1);
    assert_eq!(runtime.engine().stats().snapshots_shared, 2);
    assert_eq!(runtime.outstanding(), 0);
}

/// A read may run against a snapshot older than the engine: a row written
/// into the filter after that snapshot but before the subscription existed
/// is in neither the snapshot nor the routing, so landing adds it from the
/// delivered writes; a row written out of the filter stays out.
#[test]
fn writes_between_the_snapshot_and_the_registration_land_too() {
    let mut db = Db::at(0);
    db.seed(&[ticket(1, "OPEN", 7, 1)]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let stale_rows = db.storage.rows(&open_tickets());
    let stale_at = db.head();

    stream(&mut runtime, &mut db, &ticket(2, "OPEN", 7, 2));
    stream(&mut runtime, &mut db, &ticket(3, "DONE", 7, 3));
    let (sub, step) = runtime.register(open_tickets());
    let read = only(&step);
    let landed = runtime.fetched(
        read.id,
        Snapshot {
            rows: stale_rows,
            at: stale_at,
        },
    );
    assert_eq!(
        ids(runtime.engine().rows_for(sub)),
        BTreeSet::from([1, 2]),
        "ticket 2 was written after the snapshot and before the registration"
    );
    assert_eq!(landed.updates.len(), 2);
    assert_eq!(runtime.stats().rows_added, 1);
}

/// The same under a window whose read came back full: a late row better
/// than the worst row read joins the result, one worse than it is left to
/// a refill, so the frontier the landing sets covers only what storage
/// returned.
#[test]
fn late_writes_respect_a_full_window() {
    let mut db = Db::at(0);
    db.seed(
        &[10, 20, 30, 40, 50]
            .iter()
            .map(|points| ticket(*points, "OPEN", 7, *points))
            .collect::<Vec<_>>(),
    );
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let windowed = SingleTableReadQuery::new(
        tickets_table().name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        2,
    );
    let storage_query = SingleTableReadQuery {
        limit: 4,
        ..windowed.clone()
    };
    let stale_rows = db.storage.rows(&storage_query);
    let stale_at = db.head();
    assert_eq!(stale_rows.len(), 4, "the buffer read comes back full");

    stream(&mut runtime, &mut db, &ticket(5, "OPEN", 7, 5));
    stream(&mut runtime, &mut db, &ticket(45, "OPEN", 7, 45));
    let (sub, step) = runtime.register(windowed);
    let read = only(&step);
    runtime.fetched(
        read.id,
        Snapshot {
            rows: stale_rows,
            at: stale_at,
        },
    );
    assert_eq!(
        ids(runtime.engine().rows_for(sub)),
        BTreeSet::from([5, 10]),
        "the better late row joins the page"
    );
    assert_eq!(
        runtime.stats().rows_added,
        1,
        "the worse one is left to a refill"
    );
    assert!(
        stream(&mut runtime, &mut db, &ticket(60, "OPEN", 7, 60))
            .updates
            .is_empty(),
        "the frontier stands at the worst row read: 60 is rejected"
    );
}

/// Registration walks the tree as reads land: a RIGHT child's read comes
/// first, and only once it has landed does the parent register, with the
/// child's join values already in its set, so the parent costs one read;
/// a LEFT child registers after its parent landed, with the parent's
/// values in its set, again one read.
#[test]
fn post_order_registration_follows_landings() {
    let mut db = Db::at(0);
    db.seed(&[
        user(7, "meera"),
        user(8, "arjun"),
        ticket(1, "OPEN", 7, 1),
        ticket(2, "OPEN", 8, 2),
        ticket(3, "OPEN", 9, 3),
    ]);
    let mut runtime = Runtime::new(MultiTableIVM::new());
    runtime.progress(db.head());
    let right = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::right(
            MultiTableReadQuery::single(query(&users_table(), Where::AND(vec![]))),
            "assigned_to",
            "id",
        )],
    );
    let (sub, step) = runtime.register(right);
    let first = only(&step);
    assert_eq!(first.query.table, "users", "the driving child reads first");
    let step = runtime.fetched(first.id, db.snapshot(&first));
    let second = only(&step);
    assert_eq!(
        second.query.table, "tickets",
        "the parent registers once the child landed"
    );
    let step = runtime.fetched(second.id, db.snapshot(&second));
    assert!(
        step.selects.is_empty(),
        "the parent's set was complete: no narrowed reads"
    );
    assert_eq!(
        ids(runtime.engine().rows_for(sub, QueryPart::main())),
        BTreeSet::from([1, 2])
    );
    assert_eq!(runtime.engine().stats().storage_reads, 2);

    let left = MultiTableReadQuery::new(
        query(
            &tickets_table(),
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        ),
        vec![Join::left(
            MultiTableReadQuery::single(query(&users_table(), Where::AND(vec![]))),
            "assigned_to",
            "id",
        )],
    );
    let before = runtime.engine().stats().storage_reads;
    let (sub, step) = runtime.register(left);
    let main = only(&step);
    assert_eq!(main.query.table, "tickets");
    let step = runtime.fetched(main.id, db.snapshot(&main));
    let child = only(&step);
    assert_eq!(
        child.query.table, "users",
        "the LEFT child registers after the parent landed"
    );
    let step = runtime.fetched(child.id, db.snapshot(&child));
    assert!(step.selects.is_empty());
    assert_eq!(
        ids(runtime.engine().rows_for(sub, QueryPart::join(0))),
        BTreeSet::from([7, 8])
    );
    assert_eq!(
        runtime.engine().stats().storage_reads - before,
        2,
        "one read per part"
    );
}

/// A read the driver could not run is parked and handed out again when
/// the stream moves; an unregistered subscription's read lands as a
/// no-op; a second identical registration while the first's read is out
/// joins that read instead of reading for itself.
#[test]
fn parked_reads_unregistration_and_pending_twins() {
    let mut db = Db::at(0);
    db.seed(&[ticket(1, "OPEN", 7, 1)]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());

    let (sub, step) = runtime.register(open_tickets());
    let read = only(&step);
    let parked = runtime.failed(read.id);
    assert!(parked.selects.is_empty(), "parked, not re-issued at once");
    assert_eq!(runtime.outstanding(), 1);
    let woken = stream(&mut runtime, &mut db, &ticket(2, "DONE", 7, 2));
    assert_eq!(only(&woken).id, read.id, "the same read, handed out again");
    assert_eq!(runtime.stats().reads_retried, 1);
    runtime.fetched(read.id, db.snapshot(&read));
    assert_eq!(ids(runtime.engine().rows_for(sub)), BTreeSet::from([1]));

    let (doomed, step) = runtime.register(query(
        &tickets_table(),
        Where::condition("points", ComparisonOperator::GTE, 0),
    ));
    let read = only(&step);
    runtime.unregister(doomed);
    let landed = runtime.fetched(read.id, db.snapshot(&read));
    assert!(landed.updates.is_empty());
    assert_eq!(runtime.outstanding(), 0);
    assert!(runtime.engine().rows_for(doomed).is_none());

    let (first, step) = runtime.register(query(
        &tickets_table(),
        Where::condition("assigned_to", ComparisonOperator::EQ, 7),
    ));
    let first_read = only(&step);
    let (second, step) = runtime.register(query(
        &tickets_table(),
        Where::condition("assigned_to", ComparisonOperator::EQ, 7),
    ));
    assert!(
        step.selects.is_empty(),
        "the twin joins the read that is out, got {:?}",
        step.selects
    );
    assert_eq!(
        runtime.engine().stats().snapshots_shared,
        1,
        "an incomplete twin donates what it has and shares its read"
    );
    runtime.fetched(first_read.id, db.snapshot(&first_read));
    assert_eq!(runtime.outstanding(), 0);
    assert_eq!(
        ids(runtime.engine().rows_for(first)),
        BTreeSet::from([1, 2])
    );
    assert_eq!(
        ids(runtime.engine().rows_for(second)),
        BTreeSet::from([1, 2])
    );

    let (third, step) = runtime.register(query(
        &tickets_table(),
        Where::condition("assigned_to", ComparisonOperator::EQ, 7),
    ));
    assert!(
        step.selects.is_empty(),
        "with both landed, the twin path serves it"
    );
    assert_eq!(step.updates.len(), 2, "one delta per shared row");
    assert_eq!(runtime.engine().stats().snapshots_shared, 2);
    assert_eq!(
        ids(runtime.engine().rows_for(third)),
        BTreeSet::from([1, 2])
    );
}

/// A later identical join registration while the shared tree is still
/// landing is served what is there and receives the rest as it lands,
/// like every other subscriber; two subscribers of one client receive one
/// delta naming both.
#[test]
fn twin_joining_a_landing_tree_receives_the_rest() {
    let mut db = Db::at(0);
    db.seed(&[user(7, "meera"), ticket(1, "OPEN", 7, 1)]);
    let mut runtime = Runtime::new(MultiTableIVM::new());
    runtime.progress(db.head());
    let spec = || {
        MultiTableReadQuery::new(
            open_tickets(),
            vec![Join::left(
                MultiTableReadQuery::single(query(&users_table(), Where::AND(vec![]))),
                "assigned_to",
                "id",
            )],
        )
    };
    let (first, step) = runtime.register(spec());
    let main = only(&step);
    let (second, step) = runtime.register(spec());
    assert!(
        step.selects.is_empty() && step.updates.is_empty(),
        "shares the tree, nothing landed yet"
    );

    let step = runtime.fetched(main.id, db.snapshot(&main));
    assert_eq!(step.updates.len(), 1, "one delta for the one row");
    let subs: BTreeSet<SubId> = step.updates[0].targets().map(|target| target.sub).collect();
    assert_eq!(
        subs,
        BTreeSet::from([first, second]),
        "naming both subscribers"
    );
    let child = only(&step);
    let step = runtime.fetched(child.id, db.snapshot(&child));
    assert_eq!(step.updates.len(), 1);
    assert_eq!(step.updates[0].target_count(), 2);
    for sub in [first, second] {
        assert_eq!(
            ids(runtime.engine().rows_for(sub, QueryPart::main())),
            BTreeSet::from([1])
        );
        assert_eq!(
            ids(runtime.engine().rows_for(sub, QueryPart::join(0))),
            BTreeSet::from([7])
        );
    }
}

// Partial images: an update whose large value PostgreSQL stored out of line
// and sent as "unchanged" (the update did not touch it) arrives without
// that column, marked partial. The engine must never hold or send such an
// image as the row: it completes it from a whole image of the row (the
// frame's, or the read's while the read is brought up) or reads the row
// again by primary key.

/// A conversation: `channel`, `author`, `replies` and `md`, the large
/// column an update that leaves it alone sends as unchanged.
fn conversation(id: i64, channel: &str, author: i64, replies: i64, md: &str) -> WriteQuery {
    insert(
        "conversations",
        id,
        &[
            ("channel", channel.into()),
            ("author", Value::Int(author)),
            ("replies", Value::Int(replies)),
            ("md", md.into()),
        ],
    )
}

/// An update of conversation `id` that leaves `md` alone, as the feed
/// delivers it: every other column, `md` left out, the image partial.
fn reply(id: i64, channel: &str, author: i64, replies: i64) -> WriteQuery {
    WriteQuery::UPDATE(UpdateQuery {
        table: TableName::from("conversations"),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: DataFrameRow::partial([
            ("id", Value::Int(id)),
            ("channel", channel.into()),
            ("author", Value::Int(author)),
            ("replies", Value::Int(replies)),
        ]),
    })
}

/// A whole update of conversation `id`, `md` included.
fn edit(id: i64, channel: &str, author: i64, replies: i64, md: &str) -> WriteQuery {
    update(
        "conversations",
        id,
        &[
            ("channel", channel.into()),
            ("author", Value::Int(author)),
            ("replies", Value::Int(replies)),
            ("md", md.into()),
        ],
    )
}

/// The conversations of one channel, unbounded.
fn in_channel(channel: &str) -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        "conversations",
        Where::condition("channel", ComparisonOperator::EQ, channel),
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    )
}

/// The conversations of one channel whose replies exceed `replies`: a
/// different query over the same rows.
fn busy_in_channel(channel: &str, replies: i64) -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        "conversations",
        Where::AND(vec![
            Where::condition("channel", ComparisonOperator::EQ, channel),
            Where::condition("replies", ComparisonOperator::GT, Value::Int(replies)),
        ]),
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    )
}

/// The `md` and `replies` of each row, by id; a row without `md` reads
/// `None`.
fn md_and_replies(
    rows: Option<HashMap<DataFrameKey, DataFrameRow>>,
) -> BTreeMap<i64, (Option<Value>, Value)> {
    rows.unwrap_or_default()
        .into_iter()
        .map(|(key, row)| match key.pkey_value["id"] {
            Value::Int(id) => (
                id,
                (row.data.get("md").cloned(), row.data["replies"].clone()),
            ),
            _ => panic!("integer ids"),
        })
        .collect()
}

/// No delta carries a partial image or one without `md` to a client.
fn assert_whole(updates: &[streamgres::ivm::Delta]) {
    for delta in updates {
        if let DataFrameOperation::Add(_, row) = &delta.op {
            assert!(
                !row.data.is_partial() && row.data.get("md").is_some(),
                "a partial row was sent: {row:?}"
            );
        }
    }
}

/// The ids the deltas add, in order.
fn added(updates: &[streamgres::ivm::Delta]) -> Vec<i64> {
    updates
        .iter()
        .filter_map(|delta| match &delta.op {
            DataFrameOperation::Add(key, _) => match key.pkey_value["id"] {
                Value::Int(id) => Some(id),
                _ => panic!("integer ids"),
            },
            DataFrameOperation::Delete(..) => None,
        })
        .collect()
}

/// A held row: the update's image is completed from the frame's, and the
/// client is sent the whole row.
#[test]
fn a_held_row_keeps_a_column_an_update_left_out() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let (sub, step) = runtime.register(in_channel("a"));
    settle(&mut runtime, &db, step);

    let step = stream(&mut runtime, &mut db, &reply(1, "a", 7, 1));
    assert_whole(&step.updates);
    assert_eq!(added(&step.updates), vec![1]);
    assert!(step.selects.is_empty(), "nothing to read again");
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub)),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))])
    );
}

/// Nobody holds the row and no read is out: the update reaches nobody,
/// nothing is read again, and the next read gets the whole row.
#[test]
fn an_update_nobody_needs_leaves_nothing_behind() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());

    let step = stream(&mut runtime, &mut db, &reply(1, "a", 7, 1));
    assert!(step.updates.is_empty() && step.selects.is_empty());
    runtime.set_floor(db.head());

    let (sub, step) = runtime.register(in_channel("a"));
    let updates = settle(&mut runtime, &db, step);
    assert_whole(&updates);
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub)),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))])
    );
    assert_eq!(runtime.engine().stats().row_reads, 0);
}

/// The update first, then a registration whose read runs on a snapshot
/// from before it: bringing the read up completes the update's image from
/// the snapshot's row instead of replacing it, so the frame takes the
/// whole row; a twin registered afterwards is served it from the frame,
/// and a different query reading the row agrees with the frame.
#[test]
fn a_read_behind_an_update_completes_the_row_from_its_snapshot() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let stale_rows = db.storage.rows(&in_channel("a"));
    let stale_at = db.head();

    stream(&mut runtime, &mut db, &reply(1, "a", 7, 1));
    let (sub, step) = runtime.register(in_channel("a"));
    let read = only(&step);
    let landed = runtime.fetched(
        read.id,
        Snapshot {
            rows: stale_rows,
            at: stale_at,
        },
    );
    assert_whole(&landed.updates);
    assert_eq!(added(&landed.updates), vec![1]);
    assert!(landed.selects.is_empty(), "the snapshot's row completed it");
    assert_eq!(runtime.stats().rows_completed, 1);
    assert_eq!(runtime.stats().rows_refreshed, 1);
    let whole = BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))]);
    assert_eq!(md_and_replies(runtime.engine().rows_for(sub)), whole);

    let (twin, step) = runtime.register(in_channel("a"));
    assert!(step.selects.is_empty(), "served from the frame");
    assert_whole(&step.updates);
    assert_eq!(md_and_replies(runtime.engine().rows_for(twin)), whole);

    let (other, step) = runtime.register(busy_in_channel("a", 0));
    let updates = settle(&mut runtime, &db, step);
    assert_whole(&updates);
    assert_eq!(md_and_replies(runtime.engine().rows_for(other)), whole);
    assert_eq!(runtime.engine().stats().row_reads, 0);
}

/// The registration's read is out when the update arrives: the update's
/// image is not sent and the frame does not take it; the row is read
/// again, and the subscription is hydrated only once both reads landed.
/// The registration's own read, brought up, delivers the whole row.
#[test]
fn an_update_while_the_read_is_out_waits_for_the_whole_row() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let (sub, step) = runtime.register(in_channel("a"));
    let read = only(&step);
    let snapshot = db.snapshot(&read);

    let step = stream(&mut runtime, &mut db, &reply(1, "a", 7, 1));
    assert!(
        step.updates.is_empty(),
        "no partial row sent: {:?}",
        step.updates
    );
    let again = only(&step);
    assert_eq!(again.query.table, "conversations");
    assert!(
        runtime
            .engine()
            .rows_for(sub)
            .unwrap_or_default()
            .is_empty(),
        "the frame did not take the partial image"
    );

    let landed = runtime.fetched(read.id, snapshot);
    assert_whole(&landed.updates);
    assert_eq!(added(&landed.updates), vec![1]);
    assert!(
        !runtime.engine().hydrated(sub),
        "still waiting on the row read"
    );
    let landed = runtime.fetched(again.id, db.snapshot(&again));
    assert!(landed.updates.is_empty(), "already held, whole");
    assert!(runtime.engine().hydrated(sub));
    assert_eq!(runtime.outstanding(), 0);
    let whole = BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))]);
    assert_eq!(md_and_replies(runtime.engine().rows_for(sub)), whole);

    let (other, step) = runtime.register(busy_in_channel("a", 0));
    settle(&mut runtime, &db, step);
    assert_eq!(md_and_replies(runtime.engine().rows_for(other)), whole);
    assert_eq!(runtime.engine().stats().row_reads, 1);
}

/// An update that leaves `md` alone moves a row into a hydrated
/// subscription nobody else holds it for: the row is read again, the
/// subscription waits on that read, and the client receives the whole
/// row when it lands. A second update to the row meanwhile joins the
/// same read.
#[test]
fn a_row_an_update_brings_in_is_read_again() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let (sub, step) = runtime.register(in_channel("b"));
    settle(&mut runtime, &db, step);
    assert!(runtime.engine().hydrated(sub));

    let step = stream(&mut runtime, &mut db, &reply(1, "b", 7, 0));
    assert!(step.updates.is_empty());
    let again = only(&step);
    assert!(!runtime.engine().hydrated(sub), "waits on the row read");
    let step = stream(&mut runtime, &mut db, &reply(1, "b", 7, 1));
    assert!(
        step.updates.is_empty() && step.selects.is_empty(),
        "joins the read already out"
    );

    let landed = runtime.fetched(again.id, db.snapshot(&again));
    assert_whole(&landed.updates);
    assert_eq!(added(&landed.updates), vec![1]);
    assert!(runtime.engine().hydrated(sub));
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub)),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))])
    );
    assert_eq!(runtime.engine().stats().row_reads, 1);
}

/// A row read lags the stream like any read: it is brought up before it
/// lands, so updates after its snapshot apply (completed from it), and
/// a delete after it leaves nothing to land.
#[test]
fn a_row_read_is_brought_up_like_any_read() {
    let mut db = Db::at(0);
    db.seed(&[
        conversation(1, "a", 7, 0, "long"),
        conversation(2, "a", 7, 0, "other"),
    ]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let (sub, step) = runtime.register(in_channel("b"));
    settle(&mut runtime, &db, step);

    let again = only(&stream(&mut runtime, &mut db, &reply(1, "b", 7, 0)));
    let snapshot = db.snapshot(&again);
    stream(&mut runtime, &mut db, &reply(1, "b", 7, 5));
    let landed = runtime.fetched(again.id, snapshot);
    assert_whole(&landed.updates);
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub)),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(5)))])
    );

    let again = only(&stream(&mut runtime, &mut db, &reply(2, "b", 7, 0)));
    let snapshot = db.snapshot(&again);
    stream(&mut runtime, &mut db, &delete("conversations", 2));
    let landed = runtime.fetched(again.id, snapshot);
    assert!(landed.updates.is_empty());
    assert_eq!(ids(runtime.engine().rows_for(sub)), BTreeSet::from([1]));
    assert!(runtime.engine().hydrated(sub));
    assert_eq!(runtime.outstanding(), 0);
}

/// A read on a snapshot from before an update that brought a row into
/// its filter, the row in no snapshot and the update leaving `md` out:
/// the read cannot land the row whole, so it reads it again, and the
/// subscription is hydrated once that read lands.
#[test]
fn a_read_behind_an_update_that_brought_its_row_in_reads_it_again() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let stale_rows = db.storage.rows(&in_channel("b"));
    let stale_at = db.head();

    stream(&mut runtime, &mut db, &reply(1, "b", 7, 1));
    let (sub, step) = runtime.register(in_channel("b"));
    let read = only(&step);
    let landed = runtime.fetched(
        read.id,
        Snapshot {
            rows: stale_rows,
            at: stale_at,
        },
    );
    assert!(landed.updates.is_empty(), "no partial row sent");
    let again = only(&landed);
    assert!(!runtime.engine().hydrated(sub));
    let landed = runtime.fetched(again.id, db.snapshot(&again));
    assert_whole(&landed.updates);
    assert!(runtime.engine().hydrated(sub));
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub)),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))])
    );
}

/// The same, but a whole update of the row (an edit of `md`) came first,
/// while the row was still outside the filter: the result holds no image
/// of the row to complete the later update from, so the row is read
/// again, and lands with the edit, not the snapshot's older value.
#[test]
fn a_row_brought_in_after_an_edit_is_read_again_with_the_edit() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let stale_rows = db.storage.rows(&in_channel("b"));
    let stale_at = db.head();

    stream(&mut runtime, &mut db, &edit(1, "a", 7, 0, "edited"));
    stream(&mut runtime, &mut db, &reply(1, "b", 7, 1));
    let (sub, step) = runtime.register(in_channel("b"));
    let read = only(&step);
    let landed = runtime.fetched(
        read.id,
        Snapshot {
            rows: stale_rows,
            at: stale_at,
        },
    );
    assert!(landed.updates.is_empty(), "no partial row sent");
    let again = only(&landed);
    let landed = runtime.fetched(again.id, db.snapshot(&again));
    assert_whole(&landed.updates);
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub)),
        BTreeMap::from([(1, (Some("edited".into()), Value::Int(1)))])
    );
    assert_eq!(runtime.engine().stats().row_reads, 1);
}

/// A twin registered while the row is read again for its query waits on
/// that read too; an unregistered reader's share lands as nothing.
#[test]
fn twins_join_a_row_read_and_leavers_drop_out() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let (first, step) = runtime.register(in_channel("b"));
    settle(&mut runtime, &db, step);

    let again = only(&stream(&mut runtime, &mut db, &reply(1, "b", 7, 1)));
    let (twin, step) = runtime.register(in_channel("b"));
    assert!(step.selects.is_empty() && step.updates.is_empty());
    assert!(!runtime.engine().hydrated(twin), "waits on the row read");
    runtime.unregister(first);

    let landed = runtime.fetched(again.id, db.snapshot(&again));
    assert_whole(&landed.updates);
    assert_eq!(landed.updates.len(), 1);
    assert_eq!(landed.updates[0].target_count(), 1, "the twin alone");
    assert!(runtime.engine().hydrated(twin));
    assert_eq!(ids(runtime.engine().rows_for(twin)), BTreeSet::from([1]));
}

/// A refused row read unsubscribes its readers like any refused read, and
/// the next subscription needing the row asks again instead of waiting on
/// it.
#[test]
fn a_refused_row_read_is_asked_again() {
    let mut db = Db::at(0);
    db.seed(&[conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let (first, step) = runtime.register(in_channel("b"));
    settle(&mut runtime, &db, step);
    let again = only(&stream(&mut runtime, &mut db, &reply(1, "b", 7, 1)));
    assert_eq!(runtime.refused(again.id), vec![first]);

    let (second, step) = runtime.register(in_channel("b"));
    let read = only(&step);
    let snapshot = db.snapshot(&read);
    let step = stream(&mut runtime, &mut db, &reply(1, "b", 7, 2));
    let asked = only(&step);
    assert_ne!(asked.id, again.id, "a new row read");
    let mut updates = runtime.fetched(read.id, snapshot).updates;
    updates.extend(settle(
        &mut runtime,
        &db,
        Step {
            updates: Vec::new(),
            selects: vec![asked],
        },
    ));
    assert_whole(&updates);
    assert!(runtime.engine().hydrated(second));
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(second)),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(2)))])
    );
}

/// Under a window: the row read again lands through the window like the
/// update's own row would have, entering the page and pushing the worse
/// row out.
#[test]
fn a_row_read_lands_through_the_window() {
    let mut db = Db::at(0);
    db.seed(&[
        conversation(1, "a", 7, 0, "long"),
        conversation(2, "b", 7, 0, "two"),
    ]);
    let mut runtime = Runtime::new(SingleTableIVM::new());
    runtime.progress(db.head());
    let first_of_b = SingleTableReadQuery::new(
        "conversations",
        Where::condition("channel", ComparisonOperator::EQ, "b"),
        OrderBy::new("id", Order::ASC),
        1,
    );
    let (sub, step) = runtime.register(first_of_b);
    settle(&mut runtime, &db, step);
    assert_eq!(ids(runtime.engine().rows_for(sub)), BTreeSet::from([2]));

    let again = only(&stream(&mut runtime, &mut db, &reply(1, "b", 7, 1)));
    let landed = runtime.fetched(again.id, db.snapshot(&again));
    assert_whole(&landed.updates);
    assert_eq!(added(&landed.updates), vec![1]);
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub)),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))])
    );
}

/// Through the join layer: the row read again arrives at the main part
/// as the update's row would have, and its join value fetches the driven
/// rows.
#[test]
fn a_row_read_cascades_through_a_join() {
    let mut db = Db::at(0);
    db.seed(&[user(7, "meera"), conversation(1, "a", 7, 0, "long")]);
    let mut runtime = Runtime::new(MultiTableIVM::new());
    runtime.progress(db.head());
    let spec = MultiTableReadQuery::new(
        in_channel("b"),
        vec![Join::left(
            MultiTableReadQuery::single(query(&users_table(), Where::AND(vec![]))),
            "author",
            "id",
        )],
    );
    let (sub, step) = runtime.register(spec);
    settle(&mut runtime, &db, step);
    assert!(runtime.engine().hydrated(sub));

    let step = stream(&mut runtime, &mut db, &reply(1, "b", 7, 1));
    assert!(step.updates.is_empty());
    let again = only(&step);
    assert!(!runtime.engine().hydrated(sub));
    let landed = runtime.fetched(again.id, db.snapshot(&again));
    let users = only(&landed);
    assert_eq!(users.query.table, "users");
    let mut updates = landed.updates;
    updates.extend(settle(
        &mut runtime,
        &db,
        Step {
            updates: Vec::new(),
            selects: vec![users],
        },
    ));
    assert_whole(
        &updates
            .iter()
            .filter(|delta| delta.table == "conversations")
            .cloned()
            .collect::<Vec<_>>(),
    );
    assert!(runtime.engine().hydrated(sub));
    assert_eq!(
        md_and_replies(runtime.engine().rows_for(sub, QueryPart::main())),
        BTreeMap::from([(1, (Some("long".into()), Value::Int(1)))])
    );
    assert_eq!(
        ids(runtime.engine().rows_for(sub, QueryPart::join(0))),
        BTreeSet::from([7])
    );
}
