import { AccessType, OrgRole, WorkspaceRole } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { ContractError, type AccessCheck } from './api';

/**
 * Typed access checks for dashboard (`session`) routes: the same decisions and answers as the
 * middlewares they replace (`authorize` in middleware/authorize.ts, `requireAdminOrOwner` in
 * middleware/auth.ts), as checks that run after the request is validated.
 */

const prisma = DatabaseClient.getInstance();

/**
 * The logged-in user must hold `resourceName` at `requiredAccess` (READ is also met by WRITE and
 * ADMIN, WRITE by ADMIN: `hasAccess` applies that hierarchy). As `authorize`: 403 when the
 * resource is not configured or access is missing, 500 when the lookup fails.
 */
export function resourceAccess(resourceName: string, requiredAccess: AccessType): AccessCheck<void> {
  return async ({ user }) => {
    if (!user) {
      throw new ContractError(401, { error: 'Authentication required', message: 'Please authenticate to access this resource' });
    }
    try {
      logger.info(`Authorizing user ${user.id} for resource ${resourceName} with access ${requiredAccess}`);
      const resource = await prisma.resource.findUnique({ where: { name: resourceName } });
      if (!resource) {
        logger.warn(`Authorization failed: Resource "${resourceName}" not found.`);
        throw new ContractError(403, { error: 'Forbidden', message: 'Resource not configured for access control.' });
      }
      const hasAccess = await repositories.resourceAccess.hasAccess(user.id, resource.id, requiredAccess);
      logger.info(`Access check result for user ${user.id}: ${hasAccess ? 'Granted' : 'Denied'}`);
      if (hasAccess) return;
      logger.warn(`Authorization failed for user ${user.id} on resource ${resourceName} with access ${requiredAccess}`);
      throw new ContractError(403, { error: 'Forbidden', message: 'You do not have the required permissions to access this resource' });
    } catch (error) {
      if (error instanceof ContractError) throw error;
      logger.error('Authorization error:', error);
      throw new ContractError(500, { error: 'Internal Server Error', message: 'An error occurred during authorization' });
    }
  };
}

/** Workspace or organization admin or owner, as `requireAdminOrOwner`. */
export function adminOrOwner(): AccessCheck<void> {
  return async ({ user }) => {
    if (!user) {
      throw new ContractError(401, { error: 'Authentication required', message: 'Please authenticate to access this resource' });
    }
    const isPrivileged =
      user.orgRole === OrgRole.OWNER ||
      user.orgRole === OrgRole.ADMIN ||
      user.role === WorkspaceRole.OWNER ||
      user.role === WorkspaceRole.ADMIN;
    if (!isPrivileged) {
      throw new ContractError(403, {
        error: 'Admin or owner access required',
        message: 'This endpoint requires administrator or owner privileges',
      });
    }
  };
}
