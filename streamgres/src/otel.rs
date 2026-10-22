//! The server's telemetry pushed to a collector, configured the way the
//! reference server's is: by the standard `OTEL_*` environment variables,
//! so a deployment that already feeds a collector from the reference
//! server feeds it from this server with the same block of settings.
//! Metrics go out over OTLP/HTTP as JSON (the reference server's own
//! default protocol) every
//! `OTEL_METRIC_EXPORT_INTERVAL`; log records, when the logs exporter is
//! on, go out in batches as the log thread writes them, beside the lines
//! it writes to stderr (the reference server tees the same way). One thread,
//! `streamgres-otel`, does all of it from its own small runtime: nothing
//! here runs on a thread that serves clients, a slow or absent collector
//! costs a dropped batch and a counted failure, never a wait.
//!
//! What is read, as the reference server and the OpenTelemetry
//! specification read it: a signal is on when `OTEL_EXPORTER_OTLP_ENDPOINT`, its own
//! `OTEL_EXPORTER_OTLP_{METRICS,LOGS}_ENDPOINT` or its own
//! `OTEL_{METRICS,LOGS}_EXPORTER` is set, and that exporter is not `none`;
//! `OTEL_SDK_DISABLED=true` turns everything off. The base endpoint gets
//! `/v1/metrics` and `/v1/logs` appended, a signal's own endpoint is used
//! as it is. `OTEL_EXPORTER_OTLP_HEADERS` (and per signal) are sent with
//! every request; `OTEL_EXPORTER_OTLP_TIMEOUT` bounds one; the resource is
//! `OTEL_RESOURCE_ATTRIBUTES` with `OTEL_SERVICE_NAME` (default
//! `streamgres`), the version and the instance added. Traces are not
//! produced: `OTEL_TRACES_EXPORTER` is accepted and ignored.
//!
//! The metrics are [`crate::stats::Stats::metrics`], the same names,
//! labels and values `/metrics` serves, as cumulative sums, gauges and
//! explicit-bounds histograms, so a collector that exports to Prometheus
//! yields the series a scrape of `/metrics` would.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{Value as Json, json};

use crate::log::{Level, Line, log_error, log_event, log_info};
use crate::metric::{Kind, Metric, Value};
use crate::stats::Stats;

/// Where one signal is sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub url: String,
    pub headers: Vec<(String, String)>,
}

/// What the environment asks of the exporter.
#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub metrics: Option<Endpoint>,
    pub logs: Option<Endpoint>,
    /// `OTEL_METRIC_EXPORT_INTERVAL` (60000 ms).
    pub interval: Duration,
    /// `OTEL_EXPORTER_OTLP_TIMEOUT` (10000 ms).
    pub timeout: Duration,
    /// `OTEL_BLRP_SCHEDULE_DELAY` (1000 ms): how long a log record waits
    /// for its batch at most.
    pub log_delay: Duration,
    /// `OTEL_BLRP_MAX_EXPORT_BATCH_SIZE` (512).
    pub log_batch: usize,
    /// `OTEL_BLRP_MAX_QUEUE_SIZE` (2048): past it records are dropped and
    /// counted.
    pub log_queue: usize,
    pub resource: Vec<(String, String)>,
    /// What was asked for and is not spoken, to be said once at startup.
    pub notes: Vec<String>,
}

impl Config {
    /// The configuration of the process's environment.
    pub fn from_env() -> Self {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// The configuration `lookup` describes; an unset or blank variable
    /// is absent.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Self {
        let get = |key: &str| {
            lookup(key)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        let millis = |key: &str, default: u64| {
            Duration::from_millis(
                get(key)
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(default),
            )
        };
        let count = |key: &str, default: usize| {
            get(key)
                .and_then(|value| value.parse().ok())
                .filter(|count| *count > 0)
                .unwrap_or(default)
        };
        let disabled =
            get("OTEL_SDK_DISABLED").is_some_and(|value| value.eq_ignore_ascii_case("true"));
        let base = get("OTEL_EXPORTER_OTLP_ENDPOINT");
        let mut notes = Vec::new();
        let signal = |name: &str, path: &str, notes: &mut Vec<String>| -> Option<Endpoint> {
            let own = get(&format!("OTEL_EXPORTER_OTLP_{name}_ENDPOINT"));
            let exporter = get(&format!("OTEL_{name}_EXPORTER"));
            if disabled || (base.is_none() && own.is_none() && exporter.is_none()) {
                return None;
            }
            let exporter = exporter.unwrap_or_else(|| "otlp".to_owned());
            if !exporter
                .split(',')
                .any(|one| one.trim().eq_ignore_ascii_case("otlp"))
            {
                if !exporter.eq_ignore_ascii_case("none") {
                    notes.push(format!(
                        "OTEL_{name}_EXPORTER={exporter}: only `otlp` is spoken, {} stay off",
                        name.to_ascii_lowercase()
                    ));
                }
                return None;
            }
            let protocol = get(&format!("OTEL_EXPORTER_OTLP_{name}_PROTOCOL"))
                .or_else(|| get("OTEL_EXPORTER_OTLP_PROTOCOL"))
                .unwrap_or_else(|| "http/json".to_owned());
            if protocol.eq_ignore_ascii_case("grpc") {
                notes.push(format!(
                    "the {} exporter is asked for grpc: OTLP/HTTP with JSON is what is sent, to the HTTP port of the collector (4318)",
                    name.to_ascii_lowercase()
                ));
            }
            let url = match own {
                Some(own) => own,
                None => format!(
                    "{}/{path}",
                    base.clone()
                        .unwrap_or_else(|| "http://localhost:4318".to_owned())
                        .trim_end_matches('/')
                ),
            };
            let headers = get(&format!("OTEL_EXPORTER_OTLP_{name}_HEADERS"))
                .or_else(|| get("OTEL_EXPORTER_OTLP_HEADERS"))
                .map(|text| pairs(&text))
                .unwrap_or_default();
            Some(Endpoint { url, headers })
        };
        let metrics = signal("METRICS", "v1/metrics", &mut notes);
        let logs = signal("LOGS", "v1/logs", &mut notes);
        let mut resource = get("OTEL_RESOURCE_ATTRIBUTES")
            .map(|text| pairs(&text))
            .unwrap_or_default();
        let mut set = |key: &str, value: String, overriding: bool| match resource
            .iter_mut()
            .find(|(known, _)| known == key)
        {
            Some(entry) if overriding => entry.1 = value,
            Some(_) => {}
            None => resource.push((key.to_owned(), value)),
        };
        match get("OTEL_SERVICE_NAME") {
            Some(name) => set("service.name", name, true),
            None => set("service.name", "streamgres".to_owned(), false),
        }
        let version = match get("SOURCE_COMMIT") {
            Some(commit) => format!("{}+{commit}", env!("CARGO_PKG_VERSION")),
            None => env!("CARGO_PKG_VERSION").to_owned(),
        };
        set("service.version", version, false);
        if let Some(host) = get("HOSTNAME") {
            set("service.instance.id", host.clone(), false);
            set("host.name", host, false);
        }
        Config {
            metrics,
            logs,
            interval: millis("OTEL_METRIC_EXPORT_INTERVAL", 60_000).max(Duration::from_millis(100)),
            timeout: millis("OTEL_EXPORTER_OTLP_TIMEOUT", 10_000),
            log_delay: millis("OTEL_BLRP_SCHEDULE_DELAY", 1_000).max(Duration::from_millis(10)),
            log_batch: count("OTEL_BLRP_MAX_EXPORT_BATCH_SIZE", 512),
            log_queue: count("OTEL_BLRP_MAX_QUEUE_SIZE", 2_048),
            resource,
            notes,
        }
    }

    /// Whether anything is to be sent.
    pub fn enabled(&self) -> bool {
        self.metrics.is_some() || self.logs.is_some()
    }
}

/// `k1=v1,k2=v2` as pairs, values percent-decoded, as the specification
/// writes headers and resource attributes.
fn pairs(text: &str) -> Vec<(String, String)> {
    text.split(',')
        .filter_map(|pair| pair.split_once('='))
        .map(|(key, value)| {
            let value = percent_encoding::percent_decode_str(value.trim())
                .decode_utf8_lossy()
                .into_owned();
            (key.trim().to_owned(), value)
        })
        .filter(|(key, _)| !key.is_empty())
        .collect()
}

/// Start the exporter thread when the environment asks for one; the log
/// thread is tapped when logs are to be sent.
pub fn spawn(config: Config, stats: Arc<Stats>) {
    for note in &config.notes {
        log_info!("telemetry: {note}");
    }
    if !config.enabled() {
        return;
    }
    log_event!(
        Level::Info,
        "telemetry export started",
        metrics = config
            .metrics
            .as_ref()
            .map_or("off", |endpoint| endpoint.url.as_str()),
        logs = config
            .logs
            .as_ref()
            .map_or("off", |endpoint| endpoint.url.as_str()),
        interval_ms = config.interval.as_millis(),
        protocol = "http/json"
    );
    let spawned = std::thread::Builder::new()
        .name("streamgres-otel".to_owned())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            match runtime {
                Ok(runtime) => runtime.block_on(run(config, stats)),
                Err(error) => log_error!("telemetry thread: {error}"),
            }
        });
    if let Err(error) = spawned {
        log_error!("telemetry thread: {error}");
    }
}

/// The exporter's loop: metrics on their interval, log records as their
/// batch fills or its delay passes.
async fn run(config: Config, stats: Arc<Stats>) {
    let client = match reqwest::Client::builder().timeout(config.timeout).build() {
        Ok(client) => client,
        Err(error) => {
            log_error!("telemetry client: {error}");
            return;
        }
    };
    let (tap, mut lines) = tokio::sync::mpsc::channel::<Line>(config.log_queue);
    if config.logs.is_some() {
        crate::log::tap(tap);
    }
    let mut reporter = Reporter::default();
    let mut metrics_tick = tokio::time::interval(config.interval);
    metrics_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    metrics_tick.tick().await;
    let mut logs_tick = tokio::time::interval(config.log_delay);
    logs_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut batch: Vec<Line> = Vec::with_capacity(config.log_batch);
    loop {
        tokio::select! {
            _ = metrics_tick.tick(), if config.metrics.is_some() => {
                if let Some(endpoint) = &config.metrics {
                    let body = metrics_request(
                        &config.resource,
                        &stats.metrics(),
                        stats.started_unix_nanos(),
                        stats.histograms_since_unix_nanos(),
                        unix_nanos(),
                    );
                    let sent = post(&client, endpoint, &body).await;
                    reporter.report(&stats, "metrics", &stats.otel_metric_exports, sent);
                }
            }
            line = lines.recv(), if config.logs.is_some() => {
                if let Some(line) = line {
                    batch.push(line);
                }
                if batch.len() >= config.log_batch
                    && let Some(endpoint) = &config.logs
                {
                    let body = logs_request(&config.resource, &batch);
                    batch.clear();
                    let sent = post(&client, endpoint, &body).await;
                    reporter.report(&stats, "logs", &stats.otel_log_exports, sent);
                }
            }
            _ = logs_tick.tick(), if config.logs.is_some() => {
                if !batch.is_empty()
                    && let Some(endpoint) = &config.logs
                {
                    let body = logs_request(&config.resource, &batch);
                    batch.clear();
                    let sent = post(&client, endpoint, &body).await;
                    reporter.report(&stats, "logs", &stats.otel_log_exports, sent);
                }
            }
        }
    }
}

/// Counts every export and says a failure at most once a minute, so a
/// collector that is down costs one line a minute, not one per attempt.
#[derive(Default)]
struct Reporter {
    said: Option<Instant>,
}

impl Reporter {
    /// Count the outcome of one export of `signal`.
    fn report(
        &mut self,
        stats: &Stats,
        signal: &'static str,
        accepted: &std::sync::atomic::AtomicU64,
        sent: Result<(), String>,
    ) {
        match sent {
            Ok(()) => {
                accepted.fetch_add(1, Ordering::Relaxed);
            }
            Err(error) => {
                stats.otel_export_failures.fetch_add(1, Ordering::Relaxed);
                if self
                    .said
                    .is_none_or(|said| said.elapsed() >= Duration::from_secs(60))
                {
                    self.said = Some(Instant::now());
                    log_event!(
                        Level::Warn,
                        "telemetry export failed",
                        signal = signal,
                        error = error,
                        failures = stats.otel_export_failures.load(Ordering::Relaxed)
                    );
                }
            }
        }
    }
}

/// One OTLP/HTTP request with a JSON body; an answer outside 2xx is a
/// failure that says its status.
async fn post(client: &reqwest::Client, endpoint: &Endpoint, body: &Json) -> Result<(), String> {
    let mut request = client
        .post(&endpoint.url)
        .header("content-type", "application/json");
    for (key, value) in &endpoint.headers {
        request = request.header(key, value);
    }
    let response = request
        .body(body.to_string())
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("{} from {}", response.status(), endpoint.url))
    }
}

/// The time now, in nanoseconds since the Unix epoch.
fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos())
}

/// Attributes as OTLP writes them.
fn attributes(pairs: &[(impl AsRef<str>, impl AsRef<str>)]) -> Vec<Json> {
    pairs
        .iter()
        .map(|(key, value)| json!({"key": key.as_ref(), "value": {"stringValue": value.as_ref()}}))
        .collect()
}

/// An `ExportMetricsServiceRequest` carrying `metrics`: counters as
/// cumulative monotonic sums since `started`, histograms as cumulative
/// explicit-bounds histograms since `histograms_since` (their last
/// reset), each bucket its own count, 64-bit integers as strings, as the
/// protocol's JSON mapping has them.
pub fn metrics_request(
    resource: &[(String, String)],
    metrics: &[Metric],
    started: u128,
    histograms_since: u128,
    now: u128,
) -> Json {
    let now = now.to_string();
    let encoded: Vec<Json> = metrics
        .iter()
        .map(|metric| {
            let points: Vec<Json> = metric
                .points
                .iter()
                .map(|point| {
                    let mut encoded = json!({
                        "attributes": attributes(&point.labels),
                        "timeUnixNano": now,
                    });
                    match &point.value {
                        Value::Int(value) => encoded["asInt"] = json!(value.to_string()),
                        Value::Float(value) => encoded["asDouble"] = json!(value),
                        Value::Distribution {
                            bounds,
                            cumulative,
                            count,
                            sum,
                            max,
                        } => {
                            let mut before = 0u64;
                            let mut buckets: Vec<String> = Vec::with_capacity(bounds.len() + 1);
                            for at_most in cumulative {
                                buckets.push(at_most.saturating_sub(before).to_string());
                                before = before.max(*at_most);
                            }
                            buckets.push(count.saturating_sub(before).to_string());
                            encoded["count"] = json!(count.max(&before).to_string());
                            encoded["sum"] = json!(sum);
                            encoded["max"] = json!(max);
                            encoded["bucketCounts"] = json!(buckets);
                            encoded["explicitBounds"] = json!(bounds);
                        }
                    }
                    match metric.kind {
                        Kind::Counter => {
                            encoded["startTimeUnixNano"] = json!(started.to_string());
                        }
                        Kind::Histogram => {
                            encoded["startTimeUnixNano"] = json!(histograms_since.to_string());
                        }
                        Kind::Gauge => {}
                    }
                    encoded
                })
                .collect();
            let mut encoded = json!({
                "name": metric.name,
                "description": metric.help,
                "unit": metric.unit,
            });
            match metric.kind {
                Kind::Counter => {
                    encoded["sum"] = json!({
                        "dataPoints": points,
                        "aggregationTemporality": 2,
                        "isMonotonic": true,
                    });
                }
                Kind::Gauge => encoded["gauge"] = json!({"dataPoints": points}),
                Kind::Histogram => {
                    encoded["histogram"] = json!({
                        "dataPoints": points,
                        "aggregationTemporality": 2,
                    });
                }
            }
            encoded
        })
        .collect();
    json!({"resourceMetrics": [{
        "resource": {"attributes": attributes(resource)},
        "scopeMetrics": [{
            "scope": {"name": "streamgres", "version": env!("CARGO_PKG_VERSION")},
            "metrics": encoded,
        }],
    }]})
}

/// An `ExportLogsServiceRequest` carrying `lines`: the message as the
/// body, the thread and the event's fields as attributes (a field that
/// reads as a number or a boolean sent as one), the level as OTLP's
/// severity.
pub fn logs_request(resource: &[(String, String)], lines: &[Line]) -> Json {
    let records: Vec<Json> = lines
        .iter()
        .map(|line| {
            let at = line
                .at
                .timestamp_nanos_opt()
                .map_or_else(|| "0".to_owned(), |nanos| nanos.max(0).to_string());
            let (number, text) = match line.level {
                Level::Error => (17, "ERROR"),
                Level::Warn => (13, "WARN"),
                Level::Info => (9, "INFO"),
                Level::Debug => (5, "DEBUG"),
            };
            let mut attributes =
                vec![json!({"key": "thread", "value": {"stringValue": line.thread}})];
            for (key, value) in &line.fields {
                let value = match crate::log::field_value(value) {
                    Json::Number(number) if number.is_i64() || number.is_u64() => {
                        json!({"intValue": number.to_string()})
                    }
                    Json::Number(number) => json!({"doubleValue": number}),
                    Json::Bool(flag) => json!({"boolValue": flag}),
                    _ => json!({"stringValue": value}),
                };
                attributes.push(json!({"key": key, "value": value}));
            }
            json!({
                "timeUnixNano": at,
                "observedTimeUnixNano": at,
                "severityNumber": number,
                "severityText": text,
                "body": {"stringValue": line.message},
                "attributes": attributes,
            })
        })
        .collect();
    json!({"resourceLogs": [{
        "resource": {"attributes": attributes(resource)},
        "scopeLogs": [{
            "scope": {"name": "streamgres", "version": env!("CARGO_PKG_VERSION")},
            "logRecords": records,
        }],
    }]})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metric::Catalogue;
    use std::collections::HashMap;

    /// A configuration from `vars`.
    fn config(vars: &[(&str, &str)]) -> Config {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect();
        Config::from_lookup(|key| vars.get(key).cloned())
    }

    /// The block of settings the sandbox gives the reference server turns metrics on
    /// and leaves logs off, every five seconds, to the collector's
    /// `/v1/metrics`; with nothing set nothing is sent.
    #[test]
    fn the_settings_the_ref_server_runs_with_are_read_the_same() {
        let sandbox = config(&[
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318"),
            ("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json"),
            ("OTEL_METRICS_EXPORTER", "otlp"),
            ("OTEL_TRACES_EXPORTER", "none"),
            ("OTEL_LOGS_EXPORTER", "none"),
            ("OTEL_METRIC_EXPORT_INTERVAL", "5000"),
        ]);
        assert_eq!(
            sandbox
                .metrics
                .as_ref()
                .map(|endpoint| endpoint.url.as_str()),
            Some("http://otel-collector:4318/v1/metrics")
        );
        assert_eq!(sandbox.logs, None);
        assert_eq!(sandbox.interval, Duration::from_secs(5));
        assert!(sandbox.notes.is_empty());
        assert!(
            sandbox
                .resource
                .contains(&("service.name".to_owned(), "streamgres".to_owned()))
        );

        let unset = config(&[]);
        assert!(!unset.enabled());
        assert_eq!(unset.interval, Duration::from_secs(60));
    }

    /// The endpoint alone turns both signals on; a signal's own endpoint is
    /// used as it is; headers and resource attributes are decoded; the
    /// service name overrides the resource's; the SDK switch turns all
    /// off; grpc is said not to be spoken.
    #[test]
    fn endpoints_headers_and_the_resource_follow_the_specification() {
        let both = config(&[("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318/")]);
        assert_eq!(
            both.metrics.as_ref().map(|e| e.url.as_str()),
            Some("http://collector:4318/v1/metrics")
        );
        assert_eq!(
            both.logs.as_ref().map(|e| e.url.as_str()),
            Some("http://collector:4318/v1/logs")
        );

        let own = config(&[
            (
                "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
                "https://logs.example/otlp/v1/logs",
            ),
            (
                "OTEL_EXPORTER_OTLP_HEADERS",
                "authorization=Bearer%20abc,x-scope=team",
            ),
            ("OTEL_EXPORTER_OTLP_LOGS_HEADERS", "x-logs=1"),
            ("OTEL_SERVICE_NAME", "streamgres-sandbox"),
            (
                "OTEL_RESOURCE_ATTRIBUTES",
                "service.name=ignored,deployment.environment=sandbox",
            ),
        ]);
        assert_eq!(own.metrics, None);
        let logs = own.logs.expect("logs on");
        assert_eq!(logs.url, "https://logs.example/otlp/v1/logs");
        assert_eq!(logs.headers, vec![("x-logs".to_owned(), "1".to_owned())]);
        assert!(
            own.resource
                .contains(&("service.name".to_owned(), "streamgres-sandbox".to_owned()))
        );
        assert!(
            own.resource
                .contains(&("deployment.environment".to_owned(), "sandbox".to_owned()))
        );

        let headers = config(&[
            ("OTEL_METRICS_EXPORTER", "otlp"),
            (
                "OTEL_EXPORTER_OTLP_HEADERS",
                "authorization=Bearer%20abc,x-scope=team",
            ),
        ]);
        let metrics = headers.metrics.expect("metrics on");
        assert_eq!(metrics.url, "http://localhost:4318/v1/metrics");
        assert_eq!(
            metrics.headers[0],
            ("authorization".to_owned(), "Bearer abc".to_owned())
        );

        let off = config(&[
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318"),
            ("OTEL_SDK_DISABLED", "true"),
        ]);
        assert!(!off.enabled());

        let grpc = config(&[
            ("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4317"),
            ("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"),
            ("OTEL_LOGS_EXPORTER", "console"),
        ]);
        assert!(grpc.metrics.is_some());
        assert_eq!(grpc.logs, None);
        assert_eq!(grpc.notes.len(), 2, "{:?}", grpc.notes);
    }

    /// A counter is a cumulative monotonic sum from the start, a gauge a
    /// gauge, and a histogram's buckets are each their own count, adding up
    /// to the count, with 64-bit integers written as strings.
    #[test]
    fn metrics_are_encoded_as_the_protocol_has_them() {
        let mut catalogue = Catalogue::default();
        catalogue.point(
            "x_total",
            Kind::Counter,
            "",
            "things",
            vec![("result", "hit".to_owned())],
            Value::Int(3),
        );
        catalogue.point("x_open", Kind::Gauge, "", "", Vec::new(), Value::Float(1.5));
        catalogue.point(
            "x_seconds",
            Kind::Histogram,
            "s",
            "how long",
            vec![("kind", "cold".to_owned())],
            Value::Distribution {
                bounds: vec![0.5, 1.0],
                cumulative: vec![1, 3],
                count: 4,
                sum: 6.5,
                max: 4.0,
            },
        );
        let resource = vec![("service.name".to_owned(), "streamgres".to_owned())];
        let body = metrics_request(&resource, &catalogue.into_metrics(), 1_000, 2_000, 3_000);
        let scope = &body["resourceMetrics"][0]["scopeMetrics"][0];
        assert_eq!(
            body["resourceMetrics"][0]["resource"]["attributes"][0]["value"]["stringValue"],
            "streamgres"
        );
        let counter = &scope["metrics"][0];
        assert_eq!(counter["name"], "x_total");
        assert_eq!(counter["sum"]["isMonotonic"], true);
        assert_eq!(counter["sum"]["aggregationTemporality"], 2);
        let point = &counter["sum"]["dataPoints"][0];
        assert_eq!(point["asInt"], "3");
        assert_eq!(point["startTimeUnixNano"], "1000");
        assert_eq!(point["timeUnixNano"], "3000");
        assert_eq!(point["attributes"][0]["key"], "result");
        assert_eq!(
            scope["metrics"][1]["gauge"]["dataPoints"][0]["asDouble"],
            1.5
        );
        let histogram = &scope["metrics"][2];
        assert_eq!(histogram["unit"], "s");
        let point = &histogram["histogram"]["dataPoints"][0];
        assert_eq!(point["bucketCounts"], json!(["1", "2", "1"]));
        assert_eq!(point["explicitBounds"], json!([0.5, 1.0]));
        assert_eq!(point["count"], "4");
        assert_eq!(point["startTimeUnixNano"], "2000");
    }

    /// A log line becomes a record: the level as a severity, the message
    /// as the body, the thread and the fields as typed attributes.
    #[test]
    fn log_lines_are_encoded_as_records() {
        let line = Line {
            at: chrono::DateTime::from_timestamp(1_700_000_000, 5).expect("a time"),
            level: Level::Warn,
            thread: "streamgres-server".to_owned(),
            message: "heavy read".to_owned(),
            fields: vec![
                ("name", "channelMessages".to_owned()),
                ("rows", "16000".to_owned()),
                ("ok", "true".to_owned()),
            ],
        };
        let body = logs_request(&[], &[line]);
        let record = &body["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0];
        assert_eq!(record["severityNumber"], 13);
        assert_eq!(record["severityText"], "WARN");
        assert_eq!(record["body"]["stringValue"], "heavy read");
        assert_eq!(record["timeUnixNano"], "1700000000000000005");
        assert_eq!(
            record["attributes"][0]["value"]["stringValue"],
            "streamgres-server"
        );
        assert_eq!(record["attributes"][2]["value"]["intValue"], "16000");
        assert_eq!(record["attributes"][3]["value"]["boolValue"], true);
    }
}
