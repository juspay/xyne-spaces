//! The change feed: a logical replication connection on a permanent slot,
//! streaming the `pgoutput` plugin's messages, turned into [`WriteQuery`]s
//! positioned at the **end of their transaction's commit record**. A
//! snapshot taken at a consistent point `X` holds exactly the writes
//! positioned at or below `X`, so that is the position every read is
//! compared against.
//!
//! The transport is `pgwire-replication` (startup, authentication,
//! `START_REPLICATION`, standby feedback; it decodes the transaction
//! boundaries) and the row messages are decoded by the `pgoutput` crate;
//! this module only maps decoded tuples onto the catalog's tables and
//! types.
//!
//! # Where the feed is
//!
//! The feed writes nothing to the database, so it follows a primary, a
//! logical replica and a physical standby alike. Its position comes from
//! what the server sends anyway. A **commit** carries the end of its
//! record, and decoding emits whole transactions in commit order, so
//! every transaction committed before it has been delivered. A
//! **keepalive** carries the location the server has decoded up to: the
//! server sends one whenever it has gone through log that held nothing
//! for this slot (another database's writes, a vacuum, a checkpoint, the
//! record a snapshot's slot is built from) and is about to wait for more,
//! as long as that location is past what the feed has confirmed; every
//! transaction that committed at or below it was sent before it on the
//! same connection. Both are confirmed back to the slot, so the server
//! keeps no log for a feed that is only idle. While the log stands still
//! the position does too, and nothing is owed: a snapshot cannot be
//! ahead of a log that has not moved.
//!
//! # A feed that has gone silent
//!
//! A connection can die without either end being told (a network that
//! drops its state, a machine that slept): nothing arrives, nothing
//! fails, and a server that went on serving would be serving what it
//! last knew. Silence alone does not say so: an idle database is silent,
//! and so is a server working through a long stretch of log that holds
//! nothing for this slot. What does say so is the slot: while this
//! connection lives, PostgreSQL shows the slot as held by its walsender,
//! and when the walsender has given up on a peer it no longer hears
//! (`wal_sender_timeout`), the slot is free. So once nothing has been
//! heard for [`SILENCE`] the server is asked, on a fresh ordinary
//! connection, whether the slot is still held (a read), and asked again
//! every half of that while the silence lasts. A slot nobody holds means
//! this connection is dead: it is given up and the caller reopens the
//! slot, which resumes after the last position the server had confirmed.
//! A server that cannot be asked proves nothing, and the feed waits.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use bytes::Bytes;
use pgoutput::events::base::event::BaseEvent;
use pgoutput::events::base::tuple_data::{
    OldDataOrPrimaryKeyTupleData, TupleData, TupleDataColumn,
};
use pgoutput::events::event::{Event, EventType};
use pgoutput::options::{BinaryValueTraitOff, StreamingValueTraitOff};
use pgwire_replication::{ReplicationClient, ReplicationConfig, ReplicationEvent, TlsConfig};
use tokio::sync::mpsc;
use tokio::sync::watch;
use tokio::time::MissedTickBehavior;
use tokio_postgres::Client;
use tokio_postgres::config::Host;
use tokio_postgres::error::SqlState;
use tokio_postgres::types::PgLsn;

use super::ddl::{self, DdlSource};
use crate::ivm::SchemaChange;
use crate::log::{log_info, log_warn};
use crate::model::{
    Catalog, ColumnName, DataFrameKey, DataFrameRow, DbTable, DeleteQuery, InsertQuery, Lsn,
    RowData, TableName, UpdateQuery, Value, ValueType, WriteQuery,
};
use crate::sync::service::{Command, Transaction as Committed};
use crate::sync::storage::StorageError;

/// The message set the feed asks for: text values, whole transactions
/// (no streaming of in-progress ones).
type Decoded = Event<BinaryValueTraitOff, StreamingValueTraitOff>;

/// One tuple as decoded: a value, `NULL`, or an unchanged TOAST marker per
/// column, in the relation's column order.
type Columns = TupleData<BinaryValueTraitOff>;

/// The type of a `json` column as a relation message names it. Its cells
/// arrive as the text that was stored, where a `jsonb` column's arrive as
/// the one text `jsonb` writes.
const JSON_OID: i32 = 114;

/// How long a poll waits for the feed to reach the server's position
/// before failing.
const POLL_WAIT: Duration = Duration::from_secs(10);

/// How long the feed may hear nothing before the server is asked whether
/// the slot is still held, and asked again every half of this while the
/// silence lasts.
const SILENCE: Duration = Duration::from_secs(10);

/// How long the server is given to say whether the slot is held; no
/// answer proves nothing.
const ASK_WAIT: Duration = Duration::from_secs(5);

/// One poll's yield: the writes delivered since the last poll, in commit
/// order, each at its position; and the position the feed is known to
/// have delivered everything up to.
#[derive(Debug)]
pub struct Batch {
    pub writes: Vec<(WriteQuery, Lsn)>,
    pub progress: Lsn,
}

/// One decoded transaction: the end of its commit record (the position of
/// its writes), its writes on catalog tables (none when it touched no
/// table the catalog declares), the schema changes it carried with the
/// catalog they make (`None` when it carried none), when it committed and
/// how long decoding it took.
#[derive(Debug)]
pub struct Transaction {
    pub at: Lsn,
    pub writes: Vec<WriteQuery>,
    pub schema: Vec<SchemaChange>,
    pub catalog: Option<Arc<Catalog>>,
    pub committed_at_micros: i64,
    pub decode: Duration,
}

/// One published table as the feed described it: the catalog table it
/// maps to (`None` for a table the catalog does not declare) and its
/// columns in message order.
struct Relation {
    table: Option<TableName>,
    columns: Vec<Described>,
}

/// One column of a published table as the feed described it: its name,
/// and whether it is a `json` column, whose cells are rewritten into the
/// standard form as they are decoded.
struct Described {
    name: ColumnName,
    plain_json: bool,
}

/// The mapping of decoded messages onto catalog writes: the catalog as
/// the feed has it (it grows as the trigger's messages arrive, so a row
/// after a change is decoded on the shape it was written in), the
/// relations announced so far and the transaction being collected.
pub struct Decoder {
    catalog: Arc<Catalog>,
    relations: HashMap<i32, Relation>,
    pending: Vec<WriteQuery>,
    /// Where schema changes are heard, when they are heard at all.
    ddl: Option<DdlSource>,
    /// The schema changes absorbed since a transaction was last yielded,
    /// for the next one to carry. They outlive a lost connection on
    /// purpose: a transaction cut off before its commit is streamed again
    /// from its start, its messages then mean nothing against a catalog
    /// that already has them, and the engine must still be told.
    changes: Vec<SchemaChange>,
    decode: Duration,
}

impl Decoder {
    /// A decoder over `catalog` that hears of no schema change.
    pub fn new(catalog: Arc<Catalog>) -> Self {
        Decoder {
            catalog,
            relations: HashMap::new(),
            pending: Vec::new(),
            ddl: None,
            changes: Vec::new(),
            decode: Duration::ZERO,
        }
    }

    /// A decoder over `catalog` that follows the schema changes `ddl`
    /// announces.
    pub fn with_ddl(catalog: Arc<Catalog>, ddl: DdlSource) -> Self {
        Decoder {
            ddl: Some(ddl),
            ..Self::new(catalog)
        }
    }

    /// The catalog as the feed has it.
    pub fn catalog(&self) -> &Arc<Catalog> {
        &self.catalog
    }

    /// Absorb one event; a `Commit` yields the finished transaction, which
    /// carries the time the feed thread spent decoding it.
    pub fn absorb(&mut self, event: ReplicationEvent) -> Result<Option<Transaction>, StorageError> {
        let started = Instant::now();
        let mut outcome = self.absorb_event(event);
        self.decode += started.elapsed();
        if let Ok(Some(transaction)) = &mut outcome {
            transaction.decode = std::mem::take(&mut self.decode);
        }
        outcome
    }

    /// Absorb one event.
    fn absorb_event(
        &mut self,
        event: ReplicationEvent,
    ) -> Result<Option<Transaction>, StorageError> {
        match event {
            ReplicationEvent::Begin { .. } => {
                self.pending.clear();
                Ok(None)
            }
            ReplicationEvent::Commit {
                end_lsn,
                commit_time_micros,
                ..
            } => {
                let schema = std::mem::take(&mut self.changes);
                Ok(Some(Transaction {
                    at: position(end_lsn),
                    writes: std::mem::take(&mut self.pending),
                    catalog: (!schema.is_empty()).then(|| self.catalog.clone()),
                    schema,
                    committed_at_micros: commit_time_micros,
                    decode: Duration::ZERO,
                }))
            }
            ReplicationEvent::XLogData { data, .. } => {
                self.decode(&data)?;
                Ok(None)
            }
            ReplicationEvent::Message {
                prefix,
                content,
                lsn,
                ..
            } => {
                if self.ddl.as_ref().is_some_and(|ddl| ddl.prefix == prefix) {
                    self.migrate(position(lsn), &content)?;
                }
                Ok(None)
            }
            ReplicationEvent::KeepAlive { .. } | ReplicationEvent::StoppedAt { .. } => Ok(None),
        }
    }

    /// Absorb one message of the trigger, written at `at`: the catalog
    /// becomes what the message makes of it, every row decoded from here
    /// on is laid out on that, and the changes wait for the commit that
    /// carries them. A message that changes nothing the catalog carries
    /// leaves everything as it was. A change the server cannot follow, or
    /// a message it cannot read, is the error that stops the feed, and
    /// with it the server; restarted, it loads the catalog as it is then.
    fn migrate(&mut self, at: Lsn, content: &Bytes) -> Result<(), StorageError> {
        let Some(source) = &self.ddl else {
            return Ok(());
        };
        let text = std::str::from_utf8(content)
            .map_err(|_| StorageError(format!("the DDL message at {at} is not UTF-8")))?;
        let message = ddl::DdlMessage::parse(text)
            .map_err(|reason| StorageError(format!("the DDL message at {at}: {reason}")))?;
        if !message.is_update() {
            return Ok(());
        }
        let classified =
            ddl::classify(&self.catalog, &source.schemas, &message).map_err(|reason| {
                StorageError(format!(
                    "schema change at {at} ({}) the server cannot follow: {reason}; the server stops here and, restarted, serves the schema as it is now",
                    message.tag()
                ))
            })?;
        if classified.changes.is_empty() {
            return Ok(());
        }
        for change in &classified.changes {
            log_info!("schema change at {at} ({}): {change}", message.tag());
        }
        self.catalog = Arc::new(classified.catalog);
        self.changes.extend(classified.changes);
        Ok(())
    }

    /// Map one `pgoutput` row message onto the pending transaction.
    fn decode(&mut self, data: &Bytes) -> Result<(), StorageError> {
        let Some((&tag, body)) = data.split_first() else {
            return Err(StorageError("empty pgoutput message".to_owned()));
        };
        let kind = EventType::from_char(tag)
            .ok_or_else(|| StorageError(format!("unknown pgoutput message `{}`", tag as char)))?;
        let event = Decoded::parse(&kind, body).map_err(StorageError)?;
        let Event::Base(event) = event else {
            return Ok(());
        };
        if let BaseEvent::Relation(relation) = &event {
            let qualified = format!("{}.{}", relation.relation_namespace, relation.name);
            let declared = self.catalog.table(&qualified).or_else(|| {
                (relation.relation_namespace == "public")
                    .then(|| self.catalog.table(&relation.name))
                    .flatten()
            });
            self.relations.insert(
                relation.oid,
                Relation {
                    table: declared.map(|table| table.name.clone()),
                    columns: relation
                        .columns
                        .iter()
                        .map(|column| Described {
                            name: ColumnName::from(column.name.as_str()),
                            plain_json: column.oid == JSON_OID,
                        })
                        .collect(),
                },
            );
            return Ok(());
        }
        let writes = self.writes_of(&event)?;
        self.pending.extend(writes);
        Ok(())
    }

    /// The catalog writes one row message stands for: none for a table
    /// the catalog does not declare, two for a primary-key change.
    fn writes_of(
        &self,
        event: &BaseEvent<BinaryValueTraitOff, StreamingValueTraitOff>,
    ) -> Result<Vec<WriteQuery>, StorageError> {
        match event {
            BaseEvent::Insert(insert) => {
                let Some((table, columns)) = self.declared(insert.oid) else {
                    return Ok(Vec::new());
                };
                let row = image(table, columns, &insert.data)?;
                Ok(vec![WriteQuery::INSERT(InsertQuery {
                    table: table.name.clone(),
                    pkey_value: key_of(&row, table),
                    record: row,
                })])
            }
            BaseEvent::Update(update) => {
                let Some((table, columns)) = self.declared(update.oid) else {
                    return Ok(Vec::new());
                };
                let new = image(table, columns, &update.data)?;
                let new_key = key_of(&new, table);
                let old_key = match &update.old_data_or_primary_key {
                    Some(OldDataOrPrimaryKeyTupleData::PrimaryKeyTupleData(old))
                    | Some(OldDataOrPrimaryKeyTupleData::OldTupleData(old)) => {
                        Some(key_of(&image(table, columns, old)?, table))
                    }
                    None => None,
                };
                match old_key.filter(|old_key| *old_key != new_key) {
                    Some(old_key) => Ok(vec![
                        WriteQuery::DELETE(DeleteQuery {
                            table: table.name.clone(),
                            pkey_value: old_key,
                        }),
                        WriteQuery::INSERT(InsertQuery {
                            table: table.name.clone(),
                            pkey_value: new_key,
                            record: new,
                        }),
                    ]),
                    None => Ok(vec![WriteQuery::UPDATE(UpdateQuery {
                        table: table.name.clone(),
                        pkey_value: new_key,
                        record: new,
                    })]),
                }
            }
            BaseEvent::Delete(delete) => {
                let Some((table, columns)) = self.declared(delete.oid) else {
                    return Ok(Vec::new());
                };
                let old = match &delete.old_data_or_primary_key {
                    Some(OldDataOrPrimaryKeyTupleData::PrimaryKeyTupleData(old))
                    | Some(OldDataOrPrimaryKeyTupleData::OldTupleData(old)) => old,
                    None => {
                        return Err(StorageError(format!(
                            "a DELETE on `{}` arrived without its key; the table needs a primary key or REPLICA IDENTITY",
                            table.name
                        )));
                    }
                };
                Ok(vec![WriteQuery::DELETE(DeleteQuery {
                    table: table.name.clone(),
                    pkey_value: key_of(&image(table, columns, old)?, table),
                })])
            }
            BaseEvent::Truncate(_) => Err(StorageError(
                "TRUNCATE on a published table is not supported: the frames cannot follow it"
                    .to_owned(),
            )),
            BaseEvent::Relation(_)
            | BaseEvent::Begin(_)
            | BaseEvent::Commit(_)
            | BaseEvent::Type(_) => Ok(Vec::new()),
        }
    }

    /// The catalog table and column order of relation `oid`, if the feed
    /// announced it and the catalog declares it.
    fn declared(&self, oid: i32) -> Option<(&DbTable, &[Described])> {
        let relation = self.relations.get(&oid)?;
        let table = self.catalog.table(relation.table.as_ref()?.as_str())?;
        Some((table, &relation.columns))
    }
}

/// The change feed over one replication slot: the transport half (the
/// replication connection) and the decoding half (the catalog-driven
/// decoder and the delivered position), together with an ordinary
/// connection for a single-threaded driver that polls, or split
/// ([`PgStream::split`]) so both halves run on a thread of their own
/// ([`Transport::stream`]) and hand decoded transactions to the engine
/// over a channel.
pub struct PgStream {
    transport: Transport,
    feed: Feed,
    client: Client,
}

/// The replication connection of a change feed on `slot`, and how to
/// reach the same server on an ordinary connection to ask about the slot.
/// Nothing in it is tied to a thread: it receives raw replication events
/// and confirms positions back to the slot.
pub struct Transport {
    feed: ReplicationClient,
    config: tokio_postgres::Config,
    slot: String,
}

/// A feed's silence, watched: when it was last heard, and when the server
/// was last asked about the slot.
struct Watch {
    heard: Instant,
    asked: Instant,
}

impl Watch {
    /// A feed heard just now.
    fn new() -> Self {
        let now = Instant::now();
        Watch {
            heard: now,
            asked: now,
        }
    }

    /// The feed was heard.
    fn heard(&mut self) {
        self.heard = Instant::now();
    }

    /// Whether it is time to ask the server about the slot as of `now`:
    /// nothing heard for [`SILENCE`], and not asked within half of it.
    /// Asking is noted, so the next is due half a silence later.
    fn due(&mut self, now: Instant) -> bool {
        let due = now.duration_since(self.heard) >= SILENCE
            && now.duration_since(self.asked) >= SILENCE / 2;
        if due {
            self.asked = now;
        }
        due
    }
}

/// The decoding half of a change feed: raw events in, catalog writes and
/// the delivered position out.
pub struct Feed {
    decoder: Decoder,
    progress: Lsn,
}

impl Transport {
    /// Open the replication connection to `dsn` on `slot`, streaming
    /// `publication`, after [`Transport::prepare`]. The slot is never
    /// created here: one that has gone missing since it was prepared
    /// would come back at the server's current position and skip every
    /// change in between, so its absence is an error
    /// ([`Transport::slot_exists`] tells it apart).
    pub async fn open(dsn: &str, slot: &str, publication: &str) -> Result<Self, StorageError> {
        let config: tokio_postgres::Config = dsn.parse()?;
        require_slot(&config, slot).await?;
        Self::connect(config, slot, publication).await
    }

    /// [`Transport::open`], the slot first moved up to `start` when it is
    /// behind it: the point the first read snapshot was taken at, so that
    /// nothing the snapshot already holds is streamed, and, after a stop
    /// on a schema change, the change is not met again. A slot at or past
    /// `start` is left where it is.
    pub async fn open_from(
        dsn: &str,
        slot: &str,
        publication: &str,
        start: Lsn,
    ) -> Result<Self, StorageError> {
        let config: tokio_postgres::Config = dsn.parse()?;
        let client = require_slot(&config, slot).await?;
        advance_slot(&client, slot, start).await?;
        Self::connect(config, slot, publication).await
    }

    /// Check that the deployment-provided `publication` exists and create
    /// this process's fresh feed `slot`. Done before the first read snapshot
    /// is minted, so that the slot holds the log from before that snapshot's
    /// point. The server never creates publications: that DDL belongs to
    /// deployment setup and must not race among pods at startup.
    pub async fn prepare(dsn: &str, slot: &str, publication: &str) -> Result<(), StorageError> {
        let config: tokio_postgres::Config = dsn.parse()?;
        prepare_slot(&config, slot, publication).await.map(drop)
    }

    /// Drop only our own permanent slots that PostgreSQL has reported
    /// inactive for at least `age`. A zero age disables cleanup. PostgreSQL
    /// added `inactive_since` in version 17; refusing to guess on older
    /// versions is safer than deleting a slot during a live reconnect.
    pub async fn cleanup_inactive_slots(dsn: &str, age: Duration) -> Result<(), StorageError> {
        if age.is_zero() {
            return Ok(());
        }
        let config: tokio_postgres::Config = dsn.parse()?;
        let client = super::open(&config, &tokio::runtime::Handle::current()).await?;
        let version: i32 = client
            .query_one("SELECT current_setting('server_version_num')::int", &[])
            .await?
            .get(0);
        if version < 170_000 {
            return Err(StorageError(format!(
                "STREAMGRES_SLOT_CLEANUP_AGE_MS requires PostgreSQL 17 or later (server is {version}); PostgreSQL 16 has no inactive_since timestamp, so safe age-bounded cleanup is impossible"
            )));
        }
        let age_ms = i64::try_from(age.as_millis()).unwrap_or(i64::MAX);
        let prefix = "xyne_sync_slot_";
        let slots = client
            .query(
                "SELECT slot_name FROM pg_replication_slots \
                 WHERE left(slot_name, length($1)) = $1 \
                   AND NOT temporary AND NOT active \
                 AND inactive_since <= clock_timestamp() - $2::bigint * interval '1 millisecond'",
                &[&prefix, &age_ms],
            )
            .await?;
        for row in slots {
            let slot: String = row.get(0);
            match client
                .execute("SELECT pg_drop_replication_slot($1)", &[&slot])
                .await
            {
                Ok(_) => log_info!("dropped inactive replication slot {slot} after {age:?}"),
                // A feed may have claimed the slot after the candidate query.
                // PostgreSQL refuses to drop an active slot; leave it alone.
                Err(error) if error.code() == Some(&SqlState::OBJECT_IN_USE) => {
                    log_info!(
                        "inactive replication slot {slot} became active during cleanup; keeping it"
                    )
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    /// Whether `slot` exists at `dsn`.
    pub async fn slot_exists(dsn: &str, slot: &str) -> Result<bool, StorageError> {
        let config: tokio_postgres::Config = dsn.parse()?;
        let client = super::open(&config, &tokio::runtime::Handle::current()).await?;
        Ok(client
            .query_opt(
                "SELECT 1 FROM pg_replication_slots WHERE slot_name = $1",
                &[&slot],
            )
            .await?
            .is_some())
    }

    /// Drop `slot`, ending the walsender holding it first (the drop is
    /// retried while it lets go).
    pub async fn drop_slot_only(dsn: &str, slot: &str) -> Result<(), StorageError> {
        let config: tokio_postgres::Config = dsn.parse()?;
        let client = super::open(&config, &tokio::runtime::Handle::current()).await?;
        client
            .execute(
                "SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots WHERE slot_name = $1 AND active_pid IS NOT NULL",
                &[&slot],
            )
            .await?;
        let mut attempts = 0;
        loop {
            let dropped = client
                .execute(
                    "SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1",
                    &[&slot],
                )
                .await;
            match dropped {
                Ok(_) => break,
                Err(_) if attempts < 40 => {
                    attempts += 1;
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    /// The replication connection on `slot`, streaming `publication`.
    async fn connect(
        config: tokio_postgres::Config,
        slot: &str,
        publication: &str,
    ) -> Result<Self, StorageError> {
        let feed = ReplicationClient::connect(replication_config(&config, slot, publication))
            .await
            .map_err(|error| StorageError(format!("replication connection: {error}")))?;
        Ok(Transport {
            feed,
            config,
            slot: slot.to_owned(),
        })
    }

    /// Whether a walsender still holds the slot, asked on a fresh
    /// connection (one kept from before could be as dead as the feed).
    /// While this replication connection lives the answer is yes; no
    /// answer within [`ASK_WAIT`], or a server that cannot be reached,
    /// counts as yes too, since it proves nothing.
    async fn slot_is_held(&self) -> bool {
        let asked = tokio::time::timeout(ASK_WAIT, async {
            let client = super::open(&self.config, &tokio::runtime::Handle::current()).await?;
            let row = client
                .query_opt(
                    "SELECT active FROM pg_replication_slots WHERE slot_name = $1",
                    &[&self.slot],
                )
                .await?;
            Ok::<bool, StorageError>(row.is_some_and(|row| row.get(0)))
        })
        .await;
        match asked {
            Ok(Ok(held)) => held,
            Ok(Err(error)) => {
                log_warn!("asking whether slot {} is held failed: {error}", self.slot);
                true
            }
            Err(_) => {
                log_warn!(
                    "the server did not say whether slot {} is held within {ASK_WAIT:?}",
                    self.slot
                );
                true
            }
        }
    }

    /// Tell the slot that everything up to `at` has been received.
    fn acknowledge(&mut self, at: Lsn) {
        self.feed.update_applied_lsn(pgwire_replication::Lsn(at.0));
    }

    /// Run until `out` has no receiver or the connection ends: decode
    /// every event as it arrives through `feed`, confirm the position it
    /// brought to the slot, and send each transaction on (its writes, its
    /// position, the feed's progress and the writes on the `watched`
    /// tables, once per commit). Once every `every` the engine is told
    /// the feed's position without a transaction to carry it
    /// ([`Committed::mark`]): that is how it learns of a keepalive, and
    /// what lets a snapshot minted while nothing was being written become
    /// current. A dropped connection ends the run quietly (the caller
    /// reopens the slot), and so does one that has gone silent while the
    /// server no longer holds the slot for it (see the module docs); a
    /// decoding failure ends it with the error.
    pub async fn stream(
        self,
        every: Duration,
        feed: &mut Feed,
        watched: &[TableName],
        out: mpsc::Sender<Committed>,
    ) -> Result<(), StorageError> {
        let (_stop, stop_rx) = watch::channel(false);
        self.stream_with_shutdown(every, feed, watched, out, stop_rx)
            .await
    }

    /// Like [`Transport::stream`], but also returns when `shutdown` is set.
    /// This lets graceful shutdown stop the replication connection before
    /// the permanent slot is removed.
    pub async fn stream_with_shutdown(
        mut self,
        every: Duration,
        feed: &mut Feed,
        watched: &[TableName],
        out: mpsc::Sender<Committed>,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<(), StorageError> {
        let mut ticker = tokio::time::interval(every);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut watch = Watch::new();
        loop {
            let event = tokio::select! {
                changed = shutdown.changed() => {
                    if changed.is_ok() && *shutdown.borrow() {
                        return Ok(());
                    }
                    continue;
                }
                _ = ticker.tick() => {
                    let position = feed.progress();
                    if position > Lsn(0) && out.send(Committed::mark(position)).await.is_err() {
                        return Ok(());
                    }
                    if watch.due(Instant::now()) && !self.slot_is_held().await {
                        log_warn!(
                            "the change feed has been silent for {:.0} s at {position} and no walsender holds slot {}; giving the connection up",
                            watch.heard.elapsed().as_secs_f64(),
                            self.slot
                        );
                        return Ok(());
                    }
                    continue;
                }
                event = self.feed.recv() => event,
            };
            let event = match event {
                Ok(Some(event)) => event,
                Ok(None) => return Ok(()),
                Err(error) => {
                    eprintln!("change feed ended: {error}");
                    return Ok(());
                }
            };
            heard();
            watch.heard();
            let transaction = feed.absorb(event)?;
            self.acknowledge(feed.progress());
            let Some(transaction) = transaction else {
                continue;
            };
            let watched_writes: Vec<WriteQuery> = transaction
                .writes
                .iter()
                .filter(|write| watched.contains(write.table()))
                .cloned()
                .collect();
            let committed = Committed {
                writes: transaction.writes,
                at: transaction.at,
                progress: feed.progress(),
                watched: watched_writes,
                schema: transaction.schema,
                catalog: transaction.catalog,
                received: Instant::now(),
                committed_at_micros: transaction.committed_at_micros,
                decode: transaction.decode,
            };
            if out.send(committed).await.is_err() {
                return Ok(());
            }
        }
    }
}

/// Require `publication` and create this process's new `slot` (see
/// [`Transport::prepare`]); the ordinary connection used.
async fn prepare_slot(
    config: &tokio_postgres::Config,
    slot: &str,
    publication: &str,
) -> Result<Client, StorageError> {
    let client = super::open(config, &tokio::runtime::Handle::current()).await?;
    let published = client
        .query_opt(
            "SELECT 1 FROM pg_publication WHERE pubname = $1",
            &[&publication],
        )
        .await?
        .is_some();
    if !published {
        return Err(StorageError(format!(
            "publication `{publication}` does not exist; create it before starting streamgres (for example, on the primary: CREATE PUBLICATION \"{publication}\" FOR ALL TABLES)"
        )));
    }
    let exists = client
        .query_opt(
            "SELECT 1 FROM pg_replication_slots WHERE slot_name = $1",
            &[&slot],
        )
        .await?
        .is_some();
    if !exists {
        client
            .execute(
                "SELECT pg_create_logical_replication_slot($1, 'pgoutput')",
                &[&slot],
            )
            .await?;
    }
    Ok(client)
}

/// An ordinary connection at `config`, once `slot` is known to exist
/// there; an error naming it when it does not.
async fn require_slot(config: &tokio_postgres::Config, slot: &str) -> Result<Client, StorageError> {
    let client = super::open(config, &tokio::runtime::Handle::current()).await?;
    let exists = client
        .query_opt(
            "SELECT 1 FROM pg_replication_slots WHERE slot_name = $1",
            &[&slot],
        )
        .await?
        .is_some();
    if exists {
        Ok(client)
    } else {
        Err(StorageError(format!("slot `{slot}` does not exist")))
    }
}

/// Move `slot` up to `to` when its confirmed position is behind it,
/// first ending a walsender still holding it (one left by an earlier
/// process; the server itself holds the slot on no other connection
/// while it opens the feed). A slot at or past `to` is left alone.
async fn advance_slot(client: &Client, slot: &str, to: Lsn) -> Result<(), StorageError> {
    let mut attempts = 0;
    loop {
        let row = client
            .query_opt(
                "SELECT confirmed_flush_lsn, active_pid FROM pg_replication_slots WHERE slot_name = $1",
                &[&slot],
            )
            .await?
            .ok_or_else(|| StorageError(format!("slot `{slot}` does not exist")))?;
        let confirmed: Option<PgLsn> = row.get(0);
        let holder: Option<i32> = row.get(1);
        let confirmed = confirmed.map(|lsn| Lsn(u64::from(lsn)));
        if confirmed.is_some_and(|confirmed| confirmed >= to) {
            return Ok(());
        }
        match holder {
            Some(pid) if attempts < 40 => {
                attempts += 1;
                log_warn!(
                    "slot {slot} is held by backend {pid}; ending it to move the slot to {to}"
                );
                client
                    .execute("SELECT pg_terminate_backend($1)", &[&pid])
                    .await?;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Some(pid) => {
                return Err(StorageError(format!(
                    "slot `{slot}` stays held by backend {pid}; it cannot be moved to {to}"
                )));
            }
            None => {
                client
                    .execute(
                        "SELECT pg_replication_slot_advance($1, $2)",
                        &[&slot, &PgLsn::from(to.0)],
                    )
                    .await?;
                log_info!(
                    "slot {slot} moved from {} to {to}, the first read snapshot's point",
                    confirmed.map_or_else(|| "nowhere".to_owned(), |lsn| lsn.to_string())
                );
                return Ok(());
            }
        }
    }
}

/// Note that PostgreSQL was heard from on the replication connection just
/// now, for the process that publishes how long the feed has been silent.
fn heard() {
    if let Some(stats) = crate::stats::Stats::global() {
        stats
            .feed_last_message_ms
            .store(crate::stats::now_ms(), Ordering::Relaxed);
    }
}

impl Feed {
    /// A decoder for `catalog`, at position zero until the first event,
    /// hearing of no schema change.
    pub fn new(catalog: Arc<Catalog>) -> Self {
        Feed {
            decoder: Decoder::new(catalog),
            progress: Lsn(0),
        }
    }

    /// A decoder for `catalog` that follows the schema changes `ddl`
    /// announces; a feed kept across the connections of one slot, so the
    /// catalog it grows is never lost with a connection.
    pub fn with_ddl(catalog: Arc<Catalog>, ddl: DdlSource) -> Self {
        Feed {
            decoder: Decoder::with_ddl(catalog, ddl),
            progress: Lsn(0),
        }
    }

    /// The catalog as the feed has it.
    pub fn catalog(&self) -> &Arc<Catalog> {
        self.decoder.catalog()
    }

    /// Absorb one raw event: a keepalive or a commit moves the position,
    /// and a commit also yields the transaction it closes. A keepalive
    /// that arrives inside a transaction names a location below that
    /// transaction's commit record, so the position never runs ahead of a
    /// commit still to come.
    pub fn absorb(&mut self, event: ReplicationEvent) -> Result<Option<Transaction>, StorageError> {
        if let ReplicationEvent::KeepAlive { wal_end, .. } = &event {
            self.progress = self.progress.max(position(*wal_end));
        }
        let transaction = self.decoder.absorb(event)?;
        if let Some(transaction) = &transaction {
            self.progress = self.progress.max(transaction.at);
        }
        Ok(transaction)
    }

    /// The position every commit has been delivered up to.
    pub fn progress(&self) -> Lsn {
        self.progress
    }
}

impl PgStream {
    /// Open the feed of `slot` at `dsn`, streaming `publication` and
    /// decoding with `catalog`; the slot and the publication are created
    /// first when missing ([`Transport::prepare`]).
    pub async fn open(
        dsn: &str,
        slot: &str,
        publication: &str,
        catalog: Arc<Catalog>,
    ) -> Result<Self, StorageError> {
        Transport::prepare(dsn, slot, publication).await?;
        let transport = Transport::open(dsn, slot, publication).await?;
        let config: tokio_postgres::Config = dsn.parse()?;
        let client = super::open(&config, &tokio::runtime::Handle::current()).await?;
        Ok(PgStream {
            transport,
            feed: Feed::new(catalog),
            client,
        })
    }

    /// [`PgStream::open`], the feed following the schema changes `ddl`
    /// announces.
    pub async fn open_with(
        dsn: &str,
        slot: &str,
        publication: &str,
        catalog: Arc<Catalog>,
        ddl: DdlSource,
    ) -> Result<Self, StorageError> {
        Transport::prepare(dsn, slot, publication).await?;
        let transport = Transport::open(dsn, slot, publication).await?;
        let config: tokio_postgres::Config = dsn.parse()?;
        let client = super::open(&config, &tokio::runtime::Handle::current()).await?;
        Ok(PgStream {
            transport,
            feed: Feed::with_ddl(catalog, ddl),
            client,
        })
    }

    /// The two halves, to run on separate threads.
    pub fn split(self) -> (Transport, Feed) {
        (self.transport, self.feed)
    }

    /// Drop `slot` and `publication`.
    pub async fn drop_slot(dsn: &str, slot: &str, publication: &str) -> Result<(), StorageError> {
        Transport::drop_slot_only(dsn, slot).await?;
        let config: tokio_postgres::Config = dsn.parse()?;
        let client = super::open(&config, &tokio::runtime::Handle::current()).await?;
        client
            .batch_execute(&format!("DROP PUBLICATION IF EXISTS \"{publication}\""))
            .await?;
        Ok(())
    }

    /// Collect every write the feed delivers up to where the server's log
    /// is right now, with the position the feed reached: every
    /// transaction whose commit had been acknowledged before the call is
    /// in the batch. The server is asked where its log ends (the flushed
    /// end on a primary, the replayed end on a standby; a read, nothing is
    /// written) and the feed is consumed until a commit or a keepalive
    /// says it has been delivered that far; fails if that takes longer
    /// than [`POLL_WAIT`]. A batch carries writes only: a poller is a
    /// tool for tests and the bench over a feed that hears of no schema
    /// change ([`PgStream::open`]); the schema changes a feed opened with
    /// [`PgStream::open_with`] hears travel with its transactions
    /// ([`Transport::stream`]), not with a batch.
    pub async fn poll(&mut self) -> Result<Batch, StorageError> {
        let target = server_position(&self.client).await?;
        let deadline = Instant::now() + POLL_WAIT;
        let mut writes = Vec::new();
        while self.feed.progress() < target {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let event = tokio::time::timeout(remaining, self.transport.feed.recv())
                .await
                .map_err(|_| {
                    StorageError(format!(
                        "the feed did not reach {target} within {POLL_WAIT:?}; it is at {}",
                        self.feed.progress()
                    ))
                })?;
            let event = event
                .map_err(|error| StorageError(format!("replication stream: {error}")))?
                .ok_or_else(|| StorageError("the replication stream ended".to_owned()))?;
            let transaction = self.feed.absorb(event)?;
            self.transport.acknowledge(self.feed.progress());
            if let Some(transaction) = transaction {
                let at = transaction.at;
                writes.extend(transaction.writes.into_iter().map(|write| (write, at)));
            }
        }
        Ok(Batch {
            writes,
            progress: self.feed.progress(),
        })
    }

    /// Run on one thread until `commands` has no receiver or the
    /// connection ends: [`Transport::stream`], each transaction and each
    /// position mark going out as one [`Command::Transaction`].
    pub async fn run<Q>(self, every: Duration, commands: mpsc::Sender<Command<Q>>) {
        let (transport, mut feed) = self.split();
        let (out, mut transactions) = mpsc::channel(64);
        let forward = async move {
            while let Some(transaction) = transactions.recv().await {
                if commands
                    .send(Command::Transaction(transaction))
                    .await
                    .is_err()
                {
                    return;
                }
            }
        };
        tokio::select! {
            outcome = transport.stream(every, &mut feed, &[], out) => {
                if let Err(error) = outcome {
                    eprintln!("change feed decoding failed: {error}");
                }
            }
            _ = forward => {}
        }
    }
}

/// Where the server's log ends right now, on the scale the feed's
/// positions are on: the flushed end on a primary (a transaction is
/// acknowledged once its commit record is flushed, and the feed is sent
/// flushed log only), the replayed end on a standby.
async fn server_position(client: &Client) -> Result<Lsn, StorageError> {
    let row = client
        .query_one(
            "SELECT CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn() ELSE pg_current_wal_flush_lsn() END",
            &[],
        )
        .await?;
    let end: PgLsn = row.get(0);
    Ok(Lsn(u64::from(end)))
}

/// The feed's position for a location the transport reports.
fn position(lsn: pgwire_replication::Lsn) -> Lsn {
    Lsn(lsn.as_u64())
}

/// The replication connection's settings, taken from the SQL connection's
/// (`tokio-postgres` cannot open a replication connection itself). Plain
/// TCP or a Unix socket, no TLS; standby feedback once a second.
fn replication_config(
    config: &tokio_postgres::Config,
    slot: &str,
    publication: &str,
) -> ReplicationConfig {
    let host = match config.get_hosts().first() {
        Some(Host::Tcp(host)) => host.clone(),
        Some(Host::Unix(path)) => path.to_string_lossy().into_owned(),
        None => "localhost".to_owned(),
    };
    let port = config.get_ports().first().copied().unwrap_or(5432);
    let user = config.get_user().unwrap_or("postgres");
    let password = config
        .get_password()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .unwrap_or_default();
    let database = config.get_dbname().unwrap_or(user);
    ReplicationConfig::new(host, user, password, database, slot, publication)
        .with_port(port)
        .with_tls(TlsConfig::disabled())
        .with_status_interval(Duration::from_secs(1))
}

/// The primary key of a decoded row image, laid out on the table's
/// shared key schema.
fn key_of(row: &DataFrameRow, table: &DbTable) -> DataFrameKey {
    DataFrameKey::with_schema(
        table.key_schema().clone(),
        table
            .pkey
            .iter()
            .map(|column| row.data.get(column).cloned().unwrap_or(Value::Null))
            .collect(),
    )
}

/// Row images decoded with a column PostgreSQL sent as unchanged, left
/// out ([`image`]); counted on that branch alone, so a whole image costs
/// nothing.
static PARTIAL_IMAGES: AtomicU64 = AtomicU64::new(0);

/// How many row images the feed has decoded with a column left out as
/// unchanged ([`RowData::partial`]).
pub fn partial_images() -> u64 {
    PARTIAL_IMAGES.load(Ordering::Relaxed)
}

/// A decoded tuple as a row image of `table`: each value converted by the
/// column's declared type (a `json` column's stored text rewritten into
/// the standard form first), columns the catalog does not declare
/// skipped, declared columns the relation lacks `NULL`, so every image
/// carries every column. The one exception is a column PostgreSQL sent
/// as unchanged (a large value an update did not touch): it is left out,
/// and the image is marked partial ([`RowData::partial`]) so that the
/// engine never holds or sends it as the whole row.
fn image(
    table: &DbTable,
    columns: &[Described],
    tuple: &Columns,
) -> Result<DataFrameRow, StorageError> {
    let mut data = HashMap::new();
    let mut unchanged: Vec<ColumnName> = Vec::new();
    for (described, column) in columns.iter().zip(tuple) {
        let Some(declared) = table.column(described.name.as_str()) else {
            continue;
        };
        let value = match column {
            TupleDataColumn::PGNull => Value::Null,
            TupleDataColumn::Value(text) if described.plain_json => {
                Value::String(super::text::json_as_jsonb(text))
            }
            TupleDataColumn::Value(text) => convert(text, &declared.r#type)?,
            TupleDataColumn::PGUnchangedToastedValue => {
                unchanged.push(declared.name.clone());
                continue;
            }
        };
        data.insert(declared.name.clone(), value);
    }
    if unchanged.is_empty() {
        let schema = table.row_schema().clone();
        let values = schema
            .names()
            .iter()
            .map(|name| data.remove(name.as_str()).unwrap_or(Value::Null))
            .collect();
        return Ok(DataFrameRow::from(RowData::with_schema(schema, values)));
    }
    for name in table.columns.keys() {
        if unchanged.contains(name) {
            continue;
        }
        data.entry(name.clone()).or_insert(Value::Null);
    }
    PARTIAL_IMAGES.fetch_add(1, Ordering::Relaxed);
    Ok(DataFrameRow::from(RowData::partial(data)))
}

/// Convert one text value by its declared type; a `jsonb` cell is kept in
/// the standard form, as a read keeps it.
fn convert(raw: &str, declared: &ValueType) -> Result<Value, StorageError> {
    let unreadable = || StorageError(format!("`{raw}` is not a {declared:?}"));
    Ok(match declared {
        ValueType::Int => Value::Int(raw.parse().map_err(|_| unreadable())?),
        ValueType::Float => Value::Float(raw.parse().map_err(|_| unreadable())?),
        ValueType::Json => Value::String(super::text::standard_json(raw).into_owned()),
        ValueType::String | ValueType::Map(_, _) => Value::String(raw.to_owned()),
        ValueType::List(inner) => super::text::array_literal(raw, inner),
        ValueType::Timestamp => Value::Int(super::text::epoch_millis(raw).ok_or_else(unreadable)?),
        ValueType::Bool => Value::Bool(match raw {
            "true" | "t" => true,
            "false" | "f" => false,
            _ => return Err(unreadable()),
        }),
        ValueType::Date => Value::Date(
            chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|_| unreadable())?,
        ),
        ValueType::Datetime => Value::Datetime(
            chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%.f")
                .or_else(|_| chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S"))
                .map_err(|_| unreadable())?,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ivm::evaluate;
    use crate::model::{ComparisonOperator, DbColumn, DbTable, Where};

    /// `probe_t`, the table the session was recorded from.
    fn catalog() -> Arc<Catalog> {
        Arc::new(Catalog::new(vec![DbTable::new(
            "probe_t",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("name", ValueType::String),
                DbColumn::new("points", ValueType::Int),
                DbColumn::new("flag", ValueType::Bool),
                DbColumn::new("d", ValueType::Date),
                DbColumn::new("ts", ValueType::Datetime),
                DbColumn::new("amount", ValueType::Float),
                DbColumn::new("tag", ValueType::String),
            ],
        )]))
    }

    /// A row message as the transport hands it over, from its recorded hex.
    fn xlog(hex: &str) -> ReplicationEvent {
        let data: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
            .collect();
        ReplicationEvent::XLogData {
            wal_start: pgwire_replication::Lsn(0),
            wal_end: pgwire_replication::Lsn(0),
            server_time_micros: 0,
            data: Bytes::from(data),
        }
    }

    /// A transaction boundary as the transport decodes it.
    fn begin() -> ReplicationEvent {
        ReplicationEvent::Begin {
            final_lsn: pgwire_replication::Lsn(0),
            xid: 0,
            commit_time_micros: 0,
        }
    }

    /// A commit whose record ends at `end`.
    fn commit(end: &str) -> ReplicationEvent {
        ReplicationEvent::Commit {
            lsn: pgwire_replication::Lsn(0),
            end_lsn: pgwire_replication::Lsn(Lsn::parse(end).unwrap().0),
            commit_time_micros: 0,
        }
    }

    /// A logical message some other writer emitted inside a transaction.
    fn message(content: &str) -> ReplicationEvent {
        ReplicationEvent::Message {
            transactional: true,
            lsn: pgwire_replication::Lsn(0),
            prefix: "someone_else".to_owned(),
            content: Bytes::copy_from_slice(content.as_bytes()),
        }
    }

    /// A `ddlUpdate` as the schema-change end trigger writes it for `ALTER
    /// TABLE`, on the prefix the feed under test listens on, with the
    /// published tables `previous` before and `after` after the command.
    fn ddl(previous: &str, after: &str) -> ReplicationEvent {
        ReplicationEvent::Message {
            transactional: true,
            lsn: pgwire_replication::Lsn(0x10),
            prefix: "xyne/0/ddl".to_owned(),
            content: Bytes::from(format!(
                r#"{{"type":"ddlUpdate","version":1,"event":{{"tag":"ALTER TABLE"}},"context":{{"query":"alter table"}},"previousSchema":{{"tables":[{previous}],"indexes":[]}},"schema":{{"tables":[{after}],"indexes":[]}}}}"#
            )),
        }
    }

    /// One published table `public.<name>` of a message, keyed by `id`,
    /// with `columns` as (name, `pg_type` name, default expression).
    fn published(name: &str, columns: &[(&str, &str, Option<&str>)]) -> String {
        let columns: Vec<String> = columns
            .iter()
            .enumerate()
            .map(|(index, (column, data_type, dflt))| {
                let dflt = dflt.map_or_else(|| "null".to_owned(), |text| format!("\"{text}\""));
                format!(
                    r#""{column}":{{"pos":{},"dataType":"{data_type}","pgTypeClass":"b","notNull":false,"dflt":{dflt}}}"#,
                    index + 1
                )
            })
            .collect();
        format!(
            r#"{{"oid":7,"schema":"public","name":"{name}","replicaIdentity":"d","columns":{{{}}},"primaryKey":["id"],"publications":{{}}}}"#,
            columns.join(",")
        )
    }

    /// The `docs(id, title)` catalog the schema-change scenarios start
    /// from, and the feed's source of changes.
    fn docs() -> (Arc<Catalog>, DdlSource) {
        let catalog = Arc::new(Catalog::new(vec![DbTable::new(
            "docs",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("title", ValueType::String),
            ],
        )]));
        let source = DdlSource {
            prefix: "xyne/0/ddl".to_owned(),
            schemas: vec!["public".to_owned()],
        };
        (catalog, source)
    }

    /// A column added grows the feed's catalog the moment its message is
    /// absorbed: a row of the same transaction decoded before the message
    /// is on the old layout, one after it carries the column on the
    /// layout the change names, the transaction carries the change and
    /// the catalog it makes, and a later transaction, carrying no change,
    /// is decoded on the grown catalog.
    #[test]
    fn a_column_added_is_decoded_from_the_message_on() {
        let (catalog, source) = docs();
        let mut decoder = Decoder::with_ddl(catalog, source);
        let before = published("docs", &[("id", "int8", None), ("title", "text", None)]);
        let after = published(
            "docs",
            &[
                ("id", "int8", None),
                ("title", "text", None),
                ("owner", "text", Some("'nobody'::text")),
            ],
        );
        let events = vec![
            begin(),
            relation(7, "docs", &[("id", 20), ("title", 25)]),
            insert(7, &["1", "first"]),
            ddl(&before, &after),
            relation(7, "docs", &[("id", 20), ("title", 25), ("owner", 25)]),
            insert(7, &["2", "second", "meera"]),
            commit("0/10"),
            begin(),
            insert(7, &["3", "third", "arjun"]),
            commit("0/20"),
        ];
        let transactions: Vec<Transaction> = events
            .into_iter()
            .filter_map(|event| decoder.absorb(event).unwrap())
            .collect();
        assert_eq!(transactions.len(), 2, "{transactions:?}");

        let first = &transactions[0];
        assert_eq!(first.schema.len(), 1, "{:?}", first.schema);
        let SchemaChange::ColumnAdded {
            column,
            value,
            schema,
            ..
        } = &first.schema[0]
        else {
            panic!("{:?}", first.schema);
        };
        assert_eq!(column.name.as_str(), "owner");
        assert_eq!(*value, Value::from("nobody"));
        let grown = first
            .catalog
            .as_ref()
            .expect("the catalog the change makes");
        let widened = grown.table("docs").expect("docs");
        assert!(widened.column("owner").is_some());
        assert!(
            Arc::ptr_eq(schema, widened.row_schema()),
            "the change names the layout the new catalog's rows share"
        );
        let images: Vec<&DataFrameRow> = first
            .writes
            .iter()
            .filter_map(|write| write.new_row_image())
            .collect();
        assert_eq!(images.len(), 2);
        assert!(
            !images[0].data.contains_key("owner"),
            "decoded before the message, on the old layout: {:?}",
            images[0]
        );
        assert_eq!(images[1].data.get("owner"), Some(&Value::from("meera")));
        assert!(
            Arc::ptr_eq(images[1].data.schema(), schema),
            "decoded after the message, on the layout the change names"
        );

        let second = &transactions[1];
        assert!(second.schema.is_empty() && second.catalog.is_none());
        let late = second.writes[0].new_row_image().expect("an insert");
        assert_eq!(late.data.get("owner"), Some(&Value::from("arjun")));
        assert!(Arc::ptr_eq(decoder.catalog(), grown));
    }

    /// A message on another prefix is somebody else's; one on the feed's
    /// prefix that removes a column the catalog carries is the error that
    /// stops the feed, naming the change.
    #[test]
    fn a_change_the_server_cannot_follow_stops_the_feed() {
        let (catalog, source) = docs();
        let mut decoder = Decoder::with_ddl(catalog, source);
        assert!(decoder.absorb(begin()).unwrap().is_none());
        assert!(
            decoder.absorb(message("not even json")).unwrap().is_none(),
            "another prefix is not read"
        );
        let before = published("docs", &[("id", "int8", None), ("title", "text", None)]);
        let after = published("docs", &[("id", "int8", None)]);
        let error = decoder.absorb(ddl(&before, &after)).unwrap_err();
        assert!(error.0.contains("cannot follow"), "{error}");
        assert!(error.0.contains("`title`"), "{error}");
        assert!(error.0.contains("removed or renamed"), "{error}");
    }

    /// A keepalive saying the server has gone through its log up to `end`.
    fn keepalive(end: &str) -> ReplicationEvent {
        ReplicationEvent::KeepAlive {
            wal_end: pgwire_replication::Lsn(Lsn::parse(end).unwrap().0),
            reply_requested: false,
            server_time_micros: 0,
        }
    }

    /// A relation message for `public.<name>` with `columns` of the given
    /// type OIDs, the first being the key.
    fn relation(oid: i32, name: &str, columns: &[(&str, i32)]) -> ReplicationEvent {
        let mut data = vec![b'R'];
        data.extend_from_slice(&oid.to_be_bytes());
        data.extend_from_slice(b"public\0");
        data.extend_from_slice(name.as_bytes());
        data.push(0);
        data.push(b'd');
        data.extend_from_slice(&(columns.len() as i16).to_be_bytes());
        for (index, (column, type_oid)) in columns.iter().enumerate() {
            data.push(if index == 0 { 1 } else { 0 });
            data.extend_from_slice(column.as_bytes());
            data.push(0);
            data.extend_from_slice(&type_oid.to_be_bytes());
            data.extend_from_slice(&(-1i32).to_be_bytes());
        }
        raw(data)
    }

    /// An insert into relation `oid` of one row of text `values`.
    fn insert(oid: i32, values: &[&str]) -> ReplicationEvent {
        let mut data = vec![b'I'];
        data.extend_from_slice(&oid.to_be_bytes());
        data.push(b'N');
        data.extend_from_slice(&(values.len() as i16).to_be_bytes());
        for value in values {
            data.push(b't');
            data.extend_from_slice(&(value.len() as i32).to_be_bytes());
            data.extend_from_slice(value.as_bytes());
        }
        raw(data)
    }

    /// A row message of `data`.
    fn raw(data: Vec<u8>) -> ReplicationEvent {
        ReplicationEvent::XLogData {
            wal_start: pgwire_replication::Lsn(0),
            wal_end: pgwire_replication::Lsn(0),
            server_time_micros: 0,
            data: Bytes::from(data),
        }
    }

    /// The server is asked about the slot only once the feed has been
    /// silent for [`SILENCE`], then every half of it while the silence
    /// lasts, and hearing the feed starts the wait over.
    #[test]
    fn a_silent_feed_is_asked_about_at_intervals() {
        let mut watch = Watch::new();
        let start = watch.heard;
        assert!(!watch.due(start + SILENCE / 2), "heard recently enough");
        assert!(watch.due(start + SILENCE), "silent for the whole of it");
        assert!(
            !watch.due(start + SILENCE + SILENCE / 4),
            "asked a moment ago"
        );
        assert!(watch.due(start + SILENCE + SILENCE / 2), "and asked again");
        watch.heard();
        assert!(
            !watch.due(Instant::now() + SILENCE / 2),
            "heard: the wait starts over"
        );
    }

    /// The feed's position is the furthest a commit or a keepalive has
    /// said, and never goes back: a keepalive moves it while nothing is
    /// written, one that arrives inside a transaction names a location
    /// below that transaction's commit, and an old one changes nothing.
    #[test]
    fn a_keepalive_moves_the_position_and_never_back() {
        let mut feed = Feed::new(catalog());
        assert_eq!(feed.progress(), Lsn(0));
        assert!(feed.absorb(keepalive("0/100")).unwrap().is_none());
        assert_eq!(feed.progress(), Lsn::parse("0/100").unwrap());
        assert!(feed.absorb(begin()).unwrap().is_none());
        assert!(feed.absorb(keepalive("0/180")).unwrap().is_none());
        let committed = feed
            .absorb(commit("0/200"))
            .unwrap()
            .expect("a transaction");
        assert_eq!(committed.at, Lsn::parse("0/200").unwrap());
        assert!(committed.writes.is_empty());
        assert_eq!(feed.progress(), Lsn::parse("0/200").unwrap());
        assert!(feed.absorb(keepalive("0/180")).unwrap().is_none());
        assert_eq!(feed.progress(), Lsn::parse("0/200").unwrap());
        assert!(feed.absorb(keepalive("0/2A8")).unwrap().is_none());
        assert_eq!(feed.progress(), Lsn::parse("0/2A8").unwrap());
    }

    /// A JSON cell is decoded into the standard form whichever kind of
    /// column holds it: a `jsonb` cell loses a padded fraction, a `json`
    /// cell is rewritten as its `jsonb` would read; both are then the text
    /// a read of the same row returns and a literal is written as.
    #[test]
    fn json_cells_are_decoded_into_the_standard_form() {
        let catalog = Arc::new(Catalog::new(vec![DbTable::new(
            "docs",
            ["id"],
            vec![
                DbColumn::new("id", ValueType::Int),
                DbColumn::new("binary", ValueType::Json),
                DbColumn::new("plain", ValueType::Json),
            ],
        )]));
        let mut decoder = Decoder::new(catalog);
        let events = vec![
            begin(),
            relation(
                7,
                "docs",
                &[("id", 20), ("binary", 3802), ("plain", JSON_OID)],
            ),
            insert(
                7,
                &[
                    "1",
                    "{\"a\": 1.50, \"bb\": \"1.0\"}",
                    "{ \"bb\":\"1.0\",\"a\":1.50, \"a\":15e-1 }",
                ],
            ),
            insert(7, &["2", "2.0", "2.0"]),
            commit("0/10"),
        ];
        let transactions: Vec<Transaction> = events
            .into_iter()
            .filter_map(|event| decoder.absorb(event).unwrap())
            .collect();
        let rows: Vec<&DataFrameRow> = transactions[0]
            .writes
            .iter()
            .map(|write| write.new_row_image().unwrap())
            .collect();
        let standard = Value::String("{\"a\": 1.5, \"bb\": \"1.0\"}".into());
        assert_eq!(rows[0].data["binary"], standard);
        assert_eq!(rows[0].data["plain"], standard);
        assert_eq!(rows[1].data["binary"], Value::String("2".into()));
        assert_eq!(rows[1].data["plain"], Value::String("2".into()));
    }

    /// An `UPDATE` whose `name` PostgreSQL sent as unchanged (a large
    /// value the update did not touch, kind `u`) decodes to an image
    /// without that column rather than failing, marked partial: the
    /// engine completes it from the row it holds, or reads the row again.
    #[test]
    fn an_unchanged_toast_column_is_left_out_of_the_image() {
        let mut decoder = Decoder::new(catalog());
        let events = vec![
            begin(),
            xlog(
                "52000043477075626c69630070726f62655f74006400080169640000000014ffffffff006e616d650000000019ffffffff00706f696e74730000000014ffffffff00666c61670000000010ffffffff0064000000043affffffff007473000000045affffffff00616d6f756e7400000002bdffffffff007461670000000413ffffffff",
            ),
            xlog(
                "55000043474e000874000000013175740000000134740000000174740000000a323032362d30392d31317400000015323032362d30392d31312031303a30303a30302e357400000003312e357400000003612062",
            ),
            commit("0/3EFF508"),
        ];
        let before = partial_images();
        let transactions: Vec<Transaction> = events
            .into_iter()
            .filter_map(|event| decoder.absorb(event).unwrap())
            .collect();
        assert!(partial_images() > before, "the partial image is counted");
        assert_eq!(transactions.len(), 1, "{transactions:?}");
        let write = &transactions[0].writes[0];
        assert!(matches!(write, WriteQuery::UPDATE(_)));
        let image = write.new_row_image().unwrap();
        assert!(
            image.data.get("name").is_none(),
            "the unchanged column is absent, not NULL: {image:?}"
        );
        assert!(image.data.is_partial());
        assert_eq!(image.data["points"], Value::Int(4));
        assert_eq!(image.data["tag"], Value::String("a b".into()));
    }

    /// A recorded `pgoutput` session (PostgreSQL 15, `proto_version 1`,
    /// text values): two inserts with quoting, nulls and every scalar
    /// type; an update; a primary-key change, a delete and an insert on
    /// an undeclared table; and a transaction that carried only a logical
    /// message, which is a transaction with no writes. Each transaction
    /// lands at the end of its commit record.
    #[test]
    fn decodes_a_recorded_session() {
        let mut decoder = Decoder::new(catalog());
        let events = vec![
            begin(),
            xlog(
                "52000043477075626c69630070726f62655f74006400080169640000000014ffffffff006e616d650000000019ffffffff00706f696e74730000000014ffffffff00666c61670000000010ffffffff0064000000043affffffff007473000000045affffffff00616d6f756e7400000002bdffffffff007461670000000413ffffffff",
            ),
            xlog(
                "49000043474e00087400000001317400000006697427732078740000000133740000000174740000000a323032362d30392d31317400000015323032362d30392d31312031303a30303a30302e357400000003312e357400000003612062",
            ),
            xlog("49000043474e00087400000001326e6e6e6e6e6e6e"),
            commit("0/3EFF460"),
            begin(),
            xlog(
                "55000043474e0008740000000131740000000772656e616d6564740000000134740000000174740000000a323032362d30392d31317400000015323032362d30392d31312031303a30303a30302e357400000003312e357400000003612062",
            ),
            commit("0/3EFF508"),
            begin(),
            xlog("55000043474b00087400000001326e6e6e6e6e6e6e4e00087400000001336e6e6e6e6e6e6e"),
            xlog("44000043474b00087400000001316e6e6e6e6e6e6e"),
            xlog("520000434e7075626c69630070726f62655f6f74686572006400010169640000000014ffffffff"),
            xlog("490000434e4e0001740000000139"),
            commit("0/3EFF6F8"),
            begin(),
            message("7"),
            commit("0/3EFF768"),
        ];
        let transactions: Vec<Transaction> = events
            .into_iter()
            .filter_map(|event| decoder.absorb(event).unwrap())
            .collect();
        assert_eq!(transactions.len(), 4, "{transactions:?}");

        assert_eq!(transactions[0].at, Lsn::parse("0/3EFF460").unwrap());
        assert_eq!(transactions[0].writes.len(), 2);
        let image = transactions[0].writes[0].new_row_image().unwrap();
        assert_eq!(image.data["name"], Value::String("it's x".into()));
        assert_eq!(image.data["tag"], Value::String("a b".into()));
        assert_eq!(image.data["flag"], Value::Bool(true));
        assert_eq!(image.data["amount"], Value::Float(1.5));
        assert_eq!(
            image.data["d"],
            Value::Date(chrono::NaiveDate::from_ymd_opt(2026, 9, 11).unwrap())
        );
        assert!(matches!(image.data["ts"], Value::Datetime(_)));
        assert!(evaluate(
            &Where::condition("points", ComparisonOperator::GTE, 3),
            &image.data,
            &mut 0
        ));
        assert_eq!(
            transactions[0].writes[1].new_row_image().unwrap().data["name"],
            Value::Null
        );

        assert!(matches!(transactions[1].writes[0], WriteQuery::UPDATE(_)));
        assert_eq!(transactions[1].at, Lsn::parse("0/3EFF508").unwrap());

        let last = &transactions[2].writes;
        assert_eq!(
            last.len(),
            3,
            "a key change is a delete and an insert; the undeclared table is skipped"
        );
        assert!(
            matches!(&last[0], WriteQuery::DELETE(d) if d.pkey_value.pkey_value["id"] == Value::Int(2))
        );
        assert!(
            matches!(&last[1], WriteQuery::INSERT(i) if i.pkey_value.pkey_value["id"] == Value::Int(3))
        );
        assert!(
            matches!(&last[2], WriteQuery::DELETE(d) if d.pkey_value.pkey_value["id"] == Value::Int(1))
        );
        assert_eq!(transactions[2].at, Lsn::parse("0/3EFF6F8").unwrap());

        assert!(transactions[3].writes.is_empty());
        assert_eq!(transactions[3].at, Lsn::parse("0/3EFF768").unwrap());
    }
}
