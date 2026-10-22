//! The predicates `defineQuery` adds to every query through the per-table
//! ACL classes (the per-table ACL modules of the shared package): the tenant
//! backstop, the user scope, and the channel-access chain. Where the ACL
//! passes `channelId` and `isMember` (every V2+ conversation, message and
//! desk query) the chain is a tree of INNER edges; the generic
//! `visibility = PUBLIC OR EXISTS participants` form is the same with the
//! existence test placed inside the `OR` (see `gaps.rs`).

use super::world::{ME, WS, World, ops};
use super::zql::{eq, is_null, or, zql};

/// Every workspace-scoped root gets `workspaceId = ctx.workspaceId`: a row
/// of another workspace is neither in the snapshot nor ever routed.
#[test]
fn workspace_backstop_scopes_every_root() {
    let mut w = World::new();
    w.seed("tickets", &[("id", "t-mine".into())]);
    w.seed(
        "tickets",
        &[("id", "t-theirs".into()), ("workspaceId", "ws-2".into())],
    );
    assert_eq!(w.subscribe("q", &zql("tickets")), ops(["q/main+t-mine"]));
    assert_eq!(
        w.insert(
            "tickets",
            &[("id", "t-new".into()), ("workspaceId", "ws-2".into())]
        ),
        ops([])
    );
    assert_eq!(
        w.insert("tickets", &[("id", "t-new2".into())]),
        ops(["q/main+t-new2"])
    );
}

/// `TicketsACL` with `channelId` and `isMember: true`: the ticket shows
/// while its channel is in the workspace and the caller is a participant.
/// Three tables chained by RIGHT edges; dropping the participant row
/// cascades up through the channel to the ticket.
#[test]
fn tickets_acl_member_channel_chain() {
    let mut w = World::new();
    w.seed(
        "channels",
        &[("id", "c1".into()), ("visibility", "PRIVATE".into())],
    );
    w.seed(
        "channel_participants",
        &[
            ("id", "p1".into()),
            ("channelId", "c1".into()),
            ("userId", ME.into()),
        ],
    );
    w.seed(
        "tickets",
        &[("id", "t1".into()), ("channelId", "c1".into())],
    );
    w.seed(
        "tickets",
        &[("id", "t2".into()), ("channelId", "c2".into())],
    );
    let scoped = zql("tickets")
        .eq("channelId", "c1")
        .where_exists("channel", |ch| {
            ch.eq("id", "c1")
                .eq("workspaceId", WS)
                .where_exists("participants", |p| p.eq("userId", ME).eq("channelId", "c1"))
        });
    assert_eq!(
        w.subscribe("q", &scoped),
        ops([
            "q/main+t1",
            "q/has:channel+c1",
            "q/has:channel.has:participants+p1"
        ])
    );
    assert_eq!(
        w.delete("channel_participants", "p1"),
        ops([
            "q/main-t1",
            "q/has:channel-c1",
            "q/has:channel.has:participants-p1"
        ])
    );
    assert_eq!(
        w.insert(
            "channel_participants",
            &[
                ("id", "p2".into()),
                ("channelId", "c1".into()),
                ("userId", ME.into())
            ]
        ),
        ops([
            "q/main+t1",
            "q/has:channel+c1",
            "q/has:channel.has:participants+p2"
        ])
    );
}

/// `TicketsACL` with `channelId` and `isMember: false`: the channel must be
/// public; making it private removes every ticket of it.
#[test]
fn tickets_acl_public_channel() {
    let mut w = World::new();
    w.seed(
        "channels",
        &[("id", "c1".into()), ("visibility", "PUBLIC".into())],
    );
    w.seed(
        "tickets",
        &[("id", "t1".into()), ("channelId", "c1".into())],
    );
    let scoped = zql("tickets")
        .eq("channelId", "c1")
        .where_exists("channel", |ch| {
            ch.eq("id", "c1")
                .eq("workspaceId", WS)
                .eq("visibility", "PUBLIC")
        });
    assert_eq!(
        w.subscribe("q", &scoped),
        ops(["q/main+t1", "q/has:channel+c1"])
    );
    assert_eq!(
        w.update(
            "channels",
            &[("id", "c1".into()), ("visibility", "PRIVATE".into())]
        ),
        ops(["q/main-t1", "q/has:channel-c1"])
    );
}

/// `MessagesACL` with a `channelId`: the visibility rule (`visibleTo IS
/// NULL OR visibleTo = me`) and the conversation to channel to participant
/// chain, four tables deep.
#[test]
fn messages_acl_visible_to_and_channel_chain() {
    let mut w = World::new();
    w.seed("channels", &[("id", "c1".into())]);
    w.seed(
        "channel_participants",
        &[
            ("id", "p1".into()),
            ("channelId", "c1".into()),
            ("userId", ME.into()),
        ],
    );
    w.seed(
        "conversations",
        &[("conversationId", "cv1".into()), ("channelId", "c1".into())],
    );
    w.seed(
        "messages",
        &[("messageId", "m0".into()), ("conversationId", "cv1".into())],
    );
    w.seed(
        "messages",
        &[
            ("messageId", "m1".into()),
            ("conversationId", "cv1".into()),
            ("visibleTo", ME.into()),
        ],
    );
    w.seed(
        "messages",
        &[
            ("messageId", "m2".into()),
            ("conversationId", "cv1".into()),
            ("visibleTo", "u-2".into()),
        ],
    );
    let scoped = zql("messages")
        .eq("conversationId", "cv1")
        .filter(or(vec![is_null("visibleTo"), eq("visibleTo", ME)]))
        .where_exists("conversation", |c| {
            c.eq("channelId", "c1").where_exists("channel", |ch| {
                ch.eq("id", "c1")
                    .eq("workspaceId", WS)
                    .where_exists("participants", |p| p.eq("userId", ME).eq("channelId", "c1"))
            })
        });
    assert_eq!(
        w.subscribe("q", &scoped),
        ops([
            "q/main+m0",
            "q/main+m1",
            "q/has:conversation+cv1",
            "q/has:conversation.has:channel+c1",
            "q/has:conversation.has:channel.has:participants+p1"
        ])
    );
    assert_eq!(
        w.delete("channel_participants", "p1"),
        ops([
            "q/main-m0",
            "q/main-m1",
            "q/has:conversation-cv1",
            "q/has:conversation.has:channel-c1",
            "q/has:conversation.has:channel.has:participants-p1"
        ])
    );
}

/// `ActivitiesACL` scopes to the caller; `ChannelsACL` for an admin is the
/// workspace alone; `CanvasesACL` requires the creator to be in the
/// workspace.
#[test]
fn user_admin_and_creator_scopes() {
    let mut w = World::new();
    w.seed("activities", &[("id", "a1".into()), ("userId", ME.into())]);
    w.seed(
        "activities",
        &[("id", "a2".into()), ("userId", "u-2".into())],
    );
    assert_eq!(
        w.subscribe("mine", &zql("activities").eq("userId", ME)),
        ops(["mine/main+a1"])
    );

    w.seed(
        "channels",
        &[("id", "c1".into()), ("visibility", "PRIVATE".into())],
    );
    assert_eq!(
        w.subscribe("admin", &zql("channels")),
        ops(["admin/main+c1"])
    );

    w.seed("users", &[("id", "u-in".into())]);
    w.seed(
        "users",
        &[("id", "u-out".into()), ("workspaceId", "ws-2".into())],
    );
    w.seed(
        "canvases",
        &[("id", "k1".into()), ("createdBy", "u-in".into())],
    );
    w.seed(
        "canvases",
        &[("id", "k2".into()), ("createdBy", "u-out".into())],
    );
    let canvases = zql("canvases").where_exists("createdByUser", |u| u.eq("workspaceId", WS));
    assert_eq!(
        w.subscribe("canvas", &canvases),
        ops(["canvas/main+k1", "canvas/has:createdByUser+u-in"])
    );
    assert_eq!(w.rows("canvas", "main"), 1);
}
