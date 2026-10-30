//! The server's configuration, read from the environment: where to
//! listen, which database the engine side follows, where the application
//! server answers query and mutation requests, and the timings of the
//! connection protocol. Every setting has a `STREAMGRES_` name; the
//! database and application-server URLs also accept the `ZERO_` names a
//! zero-cache deployment already sets, so one `.env` serves both.

use std::path::PathBuf;
use std::time::Duration;

use super::plan::{Policy, Side};
use crate::log::{Format, Level};
use crate::model::TableName;
use crate::sync::pg::{Keepalive, Settings, threads};

/// Everything the server reads from the environment.
#[derive(Debug, Clone)]
pub struct Config {
    /// `STREAMGRES_ADDR`: the address to listen on (`0.0.0.0:4848`).
    pub bind: String,
    /// `STREAMGRES_BASE_PATH`: the path prefix the client connects under
    /// (`/zero`, so the connect route is `/zero/sync/v51/connect`).
    pub base_path: String,
    /// `STREAMGRES_PG_DSN` (or `ZERO_UPSTREAM_DB`): the database, with the
    /// user and password in the URL. This direct connection is used for
    /// catalog/replication/snapshot minting.
    pub dsn: String,
    /// `STREAMGRES_MASTER_PG_DSN`: writable primary used for startup setup.
    pub master_dsn: String,
    /// `STREAMGRES_READ_PG_DSN`: optional read endpoint, such as PgBouncer.
    /// Defaults to `dsn`; it must reach the same database as the direct DSN
    /// because reads import snapshots minted through the direct connection.
    pub read_dsn: String,
    /// `STREAMGRES_SCHEMAS`: the schemas whose tables the catalog carries
    /// (`public` plus the app's `zero_<shard>` schema by default).
    pub schemas: Vec<String>,
    /// The replication slot of the change feed, not configurable: each
    /// process names its own using the existing compatible naming scheme.
    pub slot: String,
    /// `STREAMGRES_SLOT_CLEANUP_AGE_MS`: how long a Streamgres feed slot
    /// must have stayed inactive before startup drops it (zero disables
    /// cleanup). PostgreSQL 17 or later is required when this is enabled,
    /// because that is where `inactive_since` is available.
    pub slot_cleanup_age: Duration,
    /// `STREAMGRES_PUBLICATION`: the publication the change feed streams;
    /// startup creates it when absent and validates it when present.
    pub publication: String,
    /// The event trigger on `ddl_command_end`, derived from app ID and shard.
    pub ddl_trigger: String,
    /// The logical message prefix, derived from app ID and shard.
    pub ddl_prefix: String,
    /// `STREAMGRES_SNAPSHOT_ROTATION_MS`: how often a fresh exported
    /// snapshot (a temporary replication slot) is minted for reads (1000).
    pub snapshot_rotation: Duration,
    /// `STREAMGRES_READ_CONNECTIONS`: maximum concurrent storage reads;
    /// additional reads wait for a permit (16).
    pub read_connections: usize,
    /// `STREAMGRES_READ_IDLE_CONNECTIONS`: maximum read connections kept
    /// idle for reuse (16; zero closes each connection after its read).
    pub read_idle_connections: usize,
    /// `STREAMGRES_READ_TIMEOUT_MS`: how long one storage read (a query's
    /// rows, a planner's count, a client group's mutation ids) may take,
    /// the connection it may have to open included and the wait for a free
    /// connection not. PostgreSQL is told to cancel the statement at that
    /// point and the server stops waiting for it; the query that needed
    /// the read is refused, by name, rather than read again (10000; 0 sets
    /// no limit).
    pub read_timeout: Duration,
    /// `STREAMGRES_READ_THREADS`: how many threads run the storage reads,
    /// their connections and their row decoding (2).
    pub read_threads: usize,
    /// `STREAMGRES_PG_KEEPALIVE_IDLE_MS`: how long a connection to the
    /// database may go without a byte either way before the kernel probes
    /// the peer, so that nothing between (a NAT, a load balancer) drops it
    /// as idle. The connection behind each read snapshot is silent for its
    /// whole life, and the snapshot dies with it (30000; 0 turns the
    /// probing off).
    pub pg_keepalive_idle: Duration,
    /// `STREAMGRES_PG_KEEPALIVE_INTERVAL_MS`: how long after an unanswered
    /// probe the next one goes out (10000; 0 leaves the kernel's default).
    pub pg_keepalive_interval: Duration,
    /// `STREAMGRES_PG_KEEPALIVE_RETRIES`: how many probes in a row may go
    /// unanswered before the kernel gives the connection up (3; 0 leaves
    /// the kernel's default).
    pub pg_keepalive_retries: u32,
    /// `STREAMGRES_GROUP_THREADS`: how many threads keep the client groups'
    /// views and build their pokes, each owning a share of the groups (1).
    pub group_threads: usize,
    /// `STREAMGRES_QUERY_URL` (or `ZERO_QUERY_URL`): the application
    /// server's query endpoint, which turns query names into ASTs.
    pub query_url: String,
    /// `STREAMGRES_MUTATE_URL` (or `ZERO_MUTATE_URL`): the application
    /// server's mutation endpoint.
    pub mutate_url: String,
    /// `STREAMGRES_BACKEND_TIMEOUT_MS`: how long one call to the
    /// application server (a transform of query names, a push of
    /// mutations) may take before it is given up; a call that timed out is
    /// not tried again (30000; 0 sets no limit).
    pub backend_timeout: Duration,
    /// `STREAMGRES_FORWARD_COOKIES` (or `ZERO_QUERY_FORWARD_COOKIES`):
    /// whether the connection's cookies go along to those endpoints
    /// (true).
    pub forward_cookies: bool,
    /// `STREAMGRES_APP_ID` (or `ZERO_APP_ID`): Zero's application id
    /// (`zero`); with the shard it names the schema the application
    /// server records mutations in.
    pub app_id: String,
    /// `STREAMGRES_SHARD` (or `ZERO_SHARD_NUM`): the shard number (0).
    pub shard: u32,
    /// `STREAMGRES_PING_INTERVAL_MS`: how often a WebSocket ping frame goes
    /// to an idle connection (30000).
    pub ping_interval: Duration,
    /// `STREAMGRES_CLIENT_TIMEOUT_MS`: how long a connection may stay silent
    /// (no message, no pong) before it is closed (45000).
    pub client_timeout: Duration,
    /// `STREAMGRES_PONG_INTERVAL_MS`: how long the server lets a connection
    /// go without any downstream message before it sends a `pong` on its
    /// own (3000).
    pub pong_interval: Duration,
    /// `STREAMGRES_GROUP_TTL_MS`: how long a client group's subscriptions
    /// stay registered after its last connection closes (60000).
    pub group_ttl: Duration,
    /// `STREAMGRES_GROUP_LOG_BYTES`: how many bytes of its most recent
    /// pokes a client group keeps, the oldest dropped as new ones are
    /// sent, so a client that reconnects behind the group (its socket
    /// died unnoticed while the server went on sending, or another tab
    /// kept the group moving) is sent what it missed instead of being
    /// told to start over (262144; 0 keeps none).
    pub group_log_bytes: usize,
    /// `STREAMGRES_MAX_MESSAGE_BYTES`: the largest inbound WebSocket message
    /// accepted (16 MiB). Must be a positive number of bytes.
    pub max_message_bytes: usize,
    /// `STREAMGRES_BYTES_PER_PART`: how many bytes of serialized row
    /// operations one poke part carries at most (768000, i.e. 750 KiB).
    pub bytes_per_part: usize,
    /// `STREAMGRES_ROW_LIMIT`: the most rows the server reads into memory
    /// at once (100000), one number for the planner and the storage: the
    /// planner reads whole no side of a join past it, driving that side
    /// from the other when the other fits and refusing the query when
    /// neither does, and a storage read returning more is refused.
    /// `STREAMGRES_JOIN_LIMIT`, the planner's older name, is still read.
    pub row_limit: u64,
    /// `STREAMGRES_JOIN_PREFERRED_SIDE`: which side of an INNER join drives
    /// it when reading the node whole and having its subs drive it would
    /// hold the same rows (the plan holding fewer wins otherwise, and a
    /// page is always driven by subs that hold the same), `parent` (the
    /// default) or `child` (the subquery, Zero's `whereExists` as
    /// translated).
    pub join_preferred_side: Side,
    /// `STREAMGRES_PLAN_TTL_MS`: how long a join plan is remembered for
    /// its tree before the tree is sized again (600000).
    pub plan_ttl: Duration,
    /// `STREAMGRES_PLAN_CACHE`: how many join plans are remembered at most
    /// (10000), one per tree.
    pub plan_cache: usize,
    /// `STREAMGRES_TRANSFORM_TTL_MS`: how long the application server's
    /// transform of a query is kept per identity (60000; zero-cache keeps
    /// its own for 5000; 0 keeps none).
    pub transform_ttl: Duration,
    /// `STREAMGRES_TRANSFORM_CACHE`: how many transforms are kept at most
    /// (20000).
    pub transform_cache: usize,
    /// `STREAMGRES_PLAN_FILE`: where the query shapes asked for are kept
    /// between runs, to be planned again before the next process says it
    /// is ready (unset: nothing is kept or replayed).
    pub plan_file: Option<PathBuf>,
    /// `STREAMGRES_WARM_START_MS`: the most time spent planning the kept
    /// shapes before the process says it is ready (20000; 0 keeps shapes
    /// but plans none at startup).
    pub warm_start: Duration,
    /// `STREAMGRES_LOG`: `error`, `warn`, `info` or `debug` (`info`).
    pub log: Level,
    /// `STREAMGRES_LOG_FORMAT`: `text` or `json` (`text`).
    pub log_format: Format,
    /// `STREAMGRES_SLOW_QUERY_MS`: a query hydrating slower than this, or a
    /// push slower than this, is logged at warn (1000).
    pub slow_query: Duration,
    /// `STREAMGRES_METRICS_INTERVAL_MS`: how often the metrics thread samples
    /// the process (10000; 0 turns it off); the summary line goes out every
    /// sixth sample.
    pub metrics_interval: Duration,
    /// `STREAMGRES_METRICS_PREFIX`: prefix of exported metric names
    /// the default preserves existing series names.
    pub metrics_prefix: String,
    /// `STREAMGRES_ENABLE_ADMIN_ENDPOINTS`: whether `/stats` and `/metrics`
    /// are served (false). Enable only for deployments that need the
    /// endpoints on the public port; prefer pushing metrics over OTLP.
    pub admin_endpoints: bool,
}

impl Config {
    /// Read the configuration; an error names the missing or malformed
    /// variable.
    pub fn from_env() -> Result<Config, String> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// The configuration `lookup` describes (the environment's, or a
    /// test's): an unset or empty variable takes its default.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Config, String> {
        let value = |name: &str| {
            lookup(name)
                .filter(|value| !value.is_empty())
                .or_else(|| {
                    name.strip_prefix("STREAMGRES_")
                        .and_then(|suffix| lookup(&format!("STREAMGRES_SYNC_{suffix}")))
                        .filter(|value| !value.is_empty())
                })
                .or_else(|| {
                    name.strip_prefix("STREAMGRES_")
                        .and_then(|suffix| lookup(&format!("XYNE_SYNC_{suffix}")))
                        .filter(|value| !value.is_empty())
                })
        };
        let first = |names: &[&str]| names.iter().find_map(|name| value(name));
        let millis = |name: &str, default: u64| -> Result<Duration, String> {
            match first(&[name]) {
                Some(text) => text
                    .parse::<u64>()
                    .map(Duration::from_millis)
                    .map_err(|_| format!("{name} must be a number of milliseconds, got `{text}`")),
                None => Ok(Duration::from_millis(default)),
            }
        };
        let dsn = first(&["STREAMGRES_PG_DSN", "ZERO_UPSTREAM_DB"])
            .ok_or("STREAMGRES_PG_DSN (or ZERO_UPSTREAM_DB) must name the database")?;
        let master_dsn = first(&["STREAMGRES_MASTER_PG_DSN"])
            .ok_or("STREAMGRES_MASTER_PG_DSN must name the writable primary database")?;
        let read_dsn = first(&["STREAMGRES_READ_PG_DSN"]).unwrap_or_else(|| dsn.clone());
        let query_url = first(&["STREAMGRES_QUERY_URL", "ZERO_QUERY_URL"])
            .ok_or("STREAMGRES_QUERY_URL (or ZERO_QUERY_URL) must name the query endpoint")?;
        let mutate_url = first(&["STREAMGRES_MUTATE_URL", "ZERO_MUTATE_URL"])
            .ok_or("STREAMGRES_MUTATE_URL (or ZERO_MUTATE_URL) must name the mutate endpoint")?;
        let app_id =
            first(&["STREAMGRES_APP_ID", "ZERO_APP_ID"]).unwrap_or_else(|| "zero".to_owned());
        let shard = match first(&["STREAMGRES_SHARD", "ZERO_SHARD_NUM"]) {
            Some(text) => text
                .parse::<u32>()
                .map_err(|_| format!("STREAMGRES_SHARD must be a number, got `{text}`"))?,
            None => 0,
        };
        let ddl_trigger = format!("{app_id}_ddl_end_{shard}");
        let ddl_prefix = format!("{app_id}/{shard}/ddl");
        let schemas = match first(&["STREAMGRES_SCHEMAS"]) {
            Some(text) => text
                .split(',')
                .map(|schema| schema.trim().to_owned())
                .filter(|schema| !schema.is_empty())
                .collect(),
            None => vec!["public".to_owned(), format!("{app_id}_{shard}")],
        };
        let forward_cookies = first(&["STREAMGRES_FORWARD_COOKIES", "ZERO_QUERY_FORWARD_COOKIES"])
            .is_none_or(|value| value != "false" && value != "0");
        let row_limit = match first(&[
            "STREAMGRES_ROW_LIMIT",
            "STREAMGRES_READ_ROW_LIMIT",
            "STREAMGRES_JOIN_LIMIT",
        ]) {
            Some(text) => text
                .parse::<u64>()
                .ok()
                .filter(|limit| *limit > 0)
                .ok_or_else(|| {
                    format!("STREAMGRES_ROW_LIMIT must be a positive number of rows, got `{text}`")
                })?,
            None => 100_000,
        };
        let join_preferred_side = match first(&["STREAMGRES_JOIN_PREFERRED_SIDE"]).as_deref() {
            None | Some("parent") => Side::Parent,
            Some("child") => Side::Child,
            Some(other) => {
                return Err(format!(
                    "STREAMGRES_JOIN_PREFERRED_SIDE must be child or parent, got `{other}`"
                ));
            }
        };
        let log = match first(&["STREAMGRES_LOG"]).as_deref() {
            None | Some("info") => Level::Info,
            Some("debug") => Level::Debug,
            Some("warn") => Level::Warn,
            Some("error") => Level::Error,
            Some(other) => {
                return Err(format!(
                    "STREAMGRES_LOG must be error, warn, info or debug, got `{other}`"
                ));
            }
        };
        let log_format = match first(&["STREAMGRES_LOG_FORMAT"]).as_deref() {
            None | Some("text") => Format::Text,
            Some("json") => Format::Json,
            Some(other) => {
                return Err(format!(
                    "STREAMGRES_LOG_FORMAT must be text or json, got `{other}`"
                ));
            }
        };
        let metrics_prefix =
            first(&["STREAMGRES_METRICS_PREFIX"]).unwrap_or_else(|| "xyne_sync".to_owned());
        if !Self::valid_metrics_prefix(&metrics_prefix) {
            return Err(format!(
                "STREAMGRES_METRICS_PREFIX must start with an ASCII letter or underscore and contain only ASCII letters, digits, or underscores, got `{metrics_prefix}`"
            ));
        }
        let mut base_path = first(&["STREAMGRES_BASE_PATH"]).unwrap_or_else(|| "/zero".to_owned());
        if !base_path.starts_with('/') {
            base_path.insert(0, '/');
        }
        while base_path.len() > 1 && base_path.ends_with('/') {
            base_path.pop();
        }
        if base_path == "/" {
            base_path.clear();
        }
        Ok(Config {
            bind: first(&["STREAMGRES_ADDR"]).unwrap_or_else(|| "0.0.0.0:4848".to_owned()),
            base_path,
            dsn,
            master_dsn,
            read_dsn,
            schemas,
            slot: threads::slot_name(),
            slot_cleanup_age: millis("STREAMGRES_SLOT_CLEANUP_AGE_MS", 0)?,
            publication: first(&["STREAMGRES_PUBLICATION"])
                .unwrap_or_else(|| "xyne_sync_pub".to_owned()),
            ddl_trigger,
            ddl_prefix,
            snapshot_rotation: millis("STREAMGRES_SNAPSHOT_ROTATION_MS", 1_000)?,
            read_connections: match first(&["STREAMGRES_READ_CONNECTIONS"]) {
                Some(text) => text.parse().map_err(|_| {
                    format!("STREAMGRES_READ_CONNECTIONS must be a number, got `{text}`")
                })?,
                None => 16,
            },
            read_idle_connections: match first(&["STREAMGRES_READ_IDLE_CONNECTIONS"]) {
                Some(text) => text.parse().map_err(|_| {
                    format!("STREAMGRES_READ_IDLE_CONNECTIONS must be a number, got `{text}`")
                })?,
                None => 16,
            },
            read_timeout: millis("STREAMGRES_READ_TIMEOUT_MS", 10_000)?,
            read_threads: match first(&["STREAMGRES_READ_THREADS"]) {
                Some(text) => text
                    .parse::<usize>()
                    .ok()
                    .filter(|threads| *threads > 0)
                    .ok_or_else(|| {
                        format!("STREAMGRES_READ_THREADS must be a positive number, got `{text}`")
                    })?,
                None => 2,
            },
            pg_keepalive_idle: millis("STREAMGRES_PG_KEEPALIVE_IDLE_MS", 30_000)?,
            pg_keepalive_interval: millis("STREAMGRES_PG_KEEPALIVE_INTERVAL_MS", 10_000)?,
            pg_keepalive_retries: match first(&["STREAMGRES_PG_KEEPALIVE_RETRIES"]) {
                Some(text) => text.parse().map_err(|_| {
                    format!("STREAMGRES_PG_KEEPALIVE_RETRIES must be a number, got `{text}`")
                })?,
                None => 3,
            },
            group_threads: match first(&["STREAMGRES_GROUP_THREADS"]) {
                Some(text) => text
                    .parse::<usize>()
                    .ok()
                    .filter(|threads| *threads > 0)
                    .ok_or_else(|| {
                        format!("STREAMGRES_GROUP_THREADS must be a positive number, got `{text}`")
                    })?,
                None => 1,
            },
            query_url,
            mutate_url,
            backend_timeout: millis("STREAMGRES_BACKEND_TIMEOUT_MS", 30_000)?,
            forward_cookies,
            app_id,
            shard,
            ping_interval: millis("STREAMGRES_PING_INTERVAL_MS", 30_000)?,
            client_timeout: millis("STREAMGRES_CLIENT_TIMEOUT_MS", 45_000)?,
            pong_interval: millis("STREAMGRES_PONG_INTERVAL_MS", 3_000)?,
            group_ttl: millis("STREAMGRES_GROUP_TTL_MS", 60_000)?,
            group_log_bytes: match first(&["STREAMGRES_GROUP_LOG_BYTES"]) {
                Some(text) => text.parse().map_err(|_| {
                    format!("STREAMGRES_GROUP_LOG_BYTES must be a number of bytes, got `{text}`")
                })?,
                None => 256 * 1024,
            },
            max_message_bytes: match first(&["STREAMGRES_MAX_MESSAGE_BYTES"]) {
                Some(text) => text
                    .parse::<usize>()
                    .ok()
                    .filter(|bytes| *bytes > 0)
                    .ok_or_else(|| {
                        format!(
                            "STREAMGRES_MAX_MESSAGE_BYTES must be a positive number of bytes, got `{text}`"
                        )
                    })?,
                None => 16 * 1024 * 1024,
            },
            bytes_per_part: match first(&["STREAMGRES_BYTES_PER_PART"]) {
                Some(text) => text.parse().map_err(|_| {
                    format!("STREAMGRES_BYTES_PER_PART must be a number of bytes, got `{text}`")
                })?,
                None => 750 * 1024,
            },
            row_limit,
            join_preferred_side,
            plan_ttl: millis("STREAMGRES_PLAN_TTL_MS", 600_000)?,
            plan_cache: match first(&["STREAMGRES_PLAN_CACHE"]) {
                Some(text) => text
                    .parse()
                    .map_err(|_| format!("STREAMGRES_PLAN_CACHE must be a number, got `{text}`"))?,
                None => 10_000,
            },
            transform_ttl: millis("STREAMGRES_TRANSFORM_TTL_MS", 60_000)?,
            transform_cache: match first(&["STREAMGRES_TRANSFORM_CACHE"]) {
                Some(text) => text.parse().map_err(|_| {
                    format!("STREAMGRES_TRANSFORM_CACHE must be a number, got `{text}`")
                })?,
                None => 20_000,
            },
            plan_file: first(&["STREAMGRES_PLAN_FILE"]).map(PathBuf::from),
            warm_start: millis("STREAMGRES_WARM_START_MS", 20_000)?,
            log,
            log_format,
            slow_query: millis("STREAMGRES_SLOW_QUERY_MS", 1_000)?,
            metrics_interval: millis("STREAMGRES_METRICS_INTERVAL_MS", 10_000)?,
            metrics_prefix,
            admin_endpoints: match first(&["STREAMGRES_ENABLE_ADMIN_ENDPOINTS"])
                .as_deref()
            {
                None => false,
                Some("true") | Some("yes") | Some("on") | Some("1") => true,
                Some("false") | Some("no") | Some("off") | Some("0") => false,
                Some(other) => {
                    return Err(format!(
                        "STREAMGRES_ENABLE_ADMIN_ENDPOINTS must be a boolean, got `{other}`"
                    ));
                }
            },
        })
    }

    /// Whether `prefix` can safely begin a Prometheus metric name.
    fn valid_metrics_prefix(prefix: &str) -> bool {
        let mut bytes = prefix.bytes();
        bytes
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic() || first == b'_')
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    }

    /// The join planner's settings.
    pub fn policy(&self) -> Policy {
        Policy {
            limit: self.row_limit,
            preferred: self.join_preferred_side,
        }
    }

    /// The schema the application server records mutations in,
    /// `<app>_<shard>` (`zero_0`).
    pub fn upstream_schema(&self) -> String {
        format!("{}_{}", self.app_id, self.shard)
    }

    /// The catalog name of the table holding each client's last mutation
    /// id, `<upstream schema>.clients`.
    pub fn clients_table(&self) -> String {
        format!("{}.clients", self.upstream_schema())
    }

    /// The catalog name of the table the application server records the
    /// result of a failed mutation in, until its client has received it,
    /// `<upstream schema>.mutations`.
    pub fn mutations_table(&self) -> String {
        format!("{}.mutations", self.upstream_schema())
    }

    /// What the engine side needs: the database to follow and read, and
    /// the two tables whose rows the client side reads itself (the
    /// application's mutation ids and the results of failed mutations,
    /// which travel with the rows of the mutation that produced them).
    pub fn engine_settings(&self) -> Settings {
        Settings {
            dsn: self.dsn.clone(),
            read_dsn: self.read_dsn.clone(),
            slot: self.slot.clone(),
            slot_cleanup_age: self.slot_cleanup_age,
            publication: self.publication.clone(),
            schemas: self.schemas.clone(),
            snapshot_rotation: self.snapshot_rotation,
            read_connections: self.read_connections,
            read_idle_connections: self.read_idle_connections,
            read_timeout: self.read_timeout,
            read_threads: self.read_threads,
            keepalive: Keepalive {
                idle: self.pg_keepalive_idle,
                interval: self.pg_keepalive_interval,
                retries: self.pg_keepalive_retries,
            },
            watched: vec![
                TableName::from(self.clients_table().as_str()),
                TableName::from(self.mutations_table().as_str()),
            ],
            ddl_trigger: self.ddl_trigger.clone(),
            ddl_prefix: self.ddl_prefix.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The configuration `vars` describe, over the three variables that
    /// have no default.
    fn config(vars: &[(&str, &str)]) -> Result<Config, String> {
        Config::from_lookup(|name| match name {
            "STREAMGRES_PG_DSN" => Some("postgresql://u:p@db/app".to_owned()),
            "STREAMGRES_MASTER_PG_DSN" => Some("postgresql://admin:p@db/app".to_owned()),
            "STREAMGRES_QUERY_URL" => Some("http://app/query".to_owned()),
            "STREAMGRES_MUTATE_URL" => Some("http://app/push".to_owned()),
            _ => vars
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned()),
        })
    }

    #[test]
    fn primary_database_is_required() {
        let error = Config::from_lookup(|name| match name {
            "STREAMGRES_PG_DSN" => Some("postgresql://db/app".to_owned()),
            "STREAMGRES_QUERY_URL" => Some("http://app/query".to_owned()),
            "STREAMGRES_MUTATE_URL" => Some("http://app/push".to_owned()),
            _ => None,
        })
        .unwrap_err();
        assert!(error.contains("STREAMGRES_MASTER_PG_DSN"));
    }

    /// The DDL trigger and its message prefix follow zero-cache's naming
    /// from the app id and the shard unless named outright.
    #[test]
    fn each_config_names_a_slot_of_its_own() {
        let first = config(&[("STREAMGRES_SLOT", "ignored")]).unwrap();
        let second = config(&[]).unwrap();
        for slot in [&first.slot, &second.slot] {
            let id = slot.strip_prefix("xyne_sync_slot_").expect("the prefix");
            assert_eq!(id.len(), 32);
            assert!(
                id.chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            );
            assert!(slot.len() <= 63, "PostgreSQL caps slot names at 63 bytes");
        }
        assert_ne!(first.slot, second.slot);
        assert_eq!(first.engine_settings().slot, first.slot);
    }

    #[test]
    fn read_dsn_defaults_to_direct_dsn_and_can_be_overridden() {
        let direct = config(&[]).unwrap();
        assert_eq!(direct.read_dsn, direct.dsn);
        assert_eq!(direct.engine_settings().read_dsn, direct.dsn);

        let pooled = config(&[("STREAMGRES_READ_PG_DSN", "postgresql://u:p@pooler/app")]).unwrap();
        assert_eq!(pooled.dsn, "postgresql://u:p@db/app");
        assert_eq!(pooled.read_dsn, "postgresql://u:p@pooler/app");
        assert_eq!(pooled.engine_settings().read_dsn, pooled.read_dsn);
    }

    #[test]
    fn read_idle_connection_limit_defaults_and_allows_zero() {
        let defaults = config(&[]).unwrap();
        assert_eq!(defaults.read_idle_connections, 16);
        assert_eq!(defaults.engine_settings().read_idle_connections, 16);

        let no_idle = config(&[("STREAMGRES_READ_IDLE_CONNECTIONS", "0")]).unwrap();
        assert_eq!(no_idle.read_idle_connections, 0);
        assert_eq!(no_idle.engine_settings().read_idle_connections, 0);

        let invalid = config(&[("STREAMGRES_READ_IDLE_CONNECTIONS", "many")]).unwrap_err();
        assert!(invalid.contains("STREAMGRES_READ_IDLE_CONNECTIONS"));
    }

    #[test]
    fn the_publication_is_read_not_derived() {
        assert_eq!(config(&[]).unwrap().publication, "xyne_sync_pub");
        let config = config_with(&[("STREAMGRES_PUBLICATION", "sdlc_feed")]);
        assert_eq!(config.publication, "sdlc_feed");
        assert_eq!(config.engine_settings().publication, "sdlc_feed");
    }

    #[test]
    fn streamgres_names_take_precedence_and_xyne_names_remain_compatible() {
        let legacy = config_with(&[("XYNE_SYNC_ADDR", "127.0.0.1:4848")]);
        assert_eq!(legacy.bind, "127.0.0.1:4848");

        let transitional = config_with(&[("STREAMGRES_SYNC_ADDR", "127.0.0.1:5000")]);
        assert_eq!(transitional.bind, "127.0.0.1:5000");

        let preferred = config_with(&[
            ("STREAMGRES_ADDR", "0.0.0.0:5000"),
            ("STREAMGRES_SYNC_ADDR", "127.0.0.1:5000"),
            ("XYNE_SYNC_ADDR", "127.0.0.1:4848"),
        ]);
        assert_eq!(preferred.bind, "0.0.0.0:5000");
    }

    #[test]
    fn metrics_prefix_is_configurable_and_validated() {
        assert_eq!(config(&[]).unwrap().metrics_prefix, "xyne_sync");
        assert_eq!(
            config_with(&[("STREAMGRES_METRICS_PREFIX", "streamgres")]).metrics_prefix,
            "streamgres"
        );
        let error = config(&[("STREAMGRES_METRICS_PREFIX", "bad-prefix")]).unwrap_err();
        assert!(error.contains("STREAMGRES_METRICS_PREFIX"), "{error}");
    }

    #[test]
    fn inactive_slot_cleanup_is_off_unless_an_age_is_set() {
        assert_eq!(config(&[]).unwrap().slot_cleanup_age, Duration::ZERO);
        let config = config_with(&[("STREAMGRES_SLOT_CLEANUP_AGE_MS", "3600000")]);
        assert_eq!(config.slot_cleanup_age, Duration::from_secs(3600));
        assert_eq!(
            config.engine_settings().slot_cleanup_age,
            Duration::from_secs(3600)
        );
    }

    #[test]
    fn ddl_trigger_and_prefix_follow_the_app_and_shard() {
        let config = config(&[]).unwrap();
        assert_eq!(config.ddl_trigger, "zero_ddl_end_0");
        assert_eq!(config.ddl_prefix, "zero/0/ddl");
        let config = config_with(&[("STREAMGRES_APP_ID", "zero02"), ("STREAMGRES_SHARD", "3")]);
        assert_eq!(config.ddl_trigger, "zero02_ddl_end_3");
        assert_eq!(config.ddl_prefix, "zero02/3/ddl");
        assert_eq!(config.engine_settings().ddl_trigger, "zero02_ddl_end_3");
    }

    /// [`config`], expected to parse.
    fn config_with(vars: &[(&str, &str)]) -> Config {
        config(vars).unwrap()
    }

    /// Left alone, the database connections are probed after 30 s of
    /// silence, every 10 s while unanswered, three times.
    #[test]
    fn the_keepalive_has_its_defaults() {
        let keepalive = config(&[]).unwrap().engine_settings().keepalive;
        assert_eq!(
            keepalive,
            Keepalive {
                idle: Duration::from_secs(30),
                interval: Duration::from_secs(10),
                retries: 3,
            }
        );
    }

    /// The three variables set the probing and reach the engine's settings.
    #[test]
    fn the_keepalive_is_read_from_the_environment() {
        let keepalive = config(&[
            ("STREAMGRES_PG_KEEPALIVE_IDLE_MS", "5000"),
            ("STREAMGRES_PG_KEEPALIVE_INTERVAL_MS", "2000"),
            ("STREAMGRES_PG_KEEPALIVE_RETRIES", "5"),
        ])
        .unwrap()
        .engine_settings()
        .keepalive;
        assert_eq!(
            keepalive,
            Keepalive {
                idle: Duration::from_secs(5),
                interval: Duration::from_secs(2),
                retries: 5,
            }
        );
    }

    /// Zero disables the message size cap, so it is refused.
    #[test]
    fn zero_max_message_bytes_is_refused() {
        let error = config(&[("STREAMGRES_MAX_MESSAGE_BYTES", "0")]).unwrap_err();
        assert!(error.contains("STREAMGRES_MAX_MESSAGE_BYTES"), "{error}");
    }

    /// A value that is not a number is refused by the variable's name.
    #[test]
    fn a_malformed_keepalive_is_refused_by_name() {
        let error = config(&[("STREAMGRES_PG_KEEPALIVE_RETRIES", "three")]).unwrap_err();
        assert!(error.contains("STREAMGRES_PG_KEEPALIVE_RETRIES"), "{error}");
        let error = config(&[("STREAMGRES_PG_KEEPALIVE_IDLE_MS", "soon")]).unwrap_err();
        assert!(error.contains("STREAMGRES_PG_KEEPALIVE_IDLE_MS"), "{error}");
    }
}
