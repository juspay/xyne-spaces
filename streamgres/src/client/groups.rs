//! Every client group's view, and the threads that keep them. A group
//! thread owns no engine, no storage and no database connection: it sends
//! the engine side subscribe and unsubscribe commands and reads back that
//! side's events (deltas, hydrated subscriptions, landings, commits),
//! turning both into the pokes a Zero client expects. Connections hand it
//! requests over a channel (connect, disconnect, planned queries, pulls)
//! and receive finished frames.
//!
//! # Threads, batches, bytes
//!
//! There are `STREAMGRES_GROUP_THREADS` of these threads, each owning the
//! groups whose id hashes to it; the engine side knows which thread
//! registered each subscription and sends it that subscription's share of
//! every delta, so a thread hears only of its own groups. A thread
//! wakes, takes everything the connections and the engine side have sent
//! since, applies all of it, and only then pokes each group that has
//! something to hear, once: idle, that is one poke per transaction; under
//! load one poke carries every transaction that arrived meanwhile, which
//! is what keeps the frame count per connection bounded as the write rate
//! climbs. Every row image is serialized to its `rowsPatch` bytes once,
//! the first time any group is sent it, and the bytes stay on the image
//! for every group's frame that carries it, in this flush or a later one;
//! a group's frame is a prefix, those fragments, and a suffix, so a poke
//! costs the bookkeeping and a copy, never a JSON tree per group.
//!
//! # A client group's view
//!
//! Zero's client keeps one row store per client group, shared by its
//! queries, and learns of changes as pokes: a versioned batch of row puts
//! and dels, query-state patches and mutation ids. This module keeps, per
//! group, the queries each of its clients desires (by hash), the
//! subscription behind each query, and for every row shipped the
//! subscription parts holding it, so a row is `del`ed only when its last
//! holder lets go. A poke goes out per
//! committed transaction (so a mutation's rows and its `lastMutationID`
//! travel together), per landed read, and per query change, advancing the
//! group's version; the version is the cookie the client hands back when
//! it reconnects.
//!
//! # A client that comes back, or comes late
//!
//! What a client is owed is everything after its cookie, and a group
//! answers that in one of four ways ([`Groups::connect`]):
//!
//! - **The cookie is the group's version.** Nothing is owed. This is the
//!   usual reconnect, because a group with no connection open stands
//!   still: its deltas are still accounted against its row ledger as they
//!   arrive, but they wait as one coalesced list of row operations and no
//!   poke is built, so the version stays where the last client left it and
//!   the first poke after it returns carries all it missed.
//! - **No cookie, and the group is under way** (a tab opened before the
//!   store it shares held a cookie). The newcomer is sent the group's
//!   whole state from the ledger, as one poke from nothing to the group's
//!   version; the other connections of the group are not disturbed.
//! - **An older cookie the group's log still reaches** (a tab that was
//!   away while another kept the group moving). The group keeps its most
//!   recent pokes, as the frames it already built, up to
//!   `STREAMGRES_GROUP_LOG_BYTES`: every poke sent is kept and the oldest
//!   dropped until the rest fit, whether or not anyone was really
//!   listening (a socket that died unnoticed is sent to, and logged for,
//!   until the server learns of it). The returning connection is sent the
//!   ones after its cookie, as they were — but for the mutation ids: each
//!   replayed poke closes with a part carrying the group's mutation ids
//!   as they are *now*, so the first poke the client processes already
//!   confirms every mutation the application has processed since the
//!   poke was built. A logged poke tells the ids of its time; a client
//!   rebases its still-pending mutations against every poke that does not
//!   confirm them, and one of those, replayed stale, can make a mutator
//!   fail on a row the poke has since removed and drop the connection —
//!   on every reconnect, since the replay is the same. The client merges
//!   a poke's parts in order and refuses an id that goes backwards, so
//!   every replayed poke gets the same current ids, in its last part.
//! - **Anything else** (a cookie older than the log, or from a server
//!   that is gone): the client is told to start over, and syncs afresh.
//!
//! The application's mutation ids arrive as writes to its clients table,
//! which the engine side carries inside the transaction's own
//! [`Event::Committed`], so a mutation's rows and its id go out in the
//! same poke and no later transaction's id rides out early. At every
//! connect they are also read from the table itself, merged into what the
//! group knows, and sent with the connection's first poke: the state
//! poke, the replayed pokes, or a poke of their own at the next flush.
//!
//! The result of a mutation the application server refused (an
//! application error; a mutation that succeeds leaves none) is recorded in
//! its results table in the same transaction as the mutation's id, and
//! reaches the group the same way: as a `mutationsPatch` entry in the same
//! poke as the id, as zero-cache sends it. The client applies a poke whole
//! and settles its mutations from the results before it counts the id,
//! so the mutation is rejected with the application's error rather than
//! taken for a success. Once the client acknowledges its results the
//! application server deletes them, and the deletions go out the same way.
//! At every connect the results still waiting are read with the ids and
//! sent with them.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use bytes::Bytes;
use serde_json::{Value as Json, json};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::spawn_local;

use super::ast::Translated;
use super::config::Config;
use super::protocol;
use super::wire;
use crate::ivm::{Delta, QueryPart};
use crate::log::{Level, log_debug, log_event, log_info, log_warn};
use crate::model::{
    Catalog, DataFrameKey, DataFrameOperation, DataFrameRow, IdMap, IdSet, Lsn,
    MultiTableReadQuery, RowData, SubId, TableName, Value, WriteQuery,
};
use crate::stats::Stats;
use crate::sync::{CatalogHandle, Command, Event};

/// What goes out on one connection: a text frame, one poke (its frames
/// written together, one flush; `since` is when the feed decoded the
/// oldest transaction it carries, `sent` when it was handed over, both
/// for the server's own clock), a WebSocket ping (the liveness probe a
/// browser answers on its own), or the close.
#[derive(Debug, Clone)]
pub enum Outbound {
    Text(Arc<str>),
    Poke {
        frames: Arc<[Bytes]>,
        since: Option<Instant>,
        sent: Instant,
    },
    Ping,
    Close,
}

/// What a client group holds, by table and row key: looked up by
/// reference, so a delta the group already has the image of costs two
/// hash probes and no copy of its key.
type Ledger = IdMap<TableName, IdMap<DataFrameKey, Held>>;

/// One delta waiting for a group's next poke, shared with every other
/// group it concerns, and the subscriptions and parts of this group it
/// applies to.
struct Pending {
    delta: Rc<Delta>,
    holders: Vec<(SubId, QueryPart)>,
}

/// A connection's handle: the client it speaks for and where its frames
/// go.
#[derive(Debug, Clone)]
pub struct Socket {
    pub client: String,
    pub sink: mpsc::UnboundedSender<Outbound>,
}

/// One change to a client's desired queries, ready for this thread: a
/// query already translated and planned (`Some(Ok)`), one that could not
/// be and whose client has been told (`Some(Err)`), or a hash the client
/// re-desires without an AST (`None`).
#[derive(Debug)]
pub enum DesiredOp {
    Put {
        hash: String,
        name: String,
        ttl: Option<f64>,
        planned: Option<Result<Box<Translated>, String>>,
    },
    Del {
        hash: String,
    },
    Clear,
}

/// A mutation result waiting in the application server's results table:
/// the result of `client`'s mutation `id`, as the server wrote it.
#[derive(Debug, Clone, PartialEq)]
pub struct MutationResult {
    pub client: String,
    pub id: i64,
    pub result: Json,
}

/// What a connection asks of this thread.
#[derive(Debug)]
pub enum Request {
    Connect {
        group: String,
        wsid: String,
        socket: Socket,
        base_cookie: Option<String>,
        lmids: Vec<(String, i64)>,
        results: Vec<MutationResult>,
        reply: oneshot::Sender<ConnectReply>,
    },
    Disconnect {
        group: String,
        wsid: String,
    },
    Desired {
        group: String,
        client: String,
        ops: Vec<DesiredOp>,
    },
    DeleteClients {
        group: String,
        clients: Vec<String>,
    },
    Pull {
        group: String,
        reply: oneshot::Sender<(String, HashMap<String, i64>)>,
    },
    Expire {
        group: String,
        generation: u64,
    },
    ExpireQuery {
        group: String,
        hash: String,
        generation: u64,
    },
}

/// How long a query outlives the last client desiring it when the client
/// gave no `ttl`.
const DEFAULT_QUERY_TTL: Duration = Duration::from_secs(300);
/// The longest a query outlives the last client desiring it.
const MAX_QUERY_TTL: Duration = Duration::from_secs(600);

/// A client's `ttl` (milliseconds) as the lifetime honored for it.
fn lifetime_of(ttl: Option<f64>) -> Duration {
    match ttl {
        Some(ms) if ms.is_finite() && ms >= 0.0 => {
            Duration::from_millis(ms.min(MAX_QUERY_TTL.as_millis() as f64) as u64)
        }
        _ => DEFAULT_QUERY_TTL,
    }
}

/// This thread's answer to a connection.
#[derive(Debug)]
pub enum ConnectReply {
    Accepted,
    /// The client's cookie is not one this server holds; the client must
    /// start over.
    Reset {
        reason: String,
    },
}

/// One row operation bound for a group.
enum RowOp {
    Put(TableName, DataFrameKey, DataFrameRow),
    Del(TableName, DataFrameKey),
}

/// One desired query of a group.
///
/// - `sub`: the subscription, once the engine side has answered.
/// - `awaiting`: the generation of the registration in flight, zero when
///   none is.
/// - `hidden`: the parts of its tree whose rows are not shipped.
/// - `got`: whether the client has been told the query is complete.
/// - `ttl`: how long it outlives the last client desiring it.
/// - `inactive`: the generation of the release in flight, zero while a
///   client still desires it.
struct QueryState {
    sub: Option<SubId>,
    awaiting: u64,
    hidden: HashSet<QueryPart>,
    got: bool,
    ttl: Duration,
    inactive: u64,
    /// When the query was last sent to register, for the hydration clock.
    since: Instant,
    /// Whether the registration had to read storage.
    cold: bool,
    /// The query's name, for the error a refusal carries.
    name: String,
    /// The reason and moment of a refusal, while a re-ask is answered
    /// with the same error instead of a registration.
    refused: Option<(String, Instant)>,
}

/// How long a refused query stays refused: a client asking again within
/// this hears the reason again; after it the query is registered anew
/// (the data or the budget may have changed).
const REFUSAL_COOLDOWN: Duration = Duration::from_secs(60);

/// What a client group holds of one row: who shows it (subscription and
/// part) and the image last sent, so a second holder of the same image
/// sends nothing and a released holder deletes nothing another still
/// shows.
struct Held {
    holders: IdSet<(SubId, QueryPart)>,
    image: Arc<RowData>,
}

/// Account one delta against the group's row ledger and say what the
/// client hears: a put when the row is new to it or its image changed, a
/// del when its last holder let go, nothing when another holder already
/// showed the same image or still shows the row. This is the one place a
/// row is decided to travel or not, whatever brought it: a query's first
/// rows, a write, or a read a write set off.
fn account(
    rows: &mut Ledger,
    table: &TableName,
    key: &DataFrameKey,
    image: Option<&DataFrameRow>,
    holders: IdSet<(SubId, QueryPart)>,
) -> Option<RowOp> {
    match image {
        Some(image) => {
            if holders.is_empty() {
                return None;
            }
            if !rows.contains_key(table) {
                rows.insert(table.clone(), IdMap::default());
            }
            let of_table = rows.get_mut(table)?;
            match of_table.get_mut(key) {
                Some(held) => {
                    held.holders.extend(holders);
                    if Arc::ptr_eq(&held.image, &image.data) || *held.image == *image.data {
                        return None;
                    }
                    held.image = image.data.clone();
                }
                None => {
                    of_table.insert(
                        key.clone(),
                        Held {
                            holders,
                            image: image.data.clone(),
                        },
                    );
                }
            }
            Some(RowOp::Put(table.clone(), key.clone(), image.clone()))
        }
        None => {
            let of_table = rows.get_mut(table)?;
            let held = of_table.get_mut(key)?;
            for holder in &holders {
                held.holders.remove(holder);
            }
            if !held.holders.is_empty() {
                return None;
            }
            of_table.remove(key);
            if of_table.is_empty() {
                rows.remove(table);
            }
            Some(RowOp::Del(table.clone(), key.clone()))
        }
    }
}

/// Every row the group shows only through `sub`, taken out of the ledger:
/// the deletes a released subscription owes the client.
fn release_rows(rows: &mut Ledger, sub: SubId) -> Vec<(TableName, DataFrameKey)> {
    let mut emptied = Vec::new();
    for (table, of_table) in rows.iter_mut() {
        of_table.retain(|key, held| {
            held.holders.retain(|(holder, _)| *holder != sub);
            if held.holders.is_empty() {
                emptied.push((table.clone(), key.clone()));
            }
            !held.holders.is_empty()
        });
    }
    rows.retain(|_, of_table| !of_table.is_empty());
    emptied
}

/// One client group's view.
///
/// `generation` stamps the group's last connect or disconnect from the
/// one monotonic counter, so an expiry timer scheduled for an earlier
/// incarnation of the same group id can never match this one.
struct Group {
    version: u64,
    generation: u64,
    sockets: HashMap<String, Socket>,
    desired: HashMap<String, HashSet<String>>,
    queries: HashMap<String, QueryState>,
    subs: IdSet<SubId>,
    /// The hidden parts of each subscription, for the per-row check.
    hidden: IdMap<SubId, HashSet<QueryPart>>,
    rows: Ledger,
    lmids: HashMap<String, i64>,
    queued_desired: HashMap<String, Vec<Json>>,
    queued_got: Vec<Json>,
    queued_lmids: HashMap<String, i64>,
    /// `mutationsPatch` entries for the next poke, in the order heard.
    queued_results: Vec<Json>,
    queued_rows: Vec<RowOp>,
    /// How long `queued_rows` was when it was last coalesced: a group
    /// with no connection coalesces its waiting operations again only once
    /// they have doubled, so holding them costs each delta once.
    queued_floor: usize,
    log: PokeLog,
}

/// A group's most recent pokes as the frames that were sent, oldest
/// first and without a gap up to the group's version, within a budget of
/// bytes: every poke sent is pushed, and the oldest are dropped until the
/// rest fit. It is what a connection that returns behind the group is
/// sent: a tab that reconnects before it has taken up what another tab
/// stored, or a client whose socket died unnoticed while the server went
/// on sending to it. A poke larger than the whole budget (a first
/// hydration) empties the log, since nothing older can be continued from
/// without it.
#[derive(Default)]
struct PokeLog {
    pokes: VecDeque<Logged>,
    bytes: usize,
}

/// One poke as the log keeps it: the version it took the group to, its
/// id (what a part added at replay names), its frames and the bytes it
/// is counted as.
struct Logged {
    version: u64,
    poke_id: String,
    frames: Arc<[Bytes]>,
    size: usize,
}

/// What a logged frame is counted as on top of its own bytes, for the
/// allocations that hold it, so a log of many small pokes stays near its
/// budget in memory too.
const FRAME_OVERHEAD: usize = 64;

impl PokeLog {
    /// Remember the poke `poke_id` that took the group to `version`.
    fn push(&mut self, version: u64, poke_id: &str, frames: &Arc<[Bytes]>, budget: usize) {
        let size: usize = frames
            .iter()
            .map(|frame| frame.len() + FRAME_OVERHEAD)
            .sum();
        if size > budget {
            self.pokes.clear();
            self.bytes = 0;
            return;
        }
        self.pokes.push_back(Logged {
            version,
            poke_id: poke_id.to_owned(),
            frames: frames.clone(),
            size,
        });
        self.bytes += size;
        while self.bytes > budget {
            match self.pokes.pop_front() {
                Some(dropped) => self.bytes -= dropped.size,
                None => break,
            }
        }
    }

    /// The pokes after `version`, in order, as their ids and frames, when
    /// the log reaches back that far.
    fn after(&self, version: u64) -> Option<Vec<(String, Arc<[Bytes]>)>> {
        let oldest = self.pokes.front()?.version;
        (oldest <= version + 1).then(|| {
            self.pokes
                .iter()
                .filter(|logged| logged.version > version)
                .map(|logged| (logged.poke_id.clone(), logged.frames.clone()))
                .collect()
        })
    }
}

impl Group {
    /// An empty group.
    fn new() -> Self {
        Group {
            version: 0,
            generation: 0,
            sockets: HashMap::new(),
            desired: HashMap::new(),
            queries: HashMap::new(),
            subs: IdSet::default(),
            hidden: IdMap::default(),
            rows: IdMap::default(),
            lmids: HashMap::new(),
            queued_desired: HashMap::new(),
            queued_got: Vec::new(),
            queued_lmids: HashMap::new(),
            queued_results: Vec::new(),
            queued_rows: Vec::new(),
            queued_floor: 0,
            log: PokeLog::default(),
        }
    }

    /// Send one poke's frames to every connection of the group.
    fn broadcast(&self, frames: &Arc<[Bytes]>, since: Option<Instant>) {
        let sent = Instant::now();
        for socket in self.sockets.values() {
            let _ = socket.sink.send(Outbound::Poke {
                frames: frames.clone(),
                since,
                sent,
            });
        }
    }
}

/// One group thread's state.
///
/// - `shard`: this thread's index among the group threads; every
///   registration names it as the sink its subscription belongs to.
/// - `by_sub`: the group and query hash of every subscription this thread
///   owns: the engine side names subscriptions, and this is where a
///   subscription finds its client group.
/// - `pending`: the deltas waiting for each group's next poke.
/// - `stats`: where the flushes and the pokes are timed; `oldest` is when
///   the feed decoded the oldest transaction applied since the last flush,
///   the start of the clock every poke of the next flush carries.
pub struct Groups {
    config: Arc<Config>,
    catalog: Arc<CatalogHandle>,
    shard: usize,
    stats: Arc<Stats>,
    oldest: Option<Instant>,
    /// Commands to the engine side, in the order they were made.
    commands: mpsc::UnboundedSender<Command<MultiTableReadQuery>>,
    requests: mpsc::Sender<Request>,
    ready: bool,
    /// Flipped once, when this thread starts serving; the connections and
    /// the health check watch it.
    readiness: watch::Sender<bool>,
    backlog: Vec<Request>,
    groups: HashMap<String, Group>,
    by_sub: HashMap<SubId, (String, String)>,
    /// Registrations in flight, by the token they were sent with.
    awaiting: HashMap<u64, (String, String)>,
    pending: HashMap<String, Vec<Pending>>,
    lmid_changes: HashMap<String, HashMap<String, i64>>,
    /// The `mutationsPatch` entries each group heard since the last flush.
    result_changes: HashMap<String, Vec<Json>>,
    /// Groups with something to hear at the next flush.
    dirty: HashSet<String>,
    clients_table: TableName,
    mutations_table: TableName,
    next_poke: u64,
    next_generation: u64,
}

/// Run group thread `shard` of `shards` until every request sender is
/// gone: take what the connections and the engine side sent, in batches,
/// apply it, and flush once per batch. Must run inside a `LocalSet`.
#[allow(clippy::too_many_arguments)]
pub async fn run(
    config: Arc<Config>,
    catalog: Arc<CatalogHandle>,
    shard: usize,
    shards: usize,
    commands: mpsc::Sender<Command<MultiTableReadQuery>>,
    mut events: mpsc::UnboundedReceiver<Event>,
    mut requests_rx: mpsc::Receiver<Request>,
    requests: mpsc::Sender<Request>,
    stats: Arc<Stats>,
    readiness: watch::Sender<bool>,
) {
    let (outbox, outbox_rx) = mpsc::unbounded_channel();
    spawn_local(forward(outbox_rx, commands));
    let mut core = Groups {
        clients_table: TableName::from(config.clients_table().as_str()),
        mutations_table: TableName::from(config.mutations_table().as_str()),
        config,
        catalog,
        shard,
        stats,
        oldest: None,
        commands: outbox,
        requests,
        ready: false,
        readiness,
        backlog: Vec::new(),
        groups: HashMap::new(),
        by_sub: HashMap::new(),
        awaiting: HashMap::new(),
        pending: HashMap::new(),
        lmid_changes: HashMap::new(),
        result_changes: HashMap::new(),
        dirty: HashSet::new(),
        next_poke: 1,
        next_generation: 0,
    };
    log_info!(
        "client groups {}/{} up; waiting for the change feed to pass the first snapshot before serving queries",
        shard + 1,
        shards.max(1)
    );
    let mut taken_requests = Vec::with_capacity(256);
    let mut taken_events = Vec::with_capacity(1024);
    loop {
        tokio::select! {
            taken = requests_rx.recv_many(&mut taken_requests, 256) => {
                core.stats.set_groups_inbox(shard, requests_rx.len() as u64);
                if taken == 0 {
                    break;
                }
                for request in taken_requests.drain(..) {
                    core.handle(request);
                }
            }
            taken = events.recv_many(&mut taken_events, 1024) => {
                if taken == 0 {
                    break;
                }
                for event in taken_events.drain(..) {
                    core.event(event);
                }
            }
        }
        core.flush();
    }
}

/// Hand the engine side one command at a time, in order, so a full
/// command channel never blocks the group thread's loop.
async fn forward(
    mut outbox: mpsc::UnboundedReceiver<Command<MultiTableReadQuery>>,
    commands: mpsc::Sender<Command<MultiTableReadQuery>>,
) {
    while let Some(command) = outbox.recv().await {
        if commands.send(command).await.is_err() {
            return;
        }
    }
}

impl Groups {
    /// Apply one request.
    fn handle(&mut self, request: Request) {
        match request {
            Request::Connect {
                group,
                wsid,
                socket,
                base_cookie,
                lmids,
                results,
                reply,
            } => {
                let outcome = self.connect(&group, wsid, socket, base_cookie, lmids, results);
                let _ = reply.send(outcome);
            }
            Request::Disconnect { group, wsid } => self.disconnect(&group, &wsid),
            Request::Desired { .. } if !self.ready => self.backlog.push(request),
            Request::Desired { group, client, ops } => self.desired(&group, &client, ops),
            Request::DeleteClients { group, clients } => {
                for client in clients {
                    self.clear_client(&group, &client);
                }
            }
            Request::Pull { group, reply } => {
                let answer = self
                    .groups
                    .get(&group)
                    .map(|group| (protocol::cookie(group.version), group.lmids.clone()))
                    .unwrap_or_else(|| (protocol::cookie(0), HashMap::new()));
                let _ = reply.send(answer);
            }
            Request::Expire { group, generation } => self.expire(&group, generation),
            Request::ExpireQuery {
                group,
                hash,
                generation,
            } => self.expire_query(&group, &hash, generation),
        }
    }

    /// One event from the engine side.
    fn event(&mut self, event: Event) {
        match event {
            Event::Registered {
                token,
                sub,
                updates,
                reads,
            } => {
                self.registered(token, sub, reads);
                self.absorb(updates);
            }
            Event::Landed { updates } => self.absorb(updates),
            Event::Refused { sub, reason } => self.refused(sub, &reason),
            Event::Capped { sub } => self.capped(sub),
            Event::Heavy { sub, table, rows } => self.heavy(sub, table.as_str(), rows),
            Event::Hydrated(subs) => {
                for sub in subs {
                    let Some((group_id, hash)) = self.by_sub.get(&sub).cloned() else {
                        continue;
                    };
                    let Some(group) = self.groups.get_mut(&group_id) else {
                        continue;
                    };
                    if let Some(state) = group.queries.get_mut(&hash)
                        && !state.got
                    {
                        state.got = true;
                        let hydrate = if state.cold {
                            &self.stats.hydrate_cold
                        } else {
                            &self.stats.hydrate_warm
                        };
                        let elapsed = state.since.elapsed();
                        hydrate.record(elapsed);
                        let slow = elapsed >= self.config.slow_query;
                        log_event!(
                            if slow { Level::Warn } else { Level::Debug },
                            if slow { "slow query" } else { "query hydrated" },
                            group = group_id,
                            name = state.name,
                            hash = hash,
                            kind = if state.cold { "cold" } else { "warm" },
                            ms = format!("{:.1}", elapsed.as_secs_f64() * 1000.0)
                        );
                        group.queued_got.push(json!({"op": "put", "hash": hash}));
                        self.dirty.insert(group_id);
                    }
                }
            }
            Event::Committed {
                updates,
                position,
                floor,
                watched,
                received,
                routed,
            } => {
                self.absorb(updates);
                self.stats.engine_to_groups.record(routed.elapsed());
                self.oldest = Some(match self.oldest {
                    Some(oldest) => oldest.min(received),
                    None => received,
                });
                for write in &watched {
                    if write.table() == &self.clients_table {
                        self.note_lmid(write);
                    } else if write.table() == &self.mutations_table {
                        self.note_result(write);
                    }
                }
                self.serve_when_covered(position, floor);
            }
        }
    }

    /// Keep one step's deltas for their groups' next pokes: each delta is
    /// resolved to the groups owning its subscriptions and shared between
    /// them, with the subscriptions and parts of each group it applies to.
    fn absorb(&mut self, updates: Vec<Delta>) {
        for delta in updates {
            let delta = Rc::new(delta);
            for audience in &delta.audiences {
                for sub in audience.subs.iter() {
                    let Some((group_id, _)) = self.by_sub.get(&sub) else {
                        continue;
                    };
                    if !self.pending.contains_key(group_id.as_str()) {
                        self.pending.insert(group_id.clone(), Vec::new());
                    }
                    let Some(queue) = self.pending.get_mut(group_id.as_str()) else {
                        continue;
                    };
                    match queue.last_mut() {
                        Some(last) if Rc::ptr_eq(&last.delta, &delta) => {
                            last.holders.push((sub, audience.part));
                        }
                        _ => queue.push(Pending {
                            delta: delta.clone(),
                            holders: vec![(sub, audience.part)],
                        }),
                    }
                    if !self.dirty.contains(group_id.as_str()) {
                        self.dirty.insert(group_id.clone());
                    }
                }
            }
        }
    }

    /// Start serving once the engine's position covers the storage's
    /// snapshots; the requests that arrived meanwhile run then.
    fn serve_when_covered(&mut self, position: Lsn, floor: Lsn) {
        if self.ready || floor.0 == 0 || position < floor {
            return;
        }
        self.ready = true;
        self.readiness.send_replace(true);
        log_info!("serving: engine at {position}, storage snapshot at {floor}");
        let backlog = std::mem::take(&mut self.backlog);
        for request in backlog {
            self.handle(request);
        }
    }

    /// Send one command to the engine side.
    fn command(&self, command: Command<MultiTableReadQuery>) {
        let _ = self.commands.send(command);
    }

    /// Mark a group as having something to hear at the next flush.
    fn mark(&mut self, group_id: &str) {
        self.dirty.insert(group_id.to_owned());
    }

    /// Attach a connection to its group and send it what it is owed since
    /// its cookie (the module's "A client that comes back, or comes
    /// late"): nothing when the cookie is the group's version, the group's
    /// whole state when it has none and the group is under way, the logged
    /// pokes after an older cookie. A client that cannot be caught up is
    /// told to start over; no other connection of the group is touched.
    fn connect(
        &mut self,
        group_id: &str,
        wsid: String,
        socket: Socket,
        base_cookie: Option<String>,
        lmids: Vec<(String, i64)>,
        results: Vec<MutationResult>,
    ) -> ConnectReply {
        let offered = match base_cookie.as_deref().map(protocol::version_of) {
            None => 0,
            Some(Some(version)) => version,
            Some(None) => {
                self.stats.connects_reset.fetch_add(1, Ordering::Relaxed);
                return ConnectReply::Reset {
                    reason: "the cookie is not one this server wrote".to_owned(),
                };
            }
        };
        let owed = match self.groups.get(group_id) {
            None if base_cookie.is_some() => {
                Err("the server holds no state for this client group".to_owned())
            }
            None => Ok(Owed::Nothing),
            Some(group) if offered == group.version => Ok(Owed::Nothing),
            Some(_) if base_cookie.is_none() => Ok(Owed::Everything),
            Some(group) => match group.log.after(offered) {
                Some(pokes) if offered < group.version => Ok(Owed::Pokes(pokes)),
                _ => Err(format!(
                    "the server is at {}, the client at {}, and the pokes between are not kept",
                    protocol::cookie(group.version),
                    protocol::cookie(offered)
                )),
            },
        };
        let owed = match owed {
            Ok(owed) => owed,
            Err(reason) => {
                self.stats.connects_reset.fetch_add(1, Ordering::Relaxed);
                return ConnectReply::Reset { reason };
            }
        };
        if !self.groups.contains_key(group_id) {
            self.groups.insert(group_id.to_owned(), Group::new());
            self.stats.client_groups.fetch_add(1, Ordering::Relaxed);
            log_info!("client group {group_id} opened");
        }
        self.next_generation += 1;
        let generation = self.next_generation;
        let group = self.groups.get_mut(group_id).expect("just ensured");
        for (client, lmid) in lmids {
            let known = group.lmids.entry(client.clone()).or_insert(0);
            if lmid > *known {
                *known = lmid;
            }
        }
        for (client, lmid) in &group.lmids {
            group.queued_lmids.insert(client.clone(), *lmid);
        }
        let waiting: Vec<Json> = results
            .into_iter()
            .map(|waiting| protocol::result_put(&waiting.client, waiting.id, waiting.result))
            .collect();
        group.queued_results.extend(waiting.iter().cloned());
        if !group.queued_lmids.is_empty() || !group.queued_results.is_empty() {
            self.dirty.insert(group_id.to_owned());
        }
        group.generation = generation;
        log_info!(
            "connection {wsid} joined client group {group_id} as client {}",
            socket.client
        );
        let sent = Instant::now();
        match owed {
            Owed::Nothing => {
                self.stats.connects_current.fetch_add(1, Ordering::Relaxed);
            }
            Owed::Pokes(pokes) => {
                self.stats.connects_from_log.fetch_add(1, Ordering::Relaxed);
                log_event!(
                    Level::Info,
                    "connection caught up from the group's log",
                    wsid = wsid,
                    group = group_id,
                    from = protocol::cookie(offered),
                    to = protocol::cookie(group.version),
                    pokes = pokes.len()
                );
                for (poke_id, frames) in pokes {
                    let _ = socket.sink.send(Outbound::Poke {
                        frames: with_current(&poke_id, &frames, &group.lmids, &waiting),
                        since: None,
                        sent,
                    });
                }
            }
            Owed::Everything => {
                self.stats
                    .connects_from_state
                    .fetch_add(1, Ordering::Relaxed);
                let got: Vec<Json> = group
                    .queries
                    .iter()
                    .filter(|(_, state)| state.got)
                    .map(|(hash, _)| json!({"op": "put", "hash": hash}))
                    .collect();
                let images: Vec<(&TableName, DataFrameRow)> = group
                    .rows
                    .iter()
                    .flat_map(|(table, of_table)| {
                        of_table.values().map(move |held| {
                            (
                                table,
                                DataFrameRow {
                                    data: held.image.clone(),
                                },
                            )
                        })
                    })
                    .collect();
                let patches: Vec<Patch<'_>> = images
                    .iter()
                    .map(|(table, row)| Patch::Put(table, row))
                    .collect();
                let poke_id = self.next_poke.to_string();
                self.next_poke += 1;
                let (frames, puts, _) = build_poke(
                    &self.catalog.load(),
                    &self.stats,
                    self.config.bytes_per_part.max(1),
                    &poke_id,
                    None,
                    &protocol::cookie(group.version),
                    head_of(&HashMap::new(), &got, &group.lmids, &waiting),
                    &patches,
                );
                log_event!(
                    Level::Info,
                    "connection caught up from the group's state",
                    wsid = wsid,
                    group = group_id,
                    to = protocol::cookie(group.version),
                    rows = puts,
                    queries = got.len()
                );
                self.stats.pokes.fetch_add(1, Ordering::Relaxed);
                let _ = socket.sink.send(Outbound::Poke {
                    frames,
                    since: None,
                    sent,
                });
            }
        }
        if group.sockets.insert(wsid, socket).is_none() {
            self.stats.clients.fetch_add(1, Ordering::Relaxed);
        }
        self.mark(group_id);
        ConnectReply::Accepted
    }

    /// A connection closed; when it was the group's last, the group's
    /// subscriptions stay for the configured grace period.
    fn disconnect(&mut self, group_id: &str, wsid: &str) {
        let Some(group) = self.groups.get_mut(group_id) else {
            return;
        };
        if group.sockets.remove(wsid).is_some() {
            self.stats.clients.fetch_sub(1, Ordering::Relaxed);
        }
        log_info!("connection {wsid} left client group {group_id}");
        if group.sockets.is_empty() {
            self.next_generation += 1;
            let generation = self.next_generation;
            let group = self.groups.get_mut(group_id).expect("just had it");
            group.generation = generation;
            let requests = self.requests.clone();
            let ttl = self.config.group_ttl;
            let group_id = group_id.to_owned();
            spawn_local(async move {
                tokio::time::sleep(ttl).await;
                let _ = requests
                    .send(Request::Expire {
                        group: group_id,
                        generation,
                    })
                    .await;
            });
        }
    }

    /// The grace period of a group with no connections ran out.
    fn expire(&mut self, group_id: &str, generation: u64) {
        let expired = self
            .groups
            .get(group_id)
            .is_some_and(|group| group.sockets.is_empty() && group.generation == generation);
        if expired {
            log_info!("client group {group_id} expired; its subscriptions are released");
            self.drop_group(group_id);
        }
    }

    /// Forget a group and every subscription it had.
    fn drop_group(&mut self, group_id: &str) {
        if let Some(group) = self.groups.remove(group_id) {
            self.stats.client_groups.fetch_sub(1, Ordering::Relaxed);
            self.stats
                .clients
                .fetch_sub(group.sockets.len() as u64, Ordering::Relaxed);
            if !group.subs.is_empty() {
                self.command(Command::UnregisterAll(group.subs.iter().copied().collect()));
            }
            for sub in &group.subs {
                self.by_sub.remove(sub);
            }
            self.pending.remove(group_id);
            self.lmid_changes.remove(group_id);
            self.dirty.remove(group_id);
        }
    }

    /// Apply a client's desired-query changes to its group.
    fn desired(&mut self, group_id: &str, client: &str, ops: Vec<DesiredOp>) {
        if !self.groups.contains_key(group_id) {
            log_warn!("desired queries for an unknown client group {group_id}");
            return;
        }
        for op in ops {
            match op {
                DesiredOp::Put {
                    hash,
                    name,
                    ttl,
                    planned,
                } => self.put(group_id, client, hash, &name, ttl, planned),
                DesiredOp::Del { hash } => self.del(group_id, client, &hash),
                DesiredOp::Clear => self.clear_client(group_id, client),
            }
        }
    }

    /// One client now desires `hash`; register it for the group when it
    /// is new and it arrived planned (a query that could not be planned or
    /// translated is known to the group with no subscription behind it;
    /// its client was told by the connection).
    fn put(
        &mut self,
        group_id: &str,
        client: &str,
        hash: String,
        name: &str,
        ttl: Option<f64>,
        planned: Option<Result<Box<Translated>, String>>,
    ) {
        let lifetime = lifetime_of(ttl);
        self.mark(group_id);
        let group = self.groups.get_mut(group_id).expect("checked");
        group
            .desired
            .entry(client.to_owned())
            .or_default()
            .insert(hash.clone());
        let mut echo = json!({"op": "put", "hash": hash});
        if let Some(ttl) = ttl {
            echo["ttl"] = if ttl.fract() == 0.0 && ttl.abs() < 9.0e15 {
                json!(ttl as i64)
            } else {
                json!(ttl)
            };
        }
        group
            .queued_desired
            .entry(client.to_owned())
            .or_default()
            .push(echo);
        if let Some(state) = group.queries.get_mut(&hash) {
            state.inactive = 0;
            state.ttl = lifetime;
            match &state.refused {
                Some((reason, when)) if when.elapsed() < REFUSAL_COOLDOWN => {
                    let error = protocol::transform_error(vec![protocol::errored_query(
                        &hash,
                        &state.name,
                        reason,
                    )]);
                    if let Some(socket) = group.sockets.get(client) {
                        let _ = socket.sink.send(Outbound::Text(Arc::from(error)));
                    }
                    return;
                }
                Some(_) => {
                    group.queries.remove(&hash);
                }
                None => return,
            }
        }
        let Some(Ok(translated)) = planned else {
            group.queries.insert(
                hash,
                QueryState {
                    sub: None,
                    awaiting: 0,
                    hidden: HashSet::new(),
                    got: false,
                    ttl: lifetime,
                    inactive: 0,
                    since: Instant::now(),
                    cold: false,
                    name: name.to_owned(),
                    refused: None,
                },
            );
            return;
        };
        self.next_generation += 1;
        let token = self.next_generation;
        group.queries.insert(
            hash.clone(),
            QueryState {
                sub: None,
                awaiting: token,
                hidden: translated.hidden,
                got: false,
                ttl: lifetime,
                inactive: 0,
                since: Instant::now(),
                cold: false,
                name: name.to_owned(),
                refused: None,
            },
        );
        self.awaiting
            .insert(token, (group_id.to_owned(), hash.clone()));
        self.command(Command::Register {
            sink: self.shard,
            query: translated.query,
            token,
        });
        log_debug!("group {group_id}: query {name} ({hash}) registering");
    }

    /// The engine side registered a query (`reads` storage reads issued):
    /// adopt the subscription, unless the query was released while the
    /// registration was in flight, in which case it is let go at once.
    fn registered(&mut self, token: u64, sub: SubId, reads: usize) {
        let Some((group_id, hash)) = self.awaiting.remove(&token) else {
            self.command(Command::Unregister(sub));
            return;
        };
        let adopted = self
            .groups
            .get_mut(&group_id)
            .and_then(|group| {
                let state = group.queries.get_mut(&hash)?;
                (state.awaiting == token).then(|| {
                    state.awaiting = 0;
                    state.cold = reads > 0;
                    state.sub = Some(sub);
                    group.subs.insert(sub);
                    group.hidden.insert(sub, state.hidden.clone());
                })
            })
            .is_some();
        if adopted {
            log_debug!("group {group_id}: query {hash} registered as {}", sub.0);
            self.by_sub.insert(sub, (group_id, hash));
        } else {
            self.command(Command::Unregister(sub));
        }
    }

    /// A page of the query stopped reaching past the rows its join gate
    /// rejects: the query is served, its page short, and it is reported by
    /// name as one to rewrite.
    fn capped(&mut self, sub: SubId) {
        let Some((group_id, hash)) = self.by_sub.get(&sub).cloned() else {
            return;
        };
        let name = self
            .groups
            .get(&group_id)
            .and_then(|group| group.queries.get(&hash))
            .map(|state| state.name.clone())
            .unwrap_or_default();
        self.stats.note_short_page(&name);
        log_event!(
            Level::Warn,
            "page capped",
            name = name,
            hash = hash,
            group = group_id,
            reason = crate::stats::SHORT_PAGE
        );
    }

    /// A read the query waited on took at least half the row limit: the
    /// query is served, and it is reported by name, with the table and the
    /// share of the limit, as one to narrow before it is refused.
    fn heavy(&mut self, sub: SubId, table: &str, rows: u64) {
        let Some((group_id, hash)) = self.by_sub.get(&sub).cloned() else {
            return;
        };
        let name = self
            .groups
            .get(&group_id)
            .and_then(|group| group.queries.get(&hash))
            .map(|state| state.name.clone())
            .unwrap_or_default();
        let percent = self.stats.note_heavy_read(&name, table, rows);
        log_event!(
            if percent >= 80 {
                Level::Warn
            } else {
                Level::Info
            },
            "heavy read",
            name = name,
            hash = hash,
            group = group_id,
            table = table,
            rows = rows,
            limit = self.stats.read_row_limit.load(Ordering::Relaxed),
            percent = percent
        );
    }

    /// The engine side refused a read a query depended on: the query's
    /// subscription is gone and its rows with it, the query stays desired
    /// but errored, and every socket of the group hears the reason.
    fn refused(&mut self, sub: SubId, reason: &str) {
        let Some((group_id, hash)) = self.by_sub.remove(&sub) else {
            return;
        };
        self.mark(&group_id);
        let Some(group) = self.groups.get_mut(&group_id) else {
            return;
        };
        group.subs.remove(&sub);
        group.hidden.remove(&sub);
        for (table, key) in release_rows(&mut group.rows, sub) {
            group.queued_rows.push(RowOp::Del(table, key));
        }
        let Some(state) = group.queries.get_mut(&hash) else {
            return;
        };
        if state.got {
            group.queued_got.push(json!({"op": "del", "hash": hash}));
        }
        state.sub = None;
        state.got = false;
        state.awaiting = 0;
        state.refused = Some((reason.to_owned(), Instant::now()));
        let error =
            protocol::transform_error(vec![protocol::errored_query(&hash, &state.name, reason)]);
        let text: Arc<str> = Arc::from(error);
        for socket in group.sockets.values() {
            let _ = socket.sink.send(Outbound::Text(text.clone()));
        }
        let kind = self.stats.note_refusal(&state.name, reason);
        log_event!(
            Level::Warn,
            "query refused",
            name = state.name,
            hash = hash,
            kind = kind,
            at = "read",
            group = group_id,
            reason = reason
        );
    }

    /// One client no longer desires `hash`; unregister it when nobody in
    /// the group does.
    fn del(&mut self, group_id: &str, client: &str, hash: &str) {
        self.mark(group_id);
        let group = self.groups.get_mut(group_id).expect("checked");
        if let Some(desired) = group.desired.get_mut(client) {
            desired.remove(hash);
        }
        group
            .queued_desired
            .entry(client.to_owned())
            .or_default()
            .push(json!({"op": "del", "hash": hash}));
        let wanted = group.desired.values().any(|desired| desired.contains(hash));
        if !wanted {
            self.deactivate(group_id, hash);
        }
    }

    /// Nobody desires `hash` any more: keep it registered for its
    /// lifetime, so a client coming back to it within that time finds its
    /// rows in place, then release it.
    fn deactivate(&mut self, group_id: &str, hash: &str) {
        self.next_generation += 1;
        let generation = self.next_generation;
        let Some(state) = self
            .groups
            .get_mut(group_id)
            .and_then(|group| group.queries.get_mut(hash))
        else {
            return;
        };
        state.inactive = generation;
        let ttl = state.ttl;
        let requests = self.requests.clone();
        let group = group_id.to_owned();
        let hash = hash.to_owned();
        spawn_local(async move {
            tokio::time::sleep(ttl).await;
            let _ = requests
                .send(Request::ExpireQuery {
                    group,
                    hash,
                    generation,
                })
                .await;
        });
    }

    /// A query's lifetime after its last client ran out; released unless a
    /// client came back to it meanwhile.
    fn expire_query(&mut self, group_id: &str, hash: &str, generation: u64) {
        let expired = self
            .groups
            .get(group_id)
            .and_then(|group| group.queries.get(hash))
            .is_some_and(|state| state.inactive == generation);
        if expired {
            self.unsubscribe(group_id, hash);
        }
    }

    /// A client is gone (or cleared its queries): drop what only it
    /// desired.
    fn clear_client(&mut self, group_id: &str, client: &str) {
        let Some(group) = self.groups.get_mut(group_id) else {
            return;
        };
        let hashes: Vec<String> = group
            .desired
            .remove(client)
            .map(|desired| desired.into_iter().collect())
            .unwrap_or_default();
        self.mark(group_id);
        for hash in hashes {
            let group = self.groups.get_mut(group_id).expect("checked");
            group
                .queued_desired
                .entry(client.to_owned())
                .or_default()
                .push(json!({"op": "del", "hash": hash}));
            let wanted = group
                .desired
                .values()
                .any(|desired| desired.contains(&hash));
            if !wanted {
                self.deactivate(group_id, &hash);
            }
        }
    }

    /// Remove a query from its group: its subscription goes, the rows only
    /// it held are `del`ed, and its `got` is withdrawn.
    fn unsubscribe(&mut self, group_id: &str, hash: &str) {
        self.mark(group_id);
        let group = self.groups.get_mut(group_id).expect("checked");
        let Some(state) = group.queries.remove(hash) else {
            return;
        };
        if state.got {
            group.queued_got.push(json!({"op": "del", "hash": hash}));
        }
        let Some(sub) = state.sub else {
            return;
        };
        group.subs.remove(&sub);
        group.hidden.remove(&sub);
        for (table, key) in release_rows(&mut group.rows, sub) {
            group.queued_rows.push(RowOp::Del(table, key));
        }
        self.by_sub.remove(&sub);
        self.command(Command::Unregister(sub));
        log_debug!("group {group_id}: query {hash} unregistered ({})", sub.0);
    }

    /// A write to the mutation-id table: remember the change for the
    /// group's next poke.
    fn note_lmid(&mut self, write: &WriteQuery) {
        let Some(image) = write.new_row_image() else {
            return;
        };
        let text = |column: &str| match image.data.get(column) {
            Some(Value::String(text)) => Some(text.clone()),
            _ => None,
        };
        let (Some(group), Some(client)) = (text("clientGroupID"), text("clientID")) else {
            return;
        };
        let lmid = match image.data.get("lastMutationID") {
            Some(Value::Int(lmid)) => *lmid,
            Some(Value::Float(lmid)) => *lmid as i64,
            _ => return,
        };
        self.stats.lmid_seen(&client, lmid);
        self.dirty.insert(group.clone());
        self.lmid_changes
            .entry(group)
            .or_default()
            .insert(client, lmid);
    }

    /// A write to the mutation-result table: the result recorded for, or
    /// cleaned up from, a client's mutation, for the group's next poke.
    fn note_result(&mut self, write: &WriteQuery) {
        let Some((group, entry)) = result_entry(write) else {
            log_warn!(
                "a write to {} names no group, client and mutation, or a result that is not JSON; passed over",
                self.mutations_table
            );
            return;
        };
        self.dirty.insert(group.clone());
        self.result_changes.entry(group).or_default().push(entry);
    }

    /// Turn everything accumulated into one poke per group that has
    /// anything to hear, every row serialized once for all of them and
    /// for every later flush (the bytes stay on the row's image).
    fn flush(&mut self) {
        let groups = &self.groups;
        self.pending.retain(|group, _| groups.contains_key(group));
        if self.dirty.is_empty() {
            self.oldest = None;
            return;
        }
        let started = Instant::now();
        let since = self.oldest.take();
        let mut touched: Vec<String> = self.dirty.drain().collect();
        touched.sort();
        for group_id in touched {
            self.poke(&group_id, since);
        }
        self.stats.groups_flush.record(started.elapsed());
    }

    /// Account what has arrived for one group and, when a connection is
    /// there to hear it, assemble and send its poke; `since` is when the
    /// oldest transaction of the flush was decoded. A group with no
    /// connection keeps its ledger current and its row operations
    /// waiting, coalesced, and stands still: no frames, no new version,
    /// so the client that returns with the group's cookie is owed exactly
    /// what waits here.
    fn poke(&mut self, group_id: &str, since: Option<Instant>) {
        let lmid_changes = self.lmid_changes.remove(group_id).unwrap_or_default();
        let result_changes = self.result_changes.remove(group_id).unwrap_or_default();
        let Some(group) = self.groups.get_mut(group_id) else {
            return;
        };
        self.stats
            .mutation_results
            .fetch_add(result_changes.len() as u64, Ordering::Relaxed);
        let updates = self.pending.remove(group_id).unwrap_or_default();
        let mut rows: Vec<RowOp> = std::mem::take(&mut group.queued_rows);
        for Pending { delta, holders } in updates {
            let (key, image) = match &delta.op {
                DataFrameOperation::Add(key, row) => (key, Some(row)),
                DataFrameOperation::Delete(key, _) => (key, None),
            };
            let holders: IdSet<(SubId, QueryPart)> = holders
                .into_iter()
                .filter(|(sub, _)| group.subs.contains(sub))
                .filter(|(sub, part)| {
                    !group
                        .hidden
                        .get(sub)
                        .is_some_and(|hidden| hidden.contains(part))
                })
                .collect();
            if let Some(op) = account(&mut group.rows, &delta.table, key, image, holders) {
                rows.push(op);
            }
        }
        for (client, lmid) in lmid_changes {
            let known = group.lmids.entry(client.clone()).or_insert(0);
            if lmid >= *known {
                *known = lmid;
                group.queued_lmids.insert(client, lmid);
            }
        }
        group.queued_results.extend(result_changes);
        if group.sockets.is_empty() {
            if rows.len() > group.queued_floor * 2 + 64 {
                rows = coalesce(rows);
                group.queued_floor = rows.len();
            }
            group.queued_rows = rows;
            return;
        }
        group.queued_floor = 0;
        if rows.is_empty()
            && group.queued_got.is_empty()
            && group.queued_desired.is_empty()
            && group.queued_lmids.is_empty()
            && group.queued_results.is_empty()
        {
            return;
        }
        let got = std::mem::take(&mut group.queued_got);
        let desired = std::mem::take(&mut group.queued_desired);
        let lmids = std::mem::take(&mut group.queued_lmids);
        let results = std::mem::take(&mut group.queued_results);
        let rows = coalesce(rows);
        let patches: Vec<Patch<'_>> = rows
            .iter()
            .map(|op| match op {
                RowOp::Put(table, _, row) => Patch::Put(table, row),
                RowOp::Del(table, key) => Patch::Del(table, key),
            })
            .collect();
        let poke_id = self.next_poke.to_string();
        self.next_poke += 1;
        let base = (group.version > 0).then(|| protocol::cookie(group.version));
        group.version += 1;
        let cookie = protocol::cookie(group.version);
        let (frames, puts, dels) = build_poke(
            &self.catalog.load(),
            &self.stats,
            self.config.bytes_per_part.max(1),
            &poke_id,
            base.as_deref(),
            &cookie,
            head_of(&desired, &got, &lmids, &results),
            &patches,
        );
        log_debug!(
            "group {group_id}: poke {poke_id} {} -> {cookie}: {puts} puts, {dels} dels, {} got, {} lmids, {} results",
            base.as_deref().unwrap_or("null"),
            got.len(),
            lmids.len(),
            results.len()
        );
        self.stats.pokes.fetch_add(1, Ordering::Relaxed);
        group.log.push(
            group.version,
            &poke_id,
            &frames,
            self.config.group_log_bytes,
        );
        group.broadcast(&frames, since);
    }
}

/// What a connecting client is owed since its cookie.
enum Owed {
    Nothing,
    /// The group's whole state, as one poke from nothing.
    Everything,
    /// The logged pokes after its cookie, as their ids and frames, to be
    /// sent as they were with the group's current mutation ids added.
    Pokes(Vec<(String, Arc<[Bytes]>)>),
}

/// One row operation of a poke, borrowed from wherever it is kept: a
/// flush's operations, or the ledger's images.
enum Patch<'a> {
    Put(&'a TableName, &'a DataFrameRow),
    Del(&'a TableName, &'a DataFrameKey),
}

/// The query-state, mutation-id and mutation-result fields of a poke's
/// first part, as JSON fields ready to follow the poke id.
fn head_of(
    desired: &HashMap<String, Vec<Json>>,
    got: &[Json],
    lmids: &HashMap<String, i64>,
    results: &[Json],
) -> Vec<u8> {
    let mut head: Vec<u8> = Vec::new();
    if !desired.is_empty() {
        head.extend_from_slice(b",\"desiredQueriesPatches\":");
        let _ = serde_json::to_writer(&mut head, desired);
    }
    if !got.is_empty() {
        head.extend_from_slice(b",\"gotQueriesPatch\":");
        let _ = serde_json::to_writer(&mut head, got);
    }
    if !lmids.is_empty() {
        head.extend_from_slice(b",\"lastMutationIDChanges\":");
        let _ = serde_json::to_writer(&mut head, lmids);
    }
    if !results.is_empty() {
        head.extend_from_slice(b",\"mutationsPatch\":");
        let _ = serde_json::to_writer(&mut head, results);
    }
    head
}

/// The group and the `mutationsPatch` entry of one write to the
/// mutation-result table: a result recorded is a `put` of the result the
/// application server wrote (its JSON text parsed), a row deleted (the
/// client received it and the server cleaned it up) a `del` of the
/// mutation, named by the deleted row's key. `None` for a write naming no
/// group, client or mutation, or with a result that is not JSON.
fn result_entry(write: &WriteQuery) -> Option<(String, Json)> {
    let row: &RowData = match write {
        WriteQuery::DELETE(delete) => &delete.pkey_value.pkey_value,
        _ => &write.new_row_image()?.data,
    };
    let text = |column: &str| match row.get(column) {
        Some(Value::String(text)) => Some(text.clone()),
        _ => None,
    };
    let group = text("clientGroupID")?;
    let client = text("clientID")?;
    let id = match row.get("mutationID") {
        Some(Value::Int(id)) => *id,
        Some(Value::Float(id)) => *id as i64,
        _ => return None,
    };
    let entry = match write {
        WriteQuery::DELETE(_) => protocol::result_del(&client, id),
        _ => {
            let result: Json = serde_json::from_str(&text("result")?).ok()?;
            protocol::result_put(&client, id, result)
        }
    };
    Some((group, entry))
}

/// A logged poke `poke_id` as it is replayed: its frames as they were,
/// with one more part before the end carrying `lmids`, the group's
/// mutation ids as they are now, and `results`, the mutation results
/// waiting as they are now. The client merges a poke's parts in order,
/// so the last part's ids stand; they are never below the ones the poke
/// told at its time, which is what the client requires. A waiting result
/// goes with the ids so that a pending mutation the ids settle is
/// rejected with its error rather than taken for a success; put again in
/// a later poke it changes nothing. With nothing to tell, the frames are
/// sent as they are.
fn with_current(
    poke_id: &str,
    frames: &Arc<[Bytes]>,
    lmids: &HashMap<String, i64>,
    results: &[Json],
) -> Arc<[Bytes]> {
    let Some((end, parts)) = frames
        .split_last()
        .filter(|_| !lmids.is_empty() || !results.is_empty())
    else {
        return frames.clone();
    };
    let mut replayed: Vec<Bytes> = Vec::with_capacity(frames.len() + 1);
    replayed.extend(parts.iter().cloned());
    replayed.push(part_frame(
        poke_id,
        Some(head_of(&HashMap::new(), &[], lmids, results)),
        &[],
    ));
    replayed.push(end.clone());
    replayed.into()
}

/// One poke as its frames, from `base` to `cookie`: the start, the parts
/// (`head` in the first, row operations accumulated until the full frame
/// size reaches `bytes_per_part`, every put taken from the bytes kept on
/// its image when the image was sent before), the end. Also how many puts
/// and dels it carries.
///
/// The frame size counted against the limit is the complete wire frame:
/// the fixed JSON framing (`["pokePart",{"pokeID":...,rowsPatch":[...]}]`),
/// the head fields (`desiredQueriesPatches`, `lastMutationIDChanges`, etc.
/// — present only in the first part), and each row entry plus its comma.
#[allow(clippy::too_many_arguments)]
fn build_poke(
    catalog: &Catalog,
    stats: &Stats,
    bytes_per_part: usize,
    poke_id: &str,
    base: Option<&str>,
    cookie: &str,
    head: Vec<u8>,
    rows: &[Patch<'_>],
) -> (Arc<[Bytes]>, usize, usize) {
    let mut frames: Vec<Bytes> = Vec::with_capacity(4);
    frames.push(Bytes::from(protocol::poke_start(poke_id, base)));
    // head_of returns an empty Vec when there is nothing to say; treat that
    // as no head so the head-only flush below never emits a phantom part
    // carrying nothing.
    let mut head = (!head.is_empty()).then_some(head);
    let (mut puts, mut dels) = (0usize, 0usize);
    let frame_overhead = PART_FRAMING + poke_id.len();
    let mut entries: Vec<Bytes> = Vec::new();
    // Seed with overhead + head size: head fields are only in the first part.
    let mut current_bytes = frame_overhead + head.as_ref().map_or(0, Vec::len);
    for op in rows {
        let entry = match op {
            Patch::Put(table, row) => {
                let Some(fragment) = put_fragment(catalog, stats, table, row) else {
                    continue;
                };
                puts += 1;
                fragment
            }
            Patch::Del(table, key) => {
                dels += 1;
                let mut bytes = Vec::with_capacity(64);
                wire::write_del(&mut bytes, table.as_str(), key);
                Bytes::from(bytes)
            }
        };
        // Non-empty part: flush if adding this entry (plus its comma) would exceed
        // the limit, then the entry opens a new headless part.
        if !entries.is_empty() && current_bytes + 1 + entry.len() > bytes_per_part {
            frames.push(part_frame(poke_id, head.take(), &entries));
            entries.clear();
            current_bytes = frame_overhead;
        }
        // Empty part with a pending head: if the head and this entry together exceed
        // the limit, flush the head in its own empty-rowsPatch part first so the
        // entry starts a headless part. A row or head that exceeds the limit on its
        // own is unsplittable; it is emitted as-is and accepted as an overage.
        if entries.is_empty() && head.is_some() && current_bytes + entry.len() > bytes_per_part {
            frames.push(part_frame(poke_id, head.take(), &[]));
            current_bytes = frame_overhead;
        }
        current_bytes += if entries.is_empty() { entry.len() } else { entry.len() + 1 };
        entries.push(entry);
    }
    frames.push(part_frame(poke_id, head.take(), &entries));
    frames.push(Bytes::from(protocol::poke_end(poke_id, cookie)));
    (frames.into(), puts, dels)
}

/// The `rowsPatch` put of `row` in `table`: the bytes kept on the image
/// when it was sent before, by any group thread, or else the row written
/// now and kept there for every later send ([`RowData::wire`]). The cell
/// is read with `get` and filled with `set`, so a thread never waits on
/// another's serialization: two that both find it empty both write the
/// row, the same bytes, and the second `set` is refused and dropped. `None` for a table the catalog does not hold, which only a
/// row never sent can meet, since tables are not dropped while serving.
fn put_fragment(
    catalog: &Catalog,
    stats: &Stats,
    table: &TableName,
    row: &DataFrameRow,
) -> Option<Bytes> {
    if let Some(bytes) = row.data.wire().get() {
        stats.rows_shared.fetch_add(1, Ordering::Relaxed);
        return Some(bytes.clone());
    }
    let declared = catalog.table(table.as_str())?;
    stats.rows_serialized.fetch_add(1, Ordering::Relaxed);
    if row.data.is_partial() {
        stats.partial_rows_sent.fetch_add(1, Ordering::Relaxed);
    }
    let mut bytes = Vec::with_capacity(256);
    wire::write_put(&mut bytes, declared, row);
    let bytes = Bytes::from(bytes);
    let _ = row.data.wire().set(Box::new(bytes.clone()));
    Some(bytes)
}

/// One `pokePart` frame: the poke id, the query-state and mutation-id
/// fields of the poke's first part (`head`, already as JSON fields), and
/// the row entries, already serialized, as its `rowsPatch`.
fn part_frame(poke_id: &str, head: Option<Vec<u8>>, entries: &[Bytes]) -> Bytes {
    let size = 64
        + head.as_ref().map_or(0, Vec::len)
        + entries.iter().map(Bytes::len).sum::<usize>()
        + entries.len();
    let mut frame: Vec<u8> = Vec::with_capacity(size);
    frame.extend_from_slice(b"[\"pokePart\",{\"pokeID\":");
    let _ = serde_json::to_writer(&mut frame, poke_id);
    if let Some(head) = head {
        frame.extend_from_slice(&head);
    }
    frame.extend_from_slice(b",\"rowsPatch\":[");
    for (index, entry) in entries.iter().enumerate() {
        if index > 0 {
            frame.push(b',');
        }
        let _ = frame.write_all(entry);
    }
    frame.extend_from_slice(b"]}]");
    Bytes::from(frame)
}

/// The bytes `part_frame` writes around a numeric poke id and the
/// entries: `["pokePart",{"pokeID":"` .. `","rowsPatch":[` .. `]}]`.
/// Poke ids are counters (`next_poke.to_string()`) and never need JSON
/// escaping, so a frame's framing cost is `PART_FRAMING + poke_id.len()`.
const PART_FRAMING: usize = br#"["pokePart",{"pokeID":"","rowsPatch":[]}]"#.len();

/// Keep one operation per row, the last one, in first-seen order.
fn coalesce(rows: Vec<RowOp>) -> Vec<RowOp> {
    let mut index: IdMap<(TableName, DataFrameKey), usize> =
        IdMap::with_capacity_and_hasher(rows.len(), Default::default());
    let mut out: Vec<Option<RowOp>> = Vec::with_capacity(rows.len());
    for op in rows {
        let slot = match &op {
            RowOp::Put(table, key, _) | RowOp::Del(table, key) => (table.clone(), key.clone()),
        };
        match index.get(&slot) {
            Some(&position) => out[position] = Some(op),
            None => {
                index.insert(slot, out.len());
                out.push(Some(op));
            }
        }
    }
    out.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ColumnName;

    /// A holder of a row: subscription `sub`, main part.
    fn holder(sub: u64) -> IdSet<(SubId, QueryPart)> {
        IdSet::from_iter([(SubId(sub), QueryPart::main())])
    }

    /// A row keyed by `id` with one `name` column.
    fn row(id: i64, name: &str) -> (DataFrameKey, DataFrameRow) {
        (
            DataFrameKey::from(HashMap::from([(ColumnName::from("id"), Value::Int(id))])),
            DataFrameRow::from(HashMap::from([
                (ColumnName::from("id"), Value::Int(id)),
                (ColumnName::from("name"), Value::from(name)),
            ])),
        )
    }

    /// A row two queries show stays on the client while either still
    /// holds it, and the second holder's arrival sends nothing when the
    /// image is the one already sent.
    #[test]
    fn a_row_stays_on_the_client_while_any_query_still_holds_it() {
        let table = TableName::from("t");
        let mut rows = Ledger::default();
        let (key, image) = row(1, "a");
        let first = account(&mut rows, &table, &key, Some(&image), holder(1));
        assert!(
            matches!(first, Some(RowOp::Put(..))),
            "the first holder puts the row"
        );
        let second = account(&mut rows, &table, &key, Some(&image), holder(2));
        assert!(
            second.is_none(),
            "the same image from a second holder sends nothing"
        );
        let released = account(&mut rows, &table, &key, None, holder(1));
        assert!(
            released.is_none(),
            "the first holder letting go deletes nothing the second shows"
        );
        let gone = account(&mut rows, &table, &key, None, holder(2));
        assert!(
            matches!(gone, Some(RowOp::Del(..))),
            "the last holder letting go deletes"
        );
        assert!(rows.is_empty());
    }

    /// A changed image is sent whoever holds the row, and a released
    /// subscription owes exactly the rows only it showed.
    #[test]
    fn a_changed_image_is_sent_whoever_holds_the_row() {
        let table = TableName::from("t");
        let mut rows = Ledger::default();
        let (key, image) = row(1, "a");
        account(&mut rows, &table, &key, Some(&image), holder(1));
        let (_, changed) = row(1, "b");
        let again = account(&mut rows, &table, &key, Some(&changed), holder(2));
        assert!(
            matches!(again, Some(RowOp::Put(..))),
            "a changed image is sent"
        );
        let (key2, image2) = row(2, "only two");
        account(&mut rows, &table, &key2, Some(&image2), holder(2));
        let owed = release_rows(&mut rows, SubId(2));
        assert_eq!(
            owed,
            vec![(table.clone(), key2)],
            "only the row nobody else shows is deleted"
        );
        assert!(
            rows.get(&table)
                .is_some_and(|of_table| of_table.contains_key(&key)),
            "the shared row stays for the first holder"
        );
    }

    /// A group thread on its own: the engine side is this test, which
    /// reads the commands the thread sends and hands it events.
    struct Bench {
        core: Groups,
        commands: mpsc::UnboundedReceiver<Command<MultiTableReadQuery>>,
    }

    /// One fake connection: what its socket was sent.
    #[derive(Debug)]
    struct Tab {
        wsid: String,
        frames: mpsc::UnboundedReceiver<Outbound>,
    }

    /// One poke as a test reads it: the cookie it starts from and ends at,
    /// the rows put (by id, with the name sent) and deleted, the queries
    /// reported complete, and the mutation ids as the client would merge
    /// them (part by part, the last part standing).
    #[derive(Debug, PartialEq)]
    struct Seen {
        base: Option<String>,
        cookie: String,
        puts: Vec<(i64, String)>,
        dels: Vec<i64>,
        got: Vec<String>,
        lmids: Vec<(String, i64)>,
        results: Vec<Json>,
    }

    impl Bench {
        /// A thread over one table `notes(id, name)`, the log's budget as
        /// given.
        fn new(log_bytes: &str) -> Self {
            let vars: HashMap<&str, &str> = HashMap::from([
                ("STREAMGRES_PG_DSN", "postgresql://none/none"),
                ("STREAMGRES_MASTER_PG_DSN", "postgresql://none/none"),
                ("STREAMGRES_QUERY_URL", "http://none/query"),
                ("STREAMGRES_MUTATE_URL", "http://none/push"),
                ("STREAMGRES_GROUP_LOG_BYTES", log_bytes),
            ]);
            let config = Config::from_lookup(|name| vars.get(name).map(|v| (*v).to_owned()))
                .expect("a configuration");
            let catalog = Catalog::new([crate::model::DbTable::new(
                "notes",
                ["id"],
                vec![
                    crate::model::DbColumn::new("id", crate::model::ValueType::Int),
                    crate::model::DbColumn::new("name", crate::model::ValueType::String),
                ],
            )]);
            let (outbox, commands) = mpsc::unbounded_channel();
            let (requests, _requests_rx) = mpsc::channel(16);
            let core = Groups {
                clients_table: TableName::from(config.clients_table().as_str()),
                mutations_table: TableName::from(config.mutations_table().as_str()),
                config: Arc::new(config),
                catalog: Arc::new(CatalogHandle::new(catalog)),
                shard: 0,
                stats: Stats::shared(),
                oldest: None,
                commands: outbox,
                requests,
                ready: true,
                readiness: watch::channel(true).0,
                backlog: Vec::new(),
                groups: HashMap::new(),
                by_sub: HashMap::new(),
                awaiting: HashMap::new(),
                pending: HashMap::new(),
                lmid_changes: HashMap::new(),
                result_changes: HashMap::new(),
                dirty: HashSet::new(),
                next_poke: 1,
                next_generation: 0,
            };
            Bench { core, commands }
        }

        /// Connect `wsid` to group `g` with `cookie`; the tab when accepted,
        /// the reason when told to start over.
        fn connect(&mut self, wsid: &str, cookie: Option<&str>) -> Result<Tab, String> {
            self.connect_with(wsid, cookie, Vec::new())
        }

        /// [`Bench::connect`] with `lmids` as what the clients table says
        /// at the moment of connecting.
        fn connect_with(
            &mut self,
            wsid: &str,
            cookie: Option<&str>,
            lmids: Vec<(String, i64)>,
        ) -> Result<Tab, String> {
            self.connect_full(wsid, cookie, lmids, Vec::new())
        }

        /// [`Bench::connect_with`] with `results` as what the results table
        /// holds for the group at the moment of connecting.
        fn connect_full(
            &mut self,
            wsid: &str,
            cookie: Option<&str>,
            lmids: Vec<(String, i64)>,
            results: Vec<MutationResult>,
        ) -> Result<Tab, String> {
            let (sink, frames) = mpsc::unbounded_channel();
            let socket = Socket {
                client: format!("client-{wsid}"),
                sink,
            };
            match self.core.connect(
                "g",
                wsid.to_owned(),
                socket,
                cookie.map(str::to_owned),
                lmids,
                results,
            ) {
                ConnectReply::Accepted => Ok(Tab {
                    wsid: wsid.to_owned(),
                    frames,
                }),
                ConnectReply::Reset { reason } => Err(reason),
            }
        }

        /// The application recorded mutation `lmid` of client `client` in
        /// group `g`: the write to the clients table, as the feed carries
        /// it.
        fn mutation_recorded(&mut self, client: &str, lmid: i64) {
            let table = self.core.clients_table.clone();
            let key = DataFrameKey::from(HashMap::from([
                (ColumnName::from("clientGroupID"), Value::from("g")),
                (ColumnName::from("clientID"), Value::from(client)),
            ]));
            let record = DataFrameRow::from(HashMap::from([
                (ColumnName::from("clientGroupID"), Value::from("g")),
                (ColumnName::from("clientID"), Value::from(client)),
                (ColumnName::from("lastMutationID"), Value::Int(lmid)),
            ]));
            self.core
                .note_lmid(&WriteQuery::INSERT(crate::model::InsertQuery {
                    table,
                    pkey_value: key,
                    record,
                }));
        }

        /// The application recorded `result` (JSON text, as the feed carries
        /// a JSON column) for mutation `id` of client `client` in group `g`.
        fn result_recorded(&mut self, client: &str, id: i64, result: &str) {
            let table = self.core.mutations_table.clone();
            let (key, record) = result_row("g", client, id, Some(result));
            self.core
                .note_result(&WriteQuery::INSERT(crate::model::InsertQuery {
                    table,
                    pkey_value: key,
                    record,
                }));
        }

        /// The application cleaned up the result of mutation `id` of
        /// client `client` in group `g`: a delete, carrying the row's key.
        fn result_cleaned(&mut self, client: &str, id: i64) {
            let table = self.core.mutations_table.clone();
            let (key, _) = result_row("g", client, id, None);
            self.core
                .note_result(&WriteQuery::DELETE(crate::model::DeleteQuery {
                    table,
                    pkey_value: key,
                }));
        }

        /// The tab desires the query `hash`; the engine side registers it
        /// as `sub`, delivers `rows` and reports it complete.
        fn hydrate(&mut self, tab: &Tab, hash: &str, sub: u64, rows: &[(i64, &str)]) {
            let query = MultiTableReadQuery::single(crate::model::SingleTableReadQuery::new(
                "notes",
                crate::model::Where::AND(Vec::new()),
                crate::model::OrderBy::new("id", crate::model::Order::ASC),
                u32::MAX,
            ));
            self.core.desired(
                "g",
                &format!("client-{}", tab.wsid),
                vec![DesiredOp::Put {
                    hash: hash.to_owned(),
                    name: hash.to_owned(),
                    ttl: None,
                    planned: Some(Ok(Box::new(Translated {
                        query,
                        hidden: HashSet::new(),
                        uncursored: None,
                    }))),
                }],
            );
            let token = loop {
                match self.commands.try_recv().expect("a registration is sent") {
                    Command::Register { token, .. } => break token,
                    _ => continue,
                }
            };
            self.core.event(Event::Registered {
                token,
                sub: SubId(sub),
                updates: rows.iter().map(|(id, name)| put(sub, *id, name)).collect(),
                reads: 1,
            });
            self.core.event(Event::Hydrated(vec![SubId(sub)]));
            self.core.flush();
        }

        /// Deltas arrive from the engine side and the thread flushes.
        fn deliver(&mut self, updates: Vec<Delta>) {
            self.core.event(Event::Landed { updates });
            self.core.flush();
        }

        /// The group's version, as its cookie.
        fn cookie(&self) -> String {
            protocol::cookie(self.core.groups["g"].version)
        }
    }

    impl Tab {
        /// Every poke the tab's socket was sent since the last look.
        fn pokes(&mut self) -> Vec<Seen> {
            let mut out = Vec::new();
            while let Ok(outbound) = self.frames.try_recv() {
                let Outbound::Poke { frames, .. } = outbound else {
                    continue;
                };
                let mut seen = Seen {
                    base: None,
                    cookie: String::new(),
                    puts: Vec::new(),
                    dels: Vec::new(),
                    got: Vec::new(),
                    lmids: Vec::new(),
                    results: Vec::new(),
                };
                let mut merged_lmids: HashMap<String, i64> = HashMap::new();
                for frame in frames.iter() {
                    let parsed: Json = serde_json::from_slice(frame).expect("a JSON frame");
                    let (tag, body) = (parsed[0].as_str().unwrap_or(""), &parsed[1]);
                    match tag {
                        "pokeStart" => {
                            seen.base = body["baseCookie"].as_str().map(str::to_owned);
                        }
                        "pokeEnd" => seen.cookie = body["cookie"].as_str().unwrap_or("").to_owned(),
                        _ => {
                            for (client, lmid) in body["lastMutationIDChanges"]
                                .as_object()
                                .into_iter()
                                .flatten()
                            {
                                merged_lmids.insert(client.clone(), lmid.as_i64().unwrap_or(-1));
                            }
                            seen.results.extend(
                                body["mutationsPatch"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .cloned(),
                            );
                            for op in body["rowsPatch"].as_array().into_iter().flatten() {
                                if op["op"] == "put" {
                                    seen.puts.push((
                                        op["value"]["id"].as_i64().unwrap_or(-1),
                                        op["value"]["name"].as_str().unwrap_or("").to_owned(),
                                    ));
                                } else {
                                    seen.dels.push(op["id"]["id"].as_i64().unwrap_or(-1));
                                }
                            }
                            for op in body["gotQueriesPatch"].as_array().into_iter().flatten() {
                                seen.got.push(op["hash"].as_str().unwrap_or("").to_owned());
                            }
                        }
                    }
                }
                seen.puts.sort();
                seen.dels.sort_unstable();
                seen.lmids = merged_lmids.into_iter().collect();
                seen.lmids.sort();
                out.push(seen);
            }
            out
        }
    }

    /// A results-table row of group `group`: its key (group, client,
    /// mutation) and its image, with `result` when there is one.
    fn result_row(
        group: &str,
        client: &str,
        id: i64,
        result: Option<&str>,
    ) -> (DataFrameKey, DataFrameRow) {
        let mut columns = vec![
            (ColumnName::from("clientGroupID"), Value::from(group)),
            (ColumnName::from("clientID"), Value::from(client)),
            (ColumnName::from("mutationID"), Value::Int(id)),
        ];
        let key = DataFrameKey::from(columns.iter().cloned().collect::<HashMap<_, _>>());
        if let Some(result) = result {
            columns.push((ColumnName::from("result"), Value::from(result)));
        }
        (
            key,
            DataFrameRow::from(columns.into_iter().collect::<HashMap<_, _>>()),
        )
    }

    /// Subscription `sub` shows the note `id` named `name`.
    fn put(sub: u64, id: i64, name: &str) -> Delta {
        let (key, image) = row(id, name);
        Delta {
            table: TableName::from("notes"),
            op: DataFrameOperation::Add(key, image),
            audiences: vec![crate::ivm::Audience {
                part: QueryPart::main(),
                subs: crate::ivm::Subs::One(SubId(sub)),
            }],
        }
    }

    /// Subscription `sub` no longer shows the note `id`.
    fn gone(sub: u64, id: i64) -> Delta {
        let (key, image) = row(id, "");
        Delta {
            table: TableName::from("notes"),
            op: DataFrameOperation::Delete(key, image),
            audiences: vec![crate::ivm::Audience {
                part: QueryPart::main(),
                subs: crate::ivm::Subs::One(SubId(sub)),
            }],
        }
    }

    /// Run `body` where the thread's timers can be spawned.
    fn on_local<T>(body: impl FnOnce() -> T) -> T {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let local = tokio::task::LocalSet::new();
        local.block_on(&runtime, async { body() })
    }

    /// A group with no connection stands still: what changes while its
    /// client is away is accounted and waits, no poke is built and the
    /// version does not move, so the client that returns with its cookie
    /// is accepted and its next poke carries exactly the net of what it
    /// missed, once.
    #[test]
    fn a_client_that_returns_is_sent_what_it_missed() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut tab = bench.connect("a1", None).expect("accepted");
            bench.hydrate(&tab, "h1", 1, &[(1, "one"), (2, "two")]);
            let first = tab.pokes();
            let last = first.last().expect("a poke");
            assert_eq!(last.cookie, bench.cookie());
            assert_eq!(last.got, vec!["h1"]);
            let left_at = bench.cookie();
            bench.core.disconnect("g", "a1");

            bench.deliver(vec![put(1, 3, "three"), gone(1, 1)]);
            bench.deliver(vec![put(1, 3, "three, renamed")]);
            bench.deliver(vec![put(1, 4, "four"), gone(1, 4)]);
            assert_eq!(
                bench.cookie(),
                left_at,
                "the group did not move while nobody listened"
            );
            assert!(bench.core.groups["g"].log.pokes.len() <= first.len());

            let mut back = bench
                .connect("a2", Some(&left_at))
                .expect("the cookie still fits");
            bench.core.flush();
            let pokes = back.pokes();
            assert_eq!(pokes.len(), 1, "{pokes:?}");
            assert_eq!(pokes[0].base.as_deref(), Some(left_at.as_str()));
            assert_eq!(pokes[0].puts, vec![(3, "three, renamed".to_owned())]);
            assert_eq!(pokes[0].dels, vec![1, 4]);
            assert_eq!(pokes[0].cookie, bench.cookie());
            let stats = &bench.core.stats;
            assert_eq!(stats.connects_reset.load(Ordering::Relaxed), 0);
        });
    }

    /// A tab that joins a group under way without a cookie is sent the
    /// group's whole state as one poke from nothing, and the tab already
    /// there keeps its subscriptions and goes on hearing: nothing is
    /// unregistered, and the next change reaches both from the same
    /// cookie.
    #[test]
    fn a_tab_without_a_cookie_joins_a_group_under_way() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut first = bench.connect("a", None).expect("accepted");
            bench.hydrate(&first, "h1", 1, &[(1, "one"), (2, "two")]);
            bench.deliver(vec![put(1, 3, "three"), gone(1, 2)]);
            first.pokes();
            let at = bench.cookie();

            let mut second = bench.connect("b", None).expect("accepted, not reset");
            let caught_up = second.pokes();
            assert_eq!(caught_up.len(), 1, "{caught_up:?}");
            assert_eq!(caught_up[0].base, None);
            assert_eq!(caught_up[0].cookie, at);
            assert_eq!(
                caught_up[0].puts,
                vec![(1, "one".to_owned()), (3, "three".to_owned())]
            );
            assert_eq!(caught_up[0].got, vec!["h1"]);
            assert!(
                first.pokes().is_empty(),
                "the first tab hears nothing of it"
            );
            assert!(bench.core.groups["g"].subs.contains(&SubId(1)));
            while let Ok(command) = bench.commands.try_recv() {
                assert!(
                    !matches!(command, Command::Unregister(_) | Command::UnregisterAll(_)),
                    "the group's subscriptions were let go"
                );
            }

            bench.deliver(vec![put(1, 5, "five")]);
            let (to_first, to_second) = (first.pokes(), second.pokes());
            assert_eq!(to_first, to_second);
            let change = to_first.last().expect("a poke");
            assert_eq!(change.base.as_deref(), Some(at.as_str()));
            assert_eq!(change.puts, vec![(5, "five".to_owned())]);
        });
    }

    /// A tab that was away while another kept the group moving returns
    /// with an older cookie and is sent the pokes after it, as they were;
    /// with nothing logged, or a cookie the log no longer reaches, it is
    /// told to start over, as is a cookie this server never wrote or one
    /// for a group it does not hold.
    #[test]
    fn a_tab_behind_the_group_is_sent_the_logged_pokes() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut stays = bench.connect("a", None).expect("accepted");
            bench.hydrate(&stays, "h1", 1, &[(1, "one")]);
            let leaves = bench.connect("b", Some(&bench.cookie())).expect("accepted");
            let left_at = bench.cookie();
            bench.core.disconnect("g", &leaves.wsid);
            stays.pokes();

            bench.deliver(vec![put(1, 2, "two")]);
            bench.deliver(vec![gone(1, 1)]);
            let heard = stays.pokes();
            assert_eq!(heard.len(), 2);

            let mut back = bench
                .connect("b2", Some(&left_at))
                .expect("caught up from the log");
            assert_eq!(back.pokes(), heard, "the same pokes, in order");
            bench.deliver(vec![put(1, 3, "three")]);
            assert_eq!(back.pokes(), stays.pokes());
            assert_eq!(
                bench.core.stats.connects_from_log.load(Ordering::Relaxed),
                1
            );

            assert!(
                bench.connect("c", Some("zz")).is_err(),
                "not a cookie of ours"
            );
            let ahead = protocol::cookie(bench.core.groups["g"].version + 5);
            assert!(
                bench.connect("d", Some(&ahead)).is_err(),
                "ahead of the group"
            );

            let mut unlogged = Bench::new("0");
            let mut tab = unlogged.connect("a", None).expect("accepted");
            unlogged.hydrate(&tab, "h1", 1, &[(1, "one")]);
            let old = unlogged.cookie();
            unlogged.deliver(vec![put(1, 2, "two")]);
            tab.pokes();
            let reason = unlogged
                .connect("b", Some(&old))
                .expect_err("nothing is kept");
            assert!(reason.contains("not kept"), "{reason}");
            let mut empty = Bench::new("262144");
            assert!(empty.connect("x", Some("01")).is_err(), "no such group");
        });
    }

    /// A client that returns behind the log is told the mutation ids as
    /// they are now, with the first poke it is sent: every replayed poke
    /// closes with the ids read at connect merged into the group's (the
    /// client merges a poke's parts in order and refuses an id that goes
    /// back, so none may tell less), its rows and cookies as they were;
    /// the group then hears the ids once, in a poke of their own, and a
    /// tab joining without a cookie gets them in its state poke. Without
    /// this, a poke replayed from before the application processed a
    /// mutation made the client rebase it against rows the poke had
    /// removed, fail, and reconnect into the same replay.
    #[test]
    fn a_client_behind_the_log_is_told_the_mutation_ids_as_they_are_now() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut stays = bench.connect("a", None).expect("accepted");
            bench.hydrate(&stays, "h1", 1, &[(1, "one")]);
            let leaves = bench.connect("b", Some(&bench.cookie())).expect("accepted");
            let left_at = bench.cookie();
            bench.core.disconnect("g", &leaves.wsid);
            stays.pokes();

            bench.deliver(vec![put(1, 2, "two")]);
            bench.mutation_recorded("x", 3);
            bench.deliver(vec![gone(1, 1)]);
            bench.deliver(vec![put(1, 3, "three")]);
            let heard = stays.pokes();
            assert_eq!(heard.len(), 3);
            assert!(heard[0].lmids.is_empty());
            assert_eq!(heard[1].lmids, vec![("x".to_owned(), 3)]);
            assert!(heard[2].lmids.is_empty());

            let now = vec![("x".to_owned(), 5), ("y".to_owned(), 1)];
            let mut back = bench
                .connect_with("b2", Some(&left_at), now.clone())
                .expect("caught up from the log");
            let replayed = back.pokes();
            assert_eq!(replayed.len(), heard.len(), "{replayed:?}");
            for (poke, original) in replayed.iter().zip(&heard) {
                assert_eq!(
                    poke.lmids, now,
                    "the ids as they are now, in every replayed poke"
                );
                assert_eq!(
                    (&poke.base, &poke.cookie, &poke.puts, &poke.dels, &poke.got),
                    (
                        &original.base,
                        &original.cookie,
                        &original.puts,
                        &original.dels,
                        &original.got
                    ),
                    "the rest as it was"
                );
            }

            bench.core.flush();
            let told = back.pokes();
            assert_eq!(told.len(), 1, "the ids go out to the group once: {told:?}");
            assert_eq!(told[0].lmids, now);
            assert!(told[0].puts.is_empty() && told[0].dels.is_empty());
            assert_eq!(told[0].base.as_deref(), Some(heard[2].cookie.as_str()));
            assert_eq!(stays.pokes(), told, "the tab that stayed hears the same");

            let mut fresh = bench.connect("c", None).expect("accepted");
            let state = fresh.pokes();
            assert_eq!(state.len(), 1);
            assert_eq!(state[0].base, None);
            assert_eq!(state[0].lmids, now);
            assert_eq!(
                state[0].puts,
                vec![(2, "two".to_owned()), (3, "three".to_owned())]
            );
        });
    }

    /// The result of a mutation the application refused goes out in the
    /// same poke as the mutation's id, to every connection of the group
    /// (the client settles its mutations from the results before it counts
    /// the id, so the mutation is rejected with the application's error);
    /// the cleanup that follows the client's acknowledgement goes out as a
    /// `del` the same way.
    #[test]
    fn a_mutation_result_goes_out_with_its_id() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut a = bench.connect("a", None).expect("accepted");
            bench.hydrate(&a, "h1", 1, &[(1, "one")]);
            let mut b = bench.connect("b", Some(&bench.cookie())).expect("accepted");
            a.pokes();
            b.pokes();
            let refused = r#"{"error":"app","message":"Conversation not found"}"#;

            bench.mutation_recorded("client-a", 22);
            bench.result_recorded("client-a", 22, refused);
            bench.core.flush();
            let heard = a.pokes();
            assert_eq!(
                heard.len(),
                1,
                "the id and the result in one poke: {heard:?}"
            );
            assert_eq!(heard[0].lmids, vec![("client-a".to_owned(), 22)]);
            assert_eq!(
                heard[0].results,
                vec![protocol::result_put(
                    "client-a",
                    22,
                    serde_json::from_str(refused).expect("JSON")
                )]
            );
            assert_eq!(b.pokes(), heard, "every connection of the group hears it");
            assert_eq!(bench.core.stats.mutation_results.load(Ordering::Relaxed), 1);

            bench.result_cleaned("client-a", 22);
            bench.core.flush();
            let cleaned = a.pokes();
            assert_eq!(cleaned.len(), 1);
            assert_eq!(
                cleaned[0].results,
                vec![protocol::result_del("client-a", 22)]
            );
            assert!(cleaned[0].lmids.is_empty());
        });
    }

    /// A result heard while nobody listens waits with the group, no poke
    /// built and the version standing still, and goes out once a client is
    /// back.
    #[test]
    fn a_result_waits_while_nobody_listens() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut tab = bench.connect("a", None).expect("accepted");
            bench.hydrate(&tab, "h1", 1, &[(1, "one")]);
            tab.pokes();
            let left_at = bench.cookie();
            bench.core.disconnect("g", "a");

            bench.result_recorded("client-a", 5, r#"{"error":"app"}"#);
            bench.core.flush();
            assert_eq!(
                bench.cookie(),
                left_at,
                "nothing built while nobody listens"
            );

            let mut back = bench.connect("a2", Some(&left_at)).expect("current");
            bench.core.flush();
            let pokes = back.pokes();
            assert_eq!(pokes.len(), 1, "{pokes:?}");
            assert_eq!(pokes[0].base.as_deref(), Some(left_at.as_str()));
            assert_eq!(
                pokes[0].results,
                vec![protocol::result_put("client-a", 5, json!({"error": "app"}))]
            );
        });
    }

    /// The results waiting in the table at connect go out with the ids:
    /// in every poke replayed to a client behind the log (so a pending
    /// mutation the ids settle is rejected with its error, not taken for a
    /// success), in the state poke of a tab joining without a cookie, and
    /// to the group once, in a poke of their own; a result put again is
    /// the same entry, which changes nothing on a client that has it.
    #[test]
    fn a_connecting_client_is_told_the_results_waiting_with_the_ids() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut stays = bench.connect("a", None).expect("accepted");
            bench.hydrate(&stays, "h1", 1, &[(1, "one")]);
            let leaves = bench.connect("b", Some(&bench.cookie())).expect("accepted");
            let left_at = bench.cookie();
            bench.core.disconnect("g", &leaves.wsid);
            stays.pokes();
            bench.deliver(vec![put(1, 2, "two")]);
            bench.deliver(vec![put(1, 3, "three")]);
            let heard = stays.pokes();
            assert_eq!(heard.len(), 2);

            let waiting = MutationResult {
                client: "client-b".to_owned(),
                id: 7,
                result: json!({"error": "app", "message": "denied"}),
            };
            let entry = protocol::result_put("client-b", 7, waiting.result.clone());
            let mut back = bench
                .connect_full(
                    "b2",
                    Some(&left_at),
                    vec![("client-b".to_owned(), 7)],
                    vec![waiting.clone()],
                )
                .expect("caught up from the log");
            let replayed = back.pokes();
            assert_eq!(replayed.len(), heard.len());
            for (poke, original) in replayed.iter().zip(&heard) {
                assert_eq!(poke.lmids, vec![("client-b".to_owned(), 7)]);
                assert_eq!(poke.results, vec![entry.clone()], "the result with the ids");
                assert_eq!(
                    (&poke.cookie, &poke.puts),
                    (&original.cookie, &original.puts)
                );
            }

            bench.core.flush();
            let told = back.pokes();
            assert_eq!(told.len(), 1, "{told:?}");
            assert_eq!(told[0].results, vec![entry.clone()]);
            assert_eq!(stays.pokes(), told, "the group hears it once");

            let mut fresh = bench
                .connect_full("c", None, Vec::new(), vec![waiting])
                .expect("accepted");
            let state = fresh.pokes();
            assert_eq!(state.len(), 1);
            assert_eq!(state[0].base, None);
            assert_eq!(state[0].results, vec![entry]);
        });
    }

    /// A result for a group this thread does not hold (another thread's,
    /// or a group connected to another server) is let go at the flush:
    /// nothing is kept for it, no poke is built and it is not counted.
    #[test]
    fn a_result_for_a_group_held_elsewhere_is_let_go() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut tab = bench.connect("a", None).expect("accepted");
            bench.hydrate(&tab, "h1", 1, &[(1, "one")]);
            tab.pokes();
            let at = bench.cookie();
            let table = bench.core.mutations_table.clone();
            let (key, record) = result_row("elsewhere", "client-x", 3, Some(r#"{"error":"app"}"#));
            bench
                .core
                .note_result(&WriteQuery::INSERT(crate::model::InsertQuery {
                    table,
                    pkey_value: key,
                    record,
                }));
            bench.core.flush();
            assert!(tab.pokes().is_empty());
            assert_eq!(bench.cookie(), at);
            assert!(bench.core.result_changes.is_empty());
            assert!(bench.core.dirty.is_empty());
            assert_eq!(bench.core.stats.mutation_results.load(Ordering::Relaxed), 0);
        });
    }

    /// A write to the results table that names no group, client or
    /// mutation, or whose result is not JSON, is passed over: nothing is
    /// queued and no poke is built.
    #[test]
    fn a_result_the_group_cannot_read_is_passed_over() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut tab = bench.connect("a", None).expect("accepted");
            bench.hydrate(&tab, "h1", 1, &[(1, "one")]);
            tab.pokes();
            let at = bench.cookie();
            bench.result_recorded("client-a", 9, "not JSON");
            let table = bench.core.mutations_table.clone();
            bench
                .core
                .note_result(&WriteQuery::INSERT(crate::model::InsertQuery {
                    table,
                    pkey_value: DataFrameKey::from(HashMap::from([(
                        ColumnName::from("clientID"),
                        Value::from("client-a"),
                    )])),
                    record: DataFrameRow::from(HashMap::from([(
                        ColumnName::from("clientID"),
                        Value::from("client-a"),
                    )])),
                }));
            bench.core.flush();
            assert!(tab.pokes().is_empty());
            assert_eq!(bench.cookie(), at);
            assert_eq!(bench.core.stats.mutation_results.load(Ordering::Relaxed), 0);
        });
    }

    /// A socket that died unnoticed is still sent to, and what it is sent
    /// is logged like any poke: the client that returns with the cookie it
    /// last received, while its dead socket is still attached, is sent
    /// every poke after it, in order, many more than a handful, and hears
    /// what follows; the dead socket's later departure changes nothing.
    #[test]
    fn a_client_whose_socket_died_unnoticed_is_caught_up() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut dead = bench.connect("a", None).expect("accepted");
            bench.hydrate(&dead, "h1", 1, &[(1, "one")]);
            let last_received = bench.cookie();
            dead.pokes();
            for id in 2..=201 {
                bench.deliver(vec![put(1, id, "written while nobody heard")]);
            }
            let unheard = dead.pokes();
            assert_eq!(unheard.len(), 200);

            let mut back = bench
                .connect("a-again", Some(&last_received))
                .expect("caught up");
            let replayed = back.pokes();
            assert_eq!(
                replayed, unheard,
                "every poke after its cookie, as it was sent"
            );
            assert_eq!(replayed[0].base.as_deref(), Some(last_received.as_str()));
            assert_eq!(
                replayed.last().map(|poke| poke.cookie.clone()),
                Some(bench.cookie())
            );

            bench.core.disconnect("g", "a");
            bench.deliver(vec![put(1, 500, "after")]);
            let after = back.pokes();
            assert_eq!(after.len(), 1);
            assert_eq!(after[0].puts, vec![(500, "after".to_owned())]);
        });
    }

    /// The two ways of keeping what a client missed meet without a gap or
    /// an overlap. A socket dies unnoticed at cookie `c`: the pokes sent to
    /// it meanwhile are in the log. The server then learns of it and the
    /// group stands still: what changes from there on waits as one
    /// operation per row. The client that returns much later with `c` is
    /// sent the logged pokes as they were, which bring it to where the
    /// group stopped, and then one poke from there with the net of the
    /// rest; had it received some of the logged pokes before dying, its
    /// cookie says so and it is sent only the ones after it.
    #[test]
    fn a_long_absence_is_the_logged_pokes_and_then_the_waiting_rows() {
        on_local(|| {
            let mut bench = Bench::new("262144");
            let mut dead = bench.connect("a", None).expect("accepted");
            bench.hydrate(&dead, "h1", 1, &[(1, "one")]);
            let last_received = bench.cookie();
            dead.pokes();
            for id in 2..=6 {
                bench.deliver(vec![put(1, id, "sent to the dead socket")]);
            }
            let unheard = dead.pokes();
            let partly = unheard[1].cookie.clone();
            bench.core.disconnect("g", "a");
            let stopped_at = bench.cookie();

            bench.deliver(vec![put(1, 7, "seven")]);
            bench.deliver(vec![put(1, 7, "seven, renamed"), gone(1, 2)]);
            bench.deliver(vec![put(1, 8, "eight"), gone(1, 8)]);
            assert_eq!(bench.cookie(), stopped_at);

            let mut back = bench
                .connect("a2", Some(&last_received))
                .expect("caught up");
            bench.core.flush();
            let pokes = back.pokes();
            assert_eq!(pokes.len(), unheard.len() + 1, "{pokes:?}");
            assert_eq!(pokes[..unheard.len()], unheard[..]);
            let rest = pokes.last().expect("the waiting rows");
            assert_eq!(rest.base.as_deref(), Some(stopped_at.as_str()));
            assert_eq!(rest.puts, vec![(7, "seven, renamed".to_owned())]);
            assert_eq!(rest.dels, vec![2, 8]);
            assert_eq!(rest.cookie, bench.cookie());

            let mut other = Bench::new("262144");
            let mut tab = other.connect("a", None).expect("accepted");
            other.hydrate(&tab, "h1", 1, &[(1, "one")]);
            tab.pokes();
            for id in 2..=6 {
                other.deliver(vec![put(1, id, "sent to the dead socket")]);
            }
            let sent = tab.pokes();
            assert_eq!(sent[1].cookie, partly);
            other.core.disconnect("g", "a");
            let mut half = other.connect("a2", Some(&partly)).expect("caught up");
            assert_eq!(
                half.pokes(),
                sent[2..],
                "only the pokes after the one it last received"
            );
        });
    }

    /// The log keeps the newest pokes within its budget without a gap:
    /// every poke is pushed and the oldest are dropped until the rest fit,
    /// however many that is, and a poke larger than the budget empties it,
    /// since nothing older can be continued from without it.
    #[test]
    fn the_poke_log_is_bounded_and_gapless() {
        let frames = |bytes: usize| -> Arc<[Bytes]> {
            vec![Bytes::from(vec![b'x'; bytes - FRAME_OVERHEAD])].into()
        };
        let mut log = PokeLog::default();
        for version in 1..=5 {
            log.push(version, "p", &frames(400), 1_000);
        }
        assert_eq!(log.pokes.len(), 2);
        assert_eq!(log.bytes, 800);
        assert!(log.after(2).is_none(), "version 3 is gone");
        assert_eq!(log.after(3).map(|pokes| pokes.len()), Some(2));
        assert_eq!(log.after(4).map(|pokes| pokes.len()), Some(1));
        log.push(6, "p", &frames(5_000), 1_000);
        assert!(log.pokes.is_empty() && log.bytes == 0);
        assert!(log.after(5).is_none());
        for version in 7..=1_006 {
            log.push(version, "p", &frames(100), 256 * 1024);
        }
        assert_eq!(log.pokes.len(), 1_000, "only the bytes bound it");
        assert_eq!(log.after(6).map(|pokes| pokes.len()), Some(1_000));
    }

    /// A table `t` and `n` rows on its layout, each with an `id` and a
    /// `name` (and a JSON `meta`), as the feed decodes them.
    fn images(n: i64, name: &str) -> (Catalog, TableName, Vec<DataFrameRow>) {
        use crate::model::{DbColumn, DbTable, ValueType};
        let table = DbTable::new(
            "t",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("name", ValueType::String),
                DbColumn::new("meta", ValueType::Json),
            ],
        );
        let layout = table.row_schema().clone();
        let rows = (0..n)
            .map(|id| {
                let values = layout
                    .names()
                    .iter()
                    .map(|column| match column.as_str() {
                        "id" => Value::Int(id),
                        "name" => Value::from(format!("{name} \"{id}\"")),
                        _ => Value::from(format!(r#"{{"n":{id}}}"#)),
                    })
                    .collect();
                DataFrameRow::from(RowData::with_schema(layout.clone(), values))
            })
            .collect();
        (Catalog::new(vec![table]), TableName::from("t"), rows)
    }

    /// The put of `row` as `wire::write_put` writes it, cache aside.
    fn written(catalog: &Catalog, row: &DataFrameRow) -> Vec<u8> {
        let mut bytes = Vec::new();
        wire::write_put(&mut bytes, catalog.table("t").unwrap(), row);
        bytes
    }

    /// PART_FRAMING is the number of bytes `part_frame` writes around a
    /// numeric poke id and its entries; it is derived from a copy of the
    /// same literals, so this test keeps the constant and the code in step
    /// (a change to part_frame breaks it).
    #[test]
    fn part_framing_matches_part_frame() {
        for id in ["1", "42", "18446744073709551615"] {
            assert_eq!(
                part_frame(id, None, &[]).len(),
                PART_FRAMING + id.len(),
                "PART_FRAMING counts what part_frame writes for id {id}"
            );
        }
    }

    /// A row is serialized the first time it is sent and its bytes are
    /// reused by every later poke that carries it, in another flush and
    /// for another group, byte for byte the same frames.
    #[test]
    fn a_row_is_serialized_once_for_every_send() {
        let (catalog, table, rows) = images(3, "a");
        let stats = Stats::new();
        let patches: Vec<Patch<'_>> = rows.iter().map(|row| Patch::Put(&table, row)).collect();
        let poke = |id: &str| build_poke(&catalog, &stats, 2, id, None, "01", Vec::new(), &patches);
        let (first, puts, _) = poke("1");
        assert_eq!(puts, 3);
        assert_eq!(stats.rows_serialized.load(Ordering::Relaxed), 3);
        assert_eq!(stats.rows_shared.load(Ordering::Relaxed), 0);
        for row in &rows {
            assert_eq!(
                row.data.wire().get().map(|bytes| bytes.to_vec()),
                Some(written(&catalog, row)),
                "the bytes kept on the image are the row's put"
            );
        }
        let (second, puts, _) = poke("1");
        assert_eq!(puts, 3);
        assert_eq!(
            stats.rows_serialized.load(Ordering::Relaxed),
            3,
            "nothing serialized again"
        );
        assert_eq!(stats.rows_shared.load(Ordering::Relaxed), 3);
        assert_eq!(first, second, "the same frames from the kept bytes");
    }

    /// A partial image (a column the feed left out as unchanged) reaching
    /// a client is counted when it is first turned into JSON; whole images
    /// are not. The engine never sends one, so the count is the alarm.
    #[test]
    fn a_partial_row_sent_is_counted() {
        let (catalog, table, rows) = images(2, "a");
        let partial = DataFrameRow::from(RowData::partial(
            rows[0]
                .data
                .iter()
                .filter(|(column, _)| column.as_str() == "id")
                .map(|(column, value)| (column.clone(), value.clone()))
                .collect(),
        ));
        let stats = Stats::new();
        let patches = [Patch::Put(&table, &rows[1]), Patch::Put(&table, &partial)];
        build_poke(&catalog, &stats, 2, "1", None, "01", Vec::new(), &patches);
        assert_eq!(stats.rows_serialized.load(Ordering::Relaxed), 2);
        assert_eq!(stats.partial_rows_sent.load(Ordering::Relaxed), 1);
    }

    /// A changed row is a new image: it is written anew, and the bytes
    /// kept on the image it replaced stay that image's.
    #[test]
    fn a_changed_row_is_written_anew() {
        let (catalog, table, before) = images(1, "before");
        let (_, _, after) = images(1, "after");
        let after = DataFrameRow::from(RowData::with_schema(
            catalog.table("t").unwrap().row_schema().clone(),
            after[0].data.values().cloned().collect(),
        ));
        let stats = Stats::new();
        let old = put_fragment(&catalog, &stats, &table, &before[0]).unwrap();
        let new = put_fragment(&catalog, &stats, &table, &after).unwrap();
        assert_eq!(stats.rows_serialized.load(Ordering::Relaxed), 2);
        assert!(String::from_utf8_lossy(&old).contains("before"));
        assert!(String::from_utf8_lossy(&new).contains("after"));
        assert_eq!(new.to_vec(), written(&catalog, &after));
        assert_eq!(
            before[0].data.wire().get(),
            Some(&old),
            "the old image keeps its own bytes"
        );
    }

    /// Group threads sending the same rows at once each get the row's
    /// put, the same bytes as one thread alone, and every image ends up
    /// holding exactly those bytes, however the threads raced to fill it.
    #[test]
    fn group_threads_racing_on_a_row_agree() {
        const THREADS: usize = 8;
        let (catalog, table, rows) = images(2_000, "raced");
        let expected: Vec<Vec<u8>> = rows.iter().map(|row| written(&catalog, row)).collect();
        let stats = Stats::new();
        let start = std::sync::Barrier::new(THREADS);
        let seen: Vec<Vec<Bytes>> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..THREADS)
                .map(|_| {
                    scope.spawn(|| {
                        start.wait();
                        rows.iter()
                            .map(|row| put_fragment(&catalog, &stats, &table, row).unwrap())
                            .collect::<Vec<Bytes>>()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect()
        });
        for of_thread in &seen {
            for (bytes, want) in of_thread.iter().zip(&expected) {
                assert_eq!(&bytes[..], &want[..], "every thread sends the row's put");
            }
        }
        for (row, want) in rows.iter().zip(&expected) {
            assert_eq!(&row.data.wire().get().unwrap()[..], &want[..]);
        }
        let serialized = stats.rows_serialized.load(Ordering::Relaxed) as usize;
        let shared = stats.rows_shared.load(Ordering::Relaxed) as usize;
        assert_eq!(serialized + shared, THREADS * rows.len());
        assert!(serialized >= rows.len(), "each row written at least once");
    }

    /// What a users-sized poke costs: rows looked up column by column
    /// (the writer before the table plan), written from the plan, and
    /// sent again from the bytes kept on them. Run with
    /// `cargo test --release --lib users_poke_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn users_poke_cost() {
        use crate::model::{DbColumn, DbTable, RowSchema, ValueType};
        const ROWS: usize = 5_526;
        let mut columns = vec![
            DbColumn::new("id", ValueType::String),
            DbColumn::new("email", ValueType::String),
            DbColumn::new("name", ValueType::String),
            DbColumn::new("avatarUrl", ValueType::String),
            DbColumn::new("preferences", ValueType::Json),
            DbColumn::new("createdAt", ValueType::Timestamp),
            DbColumn::new("updatedAt", ValueType::Timestamp),
            DbColumn::new("lastSeenAt", ValueType::Timestamp),
            DbColumn::new("isActive", ValueType::Bool),
            DbColumn::new("isBot", ValueType::Bool),
            DbColumn::new("role", ValueType::String),
            DbColumn::new("timezone", ValueType::String),
            DbColumn::new("workspaceId", ValueType::String),
        ];
        for extra in 0..7 {
            columns.push(DbColumn::new(format!("field{extra}"), ValueType::String));
        }
        let table = DbTable::new("users", ["id"], columns);
        let layout = table.row_schema().clone();
        let cell = |column: &str, row: usize| -> Value {
            match column {
                "id" => Value::from(format!("u{row:08}x7f3kq2")),
                "email" => Value::from(format!("person.{row}@example.com")),
                "name" => Value::from(format!("Person Number {row}")),
                "avatarUrl" => Value::from(format!("https://cdn.example.com/a/{row}.png?s=64")),
                "preferences" => {
                    Value::from(r#"{"theme":"dark","notify":{"dm":true,"mentions":true}}"#)
                }
                "createdAt" | "updatedAt" | "lastSeenAt" => {
                    Value::Int(1_759_000_000_000 + row as i64)
                }
                "isActive" => Value::Bool(true),
                "isBot" => Value::Bool(false),
                "role" => Value::from("member"),
                "timezone" => Value::from("Asia/Kolkata"),
                "workspaceId" => Value::from("6642623f-cca7-43ad-9a6b-5e49c33226b4"),
                _ => Value::from(format!("value {row}")),
            }
        };
        let rows_on = |schema: &Arc<RowSchema>| -> Vec<DataFrameRow> {
            (0..ROWS)
                .map(|row| {
                    let values = schema
                        .names()
                        .iter()
                        .map(|c| cell(c.as_str(), row))
                        .collect();
                    DataFrameRow::from(RowData::with_schema(schema.clone(), values))
                })
                .collect()
        };
        let looked_up = rows_on(&RowSchema::new(layout.names().iter().cloned()));
        let planned = rows_on(&layout);
        let time = |label: &str, run: &mut dyn FnMut()| {
            let mut runs: Vec<f64> = (0..15)
                .map(|_| {
                    let started = Instant::now();
                    run();
                    started.elapsed().as_secs_f64() * 1_000.0
                })
                .collect();
            runs.sort_by(f64::total_cmp);
            println!(
                "{label:44} median {:6.2} ms  min {:6.2} ms",
                runs[7], runs[0]
            );
        };
        let mut sink = 0usize;
        time("write_put, column by column (before)", &mut || {
            for row in &looked_up {
                let mut out = Vec::with_capacity(256);
                wire::write_put(&mut out, &table, row);
                sink += out.len();
            }
        });
        time("write_put from the table plan", &mut || {
            for row in &planned {
                let mut out = Vec::with_capacity(256);
                wire::write_put(&mut out, &table, row);
                sink += out.len();
            }
        });
        let catalog = Catalog::new(vec![table.clone()]);
        let name = TableName::from("users");
        let stats = Stats::new();
        let patches: Vec<Patch<'_>> = planned.iter().map(|row| Patch::Put(&name, row)).collect();
        build_poke(&catalog, &stats, 500, "1", None, "01", Vec::new(), &patches);
        time("build_poke, rows already sent (cache hits)", &mut || {
            let (frames, _, _) =
                build_poke(&catalog, &stats, 500, "1", None, "01", Vec::new(), &patches);
            sink += frames.len();
        });
        let fresh: Vec<Vec<DataFrameRow>> = (0..15)
            .map(|_| {
                planned
                    .iter()
                    .map(|row| {
                        let values = row.data.values().cloned().collect();
                        DataFrameRow::from(RowData::with_schema(layout.clone(), values))
                    })
                    .collect()
            })
            .collect();
        let mut fresh = fresh.into_iter();
        let mut sent: Vec<Vec<DataFrameRow>> = Vec::new();
        time("build_poke, rows never sent (plan + fill)", &mut || {
            let rows = fresh.next().unwrap();
            let patches: Vec<Patch<'_>> = rows.iter().map(|row| Patch::Put(&name, row)).collect();
            let (frames, _, _) =
                build_poke(&catalog, &stats, 500, "1", None, "01", Vec::new(), &patches);
            sink += frames.len();
            drop(patches);
            sent.push(rows);
        });
        println!("({sink} bytes and frames, so nothing is optimised away)");
    }

    /// What a population of clients connecting costs the group thread,
    /// through the real thread (`Groups`): 400 client groups, one tab each,
    /// each registering a startup set over row images the engine shares
    /// between subscriptions, as it does:
    /// - `getUsersV2`: the workspace's 5 526 users, the same images for
    ///   every group;
    /// - `userChannels`: 250 of 1 200 channels, overlapping between groups;
    /// - `channelConversations` x 10: a page of 50 messages in each of ten
    ///   of the group's channels, overlapping where groups share channels;
    /// - 15 small per-user queries of 3 rows each, every group its own.
    ///
    /// Two arrivals: staggered (one group after another, every query
    /// landing and flushing on its own, the steady state) and a storm
    /// (25 groups' registrations landing in each flush, a deploy's
    /// reconnects). Prints the time the thread spent and the rows
    /// serialized and reused, and a checksum of every frame sent so two
    /// builds can be compared byte for byte. Run with
    /// `cargo test --release --lib connect_storm_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn connect_storm_cost() {
        use crate::model::{
            DbColumn, DbTable, Order, OrderBy, RowSchema, SingleTableReadQuery, ValueType, Where,
        };
        const GROUPS: usize = 400;
        const USERS: usize = 5_526;
        const CHANNELS: usize = 1_200;
        const PER_PAGE: usize = 50;
        /// Rows a query shows: each row's key and the engine's image.
        type Shown = Vec<(DataFrameKey, DataFrameRow)>;

        fn table(name: &str, columns: &[(&str, ValueType)]) -> DbTable {
            DbTable::new(
                name,
                ["id"],
                columns
                    .iter()
                    .map(|(column, kind)| DbColumn::new(*column, kind.clone()))
                    .collect(),
            )
        }
        let mut user_columns: Vec<(&str, ValueType)> = vec![
            ("id", ValueType::String),
            ("email", ValueType::String),
            ("name", ValueType::String),
            ("avatarUrl", ValueType::String),
            ("preferences", ValueType::Json),
            ("createdAt", ValueType::Timestamp),
            ("updatedAt", ValueType::Timestamp),
            ("lastSeenAt", ValueType::Timestamp),
            ("isActive", ValueType::Bool),
            ("isBot", ValueType::Bool),
            ("role", ValueType::String),
            ("timezone", ValueType::String),
            ("workspaceId", ValueType::String),
        ];
        let extras: Vec<String> = (0..7).map(|n| format!("field{n}")).collect();
        for extra in &extras {
            user_columns.push((extra.as_str(), ValueType::String));
        }
        let users = table("users", &user_columns);
        let channels = table(
            "channels",
            &[
                ("id", ValueType::String),
                ("workspaceId", ValueType::String),
                ("name", ValueType::String),
                ("description", ValueType::String),
                ("visibility", ValueType::String),
                ("type", ValueType::String),
                ("createdAt", ValueType::Timestamp),
                ("updatedAt", ValueType::Timestamp),
                ("createdBy", ValueType::String),
                ("isArchived", ValueType::Bool),
                ("lastMessageAt", ValueType::Timestamp),
                ("metadata", ValueType::Json),
            ],
        );
        let messages = table(
            "messages",
            &[
                ("id", ValueType::String),
                ("channelId", ValueType::String),
                ("conversationId", ValueType::String),
                ("senderId", ValueType::String),
                ("content", ValueType::String),
                ("type", ValueType::String),
                ("createdAt", ValueType::Timestamp),
                ("updatedAt", ValueType::Timestamp),
                ("editedAt", ValueType::Timestamp),
                ("isDeleted", ValueType::Bool),
                ("reactions", ValueType::Json),
                ("attachments", ValueType::Json),
                ("threadCount", ValueType::Int),
            ],
        );
        let items = table(
            "items",
            &[
                ("id", ValueType::String),
                ("userId", ValueType::String),
                ("kind", ValueType::String),
                ("value", ValueType::String),
                ("updatedAt", ValueType::Timestamp),
            ],
        );
        fn image(
            layout: &Arc<RowSchema>,
            cell: impl Fn(&str) -> Value,
        ) -> (DataFrameKey, DataFrameRow) {
            let values: Vec<Value> = layout.names().iter().map(|c| cell(c.as_str())).collect();
            let key =
                DataFrameKey::from(HashMap::from([(ColumnName::from("id"), values[0].clone())]));
            (
                key,
                DataFrameRow::from(RowData::with_schema(layout.clone(), values)),
            )
        }
        let t0 = 1_759_000_000_000i64;
        // The engine's images, built afresh for every run: a new pod's
        // rows, nothing sent yet.
        let build = || {
            let user_rows: Shown = (0..USERS)
                .map(|n| {
                    image(users.row_schema(), |c| match c {
                        "id" => Value::from(format!("u{n:08}x7f3kq2")),
                        "email" => Value::from(format!("person.{n}@example.com")),
                        "name" => Value::from(format!("Person Number {n}")),
                        "avatarUrl" => {
                            Value::from(format!("https://cdn.example.com/a/{n}.png?s=64"))
                        }
                        "preferences" => Value::from(r#"{"theme":"dark","notify":{"dm":true}}"#),
                        "createdAt" | "updatedAt" | "lastSeenAt" => Value::Int(t0 + n as i64),
                        "isActive" => Value::Bool(true),
                        "isBot" => Value::Bool(false),
                        "role" => Value::from("member"),
                        "timezone" => Value::from("Asia/Kolkata"),
                        "workspaceId" => Value::from("6642623f-cca7-43ad-9a6b-5e49c33226b4"),
                        _ => Value::from(format!("value {n}")),
                    })
                })
                .collect();
            let channel_rows: Shown = (0..CHANNELS)
                .map(|n| {
                    image(channels.row_schema(), |c| match c {
                        "id" => Value::from(format!("c{n:06}")),
                        "workspaceId" => Value::from("6642623f-cca7-43ad-9a6b-5e49c33226b4"),
                        "name" => Value::from(format!("team-channel-{n}")),
                        "description" => Value::from(format!("Discussion for \"area {n}\"")),
                        "visibility" => Value::from(if n % 4 == 0 { "private" } else { "public" }),
                        "type" => Value::from("channel"),
                        "createdAt" | "updatedAt" | "lastMessageAt" => Value::Int(t0 + n as i64),
                        "createdBy" => Value::from(format!("u{:08}x7f3kq2", n % USERS)),
                        "isArchived" => Value::Bool(false),
                        _ => Value::from(r#"{"pinned":[],"topic":"general"}"#),
                    })
                })
                .collect();
            let message_rows: Shown = (0..CHANNELS * PER_PAGE)
                .map(|n| {
                    image(messages.row_schema(), |c| match c {
                        "id" => Value::from(format!("m{n:08}")),
                        "channelId" => Value::from(format!("c{:06}", n / PER_PAGE)),
                        "conversationId" => Value::from(format!("v{:07}", n / 5)),
                        "senderId" => Value::from(format!("u{:08}x7f3kq2", n % USERS)),
                        "content" => Value::from(format!(
                            "Message {n}: the deploy finished, see \"notes\" for the details\nthanks"
                        )),
                        "type" => Value::from("text"),
                        "createdAt" | "updatedAt" => Value::Int(t0 + n as i64),
                        "editedAt" => Value::Null,
                        "isDeleted" => Value::Bool(false),
                        "reactions" => Value::from(r#"{"+1":["u1","u2"]}"#),
                        "attachments" => Value::from("[]"),
                        _ => Value::Int((n % 7) as i64),
                    })
                })
                .collect();
            (user_rows, channel_rows, message_rows)
        };

        let vars: HashMap<&str, &str> = HashMap::from([
            ("STREAMGRES_PG_DSN", "postgresql://none/none"),
            ("STREAMGRES_MASTER_PG_DSN", "postgresql://none/none"),
            ("STREAMGRES_QUERY_URL", "http://none/query"),
            ("STREAMGRES_MUTATE_URL", "http://none/push"),
        ]);
        let config = Config::from_lookup(|name| vars.get(name).map(|v| (*v).to_owned()))
            .expect("a configuration");
        let catalog = Catalog::new([
            users.clone(),
            channels.clone(),
            messages.clone(),
            items.clone(),
        ]);

        // One group's startup set: (hash, table, the rows it shows).
        let startup = |g: usize,
                       user_rows: &[(DataFrameKey, DataFrameRow)],
                       channel_rows: &[(DataFrameKey, DataFrameRow)],
                       message_rows: &[(DataFrameKey, DataFrameRow)]|
         -> Vec<(String, &'static str, Shown)> {
            let mut set = vec![("getUsersV2".to_owned(), "users", user_rows.to_vec())];
            let mine: Vec<usize> = (0..250).map(|i| (g * 37 + i * 5) % CHANNELS).collect();
            set.push((
                "userChannels".to_owned(),
                "channels",
                mine.iter().map(|c| channel_rows[*c].clone()).collect(),
            ));
            for c in &mine[..10] {
                set.push((
                    format!("channelConversations-{c}"),
                    "messages",
                    message_rows[c * PER_PAGE..(c + 1) * PER_PAGE].to_vec(),
                ));
            }
            for q in 0..15 {
                let rows = (0..3)
                    .map(|r| {
                        image(items.row_schema(), |c| match c {
                            "id" => Value::from(format!("i-{g}-{q}-{r}")),
                            "userId" => Value::from(format!("u{g:08}x7f3kq2")),
                            "kind" => Value::from(format!("kind{q}")),
                            "value" => Value::from(format!("setting {q} of user {g}")),
                            _ => Value::Int(t0),
                        })
                    })
                    .collect();
                set.push((format!("userItems{q}"), "items", rows));
            }
            set
        };

        let run = |per_flush: usize| {
            let (user_rows, channel_rows, message_rows) = build();
            let stats = Stats::shared();
            let (outbox, mut commands) = mpsc::unbounded_channel();
            let (requests, _requests_rx) = mpsc::channel(16);
            let mut core = Groups {
                clients_table: TableName::from(config.clients_table().as_str()),
                mutations_table: TableName::from(config.mutations_table().as_str()),
                config: Arc::new(config.clone()),
                catalog: Arc::new(CatalogHandle::new(catalog.clone())),
                shard: 0,
                stats: stats.clone(),
                oldest: None,
                commands: outbox,
                requests,
                ready: true,
                readiness: watch::channel(true).0,
                backlog: Vec::new(),
                groups: HashMap::new(),
                by_sub: HashMap::new(),
                awaiting: HashMap::new(),
                pending: HashMap::new(),
                lmid_changes: HashMap::new(),
                result_changes: HashMap::new(),
                dirty: HashSet::new(),
                next_poke: 1,
                next_generation: 0,
            };
            let mut thread_time = Duration::ZERO;
            let mut flush_time = Duration::ZERO;
            let (mut bytes, mut checksum, mut pokes) = (0usize, 0u64, 0usize);
            let mut drain = |tab: &mut mpsc::UnboundedReceiver<Outbound>| {
                while let Ok(outbound) = tab.try_recv() {
                    if let Outbound::Poke { frames, .. } = outbound {
                        pokes += 1;
                        let mut hash = 0xcbf2_9ce4_8422_2325u64;
                        for frame in frames.iter() {
                            bytes += frame.len();
                            for byte in frame.iter() {
                                hash = (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3);
                            }
                        }
                        checksum = checksum.wrapping_add(hash);
                    }
                }
            };
            let batch = per_flush.max(1);
            for first in (0..GROUPS).step_by(batch) {
                let members: Vec<usize> = (first..(first + batch).min(GROUPS)).collect();
                let mut tabs = Vec::new();
                let mut landing: Vec<(u64, SubId, &'static str, Shown)> = Vec::new();
                for g in &members {
                    let group = format!("group-{g}");
                    let (sink, frames) = mpsc::unbounded_channel();
                    let started = Instant::now();
                    let reply = core.connect(
                        &group,
                        format!("ws-{g}"),
                        Socket {
                            client: format!("client-{g}"),
                            sink,
                        },
                        None,
                        Vec::new(),
                        Vec::new(),
                    );
                    thread_time += started.elapsed();
                    assert!(matches!(reply, ConnectReply::Accepted));
                    tabs.push(frames);
                    for (q, (hash, table, rows)) in
                        startup(*g, &user_rows, &channel_rows, &message_rows)
                            .into_iter()
                            .enumerate()
                    {
                        let query = MultiTableReadQuery::single(SingleTableReadQuery::new(
                            table,
                            Where::AND(Vec::new()),
                            OrderBy::new("id", Order::ASC),
                            u32::MAX,
                        ));
                        let started = Instant::now();
                        core.desired(
                            &group,
                            &format!("client-{g}"),
                            vec![DesiredOp::Put {
                                hash: hash.clone(),
                                name: hash,
                                ttl: None,
                                planned: Some(Ok(Box::new(Translated {
                                    query,
                                    hidden: HashSet::new(),
                                    uncursored: None,
                                }))),
                            }],
                        );
                        thread_time += started.elapsed();
                        let token = loop {
                            match commands.try_recv().expect("a registration is sent") {
                                Command::Register { token, .. } => break token,
                                _ => continue,
                            }
                        };
                        let sub = SubId((g * 100 + q) as u64);
                        landing.push((token, sub, table, rows));
                        if per_flush == 0 {
                            let (token, sub, table, rows) = landing.pop().unwrap();
                            let started = Instant::now();
                            core.event(Event::Registered {
                                token,
                                sub,
                                updates: deltas(table, sub, rows),
                                reads: 1,
                            });
                            core.event(Event::Hydrated(vec![sub]));
                            let flushing = Instant::now();
                            core.flush();
                            flush_time += flushing.elapsed();
                            thread_time += started.elapsed();
                            drain(tabs.last_mut().unwrap());
                        }
                    }
                }
                if per_flush > 0 {
                    let started = Instant::now();
                    let mut hydrated = Vec::new();
                    for (token, sub, table, rows) in landing {
                        core.event(Event::Registered {
                            token,
                            sub,
                            updates: deltas(table, sub, rows),
                            reads: 1,
                        });
                        hydrated.push(sub);
                    }
                    core.event(Event::Hydrated(hydrated));
                    let flushing = Instant::now();
                    core.flush();
                    flush_time += flushing.elapsed();
                    thread_time += started.elapsed();
                    for tab in &mut tabs {
                        drain(tab);
                    }
                }
            }
            (
                thread_time,
                flush_time,
                stats.rows_serialized.load(Ordering::Relaxed),
                stats.rows_shared.load(Ordering::Relaxed),
                pokes,
                bytes,
                checksum,
            )
        };
        fn deltas(table: &str, sub: SubId, rows: Shown) -> Vec<Delta> {
            rows.into_iter()
                .map(|(key, image)| Delta {
                    table: TableName::from(table),
                    op: DataFrameOperation::Add(key, image),
                    audiences: vec![crate::ivm::Audience {
                        part: QueryPart::main(),
                        subs: crate::ivm::Subs::One(sub),
                    }],
                })
                .collect()
        }

        on_local(|| {
            for (label, per_flush) in [
                ("staggered (a flush per query, one group at a time)", 0usize),
                ("storm (25 groups' registrations in each flush)", 25),
            ] {
                let mut runs = Vec::new();
                for _ in 0..3 {
                    runs.push(run(per_flush));
                }
                runs.sort_by_key(|run| run.0);
                let (thread, flush, serialized, shared, pokes, bytes, checksum) = runs[1];
                println!(
                    "STORM {label}: thread {:7.1} ms, of which flush {:7.1} ms | rows serialized {serialized:>9}, reused {shared:>9} | {pokes} pokes, {:.1} MB, checksum {checksum:016x}",
                    thread.as_secs_f64() * 1e3,
                    flush.as_secs_f64() * 1e3,
                    bytes as f64 / 1e6
                );
            }
        });
    }

    /// One hour of prod's traffic through the real group threads, at
    /// the rates prod showed over its 36 h on streamgres (2026-10-03 16:28
    /// to 10-05 04:48 UTC): 4 group threads; 700 client groups already
    /// there, their rows already sent (a warm-up, not measured); then, in
    /// the hour, 162 new groups each hydrating a startup set (5 876 groups
    /// opened in the run), 5 500 pages hydrated by navigation (5 680
    /// hydrations an hour), messages written into channels whose pages
    /// groups hold, and a few user rows updated, sent to every group.
    /// Connects that resume from a cookie are left out: they replay
    /// frames already built and serialize nothing. Each event lands and
    /// flushes on its own, as prod's 19 900 flushes an hour did. Prints
    /// the threads' flush time, the rows serialized and reused, the time
    /// a new group's startup set and a page spend in flushes, and a
    /// checksum of every frame. Run with
    /// `cargo test --release --lib prod_hour_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn prod_hour_cost() {
        use crate::model::{
            DbColumn, DbTable, Order, OrderBy, RowSchema, SingleTableReadQuery, ValueType, Where,
        };
        const SHARDS: usize = 4;
        const STANDING: usize = 700;
        const WARM_PAGES: usize = 2_000;
        const NEW: usize = 162;
        const PAGES: usize = 5_500;
        const INSERTS: usize = 600;
        const USER_UPDATES: usize = 5;
        const USERS: usize = 5_526;
        const CHANNELS: usize = 1_200;
        const PER_PAGE: usize = 50;
        /// Rows a query shows: each row's key and the engine's image.
        type Shown = Vec<(DataFrameKey, DataFrameRow)>;

        /// What one group thread is handed, in order.
        enum Step {
            /// A new group connects and hydrates its startup set, one
            /// query after another: (sub, hash, table, rows).
            Open(usize, Vec<(SubId, String, &'static str, Shown)>),
            /// A group hydrates one more page.
            Page(usize, SubId, String, Shown),
            /// A write lands for some of this thread's groups.
            Land(Vec<usize>, Vec<Delta>),
        }

        fn table(name: &str, columns: &[(&str, ValueType)]) -> DbTable {
            DbTable::new(
                name,
                ["id"],
                columns
                    .iter()
                    .map(|(column, kind)| DbColumn::new(*column, kind.clone()))
                    .collect(),
            )
        }
        let mut user_columns: Vec<(&str, ValueType)> = vec![
            ("id", ValueType::String),
            ("email", ValueType::String),
            ("name", ValueType::String),
            ("avatarUrl", ValueType::String),
            ("preferences", ValueType::Json),
            ("createdAt", ValueType::Timestamp),
            ("updatedAt", ValueType::Timestamp),
            ("lastSeenAt", ValueType::Timestamp),
            ("isActive", ValueType::Bool),
            ("isBot", ValueType::Bool),
            ("role", ValueType::String),
            ("timezone", ValueType::String),
            ("workspaceId", ValueType::String),
        ];
        let extras: Vec<String> = (0..7).map(|n| format!("field{n}")).collect();
        for extra in &extras {
            user_columns.push((extra.as_str(), ValueType::String));
        }
        let users = table("users", &user_columns);
        let channels = table(
            "channels",
            &[
                ("id", ValueType::String),
                ("workspaceId", ValueType::String),
                ("name", ValueType::String),
                ("description", ValueType::String),
                ("visibility", ValueType::String),
                ("type", ValueType::String),
                ("createdAt", ValueType::Timestamp),
                ("updatedAt", ValueType::Timestamp),
                ("createdBy", ValueType::String),
                ("isArchived", ValueType::Bool),
                ("lastMessageAt", ValueType::Timestamp),
                ("metadata", ValueType::Json),
            ],
        );
        let messages = table(
            "messages",
            &[
                ("id", ValueType::String),
                ("channelId", ValueType::String),
                ("conversationId", ValueType::String),
                ("senderId", ValueType::String),
                ("content", ValueType::String),
                ("type", ValueType::String),
                ("createdAt", ValueType::Timestamp),
                ("updatedAt", ValueType::Timestamp),
                ("editedAt", ValueType::Timestamp),
                ("isDeleted", ValueType::Bool),
                ("reactions", ValueType::Json),
                ("attachments", ValueType::Json),
                ("threadCount", ValueType::Int),
            ],
        );
        let items = table(
            "items",
            &[
                ("id", ValueType::String),
                ("userId", ValueType::String),
                ("kind", ValueType::String),
                ("value", ValueType::String),
                ("updatedAt", ValueType::Timestamp),
            ],
        );
        fn image(
            layout: &Arc<RowSchema>,
            cell: impl Fn(&str) -> Value,
        ) -> (DataFrameKey, DataFrameRow) {
            let values: Vec<Value> = layout.names().iter().map(|c| cell(c.as_str())).collect();
            let key =
                DataFrameKey::from(HashMap::from([(ColumnName::from("id"), values[0].clone())]));
            (
                key,
                DataFrameRow::from(RowData::with_schema(layout.clone(), values)),
            )
        }
        let t0 = 1_759_000_000_000i64;
        let user = |n: usize, seen: i64| {
            image(users.row_schema(), |c| match c {
                "id" => Value::from(format!("u{n:08}x7f3kq2")),
                "email" => Value::from(format!("person.{n}@example.com")),
                "name" => Value::from(format!("Person Number {n}")),
                "avatarUrl" => Value::from(format!("https://cdn.example.com/a/{n}.png?s=64")),
                "preferences" => Value::from(r#"{"theme":"dark","notify":{"dm":true}}"#),
                "createdAt" | "updatedAt" => Value::Int(t0 + n as i64),
                "lastSeenAt" => Value::Int(t0 + seen),
                "isActive" => Value::Bool(true),
                "isBot" => Value::Bool(false),
                "role" => Value::from("member"),
                "timezone" => Value::from("Asia/Kolkata"),
                "workspaceId" => Value::from("6642623f-cca7-43ad-9a6b-5e49c33226b4"),
                _ => Value::from(format!("value {n}")),
            })
        };
        let message = |n: usize, channel: usize| {
            image(messages.row_schema(), |c| match c {
                "id" => Value::from(format!("m{n:08}")),
                "channelId" => Value::from(format!("c{channel:06}")),
                "conversationId" => Value::from(format!("v{:07}", n / 5)),
                "senderId" => Value::from(format!("u{:08}x7f3kq2", n % USERS)),
                "content" => Value::from(format!(
                    "Message {n}: the deploy finished, see \"notes\" for the details\nthanks"
                )),
                "type" => Value::from("text"),
                "createdAt" | "updatedAt" => Value::Int(t0 + n as i64),
                "editedAt" => Value::Null,
                "isDeleted" => Value::Bool(false),
                "reactions" => Value::from(r#"{"+1":["u1","u2"]}"#),
                "attachments" => Value::from("[]"),
                _ => Value::Int((n % 7) as i64),
            })
        };
        fn deltas(table: &str, sub: SubId, rows: &Shown) -> Vec<Delta> {
            rows.iter()
                .map(|(key, image)| Delta {
                    table: TableName::from(table),
                    op: DataFrameOperation::Add(key.clone(), image.clone()),
                    audiences: vec![crate::ivm::Audience {
                        part: QueryPart::main(),
                        subs: crate::ivm::Subs::One(sub),
                    }],
                })
                .collect()
        }

        // The engine side: every image, and every step of the hour, made
        // up front with a fixed seed, so two builds replay the same hour.
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        // Channel popularity: Zipf over the channels (a few busy ones).
        let weight: Vec<f64> = (0..CHANNELS)
            .map(|rank| 1.0 / ((rank + 1) as f64).powf(0.9))
            .collect();
        let mut user_rows: Shown = (0..USERS).map(|n| user(n, 0)).collect();
        let channel_rows: Shown = (0..CHANNELS)
            .map(|n| {
                image(channels.row_schema(), |c| match c {
                    "id" => Value::from(format!("c{n:06}")),
                    "workspaceId" => Value::from("6642623f-cca7-43ad-9a6b-5e49c33226b4"),
                    "name" => Value::from(format!("team-channel-{n}")),
                    "description" => Value::from(format!("Discussion for \"area {n}\"")),
                    "visibility" => Value::from(if n % 4 == 0 { "private" } else { "public" }),
                    "type" => Value::from("channel"),
                    "createdAt" | "updatedAt" | "lastMessageAt" => Value::Int(t0 + n as i64),
                    "createdBy" => Value::from(format!("u{:08}x7f3kq2", n % USERS)),
                    "isArchived" => Value::Bool(false),
                    _ => Value::from(r#"{"pinned":[],"topic":"general"}"#),
                })
            })
            .collect();
        let mut written = 0usize;
        let mut channel_messages: Vec<Shown> = (0..CHANNELS)
            .map(|c| {
                (0..PER_PAGE)
                    .map(|_| {
                        written += 1;
                        message(written, c)
                    })
                    .collect()
            })
            .collect();
        let mine =
            |g: usize| -> Vec<usize> { (0..250).map(|i| (g * 37 + i * 5) % CHANNELS).collect() };
        let latest = |messages: &Shown| -> Shown { messages[messages.len() - PER_PAGE..].to_vec() };

        let mut warm: Vec<Vec<Step>> = (0..SHARDS).map(|_| Vec::new()).collect();
        let mut hour: Vec<Vec<Step>> = (0..SHARDS).map(|_| Vec::new()).collect();
        let mut next_sub = 1u64;
        let mut opened: Vec<usize> = Vec::new();
        let mut users_sub: HashMap<usize, SubId> = HashMap::new();
        let mut page_subs: Vec<Vec<(usize, SubId)>> = vec![Vec::new(); CHANNELS];
        let mut sub = || {
            next_sub += 1;
            SubId(next_sub)
        };
        // Pick one of the group's channels, the busy ones more often.
        let pick = |g: usize, roll: u64| -> usize {
            let channels = mine(g);
            let total: f64 = channels.iter().map(|c| weight[*c]).sum();
            let mut at = (roll % 1_000_000) as f64 / 1_000_000.0 * total;
            for c in &channels {
                at -= weight[*c];
                if at <= 0.0 {
                    return *c;
                }
            }
            channels[channels.len() - 1]
        };
        let open = |g: usize,
                    steps: &mut [Vec<Step>],
                    user_rows: &Shown,
                    channel_messages: &[Shown],
                    opened: &mut Vec<usize>,
                    users_sub: &mut HashMap<usize, SubId>,
                    page_subs: &mut [Vec<(usize, SubId)>],
                    sub: &mut dyn FnMut() -> SubId| {
            let mut set = Vec::new();
            let s = sub();
            users_sub.insert(g, s);
            set.push((s, "getUsersV2".to_owned(), "users", user_rows.clone()));
            let channels = mine(g);
            set.push((
                sub(),
                "userChannels".to_owned(),
                "channels",
                channels.iter().map(|c| channel_rows[*c].clone()).collect(),
            ));
            for c in &channels[..10] {
                let s = sub();
                page_subs[*c].push((g, s));
                set.push((
                    s,
                    format!("channelConversations-{c}"),
                    "messages",
                    latest(&channel_messages[*c]),
                ));
            }
            for q in 0..15 {
                let rows = (0..3)
                    .map(|r| {
                        image(items.row_schema(), |c| match c {
                            "id" => Value::from(format!("i-{g}-{q}-{r}")),
                            "userId" => Value::from(format!("u{g:08}x7f3kq2")),
                            "kind" => Value::from(format!("kind{q}")),
                            "value" => Value::from(format!("setting {q} of user {g}")),
                            _ => Value::Int(t0),
                        })
                    })
                    .collect();
                set.push((sub(), format!("userItems{q}"), "items", rows));
            }
            opened.push(g);
            steps[g % SHARDS].push(Step::Open(g, set));
        };
        for g in 0..STANDING {
            open(
                g,
                &mut warm,
                &user_rows,
                &channel_messages,
                &mut opened,
                &mut users_sub,
                &mut page_subs,
                &mut sub,
            );
        }
        for _ in 0..WARM_PAGES {
            let g = opened[(next() % opened.len() as u64) as usize];
            // A page the group does not hold yet (one it holds registers
            // nothing new).
            let c = (0..20)
                .map(|_| pick(g, next()))
                .find(|c| !page_subs[*c].iter().any(|(holder, _)| *holder == g))
                .or_else(|| {
                    mine(g)
                        .into_iter()
                        .find(|c| !page_subs[*c].iter().any(|(holder, _)| *holder == g))
                })
                .expect("a channel whose page the group does not hold");
            let s = sub();
            page_subs[c].push((g, s));
            warm[g % SHARDS].push(Step::Page(
                g,
                s,
                format!("channelConversations-{c}"),
                latest(&channel_messages[c]),
            ));
        }
        // The hour, its steps interleaved in proportion.
        let total = NEW + PAGES + INSERTS + USER_UPDATES;
        let mut left = [NEW, PAGES, INSERTS, USER_UPDATES];
        for _ in 0..total {
            let mut roll = next() % left.iter().sum::<usize>() as u64;
            let mut kind = 0;
            while roll >= left[kind] as u64 {
                roll -= left[kind] as u64;
                kind += 1;
            }
            left[kind] -= 1;
            match kind {
                0 => {
                    let g = STANDING + (NEW - left[0] - 1);
                    open(
                        g,
                        &mut hour,
                        &user_rows,
                        &channel_messages,
                        &mut opened,
                        &mut users_sub,
                        &mut page_subs,
                        &mut sub,
                    );
                }
                1 => {
                    let g = opened[(next() % opened.len() as u64) as usize];
                    let c = (0..20)
                        .map(|_| pick(g, next()))
                        .find(|c| !page_subs[*c].iter().any(|(holder, _)| *holder == g))
                        .or_else(|| {
                            mine(g)
                                .into_iter()
                                .find(|c| !page_subs[*c].iter().any(|(holder, _)| *holder == g))
                        })
                        .expect("a channel whose page the group does not hold");
                    let s = sub();
                    page_subs[c].push((g, s));
                    hour[g % SHARDS].push(Step::Page(
                        g,
                        s,
                        format!("channelConversations-{c}"),
                        latest(&channel_messages[c]),
                    ));
                }
                2 => {
                    // A message in a channel chosen by popularity.
                    let total: f64 = weight.iter().sum();
                    let mut at = (next() % 1_000_000) as f64 / 1_000_000.0 * total;
                    let mut c = CHANNELS - 1;
                    for (index, w) in weight.iter().enumerate() {
                        at -= w;
                        if at <= 0.0 {
                            c = index;
                            break;
                        }
                    }
                    written += 1;
                    let (key, image) = message(written, c);
                    channel_messages[c].push((key.clone(), image.clone()));
                    let mut per_shard: Vec<(Vec<usize>, Vec<Delta>)> =
                        (0..SHARDS).map(|_| (Vec::new(), Vec::new())).collect();
                    for (g, s) in &page_subs[c] {
                        let (groups, deltas) = &mut per_shard[g % SHARDS];
                        groups.push(*g);
                        deltas.push(Delta {
                            table: TableName::from("messages"),
                            op: DataFrameOperation::Add(key.clone(), image.clone()),
                            audiences: vec![crate::ivm::Audience {
                                part: QueryPart::main(),
                                subs: crate::ivm::Subs::One(*s),
                            }],
                        });
                    }
                    for (shard, (groups, deltas)) in per_shard.into_iter().enumerate() {
                        if !deltas.is_empty() {
                            hour[shard].push(Step::Land(groups, deltas));
                        }
                    }
                }
                _ => {
                    // A user's row changes; every group holds the users list.
                    let n = (next() % USERS as u64) as usize;
                    let (key, old) = user_rows[n].clone();
                    let (_, new) = user(n, 1 + left[3] as i64);
                    user_rows[n] = (key.clone(), new.clone());
                    let mut per_shard: Vec<(Vec<usize>, Vec<Delta>)> =
                        (0..SHARDS).map(|_| (Vec::new(), Vec::new())).collect();
                    for g in &opened {
                        let s = users_sub[g];
                        let (groups, deltas) = &mut per_shard[g % SHARDS];
                        groups.push(*g);
                        for op in [
                            DataFrameOperation::Delete(key.clone(), old.clone()),
                            DataFrameOperation::Add(key.clone(), new.clone()),
                        ] {
                            deltas.push(Delta {
                                table: TableName::from("users"),
                                op,
                                audiences: vec![crate::ivm::Audience {
                                    part: QueryPart::main(),
                                    subs: crate::ivm::Subs::One(s),
                                }],
                            });
                        }
                    }
                    for (shard, (groups, deltas)) in per_shard.into_iter().enumerate() {
                        if !deltas.is_empty() {
                            hour[shard].push(Step::Land(groups, deltas));
                        }
                    }
                }
            }
        }

        let vars: HashMap<&str, &str> = HashMap::from([
            ("STREAMGRES_PG_DSN", "postgresql://none/none"),
            ("STREAMGRES_MASTER_PG_DSN", "postgresql://none/none"),
            ("STREAMGRES_QUERY_URL", "http://none/query"),
            ("STREAMGRES_MUTATE_URL", "http://none/push"),
        ]);
        let config = Config::from_lookup(|name| vars.get(name).map(|v| (*v).to_owned()))
            .expect("a configuration");
        let catalog = Catalog::new([
            users.clone(),
            channels.clone(),
            messages.clone(),
            items.clone(),
        ]);

        /// What one thread measured over the hour.
        #[derive(Default)]
        struct Measured {
            flush: Duration,
            serialized: u64,
            reused: u64,
            pokes: usize,
            bytes: usize,
            checksum: u64,
            opens: Vec<f64>,
            pages: Vec<f64>,
        }
        let replay = |shard: usize, warm: &[Step], hour: &[Step]| -> Measured {
            on_local(|| {
                let stats = Stats::shared();
                let (outbox, mut commands) = mpsc::unbounded_channel();
                let (requests, _requests_rx) = mpsc::channel(16);
                let mut core = Groups {
                    clients_table: TableName::from(config.clients_table().as_str()),
                    mutations_table: TableName::from(config.mutations_table().as_str()),
                    config: Arc::new(config.clone()),
                    catalog: Arc::new(CatalogHandle::new(catalog.clone())),
                    shard,
                    stats: stats.clone(),
                    oldest: None,
                    commands: outbox,
                    requests,
                    ready: true,
                    readiness: watch::channel(true).0,
                    backlog: Vec::new(),
                    groups: HashMap::new(),
                    by_sub: HashMap::new(),
                    awaiting: HashMap::new(),
                    pending: HashMap::new(),
                    lmid_changes: HashMap::new(),
                    result_changes: HashMap::new(),
                    dirty: HashSet::new(),
                    next_poke: 1,
                    next_generation: 0,
                };
                let mut tabs: HashMap<usize, mpsc::UnboundedReceiver<Outbound>> = HashMap::new();
                let mut out = Measured::default();
                let drain = |tab: &mut mpsc::UnboundedReceiver<Outbound>,
                             out: &mut Measured,
                             count: bool| {
                    while let Ok(outbound) = tab.try_recv() {
                        if let (Outbound::Poke { frames, .. }, true) = (outbound, count) {
                            out.pokes += 1;
                            let mut hash = 0xcbf2_9ce4_8422_2325u64;
                            for frame in frames.iter() {
                                out.bytes += frame.len();
                                for byte in frame.iter() {
                                    hash = (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3);
                                }
                            }
                            out.checksum = out.checksum.wrapping_add(hash);
                        }
                    }
                };
                let mut register = |core: &mut Groups,
                                    g: usize,
                                    sub: SubId,
                                    hash: &str,
                                    table: &'static str,
                                    rows: &Shown|
                 -> Duration {
                    let query = MultiTableReadQuery::single(SingleTableReadQuery::new(
                        table,
                        Where::AND(Vec::new()),
                        OrderBy::new("id", Order::ASC),
                        u32::MAX,
                    ));
                    core.desired(
                        &format!("group-{g}"),
                        &format!("client-{g}"),
                        vec![DesiredOp::Put {
                            hash: hash.to_owned(),
                            name: hash.to_owned(),
                            ttl: None,
                            planned: Some(Ok(Box::new(Translated {
                                query,
                                hidden: HashSet::new(),
                                uncursored: None,
                            }))),
                        }],
                    );
                    let token = loop {
                        match commands.try_recv().expect("a registration is sent") {
                            Command::Register { token, .. } => break token,
                            _ => continue,
                        }
                    };
                    core.event(Event::Registered {
                        token,
                        sub,
                        updates: deltas(table, sub, rows),
                        reads: 1,
                    });
                    core.event(Event::Hydrated(vec![sub]));
                    let started = Instant::now();
                    core.flush();
                    started.elapsed()
                };
                for (measured, steps) in [(false, warm), (true, hour)] {
                    if measured {
                        let serialized = stats.rows_serialized.load(Ordering::Relaxed);
                        let reused = stats.rows_shared.load(Ordering::Relaxed);
                        out.serialized = 0u64.wrapping_sub(serialized);
                        out.reused = 0u64.wrapping_sub(reused);
                    }
                    for step in steps {
                        match step {
                            Step::Open(g, set) => {
                                let (sink, frames) = mpsc::unbounded_channel();
                                let reply = core.connect(
                                    &format!("group-{g}"),
                                    format!("ws-{g}"),
                                    Socket {
                                        client: format!("client-{g}"),
                                        sink,
                                    },
                                    None,
                                    Vec::new(),
                                    Vec::new(),
                                );
                                assert!(matches!(reply, ConnectReply::Accepted));
                                tabs.insert(*g, frames);
                                let mut spent = Duration::ZERO;
                                for (sub, hash, table, rows) in set {
                                    spent += register(&mut core, *g, *sub, hash, table, rows);
                                    drain(tabs.get_mut(g).unwrap(), &mut out, measured);
                                }
                                if measured {
                                    out.flush += spent;
                                    out.opens.push(spent.as_secs_f64() * 1e3);
                                }
                            }
                            Step::Page(g, sub, hash, rows) => {
                                let spent = register(&mut core, *g, *sub, hash, "messages", rows);
                                drain(tabs.get_mut(g).unwrap(), &mut out, measured);
                                if measured {
                                    out.flush += spent;
                                    out.pages.push(spent.as_secs_f64() * 1e3);
                                }
                            }
                            Step::Land(groups, updates) => {
                                core.event(Event::Landed {
                                    updates: updates.clone(),
                                });
                                let started = Instant::now();
                                core.flush();
                                let spent = started.elapsed();
                                for g in groups {
                                    drain(tabs.get_mut(g).unwrap(), &mut out, measured);
                                }
                                if measured {
                                    out.flush += spent;
                                }
                            }
                        }
                    }
                }
                out.serialized = out
                    .serialized
                    .wrapping_add(stats.rows_serialized.load(Ordering::Relaxed));
                out.reused = out
                    .reused
                    .wrapping_add(stats.rows_shared.load(Ordering::Relaxed));
                out
            })
        };
        let measured: Vec<Measured> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..SHARDS)
                .map(|shard| {
                    let (warm, hour) = (&warm[shard], &hour[shard]);
                    let replay = &replay;
                    scope.spawn(move || replay(shard, warm, hour))
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect()
        });
        let quantile = |values: &mut Vec<f64>, q: f64| -> f64 {
            values.sort_by(f64::total_cmp);
            values[((values.len() as f64 - 1.0) * q).round() as usize]
        };
        let mut opens: Vec<f64> = measured.iter().flat_map(|m| m.opens.clone()).collect();
        let mut pages: Vec<f64> = measured.iter().flat_map(|m| m.pages.clone()).collect();
        let flush: f64 = measured.iter().map(|m| m.flush.as_secs_f64() * 1e3).sum();
        let busiest = measured
            .iter()
            .map(|m| m.flush.as_secs_f64() * 1e3)
            .fold(0.0, f64::max);
        let checksum = measured
            .iter()
            .fold(0u64, |sum, m| sum.wrapping_add(m.checksum));
        println!(
            "HOUR flush {flush:8.1} ms over {SHARDS} threads (busiest {busiest:7.1} ms) | rows serialized {:>9}, reused {:>9} | {} pokes, {:.0} MB | checksum {checksum:016x}",
            measured.iter().map(|m| m.serialized).sum::<u64>(),
            measured.iter().map(|m| m.reused).sum::<u64>(),
            measured.iter().map(|m| m.pokes).sum::<usize>(),
            measured.iter().map(|m| m.bytes).sum::<usize>() as f64 / 1e6,
        );
        println!(
            "HOUR new group's startup set, flush time: p50 {:6.2} ms  p90 {:6.2} ms  p99 {:6.2} ms  ({} groups)",
            quantile(&mut opens, 0.5),
            quantile(&mut opens, 0.9),
            quantile(&mut opens, 0.99),
            opens.len()
        );
        println!(
            "HOUR page hydration, flush time:      p50 {:6.3} ms  p90 {:6.3} ms  p99 {:6.3} ms  ({} pages)",
            quantile(&mut pages, 0.5),
            quantile(&mut pages, 0.9),
            quantile(&mut pages, 0.99),
            pages.len()
        );
    }
}
