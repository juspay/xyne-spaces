//! The channel queries: the caller's channel list, browsing, stats,
//! participants and status rows, sections, bookmarks, links, and the SDLC
//! hub queries, one test per registry entry over one workspace fixture.

use streamgres::model::ComparisonOperator::{GT, NEQ};
use streamgres::model::Order::{ASC, DESC};
use streamgres::model::Value;

use super::world::{ME, World, ops, with};
use super::zql::{and, eq, is_null, or, same, zql};

/// A full row image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// The caller's status row on `c1`: open, not deleted.
fn st1() -> Row {
    row!["id" => "st1", "channelId" => "c1", "userId" => ME, "isClosed" => false, "isDeleted" => false, "isStarred" => true]
        .to_vec()
}

/// Channel `c1`: a public default channel with the caller in it.
fn c1() -> Row {
    row!["id" => "c1", "name" => "general", "type" => "DEFAULT", "scopeType" => "DEFAULT", "visibility" => "PUBLIC",
         "updatedAt" => 100, "isArchived" => false]
    .to_vec()
}

/// Link `lk1`: a default-visibility link in `c1` by `u-2`.
fn lk1() -> Row {
    row!["id" => "lk1", "channelId" => "c1", "url" => "https://a", "visibility" => "DEFAULT", "createdBy" => "u-2",
         "createdAt" => 1]
    .to_vec()
}

/// The workspace: public `c1` (the caller a member), private `c2` (the
/// caller a member), private `c3` (not a member), email channel `c-mail`,
/// a DM; the caller's status rows on `c1` and `c-mail` and a closed one on
/// `c2`; stats rows; a user; a section; bookmarks; links.
fn seed_workspace(w: &mut World) {
    w.seed("channels", &c1());
    w.seed("channels", row!["id" => "c2", "name" => "ops", "type" => "DEFAULT", "scopeType" => "DEFAULT", "visibility" => "PRIVATE", "updatedAt" => 200]);
    w.seed("channels", row!["id" => "c3", "name" => "secret", "type" => "DEFAULT", "scopeType" => "DEFAULT", "visibility" => "PRIVATE", "updatedAt" => 300]);
    w.seed("channels", row!["id" => "c-mail", "name" => "support", "type" => "EMAIL", "scopeType" => "DEFAULT", "visibility" => "PUBLIC", "updatedAt" => 400]);
    w.seed("channels", row!["id" => "c-dm", "name" => "dm", "type" => "DEFAULT", "scopeType" => "DM", "visibility" => "PRIVATE", "updatedAt" => 500]);
    w.seed(
        "channel_participants",
        row!["id" => "cp1", "channelId" => "c1", "userId" => ME, "role" => "ADMIN"],
    );
    w.seed(
        "channel_participants",
        row!["id" => "cp2", "channelId" => "c2", "userId" => ME, "role" => "MEMBER"],
    );
    w.seed(
        "channel_participants",
        row!["id" => "cp3", "channelId" => "c3", "userId" => "u-3", "role" => "ADMIN"],
    );
    w.seed(
        "channel_participants",
        row!["id" => "cp4", "channelId" => "c1", "userId" => "u-2", "role" => "MEMBER"],
    );
    w.seed("channel_user_status", &st1());
    w.seed("channel_user_status", row!["id" => "st2", "channelId" => "c2", "userId" => ME, "isClosed" => true, "isDeleted" => false]);
    w.seed("channel_user_status", row!["id" => "st3", "channelId" => "c-mail", "userId" => ME, "isClosed" => false, "isDeleted" => false]);
    w.seed("channel_user_status", row!["id" => "st4", "channelId" => "c1", "userId" => "u-2", "isClosed" => false, "isDeleted" => false]);
    w.seed(
        "channel_stats",
        row!["channelId" => "c1", "lastActivityAt" => 10, "participantCount" => 2],
    );
    w.seed(
        "channel_stats",
        row!["channelId" => "c2", "lastActivityAt" => 20, "participantCount" => 1],
    );
    w.seed(
        "users",
        row!["id" => ME, "name" => "Aniket", "displayName" => "ani"],
    );
    w.seed(
        "users",
        row!["id" => "u-2", "name" => "Meera", "displayName" => "meera"],
    );
    w.seed("channel_sections", row!["id" => "sec1", "userId" => ME, "name" => "Work", "position" => 1, "isDeleted" => false]);
    w.seed(
        "channel_sections",
        row!["id" => "sec2", "userId" => ME, "name" => "Old", "position" => 2, "isDeleted" => true],
    );
    w.seed("bookmarks", row!["id" => "bk1", "userId" => ME, "entityId" => "m1", "entityType" => "MESSAGE", "isDeleted" => false, "createdAt" => 1]);
    w.seed("bookmarks", row!["id" => "bk2", "userId" => ME, "entityId" => "m2", "entityType" => "MESSAGE", "isDeleted" => true, "createdAt" => 2]);
    w.seed("links", &lk1());
    w.seed("links", row!["id" => "lk2", "channelId" => "c1", "url" => "https://b", "visibility" => "PERSONAL", "createdBy" => ME, "createdAt" => 2]);
    w.seed("links", row!["id" => "lk3", "channelId" => "c1", "url" => "https://c", "visibility" => "PERSONAL", "createdBy" => "u-2", "createdAt" => 3]);
    w.seed(
        "link_access",
        row!["id" => "la1", "linkId" => "lk3", "userId" => ME],
    );
}

/// `userAllChannels` with an `updatedAt` watermark: every channel changed
/// since it.
#[test]
fn user_all_channels() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channels").where_("updatedAt", GT, 250);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+c3", "q/main+c-mail", "q/main+c-dm"])
    );
    assert_eq!(
        w.update("channels", &with(&c1(), row!["updatedAt" => 600])),
        ops(["q/main+c1"])
    );
}

/// `userVisibleChannels`: channels the caller has an open status row on,
/// with stats; closing the status row removes the channel.
#[test]
fn user_visible_channels() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channels")
        .where_exists("participantsStatus", |p| {
            p.eq("isClosed", false)
                .eq("isDeleted", false)
                .eq("userId", ME)
        })
        .related("channelStats", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+c1",
            "q/main+c-mail",
            "q/has:participantsStatus+st1",
            "q/has:participantsStatus+st3",
            "q/channelStats+c1"
        ])
    );
    assert_eq!(
        w.update(
            "channel_user_status",
            &with(&st1(), row!["isClosed" => true])
        ),
        ops([
            "q/has:participantsStatus-st1",
            "q/main-c1",
            "q/channelStats-c1"
        ])
    );
}

/// `userVisibleChannelsV2`: the status rows themselves with channel and
/// stats.
#[test]
fn user_visible_channels_v2() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_user_status")
        .eq("userId", ME)
        .eq("isClosed", false)
        .eq("isDeleted", false)
        .related("channel", |ch| ch.related("channelStats", same));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+st1",
            "q/main+st3",
            "q/channel+c1",
            "q/channel+c-mail",
            "q/channel.channelStats+c1"
        ])
    );
    assert_eq!(
        w.update("channel_user_status", row!["id" => "st2", "channelId" => "c2", "userId" => ME, "isClosed" => false, "isDeleted" => false]),
        ops(["q/main+st2", "q/channel+c2", "q/channel.channelStats+c2"])
    );
}

/// `userVisibleChannelsV3`: the same, chat channels only (the channel
/// part filtered by type).
#[test]
fn user_visible_channels_v3() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_user_status")
        .eq("userId", ME)
        .eq("isClosed", false)
        .eq("isDeleted", false)
        .related("channel", |ch| {
            ch.not_in("type", &["EMAIL", "SLACK", "APP", "CALL", "SOCIAL_MEDIA"])
                .related("channelStats", same)
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+st1",
            "q/main+st3",
            "q/channel+c1",
            "q/channel.channelStats+c1"
        ])
    );
    assert_eq!(w.rows("q", "channel"), 1);
}

/// `userVisibleEmailChannels`: the same, desk channels only.
#[test]
fn user_visible_email_channels() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_user_status")
        .eq("userId", ME)
        .eq("isClosed", false)
        .eq("isDeleted", false)
        .related("channel", |ch| {
            ch.in_("type", &["EMAIL", "SLACK", "APP", "CALL", "SOCIAL_MEDIA"])
                .related("channelStats", same)
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+st1", "q/main+st3", "q/channel+c-mail"])
    );
    assert_eq!(
        w.delete("channel_user_status", "st3"),
        ops(["q/main-st3", "q/channel-c-mail"])
    );
}

/// `browsableChannels`: regular channels that are public or that the
/// caller is in, one subscription with the existence test inside the
/// `OR`; leaving the private channel drops it with its participants.
#[test]
fn browsable_channels() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let mut q = zql("channels").eq("scopeType", "DEFAULT");
    let member = q.exists("participants", |p| p.eq("userId", ME));
    let q = q
        .filter(or(vec![eq("visibility", "PUBLIC"), member]))
        .related("participants", same)
        .order_by("name", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+c1",
            "q/main+c2",
            "q/main+c-mail",
            "q/participants+cp1",
            "q/participants+cp2",
            "q/participants+cp4",
            "q/has:participants+cp1",
            "q/has:participants+cp2"
        ])
    );
    assert_eq!(
        w.delete("channel_participants", "cp2"),
        ops(["q/main-c2", "q/participants-cp2", "q/has:participants-cp2"])
    );
}

/// `channelStats`: one channel's stats row.
#[test]
fn channel_stats() {
    let mut w = World::new();
    seed_workspace(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("channel_stats").eq("channelId", "c1").one()),
        ops(["q/main+c1"])
    );
    assert_eq!(
        w.update(
            "channel_stats",
            row!["channelId" => "c1", "lastActivityAt" => 11, "participantCount" => 3]
        ),
        ops(["q/main+c1"])
    );
}

/// `channelStatsByIds`: several channels' stats as an `OR` of equalities.
#[test]
fn channel_stats_by_ids() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_stats").filter(or(vec![eq("channelId", "c1"), eq("channelId", "c3")]));
    assert_eq!(w.subscribe("q", &q), ops(["q/main+c1"]));
    assert_eq!(
        w.insert(
            "channel_stats",
            row!["channelId" => "c3", "lastActivityAt" => 30]
        ),
        ops(["q/main+c3"])
    );
}

/// `channelParticipants`: a channel's members.
#[test]
fn channel_participants() {
    let mut w = World::new();
    seed_workspace(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("channel_participants").eq("channelId", "c1")),
        ops(["q/main+cp1", "q/main+cp4"])
    );
    assert_eq!(w.delete("channel_participants", "cp4"), ops(["q/main-cp4"]));
}

/// `myChannelParticipations`: the channels the caller administers.
#[test]
fn my_channel_participations() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_participants")
        .eq("userId", ME)
        .eq("role", "ADMIN");
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cp1"]));
    assert_eq!(
        w.update(
            "channel_participants",
            row!["id" => "cp2", "channelId" => "c2", "userId" => ME, "role" => "ADMIN"]
        ),
        ops(["q/main+cp2"])
    );
}

/// `getUserMultipleChannelParticipations`: the caller's live status rows
/// on given channels; the empty-list guard is permanently empty.
#[test]
fn get_user_multiple_channel_participations() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_user_status")
        .eq("userId", ME)
        .eq("isDeleted", false)
        .in_("channelId", &["c1", "c2"]);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+st1", "q/main+st2"]));
    assert_eq!(
        w.subscribe(
            "none",
            &zql("channel_user_status")
                .eq("channelId", "nonexistent")
                .limit(0)
        ),
        ops([])
    );
    assert_eq!(w.delete("channel_user_status", "st2"), ops(["q/main-st2"]));
}

/// `getAllChannelsUserStatus`: every live status row of the caller.
#[test]
fn get_all_channels_user_status() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_user_status")
        .eq("userId", ME)
        .eq("isDeleted", false);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+st1", "q/main+st2", "q/main+st3"])
    );
    assert_eq!(
        w.update(
            "channel_user_status",
            &with(&st1(), row!["isDeleted" => true])
        ),
        ops(["q/main-st1"])
    );
}

/// `getChannelUserStatus`: the caller's status row on one channel.
#[test]
fn get_channel_user_status() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_user_status")
        .eq("channelId", "c1")
        .eq("userId", ME)
        .eq("isDeleted", false)
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+st1"]));
    assert_eq!(
        w.update(
            "channel_user_status",
            &with(&st1(), row!["isStarred" => false])
        ),
        ops(["q/main+st1"])
    );
}

/// `searchChannelParticipants`: members whose user matches a search. Gap
/// L: the `ILIKE` on name and display name cannot be stated; the user
/// existence test alone is.
#[test]
fn search_channel_participants() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_participants")
        .eq("channelId", "c1")
        .where_exists("user", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cp1",
            "q/main+cp4",
            "q/has:user+u-me",
            "q/has:user+u-2"
        ])
    );
}

/// `channelParticipantsPaginated`: members by role then user, after a
/// two-key cursor spelled as a `WHERE`.
#[test]
fn channel_participants_paginated() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_participants")
        .eq("channelId", "c1")
        .order_by("role", ASC)
        .order_by("userId", ASC)
        .start(
            &[
                ("role", ASC, "ADMIN".into()),
                ("userId", ASC, "u-me".into()),
            ],
            false,
        )
        .limit(10);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cp4"]));
    assert_eq!(
        w.insert(
            "channel_participants",
            row!["id" => "cp5", "channelId" => "c1", "userId" => "u-zed", "role" => "ADMIN"]
        ),
        ops(["q/main+cp5"])
    );
}

/// `userChannelSections`: the caller's live sections by position.
#[test]
fn user_channel_sections() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("channel_sections")
        .eq("isDeleted", false)
        .order_by("position", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+sec1"]));
    assert_eq!(
        w.insert("channel_sections", row!["id" => "sec3", "userId" => ME, "name" => "Later", "position" => 3, "isDeleted" => false]),
        ops(["q/main+sec3"])
    );
}

/// `userBookmarks`: live bookmarks, newest first.
#[test]
fn user_bookmarks() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let q = zql("bookmarks")
        .eq("isDeleted", false)
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+bk1"]));
    assert_eq!(
        w.update("bookmarks", row!["id" => "bk1", "userId" => ME, "entityId" => "m1", "entityType" => "MESSAGE", "isDeleted" => true, "createdAt" => 1]),
        ops(["q/main-bk1"])
    );
}

/// `channelLinks`: a channel's links the caller may see: an `OR` of three
/// branches, personal links by the caller, personal links shared with the
/// caller, and default-visibility links in a channel the caller may see
/// (public, or a participant), the last an existence test nested inside
/// another.
#[test]
fn channel_links() {
    let mut w = World::new();
    seed_workspace(&mut w);
    let mut q = zql("links").eq("channelId", "c1");
    let shared = q.exists("sharedWith", |s| s.eq("userId", ME));
    let visible_channel = q.exists("channel", |ch| {
        let mut ch = ch;
        let member = ch.exists("participants", |p| p.eq("userId", ME));
        ch.filter(or(vec![eq("visibility", "PUBLIC"), member]))
    });
    let q = q
        .filter(or(vec![
            and(vec![eq("visibility", "PERSONAL"), eq("createdBy", ME)]),
            and(vec![eq("visibility", "PERSONAL"), shared]),
            and(vec![eq("visibility", "DEFAULT"), visible_channel]),
        ]))
        .related("sharedWith", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+lk1",
            "q/main+lk2",
            "q/main+lk3",
            "q/sharedWith+la1",
            "q/has:sharedWith+la1",
            "q/has:channel+c1",
            "q/has:channel.has:participants+cp1"
        ])
    );
    assert_eq!(
        w.update(
            "links",
            &with(
                &lk1(),
                row!["visibility" => "PERSONAL", "createdBy" => "u-2"]
            )
        ),
        ops(["q/main-lk1"])
    );
}

/// The SDLC hub: channel `c-sdlc` (the caller a member) with a repo link,
/// a track, a folder under the track, a link in the hub graph, and repo
/// `r1` on project `p1`.
fn seed_sdlc(w: &mut World) {
    w.seed("channels", row!["id" => "c-sdlc", "name" => "payments-hub", "type" => "SDLC", "scopeType" => "DEFAULT", "visibility" => "PUBLIC", "isArchived" => false]);
    w.seed("channels", row!["id" => "c-sdlc2", "name" => "other-hub", "type" => "SDLC", "scopeType" => "DEFAULT", "visibility" => "PUBLIC", "isArchived" => false]);
    w.seed(
        "channel_participants",
        row!["id" => "cps", "channelId" => "c-sdlc", "userId" => ME, "role" => "MEMBER"],
    );
    w.seed(
        "channel_stats",
        row!["channelId" => "c-sdlc", "lastActivityAt" => 1],
    );
    w.seed(
        "projects",
        row!["id" => "p1", "name" => "Core", "type" => "PROJECT"],
    );
    w.seed("repos", row!["id" => "r1", "name" => "payments", "url" => "https://git/payments", "projectId" => "p1", "channelId" => "c-sdlc"]);
    w.seed(
        "repos",
        row!["id" => "r2", "name" => "orphan", "url" => "https://git/orphan"],
    );
    w.seed(
        "sdlc_tracks",
        row!["id" => "tr1", "name" => "Checkout", "status" => "ACTIVE", "createdAt" => 1],
    );
    w.seed(
        "sdlc_folders",
        row!["id" => "fo1", "name" => "Specs", "createdAt" => 1],
    );
    w.seed("sdlc_entity_links", row!["id" => "l-repo", "channelId" => "c-sdlc", "sourceType" => "CHANNEL", "sourceId" => "c-sdlc", "targetType" => "REPO", "targetId" => "r1", "relationType" => "MEMBER_OF", "createdAt" => 1]);
    w.seed("sdlc_entity_links", row!["id" => "l-track", "channelId" => "c-sdlc", "sourceType" => "CHANNEL", "sourceId" => "c-sdlc", "targetType" => "TRACK", "targetId" => "tr1", "relationType" => "TRACK_MEMBER_OF", "createdAt" => 2]);
    w.seed("sdlc_entity_links", row!["id" => "l-folder", "channelId" => "c-sdlc", "sourceType" => "TRACK", "sourceId" => "tr1", "targetType" => "FOLDER", "targetId" => "fo1", "relationType" => "CONTAINS", "createdAt" => 3]);
    w.seed("sdlc_entity_links", row!["id" => "l-flat", "channelId" => "c-sdlc", "sourceType" => "TRACK", "sourceId" => "tr1", "targetType" => "FOLDER", "targetId" => "fo1", "relationType" => "TRACK_FLAT", "createdAt" => 4]);
    w.seed("sdlc_entity_links", row!["id" => "l-graph", "channelId" => "c-sdlc", "sourceType" => "TICKET", "sourceId" => "t1", "targetType" => "CANVAS", "targetId" => "k1", "relationType" => "REFERENCES", "createdAt" => 5]);
    w.seed(
        "canvas_folders",
        row!["id" => "cf1", "channelId" => "c-sdlc", "name" => "Docs"],
    );
    w.seed(
        "canvases",
        row!["id" => "k1", "folderId" => "cf1", "channelId" => "c-sdlc", "title" => "Design"],
    );
    w.seed(
        "sdlc_artifacts",
        row!["artifactId" => "k1", "repoId" => "r1", "artifactType" => "DESIGN"],
    );
}

/// `getSdlcChannels`: live hubs the caller is in, each with its repo
/// membership links, repos and their projects, three levels deep.
#[test]
fn get_sdlc_channels() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    let q = zql("channels")
        .eq("type", "SDLC")
        .eq("isArchived", false)
        .where_exists("participants", |p| p.eq("userId", ME))
        .related("sdlcEntityLinks", |l| {
            l.eq("relationType", "MEMBER_OF")
                .related("repo", |r| r.related("project", same))
        })
        .order_by("name", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+c-sdlc",
            "q/has:participants+cps",
            "q/sdlcEntityLinks+l-repo",
            "q/sdlcEntityLinks.repo+r1",
            "q/sdlcEntityLinks.repo.project+p1"
        ])
    );
    assert_eq!(
        w.insert(
            "channel_participants",
            row!["id" => "cps2", "channelId" => "c-sdlc2", "userId" => ME, "role" => "MEMBER"]
        ),
        ops(["q/has:participants+cps2", "q/main+c-sdlc2"])
    );
}

/// `getSdlcChannelById`: one hub with participants, stats, canvas folders
/// with their canvases and artifacts, and repo links.
#[test]
fn get_sdlc_channel_by_id() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    let q = zql("channels")
        .eq("id", "c-sdlc")
        .eq("type", "SDLC")
        .related("participants", same)
        .related("channelStats", same)
        .related("canvasFolders", |f| {
            f.related("canvases", |c| c.related("sdlcArtifact", same))
        })
        .related("sdlcEntityLinks", |l| {
            l.eq("relationType", "MEMBER_OF")
                .related("repo", |r| r.related("project", same))
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+c-sdlc",
            "q/participants+cps",
            "q/channelStats+c-sdlc",
            "q/canvasFolders+cf1",
            "q/canvasFolders.canvases+k1",
            "q/canvasFolders.canvases.sdlcArtifact+k1",
            "q/sdlcEntityLinks+l-repo",
            "q/sdlcEntityLinks.repo+r1",
            "q/sdlcEntityLinks.repo.project+p1"
        ])
    );
    assert_eq!(
        w.delete("canvases", "k1"),
        ops([
            "q/canvasFolders.canvases-k1",
            "q/canvasFolders.canvases.sdlcArtifact-k1"
        ])
    );
}

/// `getSdlcFolderChildren`: one level of a track's tree, by containment
/// edge and renderable target type.
#[test]
fn get_sdlc_folder_children() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    let q = zql("sdlc_entity_links")
        .eq("channelId", "c-sdlc")
        .eq("relationType", "CONTAINS")
        .eq("sourceType", "TRACK")
        .eq("sourceId", "tr1")
        .in_("targetType", &["FOLDER", "CONVERSATION", "CANVAS"])
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+l-folder"]));
    assert_eq!(
        w.insert("sdlc_entity_links", row!["id" => "l-doc", "channelId" => "c-sdlc", "sourceType" => "TRACK", "sourceId" => "tr1", "targetType" => "CANVAS", "targetId" => "k1", "relationType" => "CONTAINS", "createdAt" => 6]),
        ops(["q/main+l-doc"])
    );
}

/// `getSdlcFoldersByChannel`: every folder placed in a hub by a flat
/// track edge.
#[test]
fn get_sdlc_folders_by_channel() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    let q = zql("sdlc_folders").where_exists("sdlcEntityLinks", |l| {
        l.eq("channelId", "c-sdlc").eq("relationType", "TRACK_FLAT")
    });
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+fo1", "q/has:sdlcEntityLinks+l-flat"])
    );
    assert_eq!(
        w.delete("sdlc_entity_links", "l-flat"),
        ops(["q/main-fo1", "q/has:sdlcEntityLinks-l-flat"])
    );
}

/// `getSdlcTracks`: a hub's tracks by their membership edge.
#[test]
fn get_sdlc_tracks() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    let q = zql("sdlc_tracks")
        .where_exists("sdlcEntityLinks", |l| {
            l.eq("channelId", "c-sdlc")
                .eq("relationType", "TRACK_MEMBER_OF")
        })
        .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+tr1", "q/has:sdlcEntityLinks+l-track"])
    );
    assert_eq!(
        w.insert(
            "sdlc_tracks",
            row!["id" => "tr2", "name" => "Refunds", "status" => "ACTIVE", "createdAt" => 2]
        ),
        ops([])
    );
    assert_eq!(
        w.insert("sdlc_entity_links", row!["id" => "l-track2", "channelId" => "c-sdlc", "sourceType" => "CHANNEL", "sourceId" => "c-sdlc", "targetType" => "TRACK", "targetId" => "tr2", "relationType" => "TRACK_MEMBER_OF", "createdAt" => 7]),
        ops(["q/has:sdlcEntityLinks+l-track2", "q/main+tr2"])
    );
}

/// `getSdlcRepoById`: a repo with a project (`projectId IS NOT NULL`);
/// an orphan repo resolves to nothing.
#[test]
fn get_sdlc_repo_by_id() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    let q = zql("repos")
        .eq("id", "r1")
        .where_is_not_null("projectId")
        .related("project", same)
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+r1", "q/project+p1"]));
    assert_eq!(
        w.subscribe(
            "orphan",
            &zql("repos")
                .eq("id", "r2")
                .where_is_not_null("projectId")
                .related("project", same)
                .one()
        ),
        ops([])
    );
}

/// `getSdlcLinks`: a hub's content graph without its structural edges.
#[test]
fn get_sdlc_links() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    let q = zql("sdlc_entity_links")
        .eq("channelId", "c-sdlc")
        .not_in("relationType", &["MEMBER_OF", "TRACK_MEMBER_OF"])
        .filter(or(vec![
            cmp_ne("relationType", "TRACK_FLAT"),
            cmp_ne("targetType", "FOLDER"),
        ]))
        .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+l-folder", "q/main+l-graph"])
    );
    assert_eq!(
        w.delete("sdlc_entity_links", "l-graph"),
        ops(["q/main-l-graph"])
    );
}

/// `column != value`.
fn cmp_ne(column: &str, value: &str) -> streamgres::model::Where {
    super::zql::cmp(column, NEQ, value)
}

/// `getAllRepos`: every repo by name.
#[test]
fn get_all_repos() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("repos").order_by("name", ASC)),
        ops(["q/main+r1", "q/main+r2"])
    );
    assert_eq!(w.delete("repos", "r2"), ops(["q/main-r2"]));
}

/// `sdlcDiscussionConversations`: a hub's discussion threads from an id
/// list, with opener attachments and nudge counts and the caller's
/// participation; `doNotPostToChannel IS NULL OR = false` admits a thread
/// with the flag unset, and setting the flag removes it.
#[test]
fn sdlc_discussion_conversations() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    w.seed("conversations", row!["conversationId" => "sv1", "channelId" => "c-sdlc", "initialMessageId" => "sm1", "doNotPostToChannel" => false, "lastActivityAt" => 10]);
    w.seed("conversations", row!["conversationId" => "sv2", "channelId" => "c-sdlc", "initialMessageId" => "sm2", "lastActivityAt" => 20]);
    w.seed(
        "message_attachments",
        row!["id" => "sa1", "entityId" => "sm1", "entityType" => "CHAT"],
    );
    w.seed(
        "surface_nudge_counts",
        row!["id" => "snc1", "messageId" => "sm1", "userId" => ME],
    );
    w.seed("conversation_participants", row!["id" => "spp1", "conversationId" => "sv1", "userId" => ME, "participationType" => "AUTHOR", "joinedAt" => 1]);
    let q = zql("conversations")
        .eq("channelId", "c-sdlc")
        .in_("conversationId", &["sv1", "sv2"])
        .filter(or(vec![
            is_null("doNotPostToChannel"),
            eq("doNotPostToChannel", false),
        ]))
        .related("initialMessageAttachments", same)
        .related("initialMessageNudgeCounts", |n| {
            n.filter(or(vec![eq("userId", ME), eq("channelId", "c-sdlc")]))
        })
        .related("participants", |p| {
            p.eq("userId", ME).order_by("joinedAt", ASC)
        })
        .order_by("lastActivityAt", DESC)
        .limit(20);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+sv1",
            "q/main+sv2",
            "q/initialMessageAttachments+sa1",
            "q/initialMessageNudgeCounts+snc1",
            "q/participants+spp1"
        ])
    );
    assert_eq!(
        w.update("conversations", row!["conversationId" => "sv2", "channelId" => "c-sdlc", "initialMessageId" => "sm2", "doNotPostToChannel" => true, "lastActivityAt" => 20]),
        ops(["q/main-sv2"])
    );
}

/// `sdlcDiscussionConversation`: one discussion thread.
#[test]
fn sdlc_discussion_conversation() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    w.seed("conversations", row!["conversationId" => "sv1", "channelId" => "c-sdlc", "initialMessageId" => "sm1", "doNotPostToChannel" => false, "lastActivityAt" => 10]);
    w.seed("conversation_participants", row!["id" => "spp1", "conversationId" => "sv1", "userId" => ME, "participationType" => "AUTHOR", "joinedAt" => 1]);
    let q = zql("conversations")
        .eq("channelId", "c-sdlc")
        .eq("conversationId", "sv1")
        .eq("doNotPostToChannel", false)
        .related("initialMessageAttachments", same)
        .related("initialMessageNudgeCounts", |n| {
            n.filter(or(vec![eq("userId", ME), eq("channelId", "c-sdlc")]))
        })
        .related("participants", |p| {
            p.eq("userId", ME).order_by("joinedAt", ASC)
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+sv1", "q/participants+spp1"])
    );
    assert_eq!(
        w.delete("conversation_participants", "spp1"),
        ops(["q/participants-spp1"])
    );
}

/// `sdlcUserActivities`: the caller's activity in a hub, newest first,
/// with message, reaction, canvas (and artifact), call and ticket.
#[test]
fn sdlc_user_activities() {
    let mut w = World::new();
    seed_sdlc(&mut w);
    w.seed("activities", row!["id" => "ac1", "userId" => ME, "channelId" => "c-sdlc", "canvasId" => "k1", "actorAction" => "canvas_edited", "updatedAt" => 10]);
    w.seed("activities", row!["id" => "ac2", "userId" => "u-2", "channelId" => "c-sdlc", "actorAction" => "mention", "updatedAt" => 20]);
    let q = zql("activities")
        .eq("userId", ME)
        .eq("channelId", "c-sdlc")
        .order_by("updatedAt", DESC)
        .order_by("id", DESC)
        .start(&[("updatedAt", DESC, 500.into())], false)
        .limit(20)
        .related("message", |m| {
            m.related("conversation", same).related("attachments", same)
        })
        .related("reaction", same)
        .related("canvas", |c| c.related("sdlcArtifact", same))
        .related("call", same)
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+ac1", "q/canvas+k1", "q/canvas.sdlcArtifact+k1"])
    );
    assert_eq!(
        w.insert("activities", row!["id" => "ac3", "userId" => ME, "channelId" => "c-sdlc", "actorAction" => "reply", "updatedAt" => 30]),
        ops(["q/main+ac3"])
    );
}
