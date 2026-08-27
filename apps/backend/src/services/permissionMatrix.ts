import { Prisma } from '@prisma/client';
import { AccessType, WorkspaceRole } from '@xyne/shared';
import { logger } from '../utils/logger';
import { repositories } from '../database/repositories/index';
import { db } from '../database/client';
import { withWorkspaceScope } from '../database/tenant/context';
import { aclAuditService } from './aclAuditService';

/**
 * Exhaustive union of all resource names used in the permission matrix.
 * A typo here (or in any matrix entry) is a compile-time error, not a silent runtime skip.
 */
export type ResourceName =
  | 'TICKETS'
  | 'TICKET-REPORTS'
  | 'WORKFLOWS'
  | 'AGENTS'
  | 'MODELS'
  | 'TOOLS'
  | 'AGENT-TOOLS-MAPPINGS'
  | 'ANALYTICS'
  | 'PROJECTS'
  | 'XYNE-APPS'
  | 'USER-MANAGEMENT'
  | 'USERS'
  | 'FORMS'
  | 'SUPPORT'
  | 'PRODUCT-INSIGHTS'
  | 'LISTPROJECTS'
  | 'CHANNELS'
  | 'CANVASES'
  | 'WORKSPACE'
  | 'ORGANIZATIONS'
  | 'TICKET-MIGRATION'
  | 'CONFLUENCE-MIGRATION'
  | 'EXTERNAL-STEP-RESPONSE'
  | 'VESPA'
  | 'SDLC';

export interface PermissionEntry {
  resourceName: ResourceName;
  accessType: AccessType;
}

/**
 * Centralised role → resource → accessType permission matrix.
 * Replaces the 3 divergent helpers: DEFAULT_USER_RESOURCES (8 WRITE),
 * grantDefaultResources (4 WRITE), grantWorkspaceOwnerResources (21 ADMIN).
 *
 * MEMBER: 12 WRITE | ADMIN: 21 ADMIN | OWNER: 21 ADMIN | GUEST: 3 WRITE + 2 READ
 *
 * Typed as Record<WorkspaceRole, readonly PermissionEntry[]> so that:
 *   1. Every WorkspaceRole must have an entry (exhaustiveness).
 *   2. Every resourceName is validated against the ResourceName union at compile time.
 */
export const PERMISSION_MATRIX: Record<WorkspaceRole, readonly PermissionEntry[]> = {
  MEMBER: [
    { resourceName: 'TICKETS', accessType: AccessType.WRITE },
    { resourceName: 'WORKFLOWS', accessType: AccessType.WRITE },
    { resourceName: 'AGENTS', accessType: AccessType.WRITE },
    { resourceName: 'MODELS', accessType: AccessType.WRITE },
    { resourceName: 'TOOLS', accessType: AccessType.WRITE },
    { resourceName: 'AGENT-TOOLS-MAPPINGS', accessType: AccessType.WRITE },
    { resourceName: 'ANALYTICS', accessType: AccessType.WRITE },
    { resourceName: 'PROJECTS', accessType: AccessType.WRITE },
    { resourceName: 'XYNE-APPS', accessType: AccessType.WRITE },
    { resourceName: 'CHANNELS', accessType: AccessType.WRITE },
    { resourceName: 'CANVASES', accessType: AccessType.WRITE },
    { resourceName: 'SDLC', accessType: AccessType.WRITE },
  ],
  COMMUNITY_MEMBER: [
    { resourceName: 'TICKETS', accessType: AccessType.WRITE },
    { resourceName: 'WORKFLOWS', accessType: AccessType.WRITE },
    { resourceName: 'AGENTS', accessType: AccessType.WRITE },
    { resourceName: 'MODELS', accessType: AccessType.WRITE },
    { resourceName: 'TOOLS', accessType: AccessType.WRITE },
    { resourceName: 'AGENT-TOOLS-MAPPINGS', accessType: AccessType.WRITE },
    { resourceName: 'EXTERNAL-STEP-RESPONSE', accessType: AccessType.WRITE },
    { resourceName: 'PROJECTS', accessType: AccessType.WRITE },
    { resourceName: 'XYNE-APPS', accessType: AccessType.WRITE },
    { resourceName: 'CHANNELS', accessType: AccessType.WRITE },
    { resourceName: 'CANVASES', accessType: AccessType.WRITE },
    { resourceName: 'SDLC', accessType: AccessType.WRITE },
  ],
  ADMIN: [
    { resourceName: 'TICKETS', accessType: AccessType.ADMIN },
    { resourceName: 'TICKET-REPORTS', accessType: AccessType.ADMIN },
    { resourceName: 'WORKFLOWS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENTS', accessType: AccessType.ADMIN },
    { resourceName: 'MODELS', accessType: AccessType.ADMIN },
    { resourceName: 'TOOLS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENT-TOOLS-MAPPINGS', accessType: AccessType.ADMIN },
    { resourceName: 'ANALYTICS', accessType: AccessType.ADMIN },
    { resourceName: 'USER-MANAGEMENT', accessType: AccessType.ADMIN },
    { resourceName: 'USERS', accessType: AccessType.ADMIN },
    { resourceName: 'FORMS', accessType: AccessType.ADMIN },
    { resourceName: 'SUPPORT', accessType: AccessType.ADMIN },
    { resourceName: 'PROJECTS', accessType: AccessType.ADMIN },
    { resourceName: 'PRODUCT-INSIGHTS', accessType: AccessType.ADMIN },
    { resourceName: 'LISTPROJECTS', accessType: AccessType.ADMIN },
    { resourceName: 'CHANNELS', accessType: AccessType.ADMIN },
    { resourceName: 'CANVASES', accessType: AccessType.ADMIN },
    { resourceName: 'WORKSPACE', accessType: AccessType.ADMIN },
    { resourceName: 'TICKET-MIGRATION', accessType: AccessType.ADMIN },
    { resourceName: 'CONFLUENCE-MIGRATION', accessType: AccessType.ADMIN },
    { resourceName: 'XYNE-APPS', accessType: AccessType.ADMIN },
    { resourceName: 'VESPA', accessType: AccessType.ADMIN },
    { resourceName: 'SDLC', accessType: AccessType.ADMIN },
  ],
  OWNER: [
    { resourceName: 'TICKETS', accessType: AccessType.ADMIN },
    { resourceName: 'TICKET-REPORTS', accessType: AccessType.ADMIN },
    { resourceName: 'WORKFLOWS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENTS', accessType: AccessType.ADMIN },
    { resourceName: 'MODELS', accessType: AccessType.ADMIN },
    { resourceName: 'TOOLS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENT-TOOLS-MAPPINGS', accessType: AccessType.ADMIN },
    { resourceName: 'ANALYTICS', accessType: AccessType.ADMIN },
    { resourceName: 'USER-MANAGEMENT', accessType: AccessType.ADMIN },
    { resourceName: 'USERS', accessType: AccessType.ADMIN },
    { resourceName: 'FORMS', accessType: AccessType.ADMIN },
    { resourceName: 'SUPPORT', accessType: AccessType.ADMIN },
    { resourceName: 'PROJECTS', accessType: AccessType.ADMIN },
    { resourceName: 'PRODUCT-INSIGHTS', accessType: AccessType.ADMIN },
    { resourceName: 'LISTPROJECTS', accessType: AccessType.ADMIN },
    { resourceName: 'CHANNELS', accessType: AccessType.ADMIN },
    { resourceName: 'CANVASES', accessType: AccessType.ADMIN },
    { resourceName: 'WORKSPACE', accessType: AccessType.ADMIN },
    { resourceName: 'TICKET-MIGRATION', accessType: AccessType.ADMIN },
    { resourceName: 'CONFLUENCE-MIGRATION', accessType: AccessType.ADMIN },
    { resourceName: 'XYNE-APPS', accessType: AccessType.ADMIN },
    { resourceName: 'VESPA', accessType: AccessType.ADMIN },
    { resourceName: 'SDLC', accessType: AccessType.ADMIN },
  ],
  GUEST: [
    { resourceName: 'TICKETS', accessType: AccessType.WRITE },
    { resourceName: 'WORKFLOWS', accessType: AccessType.WRITE },
    { resourceName: 'CANVASES', accessType: AccessType.WRITE },
    { resourceName: 'XYNE-APPS', accessType: AccessType.READ },
    { resourceName: 'CHANNELS', accessType: AccessType.READ },
  ],
};

/**
 * Grant resource permissions to a user based on their workspace role.
 * Idempotent (add-only), error-swallowing per resource.
 *
 * @param userId      The user to grant permissions to.
 * @param email       User email (for logging).
 * @param role        The workspace role determining which permissions to grant.
 * @param workspaceId Workspace ID used for resource access rows and log context.
 */
export async function grantPermissionsForRole(
  userId: string,
  email: string,
  role: WorkspaceRole,
  workspaceId: string,
): Promise<void> {
  const logPrefix = '[grantPermissionsForRole]';
  const wsContext = workspaceId ? ` (workspace: ${workspaceId})` : '';
  const actorId = userId;

  const entries = PERMISSION_MATRIX[role];

  if (entries.length === 0) {
    logger.warn(
      `${logPrefix} Role ${role} has no permission entries. Skipping permission grants for user ${email}${wsContext}.`,
    );
    return;
  }

  let grantedCount = 0;

  try {
    for (const entry of entries) {
      try {
        const resource = await repositories.resources.findByName(entry.resourceName);

        if (!resource) {
          logger.warn(
            `${logPrefix} Resource "${entry.resourceName}" not found in database. Skipping for user ${email}${wsContext}.`,
          );
          continue;
        }

        const existingAccess = await repositories.resourceAccess.findUserResourceAccess(
          userId,
          resource.id,
        );
        const alreadyHasAccess = existingAccess.some(
          access => access.userId === userId && access.accessType === entry.accessType,
        );

        if (alreadyHasAccess) {
          logger.debug(
            `${logPrefix} User ${email} already has ${entry.accessType} access to ${entry.resourceName}. Skipping.`,
          );
          continue;
        }

        await repositories.resourceAccess.grantAccess(
          {
            userId,
            resourceId: resource.id,
            accessType: entry.accessType,
            workspaceId,
          },
          actorId,
        );
        grantedCount++;
        logger.debug(
          `${logPrefix} Granted ${entry.accessType} access to ${entry.resourceName} for user ${email}${wsContext}.`,
        );
      } catch (resourceError) {
        if (resourceError instanceof Prisma.PrismaClientKnownRequestError && resourceError.code === 'P2002') {
          logger.debug(
            `${logPrefix} Access already exists (concurrent grant) for ${entry.resourceName} — skipping for user ${email}${wsContext}.`,
          );
        } else {
          logger.error(
            `${logPrefix} Failed to grant ${entry.accessType} access to ${entry.resourceName} for user ${email}${wsContext}:`,
            resourceError,
          );
        }
      }
    }

    logger.info(
      `${logPrefix} Granted ${grantedCount} permission(s) to ${role} user ${email}${wsContext}.`,
    );
  } catch (err) {
    logger.error(
      `${logPrefix} Unexpected error granting permissions for ${role} user ${email}${wsContext}:`,
      err,
    );
  }
}

/**
 * Keep a single resource's ADMIN access in lockstep with a membership-role toggle
 * (e.g. WorkspaceRole/OrgRole promote-to-admin or demote-to-member). Idempotent:
 * grants ADMIN if missing and should be present, revokes if present and shouldn't be.
 * Error-swallowing — a failure here must never fail the role-change mutation it's
 * attached to as a fire-and-forget side effect.
 */
export async function syncResourceAdminAccess(
  userId: string,
  resourceName: ResourceName,
  shouldHaveAccess: boolean,
  actorUserId: string,
  workspaceId: string,
): Promise<void> {
  const logPrefix = '[syncResourceAdminAccess]';

  try {
    const resource = await repositories.resources.findByName(resourceName);
    if (!resource) {
      logger.warn(`${logPrefix} Resource "${resourceName}" not found. Skipping for user ${userId}.`);
      return;
    }

    const existingAccess = await repositories.resourceAccess.findUserResourceAccess(userId, resource.id);
    const hasAdminAccess = existingAccess.some(
      access => access.userId === userId && access.accessType === AccessType.ADMIN,
    );

    if (shouldHaveAccess && !hasAdminAccess) {
      await repositories.resourceAccess.grantAccess(
        { userId, resourceId: resource.id, accessType: AccessType.ADMIN, workspaceId },
        actorUserId,
      );
      logger.debug(`${logPrefix} Granted ADMIN access to ${resourceName} for user ${userId}.`);
    } else if (!shouldHaveAccess && hasAdminAccess) {
      // Scoped to ADMIN rows only — a demotion must not strip any independently
      // granted WRITE/READ access to this resource. Deletes inline here (rather
      // than via repositories.resourceAccess.revokeUserAccess, which deletes every
      // accessType for the user+resource) so the shared repository stays untouched.
      const adminRows = await db.resourceAccess.findMany({
        where: { userId, resourceId: resource.id, accessType: AccessType.ADMIN },
        include: { resource: true, user: true },
      });
      await db.resourceAccess.deleteMany({
        where: { userId, resourceId: resource.id, accessType: AccessType.ADMIN },
      });
      for (const row of adminRows) {
        await aclAuditService.logPermissionRevoked(
          row.id,
          `Revoked ADMIN access from user ${row.user?.email} for resource ${row.resource.name}`,
          actorUserId,
        );
      }
      logger.debug(`${logPrefix} Revoked ADMIN access to ${resourceName} for user ${userId}.`);
    }
  } catch (error) {
    logger.error(`${logPrefix} Failed to sync ${resourceName} access for user ${userId}:`, error);
  }
}

/**
 * Org membership (org_members) has no live FK to `users` — it's matched by email.
 * A promoted/demoted org member may have a `users` row in any workspace linked to
 * their org, so resolve every matching workspace-user row and sync ORGANIZATIONS
 * ADMIN access on each. Error-swallowing, same fire-and-forget contract as its caller.
 */
export async function syncOrgResourceAdminAccess(
  orgId: string,
  email: string,
  shouldHaveAccess: boolean,
  actorUserId: string,
): Promise<void> {
  const logPrefix = '[syncOrgResourceAdminAccess]';

  try {
    // Org-wide by design: this fans out across every workspace in the org, so it runs
    // above the caller's own workspace scope.
    await withWorkspaceScope(async () => {
      const links = await db.workspaceOrganization.findMany({
        where: { orgId, leftAt: null },
        select: { workspaceId: true },
      });
      if (links.length === 0) return;

      const users = await db.user.findMany({
        where: {
          workspaceId: { in: links.map(l => l.workspaceId) },
          email: { equals: email, mode: 'insensitive' },
        },
        select: { id: true, workspaceId: true },
      });

      // A user may hold rows in several of the org's workspaces, so each grant uses that
      // row's own workspaceId — already loaded here, rather than re-read per iteration.
      for (const user of users) {
        await syncResourceAdminAccess(user.id, 'ORGANIZATIONS', shouldHaveAccess, actorUserId, user.workspaceId);
      }
    });
  } catch (error) {
    logger.error(`${logPrefix} Failed to sync ORGANIZATIONS access for org ${orgId}, email ${email}:`, error);
  }
}
