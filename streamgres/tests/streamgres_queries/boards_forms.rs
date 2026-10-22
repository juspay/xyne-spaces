//! The project, board, stage, form and SLA queries, one test per registry
//! entry over one project fixture.

use streamgres::model::ComparisonOperator::NEQ;
use streamgres::model::Order::{ASC, DESC};

use super::world::{World, ops};
use super::zql::{same, zql};

/// Two projects and a DM pseudo-project; boards `b1`, `b2` on `p1` and
/// `b3` on `p2`; stages with a PR status mapping and an approver; forms
/// `f1` (board) and `f2` (stage) with fields, one on a global field; form
/// mappings for boards and a stage; form values on a ticket; a transition
/// with an approver; SLA policies; a channel-board mapping.
fn seed_project(w: &mut World) {
    w.seed(
        "projects",
        row!["id" => "p1", "name" => "Core", "type" => "PROJECT", "createdAt" => 1],
    );
    w.seed(
        "projects",
        row!["id" => "p2", "name" => "Edge", "type" => "PROJECT", "createdAt" => 2],
    );
    w.seed(
        "projects",
        row!["id" => "p-dm", "name" => "dm", "type" => "DM", "createdAt" => 3],
    );
    w.seed("boards", row!["id" => "b1", "name" => "Dev", "projectId" => "p1", "boardType" => "KANBAN", "createdAt" => 1]);
    w.seed("boards", row!["id" => "b2", "name" => "Release", "projectId" => "p1", "boardType" => "RELEASE", "createdAt" => 2]);
    w.seed("boards", row!["id" => "b3", "name" => "Edge dev", "projectId" => "p2", "boardType" => "KANBAN", "createdAt" => 3]);
    w.seed(
        "stages",
        row!["id" => "s1", "boardId" => "b1", "name" => "Todo", "sequenceNumber" => 1],
    );
    w.seed(
        "stages",
        row!["id" => "s2", "boardId" => "b1", "name" => "Done", "sequenceNumber" => 2],
    );
    w.seed(
        "stages",
        row!["id" => "s3", "boardId" => "b2", "name" => "Staged", "sequenceNumber" => 1],
    );
    w.seed(
        "stage_pr_status_mappings",
        row!["id" => "pm1", "stageId" => "s1", "prStatus" => "OPEN"],
    );
    w.seed(
        "stage_approvers",
        row!["id" => "ap1", "stageId" => "s1", "userId" => "u-2", "approverType" => "USER"],
    );
    w.seed(
        "stage_approvers",
        row!["id" => "ap2", "transitionId" => "tr1", "roleId" => "r1", "approverType" => "ROLE"],
    );
    w.seed("forms", row!["id" => "f1", "formName" => "Ticket form", "contextType" => "BOARD", "entityType" => "TICKET", "createdAt" => 1]);
    w.seed("forms", row!["id" => "f2", "formName" => "Stage form", "contextType" => "STAGE", "entityType" => "TICKET", "createdAt" => 2]);
    w.seed(
        "global_fields",
        row!["id" => "gf1", "fieldName" => "env", "fieldType" => "TEXT"],
    );
    w.seed("form_fields", row!["id" => "ff1", "formId" => "f1", "globalFieldId" => "gf1", "fieldName" => "env", "fieldType" => "TEXT", "sequenceNumber" => 1, "createdAt" => 1]);
    w.seed("form_fields", row!["id" => "ff2", "formId" => "f1", "fieldName" => "owner", "fieldType" => "USER", "sequenceNumber" => 2, "createdAt" => 2]);
    w.seed("form_fields", row!["id" => "ff3", "formId" => "f2", "fieldName" => "notes", "fieldType" => "TEXT", "sequenceNumber" => 0, "createdAt" => 3]);
    w.seed("forms_context_mapping", row!["id" => "fcm-b1", "formId" => "f1", "contextId" => "b1", "contextType" => "BOARD", "entityType" => "TICKET"]);
    w.seed("forms_context_mapping", row!["id" => "fcm-s1", "formId" => "f2", "contextId" => "s1", "contextType" => "STAGE", "entityType" => "TICKET"]);
    w.seed("forms_context_mapping", row!["id" => "fcm-b3", "formId" => "f1", "contextId" => "b3", "contextType" => "BOARD", "entityType" => "TICKET"]);
    w.seed("form_entity_values", row!["id" => "fv1", "entityId" => "t1", "entityType" => "TICKET", "fieldId" => "ff1", "actualFieldValue" => "\"prod\"", "createdAt" => 1]);
    w.seed("form_entity_values", row!["id" => "fv2", "entityId" => "t1", "entityType" => "TICKET", "fieldId" => "gf1", "actualFieldValue" => "\"stage\"", "createdAt" => 2]);
    w.seed("form_entity_values", row!["id" => "fv3", "entityId" => "rel1", "entityType" => "RELEASE_ENV_FORM", "fieldId" => "ff1", "createdAt" => 3]);
    w.seed("message_attachments", row!["id" => "fva1", "entityId" => "fv1", "entityType" => "FORM_ENTITY_VALUE", "isDeleted" => false]);
    w.seed("stage_transitions", row!["id" => "tr1", "boardId" => "b1", "fromStageId" => "s1", "toStageId" => "s2", "formId" => "f2", "requiresApproval" => true]);
    w.seed("stage_transitions", row!["id" => "tr2", "boardId" => "b2", "fromStageId" => "s3", "toStageId" => "s3", "requiresApproval" => false]);
    w.seed("board_sla_policies", row!["id" => "sla1", "boardId" => "b1", "priority" => "HIGH", "responseHours" => 4, "isActive" => true]);
    w.seed("board_sla_policies", row!["id" => "sla2", "boardId" => "b1", "priority" => "LOW", "responseHours" => 48, "isActive" => false]);
    w.seed("board_sla_policies", row!["id" => "sla3", "boardId" => "b3", "priority" => "HIGH", "responseHours" => 8, "isActive" => true]);
    w.seed(
        "channel_board_mappings",
        row!["id" => "cbm1", "channelId" => "c1", "boardId" => "b1", "createdAt" => 1],
    );
}

/// `projectById`: one project; an edit is a replace pair.
#[test]
fn project_by_id() {
    let mut w = World::new();
    seed_project(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("projects").eq("id", "p1").one()),
        ops(["q/main+p1"])
    );
    assert_eq!(
        w.update(
            "projects",
            row!["id" => "p1", "name" => "Core platform", "type" => "PROJECT", "createdAt" => 1]
        ),
        ops(["q/main+p1"])
    );
}

/// `projectsByIds`: a literal id list.
#[test]
fn projects_by_ids() {
    let mut w = World::new();
    seed_project(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("projects").in_("id", &["p1", "p2"])),
        ops(["q/main+p1", "q/main+p2"])
    );
    assert_eq!(w.delete("projects", "p2"), ops(["q/main-p2"]));
}

/// `boardsByProject`: a project's boards with stages (and their PR
/// mappings, form mappings, approvers) and form mappings with fields and
/// global fields, three levels deep.
#[test]
fn boards_by_project() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("boards")
        .eq("projectId", "p1")
        .order_by("createdAt", ASC)
        .related("stages", |s| {
            s.order_by("sequenceNumber", ASC)
                .related("prStatusMappings", same)
                .related("formContextMappings", same)
                .related("approvers", same)
        })
        .related("formContextMappings", |m| {
            m.related("formFields", |f| f.related("globalField", same))
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+b1",
            "q/main+b2",
            "q/stages+s1",
            "q/stages+s2",
            "q/stages+s3",
            "q/stages.prStatusMappings+pm1",
            "q/stages.formContextMappings+fcm-s1",
            "q/stages.approvers+ap1",
            "q/formContextMappings+fcm-b1",
            "q/formContextMappings.formFields+ff1",
            "q/formContextMappings.formFields+ff2",
            "q/formContextMappings.formFields.globalField+gf1"
        ])
    );
    assert_eq!(
        w.insert(
            "stages",
            row!["id" => "s4", "boardId" => "b2", "name" => "Shipped", "sequenceNumber" => 2]
        ),
        ops(["q/stages+s4"])
    );
}

/// `boardDetailById`: one board with stages (approvers, form mappings and
/// their form) and form mappings with fields and global fields.
#[test]
fn board_detail_by_id() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("boards")
        .eq("id", "b1")
        .related("stages", |s| {
            s.order_by("sequenceNumber", ASC)
                .related("approvers", same)
                .related("formContextMappings", |m| m.related("form", same))
        })
        .related("formContextMappings", |m| {
            m.related("formFields", |f| f.related("globalField", same))
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+b1",
            "q/stages+s1",
            "q/stages+s2",
            "q/stages.approvers+ap1",
            "q/stages.formContextMappings+fcm-s1",
            "q/stages.formContextMappings.form+f2",
            "q/formContextMappings+fcm-b1",
            "q/formContextMappings.formFields+ff1",
            "q/formContextMappings.formFields+ff2",
            "q/formContextMappings.formFields.globalField+gf1"
        ])
    );
    assert_eq!(
        w.delete("form_fields", "ff2"),
        ops(["q/formContextMappings.formFields-ff2"])
    );
}

/// `boardFullDetailById`: the detail plus PR status mappings per stage.
#[test]
fn board_full_detail_by_id() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("boards")
        .eq("id", "b1")
        .related("stages", |s| {
            s.order_by("sequenceNumber", ASC)
                .related("approvers", same)
                .related("prStatusMappings", same)
                .related("formContextMappings", |m| m.related("form", same))
        })
        .related("formContextMappings", |m| {
            m.related("formFields", |f| f.related("globalField", same))
        })
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+b1",
            "q/stages+s1",
            "q/stages+s2",
            "q/stages.approvers+ap1",
            "q/stages.prStatusMappings+pm1",
            "q/stages.formContextMappings+fcm-s1",
            "q/stages.formContextMappings.form+f2",
            "q/formContextMappings+fcm-b1",
            "q/formContextMappings.formFields+ff1",
            "q/formContextMappings.formFields+ff2",
            "q/formContextMappings.formFields.globalField+gf1"
        ])
    );
    assert_eq!(
        w.update(
            "stage_pr_status_mappings",
            row!["id" => "pm1", "stageId" => "s1", "prStatus" => "MERGED"]
        ),
        ops(["q/stages.prStatusMappings+pm1"])
    );
}

/// `stagesByBoard`: a board's stages in sequence with approvers and form
/// mappings.
#[test]
fn stages_by_board() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("stages")
        .eq("boardId", "b1")
        .order_by("sequenceNumber", ASC)
        .related("approvers", same)
        .related("formContextMappings", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+s1",
            "q/main+s2",
            "q/approvers+ap1",
            "q/formContextMappings+fcm-s1"
        ])
    );
    assert_eq!(
        w.insert(
            "stages",
            row!["id" => "s5", "boardId" => "b1", "name" => "Review", "sequenceNumber" => 3]
        ),
        ops(["q/main+s5"])
    );
}

/// `stagesByBoards`: the stages of a project's kanban boards, the board an
/// existence test; retyping a board brings its stages.
#[test]
fn stages_by_boards() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("stages")
        .where_exists("board", |b| {
            b.eq("projectId", "p1").eq("boardType", "KANBAN")
        })
        .order_by("boardId", ASC)
        .order_by("sequenceNumber", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+s1", "q/main+s2", "q/has:board+b1"])
    );
    assert_eq!(
        w.update("boards", row!["id" => "b2", "name" => "Release", "projectId" => "p1", "boardType" => "KANBAN", "createdAt" => 2]),
        ops(["q/has:board+b2", "q/main+s3"])
    );
}

/// `getAllProjects`: every real project with its boards.
#[test]
fn get_all_projects() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("projects")
        .where_("type", NEQ, "DM")
        .order_by("createdAt", DESC)
        .related("boards", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+p1",
            "q/main+p2",
            "q/boards+b1",
            "q/boards+b2",
            "q/boards+b3"
        ])
    );
    assert_eq!(
        w.insert(
            "projects",
            row!["id" => "p3", "name" => "New", "type" => "PROJECT", "createdAt" => 4]
        ),
        ops(["q/main+p3"])
    );
}

/// `getAllProjectsList`: every real project, boards left out.
#[test]
fn get_all_projects_list() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("projects")
        .where_("type", NEQ, "DM")
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+p1", "q/main+p2"]));
}

/// `boardsByIds`: a literal id list.
#[test]
fn boards_by_ids() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("boards")
        .in_("id", &["b1", "b3"])
        .order_by("createdAt", DESC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+b1", "q/main+b3"]));
}

/// `boardsByChannel`: a channel's board mappings with the board.
#[test]
fn boards_by_channel() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("channel_board_mappings")
        .eq("channelId", "c1")
        .related("board", same)
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cbm1", "q/board+b1"]));
    assert_eq!(
        w.insert(
            "channel_board_mappings",
            row!["id" => "cbm2", "channelId" => "c1", "boardId" => "b2", "createdAt" => 2]
        ),
        ops(["q/main+cbm2", "q/board+b2"])
    );
}

/// `boardsListByProject`: a project's boards, scalar only.
#[test]
fn boards_list_by_project() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("boards")
        .eq("projectId", "p1")
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+b1", "q/main+b2"]));
    assert_eq!(w.delete("boards", "b2"), ops(["q/main-b2"]));
}

/// `getAllBoards`: every board with project and stages (approvers, form
/// mappings); deleting the last board of a project prunes the project.
#[test]
fn get_all_boards() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("boards")
        .order_by("createdAt", DESC)
        .related("project", same)
        .related("stages", |s| {
            s.order_by("sequenceNumber", ASC)
                .related("approvers", same)
                .related("formContextMappings", same)
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+b1",
            "q/main+b2",
            "q/main+b3",
            "q/project+p1",
            "q/project+p2",
            "q/stages+s1",
            "q/stages+s2",
            "q/stages+s3",
            "q/stages.approvers+ap1",
            "q/stages.formContextMappings+fcm-s1"
        ])
    );
    assert_eq!(w.delete("boards", "b3"), ops(["q/main-b3", "q/project-p2"]));
}

/// `getAllBoardsList`: every board, scalar only.
#[test]
fn get_all_boards_list() {
    let mut w = World::new();
    seed_project(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("boards").order_by("createdAt", DESC)),
        ops(["q/main+b1", "q/main+b2", "q/main+b3"])
    );
}

/// `getBoardById`: one board with its project.
#[test]
fn get_board_by_id() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("boards").eq("id", "b1").related("project", same).one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+b1", "q/project+p1"]));
}

/// `getStagesByBoardIds`: stages across boards in sequence; the empty-list
/// guard is permanently empty.
#[test]
fn get_stages_by_board_ids() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("stages")
        .in_("boardId", &["b1", "b2"])
        .order_by("sequenceNumber", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+s1", "q/main+s2", "q/main+s3"])
    );
    assert_eq!(
        w.subscribe("none", &zql("stages").eq("id", "nonexistent").limit(0)),
        ops([])
    );
}

/// `getAllForms`: every form with fields (and global fields) and context
/// mappings.
#[test]
fn get_all_forms() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("forms")
        .related("formFields", |f| f.related("globalField", same))
        .related("formContextMappings", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+f1",
            "q/main+f2",
            "q/formFields+ff1",
            "q/formFields+ff2",
            "q/formFields+ff3",
            "q/formFields.globalField+gf1",
            "q/formContextMappings+fcm-b1",
            "q/formContextMappings+fcm-s1",
            "q/formContextMappings+fcm-b3"
        ])
    );
    assert_eq!(
        w.insert(
            "forms",
            row!["id" => "f3", "formName" => "Intake", "createdAt" => 3]
        ),
        ops(["q/main+f3"])
    );
}

/// `getAllFormsList`: every form, scalar only.
#[test]
fn get_all_forms_list() {
    let mut w = World::new();
    seed_project(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("forms").order_by("createdAt", DESC)),
        ops(["q/main+f1", "q/main+f2"])
    );
}

/// `getFormById`: one form.
#[test]
fn get_form_by_id() {
    let mut w = World::new();
    seed_project(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("forms").eq("id", "f1").one()),
        ops(["q/main+f1"])
    );
    assert_eq!(w.delete("forms", "f1"), ops(["q/main-f1"]));
}

/// `getFormFieldsByFormId`: a form's fields in sequence with their global
/// field.
#[test]
fn get_form_fields_by_form_id() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("form_fields")
        .eq("formId", "f1")
        .related("globalField", same)
        .order_by("sequenceNumber", ASC)
        .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+ff1", "q/main+ff2", "q/globalField+gf1"])
    );
    assert_eq!(
        w.update(
            "global_fields",
            row!["id" => "gf1", "fieldName" => "env", "fieldType" => "ENUM"]
        ),
        ops(["q/globalField+gf1"])
    );
}

/// `getFormEntityValuesByEntityId`: an entity's form values with form
/// field (and its global field), global field and attachments; the value
/// on the global field was its only reference in that part, so deleting
/// it prunes the field there (the nested part still holds it).
#[test]
fn get_form_entity_values_by_entity_id() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("form_entity_values")
        .eq("entityId", "t1")
        .related("formField", |f| f.related("globalField", same))
        .related("globalField", same)
        .related("attachments", same)
        .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+fv1",
            "q/main+fv2",
            "q/formField+ff1",
            "q/formField.globalField+gf1",
            "q/globalField+gf1",
            "q/attachments+fva1"
        ])
    );
    assert_eq!(
        w.delete("form_entity_values", "fv2"),
        ops(["q/main-fv2", "q/globalField-gf1"])
    );
    assert_eq!(w.rows("q", "formField.globalField"), 1);
}

/// `getFormsByContextType`: forms of one context type with fields and
/// mappings.
#[test]
fn get_forms_by_context_type() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("forms")
        .eq("contextType", "BOARD")
        .related("formFields", |f| f.related("globalField", same))
        .related("formContextMappings", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+f1",
            "q/formFields+ff1",
            "q/formFields+ff2",
            "q/formFields.globalField+gf1",
            "q/formContextMappings+fcm-b1",
            "q/formContextMappings+fcm-b3"
        ])
    );
}

/// `getFormMappingsByBoardIds`: the ticket-form mappings of several boards
/// with their fields; the empty-list guard is permanently empty.
#[test]
fn get_form_mappings_by_board_ids() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("forms_context_mapping")
        .in_("contextId", &["b1", "b3"])
        .eq("contextType", "BOARD")
        .eq("entityType", "TICKET")
        .related("formFields", |f| f.related("globalField", same));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+fcm-b1",
            "q/main+fcm-b3",
            "q/formFields+ff1",
            "q/formFields+ff2",
            "q/formFields.globalField+gf1"
        ])
    );
    let none = zql("forms_context_mapping")
        .eq("id", "nonexistent")
        .limit(0)
        .related("formFields", |f| f.related("globalField", same));
    assert_eq!(w.subscribe("none", &none), ops([]));
}

/// `getFormMappingByContextId`: one context's mapping with fields;
/// removing it prunes the fields and the global field.
#[test]
fn get_form_mapping_by_context_id() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("forms_context_mapping")
        .eq("contextId", "b1")
        .eq("contextType", "BOARD")
        .eq("entityType", "TICKET")
        .related("formFields", |f| f.related("globalField", same))
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+fcm-b1",
            "q/formFields+ff1",
            "q/formFields+ff2",
            "q/formFields.globalField+gf1"
        ])
    );
    assert_eq!(
        w.delete("forms_context_mapping", "fcm-b1"),
        ops([
            "q/main-fcm-b1",
            "q/formFields-ff1",
            "q/formFields-ff2",
            "q/formFields.globalField-gf1"
        ])
    );
}

/// `getFormMappingsByContextIds`: several contexts' mappings with fields.
#[test]
fn get_form_mappings_by_context_ids() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("forms_context_mapping")
        .in_("contextId", &["b1", "b3"])
        .eq("contextType", "BOARD")
        .eq("entityType", "TICKET")
        .related("formFields", |f| f.related("globalField", same));
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+fcm-b1",
            "q/main+fcm-b3",
            "q/formFields+ff1",
            "q/formFields+ff2",
            "q/formFields.globalField+gf1"
        ])
    );
    assert_eq!(
        w.insert("form_fields", row!["id" => "ff4", "formId" => "f1", "fieldName" => "region", "fieldType" => "TEXT", "sequenceNumber" => 3]),
        ops(["q/formFields+ff4"])
    );
}

/// `getAllFormEntityValues`: every ticket form value with form field and
/// global field.
#[test]
fn get_all_form_entity_values() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("form_entity_values")
        .eq("entityType", "TICKET")
        .related("formField", same)
        .related("globalField", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+fv1",
            "q/main+fv2",
            "q/formField+ff1",
            "q/globalField+gf1"
        ])
    );
    assert_eq!(
        w.insert("form_entity_values", row!["id" => "fv4", "entityId" => "t2", "entityType" => "TICKET", "fieldId" => "ff2", "createdAt" => 4]),
        ops(["q/main+fv4", "q/formField+ff2"])
    );
}

/// `getStageTransitionsByBoardId`: a board's transitions with their
/// approvers.
#[test]
fn get_stage_transitions_by_board_id() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("stage_transitions")
        .eq("boardId", "b1")
        .related("transitionApprovers", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+tr1", "q/transitionApprovers+ap2"])
    );
    assert_eq!(
        w.delete("stage_approvers", "ap2"),
        ops(["q/transitionApprovers-ap2"])
    );
}

/// `getStageTransitionsByBoardIds`: transitions across boards with their
/// form, fields and global fields; the empty-list guard is permanently
/// empty.
#[test]
fn get_stage_transitions_by_board_ids() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("stage_transitions")
        .in_("boardId", &["b1", "b2"])
        .related("form", |f| {
            f.related("formFields", |ff| ff.related("globalField", same))
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+tr1",
            "q/main+tr2",
            "q/form+f2",
            "q/form.formFields+ff3"
        ])
    );
    let none = zql("stage_transitions")
        .eq("id", "nonexistent")
        .limit(0)
        .related("form", |f| {
            f.related("formFields", |ff| ff.related("globalField", same))
        });
    assert_eq!(w.subscribe("none", &none), ops([]));
}

/// `getBoardSlaPolicies`: a board's active policies; activating one adds
/// it.
#[test]
fn get_board_sla_policies() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("board_sla_policies")
        .eq("boardId", "b1")
        .eq("isActive", true);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+sla1"]));
    assert_eq!(
        w.update("board_sla_policies", row!["id" => "sla2", "boardId" => "b1", "priority" => "LOW", "responseHours" => 48, "isActive" => true]),
        ops(["q/main+sla2"])
    );
}

/// `getBoardSlaPoliciesByBoardIds`: active policies across boards; the
/// empty-list guard is permanently empty.
#[test]
fn get_board_sla_policies_by_board_ids() {
    let mut w = World::new();
    seed_project(&mut w);
    let q = zql("board_sla_policies")
        .in_("boardId", &["b1", "b3"])
        .eq("isActive", true);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+sla1", "q/main+sla3"]));
    assert_eq!(
        w.subscribe(
            "none",
            &zql("board_sla_policies").eq("id", "nonexistent").limit(0)
        ),
        ops([])
    );
    assert_eq!(w.delete("board_sla_policies", "sla3"), ops(["q/main-sla3"]));
}
