//! The maps and sets the engine keys by its own small integers: a
//! subscription, row, read or tree id, or a query part. Their hasher is
//! `FxHasher`, one multiply per key, where the default `SipHash` costs
//! twenty times that on the path of every write. Keys that are user data
//! (values, names, filters) keep the default, collision-resistant hasher.

use std::collections::{HashMap, HashSet};
use std::hash::BuildHasherDefault;

use rustc_hash::FxHasher;

/// A map keyed by one of the engine's own ids.
pub type IdMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

/// A set of the engine's own ids.
pub type IdSet<K> = HashSet<K, BuildHasherDefault<FxHasher>>;
