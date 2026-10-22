//! A warm start: the query shapes the last process was asked for, kept in
//! a file and planned again before this process says it is ready, so a
//! restart does not pay the planner's counts (and PostgreSQL's cold cache
//! under them) on the first client of every shape. A shape is a query's
//! name and the AST the application server gave for it; the plan cache is
//! keyed by the tree that AST translates to, so a shape planned here is a
//! cache hit for the first client that asks for it again. The file is
//! written every minute while shapes change and once more on shutdown.
//! A shape's AST is kept as its JSON text (a `RawValue`), in memory and
//! in the file alike: a few kilobytes each, where the parsed tree was
//! ten to fifty times that, and ten thousand of those was a gigabyte.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use serde_json::value::RawValue;

use super::ast::{self, Ast};
use super::plan::{self, PlanCache, Policy};
use crate::log::log_warn;
use crate::model::Catalog;
use crate::sync::Storage;

/// One shape: a query's name, the AST the application server gave for it
/// (as JSON text), and when it was last asked for (seconds since the
/// epoch).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Shape {
    pub name: String,
    pub ast: Box<RawValue>,
    pub last: u64,
}

/// The file's content.
#[derive(Serialize, Deserialize)]
struct Saved {
    shapes: Vec<Shape>,
}

/// What a replay did: how many shapes planned, how many failed to
/// translate or plan, how many were left when the budget ran out.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Replayed {
    pub planned: usize,
    pub failed: usize,
    pub skipped: usize,
}

/// The shapes seen by this process, and the file they go to.
pub struct WarmStart {
    path: Option<PathBuf>,
    capacity: usize,
    seen: Mutex<HashMap<u64, Shape>>,
    dirty: AtomicBool,
}

impl WarmStart {
    /// Shapes kept in `path` (none: nothing is kept or replayed), at most
    /// `capacity` of them, the least recently asked for dropped first.
    pub fn new(path: Option<PathBuf>, capacity: usize) -> Self {
        WarmStart {
            path,
            capacity: capacity.max(1),
            seen: Mutex::new(HashMap::new()),
            dirty: AtomicBool::new(false),
        }
    }

    /// Whether shapes are kept at all.
    pub fn enabled(&self) -> bool {
        self.path.is_some()
    }

    /// The shapes the file holds, most recently asked for first; an
    /// absent or unreadable file is no shapes. The loaded shapes are also
    /// this process's starting set, so they are saved again with it.
    pub fn load(&self) -> Vec<Shape> {
        let Some(path) = &self.path else {
            return Vec::new();
        };
        let mut shapes = match read(path) {
            Ok(shapes) => shapes,
            Err(error) => {
                log_warn!("warm start: {}: {error}", path.display());
                return Vec::new();
            }
        };
        shapes.sort_by(|a, b| b.last.cmp(&a.last));
        shapes.truncate(self.capacity);
        let mut seen = self.lock();
        for shape in &shapes {
            seen.insert(key_of(&shape.name, shape.ast.get()), shape.clone());
        }
        shapes
    }

    /// Note that `name` was asked for with `ast`.
    pub fn record(&self, name: &str, ast: &Json) {
        if self.path.is_none() {
            return;
        }
        let now = now_secs();
        let text = ast.to_string();
        let key = key_of(name, &text);
        let mut seen = self.lock();
        match seen.get_mut(&key) {
            Some(shape) => {
                if shape.last == now {
                    return;
                }
                shape.last = now;
            }
            None => {
                if seen.len() >= self.capacity {
                    let oldest = seen
                        .iter()
                        .min_by_key(|(_, shape)| shape.last)
                        .map(|(key, _)| *key);
                    if let Some(oldest) = oldest {
                        seen.remove(&oldest);
                    }
                }
                let Ok(raw) = RawValue::from_string(text) else {
                    return;
                };
                seen.insert(
                    key,
                    Shape {
                        name: name.to_owned(),
                        ast: raw,
                        last: now,
                    },
                );
            }
        }
        self.dirty.store(true, Ordering::Relaxed);
    }

    /// How many shapes this process knows.
    pub fn len(&self) -> usize {
        self.lock().len()
    }

    /// Whether no shape has been seen or loaded.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Write the shapes to the file if any changed since the last write
    /// (a temporary file renamed into place, so a crash mid-write leaves
    /// the old file); a failure is logged.
    pub fn save(&self) {
        let Some(path) = &self.path else {
            return;
        };
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let shapes: Vec<Shape> = self.lock().values().cloned().collect();
        if let Err(error) = write(path, &shapes) {
            log_warn!("warm start: writing {}: {error}", path.display());
            self.dirty.store(true, Ordering::Relaxed);
        }
    }

    /// Plan `shapes` (in the order given) against `catalog` and `storage`
    /// into `cache`, `at_once` at a time, stopping when `budget` has
    /// elapsed; a shape that no longer translates or plans is counted,
    /// not fatal.
    pub async fn replay<S: Storage + ?Sized>(
        shapes: Vec<Shape>,
        catalog: &Catalog,
        policy: Policy,
        cache: &PlanCache,
        storage: &S,
        budget: Duration,
        at_once: usize,
    ) -> Replayed {
        let started = Instant::now();
        let total = shapes.len();
        let mut outcome = Replayed::default();
        let mut work = stream::iter(shapes.into_iter())
            .map(|shape| async move {
                let ast: Ast = match serde_json::from_str(shape.ast.get()) {
                    Ok(ast) => ast,
                    Err(_) => return false,
                };
                let Ok(translated) = ast::translate(&ast, catalog) else {
                    return false;
                };
                plan::plan(&shape.name, translated, policy, cache, storage)
                    .await
                    .is_ok()
            })
            .buffer_unordered(at_once.max(1));
        while started.elapsed() < budget {
            match work.next().await {
                Some(true) => outcome.planned += 1,
                Some(false) => outcome.failed += 1,
                None => break,
            }
        }
        outcome.skipped = total - outcome.planned - outcome.failed;
        outcome
    }

    /// The shapes, read through a poisoned lock.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Shape>> {
        self.seen
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The key of a shape: a hash of its name and its AST's text.
fn key_of(name: &str, ast_text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    name.hash(&mut hasher);
    ast_text.hash(&mut hasher);
    hasher.finish()
}

/// Seconds since the epoch.
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

/// The shapes in `path`; an absent file is none.
fn read(path: &Path) -> Result<Vec<Shape>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let saved: Saved = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Ok(saved.shapes)
}

/// Write `shapes` to `path` through a temporary file beside it.
fn write(path: &Path, shapes: &[Shape]) -> Result<(), String> {
    let text = serde_json::to_string(&Saved {
        shapes: shapes.to_vec(),
    })
    .map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DbColumn, DbTable, ValueType};
    use crate::sync::MemoryStorage;
    use serde_json::json;

    /// A file of its own for one test.
    fn scratch(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("streamgres-warm-{name}-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        path
    }

    /// The AST of a thread's messages.
    fn thread(id: &str) -> Json {
        json!({
            "table": "messages",
            "where": { "type": "simple", "op": "=", "left": { "type": "column", "name": "conversationId" }, "right": { "type": "literal", "value": id } }
        })
    }

    #[test]
    fn shapes_round_trip_through_the_file_most_recent_first() {
        let path = scratch("round-trip");
        let warm = WarmStart::new(Some(path.clone()), 2);
        warm.record("conversationMessages", &thread("a"));
        warm.record("conversationMessages", &thread("a"));
        assert_eq!(warm.len(), 1, "the same shape twice is one shape");
        {
            let mut seen = warm.lock();
            seen.values_mut().next().unwrap().last -= 10;
        }
        warm.record("conversationMessages", &thread("b"));
        warm.record("conversationMessages", &thread("c"));
        assert_eq!(warm.len(), 2, "the capacity drops the oldest");
        warm.save();
        warm.save();
        let again = WarmStart::new(Some(path.clone()), 10);
        let loaded = again.load();
        let ids: Vec<String> = loaded
            .iter()
            .map(|shape| {
                let ast: Json = serde_json::from_str(shape.ast.get()).unwrap();
                ast["where"]["right"]["value"].as_str().unwrap().to_owned()
            })
            .collect();
        assert!(
            ids.contains(&"b".to_owned()) && ids.contains(&"c".to_owned()),
            "{ids:?}"
        );
        assert!(!ids.contains(&"a".to_owned()));
        assert!(loaded[0].last >= loaded[1].last, "most recent first");
        assert_eq!(again.len(), 2, "the loaded shapes are the starting set");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn nothing_is_kept_without_a_file() {
        let warm = WarmStart::new(None, 10);
        warm.record("conversationMessages", &thread("a"));
        assert!(warm.is_empty());
        assert!(warm.load().is_empty());
        warm.save();
    }

    #[tokio::test]
    async fn a_replay_fills_the_plan_cache_within_its_budget() {
        let catalog = Catalog::new(vec![DbTable::new(
            "messages",
            ["messageId"],
            vec![
                DbColumn::new("messageId", ValueType::String),
                DbColumn::new("conversationId", ValueType::String),
            ],
        )]);
        let cache = PlanCache::new(Duration::from_secs(60), 100, Duration::from_secs(60));
        let storage = MemoryStorage::new();
        let policy = Policy {
            limit: 1000,
            preferred: super::super::plan::Side::Parent,
        };
        let raw = |ast: Json| RawValue::from_string(ast.to_string()).unwrap();
        let shapes = vec![
            Shape {
                name: "conversationMessages".into(),
                ast: raw(thread("a")),
                last: 2,
            },
            Shape {
                name: "conversationMessages".into(),
                ast: raw(thread("b")),
                last: 1,
            },
            Shape {
                name: "broken".into(),
                ast: raw(json!({ "table": "nowhere" })),
                last: 0,
            },
        ];
        let replayed = WarmStart::replay(
            shapes.clone(),
            &catalog,
            policy,
            &cache,
            &storage,
            Duration::from_secs(10),
            4,
        )
        .await;
        assert_eq!(
            replayed,
            Replayed {
                planned: 2,
                failed: 1,
                skipped: 0
            }
        );
        assert_eq!(cache.queries(), 1, "two threads of one query are one plan");
        assert!(
            (1..=2).contains(&cache.len()),
            "the second thread is planned by the name once the first is"
        );
        let none = WarmStart::replay(
            shapes,
            &catalog,
            policy,
            &PlanCache::new(Duration::from_secs(60), 100, Duration::from_secs(60)),
            &storage,
            Duration::ZERO,
            4,
        )
        .await;
        assert_eq!(none.skipped, 3, "a spent budget plans nothing");
    }
}
