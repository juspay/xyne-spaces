import { Request, Response, NextFunction } from 'express';
import { DatabaseClient } from '../database/client';
import { AccessType } from '@prisma/client';
import { logger } from '../utils/logger';

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

      // Check for direct user access in resource_access table
      // Support permission hierarchy: ADMIN > WRITE > READ
      const accessTypesToCheck: AccessType[] = [requiredAccess];
      if (requiredAccess === AccessType.READ) {
        accessTypesToCheck.push(AccessType.WRITE, AccessType.ADMIN);
      } else if (requiredAccess === AccessType.WRITE) {
        accessTypesToCheck.push(AccessType.ADMIN);
      }

      const userAccess = await prisma.resourceAccess.findFirst({
        where: {
          userId: userId,
          resourceId: resource.id,
          accessType: { in: accessTypesToCheck },
        },
      });
      logger.info(`User-specific access check result: ${userAccess ? 'Found' : 'Not Found'}`);

      if (userAccess) {
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
