//! The activity feed and recap queries, one test per registry entry. The
//! activity queries carry no user filter themselves; `ActivitiesACL` adds
//! `userId = ctx.userID`, which these tests include because without it
//! the set is plainly wrong.

use streamgres::model::ComparisonOperator::GT;
use streamgres::model::Order::DESC;
use streamgres::model::Value;

use super::world::{ME, World, ops, with};
use super::zql::{eq, is_null, or, same, zql};

/// A full row image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// Activity `ac1`: an unread mention of the caller by `u-2` on `m1`.
fn ac1() -> Row {
    row!["id" => "ac1", "userId" => ME, "actorAction" => "mention", "actionSource" => "message", "messageId" => "m1",
         "isRead" => false, "updatedAt" => 100, "classification" => "IMPORTANT", "actorId" => "u-2", "channelId" => "c1"]
    .to_vec()
}

/// Activity `ac3`: an unread missed call from a bot.
fn ac3() -> Row {
    row!["id" => "ac3", "userId" => ME, "actorAction" => "missed_call", "callId" => "k1", "isRead" => false,
         "updatedAt" => 300, "actorId" => "u-bot"]
    .to_vec()
}

/// Activity `ac4`: an unread ticket assignment by `u-2`.
fn ac4() -> Row {
    row!["id" => "ac4", "userId" => ME, "actorAction" => "ticket_assigned", "ticketId" => "t1", "isRead" => false,
         "updatedAt" => 400, "actorId" => "u-2"]
    .to_vec()
}

/// Conversation `cv1`: the thread of `m1`, with replies.
fn cv1() -> Row {
    row!["conversationId" => "cv1", "channelId" => "c1", "replyCount" => 3].to_vec()
}

/// The feed: five activities of the caller and one of `u-2`, the message,
/// conversation, reaction, count and attachment they point at, a canvas
/// with an artifact, a call, a ticket, a channel, two actors.
fn seed_feed(w: &mut World) {
    w.seed("activities", &ac1());
    w.seed("activities", row!["id" => "ac2", "userId" => ME, "actorAction" => "reaction", "reactionId" => "rx1", "isRead" => true, "updatedAt" => 200, "classification" => "FYI", "actorId" => "u-2"]);
    w.seed("activities", &ac3());
    w.seed("activities", &ac4());
    w.seed("activities", row!["id" => "ac5", "userId" => ME, "actorAction" => "canvas_comment", "canvasId" => "k1", "isRead" => false, "updatedAt" => 500, "classification" => "IMPORTANT", "actorId" => "u-2"]);
    w.seed("activities", row!["id" => "ac-other", "userId" => "u-2", "actorAction" => "mention", "isRead" => false, "updatedAt" => 600, "actorId" => ME]);
    w.seed(
        "messages",
        row!["messageId" => "m1", "conversationId" => "cv1", "content" => "@ani"],
    );
    w.seed("conversations", &cv1());
    w.seed(
        "reactions",
        row!["reactionId" => "rx1", "messageId" => "m1", "userId" => "u-2", "emojiName" => "eyes"],
    );
    w.seed(
        "reaction_counts",
        row!["countId" => "rct1", "messageId" => "m1", "emojiName" => "eyes", "count" => 1],
    );
    w.seed(
        "message_attachments",
        row!["id" => "mat1", "entityId" => "m1", "entityType" => "CHAT"],
    );
    w.seed("canvases", row!["id" => "k1", "title" => "Design"]);
    w.seed(
        "sdlc_artifacts",
        row!["artifactId" => "k1", "repoId" => "r1", "artifactType" => "DESIGN"],
    );
    w.seed(
        "calls",
        row!["id" => "k1", "title" => "Standup", "status" => "ENDED"],
    );
    w.seed("tickets", row!["id" => "t1", "title" => "Login bug"]);
    w.seed("channels", row!["id" => "c1", "name" => "general"]);
    w.seed(
        "users",
        row!["id" => ME, "name" => "Aniket", "userType" => "HUMAN"],
    );
    w.seed(
        "users",
        row!["id" => "u-2", "name" => "Meera", "userType" => "HUMAN"],
    );
    w.seed(
        "users",
        row!["id" => "u-bot", "name" => "Deploy bot", "userType" => "BOT"],
    );
}

/// `userActivities`: the caller's feed with message (and its
/// conversation, reactions, counts, attachments), reaction, canvas and
/// ticket; reading one is a replace pair.
#[test]
fn user_activities() {
    let mut w = World::new();
    seed_feed(&mut w);
    let q = zql("activities")
        .eq("userId", ME)
        .order_by("updatedAt", DESC)
        .related("message", |m| {
            m.related("conversation", same)
                .related("reactions", same)
                .related("reactionCounts", same)
                .related("attachments", same)
        })
        .related("reaction", same)
        .related("canvas", same)
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+ac1",
            "q/main+ac2",
            "q/main+ac3",
            "q/main+ac4",
            "q/main+ac5",
            "q/message+m1",
            "q/message.conversation+cv1",
            "q/message.reactions+rx1",
            "q/message.reactionCounts+rct1",
            "q/message.attachments+mat1",
            "q/reaction+rx1",
            "q/canvas+k1",
            "q/ticket+t1"
        ])
    );
    assert_eq!(
        w.update("activities", &with(&ac1(), row!["isRead" => true])),
        ops(["q/main+ac1"])
    );
}

/// `userActivitiesV2`: message with conversation and attachments,
/// reaction, canvas with artifact, call, ticket; removing the canvas
/// activity prunes canvas and artifact.
#[test]
fn user_activities_v2() {
    let mut w = World::new();
    seed_feed(&mut w);
    let q = zql("activities")
        .eq("userId", ME)
        .order_by("updatedAt", DESC)
        .related("message", |m| {
            m.related("conversation", same).related("attachments", same)
        })
        .related("reaction", same)
        .related("canvas", |c| c.related("sdlcArtifact", same))
        .related("call", same)
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+ac1",
            "q/main+ac2",
            "q/main+ac3",
            "q/main+ac4",
            "q/main+ac5",
            "q/message+m1",
            "q/message.conversation+cv1",
            "q/message.attachments+mat1",
            "q/reaction+rx1",
            "q/canvas+k1",
            "q/canvas.sdlcArtifact+k1",
            "q/call+k1",
            "q/ticket+t1"
        ])
    );
    assert_eq!(
        w.delete("activities", "ac5"),
        ops(["q/main-ac5", "q/canvas-k1", "q/canvas.sdlcArtifact-k1"])
    );
}

/// `userMissedCalls`: the caller's unread missed calls.
#[test]
fn user_missed_calls() {
    let mut w = World::new();
    seed_feed(&mut w);
    let q = zql("activities")
        .eq("userId", ME)
        .eq("actorAction", "missed_call")
        .eq("isRead", false);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ac3"]));
    assert_eq!(
        w.update("activities", &with(&ac3(), row!["isRead" => true])),
        ops(["q/main-ac3"])
    );
}

/// `userUnreadActivities`: unread activities with their channel.
#[test]
fn user_unread_activities() {
    let mut w = World::new();
    seed_feed(&mut w);
    let q = zql("activities")
        .eq("userId", ME)
        .eq("isRead", false)
        .order_by("updatedAt", DESC)
        .related("channel", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+ac1",
            "q/main+ac3",
            "q/main+ac4",
            "q/main+ac5",
            "q/channel+c1"
        ])
    );
    assert_eq!(
        w.insert("activities", row!["id" => "ac6", "userId" => ME, "actorAction" => "reply", "isRead" => false, "updatedAt" => 700, "channelId" => "c1"]),
        ops(["q/main+ac6"])
    );
}

/// `userActivitiesPaginated` for two action types and one classification
/// below a cursor, ties broken by `id`.
#[test]
fn user_activities_paginated() {
    let mut w = World::new();
    seed_feed(&mut w);
    let q = zql("activities")
        .eq("userId", ME)
        .filter(or(vec![
            eq("actorAction", "mention"),
            eq("actorAction", "reaction"),
        ]))
        .filter(or(vec![eq("classification", "IMPORTANT")]))
        .order_by("updatedAt", DESC)
        .order_by("id", DESC)
        .start(&[("updatedAt", DESC, 450.into())], false)
        .limit(10)
        .related("message", |m| {
            m.related("conversation", same)
                .related("reactions", same)
                .related("reactionCounts", same)
                .related("attachments", same)
        })
        .related("reaction", same)
        .related("canvas", same)
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+ac1",
            "q/message+m1",
            "q/message.conversation+cv1",
            "q/message.reactions+rx1",
            "q/message.reactionCounts+rct1",
            "q/message.attachments+mat1"
        ])
    );
}

/// `userActivitiesPaginatedV2`: unread activities by human actors below a
/// cursor, the actor kind an existence test on `users`; reading one drops
/// it and its ticket.
#[test]
fn user_activities_paginated_v2() {
    let mut w = World::new();
    seed_feed(&mut w);
    let q = zql("activities")
        .eq("userId", ME)
        .eq("isRead", false)
        .where_exists("actor", |a| a.in_("userType", &["HUMAN"]))
        .order_by("updatedAt", DESC)
        .order_by("id", DESC)
        .start(&[("updatedAt", DESC, 450.into())], false)
        .limit(10)
        .related("message", |m| {
            m.related("conversation", same).related("attachments", same)
        })
        .related("reaction", same)
        .related("canvas", |c| c.related("sdlcArtifact", same))
        .related("call", same)
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/has:actor+u-2",
            "q/main+ac1",
            "q/main+ac4",
            "q/message+m1",
            "q/message.attachments+mat1",
            "q/message.conversation+cv1",
            "q/ticket+t1"
        ])
    );
    assert_eq!(
        w.update("activities", &with(&ac4(), row!["isRead" => true])),
        ops(["q/main-ac4", "q/ticket-t1"])
    );
}

/// `userUnreadThreadActivities`: unread message activities whose thread
/// has replies, two existence tests deep; the thread losing its replies
/// drops the activity.
#[test]
fn user_unread_thread_activities() {
    let mut w = World::new();
    seed_feed(&mut w);
    let q = zql("activities")
        .eq("userId", ME)
        .eq("isRead", false)
        .eq("actionSource", "message")
        .where_exists("message", |m| {
            m.where_exists("conversation", |c| c.where_("replyCount", GT, 0))
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+ac1",
            "q/has:message+m1",
            "q/has:message.has:conversation+cv1"
        ])
    );
    assert_eq!(
        w.update("conversations", &with(&cv1(), row!["replyCount" => 0])),
        ops([
            "q/has:message.has:conversation-cv1",
            "q/has:message-m1",
            "q/main-ac1"
        ])
    );
}

/// Recaps for one day: the caller's project recap and `u-2`'s, a base
/// channel recap (no user), the caller's custom one, another channel's,
/// yesterday's; the same in the legacy daily table.
fn seed_recaps(w: &mut World) {
    w.seed("recaps", row!["id" => "rp1", "recapDate" => 20260912, "entityType" => "PROJECT", "entityId" => "p1", "userId" => ME, "summary" => "shipped"]);
    w.seed("recaps", row!["id" => "rp2", "recapDate" => 20260912, "entityType" => "PROJECT", "entityId" => "p1", "userId" => "u-2", "summary" => "theirs"]);
    w.seed("recaps", row!["id" => "rc1", "recapDate" => 20260912, "entityType" => "CHANNEL", "entityId" => "c1", "summary" => "base"]);
    w.seed("recaps", row!["id" => "rc2", "recapDate" => 20260912, "entityType" => "CHANNEL", "entityId" => "c1", "userId" => ME, "summary" => "custom"]);
    w.seed("recaps", row!["id" => "rc3", "recapDate" => 20260912, "entityType" => "CHANNEL", "entityId" => "c2", "summary" => "base 2"]);
    w.seed("recaps", row!["id" => "rc-old", "recapDate" => 20260911, "entityType" => "CHANNEL", "entityId" => "c1", "userId" => ME, "summary" => "old"]);
    w.seed(
        "channel_daily_recaps",
        row!["id" => "cd1", "channelId" => "c1", "recapDate" => 20260912, "summary" => "base"],
    );
    w.seed("channel_daily_recaps", row!["id" => "cd2", "channelId" => "c1", "recapDate" => 20260912, "userId" => ME, "summary" => "custom"]);
    w.seed(
        "channel_daily_recaps",
        row!["id" => "cd3", "channelId" => "c2", "recapDate" => 20260912, "summary" => "base 2"],
    );
}

/// `projectRecaps`: the caller's project recaps of a day.
#[test]
fn project_recaps() {
    let mut w = World::new();
    seed_recaps(&mut w);
    let q = zql("recaps")
        .eq("recapDate", 20260912)
        .eq("entityType", "PROJECT")
        .eq("userId", ME);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+rp1"]));
    assert_eq!(
        w.insert("recaps", row!["id" => "rp3", "recapDate" => 20260912, "entityType" => "PROJECT", "entityId" => "p2", "userId" => ME]),
        ops(["q/main+rp3"])
    );
}

/// `channelRecaps`: a day's recaps of listed channels, the base ones
/// (`userId IS NULL`) and the caller's; the empty-list guard is
/// permanently empty.
#[test]
fn channel_recaps() {
    let mut w = World::new();
    seed_recaps(&mut w);
    let q = zql("recaps")
        .eq("recapDate", 20260912)
        .eq("entityType", "CHANNEL")
        .filter(or(vec![eq("entityId", "c1"), eq("entityId", "c2")]))
        .filter(or(vec![is_null("userId"), eq("userId", ME)]));
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+rc1", "q/main+rc2", "q/main+rc3"])
    );
    assert_eq!(w.subscribe("none", &zql("recaps").limit(0)), ops([]));
    assert_eq!(
        w.insert("recaps", row!["id" => "rc4", "recapDate" => 20260912, "entityType" => "CHANNEL", "entityId" => "c2", "userId" => ME]),
        ops(["q/main+rc4"])
    );
}

/// `channelDailyRecaps` (the legacy table): the same shape.
#[test]
fn channel_daily_recaps() {
    let mut w = World::new();
    seed_recaps(&mut w);
    let q = zql("channel_daily_recaps")
        .eq("recapDate", 20260912)
        .filter(or(vec![eq("channelId", "c1"), eq("channelId", "c2")]))
        .filter(or(vec![is_null("userId"), eq("userId", ME)]));
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+cd1", "q/main+cd2", "q/main+cd3"])
    );
    assert_eq!(w.delete("channel_daily_recaps", "cd2"), ops(["q/main-cd2"]));
}
