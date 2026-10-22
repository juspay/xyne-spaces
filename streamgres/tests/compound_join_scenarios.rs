//! Scenarios for joins on a composite key — `(org, id)` on the tickets
//! against `(org, ticket)` on the comments — driven through
//! `MemoryStorage` like the single-column scenarios: every write is
//! mirrored into storage first and then routed. A key is the pair, so a
//! comment of the same ticket number in another org is never a match, a
//! `NULL` in either column joins nothing, `7` and `7.0` are one key, and
//! a change to either column moves the row.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use streamgres::ivm::{Delta, MultiTableIVM, QueryPart, SubId};
use streamgres::model::*;
use streamgres::sync::{Local, MemoryStorage};

type Ivm = Local<MultiTableIVM, MemoryStorage>;

/// `tickets(id, org, status, reviewer)`.
fn tickets_table() -> DbTable {
    DbTable::new(
        "tickets",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("org", ValueType::Int),
            DbColumn::new("status", ValueType::String),
            DbColumn::new("reviewer", ValueType::Int),
        ],
    )
}

/// `comments(id, org, ticket, author)`.
fn comments_table() -> DbTable {
    DbTable::new(
        "comments",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("org", ValueType::Int),
            DbColumn::new("ticket", ValueType::Int),
            DbColumn::new("author", ValueType::Int),
        ],
    )
}

/// `threads(id, org, parent)`: a thread's replies are the threads of
/// its org whose `parent` is its id.
fn threads_table() -> DbTable {
    DbTable::new(
        "threads",
        ["id"],
        vec![
            DbColumn::new("id", ValueType::Int),
            DbColumn::new("org", ValueType::Int),
            DbColumn::new("parent", ValueType::Int),
        ],
    )
}

/// The composite key of `a` and `b`.
fn key(a: &str, b: &str) -> ColumnName {
    ColumnName::composite([a, b])
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

/// `OPEN` tickets.
fn open_tickets() -> SingleTableReadQuery {
    query(
        &tickets_table(),
        Where::condition("status", ComparisonOperator::EQ, "OPEN"),
    )
}

/// Every comment.
fn comments() -> MultiTableReadQuery {
    MultiTableReadQuery::single(query(&comments_table(), Where::AND(vec![])))
}

/// OPEN tickets LEFT JOIN comments on `(org, id) = (org, ticket)`.
fn tickets_comments_query() -> MultiTableReadQuery {
    MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::left(
            comments(),
            key("org", "id"),
            key("org", "ticket"),
        )],
    )
}

/// The primary key of row `id`.
fn pkey(id: i64) -> HashMap<ColumnName, Value> {
    HashMap::from([("id".into(), Value::Int(id))])
}

/// A full row image from `(column, value)` pairs plus the `id` key.
fn full_row(id: i64, pairs: &[(&str, Value)]) -> DataFrameRow {
    let mut data: HashMap<ColumnName, Value> = pairs
        .iter()
        .map(|(column, value)| ((*column).into(), value.clone()))
        .collect();
    data.insert("id".into(), Value::Int(id));
    DataFrameRow::from(data)
}

/// An `INSERT` of row `id` with `pairs` into `table`.
fn insert(table: &str, id: i64, pairs: &[(&str, Value)]) -> WriteQuery {
    WriteQuery::INSERT(InsertQuery {
        table: TableName::from(table),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: full_row(id, pairs),
    })
}

/// An `UPDATE` of row `id` in `table` to `pairs`, a full image.
fn update(table: &str, id: i64, pairs: &[(&str, Value)]) -> WriteQuery {
    WriteQuery::UPDATE(UpdateQuery {
        table: TableName::from(table),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: full_row(id, pairs),
    })
}

/// A `DELETE` of row `id` from `table`.
fn delete(table: &str, id: i64) -> WriteQuery {
    WriteQuery::DELETE(DeleteQuery {
        table: TableName::from(table),
        pkey_value: DataFrameKey::new(pkey(id)),
    })
}

/// An OPEN ticket `id` of `org` reviewed by `reviewer`.
fn ticket(id: i64, org: i64, reviewer: i64) -> WriteQuery {
    insert(
        "tickets",
        id,
        &[
            ("org", Value::Int(org)),
            ("status", "OPEN".into()),
            ("reviewer", Value::Int(reviewer)),
        ],
    )
}

/// A comment `id` on ticket `ticket` of `org`, by author 1.
fn comment(id: i64, org: Value, ticket: i64) -> WriteQuery {
    insert(
        "comments",
        id,
        &[
            ("org", org),
            ("ticket", Value::Int(ticket)),
            ("author", Value::Int(1)),
        ],
    )
}

/// [`comment`] as an update, moving the comment to `(org, ticket)`.
fn move_comment(id: i64, org: Value, ticket: i64) -> WriteQuery {
    update(
        "comments",
        id,
        &[
            ("org", org),
            ("ticket", Value::Int(ticket)),
            ("author", Value::Int(1)),
        ],
    )
}

/// Mirror the write into storage, then route it.
fn write(ivm: &mut Ivm, storage: &MemoryStorage, w: WriteQuery) -> Vec<Delta> {
    storage.apply(&w);
    ivm.incremental_update(&w)
}

/// A fresh engine over an in-memory storage, with a name table.
fn engine() -> (Ivm, Rc<MemoryStorage>, Names) {
    let storage = Rc::new(MemoryStorage::new());
    let ivm = Local::new(MultiTableIVM::new(), storage.clone());
    (ivm, storage, Names::default())
}

/// Readable names for subscription ids and a compact rendering of the
/// deltas, one tag per targeted part.
#[derive(Default)]
struct Names {
    ids: RefCell<HashMap<String, SubId>>,
    names: RefCell<HashMap<SubId, String>>,
}

impl Names {
    /// Register `spec` as `name`, returning what the registration emitted.
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

    /// The subscription registered as `name`.
    fn id(&self, name: &str) -> SubId {
        self.ids.borrow()[name]
    }

    /// The name a subscription was registered as.
    fn name(&self, id: SubId) -> String {
        self.names.borrow()[&id].clone()
    }

    /// `ops` as sorted `name/part/op:key` tags.
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

/// How many rows `part` of the subscription `name` holds.
fn frame_len(ivm: &Ivm, names: &Names, name: &str, part: QueryPart) -> usize {
    ivm.engine()
        .rows_for(names.id(name), part)
        .map_or(0, |rows| rows.len())
}

/// The snapshot fetches the comments of each ticket's `(org, id)` pair
/// and nothing else: not a comment of the same ticket number in another
/// org, not one of another ticket.
#[test]
fn registration_fetches_the_comments_of_each_pair() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&comment(1, Value::Int(7), 42));
    storage.apply(&comment(2, Value::Int(8), 42));
    storage.apply(&comment(3, Value::Int(7), 43));
    storage.apply(&ticket(42, 7, 1));

    let snapshot = names.register(&mut ivm, "q", tickets_comments_query());
    assert_eq!(
        names.tags(&snapshot),
        vec!["q/join0/add:Int(1)", "q/main/add:Int(42)"]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// A comment routes on the whole pair: one carrying a referenced pair
/// arrives, one of the same ticket number in another org does not, a
/// `NULL` org joins nothing, and an org written as `7.0` is the org `7`.
#[test]
fn a_comment_routes_on_the_whole_pair() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&ticket(42, 7, 1));
    names.register(&mut ivm, "q", tickets_comments_query());

    let ops = write(&mut ivm, &storage, comment(1, Value::Int(7), 42));
    assert_eq!(names.tags(&ops), vec!["q/join0/add:Int(1)"]);

    let ops = write(&mut ivm, &storage, comment(2, Value::Int(8), 42));
    assert!(ops.is_empty(), "another org: {:?}", names.tags(&ops));

    let ops = write(&mut ivm, &storage, comment(3, Value::Null, 42));
    assert!(ops.is_empty(), "a NULL component: {:?}", names.tags(&ops));

    let ops = write(&mut ivm, &storage, comment(4, Value::Float(7.0), 42));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(4)"],
        "7.0 and 7 are one key"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 2);
}

/// Changing either column of the key moves the comment: to an
/// unreferenced pair (the org changes, the ticket number stays) it
/// leaves; between two referenced pairs it is replaced in place; back to
/// a referenced pair it returns.
#[test]
fn a_change_to_either_column_moves_the_comment() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&ticket(42, 7, 1));
    storage.apply(&ticket(43, 7, 1));
    storage.apply(&comment(1, Value::Int(7), 42));
    names.register(&mut ivm, "q", tickets_comments_query());

    let ops = write(&mut ivm, &storage, move_comment(1, Value::Int(8), 42));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(1)"],
        "the ticket number alone is not the key"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 0);

    let ops = write(&mut ivm, &storage, move_comment(1, Value::Int(7), 43));
    assert_eq!(names.tags(&ops), vec!["q/join0/add:Int(1)"]);

    let ops = write(&mut ivm, &storage, move_comment(1, Value::Int(7), 42));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(1)"],
        "between two referenced pairs the row is replaced in place"
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// A ticket arriving fetches the comments of its pair alone, and the last
/// ticket of a pair leaving prunes exactly that pair's comments.
#[test]
fn a_ticket_fetches_and_prunes_by_pair() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&comment(1, Value::Int(7), 50));
    storage.apply(&comment(2, Value::Int(8), 50));
    storage.apply(&comment(3, Value::Int(7), 51));
    storage.apply(&ticket(51, 7, 1));
    names.register(&mut ivm, "q", tickets_comments_query());
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);

    let ops = write(&mut ivm, &storage, ticket(50, 7, 1));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(1)", "q/main/add:Int(50)"],
        "the org-8 comment of ticket 50 is not fetched"
    );

    let ops = write(&mut ivm, &storage, delete("tickets", 50));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(1)", "q/main/del:Int(50)"]
    );
    assert_eq!(
        frame_len(&ivm, &names, "q", QueryPart::join(0)),
        1,
        "ticket 51's comment stays"
    );
}

/// A ticket whose org changes moves its reference: the comments of the
/// old pair are pruned and those of the new pair fetched.
#[test]
fn a_ticket_changing_org_moves_its_reference() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&comment(1, Value::Int(7), 42));
    storage.apply(&comment(2, Value::Int(8), 42));
    storage.apply(&ticket(42, 7, 1));
    names.register(&mut ivm, "q", tickets_comments_query());
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);

    let ops = write(
        &mut ivm,
        &storage,
        update(
            "tickets",
            42,
            &[
                ("org", Value::Int(8)),
                ("status", "OPEN".into()),
                ("reviewer", Value::Int(1)),
            ],
        ),
    );
    assert_eq!(
        names.tags(&ops),
        vec![
            "q/join0/add:Int(2)",
            "q/join0/del:Int(1)",
            "q/main/add:Int(42)"
        ]
    );
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::join(0)), 1);
}

/// One sub table joined through two composite keys at once — the
/// comments of a ticket by `(org, id) = (org, ticket)` and the comments
/// its reviewer wrote by `(org, reviewer) = (org, author)` — holds each
/// row independently per part, and a deletion reaches both.
#[test]
fn two_composite_keys_on_one_sub_table() {
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![
            Join::left(comments(), key("org", "id"), key("org", "ticket")),
            Join::left(comments(), key("org", "reviewer"), key("org", "author")),
        ],
    );
    let (mut ivm, storage, names) = engine();
    storage.apply(&ticket(42, 7, 1));
    names.register(&mut ivm, "q", spec);

    let ops = write(&mut ivm, &storage, comment(1, Value::Int(7), 42));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(1)", "q/join1/add:Int(1)"],
        "on ticket 42 and by the reviewer, author 1"
    );

    let ops = write(&mut ivm, &storage, comment(2, Value::Int(7), 99));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join1/add:Int(2)"],
        "by the reviewer, on another ticket"
    );

    let ops = write(&mut ivm, &storage, delete("comments", 1));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(1)", "q/join1/del:Int(1)"]
    );
}

/// An `EXISTS` on a composite key, driven from the sub: the tickets with
/// a comment of their pair. A comment arriving admits its ticket, the
/// last comment leaving retracts it, and a comment of another org admits
/// nothing.
#[test]
fn an_exists_on_a_composite_key_drives_the_main() {
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::inner(
            comments(),
            key("org", "id"),
            key("org", "ticket"),
        )],
    );
    let (mut ivm, storage, names) = engine();
    storage.apply(&ticket(42, 7, 1));
    storage.apply(&ticket(43, 7, 1));
    storage.apply(&comment(1, Value::Int(7), 42));
    storage.apply(&comment(2, Value::Int(8), 43));

    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        vec!["q/join0/add:Int(1)", "q/main/add:Int(42)"]
    );

    let ops = write(&mut ivm, &storage, comment(3, Value::Int(7), 43));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(3)", "q/main/add:Int(43)"]
    );

    let ops = write(&mut ivm, &storage, delete("comments", 3));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(3)", "q/main/del:Int(43)"]
    );

    let ops = write(&mut ivm, &storage, comment(4, Value::Int(8), 42));
    assert!(ops.is_empty(), "{:?}", names.tags(&ops));
}

/// The same test evaluated from the main (the planner's other choice):
/// the comments are narrowed to the tickets' pairs and a ticket is shown
/// while one of them matches it.
#[test]
fn a_composite_gate_from_the_main_shows_the_same_rows() {
    let spec = MultiTableReadQuery::new(
        open_tickets(),
        vec![Join::inner_from_main(
            comments(),
            key("org", "id"),
            key("org", "ticket"),
        )],
    );
    let (mut ivm, storage, names) = engine();
    storage.apply(&ticket(42, 7, 1));
    storage.apply(&ticket(43, 7, 1));
    storage.apply(&comment(1, Value::Int(7), 42));
    storage.apply(&comment(2, Value::Int(8), 43));

    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        vec!["q/join0/add:Int(1)", "q/main/add:Int(42)"]
    );

    let ops = write(&mut ivm, &storage, comment(3, Value::Int(7), 43));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(3)", "q/main/add:Int(43)"]
    );

    let ops = write(&mut ivm, &storage, move_comment(3, Value::Int(8), 43));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(3)", "q/main/del:Int(43)"],
        "the gate closes when the comment's org changes"
    );
}

/// A `LIMIT` on the comments is a window per `(org, ticket)` pair: the
/// newest comment of each pair, a newer one evicting it, and a comment of
/// the same ticket number in another org outside every window.
#[test]
fn a_window_per_parent_on_a_composite_key() {
    let mut spec = tickets_comments_query();
    let sub = &mut spec.joins[0].sub.main_table;
    sub.order_by = vec![OrderBy::new("id", Order::DESC)];
    sub.limit = 1;
    let (mut ivm, storage, names) = engine();
    storage.apply(&comment(1, Value::Int(7), 42));
    storage.apply(&comment(2, Value::Int(7), 42));
    storage.apply(&ticket(42, 7, 1));

    let snapshot = names.register(&mut ivm, "q", spec);
    assert_eq!(
        names.tags(&snapshot),
        vec!["q/join0/add:Int(2)", "q/main/add:Int(42)"]
    );

    let ops = write(&mut ivm, &storage, comment(3, Value::Int(7), 42));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(3)", "q/join0/del:Int(2)"]
    );

    let ops = write(&mut ivm, &storage, comment(4, Value::Int(8), 42));
    assert!(ops.is_empty(), "{:?}", names.tags(&ops));
}

/// A self join on a composite key: a thread's replies are the threads of
/// its own org whose parent it is.
#[test]
fn a_self_join_on_a_composite_key() {
    let threads = |filter| MultiTableReadQuery::single(query(&threads_table(), filter));
    let spec = MultiTableReadQuery::new(
        query(
            &threads_table(),
            Where::condition("parent", ComparisonOperator::IS, Value::Null),
        ),
        vec![Join::left(
            threads(Where::AND(vec![])),
            key("org", "id"),
            key("org", "parent"),
        )],
    );
    let (mut ivm, storage, names) = engine();
    let thread = |id: i64, org: i64, parent: Value| {
        insert(
            "threads",
            id,
            &[("org", Value::Int(org)), ("parent", parent)],
        )
    };
    storage.apply(&thread(1, 7, Value::Null));
    names.register(&mut ivm, "q", spec);

    let ops = write(&mut ivm, &storage, thread(2, 7, Value::Int(1)));
    assert_eq!(names.tags(&ops), vec!["q/join0/add:Int(2)"]);

    let ops = write(&mut ivm, &storage, thread(3, 8, Value::Int(1)));
    assert!(
        ops.is_empty(),
        "another org's reply: {:?}",
        names.tags(&ops)
    );

    let ops = write(&mut ivm, &storage, delete("threads", 1));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(2)", "q/main/del:Int(1)"]
    );
}

/// A set of pairs past the filing limit (1024 members) is probed by
/// membership instead of filed per member; writes route the same either
/// way, and a pair leaving the set still prunes its rows.
#[test]
fn a_large_set_of_pairs_is_probed() {
    let (mut ivm, storage, names) = engine();
    for id in 1..=1100 {
        storage.apply(&ticket(id, 7, 1));
    }
    names.register(&mut ivm, "q", tickets_comments_query());
    assert_eq!(frame_len(&ivm, &names, "q", QueryPart::main()), 1100);

    let ops = write(&mut ivm, &storage, comment(1, Value::Int(7), 1100));
    assert_eq!(names.tags(&ops), vec!["q/join0/add:Int(1)"]);

    let ops = write(&mut ivm, &storage, comment(2, Value::Int(8), 1100));
    assert!(ops.is_empty(), "{:?}", names.tags(&ops));

    let ops = write(&mut ivm, &storage, delete("tickets", 1100));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/del:Int(1)", "q/main/del:Int(1100)"]
    );
}

/// A second subscription with the same spec shares the tree: it is served
/// the shown rows and a write costs one operation for both.
#[test]
fn identical_composite_subscriptions_share_one_tree() {
    let (mut ivm, storage, names) = engine();
    storage.apply(&ticket(42, 7, 1));
    storage.apply(&comment(1, Value::Int(7), 42));
    names.register(&mut ivm, "q", tickets_comments_query());
    let twin = names.register(&mut ivm, "twin", tickets_comments_query());
    assert_eq!(
        names.tags(&twin),
        vec!["twin/join0/add:Int(1)", "twin/main/add:Int(42)"]
    );

    let ops = write(&mut ivm, &storage, comment(2, Value::Int(7), 42));
    assert_eq!(
        names.tags(&ops),
        vec!["q/join0/add:Int(2)", "twin/join0/add:Int(2)"]
    );
    assert_eq!(ops.len(), 1, "one operation carries both subscribers");
}
