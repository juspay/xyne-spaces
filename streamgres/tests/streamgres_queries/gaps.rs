//! One pinning test per gap named in `main.rs`, so each is visible in the
//! suite on its own and starts failing the moment the engine closes it;
//! plus the two rewrites that need no engine change (keyset cursors and the
//! empty `IN` list), shown to be exact.

use streamgres::model::ComparisonOperator::{GT, NEQ};
use streamgres::model::Order::{ASC, DESC};
use streamgres::model::{OrderBy, Value, ValueType, Where};
use streamgres::parser::parse_read;

use super::catalog::catalog;
use super::world::{ME, World, ops};
use super::zql::{eq, is_null, or, same, zql};

/// Closed gap N: `visibleTo IS NULL OR visibleTo = me` is the visibility
/// rule of every message query. `IS NULL` selects the everyone-visible
/// message, `!=` still drops `NULL` rows as SQL does, and the parser reads
/// both spellings while refusing `IS` with anything but `NULL`.
#[test]
fn n_is_null_selects_null_rows_and_comparisons_still_do_not() {
    let mut w = World::new();
    w.seed(
        "messages",
        &[
            ("messageId", "m-all".into()),
            ("conversationId", "c1".into()),
            ("visibleTo", Value::Null),
        ],
    );
    w.seed(
        "messages",
        &[
            ("messageId", "m-me".into()),
            ("conversationId", "c1".into()),
            ("visibleTo", ME.into()),
        ],
    );
    w.seed(
        "messages",
        &[
            ("messageId", "m-other".into()),
            ("conversationId", "c1".into()),
            ("visibleTo", "u-2".into()),
        ],
    );

    let visible = zql("messages")
        .eq("conversationId", "c1")
        .filter(or(vec![is_null("visibleTo"), eq("visibleTo", ME)]));
    assert_eq!(
        w.subscribe("q", &visible),
        ops(["q/main+m-all", "q/main+m-me"])
    );

    let not_hidden = zql("messages")
        .eq("conversationId", "c1")
        .where_("visibleTo", NEQ, "u-2");
    assert_eq!(w.subscribe("q2", &not_hidden), ops(["q2/main+m-me"]));
    assert_eq!(
        w.update(
            "messages",
            &[
                ("messageId", "m-all".into()),
                ("conversationId", "c1".into()),
                ("visibleTo", "u-2".into()),
            ],
        ),
        ops(["q/main-m-all"])
    );

    let parsed = parse_read("SELECT * FROM messages WHERE visibleTo IS NULL", &catalog())
        .expect("IS NULL parses");
    assert_eq!(parsed.filter, Where::is_null("visibleTo"));
    let parsed = parse_read("SELECT * FROM tickets WHERE rootId IS NOT NULL", &catalog())
        .expect("IS NOT NULL parses");
    assert_eq!(parsed.filter, Where::is_not_null("rootId"));
    let error = parse_read("SELECT * FROM messages WHERE visibleTo IS 'x'", &catalog())
        .expect_err("IS takes NULL only");
    assert!(error.message.contains("expected NULL after IS"), "{error}");
}

/// Gap L: the search queries match `name`, `title`, `xyneId` with `ILIKE`,
/// and two recording queries scan a JSON column with `LIKE`; the parser
/// refuses both spellings.
#[test]
fn l_like_and_ilike_are_refused() {
    let error = parse_read(
        "SELECT * FROM user_groups WHERE name ILIKE '%ops%'",
        &catalog(),
    )
    .expect_err("no ILIKE");
    assert!(
        error.message.contains("expected a comparison operator"),
        "{error}"
    );
    let error = parse_read(
        "SELECT * FROM calls WHERE recordingParticipants LIKE '%\"u-2\"%'",
        &catalog(),
    )
    .expect_err("no LIKE");
    assert!(
        error.message.contains("expected a comparison operator"),
        "{error}"
    );
}

/// Closed gap X: `visibility = PUBLIC OR EXISTS(participants WHERE userId
/// = me)` is the channel-access rule the ACL attaches to tickets,
/// conversations, messages, attachments and channels. The existence test
/// is an `EXISTS` leaf placed inside the `OR`, bound to the inner join's
/// set at registration: one subscription, a channel in both branches
/// delivered once, and a membership lost from a public channel changing
/// nothing but the participant row (the prune re-evaluates the filter).
#[test]
fn x_exists_inside_or_is_one_subscription() {
    let mut w = World::new();
    w.seed(
        "channels",
        &[("id", "c-pub".into()), ("visibility", "PUBLIC".into())],
    );
    w.seed(
        "channels",
        &[("id", "c-mine".into()), ("visibility", "PRIVATE".into())],
    );
    w.seed(
        "channels",
        &[("id", "c-both".into()), ("visibility", "PUBLIC".into())],
    );
    w.seed(
        "channels",
        &[("id", "c-other".into()), ("visibility", "PRIVATE".into())],
    );
    w.seed(
        "channel_participants",
        &[
            ("id", "p1".into()),
            ("channelId", "c-mine".into()),
            ("userId", ME.into()),
        ],
    );
    w.seed(
        "channel_participants",
        &[
            ("id", "p2".into()),
            ("channelId", "c-both".into()),
            ("userId", ME.into()),
        ],
    );
    w.seed(
        "channel_participants",
        &[
            ("id", "p3".into()),
            ("channelId", "c-other".into()),
            ("userId", "u-2".into()),
        ],
    );

    let mut q = zql("channels");
    let member = q.exists("participants", |p| p.eq("userId", ME));
    let q = q.filter(or(vec![eq("visibility", "PUBLIC"), member]));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+c-pub",
            "q/main+c-mine",
            "q/main+c-both",
            "q/has:participants+p1",
            "q/has:participants+p2"
        ])
    );
    assert_eq!(
        w.delete("channel_participants", "p2"),
        ops(["q/has:participants-p2"])
    );
    assert_eq!(
        w.delete("channel_participants", "p1"),
        ops(["q/main-c-mine", "q/has:participants-p1"])
    );
    assert_eq!(
        w.update(
            "channels",
            &[("id", "c-pub".into()), ("visibility", "PRIVATE".into())]
        ),
        ops(["q/main-c-pub"])
    );
    assert_eq!(
        w.insert(
            "channel_participants",
            &[
                ("id", "p4".into()),
                ("channelId", "c-other".into()),
                ("userId", ME.into()),
            ],
        ),
        ops(["q/main+c-other", "q/has:participants+p4"])
    );
}

/// Gap O, closed on both halves: `ORDER BY createdAt DESC, id ASC` is one
/// compound order, parsed and honored, so a page of two among tickets
/// tying on `createdAt` is decided by `id`, and only the page ships (gap B
/// closed: the doubled buffer is the engine's); and a related node's
/// `ORDER BY … LIMIT 1` is a window per parent, the "latest RCA" relation
/// delivering the newest RCA alone.
#[test]
fn o_compound_order_pages_by_the_tiebreak_and_a_related_limit_is_per_parent() {
    let parsed = parse_read(
        "SELECT * FROM tickets ORDER BY createdAt DESC, id ASC LIMIT 2",
        &catalog(),
    )
    .expect("compound order");
    assert_eq!(
        parsed.order_by,
        vec![OrderBy::new("createdAt", DESC), OrderBy::new("id", ASC)]
    );

    let mut w = World::new();
    for (id, created) in [("t1", 100), ("t2", 100), ("t3", 100), ("t0", 200)] {
        w.seed(
            "tickets",
            &[("id", id.into()), ("createdAt", created.into())],
        );
    }
    let paged = zql("tickets")
        .order_by("createdAt", DESC)
        .order_by("id", ASC)
        .limit(2);
    assert_eq!(w.subscribe("q", &paged), ops(["q/main+t0", "q/main+t1"]));
    assert_eq!(
        w.insert(
            "tickets",
            &[("id", "t05".into()), ("createdAt", 100.into())]
        ),
        ops(["q/main+t05", "q/main-t1"]),
        "a tie on createdAt is broken by id: t05 enters the page and t1 leaves it"
    );
    assert_eq!(
        w.delete("tickets", "t0"),
        ops(["q/main-t0", "q/main+t1"]),
        "the buffer refills the page without a storage trip"
    );

    w.seed("tickets", &[("id", "t9".into())]);
    w.seed(
        "rcas",
        &[
            ("id", "r-old".into()),
            ("ticketId", "t9".into()),
            ("createdAt", 100.into()),
        ],
    );
    w.seed(
        "rcas",
        &[
            ("id", "r-new".into()),
            ("ticketId", "t9".into()),
            ("createdAt", 200.into()),
        ],
    );
    let latest_rca = zql("tickets")
        .eq("id", "t9")
        .related("rcas", |r| r.order_by("createdAt", DESC).limit(1));
    assert_eq!(
        w.subscribe("latest", &latest_rca),
        ops(["latest/main+t9", "latest/rcas+r-new"])
    );
}

/// Gap J: the schema's `json` columns land in the catalog as strings, so a
/// query can compare a whole document but not look inside it.
#[test]
fn j_json_columns_are_opaque_strings() {
    let catalog = catalog();
    let calls = catalog.table("calls").expect("calls");
    assert_eq!(
        calls
            .column("recordingParticipants")
            .expect("column")
            .r#type,
        ValueType::String
    );
    assert_eq!(
        calls.column("metadata").expect("column").r#type,
        ValueType::String
    );
}

/// Closed gap E: `whereExists` is an INNER edge. The matching child rows
/// still ship as a part of their own, the client composing the join from
/// them, but only under a shown parent: `a2` belongs to the archived `t2`
/// and is held by the engine (it drives the edge) without being delivered.
#[test]
fn e_where_exists_ships_only_the_children_of_shown_parents() {
    let mut w = World::new();
    w.seed(
        "tickets",
        &[("id", "t1".into()), ("isArchived", false.into())],
    );
    w.seed(
        "tickets",
        &[("id", "t2".into()), ("isArchived", true.into())],
    );
    w.seed(
        "ticket_assignments",
        &[
            ("id", "a1".into()),
            ("ticketId", "t1".into()),
            ("userId", "u-2".into()),
        ],
    );
    w.seed(
        "ticket_assignments",
        &[
            ("id", "a2".into()),
            ("ticketId", "t2".into()),
            ("userId", "u-2".into()),
        ],
    );
    let reviewed_by = zql("tickets")
        .eq("isArchived", false)
        .where_exists("assignments", |a| a.eq("userId", "u-2"));
    assert_eq!(
        w.subscribe("q", &reviewed_by),
        ops(["q/main+t1", "q/has:assignments+a1"])
    );
    assert_eq!(
        w.update(
            "tickets",
            &[("id", "t2".into()), ("isArchived", false.into())],
        ),
        ops(["q/main+t2", "q/has:assignments+a2"])
    );
    assert_eq!(
        w.delete("ticket_assignments", "a1"),
        ops(["q/main-t1", "q/has:assignments-a1"])
    );
}

/// Gaps S and B, closed: `.one()` is a window of one row and the client
/// receives exactly its page — the best row now — while the engine keeps
/// a doubled buffer behind it: a better arrival replaces the shown row,
/// and when the shown row goes the buffered one surfaces at once.
#[test]
fn s_and_b_one_ships_exactly_one_row() {
    let mut w = World::new();
    w.seed(
        "conversations",
        &[
            ("conversationId", "c-old".into()),
            ("channelId", "ch".into()),
            ("createdAt", 100.into()),
        ],
    );
    w.seed(
        "conversations",
        &[
            ("conversationId", "c-new".into()),
            ("channelId", "ch".into()),
            ("createdAt", 200.into()),
        ],
    );
    w.seed(
        "conversations",
        &[
            ("conversationId", "c-oldest".into()),
            ("channelId", "ch".into()),
            ("createdAt", 50.into()),
        ],
    );
    let latest = zql("conversations")
        .eq("channelId", "ch")
        .order_by("createdAt", DESC)
        .one();
    assert_eq!(w.subscribe("q", &latest), ops(["q/main+c-new"]));
    assert_eq!(
        w.insert(
            "conversations",
            &[
                ("conversationId", "c-newer".into()),
                ("channelId", "ch".into()),
                ("createdAt", 300.into())
            ]
        ),
        ops(["q/main+c-newer", "q/main-c-new"])
    );
    assert_eq!(
        w.delete("conversations", "c-newer"),
        ops(["q/main-c-newer", "q/main+c-new"])
    );
}

/// Rewrite, exact: a keyset cursor `start({createdAt, id}, {inclusive:
/// false})` under `ORDER BY createdAt DESC, id ASC` is the predicate
/// `createdAt < X OR (createdAt = X AND id > Y)`; the inclusive form adds
/// the cursor row itself.
#[test]
fn keyset_cursor_is_the_where_it_means() {
    let mut w = World::new();
    for (id, created) in [("a", 300), ("b", 200), ("c", 200), ("d", 100)] {
        w.seed(
            "tickets",
            &[("id", id.into()), ("createdAt", created.into())],
        );
    }
    let after_b = zql("tickets")
        .order_by("createdAt", DESC)
        .order_by("id", ASC)
        .start(
            &[("createdAt", DESC, 200.into()), ("id", ASC, "b".into())],
            false,
        )
        .limit(10);
    assert_eq!(
        w.subscribe("after", &after_b),
        ops(["after/main+c", "after/main+d"])
    );
    let from_b = zql("tickets")
        .order_by("createdAt", DESC)
        .order_by("id", ASC)
        .start(
            &[("createdAt", DESC, 200.into()), ("id", ASC, "b".into())],
            true,
        )
        .limit(10);
    assert_eq!(
        w.subscribe("from", &from_b),
        ops(["from/main+b", "from/main+c", "from/main+d"])
    );
    let error = parse_read(
        "SELECT * FROM tickets WHERE createdAt < 200 OR (createdAt = 200 AND id > 'b') ORDER BY createdAt DESC LIMIT 10",
        &catalog(),
    );
    assert!(error.is_ok(), "{error:?}");
}

/// Rewrite, exact: the client cannot run `id IN []`, so the queries guard it
/// with a sentinel (`where('id', '__no_match__')`); the engine's empty
/// `IN` is simply false, and nothing ever routes to it.
#[test]
fn empty_in_list_is_false() {
    let mut w = World::new();
    w.seed("tickets", &[("id", "t1".into())]);
    assert_eq!(w.subscribe("q", &zql("tickets").in_("id", &[])), ops([]));
    assert_eq!(w.insert("tickets", &[("id", "t2".into())]), ops([]));
    let with_ids = zql("tickets").in_("id", &["t1", "t9"]);
    assert_eq!(w.subscribe("q2", &with_ids), ops(["q2/main+t1"]));
    assert_eq!(
        w.insert("tickets", &[("id", "t9".into())]),
        ops(["q2/main+t9"])
    );
}

/// Two clients on the same query (the dashboard opens `ticketRowById` per
/// card) share one tree: the second registration touches no storage and
/// is served the shared rows, a write reaches both, and dropping one
/// subscription leaves the other whole.
#[test]
fn identical_queries_share_one_tree() {
    let mut w = World::new();
    w.seed("tickets", &[("id", "t1".into()), ("boardId", "b1".into())]);
    let open = zql("tickets")
        .eq("boardId", "b1")
        .related("assignments", same);
    assert_eq!(w.subscribe("a", &open), ops(["a/main+t1"]));
    assert_eq!(w.subscribe("b", &open), ops(["b/main+t1"]));
    assert_eq!(
        w.insert(
            "ticket_assignments",
            &[
                ("id", "as1".into()),
                ("ticketId", "t1".into()),
                ("userId", ME.into())
            ]
        ),
        ops(["a/assignments+as1", "b/assignments+as1"])
    );
    w.unsubscribe("a");
    assert_eq!(
        w.insert("tickets", &[("id", "t2".into()), ("boardId", "b1".into())]),
        ops(["b/main+t2"])
    );
    assert_eq!(w.rows("b", "assignments"), 1);
}

/// The delta filter `defineQuery` adds for `lastUpdatedAt` is a plain
/// bound, the same on every table; and `.related` on the same row twice
/// (`referencesOut` and `referencesIn` both back to `tickets`) keeps the
/// two parts apart.
#[test]
fn delta_bound_and_self_joins_are_plain() {
    let mut w = World::new();
    w.seed(
        "channels",
        &[("id", "c1".into()), ("updatedAt", 100.into())],
    );
    w.seed(
        "channels",
        &[("id", "c2".into()), ("updatedAt", 300.into())],
    );
    assert_eq!(
        w.subscribe("delta", &zql("channels").where_("updatedAt", GT, 200)),
        ops(["delta/main+c2"])
    );

    w.seed("tickets", &[("id", "t1".into())]);
    w.seed("tickets", &[("id", "t2".into())]);
    w.seed(
        "ticket_reference_mappings",
        &[
            ("id", "r1".into()),
            ("sourceTicketId", "t1".into()),
            ("targetTicketId", "t2".into()),
        ],
    );
    let refs = zql("tickets")
        .eq("id", "t1")
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same));
    assert_eq!(
        w.subscribe("refs", &refs),
        ops([
            "refs/main+t1",
            "refs/referencesOut+r1",
            "refs/referencesOut.targetTicket+t2"
        ])
    );
    assert_eq!(w.rows("refs", "referencesIn"), 0);
}
