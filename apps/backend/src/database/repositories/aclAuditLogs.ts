import { BaseRepository } from './base';
import {
  ACLAuditLog,
  CreateACLAuditLogInput,
  UpdateACLAuditLogInput,
  QueryOptions,
  PaginationOptions,
  PaginatedResult,
  ACLAuditLogWithActor,
} from '@/types/database';
import { ACLAuditEventType, ACLAuditTargetType } from '@prisma/client';

export class ACLAuditLogRepository extends BaseRepository<ACLAuditLog, CreateACLAuditLogInput, UpdateACLAuditLogInput> {
  constructor() {
    super('aclAuditLog');
  }

  async create(data: CreateACLAuditLogInput): Promise<ACLAuditLog> {
    await this.validateString(data.description, 'description', 1000);
    await this.validateString(data.targetId, 'targetId', 255);

    return await this.db.aCLAuditLog.create({
      data: {
        ...data,
        timestamp: new Date(),
      },
    });
  }

  async findById(id: string): Promise<ACLAuditLog | null> {
    return await this.db.aCLAuditLog.findUnique({
      where: { id },
    });
  }

  async findMany(options?: QueryOptions): Promise<ACLAuditLog[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.aCLAuditLog.findMany({
      skip,
      take,
      where,
      orderBy: orderBy || { timestamp: 'desc' },
    });
  }

  async update(id: string, data: UpdateACLAuditLogInput): Promise<ACLAuditLog> {
    if (data.description) {
      await this.validateString(data.description, 'description', 1000);
    }
    if (data.targetId) {
      await this.validateString(data.targetId, 'targetId', 255);
    }

    return await this.db.aCLAuditLog.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ACLAuditLog> {
    return await this.db.aCLAuditLog.delete({
      where: { id },
    });
  }

  /**
   * Get paginated audit logs
   */
  async getPaginated(options: PaginationOptions): Promise<PaginatedResult<ACLAuditLog>> {
    const paginationQuery = this.buildPaginationQuery(options);

    return this.paginate(
      () => this.db.aCLAuditLog.findMany({
        skip: paginationQuery.skip,
        take: paginationQuery.take,
        orderBy: { timestamp: 'desc' },
      }),
      () => this.db.aCLAuditLog.count(),
      options
    );
  }

  /**
   * Get audit logs with actor information
   */
  async findManyWithActor(options?: QueryOptions): Promise<ACLAuditLogWithActor[]> {
    const { skip, take, orderBy, where } = options || {};

    return await this.db.aCLAuditLog.findMany({
      skip,
      take,
      where,
      orderBy: orderBy || { timestamp: 'desc' },
      include: {
        actorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Get audit logs by event type
   */
  async findByEventType(eventType: ACLAuditEventType, options?: QueryOptions): Promise<ACLAuditLog[]> {
    return await this.findMany({
      ...options,
      where: {
        ...options?.where,
        eventType,
      },
    });
  }

  /**
   * Get audit logs by target
   */
  async findByTarget(targetType: ACLAuditTargetType, targetId: string, options?: QueryOptions): Promise<ACLAuditLog[]> {
    return await this.findMany({
      ...options,
      where: {
        ...options?.where,
        targetType,
        targetId,
      },
    });
  }

  /**
   * Get audit logs by actor user
   */
  async findByActor(actorUserId: string, options?: QueryOptions): Promise<ACLAuditLog[]> {
    return await this.findMany({
      ...options,
      where: {
        ...options?.where,
        actorUserId,
      },
    });
  }

  /**
   * Get audit logs within date range
   */
  async findByDateRange(startDate: Date, endDate: Date, options?: QueryOptions): Promise<ACLAuditLog[]> {
    return await this.findMany({
      ...options,
      where: {
        ...options?.where,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  /**
   * Get recent audit logs (last N records)
   */
  async findRecent(limit: number = 50): Promise<ACLAuditLogWithActor[]> {
    return await this.findManyWithActor({
      take: limit,
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * Get audit statistics
   */
  async getStatistics(): Promise<{
    totalLogs: number;
    eventTypeStats: Record<string, number>;
    targetTypeStats: Record<string, number>;
    last24Hours: number;
    lastWeek: number;
  }> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalLogs,
      last24HoursCount,
      lastWeekCount,
      eventTypeStats,
      targetTypeStats,
    ] = await Promise.all([
      this.db.aCLAuditLog.count(),
      this.db.aCLAuditLog.count({
        where: { timestamp: { gte: last24Hours } },
      }),
      this.db.aCLAuditLog.count({
        where: { timestamp: { gte: lastWeek } },
      }),
      this.db.aCLAuditLog.groupBy({
        by: ['eventType'],
        _count: { eventType: true },
      }),
      this.db.aCLAuditLog.groupBy({
        by: ['targetType'],
        _count: { targetType: true },
      }),
    ]);

    const eventTypeStatsMap = eventTypeStats.reduce((acc: Record<string, number>, stat: any) => {
      acc[stat.eventType] = stat._count.eventType;
      return acc;
    }, {} as Record<string, number>);

    const targetTypeStatsMap = targetTypeStats.reduce((acc: Record<string, number>, stat: any) => {
      acc[stat.targetType] = stat._count.targetType;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalLogs,
      eventTypeStats: eventTypeStatsMap,
      targetTypeStats: targetTypeStatsMap,
      last24Hours: last24HoursCount,
      lastWeek: lastWeekCount,
    };
  }

  /**
   * Clean up old audit logs (for retention policy)
   */
  async cleanupOldLogs(retentionDays: number): Promise<{ deletedCount: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.db.aCLAuditLog.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    return { deletedCount: result.count };
  }
}