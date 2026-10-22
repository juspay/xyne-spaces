//! The engine's cost on production-shaped trees, the storage's time taken
//! out: the support desk's ticket list as the dashboard registers it (ten
//! windows over one channel, each a page read in batches under an
//! `EXISTS` gate), writes on that gate's table, single-row writes into an
//! engine holding large trees, and every channel of a workspace
//! registered again by a client whose tree is already held. Each prints
//! the engine's time and the storage's, the reads and the rows read.
//! Ignored by default (they take seconds in release and minutes in
//! debug); run with
//! `cargo test --release --test engine_cost -- --ignored --nocapture`.

macro_rules! row {
    ($($column:expr => $value:expr),* $(,)?) => {
        &[$(($column, ::streamgres::model::Value::from($value))),*][..]
    };
}

#[path = "streamgres_queries/catalog.rs"]
#[allow(dead_code)]
mod catalog;
#[path = "streamgres_queries/zql.rs"]
#[allow(dead_code)]
mod zql;

use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use streamgres::client::plan::{Planner, Policy, Side};
use streamgres::ivm::MultiTableIVM;
use streamgres::model::Order::DESC;
use streamgres::model::{
    ColumnName, DataFrameKey, DataFrameRow, InsertQuery, Lsn, MultiTableReadQuery,
    SingleTableReadQuery, Snapshot, Value, WriteQuery,
};
use streamgres::sync::{Local, MemoryStorage, Storage, StorageError};
use zql::{Q, eq, is_null, or, zql};

const ME: &str = "u-me";
const WS: &str = "ws-1";

/// In-memory storage that adds up the time its reads take.
struct Timed {
    inner: MemoryStorage,
    spent: Cell<Duration>,
    reads: Cell<u64>,
    rows: Cell<u64>,
}

impl Timed {
    /// An empty store with its counters at zero.
    fn new() -> Self {
        Timed {
            inner: MemoryStorage::new(),
            spent: Cell::new(Duration::ZERO),
            reads: Cell::new(0),
            rows: Cell::new(0),
        }
    }
    /// The time, reads and rows since the last call, and a fresh start.
    fn take(&self) -> (Duration, u64, u64) {
        let out = (self.spent.get(), self.reads.get(), self.rows.get());
        self.spent.set(Duration::ZERO);
        self.reads.set(0);
        self.rows.set(0);
        out
    }
}

impl Storage for Timed {
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError> {
        let started = Instant::now();
        let out = self.inner.select(query).await;
        self.spent.set(self.spent.get() + started.elapsed());
        self.reads.set(self.reads.get() + 1);
        if let Ok(snapshot) = &out {
            self.rows.set(self.rows.get() + snapshot.rows.len() as u64);
        }
        out
    }
    async fn count(&self, query: &MultiTableReadQuery, cap: u64) -> Result<u64, StorageError> {
        self.inner.count(query, cap).await
    }
    fn advance(&self, feed: Lsn) {
        self.inner.advance(feed)
    }
    fn floor(&self) -> Lsn {
        self.inner.floor()
    }
    fn absorb(&self, write: &WriteQuery, at: Lsn) {
        self.inner.absorb(write, at)
    }
}

/// A full image of `table` from `pairs`, as the fixtures build one.
fn image(table: &str, pairs: &[(&str, Value)]) -> WriteQuery {
    let data: HashMap<ColumnName, Value> = catalog::columns(table)
        .iter()
        .map(|(column, _)| {
            let value = pairs
                .iter()
                .find(|(name, _)| name == column)
                .map(|(_, v)| v.clone())
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
    let key = DataFrameKey::new([(catalog::pkey(table), data[catalog::pkey(table)].clone())]);
    WriteQuery::INSERT(InsertQuery {
        table: table.into(),
        pkey_value: key,
        record: DataFrameRow::from(data),
    })
}

/// The tree planned on `counts` (table, narrowed) -> rows, production's policy.
fn planned(q: &Q, counts: &dyn Fn(&str, bool) -> u64) -> MultiTableReadQuery {
    let (spec, _) = q.clone().eq("workspaceId", WS).build();
    let mut planner = Planner::new(
        spec,
        Policy {
            limit: 100_000,
            preferred: Side::Parent,
        },
    );
    let asked: Vec<(usize, bool)> = planner
        .counts()
        .iter()
        .map(|c| (c.node, c.narrowed))
        .collect();
    for (node, narrowed) in asked {
        let rows = counts(planner.table_of(node), narrowed);
        planner.answer(node, narrowed, rows);
    }
    planner.decide().expect("planned")
}

/// The engine under the synchronous driver over timed storage, and a
/// clock for the writes.
struct Bench {
    ivm: Local<MultiTableIVM, Timed>,
    storage: Rc<Timed>,
    clock: u64,
}

impl Bench {
    /// An empty engine over empty storage.
    fn new() -> Self {
        let storage = Rc::new(Timed::new());
        Bench {
            ivm: Local::new(MultiTableIVM::new(), storage.clone()),
            storage,
            clock: 0,
        }
    }
    /// Put a row into storage without routing it.
    fn seed(&self, table: &str, pairs: &[(&str, Value)]) {
        self.storage.inner.apply(&image(table, pairs));
    }
    /// Register `query`, printing engine time (total minus storage) and storage stats.
    fn register(&mut self, label: &str, query: MultiTableReadQuery) -> streamgres::model::SubId {
        self.storage.take();
        let started = Instant::now();
        let (sub, updates) = self.ivm.register_query(query);
        let total = started.elapsed();
        let (io, reads, rows) = self.storage.take();
        eprintln!(
            "{label:<44} engine {:>8.1} ms  storage {:>7.1} ms  {:>5} reads {:>7} rows read {:>7} updates",
            (total - io).as_secs_f64() * 1000.0,
            io.as_secs_f64() * 1000.0,
            reads,
            rows,
            updates.len()
        );
        sub
    }
    /// Route `writes`, printing the engine's time per write.
    fn write_all(&mut self, label: &str, writes: Vec<WriteQuery>) {
        self.storage.take();
        let n = writes.len();
        let started = Instant::now();
        let mut updates = 0;
        for write in &writes {
            self.clock += 1;
            self.storage.inner.apply(write);
            updates += self.ivm.incremental_update(write).len();
        }
        let total = started.elapsed();
        let (io, reads, rows) = self.storage.take();
        eprintln!(
            "{label:<44} engine {:>8.1} ms  storage {:>7.1} ms  {:>5} reads {:>7} rows read {:>7} updates  ({:.1} µs engine per write)",
            (total - io).as_secs_f64() * 1000.0,
            io.as_secs_f64() * 1000.0,
            reads,
            rows,
            updates,
            (total - io).as_secs_f64() * 1e6 / n as f64
        );
    }
}

/// The desk list's query at `limit`, as karun.raj's list registers it.
fn desk_page(limit: u32) -> Q {
    zql("tickets")
        .eq("channelId", "c-desk")
        .eq("isArchived", false)
        .where_exists("channel", |ch| {
            ch.eq("id", "c-desk")
                .eq("workspaceId", WS)
                .where_exists("participants", |p| {
                    p.eq("userId", ME).eq("channelId", "c-desk")
                })
        })
        .where_exists("formEntityValues", |f| {
            f.eq("entityType", "TICKET").eq("fieldId", "F1")
        })
        .order_by("lastEmailAt", DESC)
        .order_by("id", DESC)
        .limit(limit)
        .related("emailDrafts", |d| {
            d.filter(or(vec![eq("userId", ME), is_null("userId")]))
        })
        .related("emailReads", |r| r.eq("userId", ME))
        .related("userMailbox", |m| m.eq("userId", ME))
        .related("formEntityValues", |f| {
            f.eq("entityType", "TICKET").in_("fieldId", &["F1"])
        })
}

/// The desk channel at production size: `tickets` tickets, a form value
/// of the filtered field on all but one in 94 (27 836 of that field in
/// the workspace), two other fields on each, and the caller's reads,
/// mailbox rows and drafts.
fn seed_desk(b: &Bench, tickets: usize) {
    b.seed(
        "channels",
        row!["id" => "c-desk", "visibility" => "PRIVATE"],
    );
    b.seed(
        "channel_participants",
        row!["id" => "p-me", "channelId" => "c-desk", "userId" => ME],
    );
    let mut fev = 0;
    for i in 0..tickets {
        let id = format!("t{i}");
        let conv = format!("cv{i}");
        b.seed("tickets", row!["id" => id.as_str(), "channelId" => "c-desk", "isArchived" => false, "lastEmailAt" => 1_000_000 + (i as i64 * 7919) % 100_000, "conversationId" => conv.as_str()]);
        if i % 94 != 0 {
            b.seed("form_entity_values", row!["id" => format!("f1-{i}").as_str(), "entityId" => id.as_str(), "entityType" => "TICKET", "fieldId" => "F1", "actualFieldValue" => "\"x\""]);
            fev += 1;
        }
        for f in ["F2", "F3"] {
            b.seed("form_entity_values", row!["id" => format!("{f}-{i}").as_str(), "entityId" => id.as_str(), "entityType" => "TICKET", "fieldId" => f, "actualFieldValue" => "\"y\""]);
        }
        if i % 2 == 0 {
            b.seed(
                "email_reads",
                row!["id" => format!("r{i}").as_str(), "ticketId" => id.as_str(), "userId" => ME],
            );
        }
        if i % 3 == 0 {
            b.seed("ticket_user_mailbox", row!["id" => format!("m{i}").as_str(), "ticketId" => id.as_str(), "userId" => ME, "state" => "INBOX"]);
        }
        if i % 50 == 0 {
            b.seed("email_drafts", row!["id" => format!("d{i}").as_str(), "conversationId" => conv.as_str(), "userId" => ME]);
        }
    }
    let mut j = 0;
    while fev < 27_836 {
        b.seed("form_entity_values", row!["id" => format!("fo-{j}").as_str(), "entityId" => format!("other{j}").as_str(), "entityType" => "TICKET", "fieldId" => "F1", "actualFieldValue" => "\"x\""]);
        fev += 1;
        j += 1;
    }
}

/// A: the desk list's ten windows, planned as production plans them.
#[test]
#[ignore]
fn a_desk_windows() {
    let mut b = Bench::new();
    seed_desk(&b, 8508);
    let counts = |table: &str, narrowed: bool| match (table, narrowed) {
        ("tickets", false) => 8508,
        ("tickets", true) => 8418,
        ("form_entity_values", _) => 27_836,
        _ => 1,
    };
    let mut limit = 51;
    while limit <= 13_056 {
        b.register(
            &format!("A desk window limit {limit}"),
            planned(&desk_page(limit), &counts),
        );
        limit *= 2;
    }
}

/// D: writes on a gate's table under a batched page: form values for
/// tickets mostly behind the page, the way a busy channel writes.
#[test]
#[ignore]
fn d_gate_writes_under_a_batched_page() {
    let mut b = Bench::new();
    seed_desk(&b, 8508);
    let counts = |table: &str, narrowed: bool| match (table, narrowed) {
        ("tickets", false) => 8508,
        ("tickets", true) => 8418,
        ("form_entity_values", _) => 27_836,
        _ => 1,
    };
    for _ in 0..5 {
        let _ = b.ivm.register_query(planned(&desk_page(51), &counts));
    }
    let writes: Vec<WriteQuery> = (0..2000).map(|k| {
        let ticket = (k * 7919) % 8508;
        image("form_entity_values", row!["id" => format!("fw{k}").as_str(), "entityId" => format!("t{ticket}").as_str(), "entityType" => "TICKET", "fieldId" => "F1", "actualFieldValue" => "\"z\""])
    }).collect();
    b.write_all("D 2000 form values under 5 desk pages", writes);
}

/// C: every channel of the workspace, registered by a second and a third
/// admin (the same tree), then by a member (a tree of its own with the
/// access gate).
#[test]
#[ignore]
fn c_all_channels_again() {
    let mut b = Bench::new();
    let channels = 76_506usize;
    for i in 0..channels {
        let id = format!("c{i}");
        b.seed("channels", row!["id" => id.as_str(), "name" => format!("channel {i}").as_str(), "visibility" => if i % 3 == 0 { "PUBLIC" } else { "PRIVATE" }, "updatedAt" => i as i64]);
        if i % 60 == 0 {
            b.seed(
                "channel_participants",
                row!["id" => format!("p{i}").as_str(), "channelId" => id.as_str(), "userId" => ME],
            );
        }
    }
    let admin = zql("channels");
    let none = |_: &str, _: bool| 1;
    b.register("C admin 1: all channels, cold", planned(&admin, &none));
    b.register("C admin 2: same tree, warm", planned(&admin, &none));
    b.register("C admin 3: same tree, warm", planned(&admin, &none));
    let member = zql("channels").filter(or(vec![eq("visibility", "PUBLIC"), {
        let mut q = zql("channels");
        q.exists("participants", |p| p.eq("userId", ME))
    }]));
    let counts = |table: &str, _: bool| match table {
        "channels" => 76_506,
        _ => 1276,
    };
    b.register(
        "C member: own tree with the access gate",
        planned(&member, &counts),
    );
}

/// B: single-row writes into an engine holding large trees: a channel's
/// conversations page for 200 groups, every channel for 3 admins.
#[test]
#[ignore]
fn b_small_writes_into_big_trees() {
    let mut b = Bench::new();
    let channels = 20_000usize;
    for i in 0..channels {
        let id = format!("c{i}");
        b.seed("channels", row!["id" => id.as_str(), "name" => format!("channel {i}").as_str(), "visibility" => "PRIVATE", "updatedAt" => i as i64]);
    }
    for i in 0..200 {
        b.seed("channel_participants", row!["id" => format!("p{i}").as_str(), "channelId" => format!("c{i}").as_str(), "userId" => format!("u{i}").as_str()]);
        for j in 0..40 {
            b.seed("conversations", row!["conversationId" => format!("cv{i}-{j}").as_str(), "channelId" => format!("c{i}").as_str(), "createdAt" => j as i64, "createdBy" => format!("u{i}").as_str()]);
        }
    }
    let none = |_: &str, _: bool| 1;
    for _ in 0..3 {
        b.register("B admin: all channels", planned(&zql("channels"), &none));
    }
    let started = Instant::now();
    for i in 0..200 {
        let channel = format!("c{i}");
        let user = format!("u{i}");
        let q = zql("conversations")
            .eq("channelId", channel.as_str())
            .where_exists("channel", |ch| {
                let c = channel.clone();
                let u = user.clone();
                ch.eq("id", c.as_str())
                    .where_exists("participants", move |p| {
                        p.eq("userId", u.as_str()).eq("channelId", c.as_str())
                    })
            })
            .related("initialMessageAttachments", |a| a)
            .order_by("createdAt", DESC)
            .limit(25);
        let counts = |table: &str, _: bool| match table {
            "conversations" => 40,
            _ => 1,
        };
        let query = planned(&q, &counts);
        let _ = b.ivm.register_query(query);
    }
    eprintln!(
        "B 200 conversation pages registered in {:.1} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
    let writes: Vec<WriteQuery> = (0..2000).map(|k| {
        let i = k % 200;
        image("conversations", row!["conversationId" => format!("new{k}").as_str(), "channelId" => format!("c{i}").as_str(), "createdAt" => 1000 + k as i64, "createdBy" => format!("u{i}").as_str()])
    }).collect();
    b.write_all("B 2000 conversation inserts", writes);
    let writes: Vec<WriteQuery> = (0..2000).map(|k| {
        image("channels", row!["id" => format!("c{}", k % 20_000).as_str(), "name" => format!("renamed {k}").as_str(), "visibility" => "PRIVATE", "updatedAt" => 99_000 + k as i64])
    }).map(|w| match w { WriteQuery::INSERT(i) => WriteQuery::UPDATE(streamgres::model::UpdateQuery { table: i.table, pkey_value: i.pkey_value, record: i.record }), other => other }).collect();
    b.write_all("B 2000 channel renames (3 admins hold all)", writes);
    let writes: Vec<WriteQuery> = (0..2000).map(|k| {
        image("messages", row!["messageId" => format!("m{k}").as_str(), "conversationId" => format!("cv{}-{}", k % 200, k % 40).as_str(), "content" => "hi", "createdAt" => k as i64])
    }).collect();
    b.write_all("B 2000 message inserts (no tree wants them)", writes);
}
