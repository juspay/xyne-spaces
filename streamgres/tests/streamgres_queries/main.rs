//! The read queries of juspay/xyne-spaces, each rebuilt on the engine and
//! exercised end to end: the synced-query registry the dashboard subscribes
//! through (the backend's `queries.ts`, 283 queries at v1.316.4,
//! commit f80fd19) plus the access-control predicates `defineQuery` adds to
//! every one of them. One test per registry entry, named after it, in the
//! domain modules; the catalog is generated from the application's schema.
//!
//! Every test builds the closest query the model can express, registers it
//! over seeded storage, asserts the snapshot, then routes writes and asserts
//! the deltas. Where a query needs something the engine does not have, the
//! test keeps the expressible part and its doc names the gap by letter, so
//! the assertion shows the current behavior and flips when the gap closes.
//! `gaps.rs` pins each gap on its own.
//!
//! | Gap | What the queries use | What the engine has today |
//! |-----|----------------------|---------------------------|
//! | N | `IS NULL` / `IS NOT NULL` (74 + 9 sites) | **closed 2026-09-15**: `IS` / `IS_NOT` operators, indexed under the `NULL` key |
//! | L | `LIKE` / `ILIKE` (11 sites: searches over `name`, `title`, `xyneId`, and a JSON text) | not supported, by decision (2026-09-15): no pattern operator; the parser refuses it |
//! | X | an existence test inside `OR` (canvas visibility, `browsableChannels`, `channelLinks`, `summaryTemplates`, `getUsers`, the channel-access ACL `visibility = PUBLIC OR EXISTS participants`, the calls ACL) | **closed 2026-09-15**: an `EXISTS` leaf placed in the filter, bound to an INNER join's set |
//! | O | a second `ORDER BY` column (tiebreaks on `id`, 100+ sites) and `ORDER BY` / `LIMIT` inside `related` (`rcas` latest one, last 10 `conversations`) | **half closed 2026-09-15**: `ORDER BY` is a list of columns compared in turn, the page and the boundary decided by all of them; a node below the root still ships every matching row, unordered and uncapped |
//! | J | `json` columns (`metadata`, `recordingParticipants` searched with `LIKE`) | carried as opaque strings, serialized and deserialized as they are; no containment, path or pattern operator, by decision |
//! | E | `whereExists` returns no child rows | **closed 2026-09-15**: `whereExists` is an INNER edge; child rows ship as a part, only under a shown parent |
//! | S | `.one()` is a singular result | **closed 2026-09-15**: `LIMIT 1`, exactly one row shipped; the singular shape is the transport's |
//! | B | `LIMIT n` ships `n` rows | **closed 2026-09-15**: the client receives exactly the page of `n`, the difference of the page after every step; the doubled buffer behind it is the engine's |
//!
//! Keyset cursors (`.start(row, {inclusive})`, 34 sites) need no engine
//! change: the builder spells them as the `WHERE` they mean, and the tests
//! show the rewrite is exact. `{flip: true}` hints are planner advice with
//! no meaning here.

/// A row as `(column, value)` pairs with every value converted:
/// `row!["id" => "t1", "createdAt" => 100]`.
macro_rules! row {
    ($($column:expr => $value:expr),* $(,)?) => {
        &[$(($column, ::streamgres::model::Value::from($value))),*][..]
    };
}

mod acl;
mod activities;
mod boards_forms;
mod calls;
mod canvases;
mod catalog;
mod channels;
mod conversations;
mod gaps;
mod people;
mod support_desk;
mod tickets;
mod world;
mod zql;
