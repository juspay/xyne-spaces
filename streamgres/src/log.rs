//! A log with four levels, written by its own thread: a call checks its
//! level first (one atomic load), formats only when the level is on, and
//! hands the finished line to a bounded queue that the `streamgres-log`
//! thread drains to stderr in batches. A full queue drops the line and
//! counts the drop rather than making the caller wait, so a flood of
//! lines never slows the thread that logged them; the count is a metric.
//! When the telemetry exporter taps it ([`tap`]), the log thread hands
//! every line it has written to the exporter's queue as well, so stderr
//! and the collector see the same lines.
//! Lines are `text` (`HH:MM:SS.mmm LEVEL [thread] message key=value`) or
//! `json` (one object per line with `ts`, `level`, `thread`, `msg` and
//! the event's fields); `log_error!`, `log_warn!`, `log_info!` and
//! `log_debug!` format like `println!`, and `log_event!` adds fields.

use std::io::Write;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// A log level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
}

/// How a line is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Format {
    #[default]
    Text,
    Json,
}

/// One line, formatted by its caller, written by the log thread.
pub struct Line {
    pub at: chrono::DateTime<chrono::Utc>,
    pub level: Level,
    pub thread: String,
    pub message: String,
    pub fields: Vec<(&'static str, String)>,
}

/// What the log thread receives.
enum Item {
    Line(Line),
    Flush(SyncSender<()>),
}

/// How many lines the queue holds before dropping.
const QUEUE: usize = 65_536;

static LEVEL: AtomicU8 = AtomicU8::new(2);
static FORMAT: AtomicU8 = AtomicU8::new(0);
static DROPPED: AtomicU64 = AtomicU64::new(0);
static QUEUED: AtomicU64 = AtomicU64::new(0);
static SENDER: OnceLock<Mutex<SyncSender<Item>>> = OnceLock::new();
static TAP: OnceLock<tokio::sync::mpsc::Sender<Line>> = OnceLock::new();
static TAP_DROPPED: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// The current thread's name, read once.
    static THREAD: String = std::thread::current().name().unwrap_or("?").to_owned();
}

/// Set the level below which lines are written.
pub fn set_level(level: Level) {
    LEVEL.store(rank(level), Ordering::Relaxed);
}

/// Set how lines are written.
pub fn set_format(format: Format) {
    FORMAT.store(
        match format {
            Format::Text => 0,
            Format::Json => 1,
        },
        Ordering::Relaxed,
    );
}

/// How lines are written.
pub fn format() -> Format {
    match FORMAT.load(Ordering::Relaxed) {
        1 => Format::Json,
        _ => Format::Text,
    }
}

/// Whether `level` is written.
pub fn enabled(level: Level) -> bool {
    rank(level) <= LEVEL.load(Ordering::Relaxed)
}

/// How many lines the queue has refused so far.
pub fn dropped() -> u64 {
    DROPPED.load(Ordering::Relaxed)
}

/// Send every line the log thread writes to `tap` as well (the telemetry
/// exporter's queue); a full queue drops the line for the tap alone and
/// counts it. The first tap stays.
pub fn tap(tap: tokio::sync::mpsc::Sender<Line>) {
    let _ = TAP.set(tap);
}

/// How many lines the tap's queue has refused so far.
pub fn tap_dropped() -> u64 {
    TAP_DROPPED.load(Ordering::Relaxed)
}

/// How many lines were handed to the log thread so far.
pub fn queued() -> u64 {
    QUEUED.load(Ordering::Relaxed)
}

/// Write one line at `level`, formatted like `println!`.
pub fn log(level: Level, message: std::fmt::Arguments<'_>) {
    if !enabled(level) {
        return;
    }
    submit(level, message.to_string(), Vec::new());
}

/// Write one line at `level` with `fields`.
pub fn event(level: Level, message: String, fields: Vec<(&'static str, String)>) {
    if !enabled(level) {
        return;
    }
    submit(level, message, fields);
}

/// Hand a line to the log thread, or count it dropped.
fn submit(level: Level, message: String, fields: Vec<(&'static str, String)>) {
    let line = Line {
        at: chrono::Utc::now(),
        level,
        thread: THREAD.with(Clone::clone),
        message,
        fields,
    };
    let sender = sender();
    let outcome = sender
        .lock()
        .map(|sender| sender.try_send(Item::Line(line)));
    match outcome {
        Ok(Ok(())) => {
            QUEUED.fetch_add(1, Ordering::Relaxed);
        }
        Ok(Err(TrySendError::Full(_))) | Ok(Err(TrySendError::Disconnected(_))) | Err(_) => {
            DROPPED.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// Wait until everything queued so far is written, for at most a second:
/// what a process does before it exits.
pub fn flush() {
    let (done_tx, done_rx) = sync_channel(1);
    let sent = sender()
        .lock()
        .map(|sender| sender.try_send(Item::Flush(done_tx)).is_ok())
        .unwrap_or(false);
    if sent {
        let _ = done_rx.recv_timeout(Duration::from_secs(1));
    }
}

/// Flush the log, then exit the process with `code`.
pub fn exit(code: i32) -> ! {
    flush();
    std::process::exit(code)
}

/// The queue's sender, the log thread started on first use.
fn sender() -> &'static Mutex<SyncSender<Item>> {
    SENDER.get_or_init(|| {
        let (sender, receiver) = sync_channel(QUEUE);
        let spawned = std::thread::Builder::new()
            .name("streamgres-log".to_owned())
            .spawn(move || write_loop(receiver));
        if spawned.is_err() {
            eprintln!("the log thread could not be started; lines are dropped");
        }
        Mutex::new(sender)
    })
}

/// The log thread: lines to stderr in batches, a flush after each.
fn write_loop(receiver: Receiver<Item>) {
    let stderr = std::io::stderr();
    while let Ok(first) = receiver.recv() {
        let mut items = vec![first];
        while let Ok(more) = receiver.try_recv() {
            items.push(more);
            if items.len() >= 1024 {
                break;
            }
        }
        // Do not hold StderrLock while waiting for the next item. Startup
        // failures are printed with `eprintln!`; retaining the lock here
        // would make that error path wait forever after the first log line.
        let mut out = std::io::BufWriter::with_capacity(64 * 1024, stderr.lock());
        let mut acks = Vec::new();
        for item in items {
            match item {
                Item::Line(line) => {
                    let _ = out.write_all(render(&line, format()).as_bytes());
                    if let Some(tap) = TAP.get()
                        && tap.try_send(line).is_err()
                    {
                        TAP_DROPPED.fetch_add(1, Ordering::Relaxed);
                    }
                }
                Item::Flush(ack) => acks.push(ack),
            }
        }
        let _ = out.flush();
        for ack in acks {
            let _ = ack.send(());
        }
    }
}

/// One line as written, newline included.
pub fn render(line: &Line, format: Format) -> String {
    match format {
        Format::Text => {
            let mut text = format!(
                "{} {} [{}] {}",
                line.at.format("%H:%M:%S%.3f"),
                tag(line.level),
                line.thread,
                line.message
            );
            for (key, value) in &line.fields {
                text.push(' ');
                text.push_str(key);
                text.push('=');
                if value.contains(' ') || value.is_empty() {
                    text.push_str(&serde_json::Value::String(value.clone()).to_string());
                } else {
                    text.push_str(value);
                }
            }
            text.push('\n');
            text
        }
        Format::Json => {
            let mut object = serde_json::Map::new();
            object.insert(
                "ts".into(),
                line.at
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                    .into(),
            );
            object.insert(
                "level".into(),
                tag(line.level).trim().to_ascii_lowercase().into(),
            );
            object.insert("thread".into(), line.thread.clone().into());
            object.insert("msg".into(), line.message.clone().into());
            for (key, value) in &line.fields {
                object.insert((*key).into(), field_value(value));
            }
            let mut text = serde_json::Value::Object(object).to_string();
            text.push('\n');
            text
        }
    }
}

/// A field's value as JSON: a number when it reads as one, else text.
pub fn field_value(value: &str) -> serde_json::Value {
    if let Ok(integer) = value.parse::<i64>() {
        return integer.into();
    }
    if let Ok(float) = value.parse::<f64>()
        && float.is_finite()
        && value.contains('.')
    {
        return serde_json::json!(float);
    }
    match value {
        "true" => true.into(),
        "false" => false.into(),
        _ => value.into(),
    }
}

/// A level's tag, padded to five columns.
fn tag(level: Level) -> &'static str {
    match level {
        Level::Error => "ERROR",
        Level::Warn => "WARN ",
        Level::Info => "INFO ",
        Level::Debug => "DEBUG",
    }
}

/// The numeric rank of a level, higher is chattier.
fn rank(level: Level) -> u8 {
    match level {
        Level::Error => 0,
        Level::Warn => 1,
        Level::Info => 2,
        Level::Debug => 3,
    }
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        $crate::log::log($crate::log::Level::Error, format_args!($($arg)*))
    };
}
macro_rules! log_warn {
    ($($arg:tt)*) => {
        $crate::log::log($crate::log::Level::Warn, format_args!($($arg)*))
    };
}
macro_rules! log_info {
    ($($arg:tt)*) => {
        $crate::log::log($crate::log::Level::Info, format_args!($($arg)*))
    };
}
macro_rules! log_debug {
    ($($arg:tt)*) => {
        $crate::log::log($crate::log::Level::Debug, format_args!($($arg)*))
    };
}
/// A line with fields: `log_event!(Level::Info, "message", key = value, ...)`;
/// nothing is formatted unless the level is on.
macro_rules! log_event {
    ($level:expr, $msg:expr $(, $key:ident = $value:expr)* $(,)?) => {
        if $crate::log::enabled($level) {
            $crate::log::event($level, ($msg).to_string(), vec![$((stringify!($key), format!("{}", $value))),*]);
        }
    };
}
pub(crate) use {log_debug, log_error, log_event, log_info, log_warn};

#[cfg(test)]
mod tests {
    use super::*;

    /// A field value that must never be asked for.
    fn boom() -> String {
        panic!("formatted although the level is off")
    }

    /// A line at `level` with two fields.
    fn line(level: Level) -> Line {
        Line {
            at: chrono::DateTime::from_timestamp(1_789_819_200, 123_000_000).unwrap(),
            level,
            thread: "streamgres-engine".to_owned(),
            message: "query registered".to_owned(),
            fields: vec![
                ("name", "channelMessages".to_owned()),
                ("ms", "12.5".to_owned()),
                ("rows", "40".to_owned()),
                ("reason", "row budget hit".to_owned()),
            ],
        }
    }

    #[test]
    fn text_and_json_lines_carry_the_same_event() {
        let text = render(&line(Level::Warn), Format::Text);
        assert_eq!(
            text,
            "12:00:00.123 WARN  [streamgres-engine] query registered name=channelMessages ms=12.5 rows=40 reason=\"row budget hit\"\n"
        );
        let json = render(&line(Level::Info), Format::Json);
        let parsed: serde_json::Value = serde_json::from_str(json.trim()).unwrap();
        assert_eq!(parsed["level"], "info");
        assert_eq!(parsed["thread"], "streamgres-engine");
        assert_eq!(parsed["msg"], "query registered");
        assert_eq!(parsed["name"], "channelMessages");
        assert_eq!(parsed["ms"], 12.5);
        assert_eq!(parsed["rows"], 40);
        assert_eq!(parsed["reason"], "row budget hit");
        assert_eq!(parsed["ts"], "2026-09-19T12:00:00.123Z");
    }

    /// A line below the level is neither formatted (`boom` would panic)
    /// nor queued; a line at the level is queued. The count is the
    /// process's, so lines other tests log meanwhile may be in it: the
    /// last check is that it grew, not by how much.
    #[test]
    fn a_level_that_is_off_formats_nothing() {
        set_level(Level::Warn);
        assert!(enabled(Level::Error) && enabled(Level::Warn));
        assert!(!enabled(Level::Info) && !enabled(Level::Debug));
        let before = queued();
        log_event!(Level::Debug, "unseen", cost = boom());
        log_info!("unseen {}", 1);
        assert_eq!(queued(), before);
        set_level(Level::Info);
        log_event!(Level::Info, "seen", n = 1);
        flush();
        assert!(queued() > before);
    }
}
