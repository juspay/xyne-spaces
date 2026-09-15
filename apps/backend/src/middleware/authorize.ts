import { Request, Response, NextFunction } from 'express';
import { AccessType, OrgRole, WorkspaceRole } from '@xyne/shared';
import { DatabaseClient } from '../database/client';
import { logger } from '../utils/logger';
import { repositories } from '../database/repositories/index';

const prisma = DatabaseClient.getInstance();

export const authorize = (resourceName: string, requiredAccess: AccessType, allowGroupAccess: boolean = true) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate to access this resource',
      });
      return;
    }

    try {
      const userId = req.user.id;
      logger.info(`Authorizing user ${userId} for resource ${resourceName} with access ${requiredAccess}`);

      // Find the resource by its name to get the ID
      const resource = await prisma.resource.findUnique({
        where: { name: resourceName },
      });

      if (!resource) {
        logger.warn(`Authorization failed: Resource "${resourceName}" not found.`);
        res.status(403).json({
          error: 'Forbidden',
          message: 'Resource not configured for access control.',
        });
        return;
      }

      // Check for direct user access AND group-based access via UserGroupMapping
      // Support permission hierarchy: ADMIN > WRITE > READ
      const accessTypesToCheck: AccessType[] = [requiredAccess];
      if (requiredAccess === AccessType.READ) {
        accessTypesToCheck.push(AccessType.WRITE, AccessType.ADMIN);
      } else if (requiredAccess === AccessType.WRITE) {
        accessTypesToCheck.push(AccessType.ADMIN);
      }

      const hasAccess = await repositories.resourceAccess.hasAccess(
        userId,
        resource.id,
        requiredAccess
      );
      logger.info(`Access check result for user ${userId}: ${hasAccess ? 'Granted' : 'Denied'}`);

      if (hasAccess) {
        next();
        return;
      }

      // For individual-only resources (like ANALYTICS), deny access immediately
      if (!allowGroupAccess) {
        logger.warn(`Authorization failed for user ${userId} on resource ${resourceName} - individual access required`);
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have the required permissions to access this resource',
        });
        return;
      }

      logger.warn(`Authorization failed for user ${userId} on resource ${resourceName} with access ${requiredAccess}`);
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have the required permissions to access this resource',
      });
    } catch (error) {
      logger.error('Authorization error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An error occurred during authorization',
      });
    }
  };
};

/**
 * Workspace/org ADMIN and OWNER pass by role; everyone else must hold the named
 * resource at the required access. Used for release-manager edit actions, which
 * are open to admins/owners and to individually-granted users.
 */
export const authorizePrivilegedOrResource = (resourceName: string, requiredAccess: AccessType) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate to access this resource',
      });
      return;
    }

    const isPrivileged =
      req.user.orgRole === OrgRole.OWNER ||
      req.user.orgRole === OrgRole.ADMIN ||
      req.user.role === WorkspaceRole.OWNER ||
      req.user.role === WorkspaceRole.ADMIN;
    if (isPrivileged) {
      next();
      return;
    }

    try {
      const resource = await prisma.resource.findUnique({ where: { name: resourceName } });
      if (
        resource &&
        (await repositories.resourceAccess.hasAccess(req.user.id, resource.id, requiredAccess))
      ) {
        next();
        return;
      }
    } catch (error) {
      logger.error('Authorization error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An error occurred during authorization',
      });
      return;
    }

    res.status(403).json({
      error: 'Admin or owner access required',
      message: 'This endpoint requires administrator or owner privileges',
    });
  };
};
