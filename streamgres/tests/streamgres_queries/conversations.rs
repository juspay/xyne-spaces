//! The chat queries: channel conversation lists and pages, thread and
//! message loads, attachments, pins, latest messages, DM lists, nudges,
//! drafts and scheduled messages, one test per registry entry over one
//! channel fixture. The message visibility rule `visibleTo IS NULL OR
//! visibleTo = me` runs through nearly all of them, so the everyone-visible
//! messages (`m1`, `m5`) arrive beside the caller's own wherever it
//! applies.

use streamgres::model::ComparisonOperator::{GT, LTE};
use streamgres::model::Order::{ASC, DESC};
use streamgres::model::Value;

use super::world::{ME, WS, World, ops, with};
use super::zql::{Q, eq, is_not_null, is_null, or, same, zql};

/// A full row image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// Conversation `cv1`: the pinned root thread of `c1`, opened by the
/// caller, on ticket `t1`, with two replies.
fn cv1() -> Row {
    row!["conversationId" => "cv1", "channelId" => "c1", "initialMessageId" => "m1", "createdBy" => ME,
         "createdAt" => 100, "lastActivityAt" => 150, "replyCount" => 2, "pinned" => true, "ticketId" => "t1"]
    .to_vec()
}

/// Conversation `cv2`: a thread under `m1` in `c1`, tied to call `call1`.
fn cv2() -> Row {
    row!["conversationId" => "cv2", "channelId" => "c1", "initialMessageId" => "m2", "parentMessageId" => "m1",
         "createdBy" => "u-2", "createdAt" => 200, "lastActivityAt" => 210, "replyCount" => 0, "pinned" => false,
         "callId" => "call1"]
    .to_vec()
}

/// Message `m1`: `cv1`'s opener by the caller, visible to everyone.
fn m1() -> Row {
    row!["messageId" => "m1", "conversationId" => "cv1", "senderId" => ME, "createdAt" => 100, "showInChannel" => true,
         "isDeleted" => false, "content" => "hello"]
    .to_vec()
}

/// Message `m4`: the caller's reply in `cv1`, visible to the caller only.
fn m4() -> Row {
    row!["messageId" => "m4", "conversationId" => "cv1", "senderId" => ME, "visibleTo" => ME, "createdAt" => 110,
         "showInChannel" => false, "isDeleted" => false, "content" => "note to self"]
    .to_vec()
}

/// Nudge `sn2`: a dismissed nudge on `m2`, visible to the caller.
fn sn2() -> Row {
    row!["id" => "sn2", "sourceId" => "m2", "state" => "DISMISSED", "visibleTo" => ME, "surfaceNudgeCountId" => "nc1",
         "createdAt" => 2]
    .to_vec()
}

/// Participant `pp3`: the caller in `cv2`, subscribed, never replied.
fn pp3() -> Row {
    row!["id" => "pp3", "conversationId" => "cv2", "userId" => ME, "participationType" => "PARTICIPANT",
         "joinedAt" => 3, "isSubscribed" => true]
    .to_vec()
}

/// Channel status `cus1`: the caller's open status on `c1`.
fn cus1() -> Row {
    row!["id" => "cus1", "channelId" => "c1", "userId" => ME, "isClosed" => false, "isDeleted" => false].to_vec()
}

/// The channel: `c1` (with the caller as participant) and `c2`; `cv1`
/// and `cv2` in `c1`, `cv3` in `c2`; messages `m1` (everyone), `m2` (the
/// caller), `m3` (someone else), `m4` (the caller, hidden from the
/// channel), `m5` (everyone, a reply); a reaction, a reaction count, an
/// attachment and three nudge counts on `m2`; attachments on a ticket, an
/// impact and two form values; conversation participants; ticket `t1`;
/// call `call1`.
fn seed_channel(w: &mut World) {
    w.seed("channels", row!["id" => "c1", "type" => "DEFAULT", "visibility" => "PUBLIC", "scopeType" => "DEFAULT", "name" => "general"]);
    w.seed("channels", row!["id" => "c2", "type" => "DEFAULT", "visibility" => "PRIVATE", "scopeType" => "DEFAULT", "name" => "ops"]);
    w.seed(
        "channel_participants",
        row!["id" => "cp1", "channelId" => "c1", "userId" => ME, "role" => "MEMBER"],
    );
    w.seed("conversations", &cv1());
    w.seed("conversations", &cv2());
    w.seed("conversations", row!["conversationId" => "cv3", "channelId" => "c2", "initialMessageId" => "m3", "createdAt" => 300]);
    w.seed("messages", &m1());
    w.seed("messages", row!["messageId" => "m2", "conversationId" => "cv2", "senderId" => "u-2", "visibleTo" => ME, "createdAt" => 200, "showInChannel" => true, "isDeleted" => false]);
    w.seed("messages", row!["messageId" => "m3", "conversationId" => "cv3", "senderId" => "u-3", "visibleTo" => "u-3", "createdAt" => 300, "showInChannel" => true]);
    w.seed("messages", &m4());
    w.seed("messages", row!["messageId" => "m5", "conversationId" => "cv1", "senderId" => "u-2", "createdAt" => 120, "showInChannel" => true, "isDeleted" => false]);
    w.seed(
        "reactions",
        row!["reactionId" => "rx1", "messageId" => "m2", "userId" => ME, "emojiName" => "+1"],
    );
    w.seed(
        "reaction_counts",
        row!["countId" => "rcnt1", "messageId" => "m2", "emojiName" => "+1", "count" => 1],
    );
    w.seed("message_attachments", row!["id" => "ma1", "entityId" => "m2", "entityType" => "CHAT", "conversationId" => "cv2", "createdAt" => 200]);
    w.seed(
        "message_attachments",
        row!["id" => "ma-t", "entityId" => "t1", "entityType" => "TICKET", "createdAt" => 1],
    );
    w.seed(
        "message_attachments",
        row!["id" => "ma-i", "entityId" => "imp1", "entityType" => "IMPACT", "createdAt" => 1],
    );
    w.seed("message_attachments", row!["id" => "fa1", "entityId" => "fev1", "entityType" => "FORM_ENTITY_VALUE", "isDeleted" => false]);
    w.seed("message_attachments", row!["id" => "fa2", "entityId" => "fev2", "entityType" => "FORM_ENTITY_VALUE", "isDeleted" => true]);
    w.seed(
        "surface_nudge_counts",
        row!["id" => "nc1", "messageId" => "m2", "userId" => ME, "nudgeCount" => 1],
    );
    w.seed("surface_nudge_counts", row!["id" => "nc2", "messageId" => "m2", "userId" => "u-2", "channelId" => "c1", "nudgeCount" => 2]);
    w.seed(
        "surface_nudge_counts",
        row!["id" => "nc3", "messageId" => "m2", "userId" => "u-2", "nudgeCount" => 3],
    );
    w.seed("conversation_participants", row!["id" => "pp1", "conversationId" => "cv1", "userId" => ME, "participationType" => "AUTHOR", "joinedAt" => 1, "isSubscribed" => true, "lastReplyAt" => 150]);
    w.seed("conversation_participants", row!["id" => "pp2", "conversationId" => "cv1", "userId" => "u-2", "participationType" => "PARTICIPANT", "joinedAt" => 2, "isSubscribed" => true, "lastReplyAt" => 160]);
    w.seed("conversation_participants", &pp3());
    w.seed(
        "tickets",
        row!["id" => "t1", "title" => "Login bug", "conversationId" => "cv1"],
    );
    w.seed("calls", row!["id" => "call1", "externalId" => "call1", "title" => "Standup", "status" => "ACTIVE", "callType" => "DEFAULT"]);
}

/// The DM side: `c-dm` with its stats row and two conversations, one
/// opened by a message the caller can see; `c1`'s stats row too.
fn seed_dm(w: &mut World) {
    w.seed(
        "channels",
        row!["id" => "c-dm", "type" => "DEFAULT", "scopeType" => "DM", "visibility" => "PRIVATE"],
    );
    w.seed(
        "channel_stats",
        row!["channelId" => "c-dm", "lastActivityAt" => 10],
    );
    w.seed(
        "channel_stats",
        row!["channelId" => "c1", "lastActivityAt" => 20],
    );
    w.seed("conversations", row!["conversationId" => "cvdm1", "channelId" => "c-dm", "initialMessageId" => "mdm1", "createdAt" => 1]);
    w.seed("conversations", row!["conversationId" => "cvdm2", "channelId" => "c-dm", "initialMessageId" => "mdm2", "createdAt" => 2]);
    w.seed("messages", row!["messageId" => "mdm1", "conversationId" => "cvdm1", "visibleTo" => ME, "createdAt" => 1]);
    w.seed("messages", row!["messageId" => "mdm2", "conversationId" => "cvdm2", "visibleTo" => "u-2", "createdAt" => 2]);
}

/// The message visibility rule: `visibleTo IS NULL OR visibleTo = me`.
fn visible_to_me(query: Q) -> Q {
    query.filter(or(vec![is_null("visibleTo"), eq("visibleTo", ME)]))
}

/// The nudge-count rule of the message queries: the caller's counts or
/// any channel's.
fn nudge_counts_mine_or_channel(query: Q) -> Q {
    query.filter(or(vec![eq("userId", ME), is_not_null("channelId")]))
}

/// The channel-access rule: public, or a channel the caller participates
/// in, the existence test inside the `OR`.
fn channel_public_or_mine(channel: Q) -> Q {
    let mut channel = channel;
    let member = channel.exists("participants", |p| p.eq("userId", ME));
    channel.filter(or(vec![eq("visibility", "PUBLIC"), member]))
}

/// The nudge-count filter of the channel queries: the caller's counts or
/// the channel's.
fn nudge_counts_for(channel: &'static str) -> impl Fn(Q) -> Q {
    move |n| n.filter(or(vec![eq("userId", ME), eq("channelId", channel)]))
}

/// `channelConversations`: a channel's threads with their visible opener
/// (reactions, counts, attachments, nudge counts), parent message,
/// authors and ticket; hiding the everyone-visible `m1` from the caller
/// removes it as opener and as parent.
#[test]
fn channel_conversations() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .order_by("createdAt", ASC)
        .related("initialMessage", |m| {
            visible_to_me(m)
                .related("reactions", same)
                .related("reactionCounts", same)
                .related("attachments", same)
                .related("nudgeCounts", nudge_counts_for("c1"))
        })
        .related("parentMessage", visible_to_me)
        .related("participants", |p| {
            p.eq("participationType", "AUTHOR")
                .order_by("joinedAt", ASC)
        })
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/main+cv2",
            "q/initialMessage+m1",
            "q/initialMessage+m2",
            "q/initialMessage.reactions+rx1",
            "q/initialMessage.reactionCounts+rcnt1",
            "q/initialMessage.attachments+ma1",
            "q/initialMessage.nudgeCounts+nc1",
            "q/initialMessage.nudgeCounts+nc2",
            "q/parentMessage+m1",
            "q/participants+pp1",
            "q/ticket+t1"
        ])
    );
    assert_eq!(
        w.update("messages", &with(&m1(), row!["visibleTo" => "u-2"])),
        ops(["q/initialMessage-m1", "q/parentMessage-m1"])
    );
}

/// `channelConversationsV2`: openers with attachments only; a new thread
/// arrives before its opener does.
#[test]
fn channel_conversations_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .order_by("createdAt", ASC)
        .related("initialMessage", |m| {
            visible_to_me(m).related("attachments", same)
        })
        .related("parentMessage", visible_to_me)
        .related("participants", |p| {
            p.eq("participationType", "AUTHOR")
                .order_by("joinedAt", ASC)
        })
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/main+cv2",
            "q/initialMessage+m1",
            "q/initialMessage+m2",
            "q/initialMessage.attachments+ma1",
            "q/parentMessage+m1",
            "q/participants+pp1",
            "q/ticket+t1"
        ])
    );
    assert_eq!(
        w.insert("conversations", row!["conversationId" => "cv5", "channelId" => "c1", "initialMessageId" => "m9", "createdAt" => 400]),
        ops(["q/main+cv5"])
    );
    assert_eq!(
        w.insert("messages", row!["messageId" => "m9", "conversationId" => "cv5", "visibleTo" => ME, "createdAt" => 400]),
        ops(["q/initialMessage+m9"])
    );
}

/// `conversationMessages`: a thread's visible messages with reactions,
/// counts, attachments and nudge counts (the caller's or any channel's).
#[test]
fn conversation_messages() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = visible_to_me(zql("messages").eq("conversationId", "cv1"))
        .order_by("createdAt", ASC)
        .related("attachments", same)
        .related("reactionCounts", same)
        .related("reactions", same)
        .related("nudgeCounts", nudge_counts_mine_or_channel);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+m1", "q/main+m4", "q/main+m5"])
    );
    assert_eq!(
        w.insert("messages", row!["messageId" => "m6", "conversationId" => "cv1", "visibleTo" => ME, "createdAt" => 130]),
        ops(["q/main+m6"])
    );
}

/// `conversationMessagesV2`: attachments and nudge counts only.
#[test]
fn conversation_messages_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = visible_to_me(zql("messages").eq("conversationId", "cv1"))
        .order_by("createdAt", ASC)
        .related("attachments", same)
        .related("nudgeCounts", nudge_counts_mine_or_channel);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+m1", "q/main+m4", "q/main+m5"])
    );
    assert_eq!(w.delete("messages", "m4"), ops(["q/main-m4"]));
}

/// `messagesByIds`: a literal id list under the visibility rule; hiding
/// one from the caller removes it.
#[test]
fn messages_by_ids() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = visible_to_me(zql("messages").in_("messageId", &["m1", "m2", "m4"]));
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+m1", "q/main+m2", "q/main+m4"])
    );
    assert_eq!(
        w.update("messages", &with(&m1(), row!["visibleTo" => "u-2"])),
        ops(["q/main-m1"])
    );
}

/// `getConversationById`: one thread with opener, parent, every
/// participant and ticket; hiding the opener from the caller removes it.
#[test]
fn get_conversation_by_id() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("conversationId", "cv1")
        .related("initialMessage", visible_to_me)
        .related("parentMessage", visible_to_me)
        .related("participants", same)
        .related("ticket", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/initialMessage+m1",
            "q/participants+pp1",
            "q/participants+pp2",
            "q/ticket+t1"
        ])
    );
    assert_eq!(
        w.update("messages", &with(&m1(), row!["visibleTo" => "u-2"])),
        ops(["q/initialMessage-m1"])
    );
}

/// `getConversationByIdWithChannel`: the same with the channel known.
#[test]
fn get_conversation_by_id_with_channel() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("conversationId", "cv1")
        .related("initialMessage", visible_to_me)
        .related("parentMessage", visible_to_me)
        .related("participants", same)
        .related("ticket", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/initialMessage+m1",
            "q/participants+pp1",
            "q/participants+pp2",
            "q/ticket+t1"
        ])
    );
    assert_eq!(
        w.insert("conversation_participants", row!["id" => "pp4", "conversationId" => "cv1", "userId" => "u-4", "participationType" => "PARTICIPANT", "joinedAt" => 4]),
        ops(["q/participants+pp4"])
    );
}

/// `threadConversation`: the thread panel in one query: ticket, call, the
/// caller's participation and the visible messages with attachments and
/// nudge counts.
#[test]
fn thread_conversation() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("conversationId", "cv1")
        .related("ticket", same)
        .related("call", same)
        .related("participants", |p| p.eq("userId", ME).one())
        .related("messages", |m| {
            visible_to_me(m)
                .order_by("createdAt", ASC)
                .related("attachments", same)
                .related("nudgeCounts", nudge_counts_mine_or_channel)
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/ticket+t1",
            "q/participants+pp1",
            "q/messages+m1",
            "q/messages+m4",
            "q/messages+m5"
        ])
    );
    assert_eq!(
        w.update("conversations", &with(&cv1(), row!["callId" => "call1"])),
        ops(["q/main+cv1", "q/call+call1"])
    );
}

/// `threadConversationV2`: participation and messages only.
#[test]
fn thread_conversation_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("conversationId", "cv1")
        .related("participants", |p| p.eq("userId", ME).one())
        .related("messages", |m| {
            visible_to_me(m)
                .order_by("createdAt", ASC)
                .related("attachments", same)
                .related("nudgeCounts", nudge_counts_mine_or_channel)
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/participants+pp1",
            "q/messages+m1",
            "q/messages+m4",
            "q/messages+m5"
        ])
    );
    assert_eq!(
        w.insert("messages", row!["messageId" => "m7", "conversationId" => "cv1", "visibleTo" => ME, "createdAt" => 140]),
        ops(["q/messages+m7"])
    );
}

/// `conversationParticipantByConversationId`: the caller's row in a
/// thread.
#[test]
fn conversation_participant_by_conversation_id() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversation_participants")
        .eq("conversationId", "cv1")
        .eq("userId", ME)
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+pp1"]));
    assert_eq!(
        w.delete("conversation_participants", "pp1"),
        ops(["q/main-pp1"])
    );
}

/// `getConversationByCallId`: the thread of a call with its visible
/// opener.
#[test]
fn get_conversation_by_call_id() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("callId", "call1")
        .related("initialMessage", visible_to_me)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+cv2", "q/initialMessage+m2"])
    );
    assert_eq!(
        w.update(
            "conversations",
            &with(&cv2(), row!["callId" => Value::Null])
        ),
        ops(["q/main-cv2", "q/initialMessage-m2"])
    );
}

/// `getConversationByTimestamp`: the newest thread at or before a time,
/// ties broken by id; a newer thread replaces it.
#[test]
fn get_conversation_by_timestamp() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .where_("createdAt", LTE, 250)
        .order_by("createdAt", DESC)
        .order_by("conversationId", DESC)
        .limit(1)
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cv2"]));
    assert_eq!(
        w.insert(
            "conversations",
            row!["conversationId" => "cv6", "channelId" => "c1", "createdAt" => 220]
        ),
        ops(["q/main+cv6", "q/main-cv2"])
    );
}

/// `userConversationsPaginated`: threads with replies the caller takes
/// part in, by activity; the participation rows ship under their threads.
#[test]
fn user_conversations_paginated() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .where_("replyCount", GT, 0)
        .where_exists("participants", |p| p.eq("userId", ME))
        .order_by("lastActivityAt", DESC)
        .start(&[("lastActivityAt", DESC, 500.into())], false)
        .limit(10);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/has:participants+pp1", "q/main+cv1"])
    );
    assert_eq!(
        w.update("conversations", &with(&cv2(), row!["replyCount" => 1])),
        ops(["q/has:participants+pp3", "q/main+cv2"])
    );
}

/// `userConversationsPaginatedV2`: the caller's subscribed participations
/// by last reply (`lastReplyAt IS NOT NULL`).
#[test]
fn user_conversations_paginated_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversation_participants")
        .eq("userId", ME)
        .eq("isSubscribed", true)
        .where_is_not_null("lastReplyAt")
        .order_by("lastReplyAt", DESC)
        .order_by("id", DESC)
        .start(&[("lastReplyAt", DESC, 500.into())], false)
        .limit(10);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+pp1"]));
    assert_eq!(
        w.update(
            "conversation_participants",
            &with(&pp3(), row!["lastReplyAt" => 170])
        ),
        ops(["q/main+pp3"])
    );
}

/// `channelAndThreadMessages`: every message shown in a channel, through
/// an existence test on its conversation, with the conversation's visible
/// opener, reactions, counts, attachments and nudge counts.
#[test]
fn channel_and_thread_messages() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("messages")
        .eq("showInChannel", true)
        .where_exists("conversation", |c| c.eq("channelId", "c1"))
        .order_by("createdAt", ASC)
        .related("conversation", |c| {
            c.related("initialMessage", visible_to_me)
        })
        .related("reactionCounts", same)
        .related("reactions", same)
        .related("attachments", same)
        .related("nudgeCounts", nudge_counts_for("c1"));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+m1",
            "q/main+m2",
            "q/main+m5",
            "q/has:conversation+cv1",
            "q/has:conversation+cv2",
            "q/conversation+cv1",
            "q/conversation+cv2",
            "q/conversation.initialMessage+m2",
            "q/reactionCounts+rcnt1",
            "q/reactions+rx1",
            "q/attachments+ma1",
            "q/nudgeCounts+nc1",
            "q/nudgeCounts+nc2",
            "q/conversation.initialMessage+m1"
        ])
    );
    assert_eq!(
        w.update("messages", &with(&m4(), row!["showInChannel" => true])),
        ops(["q/main+m4"])
    );
}

/// `channelAndThreadMessagesV2`: attachments and nudge counts only.
#[test]
fn channel_and_thread_messages_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("messages")
        .eq("showInChannel", true)
        .where_exists("conversation", |c| c.eq("channelId", "c1"))
        .order_by("createdAt", ASC)
        .related("conversation", |c| {
            c.related("initialMessage", visible_to_me)
        })
        .related("attachments", same)
        .related("nudgeCounts", nudge_counts_for("c1"));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+m1",
            "q/main+m2",
            "q/main+m5",
            "q/has:conversation+cv1",
            "q/has:conversation+cv2",
            "q/conversation+cv1",
            "q/conversation+cv2",
            "q/conversation.initialMessage+m2",
            "q/attachments+ma1",
            "q/nudgeCounts+nc1",
            "q/nudgeCounts+nc2",
            "q/conversation.initialMessage+m1"
        ])
    );
    assert_eq!(w.delete("messages", "m5"), ops(["q/main-m5"]));
}

/// `attachmentsByInitialMessage`: a message's chat attachments.
#[test]
fn attachments_by_initial_message() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("message_attachments")
        .eq("entityId", "m2")
        .eq("entityType", "CHAT")
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ma1"]));
    assert_eq!(
        w.insert(
            "message_attachments",
            row!["id" => "ma6", "entityId" => "m2", "entityType" => "CHAT", "createdAt" => 201]
        ),
        ops(["q/main+ma6"])
    );
}

/// `attachmentsByTicket`: a ticket's attachments.
#[test]
fn attachments_by_ticket() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("message_attachments")
        .eq("entityId", "t1")
        .eq("entityType", "TICKET")
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ma-t"]));
    assert_eq!(
        w.delete("message_attachments", "ma-t"),
        ops(["q/main-ma-t"])
    );
}

/// `attachmentsByImpact`: an impact's attachments.
#[test]
fn attachments_by_impact() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("message_attachments")
        .eq("entityId", "imp1")
        .eq("entityType", "IMPACT")
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ma-i"]));
}

/// `attachmentsByImpactIds`: several impacts as an `OR` of equalities; the
/// empty-list guard matches nothing.
#[test]
fn attachments_by_impact_ids() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("message_attachments")
        .eq("entityType", "IMPACT")
        .filter(or(vec![eq("entityId", "imp1"), eq("entityId", "imp2")]))
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ma-i"]));
    assert_eq!(
        w.subscribe("none", &zql("message_attachments").eq("id", "__none__")),
        ops([])
    );
    assert_eq!(
        w.insert(
            "message_attachments",
            row!["id" => "ma-i2", "entityId" => "imp2", "entityType" => "IMPACT", "createdAt" => 2]
        ),
        ops(["q/main+ma-i2"])
    );
}

/// `attachmentsByIds`: live form-value attachments by id; undeleting one
/// brings it back.
#[test]
fn attachments_by_ids() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("message_attachments")
        .eq("entityType", "FORM_ENTITY_VALUE")
        .eq("isDeleted", false)
        .filter(or(vec![eq("id", "fa1"), eq("id", "fa2")]));
    assert_eq!(w.subscribe("q", &q), ops(["q/main+fa1"]));
    assert_eq!(
        w.update("message_attachments", row!["id" => "fa2", "entityId" => "fev2", "entityType" => "FORM_ENTITY_VALUE", "isDeleted" => false]),
        ops(["q/main+fa2"])
    );
}

/// `channelConversationsPaginated`: a page of threads at or before a
/// creation cursor with the full opener tree, parent, authors or the
/// caller among the participants, and ticket; deleting a thread removes
/// its whole subtree.
#[test]
fn channel_conversations_paginated() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .related("initialMessage", |m| {
            visible_to_me(m)
                .related("reactions", same)
                .related("reactionCounts", same)
                .related("attachments", same)
                .related("nudgeCounts", nudge_counts_for("c1"))
        })
        .related("parentMessage", visible_to_me)
        .related("participants", |p| {
            p.filter(or(vec![
                eq("participationType", "AUTHOR"),
                eq("userId", ME),
            ]))
            .order_by("joinedAt", ASC)
        })
        .related("ticket", same)
        .order_by("createdAt", DESC)
        .start(&[("createdAt", DESC, 250.into())], true)
        .limit(10);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/main+cv2",
            "q/initialMessage+m2",
            "q/initialMessage.reactions+rx1",
            "q/initialMessage.reactionCounts+rcnt1",
            "q/initialMessage.attachments+ma1",
            "q/initialMessage.nudgeCounts+nc1",
            "q/initialMessage.nudgeCounts+nc2",
            "q/participants+pp1",
            "q/participants+pp3",
            "q/ticket+t1",
            "q/initialMessage+m1",
            "q/parentMessage+m1"
        ])
    );
    assert_eq!(
        w.delete("conversations", "cv2"),
        ops([
            "q/main-cv2",
            "q/initialMessage-m2",
            "q/initialMessage.reactions-rx1",
            "q/initialMessage.reactionCounts-rcnt1",
            "q/initialMessage.attachments-ma1",
            "q/initialMessage.nudgeCounts-nc1",
            "q/initialMessage.nudgeCounts-nc2",
            "q/participants-pp3",
            "q/parentMessage-m1"
        ])
    );
}

/// `channelConversationsPaginatedV2`: openers with attachments and nudge
/// counts, parents.
#[test]
fn channel_conversations_paginated_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .related("initialMessage", |m| {
            visible_to_me(m)
                .related("attachments", same)
                .related("nudgeCounts", nudge_counts_for("c1"))
        })
        .related("parentMessage", visible_to_me)
        .order_by("createdAt", DESC)
        .start(&[("createdAt", DESC, 250.into())], true)
        .limit(10);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/main+cv2",
            "q/initialMessage+m2",
            "q/initialMessage.attachments+ma1",
            "q/initialMessage.nudgeCounts+nc1",
            "q/initialMessage.nudgeCounts+nc2",
            "q/initialMessage+m1",
            "q/parentMessage+m1"
        ])
    );
    assert_eq!(
        w.insert(
            "surface_nudge_counts",
            row!["id" => "nc4", "messageId" => "m2", "userId" => ME, "nudgeCount" => 1]
        ),
        ops(["q/initialMessage.nudgeCounts+nc4"])
    );
}

/// `channelConversationsPaginatedV3`: the opener's attachments and nudge
/// counts reached straight from the conversation, an id list given.
#[test]
fn channel_conversations_paginated_v3() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .related("initialMessageAttachments", same)
        .related("initialMessageNudgeCounts", nudge_counts_for("c1"))
        .in_("conversationId", &["cv2"])
        .order_by("createdAt", DESC)
        .start(&[("createdAt", DESC, 250.into())], true)
        .limit(10);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv2",
            "q/initialMessageAttachments+ma1",
            "q/initialMessageNudgeCounts+nc1",
            "q/initialMessageNudgeCounts+nc2"
        ])
    );
    assert_eq!(
        w.delete("message_attachments", "ma1"),
        ops(["q/initialMessageAttachments-ma1"])
    );
}

/// `channelLatestMultipleConversations`: the newest threads of a channel
/// with the full opener tree, parent and ticket.
#[test]
fn channel_latest_multiple_conversations() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .related("initialMessage", |m| {
            visible_to_me(m)
                .related("reactions", same)
                .related("reactionCounts", same)
                .related("attachments", same)
                .related("nudgeCounts", nudge_counts_for("c1"))
        })
        .related("parentMessage", visible_to_me)
        .related("ticket", same)
        .order_by("createdAt", DESC)
        .limit(5);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/main+cv2",
            "q/initialMessage+m2",
            "q/initialMessage.reactions+rx1",
            "q/initialMessage.reactionCounts+rcnt1",
            "q/initialMessage.attachments+ma1",
            "q/initialMessage.nudgeCounts+nc1",
            "q/initialMessage.nudgeCounts+nc2",
            "q/ticket+t1",
            "q/initialMessage+m1",
            "q/parentMessage+m1"
        ])
    );
    assert_eq!(
        w.insert(
            "conversations",
            row!["conversationId" => "cv7", "channelId" => "c1", "createdAt" => 400]
        ),
        ops(["q/main+cv7"])
    );
}

/// `channelLatestMultipleConversationsV2`: openers with attachments and
/// nudge counts; pinning a thread is a replace pair.
#[test]
fn channel_latest_multiple_conversations_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .related("initialMessage", |m| {
            visible_to_me(m)
                .related("attachments", same)
                .related("nudgeCounts", nudge_counts_for("c1"))
        })
        .related("parentMessage", visible_to_me)
        .related("ticket", same)
        .order_by("createdAt", DESC)
        .limit(5);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/main+cv2",
            "q/initialMessage+m2",
            "q/initialMessage.attachments+ma1",
            "q/initialMessage.nudgeCounts+nc1",
            "q/initialMessage.nudgeCounts+nc2",
            "q/ticket+t1",
            "q/initialMessage+m1",
            "q/parentMessage+m1"
        ])
    );
    assert_eq!(
        w.update("conversations", &with(&cv2(), row!["pinned" => true])),
        ops(["q/main+cv2"])
    );
}

/// `channelLatestMultipleConversationsV3`: the opener's attachments and
/// nudge counts reached from the conversation, over an id list.
#[test]
fn channel_latest_multiple_conversations_v3() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .in_("conversationId", &["cv1", "cv2"])
        .related("initialMessageAttachments", same)
        .related("initialMessageNudgeCounts", nudge_counts_for("c1"))
        .order_by("createdAt", DESC)
        .limit(5);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/main+cv2",
            "q/initialMessageAttachments+ma1",
            "q/initialMessageNudgeCounts+nc1",
            "q/initialMessageNudgeCounts+nc2"
        ])
    );
    assert_eq!(
        w.delete("surface_nudge_counts", "nc2"),
        ops(["q/initialMessageNudgeCounts-nc2"])
    );
}

/// `channelLatestConversation`: the newest thread of a channel.
#[test]
fn channel_latest_conversation() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .order_by("createdAt", DESC)
        .order_by("conversationId", DESC)
        .limit(1)
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cv2"]));
}

/// `getConversationAttachements`: a channel's attachments through their
/// conversation, the channel itself public or one the caller is in (an
/// existence test inside the `OR`, nested two levels down).
#[test]
fn get_conversation_attachements() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("message_attachments")
        .where_exists("conversation", |c| {
            c.eq("channelId", "c1")
                .where_exists("channel", channel_public_or_mine)
        })
        .start(&[("createdAt", DESC, 500.into())], true)
        .order_by("createdAt", DESC)
        .limit(20);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/has:conversation+cv2",
            "q/has:conversation.has:channel+c1",
            "q/has:conversation.has:channel.has:participants+cp1",
            "q/main+ma1"
        ])
    );
}

/// `getConversationAttachementsV2`: the conversation test alone, channel
/// access left to the ACL.
#[test]
fn get_conversation_attachements_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("message_attachments")
        .where_exists("conversation", |c| c.eq("channelId", "c1"))
        .start(&[("createdAt", DESC, 500.into())], true)
        .order_by("createdAt", DESC)
        .limit(20);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/has:conversation+cv2", "q/main+ma1"])
    );
    assert_eq!(
        w.insert("message_attachments", row!["id" => "ma5", "entityId" => "m5", "entityType" => "CHAT", "conversationId" => "cv1", "createdAt" => 5]),
        ops(["q/has:conversation+cv1", "q/main+ma5"])
    );
}

/// `getPinnedMesseges`: a channel's pinned threads with the opener tree,
/// parent, ticket and authors; pinning another thread brings its opener
/// and the opener's relations.
#[test]
fn get_pinned_messeges() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .eq("pinned", true)
        .related("initialMessage", |m| {
            visible_to_me(m)
                .related("reactions", same)
                .related("reactionCounts", same)
                .related("attachments", same)
        })
        .related("parentMessage", visible_to_me)
        .related("ticket", same)
        .related("participants", |p| {
            p.eq("participationType", "AUTHOR")
                .order_by("joinedAt", ASC)
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/ticket+t1",
            "q/participants+pp1",
            "q/initialMessage+m1"
        ])
    );
    assert_eq!(
        w.update("conversations", &with(&cv2(), row!["pinned" => true])),
        ops([
            "q/main+cv2",
            "q/initialMessage+m2",
            "q/initialMessage.reactions+rx1",
            "q/initialMessage.reactionCounts+rcnt1",
            "q/initialMessage.attachments+ma1",
            "q/parentMessage+m1"
        ])
    );
}

/// `getPinnedMessegesV2`: openers with attachments; unpinning removes the
/// thread and its relations.
#[test]
fn get_pinned_messeges_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .eq("pinned", true)
        .related("initialMessage", |m| {
            visible_to_me(m).related("attachments", same)
        })
        .related("parentMessage", visible_to_me)
        .related("ticket", same)
        .related("participants", |p| {
            p.eq("participationType", "AUTHOR")
                .order_by("joinedAt", ASC)
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv1",
            "q/ticket+t1",
            "q/participants+pp1",
            "q/initialMessage+m1"
        ])
    );
    assert_eq!(
        w.update("conversations", &with(&cv1(), row!["pinned" => false])),
        ops([
            "q/main-cv1",
            "q/ticket-t1",
            "q/participants-pp1",
            "q/initialMessage-m1"
        ])
    );
}

/// `channelLatestMessage`: the newest thread with its opener's reactions,
/// counts and attachments.
#[test]
fn channel_latest_message() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .related("initialMessage", |m| {
            visible_to_me(m)
                .related("reactions", same)
                .related("reactionCounts", same)
                .related("attachments", same)
        })
        .order_by("createdAt", DESC)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv2",
            "q/initialMessage+m2",
            "q/initialMessage.reactions+rx1",
            "q/initialMessage.reactionCounts+rcnt1",
            "q/initialMessage.attachments+ma1"
        ])
    );
}

/// `channelLatestMessageV2`: the opener's attachments only.
#[test]
fn channel_latest_message_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("conversations")
        .eq("channelId", "c1")
        .related("initialMessage", |m| {
            visible_to_me(m).related("attachments", same)
        })
        .order_by("createdAt", DESC)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cv2",
            "q/initialMessage+m2",
            "q/initialMessage.attachments+ma1"
        ])
    );
    assert_eq!(w.delete("reactions", "rx1"), ops([]));
}

/// `dmChannelsLatestMessagesPaginated`: DM channels by activity through
/// their stats row, each with its newest conversation opened by a visible
/// message: an existence test under two LEFT edges, the inner one a window
/// per channel. A newer conversation becoming visible takes the window
/// from the older one, and its opener comes and goes with it.
#[test]
fn dm_channels_latest_messages_paginated() {
    let mut w = World::new();
    seed_channel(&mut w);
    seed_dm(&mut w);
    let q = zql("channel_stats")
        .where_exists("channel", |ch| {
            ch.filter(or(vec![eq("scopeType", "DM"), eq("scopeType", "GROUP_DM")]))
        })
        .order_by("lastActivityAt", DESC)
        .order_by("channelId", DESC)
        .start(&[("lastActivityAt", DESC, 500.into())], true)
        .limit(10)
        .related("channel", |ch| {
            ch.related("conversations", |c| {
                c.where_exists("initialMessage", visible_to_me)
                    .order_by("createdAt", DESC)
                    .limit(1)
            })
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/channel+c-dm",
            "q/channel.conversations+cvdm1",
            "q/channel.conversations.has:initialMessage+mdm1",
            "q/has:channel+c-dm",
            "q/main+c-dm"
        ])
    );
    assert_eq!(
        w.update("messages", row!["messageId" => "mdm2", "conversationId" => "cvdm2", "visibleTo" => ME, "createdAt" => 2]),
        ops([
            "q/channel.conversations+cvdm2",
            "q/channel.conversations-cvdm1",
            "q/channel.conversations.has:initialMessage+mdm2",
            "q/channel.conversations.has:initialMessage-mdm1"
        ])
    );
}

/// `conversationOfUserChannels`: the caller's open channels with their
/// latest threads; closing the channel removes them all. Gap O: the
/// per-channel `LIMIT 10` is not applied.
#[test]
fn conversation_of_user_channels() {
    let mut w = World::new();
    seed_channel(&mut w);
    w.seed("channel_user_status", &cus1());
    let q = zql("channels")
        .where_exists("participantsStatus", |p| {
            p.eq("isClosed", false)
                .eq("isDeleted", false)
                .eq("userId", ME)
        })
        .related("conversations", |c| c.order_by("createdAt", DESC).limit(10));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+c1",
            "q/has:participantsStatus+cus1",
            "q/conversations+cv1",
            "q/conversations+cv2"
        ])
    );
    assert_eq!(
        w.update(
            "channel_user_status",
            &with(&cus1(), row!["isClosed" => true])
        ),
        ops([
            "q/has:participantsStatus-cus1",
            "q/main-c1",
            "q/conversations-cv1",
            "q/conversations-cv2"
        ])
    );
}

/// `getMessageForActivity`: one message with conversation, reactions,
/// counts and attachments.
#[test]
fn get_message_for_activity() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("messages")
        .eq("messageId", "m2")
        .related("conversation", same)
        .related("reactions", same)
        .related("reactionCounts", same)
        .related("attachments", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+m2",
            "q/conversation+cv2",
            "q/reactions+rx1",
            "q/reactionCounts+rcnt1",
            "q/attachments+ma1"
        ])
    );
    assert_eq!(w.delete("reactions", "rx1"), ops(["q/reactions-rx1"]));
}

/// `getMessageForActivityV2`: conversation and attachments; a reaction is
/// nothing to this query.
#[test]
fn get_message_for_activity_v2() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("messages")
        .eq("messageId", "m2")
        .related("conversation", same)
        .related("attachments", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+m2", "q/conversation+cv2", "q/attachments+ma1"])
    );
    assert_eq!(w.delete("reactions", "rx1"), ops([]));
}

/// `userSentMessagesPaginated`: the caller's live messages, newest first,
/// with attachments and conversation.
#[test]
fn user_sent_messages_paginated() {
    let mut w = World::new();
    seed_channel(&mut w);
    let q = zql("messages")
        .eq("senderId", ME)
        .eq("isDeleted", false)
        .order_by("createdAt", DESC)
        .order_by("messageId", DESC)
        .start(&[("createdAt", DESC, 500.into())], false)
        .limit(10)
        .related("attachments", same)
        .related("conversation", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+m1", "q/main+m4", "q/conversation+cv1"])
    );
    assert_eq!(
        w.update("messages", &with(&m4(), row!["isDeleted" => true])),
        ops(["q/main-m4"])
    );
}

/// The caller's scheduled messages: one pending, one sent, the pending one
/// with an attachment; plus a draft with an attachment.
fn seed_scheduled(w: &mut World) {
    w.seed("delayed_messages", row!["id" => "dl1", "senderId" => ME, "status" => "PENDING", "scheduledFor" => 10, "channelId" => "c1"]);
    w.seed("delayed_messages", row!["id" => "dl2", "senderId" => ME, "status" => "SENT", "scheduledFor" => 20, "channelId" => "c1"]);
    w.seed("delayed_messages", row!["id" => "dl3", "senderId" => "u-2", "status" => "PENDING", "scheduledFor" => 30, "channelId" => "c1"]);
    w.seed(
        "message_attachments",
        row!["id" => "ma-dl", "entityId" => "dl1", "entityType" => "DELAYED_MESSAGE"],
    );
    w.seed(
        "draft_messages",
        row!["id" => "dm1", "userId" => ME, "channelId" => "c1", "content" => "wip"],
    );
    w.seed(
        "draft_messages",
        row!["id" => "dm2", "userId" => "u-2", "channelId" => "c1", "content" => "theirs"],
    );
    w.seed(
        "message_attachments",
        row!["id" => "ma-dm", "entityId" => "dm1", "entityType" => "DRAFT"],
    );
}

/// `userDelayedMessages`: the caller's pending scheduled messages with
/// attachments; sending one removes it and its attachment.
#[test]
fn user_delayed_messages() {
    let mut w = World::new();
    seed_scheduled(&mut w);
    let q = zql("delayed_messages")
        .eq("senderId", ME)
        .eq("status", "PENDING")
        .order_by("scheduledFor", ASC)
        .related("attachments", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+dl1", "q/attachments+ma-dl"])
    );
    assert_eq!(
        w.update("delayed_messages", row!["id" => "dl1", "senderId" => ME, "status" => "SENT", "scheduledFor" => 10, "channelId" => "c1"]),
        ops(["q/main-dl1", "q/attachments-ma-dl"])
    );
}

/// `userDelayedMessagesPaginated` over two statuses after a schedule
/// cursor.
#[test]
fn user_delayed_messages_paginated() {
    let mut w = World::new();
    seed_scheduled(&mut w);
    let q = zql("delayed_messages")
        .eq("senderId", ME)
        .order_by("scheduledFor", ASC)
        .order_by("id", ASC)
        .filter(or(vec![eq("status", "PENDING"), eq("status", "SENT")]))
        .start(&[("scheduledFor", ASC, 5.into())], false)
        .limit(10)
        .related("attachments", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+dl1", "q/main+dl2", "q/attachments+ma-dl"])
    );
    assert_eq!(
        w.insert("delayed_messages", row!["id" => "dl4", "senderId" => ME, "status" => "PENDING", "scheduledFor" => 40, "channelId" => "c1"]),
        ops(["q/main+dl4"])
    );
}

/// `userDrafts`: the caller's drafts with attachments.
#[test]
fn user_drafts() {
    let mut w = World::new();
    seed_scheduled(&mut w);
    let q = zql("draft_messages")
        .eq("userId", ME)
        .related("attachments", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+dm1", "q/attachments+ma-dm"])
    );
    assert_eq!(
        w.delete("draft_messages", "dm1"),
        ops(["q/main-dm1", "q/attachments-ma-dm"])
    );
}

/// Nudges on `m2`: an active one visible to the caller, a dismissed one,
/// and an active everyone-visible one.
fn seed_nudges(w: &mut World) {
    w.seed("surface_nudges", row!["id" => "sn1", "sourceId" => "m2", "state" => "ACTIVE", "visibleTo" => ME, "surfaceNudgeCountId" => "nc1", "createdAt" => 1]);
    w.seed("surface_nudges", &sn2());
    w.seed("surface_nudges", row!["id" => "sn3", "sourceId" => "m2", "state" => "ACTIVE", "surfaceNudgeCountId" => "nc1", "createdAt" => 3]);
}

/// `messageNudges`: a message's active nudges visible to the caller, the
/// message itself visible and in a reachable channel: three existence
/// tests deep, the channel public or one the caller is in.
#[test]
fn message_nudges() {
    let mut w = World::new();
    seed_channel(&mut w);
    seed_nudges(&mut w);
    let q = visible_to_me(
        zql("surface_nudges")
            .eq("sourceId", "m2")
            .eq("state", "ACTIVE"),
    )
    .where_exists("sourceMessage", |m| {
        visible_to_me(m).where_exists("conversation", |c| {
            c.where_exists("channel", channel_public_or_mine)
        })
    })
    .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/has:sourceMessage+m2",
            "q/has:sourceMessage.has:conversation+cv2",
            "q/has:sourceMessage.has:conversation.has:channel+c1",
            "q/has:sourceMessage.has:conversation.has:channel.has:participants+cp1",
            "q/main+sn1",
            "q/main+sn3"
        ])
    );
    assert_eq!(
        w.update("surface_nudges", &with(&sn2(), row!["state" => "ACTIVE"])),
        ops(["q/main+sn2"])
    );
}

/// `surfaceNudgesByCountRowIds`: active nudges of given count rows,
/// visible to the caller.
#[test]
fn surface_nudges_by_count_row_ids() {
    let mut w = World::new();
    seed_channel(&mut w);
    seed_nudges(&mut w);
    let q = visible_to_me(
        zql("surface_nudges")
            .filter(or(vec![eq("surfaceNudgeCountId", "nc1")]))
            .eq("state", "ACTIVE"),
    )
    .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+sn1", "q/main+sn3"]));
    assert_eq!(w.delete("surface_nudges", "sn1"), ops(["q/main-sn1"]));
}

/// `entityNudges` over two states.
#[test]
fn entity_nudges() {
    let mut w = World::new();
    seed_channel(&mut w);
    seed_nudges(&mut w);
    let q = visible_to_me(zql("surface_nudges").eq("sourceId", "m2"))
        .filter(or(vec![eq("state", "ACTIVE"), eq("state", "DISMISSED")]))
        .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+sn1", "q/main+sn2", "q/main+sn3"])
    );
    assert_eq!(
        w.update("surface_nudges", &with(&sn2(), row!["state" => "EXPIRED"])),
        ops(["q/main-sn2"])
    );
}

/// `activeSlashCommandArtifacts`: active artifacts in channels the caller
/// participates in; joining a channel surfaces its artifacts.
#[test]
fn active_slash_command_artifacts() {
    let mut w = World::new();
    seed_channel(&mut w);
    w.seed("message_artifacts", row!["id" => "ar1", "channelId" => "c1", "status" => "ACTIVE", "messageCreatedAt" => 1, "command" => "/deploy"]);
    w.seed("message_artifacts", row!["id" => "ar2", "channelId" => "c2", "status" => "ACTIVE", "messageCreatedAt" => 2, "command" => "/rollback"]);
    let q = zql("message_artifacts")
        .eq("workspaceId", WS)
        .eq("status", "ACTIVE")
        .where_exists("channelParticipants", |p| p.eq("userId", ME))
        .order_by("messageCreatedAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+ar1", "q/has:channelParticipants+cp1"])
    );
    assert_eq!(
        w.insert(
            "channel_participants",
            row!["id" => "cp2", "channelId" => "c2", "userId" => ME, "role" => "MEMBER"]
        ),
        ops(["q/has:channelParticipants+cp2", "q/main+ar2"])
    );
}
