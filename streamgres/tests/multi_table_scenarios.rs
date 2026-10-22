//! End-to-end scenarios for the multi-table (LEFT and RIGHT JOIN) layer, driven
//! through `MemoryStorage` — every write is mirrored into storage first and
//! then routed, the same order of events a real database produces.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use streamgres::ivm::{Delta, Engine, MultiTableIVM, QueryPart, SubId};
use streamgres::model::*;
use streamgres::sync::{Local, MemoryStorage};

/// The join layer under the synchronous driver, over in-process storage:
/// every read a registration or a crossing asks for is landed inline.
type Ivm = Local<MultiTableIVM, MemoryStorage>;

/// A `tickets(id, status, assigned_to, reviewer, project, team_id)` table.
fn tickets_table() -> DbTable {
    DbTable::new(
        "tickets",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("status", ValueType::String),
            DbColumn::new("assigned_to", ValueType::Int),
            DbColumn::new("reviewer", ValueType::Int),
            DbColumn::new("project", ValueType::Int),
            DbColumn::new("team_id", ValueType::Int),
        ],
    )
}

/// A `members(id, team)` table — its join column (`team`) is NOT the pkey,
/// so several members can share a team.
fn members_table() -> DbTable {
    DbTable::new(
        "members",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("team", ValueType::Int),
        ],
    )
}

/// A generic `(id, name)` sub table.
fn sub_table(name: &str) -> DbTable {
    DbTable::new(
        name,
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("name", ValueType::String),
        ],
    )
}

/// A single-table query on `table` with the given filter, pkey-ordered,
/// unbounded.
fn query(table: &DbTable, filter: Where) -> SingleTableReadQuery {
    SingleTableReadQuery::new(
        table.name.clone(),
        filter,
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    )
}

/// A LEFT JOIN edge to a single-node sub query.
fn left(sub: SingleTableReadQuery, main_column: &str, sub_column: &str) -> Join {
    Join::left(MultiTableReadQuery::single(sub), main_column, sub_column)
}

/// A root with the given LEFT joins and no RIGHT joins.
fn left_joined(main_table: SingleTableReadQuery, left_joins: Vec<Join>) -> MultiTableReadQuery {
    MultiTableReadQuery::new(main_table, left_joins)
}

/// `OPEN` tickets.
fn open_tickets() -> SingleTableReadQuery {
    query(
        &tickets_table(),
        Where::condition("status", ComparisonOperator::EQ, "OPEN"),
    )
}

/// The standard spec: OPEN tickets LEFT JOIN `users` on
/// `tickets.assigned_to = users.id`.
fn tickets_users_query() -> MultiTableReadQuery {
    left_joined(
        open_tickets(),
        vec![left(
            query(&sub_table("users"), Where::AND(vec![])),
            "assigned_to",
            "id",
        )],
    )
}

/// OPEN tickets LEFT JOIN `members` on `tickets.team_id = members.team` —
/// a join on a non-pkey sub column, so one value can match several rows.
fn tickets_members_query() -> MultiTableReadQuery {
    left_joined(
        open_tickets(),
        vec![left(
            query(&members_table(), Where::AND(vec![])),
            "team_id",
            "team",
        )],
    )
}

/// OPEN tickets LEFT JOINed to `users` TWICE — `assigned_to = users.id`
/// (join 0) and `reviewer = users.id` (join 1) — so one user row can be
/// referenced by both joins at once.
fn two_users_joins_query() -> MultiTableReadQuery {
    left_joined(
        open_tickets(),
        vec![
            left(
                query(&sub_table("users"), Where::AND(vec![])),
                "assigned_to",
                "id",
            ),
            left(
                query(&sub_table("users"), Where::AND(vec![])),
                "reviewer",
                "id",
            ),
        ],
    )
}

fn pkey(id: i64) -> HashMap<ColumnName, Value> {
    HashMap::from([("id".into(), Value::Int(id))])
}

/// Collects `(column, value)` pairs plus the `id` primary key into a full
/// row image — records must carry every column, pkey included.
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

fn ticket(id: i64, status: &str, user: i64) -> WriteQuery {
    insert(
        "tickets",
        id,
        &[("status", status.into()), ("assigned_to", Value::Int(user))],
    )
}

/// A ticket UPDATE carrying a full row image.
fn update_ticket(id: i64, status: &str, user: i64) -> WriteQuery {
    update(
        "tickets",
        id,
        &[("status", status.into()), ("assigned_to", Value::Int(user))],
    )
}

fn user(id: i64, name: &str) -> WriteQuery {
    insert("users", id, &[("name", name.into())])
}

fn member(id: i64, team: i64) -> WriteQuery {
    insert("members", id, &[("team", Value::Int(team))])
}

fn team_ticket(id: i64, team: i64) -> WriteQuery {
    insert(
        "tickets",
        id,
        &[("status", "OPEN".into()), ("team_id", Value::Int(team))],
    )
}

/// Mirror the write into storage, then route it — commit first, notify
/// second, like a real database.
fn write(ivm: &mut Ivm, storage: &MemoryStorage, w: WriteQuery) -> Vec<Delta> {
    storage.apply(&w);
    ivm.incremental_update(&w)
}

/// A fresh engine, a shared storage handle, and an empty name directory.
fn engine() -> (Ivm, Rc<MemoryStorage>, Names) {
    engine_with_row_limit(streamgres::ivm::DEFAULT_ROW_LIMIT)
}

/// [`engine`] with `row_limit` as the most rows one batch of a page
/// reads.
fn engine_with_row_limit(row_limit: usize) -> (Ivm, Rc<MemoryStorage>, Names) {
    let storage = Rc::new(MemoryStorage::new());
    let ivm = Local::new(
        MultiTableIVM::new().with_row_limit(row_limit),
        storage.clone(),
    );
    (ivm, storage, Names::default())
}

/// Test-side directory from readable names to the engine's subscription
/// ids and back: the role the transport layer plays in production.
#[derive(Default)]
struct Names {
    ids: RefCell<HashMap<String, SubId>>,
    names: RefCell<HashMap<SubId, String>>,
}

impl Names {
    /// Register `spec` under `name`, returning its snapshot.
    fn register(
        &self,
        ivm: &mut Ivm,
        name: impl Into<String>,
        spec: MultiTableReadQuery,
    ) -> Vec<Delta> {
        let name = name.into();
        let (id, ops) = ivm.register_query(spec);
        self.ids.borrow_mut().insert(name.clone(), id);
        self.names.borrow_mut().insert(id, name);
        ops
    }

    /// The engine id registered under `name`.
    fn id(&self, name: &str) -> SubId {
        self.ids.borrow()[name]
    }

    /// The name registered for `id`.
    fn name(&self, id: SubId) -> String {
        self.names.borrow()[&id].clone()
    }

    /// Compact rendering of updates, one tag per targeted part, for
    /// order-insensitive assertions.
    fn tags(&self, ops: &[Delta]) -> Vec<String> {
        let mut rendered: Vec<String> = ops
            .iter()
            .flat_map(|update| update.targets().map(move |target| (update, target)))
            .map(|(update, target)| {
                let part = if target.part.is_main() {
                    "main".to_owned()
                } else if let Some(index) = target.part.join_index() {
                    format!("join{index}")
                } else {
                    format!("part{:?}", target.part.path())
                };
                let op = match &update.op {
                    DataFrameOperation::Add(key, _) => format!("add:{:?}", key.pkey_value["id"]),
                    DataFrameOperation::Delete(key, _) => format!("del:{:?}", key.pkey_value["id"]),
                };
                format!("{}/{part}/{op}", self.name(target.sub))
            })
            .collect();
        rendered.sort();
        rendered
    }
}

/// The part of the one target an update has.
fn part_of(update: &Delta) -> &QueryPart {
    assert_eq!(
        update.target_count(),
        1,
        "one target expected, got {update:?}"
    );
    &update.audiences[0].part
}

fn frame_len(ivm: &Ivm, names: &Names, name: &str, part: QueryPart) -> usize {
    ivm.engine()
        .rows_for(names.id(name), part)
        .map_or(0, |rows| rows.len())
}

/// Registration loads the whole snapshot from storage: every main row
/// matching the main `WHERE` is visible — with or without sub rows (left
/// join) — and each referenced join value's sub rows arrive from one
/// narrowed sub query.
#[test]
fn registration_returns_left_join_snapshot() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    storage.apply(&ticket(1, "OPEN", 7));
    storage.apply(&ticket(2, "OPEN", 99));
    storage.apply(&ticket(3, "DONE", 7));

    let snapshot = names.register(&mut ivm, "q", tickets_users_query());
    assert_eq!(
        names.tags(&snapshot),
        vec![
            "q/join0/add:Int(7)",
            "q/main/add:Int(1)",
            "q/main/add:Int(2)"
        ]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 2);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// A main row's first reference to a join value fetches the sub rows; a
/// second reference reuses them without fetching.
#[test]
fn first_reference_fetches_sub_rows() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", tickets_users_query());

    let ops = write(&mut ivm, &storage, ticket(1, "OPEN", 7));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(7)", "q/main/add:Int(1)"]
    );

    let ops = write(&mut ivm, &storage, ticket(2, "OPEN", 7));
    assert_eq!(names.tags(&ops), vec!["q/main/add:Int(2)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// Left join: a main row whose join value has no sub rows is fully
/// visible — the sub side is simply empty.
#[test]
fn main_row_visible_without_sub_rows() {
    let (mut ivm, storage, names) = engine();
    names.register(&mut ivm, "q", tickets_users_query());

    let ops = write(&mut ivm, &storage, ticket(1, "OPEN", 99));
    assert_eq!(names.tags(&ops), vec!["q/main/add:Int(1)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// A sub row arriving for a referenced value routes natively through the
/// registered `IN` condition and fills the previously empty sub side; the
/// main part is untouched.
#[test]
fn sub_arrival_fills_referenced_value() {
    let (mut ivm, storage, names) = engine();
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 9));

    let ops = write(&mut ivm, &storage, user(9, "kiran"));
    assert_eq!(names.tags(&ops), vec!["q/join0/add:Int(9)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// A sub row for a value no main row references does not match the
/// registered `IN` condition — no operations, no frame residue.
#[test]
fn unreferenced_sub_write_is_ignored() {
    let (mut ivm, storage, names) = engine();
    names.register(&mut ivm, "q", tickets_users_query());

    let ops = write(&mut ivm, &storage, user(42, "nobody"));
    assert!(ops.is_empty());
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// A write to a referenced sub row flows straight through as a join-part
/// replace: the one `Add` with the new image for the client.
#[test]
fn referenced_sub_update_forwards() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));

    let ops = write(
        &mut ivm,
        &storage,
        insert("users", 7, &[("name", "meera k".into())]),
    );
    assert_eq!(names.tags(&ops), vec!["q/join0/add:Int(7)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// Left join: deleting the last sub row for a referenced value leaves the
/// main row in place — its sub side just goes empty.
#[test]
fn sub_deletion_leaves_main_row() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));

    let ops = write(&mut ivm, &storage, delete("users", 7));
    assert_eq!(names.tags(&ops), vec!["q/join0/del:Int(7)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// Releasing references: only the LAST main row for a value prunes the sub
/// rows it kept alive.
#[test]
fn last_reference_prunes_sub_rows() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));
    write(&mut ivm, &storage, ticket(2, "OPEN", 7));

    let ops = write(&mut ivm, &storage, delete("tickets", 1));
    assert_eq!(names.tags(&ops), vec!["q/main/del:Int(1)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);

    let ops = write(&mut ivm, &storage, delete("tickets", 2));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(7)", "q/main/del:Int(2)"]
    );
    let pruned = ops
        .iter()
        .find(|update| part_of(update) == &QueryPart::join(0))
        .expect("the prune delete");
    assert!(
        matches!(&pruned.op, DataFrameOperation::Delete(_, row) if row.data["name"] == Value::String("meera".into()))
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 0);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// A main update moving the join value replaces the main row (one `Add`
/// for the client), fetches the new side, and prunes the vacated side.
#[test]
fn main_update_moves_join_reference() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    storage.apply(&user(8, "arjun"));
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));

    let before = ivm.engine().stats().clone();
    let ops = write(&mut ivm, &storage, update_ticket(1, "OPEN", 8));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/add:Int(8)",
            "q/join0/del:Int(7)",
            "q/main/add:Int(1)"
        ]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
    let after = ivm.engine().stats();
    assert_eq!(
        after.disjuncts_registered, before.disjuncts_registered,
        "a reference move swaps the IN guard in place — no re-registration"
    );
    assert_eq!(after.conditions_indexed, before.conditions_indexed);
}

/// A main update moving to a value with no sub rows keeps the main row
/// (left join) and just empties its sub side.
#[test]
fn main_update_to_unmatched_value_keeps_main_row() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));

    let ops = write(&mut ivm, &storage, update_ticket(1, "OPEN", 99));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(7)", "q/main/add:Int(1)"]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// Regression (review): a main-row rewrite that KEEPS its join value must
/// emit exactly the main row's new image and nothing else — inside the
/// engine the replace pair is recognized and its join values diffed, so
/// the value's `left` count never swings through zero and the sub side is
/// neither pruned nor refetched.
#[test]
fn main_update_keeping_join_value_emits_only_the_replace() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));

    let ops = write(
        &mut ivm,
        &storage,
        update(
            "tickets",
            1,
            &[
                ("status", "OPEN".into()),
                ("assigned_to", Value::Int(7)),
                ("reviewer", Value::Int(42)),
            ],
        ),
    );
    let [add] = ops.as_slice() else {
        panic!(
            "expected exactly the main row's new image, got {:?}",
            names.tags(&ops)
        );
    };
    assert_eq!(*part_of(add), QueryPart::main());
    assert!(
        matches!(&add.op, DataFrameOperation::Add(_, row) if row.data["reviewer"] == Value::Int(42))
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// A referenced sub row moving to an unreferenced value stops matching the
/// registered `IN` condition — membership routing delivers the `Delete`
/// natively, and the main row stays.
#[test]
fn sub_move_to_unreferenced_value_emits_delete() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&member(1, 5));
    storage.apply(&member(2, 5));
    names.register(&mut ivm, "q", tickets_members_query());
    write(&mut ivm, &storage, team_ticket(10, 5));

    let ops = write(
        &mut ivm,
        &storage,
        insert("members", 1, &[("team", Value::Int(9))]),
    );
    assert_eq!(names.tags(&ops), vec!["q/join0/del:Int(1)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// A sub row moving between two referenced values is replaced in place —
/// one `Add` for the client, still one row, `right` counts moved by the
/// engine's diff of the two images.
#[test]
fn sub_move_between_referenced_values_refreshes() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&member(1, 5));
    storage.apply(&member(2, 6));
    names.register(&mut ivm, "q", tickets_members_query());
    write(&mut ivm, &storage, team_ticket(10, 5));
    write(&mut ivm, &storage, team_ticket(11, 6));

    let ops = write(
        &mut ivm,
        &storage,
        insert("members", 1, &[("team", Value::Int(6))]),
    );
    assert_eq!(names.tags(&ops), vec!["q/join0/add:Int(1)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 2);
}

/// One user row referenced by two joins of the same query: deleting it
/// reaches BOTH join parts natively — each part's registered `IN`
/// condition held the row independently. The main row stays (left join).
#[test]
fn shared_sub_row_across_two_joins_deletes_both_parts() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", two_users_joins_query());
    let ops = write(
        &mut ivm,
        &storage,
        insert(
            "tickets",
            1,
            &[
                ("status", "OPEN".into()),
                ("assigned_to", Value::Int(7)),
                ("reviewer", Value::Int(7)),
            ],
        ),
    );
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/add:Int(7)",
            "q/join1/add:Int(7)",
            "q/main/add:Int(1)"
        ]
    );

    let ops = write(&mut ivm, &storage, delete("users", 7));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(7)", "q/join1/del:Int(7)"]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(1)), 0);
}

/// A second subscription with the same spec gets its own full snapshot,
/// served from the shared per-table frames — and each subscription keeps
/// routing independently.
#[test]
fn second_subscription_shares_rows_and_gets_its_own_snapshot() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q1", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));

    let snapshot = names.register(&mut ivm, "q2", tickets_users_query());
    assert_eq!(
        names.tags(&snapshot),
        vec!["q2/join0/add:Int(7)", "q2/main/add:Int(1)"]
    );

    let ops = write(&mut ivm, &storage, ticket(2, "OPEN", 7));
    assert_eq!(
        names.tags(&ops),
        vec!["q1/main/add:Int(2)", "q2/main/add:Int(2)"]
    );
    ivm.unregister_query(names.id("q1"));
    assert_eq!(frame_len(&ivm, &names, "q2", QueryPart::main()), 2);
    assert_eq!(frame_len(&ivm, &names, "q2", QueryPart::join(0)), 1);
}

/// Regression (review): self-join — `people LEFT JOIN people ON mgr = id`.
/// One write is then both a main-part and a sub-part event. The sub op is
/// captured against the pre-write `IN` list, so it must be forwarded
/// BEFORE the main side's reference moves prune the frame — otherwise a
/// stale `Add` resurrects a pruned row on the client. The client replay
/// (ops applied in emitted order) must converge to the engine's frames.
#[test]
fn self_join_write_converges_for_the_client() {
    let people = DbTable::new(
        "people",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("mgr", ValueType::Int),
        ],
    );
    let spec = MultiTableReadQuery::new(
        query(&people, Where::AND(vec![])),
        vec![left(query(&people, Where::AND(vec![])), "mgr", "id")],
    );
    let (mut ivm, storage, names) = engine();
    names.register(&mut ivm, "q", spec);

    let ops = write(
        &mut ivm,
        &storage,
        insert("people", 2, &[("mgr", Value::Int(2))]),
    );
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(2)", "q/main/add:Int(2)"]
    );

    let ops = write(
        &mut ivm,
        &storage,
        update("people", 2, &[("mgr", Value::Int(1))]),
    );
    let join0_key2: Vec<&Delta> = ops
        .iter()
        .filter(|update| {
            update
                .targets()
                .any(|target| target.part == QueryPart::join(0))
                && update.op.key().pkey_value["id"] == Value::Int(2)
        })
        .collect();
    assert!(
        matches!(
            join0_key2.last().map(|update| &update.op),
            Some(DataFrameOperation::Delete(..))
        ),
        "client must end WITHOUT row 2 on the sub side, got ops: {:?}",
        names.tags(&ops)
    );
    assert!(ops.iter().all(|update| update.table == "people"));
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// `tickets LEFT JOIN members` with the members side windowed: the two
/// newest members (by id, descending) of each team.
fn tickets_two_newest_members_query() -> MultiTableReadQuery {
    let mut spec = tickets_members_query();
    let sub = &mut spec.joins[0].sub.main_table;
    sub.order_by = vec![OrderBy::new("id", Order::DESC)];
    sub.limit = 2;
    spec
}

/// A `LIMIT` on a LEFT join's sub side is a window **per parent row**, as
/// `related` means it: each referenced team shows its two newest members,
/// not two members in all. A member arriving inside a team's window evicts
/// that team's oldest shown member, a shown member leaving is refilled from
/// storage, and a team no longer referenced takes its members away.
#[test]
fn sub_table_limit_is_a_window_per_parent() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=3 {
        storage.apply(&member(id, 5));
    }
    storage.apply(&member(4, 6));
    names.register(&mut ivm, "q", tickets_two_newest_members_query());

    let ops = write(&mut ivm, &storage, team_ticket(10, 5));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/add:Int(2)",
            "q/join0/add:Int(3)",
            "q/main/add:Int(10)"
        ],
        "team 5 shows its two newest members, not member 1"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 2);

    let ops = write(&mut ivm, &storage, member(7, 5));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(7)", "q/join0/del:Int(2)"],
        "a newer member enters team 5's window and evicts its oldest shown one"
    );

    let ops = write(&mut ivm, &storage, delete("members", 7));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(2)", "q/join0/del:Int(7)"],
        "the window refills from storage when a shown member leaves"
    );

    let ops = write(&mut ivm, &storage, team_ticket(11, 6));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(4)", "q/main/add:Int(11)"],
        "another team gets a window of its own"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 3);

    let ops = write(&mut ivm, &storage, delete("tickets", 10));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/del:Int(2)",
            "q/join0/del:Int(3)",
            "q/main/del:Int(10)"
        ],
        "team 5's members go with its last ticket"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// Two tickets of one team share the team's window: the second ticket
/// adds no member rows, and the members stay while either ticket does.
#[test]
fn a_per_parent_window_is_shared_by_the_parent_rows_of_one_value() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=3 {
        storage.apply(&member(id, 5));
    }
    storage.apply(&team_ticket(10, 5));
    let snapshot = names.register(&mut ivm, "q", tickets_two_newest_members_query());
    assert_eq!(
        names.tags(&snapshot),
        vec![
            "q/join0/add:Int(2)",
            "q/join0/add:Int(3)",
            "q/main/add:Int(10)"
        ]
    );

    let ops = write(&mut ivm, &storage, team_ticket(11, 5));
    assert_eq!(
        names.tags(&ops),
        vec!["q/main/add:Int(11)"],
        "the window is already there"
    );

    let ops = write(&mut ivm, &storage, delete("tickets", 10));
    assert_eq!(
        names.tags(&ops),
        vec!["q/main/del:Int(10)"],
        "ticket 11 still references team 5"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 2);

    let ops = write(&mut ivm, &storage, delete("tickets", 11));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/del:Int(2)",
            "q/join0/del:Int(3)",
            "q/main/del:Int(11)"
        ]
    );
}

/// A second subscription to a spec with a per-parent window is served the
/// windows' shown rows from the shared tree, and both see later changes.
#[test]
fn a_twin_shares_the_per_parent_windows() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=3 {
        storage.apply(&member(id, 5));
    }
    storage.apply(&team_ticket(10, 5));
    names.register(&mut ivm, "a", tickets_two_newest_members_query());
    let snapshot = names.register(&mut ivm, "b", tickets_two_newest_members_query());
    assert_eq!(
        names.tags(&snapshot),
        vec![
            "b/join0/add:Int(2)",
            "b/join0/add:Int(3)",
            "b/main/add:Int(10)"
        ]
    );

    let ops = write(&mut ivm, &storage, member(9, 5));
    assert_eq!(
        names.tags(&ops),
        vec![
            "a/join0/add:Int(9)",
            "a/join0/del:Int(2)",
            "b/join0/add:Int(9)",
            "b/join0/del:Int(2)"
        ]
    );
}

/// Every update names the table its operation lands on: the main table for
/// the main part, the join's sub table for each join part.
#[test]
fn updates_carry_their_destination_table() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    storage.apply(&ticket(1, "OPEN", 7));

    let snapshot = names.register(&mut ivm, "q", tickets_users_query());
    assert!(
        snapshot
            .iter()
            .any(|update| *part_of(update) == QueryPart::main())
    );
    assert!(
        snapshot
            .iter()
            .any(|update| *part_of(update) == QueryPart::join(0))
    );
    for update in &snapshot {
        if part_of(update).is_main() {
            assert_eq!(update.table, "tickets");
        } else {
            assert_eq!(update.table, "users");
        }
    }
}

/// Unregistering removes every part frame and stops routing entirely.
#[test]
fn unregister_removes_all_parts() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(7, "meera"));
    names.register(&mut ivm, "q", tickets_users_query());
    write(&mut ivm, &storage, ticket(1, "OPEN", 7));

    ivm.unregister_query(names.id("q"));
    assert!(
        ivm.engine()
            .rows_for(names.id("q"), QueryPart::main())
            .is_none()
    );
    assert!(
        ivm.engine()
            .rows_for(names.id("q"), QueryPart::join(0))
            .is_none()
    );
    let ops = write(&mut ivm, &storage, ticket(2, "OPEN", 7));
    assert!(ops.is_empty());
}

/// A `profiles(id, user_id, bio)` table.
fn profiles_table() -> DbTable {
    DbTable::new(
        "profiles",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("user_id", ValueType::Int),
            DbColumn::new("bio", ValueType::String),
        ],
    )
}

fn profile(id: i64, user: i64) -> WriteQuery {
    insert(
        "profiles",
        id,
        &[("user_id", Value::Int(user)), ("bio", "x".into())],
    )
}

/// A single `users` node.
fn users_node() -> MultiTableReadQuery {
    MultiTableReadQuery::single(query(&sub_table("users"), Where::AND(vec![])))
}

/// `users` with `profiles` LEFT-joined under it on `users.id = profiles.user_id`.
fn users_with_profiles() -> MultiTableReadQuery {
    left_joined(
        query(&sub_table("users"), Where::AND(vec![])),
        vec![left(
            query(&profiles_table(), Where::AND(vec![])),
            "id",
            "user_id",
        )],
    )
}

/// OPEN tickets RIGHT JOIN `users` on `assigned_to = users.id`: every user
/// is visible, a ticket only while its assignee exists.
fn tickets_right_users_query(users: MultiTableReadQuery) -> MultiTableReadQuery {
    MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::right(users, "assigned_to", "id")],
    )
}

/// A RIGHT JOIN preserves the child: the snapshot holds every user and
/// only the open tickets whose assignee exists, the child registers
/// before the parent it drives, and parent writes route natively through
/// the parent's `IN` leaf.
#[test]
fn right_join_snapshot_keeps_children_and_matched_parents() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        ticket(10, "OPEN", 1),
        ticket(11, "OPEN", 9),
        ticket(12, "CLOSED", 1),
    ] {
        storage.apply(&w);
    }
    let snapshot = names.register(&mut ivm, "q", tickets_right_users_query(users_node()));
    assert_eq!(
        names.tags(&snapshot),
        vec![
            "q/join0/add:Int(1)",
            "q/join0/add:Int(2)",
            "q/main/add:Int(10)"
        ],
        "users preserved; ticket 11 has no user, ticket 12 is not open"
    );
    assert_eq!(
        *part_of(&snapshot[0]),
        QueryPart::join(0),
        "the driving child registers first"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 2);

    let ops = write(&mut ivm, &storage, ticket(13, "OPEN", 2));
    assert_eq!(
        names.tags(&ops),
        vec!["q/main/add:Int(13)"],
        "a referenced assignee: routed natively"
    );
    assert!(
        write(&mut ivm, &storage, ticket(14, "OPEN", 9)).is_empty(),
        "no such user: the parent's IN leaf rejects the row inside the index"
    );
}

/// A child row arriving for an unreferenced value crosses zero on the
/// RIGHT edge: the parent's `IN` leaf widens and the parent rows carrying
/// that value are fetched and forwarded after the child's own `Add`.
#[test]
fn right_join_child_arrival_admits_parent_rows() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        ticket(10, "OPEN", 1),
        ticket(11, "OPEN", 9),
        ticket(14, "OPEN", 9),
    ] {
        storage.apply(&w);
    }
    names.register(&mut ivm, "q", tickets_right_users_query(users_node()));
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);

    let ops = write(&mut ivm, &storage, user(9, "z"));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/add:Int(9)",
            "q/main/add:Int(11)",
            "q/main/add:Int(14)"
        ]
    );
    assert_eq!(
        *part_of(&ops[0]),
        QueryPart::join(0),
        "the driver's operation precedes the rows it admits"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 3);
}

/// The last child row for a value departing prunes the parent rows that
/// carried it, without a storage trip; a parent row departing never
/// touches the preserved child.
#[test]
fn right_join_departures() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(9, "z"),
        ticket(10, "OPEN", 1),
        ticket(11, "OPEN", 9),
        ticket(14, "OPEN", 9),
    ] {
        storage.apply(&w);
    }
    names.register(&mut ivm, "q", tickets_right_users_query(users_node()));
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 3);

    let ops = write(&mut ivm, &storage, delete("users", 9));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/del:Int(9)",
            "q/main/del:Int(11)",
            "q/main/del:Int(14)"
        ]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);

    let ops = write(&mut ivm, &storage, delete("tickets", 10));
    assert_eq!(
        names.tags(&ops),
        vec!["q/main/del:Int(10)"],
        "the preserved child keeps its row"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// A parent row moving between referenced values is a plain replace on
/// the parent (one `Add`); moving to an unreferenced value leaves the
/// parent's result set through membership.
#[test]
fn right_join_parent_updates_route_natively() {
    let (mut ivm, storage, names) = engine();
    for w in [user(1, "a"), user(2, "b"), ticket(10, "OPEN", 1)] {
        storage.apply(&w);
    }
    names.register(&mut ivm, "q", tickets_right_users_query(users_node()));

    let ops = write(&mut ivm, &storage, update_ticket(10, "OPEN", 2));
    assert_eq!(names.tags(&ops), vec!["q/main/add:Int(10)"]);
    let ops = write(&mut ivm, &storage, update_ticket(10, "OPEN", 9));
    assert_eq!(names.tags(&ops), vec!["q/main/del:Int(10)"]);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 0);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 2);
}

/// A LEFT join nested under a RIGHT join: a user arriving admits its
/// tickets (upward, RIGHT) and fetches its profiles (downward, LEFT) in
/// one cascade; its departure prunes both.
#[test]
fn nested_left_under_right_cascades() {
    let (mut ivm, storage, names) = engine();
    for w in [user(1, "a"), profile(100, 1), ticket(10, "OPEN", 1)] {
        storage.apply(&w);
    }
    let snapshot = names.register(
        &mut ivm,
        "q",
        tickets_right_users_query(users_with_profiles()),
    );
    assert_eq!(
        names.tags(&snapshot),
        vec![
            "q/join0/add:Int(1)",
            "q/main/add:Int(10)",
            "q/part[0, 0]/add:Int(100)"
        ]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::new(&[0, 0])), 1);

    assert!(
        write(&mut ivm, &storage, profile(101, 2)).is_empty(),
        "a profile of a user nobody holds is unreferenced"
    );
    let ops = write(&mut ivm, &storage, user(2, "b"));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(2)", "q/part[0, 0]/add:Int(101)"],
        "the user's profile is fetched through the nested LEFT edge; no ticket names user 2"
    );
    let ops = write(&mut ivm, &storage, delete("users", 2));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(2)", "q/part[0, 0]/del:Int(101)"]
    );
}

/// Two LEFT levels: a ticket arriving fetches its user, and the fetched
/// user fetches its profile; the ticket departing prunes both levels.
#[test]
fn nested_left_under_left_cascades() {
    let (mut ivm, storage, names) = engine();
    for w in [user(1, "a"), profile(100, 1)] {
        storage.apply(&w);
    }
    let spec = left_joined(
        open_tickets(),
        vec![Join::left(users_with_profiles(), "assigned_to", "id")],
    );
    assert!(names.register(&mut ivm, "q", spec).is_empty());

    let ops = write(&mut ivm, &storage, ticket(10, "OPEN", 1));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/add:Int(1)",
            "q/main/add:Int(10)",
            "q/part[0, 0]/add:Int(100)"
        ]
    );
    assert!(
        part_of(&ops[0]).is_main(),
        "the driving root row is forwarded before what it fetches"
    );
    let ops = write(&mut ivm, &storage, delete("tickets", 10));
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/del:Int(1)",
            "q/main/del:Int(10)",
            "q/part[0, 0]/del:Int(100)"
        ]
    );
    for part in [
        QueryPart::main(),
        QueryPart::join(0),
        QueryPart::new(&[0, 0]),
    ] {
        assert_eq!(frame_len(&ivm, &names, "q", part), 0);
    }
}

/// One node driven on one column from both sides — `users` LEFT-joined
/// from tickets on `users.id` and RIGHT-joined to profiles on `users.id`
/// — holds the intersection: a user is visible only while an open ticket
/// names it AND it has a profile, and either side leaving prunes it.
#[test]
fn two_edges_driving_one_column_intersect() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        profile(100, 1),
        ticket(10, "OPEN", 1),
        ticket(11, "OPEN", 2),
    ] {
        storage.apply(&w);
    }
    let users = MultiTableReadQuery::new(
        query(&sub_table("users"), Where::AND(vec![])),
        vec![Join::right(
            MultiTableReadQuery::single(query(&profiles_table(), Where::AND(vec![]))),
            "id",
            "user_id",
        )],
    );
    let spec = left_joined(open_tickets(), vec![Join::left(users, "assigned_to", "id")]);
    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        vec![
            "q/join0/add:Int(1)",
            "q/main/add:Int(10)",
            "q/main/add:Int(11)",
            "q/part[0, 0]/add:Int(100)"
        ],
        "user 2 is named by a ticket but has no profile"
    );

    let ops = write(&mut ivm, &storage, profile(101, 2));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(2)", "q/part[0, 0]/add:Int(101)"],
        "the profile completes user 2's intersection"
    );
    let ops = write(&mut ivm, &storage, delete("tickets", 10));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(1)", "q/main/del:Int(10)"],
        "no ticket names user 1 anymore; its profile is preserved"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::new(&[0, 0])), 2);
    let ops = write(&mut ivm, &storage, delete("profiles", 101));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(2)", "q/part[0, 0]/del:Int(101)"]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// Unregistering a nested subscription removes every part at every level.
#[test]
fn unregister_removes_nested_parts() {
    let (mut ivm, storage, names) = engine();
    for w in [user(1, "a"), profile(100, 1), ticket(10, "OPEN", 1)] {
        storage.apply(&w);
    }
    names.register(
        &mut ivm,
        "q",
        tickets_right_users_query(users_with_profiles()),
    );
    ivm.unregister_query(names.id("q"));
    for part in [
        QueryPart::main(),
        QueryPart::join(0),
        QueryPart::new(&[0, 0]),
    ] {
        assert!(ivm.engine().rows_for(names.id("q"), part).is_none());
    }
    assert!(write(&mut ivm, &storage, user(3, "c")).is_empty());
}

/// Identical multi-table subscriptions share one tree: a zero crossing is
/// handled once (one set edit, one fetch) and its result is emitted to
/// every subscriber; unregistering one subscriber leaves the tree intact
/// for the others, and the last one takes the parts with it.
#[test]
fn identical_subscriptions_share_one_edge() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&user(1, "a"));
    for uuid in ["a", "b", "c"] {
        names.register(&mut ivm, uuid, tickets_users_query());
    }
    let before = ivm.engine().stats().clone();
    let ops = write(&mut ivm, &storage, ticket(10, "OPEN", 1));
    let cost = ivm.engine().stats().diff(&before);
    assert_eq!(
        names.tags(&ops),
        vec![
            "a/join0/add:Int(1)",
            "a/main/add:Int(10)",
            "b/join0/add:Int(1)",
            "b/main/add:Int(10)",
            "c/join0/add:Int(1)",
            "c/main/add:Int(10)"
        ]
    );
    assert_eq!(
        cost.conditions_replaced, 1,
        "one set edit for the shared edge, not one per subscriber"
    );
    assert_eq!(
        cost.queries_impacted, 1,
        "one inner root part serves all three"
    );

    ivm.unregister_query(names.id("a"));
    let ops = write(&mut ivm, &storage, ticket(11, "OPEN", 1));
    assert_eq!(
        names.tags(&ops),
        vec!["b/main/add:Int(11)", "c/main/add:Int(11)"]
    );
    assert_eq!(frame_len(&ivm, &names, "b", QueryPart::join(0)), 1);

    ivm.unregister_query(names.id("b"));
    ivm.unregister_query(names.id("c"));
    assert!(
        ivm.engine()
            .rows_for(names.id("c"), QueryPart::main())
            .is_none()
    );
    assert!(write(&mut ivm, &storage, ticket(12, "OPEN", 1)).is_empty());
}

/// A later identical registration is served from the shared parts and
/// sees exactly the shared state, including rows that arrived through
/// crossings after the first registration.
#[test]
fn later_identical_registration_is_served_from_the_shared_tree() {
    let (mut ivm, storage, names) = engine();
    for w in [user(1, "a"), user(2, "b")] {
        storage.apply(&w);
    }
    names.register(&mut ivm, "first", tickets_users_query());
    write(&mut ivm, &storage, ticket(10, "OPEN", 1));
    write(&mut ivm, &storage, ticket(11, "OPEN", 2));
    let before = ivm.engine().stats().clone();
    let snapshot = names.register(&mut ivm, "second", tickets_users_query());
    assert_eq!(
        names.tags(&snapshot),
        vec![
            "second/join0/add:Int(1)",
            "second/join0/add:Int(2)",
            "second/main/add:Int(10)",
            "second/main/add:Int(11)"
        ]
    );
    let cost = ivm.engine().stats().diff(&before);
    assert_eq!(
        cost.snapshots_shared, 2,
        "both parts served without storage"
    );
    assert_eq!(cost.queries_registered, 0, "no inner registration happened");
}

/// The join leaf is a set with a stable identity: many crossings never
/// create new index links or counters, only file and unfile members.
#[test]
fn set_valued_leaf_keeps_its_identity_across_crossings() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=5 {
        storage.apply(&user(id, "u"));
    }
    names.register(&mut ivm, "q", tickets_users_query());
    let before = ivm.engine().stats().clone();
    for id in 1..=5 {
        write(&mut ivm, &storage, ticket(10 + id, "OPEN", id));
    }
    for id in 1..=5 {
        write(&mut ivm, &storage, delete("tickets", 10 + id));
    }
    let cost = ivm.engine().stats().diff(&before);
    assert_eq!(
        cost.conditions_replaced, 10,
        "five members added, five removed"
    );
    assert_eq!(
        cost.conditions_indexed, 0,
        "the leaf condition itself never changed"
    );
    assert_eq!(cost.disjuncts_registered, 0);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);
}

/// An INNER edge on `assigned_to = users.id`: a ticket is shown only while
/// its user exists, and a user only under a shown ticket. `t11` names a
/// user who does not exist yet, `u2` is held by the engine (it drives the
/// edge) but hidden until its ticket is open.
fn tickets_inner_users_query() -> MultiTableReadQuery {
    MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::inner(users_node(), "assigned_to", "id")],
    )
}

/// INNER keeps neither side alone: the snapshot holds the open tickets
/// whose user exists and the users under them; a user arriving admits the
/// ticket that named it, a ticket closing retracts its user, a ticket
/// opening admits the user held for it, and a user leaving drops both.
#[test]
fn inner_join_shows_each_side_only_with_the_other() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        ticket(10, "OPEN", 1),
        ticket(11, "OPEN", 9),
        ticket(12, "CLOSED", 2),
    ] {
        storage.apply(&w);
    }
    let snapshot = names.register(&mut ivm, "q", tickets_inner_users_query());
    assert_eq!(
        names.tags(&snapshot),
        ["q/join0/add:Int(1)", "q/main/add:Int(10)"]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);

    let ops = write(&mut ivm, &storage, user(9, "late"));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(9)", "q/main/add:Int(11)"]
    );

    let ops = write(&mut ivm, &storage, update_ticket(10, "CLOSED", 1));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(1)", "q/main/del:Int(10)"]
    );

    let ops = write(&mut ivm, &storage, update_ticket(12, "OPEN", 2));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(2)", "q/main/add:Int(12)"]
    );

    let ops = write(&mut ivm, &storage, delete("users", 2));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(2)", "q/main/del:Int(12)"]
    );

    let twin = names.register(&mut ivm, "twin", tickets_inner_users_query());
    assert_eq!(
        names.tags(&twin),
        ["twin/join0/add:Int(9)", "twin/main/add:Int(11)"],
        "a twin is served the shown rows only"
    );
}

/// `status = 'OPEN' OR EXISTS(users WHERE name = 'lead')`: the existence
/// test placed inside the `OR`. A ticket is shown through either branch;
/// when the lead user stops being one, the value leaves the set and the
/// tickets held for it are re-evaluated, so the one the `OPEN` branch
/// still admits stays. A user arriving before any shown ticket names it is
/// held hidden and admitted by the ticket's arrival.
#[test]
fn exists_inside_or_keeps_rows_another_branch_admits() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "lead"),
        user(2, "dev"),
        ticket(1, "OPEN", 2),
        ticket(2, "CLOSED", 1),
        ticket(3, "OPEN", 1),
        ticket(4, "CLOSED", 2),
    ] {
        storage.apply(&w);
    }
    let spec = MultiTableReadQuery::new(
        query(
            &tickets_table(),
            Where::OR(vec![
                Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                Where::exists("assigned_to", 0),
            ]),
        ),
        vec![Join::inner(
            MultiTableReadQuery::single(query(
                &sub_table("users"),
                Where::condition("name", ComparisonOperator::EQ, "lead"),
            )),
            "assigned_to",
            "id",
        )],
    );
    let snapshot = names.register(&mut ivm, "q", spec.clone());
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(1)",
            "q/main/add:Int(1)",
            "q/main/add:Int(2)",
            "q/main/add:Int(3)"
        ]
    );

    let ops = write(&mut ivm, &storage, user(1, "dev"));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(1)", "q/main/del:Int(2)"],
        "the prune re-evaluates: t3 stays through the OPEN branch"
    );

    let ops = write(&mut ivm, &storage, user(3, "lead"));
    assert!(
        ops.is_empty(),
        "a lead nobody is assigned to is held, not shown"
    );
    let ops = write(&mut ivm, &storage, ticket(5, "CLOSED", 3));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(3)", "q/main/add:Int(5)"]
    );

    let ops = write(&mut ivm, &storage, update_ticket(1, "CLOSED", 2));
    assert_eq!(names.tags(&ops), ["q/main/del:Int(1)"]);
    assert_eq!(
        names.tags(&names.register(&mut ivm, "twin", spec)),
        [
            "twin/join0/add:Int(3)",
            "twin/main/add:Int(3)",
            "twin/main/add:Int(5)"
        ]
    );
}

/// A chain of INNER edges, `tickets INNER users INNER profiles`: a row is
/// shown only if the whole chain reaches the root, and one profile
/// arriving at the bottom admits its user and the ticket above it.
#[test]
fn inner_chain_shows_only_rows_reaching_the_root() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        ticket(1, "OPEN", 1),
        ticket(2, "OPEN", 2),
        profile(1, 1),
    ] {
        storage.apply(&w);
    }
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::inner(
            MultiTableReadQuery::new(
                query(&sub_table("users"), Where::AND(vec![])),
                vec![Join::inner(
                    MultiTableReadQuery::single(query(&profiles_table(), Where::AND(vec![]))),
                    "id",
                    "user_id",
                )],
            ),
            "assigned_to",
            "id",
        )],
    );
    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(1)",
            "q/main/add:Int(1)",
            "q/part[0, 0]/add:Int(1)"
        ]
    );
    let ops = write(&mut ivm, &storage, profile(2, 2));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(2)",
            "q/main/add:Int(2)",
            "q/part[0, 0]/add:Int(2)"
        ]
    );
    let ops = write(&mut ivm, &storage, delete("profiles", 1));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/del:Int(1)",
            "q/main/del:Int(1)",
            "q/part[0, 0]/del:Int(1)"
        ]
    );
}

/// The same INNER edge evaluated from the main: the tickets are read
/// whole and the users narrowed to them, and the client sees exactly the
/// rows the sub-driven form shows, at every step. A user arriving reveals
/// the ticket that named it (the match count crossing zero), a ticket
/// closing retracts its user, a ticket opening fetches and reveals its
/// user, and a user leaving hides its ticket.
#[test]
fn inner_from_main_shows_the_same_rows_as_inner_from_sub() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        ticket(10, "OPEN", 1),
        ticket(11, "OPEN", 9),
        ticket(12, "CLOSED", 2),
    ] {
        storage.apply(&w);
    }
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::inner_from_main(users_node(), "assigned_to", "id")],
    );
    let snapshot = names.register(&mut ivm, "q", spec.clone());
    assert_eq!(
        names.tags(&snapshot),
        ["q/join0/add:Int(1)", "q/main/add:Int(10)"]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1);
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);

    let ops = write(&mut ivm, &storage, user(9, "late"));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(9)", "q/main/add:Int(11)"],
        "the user's arrival opens the gate on the ticket that named it"
    );

    let ops = write(&mut ivm, &storage, update_ticket(10, "CLOSED", 1));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(1)", "q/main/del:Int(10)"]
    );

    let ops = write(&mut ivm, &storage, update_ticket(12, "OPEN", 2));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(2)", "q/main/add:Int(12)"],
        "the ticket's arrival fetches its user, whose landing reveals the ticket"
    );

    let ops = write(&mut ivm, &storage, delete("users", 2));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(2)", "q/main/del:Int(12)"],
        "the last match leaving closes the gate"
    );

    let twin = names.register(&mut ivm, "twin", spec);
    assert_eq!(
        names.tags(&twin),
        ["twin/join0/add:Int(9)", "twin/main/add:Int(11)"],
        "a twin is served the shown rows only"
    );
}

/// `status = 'OPEN' OR EXISTS(users WHERE name = 'lead')` with the edge
/// driven from the main: the leaf becomes a gate answered per row from the
/// match count, and the rows shown are the ones the sub-driven form shows
/// through the whole scenario.
#[test]
fn exists_inside_or_gates_from_the_main_too() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "lead"),
        user(2, "dev"),
        ticket(1, "OPEN", 2),
        ticket(2, "CLOSED", 1),
        ticket(3, "OPEN", 1),
        ticket(4, "CLOSED", 2),
    ] {
        storage.apply(&w);
    }
    let spec = MultiTableReadQuery::new(
        query(
            &tickets_table(),
            Where::OR(vec![
                Where::condition("status", ComparisonOperator::EQ, "OPEN"),
                Where::exists("assigned_to", 0),
            ]),
        ),
        vec![Join::inner_from_main(
            MultiTableReadQuery::single(query(
                &sub_table("users"),
                Where::condition("name", ComparisonOperator::EQ, "lead"),
            )),
            "assigned_to",
            "id",
        )],
    );
    let snapshot = names.register(&mut ivm, "q", spec.clone());
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(1)",
            "q/main/add:Int(1)",
            "q/main/add:Int(2)",
            "q/main/add:Int(3)"
        ]
    );
    assert_eq!(
        frame_len(&ivm, &names, "q", QueryPart::main()),
        3,
        "the closed ticket of the dev is held but not shown"
    );

    let ops = write(&mut ivm, &storage, user(1, "dev"));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(1)", "q/main/del:Int(2)"],
        "the gate re-evaluates: t3 stays through the OPEN branch"
    );

    let ops = write(&mut ivm, &storage, user(3, "lead"));
    assert!(
        ops.is_empty(),
        "a lead nobody is assigned to is not referenced, so not read"
    );
    let ops = write(&mut ivm, &storage, ticket(5, "CLOSED", 3));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(3)", "q/main/add:Int(5)"],
        "the ticket references the lead, whose landing opens the gate"
    );

    let ops = write(&mut ivm, &storage, update_ticket(1, "CLOSED", 2));
    assert_eq!(names.tags(&ops), ["q/main/del:Int(1)"]);
    assert_eq!(
        names.tags(&names.register(&mut ivm, "twin", spec)),
        [
            "twin/join0/add:Int(3)",
            "twin/main/add:Int(3)",
            "twin/main/add:Int(5)"
        ]
    );
}

/// Two existence tests in one `OR`, one edge driven from the sub and one
/// from the main: `EXISTS(users WHERE name = 'lead') OR EXISTS(members)`.
/// A ticket is shown through either; a member arriving opens the gate for
/// its team, and the lead stepping down re-evaluates the tickets the
/// sub-driven edge no longer admits.
#[test]
fn mixed_drivers_inside_one_or_gate_together() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "lead"),
        insert(
            "tickets",
            1,
            &[
                ("status", "OPEN".into()),
                ("assigned_to", Value::Int(1)),
                ("team_id", Value::Int(5)),
            ],
        ),
        insert(
            "tickets",
            2,
            &[
                ("status", "OPEN".into()),
                ("assigned_to", Value::Int(2)),
                ("team_id", Value::Int(6)),
            ],
        ),
        insert(
            "tickets",
            3,
            &[
                ("status", "OPEN".into()),
                ("assigned_to", Value::Int(2)),
                ("team_id", Value::Int(7)),
            ],
        ),
        member(1, 6),
    ] {
        storage.apply(&w);
    }
    let spec = MultiTableReadQuery::new(
        query(
            &tickets_table(),
            Where::OR(vec![
                Where::exists("assigned_to", 0),
                Where::exists("team_id", 1),
            ]),
        ),
        vec![
            Join::inner(
                MultiTableReadQuery::single(query(
                    &sub_table("users"),
                    Where::condition("name", ComparisonOperator::EQ, "lead"),
                )),
                "assigned_to",
                "id",
            ),
            Join::inner_from_main(
                MultiTableReadQuery::single(query(&members_table(), Where::AND(vec![]))),
                "team_id",
                "team",
            ),
        ],
    );
    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(1)",
            "q/join1/add:Int(1)",
            "q/main/add:Int(1)",
            "q/main/add:Int(2)"
        ],
        "t1 through the lead, t2 through its member; t3 held hidden"
    );

    let ops = write(&mut ivm, &storage, member(2, 7));
    assert_eq!(
        names.tags(&ops),
        ["q/join1/add:Int(2)", "q/main/add:Int(3)"],
        "the member's arrival opens the main-driven gate for team 7"
    );

    let ops = write(&mut ivm, &storage, user(1, "dev"));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(1)", "q/main/del:Int(1)"],
        "the sub-driven edge losing the lead re-evaluates t1, which no branch admits"
    );
}

/// A main-driven inner edge below a LEFT edge: `tickets LEFT users` where
/// a user is shown only while it has a profile. The nested gate opens and
/// closes as profiles come and go, and the user's rows cascade with it.
#[test]
fn a_nested_main_driven_inner_edge_gates_its_node() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        profile(1, 1),
        ticket(10, "OPEN", 1),
        ticket(11, "OPEN", 2),
    ] {
        storage.apply(&w);
    }
    let users = MultiTableReadQuery::new(
        query(&sub_table("users"), Where::AND(vec![])),
        vec![Join::inner_from_main(
            MultiTableReadQuery::single(query(&profiles_table(), Where::AND(vec![]))),
            "id",
            "user_id",
        )],
    );
    let spec = left_joined(open_tickets(), vec![Join::left(users, "assigned_to", "id")]);
    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(1)",
            "q/main/add:Int(10)",
            "q/main/add:Int(11)",
            "q/part[0, 0]/add:Int(1)"
        ],
        "both tickets stand (LEFT); only the user with a profile is shown"
    );

    let ops = write(&mut ivm, &storage, profile(2, 2));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(2)", "q/part[0, 0]/add:Int(2)"],
        "the profile opens the gate on its user"
    );

    let ops = write(&mut ivm, &storage, delete("profiles", 1));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(1)", "q/part[0, 0]/del:Int(1)"],
        "the last profile leaving closes it"
    );
}

/// A chain of inner edges all evaluated from the main: a ticket is shown
/// only while its user is shown, and a user only while it has a profile,
/// so a held user whose own gate is closed opens nothing above it.
#[test]
fn a_main_driven_inner_chain_shows_only_rows_reaching_the_leaf() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        ticket(1, "OPEN", 1),
        ticket(2, "OPEN", 2),
        profile(1, 1),
    ] {
        storage.apply(&w);
    }
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::inner_from_main(
            MultiTableReadQuery::new(
                query(&sub_table("users"), Where::AND(vec![])),
                vec![Join::inner_from_main(
                    MultiTableReadQuery::single(query(&profiles_table(), Where::AND(vec![]))),
                    "id",
                    "user_id",
                )],
            ),
            "assigned_to",
            "id",
        )],
    );
    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(1)",
            "q/main/add:Int(1)",
            "q/part[0, 0]/add:Int(1)"
        ],
        "ticket 2's user has no profile, so neither is shown"
    );
    let ops = write(&mut ivm, &storage, profile(2, 2));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(2)",
            "q/main/add:Int(2)",
            "q/part[0, 0]/add:Int(2)"
        ]
    );
    let ops = write(&mut ivm, &storage, delete("profiles", 1));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/del:Int(1)",
            "q/main/del:Int(1)",
            "q/part[0, 0]/del:Int(1)"
        ]
    );
}

/// A sub-driven inner edge over a main-driven one: the users drive the
/// tickets, and a user is itself gated by its profiles. A held user whose
/// gate is closed must not drive: its ticket is not shown.
#[test]
fn a_gated_driver_drives_only_with_its_gate_open() {
    let (mut ivm, storage, names) = engine();
    for w in [
        user(1, "a"),
        user(2, "b"),
        ticket(1, "OPEN", 1),
        ticket(2, "OPEN", 2),
        profile(1, 1),
    ] {
        storage.apply(&w);
    }
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::inner(
            MultiTableReadQuery::new(
                query(&sub_table("users"), Where::AND(vec![])),
                vec![Join::inner_from_main(
                    MultiTableReadQuery::single(query(&profiles_table(), Where::AND(vec![]))),
                    "id",
                    "user_id",
                )],
            ),
            "assigned_to",
            "id",
        )],
    );
    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(1)",
            "q/main/add:Int(1)",
            "q/part[0, 0]/add:Int(1)"
        ],
        "user 2 has no profile, so it drives nothing"
    );
    let ops = write(&mut ivm, &storage, profile(2, 2));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(2)",
            "q/main/add:Int(2)",
            "q/part[0, 0]/add:Int(2)"
        ]
    );
    let ops = write(&mut ivm, &storage, delete("profiles", 1));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/del:Int(1)",
            "q/main/del:Int(1)",
            "q/part[0, 0]/del:Int(1)"
        ]
    );
}

/// The two first OPEN tickets whose assignee exists: a page that drives
/// its own inner edge.
fn first_two_tickets_with_a_user() -> MultiTableReadQuery {
    let mut main_table = open_tickets();
    main_table.limit = 2;
    MultiTableReadQuery::new(
        main_table,
        vec![Join::inner_from_main(
            MultiTableReadQuery::single(query(&sub_table("users"), Where::AND(vec![]))),
            "assigned_to",
            "id",
        )],
    )
}

/// The ids of the rows a subscription's part shows, sorted.
fn shown_ids(ivm: &Ivm, names: &Names, name: &str, part: QueryPart) -> Vec<i64> {
    let mut ids: Vec<i64> = ivm
        .engine()
        .rows_for(names.id(name), part)
        .unwrap_or_default()
        .keys()
        .map(|key| match key.pkey_value["id"] {
            Value::Int(id) => id,
            _ => panic!("an integer key"),
        })
        .collect();
    ids.sort_unstable();
    ids
}

/// A page that drives an inner edge is the best rows *the edge admits*:
/// tickets whose assignee does not exist take no place in it, the page
/// reaches past them, and it draws back when one of them is admitted.
#[test]
fn a_page_under_a_gate_holds_the_best_rows_the_gate_admits() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=8 {
        storage.apply(&ticket(id, "OPEN", id));
    }
    for id in [3, 6, 7] {
        storage.apply(&user(id, "u"));
    }
    let snapshot = names.register(&mut ivm, "q", first_two_tickets_with_a_user());
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(3)",
            "q/join0/add:Int(6)",
            "q/main/add:Int(3)",
            "q/main/add:Int(6)"
        ],
        "tickets 1, 2, 4 and 5 have no user: the page reaches to 3 and 6"
    );
    assert!(ivm.engine().hydrated(names.id("q")));

    let ops = write(&mut ivm, &storage, user(1, "a"));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(1)",
            "q/join0/del:Int(6)",
            "q/main/add:Int(1)",
            "q/main/del:Int(6)"
        ],
        "ticket 1 is admitted and takes the first place; ticket 6 leaves the page"
    );

    let ops = write(&mut ivm, &storage, delete("users", 3));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(6)",
            "q/join0/del:Int(3)",
            "q/main/add:Int(6)",
            "q/main/del:Int(3)"
        ],
        "ticket 3 is rejected again and the page reaches back to 6"
    );

    let ops = write(&mut ivm, &storage, delete("tickets", 1));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(7)",
            "q/join0/del:Int(1)",
            "q/main/add:Int(7)",
            "q/main/del:Int(1)"
        ],
        "a shown ticket leaving is replaced by the next admitted one"
    );

    let ops = write(&mut ivm, &storage, delete("users", 6));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/del:Int(6)", "q/main/del:Int(6)"],
        "nothing further is admitted: the page holds what there is"
    );
    assert_eq!(shown_ids(&ivm, &names, "q", QueryPart::main()), [7]);
    assert!(ivm.engine().hydrated(names.id("q")));
}

/// The page under a gate shows, at every step, what the same query shows
/// without a limit cut to its first rows: checked over a run of writes
/// that open and close gates and move rows in and out of the page.
#[test]
fn a_page_under_a_gate_is_the_unlimited_result_cut_to_the_limit() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=30 {
        storage.apply(&ticket(id, "OPEN", id % 7));
    }
    for id in [2, 5] {
        storage.apply(&user(id, "u"));
    }
    let mut unlimited = first_two_tickets_with_a_user();
    unlimited.main_table.limit = u32::MAX;
    let mut paged = first_two_tickets_with_a_user();
    paged.main_table.limit = 4;
    names.register(&mut ivm, "all", unlimited);
    names.register(&mut ivm, "page", paged);
    let check = |ivm: &Ivm, step: &str| {
        let all = shown_ids(ivm, &names, "all", QueryPart::main());
        let page = shown_ids(ivm, &names, "page", QueryPart::main());
        let expected: Vec<i64> = all.iter().copied().take(4).collect();
        assert_eq!(page, expected, "after {step}");
    };
    check(&ivm, "registration");
    let steps: Vec<(&str, WriteQuery)> = vec![
        ("user 0 arrives", user(0, "z")),
        ("user 2 leaves", delete("users", 2)),
        ("ticket 5 closes", update_ticket(5, "DONE", 5)),
        ("user 1 arrives", user(1, "a")),
        ("ticket 1 leaves", delete("tickets", 1)),
        ("user 0 leaves", delete("users", 0)),
        ("user 5 leaves", delete("users", 5)),
        ("user 1 leaves", delete("users", 1)),
        ("user 6 arrives", user(6, "f")),
        ("ticket 6 moves to user 3", update_ticket(6, "OPEN", 3)),
        ("user 3 arrives", user(3, "c")),
        ("ticket 40 arrives", ticket(40, "OPEN", 3)),
        ("ticket 3 leaves", delete("tickets", 3)),
    ];
    for (step, w) in steps {
        write(&mut ivm, &storage, w);
        check(&ivm, step);
    }
}

/// A page per parent row under a gate, the shape of "the latest
/// conversation of every channel whose first message I may see": each
/// team shows its newest member *that has a profile*, reaching past the
/// newer members without one.
#[test]
fn a_page_per_parent_under_a_gate_reaches_past_rejected_rows() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=4 {
        storage.apply(&member(id, 5));
    }
    storage.apply(&member(9, 6));
    storage.apply(&profile(100, 2));
    let mut members = query(&members_table(), Where::AND(vec![]));
    members.order_by = vec![OrderBy::new("id", Order::DESC)];
    members.limit = 1;
    let spec = left_joined(
        open_tickets(),
        vec![Join::left(
            MultiTableReadQuery::new(
                members,
                vec![Join::inner_from_main(
                    MultiTableReadQuery::single(query(&profiles_table(), Where::AND(vec![]))),
                    "id",
                    "user_id",
                )],
            ),
            "team_id",
            "team",
        )],
    );
    names.register(&mut ivm, "q", spec);

    let ops = write(&mut ivm, &storage, team_ticket(10, 5));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(2)",
            "q/main/add:Int(10)",
            "q/part[0, 0]/add:Int(100)"
        ],
        "members 4 and 3 have no profile: team 5's page reaches to member 2"
    );

    let ops = write(&mut ivm, &storage, profile(101, 4));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(4)",
            "q/join0/del:Int(2)",
            "q/part[0, 0]/add:Int(101)",
            "q/part[0, 0]/del:Int(100)"
        ],
        "member 4 is admitted and is newer: it takes the page"
    );

    let ops = write(&mut ivm, &storage, team_ticket(11, 6));
    assert_eq!(
        names.tags(&ops),
        ["q/main/add:Int(11)"],
        "team 6's only member has no profile: its page is empty"
    );

    let ops = write(&mut ivm, &storage, delete("profiles", 101));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(2)",
            "q/join0/del:Int(4)",
            "q/part[0, 0]/add:Int(100)",
            "q/part[0, 0]/del:Int(101)"
        ],
        "member 4 is rejected again and the page reaches back to member 2"
    );
    assert!(ivm.engine().hydrated(names.id("q")));
}

/// Seven hundred OPEN tickets whose assignee does not exist, then one
/// whose assignee does: what a page of two tickets with a user has to
/// reach past.
fn seed_seven_hundred_rejected(storage: &MemoryStorage) {
    for id in 1..=700 {
        storage.apply(&ticket(id, "OPEN", 10_000 + id));
    }
    storage.apply(&ticket(701, "OPEN", 7));
    storage.apply(&user(7, "g"));
}

/// A page whose gate turns nearly every row away reaches past them in
/// batches that double — the first hundred rows, then two hundred, then
/// four hundred — asking for each batch's subs in one read, and drops the
/// rows it rejects; it stops when storage runs dry, short but not capped.
#[test]
fn a_page_reaches_past_hundreds_of_rejected_rows_in_doubling_batches() {
    let (mut ivm, storage, names) = engine();
    seed_seven_hundred_rejected(&storage);
    let snapshot = names.register(&mut ivm, "q", first_two_tickets_with_a_user());
    assert_eq!(
        names.tags(&snapshot),
        ["q/join0/add:Int(7)", "q/main/add:Int(701)"],
        "ticket 701 lies behind 700 rejected rows: the page reaches it"
    );
    assert!(ivm.engine().hydrated(names.id("q")));
    assert!(
        ivm.engine_mut().take_capped().is_empty(),
        "the page is short because storage ran dry, not because it gave up"
    );
    let stats = ivm.engine().stats();
    assert_eq!(
        stats.window_rejections, 700,
        "every rejected row was dropped, none read twice: the order ends in the key, so each refill starts strictly past the frontier"
    );
    assert_eq!(stats.window_capped, 0);
    assert_eq!(
        stats.page_rounds, 3,
        "batches of 200, 400 and 800 after the first hundred"
    );
    assert_eq!(stats.window_refills, 3);
    assert_eq!(
        stats.storage_reads, 8,
        "the first batch, three more, and one read of the users per batch"
    );
    assert_eq!(
        frame_len(&ivm, &names, "q", QueryPart::main()),
        1,
        "the rejected rows are gone, not held"
    );
}

/// Read whole, the same page holds every ticket from its one read, takes
/// its batches from memory (no further storage read of the tickets),
/// keeps the rows it rejects apart, and, when the user of one of them
/// appears, decides that row again without a lookup.
#[test]
fn a_page_read_whole_reaches_from_memory_and_keeps_its_rejected_rows() {
    let (mut ivm, storage, names) = engine();
    seed_seven_hundred_rejected(&storage);
    let mut whole = first_two_tickets_with_a_user();
    whole.page = PageRead::Whole;
    let snapshot = names.register(&mut ivm, "q", whole);
    assert_eq!(
        names.tags(&snapshot),
        ["q/join0/add:Int(7)", "q/main/add:Int(701)"]
    );
    let stats = ivm.engine().stats().clone();
    assert_eq!(
        stats.window_refills, 0,
        "no storage read of the tickets past the first"
    );
    assert_eq!(
        stats.page_rounds, 4,
        "batches of 100, 200, 400 and the last row, from memory"
    );
    assert_eq!(
        stats.storage_reads, 5,
        "one read of the tickets, one of the users per batch"
    );
    assert_eq!(stats.window_rejections, 700);

    let ops = write(&mut ivm, &storage, user(10_001, "a"));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(10001)", "q/main/add:Int(1)"],
        "ticket 1's user appeared: the row kept apart takes the first place"
    );
    assert_eq!(shown_ids(&ivm, &names, "q", QueryPart::main()), [1, 701]);
    let after = ivm.engine().stats();
    assert_eq!(
        after.page_lookups, 0,
        "the row was in memory: nothing to look up"
    );
    assert_eq!(
        after.storage_reads,
        stats.storage_reads + 1,
        "one read of the user's rows for the row decided again: {after:#?}"
    );
}

/// A row a page dropped comes back through a lookup when a write on the
/// driven side concerns its value: the page is asked for its rows with
/// that value, once. A write carrying a value the page never dropped is
/// not looked up: no held row carries it, and a lookup could only bring
/// back a dropped one (rows behind the frontier land nothing).
#[test]
fn a_dropped_row_comes_back_through_a_lookup_when_its_gate_opens() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=8 {
        storage.apply(&ticket(id, "OPEN", id));
    }
    for id in [3, 6, 7] {
        storage.apply(&user(id, "u"));
    }
    names.register(&mut ivm, "q", first_two_tickets_with_a_user());
    assert_eq!(shown_ids(&ivm, &names, "q", QueryPart::main()), [3, 6]);
    let before = ivm.engine().stats().clone();

    let ops = write(&mut ivm, &storage, user(99, "nobody's"));
    assert!(ops.is_empty());
    let asked = ivm.engine().stats().clone();
    assert_eq!(
        asked.page_lookups, 0,
        "no ticket the page dropped names user 99: nothing to look up"
    );
    assert_eq!(
        asked.storage_reads, before.storage_reads,
        "nothing is read for a value the page never dropped"
    );
    assert_eq!(shown_ids(&ivm, &names, "q", QueryPart::main()), [3, 6]);

    let ops = write(&mut ivm, &storage, user(1, "a"));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(1)",
            "q/join0/del:Int(6)",
            "q/main/add:Int(1)",
            "q/main/del:Int(6)"
        ],
        "ticket 1 was dropped; its user's arrival looks it up and it takes the first place"
    );
    let after = ivm.engine().stats();
    assert_eq!(after.page_lookups, 1);
    assert_eq!(
        after.storage_reads,
        asked.storage_reads + 2,
        "the lookup of ticket 1, and the read of its user"
    );
    assert!(ivm.engine().hydrated(names.id("q")));
}

/// The per-parent windows under a paged root: the root is an ordinary
/// page (nothing gates it), each of its rows has a window of one member
/// with a profile, and a member the window dropped comes back when its
/// profile arrives — the shape of the DM list's latest visible
/// conversation per channel.
#[test]
fn per_parent_windows_under_a_gate_work_below_a_paged_root() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=4 {
        storage.apply(&member(id, 5));
    }
    storage.apply(&member(9, 6));
    storage.apply(&profile(100, 2));
    storage.apply(&team_ticket(10, 5));
    storage.apply(&team_ticket(11, 6));
    storage.apply(&team_ticket(12, 7));
    let mut members = query(&members_table(), Where::AND(vec![]));
    members.order_by = vec![OrderBy::new("id", Order::DESC)];
    members.limit = 1;
    let mut root = open_tickets();
    root.limit = 2;
    let spec = left_joined(
        root,
        vec![Join::left(
            MultiTableReadQuery::new(
                members,
                vec![Join::inner_from_main(
                    MultiTableReadQuery::single(query(&profiles_table(), Where::AND(vec![]))),
                    "id",
                    "user_id",
                )],
            ),
            "team_id",
            "team",
        )],
    );
    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        [
            "q/join0/add:Int(2)",
            "q/main/add:Int(10)",
            "q/main/add:Int(11)",
            "q/part[0, 0]/add:Int(100)"
        ],
        "the page holds tickets 10 and 11; team 5's window reaches member 2, team 6's is empty"
    );
    assert!(ivm.engine().hydrated(names.id("q")));

    let ops = write(&mut ivm, &storage, profile(101, 4));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(4)",
            "q/join0/del:Int(2)",
            "q/part[0, 0]/add:Int(101)",
            "q/part[0, 0]/del:Int(100)"
        ],
        "member 4 was dropped; its profile's arrival looks it up and it takes team 5's window"
    );

    let ops = write(&mut ivm, &storage, profile(102, 9));
    assert_eq!(
        names.tags(&ops),
        ["q/join0/add:Int(9)", "q/part[0, 0]/add:Int(102)"],
        "team 6's only member gets a profile and fills its window"
    );

    let ops = write(&mut ivm, &storage, delete("tickets", 10));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/del:Int(4)",
            "q/main/add:Int(12)",
            "q/main/del:Int(10)",
            "q/part[0, 0]/del:Int(101)"
        ],
        "the root page refills with ticket 12 (team 7 has no members); team 5's window goes with its ticket"
    );
    assert!(ivm.engine().hydrated(names.id("q")));
}

/// A page still short after ten rounds is capped and reported: it holds
/// what it found and reaches no further until one of its admitted rows
/// leaves, which starts the rounds over from where it stopped.
#[test]
fn a_page_short_after_ten_rounds_is_capped_until_an_admitted_row_leaves() {
    let (mut ivm, storage, names) = engine_with_row_limit(50);
    storage.apply(&ticket(1, "OPEN", 1));
    storage.apply(&user(1, "a"));
    for id in 2..=800 {
        storage.apply(&ticket(id, "OPEN", 10_000 + id));
    }
    storage.apply(&ticket(801, "OPEN", 7));
    storage.apply(&user(7, "g"));
    let snapshot = names.register(&mut ivm, "q", first_two_tickets_with_a_user());
    assert_eq!(
        names.tags(&snapshot),
        ["q/join0/add:Int(1)", "q/main/add:Int(1)"],
        "batches of fifty: ten rounds after the first reach row 550, short of ticket 801"
    );
    assert!(ivm.engine().hydrated(names.id("q")));
    assert_eq!(ivm.engine_mut().take_capped(), [names.id("q")], "reported");
    assert!(ivm.engine_mut().take_capped().is_empty(), "once");
    let stats = ivm.engine().stats().clone();
    assert_eq!(stats.window_capped, 1);
    assert_eq!(stats.page_rounds, 10);
    assert_eq!(stats.window_rejections, 549);

    let ops = write(&mut ivm, &storage, user(20_000, "unrelated"));
    assert!(ops.is_empty());
    assert_eq!(
        ivm.engine().stats().page_rounds,
        10,
        "a capped page does not reach again for a write that changes nothing it holds"
    );

    let ops = write(&mut ivm, &storage, delete("tickets", 1));
    assert_eq!(
        names.tags(&ops),
        [
            "q/join0/add:Int(7)",
            "q/join0/del:Int(1)",
            "q/main/add:Int(801)",
            "q/main/del:Int(1)"
        ],
        "the shown ticket left: the page reaches on from row 550 and finds ticket 801"
    );
    let after = ivm.engine().stats();
    assert!(
        (15..=17).contains(&after.page_rounds),
        "five or six more batches of fifty to row 801: {}",
        after.page_rounds
    );
    assert_eq!(after.window_capped, 1, "not capped again: storage ran dry");
    assert!(ivm.engine().hydrated(names.id("q")));
}

/// The join values a landing references are asked for in one narrowed
/// read of the driven part, however many they are.
#[test]
fn the_values_of_one_step_are_fetched_in_one_read() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=50 {
        storage.apply(&user(id, "u"));
        storage.apply(&ticket(id, "OPEN", id));
    }
    names.register(&mut ivm, "q", tickets_users_query());
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 50);
    assert_eq!(
        ivm.engine().stats().storage_reads,
        2,
        "the tickets' snapshot, and one read for the fifty users they name"
    );
}
