import { Request, Response, NextFunction } from 'express';
import { aclService } from '../services/aclService';
import { repositories } from '../database/repositories/index';
import { logger } from '../utils/logger';

// Import the Express type extensions
import '../types/express';

// Extend Express Request interface to include ACL info
declare global {
  namespace Express {
    interface Request {
      aclUser?: {
        id: string;
        email: string;
        name: string;
        userGroupId?: string;
      };
    }
  }
}

/**
 * ACL Middleware for API access control
 */
export class ACLMiddleware {
  private static instance: ACLMiddleware;

  private constructor() {}

  public static getInstance(): ACLMiddleware {
    if (!ACLMiddleware.instance) {
      ACLMiddleware.instance = new ACLMiddleware();
    }
    return ACLMiddleware.instance;
  }

  /**
   * Extract user from req.user (set by auth middleware) and validate
   */
  private async extractAndValidateUser(req: Request): Promise<{
    success: boolean;
    user?: any;
    error?: string;
  }> {
    // Auth middleware should have already set req.user
    if (!req.user) {
      return {
        success: false,
        error: 'User not authenticated - auth middleware should run first'
      };
    }

    try {
      // Handle virtual environment API key user
      if (req.user.isApiKeyUser && req.user.id === 'env-api-user') {
        // Return a virtual user object for environment API key
        return {
          success: true,
          user: {
            id: 'env-api-user',
            email: req.user.email,
            name: req.user.name,
            userGroupId: null, // No user group for virtual user
            isVirtualUser: true, // Flag to indicate this is virtual
            role: req.user.role
          }
        };
      }

      // Get user from database using the authenticated user's ID
      const user = await repositories.users.findById(req.user.id);
      if (!user) {
        return {
          success: false,
          error: `User with ID ${req.user.id} not found in database`
        };
      }

      return {
        success: true,
        user
      };
    } catch (error) {
      logger.error('Error validating user:', error);
      return {
        success: false,
        error: 'Failed to validate user'
      };
    }
  }

  /**
   * Main ACL middleware function
   */
  checkAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    logger.info(`ACL middleware triggered for ${req.method} ${req.path}`);

    try {
      // Extract and validate user
      const userResult = await this.extractAndValidateUser(req);
      if (!userResult.success) {
        logger.warn(`ACL failed - ${userResult.error}`);
        res.status(403).json({
          error: 'Unauthorized',
          message: userResult.error
        });
        return;
      }

      const user = userResult.user!;

      // Attach user to request for downstream use
      req.aclUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        userGroupId: user.userGroupId
      };

      // Check access permissions (use originalUrl to get full path including /api prefix)
      // Skip ACL check for admin users (virtual or real from environment API key)
      if ((user.isVirtualUser && user.role === 'admin') || 
          (req.user?.isApiKeyUser && req.user?.role === 'admin')) {
        logger.info(`Skipping ACL check for admin user: ${user.id} (${user.isVirtualUser ? 'virtual' : 'environment API key'})`);
      } else {
        // Check access permissions (use originalUrl to get full path including /api prefix)
        const accessResult = await aclService.checkAccess(
          user.id,
          req.method,
          req.originalUrl.split('?')[0] // Remove query parameters
        );
        
        if (!accessResult.hasAccess) {
          logger.warn(`ACL denied access for user ${user.id} (${user.email}): ${accessResult.reason}`);
          res.status(403).json({
            error: 'Unauthorized',
            message: accessResult.reason || 'Insufficient permissions'
          });
          return;
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`ACL granted access for user ${user.id} (${user.email}) in ${duration}ms`);

      // Access granted, continue to next middleware/route
      next();

    } catch (error) {
      logger.error('ACL middleware error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to check permissions'
      });
    }
  };

  /**
   * Optional ACL middleware - allows requests through even if ACL fails
   * Useful for endpoints that have both authenticated and unauthenticated access
   */
  optionalCheckAccess = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userResult = await this.extractAndValidateUser(req);

      if (userResult.success) {
        const user = userResult.user!;

        // Attach user to request
        req.aclUser = {
          id: user.id,
          email: user.email,
          name: user.name,
          userGroupId: user.userGroupId
        };

        // Check access but don't block if failed (use originalUrl to get full path)
        const accessResult = await aclService.checkAccess(
          user.id,
          req.method,
          req.originalUrl.split('?')[0] // Remove query parameters
        );

        if (!accessResult.hasAccess) {
          logger.info(`Optional ACL: User ${user.id} doesn't have access, but allowing through`);
        }
      } else {
        logger.info('Optional ACL: No valid user found, allowing anonymous access');
      }

      // Always continue regardless of access check result
      next();

    } catch (error) {
      logger.error('Optional ACL middleware error:', error);
      // Continue even on error for optional middleware
      next();
    }
  };

  /**
   * Middleware to skip ACL for specific routes/patterns
   */
  skipACL = (req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`Skipping ACL for ${req.method} ${req.path}`);
    next();
  };
}

// Export singleton instance
export const aclMiddleware = ACLMiddleware.getInstance();