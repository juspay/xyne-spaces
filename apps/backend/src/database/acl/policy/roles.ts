import { PrismaClient } from '@prisma/client'
import type { ACLContext } from '../base-acl'
import { hasResourceAdminAccess } from '../admin-access'

/**
 * Role checks shared by every policy class. One place, so "who is an admin" can't drift
 * between tables.
 *
 * Workspace roles (ctx.role): OWNER | ADMIN | MEMBER | COMMUNITY_MEMBER | GUEST.
 * COMMUNITY_MEMBER is a normal member inside their own workspace and needs no branch here: the
 * workspace filter already keeps them out of every other workspace. What they may not do
 * (create a workspace) is enforced where workspaces are created.
 */

const WORKSPACE_ADMIN_ROLES = new Set(['OWNER', 'ADMIN'])
const ORG_ADMIN_ROLES = new Set(['OWNER', 'ADMIN'])

/** Workspace OWNER or ADMIN. */
export function isWorkspaceAdmin(ctx: Pick<ACLContext, 'role'>): boolean {
  return WORKSPACE_ADMIN_ROLES.has(ctx.role ?? '')
}

/** A guest: reaches only what GuestAccess grants. */
export function isGuest(ctx: Pick<ACLContext, 'role'>): boolean {
  return ctx.role === 'GUEST'
}

/**
 * ADMIN on a named resource (ROLES, FORMS, LISTPROJECTS, …), granted directly or through a group,
 * or a workspace admin. Every lookup is limited to the caller's workspace.
 */
export async function hasResourceAdmin(
  prisma: PrismaClient,
  ctx: Pick<ACLContext, 'role' | 'userId' | 'workspaceId'>,
  resource: string,
): Promise<boolean> {
  if (isWorkspaceAdmin(ctx)) return true
  return hasResourceAdminAccess(prisma, ctx.userId, resource, ctx.workspaceId)
}

/**
 * Org memberships of the caller, with their org role. An OrgMember row is one org per email, so
 * this is normally a single row. `[]` when the caller has no member identity: callers treat that
 * as "no org", which denies.
 */
export async function callerOrgMemberships(
  prisma: PrismaClient,
  ctx: Pick<ACLContext, 'memberId'>,
): Promise<{ orgId: string; role: string }[]> {
  if (!ctx.memberId) return []
  return prisma.orgMember.findMany({
    where: { memberId: ctx.memberId, leftAt: null },
    select: { orgId: true, role: true },
  })
}

/** Org ids the caller belongs to; with `adminOnly`, only those where they are OWNER/ADMIN. */
export async function callerOrgIds(
  prisma: PrismaClient,
  ctx: Pick<ACLContext, 'memberId'>,
  opts: { adminOnly?: boolean } = {},
): Promise<string[]> {
  const rows = await callerOrgMemberships(prisma, ctx)
  return rows.filter((r) => !opts.adminOnly || ORG_ADMIN_ROLES.has(r.role)).map((r) => r.orgId)
}
