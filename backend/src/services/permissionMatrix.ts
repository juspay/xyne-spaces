import { AccessType, WorkspaceRole, Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { repositories } from '../database/repositories/index';

/**
 * Exhaustive union of all resource names used in the permission matrix.
 * A typo here (or in any matrix entry) is a compile-time error, not a silent runtime skip.
 */
export type ResourceName =
  | 'TICKETS'
  | 'WORKFLOWS'
  | 'AGENTS'
  | 'MODELS'
  | 'TOOLS'
  | 'AGENT-TOOLS-MAPPINGS'
  | 'EXTERNAL-STEP-RESPONSE'
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
  | 'TICKET-MIGRATION'
  | 'CONFLUENCE-MIGRATION';

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
    { resourceName: 'EXTERNAL-STEP-RESPONSE', accessType: AccessType.WRITE },
    { resourceName: 'ANALYTICS', accessType: AccessType.WRITE },
    { resourceName: 'PROJECTS', accessType: AccessType.WRITE },
    { resourceName: 'XYNE-APPS', accessType: AccessType.WRITE },
    { resourceName: 'CHANNELS', accessType: AccessType.WRITE },
    { resourceName: 'CANVASES', accessType: AccessType.WRITE },
  ],
  ADMIN: [
    { resourceName: 'TICKETS', accessType: AccessType.ADMIN },
    { resourceName: 'WORKFLOWS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENTS', accessType: AccessType.ADMIN },
    { resourceName: 'MODELS', accessType: AccessType.ADMIN },
    { resourceName: 'TOOLS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENT-TOOLS-MAPPINGS', accessType: AccessType.ADMIN },
    { resourceName: 'EXTERNAL-STEP-RESPONSE', accessType: AccessType.ADMIN },
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
  ],
  OWNER: [
    { resourceName: 'TICKETS', accessType: AccessType.ADMIN },
    { resourceName: 'WORKFLOWS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENTS', accessType: AccessType.ADMIN },
    { resourceName: 'MODELS', accessType: AccessType.ADMIN },
    { resourceName: 'TOOLS', accessType: AccessType.ADMIN },
    { resourceName: 'AGENT-TOOLS-MAPPINGS', accessType: AccessType.ADMIN },
    { resourceName: 'EXTERNAL-STEP-RESPONSE', accessType: AccessType.ADMIN },
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
 * @param workspaceId Optional workspace ID (for logging context only).
 */
export async function grantPermissionsForRole(
  userId: string,
  email: string,
  role: WorkspaceRole,
  workspaceId?: string,
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
