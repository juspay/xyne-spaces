import { PrismaClient, Collection } from '@prisma/client';
import { CollectionRole, IngestionStatus } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';

/**
 * Centralised collection-permission logic.
 *
 * The legacy CollectionController.getCollectionOrRole() only checked direct
 * (collectionId, userId) rows in collection_permissions — it ignored grants
 * issued via userGroupId, so users who only had access through a group were
 * silently denied. This module is the single source of truth that honours
 * BOTH direct and group permissions, plus owner + public fallback, and is the
 * implementation backing the /api/collections/accessible listing endpoint.
 */

export type EffectiveRole = CollectionRole;

export interface ResolvedRoleResult {
    role: EffectiveRole | null;
}

export interface AccessibleCollectionItem {
    id: string;
    name: string;
    itemType: 'file';
    fileId: string;
    ingestionStatus: IngestionStatus;
    createdAt: Date;
    updatedAt: Date;
}

export interface AccessibleCollectionNode extends Pick<Collection, 'id' | 'name' | 'description' | 'isPrivate' | 'ownerId' | 'scopeType' | 'scopeId' | 'parentId' | 'rootCollectionId'> {
    effectiveRole: EffectiveRole;
    /** Channel display name resolved from scopeId when scopeType='CHANNEL'.
     *  Populated only on ROOT collection nodes — sub-folders inherit through the tree. */
    channelName?: string;
    /** Project id of the channel that owns this collection. Used to group
     *  collections by project in the KB picker. */
    projectId?: string;
    /** Project display name. */
    projectName?: string;
    /** Sub-folders. Present only when includeItems=true. */
    children?: AccessibleCollectionNode[];
    /** Direct file children of this folder. Present only when includeItems=true. */
    items?: AccessibleCollectionItem[];
}

/** Permission rank — higher wins when a user has both direct and group grants. */
const ROLE_RANK: Record<CollectionRole, number> = {
    [CollectionRole.VIEWER]: 1,
    [CollectionRole.EDITOR]: 2,
    [CollectionRole.OWNER]: 3,
};

function maxRole(a: CollectionRole | null, b: CollectionRole | null): CollectionRole | null {
    if (!a) return b;
    if (!b) return a;
    return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

async function getUserGroupIds(db: PrismaClient, userId: string): Promise<string[]> {
    const rows = await db.userGroupMapping.findMany({
        where: { userId },
        select: { userGroupId: true },
    });
    return rows.map(r => r.userGroupId);
}

async function getUserChannelIds(db: PrismaClient, userId: string): Promise<string[]> {
    const rows = await db.channelParticipant.findMany({
        where: { userId },
        select: { channelId: true },
    });
    return rows.map(r => r.channelId);
}

/**
 * Resolve the effective role for a user on a single (already-loaded) collection.
 * Caller must pre-load permissions if they want the same single-query path the
 * controller used. Group permissions require a separate user-group lookup —
 * pass `userGroupIds` to avoid re-querying when checking many collections.
 */
export async function resolveCollectionAccess(
    userId: string,
    collection: Pick<Collection, 'ownerId' | 'isPrivate'> & {
        permissions?: Array<{ userId: string | null; userGroupId: string | null; channelId?: string | null; role: CollectionRole }>;
    },
    options?: { userGroupIds?: string[]; userChannelIds?: string[] }
): Promise<ResolvedRoleResult> {
    if (collection.ownerId === userId) {
        return { role: CollectionRole.OWNER };
    }

    const db = DatabaseClient.getInstance();
    const userGroupIds = options?.userGroupIds ?? (await getUserGroupIds(db, userId));
    const groupSet = new Set(userGroupIds);
    const userChannelIds = options?.userChannelIds ?? (await getUserChannelIds(db, userId));
    const channelSet = new Set(userChannelIds);

    let role: CollectionRole | null = null;
    for (const p of collection.permissions ?? []) {
        if (p.userId === userId) role = maxRole(role, p.role);
        if (p.userGroupId && groupSet.has(p.userGroupId)) role = maxRole(role, p.role);
        // Channel grants are always stored as VIEWER (enforced in
        // grantPermission), so this can never elevate anyone above VIEWER.
        if (p.channelId && channelSet.has(p.channelId)) role = maxRole(role, p.role);
    }

    if (!role && !collection.isPrivate) {
        // Public collections grant implicit VIEWER (read-only) — write access
        // requires being the owner or an explicit collaborator (EDITOR/OWNER
        // CollectionPermission row). See zero/mutators.ts's matching write-path
        // checks for the enforcement side of this.
        role = CollectionRole.VIEWER;
    }

    return { role };
}

/**
 * Return every root collection (parentId IS NULL) the user can access — owner,
 * direct grant, group grant, or public (non-private), scoped to the caller's
 * workspace. Returns the row PLUS the resolved `effectiveRole` so the caller
 * doesn't need to re-derive it.
 */
export async function listAccessibleRootCollections(
    userId: string,
    workspaceId: string,
    options?: { scopeType?: string; scopeId?: string }
): Promise<Array<AccessibleCollectionNode>> {
    const db = DatabaseClient.getInstance();
    const userGroupIds = await getUserGroupIds(db, userId);
    const userChannelIds = await getUserChannelIds(db, userId);

    const rows = await db.collection.findMany({
        where: {
            parentId: null,
            deletedAt: null,
            workspaceId,
            ...(options?.scopeType ? { scopeType: options.scopeType } : {}),
            ...(options?.scopeId ? { scopeId: options.scopeId } : {}),
            OR: [
                { ownerId: userId },
                { isPrivate: false },
                { permissions: { some: { userId } } },
                ...(userGroupIds.length > 0
                    ? [{ permissions: { some: { userGroupId: { in: userGroupIds } } } }]
                    : []),
                ...(userChannelIds.length > 0
                    ? [{ permissions: { some: { channelId: { in: userChannelIds } } } }]
                    : []),
            ],
        },
        include: {
            permissions: {
                where: {
                    OR: [
                        { userId },
                        ...(userGroupIds.length > 0 ? [{ userGroupId: { in: userGroupIds } }] : []),
                        ...(userChannelIds.length > 0 ? [{ channelId: { in: userChannelIds } }] : []),
                    ],
                },
                select: { userId: true, userGroupId: true, channelId: true, role: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Resolve channel + project metadata for grouping in the picker UI.
    // We batch on the CHANNEL-scoped subset; non-channel scopes (future
    // THREAD/TICKET) fall back to scopeType as the bucket label.
    const channelIds = [...new Set(
        rows.filter(r => r.scopeType === 'CHANNEL').map(r => r.scopeId).filter(Boolean)
    )];
    const channelMeta = new Map<string, { name: string; projectId: string; projectName: string }>();
    if (channelIds.length > 0) {
        // NOTE: do NOT select the required `channel.project` relation here.
        // Projects are hard-deleted with no FK cascade (relationMode = "prisma"),
        // so a channel can outlive its project. Selecting the required relation
        // makes Prisma throw "Field project is required to return data, got null"
        // for the ENTIRE query, breaking collection listings for every user whose
        // result set happens to include one orphaned channel-scoped collection.
        // Instead we select the scalar projectId and resolve project names via a
        // separate batch lookup that tolerates missing projects.
        const channels = await db.channel.findMany({
            where: { id: { in: channelIds } },
            select: {
                id: true,
                name: true,
                projectId: true,
            },
        });

        const projectIds = [...new Set(channels.map(c => c.projectId).filter(Boolean))];
        const projectNames = new Map<string, string>();
        if (projectIds.length > 0) {
            const projects = await db.project.findMany({
                where: { id: { in: projectIds } },
                select: { id: true, name: true },
            });
            for (const p of projects) {
                projectNames.set(p.id, p.name);
            }
        }

        for (const c of channels) {
            channelMeta.set(c.id, {
                name: c.name,
                projectId: c.projectId,
                // Orphaned channel (project hard-deleted): fall back to a blank
                // project name instead of throwing.
                projectName: projectNames.get(c.projectId) ?? '',
            });
        }
    }

    const out: AccessibleCollectionNode[] = [];
    for (const row of rows) {
        const { role } = await resolveCollectionAccess(
            userId,
            { ownerId: row.ownerId, isPrivate: row.isPrivate, permissions: row.permissions as Array<{ userId: string | null; userGroupId: string | null; channelId: string | null; role: CollectionRole }> },
            { userGroupIds, userChannelIds }
        );
        if (!role) continue;
        const meta = row.scopeType === 'CHANNEL' ? channelMeta.get(row.scopeId) : undefined;
        out.push({
            id: row.id,
            name: row.name,
            description: row.description,
            isPrivate: row.isPrivate,
            ownerId: row.ownerId,
            scopeType: row.scopeType,
            scopeId: row.scopeId,
            parentId: row.parentId,
            rootCollectionId: row.rootCollectionId,
            effectiveRole: role,
            ...(meta?.name ? { channelName: meta.name } : {}),
            ...(meta?.projectId ? { projectId: meta.projectId } : {}),
            ...(meta?.projectName ? { projectName: meta.projectName } : {}),
        });
    }
    return out;
}

/**
 * Build the full tree (sub-folders + files) under each given root collection.
 * Used when the frontend picker wants per-file granularity. Sub-folders inherit
 * the root's effective role — selecting a sub-folder grants access to its
 * sub-tree only (enforced at the agent-tools layer, not here).
 */
export async function expandCollectionTrees(
    roots: AccessibleCollectionNode[]
): Promise<AccessibleCollectionNode[]> {
    if (roots.length === 0) return roots;
    const db = DatabaseClient.getInstance();
    const rootIds = roots.map(r => r.id);

    // Fetch every descendant folder + every latest file in one shot, then build
    // the tree in memory. This is O(N) in collection size rather than O(depth).
    const [allFolders, allFiles] = await Promise.all([
        db.collection.findMany({
            where: { rootCollectionId: { in: rootIds }, deletedAt: null, parentId: { not: null } },
            select: { id: true, name: true, description: true, isPrivate: true, ownerId: true, scopeType: true, scopeId: true, parentId: true, rootCollectionId: true },
            orderBy: { createdAt: 'asc' },
        }),
        db.collectionItem.findMany({
            where: { rootCollectionId: { in: rootIds }, isLatest: true, deletedAt: null },
            select: { id: true, name: true, fileId: true, ingestionStatus: true, createdAt: true, updatedAt: true, collectionId: true },
            orderBy: { createdAt: 'asc' },
        }),
    ]);

    const nodeById = new Map<string, AccessibleCollectionNode>();
    for (const r of roots) {
        const n: AccessibleCollectionNode = { ...r, children: [], items: [] };
        nodeById.set(r.id, n);
    }
    for (const f of allFolders) {
        const root = roots.find(r => r.id === f.rootCollectionId);
        if (!root) continue;
        nodeById.set(f.id, {
            ...f,
            effectiveRole: root.effectiveRole,
            children: [],
            items: [],
        });
    }
    // Wire folder children
    for (const f of allFolders) {
        const node = nodeById.get(f.id);
        const parent = f.parentId ? nodeById.get(f.parentId) : undefined;
        if (node && parent) parent.children!.push(node);
    }
    // Wire file children
    for (const file of allFiles) {
        const folder = nodeById.get(file.collectionId);
        if (!folder) continue;
        folder.items!.push({
            id: file.id,
            name: file.name,
            itemType: 'file',
            fileId: file.fileId,
            ingestionStatus: file.ingestionStatus as IngestionStatus,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
        });
    }

    return roots.map(r => nodeById.get(r.id)!);
}
