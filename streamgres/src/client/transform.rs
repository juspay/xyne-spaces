//! A cache of the application server's transforms: the AST it returned
//! for a query, kept for a while per identity, so a client asking for a
//! shape its identity asked for recently (a screen reopened, a second tab,
//! a reconnect) does not pay the round trip. The key is everything the
//! request would be made with (the token, the cookie, the origin, the
//! per-identity endpoint and headers), the query's name and its
//! arguments, as zero-cache keys its own; a failed transform is never
//! kept; an entry expires after the TTL or leaves as the least recently
//! used when the capacity is reached. The TTL defaults to a minute, so a
//! deploy of the application that changes a query's shape reaches every
//! client within one (zero-cache keeps its own for five seconds, which on
//! the rig cost a hydration about 8 ms at the median: twice the calls to
//! the backend, each slower). The AST changes only when the application's
//! code does, and what the user may see is decided by the rows the engine
//! evaluates live, not by the AST's age. An entry keeps the AST as its
//! JSON text, not as a parsed tree: the text is a few kilobytes where the
//! tree, with a node and a string per key, was ten to fifty times that,
//! which at twenty thousand entries was gigabytes; a hit parses the text
//! again, in microseconds.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value as Json, json};

use super::backend::Identity;

/// One kept transform: the AST as JSON text.
struct Entry {
    ast: String,
    at: Instant,
    tick: u64,
}

/// The entries by key and the least recently used order.
#[derive(Default)]
struct State {
    entries: HashMap<String, Entry>,
    order: BTreeMap<u64, String>,
    tick: u64,
}

/// The transforms kept, with how often they were asked for and found.
pub struct TransformCache {
    state: Mutex<State>,
    ttl: Duration,
    capacity: usize,
    hits: AtomicU64,
    misses: AtomicU64,
}

impl TransformCache {
    /// A cache keeping each transform for `ttl` (zero: nothing is kept),
    /// at most `capacity` of them.
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        TransformCache {
            state: Mutex::new(State::default()),
            ttl,
            capacity: capacity.max(1),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        }
    }

    /// Whether anything is kept.
    pub fn enabled(&self) -> bool {
        !self.ttl.is_zero()
    }

    /// The kept AST for `name` with `args` under `identity`, if it has one
    /// that has not expired; counted as a hit or a miss either way.
    pub fn lookup(&self, identity: &Identity, name: &str, args: &Json) -> Option<Json> {
        if !self.enabled() {
            return None;
        }
        let key = key_of(identity, name, args);
        let mut state = self.lock();
        let tick = state.tick + 1;
        state.tick = tick;
        let found = match state.entries.get_mut(&key) {
            Some(entry) if entry.at.elapsed() <= self.ttl => {
                let old = entry.tick;
                entry.tick = tick;
                serde_json::from_str::<Json>(&entry.ast)
                    .ok()
                    .map(|ast| (ast, old))
            }
            _ => None,
        };
        match found {
            Some((ast, old)) => {
                state.order.remove(&old);
                state.order.insert(tick, key);
                self.hits.fetch_add(1, Ordering::Relaxed);
                Some(ast)
            }
            None => {
                self.misses.fetch_add(1, Ordering::Relaxed);
                None
            }
        }
    }

    /// Keep `ast` as the transform of `name` with `args` under `identity`.
    pub fn store(&self, identity: &Identity, name: &str, args: &Json, ast: Json) {
        if !self.enabled() {
            return;
        }
        let key = key_of(identity, name, args);
        let mut state = self.lock();
        let tick = state.tick + 1;
        state.tick = tick;
        if let Some(previous) = state.entries.remove(&key) {
            state.order.remove(&previous.tick);
        }
        while state.entries.len() >= self.capacity {
            let Some((&oldest, _)) = state.order.iter().next() else {
                break;
            };
            if let Some(evicted) = state.order.remove(&oldest) {
                state.entries.remove(&evicted);
            }
        }
        state.order.insert(tick, key.clone());
        state.entries.insert(
            key,
            Entry {
                ast: ast.to_string(),
                at: Instant::now(),
                tick,
            },
        );
    }

    /// How many transforms are kept.
    pub fn len(&self) -> usize {
        self.lock().entries.len()
    }

    /// Whether none is kept.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// How many lookups were answered from the cache, and how many were not.
    pub fn hits_and_misses(&self) -> (u64, u64) {
        (
            self.hits.load(Ordering::Relaxed),
            self.misses.load(Ordering::Relaxed),
        )
    }

    /// Forget the counts (the entries stay).
    pub fn reset_counts(&self) {
        self.hits.store(0, Ordering::Relaxed);
        self.misses.store(0, Ordering::Relaxed);
    }

    /// The state, read through a poisoned lock.
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The key of a transform: the request's credentials, the query's name
/// and its arguments, as one JSON text (the arguments' object keys in
/// sorted order, as `serde_json` writes them).
fn key_of(identity: &Identity, name: &str, args: &Json) -> String {
    json!({
        "token": identity.token,
        "cookie": identity.cookie,
        "origin": identity.origin,
        "name": name,
        "args": args,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An identity with `token`.
    fn identity(token: &str) -> Identity {
        Identity {
            token: Some(token.to_owned()),
            ..Identity::default()
        }
    }

    #[test]
    fn a_transform_is_found_for_its_identity_name_and_arguments_only() {
        let cache = TransformCache::new(Duration::from_secs(60), 10);
        let alice = identity("alice");
        let args = json!([{"channelId": "c1", "limit": 25}]);
        assert!(cache.lookup(&alice, "channelMessages", &args).is_none());
        cache.store(
            &alice,
            "channelMessages",
            &args,
            json!({"table": "messages"}),
        );
        assert_eq!(
            cache.lookup(&alice, "channelMessages", &args),
            Some(json!({"table": "messages"}))
        );
        assert!(
            cache
                .lookup(&identity("bob"), "channelMessages", &args)
                .is_none()
        );
        assert!(cache.lookup(&alice, "channelMembers", &args).is_none());
        assert!(
            cache
                .lookup(
                    &alice,
                    "channelMessages",
                    &json!([{"channelId": "c2", "limit": 25}])
                )
                .is_none()
        );
        let reordered = json!([{"limit": 25, "channelId": "c1"}]);
        assert!(
            cache
                .lookup(&alice, "channelMessages", &reordered)
                .is_some(),
            "the same arguments in another order are the same key"
        );
        assert_eq!(cache.hits_and_misses(), (2, 4));
    }

    #[test]
    fn an_entry_expires_and_the_least_recently_used_leaves_first() {
        let cache = TransformCache::new(Duration::from_millis(20), 2);
        let alice = identity("alice");
        cache.store(&alice, "a", &json!([]), json!(1));
        cache.store(&alice, "b", &json!([]), json!(2));
        assert!(cache.lookup(&alice, "a", &json!([])).is_some());
        cache.store(&alice, "c", &json!([]), json!(3));
        assert_eq!(cache.len(), 2);
        assert!(
            cache.lookup(&alice, "b", &json!([])).is_none(),
            "b was the least recently used"
        );
        assert!(cache.lookup(&alice, "a", &json!([])).is_some());
        std::thread::sleep(Duration::from_millis(30));
        assert!(cache.lookup(&alice, "a", &json!([])).is_none(), "expired");
        assert!(cache.lookup(&alice, "c", &json!([])).is_none(), "expired");
    }

    #[test]
    fn a_zero_ttl_keeps_nothing() {
        let cache = TransformCache::new(Duration::ZERO, 10);
        let alice = identity("alice");
        cache.store(&alice, "a", &json!([]), json!(1));
        assert!(cache.is_empty());
        assert!(cache.lookup(&alice, "a", &json!([])).is_none());
        assert_eq!(
            cache.hits_and_misses(),
            (0, 0),
            "an unused cache counts nothing"
        );
    }
}
