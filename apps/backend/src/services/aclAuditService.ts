import { repositories } from '../database/repositories/index';
import { getContextOrNull } from '@/database/tenant/context';
import { ACLAuditEventType, ACLAuditTargetType } from '@prisma/client';
import { ACLAuditLog, ACLAuditLogWithActor, PaginationOptions, PaginatedResult } from '../types/database';
import { logger } from '../utils/logger';

/**
 * ACL Audit Service for logging and querying audit trails
 */
export class ACLAuditService {
  private static instance: ACLAuditService;

  private constructor() {}

  public static getInstance(): ACLAuditService {
    if (!ACLAuditService.instance) {
      ACLAuditService.instance = new ACLAuditService();
    }
    return ACLAuditService.instance;
  }

  /**
   * Log an audit event
   */
  async logEvent(
    eventType: ACLAuditEventType,
    targetType: ACLAuditTargetType,
    targetId: string,
    description: string,
    actorUserId?: string
  ): Promise<ACLAuditLog> {
    try {
      // System/no-context entry points (e.g. the ACL seed script) legitimately have no tenant.
      // workspaceId is nullable, so record a tenant-less audit row rather than throwing.
      const workspaceId = getContextOrNull()?.workspaceId ?? null;
      const auditLog = await repositories.aclAuditLogs.create({
        eventType,
        targetType,
        targetId,
        description,
        workspaceId,
        actorUser: actorUserId ? { connect: { id: actorUserId } } : undefined,
      });

      logger.info(`ACL Audit: ${eventType} - ${description}`, {
        eventType,
        targetType,
        targetId,
        actorUserId,
        auditLogId: auditLog.id,
      });

      return auditLog;
    } catch (error) {
      logger.error('Failed to log audit event:', error);
      throw new Error('Failed to log audit event');
    }
  }

  /**
   * Log resource creation
   */
  async logResourceCreated(resourceId: string, resourceName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.RESOURCE_CREATED,
      ACLAuditTargetType.RESOURCE,
      resourceId,
      `Created resource: ${resourceName}`,
      actorUserId
    );
  }

  /**
   * Log resource update
   */
  async logResourceUpdated(resourceId: string, resourceName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.RESOURCE_UPDATED,
      ACLAuditTargetType.RESOURCE,
      resourceId,
      `Updated resource: ${resourceName}`,
      actorUserId
    );
  }

  /**
   * Log resource deletion
   */
  async logResourceDeleted(resourceId: string, resourceName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.RESOURCE_DELETED,
      ACLAuditTargetType.RESOURCE,
      resourceId,
      `Deleted resource: ${resourceName}`,
      actorUserId
    );
  }

  /**
   * Log permission granted
   */
  async logPermissionGranted(
    resourceAccessId: string,
    description: string,
    actorUserId?: string
  ): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.PERMISSION_GRANTED,
      ACLAuditTargetType.RESOURCE_ACCESS,
      resourceAccessId,
      description,
      actorUserId
    );
  }

  /**
   * Log permission revoked
   */
  async logPermissionRevoked(
    resourceAccessId: string,
    description: string,
    actorUserId?: string
  ): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.PERMISSION_REVOKED,
      ACLAuditTargetType.RESOURCE_ACCESS,
      resourceAccessId,
      description,
      actorUserId
    );
  }

  /**
   * Log permission updated
   */
  async logPermissionUpdated(
    resourceAccessId: string,
    description: string,
    actorUserId?: string
  ): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.PERMISSION_UPDATED,
      ACLAuditTargetType.RESOURCE_ACCESS,
      resourceAccessId,
      description,
      actorUserId
    );
  }

  /**
   * Log user group creation
   */
  async logUserGroupCreated(groupId: string, groupName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.USER_GROUP_CREATED,
      ACLAuditTargetType.USER_GROUP,
      groupId,
      `Created user group: ${groupName}`,
      actorUserId
    );
  }

  /**
   * Log user group update
   */
  async logUserGroupUpdated(groupId: string, groupName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.USER_GROUP_UPDATED,
      ACLAuditTargetType.USER_GROUP,
      groupId,
      `Updated user group: ${groupName}`,
      actorUserId
    );
  }

  /**
   * Log user group deletion
   */
  async logUserGroupDeleted(groupId: string, groupName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.USER_GROUP_DELETED,
      ACLAuditTargetType.USER_GROUP,
      groupId,
      `Deleted user group: ${groupName}`,
      actorUserId
    );
  }

  /**
   * Log user group deactivation
   */
  async logUserGroupDeactivated(groupId: string, groupName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.USER_GROUP_DEACTIVATED,
      ACLAuditTargetType.USER_GROUP,
      groupId,
      `Deactivated user group: ${groupName}`,
      actorUserId
    );
  }

  /**
   * Log user group reactivation
   */
  async logUserGroupReactivated(groupId: string, groupName: string, actorUserId?: string): Promise<ACLAuditLog> {
    return this.logEvent(
      ACLAuditEventType.USER_GROUP_REACTIVATED,
      ACLAuditTargetType.USER_GROUP,
      groupId,
      `Reactivated user group: ${groupName}`,
      actorUserId
    );
  }

  /**
   * Get paginated audit logs
   */
  async getAuditLogs(options: PaginationOptions): Promise<PaginatedResult<ACLAuditLog>> {
    try {
      return await repositories.aclAuditLogs.getPaginated(options);
    } catch (error) {
      logger.error('Failed to get audit logs:', error);
      throw new Error('Failed to get audit logs');
    }
  }

  /**
   * Get audit logs with actor information
   */
  async getAuditLogsWithActor(limit: number = 50): Promise<ACLAuditLogWithActor[]> {
    try {
      return await repositories.aclAuditLogs.findRecent(limit);
    } catch (error) {
      logger.error('Failed to get audit logs with actor:', error);
      throw new Error('Failed to get audit logs with actor');
    }
  }

  /**
   * Get audit logs by event type
   */
  async getAuditLogsByEventType(eventType: ACLAuditEventType, limit: number = 100): Promise<ACLAuditLog[]> {
    try {
      return await repositories.aclAuditLogs.findByEventType(eventType, {
        take: limit,
        orderBy: { timestamp: 'desc' },
      });
    } catch (error) {
      logger.error('Failed to get audit logs by event type:', error);
      throw new Error('Failed to get audit logs by event type');
    }
  }

  /**
   * Get audit logs for a specific target
   */
  async getAuditLogsForTarget(
    targetType: ACLAuditTargetType,
    targetId: string,
    limit: number = 100
  ): Promise<ACLAuditLog[]> {
    try {
      return await repositories.aclAuditLogs.findByTarget(targetType, targetId, {
        take: limit,
        orderBy: { timestamp: 'desc' },
      });
    } catch (error) {
      logger.error('Failed to get audit logs for target:', error);
      throw new Error('Failed to get audit logs for target');
    }
  }

  /**
   * Get audit logs by actor
   */
  async getAuditLogsByActor(actorUserId: string, limit: number = 100): Promise<ACLAuditLog[]> {
    try {
      return await repositories.aclAuditLogs.findByActor(actorUserId, {
        take: limit,
        orderBy: { timestamp: 'desc' },
      });
    } catch (error) {
      logger.error('Failed to get audit logs by actor:', error);
      throw new Error('Failed to get audit logs by actor');
    }
  }

  /**
   * Get audit logs within date range
   */
  async getAuditLogsByDateRange(startDate: Date, endDate: Date, limit: number = 1000): Promise<ACLAuditLog[]> {
    try {
      return await repositories.aclAuditLogs.findByDateRange(startDate, endDate, {
        take: limit,
        orderBy: { timestamp: 'desc' },
      });
    } catch (error) {
      logger.error('Failed to get audit logs by date range:', error);
      throw new Error('Failed to get audit logs by date range');
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(): Promise<{
    totalLogs: number;
    eventTypeStats: Record<string, number>;
    targetTypeStats: Record<string, number>;
    last24Hours: number;
    lastWeek: number;
  }> {
    try {
      return await repositories.aclAuditLogs.getStatistics();
    } catch (error) {
      logger.error('Failed to get audit statistics:', error);
      throw new Error('Failed to get audit statistics');
    }
  }

  /**
   * Clean up old audit logs (for retention policy)
   */
  async cleanupOldLogs(retentionDays: number): Promise<{ deletedCount: number }> {
    try {
      const result = await repositories.aclAuditLogs.cleanupOldLogs(retentionDays);

      logger.info(`Cleaned up ${result.deletedCount} old audit logs (retention: ${retentionDays} days)`);

      return result;
    } catch (error) {
      logger.error('Failed to cleanup old audit logs:', error);
      throw new Error('Failed to cleanup old audit logs');
    }
  }

  /**
   * Search audit logs by description
   */
  async searchAuditLogs(searchTerm: string, limit: number = 100): Promise<ACLAuditLog[]> {
    try {
      return await repositories.aclAuditLogs.findMany({
        where: {
          description: {
            contains: searchTerm,
            mode: 'insensitive',
          },
        },
        take: limit,
        orderBy: { timestamp: 'desc' },
      });
    } catch (error) {
      logger.error('Failed to search audit logs:', error);
      throw new Error('Failed to search audit logs');
    }
  }
}

export const aclAuditService = ACLAuditService.getInstance();