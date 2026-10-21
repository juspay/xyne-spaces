//! The ticket queries: kanban and project boards, ticket detail, sub
//! tickets, workflows, RCAs and releases, one test per registry entry over
//! one board fixture.

use streamgres::model::ComparisonOperator::{GTE, LT, LTE, NEQ};
use streamgres::model::Order::{ASC, DESC};
use streamgres::model::Value;

use super::world::{ME, World, ops, with};
use super::zql::{cmp, eq, is_null, or, same, zql};

/// A full ticket image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// Ticket `t0`: on `b1`, assigned to and created by the caller, with no
/// `ticketType`, the row only `ticketType IS NULL` admits.
fn t0() -> Row {
    row!["id" => "t0", "boardId" => "b1", "projectId" => "p1", "stageName" => "Todo", "statusV2" => "OPEN",
         "assignedTo" => ME, "createdBy" => ME, "createdAt" => 50, "isArchived" => false, "priority" => "MEDIUM",
         "channelId" => "c1", "xyneId" => "X-0", "title" => "Untyped"]
    .to_vec()
}

/// Ticket `t1`: the fully connected one, on `b1`, Todo, HIGH, overdue,
/// assigned to the caller by prefix, created by `u-2`.
fn t1() -> Row {
    row!["id" => "t1", "boardId" => "b1", "projectId" => "p1", "stageName" => "Todo", "statusV2" => "OPEN",
         "assignedTo" => "user:u-me", "createdBy" => "u-2", "createdAt" => 100, "isArchived" => false,
         "ticketType" => "Task", "priority" => "HIGH", "channelId" => "c1", "conversationId" => "cv1",
         "xyneId" => "X-1", "title" => "Login bug", "userGroupId" => "g1", "eta" => 500, "isStageOverdue" => true]
    .to_vec()
}

/// Ticket `t2`: on `b1`, Done, LOW, created by the caller.
fn t2() -> Row {
    row!["id" => "t2", "boardId" => "b1", "projectId" => "p1", "stageName" => "Done", "statusV2" => "COMPLETED",
         "assignedTo" => "u-2", "createdBy" => ME, "createdAt" => 200, "isArchived" => false, "ticketType" => "Bug",
         "priority" => "LOW", "channelId" => "c1", "xyneId" => "X-2", "title" => "Slow page"]
    .to_vec()
}

/// Ticket `t3`: on `b2`, archived.
fn t3() -> Row {
    row!["id" => "t3", "boardId" => "b2", "projectId" => "p1", "stageName" => "Todo", "statusV2" => "OPEN",
         "assignedTo" => "u-3", "createdBy" => "u-3", "createdAt" => 300, "isArchived" => true, "ticketType" => "Task",
         "xyneId" => "X-3", "title" => "Old"]
    .to_vec()
}

/// Ticket `t4`: a Support ticket on `b1`, from the desk channel.
fn t4() -> Row {
    row!["id" => "t4", "boardId" => "b1", "projectId" => "p1", "stageName" => "Todo", "statusV2" => "OPEN",
         "assignedTo" => "u-3", "createdBy" => "u-3", "createdAt" => 400, "isArchived" => false,
         "ticketType" => "Support", "channelId" => "c-desk", "conversationId" => "cv4", "xyneId" => "X-4",
         "title" => "Desk"]
    .to_vec()
}

/// Release ticket `t-rel` on `p1`.
fn t_rel() -> Row {
    row!["id" => "t-rel", "projectId" => "p1", "ticketType" => "Release", "isArchived" => false, "createdAt" => 900,
         "title" => "Release 1.0", "xyneId" => "R-1"]
    .to_vec()
}

/// Assignment `a1`: `u-2` reviews `t1` in role `r1`.
fn a1() -> Row {
    row!["id" => "a1", "ticketId" => "t1", "userId" => "u-2", "userResponsibility" => "PR_REVIEWER", "roleId" => "r1"]
        .to_vec()
}

/// Workflow `w1`: a running flow of `t1`.
fn w1() -> Row {
    row!["id" => "w1", "ticketId" => "t1", "status" => "RUNNING", "workflowType" => "Flow", "createdAt" => 500].to_vec()
}

/// Stage request `sr1`: `t1` submitted for stage `st1` with form `f1`.
fn sr1() -> Row {
    row!["id" => "sr1", "ticketId" => "t1", "stageId" => "st1", "formId" => "f1", "status" => "SUBMITTED",
         "reviewerCommentMessageId" => "m-rev", "createdAt" => 10]
    .to_vec()
}

/// The Support exclusion of the board queries: `ticketType != 'Support'
/// OR ticketType IS NULL`, so an untyped ticket counts.
fn not_support() -> streamgres::model::Where {
    or(vec![
        cmp("ticketType", NEQ, "Support"),
        is_null("ticketType"),
    ])
}

/// The board: project `p1` with boards `b1` and `b2`, role `r1`, channels
/// `c1` (default) and `c-desk` (email) with a conversation each, tickets
/// `t0` to `t4`, two assignments, two stage ETAs, one tag in each model.
fn seed_board(w: &mut World) {
    w.seed(
        "projects",
        row!["id" => "p1", "name" => "Core", "type" => "PROJECT", "createdAt" => 1],
    );
    w.seed(
        "boards",
        row!["id" => "b1", "projectId" => "p1", "name" => "Dev", "createdAt" => 1],
    );
    w.seed(
        "boards",
        row!["id" => "b2", "projectId" => "p1", "name" => "Ops", "createdAt" => 2],
    );
    w.seed(
        "roles",
        row!["id" => "r1", "name" => "Reviewer", "isActive" => true, "createdAt" => 1],
    );
    w.seed(
        "channels",
        row!["id" => "c1", "type" => "DEFAULT", "visibility" => "PUBLIC"],
    );
    w.seed(
        "channels",
        row!["id" => "c-desk", "type" => "EMAIL", "visibility" => "PUBLIC"],
    );
    w.seed(
        "conversations",
        row!["conversationId" => "cv1", "channelId" => "c1", "ticketId" => "t1"],
    );
    w.seed(
        "conversations",
        row!["conversationId" => "cv4", "channelId" => "c-desk", "ticketId" => "t4"],
    );
    for ticket in [t0(), t1(), t2(), t3(), t4()] {
        w.seed("tickets", &ticket);
    }
    w.seed("ticket_assignments", &a1());
    w.seed(
        "ticket_assignments",
        row!["id" => "a2", "ticketId" => "t2", "userId" => "u-4", "userResponsibility" => "QA"],
    );
    w.seed(
        "ticket_stage_eta",
        row!["id" => "e1", "ticketId" => "t1", "stageEta" => 50],
    );
    w.seed(
        "ticket_stage_eta",
        row!["id" => "e2", "ticketId" => "t2", "stageEta" => 10, "stageLeftAt" => 20],
    );
    w.seed(
        "ticket_tag_mappings",
        row!["id" => "g1", "ticketId" => "t1", "tagId" => "tag1", "tagName" => "infra"],
    );
    w.seed(
        "ticket_tags",
        row!["id" => "tg1", "ticketId" => "t1", "name" => "infra"],
    );
}

/// The detail rows around `t1`: a reference to `t2`, an entity mapping, a
/// stage request with its form and reviewer message, two RCAs with an
/// impact and a COE, a pull request, a release ticket.
fn seed_detail(w: &mut World) {
    w.seed("ticket_reference_mappings", row!["id" => "rm1", "sourceTicketId" => "t1", "targetTicketId" => "t2", "relationType" => "BLOCKS"]);
    w.seed(
        "ticket_entity_mappings",
        row!["id" => "em1", "ticketId" => "t1", "entityType" => "SERVICE", "entityName" => "auth"],
    );
    w.seed(
        "forms",
        row!["id" => "f1", "formName" => "Review", "createdAt" => 1],
    );
    w.seed(
        "messages",
        row!["messageId" => "m-rev", "conversationId" => "cv1", "content" => "lgtm"],
    );
    w.seed("ticket_stage_requests", &sr1());
    w.seed(
        "rcas",
        row!["id" => "rc1", "ticketId" => "t1", "title" => "Outage", "createdAt" => 100],
    );
    w.seed(
        "rcas",
        row!["id" => "rc2", "ticketId" => "t1", "title" => "Regression", "createdAt" => 200],
    );
    w.seed(
        "impacts",
        row!["id" => "im1", "rcaId" => "rc1", "ticketId" => "t1", "impact" => "high"],
    );
    w.seed(
        "coes",
        row!["id" => "co1", "rcaId" => "rc1", "action" => "alerting", "status" => "OPEN"],
    );
    w.seed(
        "pull_requests",
        row!["id" => "pr1", "ticketId" => "t1", "prId" => 41, "date" => 10, "updatedAt" => 10],
    );
    w.seed("tickets", &t_rel());
}

/// Three workflows: `w1` running on `t1`, `w2` done on `t2`, `w-auto` an
/// automation.
fn seed_workflows(w: &mut World) {
    w.seed("workflows", &w1());
    w.seed("workflows", row!["id" => "w2", "ticketId" => "t2", "status" => "DONE", "workflowType" => "Flow", "createdAt" => 600]);
    w.seed("workflows", row!["id" => "w-auto", "status" => "DONE", "workflowType" => "Automations", "createdAt" => 700]);
}

/// Sub ticket `s1`, mapped to `t2`, with its conversation, listed under
/// `t1`.
fn seed_sub_tickets(w: &mut World) {
    w.seed(
        "conversations",
        row!["conversationId" => "cv2", "channelId" => "c1"],
    );
    w.seed("sub_tickets", row!["id" => "s1", "mappedTicketId" => "t2", "conversationId" => "cv2", "title" => "Part A", "createdBy" => ME]);
    w.seed(
        "ticket_sub_ticket_mappings",
        row!["id" => "m-s1", "ticketId" => "t1", "subTicketId" => "s1"],
    );
}

/// `allTickets`: every live ticket with project, assignments and stage
/// ETAs.
#[test]
fn all_tickets() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("isArchived", false)
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("assignments", same)
        .related("stageEtaEntries", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t0",
            "q/main+t1",
            "q/main+t2",
            "q/main+t4",
            "q/project+p1",
            "q/assignments+a1",
            "q/assignments+a2",
            "q/stageEtaEntries+e1",
            "q/stageEtaEntries+e2"
        ])
    );
    assert_eq!(
        w.insert(
            "tickets",
            row!["id" => "t5", "projectId" => "p1", "isArchived" => false, "createdAt" => 500]
        ),
        ops(["q/main+t5"])
    );
    assert_eq!(
        w.update("tickets", &with(&t1(), row!["isArchived" => true])),
        ops(["q/main-t1", "q/assignments-a1", "q/stageEtaEntries-e1"])
    );
}

/// `ticketsQuery` (board view of `b1`): root tickets (`rootId IS NULL`)
/// that are not Support tickets, the untyped `t0` included; a flow step
/// under `t1` is not admitted.
#[test]
fn tickets_query() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("boardId", "b1")
        .where_is_null("rootId")
        .filter(not_support())
        .order_by("createdAt", DESC)
        .related("assignments", same)
        .related("stageEtaEntries", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t0",
            "q/main+t1",
            "q/main+t2",
            "q/assignments+a1",
            "q/assignments+a2",
            "q/stageEtaEntries+e1",
            "q/stageEtaEntries+e2"
        ])
    );
    assert_eq!(
        w.insert("tickets", row!["id" => "t6", "boardId" => "b1", "ticketType" => "Task", "rootId" => "t1", "createdAt" => 600]),
        ops([])
    );
    assert_eq!(w.held("q", "main"), ["t0", "t1", "t2"]);
}

/// `ticketsQueryV2` (project view scoped to boards `b1`, `b2`): archived
/// tickets included, assignments carry their role.
#[test]
fn tickets_query_v2() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .in_("boardId", &["b1", "b2"])
        .where_is_null("rootId")
        .filter(not_support())
        .order_by("createdAt", DESC)
        .related("assignments", |a| a.related("role", same))
        .related("tagMappings", same)
        .related("stageEtaEntries", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t0",
            "q/main+t1",
            "q/main+t2",
            "q/main+t3",
            "q/assignments+a1",
            "q/assignments+a2",
            "q/assignments.role+r1",
            "q/tagMappings+g1",
            "q/stageEtaEntries+e1",
            "q/stageEtaEntries+e2"
        ])
    );
    assert_eq!(
        w.delete("ticket_assignments", "a1"),
        ops(["q/assignments-a1", "q/assignments.role-r1"])
    );
}

/// `kanbanTicketsPage` (board `b1`, column Todo, priority HIGH or MEDIUM,
/// a page of 10), the untyped `t0` included.
#[test]
fn kanban_tickets_page() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("stageName", "Todo")
        .eq("isArchived", false)
        .eq("boardId", "b1")
        .filter(not_support())
        .in_("priority", &["HIGH", "MEDIUM"])
        .order_by("createdAt", DESC)
        .order_by("id", ASC)
        .limit(10)
        .related("assignments", same)
        .related("stageEtaEntries", same)
        .related("tagMappings", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t0",
            "q/main+t1",
            "q/assignments+a1",
            "q/stageEtaEntries+e1",
            "q/tagMappings+g1"
        ])
    );
    assert_eq!(
        w.update(
            "tickets",
            &with(&t2(), row!["stageName" => "Todo", "priority" => "HIGH"])
        ),
        ops(["q/main+t2", "q/assignments+a2", "q/stageEtaEntries+e2"])
    );
}

/// `kanbanTicketsPageV2` with a role-assignment filter and overdue-only:
/// two existence tests on the same root, both required (their referenced
/// sets intersect), a keyset cursor rewritten as a `WHERE`; a left stage
/// (`stageLeftAt` set) does not count as overdue.
#[test]
fn kanban_tickets_page_v2() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("stageName", "Todo")
        .eq("isArchived", false)
        .eq("boardId", "b1")
        .where_("ticketType", NEQ, "Support")
        .where_exists("assignments", |a| {
            a.eq("roleId", "r1").in_("userId", &["u-2"])
        })
        .where_("statusV2", NEQ, "COMPLETED")
        .where_("statusV2", NEQ, "CANCELLED")
        .where_exists("stageEtaEntries", |e| {
            e.where_is_null("stageLeftAt").where_("stageEta", LT, 100)
        })
        .order_by("createdAt", DESC)
        .order_by("id", ASC)
        .start(
            &[("createdAt", DESC, 150.into()), ("id", ASC, "x".into())],
            false,
        )
        .limit(10)
        .related("assignments", |a| a.related("role", same))
        .related("stageEtaEntries", same)
        .related("tagMappings", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/assignments+a1",
            "q/assignments.role+r1",
            "q/stageEtaEntries+e1",
            "q/tagMappings+g1",
            "q/has:assignments+a1",
            "q/has:stageEtaEntries+e1"
        ])
    );
    let t7 = row!["id" => "t7", "boardId" => "b1", "stageName" => "Todo", "statusV2" => "OPEN", "isArchived" => false,
                  "ticketType" => "Task", "createdAt" => 120, "priority" => "HIGH"];
    assert_eq!(w.insert("tickets", t7), ops([]));
    assert_eq!(
        w.insert(
            "ticket_assignments",
            row!["id" => "a8", "ticketId" => "t7", "roleId" => "r1", "userId" => "u-2"]
        ),
        ops([])
    );
    assert_eq!(
        w.insert(
            "ticket_stage_eta",
            row!["id" => "e8", "ticketId" => "t7", "stageEta" => 10]
        ),
        ops([
            "q/assignments+a8",
            "q/has:assignments+a8",
            "q/has:stageEtaEntries+e8",
            "q/main+t7",
            "q/stageEtaEntries+e8"
        ])
    );
}

/// `kanbanTicketsPageV3`: the overdue flag is a column, the page is a
/// `createdAt` window `[createdAfter, cursor]`.
#[test]
fn kanban_tickets_page_v3() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("stageName", "Todo")
        .eq("isArchived", false)
        .eq("boardId", "b1")
        .where_is_null("rootId")
        .filter(not_support())
        .where_("statusV2", NEQ, "COMPLETED")
        .where_("statusV2", NEQ, "CANCELLED")
        .eq("isStageOverdue", true)
        .order_by("createdAt", DESC)
        .order_by("id", ASC)
        .where_("createdAt", LTE, 250)
        .where_("createdAt", GTE, 60)
        .limit(10)
        .related("assignments", |a| a.related("role", same))
        .related("tagMappings", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/assignments+a1",
            "q/assignments.role+r1",
            "q/tagMappings+g1"
        ])
    );
    assert_eq!(
        w.update("tickets", &with(&t1(), row!["isStageOverdue" => false])),
        ops([
            "q/main-t1",
            "q/assignments-a1",
            "q/assignments.role-r1",
            "q/tagMappings-g1"
        ])
    );
}

/// `workflowsPaginated` with status, type, creator and date filters and a
/// cursor; the creator filter is an existence test on the ticket. Gap L:
/// the `searchQuery` `ILIKE` branch cannot be stated.
#[test]
fn workflows_paginated() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_workflows(&mut w);
    let q = zql("workflows")
        .in_("status", &["RUNNING"])
        .in_("workflowType", &["Flow"])
        .where_exists("ticket", |t| t.in_("createdBy", &["u-2"]))
        .where_("createdAt", GTE, 0)
        .where_("createdAt", LTE, 1000)
        .order_by("createdAt", DESC)
        .start(&[("createdAt", DESC, 900.into())], false)
        .limit(5)
        .related("ticket", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+w1", "q/ticket+t1", "q/has:ticket+t1"])
    );
    assert_eq!(
        w.update("workflows", &with(&w1(), row!["status" => "DONE"])),
        ops(["q/has:ticket-t1", "q/main-w1", "q/ticket-t1"])
    );
}

/// `ticketById`: one ticket with every relation of the detail screen,
/// references in both directions back to `tickets`.
#[test]
fn ticket_by_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("id", "t1")
        .related("project", same)
        .related("tags", same)
        .related("assignments", same)
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same))
        .related("entity", same)
        .related("conversation", same)
        .related("stageEtaEntries", same)
        .related("ticketStageRequests", |a| a.related("form", same))
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/project+p1",
            "q/tags+tg1",
            "q/assignments+a1",
            "q/referencesOut+rm1",
            "q/referencesOut.targetTicket+t2",
            "q/entity+em1",
            "q/conversation+cv1",
            "q/stageEtaEntries+e1",
            "q/ticketStageRequests+sr1",
            "q/ticketStageRequests.form+f1"
        ])
    );
    assert_eq!(
        w.insert("ticket_reference_mappings", row!["id" => "rm2", "sourceTicketId" => "t2", "targetTicketId" => "t1", "relationType" => "BLOCKS"]),
        ops(["q/referencesIn+rm2", "q/referencesIn.sourceTicket+t2"])
    );
}

/// `ticketRowById`: the bare row; an edit is the replace pair, a delete
/// the removal.
#[test]
fn ticket_row_by_id() {
    let mut w = World::new();
    seed_board(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("tickets").eq("id", "t1").one()),
        ops(["q/main+t1"])
    );
    assert_eq!(
        w.update("tickets", &with(&t1(), row!["title" => "Login bug (prod)"])),
        ops(["q/main+t1"])
    );
    assert_eq!(w.delete("tickets", "t1"), ops(["q/main-t1"]));
}

/// `ticketByIdV2`: tag mappings and roles instead of the old tag model.
#[test]
fn ticket_by_id_v2() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("id", "t1")
        .related("project", same)
        .related("tagMappings", same)
        .related("assignments", |a| a.related("role", same))
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same))
        .related("entity", same)
        .related("conversation", same)
        .related("stageEtaEntries", same)
        .related("ticketStageRequests", |a| a.related("form", same))
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/project+p1",
            "q/tagMappings+g1",
            "q/assignments+a1",
            "q/assignments.role+r1",
            "q/referencesOut+rm1",
            "q/referencesOut.targetTicket+t2",
            "q/entity+em1",
            "q/conversation+cv1",
            "q/stageEtaEntries+e1",
            "q/ticketStageRequests+sr1",
            "q/ticketStageRequests.form+f1"
        ])
    );
    assert_eq!(
        w.delete("ticket_stage_requests", "sr1"),
        ops(["q/ticketStageRequests-sr1", "q/ticketStageRequests.form-f1"])
    );
}

/// `ticketDetailsById`: `ticketById` plus the latest RCA — the `rcas`
/// relation's `ORDER BY createdAt DESC LIMIT 1` is a window per ticket, so
/// only the newest RCA ships, and a newer one arriving replaces it.
#[test]
fn ticket_details_by_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("id", "t1")
        .related("project", same)
        .related("tags", same)
        .related("assignments", same)
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same))
        .related("entity", same)
        .related("conversation", same)
        .related("stageEtaEntries", same)
        .related("rcas", |r| r.order_by("createdAt", DESC).limit(1))
        .related("ticketStageRequests", |a| a.related("form", same))
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/project+p1",
            "q/tags+tg1",
            "q/assignments+a1",
            "q/referencesOut+rm1",
            "q/referencesOut.targetTicket+t2",
            "q/entity+em1",
            "q/conversation+cv1",
            "q/stageEtaEntries+e1",
            "q/rcas+rc2",
            "q/ticketStageRequests+sr1",
            "q/ticketStageRequests.form+f1"
        ])
    );
    assert_eq!(
        w.insert(
            "rcas",
            row!["id" => "rc3", "ticketId" => "t1", "title" => "Third", "createdAt" => 300]
        ),
        ops(["q/rcas+rc3", "q/rcas-rc2"])
    );
}

/// `ticketDetailsByIdV2`: the V2 relations plus RCAs; moving the ticket to
/// another project swaps the project part.
#[test]
fn ticket_details_by_id_v2() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    w.seed(
        "projects",
        row!["id" => "p2", "name" => "Edge", "type" => "PROJECT", "createdAt" => 2],
    );
    let q = zql("tickets")
        .eq("id", "t1")
        .related("project", same)
        .related("tagMappings", same)
        .related("assignments", |a| a.related("role", same))
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same))
        .related("entity", same)
        .related("conversation", same)
        .related("stageEtaEntries", same)
        .related("rcas", |r| r.order_by("createdAt", DESC).limit(1))
        .related("ticketStageRequests", |a| a.related("form", same))
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/project+p1",
            "q/tagMappings+g1",
            "q/assignments+a1",
            "q/assignments.role+r1",
            "q/referencesOut+rm1",
            "q/referencesOut.targetTicket+t2",
            "q/entity+em1",
            "q/conversation+cv1",
            "q/stageEtaEntries+e1",
            "q/rcas+rc2",
            "q/ticketStageRequests+sr1",
            "q/ticketStageRequests.form+f1"
        ])
    );
    assert_eq!(
        w.update("tickets", &with(&t1(), row!["projectId" => "p2"])),
        ops(["q/main+t1", "q/project-p1", "q/project+p2"])
    );
}

/// `ticketByXyneId`: lookup by the human id; a second ticket with the same
/// id in another workspace is invisible, one in this workspace waits in
/// the `.one()` buffer and surfaces when the shown ticket goes.
#[test]
fn ticket_by_xyne_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("xyneId", "X-1")
        .related("project", same)
        .related("tags", same)
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same))
        .related("entity", same)
        .related("conversation", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/project+p1",
            "q/tags+tg1",
            "q/referencesOut+rm1",
            "q/referencesOut.targetTicket+t2",
            "q/entity+em1",
            "q/conversation+cv1"
        ])
    );
    assert_eq!(
        w.insert(
            "tickets",
            row!["id" => "t8", "xyneId" => "X-1", "workspaceId" => "ws-2"]
        ),
        ops([])
    );
    assert_eq!(
        w.insert("tickets", row!["id" => "t9", "xyneId" => "X-1"]),
        ops([])
    );
    assert_eq!(
        w.delete("tickets", "t1"),
        ops([
            "q/main-t1",
            "q/project-p1",
            "q/tags-tg1",
            "q/referencesOut-rm1",
            "q/referencesOut.targetTicket-t2",
            "q/entity-em1",
            "q/conversation-cv1",
            "q/main+t9"
        ])
    );
}

/// `ticketByXyneIdV2`: the workspace is an explicit argument as well as
/// the backstop.
#[test]
fn ticket_by_xyne_id_v2() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("xyneId", "X-1")
        .eq("workspaceId", "ws-1")
        .related("project", same)
        .related("tags", same)
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same))
        .related("entity", same)
        .related("conversation", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/project+p1",
            "q/tags+tg1",
            "q/referencesOut+rm1",
            "q/referencesOut.targetTicket+t2",
            "q/entity+em1",
            "q/conversation+cv1"
        ])
    );
    assert_eq!(
        w.delete("ticket_reference_mappings", "rm1"),
        ops(["q/referencesOut-rm1", "q/referencesOut.targetTicket-t2"])
    );
}

/// `ticketByXyneIdV3`: tag mappings.
#[test]
fn ticket_by_xyne_id_v3() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("xyneId", "X-1")
        .eq("workspaceId", "ws-1")
        .related("project", same)
        .related("tagMappings", same)
        .related("referencesOut", |r| r.related("targetTicket", same))
        .related("referencesIn", |r| r.related("sourceTicket", same))
        .related("entity", same)
        .related("conversation", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+t1",
            "q/project+p1",
            "q/tagMappings+g1",
            "q/referencesOut+rm1",
            "q/referencesOut.targetTicket+t2",
            "q/entity+em1",
            "q/conversation+cv1"
        ])
    );
    assert_eq!(
        w.insert(
            "ticket_tag_mappings",
            row!["id" => "g2", "ticketId" => "t1", "tagId" => "tag2", "tagName" => "urgent"]
        ),
        ops(["q/tagMappings+g2"])
    );
}

/// `ticketsByIds`: a literal id list, one id not yet existing.
#[test]
fn tickets_by_ids() {
    let mut w = World::new();
    seed_board(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("tickets").in_("id", &["t1", "t3", "t9"])),
        ops(["q/main+t1", "q/main+t3"])
    );
    assert_eq!(
        w.insert("tickets", row!["id" => "t9", "title" => "Late"]),
        ops(["q/main+t9"])
    );
}

/// `getWorkflowForTicket`: the workflows of one ticket, oldest first.
#[test]
fn get_workflow_for_ticket() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_workflows(&mut w);
    let q = zql("workflows")
        .eq("ticketId", "t1")
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+w1"]));
    assert_eq!(
        w.insert(
            "workflows",
            row!["id" => "w3", "ticketId" => "t1", "status" => "RUNNING", "createdAt" => 800]
        ),
        ops(["q/main+w3"])
    );
}

/// `automationsList`: workflows of type Automations, newest first.
#[test]
fn automations_list() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_workflows(&mut w);
    let q = zql("workflows")
        .eq("workflowType", "Automations")
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+w-auto"]));
    assert_eq!(
        w.update(
            "workflows",
            &with(&w1(), row!["workflowType" => "Automations"])
        ),
        ops(["q/main+w1"])
    );
}

/// `automationById`: one automation by id.
#[test]
fn automation_by_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_workflows(&mut w);
    let q = zql("workflows")
        .eq("id", "w-auto")
        .eq("workflowType", "Automations")
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+w-auto"]));
    assert_eq!(w.delete("workflows", "w-auto"), ops(["q/main-w-auto"]));
}

/// `subTicketsForTicket`: the mappings of one ticket with each sub
/// ticket's conversation and mapped ticket, three levels deep; dropping
/// the mapping prunes the whole branch.
#[test]
fn sub_tickets_for_ticket() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_sub_tickets(&mut w);
    let q = zql("ticket_sub_ticket_mappings")
        .eq("ticketId", "t1")
        .related("subTicket", |s| {
            s.related("conversation", same)
                .related("mappedTicket", same)
        })
        .order_by("id", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+m-s1",
            "q/subTicket+s1",
            "q/subTicket.conversation+cv2",
            "q/subTicket.mappedTicket+t2"
        ])
    );
    assert_eq!(
        w.delete("ticket_sub_ticket_mappings", "m-s1"),
        ops([
            "q/main-m-s1",
            "q/subTicket-s1",
            "q/subTicket.conversation-cv2",
            "q/subTicket.mappedTicket-t2"
        ])
    );
}

/// `subTicketMappingsForTickets`: the same over an id list; a second
/// mapping to an already-held sub ticket adds only itself.
#[test]
fn sub_ticket_mappings_for_tickets() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_sub_tickets(&mut w);
    let q = zql("ticket_sub_ticket_mappings")
        .in_("ticketId", &["t1", "t2"])
        .related("subTicket", |s| {
            s.related("conversation", same)
                .related("mappedTicket", same)
        })
        .order_by("id", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+m-s1",
            "q/subTicket+s1",
            "q/subTicket.conversation+cv2",
            "q/subTicket.mappedTicket+t2"
        ])
    );
    assert_eq!(
        w.insert(
            "ticket_sub_ticket_mappings",
            row!["id" => "m-s2", "ticketId" => "t2", "subTicketId" => "s1"]
        ),
        ops(["q/main+m-s2"])
    );
}

/// `subTicketsByMappedTicketId`: sub tickets mapped to `t2` with their
/// mappings.
#[test]
fn sub_tickets_by_mapped_ticket_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_sub_tickets(&mut w);
    let q = zql("sub_tickets")
        .eq("mappedTicketId", "t2")
        .related("ticketMappings", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+s1", "q/ticketMappings+m-s1"])
    );
    assert_eq!(
        w.insert(
            "ticket_sub_ticket_mappings",
            row!["id" => "m-s3", "ticketId" => "t4", "subTicketId" => "s1"]
        ),
        ops(["q/ticketMappings+m-s3"])
    );
}

/// `subTicketByMappedTicketId`: the single sub ticket of `t2`.
#[test]
fn sub_ticket_by_mapped_ticket_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_sub_tickets(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("sub_tickets").eq("mappedTicketId", "t2").one()),
        ops(["q/main+s1"])
    );
    assert_eq!(w.delete("sub_tickets", "s1"), ops(["q/main-s1"]));
}

/// `ticketAssignmentsByTicketId`: an assignment moving to another ticket
/// leaves the set.
#[test]
fn ticket_assignments_by_ticket_id() {
    let mut w = World::new();
    seed_board(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("ticket_assignments").eq("ticketId", "t1")),
        ops(["q/main+a1"])
    );
    assert_eq!(
        w.insert(
            "ticket_assignments",
            row!["id" => "a5", "ticketId" => "t1", "userId" => "u-5", "userResponsibility" => "QA"]
        ),
        ops(["q/main+a5"])
    );
    assert_eq!(
        w.update("ticket_assignments", &with(&a1(), row!["ticketId" => "t2"])),
        ops(["q/main-a1"])
    );
}

/// `ticketsByProject`: live non-Support tickets of `p1` with tags; a
/// Support ticket retyped joins. The untyped `t0` is left out, as in
/// the client: this filter has no `IS NULL` half.
#[test]
fn tickets_by_project() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("projectId", "p1")
        .eq("isArchived", false)
        .where_("ticketType", NEQ, "Support")
        .related("tags", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+t1", "q/main+t2", "q/tags+tg1"])
    );
    assert_eq!(
        w.update("tickets", &with(&t4(), row!["ticketType" => "Task"])),
        ops(["q/main+t4"])
    );
}

/// `ticketsByProjectV2`: tag mappings.
#[test]
fn tickets_by_project_v2() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("projectId", "p1")
        .eq("isArchived", false)
        .where_("ticketType", NEQ, "Support")
        .related("tagMappings", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+t1", "q/main+t2", "q/tagMappings+g1"])
    );
    assert_eq!(
        w.delete("ticket_tag_mappings", "g1"),
        ops(["q/tagMappings-g1"])
    );
}

/// `ticketActivities`: the activity log of one ticket, newest first.
#[test]
fn ticket_activities() {
    let mut w = World::new();
    seed_board(&mut w);
    w.seed(
        "ticket_activities",
        row!["id" => "ta1", "ticketId" => "t1", "timestamp" => 100, "activityType" => "CREATED"],
    );
    w.seed(
        "ticket_activities",
        row!["id" => "ta2", "ticketId" => "t1", "timestamp" => 200, "activityType" => "ASSIGNED"],
    );
    w.seed(
        "ticket_activities",
        row!["id" => "ta3", "ticketId" => "t2", "timestamp" => 300, "activityType" => "CREATED"],
    );
    let q = zql("ticket_activities")
        .eq("ticketId", "t1")
        .order_by("timestamp", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ta1", "q/main+ta2"]));
    assert_eq!(
        w.insert(
            "ticket_activities",
            row!["id" => "ta4", "ticketId" => "t1", "timestamp" => 400, "activityType" => "MOVED"]
        ),
        ops(["q/main+ta4"])
    );
}

/// `ticketActivitiesForTickets`: a page across several tickets below a
/// timestamp cursor.
#[test]
fn ticket_activities_for_tickets() {
    let mut w = World::new();
    seed_board(&mut w);
    w.seed(
        "ticket_activities",
        row!["id" => "ta1", "ticketId" => "t1", "timestamp" => 100, "activityType" => "CREATED"],
    );
    w.seed(
        "ticket_activities",
        row!["id" => "ta2", "ticketId" => "t1", "timestamp" => 200, "activityType" => "ASSIGNED"],
    );
    w.seed(
        "ticket_activities",
        row!["id" => "ta3", "ticketId" => "t2", "timestamp" => 300, "activityType" => "CREATED"],
    );
    let q = zql("ticket_activities")
        .in_("ticketId", &["t1", "t2"])
        .order_by("timestamp", DESC)
        .order_by("id", DESC)
        .start(&[("timestamp", DESC, 150.into())], false)
        .limit(10);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ta1"]));
    assert_eq!(
        w.insert(
            "ticket_activities",
            row!["id" => "ta5", "ticketId" => "t2", "timestamp" => 120, "activityType" => "MOVED"]
        ),
        ops(["q/main+ta5"])
    );
}

/// `ticketExportsForCurrentUser`: the hundred newest exports.
#[test]
fn ticket_exports_for_current_user() {
    let mut w = World::new();
    w.seed(
        "ticket_exports",
        row!["id" => "x1", "requestedBy" => ME, "status" => "DONE", "createdAt" => 1],
    );
    w.seed(
        "ticket_exports",
        row!["id" => "x2", "requestedBy" => ME, "status" => "RUNNING", "createdAt" => 2],
    );
    let q = zql("ticket_exports").order_by("createdAt", DESC).limit(100);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+x1", "q/main+x2"]));
    assert_eq!(
        w.insert(
            "ticket_exports",
            row!["id" => "x3", "requestedBy" => ME, "status" => "QUEUED", "createdAt" => 3]
        ),
        ops(["q/main+x3"])
    );
}

/// `getAllTicketEntityMappings`: the whole table.
#[test]
fn get_all_ticket_entity_mappings() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("ticket_entity_mappings")),
        ops(["q/main+em1"])
    );
    assert_eq!(
        w.insert("ticket_entity_mappings", row!["id" => "em2", "ticketId" => "t2", "entityType" => "SERVICE", "entityName" => "web"]),
        ops(["q/main+em2"])
    );
}

/// `getAllTicketTags`: the whole (old model) tag table.
#[test]
fn get_all_ticket_tags() {
    let mut w = World::new();
    seed_board(&mut w);
    assert_eq!(w.subscribe("q", &zql("ticket_tags")), ops(["q/main+tg1"]));
    assert_eq!(w.delete("ticket_tags", "tg1"), ops(["q/main-tg1"]));
}

/// Project tags `alpha`, `infra`, `zeta` on `p1`.
fn seed_project_tags(w: &mut World) {
    w.seed(
        "project_tags",
        row!["id" => "pt1", "projectId" => "p1", "name" => "alpha", "createdAt" => 1],
    );
    w.seed(
        "project_tags",
        row!["id" => "pt2", "projectId" => "p1", "name" => "infra", "createdAt" => 2],
    );
    w.seed(
        "project_tags",
        row!["id" => "pt3", "projectId" => "p1", "name" => "zeta", "createdAt" => 3],
    );
}

/// `projectTagsByProjectId`: a name-ordered page after the cursor
/// `(name 'b', id 'x')`, spelled as a `WHERE`.
#[test]
fn project_tags_by_project_id() {
    let mut w = World::new();
    seed_project_tags(&mut w);
    let q = zql("project_tags")
        .eq("projectId", "p1")
        .order_by("name", ASC)
        .order_by("id", ASC)
        .start(&[("name", ASC, "b".into()), ("id", ASC, "x".into())], false)
        .limit(100);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+pt2", "q/main+pt3"]));
    assert_eq!(
        w.insert(
            "project_tags",
            row!["id" => "pt4", "projectId" => "p1", "name" => "beta", "createdAt" => 4]
        ),
        ops(["q/main+pt4"])
    );
}

/// `projectTagsByProjectIds`: several projects at once; the empty-list
/// guard the query ships (`id = 'nonexistent' LIMIT 0`) is permanently
/// empty.
#[test]
fn project_tags_by_project_ids() {
    let mut w = World::new();
    seed_project_tags(&mut w);
    let q = zql("project_tags")
        .in_("projectId", &["p1", "p2"])
        .order_by("name", ASC)
        .order_by("id", ASC)
        .limit(100);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+pt1", "q/main+pt2", "q/main+pt3"])
    );
    assert_eq!(
        w.subscribe(
            "none",
            &zql("project_tags").eq("id", "nonexistent").limit(0)
        ),
        ops([])
    );
    assert_eq!(
        w.insert(
            "project_tags",
            row!["id" => "pt5", "projectId" => "p2", "name" => "omega", "createdAt" => 5]
        ),
        ops(["q/main+pt5"])
    );
}

/// `getTicketEntityMappingsByTicketId`: the entity mappings of one ticket.
#[test]
fn get_ticket_entity_mappings_by_ticket_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("ticket_entity_mappings").eq("ticketId", "t1")),
        ops(["q/main+em1"])
    );
    assert_eq!(
        w.delete("ticket_entity_mappings", "em1"),
        ops(["q/main-em1"])
    );
}

/// `sdlcTicketsByIds`: tickets with their pull requests. Gap O: the
/// relation's ordering is the client's.
#[test]
fn sdlc_tickets_by_ids() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .in_("id", &["t1"])
        .related("pullRequests", |p| p.order_by("updatedAt", DESC));
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+t1", "q/pullRequests+pr1"])
    );
    assert_eq!(
        w.insert(
            "pull_requests",
            row!["id" => "pr2", "ticketId" => "t1", "prId" => 42, "date" => 20, "updatedAt" => 20]
        ),
        ops(["q/pullRequests+pr2"])
    );
}

/// `sdlcTicketsByChannel`: live root tickets of a hub, the untyped `t0`
/// included.
#[test]
fn sdlc_tickets_by_channel() {
    let mut w = World::new();
    seed_board(&mut w);
    let q = zql("tickets")
        .eq("channelId", "c1")
        .eq("isArchived", false)
        .where_is_null("rootId")
        .filter(not_support());
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+t0", "q/main+t1", "q/main+t2"])
    );
    assert_eq!(
        w.update("tickets", &with(&t2(), row!["isArchived" => true])),
        ops(["q/main-t2"])
    );
}

/// `releaseTickets`: live release tickets, newest first.
#[test]
fn release_tickets() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("ticketType", "Release")
        .eq("isArchived", false)
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+t-rel"]));
    assert_eq!(
        w.insert("tickets", row!["id" => "t-rel2", "ticketType" => "Release", "isArchived" => false, "createdAt" => 950]),
        ops(["q/main+t-rel2"])
    );
}

/// `releaseTicketsByProjectId`: the hundred newest releases of a project.
#[test]
fn release_tickets_by_project_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("ticketType", "Release")
        .eq("projectId", "p1")
        .eq("isArchived", false)
        .order_by("createdAt", DESC)
        .limit(100);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+t-rel"]));
    assert_eq!(
        w.update("tickets", &with(&t_rel(), row!["isArchived" => true])),
        ops(["q/main-t-rel"])
    );
}

/// `releaseTicketsSearch` without a search term. Gap L: the `ILIKE` over
/// `xyneId` and `title` cannot be stated.
#[test]
fn release_tickets_search() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .eq("ticketType", "Release")
        .order_by("createdAt", DESC)
        .limit(10);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+t-rel"]));
}

/// `ticketsSearch` without a search term: neither Release nor Support;
/// the untyped `t0` is excluded here in the client as well. Gap L for the term.
#[test]
fn tickets_search() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("tickets")
        .where_("ticketType", NEQ, "Release")
        .where_("ticketType", NEQ, "Support")
        .order_by("createdAt", DESC)
        .limit(10);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+t1", "q/main+t2", "q/main+t3"])
    );
}

/// `subTicketsByIds`: a literal id list.
#[test]
fn sub_tickets_by_ids() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_sub_tickets(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("sub_tickets").in_("id", &["s1", "s9"])),
        ops(["q/main+s1"])
    );
}

/// `getTicketStageRequests`: the stage requests of a ticket with the
/// reviewer's comment message.
#[test]
fn get_ticket_stage_requests() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("ticket_stage_requests")
        .eq("ticketId", "t1")
        .related("reviewerCommentMessage", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+sr1", "q/reviewerCommentMessage+m-rev"])
    );
    assert_eq!(
        w.delete("messages", "m-rev"),
        ops(["q/reviewerCommentMessage-m-rev"])
    );
}

/// `getOpenTicketStageRequestsByStageId`: draft or submitted requests of a
/// stage; approval removes one.
#[test]
fn get_open_ticket_stage_requests_by_stage_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("ticket_stage_requests")
        .eq("stageId", "st1")
        .filter(or(vec![eq("status", "DRAFT"), eq("status", "SUBMITTED")]));
    assert_eq!(w.subscribe("q", &q), ops(["q/main+sr1"]));
    assert_eq!(
        w.update(
            "ticket_stage_requests",
            &with(&sr1(), row!["status" => "APPROVED"])
        ),
        ops(["q/main-sr1"])
    );
}

/// `allRCAsPaginated`: RCAs newest first below a cursor, with their
/// ticket.
#[test]
fn all_rcas_paginated() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("rcas")
        .order_by("createdAt", DESC)
        .related("ticket", same)
        .start(&[("createdAt", DESC, 150.into())], false)
        .limit(10);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+rc1", "q/ticket+t1"]));
    assert_eq!(
        w.insert(
            "rcas",
            row!["id" => "rc0", "ticketId" => "t2", "title" => "Early", "createdAt" => 5]
        ),
        ops(["q/main+rc0", "q/ticket+t2"])
    );
}

/// `rcaById`: one RCA with impacts, COEs and ticket.
#[test]
fn rca_by_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("rcas")
        .eq("id", "rc1")
        .related("impacts", same)
        .related("coes", same)
        .related("ticket", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+rc1", "q/impacts+im1", "q/coes+co1", "q/ticket+t1"])
    );
    assert_eq!(
        w.insert(
            "coes",
            row!["id" => "co2", "rcaId" => "rc1", "action" => "runbook", "status" => "OPEN"]
        ),
        ops(["q/coes+co2"])
    );
}

/// `rcaByTicketId`: the RCA of a ticket — `.one()` shows the first by id
/// though `t1` has two.
#[test]
fn rca_by_ticket_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    let q = zql("rcas")
        .eq("ticketId", "t1")
        .related("impacts", same)
        .related("coes", same)
        .related("ticket", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+rc1", "q/impacts+im1", "q/coes+co1", "q/ticket+t1"])
    );
}

/// `releaseAttributionsByTicketId`: attributions of a ticket, newest first.
#[test]
fn release_attributions_by_ticket_id() {
    let mut w = World::new();
    w.seed("release_attributions", row!["id" => "ra1", "ticketId" => "t1", "releaseId" => "t-rel", "confidence" => 90, "createdAt" => 1]);
    let q = zql("release_attributions")
        .eq("ticketId", "t1")
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ra1"]));
    assert_eq!(
        w.insert("release_attributions", row!["id" => "ra2", "ticketId" => "t1", "releaseId" => "t-rel", "confidence" => 60, "createdAt" => 2]),
        ops(["q/main+ra2"])
    );
}

/// `applicationReleaseTicketsByReleaseId` with column data: the dev ticket
/// with its pull requests, workflows, tags and form values, and the sub
/// ticket with its mapped ticket. Gap O: the pull-request `LIMIT 1` is
/// not applied.
#[test]
fn application_release_tickets_by_release_id() {
    let mut w = World::new();
    seed_board(&mut w);
    seed_detail(&mut w);
    seed_workflows(&mut w);
    seed_sub_tickets(&mut w);
    w.seed(
        "form_fields",
        row!["id" => "ff1", "formId" => "f1", "fieldName" => "env", "fieldType" => "TEXT"],
    );
    w.seed("form_entity_values", row!["id" => "fev1", "entityId" => "t1", "entityType" => "TICKET", "fieldId" => "ff1", "actualFieldValue" => "\"prod\""]);
    w.seed("application_release_tickets", row!["id" => "art1", "releaseId" => "t-rel", "ticketId" => "t1", "applicationReleaseId" => "s1", "createdAt" => 10]);
    let q = zql("application_release_tickets")
        .eq("releaseId", "t-rel")
        .related("devTicket", |t| {
            t.one()
                .related("pullRequests", |p| p.order_by("date", DESC).limit(1))
                .related("workflows", same)
                .related("tags", same)
                .related("formEntityValues", same)
        })
        .related("subTicket", |s| {
            s.one().related("mappedTicket", |m| m.one())
        })
        .order_by("createdAt", DESC)
        .order_by("id", DESC)
        .limit(20);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+art1",
            "q/devTicket+t1",
            "q/devTicket.pullRequests+pr1",
            "q/devTicket.workflows+w1",
            "q/devTicket.tags+tg1",
            "q/devTicket.formEntityValues+fev1",
            "q/subTicket+s1",
            "q/subTicket.mappedTicket+t2"
        ])
    );
    assert_eq!(
        w.insert("application_release_tickets", row!["id" => "art2", "releaseId" => "t-rel", "ticketId" => "t2", "applicationReleaseId" => "s1", "createdAt" => 20]),
        ops(["q/main+art2", "q/devTicket+t2", "q/devTicket.workflows+w2"])
    );
}

/// `releaseChangesByReleaseId`: change anchors with their application.
#[test]
fn release_changes_by_release_id() {
    let mut w = World::new();
    w.seed(
        "applications",
        row!["id" => "app1", "name" => "api", "projectId" => "p1"],
    );
    w.seed("release_change_types", row!["id" => "rct1", "releaseId" => "t-rel", "applicationId" => "app1", "changeType" => "ENV", "createdAt" => 1]);
    let q = zql("release_change_types")
        .eq("releaseId", "t-rel")
        .related("application", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+rct1", "q/application+app1"])
    );
    assert_eq!(
        w.delete("release_change_types", "rct1"),
        ops(["q/main-rct1", "q/application-app1"])
    );
}

/// `releaseEventsByReleaseId`: the audit feed minus form saves.
#[test]
fn release_events_by_release_id() {
    let mut w = World::new();
    w.seed(
        "release_events",
        row!["id" => "ev1", "releaseId" => "t-rel", "eventName" => "TESTED", "createdAt" => 1],
    );
    w.seed(
        "release_events",
        row!["id" => "ev2", "releaseId" => "t-rel", "eventName" => "FORM_SAVED", "createdAt" => 2],
    );
    let q = zql("release_events")
        .eq("releaseId", "t-rel")
        .where_("eventName", NEQ, "FORM_SAVED")
        .order_by("createdAt", DESC)
        .order_by("id", DESC)
        .limit(50);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ev1"]));
    assert_eq!(w.insert("release_events", row!["id" => "ev3", "releaseId" => "t-rel", "eventName" => "FORM_SAVED", "createdAt" => 3]), ops([]));
    assert_eq!(
        w.insert(
            "release_events",
            row!["id" => "ev4", "releaseId" => "t-rel", "eventName" => "DEPLOYED", "createdAt" => 4]
        ),
        ops(["q/main+ev4"])
    );
}

/// Form values of release `t-rel`: an env-form value on field `ff1` and a
/// ticket value that is not a release form.
fn seed_release_values(w: &mut World) {
    w.seed(
        "form_fields",
        row!["id" => "ff1", "formId" => "f1", "fieldName" => "env", "fieldType" => "TEXT"],
    );
    w.seed(
        "form_fields",
        row!["id" => "ff-log", "formId" => "f1", "fieldName" => "changeLog", "fieldType" => "TEXT"],
    );
    w.seed("form_entity_values", row!["id" => "fev-r1", "contextId" => "t-rel", "entityType" => "RELEASE_ENV_FORM", "fieldId" => "ff1"]);
    w.seed("form_entity_values", row!["id" => "fev-r2", "contextId" => "t-rel", "entityType" => "RELEASE_MIGRATION_FORM", "fieldId" => "ff-log"]);
    w.seed("form_entity_values", row!["id" => "fev-r3", "contextId" => "t-rel", "entityType" => "TICKET", "fieldId" => "ff1"]);
}

/// `releaseChangeFormValuesByReleaseId`: env and migration form values of
/// a release with their field, the `changeLog` field excluded through an
/// `OR` of two existence tests (a form field or a global field named
/// otherwise).
#[test]
fn release_change_form_values_by_release_id() {
    let mut w = World::new();
    seed_release_values(&mut w);
    let mut q = zql("form_entity_values")
        .eq("contextId", "t-rel")
        .filter(or(vec![
            eq("entityType", "RELEASE_ENV_FORM"),
            eq("entityType", "RELEASE_MIGRATION_FORM"),
        ]));
    let form_field = q.exists("formField", |f| f.where_("fieldName", NEQ, "changeLog"));
    let global_field = q.exists("globalField", |g| g.where_("fieldName", NEQ, "changeLog"));
    let q = q
        .filter(or(vec![form_field, global_field]))
        .related("formField", same)
        .related("globalField", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+fev-r1", "q/formField+ff1", "q/has:formField+ff1"])
    );
    assert_eq!(
        w.delete("form_entity_values", "fev-r1"),
        ops(["q/main-fev-r1", "q/formField-ff1", "q/has:formField-ff1"])
    );
}

/// `releaseChangeLogValuesByReleaseId`: the change-log half, selected by
/// the same `OR` of existence tests on the field name.
#[test]
fn release_change_log_values_by_release_id() {
    let mut w = World::new();
    seed_release_values(&mut w);
    let mut q = zql("form_entity_values")
        .eq("contextId", "t-rel")
        .filter(or(vec![
            eq("entityType", "RELEASE_ENV_FORM"),
            eq("entityType", "RELEASE_MIGRATION_FORM"),
        ]));
    let form_field = q.exists("formField", |f| f.eq("fieldName", "changeLog"));
    let global_field = q.exists("globalField", |g| g.eq("fieldName", "changeLog"));
    let q = q
        .filter(or(vec![form_field, global_field]))
        .related("formField", same)
        .related("globalField", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+fev-r2",
            "q/formField+ff-log",
            "q/has:formField+ff-log"
        ])
    );
    assert_eq!(w.rows("q", "globalField"), 0);
}

/// `applicationsByProjectId`: the applications of a project.
#[test]
fn applications_by_project_id() {
    let mut w = World::new();
    w.seed(
        "applications",
        row!["id" => "app1", "name" => "api", "projectId" => "p1"],
    );
    w.seed(
        "applications",
        row!["id" => "app2", "name" => "web", "projectId" => "p2"],
    );
    assert_eq!(
        w.subscribe("q", &zql("applications").eq("projectId", "p1")),
        ops(["q/main+app1"])
    );
    assert_eq!(
        w.insert(
            "applications",
            row!["id" => "app3", "name" => "worker", "projectId" => "p1"]
        ),
        ops(["q/main+app3"])
    );
}
