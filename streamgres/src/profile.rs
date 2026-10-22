//! Continuous profiling pushed to Pyroscope: where the server's CPU time
//! goes and which code holds its heap, by function, as flame graphs beside
//! the stage histograms `/metrics` serves. Off unless
//! `STREAMGRES_PYROSCOPE_URL` is set; off, nothing is installed, no signal
//! handler, no timer, no thread, and jemalloc's heap sampling stays off.
//!
//! On, the pprof-rs backend of the `pyroscope` crate arms `ITIMER_PROF`
//! at `STREAMGRES_PYROSCOPE_SAMPLE_RATE` (100 Hz): the kernel sends
//! `SIGPROF` to a running thread for every 1/rate s of CPU time the
//! process spends, so an idle server is not interrupted at all and a busy
//! one pays for one stack walk (framehop, from the unwind tables) per
//! sample. The agent's own threads gather the samples every ten
//! seconds, symbolise them and post them to the server's
//! `/push.v1.PusherService/Push`; nothing here runs on a thread that
//! serves clients. A failed upload is logged and the next one tried.
//!
//! The heap profile (`STREAMGRES_PYROSCOPE_HEAP`, on by default) is
//! jemalloc's: the binaries run on jemalloc built with its profiler and
//! started with sampling off (`malloc_conf` in `src/bin/server.rs`); here
//! sampling is switched on, one allocation per 512 KiB allocated has its
//! stack recorded, and a second agent posts what is still live every ten
//! seconds as `memory:inuse_space`: the bytes held, by the stack that
//! allocated them. Allocations made before profiling starts are not in it.
//!
//! Every profile carries `service_name` (the application),
//! `thread_name` (so the engine thread's graph is read apart from the
//! groups' and the reads'), `version` (the crate's, with the image's
//! `SOURCE_COMMIT`), `service_git_ref` (the commit alone), `instance`
//! (`HOSTNAME`, the pod) and whatever `STREAMGRES_PYROSCOPE_TAGS` adds.

use std::sync::mpsc;
use std::time::{Duration, Instant};

use pyroscope::PyroscopeAgent;
use pyroscope::backend::jemalloc::jemalloc_backend;
use pyroscope::backend::{
    BackendConfig, BackendImpl, BackendUninitialized, PprofConfig, pprof_backend,
};
use pyroscope::pyroscope::{PyroscopeAgentBuilder, PyroscopeAgentRunning};

use crate::log::{self, Level, log_event, log_warn};

/// What the environment asks of the profiler.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// `STREAMGRES_PYROSCOPE_URL`: the server's base URL, no trailing `/`.
    pub url: String,
    /// `STREAMGRES_PYROSCOPE_APPLICATION` (`streamgres`): the profiles'
    /// `service_name`.
    pub application: String,
    /// `STREAMGRES_PYROSCOPE_SAMPLE_RATE` (100): samples per second of CPU
    /// time, 1 to 1000.
    pub sample_rate: u32,
    /// `STREAMGRES_PYROSCOPE_USER` and `STREAMGRES_PYROSCOPE_PASSWORD`:
    /// basic authentication, as Grafana Cloud asks for.
    pub basic_auth: Option<(String, String)>,
    /// `STREAMGRES_PYROSCOPE_TENANT`: sent as `X-Scope-OrgID` to a
    /// multi-tenant server.
    pub tenant: Option<String>,
    /// The labels every profile carries, in order.
    pub tags: Vec<(String, String)>,
    /// `STREAMGRES_PYROSCOPE_HEAP` (true): whether the heap is profiled
    /// beside the CPU.
    pub heap: bool,
}

impl Config {
    /// The configuration of the process's environment: `None` when
    /// profiling is off.
    pub fn from_env() -> Result<Option<Config>, String> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// The configuration `lookup` describes; an unset or blank variable
    /// is absent, a malformed one an error.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Option<Config>, String> {
        let get = |key: &str| {
            lookup(key)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
                .or_else(|| {
                    key.strip_prefix("STREAMGRES_")
                        .and_then(|suffix| lookup(&format!("STREAMGRES_SYNC_{suffix}")))
                        .map(|value| value.trim().to_owned())
                        .filter(|value| !value.is_empty())
                })
                .or_else(|| {
                    key.strip_prefix("STREAMGRES_")
                        .and_then(|suffix| lookup(&format!("XYNE_SYNC_{suffix}")))
                        .map(|value| value.trim().to_owned())
                        .filter(|value| !value.is_empty())
                })
        };
        let Some(text) = get("STREAMGRES_PYROSCOPE_URL") else {
            return Ok(None);
        };
        let url = base_url(&text)
            .map_err(|why| format!("STREAMGRES_PYROSCOPE_URL {why}, got `{text}`"))?;
        let application =
            get("STREAMGRES_PYROSCOPE_APPLICATION").unwrap_or_else(|| "streamgres".to_owned());
        let sample_rate = match get("STREAMGRES_PYROSCOPE_SAMPLE_RATE") {
            Some(text) => text
                .parse::<u32>()
                .ok()
                .filter(|rate| (1..=1000).contains(rate))
                .ok_or_else(|| {
                    format!(
                        "STREAMGRES_PYROSCOPE_SAMPLE_RATE must be a number of samples a second from 1 to 1000, got `{text}`"
                    )
                })?,
            None => 100,
        };
        let basic_auth = match (
            get("STREAMGRES_PYROSCOPE_USER"),
            get("STREAMGRES_PYROSCOPE_PASSWORD"),
        ) {
            (Some(user), Some(password)) => Some((user, password)),
            (None, None) => None,
            _ => {
                return Err(
                    "STREAMGRES_PYROSCOPE_USER and STREAMGRES_PYROSCOPE_PASSWORD are set together or not at all"
                        .to_owned(),
                );
            }
        };
        let tenant = get("STREAMGRES_PYROSCOPE_TENANT");
        let heap = match get("STREAMGRES_PYROSCOPE_HEAP").as_deref() {
            None | Some("true") | Some("1") => true,
            Some("false") | Some("0") => false,
            Some(other) => {
                return Err(format!(
                    "STREAMGRES_PYROSCOPE_HEAP must be true or false, got `{other}`"
                ));
            }
        };

        let mut tags: Vec<(String, String)> = Vec::new();
        let commit = get("SOURCE_COMMIT").filter(|commit| commit != "unknown");
        let version = match &commit {
            Some(commit) => format!("{}+{commit}", env!("CARGO_PKG_VERSION")),
            None => env!("CARGO_PKG_VERSION").to_owned(),
        };
        tags.push(("version".to_owned(), version));
        if let Some(commit) = commit {
            tags.push(("service_git_ref".to_owned(), commit));
        }
        if let Some(host) = get("HOSTNAME") {
            tags.push(("instance".to_owned(), host));
        }
        if let Some(text) = get("STREAMGRES_PYROSCOPE_TAGS") {
            for pair in text.split(',').filter(|pair| !pair.trim().is_empty()) {
                let (key, value) = pair
                    .split_once('=')
                    .map(|(key, value)| (key.trim(), value.trim()))
                    .filter(|(key, value)| label_name(key) && !value.is_empty())
                    .ok_or_else(|| {
                        format!(
                            "STREAMGRES_PYROSCOPE_TAGS must be `name=value,...` with names of letters, digits and `_` not starting with a digit, got `{}`",
                            pair.trim()
                        )
                    })?;
                if RESERVED.contains(&key) {
                    return Err(format!(
                        "STREAMGRES_PYROSCOPE_TAGS cannot set `{key}`: the server sets it"
                    ));
                }
                match tags.iter_mut().find(|(known, _)| known == key) {
                    Some(entry) => entry.1 = value.to_owned(),
                    None => tags.push((key.to_owned(), value.to_owned())),
                }
            }
        }
        Ok(Some(Config {
            url,
            application,
            sample_rate,
            basic_auth,
            tenant,
            tags,
            heap,
        }))
    }
}

/// Labels the agent sets itself, which a tag of the same name would
/// shadow or duplicate.
const RESERVED: &[&str] = &["service_name", "thread_name", "thread_id", "pid"];

/// `text` as a URL the agent can append its push path to: `http` or
/// `https`, a host, no query or fragment, and no trailing `/` (the agent
/// appends path segments, and after a trailing `/` it would append them
/// behind an empty one).
fn base_url(text: &str) -> Result<String, &'static str> {
    let url = reqwest::Url::parse(text).map_err(|_| "must be a URL")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("must be an http or https URL");
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("must name a host");
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("cannot carry a query or a fragment");
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

/// Whether `name` is a label name Pyroscope accepts from a client: `__`
/// starts the server's own.
fn label_name(name: &str) -> bool {
    if name.starts_with("__") {
        return false;
    }
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|rest| rest.is_ascii_alphanumeric() || rest == '_')
}

/// How long a stopping profiler is waited for. An agent's stop hands the
/// last profile to its uploader, which can be queued behind uploads to a
/// server that is down, and its shutdown joins a timer thread that wakes
/// only on the next ten-second boundary: unbounded, the two would stretch
/// the shutdown `SIGTERM` starts (three seconds of closing, five more to
/// exit, in a grace period of fifteen) past the grace period. The agents
/// are stopped together, and the last profiles are sent within this
/// unless the server is slow or down.
const STOP_WAIT: Duration = Duration::from_secs(2);

/// How far a stopping agent has got.
enum Step {
    /// The last profile is taken and handed to the uploader.
    Stopped,
    /// The uploader is done with it and the agent's threads are joined.
    ShutDown,
}

/// The running profiler: one agent for the CPU, and one for the heap when
/// it is profiled. Dropping it stops the sampling and sends the last
/// profiles, waiting [`STOP_WAIT`] at most.
pub struct Profiler {
    agents: Vec<(&'static str, PyroscopeAgent<PyroscopeAgentRunning>)>,
}

impl Drop for Profiler {
    fn drop(&mut self) {
        let agents = std::mem::take(&mut self.agents);
        if agents.is_empty() {
            return;
        }
        let started = Instant::now();
        let deadline = started + STOP_WAIT;
        // Each agent on a thread of its own, in two steps told apart: the
        // stop, which takes the last profile and hands it to the uploader,
        // and the shutdown, which returns once the uploader has sent it
        // (or logged that it could not).
        let (step_tx, step_rx) = mpsc::channel::<(&'static str, Result<Step, String>)>();
        let mut outcome: Vec<(&'static str, &'static str)> = Vec::new();
        for (kind, agent) in agents {
            let step_tx = step_tx.clone();
            let spawned = std::thread::Builder::new()
                .name(format!("streamgres-profile-stop-{kind}"))
                .spawn(move || match agent.stop() {
                    Ok(ready) => {
                        let _ = step_tx.send((kind, Ok(Step::Stopped)));
                        ready.shutdown();
                        let _ = step_tx.send((kind, Ok(Step::ShutDown)));
                    }
                    Err(error) => {
                        let _ = step_tx.send((kind, Err(error.to_string())));
                    }
                });
            match spawned {
                Ok(_) => outcome.push((kind, "dropped")),
                Err(error) => {
                    log_warn!("profiling: no thread to stop the {kind} agent on: {error}");
                    outcome.push((kind, "failed"));
                }
            }
        }
        drop(step_tx);
        let settled = |outcome: &[(&str, &str)]| {
            outcome
                .iter()
                .all(|(_, state)| matches!(*state, "sent" | "failed"))
        };
        while !settled(&outcome) {
            let Ok((kind, step)) =
                step_rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            else {
                break;
            };
            let state = match step {
                Ok(Step::Stopped) => "uploading",
                Ok(Step::ShutDown) => "sent",
                Err(error) => {
                    log_warn!("profiling: the {kind} agent did not stop cleanly: {error}");
                    "failed"
                }
            };
            if let Some(entry) = outcome.iter_mut().find(|(known, _)| *known == kind) {
                entry.1 = state;
            }
        }
        let last = |kind: &str| {
            outcome
                .iter()
                .find(|(known, _)| *known == kind)
                .map_or("off", |(_, state)| *state)
        };
        log_event!(
            Level::Info,
            "profiling stopped",
            elapsed_ms = started.elapsed().as_millis(),
            last_cpu_profile = last("cpu"),
            last_heap_profile = last("heap")
        );
        // The process exits next: the lines above are written before it.
        log::flush();
    }
}

/// Start profiling when `config` asks for it; `None` is off, and returns
/// no profiler. A profiler that cannot start (both need a writable
/// temporary directory) is a warning, never a reason not to serve: the
/// other one runs alone, or none does.
pub fn start(config: Option<Config>) -> Result<Option<Profiler>, String> {
    let Some(config) = config else {
        return Ok(None);
    };
    // The agent's HTTP client is rustls with no provider of its own: the
    // process's default is ring, the one reqwest's own client uses. An
    // error means a default is already installed, which serves as well.
    let _ = rustls::crypto::ring::default_provider().install_default();
    install_log_bridge();

    let cpu = pprof_backend(
        PprofConfig {
            sample_rate: config.sample_rate,
        },
        BackendConfig {
            report_thread_id: false,
            report_thread_name: true,
            report_pid: false,
        },
    );
    let mut agents = Vec::new();
    let cpu = match run(&config, cpu) {
        Ok(agent) => {
            agents.push(("cpu", agent));
            "on"
        }
        Err(error) => {
            log_warn!("profiling: no CPU profile: the CPU agent could not start: {error}");
            "unavailable"
        }
    };
    let heap = if !config.heap {
        "off"
    } else {
        match start_heap_sampling() {
            Err(why) => {
                log_warn!("profiling: no heap profile: {why}");
                "unavailable"
            }
            Ok(()) => match run(&config, jemalloc_backend()) {
                Ok(agent) => {
                    agents.push(("heap", agent));
                    "inuse_space"
                }
                Err(error) => {
                    log_warn!("profiling: no heap profile: the heap agent could not start: {error}");
                    stop_heap_sampling();
                    "unavailable"
                }
            },
        }
    };
    if agents.is_empty() {
        return Ok(None);
    }
    log_event!(
        Level::Info,
        "profiling started",
        url = config.url,
        application = config.application,
        cpu = cpu,
        sample_rate_hz = config.sample_rate,
        heap = heap,
        auth = if config.basic_auth.is_some() {
            "basic"
        } else {
            "none"
        },
        tenant = config.tenant.as_deref().unwrap_or("none")
    );
    Ok(Some(Profiler { agents }))
}

/// An agent posting what `backend` samples to the server `config` names,
/// started.
fn run(
    config: &Config,
    backend: BackendImpl<BackendUninitialized>,
) -> pyroscope::Result<PyroscopeAgent<PyroscopeAgentRunning>> {
    let mut builder = PyroscopeAgentBuilder::new(
        &config.url,
        &config.application,
        config.sample_rate,
        "pyroscope-rs",
        env!("CARGO_PKG_VERSION"),
        backend,
    )
    .tags(
        config
            .tags
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect(),
    );
    if let Some((user, password)) = &config.basic_auth {
        builder = builder.basic_auth(user, password);
    }
    if let Some(tenant) = &config.tenant {
        builder = builder.tenant_id(tenant.clone());
    }
    builder.build()?.start()
}

/// Switch jemalloc's heap sampling on, and take one dump the way the
/// agent will every ten seconds, so a process that cannot (no profiler in
/// its jemalloc, no writable temporary directory for the dump) says so
/// once at startup: the agent's own thread would end at its first failed
/// dump, silently.
fn start_heap_sampling() -> Result<(), String> {
    let ctl = jemalloc_pprof::PROF_CTL.as_ref().ok_or(
        "this binary's jemalloc was not started with its profiler (`prof:true` in its malloc_conf)",
    )?;
    let mut ctl = ctl
        .try_lock()
        .map_err(|_| "jemalloc's profiler is held elsewhere")?;
    ctl.activate()
        .map_err(|error| format!("jemalloc's sampling could not be switched on: {error}"))?;
    if let Err(error) = ctl.dump_pprof() {
        let _ = ctl.deactivate();
        return Err(format!(
            "jemalloc's heap could not be dumped (it is written to the temporary directory, which must be writable): {error}"
        ));
    }
    Ok(())
}

/// Switch jemalloc's heap sampling off again.
fn stop_heap_sampling() {
    if let Some(ctl) = jemalloc_pprof::PROF_CTL.as_ref()
        && let Ok(mut ctl) = ctl.try_lock()
    {
        let _ = ctl.deactivate();
    }
}

/// The `pyroscope` crate logs through the `log` facade, a failed upload
/// at error; its warnings and errors are carried into the server's log,
/// every other crate's `log` records left as they were (nowhere).
struct LogBridge;

impl ::log::Log for LogBridge {
    fn enabled(&self, metadata: &::log::Metadata<'_>) -> bool {
        metadata.level() <= ::log::Level::Warn && from_agent(metadata.target())
    }

    fn log(&self, record: &::log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let level = match record.level() {
            ::log::Level::Error => Level::Error,
            _ => Level::Warn,
        };
        log::log(level, format_args!("profiling: {}", record.args()));
    }

    fn flush(&self) {}
}

/// Whether a `log` target is the agent's: its module paths
/// (`pyroscope::session`) or its tags (`Pyroscope::Session`).
fn from_agent(target: &str) -> bool {
    target
        .get(..9)
        .is_some_and(|head| head.eq_ignore_ascii_case("pyroscope"))
}

/// Install [`LogBridge`] as the `log` facade's logger, unless one is.
fn install_log_bridge() {
    static BRIDGE: LogBridge = LogBridge;
    if ::log::set_logger(&BRIDGE).is_ok() {
        ::log::set_max_level(::log::LevelFilter::Warn);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A configuration from `vars`.
    fn config(vars: &[(&str, &str)]) -> Result<Option<Config>, String> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect();
        Config::from_lookup(|key| vars.get(key).cloned())
    }

    /// Nothing set, or the URL blank, is off: no profiler, nothing
    /// installed.
    #[test]
    fn without_a_url_profiling_is_off() {
        assert_eq!(config(&[]), Ok(None));
        assert_eq!(config(&[("STREAMGRES_PYROSCOPE_URL", "  ")]), Ok(None));
        assert_eq!(
            config(&[("STREAMGRES_PYROSCOPE_SAMPLE_RATE", "50")]),
            Ok(None)
        );
        assert!(matches!(start(None), Ok(None)));
    }

    #[test]
    fn streamgres_profile_names_precede_legacy_xyne_names() {
        let legacy = config(&[("XYNE_SYNC_PYROSCOPE_URL", "http://legacy:4040")])
            .unwrap()
            .unwrap();
        assert_eq!(legacy.url, "http://legacy:4040");

        let transitional = config(&[("STREAMGRES_SYNC_PYROSCOPE_URL", "http://old:4040")])
            .unwrap()
            .unwrap();
        assert_eq!(transitional.url, "http://old:4040");

        let preferred = config(&[
            ("STREAMGRES_PYROSCOPE_URL", "http://new:4040"),
            ("STREAMGRES_SYNC_PYROSCOPE_URL", "http://old:4040"),
            ("XYNE_SYNC_PYROSCOPE_URL", "http://legacy:4040"),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(preferred.url, "http://new:4040");
    }

    /// A URL alone takes every default; the image's commit and the pod's
    /// name become labels, the image's placeholder commit does not.
    #[test]
    fn a_url_alone_takes_the_defaults() {
        let on = config(&[
            ("STREAMGRES_PYROSCOPE_URL", "http://pyroscope:4040/"),
            ("SOURCE_COMMIT", "a12bb82"),
            ("HOSTNAME", "streamgres-0"),
        ])
        .unwrap()
        .unwrap();
        let version = format!("{}+a12bb82", env!("CARGO_PKG_VERSION"));
        assert_eq!(
            on,
            Config {
                url: "http://pyroscope:4040".to_owned(),
                application: "streamgres".to_owned(),
                sample_rate: 100,
                basic_auth: None,
                tenant: None,
                tags: vec![
                    ("version".to_owned(), version),
                    ("service_git_ref".to_owned(), "a12bb82".to_owned()),
                    ("instance".to_owned(), "streamgres-0".to_owned()),
                ],
                heap: true,
            }
        );
        let placeholder = config(&[
            ("STREAMGRES_PYROSCOPE_URL", "http://pyroscope:4040"),
            ("SOURCE_COMMIT", "unknown"),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(
            placeholder.tags,
            vec![("version".to_owned(), env!("CARGO_PKG_VERSION").to_owned())]
        );
    }

    /// Grafana Cloud's settings: https, basic authentication, a tenant,
    /// a lower rate and tags of the deployment's own, one overriding the
    /// version.
    #[test]
    fn every_setting_is_read() {
        let on = config(&[
            (
                "STREAMGRES_PYROSCOPE_URL",
                "https://profiles-prod-001.grafana.net",
            ),
            ("STREAMGRES_PYROSCOPE_APPLICATION", "streamgres-sandbox"),
            ("STREAMGRES_PYROSCOPE_SAMPLE_RATE", "49"),
            ("STREAMGRES_PYROSCOPE_USER", "123456"),
            ("STREAMGRES_PYROSCOPE_PASSWORD", "glc_token"),
            ("STREAMGRES_PYROSCOPE_TENANT", "team-a"),
            (
                "STREAMGRES_PYROSCOPE_TAGS",
                "env=sandbox, region = asia_south1 ,version=canary,",
            ),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(on.url, "https://profiles-prod-001.grafana.net");
        assert_eq!(on.application, "streamgres-sandbox");
        assert_eq!(on.sample_rate, 49);
        assert_eq!(
            on.basic_auth,
            Some(("123456".to_owned(), "glc_token".to_owned()))
        );
        assert_eq!(on.tenant.as_deref(), Some("team-a"));
        assert!(on.heap);
        for (text, heap) in [("false", false), ("0", false), ("true", true), ("1", true)] {
            let set = config(&[
                ("STREAMGRES_PYROSCOPE_URL", "http://pyroscope:4040"),
                ("STREAMGRES_PYROSCOPE_HEAP", text),
            ])
            .unwrap()
            .unwrap();
            assert_eq!(set.heap, heap, "{text}");
        }
        assert_eq!(
            on.tags,
            vec![
                ("version".to_owned(), "canary".to_owned()),
                ("env".to_owned(), "sandbox".to_owned()),
                ("region".to_owned(), "asia_south1".to_owned()),
            ]
        );
    }

    /// A malformed setting stops the server at startup with its name,
    /// rather than profiling with something else than was asked.
    #[test]
    fn a_malformed_setting_is_refused() {
        let url = ("STREAMGRES_PYROSCOPE_URL", "http://pyroscope:4040");
        let refused = |vars: &[(&str, &str)], names: &str| {
            let error = config(vars).unwrap_err();
            assert!(error.contains(names), "{error}");
        };
        for bad in [
            "pyroscope:4040",
            "localhost:4040",
            "ftp://pyroscope",
            "http://",
            "http://pyroscope:4040/?a=b",
            "http://pyroscope:4040/#top",
        ] {
            refused(
                &[("STREAMGRES_PYROSCOPE_URL", bad)],
                "STREAMGRES_PYROSCOPE_URL",
            );
        }
        for bad in ["0", "1001", "-5", "fast", "1.5"] {
            refused(
                &[url, ("STREAMGRES_PYROSCOPE_SAMPLE_RATE", bad)],
                "STREAMGRES_PYROSCOPE_SAMPLE_RATE",
            );
        }
        refused(
            &[url, ("STREAMGRES_PYROSCOPE_USER", "123456")],
            "STREAMGRES_PYROSCOPE_PASSWORD",
        );
        refused(
            &[url, ("STREAMGRES_PYROSCOPE_PASSWORD", "glc_token")],
            "STREAMGRES_PYROSCOPE_USER",
        );
        for bad in [
            "env",
            "env=",
            "=sandbox",
            "9env=x",
            "env.name=x",
            "a-b=c",
            "__name__=x",
        ] {
            refused(
                &[url, ("STREAMGRES_PYROSCOPE_TAGS", bad)],
                "STREAMGRES_PYROSCOPE_TAGS",
            );
        }
        for bad in ["yes", "off", "TRUE"] {
            refused(
                &[url, ("STREAMGRES_PYROSCOPE_HEAP", bad)],
                "STREAMGRES_PYROSCOPE_HEAP",
            );
        }
        refused(
            &[url, ("STREAMGRES_PYROSCOPE_TAGS", "thread_name=x")],
            "`thread_name`",
        );
    }

    /// The agent appends `push.v1.PusherService/Push` as path segments to
    /// the URL it is given: the base kept by the configuration yields the
    /// push endpoint under any path prefix, with no empty segment.
    #[test]
    fn the_push_path_lands_under_the_base() {
        let pushed = |text: &str| {
            let mut url = reqwest::Url::parse(&base_url(text).unwrap()).unwrap();
            url.path_segments_mut()
                .unwrap()
                .push("push.v1.PusherService")
                .push("Push");
            url.to_string()
        };
        assert_eq!(
            pushed("http://pyroscope:4040"),
            "http://pyroscope:4040/push.v1.PusherService/Push"
        );
        assert_eq!(
            pushed("http://pyroscope:4040/"),
            "http://pyroscope:4040/push.v1.PusherService/Push"
        );
        assert_eq!(
            pushed("https://gateway/pyroscope/"),
            "https://gateway/pyroscope/push.v1.PusherService/Push"
        );
    }

    /// Only the agent's records are carried into the server's log.
    #[test]
    fn the_bridge_takes_the_agents_records_only() {
        assert!(from_agent("pyroscope::session"));
        assert!(from_agent("Pyroscope::Session"));
        assert!(from_agent("pyroscope"));
        assert!(!from_agent("tokio_postgres::connection"));
        assert!(!from_agent("rustls::client"));
        assert!(!from_agent("pyro"));
    }
}
