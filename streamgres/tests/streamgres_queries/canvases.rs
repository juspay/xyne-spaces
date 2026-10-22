//! The canvas, folder and knowledge-collection queries, one test per
//! registry entry. The canvas visibility rule is `createdBy = me OR EXISTS
//! participants(me) [OR visibility = PUBLIC]`, the existence test placed
//! inside the `OR` of one subscription (the group and channel grants of the
//! participant branch are not modelled by the fixture).

use streamgres::model::Order::{ASC, DESC};
use streamgres::model::Value;

use super::world::{ME, World, ops, with};
use super::zql::{Q, eq, or, same, zql};

/// A full row image from its distinguishing columns.
type Row = Vec<(&'static str, Value)>;

/// Canvas `k2`: `u-2`'s public canvas in the channel folder.
fn k2() -> Row {
    row!["id" => "k2", "channelId" => "c1", "folderId" => "cf-c", "createdBy" => "u-2", "visibility" => "PUBLIC",
         "docType" => "Canvas", "isArchived" => false, "updatedAt" => 200, "title" => "Public in folder"]
    .to_vec()
}

/// Canvas `k6`: the caller's personal root canvas.
fn k6() -> Row {
    row!["id" => "k6", "createdBy" => ME, "visibility" => "PRIVATE", "docType" => "Canvas", "isArchived" => false,
         "updatedAt" => 600, "title" => "Personal root"]
    .to_vec()
}

/// Canvas `k7`: `u-2`'s private canvas reachable by legacy access ids.
fn k7() -> Row {
    row!["id" => "k7", "channelId" => "c1", "createdBy" => "u-2", "visibility" => "PRIVATE", "docType" => "Canvas",
         "isArchived" => false, "updatedAt" => 700, "viewAccessId" => "view-7", "editAccessId" => "edit-7",
         "title" => "Legacy ids"]
    .to_vec()
}

/// The canvases: folders (personal, channel, project, project-in-channel),
/// canvases `k1` to `k8` across them, participants, statuses, versions, a
/// comment thread with two comments.
fn seed_canvases(w: &mut World) {
    w.seed("channels", row!["id" => "c1", "name" => "general"]);
    w.seed("users", row!["id" => ME, "name" => "Aniket"]);
    w.seed("users", row!["id" => "u-2", "name" => "Meera"]);
    w.seed(
        "canvas_folders",
        row!["id" => "cf-p", "createdBy" => ME, "name" => "Personal"],
    );
    w.seed(
        "canvas_folders",
        row!["id" => "cf-c", "channelId" => "c1", "createdBy" => "u-2", "name" => "Channel docs"],
    );
    w.seed(
        "canvas_folders",
        row!["id" => "cf-pj", "projectId" => "p1", "createdBy" => "u-2", "name" => "Project docs"],
    );
    w.seed("canvas_folders", row!["id" => "cf-pj2", "projectId" => "p1", "channelId" => "c1", "createdBy" => ME, "name" => "Project chan"]);
    w.seed("canvases", row!["id" => "k1", "channelId" => "c1", "createdBy" => ME, "visibility" => "PRIVATE", "docType" => "Canvas", "isArchived" => false, "updatedAt" => 100, "title" => "Mine"]);
    w.seed("canvases", &k2());
    w.seed("canvases", row!["id" => "k3", "channelId" => "c1", "createdBy" => "u-2", "visibility" => "PRIVATE", "docType" => "Quarto", "isArchived" => false, "updatedAt" => 300, "userRepo" => "repo/k3", "title" => "Quarto private"]);
    w.seed("canvases", row!["id" => "k4", "channelId" => "c1", "createdBy" => "u-2", "visibility" => "PRIVATE", "docType" => "Canvas", "isArchived" => true, "updatedAt" => 400, "title" => "Archived"]);
    w.seed("canvases", row!["id" => "k5", "projectId" => "p1", "folderId" => "cf-pj", "createdBy" => ME, "visibility" => "PRIVATE", "docType" => "Canvas", "isArchived" => false, "updatedAt" => 500, "title" => "Project canvas"]);
    w.seed("canvases", &k6());
    w.seed("canvases", &k7());
    w.seed("canvases", row!["id" => "k8", "channelId" => "c1", "createdBy" => ME, "visibility" => "PRIVATE", "docType" => "Quarto", "isArchived" => false, "updatedAt" => 800, "userRepo" => "repo/k8", "title" => "My quarto"]);
    w.seed(
        "canvas_participants",
        row!["id" => "kp3", "canvasId" => "k3", "userId" => ME, "role" => "EDITOR"],
    );
    w.seed(
        "canvas_participants",
        row!["id" => "kp2", "canvasId" => "k2", "userId" => "u-2", "role" => "OWNER"],
    );
    w.seed(
        "canvas_user_status",
        row!["id" => "ks1", "canvasId" => "k1", "userId" => ME, "isStarred" => true],
    );
    w.seed(
        "canvas_user_status",
        row!["id" => "ks2", "canvasId" => "k1", "userId" => "u-2", "isStarred" => false],
    );
    w.seed(
        "canvas_versions",
        row!["id" => "kv1", "canvasId" => "k1", "name" => "v1", "updatedAt" => 1],
    );
    w.seed(
        "canvas_versions",
        row!["id" => "kv2", "canvasId" => "k1", "name" => "v2", "updatedAt" => 2],
    );
    w.seed("canvas_comment_threads", row!["id" => "th1", "canvasId" => "k1", "initialCommentId" => "cc1", "status" => "OPEN", "createdAt" => 1]);
    w.seed("canvas_comments", row!["id" => "cc1", "threadId" => "th1", "canvasId" => "k1", "body" => "first", "isInitial" => true, "createdAt" => 1]);
    w.seed("canvas_comments", row!["id" => "cc2", "threadId" => "th1", "canvasId" => "k1", "body" => "second", "isInitial" => false, "createdAt" => 2]);
}

/// The visibility rule: mine, or public when asked, or a canvas the
/// caller participates in (an existence test inside the `OR`).
fn visible(query: Q, include_public: bool) -> Q {
    let mut query = query;
    let participant = query.exists("participants", |p| p.eq("userId", ME));
    let mut branches = vec![eq("createdBy", ME)];
    if include_public {
        branches.push(eq("visibility", "PUBLIC"));
    }
    branches.push(participant);
    query.filter(or(branches))
}

/// The caller's own status row on each canvas.
fn with_my_status(query: Q) -> Q {
    query.related("userStatuses", |s| s.eq("userId", ME))
}

/// `personalCanvasFolders`: the caller's folders outside any project or
/// channel (both `IS NULL`).
#[test]
fn personal_canvas_folders() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = zql("canvas_folders")
        .where_is_null("projectId")
        .where_is_null("channelId")
        .eq("createdBy", ME)
        .order_by("name", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cf-p"]));
    assert_eq!(
        w.insert(
            "canvas_folders",
            row!["id" => "cf-new", "createdBy" => ME, "name" => "Drafts"]
        ),
        ops(["q/main+cf-new"])
    );
}

/// `hierarchyCanvases` at a channel's root: live canvases of the channel
/// the caller may see (`folderId IS NULL`, own, public or participating),
/// with the caller's status.
#[test]
fn hierarchy_canvases() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = with_my_status(
        visible(
            zql("canvases")
                .eq("channelId", "c1")
                .eq("docType", "Canvas")
                .eq("isArchived", false)
                .where_is_null("folderId"),
            true,
        )
        .order_by("updatedAt", DESC),
    );
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+k1", "q/userStatuses+ks1"])
    );
    assert_eq!(
        w.update("canvases", &with(&k7(), row!["visibility" => "PUBLIC"])),
        ops(["q/main+k7"])
    );
}

/// `channelCanvasFolders`: a channel's folders by name.
#[test]
fn channel_canvas_folders() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = zql("canvas_folders")
        .eq("channelId", "c1")
        .order_by("name", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cf-c", "q/main+cf-pj2"]));
    assert_eq!(w.delete("canvas_folders", "cf-c"), ops(["q/main-cf-c"]));
}

/// `projectCanvasFolders`: a project's folders outside channels
/// (`channelId IS NULL`).
#[test]
fn project_canvas_folders() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = zql("canvas_folders")
        .eq("projectId", "p1")
        .where_is_null("channelId")
        .order_by("name", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cf-pj"]));
}

/// `projectFolderCanvases`: live canvases of a project folder outside
/// channels the caller may see.
#[test]
fn project_folder_canvases() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = with_my_status(
        visible(
            zql("canvases")
                .eq("folderId", "cf-pj")
                .eq("projectId", "p1")
                .where_is_null("channelId")
                .eq("docType", "Canvas")
                .eq("isArchived", false),
            true,
        )
        .order_by("updatedAt", DESC),
    );
    assert_eq!(w.subscribe("q", &q), ops(["q/main+k5"]));
    assert_eq!(
        w.insert("canvases", row!["id" => "k9", "projectId" => "p1", "folderId" => "cf-pj", "createdBy" => "u-2", "visibility" => "PUBLIC", "docType" => "Canvas", "isArchived" => false, "updatedAt" => 900]),
        ops(["q/main+k9"])
    );
}

/// `channelCanvasesPaginated`: a page of a channel's live canvases the
/// caller may see, with participants, channel and the caller's status;
/// archiving one removes it and its participants.
#[test]
fn channel_canvases_paginated() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = with_my_status(
        visible(
            zql("canvases")
                .eq("channelId", "c1")
                .eq("docType", "Canvas")
                .eq("isArchived", false),
            true,
        )
        .order_by("updatedAt", DESC)
        .order_by("id", DESC)
        .start(&[("updatedAt", DESC, 1000.into())], false)
        .limit(10)
        .related("participants", same)
        .related("channel", same),
    );
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+k1",
            "q/main+k2",
            "q/participants+kp2",
            "q/channel+c1",
            "q/userStatuses+ks1"
        ])
    );
    assert_eq!(
        w.update("canvases", &with(&k2(), row!["isArchived" => true])),
        ops(["q/main-k2", "q/participants-kp2"])
    );
}

/// `channelQuartoDocsPaginated`: a channel's Quarto documents with
/// participants, channel and the caller's status.
#[test]
fn channel_quarto_docs_paginated() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = with_my_status(
        zql("canvases")
            .eq("channelId", "c1")
            .eq("docType", "Quarto")
            .order_by("updatedAt", DESC)
            .order_by("id", DESC)
            .start(&[("updatedAt", DESC, 1000.into())], false)
            .limit(10)
            .related("participants", same)
            .related("channel", same),
    );
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+k3",
            "q/main+k8",
            "q/participants+kp3",
            "q/channel+c1"
        ])
    );
    assert_eq!(
        w.delete("canvas_participants", "kp3"),
        ops(["q/participants-kp3"])
    );
}

/// `userCanvasesPaginated`: the caller's own live canvases and those
/// reached through participation (no public branch here), newest first.
#[test]
fn user_canvases_paginated() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = with_my_status(
        visible(zql("canvases"), false)
            .eq("docType", "Canvas")
            .eq("isArchived", false)
            .order_by("updatedAt", DESC)
            .order_by("id", DESC)
            .start(&[("updatedAt", DESC, 1000.into())], true)
            .limit(10)
            .related("participants", same),
    );
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+k1", "q/main+k5", "q/main+k6", "q/userStatuses+ks1"])
    );
    assert_eq!(
        w.update("canvases", &with(&k6(), row!["isArchived" => true])),
        ops(["q/main-k6"])
    );
}

/// `userQuartoDocsPaginated`: the caller's Quarto documents, own or
/// reached through participation (`k3`), one subscription.
#[test]
fn user_quarto_docs_paginated() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = with_my_status(
        visible(zql("canvases").eq("docType", "Quarto"), false)
            .order_by("updatedAt", DESC)
            .order_by("id", DESC)
            .limit(10)
            .related("participants", same),
    );
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+k3",
            "q/main+k8",
            "q/has:participants+kp3",
            "q/participants+kp3"
        ])
    );
    assert_eq!(
        w.delete("canvas_participants", "kp3"),
        ops(["q/main-k3", "q/has:participants-kp3", "q/participants-kp3"])
    );
}

/// `canvasParticipants`: a canvas's participants with the canvas.
#[test]
fn canvas_participants() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = zql("canvas_participants")
        .eq("canvasId", "k3")
        .related("canvas", same);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+kp3", "q/canvas+k3"]));
    assert_eq!(
        w.insert(
            "canvas_participants",
            row!["id" => "kp3b", "canvasId" => "k3", "userId" => "u-2", "role" => "VIEWER"]
        ),
        ops(["q/main+kp3b"])
    );
}

/// `canvasCommentThreads`: a canvas's threads with their first comment.
#[test]
fn canvas_comment_threads() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = zql("canvas_comment_threads")
        .eq("canvasId", "k1")
        .order_by("createdAt", ASC)
        .related("initialComment", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+th1", "q/initialComment+cc1"])
    );
    assert_eq!(
        w.delete("canvas_comment_threads", "th1"),
        ops(["q/main-th1", "q/initialComment-cc1"])
    );
}

/// `canvasThreadComments`: a thread's comments, oldest first.
#[test]
fn canvas_thread_comments() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = zql("canvas_comments")
        .eq("threadId", "th1")
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+cc1", "q/main+cc2"]));
    assert_eq!(
        w.insert("canvas_comments", row!["id" => "cc3", "threadId" => "th1", "canvasId" => "k1", "body" => "third", "isInitial" => false, "createdAt" => 3]),
        ops(["q/main+cc3"])
    );
}

/// `getCanvas`: a canvas by any of its ids, if visible; a private canvas
/// of someone else appears once made public.
#[test]
fn get_canvas() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let by_id = |id: &'static str| {
        visible(
            zql("canvases")
                .filter(or(vec![
                    eq("id", id),
                    eq("userRepo", id),
                    eq("viewAccessId", id),
                    eq("editAccessId", id),
                ]))
                .related("participants", same)
                .related("channel", same),
            true,
        )
        .one()
    };
    assert_eq!(
        w.subscribe("k1", &by_id("k1")),
        ops(["k1/main+k1", "k1/channel+c1"])
    );
    assert_eq!(w.subscribe("legacy", &by_id("view-7")), ops([]));
    assert_eq!(
        w.update("canvases", &with(&k7(), row!["visibility" => "PUBLIC"])),
        ops(["legacy/main+k7", "legacy/channel+c1"])
    );
}

/// `canvasVersions`: a canvas's versions, the canvas an existence test
/// under the visibility rule (only the versions' own canvas ships).
#[test]
fn canvas_versions() {
    let mut w = World::new();
    seed_canvases(&mut w);
    let q = zql("canvas_versions")
        .eq("canvasId", "k1")
        .where_exists("canvas", |c| visible(c, true))
        .order_by("updatedAt", DESC)
        .order_by("id", DESC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/has:canvas+k1", "q/main+kv1", "q/main+kv2"])
    );
    assert_eq!(w.delete("canvas_versions", "kv2"), ops(["q/main-kv2"]));
}

/// Knowledge collections: root `col-root` scoped to `c1` with a subfolder,
/// a deleted root, a second root scoped to `c2`; items (latest, older,
/// deleted) with attachments; permissions for the caller, a group and a
/// channel.
fn seed_collections(w: &mut World) {
    w.seed("channels", row!["id" => "c1", "name" => "general"]);
    w.seed("users", row!["id" => ME, "name" => "Aniket"]);
    w.seed("user_groups", row!["id" => "g1", "name" => "Payments"]);
    w.seed("collections", row!["id" => "col-root", "rootCollectionId" => "col-root", "scopeType" => "CHANNEL", "scopeId" => "c1", "name" => "KB", "createdAt" => 1]);
    w.seed("collections", row!["id" => "col-sub", "parentId" => "col-root", "rootCollectionId" => "col-root", "scopeType" => "CHANNEL", "scopeId" => "c1", "name" => "Runbooks", "createdAt" => 2]);
    w.seed("collections", row!["id" => "col-del", "rootCollectionId" => "col-del", "scopeType" => "CHANNEL", "scopeId" => "c1", "name" => "Gone", "createdAt" => 3, "deletedAt" => 5]);
    w.seed("collections", row!["id" => "col-root2", "rootCollectionId" => "col-root2", "scopeType" => "CHANNEL", "scopeId" => "c2", "name" => "Other", "createdAt" => 4]);
    w.seed("collection_items", row!["id" => "ci1", "collectionId" => "col-root", "rootCollectionId" => "col-root", "isLatest" => true, "name" => "a.pdf", "createdAt" => 1]);
    w.seed("collection_items", row!["id" => "ci2", "collectionId" => "col-sub", "rootCollectionId" => "col-root", "isLatest" => true, "name" => "b.pdf", "createdAt" => 2]);
    w.seed("collection_items", row!["id" => "ci3", "collectionId" => "col-root", "rootCollectionId" => "col-root", "isLatest" => false, "name" => "a-old.pdf", "createdAt" => 3]);
    w.seed("collection_items", row!["id" => "ci4", "collectionId" => "col-root", "rootCollectionId" => "col-root", "isLatest" => true, "name" => "c.pdf", "createdAt" => 4, "deletedAt" => 9]);
    w.seed("message_attachments", row!["id" => "ca1", "entityId" => "ci1", "entityType" => "COLLECTION", "isDeleted" => false]);
    w.seed(
        "message_attachments",
        row!["id" => "ca2", "entityId" => "ci2", "entityType" => "COLLECTION", "isDeleted" => true],
    );
    w.seed(
        "collection_permissions",
        row!["id" => "cpm1", "collectionId" => "col-root", "userId" => ME, "role" => "EDITOR"],
    );
    w.seed("collection_permissions", row!["id" => "cpm2", "collectionId" => "col-root", "userGroupId" => "g1", "role" => "VIEWER"]);
    w.seed(
        "collection_permissions",
        row!["id" => "cpm3", "collectionId" => "col-root", "channelId" => "c1", "role" => "VIEWER"],
    );
    w.seed(
        "collection_permissions",
        row!["id" => "cpm4", "collectionId" => "col-root2", "userId" => "u-2", "role" => "OWNER"],
    );
}

/// `collectionSubfolders`: the live folders under a root (`parentId IS
/// NOT NULL`, `deletedAt IS NULL`), the root itself excluded.
#[test]
fn collection_subfolders() {
    let mut w = World::new();
    seed_collections(&mut w);
    let q = zql("collections")
        .eq("rootCollectionId", "col-root")
        .where_is_not_null("parentId")
        .where_is_null("deletedAt")
        .order_by("createdAt", ASC);
    assert_eq!(w.subscribe("q", &q), ops(["q/main+col-sub"]));
    assert_eq!(
        w.insert("collections", row!["id" => "col-sub2", "parentId" => "col-root", "rootCollectionId" => "col-root", "name" => "Specs", "createdAt" => 6]),
        ops(["q/main+col-sub2"])
    );
}

/// `collectionItems`: a folder's latest live files (`deletedAt IS NULL`)
/// with their live collection attachment.
#[test]
fn collection_items() {
    let mut w = World::new();
    seed_collections(&mut w);
    let q = zql("collection_items")
        .eq("collectionId", "col-root")
        .eq("isLatest", true)
        .where_is_null("deletedAt")
        .order_by("createdAt", ASC)
        .related("attachment", |a| {
            a.eq("entityType", "COLLECTION").eq("isDeleted", false)
        });
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+ci1", "q/attachment+ca1"])
    );
    assert_eq!(
        w.update("collection_items", row!["id" => "ci3", "collectionId" => "col-root", "rootCollectionId" => "col-root", "isLatest" => true, "name" => "a-old.pdf", "createdAt" => 3]),
        ops(["q/main+ci3"])
    );
}

/// `collectionFilesByRoot`: every latest live file across a whole
/// collection with its live attachment.
#[test]
fn collection_files_by_root() {
    let mut w = World::new();
    seed_collections(&mut w);
    let q = zql("collection_items")
        .eq("rootCollectionId", "col-root")
        .eq("isLatest", true)
        .where_is_null("deletedAt")
        .order_by("createdAt", ASC)
        .related("attachment", |a| a.eq("isDeleted", false));
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+ci1", "q/main+ci2", "q/attachment+ca1"])
    );
    assert_eq!(
        w.update("message_attachments", row!["id" => "ca2", "entityId" => "ci2", "entityType" => "COLLECTION", "isDeleted" => false]),
        ops(["q/attachment+ca2"])
    );
}

/// `collectionById`: one live collection; a deleted one resolves to
/// nothing.
#[test]
fn collection_by_id() {
    let mut w = World::new();
    seed_collections(&mut w);
    assert_eq!(
        w.subscribe(
            "q",
            &zql("collections")
                .eq("id", "col-root")
                .where_is_null("deletedAt")
        ),
        ops(["q/main+col-root"])
    );
    assert_eq!(
        w.subscribe(
            "gone",
            &zql("collections")
                .eq("id", "col-del")
                .where_is_null("deletedAt")
        ),
        ops([])
    );
}

/// `scopedCollections` for a channel: live root collections (`parentId
/// IS NULL`, `deletedAt IS NULL`) with the caller's permission rows; gap
/// X: group and channel grants are existence tests inside the permission
/// filter's `OR`.
#[test]
fn scoped_collections() {
    let mut w = World::new();
    seed_collections(&mut w);
    let q = zql("collections")
        .eq("scopeType", "CHANNEL")
        .eq("scopeId", "c1")
        .where_is_null("parentId")
        .where_is_null("deletedAt")
        .related("permissions", |p| p.eq("userId", ME))
        .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops(["q/main+col-root", "q/permissions+cpm1"])
    );
    assert_eq!(
        w.delete("collection_permissions", "cpm1"),
        ops(["q/permissions-cpm1"])
    );
}

/// `scopedCollectionsWithItems`: the same plus every latest file in each
/// collection.
#[test]
fn scoped_collections_with_items() {
    let mut w = World::new();
    seed_collections(&mut w);
    let q = zql("collections")
        .eq("scopeType", "CHANNEL")
        .eq("scopeId", "c1")
        .where_is_null("parentId")
        .where_is_null("deletedAt")
        .related("permissions", |p| p.eq("userId", ME))
        .related("allItems", |i| i.eq("isLatest", true))
        .order_by("createdAt", ASC);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+col-root",
            "q/permissions+cpm1",
            "q/allItems+ci1",
            "q/allItems+ci4",
            "q/allItems+ci2"
        ])
    );
    assert_eq!(w.delete("collection_items", "ci4"), ops(["q/allItems-ci4"]));
}

/// `collectionPermissions`: every grant on a collection with the user,
/// group or channel it names.
#[test]
fn collection_permissions() {
    let mut w = World::new();
    seed_collections(&mut w);
    let q = zql("collection_permissions")
        .eq("collectionId", "col-root")
        .related("user", same)
        .related("userGroup", same)
        .related("channel", same);
    assert_eq!(
        w.subscribe("q", &q),
        ops([
            "q/main+cpm1",
            "q/main+cpm2",
            "q/main+cpm3",
            "q/user+u-me",
            "q/userGroup+g1",
            "q/channel+c1"
        ])
    );
    assert_eq!(
        w.delete("collection_permissions", "cpm2"),
        ops(["q/main-cpm2", "q/userGroup-g1"])
    );
}
