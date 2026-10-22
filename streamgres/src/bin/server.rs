//! The sync server binary.
//!
//! ```bash
//! cargo run --release --bin server
//! ```
//!
//! Configured by `STREAMGRES_*` environment variables (see `.env.example`);
//! a `.env` file in the working directory is read first, without
//! overriding variables already set.
#[global_allocator]
static ALLOCATOR: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[unsafe(export_name = "_rjem_malloc_conf")]
static MALLOC_CONF: MallocConf =
    MallocConf(c"prof:true,prof_active:false,lg_prof_sample:19".as_ptr());

#[repr(transparent)]
struct MallocConf(*const std::ffi::c_char);

unsafe impl Sync for MallocConf {}

fn main() {
    load_dotenv(".env");
    raise_file_limit();
    let outcome = streamgres::client::Config::from_env().and_then(streamgres::client::serve);
    if let Err(error) = outcome {
        eprintln!("{error}");
        streamgres::log::exit(1);
    }
}

/// Set every `KEY=VALUE` line of `path` that is not already set; a
/// missing file is fine.
fn load_dotenv(path: &str) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"').trim_matches('\'');
        if std::env::var_os(key).is_none() {
            // SAFETY: called from `main` before any other thread exists.
            unsafe { std::env::set_var(key, value) };
        }
    }
}

/// Raise the soft limit on open files to the hard limit: every client is a
/// socket and every read connection a descriptor, and a container's soft
/// limit is often 1024, which would cap the server under a thousand
/// clients while the hard limit allows a million. Failure to raise it is
/// logged, not fatal.
fn raise_file_limit() {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: `limit` is a valid, writable rlimit; getrlimit only writes it.
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } != 0 {
        return;
    }
    if limit.rlim_cur >= limit.rlim_max {
        return;
    }
    let wanted = libc::rlimit {
        rlim_cur: limit.rlim_max,
        rlim_max: limit.rlim_max,
    };
    // SAFETY: `wanted` is a valid rlimit; setrlimit only reads it.
    if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &wanted) } != 0 {
        eprintln!(
            "could not raise the open-file limit from {} to {}: {}",
            limit.rlim_cur,
            limit.rlim_max,
            std::io::Error::last_os_error()
        );
    }
}
