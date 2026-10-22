//! The runtime: the single owner of an engine, feeding it the write
//! stream and the results of the storage reads it asks for. It is a pure
//! state machine — no I/O, no clock — so every interleaving of reads and
//! writes can be replayed deterministically in a test; the drivers
//! ([`super::Local`], [`super::Service`]) feed it and run the reads it
//! hands out.
//!
//! # One position
//!
//! The engine sits at one position at every moment: the location of the
//! last write routed into it. A storage read is positioned at or below
//! that (the storage's contract, see [`super::Storage`]), never above, and
//! it lands the moment it returns: every delivered write past the read's
//! snapshot that touches a row of its result is applied to the result
//! first — a delete, or a new image that fails the read's filter, drops
//! the row; a new image that passes replaces it — and what remains is
//! exactly what the engine's position implies. A new image the feed left
//! columns out of (a large value an update did not touch) is completed
//! from the row's image before it, so it replaces nothing the update did
//! not change. The engine then adopts the rows without comparing
//! anything. Nothing waits: a read behind the stream is caught up, and a
//! read ahead of it cannot exist.
//!
//! The delivered writes are kept in a buffer bounded below by the
//! **floor**: the lowest location a read can still be positioned at,
//! which the driver learns from the storage and sets here, taken together
//! with the floors the reads in flight were issued under. A read the
//! driver could not run (no snapshot available yet) is parked and handed
//! out again the next time the stream moves.

use std::collections::{HashMap, VecDeque};
use std::fmt;

use crate::ivm::{
    Delta, Engine, Fetch, FetchId, SchemaChange, complete_image, evaluate, order_rows,
};
use crate::model::frame::SharedRow;
use crate::model::{
    DataFrameKey, DataFrameRow, IdMap, Lsn, Snapshot, SubId, TableName, WriteQuery,
};

/// What one runtime step produced: deltas to deliver, and reads the
/// driver must run and report back through [`Runtime::fetched`] (or
/// [`Runtime::failed`]).
#[derive(Debug, Default)]
pub struct Step {
    pub updates: Vec<Delta>,
    pub selects: Vec<Fetch>,
}

/// A read the driver is running: what was asked for, the floor it was
/// issued under, and whether it is parked awaiting the stream.
struct InFlight {
    fetch: Fetch,
    floor: Lsn,
    parked: bool,
}

/// One write the stream delivered, kept while a read may still be
/// positioned below it.
struct Delivered {
    at: Lsn,
    write: WriteQuery,
}

/// Counters of the runtime's own work.
///
/// - `reads_issued`: reads handed to the driver, re-issues included.
/// - `reads_landed`: reads whose rows were applied.
/// - `reads_retried`: reads parked after the driver reported a failure
///   and handed out again.
/// - `rows_dropped`: result rows removed before landing because a
///   delivered write past the read's snapshot deleted them or moved them
///   out of the read's filter.
/// - `rows_refreshed`: result rows whose image was replaced before
///   landing by such a write.
/// - `rows_completed`: such writes' images the feed left columns out of,
///   completed from the result's image of the row.
/// - `writes_buffered`: writes remembered for reads to be brought up.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncStats {
    pub reads_issued: u64,
    pub reads_landed: u64,
    pub reads_retried: u64,
    pub reads_refused: u64,
    pub rows_dropped: u64,
    pub rows_refreshed: u64,
    pub rows_completed: u64,
    pub rows_added: u64,
    pub writes_buffered: u64,
}

impl fmt::Display for SyncStats {
    /// Multi-line, dot-aligned rendering of every counter.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "reads issued / landed ...... {} / {}",
            self.reads_issued, self.reads_landed
        )?;
        writeln!(f, "reads retried .............. {}", self.reads_retried)?;
        writeln!(f, "reads refused .............. {}", self.reads_refused)?;
        writeln!(
            f,
            "rows dropped / refreshed ... {} / {}",
            self.rows_dropped, self.rows_refreshed
        )?;
        writeln!(f, "rows completed ............. {}", self.rows_completed)?;
        writeln!(f, "rows added late ............ {}", self.rows_added)?;
        write!(f, "writes buffered ............ {}", self.writes_buffered)
    }
}

/// The single owner of an engine (see the module docs).
///
/// - `engine`: the engine, exclusively owned.
/// - `in_flight`: reads handed to the driver and not yet landed, by id.
/// - `recent`: delivered writes above the floor, oldest first.
/// - `position`: the location of the last write routed (or progress mark
///   seen): where the engine is.
/// - `floor`: the lowest location a read issued from now on can be at.
/// - `stats`: the runtime's counters.
pub struct Runtime<E: Engine> {
    engine: E,
    in_flight: IdMap<FetchId, InFlight>,
    /// The rows of landed reads, kept until [`Runtime::take_landed`] so
    /// their freeing (an allocation per row) happens off the engine's
    /// thread; the frames hold the ones that matter by reference.
    landed: Vec<Vec<(DataFrameKey, DataFrameRow)>>,
    recent: VecDeque<Delivered>,
    position: Lsn,
    floor: Lsn,
    stats: SyncStats,
}

impl<E: Engine> Runtime<E> {
    /// A runtime owning `engine`, at location zero.
    pub fn new(engine: E) -> Self {
        Runtime {
            engine,
            in_flight: IdMap::default(),
            landed: Vec::new(),
            recent: VecDeque::new(),
            position: Lsn(0),
            floor: Lsn(0),
            stats: SyncStats::default(),
        }
    }

    /// The engine, for inspection.
    pub fn engine(&self) -> &E {
        &self.engine
    }

    /// The engine, for direct maintenance calls; run [`Runtime::pump`]
    /// afterwards to pick up any reads they asked for.
    pub fn engine_mut(&mut self) -> &mut E {
        &mut self.engine
    }

    /// The runtime's counters.
    pub fn stats(&self) -> &SyncStats {
        &self.stats
    }

    /// The engine's routing counters.
    pub fn engine_footprint(&self) -> crate::ivm::Footprint {
        self.engine.footprint()
    }

    /// The engine's own counters.
    pub fn engine_stats(&self) -> &crate::ivm::IvmStats {
        self.engine.stats()
    }

    /// Where the engine is: the location of the last write routed or
    /// progress mark seen.
    pub fn position(&self) -> Lsn {
        self.position
    }

    /// The lowest location a read issued from now on can be positioned
    /// at, as last told by the driver.
    pub fn floor(&self) -> Lsn {
        self.floor
    }

    /// How many delivered writes are kept for bringing reads up.
    pub fn buffered(&self) -> usize {
        self.recent.len()
    }

    /// How many reads are out (parked ones included).
    pub fn outstanding(&self) -> usize {
        self.in_flight.len()
    }

    /// Register a subscription: its id, whatever of its snapshot the
    /// engine had at hand, and the reads the rest needs.
    pub fn register(&mut self, query: E::Query) -> (SubId, Step) {
        let (sub, updates) = self.engine.subscribe(query);
        let mut step = Step {
            updates,
            selects: Vec::new(),
        };
        self.collect(&mut step);
        (sub, step)
    }

    /// Remove a subscription; its reads still out land as no-ops.
    pub fn unregister(&mut self, sub: SubId) {
        self.engine.unsubscribe(sub);
    }

    /// Route one write committed at `at`, remembering it for reads
    /// positioned below it. Writes arrive in commit order, so `at` never
    /// goes backwards (two writes of one transaction share a location).
    pub fn write(&mut self, write: &WriteQuery, at: Lsn) -> Step {
        debug_assert!(at >= self.position, "the stream delivers in commit order");
        self.position = self.position.max(at);
        self.stats.writes_buffered += 1;
        self.recent.push_back(Delivered {
            at,
            write: write.clone(),
        });
        let mut step = Step {
            updates: self.engine.route(write),
            selects: Vec::new(),
        };
        self.collect(&mut step);
        self.wake(&mut step);
        self.trim();
        step
    }

    /// A migration grew the schema ([`Engine::alter`]): the engine's held
    /// rows are brought onto the new layout before the writes that follow
    /// it are routed. Nothing is delivered for it.
    pub fn alter(&mut self, change: &SchemaChange) {
        self.engine.alter(change);
    }

    /// The feed has delivered everything up to `lsn` without a write to
    /// carry that fact (an idle tick, the end of a batch).
    pub fn progress(&mut self, lsn: Lsn) -> Step {
        self.position = self.position.max(lsn);
        let mut step = Step::default();
        self.wake(&mut step);
        step
    }

    /// The driver learned the storage's floor: no read issued from now on
    /// is positioned below `floor`. Never moves backwards.
    pub fn set_floor(&mut self, floor: Lsn) {
        if floor > self.floor {
            self.floor = floor;
            self.trim();
        }
    }

    /// The driver finished read `id`: bring its result up to the engine
    /// and land it. An id the runtime is not waiting for is ignored.
    pub fn fetched(&mut self, id: FetchId, snapshot: Snapshot) -> Step {
        let mut step = Step::default();
        let Some(flight) = self.in_flight.remove(&id) else {
            return step;
        };
        debug_assert!(
            snapshot.at <= self.position,
            "a read is never positioned ahead of the engine ({} > {})",
            snapshot.at,
            self.position
        );
        let (rows, worst_read) = self.bring_up(&flight.fetch, snapshot.rows, snapshot.at);
        self.stats.reads_landed += 1;
        step.updates = self.engine.land(&flight.fetch, &rows, worst_read.as_ref());
        self.landed.push(rows);
        self.collect(&mut step);
        self.trim();
        step
    }

    /// [`Engine::take_capped`]: the subscriptions one of whose pages
    /// stopped reaching past its rejected rows since the last call.
    pub fn take_capped(&mut self) -> Vec<SubId> {
        self.engine.take_capped()
    }

    /// [`Engine::take_dead`]: the rows dropped since the last call.
    pub fn take_dead(&mut self) -> Vec<SharedRow> {
        self.engine.take_dead()
    }

    /// The rows of the reads landed since the last call, to be freed
    /// elsewhere.
    pub fn take_landed(&mut self) -> Vec<Vec<(DataFrameKey, DataFrameRow)>> {
        std::mem::take(&mut self.landed)
    }

    /// The table read `id` is on, while the runtime waits for it.
    pub fn reading(&self, id: FetchId) -> Option<TableName> {
        self.in_flight
            .get(&id)
            .map(|flight| flight.fetch.query.table.clone())
    }

    /// The subscriptions whose hydration may complete when read `id`
    /// lands; nothing when the runtime is not waiting for it.
    pub fn waiting_on(&self, id: FetchId) -> Vec<SubId> {
        self.in_flight
            .get(&id)
            .map(|flight| self.engine.waiting_on(&flight.fetch))
            .unwrap_or_default()
    }

    /// The driver refused read `id` (it will never succeed): forget it and
    /// unsubscribe everything that was waiting on it, named so the owner
    /// of each can be told.
    pub fn refused(&mut self, id: FetchId) -> Vec<SubId> {
        let Some(flight) = self.in_flight.remove(&id) else {
            return Vec::new();
        };
        self.stats.reads_refused += 1;
        let gone = self.engine.refuse(&flight.fetch);
        self.trim();
        gone
    }

    /// The driver could not run read `id` (no snapshot available yet, a
    /// broken connection): park it; it is handed out again the next time
    /// the stream moves.
    pub fn failed(&mut self, id: FetchId) -> Step {
        if let Some(flight) = self.in_flight.get_mut(&id) {
            flight.parked = true;
        }
        Step::default()
    }

    /// Pick up reads the engine asked for outside a runtime call (a
    /// maintenance seam used directly).
    pub fn pump(&mut self) -> Step {
        let mut step = Step::default();
        self.collect(&mut step);
        step
    }

    /// Take the engine's new read requests into flight, issued under the
    /// current floor, and hand them to the driver.
    fn collect(&mut self, step: &mut Step) {
        for fetch in self.engine.requests() {
            self.stats.reads_issued += 1;
            self.in_flight.insert(
                fetch.id,
                InFlight {
                    fetch: fetch.clone(),
                    floor: self.floor,
                    parked: false,
                },
            );
            step.selects.push(fetch);
        }
    }

    /// Hand every parked read out again, under the current floor.
    fn wake(&mut self, step: &mut Step) {
        for flight in self.in_flight.values_mut() {
            if flight.parked {
                flight.parked = false;
                flight.floor = self.floor;
                self.stats.reads_retried += 1;
                self.stats.reads_issued += 1;
                step.selects.push(flight.fetch.clone());
            }
        }
    }

    /// Apply to a read's result every delivered write past its snapshot's
    /// location: a delete, or a new image that fails the read's filter,
    /// drops the row; a new image that passes replaces it; a row the
    /// snapshot did not have that a write since brought into the filter
    /// is added (it was routed to nobody if the subscription did not exist
    /// yet). Rows the writes never touched stand. Under a window whose
    /// read came back full, a row a write since moved worse than the worst
    /// row read, or brought in there, is left to a refill, so the frontier
    /// the landing sets stays honest; the worst row read comes back beside
    /// the rows for that frontier, since the rows alone, some of them
    /// dropped here, no longer say the read was full.
    ///
    /// A new image the feed left columns out of is completed from the
    /// result's image of the row, when the result holds it, and filtered
    /// whole. A row the result does not hold that such a write brings into
    /// the filter stays partial; the engine does not adopt it, and reads
    /// it again.
    fn bring_up(
        &mut self,
        fetch: &Fetch,
        rows: Vec<(DataFrameKey, DataFrameRow)>,
        at: Lsn,
    ) -> (Vec<(DataFrameKey, DataFrameRow)>, Option<DataFrameRow>) {
        let table: &TableName = &fetch.query.table;
        let query = &fetch.query;
        let worst_read = (query.limit != u32::MAX && rows.len() >= query.limit as usize)
            .then(|| {
                rows.iter()
                    .map(|(_, row)| row.clone())
                    .max_by(|a, b| order_rows(&query.order_by, a, b))
            })
            .flatten();
        let mut index: HashMap<DataFrameKey, usize> = rows
            .iter()
            .enumerate()
            .map(|(position, (key, _))| (key.clone(), position))
            .collect();
        let mut rows: Vec<Option<(DataFrameKey, DataFrameRow)>> =
            rows.into_iter().map(Some).collect();
        let beyond = |image: &DataFrameRow| {
            worst_read.as_ref().is_some_and(|worst| {
                order_rows(&query.order_by, image, worst) == std::cmp::Ordering::Greater
            })
        };
        for delivered in &self.recent {
            if delivered.at <= at || delivered.write.table() != table {
                continue;
            }
            let key = delivered.write.pkey_value();
            let position = index.get(key).copied();
            let Some(image) = delivered.write.new_row_image() else {
                if let Some(position) = position {
                    if rows[position].take().is_some() {
                        self.stats.rows_dropped += 1;
                    }
                    index.remove(key);
                }
                continue;
            };
            let completed = if image.data.is_partial() {
                let before = position.and_then(|position| rows[position].as_ref());
                complete_image(Some(image), before.map(|(_, row)| row))
            } else {
                None
            };
            if completed.is_some() {
                self.stats.rows_completed += 1;
            }
            let image = completed.as_ref().unwrap_or(image);
            let admitted = evaluate(&query.filter, &image.data, &mut 0) && !beyond(image);
            match position {
                Some(position) if admitted => {
                    if let Some((_, row)) = rows[position].as_mut() {
                        *row = image.clone();
                        self.stats.rows_refreshed += 1;
                    }
                }
                Some(position) => {
                    if rows[position].take().is_some() {
                        self.stats.rows_dropped += 1;
                    }
                    index.remove(key);
                }
                None if admitted => {
                    index.insert(key.clone(), rows.len());
                    rows.push(Some((key.clone(), image.clone())));
                    self.stats.rows_added += 1;
                }
                None => {}
            }
        }
        (rows.into_iter().flatten().collect(), worst_read)
    }

    /// Forget delivered writes no read can still be positioned below:
    /// those at or below the floor and every in-flight read's floor.
    fn trim(&mut self) {
        let keep_above = self
            .in_flight
            .values()
            .map(|flight| flight.floor)
            .fold(self.floor, Lsn::min);
        while self
            .recent
            .front()
            .is_some_and(|delivered| delivered.at <= keep_above)
        {
            self.recent.pop_front();
        }
    }
}
