import { DatabaseClient, readReplicaDb } from '../client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { Prisma } from '@prisma/client';
import { IST_OFFSET_MS, HOUR_MS } from '@/utils/dateUtils';
import {logger} from '@/utils/logger';
import { AttachmentEntityType, CallType, ChannelScopeType, UserType } from '@xyne/shared';

export interface AnalyticsFilters {
  timeRange?: string; // 'today', '7d', '30d', '90d', 'custom'
  workspaceId?: string; // Current workspace scope for analytics queries
  workflowType?: string; // 'all' or any value from WorkflowType enum
  startDate?: string; // ISO date string for custom range start
  endDate?: string; // ISO date string for custom range end
  repoName?: string; // Repository filter
  userId?: string; // User filter - 'all' or specific user ID
}

// Calls and recordings are the same table, split by callType (HEADLESS = recording)
export interface CallsBreakdown {
  calls: number;      // Regular calls (every callType except HEADLESS)
  recordings: number; // Recordings (HEADLESS)
}

export interface CallsTimeSeriesPoint {
  date: string;
  calls: number;      // Call count for the bucket (recordings excluded)
  recordings: number; // Recording count for the bucket
}

// New optimized types for execution stats
export interface ExecutionTimeStats {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface ExecutionStatsItem {
  type: string;              // "BUG_WORKFLOW", "FEATURE_IMPLEMENTATION", etc.
  executionCount: number;    // Total completed executions
  successCount: number;      // Successful executions
  failedCount: number;       // Failed executions
  successRate: number;       // Percentage (0-100)
  timeStats: ExecutionTimeStats;
}

export interface SuccessRateTimePoint {
  date: string;              // "2024-11-01"
  totalExecutions: number;
  successfulExecutions: number;
  successRate: number;       // Percentage (0-100)
}

export interface ExecutionStats {
  overallTimeStats: ExecutionTimeStats;
  successRateTimeSeries: SuccessRateTimePoint[];
  workflowTypes: ExecutionStatsItem[];
}

export interface ExecutionStatusStats {
  status: string;
  count: number;
  percentage: number;
}

export interface StepFailureStats {
  stepName: string;
  failures: number;
  totalRuns: number;
  rate: number;
}

export interface StepFunnelStats {
  stepName: string;
  stepOrder: number;
  totalStarted: number;
  totalCompleted: number;
  completionRate: number;
  dropoffRate: number;
}

export interface RecentActivityItem {
  time: string;
  event: string;
}

export interface WorkflowTypeOption {
  value: string;
  label: string;
  description?: string;
}

export interface PRStatValue {
  count: number
  trend: string // e.g., "+22%", "-42%", "0%"
}

export interface PRStats {
  xyneMerged: PRStatValue
  xyneDeclined: PRStatValue
  xyneOpen: PRStatValue
  nonXyneMerged: PRStatValue
  raised: PRStatValue
  successRate: number
  coverage: number
}

export interface PRStatsLegacy {
  xyneMerged: number
  xyneDeclined: number
  xyneOpen: number
  nonXyneMerged: number
  raised: number
  successRate: number,
  coverage: number
}

export interface TimeSeriesDataPoint {
  date: string
  stats: PRStatsLegacy
}

// Message type for filtered messages
type FilteredMessage = {
  messageId: string;
  senderId: string;
  conversationId: string;
  channelId: string;
  channelScopeType: string;
  createdAt: Date;
};
const MINUTE_MS = 60 * 1000;
/**
 * Quantizes "now" to a whole minute so the ~8 panels of one dashboard resolve and share identical [gte, lte]
 */
function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

/**
 * Helper method to get date filter SQL condition
 * ALL DATE OPERATIONS USE UTC TO AVOID TIMEZONE ISSUES
 */
export function getDateFilter(filters: AnalyticsFilters): Date | { gte: Date; lte?: Date } {
  const now = floorToMinute(new Date());

  // Handle custom date range
  if (filters.timeRange === 'custom' && filters.startDate) {
    const startDate = new Date(filters.startDate);
    const endDate = filters.endDate ? new Date(filters.endDate) : now;
    return { gte: startDate, lte: endDate };
  }

  // Handle date range in format "YYYY-MM-DD_YYYY-MM-DD" from frontend calendar
  const timeRange = filters.timeRange || '7d';
  if (timeRange.includes('_')) {
    const [startDateStr, endDateStr] = timeRange.split('_');
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    // Set end date to end of day using UTC to include the entire end date
    endDate.setUTCHours(23, 59, 59, 999);

    return { gte: startDate, lte: endDate };
  }

  // Handle preset ranges with proper end dates using UTC
  switch (timeRange) {
    case 'today':
      // Return start of today using UTC to now
      const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { gte: startOfToday, lte: now };
      
    case '7d':
      const start7d = new Date(now.getTime() - 7 * 24 * HOUR_MS);
      return { gte: start7d, lte: now };
      
    case '30d':
      const start30d = new Date(now.getTime() - 30 * 24 * HOUR_MS);
      return { gte: start30d, lte: now };
      
    case '90d':
      const start90d = new Date(now.getTime() - 90 * 24 * HOUR_MS);
      return { gte: start90d, lte: now };
      
    default:
      const startDefault = new Date(now.getTime() - 7 * 24 * HOUR_MS);
      return { gte: startDefault, lte: now };
  }
}


export class AnalyticsRepository {
  /**
   * Uses read replica if available, falls back to main database
   */
  private getDbInstance() {
    const replica = readReplicaDb;
    if (replica) {
      logger.info('Using read replica database for analytics queries');
      return replica;
    }
    logger.info('Read replica not available, using main database for analytics queries');
    return DatabaseClient.getInstance();
  }

  /**
   * Centralized helper to fetch and filter valid messages
   * Accepts a Prisma where clause and returns only valid messages
   */
  /**
   * Excluded channel IDs for analytics filtering
   * These channels are excluded from all analytics message queries
   */
  private static readonly EXCLUDED_CHANNEL_IDS = [
    'cmkl0nsjp01vq5n0sczlf058f', 'cmkmh8ksj00fbxkaq0u5u207c',
    'cmkmir9ys03ntskfrt63lrfex', 'cmkmiz3wb03o7skfr6cos6t3b',
    'cmkn23y86008b10br13ngegoq', 'cmkn2ohyc009vjja5vbw9qrg7',
    'cmlpgdr0a09rj11uzf3xql7ad', 'cmkmhn5c803k3skfrc836863n','cmlv7gc0a00mrka9fol3ccjrk'
  ];

  /**
   * Coalesces concurrent identical scans. Every analytics panel calls this
   * helper with the same (workspace, range) key, and the dashboard fires all
   * of them in parallel on mount and on every refetch — without this, one
   * dashboard render issues ~8 copies of the same scan against the replica.
   *
   * Relies on ranges being minute-quantized (see floorToMinute) so that panels
   * resolving their range moments apart still produce the same key.
   */
  private static readonly inFlightMessageQueries = new Map<string, Promise<FilteredMessage[]>>();

  private async getFilteredMessages(dateCondition: { gte?: Date; lte?: Date }, workspaceId: string): Promise<readonly FilteredMessage[]> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);
    const gte = dateCondition.gte ? dateCondition.gte.toISOString() : null;
    const lte = dateCondition.lte ? dateCondition.lte.toISOString() : null;

    const key = `${scopedWorkspaceId}|${gte ?? ''}|${lte ?? ''}`;
    const inFlight = AnalyticsRepository.inFlightMessageQueries.get(key);
    if (inFlight) return inFlight;

    const query = this.queryFilteredMessages(gte, lte, scopedWorkspaceId)
      .finally(() => AnalyticsRepository.inFlightMessageQueries.delete(key));

    AnalyticsRepository.inFlightMessageQueries.set(key, query);
    return query;
  }

  private async queryFilteredMessages(gte: string | null, lte: string | null, scopedWorkspaceId: string): Promise<FilteredMessage[]> {
    const excludedChannels = AnalyticsRepository.EXCLUDED_CHANNEL_IDS;

    // Emit the date bounds as plain comparisons instead of
    // `($1::timestamp IS NULL OR m."createdAt" >= $1::timestamp)`. That OR form
    // is non-sargable: Postgres can only fold the IS NULL branch away while it
    // still builds custom plans, so once a pooled connection's prepared
    // statement flips to a generic plan it stops using (msgType, createdAt) and
    // sequential-scans `messages` regardless of how narrow the range is. That is
    // what makes the same request succeed on one connection and hit
    // statement_timeout on the next.
    const gteClause = gte ? Prisma.sql`AND m."createdAt" >= ${gte}::timestamp` : Prisma.empty;
    const lteClause = lte ? Prisma.sql`AND m."createdAt" <= ${lte}::timestamp` : Prisma.empty;

    const messages = await this.prisma.$queryRaw<FilteredMessage[]>(Prisma.sql`
      SELECT 
        m."messageId", 
        m."senderId", 
        m."conversationId", 
        c."channelId",
        ch."scopeType" AS "channelScopeType",
        m."createdAt"
      FROM "public"."messages_without_content" m
      INNER JOIN "public"."conversations" c 
        ON c."conversationId" = m."conversationId"
      INNER JOIN "public"."channels" ch
        ON ch."id" = c."channelId"
      WHERE 
        m."msgType" = 'USER'
        ${gteClause}
        ${lteClause}
        AND ch."workspaceId" = ${scopedWorkspaceId}
        AND c."channelId" NOT IN (${Prisma.join(excludedChannels)})
        AND NOT EXISTS (
          SELECT 1 
          FROM "workflow"."external_sources" es
          WHERE es."channelId" = c."channelId"
            AND m."createdAt" < es."createdAt"
        )
        AND NOT (
          ch."type" = 'EMAIL'
          AND (c."parentMessageId" IS NULL OR m."messageId" = c."initialMessageId")
        )
    `);

    return messages;
  }
  private prisma = this.getDbInstance();

  /**
   * Get IDs of real users (userType: 'USER'), excludes bots
   */
  private requireWorkspaceId(workspaceId?: string): string {
    if (!workspaceId) {
      throw new Error('Workspace ID is required for analytics queries');
    }

    return workspaceId;
  }

  private getWorkspaceFilter(filters: AnalyticsFilters): { workspaceId: string } {
    return { workspaceId: this.requireWorkspaceId(filters.workspaceId) };
  }

  private getCallWorkspaceFilter(workspaceId: string, userIds: string[]): Prisma.CallWhereInput {
    return {
      OR: [
        { channel: { workspaceId } },
        { channelId: null, createdByUserId: { in: userIds } }
      ]
    };
  }

  private async getUsersId(workspaceId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { userType: UserType.USER, workspaceId: this.requireWorkspaceId(workspaceId) },
      select: { id: true }
    });
    return users.map(u => u.id);
  }

  /**
   * Helper to generate bucket key for time-series data
   * Converts timestamps to IST and rounds to hour for hourly grouping
   */
  private getBucketKey(timestamp: Date, groupBy: 'day' | 'hour'): string {
    if (groupBy === 'hour') {
      // Convert to IST and round to hour to match bucket keys
      const istTime = timestamp.getTime() + IST_OFFSET_MS;
      const roundedISTTime = Math.floor(istTime / HOUR_MS) * HOUR_MS;
      const utcTime = roundedISTTime - IST_OFFSET_MS;
      return new Date(utcTime).toISOString();
    } else {
      // Convert to IST for daily bucketing
      const istTime = new Date(timestamp.getTime() + IST_OFFSET_MS);
      return istTime.toISOString().split('T')[0];
    }
  }

  /**
   * Reduce a list of records into a per-bucket numeric time series.
   * Materializes every bucket (zero-filled) in the given order, adds each
   * record's amount (default 1) to the bucket its key falls in, and returns the
   * points sorted by date. Records whose key is null/undefined or not a known
   * bucket are ignored, matching the previous hand-rolled loops exactly.
   */
  private bucketCounts<T>(
    records: readonly T[],
    timeBuckets: string[],
    keyOf: (record: T) => string | null | undefined,
    amountOf: (record: T) => number = () => 1,
  ): { date: string; value: number }[] {
    const bucketData = new Map<string, number>();
    timeBuckets.forEach(bucket => bucketData.set(bucket, 0));

    records.forEach(record => {
      const bucketKey = keyOf(record);
      if (bucketKey != null && bucketData.has(bucketKey)) {
        bucketData.set(bucketKey, bucketData.get(bucketKey)! + amountOf(record));
      }
    });

    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Compute the UTC instant for the start of "today" in IST, plus a
   * minute-floored "now". Shared by getMessagesToday and its time-series so the
   * two resolve the same scan window.
   */
  private getIstDayBounds(): { startOfTodayUTC: Date; now: Date } {
    const now = floorToMinute(new Date());
    const istTime = new Date(now.getTime() + IST_OFFSET_MS);
    const startOfTodayIST = new Date(Date.UTC(
      istTime.getUTCFullYear(),
      istTime.getUTCMonth(),
      istTime.getUTCDate()
    ));
    const startOfTodayUTC = new Date(startOfTodayIST.getTime() - IST_OFFSET_MS);
    return { startOfTodayUTC, now };
  }

  /**
   * Helper method to extract start and end dates from date condition
   * Centralizes the logic to avoid code duplication across time-series methods
   */
  /**
   * Normalize a date filter (single Date or a {gte,lte} range) into a Prisma date condition.
   */
  private toDateCondition(dateFilter: Date | { gte: Date; lte?: Date }): { gte: Date; lte?: Date } {
    return typeof dateFilter === 'object' && 'gte' in dateFilter ? dateFilter : { gte: dateFilter };
  }

  private getDateRange(dateCondition: Date | { gte: Date; lte?: Date }): { startDate: Date; endDate: Date } {
    const startDate = typeof dateCondition === 'object' && 'gte' in dateCondition 
      ? dateCondition.gte 
      : dateCondition;
    const endDate = typeof dateCondition === 'object' && 'lte' in dateCondition && dateCondition.lte 
      ? dateCondition.lte 
      : new Date();
    
    return { startDate, endDate };
  }

  /**
   * Get workflow metrics bucketed by workflowType and status
   */
  async getWorkflowMetrics(filters: AnalyticsFilters) {
    const dateFilter = getDateFilter(filters);
    const workspaceFilter = this.getWorkspaceFilter(filters);
    const dateCondition = this.toDateCondition(dateFilter);

    const groupedData = await this.prisma.workflow.groupBy({
      by: ['workflowType', 'status'],
      where: {
        createdAt: dateCondition,
        NOT: { workflowType: 'Automations' },
        ...workspaceFilter
      },
      _count: {
        id: true
      }
    });

    return groupedData;
  }

  /**
   * UNIFIED: Get messages exchanged statistics - ALWAYS returns time-series data
   * This replaces the old getMessagesExchanged() and ensures consistency
   */
  async getMessagesExchanged(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number; channelMessages: number; dmMessages: number; groupDmMessages: number }[]> {
    // Always use day groupby for consistency - no more "none" option
    return this.getMessagesExchangedTimeSeries(filters, groupBy);
  }

  /**
   * Get current active users grouped by presence status
   */
  async getCurrentActiveUsers(workspaceId: string): Promise<{ userStatus: string; userCount: number; percentage: number }[]> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);

    // Get users grouped by their presence status
    const userPresenceStats = await this.prisma.userPresence.groupBy({
      by: ['status'],
      where: {
        user: {
          workspaceId: scopedWorkspaceId
        }
      },
      _count: {
        status: true,
      },
    });

    // Get total user count
    const totalUsers = await this.prisma.userPresence.count({
      where: {
        user: {
          workspaceId: scopedWorkspaceId
        }
      }
    });

    // Transform the data and calculate percentages
    const results = userPresenceStats.map(stat => ({
      userStatus: stat.status,
      userCount: stat._count.status,
      percentage: totalUsers > 0 ? Math.round((stat._count.status / totalUsers) * 100) : 0,
    }));

    return results;
  }

  /**
   * Get files shared statistics
   * Counts the number of file attachments shared in the selected time period
   */
  async getFilesShared(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);
    const validMessageIds = validMessages.map(m => m.messageId);

    if (validMessageIds.length === 0) return 0;

    const [{ count }] = await this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      ${this.chatAttachmentsFrom(validMessageIds, workspaceId)}
    `);

    return count;
  }

  private chatAttachmentsFrom(messageIds: string[], workspaceId: string): Prisma.Sql {
    return Prisma.sql`
      FROM "public"."message_attachments" a
      WHERE a."entityId" = ANY(${messageIds}::text[])
        AND a."entityType" = ${AttachmentEntityType.CHAT}
        AND a."workspaceId" = ${workspaceId}
        AND a."createdBy" NOT IN ('Unified Alerts', 'system')
    `;
  }

  /**
   * Get messages exchanged time-series data using optimized Prisma ORM aggregation
   * Fetches all messages within date range and processes aggregation in application memory
   */
  async getMessagesExchangedTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number; channelMessages: number; dmMessages: number; groupDmMessages: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const dateCondition = this.toDateCondition(dateFilter);
    const { startDate, endDate } = this.getDateRange(dateCondition);

    // Use centralized helper for filtering. Channel + scopeType ride along on each
    // message, so no per-conversation follow-up query (and no unbounded IN list).
    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);

    // Generate complete time buckets for the date range based on groupBy
    const timeBuckets = groupBy === 'hour' 
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);
    const bucketData = new Map<string, { total: number; channel: number; dm: number; groupDm: number }>();

    // Initialize all buckets with zero values
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, { total: 0, channel: 0, dm: 0, groupDm: 0 });
    });

    // Aggregate valid messages
    validMessages.forEach(message => {
      const dateKey = this.getBucketKey(message.createdAt, groupBy);
      const scopeType = message.channelScopeType;
      if (bucketData.has(dateKey)) {
        const bucket = bucketData.get(dateKey)!;
        bucket.total += 1;

        if (scopeType === 'DEFAULT') {
          bucket.channel += 1;
        } else if (scopeType === 'DM') {
          bucket.dm += 1;
        } else if (scopeType === 'GROUP_DM') {
          bucket.groupDm += 1;
        }
      }
    });

    // Convert to final format
    return timeBuckets.map(dateKey => ({
      date: dateKey,
      value: bucketData.get(dateKey)!.total,
      channelMessages: bucketData.get(dateKey)!.channel,
      dmMessages: bucketData.get(dateKey)!.dm,
      groupDmMessages: bucketData.get(dateKey)!.groupDm
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Generate daily time buckets for a date range
   * Converts to IST timezone for proper day bucketing in Indian timezone
   */
  private generateDailyTimeBuckets(startDate: Date, endDate: Date): string[] {
    const buckets: string[] = [];
    
    // Convert start and end dates to IST for proper bucket generation
    const istStartDate = new Date(startDate.getTime() + IST_OFFSET_MS);
    const istEndDate = new Date(endDate.getTime() + IST_OFFSET_MS);
    
    // Initialize currentDate properly in IST
    const currentDate = new Date(istStartDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    while (currentDate <= istEndDate) {
      buckets.push(currentDate.toISOString().split('T')[0]);
      // Use UTC date operations to ensure consistent behavior
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return buckets;
  }

  /**
   * Generate hourly time buckets for a date range
   * Frontend sends times in user timezone (as UTC). We need to bucket by IST hours
   * so convert to IST, floor to IST hours, then convert back to UTC for storage
   */
  private generateHourlyTimeBuckets(startDate: Date, endDate: Date): string[] {
    const buckets: string[] = [];
    
    // Convert to IST milliseconds
    const istStartTime = startDate.getTime() + IST_OFFSET_MS;
    const istEndTime = endDate.getTime() + IST_OFFSET_MS;
    
    // Floor both start and end to IST hour (include the hour containing the end time, not the next hour)
    const startHourIST = Math.floor(istStartTime / HOUR_MS) * HOUR_MS;
    const endHourIST = Math.floor(istEndTime / HOUR_MS) * HOUR_MS;

    // Generate hourly buckets in IST, but store as UTC equivalents
    for (let time = startHourIST; time <= endHourIST; time += HOUR_MS) {
      // Convert back to UTC by subtracting IST offset
      const utcTime = time - IST_OFFSET_MS;
      buckets.push(new Date(utcTime).toISOString());
    }

    return buckets;
  }

  /**
   * Get active users with both aggregate and time-series data in single call
   */
  async getActiveUsersWithChart(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{
    uniqueUsers: number;
    timeSeries: { date: string; value: number }[];
  }> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const userIds = await this.getUsersId(workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    // Use getFilteredMessages for robust filtering
    const validMessageActivities = await this.getFilteredMessages(dateCondition, workspaceId);

    // Get other activity types (reactions, attachments, tickets, ticket activities, canvas, canvas participants)
    const [reactionUsers, attachmentUsers, ticketCreators, ticketActivityUsers, canvasCreators, canvasParticipants] = await Promise.all([
      withWorkspaceScope(async () => await this.prisma.reaction.findMany({
        where: { createdAt: dateCondition, userId: { in: userIds } },
        select: { userId: true, createdAt: true },
      })),
      this.prisma.messageAttachment.findMany({
        where: { createdAt: dateCondition, workspaceId },
        select: { createdBy: true, createdAt: true },
      }),

      // Users who created tickets
      this.prisma.ticket.findMany({
        where: { createdAt: dateCondition, workspaceId },
        select: { createdBy: true, createdAt: true },
      }),

      // Users who update ticket_activities
      this.prisma.ticketActivity.findMany({
        where: { timestamp: dateCondition, ticket: { workspaceId } },
        select: { updatedBy: true, timestamp: true },
      }),

      // Users who created canvas
      this.prisma.canvas.findMany({
        where: { createdAt: dateCondition, createdBy: { in: userIds } },
        select: { createdBy: true, createdAt: true },
      }),

      // Users who edited canvas
      withWorkspaceScope(async () => await this.prisma.canvasParticipant.findMany({
        where: { updatedAt: dateCondition, userId: { in: userIds } },
        select: { userId: true, updatedAt: true },
      }))
    ]);

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);
    const bucketData = new Map<string, Set<string>>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, new Set<string>());
    });

    // Group valid message activities by time buckets
    validMessageActivities.forEach(message => {
      const userId = message.senderId;
      const timestamp = message.createdAt;
      if (userId && timestamp) {
        const bucketKey = this.getBucketKey(timestamp, groupBy);
        if (bucketData.has(bucketKey)) {
          bucketData.get(bucketKey)!.add(userId);
        }
      }
    });

    // Group other activities by time buckets
    const otherActivities = [
      ...reactionUsers,
      ...attachmentUsers,
      ...ticketCreators,
      ...ticketActivityUsers,
      ...canvasCreators,
      ...canvasParticipants
    ];
    otherActivities.forEach(activity => {
      const userId = ('userId' in activity && activity.userId) ||
                    ('createdBy' in activity && activity.createdBy) ||
                    ('updatedBy' in activity && activity.updatedBy);
      const timestamp = ('createdAt' in activity && activity.createdAt) ||
                       ('updatedAt' in activity && activity.updatedAt) ||
                       ('timestamp' in activity && activity.timestamp);
      if (userId && timestamp) {
        const bucketKey = this.getBucketKey(timestamp, groupBy);
        if (bucketData.has(bucketKey)) {
          bucketData.get(bucketKey)!.add(userId);
        }
      }
    });

    // Calculate unique users across entire period
    const allUniqueUsers = new Set<string>();
    validMessageActivities.forEach(message => {
      if (message.senderId) allUniqueUsers.add(message.senderId);
    });
    otherActivities.forEach(activity => {
      const userId = ('userId' in activity && activity.userId) ||
                    ('createdBy' in activity && activity.createdBy) ||
                    ('updatedBy' in activity && activity.updatedBy);
      if (userId) allUniqueUsers.add(userId);
    });

    // Convert time series to array format
    const timeSeries = timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey)?.size || 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    return {
      uniqueUsers: allUniqueUsers.size,
      timeSeries: timeSeries
    };
  }

  /**
   * Get active channels aggregate count (efficient database query)
   * Returns unique channels that had activity based on messages over the entire period
   * Uses the same logic as the time-series to ensure consistency
   */
  async getActiveChannels(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const dateCondition = this.toDateCondition(dateFilter);
    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);
    if (validMessages.length === 0) {
      return 0;
    }

    // Count the distinct DEFAULT-scope channels the messages belong to. The scope
    // rides along on each message, so no conversation/channel lookups by id list.
    const activeChannelIds = new Set(
      validMessages
        .filter(m => m.channelScopeType === ChannelScopeType.DEFAULT)
        .map(m => m.channelId)
    );

    return activeChannelIds.size;
  }

  /**
   * Get active channels time-series data
   */
  async getActiveChannelsTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    // Use centralized helper for filtering. Channel + scopeType ride along on each
    // message, so no per-conversation follow-up query (and no unbounded IN list).
    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);
    const bucketData = new Map<string, Set<string>>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, new Set<string>());
    });

    // Group valid channels by time buckets based on valid message activity
    validMessages.forEach(message => {
      if (message.channelScopeType !== ChannelScopeType.DEFAULT) return;
      const bucketKey = this.getBucketKey(message.createdAt, groupBy);
      if (bucketData.has(bucketKey)) {
        bucketData.get(bucketKey)!.add(message.channelId);
      }
    });

    // Convert to array format
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey)?.size || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get users onboarded count
   * Counts the number of users who were onboarded (created in user_presence table) in the selected time period
   */
  async getUsersOnboarded(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Count users onboarded in the selected time period
    const usersOnboardedCount = await this.prisma.userPresence.count({
      where: {
        createdAt: dateCondition,
        user: {
          workspaceId
        }
      }
    });

    return usersOnboardedCount;
  }

  /**
   * Get users onboarded time-series data
   */
  async getUsersOnboardedTimeSeries(filters: AnalyticsFilters): Promise<{ date: string; value: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    // Get user presence records
    const userPresenceRecords = await this.prisma.userPresence.findMany({
      where: { createdAt: dateCondition, user: { workspaceId } },
      select: { createdAt: true },
    });

    // Generate time buckets
    const timeBuckets = this.generateDailyTimeBuckets(startDate, endDate);

    return this.bucketCounts(
      userPresenceRecords,
      timeBuckets,
      record => this.getBucketKey(record.createdAt, 'day'),
    );
  }

  /**
   * Get messages today count
   * Counts the number of messages sent today (in IST timezone)
   */
  async getMessagesToday(workspaceId?: string): Promise<number> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);
    const { startOfTodayUTC, now } = this.getIstDayBounds();

    const validMessages = await this.getFilteredMessages({ gte: startOfTodayUTC, lte: now }, scopedWorkspaceId);

    return validMessages.length;
  }

  /**
   * Get messages today time-series data (hourly breakdown for today)
   */
  async getMessagesTodayTimeSeries(workspaceId?: string): Promise<{ date: string; value: number }[]> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);
    const { startOfTodayUTC, now } = this.getIstDayBounds();

    const messages = await this.getFilteredMessages({ gte: startOfTodayUTC, lte: now }, scopedWorkspaceId);

    // Generate hourly buckets for today
    const timeBuckets = this.generateHourlyTimeBuckets(startOfTodayUTC, now);

    return this.bucketCounts(
      messages,
      timeBuckets,
      message => this.getBucketKey(message.createdAt, 'hour'),
    );
  }

  /**
   * Get number of tickets created
   * Counts the number of tickets created in the selected time period
   * Only counts tickets created by (userType: 'USER')
   */
  async getNumberOfTickets(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    const userIds = await this.getUsersId(workspaceId);

    // Count tickets created in the selected time period by users only
    const ticketsCount = await this.prisma.ticket.count({
      where: {
        createdAt: dateCondition,
        workspaceId,
        createdBy: { in: userIds }
      }
    });

    return ticketsCount;
  }

  /**
   * Get number of tickets time-series data
   * Only counts tickets created by real users (userType: 'USER'), excludes bot-created tickets
   */
  async getNumberOfTicketsTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    const userIds = await this.getUsersId(workspaceId);

    // Get tickets created by real users only
    const tickets = await this.prisma.ticket.findMany({
      where: {
        createdAt: dateCondition,
        workspaceId,
        createdBy: { in: userIds }
      },
      select: { createdAt: true },
    });

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);

    return this.bucketCounts(
      tickets,
      timeBuckets,
      ticket => this.getBucketKey(ticket.createdAt, groupBy),
    );
  }

  /**
   * Get number of active canvases
   * Counts the number of canvases that were edited in the selected time period
   * Only counts canvases created by real users (userType: 'USER'), excludes bot-created canvases
   */
  async getNumberOfCanvases(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    const userIds = await this.getUsersId(workspaceId);

    // Count canvases edited in the selected time period by real users only
    const canvasesCount = await this.prisma.canvas.count({
      where: {
        lastEditedAt: dateCondition,
        createdBy: { in: userIds }
      }
    });

    return canvasesCount;
  }

  /**
   * Get number of canvases time-series data
   * Only counts canvases created by real users (userType: 'USER'), excludes bot-created canvases
   */
  async getNumberOfCanvasesTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    const userIds = await this.getUsersId(workspaceId);

    // Get canvases created by real users only
    const canvases = await this.prisma.canvas.findMany({
      where: {
        lastEditedAt: dateCondition,
        createdBy: { in: userIds }
      },
      select: { lastEditedAt: true },
    });

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);

    return this.bucketCounts(
      canvases,
      timeBuckets,
      canvas => canvas.lastEditedAt ? this.getBucketKey(canvas.lastEditedAt, groupBy) : null,
    );
  }

  /**
   * Get the calls that lasted more than 60 seconds in the selected time period
   * Calls and recordings live in the same table - HEADLESS calls are note taker recordings,
   * every other call type is a regular call
   */
  private async getValidCalls(filters: AnalyticsFilters): Promise<{
    validCalls: { startedAt: Date; isRecording: boolean }[];
    dateCondition: Date | { gte: Date; lte?: Date };
  }> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const userIds = await this.getUsersId(workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Get all calls in the date range
    const calls = await withWorkspaceScope(async () => await this.prisma.call.findMany({
      where: {
        startedAt: dateCondition,
        ...this.getCallWorkspaceFilter(workspaceId, userIds)
      },
      select: {
        startedAt: true,
        endedAt: true,
        callType: true
      }
    }));

    // Filter for calls that lasted more than 60 seconds
    const validCalls = calls
      .filter(call => {
        if (!call.endedAt) return false;
        const duration = (call.endedAt.getTime() - call.startedAt.getTime()) / 1000;
        return duration > 60;
      })
      .map(call => ({
        startedAt: call.startedAt,
        isRecording: call.callType === CallType.HEADLESS
      }));

    return { validCalls, dateCondition };
  }

  /**
   * Get number of calls and recordings
   * Counts the calls started in the selected time period, split into regular calls
   * and note taker recordings
   */
  async getNumberOfCalls(filters: AnalyticsFilters): Promise<CallsBreakdown> {
    const { validCalls } = await this.getValidCalls(filters);

    return {
      calls: validCalls.filter(call => !call.isRecording).length,
      recordings: validCalls.filter(call => call.isRecording).length
    };
  }

  /**
   * Get number of calls time-series data
   * Each point carries the call and recording counts for its bucket
   */
  async getNumberOfCallsTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<CallsTimeSeriesPoint[]> {
    const { validCalls, dateCondition } = await this.getValidCalls(filters);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);
    const callBuckets = new Map<string, number>();
    const recordingBuckets = new Map<string, number>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      callBuckets.set(bucket, 0);
      recordingBuckets.set(bucket, 0);
    });

    // Group calls by time buckets
    validCalls.forEach(call => {
      const bucketKey = this.getBucketKey(call.startedAt, groupBy);
      const bucketData = call.isRecording ? recordingBuckets : callBuckets;
      if (bucketData.has(bucketKey)) {
        bucketData.set(bucketKey, bucketData.get(bucketKey)! + 1);
      }
    });

    // Convert to array format
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      calls: callBuckets.get(bucketKey) || 0,
      recordings: recordingBuckets.get(bucketKey) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get total duration of calls in the selected time period (in minutes)
   * Only counts calls that lasted more than 60 seconds
   */
  async getTotalCallsDuration(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const userIds = await this.getUsersId(workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Get calls that have both start and end times
    const calls = await withWorkspaceScope(async () => await this.prisma.call.findMany({
      where: {
        startedAt: dateCondition,
        endedAt: { not: null },
        ...this.getCallWorkspaceFilter(workspaceId, userIds)
      },
      select: {
        startedAt: true,
        endedAt: true
      }
    }));

    // Filter for calls that lasted more than 60 seconds and sum their durations
    let totalDurationSeconds = 0;
    calls.forEach(call => {
      if (!call.endedAt) return;
      const duration = (call.endedAt.getTime() - call.startedAt.getTime()) / 1000;
      if (duration <= 60) return;

      totalDurationSeconds += duration;
    });

    // Return total duration in minutes (rounded to 1 decimal place)
    return Math.round((totalDurationSeconds / 60) * 10) / 10;
  }

  /**
   * Get total duration of calls time-series data (in minutes per day)
   * Only counts calls that lasted more than 60 seconds
   */
  async getTotalCallsDurationTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const userIds = await this.getUsersId(workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    // Get calls that have both start and end times
    const calls = await withWorkspaceScope(async () => await this.prisma.call.findMany({
      where: {
        startedAt: dateCondition,
        endedAt: { not: null },
        ...this.getCallWorkspaceFilter(workspaceId, userIds)
      },
      select: {
        startedAt: true,
        endedAt: true
      }
    }));

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);

    // Sum qualifying call durations (seconds) per bucket, then convert to minutes
    const durationSecondsSeries = this.bucketCounts(
      calls.filter(call => call.endedAt && (call.endedAt.getTime() - call.startedAt.getTime()) / 1000 > 60),
      timeBuckets,
      call => this.getBucketKey(call.startedAt, groupBy),
      call => (call.endedAt!.getTime() - call.startedAt.getTime()) / 1000,
    );

    return durationSecondsSeries.map(point => ({
      date: point.date,
      value: Math.round(point.value / 60 * 10) / 10 // Convert to minutes with 1 decimal
    }));
  }

  /**
   * Get top users by message count
   * Returns the top N users who sent the most messages in the selected time period
   * Uses database aggregation for optimal performance
   */
  async getTopUsersByMessages(filters: AnalyticsFilters, limit: number = 10): Promise<{ userId: string; userName: string; messageCount: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const dateCondition = this.toDateCondition(dateFilter);
    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);
    // userType : USER ensures we only count messages from real users, excluding bots
    const userIds = new Set(await this.getUsersId(workspaceId));

    // Aggregate message counts by senderId
    const userMessageCount = new Map<string, number>();
    validMessages.forEach(message => {
      if (message.senderId && userIds.has(message.senderId)) {
        userMessageCount.set(
          message.senderId,
          (userMessageCount.get(message.senderId) || 0) + 1
        );
      }
    });

    // Sort users by message count descending and take top N
    const topUserIds = Array.from(userMessageCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([userId]) => userId);

    // Fetch user details for the top senders
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: topUserIds },
        workspaceId
      },
      select: {
        id: true,
        name: true
      }
    });

    // Create a map of userId to userName for efficient lookup
    const userMap = new Map(users.map(u => [u.id, u.name]));

    // Build result with user names, maintaining the sort order
    return topUserIds.map(userId => ({
      userId,
      userName: userMap.get(userId) || 'Unknown User',
      messageCount: userMessageCount.get(userId) || 0
    }));
  }

  /**
   * Get files shared time-series data
   */
  async getFilesSharedTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = this.toDateCondition(dateFilter);

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);
    const validMessageIds = validMessages.map(m => m.messageId);

    // Get file attachments for valid (non-migrated) messages only
    const attachments = validMessageIds.length === 0 ? [] : await this.prisma.$queryRaw<{ createdAt: Date }[]>(Prisma.sql`
      SELECT a."createdAt"
      ${this.chatAttachmentsFrom(validMessageIds, workspaceId)}
    `);

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);

    return this.bucketCounts(
      attachments,
      timeBuckets,
      attachment => this.getBucketKey(attachment.createdAt, groupBy),
    );
  }

}
