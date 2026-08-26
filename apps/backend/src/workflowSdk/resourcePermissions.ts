// Row-level bookkeeping for workflow-sdk resources, over the polymorphic
// public.sdk_resource_permissions table. An owner row is stamped on create so
// the creator is recorded (the credential vault shows it as `createdBy`).
//
// Visibility itself is NOT decided here: access to the v2 engine is the
// WORKFLOW-STUDIO ACL resource, exactly as automations use their own resource,
// so everything in a workspace is visible to everyone holding that grant. The
// owner rows accumulate for a later per-resource phase; nothing reads them for
// authorization today.

import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/database/client';
import { SDK_WORKFLOW_TYPE } from './acl';

type SdkResourceType = 'workflow' | 'folder' | 'credential';

export enum SdkResourceRole {
  Owner = 'owner',
  Editor = 'editor',
  Viewer = 'viewer',
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Credential names are workspace-local, so their polymorphic permission ID must be scoped. */
export const credentialPermissionId = (workspaceId: string, name: string): string =>
  `${workspaceId}:${name}`;

/** Upsert a grant on the (user, type, id) unique index — stamps ownership at create. */
export const grantSdkPermission = async (
  tx: Db,
  workspaceId: string,
  userId: string,
  type: SdkResourceType,
  resourceId: string,
  role: SdkResourceRole,
): Promise<void> => {
  await tx.sdkResourcePermission.upsert({
    where: {
      userId_resourceType_resourceId: { userId, resourceType: type, resourceId },
    },
    create: { workspaceId, userId, resourceType: type, resourceId, role },
    update: { role },
  });
};

// ─── Accessible-resources queries (the visibleFilter predicate) ──────────────

type AccessibleFilter = { userId: string; workspaceId: string };

export const getUserAccessibleWorkflows = async (
  filter: AccessibleFilter,
  page?: { folderId?: string; limit?: number; offset?: number },
) => {
  // SDK workflows live on the shared legacy table, discriminated by
  // workflowType='SDK' — never expose legacy/automation rows.
  return db.workflow.findMany({
    where: {
      workflowType: SDK_WORKFLOW_TYPE,
      workspaceId: filter.workspaceId,
      ...(page?.folderId ? { folderId: page.folderId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    ...(page?.limit !== undefined ? { take: page.limit } : {}),
    ...(page?.offset !== undefined ? { skip: page.offset } : {}),
  });
};

export const getUserAccessibleFolders = async (filter: AccessibleFilter) => {
  return db.sdkFolder.findMany({
    where: { workspaceId: filter.workspaceId },
    orderBy: { createdAt: 'desc' },
  });
};

/** Total + per-folder counts over the visible workflow set (folder rail). */
export const getAccessibleWorkflowCounts = async (
  filter: AccessibleFilter,
): Promise<{ total: number; byFolder: Record<string, { total: number; active: number }> }> => {
  const rows = await db.workflow.findMany({
    where: { workflowType: SDK_WORKFLOW_TYPE, workspaceId: filter.workspaceId },
    select: { id: true, folderId: true, status: true },
  });
  const byFolder: Record<string, { total: number; active: number }> = {};
  for (const r of rows) {
    const folderId = r.folderId ?? 'default';
    const e = byFolder[folderId] ?? { total: 0, active: 0 };
    e.total++;
    if (r.status === 'ACTIVE') e.active++;
    byFolder[folderId] = e;
  }
  return { total: rows.length, byFolder };
};

/** Resolve each resource's creator from its single Owner permission row. */
export const getResourceOwners = async (
  refs: ReadonlyArray<{ type: SdkResourceType; id: string }>,
): Promise<Map<string, { userId: string; email: string }>> => {
  if (refs.length === 0) return new Map();
  const rows = await db.sdkResourcePermission.findMany({
    where: {
      role: SdkResourceRole.Owner,
      OR: refs.map(r => ({ resourceType: r.type, resourceId: r.id })),
    },
    select: { resourceType: true, resourceId: true, userId: true },
  });
  if (rows.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: Array.from(new Set(rows.map(r => r.userId))) } },
    select: { id: true, email: true },
  });
  const emailById = new Map(users.map(u => [u.id, u.email]));
  return new Map(
    rows.map(r => [
      `${r.resourceType}:${r.resourceId}`,
      { userId: r.userId, email: emailById.get(r.userId) ?? '' },
    ]),
  );
};
