//! The engine side wired over PostgreSQL: a feed thread that holds the
//! replication connection, decodes the `pgoutput` events into rows and
//! hands the engine one transaction per commit (reopening the slot when
//! the connection drops), and, on the caller's engine thread, the storage
//! (its reads on the pool) and the [`Service`]. Whoever serves clients
//! talks to this side over the service's channels, commands in and events
//! out, and never touches a database connection.
//!
//! The order at start is what makes the first snapshot and the feed
//! agree: the slot is made to exist, then the storage mints its first
//! snapshot, then the feed opens with the slot moved up to that
//! snapshot's point, so it streams exactly what the snapshot does not
//! hold. Each process streams from a slot of its own, named
//! [`SLOT_PREFIX`] and a fresh UUID: a restart needs nothing of the
//! slot before it (the slot is moved up to the first snapshot anyway).
//! At startup it can drop this server's inactive slots once they have
//! exceeded an explicitly configured age; the PostgreSQL 17
//! `inactive_since` timestamp makes that cleanup safe across restarts.
//! Schema changes reach the feed as the messages of the schema-change
//! event trigger ([`super::ddl`]); the server refuses to serve
//! without that trigger ([`require_ddl_trigger`]).
//!
//! A consumer that must read some rows for itself (an application's
//! mutation-id table, say) names those tables in [`Settings::watched`].
//! Their writes travel inside the transaction that carried them and reach
//! the consumer in its [`Event::Committed`], so a mutation's rows and its
//! id are one poke and no later transaction's id rides out early.

use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::sync::watch;
use tokio::task::spawn_local;

use super::ddl::{self, DdlSource};
use super::{Feed, Keepalive, PgStorage, Transport, load_catalog};
use crate::ivm::MultiTableIVM;
use crate::log::{log_error, log_info, log_warn};
use crate::model::{Catalog, Lsn, MultiTableReadQuery, TableName};
use crate::shutdown::Shutdown;
use crate::stats::Stats;
use crate::sync::{CatalogHandle, Command, Event, Runtime, Service, Sources, Transaction};

/// How the engine side reaches its database.
///
/// - `dsn`: the database, with the user and password in the URL.
/// - `slot`: the replication slot of the change feed, this process's own
///   ([`slot_name`]).
/// - `slot_cleanup_age`: how long an inactive slot of an ended process is
///   retained before startup removes it (zero disables cleanup).
/// - `publication`: the publication the feed streams.
/// - `schemas`: the schemas whose tables the catalog carries.
/// - `snapshot_rotation`: how often a fresh exported snapshot is minted
///   for reads.
/// - `read_connections`: how many storage reads may hold a connection at
///   once.
/// - `read_timeout`: how long one storage read may take before it is
///   given up and refused; zero for no limit.
/// - `read_threads`: how many threads the reads pool runs on.
/// - `keepalive`: how the kernel probes a silent connection to the
///   database so that nothing between drops it ([`Keepalive`]).
/// - `watched`: tables whose writes are copied to the consumer as they
///   are decoded, besides being routed like every other write.
/// - `ddl_trigger`: the event trigger on `ddl_command_end` through which
///   schema changes are heard; the server will not serve without it.
/// - `ddl_prefix`: the prefix of that trigger's logical messages.
#[derive(Debug, Clone)]
pub struct Settings {
    pub dsn: String,
    pub slot: String,
    pub slot_cleanup_age: Duration,
    pub publication: String,
    pub schemas: Vec<String>,
    pub snapshot_rotation: Duration,
    pub read_connections: usize,
    pub read_timeout: Duration,
    pub read_threads: usize,
    pub keepalive: Keepalive,
    pub watched: Vec<TableName>,
    pub ddl_trigger: String,
    pub ddl_prefix: String,
}

/// What every slot a server names for itself starts with.
pub const SLOT_PREFIX: &str = "xyne_sync_slot_";

/// A slot name of this process's own: [`SLOT_PREFIX`] and a fresh UUID
/// (lowercase hex, no dashes, as slot names allow).
pub fn slot_name() -> String {
    format!("{SLOT_PREFIX}{}", uuid::Uuid::new_v4().simple())
}

/// How often the feed thread tells the engine where the feed is without a
/// transaction to carry the news: the most a snapshot minted while
/// nothing is being written waits before reads move onto it, and a server
/// on a quiet database before it says it is ready.
const POSITION_EVERY: Duration = Duration::from_millis(200);

/// The feed has four seconds of the process's 25-second application shutdown
/// budget; Kubernetes retains five seconds of a 30-second grace period.
const FEED_STOP_GRACE: Duration = Duration::from_secs(4);

/// The running engine side: commands in, one event stream per consumer
/// (the consumer of a client being the one at its id modulo their count),
/// and the storage handle for the reads that are not the engine's (a
/// planner's counts, a connect-time query).
pub struct Started {
    pub commands: mpsc::Sender<Command<MultiTableReadQuery>>,
    pub events: Vec<mpsc::UnboundedReceiver<Event>>,
    pub storage: Arc<PgStorage>,
    pub feed: FeedHandle,
}

/// The feed's stop signal and its OS thread. Shutdown sets the signal, waits
/// for the replication connection to close, and only then may remove the
/// feed's slot.
pub struct FeedHandle {
    stop: watch::Sender<bool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// The service's task, kept on the engine thread: it resolves only when
/// the service stops or panics, and a server with no engine must not
/// keep listening.
pub type ServiceTask = tokio::task::JoinHandle<Runtime<MultiTableIVM>>;

/// Load the catalog of `schemas` over a connection of its own.
pub async fn load_catalog_at(dsn: &str, schemas: &[String]) -> Result<Catalog, String> {
    let (client, connection) = tokio_postgres::connect(dsn, tokio_postgres::NoTls)
        .await
        .map_err(|error| format!("connecting to the database: {error}"))?;
    let handle = tokio::spawn(async move {
        let _ = connection.await;
    });
    let (catalog, notes) = load_catalog(&client, schemas)
        .await
        .map_err(|error| format!("reading the catalog: {error}"))?;
    drop(client);
    let _ = handle.await;
    for note in &notes {
        log_info!("catalog: {note}");
    }
    log_info!(
        "catalog loaded from {}: {} tables",
        schemas.join(", "),
        catalog.tables().count()
    );
    let mut tables: Vec<_> = catalog.tables().collect();
    tables.sort_by(|a, b| a.name.as_str().cmp(b.name.as_str()));
    for table in tables {
        log_info!("schema: {table}");
    }
    Ok(catalog)
}

/// Refuse to serve without the event trigger `name` on `ddl_command_end`
/// at `dsn`: it is how the server hears of schema changes, and a server
/// that would not hear of them could go on serving rows in a shape the
/// clients no longer expect.
pub async fn require_ddl_trigger(dsn: &str, name: &str) -> Result<(), String> {
    let (client, connection) = tokio_postgres::connect(dsn, tokio_postgres::NoTls)
        .await
        .map_err(|error| format!("connecting to the database: {error}"))?;
    let handle = tokio::spawn(async move {
        let _ = connection.await;
    });
    let present = ddl::trigger_present(&client, name)
        .await
        .map_err(|error| format!("looking for the DDL event trigger `{name}`: {error}"))?;
    drop(client);
    let _ = handle.await;
    if present {
        log_info!("schema changes are heard through the event trigger {name}");
        Ok(())
    } else {
        Err(format!(
            "the event trigger `{name}` (STREAMGRES_DDL_TRIGGER) is not on this database or is disabled; the server hears of schema changes through it and will not serve without it"
        ))
    }
}

/// Start the feed thread: it decodes every replication event, starting
/// from `catalog` and following the schema changes the DDL trigger
/// announces, sends one transaction per commit into the returned channel,
/// reopens the slot with a backoff when the connection drops (the catalog
/// as the feed has grown it survives the connection), and ends the
/// process when the receiver is gone or decoding fails. The first time
/// the slot opens it is moved up to `start`, the first read snapshot's
/// point, when it is behind it.
pub fn spawn_feed(
    settings: Settings,
    catalog: Arc<Catalog>,
    start: Lsn,
    shutdown: Shutdown,
) -> Result<(mpsc::Receiver<Transaction>, FeedHandle), String> {
    let (out, transactions) = mpsc::channel(1024);
    let (stop, mut stop_rx) = watch::channel(false);
    let thread = std::thread::Builder::new()
        .name("streamgres-feed".to_owned())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("feed runtime");
            let running_shutdown = shutdown.clone();
            let stopped = runtime.block_on(async move {
                let ddl = DdlSource {
                    prefix: settings.ddl_prefix.clone(),
                    schemas: settings.schemas.clone(),
                };
                let mut feed = Feed::with_ddl(catalog, ddl);
                let mut start = Some(start);
                let mut failures = 0u32;
                loop {
                    let opened = match start {
                        Some(from) => Transport::open_from(
                            &settings.dsn,
                            &settings.slot,
                            &settings.publication,
                            from,
                        )
                        .await,
                        None => Transport::open(
                            &settings.dsn,
                            &settings.slot,
                            &settings.publication,
                        )
                        .await,
                    };
                    match opened {
                        Ok(transport) => {
                            log_info!("change feed open on slot {}", settings.slot);
                            start = None;
                            failures = 0;
                            let outcome = transport
                                .stream_with_shutdown(
                                    POSITION_EVERY,
                                    &mut feed,
                                    &settings.watched,
                                    out.clone(),
                                    stop_rx.clone(),
                                )
                                .await;
                            if *stop_rx.borrow() {
                                return true;
                            }
                            if out.is_closed() {
                                return false;
                            }
                            match outcome {
                                Ok(()) => log_warn!("change feed dropped; reopening the slot"),
                                Err(error) => {
                                    log_error!("change feed failed: {error}");
                                    running_shutdown.fail(format!("change feed failed: {error}"));
                                    return true;
                                }
                            }
                        }
                        Err(error) => {
                            failures += 1;
                            log_error!("opening the change feed (attempt {failures}): {error}");
                            if let Ok(false) =
                                Transport::slot_exists(&settings.dsn, &settings.slot).await
                            {
                                log_error!(
                                    "slot {} is gone, and a slot made again would skip the changes since; stopping so a restart begins on a fresh slot and snapshot",
                                    settings.slot
                                );
                                running_shutdown.fail(format!(
                                    "change-feed slot {} disappeared",
                                    settings.slot
                                ));
                                return true;
                            }
                        }
                    }
                    let backoff = Duration::from_secs(1 << failures.min(4));
                    tokio::select! {
                        _ = tokio::time::sleep(backoff) => {}
                        changed = stop_rx.changed() => {
                            if changed.is_ok() && *stop_rx.borrow() {
                                return true;
                            }
                        }
                    }
                }
            });
            if stopped {
                log_info!("change feed thread stopped gracefully");
            } else {
                log_error!("change feed thread stopped: the engine is gone");
                if !shutdown.requested() {
                    shutdown.fail("change feed thread stopped: the engine is gone");
                }
            }
        })
        .map_err(|error| format!("feed thread: {error}"))?;
    Ok((
        transactions,
        FeedHandle {
            stop,
            thread: Some(thread),
        },
    ))
}

/// Stop the feed thread and wait until its replication connection is closed.
pub async fn stop_feed(mut feed: FeedHandle) -> Result<(), String> {
    feed.stop.send_replace(true);
    let Some(thread) = feed.thread.take() else {
        return Ok(());
    };
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("streamgres-feed-join".to_owned())
        .spawn(move || {
            let outcome = thread
                .join()
                .map_err(|_| "change feed thread panicked while stopping".to_owned());
            let _ = done_tx.send(outcome);
        })
        .map_err(|error| format!("joining change feed thread: {error}"))?;
    match tokio::time::timeout(FEED_STOP_GRACE, done_rx).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(_)) => Err("change feed join worker stopped unexpectedly".to_owned()),
        Err(_) => Err(format!(
            "change feed did not stop within {FEED_STOP_GRACE:?}"
        )),
    }
}

/// Bring the engine side up on the current thread's local set: the slot
/// made to exist, the storage over `settings` (its reads running on
/// `reads`) with its first snapshot minted, the feed thread started at
/// that snapshot's point, and the service, keeping `catalog` current,
/// delivering its events to `consumers` streams and its timings to
/// `stats`. Must run inside a `LocalSet`.
pub async fn start(
    settings: &Settings,
    catalog: Arc<CatalogHandle>,
    reads: tokio::runtime::Handle,
    consumers: usize,
    stats: Arc<Stats>,
    shutdown: Shutdown,
) -> Result<(Started, ServiceTask), String> {
    Transport::cleanup_inactive_slots(&settings.dsn, settings.slot_cleanup_age)
        .await
        .map_err(|error| format!("cleaning up inactive replication slots: {error}"))?;
    Transport::prepare(&settings.dsn, &settings.slot, &settings.publication)
        .await
        .map_err(|error| format!("preparing the change feed: {error}"))?;
    let mut config: tokio_postgres::Config = settings
        .dsn
        .parse()
        .map_err(|error| format!("connecting the storage: {error}"))?;
    settings.keepalive.apply(&mut config);
    let pg = PgStorage::connect_configured(config, catalog.load(), reads)
        .await
        .map_err(|error| format!("connecting the storage: {error}"))?
        .with_rotation(settings.snapshot_rotation)
        .with_read_connections(settings.read_connections)
        .with_read_timeout(settings.read_timeout);
    let pg = Arc::new(pg);
    let (feed, feed_handle) = spawn_feed(
        settings.clone(),
        catalog.load(),
        pg.first_position(),
        shutdown,
    )?;
    let cached = Sources::cached_from_env();
    let storage = Rc::new(Sources::new(pg.clone(), catalog.load(), cached.clone()));
    if !cached.is_empty() {
        let rows = storage
            .warm()
            .await
            .map_err(|error| format!("warming the memory tables: {error}"))?;
        log_info!("memory tables warmed with {rows} rows");
    }
    let (sinks, events): (Vec<_>, Vec<_>) = (0..consumers.max(1))
        .map(|_| mpsc::unbounded_channel())
        .unzip();
    let first = sinks[0].clone();
    let engine = MultiTableIVM::new().with_row_limit(super::read_row_limit());
    let (service, commands) = Service::new(engine, storage, first);
    let service = spawn_local(
        service
            .with_feed(feed)
            .with_catalog(catalog)
            .with_sinks(sinks)
            .with_stats(stats)
            .run(),
    );
    Ok((
        Started {
            commands,
            events,
            storage: pg,
            feed: feed_handle,
        },
        service,
    ))
}
