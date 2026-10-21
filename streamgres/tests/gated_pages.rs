//! The join layer against a reference evaluator, over runs of random
//! writes: inner edges driven from either side, chains of them, `EXISTS`
//! inside `OR`, and pages (`ORDER BY` / `LIMIT`) that drive their own
//! inner edges, at the root and per parent row. After every write each
//! subscription's parts must show exactly what evaluating its query over
//! the storage from scratch gives: a row passes when its own `WHERE`
//! holds with every `EXISTS` answered by a passing row of that sub, a
//! page is the best rows *that pass*, and a sub's rows are shown under
//! the shown rows of its parent.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::rc::Rc;

use streamgres::ivm::{Engine, Fetch, MultiTableIVM, QueryPart, SubId, evaluate_with, order_rows};
use streamgres::model::*;
use streamgres::sync::{Local, Lsn, MemoryStorage, Runtime, Snapshot};

/// The join layer under the synchronous driver: every read is landed
/// inline.
type Ivm = Local<MultiTableIVM, MemoryStorage>;

/// A table of integer columns keyed by `id`.
fn table(name: &str, columns: &[&str]) -> DbTable {
    let mut all = vec![DbColumn::new("id", ValueType::Int)];
    all.extend(
        columns
            .iter()
            .map(|column| DbColumn::new(*column, ValueType::Int)),
    );
    DbTable::new(name, ["id"], all)
}

/// `table WHERE filter ORDER BY order, id LIMIT limit`.
fn node(name: &str, filter: Where, order: &[(&str, Order)], limit: u32) -> SingleTableReadQuery {
    let mut order_by: Vec<OrderBy> = order
        .iter()
        .map(|(column, direction)| OrderBy::new(*column, *direction))
        .collect();
    order_by.push(OrderBy::new("id", Order::ASC));
    SingleTableReadQuery {
        table: TableName::from(name),
        filter,
        order_by,
        limit,
    }
}

/// Every row of `name`.
fn all(name: &str) -> SingleTableReadQuery {
    node(name, Where::AND(Vec::new()), &[], u32::MAX)
}

/// `open = 1`.
fn open() -> Where {
    Where::condition("open", ComparisonOperator::EQ, Value::Int(1))
}

/// `spec` with its root page read whole.
fn whole(mut spec: MultiTableReadQuery) -> MultiTableReadQuery {
    spec.page = PageRead::Whole;
    spec
}

/// The subscriptions under test, by name.
fn specs() -> Vec<(&'static str, MultiTableReadQuery)> {
    let users = || MultiTableReadQuery::single(all("users"));
    let profiles = || MultiTableReadQuery::single(all("profiles"));
    let users_with_profiles = |driver: fn(MultiTableReadQuery, &str, &str) -> Join| {
        MultiTableReadQuery::new(all("users"), vec![driver(profiles(), "id", "user_id")])
    };
    let from_main = |sub, main: &str, column: &str| Join::inner_from_main(sub, main, column);
    let from_sub = |sub, main: &str, column: &str| Join::inner(sub, main, column);
    vec![
        (
            "inner from the main",
            MultiTableReadQuery::new(
                node("tickets", open(), &[], u32::MAX),
                vec![Join::inner_from_main(users(), "assignee", "id")],
            ),
        ),
        (
            "a chain from the main",
            MultiTableReadQuery::new(
                node("tickets", open(), &[], u32::MAX),
                vec![Join::inner_from_main(
                    users_with_profiles(from_main),
                    "assignee",
                    "id",
                )],
            ),
        ),
        (
            "a gated driver",
            MultiTableReadQuery::new(
                node("tickets", open(), &[], u32::MAX),
                vec![Join::inner(
                    users_with_profiles(from_main),
                    "assignee",
                    "id",
                )],
            ),
        ),
        (
            "a chain from the subs",
            MultiTableReadQuery::new(
                node("tickets", open(), &[], u32::MAX),
                vec![Join::inner(users_with_profiles(from_sub), "assignee", "id")],
            ),
        ),
        (
            "a page under a gate",
            MultiTableReadQuery::new(
                node("tickets", open(), &[], 3),
                vec![Join::inner_from_main(users(), "assignee", "id")],
            ),
        ),
        (
            "a page under a chain",
            MultiTableReadQuery::new(
                node("tickets", open(), &[("project", Order::DESC)], 3),
                vec![Join::inner_from_main(
                    users_with_profiles(from_main),
                    "assignee",
                    "id",
                )],
            ),
        ),
        (
            "a page under a gate, read whole",
            whole(MultiTableReadQuery::new(
                node("tickets", open(), &[], 3),
                vec![Join::inner_from_main(users(), "assignee", "id")],
            )),
        ),
        (
            "a page under a chain, read whole",
            whole(MultiTableReadQuery::new(
                node("tickets", open(), &[("project", Order::DESC)], 3),
                vec![Join::inner_from_main(
                    users_with_profiles(from_main),
                    "assignee",
                    "id",
                )],
            )),
        ),
        (
            "a page under a gate inside OR",
            MultiTableReadQuery::new(
                node(
                    "tickets",
                    Where::AND(vec![
                        open(),
                        Where::OR(vec![
                            Where::condition("project", ComparisonOperator::EQ, Value::Int(0)),
                            Where::exists("assignee", 0),
                        ]),
                    ]),
                    &[("project", Order::ASC)],
                    4,
                ),
                vec![Join::inner_from_main(users(), "assignee", "id")],
            ),
        ),
        (
            "a page under a gate and a restriction",
            MultiTableReadQuery::new(
                node("tickets", open(), &[], 2),
                vec![
                    Join::inner_from_main(users(), "assignee", "id"),
                    Join::inner(
                        MultiTableReadQuery::single(node(
                            "teams",
                            Where::condition("active", ComparisonOperator::EQ, Value::Int(1)),
                            &[],
                            u32::MAX,
                        )),
                        "team",
                        "id",
                    ),
                ],
            ),
        ),
        (
            "a page per parent under a gate",
            MultiTableReadQuery::new(
                node("teams", Where::AND(Vec::new()), &[], u32::MAX),
                vec![Join::left(
                    MultiTableReadQuery::new(
                        node("tickets", open(), &[("project", Order::DESC)], 2),
                        vec![Join::inner_from_main(users(), "assignee", "id")],
                    ),
                    "id",
                    "team",
                )],
            ),
        ),
        (
            "a page per parent under a gate below a paged root",
            MultiTableReadQuery::new(
                node(
                    "teams",
                    Where::AND(Vec::new()),
                    &[("active", Order::DESC)],
                    2,
                ),
                vec![Join::left(
                    MultiTableReadQuery::new(
                        node("tickets", open(), &[("project", Order::DESC)], 2),
                        vec![Join::inner_from_main(users(), "assignee", "id")],
                    ),
                    "id",
                    "team",
                )],
            ),
        ),
    ]
}

/// A row's value in `column`.
fn value_of(row: &DataFrameRow, column: &ColumnName) -> Value {
    row.data
        .get(column.as_str())
        .cloned()
        .unwrap_or(Value::Null)
}

/// A row's `id`.
fn id_of(key: &DataFrameKey) -> i64 {
    match key.pkey_value["id"] {
        Value::Int(id) => id,
        _ => panic!("an integer key"),
    }
}

/// The rows of `spec`'s node that pass: their own `WHERE` with every
/// `EXISTS` leaf answered by a passing row of the inner sub it names, and
/// the inner subs no leaf names conjoined.
fn passing(
    spec: &MultiTableReadQuery,
    storage: &MemoryStorage,
) -> Vec<(DataFrameKey, DataFrameRow)> {
    let inner: Vec<(&Join, Vec<Value>)> = spec
        .joins
        .iter()
        .filter(|join| join.is_inner)
        .map(|join| {
            let values = passing(&join.sub, storage)
                .iter()
                .map(|(_, row)| value_of(row, &join.sub_table_column))
                .collect();
            (join, values)
        })
        .collect();
    let named: Vec<bool> = inner
        .iter()
        .enumerate()
        .map(|(index, (join, _))| {
            spec.main_table.filter.contains(&Condition::new(
                join.main_table_column.clone(),
                ComparisonOperator::EXISTS,
                Value::Int(index as i64),
            ))
        })
        .collect();
    storage
        .rows(&all(spec.main_table.table.as_str()))
        .into_iter()
        .filter(|(_, row)| {
            let exists = |leaf: &Condition| -> bool {
                let Value::Int(index) = leaf.value else {
                    return false;
                };
                inner.get(index as usize).is_some_and(|(join, values)| {
                    let value = value_of(row, &join.main_table_column);
                    !value.is_null() && values.contains(&value)
                })
            };
            evaluate_with(&spec.main_table.filter, &row.data, &mut 0, &exists)
                && inner.iter().zip(&named).all(|((join, values), named)| {
                    *named || values.contains(&value_of(row, &join.main_table_column))
                })
        })
        .collect()
}

/// The best `limit` of `rows` under `order`.
fn page(
    mut rows: Vec<(DataFrameKey, DataFrameRow)>,
    query: &SingleTableReadQuery,
) -> Vec<(DataFrameKey, DataFrameRow)> {
    rows.sort_by(|(_, a), (_, b)| order_rows(&query.order_by, a, b));
    if query.limit != u32::MAX {
        rows.truncate(query.limit as usize);
    }
    rows
}

/// What every part of `spec` shows, by part: the root's page of passing
/// rows, and under each shown row the passing rows of each sub carrying
/// its join value, a sub with a limit paged per parent value.
fn expected(
    spec: &MultiTableReadQuery,
    storage: &MemoryStorage,
) -> BTreeMap<Vec<usize>, BTreeSet<i64>> {
    let mut out = BTreeMap::new();
    let root = page(passing(spec, storage), &spec.main_table);
    descend(spec, &root, Vec::new(), storage, &mut out);
    out
}

/// Record `shown` for the node at `path` and evaluate the subs under it.
fn descend(
    spec: &MultiTableReadQuery,
    shown: &[(DataFrameKey, DataFrameRow)],
    path: Vec<usize>,
    storage: &MemoryStorage,
    out: &mut BTreeMap<Vec<usize>, BTreeSet<i64>>,
) {
    out.insert(
        path.clone(),
        shown.iter().map(|(key, _)| id_of(key)).collect(),
    );
    for (index, join) in spec.joins.iter().enumerate() {
        let candidates = passing(&join.sub, storage);
        let mut values: Vec<Value> = shown
            .iter()
            .map(|(_, row)| value_of(row, &join.main_table_column))
            .filter(|value| !value.is_null())
            .collect();
        values.sort_by(streamgres::ivm::order_cmp);
        values.dedup();
        let mut under = Vec::new();
        for value in values {
            let of_value: Vec<(DataFrameKey, DataFrameRow)> = candidates
                .iter()
                .filter(|(_, row)| value_of(row, &join.sub_table_column) == value)
                .cloned()
                .collect();
            under.extend(page(of_value, &join.sub.main_table));
        }
        let mut child = path.clone();
        child.push(index);
        descend(&join.sub, &under, child, storage, out);
    }
}

/// What the engine shows for every part of `spec`.
fn actual(
    ivm: &MultiTableIVM,
    sub: SubId,
    spec: &MultiTableReadQuery,
    path: Vec<usize>,
    out: &mut BTreeMap<Vec<usize>, BTreeSet<i64>>,
) {
    let part = QueryPart::try_new(&path).expect("a shallow tree");
    let rows = ivm.rows_for(sub, part).unwrap_or_default();
    out.insert(path.clone(), rows.keys().map(id_of).collect());
    for (index, join) in spec.joins.iter().enumerate() {
        let mut child = path.clone();
        child.push(index);
        actual(ivm, sub, &join.sub, child, out);
    }
}

/// A small deterministic generator.
struct Random(u64);

impl Random {
    /// The next value below `bound`.
    fn below(&mut self, bound: u64) -> i64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % bound) as i64
    }
}

/// One random write over the four tables, mirrored into `present` (which
/// ids exist per table) so inserts, updates and deletes stay valid.
fn random_write(
    random: &mut Random,
    present: &mut HashMap<&'static str, BTreeSet<i64>>,
) -> WriteQuery {
    let (name, ids, columns): (&'static str, u64, Vec<(&str, u64)>) = match random.below(10) {
        0..=4 => (
            "tickets",
            14,
            vec![("open", 2), ("assignee", 5), ("project", 4), ("team", 3)],
        ),
        5..=6 => ("users", 5, vec![("rank", 3)]),
        7..=8 => ("profiles", 6, vec![("user_id", 5)]),
        _ => ("teams", 3, vec![("active", 2)]),
    };
    let id = random.below(ids);
    let key = DataFrameKey::new([("id", Value::Int(id))]);
    let exists = present.entry(name).or_default().contains(&id);
    if exists && random.below(3) == 0 {
        present.entry(name).or_default().remove(&id);
        return WriteQuery::DELETE(DeleteQuery {
            table: TableName::from(name),
            pkey_value: key,
        });
    }
    let mut data: HashMap<ColumnName, Value> = columns
        .iter()
        .map(|(column, bound)| ((*column).into(), Value::Int(random.below(*bound))))
        .collect();
    data.insert("id".into(), Value::Int(id));
    let record = DataFrameRow::from(data);
    if exists {
        WriteQuery::UPDATE(UpdateQuery {
            table: TableName::from(name),
            pkey_value: key,
            record,
        })
    } else {
        present.entry(name).or_default().insert(id);
        WriteQuery::INSERT(InsertQuery {
            table: TableName::from(name),
            pkey_value: key,
            record,
        })
    }
}

/// Run `steps` random writes from `seed`, some before the subscriptions
/// register and the rest after, checking every subscription against the
/// reference after each. `GATED_TRACE=<step>` prints, for the seed
/// `GATED_SEED` names (1 by default), every write from that step on with
/// what it produced and the trees' state.
fn run(seed: u64, steps: usize) {
    let _ = (
        table("tickets", &["open", "assignee", "project", "team"]),
        table("users", &["rank"]),
        table("profiles", &["user_id"]),
        table("teams", &["active"]),
    );
    let storage = Rc::new(MemoryStorage::new());
    let mut ivm: Ivm = Local::new(MultiTableIVM::new(), storage.clone());
    let mut random = Random(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let mut present: HashMap<&'static str, BTreeSet<i64>> = HashMap::new();
    for _ in 0..40 {
        storage.apply(&random_write(&mut random, &mut present));
    }
    let registered: Vec<(&str, MultiTableReadQuery, SubId)> = specs()
        .into_iter()
        .map(|(name, spec)| {
            let (sub, _) = ivm.register_query(spec.clone());
            (name, spec, sub)
        })
        .collect();
    for step in 0..=steps {
        for (name, spec, sub) in &registered {
            let mut shown = BTreeMap::new();
            actual(ivm.engine(), *sub, spec, Vec::new(), &mut shown);
            assert_eq!(
                shown,
                expected(spec, &storage),
                "`{name}`, seed {seed}, after {step} writes: {:#?}",
                ivm.engine().describe(*sub)
            );
            assert!(
                ivm.engine().hydrated(*sub),
                "`{name}` has a read out, seed {seed}, after {step} writes"
            );
        }
        let write = random_write(&mut random, &mut present);
        storage.apply(&write);
        let traced_seed: u64 = std::env::var("GATED_SEED")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1);
        let trace = std::env::var("GATED_TRACE")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .is_some_and(|from| seed == traced_seed && step >= from);
        if trace {
            eprintln!("--- write {step}: {write:?}");
        }
        let out = ivm.incremental_update(&write);
        if trace {
            for delta in &out {
                eprintln!("    {delta:?}");
            }
            let stats = ivm.engine().stats();
            eprintln!(
                "    stats: reads {} lookups {} rounds {} rejected {}",
                stats.storage_reads, stats.page_lookups, stats.page_rounds, stats.window_rejections
            );
            for (name, _, sub) in &registered {
                for line in ivm.engine().describe(*sub) {
                    eprintln!("    `{name}` {line}");
                }
            }
        }
        let problems = ivm.engine().audit();
        assert!(
            problems.is_empty(),
            "seed {seed}, write {step} ({write:?}): {problems:#?}"
        );
    }
}

#[test]
fn every_shape_shows_what_the_reference_evaluates() {
    for seed in 1..=40 {
        run(seed, 250);
    }
}

/// The same runs with the reads landing late: every read is answered
/// from the storage as it was when it was asked for and landed some
/// writes later, in a random order, the way a slow database would; the
/// runtime brings each result up to the engine's position. Whenever
/// nothing is out the subscriptions must show what the reference
/// evaluates, and the counts must agree with the rows.
fn run_late(seed: u64, steps: usize) {
    let storage = MemoryStorage::new();
    let mut runtime = Runtime::new(MultiTableIVM::new());
    let mut random = Random(seed.wrapping_mul(0xD6E8_FEB8_6659_FD93) | 1);
    let mut present: HashMap<&'static str, BTreeSet<i64>> = HashMap::new();
    let mut lsn = 0u64;
    for _ in 0..40 {
        storage.apply(&random_write(&mut random, &mut present));
        lsn += 1;
    }
    runtime.progress(Lsn(lsn));
    let mut out: Vec<(Fetch, Snapshot)> = Vec::new();
    let asked = |selects: Vec<Fetch>,
                 storage: &MemoryStorage,
                 lsn: u64,
                 out: &mut Vec<(Fetch, Snapshot)>| {
        for fetch in selects {
            let snapshot = Snapshot {
                rows: storage.rows(&fetch.query),
                at: Lsn(lsn),
            };
            out.push((fetch, snapshot));
        }
    };
    let only: Option<usize> = std::env::var("GATED_ONLY")
        .ok()
        .and_then(|v| v.parse().ok());
    let mut registered: Vec<(&str, MultiTableReadQuery, SubId)> = Vec::new();
    for (index, (name, spec)) in specs().into_iter().enumerate() {
        if only.is_some_and(|only| only != index) {
            continue;
        }
        let (sub, step) = runtime.register(spec.clone());
        asked(step.selects, &storage, lsn, &mut out);
        registered.push((name, spec, sub));
    }
    let trace_from: Option<usize> = std::env::var("GATED_TRACE")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|_| std::env::var("GATED_SEED").is_ok());
    for step in 0..steps {
        let trace = trace_from.is_some_and(|from| step >= from);
        let land = !out.is_empty() && (random.below(3) != 0 || step + 1 == steps);
        if land {
            let (fetch, snapshot) = out.remove(random.below(out.len() as u64) as usize);
            if trace {
                eprintln!(
                    "--- step {step}: land {:?} {:?} for {:?}: {} rows {:?}",
                    fetch.id,
                    fetch.kind,
                    fetch.sub,
                    snapshot.rows.len(),
                    fetch.query.filter
                );
            }
            let landed = runtime.fetched(fetch.id, snapshot);
            asked(landed.selects, &storage, lsn, &mut out);
        } else {
            let write = random_write(&mut random, &mut present);
            storage.apply(&write);
            lsn += 1;
            if trace {
                eprintln!("--- step {step}: write {write:?}");
            }
            let routed = runtime.write(&write, Lsn(lsn));
            asked(routed.selects, &storage, lsn, &mut out);
        }
        if trace {
            for (name, _, sub) in &registered {
                for line in runtime.engine().describe(*sub) {
                    eprintln!("    `{name}` {line}");
                }
            }
        }
        let problems = runtime.engine().audit();
        assert!(
            problems.is_empty(),
            "seed {seed}, step {step}: {problems:#?}"
        );
        if !out.is_empty() {
            continue;
        }
        for (name, spec, sub) in &registered {
            let mut shown = BTreeMap::new();
            actual(runtime.engine(), *sub, spec, Vec::new(), &mut shown);
            assert_eq!(
                shown,
                expected(spec, &storage),
                "`{name}`, seed {seed}, quiet after step {step}: {:#?}",
                runtime.engine().describe(*sub)
            );
        }
    }
    let mut rounds = 0;
    while !out.is_empty() {
        let (fetch, snapshot) = out.remove(0);
        if trace_from.is_some() {
            eprintln!(
                "--- drain {rounds}: land {:?} {:?} for {:?}: {} rows {:?}",
                fetch.id,
                fetch.kind,
                fetch.sub,
                snapshot.rows.len(),
                fetch.query.filter
            );
        }
        let landed = runtime.fetched(fetch.id, snapshot);
        asked(landed.selects, &storage, lsn, &mut out);
        if trace_from.is_some() {
            for (name, _, sub) in &registered {
                for line in runtime.engine().describe(*sub) {
                    eprintln!("    `{name}` {line}");
                }
            }
        }
        rounds += 1;
        assert!(rounds < 10_000, "seed {seed}: the reads never settle");
    }
    for (name, spec, sub) in &registered {
        let mut shown = BTreeMap::new();
        actual(runtime.engine(), *sub, spec, Vec::new(), &mut shown);
        assert_eq!(
            shown,
            expected(spec, &storage),
            "`{name}`, seed {seed}, at the end"
        );
        assert!(runtime.engine().hydrated(*sub), "`{name}`, seed {seed}");
    }
}

#[test]
fn every_shape_converges_with_reads_landing_late() {
    let seeds: Vec<u64> = match std::env::var("GATED_SEED")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        Some(seed) => vec![seed],
        None => (1..=40).collect(),
    };
    for seed in seeds {
        run_late(seed, 400);
    }
}
