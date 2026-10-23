//! End-to-end routing scenarios for the IVM engine — the assertable version
//! of the demo in `src/main.rs`.

use std::cell::RefCell;
use std::collections::HashMap;

use std::rc::Rc;
use streamgres::ivm::{Delta, SingleTableIVM, SubId};
use streamgres::model::*;
use streamgres::sync::{Local, MemoryStorage};

/// The single-table engine under the synchronous driver, over in-process
/// storage: registration and routing keep the engine's own call shape,
/// every storage read landed inline.
type Ivm = Local<SingleTableIVM, MemoryStorage>;

/// Builds the standard five-column test table (`id` pkey, plus `status`,
/// `priority`, `assigned_to`, `points`) under the given name.
fn table(name: &str) -> DbTable {
    DbTable::new(
        name,
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("status", ValueType::String),
            DbColumn::new("priority", ValueType::String),
            DbColumn::new("assigned_to", ValueType::String),
            DbColumn::new("points", ValueType::Int),
        ],
    )
}

/// Wraps a filter into a [`SingleTableReadQuery`] on `table`, ordered by `id` ASC with
/// a limit of 100.
fn query(table: &DbTable, filter: Where) -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        table.name.clone(),
        filter,
        OrderBy::new("id", Order::ASC),
        100,
    )
}

/// Builds the single-column primary-key map `{"id": id}`.
fn pkey(id: i64) -> HashMap<ColumnName, Value> {
    HashMap::from([("id".into(), Value::Int(id))])
}

/// Collects `(column, value)` pairs plus the `id` primary key into a full
/// row image — records must carry every column, pkey included.
fn full_row(id: i64, pairs: &[(&str, Value)]) -> DataFrameRow {
    let mut data: HashMap<ColumnName, Value> = pairs
        .iter()
        .map(|(col, val)| ((*col).into(), val.clone()))
        .collect();
    data.insert("id".into(), Value::Int(id));
    DataFrameRow::from(data)
}

/// Builds an INSERT [`WriteQuery`] for row `id` with the given column data.
fn insert(table: &DbTable, id: i64, pairs: &[(&str, Value)]) -> WriteQuery {
    WriteQuery::INSERT(InsertQuery {
        table: table.name.clone(),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: full_row(id, pairs),
    })
}

/// Builds an UPDATE [`WriteQuery`] carrying the full new row image for `id`.
fn update(table: &DbTable, id: i64, pairs: &[(&str, Value)]) -> WriteQuery {
    WriteQuery::UPDATE(UpdateQuery {
        table: table.name.clone(),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: full_row(id, pairs),
    })
}

/// Builds a DELETE [`WriteQuery`] for row `id`.
fn delete(table: &DbTable, id: i64) -> WriteQuery {
    WriteQuery::DELETE(DeleteQuery {
        table: table.name.clone(),
        pkey_value: DataFrameKey::new(pkey(id)),
    })
}

/// The standard fixture: four distinct-condition subscriptions plus a
/// full-table one, on `tickets`.
fn standard_ivm(tickets: &DbTable) -> (Ivm, Names) {
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(
        &mut ivm,
        "q-open",
        query(
            tickets,
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        ),
    );
    names.register(
        &mut ivm,
        "q-mine-active",
        query(
            tickets,
            Where::AND(vec![
                Where::condition("assigned_to", ComparisonOperator::EQ, "aniket"),
                Where::condition("status", ComparisonOperator::NEQ, "DONE"),
            ]),
        ),
    );
    names.register(
        &mut ivm,
        "q-hot",
        query(
            tickets,
            Where::condition(
                "priority",
                ComparisonOperator::IN,
                Value::List(vec!["HIGH".into(), "URGENT".into()]),
            ),
        ),
    );
    names.register(
        &mut ivm,
        "q-big",
        query(
            tickets,
            Where::condition("points", ComparisonOperator::GTE, 8),
        ),
    );
    names.register(&mut ivm, "q-all", query(tickets, Where::AND(vec![])));
    (ivm, names)
}

/// The canonical row: OPEN, LOW priority, assigned to aniket, 3 points —
/// matches `q-open`, `q-mine-active`, and `q-all` of the standard fixture.
fn open_ticket_row() -> Vec<(&'static str, Value)> {
    vec![
        ("status", "OPEN".into()),
        ("priority", "LOW".into()),
        ("assigned_to", "aniket".into()),
        ("points", 3.into()),
    ]
}

/// Test-side directory from readable names to the engine's subscription
/// ids and back: the role the transport layer plays in production. Every
/// subscription is on its own: the engine knows nothing of clients.
#[derive(Default)]
struct Names {
    ids: RefCell<HashMap<String, SubId>>,
    names: RefCell<HashMap<SubId, String>>,
}

impl Names {
    /// Register `query` under `name`, returning
    /// its snapshot as bare operations.
    fn register(
        &self,
        ivm: &mut Ivm,
        name: impl Into<String>,
        query: SingleTableReadQuery,
    ) -> Vec<DataFrameOperation> {
        let name = name.into();
        let (id, updates) = ivm.register_query(query);
        self.ids.borrow_mut().insert(name.clone(), id);
        self.names.borrow_mut().insert(id, name);
        updates.into_iter().map(|update| update.op).collect()
    }

    /// The engine id registered under `name`.
    fn id(&self, name: &str) -> SubId {
        self.ids.borrow()[name]
    }

    /// The name registered for `id`.
    fn name(&self, id: SubId) -> String {
        self.names.borrow()[&id].clone()
    }

    /// The impacted subscriptions of an update batch by name, deduplicated
    /// and sorted.
    fn impacted(&self, ops: &[Delta]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for target in ops.iter().flat_map(|update| update.targets()) {
            let name = self.name(target.sub);
            if !out.contains(&name) {
                out.push(name);
            }
        }
        out.sort();
        out
    }

    /// Whether an update names subscription `name`.
    fn targets(&self, update: &Delta, name: &str) -> bool {
        update.targets().any(|target| target.sub == self.id(name))
    }

    /// The names of `ids`, sorted.
    fn names_of(&self, ids: &[SubId]) -> Vec<String> {
        let mut out: Vec<String> = ids.iter().map(|id| self.name(*id)).collect();
        out.sort();
        out
    }
}

/// `IS NULL` and `IS NOT NULL` route through the column index: a `NULL`
/// `assigned_to` reaches the null test alone (a `!=` on the column stays
/// false for it, as SQL says), setting the column moves the row to the
/// other test in one step, and clearing it moves it back; a `NULL` row
/// already in storage is served to the null test at registration.
#[test]
fn null_tests_route_through_the_index() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    let mut unassigned = open_ticket_row();
    unassigned[2] = ("assigned_to", Value::Null);
    storage.apply(&insert(&tickets, 9, &unassigned));

    let snapshot = names.register(
        &mut ivm,
        "q-unassigned",
        query(&tickets, Where::is_null("assigned_to")),
    );
    assert_eq!(snapshot.len(), 1, "the stored NULL row is served");
    names.register(
        &mut ivm,
        "q-assigned",
        query(&tickets, Where::is_not_null("assigned_to")),
    );
    names.register(
        &mut ivm,
        "q-not-bob",
        query(
            &tickets,
            Where::condition("assigned_to", ComparisonOperator::NEQ, "bob"),
        ),
    );

    let ops = ivm.incremental_update(&insert(&tickets, 1, &unassigned));
    assert_eq!(names.impacted(&ops), ["q-unassigned"]);

    let ops = ivm.incremental_update(&update(&tickets, 1, &open_ticket_row()));
    assert_eq!(
        names.impacted(&ops),
        ["q-assigned", "q-not-bob", "q-unassigned"]
    );
    assert!(
        ops.iter()
            .any(|update| names.targets(update, "q-unassigned")
                && matches!(update.op, DataFrameOperation::Delete(..)))
    );
    assert!(ops.iter().any(|update| names.targets(update, "q-assigned")
        && matches!(update.op, DataFrameOperation::Add(..))));

    let ops = ivm.incremental_update(&update(&tickets, 1, &unassigned));
    assert_eq!(
        names.impacted(&ops),
        ["q-assigned", "q-not-bob", "q-unassigned"]
    );
    assert!(
        ops.iter()
            .any(|update| names.targets(update, "q-unassigned")
                && matches!(update.op, DataFrameOperation::Add(..)))
    );
    assert!(ops.iter().any(|update| names.targets(update, "q-not-bob")
        && matches!(update.op, DataFrameOperation::Delete(..))));
    assert_eq!(
        ivm.engine().stats().conditions_evaluated,
        4,
        "a NULL probe yields the null test alone, a value probe the two negations: no scan"
    );
}

/// An insert produces `Add`s only for the subscriptions whose filters the
/// row satisfies; non-matching frames stay empty.
#[test]
fn insert_routes_to_matching_queries_only() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);

    let ops = ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));

    assert_eq!(
        names.impacted(&ops),
        vec!["q-all", "q-mine-active", "q-open"]
    );
    assert!(
        ops.iter()
            .all(|update| matches!(update.op, DataFrameOperation::Add(..)))
    );
    assert!(ops.iter().all(|update| update.table == "tickets"));
    assert_eq!(ivm.engine().rows_for(names.id("q-open")).unwrap().len(), 1);
    assert_eq!(ivm.engine().rows_for(names.id("q-hot")).unwrap().len(), 0);
}

/// A disjunct that only partially matches never fires: `status != 'DONE'`
/// (a conjunct of q-mine-active's single disjunct) matches the inserted row
/// and bumps the counter to 1 of 2, but the other conjunct
/// (`assigned_to = 'aniket'`) never matches — so q-mine-active is not
/// impacted, and increments outnumber fires in the stats.
#[test]
fn partial_disjunct_does_not_fire() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);

    let ops = ivm.incremental_update(&insert(
        &tickets,
        2,
        &[
            ("status", "TODO".into()),
            ("priority", "URGENT".into()),
            ("assigned_to", "vipul".into()),
            ("points", 9.into()),
        ],
    ));

    assert_eq!(names.impacted(&ops), vec!["q-all", "q-big", "q-hot"]);
    assert!(ivm.engine().stats().disjunct_increments > ivm.engine().stats().disjuncts_fired);
}

/// An update that stops a held row from matching emits `Delete` — carrying
/// the removed image — for the subscriptions it leaves; the row still
/// matching the unfiltered subscription (`q-all`) is replaced in place,
/// which reaches its client as the one `Add` with the new image.
#[test]
fn update_moves_row_out_with_delete() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);
    ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));

    let mut done_row = open_ticket_row();
    done_row[0] = ("status", "DONE".into());
    let ops = ivm.incremental_update(&update(&tickets, 1, &done_row));

    assert_eq!(
        names.impacted(&ops),
        vec!["q-all", "q-mine-active", "q-open"]
    );
    let ops_for = |uuid: &str| -> Vec<&DataFrameOperation> {
        ops.iter()
            .filter(|update| names.targets(update, uuid))
            .map(|update| &update.op)
            .collect()
    };
    let q_open = ops_for("q-open");
    let [DataFrameOperation::Delete(_, removed)] = q_open.as_slice() else {
        panic!("q-open expects exactly one Delete, got {q_open:?}");
    };
    assert_eq!(removed.data["status"], Value::String("OPEN".into()));
    assert!(matches!(
        ops_for("q-mine-active").as_slice(),
        [DataFrameOperation::Delete(..)]
    ));
    let q_all = ops_for("q-all");
    let [DataFrameOperation::Add(_, new)] = q_all.as_slice() else {
        panic!("q-all expects the one Add of an in-place change, got {q_all:?}");
    };
    assert_eq!(new.data["status"], Value::String("DONE".into()));

    assert_eq!(ivm.engine().rows_for(names.id("q-open")).unwrap().len(), 0);
    assert_eq!(ivm.engine().rows_for(names.id("q-all")).unwrap().len(), 1);
}

/// An update whose row keeps matching replaces the stored row's data in
/// the shared frame rather than duplicating or dropping it, and the row's
/// subscriber tags name exactly the subscriptions holding it.
#[test]
fn update_refreshes_row_in_place_with_new_data() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);
    ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));

    let mut renamed = open_ticket_row();
    renamed[3] = ("points", 4.into());
    ivm.incremental_update(&update(&tickets, 1, &renamed));

    let rows = ivm.engine().rows_for(names.id("q-open")).unwrap();
    let key = DataFrameKey::new(pkey(1));
    assert_eq!(rows[&key].data["points"], Value::Int(4));
    assert_eq!(
        names.names_of(&ivm.engine().holders_of(&TableName::from("tickets"), &key)),
        vec!["q-all", "q-mine-active", "q-open"]
    );
}

/// A delete emits `Delete` only to the subscriptions actually holding the
/// row; deleting an unknown row impacts nothing.
#[test]
fn delete_reaches_only_queries_holding_the_row() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);
    ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));

    let ops = ivm.incremental_update(&delete(&tickets, 1));

    assert_eq!(
        names.impacted(&ops),
        vec!["q-all", "q-mine-active", "q-open"]
    );
    assert!(
        ops.iter()
            .all(|update| matches!(update.op, DataFrameOperation::Delete(..)))
    );
    assert!(ivm.engine().rows_for(names.id("q-all")).unwrap().is_empty());

    let ops = ivm.incremental_update(&delete(&tickets, 99));
    assert!(ops.is_empty());
}

/// A `WHERE TRUE` subscription (empty AND) is impacted by every write on
/// its table, regardless of row contents.
#[test]
fn conditionless_query_sees_every_write_on_its_table() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);

    for id in 1..=3 {
        let ops = ivm.incremental_update(&insert(
            &tickets,
            id,
            &[("status", "WHATEVER".into()), ("points", id.into())],
        ));
        assert!(names.impacted(&ops).iter().any(|name| name == "q-all"));
    }
    assert_eq!(ivm.engine().rows_for(names.id("q-all")).unwrap().len(), 3);
}

/// `status = 'NOPE' OR TRUE` is always true, but its only leaf condition
/// does not match the inserted row, so the reverse index alone cannot find
/// the subscription — the vacuous-satisfiability path must route it.
#[test]
fn vacuously_true_filter_is_found_even_when_its_leaf_fails() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(
        &mut ivm,
        "q-weird",
        query(
            &tickets,
            Where::OR(vec![
                Where::condition("status", ComparisonOperator::EQ, "NOPE"),
                Where::AND(vec![]),
            ]),
        ),
    );

    let ops = ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));
    assert_eq!(names.impacted(&ops), vec!["q-weird"]);
}

/// Routing is table-scoped: a `tickets` write, even one whose row matches
/// the calls subscription's condition textually, must not reach the
/// subscription registered on `calls`.
#[test]
fn writes_on_other_tables_are_isolated() {
    let tickets = table("tickets");
    let calls = table("calls");
    let (mut ivm, names) = standard_ivm(&tickets);
    names.register(
        &mut ivm,
        "q-calls-active",
        query(
            &calls,
            Where::condition("status", ComparisonOperator::EQ, "ACTIVE"),
        ),
    );

    let ops = ivm.incremental_update(&insert(&calls, 1, &[("status", "ACTIVE".into())]));
    assert_eq!(names.impacted(&ops), vec!["q-calls-active"]);

    let ops = ivm.incremental_update(&insert(&tickets, 1, &[("status", "ACTIVE".into())]));
    assert!(
        !names
            .impacted(&ops)
            .iter()
            .any(|name| name == "q-calls-active")
    );
}

/// The read-only probe and the mutating path agree: `search_impacted_queries`
/// returns exactly the uuids that `incremental_update` then emits ops for.
#[test]
fn search_impacted_queries_matches_incremental_update_routing() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);

    let write = insert(&tickets, 1, &open_ticket_row());
    let found = ivm.engine_mut().search_impacted_queries(&write);
    let ops = ivm.incremental_update(&write);

    assert_eq!(names.names_of(&found), names.impacted(&ops));
}

/// Subscriptions sharing an identical disjunct shape share one counter, so
/// both are routed by a single condition evaluation — one probe, full
/// fan-out — and the row later moves out of both subscriptions
/// consistently.
#[test]
fn duplicate_condition_routes_to_every_subscriber() {
    let tickets = table("tickets");
    let (mut ivm, names) = standard_ivm(&tickets);
    names.register(
        &mut ivm,
        "q-open-dup",
        query(
            &tickets,
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        ),
    );

    let ops = ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));
    let found = names.impacted(&ops);
    assert!(found.iter().any(|name| name == "q-open"));
    assert!(found.iter().any(|name| name == "q-open-dup"));

    let mut done_row = open_ticket_row();
    done_row[0] = ("status", "DONE".into());
    let ops = ivm.incremental_update(&update(&tickets, 1, &done_row));
    let found = names.impacted(&ops);
    assert!(found.iter().any(|name| name == "q-open"));
    assert!(found.iter().any(|name| name == "q-open-dup"));
}

/// A filter with OR across ANDs routes through whichever disjunct matches.
/// Filter: `(status = 'OPEN' AND priority = 'LOW') OR points >= 8`. Row 1:
/// the second disjunct fires (points) while the first stays partial (wrong
/// priority). Row 2: the first disjunct fires, the second does not. Row 3:
/// neither fires.
#[test]
fn or_of_ands_routes_by_either_disjunct() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(
        &mut ivm,
        "q-either",
        query(
            &tickets,
            Where::OR(vec![
                Where::AND(vec![
                    Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                    Where::condition("priority", ComparisonOperator::EQ, "LOW"),
                ]),
                Where::condition("points", ComparisonOperator::GTE, 8),
            ]),
        ),
    );

    let ops = ivm.incremental_update(&insert(
        &tickets,
        1,
        &[
            ("status", "OPEN".into()),
            ("priority", "HIGH".into()),
            ("points", 9.into()),
        ],
    ));
    assert_eq!(names.impacted(&ops), vec!["q-either"]);

    let ops = ivm.incremental_update(&insert(
        &tickets,
        2,
        &[
            ("status", "OPEN".into()),
            ("priority", "LOW".into()),
            ("points", 1.into()),
        ],
    ));
    assert_eq!(names.impacted(&ops), vec!["q-either"]);

    let ops = ivm.incremental_update(&insert(
        &tickets,
        3,
        &[
            ("status", "DONE".into()),
            ("priority", "LOW".into()),
            ("points", 1.into()),
        ],
    ));
    assert!(ops.is_empty());
}

/// `WHERE FALSE` normalizes to zero disjuncts: nothing to fire, ever.
#[test]
fn where_false_never_matches() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(&mut ivm, "q-never", query(&tickets, Where::OR(vec![])));

    let ops = ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));
    assert!(ops.is_empty());
    assert!(
        ivm.engine()
            .rows_for(names.id("q-never"))
            .unwrap()
            .is_empty()
    );
}

/// A subscription whose query changes is unregistered and registered anew
/// (ids are engine-issued, so a changed query is a new subscription); the
/// old routing must go entirely — a stale condition link would corrupt the
/// new query's disjunct counters, since firing is exact counting. Swapping
/// the status filter for a points filter starts from an empty frame, the
/// old condition no longer routes here, and the new one does; the final
/// unregister removes the subscription entirely.
#[test]
fn reregistration_replaces_routing_and_unregister_removes_it() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(
        &mut ivm,
        "q",
        query(
            &tickets,
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        ),
    );
    ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));
    assert_eq!(ivm.engine().rows_for(names.id("q")).unwrap().len(), 1);

    ivm.unregister_query(names.id("q"));
    names.register(
        &mut ivm,
        "q",
        query(
            &tickets,
            Where::condition("points", ComparisonOperator::GTE, 8),
        ),
    );
    assert!(ivm.engine().rows_for(names.id("q")).unwrap().is_empty());

    let ops = ivm.incremental_update(&insert(&tickets, 2, &open_ticket_row()));
    assert!(ops.is_empty(), "an OPEN low-points row no longer matches");

    let mut big = open_ticket_row();
    big[3] = ("points", 9.into());
    let ops = ivm.incremental_update(&insert(&tickets, 3, &big));
    assert_eq!(names.impacted(&ops), vec!["q"]);

    ivm.unregister_query(names.id("q"));
    assert!(ivm.engine().rows_for(names.id("q")).is_none());
    let ops = ivm.incremental_update(&insert(&tickets, 4, &big));
    assert!(ops.is_empty());
}

/// Interleaved writes across tables keep their counting state fully
/// independent — the invariant that will make table-sharded parallelism
/// safe: two tables carrying the textually identical two-condition filter
/// get separate counters, a partial bump left behind on one table must not
/// leak into the other, and the stale count must be discarded (not resumed)
/// when its own table is written again with the other half of the filter.
#[test]
fn interleaved_writes_across_tables_keep_counters_independent() {
    let tickets = table("tickets");
    let calls = table("calls");
    let filter = || {
        Where::AND(vec![
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
            Where::condition("points", ComparisonOperator::GTE, 5),
        ])
    };
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(&mut ivm, "q-tickets", query(&tickets, filter()));
    names.register(&mut ivm, "q-calls", query(&calls, filter()));

    let ops = ivm.incremental_update(&insert(
        &tickets,
        1,
        &[("status", "OPEN".into()), ("points", 1.into())],
    ));
    assert!(ops.is_empty(), "tickets counter stays partial at 1 of 2");

    let ops = ivm.incremental_update(&insert(
        &calls,
        1,
        &[("status", "OPEN".into()), ("points", 9.into())],
    ));
    assert_eq!(names.impacted(&ops), vec!["q-calls"]);

    let ops = ivm.incremental_update(&insert(
        &tickets,
        2,
        &[("status", "DONE".into()), ("points", 9.into())],
    ));
    assert!(
        ops.is_empty(),
        "the stale 1-of-2 from write one must not combine with this write's other half"
    );

    let ops = ivm.incremental_update(&insert(
        &tickets,
        3,
        &[("status", "OPEN".into()), ("points", 9.into())],
    ));
    assert_eq!(names.impacted(&ops), vec!["q-tickets"]);
}

/// Two subscriptions with the same filter share one disjunct counter;
/// unregistering one must leave the counter firing for the survivor, and
/// unregistering the survivor must silence it entirely.
#[test]
fn shared_counter_survives_partial_unregistration() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    let filter = Where::condition("status", ComparisonOperator::EQ, "OPEN");
    names.register(&mut ivm, "q-a", query(&tickets, filter.clone()));
    names.register(&mut ivm, "q-b", query(&tickets, filter));

    let ops = ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));
    assert_eq!(names.impacted(&ops), vec!["q-a", "q-b"]);

    ivm.unregister_query(names.id("q-a"));
    let ops = ivm.incremental_update(&insert(&tickets, 2, &open_ticket_row()));
    assert_eq!(names.impacted(&ops), vec!["q-b"]);

    ivm.unregister_query(names.id("q-b"));
    let ops = ivm.incremental_update(&insert(&tickets, 3, &open_ticket_row()));
    assert!(ops.is_empty());
}

/// The DNF counting result must agree with plain tree evaluation of the
/// filter — `evaluate` is the semantic oracle. Each row is inserted under a
/// fresh pkey to keep membership out of the picture: impacted must equal
/// exactly the filters the row image satisfies.
#[test]
fn counting_agrees_with_tree_evaluation() {
    use ComparisonOperator::*;
    use streamgres::ivm::evaluate;

    let tickets = table("tickets");
    let filters: Vec<Where> = vec![
        Where::condition("status", EQ, "OPEN"),
        Where::AND(vec![
            Where::condition("status", EQ, "OPEN"),
            Where::condition("points", GTE, 5),
        ]),
        Where::OR(vec![
            Where::condition("status", EQ, "OPEN"),
            Where::condition("points", GTE, 5),
        ]),
        Where::AND(vec![
            Where::OR(vec![
                Where::condition("status", EQ, "OPEN"),
                Where::condition("status", EQ, "TODO"),
            ]),
            Where::OR(vec![
                Where::condition("priority", EQ, "HIGH"),
                Where::condition("points", GTE, 5),
            ]),
        ]),
        Where::AND(vec![]),
        Where::OR(vec![]),
        Where::OR(vec![
            Where::condition("status", EQ, "NOPE"),
            Where::AND(vec![]),
        ]),
        Where::AND(vec![
            Where::condition("status", NEQ, "DONE"),
            Where::condition("priority", NOT_IN, Value::List(vec!["LOW".into()])),
        ]),
        Where::AND(vec![
            Where::condition("status", EQ, "OPEN"),
            Where::condition("status", EQ, "OPEN"),
        ]),
    ];
    let rows: Vec<Vec<(&str, Value)>> = vec![
        vec![
            ("status", "OPEN".into()),
            ("priority", "LOW".into()),
            ("points", 3.into()),
        ],
        vec![
            ("status", "OPEN".into()),
            ("priority", "HIGH".into()),
            ("points", 9.into()),
        ],
        vec![
            ("status", "TODO".into()),
            ("priority", "MEDIUM".into()),
            ("points", 5.into()),
        ],
        vec![
            ("status", "DONE".into()),
            ("priority", "LOW".into()),
            ("points", 9.into()),
        ],
        vec![("status", "NOPE".into()), ("points", 1.into())],
    ];

    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    for (index, filter) in filters.iter().enumerate() {
        names.register(
            &mut ivm,
            format!("q{index:02}"),
            query(&tickets, filter.clone()),
        );
    }

    for (row_index, pairs) in rows.iter().enumerate() {
        let write = insert(&tickets, row_index as i64, pairs);
        let image = write.new_row_image().expect("inserts carry a row image");
        let expected: Vec<String> = filters
            .iter()
            .enumerate()
            .filter(|(_, filter)| evaluate(filter, &image.data, &mut 0))
            .map(|(index, _)| format!("q{index:02}"))
            .collect();
        let ops = ivm.incremental_update(&write);
        let got: Vec<String> = names.impacted(&ops);
        assert_eq!(got, expected, "row {row_index}: {pairs:?}");
    }
}

/// Identical queries under different uuids share the stored rows but keep
/// independently tagged views — same contents, separate subscriptions,
/// each receiving its own operations.
#[test]
fn identical_queries_maintain_independent_frames() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    let filter = Where::condition("status", ComparisonOperator::EQ, "OPEN");
    let snapshot = names.register(&mut ivm, "q-a", query(&tickets, filter.clone()));
    assert!(snapshot.is_empty());
    names.register(&mut ivm, "q-b", query(&tickets, filter));

    let ops = ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));
    assert_eq!(names.impacted(&ops), vec!["q-a", "q-b"]);

    assert_eq!(
        ivm.engine().rows_for(names.id("q-a")),
        ivm.engine().rows_for(names.id("q-b"))
    );
    assert_eq!(ivm.engine().rows_for(names.id("q-a")).unwrap().len(), 1);
}

/// A subscription registered late with a query structurally identical to
/// an existing one is served from the shared frame: the twin's current
/// rows come back as its snapshot `Add`s — storage is a stub here, so the
/// rows can only have come from the frame — and from then on both twins
/// route together.
#[test]
fn late_identical_registration_inherits_the_twins_rows() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(&mut ivm, "early", query(&tickets, Where::AND(vec![])));
    for id in 1..=3 {
        ivm.incremental_update(&insert(&tickets, id, &open_ticket_row()));
    }

    let snapshot = names.register(&mut ivm, "late", query(&tickets, Where::AND(vec![])));
    assert_eq!(snapshot.len(), 3, "the twin's three rows arrive as Adds");
    assert!(
        snapshot
            .iter()
            .all(|op| matches!(op, DataFrameOperation::Add(..)))
    );
    assert_eq!(
        ivm.engine().rows_for(names.id("late")),
        ivm.engine().rows_for(names.id("early"))
    );
    assert_eq!(ivm.engine().stats().snapshots_shared, 1);

    let ops = ivm.incremental_update(&delete(&tickets, 1));
    assert_eq!(names.impacted(&ops), vec!["early", "late"]);
    assert_eq!(ivm.engine().rows_for(names.id("early")).unwrap().len(), 2);
    assert_eq!(ivm.engine().rows_for(names.id("late")).unwrap().len(), 2);
}

/// ORDER BY + LIMIT: the client receives exactly the requested rows while
/// the engine buffers twice as many. An arrival better than the storage
/// frontier enters the buffer (evicting the worst past capacity) and ships
/// only if it enters the page; a held row that worsens in place keeps its
/// buffer slot but leaves the page; removals drain the buffer to the limit
/// before a storage refill; and a buffered row surfaces without one.
#[test]
fn limit_window_admits_evicts_and_refills() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    for (id, points) in [(1, 10), (2, 20), (3, 30), (4, 40), (5, 50), (6, 60)] {
        storage.apply(&insert(&tickets, id, &[("points", points.into())]));
    }
    let windowed = SingleTableReadQuery::new(
        tickets.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        2,
    );
    let snapshot = names.register(&mut ivm, "w", windowed);
    assert_eq!(
        snapshot.len(),
        2,
        "the client receives the limit, not the buffer"
    );

    let admit = insert(&tickets, 7, &[("points", 5.into())]);
    storage.apply(&admit);
    let ops = ivm.incremental_update(&admit);
    assert_eq!(
        ops.len(),
        2,
        "5 enters the page and 20 leaves it, got {ops:?}"
    );
    assert!(
        matches!(&ops[0].op, DataFrameOperation::Delete(key, _) if key.pkey_value["id"] == Value::Int(2))
    );
    assert!(
        matches!(&ops[1].op, DataFrameOperation::Add(key, _) if key.pkey_value["id"] == Value::Int(7))
    );
    assert_eq!(
        ivm.engine().stats().window_evictions,
        1,
        "40 left the buffer without the client hearing of it"
    );

    let reject = insert(&tickets, 8, &[("points", 100.into())]);
    storage.apply(&reject);
    assert!(
        ivm.incremental_update(&reject).is_empty(),
        "worse than the boundary — the admission guard rejects it"
    );

    for id in [7, 1] {
        let removal = delete(&tickets, id);
        storage.apply(&removal);
        ivm.incremental_update(&removal);
    }
    assert_eq!(ivm.engine().rows_for(names.id("w")).unwrap().len(), 2);
    assert!(
        ivm.engine().stats().window_refills >= 1,
        "draining to the limit refilled the buffer from storage"
    );

    let worsen = update(&tickets, 2, &[("points", 999.into())]);
    storage.apply(&worsen);
    let ops = ivm.incremental_update(&worsen);
    assert_eq!(names.impacted(&ops), vec!["w"]);
    assert_eq!(
        ops.len(),
        2,
        "the worsened row leaves the page and the buffered 40 takes its place, got {ops:?}"
    );
    assert!(
        matches!(&ops[0].op, DataFrameOperation::Delete(key, _) if key.pkey_value["id"] == Value::Int(2))
    );
    assert!(
        matches!(&ops[1].op, DataFrameOperation::Add(key, _) if key.pkey_value["id"] == Value::Int(4))
    );

    let better = insert(&tickets, 9, &[("points", 45.into())]);
    storage.apply(&better);
    let ops = ivm.incremental_update(&better);
    assert!(
        ops.is_empty(),
        "45 is buffered behind the page of 30, 40, got {ops:?}"
    );
    assert_eq!(
        ivm.engine().stats().window_evictions,
        2,
        "the worsened row is the one a better arrival evicts"
    );

    let refills = ivm.engine().stats().window_refills;
    let removal = delete(&tickets, 3);
    storage.apply(&removal);
    let ops = ivm.incremental_update(&removal);
    assert!(
        matches!(&ops[1].op, DataFrameOperation::Add(key, _) if key.pkey_value["id"] == Value::Int(9)),
        "the buffered 45 surfaces without a refill, got {ops:?}"
    );
    assert_eq!(ivm.engine().stats().window_refills, refills);
}

/// `replace_query` leaves the filter ahead of the held rows until the
/// caller's fetch lands. A twin registering meanwhile is served what the
/// subscription holds so far and joins the read, which lands into both.
#[test]
fn replaced_query_shares_its_fetch_with_a_twin() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    let narrow = query(
        &tickets,
        Where::condition(
            "points",
            ComparisonOperator::IN,
            Value::List(vec![Value::Int(10)]),
        ),
    );
    let wide = query(
        &tickets,
        Where::condition(
            "points",
            ComparisonOperator::IN,
            Value::List(vec![Value::Int(10), Value::Int(20)]),
        ),
    );
    storage.apply(&insert(&tickets, 1, &[("points", 10.into())]));
    storage.apply(&insert(&tickets, 2, &[("points", 20.into())]));
    let snapshot = names.register(&mut ivm, "s", narrow);
    assert_eq!(snapshot.len(), 1);

    ivm.engine_mut().replace_query(names.id("s"), wide.clone());
    ivm.engine_mut()
        .fetch(names.id("s"), "points", &[Value::Int(20)]);
    let reads = ivm.engine().stats().storage_reads;
    names.register(&mut ivm, "t", wide);
    assert_eq!(
        ivm.engine().stats().snapshots_shared,
        1,
        "served from `s` though its read is out"
    );
    assert_eq!(
        ivm.engine().stats().storage_reads,
        reads,
        "no read of its own: it joined `s`'s"
    );
    assert_eq!(ivm.engine().rows_for(names.id("s")).unwrap().len(), 2);
    assert_eq!(
        ivm.engine().rows_for(names.id("t")).unwrap().len(),
        2,
        "the fetch landed into both"
    );
}

/// `replace_condition` behaves the same: the edit itself re-registers
/// nothing (only `conditions_replaced` moves); the caller prunes what
/// narrowed out and fetches what widened in, in the same call; a twin
/// registering while that fetch is out shares it, and both route on the
/// edited leaf.
#[test]
fn replaced_condition_shares_its_fetch_with_a_twin() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    let in_points = |points: i64| {
        Condition::new(
            "points",
            ComparisonOperator::IN,
            Value::List(vec![Value::Int(points)]),
        )
    };
    let with = |points: i64| query(&tickets, Where::Condition(in_points(points)));
    storage.apply(&insert(&tickets, 1, &[("points", 10.into())]));
    storage.apply(&insert(&tickets, 2, &[("points", 20.into())]));
    let snapshot = names.register(&mut ivm, "a", with(10));
    assert_eq!(snapshot.len(), 1);

    let before = ivm.engine().stats().clone();
    ivm.engine_mut()
        .replace_condition(names.id("a"), &in_points(10), in_points(20));
    let after = ivm.engine().stats();
    assert_eq!(after.disjuncts_registered, before.disjuncts_registered);
    assert_eq!(after.conditions_indexed, before.conditions_indexed);
    assert!(after.conditions_replaced > before.conditions_replaced);
    ivm.engine_mut()
        .delete_rows(names.id("a"), "points", &[Value::Int(10)]);
    ivm.engine_mut()
        .fetch(names.id("a"), "points", &[Value::Int(20)]);

    let reads = ivm.engine().stats().storage_reads;
    names.register(&mut ivm, "b", with(20));
    assert_eq!(ivm.engine().stats().snapshots_shared, 1);
    assert_eq!(ivm.engine().stats().storage_reads, reads);
    let held = ivm.engine().rows_for(names.id("b")).unwrap();
    assert_eq!(held.len(), 1, "the landed row and nothing pruned");
    assert!(held.contains_key(&DataFrameKey::new(pkey(2))));
    assert_eq!(ivm.engine().rows_for(names.id("a")).unwrap().len(), 1);

    let admitted = insert(&tickets, 3, &[("points", 20.into())]);
    storage.apply(&admitted);
    assert_eq!(
        names.impacted(&ivm.incremental_update(&admitted)),
        vec!["a", "b"],
        "the edited IN condition routes new writes"
    );
    let ignored = insert(&tickets, 4, &[("points", 10.into())]);
    storage.apply(&ignored);
    assert!(ivm.incremental_update(&ignored).is_empty());
}

/// A read serves the query, not the subscription: identical registrations
/// arriving while the first one's snapshot read is out issue nothing and
/// wait on that read, which lands into all of them — each with its own
/// window and page — so a burst of identical registrations costs one
/// storage read.
#[test]
fn identical_registrations_share_the_read_that_is_out() {
    let tickets = table("tickets");
    let mut engine = SingleTableIVM::new();
    let windowed = SingleTableReadQuery::new(
        tickets.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        2,
    );
    let (a, first) = engine.register_query(windowed.clone());
    assert!(first.is_empty(), "nothing has landed yet");
    let (b, second) = engine.register_query(windowed);
    assert!(
        second.is_empty(),
        "served from `a`, which holds nothing yet"
    );
    assert_eq!(engine.stats().snapshots_shared, 1);
    assert!(engine.is_pending(a) && engine.is_pending(b));
    let requests = engine.take_requests();
    assert_eq!(requests.len(), 1, "one read for the two registrations");

    let rows: Vec<(DataFrameKey, DataFrameRow)> = [(1, 10), (2, 20), (3, 30), (4, 40)]
        .iter()
        .map(|&(id, points)| {
            let write = insert(&tickets, id, &[("points", points.into())]);
            (
                write.pkey_value().clone(),
                write.new_row_image().unwrap().clone(),
            )
        })
        .collect();
    let landed = engine.land_fetch(&requests[0], &rows);
    let page = |sub: SubId| landed.iter().filter(|update| update.query == sub).count();
    assert_eq!(page(a), 2, "the page of two for `a`, got {landed:?}");
    assert_eq!(page(b), 2, "and for `b`");
    assert!(!engine.is_pending(a) && !engine.is_pending(b));
    assert_eq!(engine.rows_for(a), engine.rows_for(b));
    assert!(engine.take_requests().is_empty(), "no read left to run");
}

/// A `LIMIT 0` subscription is permanently empty: an empty registration
/// snapshot, and later matching writes never admit.
#[test]
fn limit_zero_subscription_stays_empty() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    storage.apply(&insert(&tickets, 1, &[("points", 10.into())]));
    let zero = SingleTableReadQuery::new(
        tickets.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        0,
    );
    assert!(names.register(&mut ivm, "z", zero).is_empty());

    let w = insert(&tickets, 2, &[("points", 20.into())]);
    storage.apply(&w);
    assert!(ivm.incremental_update(&w).is_empty());
    assert!(ivm.engine().rows_for(names.id("z")).unwrap().is_empty());
}

/// A DESC window mirrors the ASC behaviors: the page shows the largest
/// rows, admission requires strictly beating the smallest buffered value,
/// eviction drops the smallest, and refills walk downward.
#[test]
fn desc_window_admits_evicts_and_refills() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    for (id, points) in [(1, 10), (2, 20), (3, 30), (4, 40), (5, 50), (6, 60)] {
        storage.apply(&insert(&tickets, id, &[("points", points.into())]));
    }
    let windowed = SingleTableReadQuery::new(
        tickets.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::DESC),
        2,
    );
    let snapshot = names.register(&mut ivm, "w", windowed);
    assert_eq!(snapshot.len(), 2);
    let held = |ivm: &Ivm| -> Vec<Value> {
        let mut held: Vec<Value> = ivm
            .engine()
            .rows_for(names.id("w"))
            .unwrap()
            .values()
            .map(|row| row.data["points"].clone())
            .collect();
        held.sort_by_key(|value| match value {
            Value::Int(i) => *i,
            _ => 0,
        });
        held
    };
    assert_eq!(
        held(&ivm),
        vec![Value::Int(50), Value::Int(60)],
        "DESC shows the two LARGEST"
    );

    let admit = insert(&tickets, 7, &[("points", 100.into())]);
    storage.apply(&admit);
    let ops = ivm.incremental_update(&admit);
    assert_eq!(
        ops.len(),
        2,
        "100 enters the page and 50 leaves it (30 leaves the buffer), got {ops:?}"
    );
    assert!(
        matches!(&ops[0].op, DataFrameOperation::Delete(key, _) if key.pkey_value["id"] == Value::Int(5))
    );
    assert!(
        matches!(&ops[1].op, DataFrameOperation::Add(key, _) if key.pkey_value["id"] == Value::Int(7))
    );
    assert_eq!(ivm.engine().stats().window_evictions, 1);

    let reject = insert(&tickets, 8, &[("points", 5.into())]);
    storage.apply(&reject);
    assert!(ivm.incremental_update(&reject).is_empty());

    for id in [7, 6] {
        let removal = delete(&tickets, id);
        storage.apply(&removal);
        ivm.incremental_update(&removal);
    }
    assert_eq!(
        held(&ivm),
        vec![Value::Int(40), Value::Int(50)],
        "drained to the limit — refilled downward from storage; the page is exact"
    );
    assert!(ivm.engine().stats().window_refills >= 1);
}

/// A fetch into a windowed subscription maintains the window: fetched
/// rows enter the buffer and overflow evicts the worst, while the client
/// sees only the page's change.
#[test]
fn fetch_respects_the_window() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    for (id, points) in [(1, 10), (2, 20), (3, 30), (4, 40)] {
        storage.apply(&insert(&tickets, id, &[("points", points.into())]));
    }
    let windowed = SingleTableReadQuery::new(
        tickets.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        2,
    );
    assert_eq!(names.register(&mut ivm, "w", windowed).len(), 2);
    storage.apply(&insert(&tickets, 5, &[("points", 1.into())]));

    ivm.engine_mut()
        .fetch(names.id("w"), "points", &[Value::Int(1)]);
    let ops: Vec<DataFrameOperation> = ivm.pump().into_iter().map(|update| update.op).collect();
    assert_eq!(
        ops.len(),
        2,
        "the fetched 1 enters the page and 20 leaves it, got {ops:?}"
    );
    assert!(
        matches!(&ops[0], DataFrameOperation::Delete(key, _) if key.pkey_value["id"] == Value::Int(2))
    );
    assert!(
        matches!(&ops[1], DataFrameOperation::Add(key, _) if key.pkey_value["id"] == Value::Int(5))
    );
    assert_eq!(ivm.engine().rows_for(names.id("w")).unwrap().len(), 2);
    assert_eq!(
        ivm.engine().stats().window_evictions,
        1,
        "40 overflowed the buffer"
    );
}

/// The identical-query snapshot happens WITHOUT a storage round-trip: a
/// row committed to storage but not yet routed through the engine is
/// invisible to a twin's snapshot, while a registration with no twin
/// still reads storage and sees it.
#[test]
fn identical_registration_skips_storage() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    let open = Where::condition("status", ComparisonOperator::EQ, "OPEN");
    names.register(&mut ivm, "q-a", query(&tickets, open.clone()));

    let routed = insert(&tickets, 1, &open_ticket_row());
    storage.apply(&routed);
    ivm.incremental_update(&routed);
    storage.apply(&insert(&tickets, 2, &open_ticket_row()));

    let snapshot = names.register(&mut ivm, "q-b", query(&tickets, open));
    assert_eq!(snapshot.len(), 1, "served from q-a's rows, not storage");
    assert_eq!(snapshot[0].key(), &DataFrameKey::new(pkey(1)));

    let snapshot = names.register(&mut ivm, "q-c", query(&tickets, Where::AND(vec![])));
    assert_eq!(snapshot.len(), 2, "no twin — storage is consulted");
}

/// Regression (review): the admission boundary is anchored at the storage
/// frontier, not at the worst held row. After a delete leaves the buffer
/// below capacity, an arrival beyond the frontier is still rejected (the
/// rows still in storage are better) while one inside it is buffered for
/// both twins, out of sight until a page drains to it, and the refill that
/// follows a drain fetches from the frontier so the page stays exact.
#[test]
fn window_boundary_survives_a_deletion() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    for id in 1..=8 {
        storage.apply(&insert(&tickets, id, &[("points", (id * 10).into())]));
    }
    let windowed = SingleTableReadQuery::new(
        tickets.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        2,
    );
    assert_eq!(names.register(&mut ivm, "w", windowed.clone()).len(), 2);
    assert_eq!(names.register(&mut ivm, "twin", windowed).len(), 2);

    let removal = delete(&tickets, 1);
    storage.apply(&removal);
    ivm.incremental_update(&removal);
    assert_eq!(ivm.engine().rows_for(names.id("w")).unwrap().len(), 2);
    assert_eq!(
        ivm.engine().stats().window_refills,
        0,
        "below capacity, above the limit: no refill"
    );

    let beyond = insert(&tickets, 9, &[("points", 1000.into())]);
    storage.apply(&beyond);
    assert!(
        ivm.incremental_update(&beyond).is_empty(),
        "beyond the frontier (40): rejected for both subscriptions even with room in the buffer"
    );

    let within = insert(&tickets, 10, &[("points", 35.into())]);
    storage.apply(&within);
    let ops = ivm.incremental_update(&within);
    assert!(
        ops.is_empty(),
        "inside the frontier: buffered, behind the page of 20, 30, got {ops:?}"
    );

    let removal = delete(&tickets, 2);
    storage.apply(&removal);
    let ops = ivm.incremental_update(&removal);
    assert_eq!(names.impacted(&ops), vec!["twin", "w"]);
    assert!(
        ops.iter().any(|update| matches!(
            &update.op,
            DataFrameOperation::Add(key, _) if key.pkey_value["id"] == Value::Int(10)
        )),
        "the buffered 35 takes the vacated slot on both pages, got {ops:?}"
    );
    assert_eq!(
        ivm.engine().stats().window_refills,
        0,
        "served from the buffer"
    );

    let removal = delete(&tickets, 3);
    storage.apply(&removal);
    ivm.incremental_update(&removal);
    let mut held: Vec<i64> = ivm
        .engine()
        .rows_for(names.id("w"))
        .unwrap()
        .values()
        .map(|row| match row.data["points"] {
            Value::Int(points) => points,
            _ => unreachable!(),
        })
        .collect();
    held.sort_unstable();
    assert_eq!(
        held,
        vec![35, 40],
        "the refill walked storage from the frontier; the page is exact"
    );
    assert!(ivm.engine().stats().window_refills >= 1);
}

/// Regression (review): rows tying the frontier are reachable. With four
/// rows sharing the boundary value and two of them buffered, refills fetch
/// from the frontier inclusive and dedup the held ties, so the page never
/// shows a strictly worse row while a tied one sits in storage; once
/// storage is exhausted there is no boundary and arrivals are buffered.
#[test]
fn window_refill_reaches_rows_tying_the_frontier() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    for (id, points) in [(1, 1), (2, 2), (3, 3), (4, 3), (5, 3), (6, 3), (7, 5)] {
        storage.apply(&insert(&tickets, id, &[("points", points.into())]));
    }
    let windowed = SingleTableReadQuery::new(
        tickets.name.clone(),
        Where::AND(vec![]),
        OrderBy::new("points", Order::ASC),
        2,
    );
    assert_eq!(names.register(&mut ivm, "w", windowed).len(), 2);

    for id in [1, 2] {
        let removal = delete(&tickets, id);
        storage.apply(&removal);
        ivm.incremental_update(&removal);
    }
    let points_of = |ivm: &Ivm| -> Vec<i64> {
        let mut held: Vec<i64> = ivm
            .engine()
            .rows_for(names.id("w"))
            .unwrap()
            .values()
            .map(|row| match row.data["points"] {
                Value::Int(points) => points,
                _ => unreachable!(),
            })
            .collect();
        held.sort_unstable();
        held
    };
    assert_eq!(
        points_of(&ivm),
        vec![3, 3],
        "the refill fetched the unheld ties, not the 5"
    );

    let shown_ids = |ivm: &Ivm| -> Vec<i64> {
        ivm.engine()
            .rows_for(names.id("w"))
            .unwrap()
            .keys()
            .map(|key| match key.pkey_value["id"] {
                Value::Int(id) => id,
                _ => unreachable!(),
            })
            .collect()
    };
    for id in shown_ids(&ivm) {
        let removal = delete(&tickets, id);
        storage.apply(&removal);
        ivm.incremental_update(&removal);
    }
    assert_eq!(
        points_of(&ivm),
        vec![3, 3],
        "the two remaining ties come out of the buffer and the refill, ahead of the 5"
    );

    let arrival = insert(&tickets, 8, &[("points", 4.into())]);
    storage.apply(&arrival);
    assert!(
        ivm.incremental_update(&arrival).is_empty(),
        "storage exhausted, so no boundary: the 4 is buffered behind the ties"
    );
    let removal = delete(&tickets, shown_ids(&ivm)[0]);
    storage.apply(&removal);
    let ops = ivm.incremental_update(&removal);
    assert!(
        ops.iter().any(|update| matches!(
            &update.op,
            DataFrameOperation::Add(key, _) if key.pkey_value["id"] == Value::Int(8)
        )),
        "the buffered 4 surfaces ahead of the 5, got {ops:?}"
    );
    assert_eq!(points_of(&ivm), vec![3, 4]);
}

/// Disjunct identity is canonical: the same conditions in a different
/// order, whether written that way or reached by an in-place edit, map to
/// one shared counter rather than a duplicate.
#[test]
fn disjuncts_are_canonical_regardless_of_condition_order() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    let open = Where::condition("status", ComparisonOperator::EQ, "OPEN");
    let mine = Where::condition(
        "assigned_to",
        ComparisonOperator::IN,
        Value::List(vec!["a".into()]),
    );
    names.register(
        &mut ivm,
        "ab",
        query(&tickets, Where::AND(vec![open.clone(), mine.clone()])),
    );
    let links = ivm.engine().stats().conditions_indexed;
    assert_eq!(links, 2, "two conditions linked to one counter");

    names.register(
        &mut ivm,
        "ba",
        query(&tickets, Where::AND(vec![mine.clone(), open.clone()])),
    );
    assert_eq!(
        ivm.engine().stats().conditions_indexed,
        links,
        "the reversed filter shares the counter: no new links"
    );

    let widened = Condition::new(
        "assigned_to",
        ComparisonOperator::IN,
        Value::List(vec!["a".into(), "b".into()]),
    );
    let Where::Condition(narrow) = mine.clone() else {
        unreachable!()
    };
    ivm.engine_mut()
        .replace_condition(names.id("ab"), &narrow, widened.clone());
    let links_after_edit = ivm.engine().stats().conditions_indexed;
    names.register(
        &mut ivm,
        "fresh",
        query(
            &tickets,
            Where::AND(vec![Where::Condition(widened), open.clone()]),
        ),
    );
    assert_eq!(
        ivm.engine().stats().conditions_indexed,
        links_after_edit,
        "a fresh registration of the edited shape shares the edited counter"
    );
}

/// The column index reaches every operator family with the predicate
/// semantics of tree evaluation: equality with numeric coercion, `IN`,
/// the negated forms (a `NOT IN` holding `NULL` never matches), each range
/// operator at and around its threshold, and `NULL`, `NaN` and mixed-type
/// writes.
#[test]
fn column_index_matches_every_operator_family() {
    use ComparisonOperator::*;
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    let subscriptions: Vec<(&str, Where)> = vec![
        ("eq", Where::condition("points", EQ, 5)),
        ("eq-float", Where::condition("points", EQ, 5.0)),
        (
            "in",
            Where::condition("points", IN, Value::List(vec![1.into(), 2.into()])),
        ),
        ("neq", Where::condition("points", NEQ, 5)),
        (
            "not-in",
            Where::condition("points", NOT_IN, Value::List(vec![1.into(), 2.into()])),
        ),
        (
            "not-in-null",
            Where::condition("points", NOT_IN, Value::List(vec![1.into(), Value::Null])),
        ),
        ("gt", Where::condition("points", GT, 5)),
        ("gte", Where::condition("points", GTE, 5)),
        ("lt", Where::condition("points", LT, 5)),
        ("lte", Where::condition("points", LTE, 5)),
        ("str", Where::condition("points", EQ, "5")),
    ];
    for (uuid, filter) in &subscriptions {
        names.register(&mut ivm, *uuid, query(&tickets, filter.clone()));
    }
    let cases: Vec<(Value, Vec<&str>)> = vec![
        (5.into(), vec!["eq", "eq-float", "gte", "lte", "not-in"]),
        (
            Value::Float(5.0),
            vec!["eq", "eq-float", "gte", "lte", "not-in"],
        ),
        (4.into(), vec!["lt", "lte", "neq", "not-in"]),
        (6.into(), vec!["gt", "gte", "neq", "not-in"]),
        (1.into(), vec!["in", "lt", "lte", "neq"]),
        (Value::String("5".into()), vec!["neq", "not-in", "str"]),
        (Value::Null, vec![]),
        (Value::Float(f64::NAN), vec!["neq", "not-in"]),
    ];
    for (id, (value, expected)) in cases.into_iter().enumerate() {
        let write = insert(&tickets, id as i64 + 1, &[("points", value.clone())]);
        let ops = ivm.incremental_update(&write);
        assert_eq!(names.impacted(&ops), expected, "points = {value:?}");
    }
}

/// Routing cost follows the matches, not the vocabulary: fifty distinct
/// equality conditions on one column cost one matched condition per write.
#[test]
fn routing_probes_columns_instead_of_evaluating_every_condition() {
    use ComparisonOperator::*;
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    for points in 0..50 {
        let uuid = format!("points-{points}");
        names.register(
            &mut ivm,
            uuid.as_str(),
            query(&tickets, Where::condition("points", EQ, points)),
        );
    }
    let before = ivm.engine().stats().clone();
    let ops = ivm.incremental_update(&insert(&tickets, 1, &[("points", 7.into())]));
    let cost = ivm.engine().stats().diff(&before);
    assert_eq!(names.impacted(&ops), vec!["points-7"]);
    assert_eq!(
        cost.conditions_evaluated, 1,
        "one candidate, not fifty evaluations"
    );
    assert_eq!(cost.index_hits, 1);
    assert!(cost.columns_probed >= 1);
}

/// Deltas are folded per row: three subscriptions holding one row
/// receive it as one delta naming all three, whoever they belong to (the
/// engine knows subscriptions, not clients); a row that leaves one
/// subscription and is rewritten for the others is a `Delete` for the one
/// and one `Add` for the rest; and a subscription let go hears nothing
/// more.
#[test]
fn updates_are_folded_per_row() {
    let tickets = table("tickets");
    let mut ivm = Local::new(SingleTableIVM::new(), Rc::new(MemoryStorage::new()));
    let names = Names::default();
    names.register(
        &mut ivm,
        "open",
        query(
            &tickets,
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        ),
    );
    names.register(&mut ivm, "all", query(&tickets, Where::AND(vec![])));
    names.register(&mut ivm, "also-all", query(&tickets, Where::AND(vec![])));

    let ops = ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));
    assert_eq!(ops.len(), 1, "one delta for the row, got {ops:?}");
    assert_eq!(ops[0].target_count(), 3, "naming every subscription");
    assert!(
        names.targets(&ops[0], "open")
            && names.targets(&ops[0], "all")
            && names.targets(&ops[0], "also-all")
    );

    let mut done_row = open_ticket_row();
    done_row[0] = ("status", "DONE".into());
    let ops = ivm.incremental_update(&update(&tickets, 1, &done_row));
    assert_eq!(
        ops.len(),
        2,
        "the row leaves `open` and is replaced for the other two, got {ops:?}"
    );
    assert!(matches!(ops[0].op, DataFrameOperation::Delete(..)));
    assert_eq!(names.impacted(&ops[..1]), ["open"]);
    assert!(matches!(ops[1].op, DataFrameOperation::Add(..)));
    assert_eq!(names.impacted(&ops[1..]), ["all", "also-all"]);

    ivm.unregister_query(names.id("all"));
    assert!(ivm.engine().rows_for(names.id("all")).is_none());
    let ops = ivm.incremental_update(&delete(&tickets, 1));
    assert_eq!(ops.len(), 1);
    assert_eq!(names.impacted(&ops), ["also-all"]);
}

/// A column the change feed left out of an update (a large value
/// PostgreSQL reported unchanged) keeps its held value: the subscriber
/// sees the whole row, not one with the column gone.
#[test]
fn an_update_missing_a_column_keeps_the_held_value() {
    let tickets = table("tickets");
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm = Local::new(SingleTableIVM::new(), storage.clone());
    let names = Names::default();
    names.register(
        &mut ivm,
        "q-open",
        query(
            &tickets,
            Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        ),
    );
    ivm.incremental_update(&insert(&tickets, 1, &open_ticket_row()));

    let partial: HashMap<ColumnName, Value> = HashMap::from([
        ("id".into(), Value::Int(1)),
        ("status".into(), "OPEN".into()),
        ("priority".into(), "HIGH".into()),
        ("points".into(), 3.into()),
    ]);
    let write = WriteQuery::UPDATE(UpdateQuery {
        table: tickets.name.clone(),
        pkey_value: DataFrameKey::new(pkey(1)),
        record: DataFrameRow::from(partial),
    });
    let ops = ivm.incremental_update(&write);
    let added = ops
        .iter()
        .find_map(|update| match &update.op {
            DataFrameOperation::Add(_, row) => Some(row.clone()),
            _ => None,
        })
        .expect("the open row is re-added with its new image");
    assert_eq!(
        added.data.get(&ColumnName::from("assigned_to")),
        Some(&Value::from("aniket")),
        "the column the feed left out keeps its held value"
    );
    assert_eq!(
        added.data.get(&ColumnName::from("priority")),
        Some(&Value::from("HIGH")),
        "the columns the feed carried are the new ones"
    );
}
