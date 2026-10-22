//! The directory and administration queries: users, profiles, groups and
//! memberships, assignment states, resources, invitations, apps,
//! workspaces and organisations, roles, saved views, lookups, emojis and
//! dashboards, one test per registry entry.

use streamgres::model::ComparisonOperator::GT;
use streamgres::model::Order::{ASC, DESC};
use streamgres::model::Value;

use super::world::{ME, WS, World, ops, with};
use super::zql::{and, cmp, eq, or, same, zql};

/// A full row image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// User `u-2`: a member of group `g1`, with a presence row.
fn u2() -> Row {
    row!["id" => "u-2", "name" => "Meera", "displayName" => "meera", "userType" => "HUMAN", "updatedAt" => 200].to_vec()
}

/// Group `g1`: an active on-call group.
fn g1() -> Row {
    row!["id" => "g1", "name" => "Payments On-call", "alias" => "pay-oncall", "isActive" => true, "createdAt" => 1].to_vec()
}

/// The directory: the caller and `u-2` (with a presence row), a bot, a
/// user in another workspace; profiles; groups `g1`, `g2` with mappings;
/// roles; assignment, workload and expertise states; board complexity
/// scores.
fn seed_directory(w: &mut World) {
    w.seed("users", row!["id" => ME, "name" => "Aniket", "displayName" => "ani", "userType" => "HUMAN", "updatedAt" => 100]);
    w.seed("users", &u2());
    w.seed(
        "users",
        row!["id" => "u-bot", "name" => "Deploy bot", "userType" => "BOT", "updatedAt" => 300],
    );
    w.seed("users", row!["id" => "u-out", "name" => "Elsewhere", "userType" => "HUMAN", "workspaceId" => "ws-2", "updatedAt" => 400]);
    w.seed(
        "user_presence",
        row!["id" => "pr2", "userId" => "u-2", "status" => "ONLINE", "updatedAt" => 250],
    );
    w.seed(
        "user_profiles",
        row!["id" => "pf-me", "userId" => ME, "team" => "Sync"],
    );
    w.seed(
        "user_profiles",
        row!["id" => "pf-2", "userId" => "u-2", "team" => "Payments"],
    );
    w.seed("user_groups", &g1());
    w.seed(
        "user_groups",
        row!["id" => "g2", "name" => "Ops", "alias" => "ops", "isActive" => true, "createdAt" => 2],
    );
    w.seed(
        "roles",
        row!["id" => "r1", "name" => "Reviewer", "isActive" => true, "createdAt" => 1],
    );
    w.seed(
        "roles",
        row!["id" => "r2", "name" => "Retired", "isActive" => false, "createdAt" => 2],
    );
    w.seed("user_group_mappings", row!["id" => "gm1", "userId" => "u-2", "userGroupId" => "g1", "roleId" => "r1", "createdAt" => 1]);
    w.seed(
        "user_group_mappings",
        row!["id" => "gm2", "userId" => ME, "userGroupId" => "g2", "createdAt" => 2],
    );
    w.seed(
        "user_role_mappings",
        row!["id" => "rm1", "userId" => "u-2", "roleId" => "r1"],
    );
    w.seed("user_assignment_states", row!["id" => "as1", "userId" => "u-2", "userGroupId" => "g1", "onCall" => true, "isActiveForAssignment" => true]);
    w.seed("user_assignment_states", row!["id" => "as2", "userId" => ME, "userGroupId" => "g2", "onCall" => false, "isActiveForAssignment" => true]);
    w.seed("user_workload_mappings", row!["id" => "wl1", "userId" => "u-2", "userGroupId" => "g1", "boardId" => "b1", "activeTasks" => 3]);
    w.seed("user_expertise_mappings", row!["id" => "ex1", "userId" => "u-2", "userGroupId" => "g1", "boardId" => "b1", "hasExpertise" => true]);
    w.seed("user_expertise_mappings", row!["id" => "ex2", "userId" => "u-2", "userGroupId" => "g1", "boardId" => "b2", "hasExpertise" => false]);
    w.seed(
        "boards",
        row!["id" => "b1", "name" => "Dev", "projectId" => "p1"],
    );
    w.seed(
        "board_complexity_scores",
        row!["id" => "cs1", "userGroupId" => "g1", "boardId" => "b1", "weight" => 2],
    );
}

/// `getUsers` with a watermark: users changed since it, or whose presence
/// changed (an existence test inside the `OR`), with presence.
#[test]
fn get_users() {
    let mut w = World::new();
    seed_directory(&mut w);
    let mut q = zql("users");
    let presence_changed = q.exists("presenceStatus", |p| p.where_("updatedAt", GT, 150));
    let q = q
        .filter(or(vec![cmp("updatedAt", GT, 150), presence_changed]))
        .related("presenceStatus", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+u-2",
            "q/main+u-bot",
            "q/presenceStatus+pr2",
            "q/has:presenceStatus+pr2"
        ])
    );
    assert_eq!(
        w.update(
            "user_presence",
            row!["id" => "pr2", "userId" => "u-2", "status" => "AWAY", "updatedAt" => 260]
        ),
        ops(["q/presenceStatus+pr2", "q/has:presenceStatus+pr2"])
    );
}

/// `getUsersV2`: users changed since a watermark, the workspace backstop
/// hiding the other workspace's user.
#[test]
fn get_users_v2() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("users").where_("updatedAt", GT, 150)),
        ops(["q/main+u-2", "q/main+u-bot"])
    );
    assert_eq!(
        w.update(
            "users",
            &with(&u2(), row!["updatedAt" => 500, "displayName" => "meera k"])
        ),
        ops(["q/main+u-2"])
    );
}

/// `getUserProfilesByIds`: profiles of listed users.
#[test]
fn get_user_profiles_by_ids() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_profiles").in_("userId", &[ME, "u-9"])),
        ops(["q/main+pf-me"])
    );
    assert_eq!(
        w.insert(
            "user_profiles",
            row!["id" => "pf-9", "userId" => "u-9", "team" => "New"]
        ),
        ops(["q/main+pf-9"])
    );
}

/// `getUserProfile`: one user's profile.
#[test]
fn get_user_profile() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_profiles").eq("userId", "u-2").one()),
        ops(["q/main+pf-2"])
    );
    assert_eq!(w.delete("user_profiles", "pf-2"), ops(["q/main-pf-2"]));
}

/// `getUserGroupsByIds`: listed groups with their memberships; the
/// empty-list guard is permanently empty.
#[test]
fn get_user_groups_by_ids() {
    let mut w = World::new();
    seed_directory(&mut w);
    let q = zql("user_groups")
        .in_("id", &["g1"])
        .related("userGroupMappings", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+g1", "q/userGroupMappings+gm1"])
    );
    assert_eq!(
        w.subscribe("none", &zql("user_groups").eq("id", "nonexistent").limit(0)),
        ops([])
    );
    assert_eq!(
        w.insert(
            "user_group_mappings",
            row!["id" => "gm3", "userId" => ME, "userGroupId" => "g1", "createdAt" => 3]
        ),
        ops(["q/userGroupMappings+gm3"])
    );
}

/// `searchUserGroups` for a term. Gap L: `name ILIKE` / `alias ILIKE`
/// cannot be stated; the shape without the term (fifteen by name with
/// memberships) is.
#[test]
fn search_user_groups() {
    let mut w = World::new();
    seed_directory(&mut w);
    let q = zql("user_groups")
        .limit(15)
        .order_by("name", ASC)
        .related("userGroupMappings", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+g1",
            "q/main+g2",
            "q/userGroupMappings+gm1",
            "q/userGroupMappings+gm2"
        ])
    );
}

/// `getAllUserGroups`: every group, newest first.
#[test]
fn get_all_user_groups() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_groups").order_by("createdAt", DESC)),
        ops(["q/main+g1", "q/main+g2"])
    );
    assert_eq!(
        w.update("user_groups", &with(&g1(), row!["isActive" => false])),
        ops(["q/main+g1"])
    );
}

/// `getUserGroupById`: one group.
#[test]
fn get_user_group_by_id() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_groups").eq("id", "g1").one()),
        ops(["q/main+g1"])
    );
}

/// `getUserGroupMembers`: a group's memberships with their role.
#[test]
fn get_user_group_members() {
    let mut w = World::new();
    seed_directory(&mut w);
    let q = zql("user_group_mappings")
        .eq("userGroupId", "g1")
        .order_by("createdAt", DESC)
        .related("role", same);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+gm1", "q/role+r1"]));
    assert_eq!(
        w.delete("user_group_mappings", "gm1"),
        ops(["q/main-gm1", "q/role-r1"])
    );
}

/// `getUserGroupMembersByGroupIds`: memberships across groups.
#[test]
fn get_user_group_members_by_group_ids() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe(
            "q",
            &zql("user_group_mappings").in_("userGroupId", &["g1", "g2"])
        ),
        ops(["q/main+gm1", "q/main+gm2"])
    );
}

/// `getUserGroupMappingsByUserId`: the caller's memberships.
#[test]
fn get_user_group_mappings_by_user_id() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_group_mappings").eq("userId", ME)),
        ops(["q/main+gm2"])
    );
    assert_eq!(
        w.insert(
            "user_group_mappings",
            row!["id" => "gm4", "userId" => ME, "userGroupId" => "g1", "createdAt" => 4]
        ),
        ops(["q/main+gm4"])
    );
}

/// `getAllResources`: every resource by name.
#[test]
fn get_all_resources() {
    let mut w = World::new();
    w.seed("resources", row!["id" => "rs1", "name" => "SCRIBE"]);
    w.seed("resources", row!["id" => "rs2", "name" => "ADMIN"]);
    assert_eq!(
        w.subscribe("q", &zql("resources").order_by("name", ASC)),
        ops(["q/main+rs1", "q/main+rs2"])
    );
    assert_eq!(
        w.insert("resources", row!["id" => "rs3", "name" => "BILLING"]),
        ops(["q/main+rs3"])
    );
}

/// `getAllInvitations`: every invitation, newest first.
#[test]
fn get_all_invitations() {
    let mut w = World::new();
    w.seed(
        "invitations",
        row!["id" => "in1", "email" => "a@x", "role" => "MEMBER", "createdAt" => 1],
    );
    assert_eq!(
        w.subscribe("q", &zql("invitations").order_by("createdAt", DESC)),
        ops(["q/main+in1"])
    );
    assert_eq!(
        w.insert(
            "invitations",
            row!["id" => "in2", "email" => "b@x", "role" => "MEMBER", "createdAt" => 2]
        ),
        ops(["q/main+in2"])
    );
}

/// `getResourceAccessForUser`: one user's resource grants.
#[test]
fn get_resource_access_for_user() {
    let mut w = World::new();
    w.seed(
        "resource_access",
        row!["id" => "ra1", "userId" => ME, "resourceId" => "rs1", "accessType" => "ADMIN"],
    );
    w.seed(
        "resource_access",
        row!["id" => "ra2", "userId" => "u-2", "resourceId" => "rs1", "accessType" => "VIEW"],
    );
    assert_eq!(
        w.subscribe("q", &zql("resource_access").eq("userId", ME)),
        ops(["q/main+ra1"])
    );
    assert_eq!(w.delete("resource_access", "ra1"), ops(["q/main-ra1"]));
}

/// `getBoardComplexityScores`: a group's board weights with the board.
#[test]
fn get_board_complexity_scores() {
    let mut w = World::new();
    seed_directory(&mut w);
    let q = zql("board_complexity_scores")
        .eq("userGroupId", "g1")
        .related("board", same);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cs1", "q/board+b1"]));
    assert_eq!(
        w.update(
            "boards",
            row!["id" => "b1", "name" => "Development", "projectId" => "p1"]
        ),
        ops(["q/board+b1"])
    );
}

/// `getUserWorkloadMappings`: a group's workload rows.
#[test]
fn get_user_workload_mappings() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_workload_mappings").eq("userGroupId", "g1")),
        ops(["q/main+wl1"])
    );
    assert_eq!(
        w.update("user_workload_mappings", row!["id" => "wl1", "userId" => "u-2", "userGroupId" => "g1", "boardId" => "b1", "activeTasks" => 4]),
        ops(["q/main+wl1"])
    );
}

/// `getUserExpertiseMappings`: a group's expertise on one board.
#[test]
fn get_user_expertise_mappings() {
    let mut w = World::new();
    seed_directory(&mut w);
    let q = zql("user_expertise_mappings")
        .eq("userGroupId", "g1")
        .eq("boardId", "b1");
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ex1"]));
}

/// `getUserAssignmentStates`: a group's assignment states.
#[test]
fn get_user_assignment_states() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_assignment_states").eq("userGroupId", "g1")),
        ops(["q/main+as1"])
    );
    assert_eq!(
        w.update("user_assignment_states", row!["id" => "as1", "userId" => "u-2", "userGroupId" => "g1", "onCall" => false, "isActiveForAssignment" => true]),
        ops(["q/main+as1"])
    );
}

/// `getUserAssignmentStatesByUserId`: one user's states across groups.
#[test]
fn get_user_assignment_states_by_user_id() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("user_assignment_states").eq("userId", ME)),
        ops(["q/main+as2"])
    );
}

/// `getUserAssignmentStatesByGroupIds`: states across several groups.
#[test]
fn get_user_assignment_states_by_group_ids() {
    let mut w = World::new();
    seed_directory(&mut w);
    assert_eq!(
        w.subscribe(
            "q",
            &zql("user_assignment_states").in_("userGroupId", &["g1", "g2"])
        ),
        ops(["q/main+as1", "q/main+as2"])
    );
    assert_eq!(
        w.delete("user_assignment_states", "as2"),
        ops(["q/main-as2"])
    );
}

/// Apps: a global one, an org one, another org's; one installed by the
/// caller's workspace user.
fn seed_apps(w: &mut World) {
    w.seed("users", row!["id" => ME, "name" => "Aniket"]);
    w.seed(
        "users",
        row!["id" => "u-out", "name" => "Elsewhere", "workspaceId" => "ws-2"],
    );
    w.seed(
        "apps",
        row!["id" => "ap-global", "name" => "Notes", "scope" => "GLOBAL", "createdAt" => 1],
    );
    w.seed("apps", row!["id" => "ap-org", "name" => "Payroll", "scope" => "ORG", "orgId" => "org1", "createdAt" => 2]);
    w.seed("apps", row!["id" => "ap-other", "name" => "Theirs", "scope" => "ORG", "orgId" => "org2", "createdAt" => 3]);
    w.seed(
        "installed_apps",
        row!["id" => "ia1", "appId" => "ap-global", "userId" => ME, "createdAt" => 1],
    );
    w.seed(
        "installed_apps",
        row!["id" => "ia2", "appId" => "ap-global", "userId" => "u-out", "createdAt" => 2],
    );
}

/// `getWorkspaceInstalledApps`: installs whose user is in the caller's
/// workspace, with the app.
#[test]
fn get_workspace_installed_apps() {
    let mut w = World::new();
    seed_apps(&mut w);
    let q = zql("installed_apps")
        .where_exists("user", |u| u.eq("workspaceId", WS))
        .order_by("createdAt", DESC)
        .order_by("id", DESC)
        .limit(20)
        .related("app", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+ia1", "q/has:user+u-me", "q/app+ap-global"])
    );
    assert_eq!(
        w.insert(
            "installed_apps",
            row!["id" => "ia3", "appId" => "ap-org", "userId" => ME, "createdAt" => 3]
        ),
        ops(["q/main+ia3", "q/app+ap-org"])
    );
}

/// `getOrgApps`: an organisation's apps, newest first; `apps` is exempt
/// from the workspace backstop.
#[test]
fn get_org_apps() {
    let mut w = World::new();
    seed_apps(&mut w);
    let q = zql("apps")
        .filter(and(vec![eq("scope", "ORG"), eq("orgId", "org1")]))
        .order_by("createdAt", DESC)
        .order_by("id", DESC)
        .limit(20);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ap-org"]));
    assert_eq!(
        w.insert("apps", row!["id" => "ap-org2", "name" => "Leave", "scope" => "ORG", "orgId" => "org1", "createdAt" => 4, "workspaceId" => "ws-9"]),
        ops(["q/main+ap-org2"])
    );
}

/// `getMarketplaceApps`: global apps across organisations.
#[test]
fn get_marketplace_apps() {
    let mut w = World::new();
    seed_apps(&mut w);
    let q = zql("apps")
        .eq("scope", "GLOBAL")
        .order_by("createdAt", DESC)
        .order_by("id", DESC)
        .limit(20);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ap-global"]));
    assert_eq!(
        w.update("apps", row!["id" => "ap-org", "name" => "Payroll", "scope" => "GLOBAL", "orgId" => "org1", "createdAt" => 2]),
        ops(["q/main+ap-org"])
    );
}

/// Organisations: the caller's workspace linked to `org1`, `org2` active,
/// `org3` suspended; members of `org1`.
fn seed_orgs(w: &mut World) {
    w.seed(
        "workspaces",
        row!["id" => WS, "name" => "Juspay", "orgId" => "org1", "status" => "ACTIVE"],
    );
    w.seed(
        "workspaces",
        row!["id" => "ws-2", "name" => "Other", "orgId" => "org2", "status" => "ACTIVE"],
    );
    w.seed(
        "organizations",
        row!["orgId" => "org1", "name" => "Juspay", "status" => "ACTIVE"],
    );
    w.seed(
        "organizations",
        row!["orgId" => "org2", "name" => "Acme", "status" => "ACTIVE"],
    );
    w.seed(
        "organizations",
        row!["orgId" => "org3", "name" => "Gone", "status" => "SUSPENDED"],
    );
    w.seed("workspace_organizations", row!["id" => "wo1", "workspaceId" => WS, "orgId" => "org1", "role" => "OWNER", "createdAt" => 1]);
    w.seed("workspace_organizations", row!["id" => "wo2", "workspaceId" => WS, "orgId" => "org3", "role" => "GUEST", "leftAt" => 5, "createdAt" => 2]);
    w.seed("org_members", row!["memberId" => "om1", "orgId" => "org1", "userId" => ME, "email" => "a@j", "role" => "ADMIN", "joinedAt" => 1]);
    w.seed("org_members", row!["memberId" => "om2", "orgId" => "org1", "userId" => "u-2", "email" => "m@j", "role" => "MEMBER", "joinedAt" => 2, "leftAt" => 9]);
}

/// `getWorkspaceById`: one workspace.
#[test]
fn get_workspace_by_id() {
    let mut w = World::new();
    seed_orgs(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("workspaces").eq("id", WS).one()),
        ops(["q/main+ws-1"])
    );
    assert_eq!(
        w.update(
            "workspaces",
            row!["id" => WS, "name" => "Juspay Tech", "orgId" => "org1", "status" => "ACTIVE"]
        ),
        ops(["q/main+ws-1"])
    );
}

/// `workspaceOrganizations`: a workspace's current (`leftAt IS NULL`)
/// organisation links with the organisation; leaving one drops it with
/// its organisation.
#[test]
fn workspace_organizations() {
    let mut w = World::new();
    seed_orgs(&mut w);
    let q = zql("workspace_organizations")
        .eq("workspaceId", WS)
        .where_is_null("leftAt")
        .related("organization", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+wo1", "q/organization+org1"])
    );
    assert_eq!(
        w.update("workspace_organizations", row!["id" => "wo1", "workspaceId" => WS, "orgId" => "org1", "role" => "OWNER", "createdAt" => 1, "leftAt" => 7]),
        ops(["q/main-wo1", "q/organization-org1"])
    );
}

/// `availableOrganizations`: active organisations by name.
#[test]
fn available_organizations() {
    let mut w = World::new();
    seed_orgs(&mut w);
    let q = zql("organizations")
        .eq("status", "ACTIVE")
        .order_by("name", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+org1", "q/main+org2"]));
    assert_eq!(
        w.update(
            "organizations",
            row!["orgId" => "org3", "name" => "Gone", "status" => "ACTIVE"]
        ),
        ops(["q/main+org3"])
    );
}

/// `getOrgMembers`: an organisation's current members by join date; a
/// departed member rejoins when `leftAt` is cleared.
#[test]
fn get_org_members() {
    let mut w = World::new();
    seed_orgs(&mut w);
    let q = zql("org_members")
        .eq("orgId", "org1")
        .where_is_null("leftAt")
        .order_by("joinedAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+om1"]));
    assert_eq!(
        w.update("org_members", row!["memberId" => "om2", "orgId" => "org1", "userId" => "u-2", "email" => "m@j", "role" => "MEMBER", "joinedAt" => 2]),
        ops(["q/main+om2"])
    );
}

/// `getOrgMemberById`: one membership.
#[test]
fn get_org_member_by_id() {
    let mut w = World::new();
    seed_orgs(&mut w);
    assert_eq!(
        w.subscribe("q", &zql("org_members").eq("memberId", "om1").one()),
        ops(["q/main+om1"])
    );
}

/// `getCurrentUserPreference`: the caller's preference row.
#[test]
fn get_current_user_preference() {
    let mut w = World::new();
    w.seed(
        "user_preferences",
        row!["id" => "up1", "userId" => ME, "enterSendsMessage" => true],
    );
    w.seed(
        "user_preferences",
        row!["id" => "up2", "userId" => "u-2", "enterSendsMessage" => false],
    );
    assert_eq!(
        w.subscribe("q", &zql("user_preferences").eq("userId", ME).one()),
        ops(["q/main+up1"])
    );
    assert_eq!(
        w.update(
            "user_preferences",
            row!["id" => "up1", "userId" => ME, "enterSendsMessage" => false]
        ),
        ops(["q/main+up1"])
    );
}

/// `roles`: the workspace's active roles, newest first, a page after a
/// cursor.
#[test]
fn roles() {
    let mut w = World::new();
    seed_directory(&mut w);
    let q = zql("roles")
        .eq("workspaceId", WS)
        .eq("isActive", true)
        .order_by("createdAt", DESC)
        .start(&[("createdAt", DESC, 100.into())], false)
        .limit(20);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+r1"]));
    assert_eq!(
        w.update(
            "roles",
            row!["id" => "r2", "name" => "Retired", "isActive" => true, "createdAt" => 2]
        ),
        ops(["q/main+r2"])
    );
}

/// `roleById`: one active role with its user mappings.
#[test]
fn role_by_id() {
    let mut w = World::new();
    seed_directory(&mut w);
    let q = zql("roles")
        .eq("id", "r1")
        .eq("workspaceId", WS)
        .eq("isActive", true)
        .related("userMappings", same)
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+r1", "q/userMappings+rm1"])
    );
    assert_eq!(
        w.update(
            "roles",
            row!["id" => "r1", "name" => "Reviewer", "isActive" => false, "createdAt" => 1]
        ),
        ops(["q/main-r1", "q/userMappings-rm1"])
    );
}

/// Saved views: the caller's board view with two values, `u-2`'s view
/// shared with the caller.
fn seed_views(w: &mut World) {
    w.seed("saved_user_configurations", row!["id" => "sv1", "userId" => ME, "name" => "My bugs", "contextType" => "BOARD", "contextId" => "b1", "createdAt" => 1]);
    w.seed("saved_user_configurations", row!["id" => "sv2", "userId" => "u-2", "name" => "Hot", "contextType" => "BOARD", "contextId" => "b1", "createdAt" => 2]);
    w.seed("saved_user_configuration_values", row!["id" => "svv1", "configId" => "sv1", "entityName" => "filter", "fieldName" => "priority", "fieldValue" => "HIGH"]);
    w.seed("saved_user_configuration_values", row!["id" => "svv2", "configId" => "sv1", "entityName" => "filter", "fieldName" => "assignee", "fieldValue" => ME]);
    w.seed("saved_user_configuration_values", row!["id" => "svv3", "configId" => "sv2", "entityName" => "filter", "fieldName" => "priority", "fieldValue" => "URGENT"]);
    w.seed("view_access", row!["id" => "va1", "viewId" => "sv2", "entityType" => "USER", "entityId" => ME, "sharedBy" => "u-2", "createdAt" => 1]);
}

/// `savedConfigsByBoard`: a board's saved views with their values.
#[test]
fn saved_configs_by_board() {
    let mut w = World::new();
    seed_views(&mut w);
    let q = zql("saved_user_configurations")
        .eq("contextType", "BOARD")
        .eq("contextId", "b1")
        .related("values", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+sv1",
            "q/main+sv2",
            "q/values+svv1",
            "q/values+svv2",
            "q/values+svv3"
        ])
    );
    assert_eq!(
        w.delete("saved_user_configuration_values", "svv2"),
        ops(["q/values-svv2"])
    );
}

/// `savedConfigsByUser`: a user's saved views with their values.
#[test]
fn saved_configs_by_user() {
    let mut w = World::new();
    seed_views(&mut w);
    let q = zql("saved_user_configurations")
        .eq("userId", ME)
        .related("values", same)
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+sv1", "q/values+svv1", "q/values+svv2"])
    );
    assert_eq!(
        w.delete("saved_user_configurations", "sv1"),
        ops(["q/main-sv1", "q/values-svv1", "q/values-svv2"])
    );
}

/// `savedConfigsSharedWithUser`: views shared with a user, each with its
/// values, two levels down.
#[test]
fn saved_configs_shared_with_user() {
    let mut w = World::new();
    seed_views(&mut w);
    let q = zql("view_access")
        .eq("entityType", "USER")
        .eq("entityId", ME)
        .related("view", |v| v.related("values", same))
        .order_by("createdAt", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+va1", "q/view+sv2", "q/view.values+svv3"])
    );
    assert_eq!(
        w.delete("view_access", "va1"),
        ops(["q/main-va1", "q/view-sv2", "q/view.values-svv3"])
    );
}

/// `lookupValuesByType`: the values of one lookup type, oldest first.
#[test]
fn lookup_values_by_type() {
    let mut w = World::new();
    w.seed(
        "lookup_values",
        row!["id" => "lv1", "type" => "BUG_TYPE", "value" => "Crash", "createdAt" => 1],
    );
    w.seed(
        "lookup_values",
        row!["id" => "lv2", "type" => "SEVERITY", "value" => "S1", "createdAt" => 2],
    );
    let q = zql("lookup_values")
        .eq("type", "BUG_TYPE")
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+lv1"]));
    assert_eq!(
        w.insert(
            "lookup_values",
            row!["id" => "lv3", "type" => "BUG_TYPE", "value" => "Leak", "createdAt" => 3]
        ),
        ops(["q/main+lv3"])
    );
}

/// Custom emojis by two creators.
fn seed_emojis(w: &mut World) {
    w.seed("users", row!["id" => ME, "name" => "Aniket"]);
    w.seed("users", row!["id" => "u-2", "name" => "Meera"]);
    w.seed("custom_emojis", row!["id" => "ce1", "name" => "shipit", "url" => "https://e/1", "createdBy" => ME, "createdAt" => 1]);
    w.seed("custom_emojis", row!["id" => "ce2", "name" => "oncall", "url" => "https://e/2", "createdBy" => "u-2", "createdAt" => 2]);
}

/// `getAllCustomEmojis`: every emoji with its creator.
#[test]
fn get_all_custom_emojis() {
    let mut w = World::new();
    seed_emojis(&mut w);
    let q = zql("custom_emojis")
        .order_by("createdAt", DESC)
        .related("creator", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+ce1",
            "q/main+ce2",
            "q/creator+u-me",
            "q/creator+u-2"
        ])
    );
    assert_eq!(
        w.delete("custom_emojis", "ce2"),
        ops(["q/main-ce2", "q/creator-u-2"])
    );
}

/// `getCustomEmojiById`: one emoji with its creator.
#[test]
fn get_custom_emoji_by_id() {
    let mut w = World::new();
    seed_emojis(&mut w);
    let q = zql("custom_emojis")
        .eq("id", "ce1")
        .related("creator", same)
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ce1", "q/creator+u-me"]));
}

/// `getCustomEmojiByName`: one emoji by name.
#[test]
fn get_custom_emoji_by_name() {
    let mut w = World::new();
    seed_emojis(&mut w);
    let q = zql("custom_emojis")
        .eq("name", "oncall")
        .related("creator", same)
        .one();
    assert_eq!(w.subscribe("q", &q), ops(["q/main+ce2", "q/creator+u-2"]));
    assert_eq!(
        w.update("custom_emojis", row!["id" => "ce2", "name" => "on-call", "url" => "https://e/2", "createdBy" => "u-2", "createdAt" => 2]),
        ops(["q/main-ce2", "q/creator-u-2"])
    );
}

/// `getAllDashboards`: every dashboard, latest edited first.
#[test]
fn get_all_dashboards() {
    let mut w = World::new();
    w.seed(
        "dashboards",
        row!["id" => "db1", "name" => "Ops", "updatedAt" => 1],
    );
    assert_eq!(
        w.subscribe("q", &zql("dashboards").order_by("updatedAt", DESC)),
        ops(["q/main+db1"])
    );
    assert_eq!(
        w.insert(
            "dashboards",
            row!["id" => "db2", "name" => "Sales", "updatedAt" => 2]
        ),
        ops(["q/main+db2"])
    );
}

/// `getDashboardById`: one dashboard with its query mappings and their
/// queries.
#[test]
fn get_dashboard_by_id() {
    let mut w = World::new();
    w.seed(
        "dashboards",
        row!["id" => "db1", "name" => "Ops", "updatedAt" => 1],
    );
    w.seed(
        "queries",
        row!["id" => "qy1", "title" => "Open tickets", "visualType" => "BAR"],
    );
    w.seed(
        "dashboard_queries_mapping",
        row!["id" => "dq1", "dashboardId" => "db1", "queryId" => "qy1", "sequence" => 1],
    );
    let q = zql("dashboards")
        .eq("id", "db1")
        .related("queryMappings", |m| m.related("query", same))
        .one();
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+db1",
            "q/queryMappings+dq1",
            "q/queryMappings.query+qy1"
        ])
    );
    assert_eq!(
        w.delete("dashboard_queries_mapping", "dq1"),
        ops(["q/queryMappings-dq1", "q/queryMappings.query-qy1"])
    );
}
