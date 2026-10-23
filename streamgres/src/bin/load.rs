//! Load bench: the whole server over the wire, under a production-shaped
//! load, with its CPU, cores and memory sampled every second and reported
//! at the median, the 90th and the 99th percentile.
//!
//! ```bash
//! cargo build --release --bin server
//! STREAMGRES_PG_DSN=postgres://user@localhost:5432/streamgres_bench \
//!   cargo run --release --bin load -- --connections 200 --duration 60
//! ```
//!
//! Everything but PostgreSQL is this process's own: it lays out a chat and
//! ticketing workspace in the database named (which must have `bench` in
//! its name, since its tables are dropped and made again), hosts the
//! application server the sync server calls (the query endpoint turning
//! query names into ASTs, the mutate endpoint running the clients'
//! mutations against PostgreSQL), starts the server binary against both,
//! and connects the clients. Six phases, each reported:
//!
//! 1. **prepare** — the schema: `users` and `presence` (light, a thousand
//!    rows each, presence changing all the time), `channels` and
//!    `channel_members`, `conversations` (a markdown body of a few
//!    kilobytes, so the row is big and PostgreSQL stores it out of line),
//!    `messages` (a few hundred characters), `attachments` (a jsonb of a
//!    kilobyte or two), `tickets` (many light columns, updated in place)
//!    and `activities` (light inserts); the `xyne_0` schema the mutate
//!    endpoint records mutations in; the publication and the schema-change
//!    trigger stack. Then the seed rows.
//! 2. **server** — the server binary (`--server-bin`) started against the
//!    database and this process's application server, ready when `/health`
//!    says so; or an already running one (`--gateway`, with `--pid` to
//!    sample it).
//! 3. **hydrate** — `--connections` clients, each a browser tab of one of
//!    `--users` users, spread over `--channels` channels and `--boards`
//!    boards, registering the chat screen's queries by name: the user's
//!    channels (an `EXISTS` on memberships), the channel's latest fifty
//!    conversations (a window), `--threads` open threads (messages with
//!    their attachments, a LEFT join), the workspace's users and presence
//!    (shared by every client), the user's tickets and unread activities,
//!    and the board's page. Measured: socket open to `connected`, to the
//!    first poke, to every query reporting `got`; rows and bytes per client.
//! 4. **steady** — for `--warmup` then `--duration` seconds, `--writers`
//!    connections commit `--tps` transactions a second into PostgreSQL,
//!    `--rows-per-tx` writes each, drawn from a mix (a new conversation
//!    with its first message, a reply into an open thread which also bumps
//!    the conversation, an attachment, a ticket edited in place, a presence
//!    heartbeat, an activity); `--pushers` of the clients push
//!    `messages.send` mutations through the server at `--push-rate` a
//!    second between them, the way a user typing does; and `--churn` clients
//!    a second close and come back as fresh tabs, hydrating under load.
//!    Every row delivered is matched to its commit, so the latency reported
//!    is commit to client, by kind of row.
//! 5. **sample** — once a second, throughout: the server process's CPU time
//!    (as cores, the seconds of CPU per second of wall), each of its threads'
//!    by name (engine, groups, feed, reads, the tokio workers, ...), its
//!    resident set; and this process's own CPU, so a slow driver is visible
//!    as such. From the server's `/stats`: every pipeline stage's
//!    percentiles over the measured window, the counts, what is held.
//! 6. **report** — tables of p50 / p90 / p99 / max for each measurement, a
//!    PASS when every committed row reached every client that held its
//!    query and no connection dropped; `--out FILE` writes it all as JSON.
//!
//! Options (defaults in brackets): `--dsn` [`$STREAMGRES_PG_DSN`],
//! `--connections` [200], `--users` [100], `--channels` [20], `--boards`
//! [10], `--threads` [3], `--tps` [50], `--rows-per-tx` [5], `--writers`
//! [4], `--pushers` [8], `--push-rate` [10], `--churn` [1], `--warmup` [5],
//! `--duration` [60], `--md-kb` [3], `--seed-users` [1000],
//! `--seed-conversations` [100, per channel], `--seed-tickets` [10000],
//! `--backend-ms` [0, think time of the application server],
//! `--server-bin` [target/release/server], `--port` [4858],
//! `--group-threads` [1], `--read-threads` [2], `--read-connections` [16],
//! `--prewarm` [0: that many clients connected, hydrated and closed before
//! the measured hydration, so the server's pool and caches are warm], `--server-log`
//! [target/load-server.log], `--log-level` [warn], `--gateway URL` and
//! `--pid N` (attach instead of starting; the database must have been
//! prepared before that server started, `--prepare-only` does that),
//! `--out FILE`, `--label TEXT`, `--seed N`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json as AxumJson, Router};
use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value as Json_, json};
use tokio::net::TcpStream;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use streamgres::client::ddl_triggers::trigger_stack_sql;

type Json = Json_;
type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type Sink = futures_util::stream::SplitSink<Ws, Message>;

const WORKSPACE: &str = "ws-1";
const APP_ID: &str = "xyne";
const SHARD: u32 = 0;
const PUBLICATION: &str = "xyne_sync_pub";
const APP_SCHEMA: &str = "xyne_0";
const CLEANUP_RESULTS: &str = "_zero_cleanupResults";
/// The threads of a channel that clients open and writers reply into: the
/// newest seeded conversations, so a reply's bump of the conversation lands
/// in the channel's window too, as a reply to a recent thread does.
const THREAD_POOL: usize = 20;
/// Messages seeded under every conversation.
const SEED_REPLIES: usize = 5;

// ---------------------------------------------------------------------------
// Options

/// Everything the command line sets.
#[derive(Debug, Clone)]
struct Options {
    dsn: String,
    connections: usize,
    users: usize,
    channels: usize,
    boards: usize,
    threads: usize,
    tps: f64,
    rows_per_tx: usize,
    writers: usize,
    pushers: usize,
    push_rate: f64,
    churn: f64,
    warmup: u64,
    duration: u64,
    md_kb: f64,
    seed_users: usize,
    seed_conversations: usize,
    seed_tickets: usize,
    backend_ms: u64,
    server_bin: String,
    port: u16,
    group_threads: usize,
    read_threads: usize,
    read_connections: usize,
    prewarm: usize,
    sample_ms: u64,
    server_log: String,
    log_level: String,
    gateway: Option<String>,
    pid: Option<u32>,
    prepare_only: bool,
    out: Option<String>,
    label: String,
    seed: u64,
}

impl Options {
    /// Parse `--name value` pairs; a bad value says which.
    fn parse() -> Result<Options, String> {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut map: HashMap<String, String> = HashMap::new();
        let mut flags: HashSet<String> = HashSet::new();
        let mut index = 0;
        while index < args.len() {
            let arg = &args[index];
            let Some(name) = arg.strip_prefix("--") else {
                return Err(format!("unexpected argument `{arg}`"));
            };
            if name == "help" || name == "prepare-only" {
                flags.insert(name.to_owned());
                index += 1;
                continue;
            }
            let value = args
                .get(index + 1)
                .ok_or_else(|| format!("--{name} needs a value"))?;
            map.insert(name.to_owned(), value.clone());
            index += 2;
        }
        if flags.contains("help") {
            return Err(String::new());
        }
        let get = |name: &str| map.get(name).cloned();
        fn num<T: std::str::FromStr>(value: Option<String>, name: &str, default: T) -> Result<T, String> {
            match value {
                Some(text) => text
                    .parse::<T>()
                    .map_err(|_| format!("--{name} must be a number, got `{text}`")),
                None => Ok(default),
            }
        }
        let dsn = get("dsn")
            .or_else(|| std::env::var("STREAMGRES_PG_DSN").ok())
            .or_else(|| std::env::var("XYNE_SYNC_PG_DSN").ok())
            .ok_or("--dsn (or STREAMGRES_PG_DSN) must name the database")?;
        let database = dsn
            .rsplit('/')
            .next()
            .map(|last| last.split('?').next().unwrap_or(last))
            .unwrap_or("");
        if !database.contains("bench") {
            return Err(format!(
                "the database must have `bench` in its name (its tables are dropped and made again); `{database}` has not"
            ));
        }
        let connections = num(get("connections"), "connections", 200usize)?;
        let users = num(get("users"), "users", 100usize)?.clamp(1, connections.max(1));
        Ok(Options {
            dsn,
            connections,
            users,
            channels: num(get("channels"), "channels", 20usize)?.max(1),
            boards: num(get("boards"), "boards", 10usize)?.max(1),
            threads: num(get("threads"), "threads", 3usize)?.min(THREAD_POOL),
            tps: num(get("tps"), "tps", 50.0f64)?.max(0.0),
            rows_per_tx: num(get("rows-per-tx"), "rows-per-tx", 5usize)?.max(1),
            writers: num(get("writers"), "writers", 4usize)?.max(1),
            pushers: num(get("pushers"), "pushers", 8usize)?.min(connections),
            push_rate: num(get("push-rate"), "push-rate", 10.0f64)?.max(0.0),
            churn: num(get("churn"), "churn", 1.0f64)?.max(0.0),
            warmup: num(get("warmup"), "warmup", 5u64)?,
            duration: num(get("duration"), "duration", 60u64)?.max(1),
            md_kb: num(get("md-kb"), "md-kb", 3.0f64)?.max(0.1),
            seed_users: num(get("seed-users"), "seed-users", 1000usize)?.max(users),
            seed_conversations: num(get("seed-conversations"), "seed-conversations", 100usize)?
                .max(THREAD_POOL),
            seed_tickets: num(get("seed-tickets"), "seed-tickets", 10_000usize)?,
            backend_ms: num(get("backend-ms"), "backend-ms", 0u64)?,
            server_bin: get("server-bin").unwrap_or_else(|| "target/release/server".to_owned()),
            port: num(get("port"), "port", 4858u16)?,
            group_threads: num(get("group-threads"), "group-threads", 1usize)?.max(1),
            read_threads: num(get("read-threads"), "read-threads", 2usize)?.max(1),
            read_connections: num(get("read-connections"), "read-connections", 16usize)?.max(1),
            prewarm: num(get("prewarm"), "prewarm", 0usize)?,
            sample_ms: num(get("sample-ms"), "sample-ms", 1000u64)?.max(10),
            server_log: get("server-log").unwrap_or_else(|| "target/load-server.log".to_owned()),
            log_level: get("log-level").unwrap_or_else(|| "warn".to_owned()),
            gateway: get("gateway"),
            pid: match get("pid") {
                Some(text) => Some(
                    text.parse::<u32>()
                        .map_err(|_| format!("--pid must be a number, got `{text}`"))?,
                ),
                None => None,
            },
            prepare_only: flags.contains("prepare-only"),
            out: get("out"),
            label: get("label").unwrap_or_default(),
            seed: num(get("seed"), "seed", 7u64)?,
        })
    }
}

/// The usage text.
fn usage() -> &'static str {
    "usage: load [--dsn DSN] [--connections N] [--users N] [--channels N] [--boards N] [--threads N]
            [--tps N] [--rows-per-tx N] [--writers N] [--pushers N] [--push-rate N] [--churn N]
            [--warmup S] [--duration S] [--md-kb N] [--seed-users N] [--seed-conversations N]
            [--seed-tickets N] [--backend-ms N] [--server-bin PATH] [--port N] [--group-threads N]
            [--read-threads N] [--read-connections N] [--prewarm N] [--sample-ms N] [--server-log PATH] [--log-level LEVEL] [--gateway URL --pid N]
            [--prepare-only] [--out FILE] [--label TEXT] [--seed N]
See the module documentation at the top of src/bin/load.rs."
}

// ---------------------------------------------------------------------------
// Clock, PRNG, text

/// The instant everything is measured from.
fn epoch() -> Instant {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    *EPOCH.get_or_init(Instant::now)
}

/// Nanoseconds since [`epoch`], now or at `at`; never zero, so zero can
/// mean "not yet".
fn nanos_at(at: Instant) -> u64 {
    (at.saturating_duration_since(epoch()).as_nanos() as u64).max(1)
}

/// Milliseconds since the Unix epoch, now.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Xorshift64: deterministic, dependency-free.
struct XorShift64(u64);

impl XorShift64 {
    fn new(seed: u64) -> Self {
        XorShift64(seed.max(1))
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n.max(1)
    }

    fn index(&mut self, len: usize) -> usize {
        self.below(len as u64) as usize
    }

    /// Uniform in `[0, 1)`.
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.index(items.len())]
    }

    /// One of `items`.
    fn word(&mut self, items: &[&'static str]) -> &'static str {
        items[self.index(items.len())]
    }
}

const WORDS: [&str; 48] = [
    "deploy", "latency", "queue", "release", "customer", "invoice", "retry", "schema", "metric",
    "channel", "thread", "review", "merge", "rollback", "alert", "budget", "quarter", "design",
    "token", "cache", "replica", "snapshot", "window", "cursor", "index", "shard", "socket",
    "payload", "handshake", "timeout", "backlog", "sprint", "ticket", "incident", "runbook",
    "pager", "standup", "roadmap", "feature", "regression", "throughput", "cluster", "quota",
    "webhook", "ledger", "payout", "refund", "merchant",
];

/// `n` words of filler.
fn words(rng: &mut XorShift64, n: usize) -> String {
    let mut out = String::with_capacity(n * 8);
    for i in 0..n {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(rng.word(&WORDS));
    }
    out
}

/// A markdown body of about `bytes` bytes (uniform between half and one and
/// a half of it): headings, paragraphs, lists, emphasis.
fn markdown(rng: &mut XorShift64, bytes: usize) -> String {
    let target = (bytes as f64 * (0.5 + rng.unit())) as usize;
    let mut out = String::with_capacity(target + 128);
    let _ = writeln!(out, "# {}\n", words(rng, 4));
    while out.len() < target {
        match rng.below(5) {
            0 => {
                let _ = writeln!(out, "## {}\n", words(rng, 3));
            }
            1 => {
                for _ in 0..rng.below(5) + 2 {
                    let _ = writeln!(out, "- {}", words(rng, 6));
                }
                out.push('\n');
            }
            2 => {
                let _ = writeln!(out, "**{}** {}\n", words(rng, 2), words(rng, 25));
            }
            _ => {
                let _ = writeln!(out, "{}.\n", words(rng, 40));
            }
        }
    }
    out
}

/// A jsonb document of about `bytes` bytes, the kind an upload's metadata is.
fn meta_json(rng: &mut XorShift64, bytes: usize) -> String {
    let mut pages = Vec::new();
    let mut size = 0;
    while size < bytes {
        let page = json!({
            "page": pages.len() + 1,
            "width": 1200 + rng.below(800),
            "height": 1600 + rng.below(800),
            "text": words(rng, 20),
            "ocrConfidence": rng.unit(),
        });
        size += page.to_string().len();
        pages.push(page);
    }
    json!({"pages": pages, "producer": "load-bench", "version": 1}).to_string()
}

/// `text` as a SQL string literal.
fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

// ---------------------------------------------------------------------------
// The workspace: ids and the seed

/// The ids the seed lays out; everything the writers and clients name.
#[derive(Debug, Clone)]
struct World {
    users: Vec<String>,
    channels: Vec<String>,
    boards: Vec<String>,
    /// Per channel, the conversations clients open and writers reply into.
    threads: Vec<Vec<String>>,
    /// Per board, the fifty newest tickets: the ones in the board's window.
    hot_tickets: Vec<Vec<String>>,
}

fn user_id(n: usize) -> String {
    format!("u-{n}")
}

fn channel_id(n: usize) -> String {
    format!("ch-{n}")
}

fn board_id(n: usize) -> String {
    format!("b-{n}")
}

fn conversation_id(channel: usize, n: usize) -> String {
    format!("c-{channel}-{n}")
}

fn message_id(channel: usize, conversation: usize, k: usize) -> String {
    format!("m-{channel}-{conversation}-{k}")
}

/// Drop and make the tables, the publication and the trigger stack, then
/// load the seed rows.
async fn prepare(opts: &Options) -> Result<World, String> {
    let (client, connection) = tokio_postgres::connect(&opts.dsn, tokio_postgres::NoTls)
        .await
        .map_err(|error| format!("connecting to {}: {error}", opts.dsn))?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    // Slots left by a server that was killed hold the WAL; none of ours is live now.
    let _ = client
        .batch_execute(
            "SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots \
             WHERE slot_name LIKE 'xyne_sync_%' AND NOT active AND database = current_database()",
        )
        .await;
    let ddl = format!(
        r#"
DROP TABLE IF EXISTS activities, attachments, messages, conversations, channel_members, channels, tickets, presence, users CASCADE;
DROP SCHEMA IF EXISTS {schema} CASCADE;
DROP PUBLICATION IF EXISTS {publication};
CREATE TABLE users (id text PRIMARY KEY, "workspaceId" text NOT NULL, name text NOT NULL, email text NOT NULL, title text, "avatarUrl" text, role text NOT NULL, "createdAt" int8 NOT NULL, "updatedAt" int8 NOT NULL);
CREATE TABLE presence ("userId" text PRIMARY KEY, "workspaceId" text NOT NULL, status text NOT NULL, "lastSeenAt" int8 NOT NULL, version int8 NOT NULL DEFAULT 0);
CREATE TABLE channels (id text PRIMARY KEY, "workspaceId" text NOT NULL, name text NOT NULL, "scopeType" text NOT NULL, "isPrivate" bool NOT NULL, "createdAt" int8 NOT NULL);
CREATE TABLE channel_members (id text PRIMARY KEY, "channelId" text NOT NULL, "userId" text NOT NULL, role text NOT NULL, "createdAt" int8 NOT NULL);
CREATE INDEX channel_members_user ON channel_members ("userId");
CREATE INDEX channel_members_channel ON channel_members ("channelId");
CREATE TABLE conversations ("conversationId" text PRIMARY KEY, "workspaceId" text NOT NULL, "channelId" text NOT NULL, "createdBy" text NOT NULL, title text NOT NULL, md text NOT NULL, "replyCount" int8 NOT NULL, "lastActivityAt" int8 NOT NULL, "createdAt" int8 NOT NULL, "updatedAt" int8 NOT NULL);
CREATE INDEX conversations_channel ON conversations ("channelId", "createdAt" DESC);
CREATE TABLE messages ("messageId" text PRIMARY KEY, "conversationId" text NOT NULL, "senderId" text NOT NULL, "workspaceId" text NOT NULL, content text NOT NULL, "msgType" text NOT NULL, "hasAttachment" bool NOT NULL, edited bool NOT NULL, "isDeleted" bool NOT NULL, "createdAt" int8 NOT NULL, metadata jsonb);
CREATE INDEX messages_conversation ON messages ("conversationId", "createdAt");
CREATE TABLE attachments (id text PRIMARY KEY, "messageId" text NOT NULL, "conversationId" text NOT NULL, name text NOT NULL, "mimeType" text NOT NULL, "sizeBytes" int8 NOT NULL, meta jsonb, "createdAt" int8 NOT NULL);
CREATE INDEX attachments_message ON attachments ("messageId");
CREATE TABLE tickets (id text PRIMARY KEY, "workspaceId" text NOT NULL, "boardId" text NOT NULL, title text NOT NULL, description text NOT NULL, status text NOT NULL, priority text NOT NULL, "assigneeId" text, "reporterId" text NOT NULL, labels jsonb, "dueAt" int8, "createdAt" int8 NOT NULL, "updatedAt" int8 NOT NULL, "deletedAt" int8, version int8 NOT NULL DEFAULT 0);
CREATE INDEX tickets_board ON tickets ("boardId", "createdAt" DESC);
CREATE INDEX tickets_assignee ON tickets ("assigneeId", "updatedAt" DESC);
CREATE TABLE activities (id text PRIMARY KEY, "workspaceId" text NOT NULL, "userId" text NOT NULL, kind text NOT NULL, "refId" text NOT NULL, "readAt" int8, "createdAt" int8 NOT NULL);
CREATE INDEX activities_user ON activities ("userId", "createdAt" DESC);
CREATE SCHEMA {schema};
CREATE TABLE {schema}.clients ("clientGroupID" text NOT NULL, "clientID" text NOT NULL, "lastMutationID" int8 NOT NULL, "userID" text, PRIMARY KEY ("clientGroupID", "clientID"));
CREATE TABLE {schema}.mutations ("clientGroupID" text NOT NULL, "clientID" text NOT NULL, "mutationID" int8 NOT NULL, result json NOT NULL, PRIMARY KEY ("clientGroupID", "clientID", "mutationID"));
CREATE PUBLICATION {publication} FOR ALL TABLES;
"#,
        schema = APP_SCHEMA,
        publication = PUBLICATION
    );
    client
        .batch_execute(&ddl)
        .await
        .map_err(|error| format!("creating the tables: {error}"))?;
    client
        .batch_execute(&trigger_stack_sql(APP_ID, SHARD, &[PUBLICATION]))
        .await
        .map_err(|error| format!("installing the schema-change triggers: {error}"))?;

    let mut rng = XorShift64::new(opts.seed ^ 0x5EED);
    let now = now_ms();
    let day = 86_400_000i64;
    let roles = ["MEMBER", "MEMBER", "MEMBER", "ADMIN"];
    let statuses = ["ONLINE", "AWAY", "OFFLINE", "DND"];

    // users and presence
    let users: Vec<String> = (0..opts.seed_users).map(user_id).collect();
    let mut rows = Vec::with_capacity(users.len());
    let mut presence = Vec::with_capacity(users.len());
    for (n, id) in users.iter().enumerate() {
        rows.push(format!(
            "({id}, '{ws}', 'User {n}', 'user{n}@example.test', {title}, 'https://cdn.example.test/a/{n}.png', '{role}', {created}, {created})",
            id = quote(id),
            ws = WORKSPACE,
            title = quote(&words(&mut rng, 2)),
            role = rng.word(&roles),
            created = now - day * 400 + n as i64 * 1000,
        ));
        presence.push(format!(
            "({id}, '{ws}', '{status}', {seen}, 0)",
            id = quote(id),
            ws = WORKSPACE,
            status = rng.word(&statuses),
            seen = now - rng.below(3_600_000) as i64,
        ));
    }
    insert_batches(&client, "users", &rows).await?;
    insert_batches(&client, "presence", &presence).await?;

    // channels and memberships: every load user is a member of their channel
    // and of some others, every other user of a handful
    let channels: Vec<String> = (0..opts.channels).map(channel_id).collect();
    let mut rows = Vec::new();
    for (n, id) in channels.iter().enumerate() {
        rows.push(format!(
            "({id}, '{ws}', 'channel-{n}', 'DEFAULT', false, {created})",
            id = quote(id),
            ws = WORKSPACE,
            created = now - day * 300 + n as i64 * 1000,
        ));
    }
    insert_batches(&client, "channels", &rows).await?;
    let mut rows = Vec::new();
    let mut member_of: HashSet<(usize, usize)> = HashSet::new();
    for (user, user_id) in users.iter().enumerate().take(opts.seed_users) {
        let mut mine: Vec<usize> = Vec::new();
        if user < opts.users {
            // the load users: their own channel and the next few
            for k in 0..8.min(opts.channels) {
                mine.push((user + k) % opts.channels);
            }
        } else {
            for _ in 0..3.min(opts.channels) {
                mine.push(rng.index(opts.channels));
            }
        }
        for channel in mine {
            if member_of.insert((user, channel)) {
                rows.push(format!(
                    "('cm-{user}-{channel}', {ch}, {u}, 'MEMBER', {created})",
                    ch = quote(&channels[channel]),
                    u = quote(user_id),
                    created = now - day * 200 + rng.below(day as u64) as i64,
                ));
            }
        }
    }
    insert_batches(&client, "channel_members", &rows).await?;

    // conversations with their messages: the body is the big value
    let md_bytes = (opts.md_kb * 1024.0) as usize;
    let mut threads = Vec::with_capacity(opts.channels);
    let mut conv_rows = Vec::new();
    let mut msg_rows = Vec::new();
    for (channel, channel_id) in channels.iter().enumerate() {
        let mut pool = Vec::with_capacity(THREAD_POOL);
        for n in 0..opts.seed_conversations {
            let id = conversation_id(channel, n);
            if n + THREAD_POOL >= opts.seed_conversations {
                pool.push(id.clone());
            }
            let created = now - day * 30 + (n as i64) * (day * 30 / opts.seed_conversations as i64);
            let author = rng.index(opts.seed_users);
            conv_rows.push(format!(
                "({id}, '{ws}', {ch}, {by}, {title}, {md}, {replies}, {activity}, {created}, {created})",
                id = quote(&id),
                ws = WORKSPACE,
                ch = quote(channel_id),
                by = quote(&users[author]),
                title = quote(&words(&mut rng, 5)),
                md = quote(&markdown(&mut rng, md_bytes)),
                replies = SEED_REPLIES,
                activity = created + 60_000 * SEED_REPLIES as i64,
            ));
            for k in 0..SEED_REPLIES {
                msg_rows.push(format!(
                    "({id}, {conv}, {by}, '{ws}', {content}, 'USER', false, false, false, {created}, '{{\"client\":\"web\",\"v\":1}}')",
                    id = quote(&message_id(channel, n, k)),
                    conv = quote(&id),
                    by = quote(&users[rng.index(opts.seed_users)]),
                    ws = WORKSPACE,
                    content = quote(&{ let n = 20 + rng.index(60); words(&mut rng, n) }),
                    created = created + 60_000 * (k as i64 + 1),
                ));
            }
        }
        threads.push(pool);
    }
    insert_batches(&client, "conversations", &conv_rows).await?;
    insert_batches(&client, "messages", &msg_rows).await?;

    // tickets over the boards, the load users among the assignees
    let boards: Vec<String> = (0..opts.boards).map(board_id).collect();
    let ticket_status = ["NEW", "OPEN", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"];
    let priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
    let labels = ["bug", "feature", "ops", "billing", "mobile", "web", "api"];
    let mut rows = Vec::with_capacity(opts.seed_tickets);
    let mut hot_tickets: Vec<Vec<String>> = vec![Vec::new(); opts.boards];
    for n in 0..opts.seed_tickets {
        let board = n % opts.boards;
        let id = format!("t-{n}");
        let assignee = if rng.below(2) == 0 {
            Some(users[rng.index(opts.users)].clone())
        } else {
            Some(users[rng.index(opts.seed_users)].clone())
        };
        let created = now - day * 90 + (n as i64) * (day * 90 / opts.seed_tickets.max(1) as i64);
        rows.push(format!(
            "({id}, '{ws}', {board}, {title}, {description}, '{status}', '{priority}', {assignee}, {reporter}, '[\"{l1}\",\"{l2}\"]', {due}, {created}, {created}, NULL, 0)",
            id = quote(&id),
            ws = WORKSPACE,
            board = quote(&boards[board]),
            title = quote(&words(&mut rng, 6)),
            description = quote(&words(&mut rng, 60)),
            status = rng.word(&ticket_status),
            priority = rng.word(&priorities),
            assignee = assignee.map_or("NULL".to_owned(), |a| quote(&a)),
            reporter = quote(&users[rng.index(opts.seed_users)]),
            l1 = rng.word(&labels),
            l2 = rng.word(&labels),
            due = created + day * 14,
        ));
        hot_tickets[board].push(id);
    }
    for hot in &mut hot_tickets {
        let keep = hot.len().saturating_sub(50);
        hot.drain(..keep);
    }
    insert_batches(&client, "tickets", &rows).await?;

    // activities: a few unread per load user
    let kinds = ["mention", "reply", "assigned", "reaction"];
    let mut rows = Vec::new();
    for (user, user_id) in users.iter().enumerate().take(opts.users) {
        for k in 0..3 {
            rows.push(format!(
                "('a-{user}-{k}', '{ws}', {u}, '{kind}', {ref_}, {read}, {created})",
                ws = WORKSPACE,
                u = quote(user_id),
                kind = rng.word(&kinds),
                ref_ = quote(&conversation_id(user % opts.channels, rng.index(opts.seed_conversations))),
                read = if k == 0 { "NULL".to_owned() } else { (now - 3_600_000).to_string() },
                created = now - 7_200_000 + k as i64 * 600_000,
            ));
        }
    }
    insert_batches(&client, "activities", &rows).await?;
    client
        .batch_execute("ANALYZE")
        .await
        .map_err(|error| format!("analyze: {error}"))?;
    Ok(World {
        users: users[..opts.users].to_vec(),
        channels,
        boards,
        threads,
        hot_tickets,
    })
}

/// `INSERT INTO table VALUES ...` in batches of a few hundred rows.
async fn insert_batches(
    client: &tokio_postgres::Client,
    table: &str,
    rows: &[String],
) -> Result<(), String> {
    for chunk in rows.chunks(400) {
        let sql = format!("INSERT INTO {table} VALUES {}", chunk.join(", "));
        client
            .batch_execute(&sql)
            .await
            .map_err(|error| format!("seeding {table}: {error}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commit stamps and the kinds of rows

/// The kinds of rows the writers produce, reported apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Kind {
    Conversation = 0,
    Message = 1,
    Attachment = 2,
    Ticket = 3,
    Presence = 4,
    Activity = 5,
}

const KINDS: [Kind; 6] = [
    Kind::Conversation,
    Kind::Message,
    Kind::Attachment,
    Kind::Ticket,
    Kind::Presence,
    Kind::Activity,
];

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Conversation => "conversation (big md)",
            Kind::Message => "message (medium)",
            Kind::Attachment => "attachment (big jsonb)",
            Kind::Ticket => "ticket update (light)",
            Kind::Presence => "presence update (tiny)",
            Kind::Activity => "activity (light)",
        }
    }
}

/// When each stamped write was committed: nanoseconds since [`epoch`] by
/// write sequence number, written by the writer just before its `COMMIT`
/// and read by every client that receives the row.
struct Stamps {
    at: Vec<AtomicU64>,
    next: AtomicU64,
    /// Writes past the capacity: not measured, counted.
    overflow: AtomicU64,
}

impl Stamps {
    fn new(capacity: usize) -> Self {
        Stamps {
            at: (0..capacity).map(|_| AtomicU64::new(0)).collect(),
            next: AtomicU64::new(1),
            overflow: AtomicU64::new(0),
        }
    }

    /// The next sequence number.
    fn next(&self) -> u64 {
        self.next.fetch_add(1, Ordering::Relaxed)
    }

    /// Note that `seq` is being committed now.
    fn stamp(&self, seq: u64) {
        match self.at.get(seq as usize) {
            Some(slot) => slot.store(nanos_at(Instant::now()), Ordering::Release),
            None => {
                self.overflow.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// When `seq` was committed, if known.
    fn get(&self, seq: u64) -> Option<u64> {
        self.at
            .get(seq as usize)
            .map(|slot| slot.load(Ordering::Acquire))
            .filter(|&at| at > 0)
    }
}

/// The sequence number a live row carries: in its id (`lv<seq>`) for an
/// inserted row, in its `version` for a row updated in place.
fn seq_of(table: &str, value: &Json) -> Option<(Kind, u64)> {
    let from_id = |column: &str| -> Option<u64> {
        value
            .get(column)?
            .as_str()?
            .strip_prefix("lv")?
            .parse()
            .ok()
    };
    let from_version = || -> Option<u64> {
        let version = value.get("version")?.as_i64()?;
        (version > 0).then_some(version as u64)
    };
    match table {
        "conversations" => Some((Kind::Conversation, from_id("conversationId")?)),
        "messages" => Some((Kind::Message, from_id("messageId")?)),
        "attachments" => Some((Kind::Attachment, from_id("id")?)),
        "tickets" => Some((Kind::Ticket, from_version()?)),
        "presence" => Some((Kind::Presence, from_version()?)),
        "activities" => Some((Kind::Activity, from_id("id")?)),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Who listens to what

/// How many open clients hold each query's rows, so a writer knows how
/// many deliveries its write owes.
#[derive(Default)]
struct Topology {
    channel: Vec<usize>,
    board: Vec<usize>,
    user: Vec<usize>,
    thread: HashMap<String, usize>,
    all: usize,
}

impl Topology {
    fn new(world: &World) -> Self {
        Topology {
            channel: vec![0; world.channels.len()],
            board: vec![0; world.boards.len()],
            user: vec![0; world.users.len()],
            thread: HashMap::new(),
            all: 0,
        }
    }

    fn add(&mut self, profile: &Profile, delta: isize) {
        let bump = |slot: &mut usize| *slot = (*slot as isize + delta).max(0) as usize;
        bump(&mut self.channel[profile.channel]);
        bump(&mut self.board[profile.board]);
        bump(&mut self.user[profile.user]);
        bump(&mut self.all);
        for thread in &profile.threads {
            let slot = self.thread.entry(thread.clone()).or_insert(0);
            bump(slot);
        }
    }
}

/// Which user, channel, board and threads a client is: what it subscribes to.
#[derive(Debug, Clone)]
struct Profile {
    user: usize,
    channel: usize,
    board: usize,
    threads: Vec<String>,
}

impl Profile {
    /// The profile of the `slot`-th client.
    fn of(slot: usize, opts: &Options, world: &World) -> Profile {
        let channel = slot % opts.channels;
        let pool = &world.threads[channel];
        let threads = (0..opts.threads)
            .map(|k| pool[((slot / opts.channels) * opts.threads + k) % pool.len()].clone())
            .collect();
        Profile {
            user: slot % opts.users,
            channel,
            board: slot % opts.boards,
            threads,
        }
    }

    /// The desired-queries patch of this profile.
    fn patch(&self, world: &World) -> Vec<Json> {
        let put = |hash: &str, name: &str, args: Json| {
            json!({"op": "put", "hash": hash, "name": name, "args": [args], "ttl": 300000})
        };
        let mut patch = vec![
            put("q-channels", "myChannels", json!({})),
            put(
                "q-conv",
                "channelConversations",
                json!({"channelId": world.channels[self.channel]}),
            ),
            put("q-users", "workspaceUsers", json!({})),
            put("q-presence", "presence", json!({})),
            put("q-mine", "myTickets", json!({})),
            put("q-board", "boardTickets", json!({"boardId": world.boards[self.board]})),
            put("q-unread", "unreadActivities", json!({})),
        ];
        for thread in &self.threads {
            patch.push(put(
                &format!("q-thread-{thread}"),
                "threadMessages",
                json!({"conversationId": thread}),
            ));
        }
        patch
    }
}

// ---------------------------------------------------------------------------
// The application server

/// One comparison in Zero's AST.
fn cond(column: &str, op: &str, value: Json) -> Json {
    json!({"type": "simple", "op": op, "left": {"type": "column", "name": column}, "right": {"type": "literal", "value": value}})
}

/// The AST of query `name` with `args` for `user`, or why there is none.
fn ast_for(name: &str, args: &Json, user: &str) -> Result<Json, String> {
    let arg = |key: &str| -> Result<Json, String> {
        args.get(key)
            .cloned()
            .ok_or_else(|| format!("{name} needs {key}"))
    };
    Ok(match name {
        "myChannels" => json!({
            "table": "channels",
            "where": {"type": "correlatedSubquery", "op": "EXISTS", "related": {
                "correlation": {"parentField": ["id"], "childField": ["channelId"]},
                "subquery": {"table": "channel_members", "where": cond("userId", "=", json!(user))}
            }},
            "orderBy": [["name", "asc"]]
        }),
        "channelConversations" => json!({
            "table": "conversations",
            "where": cond("channelId", "=", arg("channelId")?),
            "orderBy": [["createdAt", "desc"], ["conversationId", "asc"]],
            "limit": 50
        }),
        "threadMessages" => json!({
            "table": "messages",
            "where": {"type": "and", "conditions": [
                cond("conversationId", "=", arg("conversationId")?),
                cond("isDeleted", "=", json!(false)),
            ]},
            "related": [{
                "correlation": {"parentField": ["messageId"], "childField": ["messageId"]},
                "subquery": {"table": "attachments", "orderBy": [["id", "asc"]]}
            }],
            "orderBy": [["createdAt", "asc"]]
        }),
        "workspaceUsers" => json!({
            "table": "users",
            "where": cond("workspaceId", "=", json!(WORKSPACE)),
            "orderBy": [["name", "asc"]]
        }),
        "presence" => json!({
            "table": "presence",
            "where": cond("workspaceId", "=", json!(WORKSPACE))
        }),
        "myTickets" => json!({
            "table": "tickets",
            "where": {"type": "and", "conditions": [
                cond("assigneeId", "=", json!(user)),
                cond("deletedAt", "IS", Json::Null),
            ]},
            "orderBy": [["updatedAt", "desc"], ["id", "asc"]],
            "limit": 50
        }),
        "boardTickets" => json!({
            "table": "tickets",
            "where": {"type": "and", "conditions": [
                cond("boardId", "=", arg("boardId")?),
                cond("deletedAt", "IS", Json::Null),
            ]},
            "orderBy": [["createdAt", "desc"], ["id", "asc"]],
            "limit": 50
        }),
        "unreadActivities" => json!({
            "table": "activities",
            "where": {"type": "and", "conditions": [
                cond("userId", "=", json!(user)),
                cond("readAt", "IS", Json::Null),
            ]},
            "orderBy": [["createdAt", "desc"], ["id", "asc"]],
            "limit": 100
        }),
        other => return Err(format!("unknown query `{other}`")),
    })
}

/// A few PostgreSQL connections the mutate endpoint takes turns on.
struct PgPool {
    tx: tokio::sync::mpsc::Sender<tokio_postgres::Client>,
    rx: tokio::sync::Mutex<tokio::sync::mpsc::Receiver<tokio_postgres::Client>>,
}

impl PgPool {
    async fn connect(dsn: &str, size: usize) -> Result<PgPool, String> {
        let (tx, rx) = tokio::sync::mpsc::channel(size.max(1));
        for _ in 0..size.max(1) {
            let client = pg_connect(dsn).await?;
            let _ = tx.send(client).await;
        }
        Ok(PgPool {
            tx,
            rx: tokio::sync::Mutex::new(rx),
        })
    }

    async fn take(&self) -> tokio_postgres::Client {
        let mut rx = self.rx.lock().await;
        rx.recv().await.expect("the pool is never closed")
    }

    async fn give(&self, client: tokio_postgres::Client) {
        let _ = self.tx.send(client).await;
    }
}

/// One connection to the database, its driver spawned.
async fn pg_connect(dsn: &str) -> Result<tokio_postgres::Client, String> {
    let (client, connection) = tokio_postgres::connect(dsn, tokio_postgres::NoTls)
        .await
        .map_err(|error| format!("connecting to PostgreSQL: {error}"))?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    Ok(client)
}

/// What the application server holds.
struct App {
    pool: PgPool,
    stamps: Arc<Stamps>,
    think: Duration,
    transforms: AtomicU64,
    pushes: AtomicU64,
    cleanups: AtomicU64,
    failures: Mutex<Vec<String>>,
}

/// The user a request is for: the bearer token the handshake carried.
fn user_of(headers: &HeaderMap) -> String {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("anonymous")
        .to_owned()
}

/// `POST /query`: `["transform", [{id, name, args}]]` to `["transformed", [{id, name, ast}]]`.
async fn transform(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> AxumJson<Json> {
    app.transforms.fetch_add(1, Ordering::Relaxed);
    if !app.think.is_zero() {
        tokio::time::sleep(app.think).await;
    }
    let user = user_of(&headers);
    let request: Json = serde_json::from_slice(&body).unwrap_or(Json::Null);
    let requests = request
        .get(1)
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::with_capacity(requests.len());
    for query in requests {
        let id = query.get("id").cloned().unwrap_or(Json::Null);
        let name = query.get("name").and_then(Json::as_str).unwrap_or("");
        let args = query
            .get("args")
            .and_then(Json::as_array)
            .and_then(|args| args.first())
            .cloned()
            .unwrap_or(json!({}));
        match ast_for(name, &args, &user) {
            Ok(ast) => out.push(json!({"id": id, "name": name, "ast": ast})),
            Err(message) => {
                out.push(json!({"error": "app", "id": id, "name": name, "message": message}))
            }
        }
    }
    AxumJson(json!(["transformed", out]))
}

/// `POST /push`: run the mutations, record the ids, answer a `MutateResponse`.
async fn push(State(app): State<Arc<App>>, body: axum::body::Bytes) -> AxumJson<Json> {
    app.pushes.fetch_add(1, Ordering::Relaxed);
    if !app.think.is_zero() {
        tokio::time::sleep(app.think).await;
    }
    let push: Json = serde_json::from_slice(&body).unwrap_or(Json::Null);
    let group = push
        .get("clientGroupID")
        .and_then(Json::as_str)
        .unwrap_or("")
        .to_owned();
    let mutations = push
        .get("mutations")
        .and_then(Json::as_array)
        .cloned()
        .unwrap_or_default();
    let mut results = Vec::with_capacity(mutations.len());
    let mut client = app.pool.take().await;
    for mutation in &mutations {
        let client_id = mutation
            .get("clientID")
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_owned();
        let id = mutation.get("id").and_then(Json::as_i64).unwrap_or(0);
        let name = mutation.get("name").and_then(Json::as_str).unwrap_or("");
        let args = mutation
            .get("args")
            .and_then(Json::as_array)
            .and_then(|args| args.first())
            .cloned()
            .unwrap_or(json!({}));
        let outcome = apply_mutation(&app, &mut client, &group, &client_id, id, name, &args).await;
        let result = match outcome {
            Ok(()) => json!({}),
            Err(message) => {
                app.failures.lock().unwrap().push(message.clone());
                json!({"error": "app", "message": message})
            }
        };
        results.push(json!({"id": {"clientID": client_id, "id": id}, "result": result}));
    }
    app.pool.give(client).await;
    AxumJson(json!({"kind": "MutateResponse", "mutations": results}))
}

/// One mutation against the database, in its own transaction with the
/// bookkeeping zero's server library does: the client's last mutation id
/// and the result row.
async fn apply_mutation(
    app: &App,
    client: &mut tokio_postgres::Client,
    group: &str,
    client_id: &str,
    id: i64,
    name: &str,
    args: &Json,
) -> Result<(), String> {
    let text = |key: &str| -> Result<String, String> {
        args.get(key)
            .and_then(Json::as_str)
            .map(str::to_owned)
            .ok_or_else(|| format!("{name} needs {key}"))
    };
    let tx = client
        .transaction()
        .await
        .map_err(|error| format!("begin: {error}"))?;
    let seq: Option<u64> = match name {
        CLEANUP_RESULTS => {
            app.cleanups.fetch_add(1, Ordering::Relaxed);
            let kind = args.get("type").and_then(Json::as_str).unwrap_or("");
            if kind == "single" {
                let upto = args.get("upToMutationID").and_then(Json::as_i64).unwrap_or(0);
                let who = text("clientID")?;
                tx.execute(
                    &format!(
                        "DELETE FROM {APP_SCHEMA}.mutations WHERE \"clientGroupID\" = $1 AND \"clientID\" = $2 AND \"mutationID\" <= $3"
                    ),
                    &[&group, &who, &upto],
                )
                .await
                .map_err(|error| format!("cleanup: {error}"))?;
            } else {
                let clients: Vec<String> = args
                    .get("clientIDs")
                    .and_then(Json::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(Json::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
                tx.execute(
                    &format!(
                        "DELETE FROM {APP_SCHEMA}.mutations WHERE \"clientGroupID\" = $1 AND \"clientID\" = ANY($2)"
                    ),
                    &[&group, &clients],
                )
                .await
                .map_err(|error| format!("cleanup: {error}"))?;
            }
            return tx.commit().await.map_err(|error| format!("commit: {error}"));
        }
        "messages.send" => {
            let conversation = text("conversationId")?;
            let message = text("messageId")?;
            let content = text("content")?;
            let sender = text("senderId")?;
            let now = now_ms();
            tx.execute(
                "INSERT INTO messages (\"messageId\", \"conversationId\", \"senderId\", \"workspaceId\", content, \"msgType\", \"hasAttachment\", edited, \"isDeleted\", \"createdAt\", metadata) \
                 VALUES ($1, $2, $3, $4, $5, 'USER', false, false, false, $6, '{\"client\":\"web\",\"v\":1}'::jsonb)",
                &[&message, &conversation, &sender, &WORKSPACE, &content, &now],
            )
            .await
            .map_err(|error| format!("insert message: {error}"))?;
            tx.execute(
                "UPDATE conversations SET \"replyCount\" = \"replyCount\" + 1, \"lastActivityAt\" = $2, \"updatedAt\" = $2 WHERE \"conversationId\" = $1",
                &[&conversation, &now],
            )
            .await
            .map_err(|error| format!("bump conversation: {error}"))?;
            args.get("seq").and_then(Json::as_u64)
        }
        other => return Err(format!("unknown mutation `{other}`")),
    };
    tx.execute(
        &format!(
            "INSERT INTO {APP_SCHEMA}.clients (\"clientGroupID\", \"clientID\", \"lastMutationID\", \"userID\") VALUES ($1, $2, $3, NULL) \
             ON CONFLICT (\"clientGroupID\", \"clientID\") DO UPDATE SET \"lastMutationID\" = EXCLUDED.\"lastMutationID\""
        ),
        &[&group, &client_id, &id],
    )
    .await
    .map_err(|error| format!("record lmid: {error}"))?;
    tx.execute(
        &format!(
            "INSERT INTO {APP_SCHEMA}.mutations (\"clientGroupID\", \"clientID\", \"mutationID\", result) VALUES ($1, $2, $3, '{{}}'::json) ON CONFLICT DO NOTHING"
        ),
        &[&group, &client_id, &id],
    )
    .await
    .map_err(|error| format!("record result: {error}"))?;
    if let Some(seq) = seq {
        app.stamps.stamp(seq);
    }
    tx.commit().await.map_err(|error| format!("commit: {error}"))
}

/// Serve the application server on a free port; the port.
async fn start_app(app: Arc<App>) -> Result<u16, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("binding the application server: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let router = Router::new()
        .route("/query", post(transform))
        .route("/push", post(push))
        .with_state(app);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok(port)
}

// ---------------------------------------------------------------------------
// The server process

/// The server under test: a child of ours, or one already running.
struct Server {
    child: Option<Child>,
    pid: Option<u32>,
    gateway: String,
    http: String,
}

impl Server {
    /// Start the binary against the database and the application server on
    /// `app_port`, and wait until it is ready.
    async fn start(opts: &Options, app_port: u16) -> Result<Server, String> {
        if let Some(gateway) = &opts.gateway {
            let http = gateway
                .replacen("ws://", "http://", 1)
                .replacen("wss://", "https://", 1);
            let http = http
                .rfind('/')
                .filter(|&at| at > "http://".len())
                .map(|at| http[..at].to_owned())
                .unwrap_or(http);
            return Ok(Server {
                child: None,
                pid: opts.pid,
                gateway: gateway.clone(),
                http,
            });
        }
        if !std::path::Path::new(&opts.server_bin).exists() {
            return Err(format!(
                "{} does not exist: run `cargo build --release --bin server` first, or pass --server-bin",
                opts.server_bin
            ));
        }
        // The port must be ours: a server left over from an earlier run
        // would answer the readiness probe in this one's place.
        let addr = format!("127.0.0.1:{}", opts.port);
        match std::net::TcpListener::bind(&addr) {
            Ok(listener) => drop(listener),
            Err(error) => {
                return Err(format!(
                    "{addr} is taken ({error}); a server from an earlier run may still be up (`pgrep -fl target/release/server`), or pass --port"
                ));
            }
        }
        if let Some(parent) = std::path::Path::new(&opts.server_log).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let log = std::fs::File::create(&opts.server_log)
            .map_err(|error| format!("creating {}: {error}", opts.server_log))?;
        let log_err = log.try_clone().map_err(|error| error.to_string())?;
        let child = Command::new(&opts.server_bin)
            .env_clear()
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .env("HOME", std::env::var("HOME").unwrap_or_default())
            .env("STREAMGRES_ADDR", &addr)
            .env("STREAMGRES_BASE_PATH", "/sync")
            .env("STREAMGRES_PG_DSN", &opts.dsn)
            .env("STREAMGRES_PUBLICATION", PUBLICATION)
            .env("STREAMGRES_QUERY_URL", format!("http://127.0.0.1:{app_port}/query"))
            .env("STREAMGRES_MUTATE_URL", format!("http://127.0.0.1:{app_port}/push"))
            .env("STREAMGRES_APP_ID", APP_ID)
            .env("STREAMGRES_SHARD", SHARD.to_string())
            .env("STREAMGRES_SLOT_CLEANUP_AGE_MS", "0")
            .env("STREAMGRES_WARM_START_MS", "0")
            .env("STREAMGRES_METRICS_INTERVAL_MS", "1000")
            .env("STREAMGRES_GROUP_THREADS", opts.group_threads.to_string())
            .env("STREAMGRES_READ_THREADS", opts.read_threads.to_string())
            .env("STREAMGRES_READ_CONNECTIONS", opts.read_connections.to_string())
            .env("STREAMGRES_GROUP_TTL_MS", "2000")
            .env("STREAMGRES_LOG", &opts.log_level)
            .env("STREAMGRES_LOG_FORMAT", "text")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .spawn()
            .map_err(|error| format!("starting {}: {error}", opts.server_bin))?;
        let pid = child.id();
        let server = Server {
            child: Some(child),
            pid: Some(pid),
            gateway: format!("ws://{addr}/sync"),
            http: format!("http://{addr}"),
        };
        let deadline = Instant::now() + Duration::from_secs(90);
        let http = reqwest::Client::new();
        loop {
            if let Ok(response) = http.get(format!("{}/health", server.http)).send().await
                && response.status().is_success()
            {
                return Ok(server);
            }
            if let Some(child) = &server.child
                && let Ok(Some(status)) = child_status(child)
            {
                return Err(format!(
                    "the server exited during startup ({status}); see {}",
                    opts.server_log
                ));
            }
            if Instant::now() > deadline {
                return Err(format!(
                    "the server did not become ready within 90 s; see {}",
                    opts.server_log
                ));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Ask the child to stop (SIGTERM, which drops its replication slot),
    /// wait for it, kill it if it will not.
    fn stop(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };
        // SAFETY: a plain signal to a process we started.
        unsafe {
            libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
            }
        }
    }
}

/// Whether `child` has exited, without waiting.
fn child_status(child: &Child) -> std::io::Result<Option<std::process::ExitStatus>> {
    // SAFETY: waitpid with WNOHANG on our own child.
    let mut status: libc::c_int = 0;
    let pid = unsafe { libc::waitpid(child.id() as libc::pid_t, &mut status, libc::WNOHANG) };
    if pid == 0 {
        return Ok(None);
    }
    if pid < 0 {
        return Err(std::io::Error::last_os_error());
    }
    use std::os::unix::process::ExitStatusExt;
    Ok(Some(std::process::ExitStatus::from_raw(status)))
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------------------------------------------------------------------------
// Process sampling

/// One reading of a process: its CPU time, its resident set, and the CPU
/// time of each of its threads by name.
#[derive(Debug, Clone, Default)]
struct ProcessReading {
    cpu: Duration,
    rss: u64,
    threads: Vec<(String, Duration)>,
}

/// Read `pid` now; `None` when it cannot be read (gone, or another user's).
#[cfg(target_os = "macos")]
fn read_process(pid: u32) -> Option<ProcessReading> {
    use std::ffi::CStr;
    const PROC_PIDLISTTHREADS: libc::c_int = 6;
    // SAFETY: proc_pidinfo fills the buffer it is given up to its size.
    unsafe {
        let mut task: libc::proc_taskinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
        let got = libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTASKINFO,
            0,
            &mut task as *mut _ as *mut libc::c_void,
            size,
        );
        if got != size {
            return None;
        }
        // The task's times are in mach absolute-time ticks (41.67 ns each on
        // Apple silicon); the threads' are in nanoseconds already.
        #[repr(C)]
        struct MachTimebaseInfo {
            numer: u32,
            denom: u32,
        }
        unsafe extern "C" {
            fn mach_timebase_info(info: *mut MachTimebaseInfo) -> libc::c_int;
        }
        let mut timebase = MachTimebaseInfo { numer: 0, denom: 0 };
        mach_timebase_info(&mut timebase);
        let ticks = task.pti_total_user + task.pti_total_system;
        let nanos = if timebase.denom == 0 {
            ticks
        } else {
            (ticks as u128 * timebase.numer as u128 / timebase.denom as u128) as u64
        };
        let cpu = Duration::from_nanos(nanos);
        let rss = task.pti_resident_size;
        let count = task.pti_threadnum.max(1) as usize + 16;
        let mut ids: Vec<u64> = vec![0; count];
        let bytes = libc::proc_pidinfo(
            pid as libc::c_int,
            PROC_PIDLISTTHREADS,
            0,
            ids.as_mut_ptr() as *mut libc::c_void,
            (count * std::mem::size_of::<u64>()) as libc::c_int,
        );
        let listed = if bytes > 0 {
            (bytes as usize / std::mem::size_of::<u64>()).min(count)
        } else {
            0
        };
        let mut threads = Vec::with_capacity(listed);
        for &tid in &ids[..listed] {
            let mut info: libc::proc_threadinfo = std::mem::zeroed();
            let size = std::mem::size_of::<libc::proc_threadinfo>() as libc::c_int;
            let got = libc::proc_pidinfo(
                pid as libc::c_int,
                libc::PROC_PIDTHREADINFO,
                tid,
                &mut info as *mut _ as *mut libc::c_void,
                size,
            );
            if got != size {
                continue;
            }
            let name = CStr::from_ptr(info.pth_name.as_ptr())
                .to_string_lossy()
                .into_owned();
            let name = if name.is_empty() { "main".to_owned() } else { name };
            threads.push((
                thread_group(&name),
                Duration::from_nanos(info.pth_user_time + info.pth_system_time),
            ));
        }
        Some(ProcessReading { cpu, rss, threads })
    }
}

/// Read `pid` now from `/proc`.
#[cfg(target_os = "linux")]
fn read_process(pid: u32) -> Option<ProcessReading> {
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as f64;
    let cpu_of = |stat: &str| -> Option<Duration> {
        let after = &stat[stat.rfind(')')? + 2..];
        let fields: Vec<&str> = after.split_whitespace().collect();
        let utime: f64 = fields.get(11)?.parse().ok()?;
        let stime: f64 = fields.get(12)?.parse().ok()?;
        Some(Duration::from_secs_f64((utime + stime) / ticks))
    };
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let cpu = cpu_of(&stat)?;
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    let rss = status
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))
        .and_then(|rest| rest.split_whitespace().next())
        .and_then(|kb| kb.parse::<u64>().ok())
        .map_or(0, |kb| kb * 1024);
    let mut threads = Vec::new();
    if let Ok(tasks) = std::fs::read_dir(format!("/proc/{pid}/task")) {
        for task in tasks.flatten() {
            let Ok(stat) = std::fs::read_to_string(task.path().join("stat")) else {
                continue;
            };
            let name = stat
                .find('(')
                .zip(stat.rfind(')'))
                .map(|(open, close)| stat[open + 1..close].to_owned())
                .unwrap_or_default();
            if let Some(cpu) = cpu_of(&stat) {
                threads.push((thread_group(&name), cpu));
            }
        }
    }
    Some(ProcessReading { cpu, rss, threads })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn read_process(_pid: u32) -> Option<ProcessReading> {
    None
}

/// The name a thread is reported under: the server's `streamgres-` prefix
/// and a trailing shard or index taken off, the tokio workers as one.
fn thread_group(name: &str) -> String {
    let name = name
        .strip_prefix("streamgres-")
        .or_else(|| name.strip_prefix("xyne-sync-"))
        .unwrap_or(name);
    if name.starts_with("tokio-runtime") || name.starts_with("tokio-rt") {
        return "tokio".to_owned();
    }
    let trimmed = name.trim_end_matches(|c: char| c.is_ascii_digit());
    let trimmed = trimmed.strip_suffix('-').unwrap_or(trimmed);
    if trimmed.is_empty() {
        name.to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// One second's worth: what the server and this process used of the CPU
/// and held of memory.
#[derive(Debug, Clone)]
struct Sample {
    at: Instant,
    server_cores: f64,
    server_rss: u64,
    thread_cores: Vec<(String, f64)>,
    self_cores: f64,
}

/// The sampler's accumulator: readings turned into per-second rates.
struct Sampler {
    samples: Mutex<Vec<Sample>>,
    stop: AtomicBool,
}

impl Sampler {
    fn new() -> Arc<Self> {
        Arc::new(Sampler {
            samples: Mutex::new(Vec::new()),
            stop: AtomicBool::new(false),
        })
    }

    /// Sample `server_pid` (when known) and ourselves every second on a
    /// thread of our own, so the runtime's load never delays a reading.
    fn run(self: &Arc<Self>, server_pid: Option<u32>, every: Duration) {
        let sampler = self.clone();
        let self_pid = std::process::id();
        std::thread::Builder::new()
            .name("load-sampler".to_owned())
            .spawn(move || {
                let mut last_at = Instant::now();
                let mut last_server = server_pid.and_then(read_process);
                let mut last_self = read_process(self_pid);
                while !sampler.stop.load(Ordering::Relaxed) {
                    std::thread::sleep(every);
                    let at = Instant::now();
                    let wall = at.duration_since(last_at).as_secs_f64().max(1e-6);
                    let server = server_pid.and_then(read_process);
                    let own = read_process(self_pid);
                    let rate = |now: Duration, before: Duration| {
                        now.saturating_sub(before).as_secs_f64() / wall
                    };
                    let mut sample = Sample {
                        at,
                        server_cores: 0.0,
                        server_rss: 0,
                        thread_cores: Vec::new(),
                        self_cores: 0.0,
                    };
                    if let (Some(now), Some(before)) = (&server, &last_server) {
                        sample.server_cores = rate(now.cpu, before.cpu);
                        sample.server_rss = now.rss;
                        let mut before_by: HashMap<&str, Duration> = HashMap::new();
                        for (name, cpu) in &before.threads {
                            *before_by.entry(name.as_str()).or_default() += *cpu;
                        }
                        let mut now_by: BTreeMap<String, Duration> = BTreeMap::new();
                        for (name, cpu) in &now.threads {
                            *now_by.entry(name.clone()).or_default() += *cpu;
                        }
                        for (name, cpu) in now_by {
                            let before = before_by.get(name.as_str()).copied().unwrap_or_default();
                            sample.thread_cores.push((name, rate(cpu, before)));
                        }
                    } else if let Some(now) = &server {
                        sample.server_rss = now.rss;
                    }
                    if let (Some(now), Some(before)) = (&own, &last_self) {
                        sample.self_cores = rate(now.cpu, before.cpu);
                    }
                    sampler.samples.lock().unwrap().push(sample);
                    last_at = at;
                    last_server = server;
                    last_self = own;
                }
            })
            .expect("spawn the sampler");
    }

    fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    /// The samples taken between `from` and `to`.
    fn between(&self, from: Instant, to: Instant) -> Vec<Sample> {
        self.samples
            .lock()
            .unwrap()
            .iter()
            .filter(|sample| sample.at >= from && sample.at <= to)
            .cloned()
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Clients

/// What one client connection records.
struct Conn {
    name: String,
    client_id: String,
    group_id: String,
    profile: Profile,
    opened_ns: u64,
    /// From when rows were owed to this tab: when it entered the topology.
    /// A churned tab enters before its socket opens, so the rows committed
    /// between reach it by its hydration and count, with the latency from
    /// their commit to their arrival; rows from before were owed to the tab
    /// it replaces.
    owed_from_ns: u64,
    connected_at: AtomicU64,
    first_poke_at: AtomicU64,
    hydrated_at: AtomicU64,
    wanted: HashSet<String>,
    got: Mutex<HashSet<String>>,
    rows: AtomicU64,
    bytes: AtomicU64,
    pokes: AtomicU64,
    closed: AtomicBool,
    closing: AtomicBool,
    errors: Mutex<Vec<String>>,
    deliveries: Mutex<Vec<(Kind, u64)>>,
    seen: Mutex<HashSet<u64>>,
    lmid: AtomicI64,
    pending: Mutex<BTreeMap<i64, Instant>>,
    acks: Mutex<Vec<u64>>,
    next_mutation: AtomicI64,
    changed: Notify,
    sink: tokio::sync::Mutex<Option<Sink>>,
}

/// Everything the clients share.
struct Shared {
    opts: Options,
    world: World,
    stamps: Arc<Stamps>,
    topology: Mutex<Topology>,
    expected: [AtomicU64; 6],
    received: [AtomicU64; 6],
    writes: [AtomicU64; 6],
    gateway: String,
    /// When the measured window began: deliveries of rows committed before
    /// it are not counted.
    window_start: AtomicU64,
}

impl Shared {
    fn listeners(&self, kind: Kind, target: &Target) -> usize {
        let topology = self.topology.lock().unwrap();
        match (kind, target) {
            (Kind::Conversation, Target::Channel(c)) => topology.channel[*c],
            (Kind::Message | Kind::Attachment, Target::Thread(t)) => {
                topology.thread.get(t).copied().unwrap_or(0)
            }
            (Kind::Ticket, Target::Board(b)) => topology.board[*b],
            (Kind::Presence, _) => topology.all,
            (Kind::Activity, Target::User(u)) => topology.user[*u],
            _ => 0,
        }
    }

    /// Note a write of `kind` to `target` committed: the deliveries it owes.
    fn owed(&self, kind: Kind, target: &Target) {
        let listeners = self.listeners(kind, target);
        self.expected[kind as usize].fetch_add(listeners as u64, Ordering::Relaxed);
        self.writes[kind as usize].fetch_add(1, Ordering::Relaxed);
    }
}

/// What a write aims at.
enum Target {
    Channel(usize),
    Thread(String),
    Board(usize),
    User(usize),
    Everyone,
}

impl Conn {
    /// Open a connection for `profile`, register its queries, and start
    /// reading; the reading task runs until the socket closes.
    async fn open(
        shared: &Arc<Shared>,
        name: String,
        profile: Profile,
        counter: u64,
        owed_from_ns: Option<u64>,
    ) -> Result<Arc<Conn>, String> {
        let client_id = format!("lc-{counter}-{}", &name);
        let group_id = format!("lg-{counter}-{}", &name);
        let patch = profile.patch(&shared.world);
        let wanted: HashSet<String> = patch
            .iter()
            .filter_map(|op| op.get("hash").and_then(Json::as_str).map(str::to_owned))
            .collect();
        let user = shared.world.users[profile.user].clone();
        let init = json!(["initConnection", {"desiredQueriesPatch": patch, "activeClients": [client_id]}]);
        let handshake = json!({"initConnectionMessage": init, "authToken": user});
        let encoded = base64::engine::general_purpose::STANDARD.encode(handshake.to_string());
        let header = percent_encoding::utf8_percent_encode(&encoded, percent_encoding::NON_ALPHANUMERIC)
            .to_string();
        let url = format!(
            "{}/sync/v51/connect?clientID={client_id}&clientGroupID={group_id}&userID={user}&baseCookie=&ts=1&lmid=0&wsid={name}&profileID=load",
            shared.gateway
        );
        let mut request = url
            .into_client_request()
            .map_err(|error| format!("{name}: bad URL: {error}"))?;
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            HeaderValue::from_str(&header).map_err(|error| error.to_string())?,
        );
        request
            .headers_mut()
            .insert("Origin", HeaderValue::from_static("http://localhost:5173"));
        let opened = Instant::now();
        let (ws, _) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|error| format!("{name}: connect: {error}"))?;
        let (sink, stream) = ws.split();
        let conn = Arc::new(Conn {
            name,
            client_id,
            group_id,
            profile,
            opened_ns: nanos_at(opened),
            owed_from_ns: owed_from_ns.unwrap_or_else(|| nanos_at(opened)),
            connected_at: AtomicU64::new(0),
            first_poke_at: AtomicU64::new(0),
            hydrated_at: AtomicU64::new(0),
            wanted,
            got: Mutex::new(HashSet::new()),
            rows: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            pokes: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            closing: AtomicBool::new(false),
            errors: Mutex::new(Vec::new()),
            deliveries: Mutex::new(Vec::new()),
            seen: Mutex::new(HashSet::new()),
            lmid: AtomicI64::new(0),
            pending: Mutex::new(BTreeMap::new()),
            acks: Mutex::new(Vec::new()),
            next_mutation: AtomicI64::new(1),
            changed: Notify::new(),
            sink: tokio::sync::Mutex::new(Some(sink)),
        });
        let reader = conn.clone();
        let shared = shared.clone();
        tokio::spawn(async move { reader.read_loop(stream, shared).await });
        Ok(conn)
    }

    /// Read until the socket closes.
    async fn read_loop(
        self: Arc<Self>,
        mut stream: futures_util::stream::SplitStream<Ws>,
        shared: Arc<Shared>,
    ) {
        let mut ack_due = Instant::now() + Duration::from_secs(10);
        loop {
            let next = tokio::time::timeout_at(ack_due.into(), stream.next()).await;
            match next {
                Err(_) => {
                    // nothing for ten seconds: a ping, as a client does
                    self.send(json!(["ping", {}])).await;
                    ack_due = Instant::now() + Duration::from_secs(10);
                }
                Ok(Some(Ok(Message::Text(text)))) => {
                    self.bytes.fetch_add(text.len() as u64, Ordering::Relaxed);
                    self.on_text(text.as_str(), &shared).await;
                }
                Ok(Some(Ok(Message::Binary(bytes)))) => {
                    self.bytes.fetch_add(bytes.len() as u64, Ordering::Relaxed);
                }
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) => break,
                Ok(Some(Ok(_))) => {}
                Ok(Some(Err(error))) => {
                    if !self.closing.load(Ordering::Relaxed) {
                        self.errors
                            .lock()
                            .unwrap()
                            .push(format!("socket: {error}"));
                    }
                    break;
                }
            }
        }
        self.closed.store(true, Ordering::Release);
        self.changed.notify_waiters();
    }

    /// One downstream message. The tag is read off the front of the text,
    /// and a poke part is parsed with its rows left as raw text, so the
    /// hydration's hundreds of thousands of rows cost a scan and not a
    /// tree each: this process must stay light beside the server it
    /// measures.
    async fn on_text(&self, text: &str, shared: &Shared) {
        let tag = text
            .strip_prefix("[\"")
            .and_then(|rest| rest.split('"').next())
            .unwrap_or("");
        if tag == "pokePart" {
            self.on_poke_part(text, shared).await;
            return;
        }
        let Ok(message) = serde_json::from_str::<Json>(text) else {
            return;
        };
        let body = message.get(1).cloned().unwrap_or(Json::Null);
        match tag {
            "connected" => {
                self.connected_at
                    .store(nanos_at(Instant::now()), Ordering::Relaxed);
            }
            "pokeEnd" => {
                self.pokes.fetch_add(1, Ordering::Relaxed);
                let _ = self.first_poke_at.compare_exchange(
                    0,
                    nanos_at(Instant::now()),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
                if self.hydrated_at.load(Ordering::Relaxed) == 0 {
                    let got = self.got.lock().unwrap();
                    if self.wanted.iter().all(|hash| got.contains(hash)) {
                        self.hydrated_at
                            .store(nanos_at(Instant::now()), Ordering::Release);
                        self.changed.notify_waiters();
                    }
                }
            }
            "error" => {
                self.errors
                    .lock()
                    .unwrap()
                    .push(format!("error: {}", preview(&body.to_string())));
                self.changed.notify_waiters();
            }
            "transformError" => {
                self.errors
                    .lock()
                    .unwrap()
                    .push(format!("transformError: {}", preview(&body.to_string())));
                self.changed.notify_waiters();
            }
            "pushResponse" => {
                if body.get("error").is_some() {
                    self.errors
                        .lock()
                        .unwrap()
                        .push(format!("pushResponse: {}", preview(&body.to_string())));
                }
            }
            _ => {}
        }
    }

    /// The rows, query states and mutation ids of one poke part.
    async fn on_poke_part(&self, text: &str, shared: &Shared) {
        #[derive(serde::Deserialize)]
        struct Part<'a> {
            #[serde(borrow, rename = "rowsPatch")]
            rows: Option<&'a serde_json::value::RawValue>,
            #[serde(rename = "gotQueriesPatch")]
            got: Option<Vec<Json>>,
            #[serde(rename = "lastMutationIDChanges")]
            lmids: Option<HashMap<String, i64>>,
            #[serde(rename = "mutationsPatch")]
            results: Option<Vec<Json>>,
        }
        let Ok((_, part)) = serde_json::from_str::<(&str, Part)>(text) else {
            return;
        };
        let now = Instant::now();
        let now_ns = nanos_at(now);
        let window_start = shared.window_start.load(Ordering::Relaxed);
        let body = json!({
            "gotQueriesPatch": part.got, "lastMutationIDChanges": part.lmids, "mutationsPatch": part.results,
        });
        if let Some(raw) = part.rows {
            let raw = raw.get();
            let count = raw.matches("{\"op\":\"put\"").count() + raw.matches("{\"op\":\"del\"").count();
            self.rows.fetch_add(count as u64, Ordering::Relaxed);
            // Rows are looked at only inside the measured window, and only
            // when the part can carry a stamped row at all.
            let measuring = window_start != 0 && window_start != u64::MAX;
            let stamped = raw.contains("\"lv") || raw.contains("\"version\":");
            let ops: Vec<Json> = if measuring && stamped {
                serde_json::from_str(raw).unwrap_or_default()
            } else {
                Vec::new()
            };
            let mut deliveries = Vec::new();
            let closing = self.closing.load(Ordering::Relaxed);
            for op in &ops {
                if closing {
                    break;
                }
                if op.get("op").and_then(Json::as_str) != Some("put") {
                    continue;
                }
                let table = op.get("tableName").and_then(Json::as_str).unwrap_or("");
                let Some(value) = op.get("value") else {
                    continue;
                };
                let Some((kind, seq)) = seq_of(table, value) else {
                    continue;
                };
                let Some(committed) = shared.stamps.get(seq) else {
                    continue;
                };
                // a row committed before the measured window is not measured
                if window_start == 0 || committed < window_start {
                    continue;
                }
                // a row committed before this tab was owed anything was
                // owed to another (the tab it replaced), or to none
                if committed < self.owed_from_ns {
                    continue;
                }
                if !self.holds(kind, value, &shared.world) {
                    continue;
                }
                if !self.seen.lock().unwrap().insert(seq) {
                    continue;
                }
                deliveries.push((kind, now_ns.saturating_sub(committed)));
                shared.received[kind as usize].fetch_add(1, Ordering::Relaxed);
            }
            if !deliveries.is_empty() {
                self.deliveries.lock().unwrap().extend(deliveries);
            }
        }
        if let Some(ops) = body.get("gotQueriesPatch").and_then(Json::as_array) {
            let mut got = self.got.lock().unwrap();
            for op in ops {
                let hash = op.get("hash").and_then(Json::as_str).unwrap_or("");
                match op.get("op").and_then(Json::as_str) {
                    Some("put") => {
                        got.insert(hash.to_owned());
                    }
                    Some("del") => {
                        got.remove(hash);
                    }
                    _ => {}
                }
            }
        }
        if let Some(changes) = body.get("lastMutationIDChanges").and_then(Json::as_object)
            && let Some(lmid) = changes.get(&self.client_id).and_then(Json::as_i64)
        {
            self.lmid.fetch_max(lmid, Ordering::Relaxed);
            let mut pending = self.pending.lock().unwrap();
            let settled: Vec<i64> = pending.range(..=lmid).map(|(id, _)| *id).collect();
            let mut acks = self.acks.lock().unwrap();
            for id in settled {
                if let Some(sent) = pending.remove(&id) {
                    acks.push(now.duration_since(sent).as_nanos() as u64);
                }
            }
            drop(acks);
            drop(pending);
            self.changed.notify_waiters();
        }
        if let Some(results) = body.get("mutationsPatch").and_then(Json::as_array) {
            let mut highest = None;
            for entry in results {
                if entry.get("op").and_then(Json::as_str) != Some("put") {
                    continue;
                }
                let id = entry.pointer("/mutation/id");
                if id.and_then(|id| id.get("clientID")).and_then(Json::as_str)
                    == Some(self.client_id.as_str())
                    && let Some(n) = id.and_then(|id| id.get("id")).and_then(Json::as_i64)
                {
                    highest = Some(highest.map_or(n, |h: i64| h.max(n)));
                }
            }
            if let Some(n) = highest {
                self.send(json!(["ackMutationResponses", {"clientID": self.client_id, "id": n}]))
                    .await;
            }
        }
    }

    /// Whether this client's queries hold rows like `value` of `kind`.
    fn holds(&self, kind: Kind, value: &Json, world: &World) -> bool {
        let text = |column: &str| value.get(column).and_then(Json::as_str).unwrap_or("");
        match kind {
            Kind::Conversation => text("channelId") == world.channels[self.profile.channel],
            Kind::Message | Kind::Attachment => {
                let conversation = text("conversationId");
                self.profile.threads.iter().any(|t| t == conversation)
            }
            Kind::Ticket => text("boardId") == world.boards[self.profile.board],
            Kind::Presence => true,
            Kind::Activity => text("userId") == world.users[self.profile.user],
        }
    }

    /// Send one upstream message; a closed socket is ignored.
    async fn send(&self, message: Json) {
        let mut sink = self.sink.lock().await;
        if let Some(sink) = sink.as_mut() {
            let _ = sink.send(Message::Text(message.to_string().into())).await;
        }
    }

    /// Close the socket on purpose.
    async fn close(&self) {
        self.closing.store(true, Ordering::Relaxed);
        let mut sink = self.sink.lock().await;
        if let Some(mut sink) = sink.take() {
            let _ = sink.close().await;
        }
    }

    /// Wait until every query reports `got`, the socket closes, or an error
    /// is reported; whether it hydrated.
    async fn wait_hydrated(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.hydrated_at.load(Ordering::Acquire) > 0 {
                return true;
            }
            if self.closed.load(Ordering::Acquire) || !self.errors.lock().unwrap().is_empty() {
                return false;
            }
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let _ = tokio::time::timeout(deadline - now, self.changed.notified()).await;
        }
    }

    /// Push one `messages.send` into one of this client's threads and wait
    /// for its acknowledgement; the round trip, or `None` on a timeout.
    async fn push_reply(&self, shared: &Shared, rng_word: u64, timeout: Duration) -> Option<Duration> {
        let thread = &self.profile.threads[(rng_word % self.profile.threads.len() as u64) as usize];
        let seq = shared.stamps.next();
        let id = self.next_mutation.fetch_add(1, Ordering::Relaxed);
        let now = now_ms();
        let sent = Instant::now();
        shared.owed(Kind::Message, &Target::Thread(thread.clone()));
        self.pending.lock().unwrap().insert(id, sent);
        let channel = &shared.world.channels[self.profile.channel];
        let body = json!(["push", {
            "clientGroupID": self.group_id,
            "mutations": [{
                "type": "custom", "id": id, "clientID": self.client_id, "name": "messages.send",
                "args": [{
                    "conversationId": thread, "messageId": format!("lv{seq}"),
                    "content": format!("reply {seq} from {}", self.name), "channelId": channel,
                    "senderId": shared.world.users[self.profile.user], "seq": seq
                }],
                "timestamp": now
            }],
            "pushVersion": 1, "timestamp": now, "requestID": format!("{}-{id}", self.name)
        }]);
        self.send(body).await;
        let deadline = sent + timeout;
        loop {
            if self.lmid.load(Ordering::Relaxed) >= id {
                return Some(Instant::now().duration_since(sent));
            }
            if self.closed.load(Ordering::Acquire) {
                return None;
            }
            let now = Instant::now();
            if now >= deadline {
                self.pending.lock().unwrap().remove(&id);
                return None;
            }
            let _ = tokio::time::timeout(deadline - now, self.changed.notified()).await;
        }
    }
}

/// The first hundred characters.
fn preview(text: &str) -> String {
    let mut out: String = text.chars().take(160).collect();
    if out.len() < text.len() {
        out.push_str("...");
    }
    out
}

// ---------------------------------------------------------------------------
// Writers

/// A writer: one connection, committing transactions of the mix at its share
/// of the rate until `until`.
async fn writer(
    k: usize,
    shared: Arc<Shared>,
    start: Instant,
    until: Instant,
    tx_index: Arc<AtomicU64>,
    commit_times: Arc<Mutex<Vec<u64>>>,
    failures: Arc<AtomicU64>,
) -> Result<(), String> {
    let mut client = pg_connect(&shared.opts.dsn).await?;
    let ins_conv = client.prepare(
        "INSERT INTO conversations (\"conversationId\", \"workspaceId\", \"channelId\", \"createdBy\", title, md, \"replyCount\", \"lastActivityAt\", \"createdAt\", \"updatedAt\") VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7, $7)",
    ).await.map_err(|e| e.to_string())?;
    let ins_msg = client.prepare(
        "INSERT INTO messages (\"messageId\", \"conversationId\", \"senderId\", \"workspaceId\", content, \"msgType\", \"hasAttachment\", edited, \"isDeleted\", \"createdAt\", metadata) VALUES ($1, $2, $3, $4, $5, 'USER', $6, false, false, $7, $8::text::jsonb)",
    ).await.map_err(|e| e.to_string())?;
    let bump = client.prepare(
        "UPDATE conversations SET \"replyCount\" = \"replyCount\" + 1, \"lastActivityAt\" = $2, \"updatedAt\" = $2 WHERE \"conversationId\" = $1",
    ).await.map_err(|e| e.to_string())?;
    let ins_att = client.prepare(
        "INSERT INTO attachments (id, \"messageId\", \"conversationId\", name, \"mimeType\", \"sizeBytes\", meta, \"createdAt\") VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8)",
    ).await.map_err(|e| e.to_string())?;
    let upd_ticket = client.prepare(
        "UPDATE tickets SET status = $2, priority = $3, \"updatedAt\" = $4, version = $5 WHERE id = $1",
    ).await.map_err(|e| e.to_string())?;
    let upd_presence = client.prepare(
        "UPDATE presence SET status = $2, \"lastSeenAt\" = $3, version = $4 WHERE \"userId\" = $1",
    ).await.map_err(|e| e.to_string())?;
    let ins_act = client.prepare(
        "INSERT INTO activities (id, \"workspaceId\", \"userId\", kind, \"refId\", \"readAt\", \"createdAt\") VALUES ($1, $2, $3, $4, $5, NULL, $6)",
    ).await.map_err(|e| e.to_string())?;

    let opts = &shared.opts;
    let world = &shared.world;
    let mut rng = XorShift64::new(opts.seed ^ (0xA11CE + k as u64 * 7919));
    let md_bytes = (opts.md_kb * 1024.0) as usize;
    let statuses = ["NEW", "OPEN", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"];
    let priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
    let presence_states = ["ONLINE", "AWAY", "ONLINE", "DND"];
    let kinds = ["mention", "reply", "assigned", "reaction"];
    // the mix, in hundredths
    const MIX: [(Kind, u64); 6] = [
        (Kind::Conversation, 10),
        (Kind::Message, 40),
        (Kind::Attachment, 3),
        (Kind::Ticket, 17),
        (Kind::Presence, 20),
        (Kind::Activity, 10),
    ];
    let draw = |rng: &mut XorShift64| -> Kind {
        let mut roll = rng.below(100);
        for (kind, weight) in MIX {
            if roll < weight {
                return kind;
            }
            roll -= weight;
        }
        Kind::Message
    };
    let per_tx = Duration::from_secs_f64(1.0 / opts.tps.max(0.001));
    loop {
        let i = tx_index.fetch_add(1, Ordering::Relaxed);
        let due = start + per_tx.mul_f64(i as f64);
        if due >= until {
            break;
        }
        tokio::time::sleep_until(due.into()).await;
        if Instant::now() >= until {
            break;
        }
        // Build the transaction's writes; each is owed to the listeners of
        // its target as of now, and stamped just before the commit.
        let mut owed: Vec<(Kind, Target, u64)> = Vec::with_capacity(opts.rows_per_tx);
        let tx = match client.transaction().await {
            Ok(tx) => tx,
            Err(error) => {
                failures.fetch_add(1, Ordering::Relaxed);
                eprintln!("writer {k}: begin: {error}");
                continue;
            }
        };
        let mut failed = None;
        for _ in 0..opts.rows_per_tx {
            let kind = draw(&mut rng);
            let seq = shared.stamps.next();
            let now = now_ms();
            let result = match kind {
                Kind::Conversation => {
                    let channel = rng.index(opts.channels);
                    let id = format!("lv{seq}");
                    let author = &world.users[rng.index(world.users.len())];
                    let title = words(&mut rng, 5);
                    let md = markdown(&mut rng, md_bytes);
                    let first = tx
                        .execute(
                            &ins_conv,
                            &[&id, &WORKSPACE, &world.channels[channel], author, &title, &md, &now],
                        )
                        .await;
                    let result = match first {
                        Ok(_) => {
                            let message = format!("lvm{seq}");
                            let content = words(&mut rng, 30);
                            tx.execute(
                                &ins_msg,
                                &[&message, &id, author, &WORKSPACE, &content, &false, &now, &"{\"client\":\"web\",\"v\":1}"],
                            )
                            .await
                        }
                        Err(error) => Err(error),
                    };
                    owed.push((kind, Target::Channel(channel), seq));
                    result
                }
                Kind::Message => {
                    let channel = rng.index(opts.channels);
                    let thread = rng.pick(&world.threads[channel]).clone();
                    let id = format!("lv{seq}");
                    let author = &world.users[rng.index(world.users.len())];
                    let n = 10 + rng.index(80);
                    let content = words(&mut rng, n);
                    let result = tx
                        .execute(
                            &ins_msg,
                            &[&id, &thread, author, &WORKSPACE, &content, &false, &now, &"{\"client\":\"web\",\"v\":1}"],
                        )
                        .await;
                    let result = match result {
                        Ok(_) => tx.execute(&bump, &[&thread, &now]).await,
                        Err(error) => Err(error),
                    };
                    owed.push((kind, Target::Thread(thread), seq));
                    result
                }
                Kind::Attachment => {
                    let channel = rng.index(opts.channels);
                    let pool = &world.threads[channel];
                    let index = rng.index(pool.len());
                    let thread = pool[index].clone();
                    // the seeded message of that thread: the pool is the newest seeded conversations
                    let conversation = opts.seed_conversations - pool.len() + index;
                    let message = message_id(channel, conversation, rng.index(SEED_REPLIES));
                    let id = format!("lv{seq}");
                    let name = format!("{}.pdf", words(&mut rng, 2).replace(' ', "-"));
                    let meta_bytes = 1024 + rng.index(2048);
                    let meta = meta_json(&mut rng, meta_bytes);
                    let size = 20_000 + rng.below(4_000_000) as i64;
                    let result = tx
                        .execute(
                            &ins_att,
                            &[&id, &message, &thread, &name, &"application/pdf", &size, &meta, &now],
                        )
                        .await;
                    owed.push((kind, Target::Thread(thread), seq));
                    result
                }
                Kind::Ticket => {
                    let board = rng.index(opts.boards);
                    let ticket = rng.pick(&world.hot_tickets[board]).clone();
                    let status = rng.word(&statuses);
                    let priority = rng.word(&priorities);
                    let version = seq as i64;
                    let result = tx
                        .execute(&upd_ticket, &[&ticket, &status, &priority, &now, &version])
                        .await;
                    owed.push((kind, Target::Board(board), seq));
                    result
                }
                Kind::Presence => {
                    let user = user_id(rng.index(opts.seed_users));
                    let state = rng.word(&presence_states);
                    let version = seq as i64;
                    let result = tx
                        .execute(&upd_presence, &[&user, &state, &now, &version])
                        .await;
                    owed.push((kind, Target::Everyone, seq));
                    result
                }
                Kind::Activity => {
                    let user = rng.index(world.users.len());
                    let id = format!("lv{seq}");
                    let reference = conversation_id(rng.index(opts.channels), rng.index(opts.seed_conversations));
                    let kind_name = rng.word(&kinds);
                    let result = tx
                        .execute(
                            &ins_act,
                            &[&id, &WORKSPACE, &world.users[user], &kind_name, &reference, &now],
                        )
                        .await;
                    owed.push((kind, Target::User(user), seq));
                    result
                }
            };
            if let Err(error) = result {
                failed = Some(error.to_string());
                break;
            }
        }
        if let Some(error) = failed {
            failures.fetch_add(1, Ordering::Relaxed);
            if failures.load(Ordering::Relaxed) <= 3 {
                eprintln!("writer {k}: {error}");
            }
            let _ = tx.rollback().await;
            continue;
        }
        for (kind, target, seq) in &owed {
            shared.owed(*kind, target);
            shared.stamps.stamp(*seq);
        }
        let committing = Instant::now();
        match tx.commit().await {
            Ok(()) => {
                commit_times
                    .lock()
                    .unwrap()
                    .push(committing.elapsed().as_nanos() as u64);
            }
            Err(error) => {
                failures.fetch_add(1, Ordering::Relaxed);
                if failures.load(Ordering::Relaxed) <= 3 {
                    eprintln!("writer {k}: commit: {error}");
                }
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Statistics and tables

/// p50, p90, p99, max and the count of `values`.
#[derive(Debug, Clone, Copy, Default)]
struct Pct {
    n: usize,
    p50: f64,
    p90: f64,
    p99: f64,
    max: f64,
    mean: f64,
}

impl Pct {
    fn of(values: &mut [f64]) -> Pct {
        if values.is_empty() {
            return Pct::default();
        }
        values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let at = |q: f64| values[((values.len() as f64 * q) as usize).min(values.len() - 1)];
        Pct {
            n: values.len(),
            p50: at(0.50),
            p90: at(0.90),
            p99: at(0.99),
            max: values[values.len() - 1],
            mean: values.iter().sum::<f64>() / values.len() as f64,
        }
    }

    fn json(&self) -> Json {
        json!({"n": self.n, "p50": self.p50, "p90": self.p90, "p99": self.p99, "max": self.max, "mean": self.mean})
    }
}

/// Nanoseconds to milliseconds.
fn ms(ns: u64) -> f64 {
    ns as f64 / 1e6
}

fn fmt1(x: f64) -> String {
    format!("{x:.1}")
}

fn fmt2(x: f64) -> String {
    format!("{x:.2}")
}

fn fmt0(x: f64) -> String {
    format!("{x:.0}")
}

/// A row of p50 / p90 / p99 / max.
fn pct_row(label: &str, pct: &Pct, fmt: fn(f64) -> String) -> Vec<String> {
    vec![
        label.to_owned(),
        pct.n.to_string(),
        fmt(pct.p50),
        fmt(pct.p90),
        fmt(pct.p99),
        fmt(pct.max),
    ]
}

/// A table with right-aligned numeric columns.
fn print_table(header: &[&str], rows: &[Vec<String>]) {
    let columns = header.len();
    let mut widths: Vec<usize> = header.iter().map(|h| h.len()).collect();
    for row in rows {
        for (i, cell) in row.iter().enumerate().take(columns) {
            widths[i] = widths[i].max(cell.len());
        }
    }
    let line = |cells: &[String]| {
        let mut out = String::new();
        for (i, cell) in cells.iter().enumerate().take(columns) {
            if i > 0 {
                out.push_str("  ");
            }
            if i == 0 {
                out.push_str(&format!("{:<width$}", cell, width = widths[i]));
            } else {
                out.push_str(&format!("{:>width$}", cell, width = widths[i]));
            }
        }
        out
    };
    let header: Vec<String> = header.iter().map(|h| h.to_string()).collect();
    println!("  {}", line(&header));
    println!(
        "  {}",
        widths
            .iter()
            .map(|w| "-".repeat(*w))
            .collect::<Vec<_>>()
            .join("  ")
    );
    for row in rows {
        println!("  {}", line(row));
    }
}

/// The hydration figures of `conns`: open to connected, to the first poke,
/// to every query got; rows and kilobytes per client.
fn hydration_report(conns: &[Arc<Conn>]) -> (Json, Vec<Vec<String>>) {
    let since = |conn: &Conn, at: &AtomicU64| -> Option<f64> {
        let at = at.load(Ordering::Relaxed);
        (at > 0).then(|| ms(at.saturating_sub(conn.opened_ns)))
    };
    let mut connected: Vec<f64> = conns.iter().filter_map(|c| since(c, &c.connected_at)).collect();
    let mut first: Vec<f64> = conns.iter().filter_map(|c| since(c, &c.first_poke_at)).collect();
    let mut hydrated: Vec<f64> = conns.iter().filter_map(|c| since(c, &c.hydrated_at)).collect();
    let mut rows: Vec<f64> = conns.iter().map(|c| c.rows.load(Ordering::Relaxed) as f64).collect();
    let mut kb: Vec<f64> = conns
        .iter()
        .map(|c| c.bytes.load(Ordering::Relaxed) as f64 / 1024.0)
        .collect();
    let connected = Pct::of(&mut connected);
    let first = Pct::of(&mut first);
    let hydrated = Pct::of(&mut hydrated);
    let rows = Pct::of(&mut rows);
    let kb = Pct::of(&mut kb);
    let table = vec![
        pct_row("open → connected (ms)", &connected, fmt1),
        pct_row("open → first poke (ms)", &first, fmt1),
        pct_row("open → every query got (ms)", &hydrated, fmt1),
        pct_row("rows per client", &rows, fmt0),
        pct_row("KB per client", &kb, fmt0),
    ];
    let json = json!({
        "to_connected_ms": connected.json(), "to_first_poke_ms": first.json(), "to_hydrated_ms": hydrated.json(),
        "rows_per_client": rows.json(), "kb_per_client": kb.json(),
    });
    (json, table)
}

/// The WAL position `X/Y` as a number of bytes.
fn lsn_bytes(text: &str) -> u64 {
    let Some((high, low)) = text.split_once('/') else {
        return 0;
    };
    let high = u64::from_str_radix(high, 16).unwrap_or(0);
    let low = u64::from_str_radix(low, 16).unwrap_or(0);
    (high << 32) | low
}

/// The server's pipeline stages from a `/stats` reading, as a table: the
/// count, the percentiles and the sum (count times mean), which says how
/// much of a thread's time a stage took.
fn print_stages(stats: &Json) {
    let stages = [
        "feed_lag", "feed_decode", "feed_to_engine", "engine_step", "engine_to_groups", "groups_flush",
        "groups_to_socket", "end_to_end", "transform", "plan", "count_io", "connect_mutations", "connect_group",
        "read_pool_wait", "read_io", "register_step", "land_step", "unregister_step", "hydrate_cold",
        "hydrate_warm", "push", "push_queue", "mutation_ack",
    ];
    let mut rows = Vec::new();
    if let Some(map) = stats.get("stages_us").and_then(Json::as_object) {
        for stage in stages {
            let Some(h) = map.get(stage) else { continue };
            let n = h.get("count").and_then(Json::as_u64).unwrap_or(0);
            if n == 0 {
                continue;
            }
            let get = |k: &str| h.get(k).and_then(Json::as_u64).unwrap_or(0);
            rows.push(vec![
                stage.to_owned(),
                n.to_string(),
                get("p50_us").to_string(),
                get("p90_us").to_string(),
                get("p99_us").to_string(),
                get("max_us").to_string(),
                fmt1((n * get("mean_us")) as f64 / 1000.0),
            ]);
        }
    }
    print_table(&["stage", "n", "p50 µs", "p90 µs", "p99 µs", "max µs", "sum ms"], &rows);
    if let Some(engine) = stats.get("engine").and_then(Json::as_object) {
        let get = |k: &str| engine.get(k).and_then(Json::as_u64).unwrap_or(0);
        println!(
            "  engine: {} registered, {} reads issued, {} landed, {} refused, {} snapshots shared, {} row reads, {} rows completed, {} page rounds, {} storage reads, {} writes processed",
            get("queries_registered"), get("reads_issued"), get("reads_landed"), get("reads_refused"),
            get("snapshots_shared"), get("row_reads"), get("rows_completed"), get("page_rounds"),
            get("storage_reads"), get("writes_processed")
        );
    }
}

/// The process figures of `samples`: cores and resident set, each thread's
/// cores, and this process's cores, as table rows and JSON.
fn process_report(samples: &[Sample]) -> (Vec<Vec<String>>, serde_json::Map<String, Json>) {
    let mut process_rows = Vec::new();
    let mut process_json = serde_json::Map::new();
    if samples.is_empty() {
        return (process_rows, process_json);
    }
    {
        let mut cores: Vec<f64> = samples.iter().map(|s| s.server_cores).collect();
        let mut rss: Vec<f64> = samples.iter().map(|s| s.server_rss as f64 / 1e6).collect();
        let cores = Pct::of(&mut cores);
        let rss = Pct::of(&mut rss);
        process_rows.push(pct_row("cores (CPU s / wall s)", &cores, fmt2));
        process_rows.push(pct_row("resident set (MB)", &rss, fmt0));
        process_json.insert("cores".to_owned(), cores.json());
        process_json.insert("rss_mb".to_owned(), rss.json());
        let mut by_thread: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        for sample in samples {
            for (name, cores) in &sample.thread_cores {
                by_thread.entry(name.clone()).or_default().push(*cores);
            }
        }
        let mut threads: Vec<(String, Pct)> = by_thread
            .into_iter()
            .map(|(name, mut values)| {
                while values.len() < samples.len() {
                    values.push(0.0);
                }
                (name, Pct::of(&mut values))
            })
            .collect();
        threads.sort_by(|a, b| b.1.mean.partial_cmp(&a.1.mean).unwrap_or(std::cmp::Ordering::Equal));
        let mut thread_json = serde_json::Map::new();
        for (name, pct) in &threads {
            if pct.max < 0.005 {
                continue;
            }
            process_rows.push(pct_row(&format!("thread {name} (cores)"), pct, fmt2));
            thread_json.insert(name.clone(), pct.json());
        }
        process_json.insert("threads_cores".to_owned(), Json::Object(thread_json));
        let mut own: Vec<f64> = samples.iter().map(|s| s.self_cores).collect();
        let own = Pct::of(&mut own);
        process_rows.push(pct_row("this bench process (cores)", &own, fmt2));
        process_json.insert("bench_cores".to_owned(), own.json());
    }
    (process_rows, process_json)
}

/// `GET /stats` of the server, `reset` zeroing its histograms first.
async fn server_stats(http: &reqwest::Client, base: &str, reset: bool) -> Option<Json> {
    let url = if reset {
        format!("{base}/stats?reset=1")
    } else {
        format!("{base}/stats")
    };
    let response = http
        .get(url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    response.json().await.ok()
}

// ---------------------------------------------------------------------------
// Main

fn main() {
    let opts = match Options::parse() {
        Ok(opts) => opts,
        Err(message) if message.is_empty() => {
            println!("{}", usage());
            return;
        }
        Err(message) => {
            eprintln!("{message}\n\n{}", usage());
            std::process::exit(2);
        }
    };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let code = runtime.block_on(run(opts));
    runtime.shutdown_timeout(Duration::from_secs(5));
    std::process::exit(code);
}

/// The run; the exit code.
async fn run(opts: Options) -> i32 {
    let _ = epoch();
    let started = Instant::now();
    let label = if opts.label.is_empty() {
        String::new()
    } else {
        format!(" [{}]", opts.label)
    };
    println!(
        "streamgres load bench{label}: {} clients of {} users over {} channels and {} boards, {} open threads each; \
         {} tx/s × {} rows for {} s after {} s warmup; {} pushers at {}/s; churn {}/s; seed {}",
        opts.connections, opts.users, opts.channels, opts.boards, opts.threads,
        opts.tps, opts.rows_per_tx, opts.duration, opts.warmup, opts.pushers, opts.push_rate, opts.churn, opts.seed
    );
    match run_inner(opts, started).await {
        Ok(passed) => {
            println!("\n{}", if passed { "PASS" } else { "FAIL" });
            if passed { 0 } else { 1 }
        }
        Err(message) => {
            eprintln!("\nERROR: {message}");
            2
        }
    }
}

async fn run_inner(opts: Options, started: Instant) -> Result<bool, String> {
    let http = reqwest::Client::new();
    let mut report = json!({
        "label": opts.label,
        "started": now_ms(),
        "config": {
            "connections": opts.connections, "users": opts.users, "channels": opts.channels, "boards": opts.boards,
            "threads": opts.threads, "tps": opts.tps, "rows_per_tx": opts.rows_per_tx, "writers": opts.writers,
            "pushers": opts.pushers, "push_rate": opts.push_rate, "churn": opts.churn, "warmup_s": opts.warmup,
            "duration_s": opts.duration, "md_kb": opts.md_kb, "seed_users": opts.seed_users,
            "seed_conversations": opts.seed_conversations, "seed_tickets": opts.seed_tickets,
            "backend_ms": opts.backend_ms, "group_threads": opts.group_threads, "read_threads": opts.read_threads,
            "read_connections": opts.read_connections,
            "seed": opts.seed,
        },
        "phases": {},
    });

    // ---- 1. prepare
    println!("\n== 1. prepare ==");
    let phase = Instant::now();
    let world = prepare(&opts).await?;
    let prepare_ms = phase.elapsed().as_secs_f64() * 1000.0;
    println!(
        "  {} users, {} channels, {} conversations of ~{} KB with {} messages each, {} tickets on {} boards, in {} ms",
        opts.seed_users,
        opts.channels,
        opts.channels * opts.seed_conversations,
        opts.md_kb,
        SEED_REPLIES,
        opts.seed_tickets,
        opts.boards,
        fmt0(prepare_ms)
    );
    report["phases"]["prepare"] = json!({"ms": prepare_ms});
    if opts.prepare_only {
        println!("\nprepared only; start the server against this database and run again with --gateway");
        return Ok(true);
    }

    // ---- 2. the application server and the sync server
    println!("\n== 2. server ==");
    let phase = Instant::now();
    let total_writes = (opts.tps * opts.rows_per_tx as f64 + opts.push_rate)
        * (opts.duration + opts.warmup + 120) as f64;
    let stamps = Arc::new(Stamps::new((total_writes * 2.0) as usize + 100_000));
    let app = Arc::new(App {
        pool: PgPool::connect(&opts.dsn, 8).await?,
        stamps: stamps.clone(),
        think: Duration::from_millis(opts.backend_ms),
        transforms: AtomicU64::new(0),
        pushes: AtomicU64::new(0),
        cleanups: AtomicU64::new(0),
        failures: Mutex::new(Vec::new()),
    });
    let app_port = start_app(app.clone()).await?;
    let mut server = Server::start(&opts, app_port).await?;
    let startup_ms = phase.elapsed().as_secs_f64() * 1000.0;
    match (&server.child, server.pid) {
        (Some(_), Some(pid)) => println!(
            "  started {} (pid {pid}) at {}, ready in {} ms; log in {}",
            opts.server_bin, server.gateway, fmt0(startup_ms), opts.server_log
        ),
        (None, pid) => println!(
            "  attached to {} (pid {})",
            server.gateway,
            pid.map_or("unknown, not sampled".to_owned(), |p| p.to_string())
        ),
        _ => {}
    }
    println!("  application server on 127.0.0.1:{app_port}, think time {} ms", opts.backend_ms);
    report["phases"]["server"] = json!({"startup_ms": startup_ms, "pid": server.pid});
    let sampler = Sampler::new();
    sampler.run(server.pid, Duration::from_millis(opts.sample_ms));
    let pg = pg_connect(&opts.dsn).await?;

    let shared = Arc::new(Shared {
        opts: opts.clone(),
        world: world.clone(),
        stamps: stamps.clone(),
        topology: Mutex::new(Topology::new(&world)),
        expected: Default::default(),
        received: Default::default(),
        writes: Default::default(),
        gateway: server.gateway.clone(),
        window_start: AtomicU64::new(0),
    });

    let counter = Arc::new(AtomicU64::new(0));
    if opts.prewarm > 0 {
        println!("\n== 2b. prewarm ({} clients connected, hydrated and closed) ==", opts.prewarm);
        let phase = Instant::now();
        let mut warm = Vec::new();
        for slot in 0..opts.prewarm {
            let n = counter.fetch_add(1, Ordering::Relaxed);
            if let Ok(conn) = Conn::open(&shared, format!("W{slot}"), Profile::of(slot, &opts, &world), n, None).await {
                warm.push(conn);
            }
        }
        for conn in &warm {
            conn.wait_hydrated(Duration::from_secs(60)).await;
        }
        for conn in &warm {
            conn.close().await;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        println!("  done in {} ms", fmt0(phase.elapsed().as_secs_f64() * 1000.0));
    }

    // ---- 3. hydrate
    println!("\n== 3. hydrate ({} clients, {} queries each) ==", opts.connections, 7 + opts.threads);
    let phase = Instant::now();
    let _ = server_stats(&http, &server.http, true).await;
    let mut conns: Vec<Arc<Conn>> = Vec::with_capacity(opts.connections);
    let mut opening = Vec::with_capacity(opts.connections);
    for slot in 0..opts.connections {
        let profile = Profile::of(slot, &opts, &world);
        let shared = shared.clone();
        let counter = counter.clone();
        opening.push(tokio::spawn(async move {
            let n = counter.fetch_add(1, Ordering::Relaxed);
            Conn::open(&shared, format!("S{slot}"), profile, n, None).await
        }));
        if slot % 50 == 49 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
    let mut connect_errors = Vec::new();
    for handle in opening {
        match handle.await {
            Ok(Ok(conn)) => conns.push(conn),
            Ok(Err(error)) => connect_errors.push(error),
            Err(error) => connect_errors.push(error.to_string()),
        }
    }
    let hydrate_deadline = Duration::from_secs(120);
    let waits: Vec<_> = conns
        .iter()
        .map(|conn| {
            let conn = conn.clone();
            tokio::spawn(async move { conn.wait_hydrated(hydrate_deadline).await })
        })
        .collect();
    let mut hydrated = 0usize;
    for wait in waits {
        if matches!(wait.await, Ok(true)) {
            hydrated += 1;
        }
    }
    {
        let mut topology = shared.topology.lock().unwrap();
        for conn in &conns {
            topology.add(&conn.profile, 1);
        }
    }
    let hydrate_ms = phase.elapsed().as_secs_f64() * 1000.0;
    let (hydrate_json, hydrate_table) = hydration_report(&conns);
    let subscriptions = conns.len() * (7 + opts.threads);
    println!(
        "  {hydrated}/{} hydrated in {} ms ({} subscriptions, {} registered/s); {} connect errors",
        opts.connections,
        fmt0(hydrate_ms),
        subscriptions,
        fmt0(subscriptions as f64 / (hydrate_ms / 1000.0).max(0.001)),
        connect_errors.len()
    );
    print_table(&["hydration", "n", "p50", "p90", "p99", "max"], &hydrate_table);
    let first_errors: Vec<String> = conns
        .iter()
        .flat_map(|c| c.errors.lock().unwrap().clone())
        .chain(connect_errors.iter().cloned())
        .take(3)
        .collect();
    if !first_errors.is_empty() {
        println!("  first errors: {}", first_errors.join(" | "));
    }
    let hydrate_stats = server_stats(&http, &server.http, false).await;
    if let Some(stats) = &hydrate_stats {
        println!("  server stages over the hydration (/stats):");
        print_stages(stats);
    }
    let hydrate_samples = sampler.between(phase, Instant::now());
    let (rows, _) = process_report(&hydrate_samples);
    if !rows.is_empty() {
        println!("  server process over the hydration ({} ms samples):", opts.sample_ms);
        print_table(&["measure", "samples", "p50", "p90", "p99", "max"], &rows);
    }
    report["phases"]["hydrate"] = json!({
        "ms": hydrate_ms, "connections": opts.connections, "hydrated": hydrated,
        "subscriptions": subscriptions, "connect_errors": connect_errors.len(), "measures": hydrate_json,
        "first_errors": first_errors, "server_stats": hydrate_stats,
    });
    if hydrated == 0 {
        return Err("no client hydrated; see the server log".to_owned());
    }

    // ---- 4. steady
    println!(
        "\n== 4. steady ({} s warmup, then {} s measured) ==",
        opts.warmup, opts.duration
    );
    let steady_start = Instant::now();
    let window_start = steady_start + Duration::from_secs(opts.warmup);
    let window_end = window_start + Duration::from_secs(opts.duration);
    let tx_index = Arc::new(AtomicU64::new(0));
    let commit_times = Arc::new(Mutex::new(Vec::new()));
    let write_failures = Arc::new(AtomicU64::new(0));
    let mut tasks = Vec::new();
    for k in 0..opts.writers {
        let shared = shared.clone();
        let tx_index = tx_index.clone();
        let commit_times = commit_times.clone();
        let failures = write_failures.clone();
        tasks.push(tokio::spawn(async move {
            if let Err(error) = writer(k, shared, steady_start, window_end, tx_index, commit_times, failures).await {
                eprintln!("writer {k}: {error}");
            }
        }));
    }
    // pushers: the first connections, each pushing at its share of the rate
    let push_timeouts = Arc::new(AtomicU64::new(0));
    let pushes_sent = Arc::new(AtomicU64::new(0));
    let pusher_names: HashSet<String> = conns.iter().take(opts.pushers).map(|c| c.name.clone()).collect();
    if opts.pushers > 0 && opts.push_rate > 0.0 {
        let per_pusher = Duration::from_secs_f64(opts.pushers as f64 / opts.push_rate);
        for (k, conn) in conns.iter().take(opts.pushers).enumerate() {
            let conn = conn.clone();
            let shared = shared.clone();
            let timeouts = push_timeouts.clone();
            let sent = pushes_sent.clone();
            tasks.push(tokio::spawn(async move {
                let mut rng = XorShift64::new(0xB0B + k as u64);
                let mut due = steady_start + per_pusher.mul_f64(k as f64 / opts_pushers(&shared) as f64);
                while due < window_end {
                    tokio::time::sleep_until(due.into()).await;
                    if conn.closed.load(Ordering::Relaxed) {
                        break;
                    }
                    sent.fetch_add(1, Ordering::Relaxed);
                    if conn
                        .push_reply(&shared, rng.next_u64(), Duration::from_secs(30))
                        .await
                        .is_none()
                    {
                        timeouts.fetch_add(1, Ordering::Relaxed);
                    }
                    due += per_pusher;
                }
            }));
        }
    }
    // churn: a client closes and a fresh tab of the same user takes its place
    let conns_shared = Arc::new(Mutex::new(conns));
    let rehydrate = Arc::new(Mutex::new(Vec::<f64>::new()));
    let churned = Arc::new(AtomicU64::new(0));
    let churn_failures = Arc::new(AtomicU64::new(0));
    let retired = Arc::new(Mutex::new(Vec::<Arc<Conn>>::new()));
    if opts.churn > 0.0 {
        let shared = shared.clone();
        let conns_shared = conns_shared.clone();
        let rehydrate = rehydrate.clone();
        let churned = churned.clone();
        let churn_failures = churn_failures.clone();
        let retired = retired.clone();
        let counter = counter.clone();
        let pusher_names = pusher_names.clone();
        tasks.push(tokio::spawn(async move {
            let every = Duration::from_secs_f64(1.0 / opts.churn);
            let mut rng = XorShift64::new(0xC0FFEE);
            let mut due = steady_start + every;
            while due < window_end {
                tokio::time::sleep_until(due.into()).await;
                due += every;
                let victim = {
                    let conns = conns_shared.lock().unwrap();
                    let candidates: Vec<usize> = (0..conns.len())
                        .filter(|&i| !pusher_names.contains(&conns[i].name))
                        .collect();
                    if candidates.is_empty() {
                        continue;
                    }
                    candidates[rng.index(candidates.len())]
                };
                let old = conns_shared.lock().unwrap()[victim].clone();
                // The old tab stops being owed rows before its socket closes,
                // and counts none from here on; the fresh one is owed every
                // row committed from before its socket opens, since those
                // reach it in its hydration or after.
                old.closing.store(true, Ordering::Relaxed);
                shared.topology.lock().unwrap().add(&old.profile, -1);
                old.close().await;
                let n = counter.fetch_add(1, Ordering::Relaxed);
                let opened = Instant::now();
                let owed_from = nanos_at(opened);
                shared.topology.lock().unwrap().add(&old.profile, 1);
                match Conn::open(&shared, old.name.clone(), old.profile.clone(), n, Some(owed_from)).await {
                    Ok(fresh) => {
                        if fresh.wait_hydrated(Duration::from_secs(60)).await {
                            rehydrate
                                .lock()
                                .unwrap()
                                .push(opened.elapsed().as_secs_f64() * 1000.0);
                        } else {
                            churn_failures.fetch_add(1, Ordering::Relaxed);
                        }
                        let previous = std::mem::replace(&mut conns_shared.lock().unwrap()[victim], fresh);
                        retired.lock().unwrap().push(previous);
                        churned.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(error) => {
                        shared.topology.lock().unwrap().add(&old.profile, -1);
                        churn_failures.fetch_add(1, Ordering::Relaxed);
                        eprintln!("churn: {error}");
                    }
                }
            }
        }));
    }

    // the measured window
    tokio::time::sleep_until(window_start.into()).await;
    let wal_start = pg
        .query_one("SELECT pg_current_wal_lsn()::text", &[])
        .await
        .map(|row| lsn_bytes(row.get(0)))
        .unwrap_or(0);
    let _ = server_stats(&http, &server.http, true).await;
    for kind in KINDS {
        shared.expected[kind as usize].store(0, Ordering::Relaxed);
        shared.received[kind as usize].store(0, Ordering::Relaxed);
        shared.writes[kind as usize].store(0, Ordering::Relaxed);
    }
    commit_times.lock().unwrap().clear();
    rehydrate.lock().unwrap().clear();
    shared.window_start.store(nanos_at(window_start), Ordering::Release);
    let window_opened = Instant::now();
    println!("  measuring...");
    tokio::time::sleep_until(window_end.into()).await;
    let window_closed = Instant::now();
    shared.window_start.store(u64::MAX, Ordering::Release);
    let wal_end = pg
        .query_one("SELECT pg_current_wal_lsn()::text", &[])
        .await
        .map(|row| lsn_bytes(row.get(0)))
        .unwrap_or(0);
    for task in tasks {
        let _ = task.await;
    }
    // let the last rows land
    tokio::time::sleep(Duration::from_secs(3)).await;
    let stats_end = server_stats(&http, &server.http, false).await;
    sampler.stop();

    // ---- 5. report
    let measured_s = window_closed.duration_since(window_opened).as_secs_f64();
    let conns = conns_shared.lock().unwrap().clone();
    let retired = retired.lock().unwrap().clone();
    let all_conns: Vec<Arc<Conn>> = conns.iter().chain(retired.iter()).cloned().collect();

    println!("\n== 5. steady: writes and delivery ({} s measured) ==", fmt1(measured_s));
    let total_writes: u64 = KINDS.iter().map(|k| shared.writes[*k as usize].load(Ordering::Relaxed)).sum();
    let transactions = tx_index.load(Ordering::Relaxed);
    let mut commit_ms: Vec<f64> = commit_times.lock().unwrap().iter().map(|&ns| ms(ns)).collect();
    let commit = Pct::of(&mut commit_ms);
    let wal_mb = wal_end.saturating_sub(wal_start) as f64 / 1e6;
    println!(
        "  {} writes in {} transactions ({} writes/s, {} tx/s); {} pushes ({}/s); WAL {} MB ({} MB/s); commit p50/p99 {} / {} ms; {} write failures",
        total_writes,
        commit.n,
        fmt0(total_writes as f64 / measured_s),
        fmt1(commit.n as f64 / measured_s),
        pushes_sent.load(Ordering::Relaxed),
        fmt1(pushes_sent.load(Ordering::Relaxed) as f64 / measured_s),
        fmt1(wal_mb),
        fmt2(wal_mb / measured_s),
        fmt1(commit.p50),
        fmt1(commit.p99),
        write_failures.load(Ordering::Relaxed)
    );
    let _ = transactions;
    let mut delivery_rows = Vec::new();
    let mut delivery_json = serde_json::Map::new();
    let mut all_latencies: Vec<f64> = Vec::new();
    let mut delivered_total = 0u64;
    let mut expected_total = 0u64;
    let mut short = Vec::new();
    for kind in KINDS {
        let mut latencies: Vec<f64> = all_conns
            .iter()
            .flat_map(|c| {
                c.deliveries
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(k, _)| *k == kind)
                    .map(|(_, ns)| ms(*ns))
                    .collect::<Vec<_>>()
            })
            .collect();
        all_latencies.extend(latencies.iter().copied());
        let pct = Pct::of(&mut latencies);
        let writes = shared.writes[kind as usize].load(Ordering::Relaxed);
        let expected = shared.expected[kind as usize].load(Ordering::Relaxed);
        let received = shared.received[kind as usize].load(Ordering::Relaxed);
        delivered_total += received;
        expected_total += expected;
        let ratio = if expected == 0 { 100.0 } else { received as f64 * 100.0 / expected as f64 };
        if expected > 0 && ratio < 99.5 {
            short.push(format!("{}: {received}/{expected}", kind.name()));
        }
        delivery_rows.push(vec![
            kind.name().to_owned(),
            writes.to_string(),
            expected.to_string(),
            received.to_string(),
            format!("{ratio:.1}%"),
            fmt1(pct.p50),
            fmt1(pct.p90),
            fmt1(pct.p99),
            fmt1(pct.max),
        ]);
        delivery_json.insert(
            kind.name().to_owned(),
            json!({"writes": writes, "expected": expected, "received": received, "latency_ms": pct.json()}),
        );
    }
    let all_pct = Pct::of(&mut all_latencies);
    delivery_rows.push(vec![
        "all rows".to_owned(),
        total_writes.to_string(),
        expected_total.to_string(),
        delivered_total.to_string(),
        format!(
            "{:.1}%",
            if expected_total == 0 { 100.0 } else { delivered_total as f64 * 100.0 / expected_total as f64 }
        ),
        fmt1(all_pct.p50),
        fmt1(all_pct.p90),
        fmt1(all_pct.p99),
        fmt1(all_pct.max),
    ]);
    println!("  commit → client latency by kind of row (ms):");
    print_table(
        &["row", "writes", "expected", "received", "delivered", "p50", "p90", "p99", "max"],
        &delivery_rows,
    );
    let rows_delivered: u64 = all_conns.iter().map(|c| c.rows.load(Ordering::Relaxed)).sum();
    let bytes_delivered: u64 = all_conns.iter().map(|c| c.bytes.load(Ordering::Relaxed)).sum();
    println!(
        "  row operations received over the whole run: {} ({} MB); matched deliveries over the window: {}/s",
        rows_delivered,
        fmt1(bytes_delivered as f64 / 1e6),
        fmt0(delivered_total as f64 / measured_s)
    );
    let mut acks: Vec<f64> = all_conns
        .iter()
        .flat_map(|c| c.acks.lock().unwrap().iter().map(|&ns| ms(ns)).collect::<Vec<_>>())
        .collect();
    let ack = Pct::of(&mut acks);
    let mut rehydrate_ms = rehydrate.lock().unwrap().clone();
    let rehydrated = Pct::of(&mut rehydrate_ms);
    print_table(
        &["clients", "n", "p50", "p90", "p99", "max"],
        &[
            pct_row("push → acknowledged (ms)", &ack, fmt1),
            pct_row("hydrate under load, churned tab (ms)", &rehydrated, fmt1),
            pct_row("PostgreSQL commit (ms)", &commit, fmt1),
        ],
    );
    let dropped = all_conns
        .iter()
        .filter(|c| c.closed.load(Ordering::Relaxed) && !c.closing.load(Ordering::Relaxed))
        .count();
    let conn_errors: Vec<String> = all_conns
        .iter()
        .flat_map(|c| c.errors.lock().unwrap().clone())
        .collect();
    let app_failures = app.failures.lock().unwrap().clone();
    println!(
        "  churned {} clients ({} failed); dropped connections {}; connection errors {}; push timeouts {}; application server: {} transforms, {} pushes, {} cleanups, {} failures",
        churned.load(Ordering::Relaxed),
        churn_failures.load(Ordering::Relaxed),
        dropped,
        conn_errors.len(),
        push_timeouts.load(Ordering::Relaxed),
        app.transforms.load(Ordering::Relaxed),
        app.pushes.load(Ordering::Relaxed),
        app.cleanups.load(Ordering::Relaxed),
        app_failures.len()
    );
    if let Some(first) = conn_errors.first() {
        println!("  first connection error: {first}");
    }
    if let Some(first) = app_failures.first() {
        println!("  first application failure: {first}");
    }
    if stamps.overflow.load(Ordering::Relaxed) > 0 {
        println!(
            "  note: {} writes were past the stamp table and not measured",
            stamps.overflow.load(Ordering::Relaxed)
        );
    }

    // ---- 6. the process
    println!(
        "\n== 6. server process, sampled every {} ms over the measured window ==",
        opts.sample_ms
    );
    let samples = sampler.between(window_opened, window_closed);
    let (process_rows, process_json) = process_report(&samples);
    if server.pid.is_some() && !samples.is_empty() {
        print_table(&["measure", "samples", "p50", "p90", "p99", "max"], &process_rows);
    } else {
        println!("  no process to sample (attach with --pid, or start the server from here)");
    }

    // ---- 7. the server's own stages
    let mut stages_json = Json::Null;
    if let Some(stats) = &stats_end {
        println!("\n== 7. server stages over the window (/stats) ==");
        print_stages(stats);
        let counts = stats.get("counts").cloned().unwrap_or(Json::Null);
        let gauges = stats.get("gauges").cloned().unwrap_or(Json::Null);
        let held = stats.get("held").cloned().unwrap_or(Json::Null);
        let count = |k: &str| counts.get(k).and_then(Json::as_u64).unwrap_or(0);
        println!(
            "  counts: {} transactions, {} writes, {} pokes, {} frames, {} rows serialized, {} rows shared, {} partial rows; held: {} subscriptions, {} trees, {} rows; gauges: {} sockets, {} groups, rss {} MB",
            count("transactions"), count("writes"), count("pokes"), count("frames"), count("rows_serialized"),
            count("rows_shared"), count("partial_rows_sent"),
            held.get("subscriptions").and_then(Json::as_u64).unwrap_or(0),
            held.get("trees").and_then(Json::as_u64).unwrap_or(0),
            held.get("rows_by_table").and_then(Json::as_object).map_or(0, |m| m.values().filter_map(Json::as_u64).sum::<u64>()),
            gauges.get("connections_open").and_then(Json::as_u64).unwrap_or(0),
            gauges.get("client_groups").and_then(Json::as_u64).unwrap_or(0),
            gauges.get("process_rss_bytes").and_then(Json::as_u64).unwrap_or(0) / 1_000_000,
        );
        stages_json = stats.clone();
    }

    // ---- verdict and the file
    let passed = short.is_empty()
        && dropped == 0
        && conn_errors.is_empty()
        && push_timeouts.load(Ordering::Relaxed) == 0
        && write_failures.load(Ordering::Relaxed) == 0
        && app_failures.is_empty()
        && hydrated == opts.connections;
    if !short.is_empty() {
        println!("\n  short deliveries: {}", short.join("; "));
    }
    report["phases"]["steady"] = json!({
        "measured_s": measured_s, "writes": total_writes, "transactions": commit.n,
        "writes_per_s": total_writes as f64 / measured_s, "pushes": pushes_sent.load(Ordering::Relaxed),
        "wal_mb": wal_mb, "wal_mb_per_s": wal_mb / measured_s, "commit_ms": commit.json(),
        "delivery": Json::Object(delivery_json), "all_rows_latency_ms": all_pct.json(),
        "expected": expected_total, "received": delivered_total,
        "push_ack_ms": ack.json(), "rehydrate_ms": rehydrated.json(),
        "churned": churned.load(Ordering::Relaxed), "churn_failures": churn_failures.load(Ordering::Relaxed),
        "dropped_connections": dropped, "connection_errors": conn_errors.len(),
        "push_timeouts": push_timeouts.load(Ordering::Relaxed), "write_failures": write_failures.load(Ordering::Relaxed),
        "app": {"transforms": app.transforms.load(Ordering::Relaxed), "pushes": app.pushes.load(Ordering::Relaxed),
                "cleanups": app.cleanups.load(Ordering::Relaxed), "failures": app_failures.len()},
    });
    report["process"] = Json::Object(process_json);
    report["phases"]["hydrate"]["process"] = Json::Object(process_report(&hydrate_samples).1);
    report["server_stats"] = stages_json;
    report["passed"] = json!(passed);
    report["total_s"] = json!(started.elapsed().as_secs_f64());
    if let Some(path) = &opts.out {
        if let Some(parent) = std::path::Path::new(path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(path, serde_json::to_string_pretty(&report).unwrap_or_default())
            .map_err(|error| format!("writing {path}: {error}"))?;
        println!("\n  wrote {path}");
    }

    // ---- tidy up
    for conn in &conns {
        conn.close().await;
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    server.stop();
    let _ = pg
        .batch_execute(
            "SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots \
             WHERE slot_name LIKE 'xyne_sync_%' AND NOT active AND database = current_database()",
        )
        .await;
    println!("\ntotal wall time: {} s", fmt1(started.elapsed().as_secs_f64()));
    Ok(passed)
}

/// The pusher count, as a float divisor.
fn opts_pushers(shared: &Shared) -> usize {
    shared.opts.pushers.max(1)
}
