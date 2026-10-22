//! The Xyne Desk (email support) queries: filtered and paginated desk
//! tickets, ticket rows and detail, emails, drafts, labels, mailboxes and
//! desk settings, one test per registry entry over one desk fixture.

use streamgres::model::ComparisonOperator::{GTE, LTE};
use streamgres::model::Order::{ASC, DESC};
use streamgres::model::Value;

use super::world::{ME, World, ops, with};
use super::zql::{Q, eq, is_null, or, same, zql};

/// A full row image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// Desk ticket `d1`: merchant `m-1`, assigned to the caller, HIGH, New,
/// billing, group `g1`, the fully connected one.
fn d1() -> Row {
    row!["id" => "d1", "channelId" => "c-desk", "merchantId" => "m-1", "assignedTo" => ME, "createdBy" => "u-2",
         "priority" => "HIGH", "stageName" => "New", "aiCategory" => "billing", "userGroupId" => "g1",
         "lastEmailAt" => 100, "createdAt" => 100, "isArchived" => false, "conversationId" => "cvd1",
         "xyneId" => "D-1", "projectId" => "p1", "title" => "Refund"]
    .to_vec()
}

/// Desk ticket `d2`: merchant `m-2`, assigned to `u-2`, LOW, Resolved.
fn d2() -> Row {
    row!["id" => "d2", "channelId" => "c-desk", "merchantId" => "m-2", "assignedTo" => "u-2", "createdBy" => "u-3",
         "priority" => "LOW", "stageName" => "Resolved", "aiCategory" => "login", "lastEmailAt" => 200,
         "createdAt" => 200, "isArchived" => false, "conversationId" => "cvd2", "xyneId" => "D-2",
         "projectId" => "p1", "title" => "Cannot log in"]
    .to_vec()
}

/// Channel `c1`: a default channel with one ticket.
fn c1() -> Row {
    row!["id" => "c1", "type" => "DEFAULT", "visibility" => "PUBLIC", "name" => "general"].to_vec()
}

/// Mailbox overlay `mb1`: the caller filed `d1` as spam.
fn mb1() -> Row {
    row!["id" => "mb1", "ticketId" => "d1", "userId" => ME, "state" => "SPAM", "starred" => false]
        .to_vec()
}

/// Email `em1`: the caller's reply on `d1`'s thread.
fn em1() -> Row {
    row!["id" => "em1", "conversationId" => "cvd1", "channelId" => "c-desk", "type" => "REPLY", "sentByUserId" => ME,
         "subject" => "Re: refund", "createdAt" => 10]
    .to_vec()
}

/// The desk: email channel `c-desk` and default channel `c1`, tickets `d1`,
/// `d2`, archived `d3` and default-channel `t1`, their conversations,
/// emails with one attachment, drafts (an AI draft with no user, the
/// caller's reply draft, the caller's compose draft), a read marker, two
/// mailbox overlays, a sub-ticket mapping, a label with its mapping, a
/// dynamic field value, a merge reference, two merchants, tags in both
/// models.
fn seed_desk(w: &mut World) {
    w.seed(
        "channels",
        row!["id" => "c-desk", "type" => "EMAIL", "visibility" => "PUBLIC", "name" => "support"],
    );
    w.seed("channels", &c1());
    w.seed(
        "projects",
        row!["id" => "p1", "name" => "Core", "type" => "PROJECT"],
    );
    w.seed("tickets", &d1());
    w.seed("tickets", &d2());
    w.seed("tickets", row!["id" => "d3", "channelId" => "c-desk", "isArchived" => true, "lastEmailAt" => 300, "createdAt" => 300, "xyneId" => "D-3", "projectId" => "p1"]);
    w.seed("tickets", row!["id" => "t1", "channelId" => "c1", "conversationId" => "cv1", "createdAt" => 50, "projectId" => "p1", "xyneId" => "X-1", "isArchived" => false]);
    w.seed(
        "conversations",
        row!["conversationId" => "cvd1", "channelId" => "c-desk", "ticketId" => "d1"],
    );
    w.seed(
        "conversations",
        row!["conversationId" => "cvd2", "channelId" => "c-desk", "ticketId" => "d2"],
    );
    w.seed(
        "conversations",
        row!["conversationId" => "cv1", "channelId" => "c1", "ticketId" => "t1"],
    );
    w.seed("emails", &em1());
    w.seed("emails", row!["id" => "em2", "conversationId" => "cvd1", "channelId" => "c-desk", "type" => "INBOUND", "subject" => "Refund", "createdAt" => 20]);
    w.seed("emails", row!["id" => "em3", "conversationId" => "cvd2", "channelId" => "c-desk", "type" => "COMPOSE", "sentByUserId" => "u-2", "createdAt" => 30]);
    w.seed("message_attachments", row!["id" => "at1", "entityId" => "em1", "entityType" => "EMAIL", "conversationId" => "cvd1", "originalFilename" => "receipt.pdf"]);
    w.seed(
        "email_drafts",
        row!["id" => "dr1", "conversationId" => "cvd1", "channelId" => "c-desk", "updatedAt" => 10],
    );
    w.seed("email_drafts", row!["id" => "dr2", "conversationId" => "cvd1", "userId" => ME, "channelId" => "c-desk", "updatedAt" => 20]);
    w.seed(
        "email_drafts",
        row!["id" => "dr3", "userId" => ME, "channelId" => "c-desk", "updatedAt" => 30],
    );
    w.seed(
        "email_reads",
        row!["id" => "rd1", "ticketId" => "d1", "userId" => ME, "lastReadEmailId" => "em2"],
    );
    w.seed("ticket_user_mailbox", &mb1());
    w.seed("ticket_user_mailbox", row!["id" => "mb2", "ticketId" => "d2", "userId" => ME, "state" => "INBOX", "starred" => true]);
    w.seed(
        "ticket_sub_ticket_mappings",
        row!["id" => "dm1", "ticketId" => "d1", "subTicketId" => "s-d"],
    );
    w.seed(
        "conversation_labels",
        row!["id" => "lb1", "channelId" => "c-desk", "name" => "vip", "color" => "gold"],
    );
    w.seed("conversation_label_mappings", row!["id" => "lm1", "conversationId" => "cvd1", "labelId" => "lb1", "labelName" => "vip", "channelId" => "c-desk", "createdAt" => 1]);
    w.seed("form_entity_values", row!["id" => "fev-d1", "entityId" => "d1", "entityType" => "TICKET", "fieldId" => "ff-d", "actualFieldValue" => "\"gold\""]);
    w.seed("ticket_reference_mappings", row!["id" => "dr-m", "sourceTicketId" => "d2", "targetTicketId" => "d1", "relationType" => "MERGED_INTO"]);
    w.seed("merchants", row!["id" => "m-1", "mid" => "M001"]);
    w.seed("merchants", row!["id" => "m-2", "mid" => "M002"]);
    w.seed(
        "ticket_tags",
        row!["id" => "dtg1", "ticketId" => "d1", "name" => "vip"],
    );
    w.seed(
        "ticket_tag_mappings",
        row!["id" => "dg1", "ticketId" => "d1", "tagId" => "tag-vip", "tagName" => "vip"],
    );
}

/// The desk row relations shared by the row and by-xyne-id queries: the
/// caller's drafts and the AI draft (`userId IS NULL`), and the caller's
/// reads.
fn caller_drafts_and_reads(query: Q) -> Q {
    query
        .related("emailDrafts", |d| {
            d.filter(or(vec![eq("userId", ME), is_null("userId")]))
        })
        .related("emailReads", |r| r.eq("userId", ME))
}

/// `ticketsForEmailChannels`: tickets whose conversation is in an email
/// channel, two existence tests deep; retyping a channel to email pulls
/// its tickets in through both levels.
#[test]
fn tickets_for_email_channels() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .where_exists("conversation", |c| {
            c.where_exists("channel", |ch| ch.eq("type", "EMAIL"))
        })
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("tags", same)
        .related("entity", same)
        .related("conversation", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/main+d2",
            "q/has:conversation+cvd1",
            "q/has:conversation+cvd2",
            "q/has:conversation.has:channel+c-desk",
            "q/project+p1",
            "q/tags+dtg1",
            "q/conversation+cvd1",
            "q/conversation+cvd2"
        ])
    );
    assert_eq!(
        w.update("channels", &with(&c1(), row!["type" => "EMAIL"])),
        ops([
            "q/has:conversation.has:channel+c1",
            "q/has:conversation+cv1",
            "q/main+t1",
            "q/conversation+cv1"
        ])
    );
}

/// `ticketsForEmailChannelsV2`: tag mappings; a conversation vanishing
/// takes its ticket with it.
#[test]
fn tickets_for_email_channels_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .where_exists("conversation", |c| {
            c.where_exists("channel", |ch| ch.eq("type", "EMAIL"))
        })
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("tagMappings", same)
        .related("entity", same)
        .related("conversation", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/main+d2",
            "q/has:conversation+cvd1",
            "q/has:conversation+cvd2",
            "q/has:conversation.has:channel+c-desk",
            "q/project+p1",
            "q/tagMappings+dg1",
            "q/conversation+cvd1",
            "q/conversation+cvd2"
        ])
    );
    assert_eq!(
        w.delete("conversations", "cvd2"),
        ops([
            "q/has:conversation-cvd2",
            "q/main-d2",
            "q/conversation-cvd2"
        ])
    );
}

/// `supportTicketsFiltered` for one channel and merchant.
#[test]
fn support_tickets_filtered() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .eq("merchantId", "m-1")
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("tags", same)
        .related("entity", same)
        .related("conversation", |c| c.related("channel", same));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/conversation+cvd1",
            "q/conversation.channel+c-desk"
        ])
    );
    assert_eq!(
        w.update("tickets", &with(&d2(), row!["merchantId" => "m-1"])),
        ops(["q/main+d2", "q/conversation+cvd2"])
    );
}

/// `supportTicketsFilteredV2` with assignee, priority, stage and category
/// filters and `hasAiDraft`, an existence test on drafts with no user;
/// deleting the AI draft drops the ticket, deleting the caller's own
/// draft changes nothing.
#[test]
fn support_tickets_filtered_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .eq("isArchived", false)
        .filter(or(vec![eq("assignedTo", ME), eq("assignedTo", "u-2")]))
        .eq("priority", "HIGH")
        .eq("stageName", "New")
        .eq("aiCategory", "billing")
        .where_exists("emailDrafts", |d| d.where_is_null("userId"))
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("tags", same)
        .related("entity", same)
        .related("conversation", |c| c.related("channel", same));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/has:emailDrafts+dr1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/conversation+cvd1",
            "q/conversation.channel+c-desk"
        ])
    );
    assert_eq!(w.delete("email_drafts", "dr2"), ops([]));
    assert_eq!(
        w.delete("email_drafts", "dr1"),
        ops([
            "q/has:emailDrafts-dr1",
            "q/main-d1",
            "q/project-p1",
            "q/tags-dtg1",
            "q/conversation-cvd1",
            "q/conversation.channel-c-desk"
        ])
    );
}

/// `supportTicketsFilteredV3` with creator, group, sub-ticket, label, date
/// and dynamic-field filters: four existence tests on one root, the
/// dynamic field both filtered and related. Removing the label mapping
/// drops the ticket and every relation under it.
#[test]
fn support_tickets_filtered_v3() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .in_("createdBy", &["u-2"])
        .where_exists("subTicketMappings", same)
        .in_("userGroupId", &["g1"])
        .where_exists("conversationLabelMappings", |m| m.eq("labelId", "lb1"))
        .where_("lastEmailAt", GTE, 50)
        .where_("lastEmailAt", LTE, 150)
        .where_("createdAt", GTE, 50)
        .where_("createdAt", LTE, 150)
        .where_exists("formEntityValues", |f| {
            f.eq("entityType", "TICKET")
                .eq("fieldId", "ff-d")
                .filter(or(vec![eq("actualFieldValue", "\"gold\"")]))
        })
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("tagMappings", same)
        .related("entity", same)
        .related("conversation", |c| c.related("channel", same))
        .related("emailReads", |r| r.eq("userId", ME))
        .related("formEntityValues", |f| {
            f.eq("entityType", "TICKET").in_("fieldId", &["ff-d"])
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/has:subTicketMappings+dm1",
            "q/has:conversationLabelMappings+lm1",
            "q/has:formEntityValues+fev-d1",
            "q/project+p1",
            "q/tagMappings+dg1",
            "q/conversation+cvd1",
            "q/conversation.channel+c-desk",
            "q/emailReads+rd1",
            "q/formEntityValues+fev-d1"
        ])
    );
    assert_eq!(
        w.delete("conversation_label_mappings", "lm1"),
        ops([
            "q/conversation-cvd1",
            "q/conversation.channel-c-desk",
            "q/emailReads-rd1",
            "q/formEntityValues-fev-d1",
            "q/has:conversationLabelMappings-lm1",
            "q/has:formEntityValues-fev-d1",
            "q/has:subTicketMappings-dm1",
            "q/main-d1",
            "q/project-p1",
            "q/tagMappings-dg1"
        ])
    );
}

/// `supportTicketsFilteredV4`: the `IN` spellings of the same filters;
/// lowering the priority drops the ticket.
#[test]
fn support_tickets_filtered_v4() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .in_("assignedTo", &[ME])
        .in_("priority", &["HIGH"])
        .in_("aiCategory", &["billing"])
        .where_exists("emailDrafts", |d| d.where_is_null("userId"))
        .where_("lastEmailAt", GTE, 50)
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("tagMappings", same)
        .related("entity", same)
        .related("conversation", |c| c.related("channel", same))
        .related("emailReads", |r| r.eq("userId", ME))
        .related("formEntityValues", |f| {
            f.eq("fieldId", "__no_dynamic_field_filters__")
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/has:emailDrafts+dr1",
            "q/project+p1",
            "q/tagMappings+dg1",
            "q/conversation+cvd1",
            "q/conversation.channel+c-desk",
            "q/emailReads+rd1"
        ])
    );
    assert_eq!(
        w.update("tickets", &with(&d1(), row!["priority" => "LOW"])),
        ops([
            "q/conversation-cvd1",
            "q/conversation.channel-c-desk",
            "q/emailReads-rd1",
            "q/has:emailDrafts-dr1",
            "q/main-d1",
            "q/project-p1",
            "q/tagMappings-dg1"
        ])
    );
}

/// `topicsExplorerTickets`: a channel's live tickets in a creation window.
#[test]
fn topics_explorer_tickets() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .eq("isArchived", false)
        .where_("createdAt", GTE, 150)
        .where_("createdAt", LTE, 350)
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+d2"]));
    assert_eq!(
        w.insert(
            "tickets",
            row!["id" => "d5", "channelId" => "c-desk", "isArchived" => false, "createdAt" => 160]
        ),
        ops(["q/main+d5"])
    );
}

/// `supportTicketRow`: one desk ticket with its emails.
#[test]
fn support_ticket_row() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("id", "d1")
        .related("project", same)
        .related("tags", same)
        .related("entity", same)
        .related("emails", same)
        .related("conversation", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/conversation+cvd1"
        ])
    );
    assert_eq!(
        w.insert("emails", row!["id" => "em4", "conversationId" => "cvd1", "channelId" => "c-desk", "type" => "INBOUND", "createdAt" => 40]),
        ops(["q/emails+em4"])
    );
}

/// `supportTicketRowV2`: emails with attachments, the caller's drafts, the
/// AI draft and the caller's reads.
#[test]
fn support_ticket_row_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = caller_drafts_and_reads(
        zql("tickets")
            .eq("id", "d1")
            .related("project", same)
            .related("tags", same)
            .related("entity", same)
            .related("emails", |e| e.related("attachments", same)),
    )
    .related("conversation", same)
    .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/emails.attachments+at1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/conversation+cvd1",
            "q/emailDrafts+dr1"
        ])
    );
    assert_eq!(
        w.insert("email_drafts", row!["id" => "dr4", "conversationId" => "cvd1", "userId" => ME, "channelId" => "c-desk", "updatedAt" => 40]),
        ops(["q/emailDrafts+dr4"])
    );
}

/// `supportTicketRowV3`: tag mappings.
#[test]
fn support_ticket_row_v3() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = caller_drafts_and_reads(
        zql("tickets")
            .eq("id", "d1")
            .related("project", same)
            .related("tagMappings", same)
            .related("entity", same)
            .related("emails", |e| e.related("attachments", same)),
    )
    .related("conversation", same)
    .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tagMappings+dg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/emails.attachments+at1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/conversation+cvd1",
            "q/emailDrafts+dr1"
        ])
    );
    assert_eq!(
        w.delete("message_attachments", "at1"),
        ops(["q/emails.attachments-at1"])
    );
}

/// `supportTicketByXyneId`: the row by human id; an edit is a replace pair.
#[test]
fn support_ticket_by_xyne_id() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("xyneId", "D-1")
        .related("project", same)
        .related("tags", same)
        .related("entity", same)
        .related("emails", same)
        .related("conversation", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/conversation+cvd1"
        ])
    );
    assert_eq!(
        w.update("tickets", &with(&d1(), row!["title" => "Refund (urgent)"])),
        ops(["q/main+d1"])
    );
}

/// `supportTicketByXyneIdV2`: attachments, the caller's drafts and reads.
#[test]
fn support_ticket_by_xyne_id_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = caller_drafts_and_reads(
        zql("tickets")
            .eq("xyneId", "D-1")
            .related("project", same)
            .related("tags", same)
            .related("entity", same)
            .related("emails", |e| e.related("attachments", same)),
    )
    .related("conversation", same)
    .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/emails.attachments+at1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/conversation+cvd1",
            "q/emailDrafts+dr1"
        ])
    );
    assert_eq!(w.delete("email_reads", "rd1"), ops(["q/emailReads-rd1"]));
}

/// `supportTicketByXyneIdV3`: the workspace as an explicit argument.
#[test]
fn support_ticket_by_xyne_id_v3() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = caller_drafts_and_reads(
        zql("tickets")
            .eq("xyneId", "D-1")
            .eq("workspaceId", "ws-1")
            .related("project", same)
            .related("tags", same)
            .related("entity", same)
            .related("emails", |e| e.related("attachments", same)),
    )
    .related("conversation", same)
    .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/emails.attachments+at1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/conversation+cvd1",
            "q/emailDrafts+dr1"
        ])
    );
    assert_eq!(
        w.insert("emails", row!["id" => "em4", "conversationId" => "cvd1", "channelId" => "c-desk", "type" => "INBOUND", "createdAt" => 40]),
        ops(["q/emails+em4"])
    );
}

/// `supportTicketByXyneIdV4`: tag mappings.
#[test]
fn support_ticket_by_xyne_id_v4() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = caller_drafts_and_reads(
        zql("tickets")
            .eq("xyneId", "D-1")
            .eq("workspaceId", "ws-1")
            .related("project", same)
            .related("tagMappings", same)
            .related("entity", same)
            .related("emails", |e| e.related("attachments", same)),
    )
    .related("conversation", same)
    .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tagMappings+dg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/emails.attachments+at1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/conversation+cvd1",
            "q/emailDrafts+dr1"
        ])
    );
    assert_eq!(
        w.delete("ticket_tag_mappings", "dg1"),
        ops(["q/tagMappings-dg1"])
    );
}

/// `supportTicketDetail` by id: the merged-in sources with their ticket,
/// the caller's drafts and reads; editing a source ticket replaces it in
/// the nested part.
#[test]
fn support_ticket_detail() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = caller_drafts_and_reads(zql("tickets").eq("id", "d1").related("referencesIn", |r| {
        r.eq("relationType", "MERGED_INTO")
            .related("sourceTicket", same)
    }))
    .related("conversation", same)
    .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/referencesIn+dr-m",
            "q/referencesIn.sourceTicket+d2",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/conversation+cvd1",
            "q/emailDrafts+dr1"
        ])
    );
    assert_eq!(
        w.update(
            "tickets",
            &with(&d2(), row!["title" => "Cannot log in (merged)"])
        ),
        ops(["q/referencesIn.sourceTicket+d2"])
    );
}

/// `supportTicketDetailV2` by human id and workspace: the merged-in
/// sources alone.
#[test]
fn support_ticket_detail_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("xyneId", "D-1")
        .eq("workspaceId", "ws-1")
        .related("referencesIn", |r| {
            r.eq("relationType", "MERGED_INTO")
                .related("sourceTicket", same)
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/referencesIn+dr-m",
            "q/referencesIn.sourceTicket+d2"
        ])
    );
    assert_eq!(
        w.delete("ticket_reference_mappings", "dr-m"),
        ops(["q/referencesIn-dr-m", "q/referencesIn.sourceTicket-d2"])
    );
}

/// `supportTicketsPage`: the caller's tickets of a channel below a
/// creation cursor; reassigning a ticket to the caller brings it and its
/// emails.
#[test]
fn support_tickets_page() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .eq("assignedTo", ME)
        .order_by("createdAt", DESC)
        .start(&[("createdAt", DESC, 500.into())], false)
        .limit(10)
        .related("project", same)
        .related("tags", same)
        .related("entity", same)
        .related("emails", same)
        .related("conversation", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/conversation+cvd1"
        ])
    );
    assert_eq!(
        w.update("tickets", &with(&d2(), row!["assignedTo" => ME])),
        ops(["q/main+d2", "q/emails+em3", "q/conversation+cvd2"])
    );
}

/// `supportTicketsPageV2`: ordered by last email, with attachments,
/// drafts and reads; deleting an email takes its attachment.
#[test]
fn support_tickets_page_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = caller_drafts_and_reads(
        zql("tickets")
            .eq("channelId", "c-desk")
            .filter(or(vec![eq("assignedTo", ME)]))
            .filter(or(vec![eq("priority", "HIGH")]))
            .order_by("lastEmailAt", DESC)
            .start(&[("lastEmailAt", DESC, 500.into())], false)
            .limit(10)
            .related("project", same)
            .related("tags", same)
            .related("entity", same)
            .related("emails", |e| e.related("attachments", same)),
    )
    .related("conversation", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/project+p1",
            "q/tags+dtg1",
            "q/emails+em1",
            "q/emails+em2",
            "q/emails.attachments+at1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/conversation+cvd1",
            "q/emailDrafts+dr1"
        ])
    );
    assert_eq!(
        w.delete("emails", "em1"),
        ops(["q/emails-em1", "q/emails.attachments-at1"])
    );
}

/// `supportTicketsPageV3` in the Starred folder: an existence test on the
/// caller's mailbox overlay, also related for the client's folder logic;
/// starring another ticket brings it with its drafts and reads.
#[test]
fn support_tickets_page_v3() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .eq("isArchived", false)
        .where_exists("userMailbox", |m| {
            m.eq("userId", ME)
                .eq("starred", true)
                .filter(or(vec![eq("state", "INBOX"), eq("state", "ARCHIVED")]))
        })
        .order_by("lastEmailAt", DESC)
        .order_by("id", DESC)
        .limit(10)
        .related("emailDrafts", |d| d.eq("userId", ME))
        .related("emailReads", |r| r.eq("userId", ME))
        .related("userMailbox", |m| m.eq("userId", ME))
        .related("formEntityValues", |f| {
            f.eq("fieldId", "__no_dynamic_field_filters__")
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+d2", "q/has:userMailbox+mb2", "q/userMailbox+mb2"])
    );
    assert_eq!(
        w.update(
            "ticket_user_mailbox",
            &with(&mb1(), row!["starred" => true, "state" => "INBOX"])
        ),
        ops([
            "q/has:userMailbox+mb1",
            "q/main+d1",
            "q/userMailbox+mb1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1"
        ])
    );
}

/// `supportTicketsPageV4` in the Sent folder: tickets the caller sent an
/// outbound email on; re-attributing that email drops the ticket and its
/// relations.
#[test]
fn support_tickets_page_v4() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c-desk")
        .eq("isArchived", false)
        .where_exists("emails", |e| {
            e.in_("type", &["REPLY", "REPLY_ALL", "COMPOSE"])
                .eq("sentByUserId", ME)
        })
        .order_by("lastEmailAt", DESC)
        .order_by("id", DESC)
        .limit(10)
        .related("emailDrafts", |d| d.eq("userId", ME))
        .related("emailReads", |r| r.eq("userId", ME))
        .related("userMailbox", |m| m.eq("userId", ME))
        .related("formEntityValues", |f| {
            f.eq("fieldId", "__no_dynamic_field_filters__")
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+d1",
            "q/has:emails+em1",
            "q/emailDrafts+dr2",
            "q/emailReads+rd1",
            "q/userMailbox+mb1"
        ])
    );
    assert_eq!(
        w.update("emails", &with(&em1(), row!["sentByUserId" => "u-2"])),
        ops([
            "q/has:emails-em1",
            "q/main-d1",
            "q/emailDrafts-dr2",
            "q/emailReads-rd1",
            "q/userMailbox-mb1"
        ])
    );
}

/// `getAllMerchants`: every merchant by mid.
#[test]
fn get_all_merchants() {
    let mut w = World::new();
    seed_desk(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("merchants").order_by("mid", ASC)),
        ops(["q/main+m-1", "q/main+m-2"])
    );
    assert_eq!(
        w.insert("merchants", row!["id" => "m-3", "mid" => "M003"]),
        ops(["q/main+m-3"])
    );
}

/// `getEmailsForTicket`: the emails of one thread.
#[test]
fn get_emails_for_ticket() {
    let mut w = World::new();
    seed_desk(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("emails").eq("conversationId", "cvd1")),
        ops(["q/main+em1", "q/main+em2"])
    );
    assert_eq!(
        w.insert("emails", row!["id" => "em4", "conversationId" => "cvd1", "channelId" => "c-desk", "type" => "INBOUND", "createdAt" => 40]),
        ops(["q/main+em4"])
    );
}

/// `getEmailsForConversations`: the emails of several threads with their
/// attachments; the empty-list guard the query ships matches nothing.
#[test]
fn get_emails_for_conversations() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("emails")
        .in_("conversationId", &["cvd1", "cvd2"])
        .related("attachments", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+em1",
            "q/main+em2",
            "q/main+em3",
            "q/attachments+at1"
        ])
    );
    let none = zql("emails")
        .eq("conversationId", "__no_match__")
        .related("attachments", same);
    assert_eq!(w.subscribe("none", &none), ops([]));
}

/// `getEmailsForConversationsV2`: the same with channel membership known.
#[test]
fn get_emails_for_conversations_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("emails")
        .in_("conversationId", &["cvd1", "cvd2"])
        .related("attachments", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+em1",
            "q/main+em2",
            "q/main+em3",
            "q/attachments+at1"
        ])
    );
    assert_eq!(
        w.delete("message_attachments", "at1"),
        ops(["q/attachments-at1"])
    );
}

/// `getDraftForConversation`: the drafts of a thread visible to the
/// caller: the caller's own and the AI draft with no user.
#[test]
fn get_draft_for_conversation() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("email_drafts")
        .eq("conversationId", "cvd1")
        .filter(or(vec![eq("userId", ME), is_null("userId")]))
        .order_by("updatedAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+dr1", "q/main+dr2"]));
    assert_eq!(
        w.insert("email_drafts", row!["id" => "dr5", "conversationId" => "cvd1", "channelId" => "c-desk", "updatedAt" => 50]),
        ops(["q/main+dr5"])
    );
}

/// `getDraftForConversationV2`: the same with channel membership known.
#[test]
fn get_draft_for_conversation_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("email_drafts")
        .eq("conversationId", "cvd1")
        .filter(or(vec![eq("userId", ME), is_null("userId")]))
        .order_by("updatedAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+dr1", "q/main+dr2"]));
    assert_eq!(
        w.insert("email_drafts", row!["id" => "dr6", "conversationId" => "cvd1", "userId" => ME, "channelId" => "c-desk", "updatedAt" => 60]),
        ops(["q/main+dr6"])
    );
}

/// `composeDraftsByChannel`: the caller's compose drafts, those with no
/// conversation.
#[test]
fn compose_drafts_by_channel() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("email_drafts")
        .eq("channelId", "c-desk")
        .eq("userId", ME)
        .where_is_null("conversationId")
        .order_by("updatedAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+dr3"]));
    assert_eq!(w.delete("email_drafts", "dr3"), ops(["q/main-dr3"]));
}

/// `userEmailDrafts`: the caller's reply drafts of a channel with their
/// ticket, below an update cursor.
#[test]
fn user_email_drafts() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("email_drafts")
        .eq("channelId", "c-desk")
        .eq("userId", ME)
        .where_is_not_null("conversationId")
        .order_by("updatedAt", DESC)
        .order_by("id", DESC)
        .start(&[("updatedAt", DESC, 100.into())], false)
        .limit(10)
        .related("ticket", same);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+dr2", "q/ticket+d1"]));
    assert_eq!(
        w.delete("email_drafts", "dr2"),
        ops(["q/main-dr2", "q/ticket-d1"])
    );
}

/// `userEmailsSent` for the caller: outbound emails in a channel with
/// their ticket, in a channel the caller may see (public, or a
/// participant).
#[test]
fn user_emails_sent() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("emails")
        .eq("channelId", "c-desk")
        .in_("type", &["REPLY", "REPLY_ALL", "COMPOSE"])
        .eq("sentByUserId", ME)
        .where_exists("channel", |ch| {
            let mut ch = ch;
            let member = ch.exists("participants", |p| p.eq("userId", ME));
            ch.filter(or(vec![eq("visibility", "PUBLIC"), member]))
        })
        .order_by("createdAt", DESC)
        .order_by("id", DESC)
        .limit(10)
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+em1", "q/ticket+d1", "q/has:channel+c-desk"])
    );
    assert_eq!(
        w.insert("emails", row!["id" => "em5", "conversationId" => "cvd2", "channelId" => "c-desk", "type" => "COMPOSE", "sentByUserId" => ME, "createdAt" => 40]),
        ops(["q/main+em5", "q/ticket+d2"])
    );
}

/// `conversationLabelsByChannelId`: a channel's labels by name.
#[test]
fn conversation_labels_by_channel_id() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("conversation_labels")
        .eq("channelId", "c-desk")
        .order_by("name", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+lb1"]));
    assert_eq!(
        w.insert(
            "conversation_labels",
            row!["id" => "lb2", "channelId" => "c-desk", "name" => "billing", "color" => "blue"]
        ),
        ops(["q/main+lb2"])
    );
}

/// `conversationLabelsByChannelIdV2`: the same with membership known.
#[test]
fn conversation_labels_by_channel_id_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("conversation_labels")
        .eq("channelId", "c-desk")
        .order_by("name", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+lb1"]));
    assert_eq!(w.delete("conversation_labels", "lb1"), ops(["q/main-lb1"]));
}

/// `conversationLabelMappingsByConversationId`: a thread's labels.
#[test]
fn conversation_label_mappings_by_conversation_id() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("conversation_label_mappings")
        .eq("conversationId", "cvd1")
        .order_by("labelName", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+lm1"]));
    assert_eq!(
        w.delete("conversation_label_mappings", "lm1"),
        ops(["q/main-lm1"])
    );
}

/// `conversationLabelMappingsByConversationIdV2`: the same with membership
/// known.
#[test]
fn conversation_label_mappings_by_conversation_id_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("conversation_label_mappings")
        .eq("conversationId", "cvd1")
        .order_by("labelName", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+lm1"]));
    assert_eq!(
        w.insert("conversation_label_mappings", row!["id" => "lm2", "conversationId" => "cvd1", "labelId" => "lb2", "labelName" => "billing", "channelId" => "c-desk", "createdAt" => 2]),
        ops(["q/main+lm2"])
    );
}

/// `conversationLabelMappingsByLabelId`: the threads carrying a label,
/// each with its ticket.
#[test]
fn conversation_label_mappings_by_label_id() {
    let mut w = World::new();
    seed_desk(&mut w);
    let q = zql("conversation_label_mappings")
        .eq("labelId", "lb1")
        .related("conversation", |c| c.related("ticket", same))
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+lm1",
            "q/conversation+cvd1",
            "q/conversation.ticket+d1"
        ])
    );
    assert_eq!(
        w.insert("conversation_label_mappings", row!["id" => "lm3", "conversationId" => "cvd2", "labelId" => "lb1", "labelName" => "vip", "channelId" => "c-desk", "createdAt" => 3]),
        ops(["q/main+lm3", "q/conversation+cvd2", "q/conversation.ticket+d2"])
    );
}

/// `myTicketMailbox`: the mailbox overlays of a ticket.
#[test]
fn my_ticket_mailbox() {
    let mut w = World::new();
    seed_desk(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("ticket_user_mailbox").eq("ticketId", "d1")),
        ops(["q/main+mb1"])
    );
    assert_eq!(w.delete("ticket_user_mailbox", "mb1"), ops(["q/main-mb1"]));
}

/// `myTicketMailboxV2`: the same with membership known; an edit is a
/// replace pair.
#[test]
fn my_ticket_mailbox_v2() {
    let mut w = World::new();
    seed_desk(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("ticket_user_mailbox").eq("ticketId", "d1")),
        ops(["q/main+mb1"])
    );
    assert_eq!(
        w.update(
            "ticket_user_mailbox",
            &with(&mb1(), row!["state" => "INBOX"])
        ),
        ops(["q/main+mb1"])
    );
}

/// `getEmailChannelPreference`: the desk settings row of a channel.
#[test]
fn get_email_channel_preference() {
    let mut w = World::new();
    w.seed(
        "email_channel_preferences",
        row!["channelId" => "c-desk", "deskType" => "EMAIL", "sendAsEmail" => true],
    );
    assert_eq!(
        w.subscribe(
            "q",
            &zql("email_channel_preferences").eq("channelId", "c-desk")
        ),
        ops(["q/main+c-desk"])
    );
    assert_eq!(
        w.update(
            "email_channel_preferences",
            row!["channelId" => "c-desk", "deskType" => "EMAIL", "sendAsEmail" => false]
        ),
        ops(["q/main+c-desk"])
    );
}

/// `getClassificationMappings`: a channel's category routing, oldest
/// first.
#[test]
fn get_classification_mappings() {
    let mut w = World::new();
    w.seed("classification_mappings", row!["id" => "cm1", "channelId" => "c-desk", "category" => "billing", "userGroupId" => "g1", "createdAt" => 1]);
    let q = zql("classification_mappings")
        .eq("channelId", "c-desk")
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cm1"]));
    assert_eq!(
        w.insert("classification_mappings", row!["id" => "cm2", "channelId" => "c-desk", "category" => "login", "userGroupId" => "g2", "createdAt" => 2]),
        ops(["q/main+cm2"])
    );
}

/// `userEmailSignatures`: the caller's signatures by name.
#[test]
fn user_email_signatures() {
    let mut w = World::new();
    w.seed(
        "email_signatures",
        row!["id" => "sg1", "userId" => ME, "name" => "Default", "isDefault" => true],
    );
    w.seed(
        "email_signatures",
        row!["id" => "sg2", "userId" => "u-2", "name" => "Work"],
    );
    let q = zql("email_signatures")
        .eq("userId", ME)
        .order_by("name", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+sg1"]));
    assert_eq!(
        w.insert(
            "email_signatures",
            row!["id" => "sg3", "userId" => ME, "name" => "Short"]
        ),
        ops(["q/main+sg3"])
    );
}
