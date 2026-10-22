//! What the asynchronous driver promises its consumer, over an in-memory
//! store: a subscription is named before anything is said about it, a
//! registration served from a tree the engine already holds needs no
//! storage read and still reports itself complete, and one committed
//! transaction reaches the consumer as one event carrying every delta of
//! it whatever else is happening. These are the properties the client side
//! builds its pokes on; each was a live defect before it was pinned here.

use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::{LocalSet, spawn_local};
use streamgres::ivm::MultiTableIVM;
use streamgres::model::*;
use streamgres::sync::{
    Command, Event, Lsn, MemoryStorage, Service, Storage, StorageError, SubId, Transaction,
};

/// Run `body` on a current-thread runtime with a local task set (the
/// driver and its storage are single-threaded).
fn block_on<F: std::future::Future>(body: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    LocalSet::new().block_on(&runtime, body)
}

/// The primary key of `id`.
fn pkey(id: i64) -> HashMap<ColumnName, Value> {
    HashMap::from([("id".into(), Value::Int(id))])
}

/// One full ticket row: every column the table declares.
fn ticket(id: i64, status: &str) -> DataFrameRow {
    DataFrameRow::from(HashMap::from([
        ("id".into(), Value::Int(id)),
        ("status".into(), Value::String(status.to_owned())),
    ]))
}

/// An insert of `ticket(id, status)`.
fn insert(id: i64, status: &str) -> WriteQuery {
    WriteQuery::INSERT(InsertQuery {
        table: TableName::from("tickets"),
        pkey_value: DataFrameKey::new(pkey(id)),
        record: ticket(id, status),
    })
}

/// The one query these scenarios subscribe to: the open tickets.
fn open_tickets() -> MultiTableReadQuery {
    MultiTableReadQuery::single(SingleTableReadQuery::new(
        "tickets",
        Where::condition("status", ComparisonOperator::EQ, "OPEN"),
        OrderBy::new("id", Order::ASC),
        u32::MAX,
    ))
}

/// A driver over `storage`, with the events it sends and the commands it
/// takes; the driver runs as a task of the caller's local set.
fn start(
    storage: Rc<MemoryStorage>,
) -> (
    mpsc::Sender<Command<MultiTableReadQuery>>,
    mpsc::UnboundedReceiver<Event>,
) {
    let (events_tx, events) = mpsc::unbounded_channel();
    let (service, commands) = Service::new(MultiTableIVM::new(), storage, events_tx);
    spawn_local(service.run());
    (commands, events)
}

/// Every event the driver sends within a short window, in order.
async fn drain(events: &mut mpsc::UnboundedReceiver<Event>) -> Vec<Event> {
    let mut seen = Vec::new();
    while let Ok(Some(event)) =
        tokio::time::timeout(Duration::from_millis(200), events.recv()).await
    {
        seen.push(event);
    }
    seen
}

/// The names of the events, for readable assertions.
fn shapes(events: &[Event]) -> Vec<&'static str> {
    events
        .iter()
        .map(|event| match event {
            Event::Registered { .. } => "registered",
            Event::Hydrated(_) => "hydrated",
            Event::Landed { .. } => "landed",
            Event::Refused { .. } => "refused",
            Event::Committed { .. } => "committed",
            Event::Capped { .. } => "capped",
            Event::Heavy { .. } => "heavy",
        })
        .collect()
}

/// The deltas an event carries.
fn updates_of(event: &Event) -> &[streamgres::ivm::Delta] {
    match event {
        Event::Registered { updates, .. }
        | Event::Landed { updates }
        | Event::Committed { updates, .. } => updates,
        Event::Hydrated(_) | Event::Refused { .. } | Event::Capped { .. } | Event::Heavy { .. } => {
            &[]
        }
    }
}

/// The rows added by every event, as ids.
fn ids(events: &[Event]) -> Vec<i64> {
    let mut out = Vec::new();
    for event in events {
        for update in updates_of(event) {
            if let DataFrameOperation::Add(key, _) = &update.op
                && let Some(Value::Int(id)) = key.pkey_value.get(&ColumnName::from("id"))
            {
                out.push(*id);
            }
        }
    }
    out.sort_unstable();
    out
}

/// The subscription a registration became, and the token it answers.
fn registered(events: &[Event]) -> Option<(u64, SubId)> {
    events.iter().find_map(|event| match event {
        Event::Registered { token, sub, .. } => Some((*token, *sub)),
        _ => None,
    })
}

/// A registration is announced before anything is said about it: the
/// first event is the subscription's id, carrying the token the command
/// was sent with, and only then do its rows and its completion follow.
/// Without that order a consumer meets a `SubId` it cannot place and
/// drops the rows and the completion on the floor.
#[test]
fn a_registration_is_named_before_its_rows() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        storage.apply(&insert(1, "OPEN"));
        storage.apply(&insert(2, "DONE"));
        let (commands, mut events) = start(storage);

        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 7,
            })
            .await
            .expect("send");
        let seen = drain(&mut events).await;

        assert_eq!(
            shapes(&seen).first(),
            Some(&"registered"),
            "the subscription is named first, got {:?}",
            shapes(&seen)
        );
        let (token, sub) = registered(&seen).expect("the registration is answered");
        assert_eq!(token, 7, "the token comes back unchanged");
        assert_eq!(ids(&seen), vec![1], "only the open ticket is delivered");
        assert!(
            seen.iter().any(|event| matches!(
                event,
                Event::Hydrated(subs) if subs.contains(&sub)
            )),
            "the subscription reports itself complete, got {:?}",
            shapes(&seen)
        );
    });
}

/// A second subscription to a query the engine already holds is served
/// from that tree: it is named, given its rows and reported complete
/// without a storage read, so a consumer that waits for a landing before
/// telling the client would wait for something that never comes.
#[test]
fn a_twin_registration_completes_without_a_read() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        storage.apply(&insert(1, "OPEN"));
        let (commands, mut events) = start(storage);

        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 1,
            })
            .await
            .expect("send");
        let first = drain(&mut events).await;
        assert!(
            first
                .iter()
                .any(|event| matches!(event, Event::Landed { .. })),
            "the first registration reads storage, got {:?}",
            shapes(&first)
        );

        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 2,
            })
            .await
            .expect("send");
        let twin = drain(&mut events).await;

        let (token, sub) = registered(&twin).expect("the twin is answered");
        assert_eq!(token, 2, "the twin's own token comes back");
        assert_eq!(ids(&twin), vec![1], "the twin is given the held row");
        assert!(
            twin.iter().any(|event| matches!(
                event,
                Event::Hydrated(subs) if subs.contains(&sub)
            )),
            "the twin reports itself complete, got {:?}",
            shapes(&twin)
        );
        assert!(
            !twin
                .iter()
                .any(|event| matches!(event, Event::Landed { .. })),
            "the twin needs no storage read, got {:?}",
            shapes(&twin)
        );
    });
}

/// One committed transaction reaches the consumer as one event carrying
/// every delta of it: the driver routes every write of a commit in a
/// single synchronous step, so nothing a client is told can be cut in the
/// middle of a commit, and the rows of that commit travel together with
/// its position.
#[test]
fn a_commit_arrives_as_one_batch() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        let (commands, mut events) = start(storage);

        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 1,
            })
            .await
            .expect("send");
        drain(&mut events).await;

        commands
            .send(Command::Transaction(Transaction::new(
                vec![insert(10, "OPEN"), insert(11, "OPEN"), insert(12, "DONE")],
                Lsn(100),
            )))
            .await
            .expect("send");
        let seen = drain(&mut events).await;

        assert_eq!(
            seen.iter()
                .filter(|event| !updates_of(event).is_empty())
                .count(),
            1,
            "the commit's rows travel in one event, got {:?}",
            shapes(&seen)
        );
        assert!(
            matches!(seen.last(), Some(Event::Committed { updates, .. }) if updates.len() == 2),
            "and that event is the commit itself, got {:?}",
            shapes(&seen)
        );
        assert_eq!(
            ids(&seen),
            vec![10, 11],
            "both open tickets of the commit are delivered together"
        );
    });
}

/// A committed transaction reports where the engine now is (the feed's
/// progress mark) and carries the watched writes it held, which is what a
/// consumer batching per transaction flushes on.
#[test]
fn a_commit_reports_the_position_and_the_watched_writes() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        let (commands, mut events) = start(storage);

        commands
            .send(Command::Transaction(Transaction {
                writes: vec![insert(1, "OPEN")],
                at: Lsn(42),
                progress: Lsn(50),
                watched: vec![insert(1, "OPEN")],
                schema: Vec::new(),
                catalog: None,
                received: std::time::Instant::now(),
                committed_at_micros: 0,
                decode: std::time::Duration::ZERO,
            }))
            .await
            .expect("send");
        let seen = drain(&mut events).await;

        let committed = seen.iter().find_map(|event| match event {
            Event::Committed {
                position, watched, ..
            } => Some((*position, watched.len())),
            _ => None,
        });
        assert_eq!(
            committed,
            Some((Lsn(50), 1)),
            "the progress mark and the watched write are reported, got {:?}",
            shapes(&seen)
        );
        assert!(
            matches!(seen.as_slice(), [Event::Committed { updates, .. }] if updates.is_empty()),
            "the commit is the one event; nobody subscribed, so it carries no delta, got {:?}",
            shapes(&seen)
        );
    });
}

/// Storage that refuses every read, the way a read past the row budget is.
struct Refusing(MemoryStorage);

impl Storage for Refusing {
    /// Refused, whatever is asked.
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError> {
        Err(StorageError::refused(format!(
            "a read on `{}` returned more than 1 rows",
            query.table
        )))
    }

    /// [`MemoryStorage::advance`].
    fn advance(&self, feed: Lsn) {
        self.0.advance(feed)
    }

    /// [`MemoryStorage::floor`].
    fn floor(&self) -> Lsn {
        self.0.floor()
    }

    /// [`MemoryStorage::absorb`].
    fn absorb(&self, write: &WriteQuery, at: Lsn) {
        self.0.absorb(write, at)
    }
}

/// A refused read is not parked and retried: the subscription that was
/// waiting on it is unregistered, its client is told why, and it is never
/// reported complete.
#[test]
fn a_refused_read_unregisters_the_subscription_and_says_why() {
    block_on(async {
        let storage = Rc::new(Refusing(MemoryStorage::new()));
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (service, commands) = Service::new(MultiTableIVM::new(), storage, events_tx);
        spawn_local(service.run());
        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 3,
            })
            .await
            .expect("send");
        let seen = drain(&mut events).await;
        let (_, sub) = registered(&seen).expect("the registration is named first");
        assert_eq!(
            shapes(&seen),
            vec!["registered", "refused"],
            "named, then refused, and never hydrated"
        );
        assert!(
            seen.iter().any(|event| matches!(
                event,
                Event::Refused { sub: refused, reason } if *refused == sub && reason.contains("tickets")
            )),
            "the refusal names the subscription and the table, got {seen:?}"
        );
    });
}

/// Storage whose reads wait until the gate opens, so a read can be in
/// flight while another registration arrives.
struct Gated {
    inner: MemoryStorage,
    open: Rc<std::cell::Cell<bool>>,
}

impl Storage for Gated {
    /// The inner read, once the gate is open.
    async fn select(&self, query: &SingleTableReadQuery) -> Result<Snapshot, StorageError> {
        while !self.open.get() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        self.inner.select(query).await
    }

    /// [`MemoryStorage::advance`].
    fn advance(&self, feed: Lsn) {
        self.inner.advance(feed)
    }

    /// [`MemoryStorage::floor`].
    fn floor(&self) -> Lsn {
        self.inner.floor()
    }

    /// [`MemoryStorage::absorb`].
    fn absorb(&self, write: &WriteQuery, at: Lsn) {
        self.inner.absorb(write, at)
    }
}

/// A twin that registers while the first subscription's read is still
/// out joins that read, and both are reported complete when it lands:
/// the landing names every subscription waiting on it, not only the one
/// that asked.
#[test]
fn a_twin_joining_a_read_in_flight_completes_when_it_lands() {
    block_on(async {
        let inner = MemoryStorage::new();
        inner.apply(&insert(1, "OPEN"));
        let open = Rc::new(std::cell::Cell::new(false));
        let storage = Rc::new(Gated {
            inner,
            open: open.clone(),
        });
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (service, commands) = Service::new(MultiTableIVM::new(), storage, events_tx);
        spawn_local(service.run());
        for token in [1u64, 2] {
            commands
                .send(Command::Register {
                    sink: 0,
                    query: open_tickets(),
                    token,
                })
                .await
                .expect("send");
        }
        let before = drain(&mut events).await;
        assert_eq!(
            shapes(&before),
            vec!["registered", "registered"],
            "both are named and neither is complete while the read is out"
        );
        let subs: Vec<SubId> = before
            .iter()
            .filter_map(|event| match event {
                Event::Registered { sub, .. } => Some(*sub),
                _ => None,
            })
            .collect();
        open.set(true);
        let after = drain(&mut events).await;
        let hydrated: Vec<SubId> = after
            .iter()
            .flat_map(|event| match event {
                Event::Hydrated(subs) => subs.clone(),
                _ => Vec::new(),
            })
            .collect();
        assert!(
            subs.iter().all(|sub| hydrated.contains(sub)),
            "both subscriptions complete on the one landing, got {:?} for {subs:?}",
            shapes(&after)
        );
        assert!(
            ids(&after).contains(&1),
            "the row lands, got {:?}",
            ids(&after)
        );
    });
}

/// Two consumers, one tree: subscriptions of one query registered from two
/// sinks share the engine's tree, and each sink hears of its own alone.
/// A registration is answered to the sink that asked; a write's delta
/// reaches both, each copy naming only that sink's subscriptions (three
/// of them on the first sink, as one shared list); a subscription let go
/// hears nothing more; and a group of subscriptions released together
/// leaves its sink silent while the other still hears.
#[test]
fn deltas_reach_the_sink_that_owns_each_subscription() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        storage.apply(&insert(1, "OPEN"));
        let (first_tx, mut first) = mpsc::unbounded_channel();
        let (second_tx, mut second) = mpsc::unbounded_channel();
        let (service, commands) =
            Service::new(MultiTableIVM::new(), storage.clone(), first_tx.clone());
        spawn_local(service.with_sinks(vec![first_tx, second_tx]).run());

        let mut owned: Vec<Vec<SubId>> = vec![Vec::new(), Vec::new()];
        for (token, sink) in [(1u64, 0usize), (2, 0), (3, 0), (4, 1)] {
            commands
                .send(Command::Register {
                    sink,
                    query: open_tickets(),
                    token,
                })
                .await
                .expect("send");
            let (mine, other) = if sink == 0 {
                (&mut first, &mut second)
            } else {
                (&mut second, &mut first)
            };
            let seen = drain(mine).await;
            let (answered, sub) = registered(&seen).expect("answered to the sink that asked");
            assert_eq!(answered, token);
            assert_eq!(ids(&seen), vec![1], "with its row");
            assert!(
                registered(&drain(other).await).is_none(),
                "the other sink hears nothing of it"
            );
            owned[sink].push(sub);
        }

        storage.apply(&insert(2, "OPEN"));
        commands
            .send(Command::Transaction(Transaction::new(
                vec![insert(2, "OPEN")],
                Lsn(1),
            )))
            .await
            .expect("send");
        for (sink, events) in [(0usize, &mut first), (1, &mut second)] {
            let seen = drain(events).await;
            let deltas: Vec<_> = seen.iter().flat_map(updates_of).collect();
            assert_eq!(deltas.len(), 1, "one delta for the one row, sink {sink}");
            let mut named: Vec<SubId> = deltas[0].targets().map(|target| target.sub).collect();
            named.sort();
            assert_eq!(named, owned[sink], "naming that sink's subscriptions alone");
        }

        commands
            .send(Command::UnregisterAll(owned[0].clone()))
            .await
            .expect("send");
        storage.apply(&insert(3, "OPEN"));
        commands
            .send(Command::Transaction(Transaction::new(
                vec![insert(3, "OPEN")],
                Lsn(2),
            )))
            .await
            .expect("send");
        let quiet = drain(&mut first).await;
        assert!(
            quiet.iter().flat_map(updates_of).next().is_none(),
            "the released sink has nothing left to hear"
        );
        let heard = drain(&mut second).await;
        assert_eq!(ids(&heard), vec![3], "the other still hears");
    });
}

/// A read that comes back with at least half the row limit is told, once,
/// to the owner of a subscription waiting on it, with the table and the
/// row count, so the transport can name the query; a small read is not.
#[test]
fn a_heavy_read_is_told_to_the_subscriptions_owner() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        for id in 1..=6 {
            storage.apply(&insert(id, "OPEN"));
        }
        storage.apply(&insert(7, "DONE"));
        let stats = streamgres::stats::Stats::shared();
        stats
            .read_row_limit
            .store(10, std::sync::atomic::Ordering::Relaxed);
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (service, commands) = Service::new(MultiTableIVM::new(), storage, events_tx);
        spawn_local(service.with_stats(stats.clone()).run());

        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 1,
            })
            .await
            .expect("send");
        let seen = drain(&mut events).await;
        let (_, sub) = registered(&seen).expect("registered");
        let heavy: Vec<_> = seen
            .iter()
            .filter_map(|event| match event {
                Event::Heavy { sub, table, rows } => Some((*sub, table.as_str().to_owned(), *rows)),
                _ => None,
            })
            .collect();
        assert_eq!(
            heavy,
            vec![(sub, "tickets".to_owned(), 6)],
            "{:?}",
            shapes(&seen)
        );

        let done = MultiTableReadQuery::single(SingleTableReadQuery::new(
            "tickets",
            Where::condition("status", ComparisonOperator::EQ, "DONE"),
            OrderBy::new("id", Order::ASC),
            u32::MAX,
        ));
        commands
            .send(Command::Register {
                sink: 0,
                query: done,
                token: 2,
            })
            .await
            .expect("send");
        let seen = drain(&mut events).await;
        assert!(
            !shapes(&seen).contains(&"heavy"),
            "one row of a limit of ten is no heavy read, got {:?}",
            shapes(&seen)
        );
    });
}

/// A feed that reopens its slot is sent again the transactions the server
/// had not seen confirmed. The driver applies each transaction once: one
/// that committed at or below where the engine already is goes by
/// without a second event, a position mark is a step with nothing in it,
/// and the transactions after the repeat are applied as ever.
#[test]
fn a_transaction_the_feed_repeats_is_applied_once() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        let (events_tx, mut events) = mpsc::unbounded_channel();
        let (feed, transactions) = mpsc::channel(16);
        let (service, commands) = Service::new(MultiTableIVM::new(), storage, events_tx);
        spawn_local(service.with_feed(transactions).run());
        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 1,
            })
            .await
            .expect("send");
        drain(&mut events).await;

        let committed = |id: i64, at: u64| {
            let mut transaction = Transaction::new(vec![insert(id, "OPEN")], Lsn(at));
            transaction.committed_at_micros = 1;
            transaction
        };
        assert!(Transaction::mark(Lsn(5)).is_mark());
        assert!(!committed(1, 10).is_mark());
        assert!(committed(1, 10).repeats(Lsn(10)));
        assert!(!committed(1, 10).repeats(Lsn(9)));
        assert!(!Transaction::mark(Lsn(5)).repeats(Lsn(10)));

        feed.send(committed(1, 10)).await.expect("feed");
        feed.send(committed(2, 20)).await.expect("feed");
        feed.send(Transaction::mark(Lsn(25))).await.expect("feed");
        feed.send(committed(2, 20)).await.expect("feed");
        feed.send(committed(1, 10)).await.expect("feed");
        feed.send(committed(3, 30)).await.expect("feed");
        let seen = drain(&mut events).await;
        assert_eq!(
            shapes(&seen),
            vec!["committed", "committed", "committed", "committed"],
            "two transactions, the mark, and the one after the repeats"
        );
        assert_eq!(ids(&seen), vec![1, 2, 3], "each row added once");
        let positions: Vec<Lsn> = seen
            .iter()
            .filter_map(|event| match event {
                Event::Committed { position, .. } => Some(*position),
                _ => None,
            })
            .collect();
        assert_eq!(positions, vec![Lsn(10), Lsn(20), Lsn(25), Lsn(30)]);
    });
}

/// With several consumers, a commit wakes only those with something to
/// hear once they are serving: the first commit reaches every consumer (it
/// is the one they start serving on), a later one with deltas for one
/// consumer reaches that one alone, and a watched write reaches them all.
#[test]
fn a_serving_consumer_is_not_woken_for_nothing() {
    block_on(async {
        let storage = Rc::new(MemoryStorage::new());
        let (owner_tx, mut owner) = mpsc::unbounded_channel();
        let (other_tx, mut other) = mpsc::unbounded_channel();
        let (service, commands) =
            Service::new(MultiTableIVM::new(), storage, owner_tx.clone());
        let service = service.with_sinks(vec![owner_tx, other_tx]);
        spawn_local(service.run());

        let transaction = |id: i64, at: u64, watched: bool| {
            let write = insert(id, "OPEN");
            Transaction {
                watched: if watched { vec![write.clone()] } else { Vec::new() },
                writes: vec![write],
                at: Lsn(at),
                progress: Lsn(at),
                schema: Vec::new(),
                catalog: None,
                received: std::time::Instant::now(),
                committed_at_micros: 0,
                decode: Duration::ZERO,
            }
        };

        commands
            .send(Command::Transaction(transaction(1, 10, false)))
            .await
            .expect("send");
        let (first_owner, first_other) = (drain(&mut owner).await, drain(&mut other).await);
        assert_eq!(shapes(&first_owner), vec!["committed"]);
        assert_eq!(shapes(&first_other), vec!["committed"], "every consumer starts serving");

        commands
            .send(Command::Register {
                sink: 0,
                query: open_tickets(),
                token: 1,
            })
            .await
            .expect("send");
        drain(&mut owner).await;
        commands
            .send(Command::Transaction(transaction(2, 20, false)))
            .await
            .expect("send");
        let (owner_seen, other_seen) = (drain(&mut owner).await, drain(&mut other).await);
        assert_eq!(shapes(&owner_seen), vec!["committed"]);
        assert_eq!(ids(&owner_seen), vec![2]);
        assert!(other_seen.is_empty(), "nothing for it: {:?}", shapes(&other_seen));

        commands
            .send(Command::Transaction(transaction(3, 30, true)))
            .await
            .expect("send");
        let other_seen = drain(&mut other).await;
        assert!(
            matches!(other_seen.as_slice(), [Event::Committed { updates, watched, .. }]
                if updates.is_empty() && watched.len() == 1),
            "a watched write reaches every consumer: {:?}",
            shapes(&other_seen)
        );
        assert_eq!(ids(&drain(&mut owner).await), vec![3]);
    });
}
