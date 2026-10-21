//! The metrics thread: every interval it reads what only sampling can
//! give (the process's resident set, each thread's CPU time by name and,
//! attributed to the core each thread was on, by core and by thread and
//! core, where each thread is, how often the threads move cores, the
//! caches' sizes) into the shared measurements, and every sixth sample it
//! writes the summary line, so a log alone says how the server is doing.
//! Nothing here runs on a thread that serves clients.

use std::collections::{BTreeMap, HashMap};
use std::ops::AddAssign;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::connection::AppState;
use crate::log::{Level, log_error};
use crate::stats::Stats;

/// Start the sampler; `interval` zero starts nothing.
pub fn spawn(state: Arc<AppState>, interval: Duration) {
    if interval.is_zero() {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("streamgres-metrics".to_owned())
        .spawn(move || run(state, interval));
    if let Err(error) = spawned {
        log_error!("metrics thread: {error}");
    }
}

/// The sampler's loop.
fn run(state: Arc<AppState>, interval: Duration) {
    let stats: Arc<Stats> = state.stats.clone();
    let mut previous = stats.snapshot();
    let mut last_summary = Instant::now();
    let mut ticks = 0u64;
    let mut cores = CoreAccount::default();
    loop {
        std::thread::sleep(interval);
        ticks += 1;
        stats
            .process_rss_bytes
            .store(resident_bytes(), Ordering::Relaxed);
        stats
            .plan_cache_entries
            .store(state.plans.len() as u64, Ordering::Relaxed);
        stats
            .transform_cache_entries
            .store(state.transforms.len() as u64, Ordering::Relaxed);
        stats
            .warm_shapes
            .store(state.warm.len() as u64, Ordering::Relaxed);
        let samples = thread_samples();
        stats.publish_thread_cpu(thread_cpu_seconds(&samples));
        let attributed = cores.account(&samples);
        stats.publish_core_cpu(attributed.cores);
        stats.publish_thread_core_cpu(attributed.thread_cores);
        stats.publish_thread_core(attributed.placement);
        stats.publish_thread_migrations(attributed.migrations);
        if ticks % 6 == 0 {
            let (message, fields) = stats.summary_line(&previous, last_summary.elapsed());
            crate::log::event(Level::Info, message, fields);
            previous = stats.snapshot();
            stats.rotate_read_peak();
            last_summary = Instant::now();
        }
    }
}

/// The process's resident set in bytes: exact on Linux (`/proc`), the
/// peak so far elsewhere (`getrusage`).
pub fn resident_bytes() -> u64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(statm) = std::fs::read_to_string("/proc/self/statm") {
            let mut fields = statm.split_whitespace();
            fields.next();
            if let Some(pages) = fields.next().and_then(|text| text.parse::<u64>().ok()) {
                // SAFETY: sysconf reads a constant.
                let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
                return pages * u64::try_from(page).unwrap_or(4096);
            }
        }
    }
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: getrusage writes the struct we hand it.
    let code = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if code != 0 {
        return 0;
    }
    // SAFETY: getrusage returned 0, so the struct is initialised.
    let usage = unsafe { usage.assume_init() };
    let maxrss = u64::try_from(usage.ru_maxrss).unwrap_or(0);
    if cfg!(target_os = "macos") {
        maxrss
    } else {
        maxrss * 1024
    }
}

/// One thread of the process as sampled: its id, its label
/// ([`thread_label`]), its CPU time so far in seconds, the core it last
/// ran on (`processor` in `/proc/<tid>/stat`; `None` off Linux) and how
/// many times the scheduler has moved it between cores so far
/// (`se.nr_migrations` in `/proc/<tid>/sched`; `None` where the kernel
/// does not say).
#[derive(Debug, Clone, PartialEq)]
pub struct ThreadSample {
    pub tid: u64,
    pub name: String,
    pub seconds: f64,
    pub core: Option<u32>,
    pub migrations: Option<u64>,
}

/// Every thread of the process, sampled from `/proc` on Linux; nothing
/// elsewhere. A kernel without the `sched` file says so on the first
/// thread, and the rest of the round is not asked.
pub fn thread_samples() -> Vec<ThreadSample> {
    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut samples = Vec::new();
    #[cfg(target_os = "linux")]
    {
        let ticks = clock_ticks();
        let mut sched_exposed = true;
        if let Ok(tasks) = std::fs::read_dir("/proc/self/task") {
            for task in tasks.flatten() {
                let path = task.path();
                let Some(tid) = task
                    .file_name()
                    .to_str()
                    .and_then(|name| name.parse::<u64>().ok())
                else {
                    continue;
                };
                let Ok(comm) = std::fs::read_to_string(path.join("comm")) else {
                    continue;
                };
                let Ok(stat) = std::fs::read_to_string(path.join("stat")) else {
                    continue;
                };
                let Some((seconds, core)) = parse_stat(&stat, ticks) else {
                    continue;
                };
                let migrations = if sched_exposed {
                    match std::fs::read_to_string(path.join("sched")) {
                        Ok(sched) => parse_sched_migrations(&sched),
                        Err(error) => {
                            sched_exposed = error.kind() != std::io::ErrorKind::NotFound;
                            None
                        }
                    }
                } else {
                    None
                };
                samples.push(ThreadSample {
                    tid,
                    name: thread_label(comm.trim()),
                    seconds,
                    core,
                    migrations,
                });
            }
        }
    }
    samples
}

/// Clock ticks a second as the system reports them, read once (100 when
/// it will not say).
#[cfg(target_os = "linux")]
fn clock_ticks() -> f64 {
    static TICKS: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
    *TICKS.get_or_init(|| {
        // SAFETY: sysconf reads a constant.
        let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        if ticks > 0 { ticks as f64 } else { 100.0 }
    })
}

/// The CPU time and the core of a `/proc/<tid>/stat` line: `utime` and
/// `stime` (fields 14 and 15, in clock ticks of `ticks` a second)
/// summed, and `processor` (field 39), the fields taken after the last
/// `)` since the thread's name before it may hold spaces or parentheses.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_stat(stat: &str, ticks: f64) -> Option<(f64, Option<u32>)> {
    let after = stat.rsplit(')').next()?;
    let mut fields = after.split_whitespace();
    let utime: f64 = fields.nth(11)?.parse().ok()?;
    let stime: f64 = fields.next()?.parse().ok()?;
    let core = fields.nth(23).and_then(|text| text.parse::<u32>().ok());
    Some(((utime + stime) / ticks, core))
}

/// The `se.nr_migrations` line of `/proc/<tid>/sched`: how many times the
/// scheduler has moved the thread to another core; `None` when the
/// kernel does not expose it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_sched_migrations(sched: &str) -> Option<u64> {
    sched
        .lines()
        .find_map(|line| line.strip_prefix("se.nr_migrations"))
        .and_then(|rest| rest.trim_start().strip_prefix(':'))
        .and_then(|value| value.trim().parse().ok())
}

/// CPU seconds so far by thread name (the server's own names, without
/// the `streamgres-` prefix and summed over a pool's threads), from
/// `samples`.
pub fn thread_cpu_seconds(samples: &[ThreadSample]) -> Vec<(String, f64)> {
    let mut by_name: BTreeMap<String, f64> = BTreeMap::new();
    for sample in samples {
        *by_name.entry(sample.name.clone()).or_insert(0.0) += sample.seconds;
    }
    by_name.into_iter().collect()
}

/// What one round of attribution says: CPU seconds by core, by thread
/// name and core, where every thread is (its label, id and core), and
/// the moves between cores by thread name so far.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Attribution {
    pub cores: Vec<(u32, f64)>,
    pub thread_cores: Vec<(String, u32, f64)>,
    pub placement: Vec<(String, u64, u32)>,
    pub migrations: Vec<(String, u64)>,
}

/// CPU time by core: each thread's CPU time since the last sample is
/// attributed to the core it was on at the sample, so a core's total is
/// what the process burned there, as closely as the sampling interval
/// tells a thread's moves apart (a shorter `STREAMGRES_METRICS_INTERVAL_MS`
/// sharpens it). The same seconds are kept by thread name and core, so
/// which thread burned a core is known too, and each thread's moves
/// between cores since the last sample are summed by name: a name whose
/// moves climb quickly is one whose per-core split is a blur. A thread
/// seen for the first time contributes nothing yet; one gone is
/// forgotten.
#[derive(Default)]
pub struct CoreAccount {
    last: HashMap<u64, (f64, Option<u64>)>,
    cores: BTreeMap<u32, f64>,
    thread_cores: BTreeMap<String, BTreeMap<u32, f64>>,
    migrations: BTreeMap<String, u64>,
}

/// Add `amount` to what `map` holds for `name`, the name copied only when
/// it is new there.
fn add<T: AddAssign>(map: &mut BTreeMap<String, T>, name: &str, amount: T) {
    match map.get_mut(name) {
        Some(total) => *total += amount,
        None => {
            map.insert(name.to_owned(), amount);
        }
    }
}

impl CoreAccount {
    /// Take `samples` in and return the attribution so far.
    pub fn account(&mut self, samples: &[ThreadSample]) -> Attribution {
        let mut seen = HashMap::with_capacity(samples.len());
        let mut placement = Vec::with_capacity(samples.len());
        for sample in samples {
            if let Some(&(before, moved_before)) = self.last.get(&sample.tid) {
                if let Some(core) = sample.core {
                    let burned = (sample.seconds - before).max(0.0);
                    *self.cores.entry(core).or_insert(0.0) += burned;
                    match self.thread_cores.get_mut(sample.name.as_str()) {
                        Some(cores) => *cores.entry(core).or_insert(0.0) += burned,
                        None => {
                            self.thread_cores
                                .insert(sample.name.clone(), BTreeMap::from([(core, burned)]));
                        }
                    }
                }
                if let (Some(moved), Some(moved_before)) = (sample.migrations, moved_before) {
                    add(
                        &mut self.migrations,
                        &sample.name,
                        moved.saturating_sub(moved_before),
                    );
                }
            } else if sample.migrations.is_some() {
                add(&mut self.migrations, &sample.name, 0);
            }
            if let Some(core) = sample.core {
                placement.push((sample.name.clone(), sample.tid, core));
            }
            seen.insert(sample.tid, (sample.seconds, sample.migrations));
        }
        self.last = seen;
        placement.sort();
        Attribution {
            cores: self
                .cores
                .iter()
                .map(|(&core, &seconds)| (core, seconds))
                .collect(),
            thread_cores: self
                .thread_cores
                .iter()
                .flat_map(|(name, cores)| {
                    cores
                        .iter()
                        .map(move |(&core, &seconds)| (name.clone(), core, seconds))
                })
                .collect(),
            placement,
            migrations: self
                .migrations
                .iter()
                .map(|(name, &moves)| (name.clone(), moves))
                .collect(),
        }
    }
}

/// A thread's label from its (15-character) kernel name.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn thread_label(comm: &str) -> String {
    // Linux truncates `comm` at 15 bytes. With the longer Streamgres prefix,
    // several worker names are shortened further than their full names.
    let name = comm.strip_prefix("streamgres-").unwrap_or(comm);
    let name = match name {
        "engi" | "engin" | "engine" => "engine",
        "reap" | "reape" | "reaper" => "reaper",
        "serv" | "serve" | "server" => "server",
        "metr" | "metri" | "metrics" => "metrics",
        other if other.starts_with("grou") => "groups",
        other if other.starts_with("read") => "reads",
        other if other.starts_with("feed") => "feed",
        other if other.starts_with("log") => "log",
        other if other.starts_with("tokio") => "tokio",
        other => other,
    };
    name.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_names_fold_into_their_pools() {
        assert_eq!(thread_label("streamgres-engi"), "engine");
        assert_eq!(thread_label("streamgres-grou"), "groups");
        assert_eq!(thread_label("streamgres-read"), "reads");
        assert_eq!(thread_label("streamgres-serv"), "server");
        assert_eq!(thread_label("streamgres-metr"), "metrics");
        assert_eq!(thread_label("streamgres-log"), "log");
        assert_eq!(thread_label("server"), "server");
    }

    #[test]
    fn the_resident_set_is_read() {
        assert!(resident_bytes() > 0);
    }

    /// A stat line's CPU time is `utime + stime` in ticks and its core the
    /// `processor` field, both read past the thread's name, which may
    /// hold spaces and parentheses.
    #[test]
    fn a_stat_line_gives_cpu_time_and_the_core() {
        let stat = "12345 (streamgres (eng) x) R 1 1 1 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 1 0 999 \
                    1000000 500 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 7 0 0 0 0 0 0 0 0 0 0 0 0 0";
        let (seconds, core) = parse_stat(stat, 100.0).expect("parsed");
        assert_eq!(seconds, 3.0);
        assert_eq!(core, Some(7));
        assert!(parse_stat("1 (x) R 1", 100.0).is_none());
    }

    /// CPU time since the last sample goes to the core the thread was
    /// sampled on; a first sample only sets the baseline, a thread gone is
    /// forgotten.
    #[test]
    fn cpu_time_is_attributed_to_the_core_a_thread_was_sampled_on() {
        let sample = |tid: u64, seconds: f64, core: u32| ThreadSample {
            tid,
            name: "engine".to_owned(),
            seconds,
            core: Some(core),
            migrations: None,
        };
        let mut account = CoreAccount::default();
        assert_eq!(account.account(&[sample(1, 10.0, 3)]).cores, vec![]);
        assert_eq!(account.account(&[sample(1, 12.5, 3)]).cores, vec![(3, 2.5)]);
        assert_eq!(
            account
                .account(&[sample(1, 13.0, 5), sample(2, 1.0, 5)])
                .cores,
            vec![(3, 2.5), (5, 0.5)],
            "a move charges the new core; a new thread nothing yet"
        );
        assert_eq!(
            account.account(&[sample(2, 1.25, 5)]).cores,
            vec![(3, 2.5), (5, 0.75)],
            "the thread gone is forgotten"
        );
        assert_eq!(
            thread_cpu_seconds(&[sample(1, 1.0, 0), sample(2, 2.0, 1)]),
            vec![("engine".to_owned(), 3.0)]
        );
    }

    /// The same seconds are kept by thread name and core, so the by-core
    /// total is the sum over threads of the by-thread-and-core series, a
    /// pool's threads summing under their one name; and every sampled
    /// thread reports where it is.
    #[test]
    fn cpu_time_is_kept_by_thread_and_core_and_every_thread_says_where_it_is() {
        let sample = |tid: u64, name: &str, seconds: f64, core: u32| ThreadSample {
            tid,
            name: name.to_owned(),
            seconds,
            core: Some(core),
            migrations: None,
        };
        let mut account = CoreAccount::default();
        account.account(&[
            sample(1, "engine", 10.0, 3),
            sample(2, "groups", 4.0, 3),
            sample(3, "groups", 4.0, 6),
        ]);
        let got = account.account(&[
            sample(1, "engine", 12.0, 3),
            sample(2, "groups", 4.5, 3),
            sample(3, "groups", 5.0, 6),
        ]);
        assert_eq!(got.cores, vec![(3, 2.5), (6, 1.0)]);
        assert_eq!(
            got.thread_cores,
            vec![
                ("engine".to_owned(), 3, 2.0),
                ("groups".to_owned(), 3, 0.5),
                ("groups".to_owned(), 6, 1.0),
            ]
        );
        let by_core: f64 = got.cores.iter().map(|(_, s)| s).sum();
        let by_thread_core: f64 = got.thread_cores.iter().map(|(_, _, s)| s).sum();
        assert_eq!(by_core, by_thread_core, "the two series sum alike");
        assert_eq!(
            got.placement,
            vec![
                ("engine".to_owned(), 1, 3),
                ("groups".to_owned(), 2, 3),
                ("groups".to_owned(), 3, 6),
            ]
        );
    }

    /// Moves between cores are summed by thread name from each thread's
    /// own counter, as deltas, so a thread gone takes nothing away and a
    /// kernel that does not count them leaves the series out.
    #[test]
    fn moves_between_cores_are_summed_by_thread_name() {
        let sample = |tid: u64, name: &str, moved: Option<u64>| ThreadSample {
            tid,
            name: name.to_owned(),
            seconds: 1.0,
            core: Some(0),
            migrations: moved,
        };
        let mut account = CoreAccount::default();
        assert_eq!(
            account
                .account(&[sample(1, "engine", Some(10)), sample(2, "groups", Some(3))])
                .migrations,
            vec![("engine".to_owned(), 0), ("groups".to_owned(), 0)],
            "a first sample sets the baseline"
        );
        assert_eq!(
            account
                .account(&[
                    sample(1, "engine", Some(14)),
                    sample(2, "groups", Some(3)),
                    sample(3, "groups", Some(100))
                ])
                .migrations,
            vec![("engine".to_owned(), 4), ("groups".to_owned(), 0)]
        );
        assert_eq!(
            account
                .account(&[
                    sample(1, "engine", Some(15)),
                    sample(3, "groups", Some(102))
                ])
                .migrations,
            vec![("engine".to_owned(), 5), ("groups".to_owned(), 2)],
            "a thread gone takes nothing away"
        );
        assert_eq!(
            CoreAccount::default()
                .account(&[sample(1, "engine", None)])
                .migrations,
            vec![],
            "no counter, no series"
        );
        assert_eq!(
            parse_sched_migrations(
                "x (1, #threads: 1)\n---\nse.exec_start   :  1.5\nse.nr_migrations  :   42\nnr_switches : 7\n"
            ),
            Some(42)
        );
        assert_eq!(parse_sched_migrations("nr_switches : 7\n"), None);
    }
}
