import { repositories } from '../database/repositories/index';
import { AccessType } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * ACL Service for handling access control logic
 */
export class ACLService {
  private static instance: ACLService;

  private constructor() {}

  public static getInstance(): ACLService {
    if (!ACLService.instance) {
      ACLService.instance = new ACLService();
    }
    return ACLService.instance;
  }

  /**
   * Extract resource name from endpoint path
   * Examples:
   * - /api/tickets → TICKETS
   * - /api/users/{id} → USERS
   * - /workflows/123/steps → WORKFLOWS
   */
  private extractResourceName(path: string): string {
    // Remove /api prefix if present
    let cleanPath = path.replace(/^\/api\//, '/');

    // Remove leading slash
    cleanPath = cleanPath.replace(/^\//, '');

    // Extract first path segment (before any / or parameter)
    const firstSegment = cleanPath.split('/')[0];

    // Remove path parameters like {id}, :id, or actual IDs
    let resourceName = firstSegment.replace(/[{}:]/g, '');

    // If the segment is purely numeric (like an ID), return empty and we'll need to handle this
    if (/^\d+$/.test(resourceName)) {
      resourceName = '';
    }

    // If we get an empty resource name, it means this was likely an ID-only path
    if (!resourceName) {
      logger.warn(`Could not extract resource name from path: ${path}`);
      return 'UNKNOWN';
    }

    return resourceName.toUpperCase();
  }

  /**
   * Determine required access level based on HTTP method
   */
  private getRequiredAccessLevel(method: string): AccessType {
    const upperMethod = method.toUpperCase();

    switch (upperMethod) {
      case 'GET':
      case 'HEAD':
      case 'OPTIONS':
        return AccessType.READ;

      case 'POST':
      case 'PUT':
      case 'PATCH':
      case 'DELETE':
        return AccessType.WRITE;

      default:
        logger.warn(`Unknown HTTP method: ${method}, defaulting to WRITE access`);
        return AccessType.WRITE;
    }
  }

  /**
   * Check if user has required access to a resource
   */
  async checkAccess(
    userId: string,
    method: string,
    path: string
  ): Promise<{ hasAccess: boolean; reason?: string }> {
    try {
      logger.info(`ACL check for user ${userId}: ${method} ${path}`);

      // Extract resource name from path
      const resourceName = this.extractResourceName(path);
      logger.debug(`Extracted resource name: ${resourceName}`);

      // Get required access level for this HTTP method
      const requiredAccess = this.getRequiredAccessLevel(method);
      logger.debug(`Required access level: ${requiredAccess}`);

      // Find the resource in database
      const resource = await repositories.resources.findByName(resourceName);
      if (!resource) {
        logger.warn(`Resource '${resourceName}' not found in database`);
        return {
          hasAccess: false,
          reason: `Resource '${resourceName}' not configured`
        };
      }

      // Check if user has access to this resource (includes ADMIN hierarchy check)
      const hasAccess = await repositories.resourceAccess.hasAccess(
        userId,
        resource.id,
        requiredAccess
      );

      if (!hasAccess) {
        logger.warn(`User ${userId} denied access to ${resourceName} (required: ${requiredAccess})`);
        return {
          hasAccess: false,
          reason: `Insufficient permissions for ${method} ${path}`
        };
      }

      logger.info(`User ${userId} granted access to ${resourceName}`);
      return { hasAccess: true };

    } catch (error) {
      logger.error('Error in ACL check:', error);
      return {
        hasAccess: false,
        reason: 'Internal error during permission check'
      };
    }
  }

  /**
   * Get all resources a user has access to
   */
  async getUserResources(userId: string): Promise<{
    resourceName: string;
    accessType: AccessType;
  }[]> {
    try {
      const userAccess = await repositories.resourceAccess.findAllUserAccess(userId);

      return userAccess.map(access => ({
        resourceName: access.resource.name,
        accessType: access.accessType
      }));
    } catch (error) {
      logger.error('Error getting user resources:', error);
      return [];
    }
  }

  /**
   * Grant access to a user for a specific resource
   */
  async grantUserAccess(
    userId: string,
    resourceName: string,
    accessType: AccessType
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Find the resource
      const resource = await repositories.resources.findByName(resourceName);
      if (!resource) {
        return {
          success: false,
          message: `Resource '${resourceName}' not found`
        };
      }

      // Grant access
      await repositories.resourceAccess.grantAccess({
        userId,
        resourceId: resource.id,
        accessType
      });

      logger.info(`Granted ${accessType} access to user ${userId} for resource ${resourceName}`);
      return {
        success: true,
        message: `Access granted successfully`
      };
    } catch (error) {
      logger.error('Error granting user access:', error);
      return {
        success: false,
        message: 'Failed to grant access'
      };
    }
  }

  /**
   * Grant access to a user group for a specific resource
   */
  async grantGroupAccess(
    groupId: string,
    resourceName: string,
    accessType: AccessType
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Find the resource
      const resource = await repositories.resources.findByName(resourceName);
      if (!resource) {
        return {
          success: false,
          message: `Resource '${resourceName}' not found`
        };
      }

      // Grant access
      await repositories.resourceAccess.grantAccess({
        groupId,
        resourceId: resource.id,
        accessType
      });

      logger.info(`Granted ${accessType} access to group ${groupId} for resource ${resourceName}`);
      return {
        success: true,
        message: `Access granted successfully`
      };
    } catch (error) {
      logger.error('Error granting group access:', error);
      return {
        success: false,
        message: 'Failed to grant access'
      };
    }
  }

  /**
   * Revoke access for a user from a specific resource
   */
  async revokeUserAccess(
    userId: string,
    resourceName: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const resource = await repositories.resources.findByName(resourceName);
      if (!resource) {
        return {
          success: false,
          message: `Resource '${resourceName}' not found`
        };
      }

      await repositories.resourceAccess.revokeUserAccess(userId, resource.id);

      logger.info(`Revoked access for user ${userId} from resource ${resourceName}`);
      return {
        success: true,
        message: `Access revoked successfully`
      };
    } catch (error) {
      logger.error('Error revoking user access:', error);
      return {
        success: false,
        message: 'Failed to revoke access'
      };
    }
  }

  /**
   * Revoke access for a group from a specific resource
   */
  async revokeGroupAccess(
    groupId: string,
    resourceName: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const resource = await repositories.resources.findByName(resourceName);
      if (!resource) {
        return {
          success: false,
          message: `Resource '${resourceName}' not found`
        };
      }

      await repositories.resourceAccess.revokeGroupAccess(groupId, resource.id);

      logger.info(`Revoked access for group ${groupId} from resource ${resourceName}`);
      return {
        success: true,
        message: `Access revoked successfully`
      };
    } catch (error) {
      logger.error('Error revoking group access:', error);
      return {
        success: false,
        message: 'Failed to revoke access'
      };
    }
  }
}

export const aclService = ACLService.getInstance();
