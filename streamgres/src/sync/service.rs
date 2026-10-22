//! The asynchronous driver: one task owns the runtime, takes commands
//! (subscribe, unsubscribe) from a channel and committed transactions
//! from the feed's, hands every delta to an event channel, and runs the
//! storage reads the runtime asks for. Every read, a registration's
//! snapshot as much as a join fetch or a window refill, runs as its own
//! task while the loop keeps routing; the loop never waits on storage, and
//! each result is brought up to the engine's position when it lands. The
//! runtime is touched only between awaits. Single-threaded by design: run
//! it on a [`tokio::task::LocalSet`].
//!
//! Besides the deltas, the events tell a consumer what it needs to batch
//! and to acknowledge without touching the runtime: which subscription a
//! registration became, when a subscription's first rows have all
//! arrived, when a read landed, and where the stream is after each
//! transaction, with the writes on the tables the consumer watches for
//! itself. Everything a consumer learns arrives on that one stream, so a
//! subscription is always named before anything about it is: no consumer
//! ever meets a [`SubId`] it has not been told about. The consumer may be
//! several ([`Service::with_sinks`]): a registration says which sink asked
//! for it, the service remembers the sink of every subscription, and what
//! concerns a subscription (its deltas, its refusal, its completion) goes
//! to that sink alone, each delta cut down to the subscriptions the sink
//! owns; what concerns everyone (a commit) goes to every sink. The engine
//! under the service never learns of clients or sinks: it names
//! subscriptions, and this is where a subscription finds its way home.

use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use crate::log::{Level, log_event, log_info, log_warn};

/// PostgreSQL's epoch (2000-01-01) in microseconds since the Unix epoch.
const PG_EPOCH_UNIX_MICROS: i64 = 946_684_800_000_000;

use tokio::sync::mpsc;
use tokio::task::spawn_local;

use super::catalog::CatalogHandle;
use super::runtime::{Runtime, Step};
use super::storage::{Storage, StorageError};
use crate::ivm::{Audience, Delta, Engine, Fetch, FetchId, SchemaChange, Subs};
use crate::model::frame::SharedRow;
use crate::model::{
    Catalog, DataFrameKey, DataFrameRow, IdMap, Lsn, Snapshot, SubId, TableName, WriteQuery,
};
use crate::stats::Stats;

/// What a client of the service can ask.
///
/// - `Register`: subscribe, on behalf of sink `sink` (the index of the
///   asking consumer among [`Service::with_sinks`]'s; zero when there is
///   one); the subscription's id comes back to that sink as
///   [`Event::Registered`] carrying `token` unchanged, before any event
///   about that subscription, and its first rows arrive as updates like
///   every other change.
/// - `Unregister`: unsubscribe one subscription.
/// - `UnregisterAll`: unsubscribe several in one step (a client group
///   that went away names its own).
/// - `Transaction`: one committed transaction, which the feed normally
///   delivers on its own channel ([`Service::with_feed`]) and a caller
///   without a feed hands in here.
pub enum Command<Q> {
    Register { sink: usize, query: Q, token: u64 },
    Unregister(SubId),
    UnregisterAll(Vec<SubId>),
    Transaction(Transaction),
}

/// One committed transaction as the feed delivers it: every write of it,
/// the location of its commit record, the position the feed has delivered
/// everything up to once it is applied, the writes among them on the
/// tables the consumer watches for itself, the schema changes it carried
/// with the catalog they make (`None` when it carried none), and the
/// instant the feed decoded it (where the server's own clock on it
/// starts). A transaction is one step of the engine, so nothing can be
/// interleaved inside it: a read that lands while it is being routed is
/// seen only once the whole transaction has been, and a consumer never
/// meets half of one.
#[derive(Debug)]
pub struct Transaction {
    pub writes: Vec<WriteQuery>,
    pub at: Lsn,
    pub progress: Lsn,
    pub watched: Vec<WriteQuery>,
    pub schema: Vec<SchemaChange>,
    pub catalog: Option<Arc<Catalog>>,
    pub received: Instant,
    pub committed_at_micros: i64,
    pub decode: Duration,
}

impl Transaction {
    /// The feed's position without a transaction to carry it: everything
    /// committed at or below `position` has been delivered, and nothing
    /// was written. It is one step like any other, which is what moves
    /// the engine, and the snapshots waiting on it, while nobody writes.
    pub fn mark(position: Lsn) -> Self {
        Self::new(Vec::new(), position)
    }

    /// Whether the feed is delivering this transaction a second time: it
    /// committed at or below `position`, which the engine has applied
    /// everything up to. A slot reopened after a lost connection resumes
    /// from the last position the server saw confirmed, so the
    /// transactions received after that confirmation come again; commit
    /// records end at distinct locations, so the comparison is exact.
    pub fn repeats(&self, position: Lsn) -> bool {
        !self.is_mark() && self.at <= position
    }

    /// Whether this is a position mark rather than a transaction
    /// PostgreSQL committed (which carries the time it committed, even
    /// when none of its writes were on a table of the catalog).
    pub fn is_mark(&self) -> bool {
        self.writes.is_empty() && self.committed_at_micros == 0
    }

    /// A transaction of `writes` committed at `at`, the feed's progress
    /// mark being that same location, with nothing watched, received now.
    pub fn new(writes: Vec<WriteQuery>, at: Lsn) -> Self {
        Transaction {
            writes,
            at,
            progress: at,
            watched: Vec::new(),
            schema: Vec::new(),
            catalog: None,
            received: Instant::now(),
            committed_at_micros: 0,
            decode: Duration::ZERO,
        }
    }

    /// The transaction with the schema `changes` it carried and the
    /// `catalog` they make.
    pub fn with_schema(mut self, changes: Vec<SchemaChange>, catalog: Arc<Catalog>) -> Self {
        self.schema = changes;
        self.catalog = Some(catalog);
        self
    }
}

/// What the service tells its consumer. Every step's deltas (folded per
/// client and row) travel inside the event that ends the step, so a
/// consumer never sees half a step, and a transaction's rows and its
/// watched writes are one event.
///
/// - `Registered`: the subscription a [`Command::Register`] became, with
///   that command's `token`, the rows it was served at once (a twin's) and
///   `reads`, how many storage reads the registration issued (zero when
///   the frames already held answered it). It precedes every other event
///   about the subscription.
/// - `Landed`: a storage read landed, with the deltas it produced.
/// - `Refused`: a storage read the subscription depended on was refused
///   (it returned more rows than a read may), so the subscription is gone;
///   `reason` is what the client can be told.
/// - `Committed`: a transaction was applied: its deltas for this
///   consumer, the engine's position, the storage floor, the transaction's
///   writes on the watched tables, and two instants for the consumer's
///   clock, when the feed decoded the transaction and when the engine
///   finished with it. A consumer serves once the position covers the
///   floor. With several consumers, one already serving hears only the
///   commits with deltas for it or watched writes.
/// - `Hydrated`: subscriptions whose first rows have all arrived (every
///   part of their tree is live), each named once.
/// - `Capped`: a page of the subscription stopped reaching past the rows
///   its join gate rejects, so it holds fewer rows than asked for: a
///   query to report by name. The subscription stays.
/// - `Heavy`: a read the subscription's tree waited on came back with at
///   least half the row limit: a query to report by name before it grows
///   into the limit and is refused. Sent once per read, to the owner of
///   one subscription of the tree.
#[derive(Debug)]
pub enum Event {
    Registered {
        token: u64,
        sub: SubId,
        updates: Vec<Delta>,
        reads: usize,
    },
    Landed {
        updates: Vec<Delta>,
    },
    Refused {
        sub: SubId,
        reason: String,
    },
    Committed {
        updates: Vec<Delta>,
        position: Lsn,
        floor: Lsn,
        watched: Vec<WriteQuery>,
        received: Instant,
        routed: Instant,
    },
    Hydrated(Vec<SubId>),
    Capped {
        sub: SubId,
    },
    Heavy {
        sub: SubId,
        table: TableName,
        rows: u64,
    },
}

/// How a step ended: what its deltas travel inside of.
enum Outcome {
    Registered {
        sink: usize,
        token: u64,
        sub: SubId,
        reads: usize,
    },
    Landed,
    Committed {
        position: Lsn,
        floor: Lsn,
        watched: Vec<WriteQuery>,
        received: Instant,
        routed: Instant,
    },
    Nothing,
}

/// The loop's handles: the command inlet, the feed's transaction inlet
/// when there is one, and the event outlet.
pub struct Service<E: Engine, S: Storage> {
    runtime: Runtime<E>,
    storage: Rc<S>,
    commands: mpsc::Receiver<Command<E::Query>>,
    feed: Option<mpsc::Receiver<Transaction>>,
    sinks: Vec<mpsc::UnboundedSender<Event>>,
    stats: Option<Arc<Stats>>,
    /// The sink every live subscription belongs to: where its deltas and
    /// whatever else concerns it are sent.
    owners: IdMap<SubId, usize>,
    /// Subscriptions registered but not yet reported hydrated.
    awaiting: IdMap<SubId, ()>,
    /// When each read in flight was handed to the driver, for `read_io`.
    issued: IdMap<FetchId, Instant>,
    /// When every awaited subscription was last checked for completion;
    /// the checks otherwise touch only what a step could have completed.
    swept: Instant,
    /// The thread that frees dropped rows and landed batches, so a
    /// release of a large subscription or the landing of a large read
    /// costs the engine its bookkeeping and not the allocator's work.
    reaper: std::sync::mpsc::Sender<Dead>,
    lag_warned: Option<Instant>,
    /// Whether every sink has been sent a commit whose position covers the
    /// storage floor, the one it starts serving on (every sink not yet
    /// serving hears every commit, so they all get that one together).
    /// From then on, with several sinks, a sink hears a commit only when
    /// the commit has deltas for it or watched writes: each send wakes its
    /// thread.
    serving: bool,
    results: mpsc::UnboundedReceiver<(FetchId, Result<Snapshot, StorageError>)>,
    report: mpsc::UnboundedSender<(FetchId, Result<Snapshot, StorageError>)>,
    /// The catalog the clients' side reads, when the service is to keep
    /// it current ([`Service::with_catalog`]).
    catalog: Option<Arc<CatalogHandle>>,
    /// Catalogs of schema changes applied to the engine, each with the
    /// position it took effect at, waiting for the storage floor to reach
    /// that position before the clients' side sees them, and the tables
    /// the change touched.
    pending: VecDeque<(Lsn, Arc<Catalog>, Vec<TableName>)>,
}

impl<E, S> Service<E, S>
where
    E: Engine + 'static,
    E::Query: 'static,
    S: Storage + 'static,
{
    /// A service over `engine` and `storage`, delivering events to
    /// `events`; returns it with the command sender to drive it by.
    pub fn new(
        engine: E,
        storage: Rc<S>,
        events: mpsc::UnboundedSender<Event>,
    ) -> (Self, mpsc::Sender<Command<E::Query>>) {
        let (commands_tx, commands) = mpsc::channel(1024);
        let (report, results) = mpsc::unbounded_channel();
        let service = Service {
            runtime: Runtime::new(engine),
            storage,
            commands,
            feed: None,
            sinks: vec![events],
            stats: None,
            owners: IdMap::default(),
            awaiting: IdMap::default(),
            issued: IdMap::default(),
            swept: Instant::now(),
            reaper: spawn_reaper(),
            lag_warned: None,
            serving: false,
            results,
            report,
            catalog: None,
            pending: VecDeque::new(),
        };
        (service, commands_tx)
    }

    /// Keep `catalog`, the one the clients' side plans and translates by,
    /// current with the schema changes the feed delivers: each is
    /// published there once the storage's snapshot has the change, so
    /// that a query on a new table is never planned against a snapshot
    /// that lacks it.
    pub fn with_catalog(mut self, catalog: Arc<CatalogHandle>) -> Self {
        self.catalog = Some(catalog);
        self
    }

    /// Take the committed transactions from `feed` as well.
    pub fn with_feed(mut self, feed: mpsc::Receiver<Transaction>) -> Self {
        self.feed = Some(feed);
        self
    }

    /// Deliver the events to `sinks` instead (at least one): a
    /// subscription's go to the sink its registration named.
    pub fn with_sinks(mut self, sinks: Vec<mpsc::UnboundedSender<Event>>) -> Self {
        if !sinks.is_empty() {
            self.sinks = sinks;
        }
        self
    }

    /// Record how long each transaction waits for the engine and takes in
    /// it, and publish the engine's counters, into `stats`.
    pub fn with_stats(mut self, stats: Arc<Stats>) -> Self {
        self.stats = Some(stats);
        self
    }

    /// Run until every command sender is dropped (or the feed ends);
    /// returns the runtime for inspection.
    pub async fn run(mut self) -> Runtime<E> {
        let mut commands = Vec::with_capacity(64);
        let mut transactions = Vec::with_capacity(64);
        loop {
            tokio::select! {
                taken = self.commands.recv_many(&mut commands, 64) => {
                    if let Some(stats) = &self.stats {
                        stats
                            .engine_inbox
                            .store(self.commands.len() as u64, Ordering::Relaxed);
                    }
                    if taken == 0 {
                        break;
                    }
                    for command in commands.drain(..) {
                        self.handle(command);
                    }
                }
                taken = recv_transactions(&mut self.feed, &mut transactions) => {
                    if taken == 0 {
                        break;
                    }
                    for transaction in transactions.drain(..) {
                        if transaction.repeats(self.runtime.position()) {
                            continue;
                        }
                        self.commit(transaction);
                    }
                }
                result = self.results.recv() => match result {
                    Some((id, Ok(snapshot))) => {
                        let started = Instant::now();
                        if let Some(stats) = &self.stats
                            && let Some(issued) = self.issued.remove(&id)
                        {
                            stats.read_io.record(started.duration_since(issued));
                        }
                        let waiting = self.runtime.waiting_on(id);
                        self.note_heavy(id, snapshot.rows.len() as u64, &waiting);
                        let step = self.runtime.fetched(id, snapshot);
                        if let Some(stats) = &self.stats {
                            stats.land_step.record(started.elapsed());
                        }
                        self.dispatch(step, Outcome::Landed);
                        self.settle(&waiting);
                        self.reap();
                    }
                    Some((id, Err(error))) => {
                        self.issued.remove(&id);
                        if let Some(reason) = error.refusal() {
                            log_warn!("storage read {} refused: {reason}", id.0);
                            for sub in self.runtime.refused(id) {
                                self.awaiting.remove(&sub);
                                if let Some(sink) = self.owners.remove(&sub) {
                                    self.send_to(
                                        sink,
                                        Event::Refused {
                                            sub,
                                            reason: reason.to_owned(),
                                        },
                                    );
                                }
                            }
                        } else {
                            log_warn!("storage read {} failed, parked: {error}", id.0);
                            let step = self.runtime.failed(id);
                            self.dispatch(step, Outcome::Nothing);
                        }
                    }
                    None => break,
                },
            }
        }
        self.runtime
    }

    /// Apply one command to the runtime and dispatch what it produced.
    fn handle(&mut self, command: Command<E::Query>) {
        match command {
            Command::Register { sink, query, token } => {
                let started = Instant::now();
                let sink = sink.min(self.sinks.len() - 1);
                let (sub, step) = self.runtime.register(query);
                let reads = step.selects.len();
                if let Some(stats) = &self.stats {
                    stats.register_step.record(started.elapsed());
                }
                self.owners.insert(sub, sink);
                self.awaiting.insert(sub, ());
                self.dispatch(
                    step,
                    Outcome::Registered {
                        sink,
                        token,
                        sub,
                        reads,
                    },
                );
                self.settle(&[sub]);
            }
            Command::Unregister(sub) => self.unregister(&[sub]),
            Command::UnregisterAll(subs) => self.unregister(&subs),
            Command::Transaction(transaction) => self.commit(transaction),
        }
    }

    /// Unsubscribe `subs` as one step.
    fn unregister(&mut self, subs: &[SubId]) {
        let started = Instant::now();
        for sub in subs {
            self.runtime.unregister(*sub);
            self.awaiting.remove(sub);
            self.owners.remove(sub);
        }
        self.reap();
        if let Some(stats) = &self.stats {
            stats.unregister_step.record(started.elapsed());
        }
    }

    /// Apply one committed transaction as one step: its schema changes
    /// absorbed first ([`Service::migrate`]), then every write routed,
    /// the progress mark taken, the storage told, the deltas delivered
    /// together, and the consumer told where the engine now is. A position
    /// mark is the same step with nothing to route; it is not counted or
    /// timed as a transaction.
    fn commit(&mut self, transaction: Transaction) {
        let mark = transaction.is_mark();
        let Transaction {
            writes,
            at,
            progress,
            watched,
            schema,
            catalog,
            received,
            committed_at_micros,
            decode,
        } = transaction;
        let started = Instant::now();
        let mut step = Step::default();
        if let Some(catalog) = catalog {
            self.migrate(at, &schema, catalog);
        }
        for write in &writes {
            self.storage.absorb(write, at);
            let routed = self.runtime.write(write, at);
            step.updates.extend(routed.updates);
            step.selects.extend(routed.selects);
        }
        let moved = self.runtime.progress(progress);
        step.updates.extend(moved.updates);
        step.selects.extend(moved.selects);
        self.moved();
        let position = self.runtime.position();
        let floor = self.runtime.floor();
        self.adopt(floor);
        let routed = Instant::now();
        if let Some(stats) = &self.stats {
            stats.feed_lsn.store(at.0, Ordering::Relaxed);
            stats.publish_engine(self.runtime.engine_stats(), self.runtime.stats());
            stats.publish_footprint(self.runtime.engine_footprint());
        }
        if let Some(stats) = self.stats.as_ref().filter(|_| !mark) {
            stats
                .feed_to_engine
                .record(started.duration_since(received));
            stats.engine_step.record(routed.duration_since(started));
            stats.feed_decode.record(decode);
            if committed_at_micros > 0 {
                let committed_unix = committed_at_micros.saturating_add(PG_EPOCH_UNIX_MICROS);
                let now_unix = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|since| i64::try_from(since.as_micros()).unwrap_or(i64::MAX))
                    .unwrap_or(0);
                let lag = u64::try_from(now_unix - committed_unix).unwrap_or(0);
                stats.feed_lag.record(Duration::from_micros(lag));
                if lag >= 5_000_000
                    && self
                        .lag_warned
                        .is_none_or(|warned| warned.elapsed() >= Duration::from_secs(60))
                {
                    self.lag_warned = Some(Instant::now());
                    log_warn!(
                        "the feed is {:.1} s behind PostgreSQL's commits at position {}",
                        lag as f64 / 1_000_000.0,
                        at.0
                    );
                }
            }
            log_event!(
                Level::Debug,
                "transaction routed",
                position = at.0,
                writes = writes.len(),
                client_updates = step.updates.len(),
                reads = step.selects.len(),
                ms = format!(
                    "{:.2}",
                    routed.duration_since(started).as_secs_f64() * 1000.0
                )
            );
            stats.transactions.fetch_add(1, Ordering::Relaxed);
            stats
                .writes
                .fetch_add(writes.len() as u64, Ordering::Relaxed);
        }
        self.dispatch(
            step,
            Outcome::Committed {
                position,
                floor,
                watched,
                received,
                routed,
            },
        );
        self.reap();
    }

    /// A transaction committed at `at` carried schema `changes`, making
    /// `catalog`: the engine's held rows and the memory tables are brought
    /// onto the new layouts before the transaction's writes are routed (a
    /// write of the same transaction may already be in the new shape),
    /// the storage is told to read by `catalog` from `at` on and to mint a
    /// snapshot now rather than at its next tick, and the catalog waits
    /// for the storage floor to reach `at` before the clients' side sees
    /// it ([`Service::adopt`]).
    fn migrate(&mut self, at: Lsn, changes: &[SchemaChange], catalog: Arc<Catalog>) {
        let started = Instant::now();
        for change in changes {
            self.storage.alter(change);
            self.runtime.alter(change);
        }
        self.storage.follow(at, catalog.clone());
        self.storage.mint_now();
        let mut touched: Vec<TableName> = Vec::new();
        for change in changes {
            let table = match change {
                SchemaChange::TableAdded { table } => &table.name,
                SchemaChange::ColumnAdded { table, .. } => table,
            };
            if !touched.contains(table) {
                touched.push(table.clone());
            }
        }
        self.pending.push_back((at, catalog, touched));
        log_info!(
            "schema changed at {at}: {} change(s) absorbed in {:?}; the clients' side sees it with the next snapshot",
            changes.len(),
            started.elapsed()
        );
    }

    /// Publish to the clients' side every waiting catalog whose position
    /// the storage `floor` has reached: from here on every read it plans
    /// and every query it translates meets a snapshot that has the change.
    fn adopt(&mut self, floor: Lsn) {
        while self.pending.front().is_some_and(|(at, _, _)| *at <= floor) {
            let Some((at, catalog, touched)) = self.pending.pop_front() else {
                break;
            };
            if let Some(handle) = &self.catalog {
                handle.swap(catalog.clone());
            }
            log_info!(
                "the schema of {at} is in force at floor {floor}: {} tables",
                catalog.tables().count()
            );
            for name in &touched {
                if let Some(table) = catalog.table(name.as_str()) {
                    log_info!("schema pushed at {at}: {table}");
                }
            }
        }
    }

    /// Hand the rows the engine dropped, and the batches it landed, to
    /// the reaper thread.
    fn reap(&mut self) {
        let dead = self.runtime.take_dead();
        if !dead.is_empty() {
            let _ = self.reaper.send(Dead::Rows(dead));
        }
        for batch in self.runtime.take_landed() {
            if !batch.is_empty() {
                let _ = self.reaper.send(Dead::Landed(batch));
            }
        }
    }

    /// Send `event` to sink `sink`.
    /// A read of at least half the row limit is told to the owner of one
    /// subscription waiting on it, which knows the query's name.
    fn note_heavy(&self, id: FetchId, rows: u64, waiting: &[SubId]) {
        let heavy = self
            .stats
            .as_ref()
            .and_then(|stats| stats.heavy_read_rows())
            .is_some_and(|from| rows >= from);
        if !heavy {
            return;
        }
        let Some(table) = self.runtime.reading(id) else {
            return;
        };
        let owned = waiting
            .iter()
            .find_map(|sub| self.owners.get(sub).map(|sink| (*sub, *sink)));
        if let Some((sub, sink)) = owned {
            self.send_to(sink, Event::Heavy { sub, table, rows });
        }
    }

    fn send_to(&self, sink: usize, event: Event) {
        if let Some(sink) = self.sinks.get(sink) {
            let _ = sink.send(event);
        }
    }

    /// One step's deltas split by sink: each delta goes to the sinks that
    /// own any of its subscriptions, its audiences cut down to those. A
    /// tree's shared list is split once per step, however many of the
    /// step's deltas carry it; with one sink nothing is split at all.
    fn partition(&self, updates: Vec<Delta>) -> Vec<Vec<Delta>> {
        if self.sinks.len() == 1 {
            return vec![updates];
        }
        let sinks = self.sinks.len();
        let mut batches: Vec<Vec<Delta>> = (0..sinks).map(|_| Vec::new()).collect();
        let mut split: HashMap<usize, Vec<Option<Subs>>> = HashMap::new();
        for delta in updates {
            let mut audiences: Vec<Vec<Audience>> = (0..sinks).map(|_| Vec::new()).collect();
            for audience in &delta.audiences {
                match &audience.subs {
                    Subs::One(sub) => {
                        if let Some(&sink) = self.owners.get(sub) {
                            audiences[sink].push(audience.clone());
                        }
                    }
                    Subs::Many(list) => {
                        let parts = split.entry(list.as_ptr() as usize).or_insert_with(|| {
                            let mut owned: Vec<Vec<SubId>> =
                                (0..sinks).map(|_| Vec::new()).collect();
                            for sub in list.iter() {
                                if let Some(&sink) = self.owners.get(sub) {
                                    owned[sink].push(*sub);
                                }
                            }
                            owned
                                .into_iter()
                                .map(|subs| (!subs.is_empty()).then(|| Subs::of(&subs)))
                                .collect()
                        });
                        for (sink, subs) in parts.iter().enumerate() {
                            if let Some(subs) = subs {
                                audiences[sink].push(Audience {
                                    part: audience.part,
                                    subs: subs.clone(),
                                });
                            }
                        }
                    }
                }
            }
            for (sink, audiences) in audiences.into_iter().enumerate() {
                if !audiences.is_empty() {
                    batches[sink].push(Delta {
                        table: delta.table.clone(),
                        op: delta.op.clone(),
                        audiences,
                    });
                }
            }
        }
        batches
    }

    /// The stream moved: tell the storage, and learn its floor.
    fn moved(&mut self) {
        self.storage.advance(self.runtime.position());
        self.runtime.set_floor(self.storage.floor());
    }

    /// Deliver a step's deltas inside the event its `outcome` calls for
    /// (a registration's to its client's sink; a landing's to the sinks
    /// with any; a commit's to every sink, empty or not, except that with
    /// several sinks one already serving is not woken for a commit with
    /// nothing for it, no delta and no watched write), start each of
    /// its reads as a task, and name the subscriptions that became
    /// hydrated.
    fn dispatch(&mut self, step: Step, outcome: Outcome) {
        let Step { updates, selects } = step;
        match outcome {
            Outcome::Registered {
                sink,
                token,
                sub,
                reads,
            } => {
                self.send_to(
                    sink,
                    Event::Registered {
                        token,
                        sub,
                        updates,
                        reads,
                    },
                );
            }
            Outcome::Landed => {
                for (sink, batch) in self.sinks.iter().zip(self.partition(updates)) {
                    if !batch.is_empty() {
                        let _ = sink.send(Event::Landed { updates: batch });
                    }
                }
            }
            Outcome::Committed {
                position,
                floor,
                watched,
                received,
                routed,
            } => {
                let skip_empty = self.serving && self.sinks.len() > 1 && watched.is_empty();
                for (sink, batch) in self.sinks.iter().zip(self.partition(updates)) {
                    if skip_empty && batch.is_empty() {
                        continue;
                    }
                    let _ = sink.send(Event::Committed {
                        updates: batch,
                        position,
                        floor,
                        watched: watched.clone(),
                        received,
                        routed,
                    });
                }
                self.serving |= floor.0 != 0 && position >= floor;
            }
            Outcome::Nothing => {
                debug_assert!(updates.is_empty(), "a parked read has no deltas");
            }
        }
        for fetch in selects {
            self.spawn(fetch);
        }
        for sub in self.runtime.take_capped() {
            if let Some(&sink) = self.owners.get(&sub) {
                self.send_to(sink, Event::Capped { sub });
            }
        }
        if self.swept.elapsed() >= Duration::from_secs(1) {
            self.swept = Instant::now();
            let all: Vec<SubId> = self.awaiting.keys().copied().collect();
            self.settle(&all);
        }
    }

    /// Name those of `candidates` that are awaited and whose first rows
    /// have all arrived, each to the sink that owns it, and forget them.
    /// A step names the subscriptions it could have completed (the one it
    /// registered, the ones waiting on the read it landed); every awaited
    /// subscription is checked at most once a second besides, so the check
    /// never grows with the number still hydrating.
    fn settle(&mut self, candidates: &[SubId]) {
        let hydrated: Vec<(SubId, usize)> = candidates
            .iter()
            .filter_map(|sub| {
                self.awaiting.get(sub)?;
                let sink = *self.owners.get(sub)?;
                self.runtime.engine().hydrated(*sub).then_some((*sub, sink))
            })
            .collect();
        if hydrated.is_empty() {
            return;
        }
        let mut per_sink: Vec<Vec<SubId>> = (0..self.sinks.len()).map(|_| Vec::new()).collect();
        for (sub, sink) in hydrated {
            self.awaiting.remove(&sub);
            per_sink[sink].push(sub);
        }
        for (sink, subs) in self.sinks.iter().zip(per_sink) {
            if !subs.is_empty() {
                let _ = sink.send(Event::Hydrated(subs));
            }
        }
    }

    /// Run one read as its own task, reporting the result into the loop.
    fn spawn(&mut self, fetch: Fetch) {
        self.issued.insert(fetch.id, Instant::now());
        let storage = self.storage.clone();
        let report = self.report.clone();
        spawn_local(async move {
            let result = storage.select_shared(fetch.query.clone()).await;
            let _ = report.send((fetch.id, result));
        });
    }
}

/// Take up to a batch of transactions from the feed, if there is one; a
/// service without a feed waits here forever, and a feed that ended
/// yields nothing.
async fn recv_transactions(
    feed: &mut Option<mpsc::Receiver<Transaction>>,
    buffer: &mut Vec<Transaction>,
) -> usize {
    match feed {
        Some(feed) => feed.recv_many(buffer, 64).await,
        None => std::future::pending().await,
    }
}

/// What the reaper frees: rows whose last holder let go, and the row
/// batches of landed reads.
enum Dead {
    Rows(Vec<SharedRow>),
    Landed(Vec<(DataFrameKey, DataFrameRow)>),
}

/// Start the thread that frees dropped rows and return its inlet; the
/// thread ends when the last sender is gone.
fn spawn_reaper() -> std::sync::mpsc::Sender<Dead> {
    let (sender, receiver) = std::sync::mpsc::channel::<Dead>();
    let spawned = std::thread::Builder::new()
        .name("streamgres-reaper".to_owned())
        .spawn(move || {
            while let Ok(batch) = receiver.recv() {
                match batch {
                    Dead::Rows(rows) => drop(rows),
                    Dead::Landed(rows) => drop(rows),
                }
            }
        });
    if let Err(error) = spawned {
        log_warn!(
            "the reaper thread could not start ({error}); rows are freed on the engine thread"
        );
    }
    sender
}
