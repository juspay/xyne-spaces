//! The client side: the server a Zero client (`@rocicorp/zero` 1.9, sync
//! protocol 51) connects to in place of zero-cache, with the IVM engine
//! behind it.
//!
//! Everything here is about clients. It speaks their protocol
//! ([`protocol`]), translates the ASTs their queries arrive as into the
//! engine's trees ([`ast`]), calls the application server for those ASTs
//! and for their mutations ([`backend`]), decides which side of a join
//! is read whole before registering it ([`plan`]), keeps each client
//! group's view and builds its pokes ([`groups`]). The engine, its storage and the
//! change feed are none of its business: it reaches them only through
//! [`crate::sync::Service`]'s channels, which [`crate::sync::pg`] wires
//! up ([`crate::sync::pg::threads`]).
//!
//! # Threads
//!
//! - **Feed thread.** The replication connection, decoding the `pgoutput`
//!   events into rows and handing the engine one transaction per commit,
//!   and the feed's position a few times a second so the engine keeps up
//!   with it while nothing is written (it is read off PostgreSQL's
//!   keepalives; nothing is written to the database). Started by the sync
//!   side.
//! - **Engine thread.** The service: the runtime and the engine, and
//!   nothing else; the storage reads it asks for run on the reads pool.
//! - **Group threads.** `STREAMGRES_GROUP_THREADS` of them, each keeping
//!   the views of the client groups that hash to it and building their
//!   pokes ([`groups`]).
//! - **Reads pool.** A small runtime for the storage: the SQL, the
//!   connections, the row decoding; the planner's counts and the
//!   connect-time reads go there too.
//! - **Server threads.** A multi-threaded runtime for the WebSocket
//!   connections ([`connection`]): the handshake, the message loop, the
//!   liveness rules, the HTTP calls to the application server, and the
//!   translation and planning of every query.
//!
//! # What a connection gets
//!
//! `connected`, then pokes: each a versioned batch of row `put`s and
//! `del`s, `desiredQueriesPatches` echoing what the client asked for,
//! `gotQueriesPatch` once a query's first rows have all arrived, and
//! `lastMutationIDChanges` as the application server records mutations
//! (read off the `<app>_<shard>.clients` table in the same transaction
//! as the mutation's rows). A `pong` answers every `ping`, and one goes
//! out on the server's own account when the downstream is quiet.
//!
//! # Not yet
//!
//! A client group's history is not kept: a client reconnecting with a
//! cookie this server does not hold (after a restart, or after changes it
//! missed) is told to start over. Inspector messages are ignored.

pub mod ast;
pub mod backend;
pub mod config;
pub mod connection;
pub mod ddl_triggers;
pub mod groups;
pub mod plan;
pub mod protocol;
pub mod sampler;
pub mod schema;
pub mod transform;
pub mod warm;
pub mod wire;

use std::sync::Arc;
use std::time::Duration;

use futures_util::future::join_all;
use tokio::sync::mpsc;

pub use config::Config;

use crate::log::{self, log_error, log_info, log_warn};
use crate::shutdown::Shutdown;
use crate::sync::CatalogHandle;
use crate::sync::pg::threads;

// The listener drain is five seconds and profiler shutdown is bounded to two.
// These four seconds per worker phase and slot cleanup, plus two for reads,
// keep the application budget at 25 seconds of a 30-second Pod grace period.
const WORKER_STOP_GRACE: Duration = Duration::from_secs(4);
const SLOT_DROP_GRACE: Duration = Duration::from_secs(4);
const READS_STOP_GRACE: Duration = Duration::from_secs(2);

/// Wait a bounded amount of time for a native worker thread. The join itself
/// lives on a helper thread so a timed-out join cannot make Tokio wait for a
/// blocking-pool task forever while the process is terminating.
async fn join_worker(
    name: impl Into<String>,
    thread: std::thread::JoinHandle<()>,
) -> Result<(), String> {
    let name = name.into();
    let join_name = name.clone();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name(format!("streamgres-{name}-join"))
        .spawn(move || {
            let outcome = thread
                .join()
                .map_err(|_| format!("{join_name} thread panicked while stopping"));
            let _ = done_tx.send(outcome);
        })
        .map_err(|error| format!("joining {name} thread: {error}"))?;
    match tokio::time::timeout(WORKER_STOP_GRACE, done_rx).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(_)) => Err(format!("{name} join worker stopped unexpectedly")),
        Err(_) => Err(format!("{name} did not stop within {WORKER_STOP_GRACE:?}")),
    }
}

/// Run the server with `config` until ctrl-c; returns the reason it could
/// not start.
pub fn serve(config: Config) -> Result<(), String> {
    log::set_level(config.log);
    log::set_format(config.log_format);
    let _profiler = crate::profile::start(crate::profile::Config::from_env()?)?;
    let config = Arc::new(config);
    let shutdown = Shutdown::new();
    let settings = config.engine_settings();
    let cleanup_settings = settings.clone();
    let server = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("streamgres-server")
        .build()
        .map_err(|error| format!("tokio: {error}"))?;
    let catalog = Arc::new(CatalogHandle::new(
        server.block_on(threads::load_catalog_at(&settings.dsn, &settings.schemas))?,
    ));
    server.block_on(threads::require_ddl_trigger(
        &settings.dsn,
        &settings.ddl_trigger,
    ))?;
    let reads = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(settings.read_threads)
        .enable_all()
        .thread_name("streamgres-reads")
        .build()
        .map_err(|error| format!("tokio: {error}"))?;
    let stats = crate::stats::Stats::shared_with_metric_prefix(config.metrics_prefix.clone());
    crate::stats::Stats::install(&stats);
    let shards = config.group_threads.max(1);
    stats.read_row_limit.store(
        crate::sync::pg::read_row_limit() as u64,
        std::sync::atomic::Ordering::Relaxed,
    );

    let engine_catalog = catalog.clone();
    let engine_stats = stats.clone();
    let reads_handle = reads.handle().clone();
    let engine_shutdown = shutdown.clone();
    let (started_tx, started_rx) = std::sync::mpsc::channel::<Result<threads::Started, String>>();
    let engine_thread = std::thread::Builder::new()
        .name("streamgres-engine".to_owned())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("engine runtime");
            let local = tokio::task::LocalSet::new();
            local.block_on(&runtime, async move {
                match threads::start(
                    &settings,
                    engine_catalog,
                    reads_handle,
                    shards,
                    engine_stats,
                    engine_shutdown.clone(),
                )
                .await
                {
                    Ok((engine, service)) => {
                        let _ = started_tx.send(Ok(engine));
                        match service.await {
                            Ok(_) if engine_shutdown.requested() => {
                                log_info!("engine service stopped during shutdown")
                            }
                            Ok(_) => {
                                let reason = "the engine's service stopped";
                                log_error!("{reason}");
                                engine_shutdown.fail(reason);
                            }
                            Err(error) => {
                                let reason = format!("the engine's service panicked: {error}");
                                log_error!("{reason}");
                                engine_shutdown.fail(reason);
                            }
                        }
                    }
                    Err(error) => {
                        let reason = format!("starting engine: {error}");
                        let _ = started_tx.send(Err(error));
                        engine_shutdown.fail(reason);
                    }
                }
            });
        })
        .map_err(|error| format!("engine thread: {error}"))?;
    let threads::Started {
        commands,
        events,
        storage,
        feed,
    } = started_rx
        .recv()
        .map_err(|_| "the engine thread ended before it was up".to_owned())??;

    let (readiness, ready) = tokio::sync::watch::channel(false);
    let mut requests = Vec::with_capacity(shards);
    let mut group_threads = Vec::with_capacity(shards);
    for (shard, events) in events.into_iter().enumerate() {
        let (requests_tx, requests_rx) = mpsc::channel::<groups::Request>(1024);
        requests.push(requests_tx.clone());
        let config = config.clone();
        let catalog = catalog.clone();
        let commands = commands.clone();
        let stats = stats.clone();
        let readiness = readiness.clone();
        let group_shutdown = shutdown.clone();
        let thread = std::thread::Builder::new()
            .name(format!("streamgres-groups-{shard}"))
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("groups runtime");
                let local = tokio::task::LocalSet::new();
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    local.block_on(
                        &runtime,
                        groups::run(
                            config,
                            catalog,
                            shard,
                            shards,
                            commands,
                            events,
                            requests_rx,
                            requests_tx,
                            stats,
                            readiness,
                        ),
                    )
                }));
                match outcome {
                    Ok(()) if group_shutdown.requested() => {
                        log_info!("group thread {shard} stopped during shutdown")
                    }
                    Ok(()) => {
                        let reason = format!("group thread {shard} stopped");
                        log_error!("{reason}");
                        group_shutdown.fail(reason);
                    }
                    Err(_) => {
                        let reason = format!("group thread {shard} panicked");
                        log_error!("{reason}");
                        group_shutdown.fail(reason);
                    }
                }
            })
            .map_err(|error| format!("group thread {shard}: {error}"))?;
        group_threads.push(thread);
    }

    let backend = Arc::new(backend::Backend::new(&config)?);
    let mutations = Arc::new(connection::MutationReader::new(
        storage.clone(),
        &config.upstream_schema(),
        catalog.clone(),
    ));
    let plans = Arc::new(plan::PlanCache::new(
        config.plan_ttl,
        config.plan_cache,
        config.plan_query_ttl,
    ));
    let warm = Arc::new(warm::WarmStart::new(
        config.plan_file.clone(),
        config.plan_cache,
    ));
    let transforms = Arc::new(transform::TransformCache::new(
        config.transform_ttl,
        config.transform_cache,
    ));
    let warm_budget = config.warm_start;
    let metrics_interval = config.metrics_interval;
    let (warmed_tx, warmed) = tokio::sync::watch::channel(!warm.enabled() || warm_budget.is_zero());
    let state = Arc::new(connection::AppState {
        config,
        requests,
        backend,
        storage,
        catalog,
        plans,
        mutations,
        stats,
        ready,
        warm: warm.clone(),
        warmed,
        transforms,
        shutdown: shutdown.clone(),
    });
    drop(readiness);
    if warm.enabled() {
        let shapes = warm.load();
        let saver = warm.clone();
        server.spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                saver.save();
            }
        });
        if !warm_budget.is_zero() {
            let state = state.clone();
            server.spawn(async move {
                let mut ready = state.ready.clone();
                while !*ready.borrow() {
                    if ready.changed().await.is_err() {
                        return;
                    }
                }
                let started = std::time::Instant::now();
                let count = shapes.len();
                let replayed = warm::WarmStart::replay(
                    shapes,
                    &state.catalog.load(),
                    state.config.policy(),
                    &state.plans,
                    &*state.storage,
                    warm_budget,
                    8,
                )
                .await;
                if replayed.skipped > 0 {
                    log_warn!(
                        "warm start: {} of {count} kept shapes planned in {:?} ({} failed); {} left when the budget ran out",
                        replayed.planned,
                        started.elapsed(),
                        replayed.failed,
                        replayed.skipped
                    );
                } else {
                    log_info!(
                        "warm start: {} of {count} kept shapes planned in {:?} ({} failed)",
                        replayed.planned,
                        started.elapsed(),
                        replayed.failed
                    );
                }
                let _ = warmed_tx.send(true);
            });
        }
    }
    sampler::spawn(state.clone(), metrics_interval);
    crate::otel::spawn(crate::otel::Config::from_env(), state.stats.clone());
    log_info!("client side up");
    let served = server.block_on(connection::serve(state));
    server.block_on(async {
        if let Err(error) = threads::stop_feed(feed).await {
            log_warn!("stopping change feed during shutdown: {error}");
        }
        if let Err(error) = join_worker("engine", engine_thread).await {
            log_warn!("joining engine during shutdown: {error}");
        }
        let joined_groups = join_all(
            group_threads
                .into_iter()
                .enumerate()
                .map(|(shard, thread)| join_worker(format!("groups-{shard}"), thread)),
        )
        .await;
        for result in joined_groups {
            if let Err(error) = result {
                log_warn!("joining group thread during shutdown: {error}");
            }
        }
        match tokio::time::timeout(
            SLOT_DROP_GRACE,
            crate::sync::pg::Transport::drop_slot_only(
                &cleanup_settings.dsn,
                &cleanup_settings.slot,
            ),
        )
        .await
        {
            Ok(Ok(())) => log_info!(
                "dropped change-feed slot {} during shutdown",
                cleanup_settings.slot
            ),
            Ok(Err(error)) => {
                log_warn!(
                    "could not drop change-feed slot {} during shutdown: {error}",
                    cleanup_settings.slot
                );
            }
            Err(_) => {
                log_warn!(
                    "dropping change-feed slot {} timed out",
                    cleanup_settings.slot
                );
            }
        }
    });
    reads.shutdown_timeout(READS_STOP_GRACE);
    served?;
    match shutdown.failure() {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
