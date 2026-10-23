//! PostgreSQL's estimates remembered ([`EstimateCache`]): what each
//! `EXPLAIN` said and what `pg_stats` says of each join column, so a tree
//! is sized from what earlier trees already asked and only what no tree
//! has asked goes to the database.
//!
//! - **What is remembered** is one answer per statement — its text, the
//!   table with its where clause and every literal of it, so another
//!   reader or channel is another statement — and one per join column.
//!   A statement shared by many trees (a reader's own memberships, the
//!   whole table) is asked once for all of them.
//! - **How long:** an estimate changes only when its table's statistics
//!   do (an `ANALYZE`, a `VACUUM`) or the table grows, so an answer is
//!   kept for `STREAMGRES_ESTIMATE_TTL_MS` (a day), and a table's answers
//!   are dropped as soon as `pg_class` shows its size moved: `reltuples`
//!   and `relpages`, which both of those set and the standby receives,
//!   are read every [`SIZES_EVERY`] ([`EstimateCache::sizes_due`]).
//! - **Asked once at a time:** a statement asked while another tree's
//!   batch is asking it waits for that answer instead of asking again, so
//!   a burst of trees sharing statements (every client of a rollout
//!   asking at once) costs one round trip per statement. An answer that
//!   failed is handed to those waiting and not remembered; an asker that
//!   went away leaves the statement to the next to ask.
//! - **How many:** at most `STREAMGRES_ESTIMATE_CACHE` answers (300 000,
//!   a few tens of MB), the oldest leaving first.

use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::sync::watch;

use super::estimate::ColumnStats;

/// How long an answer is kept when `STREAMGRES_ESTIMATE_TTL_MS` is unset.
pub const DEFAULT_TTL: Duration = Duration::from_secs(86_400);

/// How many answers are kept when `STREAMGRES_ESTIMATE_CACHE` is unset.
pub const DEFAULT_CAPACITY: usize = 300_000;

/// How often the tables' sizes are read to find the tables whose
/// statistics moved.
pub const SIZES_EVERY: Duration = Duration::from_secs(300);

/// The tables' sizes as [`EstimateCache::sizes`] takes them: name,
/// `reltuples`, `relpages`.
pub const SIZES_SQL: &str = "SELECT c.relname, c.reltuples::text, c.relpages::text \
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = ANY (current_schemas(false)) AND c.relkind IN ('r', 'p')";

/// One answer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Answer {
    /// The rows an `EXPLAIN` put its statement at.
    Rows(f64),
    /// A join column's statistics; `None` when `pg_stats` has none (its
    /// table never analyzed, which an `ANALYZE` changes, and with it the
    /// table's size).
    Stats(Option<ColumnStats>),
}

/// What is asked: an `EXPLAIN` by its text, or a column's statistics,
/// as a 64-bit hash (two of a few hundred thousand colliding is a chance
/// in tens of millions).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Key(u64);

impl Key {
    /// The `EXPLAIN` `sql`.
    pub fn statement(sql: &str) -> Key {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        (0u8, sql).hash(&mut hasher);
        Key(hasher.finish())
    }

    /// The statistics of `table`.`column`.
    pub fn column(table: &str, column: &str) -> Key {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        (1u8, table, column).hash(&mut hasher);
        Key(hasher.finish())
    }
}

/// What those waiting on an asker see: nothing yet, then its answer or
/// why there is none.
type Shared = Option<Result<Answer, String>>;

/// A key's state: answered (when, in seconds since the cache began), or
/// being asked by the batch `id`.
enum Slot {
    Known {
        answer: Answer,
        at: u32,
    },
    Asked {
        id: u64,
        answer: watch::Receiver<Shared>,
    },
}

/// What [`EstimateCache::lookup`] found for a key.
pub enum Lookup {
    /// Its answer.
    Known(Answer),
    /// Another batch is asking it: its answer, when there is one.
    Wait(watch::Receiver<Shared>),
    /// No one has it: the caller asks, and hands the answer to
    /// [`EstimateCache::answer`].
    Ask(Asking),
}

/// A key the holder asks for everyone: answered with
/// [`EstimateCache::answer`]; dropped unanswered, those waiting ask again.
pub struct Asking {
    table: u32,
    key: Key,
    id: u64,
    answer: watch::Sender<Shared>,
}

/// The answers by table, and their order of arrival.
#[derive(Default)]
struct State {
    names: HashMap<String, u32>,
    tables: Vec<HashMap<Key, Slot>>,
    order: VecDeque<(u32, Key, u32)>,
    known: usize,
    sizes: HashMap<String, (String, String)>,
    next: u64,
}

impl State {
    /// The index of `table`, new the first time.
    fn table(&mut self, table: &str) -> u32 {
        if let Some(&index) = self.names.get(table) {
            return index;
        }
        let index = self.tables.len() as u32;
        self.names.insert(table.to_owned(), index);
        self.tables.push(HashMap::new());
        index
    }

    /// Drop every answer about `table` (asks under way finish for those
    /// waiting on them, and are not remembered).
    fn forget(&mut self, table: &str) {
        if let Some(&index) = self.names.get(table) {
            let slots = std::mem::take(&mut self.tables[index as usize]);
            self.known -= slots
                .values()
                .filter(|slot| matches!(slot, Slot::Known { .. }))
                .count();
        }
    }
}

/// Answers of PostgreSQL's estimates, by statement and column; see the
/// module.
pub struct EstimateCache {
    state: Mutex<State>,
    ttl: Duration,
    capacity: usize,
    born: Instant,
    sized: Mutex<Option<Instant>>,
    sizes_every: Duration,
}

impl EstimateCache {
    /// Answers kept for `ttl` (zero: none kept, asks still shared), at
    /// most `capacity` of them.
    pub fn new(ttl: Duration, capacity: usize) -> Self {
        EstimateCache {
            state: Mutex::new(State::default()),
            ttl,
            capacity: capacity.max(1),
            born: Instant::now(),
            sized: Mutex::new(None),
            sizes_every: SIZES_EVERY,
        }
    }

    /// Read the tables' sizes every `every` instead of [`SIZES_EVERY`]
    /// (tests; zero: before every estimate).
    pub fn with_sizes_every(mut self, every: Duration) -> Self {
        self.sizes_every = every;
        self
    }

    /// The cache `STREAMGRES_ESTIMATE_TTL_MS` and `STREAMGRES_ESTIMATE_CACHE`
    /// describe ([`DEFAULT_TTL`] and [`DEFAULT_CAPACITY`] when unset or
    /// not a number).
    pub fn from_env() -> Self {
        let number = |name: &str| {
            std::env::var(name)
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
        };
        EstimateCache::new(
            number("STREAMGRES_ESTIMATE_TTL_MS").map_or(DEFAULT_TTL, Duration::from_millis),
            number("STREAMGRES_ESTIMATE_CACHE").map_or(DEFAULT_CAPACITY, |n| n as usize),
        )
    }

    /// Each of `wanted` (`(table, key)`): its answer, the ask under way
    /// to wait on, or the ask the caller makes (counted as hits, shared
    /// asks and misses).
    pub fn lookup(&self, wanted: &[(&str, Key)]) -> Vec<Lookup> {
        let now = self.now();
        let ttl = self.ttl_secs();
        let (mut hits, mut shared, mut misses) = (0, 0, 0);
        let mut state = self.lock();
        let found = wanted
            .iter()
            .map(|&(table, key)| {
                let table = state.table(table);
                let slots = &state.tables[table as usize];
                match slots.get(&key) {
                    Some(Slot::Known { answer, at }) if now.saturating_sub(*at) < ttl => {
                        hits += 1;
                        return Lookup::Known(*answer);
                    }
                    Some(Slot::Asked { answer, .. }) if answer.has_changed().is_ok() => {
                        shared += 1;
                        return Lookup::Wait(answer.clone());
                    }
                    _ => {}
                }
                misses += 1;
                let (sender, receiver) = watch::channel(None);
                let id = state.next;
                state.next += 1;
                let old = state.tables[table as usize].insert(
                    key,
                    Slot::Asked {
                        id,
                        answer: receiver,
                    },
                );
                if matches!(old, Some(Slot::Known { .. })) {
                    state.known -= 1;
                }
                Lookup::Ask(Asking {
                    table,
                    key,
                    id,
                    answer: sender,
                })
            })
            .collect();
        let known = state.known;
        drop(state);
        if let Some(stats) = crate::stats::Stats::global() {
            use std::sync::atomic::Ordering::Relaxed;
            stats.estimate_hits.fetch_add(hits, Relaxed);
            stats.estimate_shared.fetch_add(shared, Relaxed);
            stats.estimate_misses.fetch_add(misses, Relaxed);
            stats.estimate_cache_entries.store(known as u64, Relaxed);
        }
        found
    }

    /// `asking`'s answer, `result`: handed to those waiting, and kept when
    /// it is one (and the table was not forgotten meanwhile).
    pub fn answer(&self, asking: Asking, result: Result<Answer, String>) {
        let now = self.now();
        let mut state = self.lock();
        asking.answer.send_replace(Some(result.clone()));
        let table = asking.table as usize;
        let ours = matches!(
            state.tables[table].get(&asking.key),
            Some(Slot::Asked { id, .. }) if *id == asking.id
        );
        if !ours {
            return;
        }
        match result {
            Ok(answer) if !self.ttl.is_zero() => {
                state.tables[table].insert(asking.key, Slot::Known { answer, at: now });
                state.known += 1;
                state.order.push_back((asking.table, asking.key, now));
                self.trim(&mut state, now);
            }
            _ => {
                state.tables[table].remove(&asking.key);
            }
        }
    }

    /// Whether the tables' sizes are due a read ([`SIZES_EVERY`] since the
    /// last, or never read; see [`EstimateCache::with_sizes_every`]): true for one caller, who reads [`SIZES_SQL`]
    /// and hands the rows to [`EstimateCache::sizes`]; a read that fails
    /// waits for the next turn.
    pub fn sizes_due(&self) -> bool {
        let mut sized = self
            .sized
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match *sized {
            Some(at) if at.elapsed() < self.sizes_every => false,
            _ => {
                *sized = Some(Instant::now());
                true
            }
        }
    }

    /// The tables' sizes now, `(name, reltuples, relpages)`: every table
    /// whose size moved since the last read, or that is gone, is
    /// forgotten.
    pub fn sizes(&self, sizes: impl IntoIterator<Item = (String, String, String)>) {
        let mut state = self.lock();
        let now: HashMap<String, (String, String)> = sizes
            .into_iter()
            .map(|(name, tuples, pages)| (name, (tuples, pages)))
            .collect();
        let before = std::mem::take(&mut state.sizes);
        let mut moved: Vec<&String> = before
            .iter()
            .filter(|(name, size)| now.get(*name) != Some(size))
            .map(|(name, _)| name)
            .collect();
        if !before.is_empty() {
            moved.extend(now.keys().filter(|name| !before.contains_key(*name)));
        }
        for name in moved {
            state.forget(name);
        }
        state.sizes = now;
    }

    /// Forget every answer: the tables may have changed shape.
    pub fn clear(&self) {
        let mut state = self.lock();
        for slots in &mut state.tables {
            slots.clear();
        }
        state.order.clear();
        state.known = 0;
    }

    /// How many answers are kept.
    pub fn len(&self) -> usize {
        self.lock().known
    }

    /// Whether no answer is kept.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Drop the answers past their TTL from the front of the order, then
    /// the oldest while there are more than `capacity`; an entry of the
    /// order no longer describing a kept answer (forgotten, asked again)
    /// is skipped, and the order rebuilt when they outnumber the answers.
    fn trim(&self, state: &mut State, now: u32) {
        let ttl = self.ttl_secs();
        while let Some(&(table, key, at)) = state.order.front() {
            let expired = now.saturating_sub(at) >= ttl;
            if !expired && state.known <= self.capacity {
                break;
            }
            state.order.pop_front();
            let slots = &mut state.tables[table as usize];
            if matches!(slots.get(&key), Some(Slot::Known { at: kept, .. }) if *kept == at) {
                slots.remove(&key);
                state.known -= 1;
            }
        }
        if state.order.len() > 2 * state.known + 1024 {
            let State { order, tables, .. } = state;
            order.retain(|(table, key, at)| {
                matches!(tables[*table as usize].get(key), Some(Slot::Known { at: kept, .. }) if kept == at)
            });
        }
    }

    /// Seconds since the cache began.
    fn now(&self) -> u32 {
        u32::try_from(self.born.elapsed().as_secs()).unwrap_or(u32::MAX)
    }

    /// The TTL in whole seconds, at least one (zero keeps nothing anyway).
    fn ttl_secs(&self) -> u32 {
        u32::try_from(self.ttl.as_secs()).unwrap_or(u32::MAX).max(1)
    }

    /// The state, read through a poisoned lock.
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache() -> EstimateCache {
        EstimateCache::new(Duration::from_secs(60), 100)
    }

    /// The one lookup of `key` on `table`.
    fn one(cache: &EstimateCache, table: &str, key: Key) -> Lookup {
        cache.lookup(&[(table, key)]).pop().expect("one lookup")
    }

    fn asking(lookup: Lookup) -> Asking {
        match lookup {
            Lookup::Ask(asking) => asking,
            _ => panic!("expected to ask"),
        }
    }

    /// A statement is asked once, then answered from the cache; another
    /// literal is another statement.
    #[test]
    fn an_answer_is_kept_by_its_statement() {
        let cache = cache();
        let key = Key::statement("EXPLAIN SELECT 1 FROM t WHERE a = 'me'");
        cache.answer(asking(one(&cache, "t", key)), Ok(Answer::Rows(7.0)));
        assert!(matches!(one(&cache, "t", key), Lookup::Known(Answer::Rows(rows)) if rows == 7.0));
        let other = Key::statement("EXPLAIN SELECT 1 FROM t WHERE a = 'you'");
        assert!(matches!(one(&cache, "t", other), Lookup::Ask(_)));
        assert_ne!(
            Key::statement("t.a"),
            Key::column("t", "a"),
            "a statement is not a column"
        );
        assert_eq!(cache.len(), 1);
    }

    /// A statement asked while another batch asks it waits for that
    /// answer; a failure reaches those waiting and is not kept.
    #[test]
    fn an_ask_under_way_is_shared() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime");
        runtime.block_on(async {
            let cache = cache();
            let key = Key::statement("x");
            let first = asking(one(&cache, "t", key));
            let Lookup::Wait(mut waiting) = one(&cache, "t", key) else {
                panic!("expected to wait");
            };
            cache.answer(first, Ok(Answer::Rows(3.0)));
            let seen = waiting
                .wait_for(Option::is_some)
                .await
                .expect("answered")
                .clone();
            assert_eq!(seen, Some(Ok(Answer::Rows(3.0))));

            let failing = Key::statement("y");
            let first = asking(one(&cache, "t", failing));
            let Lookup::Wait(mut waiting) = one(&cache, "t", failing) else {
                panic!("expected to wait");
            };
            cache.answer(first, Err("down".to_owned()));
            let seen = waiting
                .wait_for(Option::is_some)
                .await
                .expect("answered")
                .clone();
            assert_eq!(seen, Some(Err("down".to_owned())));
            assert!(
                matches!(one(&cache, "t", failing), Lookup::Ask(_)),
                "not kept"
            );
        });
    }

    /// An asker that went away leaves the statement to the next to ask.
    #[test]
    fn an_abandoned_ask_is_asked_again() {
        let cache = cache();
        let key = Key::statement("x");
        drop(asking(one(&cache, "t", key)));
        assert!(matches!(one(&cache, "t", key), Lookup::Ask(_)));
    }

    /// An answer past its TTL is asked again.
    #[test]
    fn an_answer_lasts_its_ttl() {
        let cache = EstimateCache {
            born: Instant::now() - Duration::from_secs(120),
            ..EstimateCache::new(Duration::from_secs(60), 100)
        };
        let key = Key::statement("x");
        let asked = asking(one(&cache, "t", key));
        {
            let mut state = cache.lock();
            let table = state.table("t");
            state.tables[table as usize].insert(
                key,
                Slot::Known {
                    answer: Answer::Rows(1.0),
                    at: 0,
                },
            );
            state.known += 1;
        }
        drop(asked);
        assert!(
            matches!(one(&cache, "t", key), Lookup::Ask(_)),
            "120 s old, TTL 60 s"
        );
    }

    /// A table whose size moved, or that is gone, loses its answers; the
    /// others keep theirs. The first read only learns the sizes.
    #[test]
    fn a_table_whose_size_moved_is_forgotten() {
        let cache = cache();
        let size = |name: &str, tuples: &str| (name.to_owned(), tuples.to_owned(), "10".to_owned());
        cache.sizes([size("a", "100"), size("b", "100"), size("c", "5")]);
        for table in ["a", "b", "c"] {
            let key = Key::statement(table);
            cache.answer(asking(one(&cache, table, key)), Ok(Answer::Rows(1.0)));
        }
        assert_eq!(cache.len(), 3);
        cache.sizes([size("a", "100"), size("b", "250")]);
        assert!(matches!(
            one(&cache, "a", Key::statement("a")),
            Lookup::Known(_)
        ));
        assert!(
            matches!(one(&cache, "b", Key::statement("b")), Lookup::Ask(_)),
            "grew"
        );
        assert!(
            matches!(one(&cache, "c", Key::statement("c")), Lookup::Ask(_)),
            "gone"
        );
        assert_eq!(cache.len(), 1);
    }

    /// Past its capacity the oldest answers leave first.
    #[test]
    fn the_oldest_answers_leave_first() {
        let cache = EstimateCache::new(Duration::from_secs(60), 2);
        for name in ["one", "two", "three"] {
            let key = Key::statement(name);
            cache.answer(asking(one(&cache, "t", key)), Ok(Answer::Rows(1.0)));
        }
        assert_eq!(cache.len(), 2);
        assert!(matches!(
            one(&cache, "t", Key::statement("one")),
            Lookup::Ask(_)
        ));
        assert!(matches!(
            one(&cache, "t", Key::statement("three")),
            Lookup::Known(_)
        ));
    }

    /// The sizes are read once per turn.
    #[test]
    fn the_sizes_are_due_once_per_turn() {
        let cache = cache();
        assert!(cache.sizes_due());
        assert!(!cache.sizes_due(), "read a moment ago");
    }
}
