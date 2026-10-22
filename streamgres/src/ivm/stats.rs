//! Operation counters for the IVM engine.
//!
//! The whole point of the DNF counting index is that a write's routing cost
//! scales with how *relevant* the write is (conditions matched, counters
//! bumped), not with how many subscriptions exist. These counters make that
//! claim measurable. The demo binary (`src/main.rs`) prints a per-write diff
//! of them.

use std::fmt;

/// Cumulative counters, monotonically increasing over an [`crate::ivm::SingleTableIVM`]'s
/// lifetime. Use [`IvmStats::diff`] to isolate the cost of a single write.
///
/// Registration:
/// - `queries_registered`: calls to `register_query` — including identical
///   re-registrations, which are otherwise no-ops.
/// - `disjuncts_registered`: DNF disjuncts created across all registrations.
/// - `conditions_indexed`: (condition → disjunct) links added to the reverse
///   index.
/// - `snapshots_shared`: registrations whose initial result set was served
///   from an identical already-registered query's rows instead of a storage
///   query.
/// - `conditions_replaced`: in-place edits of indexed conditions — one per
///   value added to or removed from a set-valued `IN` leaf (a join edge
///   crossing zero), or per disjunct rewritten by `replace_condition` —
///   the cheap alternative to re-registration.
///
/// Write routing:
/// - `writes_processed`: writes processed by `incremental_update`.
/// - `columns_probed`: row columns looked up in the per-column value
///   index — the `O(columns)` term of routing.
/// - `conditions_evaluated`: conditions the column index produced for the
///   row image; every one is a match, so this equals `index_hits`, and it
///   is independent of how many conditions the table carries.
/// - `index_hits`: conditions that matched the row image.
/// - `disjunct_increments`: disjunct counter bumps performed for matching
///   conditions — the output-sensitive part of routing (work ∝ matching
///   links, not subscriptions).
/// - `disjuncts_fired`: disjuncts whose counter reached its size — each
///   firing impacts *every* subscription sharing that disjunct shape, so
///   this can be smaller than the subscriptions found by counting.
/// - `membership_probes`: holder tags read off the written row's shared
///   frame entry — O(1) per holder, no subscription scan, so probes equal
///   hits.
/// - `membership_hits`: subscriptions found holding the row.
/// - `queries_impacted`: subscriptions confirmed impacted.
///
/// Storage reads:
/// - `storage_reads`: reads asked for — registration snapshots, narrowed
///   join fetches, and window refills together; each is one storage
///   round trip the runtime runs.
///
/// Window maintenance:
/// - `window_evictions`: rows evicted past a window's doubled buffer (a
///   page's admitted rows demoted past it counted too).
/// - `window_refills`: refill reads asked for by drained windows and by
///   pages reaching further.
/// - `window_rejections`: rows a join gate rejected inside a page: dropped
///   by a page read in batches, kept apart by one read whole.
/// - `window_capped`: pages that stopped reaching further after
///   [`super::PAGE_ROUNDS`] rounds without filling.
/// - `page_rounds`: rounds pages took past their first batch, each a
///   batch twice the size of the last (a read, or a promotion from the
///   rows a page read whole holds).
/// - `page_lookups`: reads pages asked for of one join value they had
///   dropped, because a write on the driven side concerned it.
/// - `row_reads`: rows read again by primary key because the only image
///   at hand of a row a subscription needed was partial (the feed left a
///   large unchanged value out of an update's image and no complete copy
///   was held) — one per row, however many subscriptions wait on it.
///
/// Emitted operations:
/// - `ops_add`: `Add` operations emitted (row entered a result set, or
///   changed in place).
/// - `ops_delete`: `Delete` operations emitted (row left a result set).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IvmStats {
    pub queries_registered: u64,
    pub disjuncts_registered: u64,
    pub conditions_indexed: u64,
    pub snapshots_shared: u64,
    pub conditions_replaced: u64,
    pub writes_processed: u64,
    pub columns_probed: u64,
    pub conditions_evaluated: u64,
    pub index_hits: u64,
    pub disjunct_increments: u64,
    pub disjuncts_fired: u64,
    pub membership_probes: u64,
    pub membership_hits: u64,
    pub queries_impacted: u64,
    pub storage_reads: u64,
    pub window_evictions: u64,
    pub window_refills: u64,
    pub window_rejections: u64,
    pub window_capped: u64,
    pub page_rounds: u64,
    pub page_lookups: u64,
    pub row_reads: u64,
    pub ops_add: u64,
    pub ops_delete: u64,
}

impl IvmStats {
    /// Counter movement since `earlier` — the cost of the work done between
    /// the two snapshots.
    pub fn diff(&self, earlier: &IvmStats) -> IvmStats {
        IvmStats {
            queries_registered: self.queries_registered - earlier.queries_registered,
            disjuncts_registered: self.disjuncts_registered - earlier.disjuncts_registered,
            conditions_indexed: self.conditions_indexed - earlier.conditions_indexed,
            snapshots_shared: self.snapshots_shared - earlier.snapshots_shared,
            conditions_replaced: self.conditions_replaced - earlier.conditions_replaced,
            writes_processed: self.writes_processed - earlier.writes_processed,
            columns_probed: self.columns_probed - earlier.columns_probed,
            conditions_evaluated: self.conditions_evaluated - earlier.conditions_evaluated,
            index_hits: self.index_hits - earlier.index_hits,
            disjunct_increments: self.disjunct_increments - earlier.disjunct_increments,
            disjuncts_fired: self.disjuncts_fired - earlier.disjuncts_fired,
            membership_probes: self.membership_probes - earlier.membership_probes,
            membership_hits: self.membership_hits - earlier.membership_hits,
            queries_impacted: self.queries_impacted - earlier.queries_impacted,
            storage_reads: self.storage_reads - earlier.storage_reads,
            window_evictions: self.window_evictions - earlier.window_evictions,
            window_refills: self.window_refills - earlier.window_refills,
            window_rejections: self.window_rejections - earlier.window_rejections,
            window_capped: self.window_capped - earlier.window_capped,
            page_rounds: self.page_rounds - earlier.page_rounds,
            page_lookups: self.page_lookups - earlier.page_lookups,
            row_reads: self.row_reads - earlier.row_reads,
            ops_add: self.ops_add - earlier.ops_add,
            ops_delete: self.ops_delete - earlier.ops_delete,
        }
    }

    /// Compact single-line rendering of the routing counters, used by the
    /// demo for per-write output.
    pub fn routing_summary(&self) -> String {
        format!(
            "{} columns probed, {} conds matched, {} disjunct bumps, {} fired, membership {}/{} hit, {} impacted, ops +{}/-{}",
            self.columns_probed,
            self.conditions_evaluated,
            self.disjunct_increments,
            self.disjuncts_fired,
            self.membership_hits,
            self.membership_probes,
            self.queries_impacted,
            self.ops_add,
            self.ops_delete,
        )
    }
}

impl fmt::Display for IvmStats {
    /// Multi-line, dot-aligned rendering of every counter.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "queries registered ......... {}",
            self.queries_registered
        )?;
        writeln!(
            f,
            "disjuncts registered ....... {}",
            self.disjuncts_registered
        )?;
        writeln!(
            f,
            "condition links indexed .... {}",
            self.conditions_indexed
        )?;
        writeln!(f, "snapshots shared ........... {}", self.snapshots_shared)?;
        writeln!(
            f,
            "conditions replaced ........ {}",
            self.conditions_replaced
        )?;
        writeln!(f, "writes processed ........... {}", self.writes_processed)?;
        writeln!(f, "columns probed ............. {}", self.columns_probed)?;
        writeln!(
            f,
            "conditions matched ......... {}",
            self.conditions_evaluated
        )?;
        writeln!(f, "condition hits ............. {}", self.index_hits)?;
        writeln!(
            f,
            "disjunct increments ........ {}",
            self.disjunct_increments
        )?;
        writeln!(f, "disjuncts fired ............ {}", self.disjuncts_fired)?;
        writeln!(
            f,
            "membership probes / hits ... {} / {}",
            self.membership_probes, self.membership_hits
        )?;
        writeln!(f, "queries impacted ........... {}", self.queries_impacted)?;
        writeln!(f, "storage reads asked ........ {}", self.storage_reads)?;
        writeln!(
            f,
            "window evictions / refills . {} / {}",
            self.window_evictions, self.window_refills
        )?;
        writeln!(
            f,
            "page rows rejected / capped  {} / {}",
            self.window_rejections, self.window_capped
        )?;
        writeln!(
            f,
            "page rounds / lookups ...... {} / {}",
            self.page_rounds, self.page_lookups
        )?;
        writeln!(f, "rows read again ............ {}", self.row_reads)?;
        write!(
            f,
            "ops emitted ................ {} adds, {} deletes",
            self.ops_add, self.ops_delete
        )
    }
}
