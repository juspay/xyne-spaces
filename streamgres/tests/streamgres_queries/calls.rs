//! The call queries: active, scheduled and past calls, recordings and
//! their shares, summary templates and recurring series, one test per
//! registry entry over one calls fixture.

use streamgres::model::ComparisonOperator::NEQ;
use streamgres::model::Order::{ASC, DESC};
use streamgres::model::Value;

use super::world::{ME, WS, World, ops, with};
use super::zql::{Q, eq, or, same, zql};

/// A full row image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// Call `k1`: an active stand-up in `c1` with the caller and `u-2`.
fn k1() -> Row {
    row!["id" => "k1", "externalId" => "k1", "title" => "Standup", "callType" => "DEFAULT", "status" => "ACTIVE",
         "channelId" => "c1", "startedAt" => 100, "startsAt" => 90, "createdByUserId" => "u-2"]
    .to_vec()
}

/// Share `sh1`: recording `rec2` shared with the caller.
fn sh1() -> Row {
    row!["id" => "sh1", "entityId" => "rec2", "shareableEntityType" => "NOTE_TAKER", "entityUserAccess" => "VIEW",
         "userId" => ME]
    .to_vec()
}

/// Template `st4`: a private template of `u-2`.
fn st4() -> Row {
    row!["id" => "st4", "name" => "Other private", "visibility" => "PRIVATE", "createdBy" => "u-2", "version" => 1].to_vec()
}

/// The calls: active `k1`, scheduled `k2`, ended `k3`, cancelled `k4`,
/// the caller's recording `rec1`, `u-2`'s recording `rec2` shared with
/// the caller (one live share, one revoked) and `k1` shared as a call;
/// participants; four summary templates; a recurring series.
fn seed_calls(w: &mut World) {
    w.seed("users", row!["id" => ME, "name" => "Aniket"]);
    w.seed("users", row!["id" => "u-2", "name" => "Meera"]);
    w.seed("calls", &k1());
    w.seed("calls", row!["id" => "k2", "externalId" => "k2", "title" => "Planning", "callType" => "DEFAULT", "status" => "SCHEDULED", "startsAt" => 500, "createdByUserId" => ME]);
    w.seed("calls", row!["id" => "k3", "externalId" => "k3", "title" => "Retro", "callType" => "DEFAULT", "status" => "ENDED", "startedAt" => 50, "endedAt" => 60, "createdByUserId" => "u-2"]);
    w.seed("calls", row!["id" => "k4", "externalId" => "k4", "title" => "Cancelled sync", "callType" => "DEFAULT", "status" => "CANCELLED", "startedAt" => 40]);
    w.seed("calls", row!["id" => "rec1", "externalId" => "ext-1", "title" => "Recording 1", "callType" => "HEADLESS", "status" => "ENDED", "createdByUserId" => ME, "startedAt" => 30, "recordingParticipants" => "[\"u-2\"]"]);
    w.seed("calls", row!["id" => "rec2", "externalId" => "ext-2", "title" => "Recording 2", "callType" => "HEADLESS", "status" => "ENDED", "createdByUserId" => "u-2", "startedAt" => 20]);
    w.seed(
        "call_participants",
        row!["id" => "cp-k1-me", "callId" => "k1", "userId" => ME, "invitedAt" => 1],
    );
    w.seed(
        "call_participants",
        row!["id" => "cp-k1-2", "callId" => "k1", "userId" => "u-2", "invitedAt" => 2],
    );
    w.seed(
        "call_participants",
        row!["id" => "cp-k2-me", "callId" => "k2", "userId" => ME, "invitedAt" => 3],
    );
    w.seed(
        "call_participants",
        row!["id" => "cp-k3-2", "callId" => "k3", "userId" => "u-2", "invitedAt" => 4],
    );
    w.seed("entity_access", &sh1());
    w.seed("entity_access", row!["id" => "sh2", "entityId" => "rec2", "shareableEntityType" => "NOTE_TAKER", "entityUserAccess" => "REVOKED", "userId" => ME]);
    w.seed("entity_access", row!["id" => "sh3", "entityId" => "k1", "shareableEntityType" => "CALL", "entityUserAccess" => "VIEW", "userId" => ME]);
    w.seed("summary_templates", row!["id" => "st1", "name" => "Daily", "visibility" => "PUBLIC", "createdBy" => "u-2", "version" => 1]);
    w.seed("summary_templates", row!["id" => "st2", "name" => "Mine", "visibility" => "PRIVATE", "createdBy" => ME, "version" => 2]);
    w.seed("summary_templates", row!["id" => "st3", "name" => "Pending", "visibility" => "WAITING_FOR_APPROVAL", "createdBy" => "u-2", "version" => 1]);
    w.seed("summary_templates", &st4());
    w.seed(
        "recurring_call_series",
        row!["id" => "rs1", "title" => "Weekly", "organizerId" => ME, "status" => "ACTIVE"],
    );
}

/// `userActiveCalls`: active non-recording calls with participants;
/// ending one removes it and them.
#[test]
fn user_active_calls() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .not_in("callType", &["HEADLESS"])
        .eq("status", "ACTIVE")
        .order_by("startedAt", DESC)
        .related("participants", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+k1",
            "q/participants+cp-k1-me",
            "q/participants+cp-k1-2"
        ])
    );
    assert_eq!(
        w.update("calls", &with(&k1(), row!["status" => "ENDED"])),
        ops([
            "q/main-k1",
            "q/participants-cp-k1-me",
            "q/participants-cp-k1-2"
        ])
    );
}

/// `activeCallsInChannel`: a channel's active calls; a new participant
/// joins the part.
#[test]
fn active_calls_in_channel() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .eq("channelId", "c1")
        .eq("status", "ACTIVE")
        .order_by("startedAt", DESC)
        .related("participants", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+k1",
            "q/participants+cp-k1-me",
            "q/participants+cp-k1-2"
        ])
    );
    assert_eq!(
        w.insert(
            "call_participants",
            row!["id" => "cp-k1-3", "callId" => "k1", "userId" => "u-3", "invitedAt" => 5]
        ),
        ops(["q/participants+cp-k1-3"])
    );
}

/// `userScheduledCalls`: scheduled calls soonest first with participants.
#[test]
fn user_scheduled_calls() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .eq("status", "SCHEDULED")
        .order_by("startsAt", ASC)
        .related("participants", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+k2", "q/participants+cp-k2-me"])
    );
    assert_eq!(
        w.insert("calls", row!["id" => "k5", "externalId" => "k5", "title" => "Demo", "callType" => "DEFAULT", "status" => "SCHEDULED", "startsAt" => 600]),
        ops(["q/main+k5"])
    );
}

/// `userScheduledCallsV2`: the caller's own participation only.
#[test]
fn user_scheduled_calls_v2() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .eq("status", "SCHEDULED")
        .order_by("startsAt", ASC)
        .related("participants", |p| p.eq("userId", ME));
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+k2", "q/participants+cp-k2-me"])
    );
    assert_eq!(
        w.delete("call_participants", "cp-k2-me"),
        ops(["q/participants-cp-k2-me"])
    );
}

/// `userCallHistory`: non-recording calls neither scheduled nor cancelled,
/// newest first below a cursor, with participants.
#[test]
fn user_call_history() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .not_in("callType", &["HEADLESS"])
        .not_in("status", &["SCHEDULED", "CANCELLED"])
        .order_by("startedAt", DESC)
        .order_by("id", DESC)
        .start(&[("startedAt", DESC, 500.into())], false)
        .limit(10)
        .related("participants", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+k1",
            "q/main+k3",
            "q/participants+cp-k1-me",
            "q/participants+cp-k1-2",
            "q/participants+cp-k3-2"
        ])
    );
}

/// `userCallHistoryV2`: past calls only, with the caller's participation;
/// a call ending moves into the history.
#[test]
fn user_call_history_v2() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .not_in("callType", &["HEADLESS"])
        .not_in("status", &["ACTIVE", "SCHEDULED", "CANCELLED"])
        .order_by("startedAt", DESC)
        .order_by("id", DESC)
        .start(&[("startedAt", DESC, 500.into())], false)
        .limit(10)
        .related("participants", |p| p.eq("userId", ME));
    assert_eq!(w.subscribe("q", &q), ops(["q/main+k3"]));
    assert_eq!(
        w.update("calls", &with(&k1(), row!["status" => "ENDED"])),
        ops(["q/main+k1", "q/participants+cp-k1-me"])
    );
}

/// `callParticipantsByCallId`: a call's participants in invitation order.
#[test]
fn call_participants_by_call_id() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("call_participants")
        .eq("callId", "k1")
        .order_by("invitedAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+cp-k1-me", "q/main+cp-k1-2"])
    );
    assert_eq!(
        w.delete("call_participants", "cp-k1-2"),
        ops(["q/main-cp-k1-2"])
    );
}

/// `userRecordings`: the caller's recordings, newest first below a cursor.
#[test]
fn user_recordings() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .eq("callType", "HEADLESS")
        .eq("createdByUserId", ME)
        .order_by("startedAt", DESC)
        .order_by("id", DESC)
        .start(&[("startedAt", DESC, 500.into())], false)
        .limit(10);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+rec1"]));
}

/// `createdOatsRecordings` without a participant filter. Gaps L and J:
/// the participant filter searches a JSON column with `LIKE`, which
/// cannot be stated.
#[test]
fn created_oats_recordings() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .eq("workspaceId", WS)
        .eq("callType", "HEADLESS")
        .eq("createdByUserId", ME)
        .order_by("startedAt", DESC)
        .order_by("id", DESC)
        .limit(10);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+rec1"]));
    assert_eq!(
        w.insert("calls", row!["id" => "rec3", "externalId" => "ext-3", "callType" => "HEADLESS", "status" => "ENDED", "createdByUserId" => ME, "startedAt" => 35]),
        ops(["q/main+rec3"])
    );
}

/// `sharedOatsRecordings`: others' recordings with a live share reaching
/// the caller directly, through a group the caller is in, or through a
/// channel the caller is in: three existence tests on one column inside
/// one `OR`, each with a set of its own. Revoking the direct share drops
/// the recording.
#[test]
fn shared_oats_recordings() {
    let mut w = World::new();
    seed_calls(&mut w);
    let live = |s: Q| {
        s.eq("shareableEntityType", "NOTE_TAKER")
            .where_("entityUserAccess", NEQ, "REVOKED")
    };
    let mut q = zql("calls")
        .eq("workspaceId", WS)
        .eq("callType", "HEADLESS")
        .where_("createdByUserId", NEQ, ME);
    let direct = q.exists("shares", |s| live(s).eq("userId", ME));
    let via_group = q.exists("shares", |s| {
        live(s).where_exists("userGroupMemberships", |m| m.eq("userId", ME))
    });
    let via_channel = q.exists("shares", |s| {
        live(s).where_exists("channelMembers", |m| m.eq("userId", ME))
    });
    let q = q
        .filter(or(vec![direct, via_group, via_channel]))
        .order_by("startedAt", DESC)
        .order_by("id", DESC)
        .limit(10);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+rec2", "q/has:shares+sh1"])
    );
    assert_eq!(
        w.update(
            "entity_access",
            &with(&sh1(), row!["entityUserAccess" => "REVOKED"])
        ),
        ops(["q/has:shares-sh1", "q/main-rec2"])
    );
}

/// `callById`: one regular call with the caller's participation and its
/// live shares.
#[test]
fn call_by_id() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .where_("callType", NEQ, "HEADLESS")
        .eq("id", "k1")
        .related("participants", |p| p.eq("userId", ME))
        .related("shares", |s| s.where_("entityUserAccess", NEQ, "REVOKED"))
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+k1", "q/participants+cp-k1-me", "q/shares+sh3"])
    );
    assert_eq!(
        w.insert("entity_access", row!["id" => "sh4", "entityId" => "k1", "shareableEntityType" => "CALL", "entityUserAccess" => "VIEW", "userId" => "u-2"]),
        ops(["q/shares+sh4"])
    );
}

/// `oatsRecordingByExternalId`: a recording by public id with its live
/// shares and who they reach.
#[test]
fn oats_recording_by_external_id() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("calls")
        .eq("workspaceId", WS)
        .eq("callType", "HEADLESS")
        .eq("externalId", "ext-2")
        .related("shares", |s| {
            s.eq("shareableEntityType", "NOTE_TAKER")
                .where_("entityUserAccess", NEQ, "REVOKED")
                .related("user", same)
                .related("userGroup", same)
                .related("channel", same)
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+rec2", "q/shares+sh1", "q/shares.user+u-me"])
    );
    assert_eq!(
        w.delete("entity_access", "sh1"),
        ops(["q/shares-sh1", "q/shares.user-u-me"])
    );
}

/// `summaryTemplates`: templates the caller made or that are public. Gap
/// X: the other two branches (pending approval for admins, shared with
/// the caller) are existence tests inside the `OR`.
#[test]
fn summary_templates() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("summary_templates")
        .eq("workspaceId", WS)
        .filter(or(vec![eq("createdBy", ME), eq("visibility", "PUBLIC")]))
        .order_by("name", ASC)
        .order_by("version", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+st1", "q/main+st2"]));
    assert_eq!(
        w.update(
            "summary_templates",
            &with(&st4(), row!["visibility" => "PUBLIC"])
        ),
        ops(["q/main+st4"])
    );
}

/// `summaryTemplateById`: one template.
#[test]
fn summary_template_by_id() {
    let mut w = World::new();
    seed_calls(&mut w);
    let q = zql("summary_templates")
        .eq("workspaceId", WS)
        .eq("id", "st1")
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+st1"]));
    assert_eq!(w.delete("summary_templates", "st1"), ops(["q/main-st1"]));
}

/// `recurringSeriesById`: one recurring series; an edit is a replace pair.
#[test]
fn recurring_series_by_id() {
    let mut w = World::new();
    seed_calls(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("recurring_call_series").eq("id", "rs1").one()),
        ops(["q/main+rs1"])
    );
    assert_eq!(
        w.update(
            "recurring_call_series",
            row!["id" => "rs1", "title" => "Weekly sync", "organizerId" => ME, "status" => "ACTIVE"]
        ),
        ops(["q/main+rs1"])
    );
}
