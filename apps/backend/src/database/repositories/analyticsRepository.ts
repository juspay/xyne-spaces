import { DatabaseClient, readReplicaDb } from '../client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { Prisma } from '@prisma/client';
import { WorkflowType, getWorkflowTypeDisplayName } from '@/workflows/types/workflow-enums';
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
  const timeRange = typeof filters.timeRange === 'string' ? filters.timeRange : '7d';
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
   * Helper method to extract start and end dates from date condition
   * Centralizes the logic to avoid code duplication across time-series methods
   */
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
   * Calculate percentage change between current and previous period
   */
  private calculateTrend(currentValue: number, previousValue: number): string {
    if (previousValue === 0) {
      return currentValue > 0 ? "+100%" : "0%";
    }

    const change = ((currentValue - previousValue) / previousValue) * 100;
    const sign = change >= 0 ? "+" : "";
    return `${sign}${Math.round(change)}%`;
  }

  /**
   * Convert legacy PR stats to new format with trends
   */
  private convertToTrendStats(currentStats: PRStatsLegacy, previousStats: PRStatsLegacy): PRStats {
    return {
      xyneMerged: {
        count: currentStats.xyneMerged,
        trend: this.calculateTrend(currentStats.xyneMerged, previousStats.xyneMerged)
      },
      xyneDeclined: {
        count: currentStats.xyneDeclined,
        trend: this.calculateTrend(currentStats.xyneDeclined, previousStats.xyneDeclined)
      },
      xyneOpen: {
        count: currentStats.xyneOpen,
        trend: this.calculateTrend(currentStats.xyneOpen, previousStats.xyneOpen)
      },
      nonXyneMerged: {
        count: currentStats.nonXyneMerged,
        trend: this.calculateTrend(currentStats.nonXyneMerged, previousStats.nonXyneMerged)
      },
      raised: {
        count: currentStats.raised,
        trend: this.calculateTrend(currentStats.raised, previousStats.raised)
      },
      successRate: currentStats.successRate,
      coverage: currentStats.coverage
    };
  }

  /**
   * Calculate date range for previous period of same length
   */
  private getPreviousPeriodDates(currentStartDate: Date, currentEndDate: Date): { startDate: Date, endDate: Date } {
    const periodLength = currentEndDate.getTime() - currentStartDate.getTime();
    const previousEndDate = new Date(currentStartDate.getTime() - 1); // One day before current period starts
    const previousStartDate = new Date(previousEndDate.getTime() - periodLength);

    return {
      startDate: previousStartDate,
      endDate: previousEndDate
    };
  }

  /**
   * Calculate raw PR stats for a given date range
   */
  private async calculateRawPRStats(filters: AnalyticsFilters, startDate: Date, endDate: Date): Promise<PRStatsLegacy> {
    const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);
    const workspaceFilter = this.getWorkspaceFilter(filters);

    // Build base where clause for pull requests
    const prWhereClause: any = {
      date: {
        gte: startDate,
        lte: endDate
      },
      ...(filters.repoName && filters.repoName !== 'all' ? {repoName: filters.repoName} : {})
    };

    // Pull requests are scoped through their linked workflow executions.
    if (workflowTypeFilter.workflowType || workspaceFilter.workspaceId) {
      const workflowExecutions = await this.prisma.workflowExecution.findMany({
        where: {
          workflow: {
            ...workspaceFilter,
            ...(workflowTypeFilter.workflowType ? { workflowType: workflowTypeFilter.workflowType as any } : {})
          }
        },
        select: {
          id: true
        }
      });

      const workflowExecutionIds = workflowExecutions.map(we => we.id);

      // Add filter for workflow execution IDs
      prWhereClause.workflowExecutionId = {
        in: workflowExecutionIds
      };
    }

    const prs = await this.prisma.pullRequests.findMany({
      where: prWhereClause
    });

    const initialStats: PRStatsLegacy = {
      xyneOpen: 0,
      xyneDeclined: 0,
      xyneMerged: 0,
      nonXyneMerged: 0,
      raised: 0,
      successRate: 0,
      coverage: 0
    };

    const stats = prs.reduce((acc, curr) => {
      // Track if this is a Xyne PR (only workflowExecutionId needed now)
      const isXynePR = !!curr.workflowExecutionId;

      if (curr.status === 'MERGED') {
        if (isXynePR) {
          acc.xyneMerged += 1;
        } else {
          acc.nonXyneMerged += 1;
        }
      } else if (curr.status === 'DECLINED' && isXynePR) {
        acc.xyneDeclined += 1;
      } else if (curr.status === 'OPEN' && isXynePR) {
        acc.xyneOpen += 1;
      }

      // Increment raised count for all Xyne PRs
      if (isXynePR) {
        acc.raised += 1;
      }

      return acc;
    }, initialStats);

    // Calculate success rate
    const totalXynePRs = stats.xyneMerged + stats.xyneDeclined;
    stats.successRate = totalXynePRs > 0
      ? (stats.xyneMerged / totalXynePRs) * 100
      : 0;

    return stats;
  }

  /**
   * Helper method to calculate execution time percentiles
   */
  private calculateExecutionTimeStats(values: number[]): ExecutionTimeStats {
    if (values.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const getPercentile = (p: number): number => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      p50: Math.round(getPercentile(50)),
      p90: Math.round(getPercentile(90)),
      p95: Math.round(getPercentile(95)),
      p99: Math.round(getPercentile(99))
    };
  }

  /**
   * Helper method to build workflow type filter
   */
  private getWorkflowTypeFilter(workflowType?: string) {
    if (!workflowType || workflowType === 'all') {
      return {};
    }
    return { workflowType };
  }

  /**
   * Helper method to build user filter (filters by ticket creator)
   */
  private getUserFilter(userId?: string) {
    if (!userId || userId === 'all') {
      // For 'all' users, don't apply any user filter (include all data)
      return {};
    }
    return {
      ticket: {
        createdBy: userId
      }
    };
  }

  /**
   * Get overview statistics
   */
  async getOverviewStats(filters: AnalyticsFilters): Promise<any> {
    const dateFilter = getDateFilter(filters);
    const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);
    const workspaceFilter = this.getWorkspaceFilter(filters);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Total workflows in time period
    const totalWorkflows = await this.prisma.workflow.count({
      where: {
        createdAt: dateCondition,
        ...workflowTypeFilter,
        ...workspaceFilter
      }
    });

    // Currently running executions (real-time, filtered by workflow type only)
    const runningExecutions = await this.prisma.workflowExecution.count({
      where: {
        status: { in: ['NEW', 'PENDING', 'RUNNING'] },
        workflow: {
          ...workflowTypeFilter,
          ...workspaceFilter
        }
      }
    });

    // Success rate and average execution time
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        createdAt: dateCondition,
        workflow: {
          ...workflowTypeFilter,
          ...workspaceFilter
        }
      },
      select: {
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(e => e.status === 'SUCCESS').length;
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    // Calculate average execution time for completed workflows
    const completedExecutions = executions.filter(e => e.status === 'SUCCESS');
    const avgExecutionTime = completedExecutions.length > 0
      ? completedExecutions.reduce((sum, e) => {
          const duration = (new Date(e.updatedAt).getTime() - new Date(e.createdAt).getTime()) / 1000;
          return sum + duration;
        }, 0) / completedExecutions.length
      : 0;

    return {
      totalWorkflows,
      runningExecutions,
      successRate: Math.round(successRate * 10) / 10, // Round to 1 decimal
      avgExecutionTime: Math.round(avgExecutionTime)
    };
  }

  /**
     * Get overview statistics
     */
  async getPRMetrics(filters: AnalyticsFilters): Promise<any> {
    const dateFilter = getDateFilter(filters);
    const workspaceFilter = this.getWorkspaceFilter(filters);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Extract dates for current period
    const currentStartDate = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter.gte
      : dateFilter;
    const currentEndDate = typeof dateFilter === 'object' && 'lte' in dateFilter && dateFilter.lte
      ? dateFilter.lte
      : new Date(); // Use lte if available, otherwise now

    // Calculate previous period dates
    const { startDate: previousStartDate, endDate: previousEndDate } =
      this.getPreviousPeriodDates(currentStartDate, currentEndDate);

    logger.info(`📊 [PR-METRICS] Date ranges:`, {
      currentPeriod: { start: currentStartDate.toISOString(), end: currentEndDate.toISOString() },
      previousPeriod: { start: previousStartDate.toISOString(), end: previousEndDate.toISOString() }
    });

    // Get current period stats
    const currentStats = await this.calculateRawPRStats(filters, currentStartDate, currentEndDate);

    // Get previous period stats for trend calculation
    const previousStats = await this.calculateRawPRStats(filters, previousStartDate, previousEndDate);

    // Convert current stats to trend format with comparisons
    const overallMetricsWithTrends = this.convertToTrendStats(currentStats, previousStats);

    // Build time series data using the original logic (but with correct types)
    const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);

    // Build base where clause for pull requests
    const prWhereClause: any = {
      date: dateCondition,
      ...(filters.repoName && filters.repoName !== 'all' ? {repoName: filters.repoName} : {})
    };

    // Pull requests are scoped through their linked workflow executions.
    if (workflowTypeFilter.workflowType || workspaceFilter.workspaceId) {
      const workflowExecutions = await this.prisma.workflowExecution.findMany({
        where: {
          workflow: {
            ...workspaceFilter,
            ...(workflowTypeFilter.workflowType ? { workflowType: workflowTypeFilter.workflowType as any } : {})
          }
        },
        select: {
          id: true
        }
      });

      const workflowExecutionIds = workflowExecutions.map(we => we.id);

      // Add filter for workflow execution IDs
      prWhereClause.workflowExecutionId = {
        in: workflowExecutionIds
      };
    }

    const prs = await this.prisma.pullRequests.findMany({
      where: prWhereClause
    });

    const initialStats: PRStatsLegacy = {
      xyneOpen: 0,
      xyneDeclined: 0,
      xyneMerged: 0,
      nonXyneMerged: 0,
      raised: 0,
      successRate: 0,
      coverage: 0
    };

    // Build repository metrics (without trends)
    const repoMetrics: { [repoName: string]: PRStatsLegacy } = {};

    prs.forEach(curr => {
      if (!(curr.repoName in repoMetrics)) {
        repoMetrics[curr.repoName] = { ...initialStats };
      }

      // Track if this is a Xyne PR (only workflowExecutionId needed now)
      const isXynePR = !!curr.workflowExecutionId;

      if (curr.status === 'MERGED') {
        if (isXynePR) {
          repoMetrics[curr.repoName].xyneMerged += 1;
        } else {
          repoMetrics[curr.repoName].nonXyneMerged += 1;
        }
      } else if (curr.status === 'DECLINED' && isXynePR) {
        repoMetrics[curr.repoName].xyneDeclined += 1;
      } else if (curr.status === 'OPEN' && isXynePR) {
        repoMetrics[curr.repoName].xyneOpen += 1;
      }

      // Increment raised count for all Xyne PRs
      if (isXynePR) {
        repoMetrics[curr.repoName].raised += 1;
      }
    });

    // Calculate success rate for each repo
    for (const key of Object.keys(repoMetrics)) {
      const repoStats = repoMetrics[key];
      const repoTotalXynePRs = repoStats.xyneMerged + repoStats.xyneDeclined;
      repoStats.successRate = repoTotalXynePRs > 0
        ? (repoStats.xyneMerged / repoTotalXynePRs) * 100
        : 0;
      repoStats.coverage = (repoStats.xyneMerged + repoStats.nonXyneMerged) > 0
        ? (repoStats.xyneMerged / (repoStats.xyneMerged + repoStats.nonXyneMerged)) * 100
        : 0;
    }

    // Sort repoMetrics by total PRs
    const sortedRepoMetrics = Object.entries(repoMetrics)
      .sort(([, a], [, b]) => {
        const totalA = a.xyneDeclined + a.xyneMerged + a.xyneOpen;
        const totalB = b.xyneDeclined + b.xyneMerged + b.xyneOpen;
        return totalB - totalA;
      })
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {} as { [repoName: string]: PRStatsLegacy });

    // Build time series data - group PRs by date
    const timeSeriesMap = new Map<string, PRStatsLegacy>();

    prs.forEach(pr => {
      // Format date as YYYY-MM-DD
      const dateKey = pr.date.toISOString().split('T')[0];

      if (!timeSeriesMap.has(dateKey)) {
        timeSeriesMap.set(dateKey, { ...initialStats });
      }

      const dayStats = timeSeriesMap.get(dateKey)!;
      const isXynePR = !!pr.workflowExecutionId;

      if (pr.status === 'MERGED') {
        if (isXynePR) {
          dayStats.xyneMerged += 1;
        } else {
          dayStats.nonXyneMerged += 1;
        }
      } else if (pr.status === 'DECLINED' && isXynePR) {
        dayStats.xyneDeclined += 1;
      } else if (pr.status === 'OPEN' && isXynePR) {
        dayStats.xyneOpen += 1;
      }

      // Increment raised count for all Xyne PRs
      if (isXynePR) {
        dayStats.raised += 1;
      }
    });

    // Calculate success rate and coverage for each day
    timeSeriesMap.forEach((stats) => {
      const dayTotalXynePRs = stats.xyneMerged + stats.xyneDeclined;
      stats.successRate = dayTotalXynePRs > 0
        ? (stats.xyneMerged / dayTotalXynePRs) * 100
        : 0;
      stats.coverage = (stats.xyneMerged + stats.nonXyneMerged) > 0
        ? (stats.xyneMerged / (stats.xyneMerged + stats.nonXyneMerged)) * 100
        : 0;
    });

    // Convert to array and sort by date
    const timeSeries = Array.from(timeSeriesMap.entries())
      .map(([date, stats]) => ({ date, stats }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      overallMetrics: overallMetricsWithTrends,
      repoMetrics: sortedRepoMetrics,
      timeSeries: timeSeries
    };
  }

  /**
   * Get workflow metrics bucketed by workflowType and status
   */
  async getWorkflowMetrics(filters: AnalyticsFilters) {
    const dateFilter = getDateFilter(filters);
    const workspaceFilter = this.getWorkspaceFilter(filters);
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
   * Get optimized execution statistics for all 3 UI components
   */
  async getExecutionStats(filters: AnalyticsFilters): Promise<ExecutionStats> {
    const dateFilter = getDateFilter(filters);
    const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);
    const userFilter = this.getUserFilter(filters.userId);
    const workspaceFilter = this.getWorkspaceFilter(filters);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Get all completed workflow executions
    const result = await this.prisma.workflow.findMany({
      where: {
        createdAt: dateCondition,
        ...workflowTypeFilter,
        ...workspaceFilter,
        ...userFilter
        // Note: repoName filter not applicable to workflows (only to PRs)
      },
      include: {
        workflowExecutions: {
          select: {
            status: true,
            createdAt: true,
            updatedAt: true,
            ignoreDuration: true
          },
          where: {
            parentWorkflowExecutionId: null,
            status: { in: ['SUCCESS', 'FAILURE'] }  // Only completed executions
          }
        }
      }
    });

    // Collect data for all calculations
    const allExecutionTimes: number[] = [];
    const workflowTypeStats = new Map<string, {
      executionTimes: number[];
      successCount: number;
      failedCount: number;
    }>();
    const dailyStats = new Map<string, {
      totalExecutions: number;
      successfulExecutions: number;
    }>();

    result.forEach(workflow => {
      const type = workflow.workflowType || 'UNKNOWN';

      if (!workflowTypeStats.has(type)) {
        workflowTypeStats.set(type, {
          executionTimes: [],
          successCount: 0,
          failedCount: 0
        });
      }

      const typeStats = workflowTypeStats.get(type)!;

      workflow.workflowExecutions.forEach(execution => {
        const executionTime = execution.updatedAt.getTime() - execution.createdAt.getTime() - execution.ignoreDuration;
        const executionDate = execution.updatedAt.toISOString().split('T')[0];

        // Collect for overall time stats
        allExecutionTimes.push(executionTime);

        // Collect for per-type stats
        typeStats.executionTimes.push(executionTime);
        if (execution.status === 'SUCCESS') {
          typeStats.successCount++;
        } else {
          typeStats.failedCount++;
        }

        // Collect for daily success rate
        if (!dailyStats.has(executionDate)) {
          dailyStats.set(executionDate, {
            totalExecutions: 0,
            successfulExecutions: 0
          });
        }
        const dayStats = dailyStats.get(executionDate)!;
        dayStats.totalExecutions++;
        if (execution.status === 'SUCCESS') {
          dayStats.successfulExecutions++;
        }
      });
    });

    // Calculate overall time stats
    const overallTimeStats = this.calculateExecutionTimeStats(allExecutionTimes);

    // Calculate per-workflow-type stats
    const workflowTypes: ExecutionStatsItem[] = [];
    workflowTypeStats.forEach((stats, type) => {
      const totalExecutions = stats.successCount + stats.failedCount;
      const successRate = totalExecutions > 0 ? (stats.successCount / totalExecutions) * 100 : 0;

      workflowTypes.push({
        type,
        executionCount: totalExecutions,
        successCount: stats.successCount,
        failedCount: stats.failedCount,
        successRate: Math.round(successRate * 10) / 10, // Round to 1 decimal
        timeStats: this.calculateExecutionTimeStats(stats.executionTimes)
      });
    });

    // Calculate success rate time series
    const successRateTimeSeries: SuccessRateTimePoint[] = [];
    Array.from(dailyStats.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .forEach(([date, stats]) => {
        const successRate = stats.totalExecutions > 0
          ? (stats.successfulExecutions / stats.totalExecutions) * 100
          : 0;

        successRateTimeSeries.push({
          date,
          totalExecutions: stats.totalExecutions,
          successfulExecutions: stats.successfulExecutions,
          successRate: Math.round(successRate * 10) / 10 // Round to 1 decimal
        });
      });

    return {
      overallTimeStats,
      successRateTimeSeries,
      workflowTypes: workflowTypes.sort((a, b) => b.executionCount - a.executionCount)
    };
  }

  /**
   * Get workflow type statistics (legacy method - now delegates to new method)
   */
  async getWorkflowTypeStats(filters: AnalyticsFilters) {
    const executionStats = await this.getExecutionStats(filters);

    // Transform new format back to legacy format for backwards compatibility
    const workflowTypes = executionStats.workflowTypes.map(item => ({
      type: item.type,
      count: item.executionCount,
      success: item.successCount,
      failed: item.failedCount,
      timeStats: item.timeStats,
      successTime: { p50: 0, p90: 0, p95: 0, p99: 0 }, // Not calculated in new method
      failureTime: { p50: 0, p90: 0, p95: 0, p99: 0 }  // Not calculated in new method
    }));

    return {
      workflowTypes,
      overallTimeStats: executionStats.overallTimeStats
    };
  }

  /**
   * Get execution status distribution
   */
  async getExecutionStatusStats(filters: AnalyticsFilters): Promise<ExecutionStatusStats[]> {
    const dateFilter = getDateFilter(filters);
    const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);
    const workspaceFilter = this.getWorkspaceFilter(filters);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        createdAt: dateCondition,
        workflow: {
          ...workflowTypeFilter,
          ...workspaceFilter
        }
      },
      select: {
        status: true
      }
    });

    const totalCount = executions.length;
    const statusCounts = new Map<string, number>();

    executions.forEach(execution => {
      const status = execution.status || 'UNKNOWN';
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    });

    const result: ExecutionStatusStats[] = [];
    statusCounts.forEach((count, status) => {
      result.push({
        status,
        count,
        percentage: totalCount > 0 ? Math.round((count / totalCount) * 1000) / 10 : 0 // Round to 1 decimal
      });
    });

    return result.sort((a, b) => b.count - a.count);
  }

  /**
   * Get most failing steps
   */
  async getStepFailureStats(filters: AnalyticsFilters): Promise<StepFailureStats[]> {
    const dateFilter = getDateFilter(filters);
    const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);
    const workspaceFilter = this.getWorkspaceFilter(filters);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    const steps = await this.prisma.workflowStep.findMany({
      where: {
        createdAt: dateCondition,
        stepName: { not: null },
        workflowExecution: {
          workflow: {
            ...workflowTypeFilter,
            ...workspaceFilter
          }
        }
      },
      select: {
        stepName: true,
        status: true
      }
    });

    // Group by step name
    const stepStatsMap = new Map<string, { failures: number; totalRuns: number }>();

    steps.forEach(step => {
      const stepName = step.stepName!;

      if (!stepStatsMap.has(stepName)) {
        stepStatsMap.set(stepName, { failures: 0, totalRuns: 0 });
      }

      const stats = stepStatsMap.get(stepName)!;
      stats.totalRuns++;

      if (step.status === 'FAILURE') {
        stats.failures++;
      }
    });

    const result: StepFailureStats[] = [];
    stepStatsMap.forEach((stats, stepName) => {
      if (stats.totalRuns >= 5) { // Only include steps with meaningful sample size
        const rate = Math.round((stats.failures / stats.totalRuns) * 1000) / 10; // Round to 1 decimal
        result.push({
          stepName,
          failures: stats.failures,
          totalRuns: stats.totalRuns,
          rate
        });
      }
    });

    return result.sort((a, b) => b.rate - a.rate || b.failures - a.failures).slice(0, 5);
  }

  /**
   * Get step funnel data - sequential completion rates
   */
  async getStepFunnelStats(filters: AnalyticsFilters): Promise<StepFunnelStats[]> {
    try {
      const dateFilter = getDateFilter(filters);
      const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);
      const workspaceFilter = this.getWorkspaceFilter(filters);

      // Build date condition for Prisma query
      const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
        ? dateFilter
        : { gte: dateFilter };

      // Get all workflow executions with their steps
      const executions = await this.prisma.workflowExecution.findMany({
        where: {
          createdAt: dateCondition,
          workflow: {
            ...workflowTypeFilter,
            ...workspaceFilter
          }
        },
        include: {
          workflowSteps: {
            where: {
              stepName: { not: null },
              type: { not: null }
            },
            orderBy: {
              createdAt: 'asc'
            },
            select: {
              stepName: true,
              type: true,
              createdAt: true
            }
          }
        },
        // Add pagination to prevent memory issues
        take: 1000
      });

    if (executions.length === 0) {
      return [];
    }

    // Build step sequence and calculate funnel metrics
    const stepSequenceMap = new Map<string, number>();
    const stepStatsMap = new Map<string, { started: number; completed: number }>();

    // First pass: determine step sequence order by finding first input occurrence
    executions.forEach(execution => {
      const inputSteps = execution.workflowSteps.filter(step => step.type === 'input');
      inputSteps.forEach((step, index) => {
        const stepName = step.stepName!;
        if (!stepSequenceMap.has(stepName)) {
          stepSequenceMap.set(stepName, index);
        } else {
          // Use the minimum index to ensure proper ordering
          stepSequenceMap.set(stepName, Math.min(stepSequenceMap.get(stepName)!, index));
        }
      });
    });

    // Sort steps by their sequence order
    const orderedSteps = Array.from(stepSequenceMap.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([stepName]) => stepName);

    // Second pass: calculate funnel metrics
    executions.forEach(execution => {
      // Group steps by name and type for this execution
      const stepsByName = new Map<string, { hasInput: boolean; hasOutput: boolean }>();

      execution.workflowSteps.forEach(step => {
        const stepName = step.stepName!;
        if (!stepsByName.has(stepName)) {
          stepsByName.set(stepName, { hasInput: false, hasOutput: false });
        }

        const stepData = stepsByName.get(stepName)!;
        if (step.type === 'input') {
          stepData.hasInput = true;
        } else if (step.type === 'output') {
          stepData.hasOutput = true;
        }
      });

      orderedSteps.forEach((stepName) => {
        if (!stepStatsMap.has(stepName)) {
          stepStatsMap.set(stepName, { started: 0, completed: 0 });
        }

        const stats = stepStatsMap.get(stepName)!;
        const stepData = stepsByName.get(stepName);

        // A step is "started" if this execution has an input for this step
        if (stepData && stepData.hasInput) {
          stats.started++;

          // A step is "completed" if it has both input AND output
          if (stepData.hasInput && stepData.hasOutput) {
            stats.completed++;
          }
        }
      });
    });

    // Build funnel result
    const result: StepFunnelStats[] = [];
    orderedSteps.forEach((stepName, index) => {
      const stats = stepStatsMap.get(stepName);
      if (stats && stats.started > 0) {
        const completionRate = Math.round((stats.completed / stats.started) * 1000) / 10;
        const dropoffRate = Math.round((1 - (stats.completed / stats.started)) * 1000) / 10;

        result.push({
          stepName,
          stepOrder: index + 1,
          totalStarted: stats.started,
          totalCompleted: stats.completed,
          completionRate,
          dropoffRate
        });
      }
    });

      return result;
    } catch (error) {
      logger.error('Error fetching step funnel stats:', error);

      // Log specific details for debugging
      if (error instanceof Error) {
        logger.error('Error message:', error.message);
        logger.error('Error stack:', error.stack);
      }

      // Return empty array as fallback
      return [];
    }
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(filters: AnalyticsFilters): Promise<RecentActivityItem[]> {
    const dateFilter = getDateFilter(filters);
    const workflowTypeFilter = this.getWorkflowTypeFilter(filters.workflowType);
    const workspaceFilter = this.getWorkspaceFilter(filters);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        updatedAt: dateCondition,
        workflow: {
          ...workflowTypeFilter,
          ...workspaceFilter
        }
      },
      include: {
        workflow: {
          select: {
            workflowType: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: 5
    });

    return executions.map(execution => {
      const workflowType = execution.workflow.workflowType || 'UNKNOWN';
      let eventDescription = '';

      switch (execution.status) {
        case 'SUCCESS':
          eventDescription = `${workflowType} workflow completed successfully`;
          break;
        case 'FAILURE':
          eventDescription = `${workflowType} workflow failed`;
          break;
        case 'RUNNING':
          eventDescription = `${workflowType} workflow started`;
          break;
        case 'PENDING':
          eventDescription = `${workflowType} workflow is pending`;
          break;
        case 'CANCELLED':
          eventDescription = `${workflowType} workflow was cancelled`;
          break;
        default:
          eventDescription = `${workflowType} workflow ${execution.status?.toLowerCase()}`;
      }

      return {
        time: this.formatTimeAgo(execution.updatedAt),
        event: eventDescription
      };
    });
  }

  /**
   * Get available users for filter dropdown
   */
  async getAvailableUsers(workspaceId: string): Promise<{ value: string; label: string; email: string; count: number }[]> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);

    // 1. Get distinct user IDs from tickets with their counts
    // Workspace-wide: the dropdown lists every ticket author, not the admin's reachable set.
    const ticketCreators = await withWorkspaceScope(async () => await this.prisma.ticket.groupBy({
      by: ['createdBy'],
      where: {
        workspaceId: scopedWorkspaceId
      },
      _count: {
        createdBy: true
      }
    }));

    // Filter out null values and extract user IDs
    const userIds = ticketCreators
      .filter(t => t.createdBy !== null)
      .map(t => t.createdBy as string);

    // Return early if no users found
    if (userIds.length === 0) {
      return [
        {
          value: 'all',
          label: 'All Users',
          email: '',
          count: 0
        }
      ];
    }

    // 2. Fetch only the relevant users
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        workspaceId: scopedWorkspaceId
      },
      select: {
        id: true,
        name: true,
        email: true
      }
    });

    // 3. Create a map of user ID to ticket count
    const countMap = new Map(
      ticketCreators
        .filter(t => t.createdBy !== null)
        .map(t => [t.createdBy as string, t._count.createdBy])
    );

    // 4. Map users with their ticket counts and sort by count
    const usersWithTickets = users
      .map(user => ({
        ...user,
        count: countMap.get(user.id) || 0
      }))
      .sort((a, b) => b.count - a.count);

    // 5. Build the options array
    const options = [
      {
        value: 'all',
        label: 'All Users',
        email: '',
        count: usersWithTickets.reduce((sum, user) => sum + user.count, 0)
      }
    ];

    // Add user options sorted by ticket count
    usersWithTickets.forEach(user => {
      options.push({
        value: user.id,
        label: user.name,
        email: user.email,
        count: user.count
      });
    });

    return options;
  }

  /**
   * Get available repositories for filter dropdown
   */
  async getAvailableRepositories(workspaceId: string): Promise<{ value: string; label: string; count: number }[]> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);
    const workflowExecutions = await this.prisma.workflowExecution.findMany({
      where: {
        workflow: {
          workspaceId: scopedWorkspaceId
        }
      },
      select: {
        id: true
      }
    });
    const workflowExecutionIds = workflowExecutions.map(we => we.id);

    // Get distinct repository names with their PR counts
    const repositories = await this.prisma.pullRequests.groupBy({
      by: ['repoName'],
      where: {
        workflowExecutionId: { in: workflowExecutionIds }
      },
      _count: {
        repoName: true
      },
      orderBy: {
        _count: {
          repoName: 'desc'
        }
      }
    });

    // Build the options array
    const options = [
      {
        value: 'all',
        label: 'All Repository',
        count: repositories.reduce((sum, repo) => sum + repo._count.repoName, 0)
      }
    ];

    // Add repository options sorted by usage count
    repositories.forEach(repo => {
      if (repo.repoName) {
        options.push({
          value: repo.repoName,
          label: repo.repoName,
          count: repo._count.repoName
        });
      }
    });

    return options;
  }

  /**
   * Get available workflow types from enum
   */
  async getAvailableWorkflowTypes(): Promise<WorkflowTypeOption[]> {
    // Get workflow types from the enum
    const workflowTypes = Object.values(WorkflowType);

    // Build the options array
    const options: WorkflowTypeOption[] = [
      {
        value: 'all',
        label: 'All Workflows',
        description: 'Show data for all workflow types'
      }
    ];

    // Add enum-defined workflow types
    workflowTypes.forEach(workflowType => {
      options.push({
        value: workflowType,
        label: getWorkflowTypeDisplayName(workflowType),
        description: `Show data for ${getWorkflowTypeDisplayName(workflowType)} workflows`
      });
    });

    return options;
  }

  /**
   * Helper method to format time ago
   */
  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60));

    if (diffInMinutes < 1) {
      return 'Just now';
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes} min ago`;
    } else if (diffInMinutes < 1440) {
      const hours = Math.floor(diffInMinutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffInMinutes / 1440);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
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
   * Get active users statistics
   * Counts distinct users who performed any activity (messages, reactions, file uploads)
   */
  async getActiveUsers(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const userIds = await this.getUsersId(workspaceId);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Use getFilteredMessages for robust message filtering
    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);

    // Get all user IDs from different activity types using Promise.all for parallel execution
    const [reactionUsers, attachmentUsers, ticketCreators, ticketActivityUsers, canvasCreators, canvasParticipants] = await Promise.all([
      // Users who posted reactions
      withWorkspaceScope(async () => await this.prisma.reaction.findMany({
        where: { createdAt: dateCondition, userId: { in: userIds } },
        select: { userId: true },
        distinct: ['userId'],
      })),

      // Users who uploaded files
      this.prisma.messageAttachment.findMany({
        where: { createdAt: dateCondition, workspaceId },
        select: { createdBy: true },
        distinct: ['createdBy'],
      }),

      // Users who created tickets. Workspace-wide metric; TicketsACL is now per-user.
      withWorkspaceScope(async () => await this.prisma.ticket.findMany({
        where: { createdAt: dateCondition, workspaceId },
        select: { createdBy: true},
        distinct: ['createdBy'],
      })),

      // Users who update ticket_activities
      withWorkspaceScope(async () => await this.prisma.ticketActivity.findMany({
        where: { timestamp: dateCondition, ticket: { workspaceId } },
        select: { updatedBy: true},
        distinct: ['updatedBy'],
      })),

      // Users who created canvas. Workspace-wide metric: CanvasesACL is now a per-user
      // clause and this query carries no workspaceId of its own. Same as the sibling below.
      withWorkspaceScope(async () => await this.prisma.canvas.findMany({
        where: { createdAt: dateCondition, createdBy: { in: userIds } },
        select: { createdBy: true},
        distinct: ['createdBy'],
      })),

      // Users who edited canvas
      withWorkspaceScope(async () => await this.prisma.canvasParticipant.findMany({
        where: { updatedAt: dateCondition, userId: { in: userIds } },
        select: { userId: true},
        distinct: ['userId'],
      }))
    ]);

    const allActiveUserIds = new Set<string>();

    // Add valid message senders
    validMessages.forEach(message => {
      if (message.senderId) {
        allActiveUserIds.add(message.senderId);
      }
    });

    // Add reaction users
    reactionUsers.forEach(user => {
      if (user.userId) {
        allActiveUserIds.add(user.userId);
      }
    });

    // Add file uploaders
    attachmentUsers.forEach(user => {
      if (user.createdBy) {
        allActiveUserIds.add(user.createdBy);
      }
    });

    ticketCreators.forEach(user => {
      if (user.createdBy) {
        allActiveUserIds.add(user.createdBy);
      }
    });

    ticketActivityUsers.forEach(user => {
      if (user.updatedBy) {
        allActiveUserIds.add(user.updatedBy);
      }
    });

    canvasCreators.forEach(user => {
      if (user.createdBy) {
        allActiveUserIds.add(user.createdBy);
      }
    });

    canvasParticipants.forEach(user => {
      if (user.userId) {
        allActiveUserIds.add(user.userId);
      }
    });

    return allActiveUserIds.size;
  }

  /**
   * Get overall messages per user average for the entire time period
   */
  async getOverallMessagesPerUser(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };
    const validMessages = await this.getFilteredMessages(dateCondition, this.requireWorkspaceId(filters.workspaceId));

    const totalMessages = validMessages.length;
    const uniqueUserCount = new Set(validMessages.map(m => m.senderId).filter(id => !!id)).size;
    return uniqueUserCount > 0
      ? Math.round((totalMessages / uniqueUserCount) * 100) / 100 // Round to 2 decimal places
      : 0;
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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter ? dateFilter : { gte: dateFilter };
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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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

      // Users who created tickets. Workspace-wide metric; TicketsACL is now per-user.
      withWorkspaceScope(async () => await this.prisma.ticket.findMany({
        where: { createdAt: dateCondition, workspaceId },
        select: { createdBy: true, createdAt: true },
      })),

      // Users who update ticket_activities
      withWorkspaceScope(async () => await this.prisma.ticketActivity.findMany({
        where: { timestamp: dateCondition, ticket: { workspaceId } },
        select: { updatedBy: true, timestamp: true },
      })),

      // Users who created canvas. withWorkspaceScope for the same reason as getActiveUsers.
      withWorkspaceScope(async () => await this.prisma.canvas.findMany({
        where: { createdAt: dateCondition, createdBy: { in: userIds } },
        select: { createdBy: true, createdAt: true },
      })),

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
   * Get messages per user time-series data
   */
  async getMessagesPerUserTimeSeries(filters: AnalyticsFilters): Promise<{ date: string; value: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);

    // Build date condition for Prisma query
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);
    // Use centralized helper for filtering
    const validMessages = await this.getFilteredMessages(dateCondition, workspaceId);

    // Generate time buckets
    const timeBuckets = this.generateDailyTimeBuckets(startDate, endDate);
    const bucketData = new Map<string, { totalMessages: number; uniqueUsers: Set<string> }>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, { totalMessages: 0, uniqueUsers: new Set<string>() });
    });

    // Group valid messages by time buckets
    validMessages.forEach(message => {
      if (message.senderId) {
        // Convert UTC time to IST (UTC+5:30) for proper day bucketing
        const istTime = new Date(message.createdAt.getTime() + IST_OFFSET_MS);
        const bucketKey = istTime.toISOString().split('T')[0];
        if (bucketData.has(bucketKey)) {
          const bucket = bucketData.get(bucketKey)!;
          bucket.totalMessages += 1;
          bucket.uniqueUsers.add(message.senderId);
        }
      }
    });

    // Convert to array format with average calculation
    return timeBuckets.map(bucketKey => {
      const data = bucketData.get(bucketKey)!;
      const avgMessagesPerUser = data.uniqueUsers.size > 0
        ? Math.round((data.totalMessages / data.uniqueUsers.size) * 100) / 100
        : 0;
      return {
        date: bucketKey,
        value: avgMessagesPerUser
      };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get active channels aggregate count (efficient database query)
   * Returns unique channels that had activity based on messages over the entire period
   * Uses the same logic as the time-series to ensure consistency
   */
  async getActiveChannels(filters: AnalyticsFilters): Promise<number> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };
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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    // Get user presence records
    const userPresenceRecords = await this.prisma.userPresence.findMany({
      where: { createdAt: dateCondition, user: { workspaceId } },
      select: { createdAt: true },
    });

    // Generate time buckets
    const timeBuckets = this.generateDailyTimeBuckets(startDate, endDate);
    const bucketData = new Map<string, number>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, 0);
    });

    // Group user onboarding by time buckets
    userPresenceRecords.forEach(record => {
      // Convert UTC time to IST (UTC+5:30) for proper day bucketing
      const istTime = new Date(record.createdAt.getTime() + IST_OFFSET_MS);
      const bucketKey = istTime.toISOString().split('T')[0];
      if (bucketData.has(bucketKey)) {
        bucketData.set(bucketKey, bucketData.get(bucketKey)! + 1);
      }
    });

    // Convert to array format
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get messages today count
   * Counts the number of messages sent today (in IST timezone)
   */
  async getMessagesToday(workspaceId?: string): Promise<number> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);
    // Get current time in IST (UTC+5:30), quantized so this range matches the
    // one getMessagesTodayTimeSeries resolves and the two can share a scan.
    const now = floorToMinute(new Date());
    const istTime = new Date(now.getTime() + IST_OFFSET_MS);
    
    // Get start of today in IST
    const startOfTodayIST = new Date(Date.UTC(
      istTime.getUTCFullYear(),
      istTime.getUTCMonth(),
      istTime.getUTCDate()
    ));
    
    // Subtract IST offset to get UTC time for start of today IST
    const startOfTodayUTC = new Date(startOfTodayIST.getTime() - IST_OFFSET_MS);

    const validMessages = await this.getFilteredMessages({ gte: startOfTodayUTC, lte: now }, scopedWorkspaceId);

    return validMessages.length;
  }

  /**
   * Get messages today time-series data (hourly breakdown for today)
   */
  async getMessagesTodayTimeSeries(workspaceId?: string): Promise<{ date: string; value: number }[]> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);
    // Get current time in IST (UTC+5:30), quantized so this range matches the
    // one getMessagesToday resolves and the two can share a scan.
    const now = floorToMinute(new Date());
    const istTime = new Date(now.getTime() + IST_OFFSET_MS);

    // Get start of today in IST
    const startOfTodayIST = new Date(Date.UTC(
      istTime.getUTCFullYear(),
      istTime.getUTCMonth(),
      istTime.getUTCDate()
    ));

    // Subtract IST offset to get UTC time for start of today IST
    const startOfTodayUTC = new Date(startOfTodayIST.getTime() - IST_OFFSET_MS);

    const messages = await this.getFilteredMessages({ gte: startOfTodayUTC, lte: now }, scopedWorkspaceId);

    // Generate hourly buckets for today
    const timeBuckets = this.generateHourlyTimeBuckets(startOfTodayUTC, now);
    const bucketData = new Map<string, number>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, 0);
    });

    // Group messages by hour
    messages.forEach(message => {
      const bucketKey = this.getBucketKey(message.createdAt, 'hour');
      if (bucketData.has(bucketKey)) {
        bucketData.set(bucketKey, bucketData.get(bucketKey)! + 1);
      }
    });

    // Convert to array format
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    const userIds = await this.getUsersId(workspaceId);

    // Count tickets created in the selected time period by users only
    // Workspace-wide metric, not "tickets the caller can reach".
    const ticketsCount = await withWorkspaceScope(async () => await this.prisma.ticket.count({
      where: {
        createdAt: dateCondition,
        workspaceId,
        createdBy: { in: userIds }
      }
    }));

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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    const userIds = await this.getUsersId(workspaceId);

    // Get tickets created by real users only
    // Workspace-wide metric, as in the count above.
    const tickets = await withWorkspaceScope(async () => await this.prisma.ticket.findMany({
      where: {
        createdAt: dateCondition,
        workspaceId,
        createdBy: { in: userIds }
      },
      select: { createdAt: true },
    }));

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);
    const bucketData = new Map<string, number>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, 0);
    });

    // Group tickets by time buckets
    tickets.forEach(ticket => {
      const bucketKey = this.getBucketKey(ticket.createdAt, groupBy);
      if (bucketData.has(bucketKey)) {
        bucketData.set(bucketKey, bucketData.get(bucketKey)! + 1);
      }
    });

    // Convert to array format
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    const userIds = await this.getUsersId(workspaceId);

    // Count canvases edited in the selected time period by real users only
    // withWorkspaceScope: a workspace-wide metric, not "canvases the caller can reach".
    const canvasesCount = await withWorkspaceScope(async () => await this.prisma.canvas.count({
      where: {
        lastEditedAt: dateCondition,
        createdBy: { in: userIds }
      }
    }));

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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

    // Extract start and end dates using centralized helper method
    const { startDate, endDate } = this.getDateRange(dateCondition);

    const userIds = await this.getUsersId(workspaceId);

    // Get canvases created by real users only
    // withWorkspaceScope: workspace-wide metric, as in getNumberOfCanvases.
    const canvases = await withWorkspaceScope(async () => await this.prisma.canvas.findMany({
      where: {
        lastEditedAt: dateCondition,
        createdBy: { in: userIds }
      },
      select: { lastEditedAt: true },
    }));

    // Generate time buckets based on groupBy
    const timeBuckets = groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);
    const bucketData = new Map<string, number>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, 0);
    });

    // Group canvases by time buckets
    canvases.forEach(canvas => {
      if (canvas.lastEditedAt) {
        const bucketKey = this.getBucketKey(canvas.lastEditedAt, groupBy);
        if (bucketData.has(bucketKey)) {
          bucketData.set(bucketKey, bucketData.get(bucketKey)! + 1);
        }
      }
    });

    // Convert to array format
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
    const bucketData = new Map<string, number>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, 0);
    });

    // Group calls by time buckets and sum durations (in seconds initially)
    calls.forEach(call => {
      if (!call.endedAt) return;
      const duration = (call.endedAt.getTime() - call.startedAt.getTime()) / 1000;
      if (duration <= 60) return;

      const bucketKey = this.getBucketKey(call.startedAt, groupBy);
      if (bucketData.has(bucketKey)) {
        bucketData.set(bucketKey, bucketData.get(bucketKey)! + duration);
      }
    });

    // Convert to array format with values in minutes
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: Math.round((bucketData.get(bucketKey) || 0) / 60 * 10) / 10 // Convert to minutes with 1 decimal
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get top users by message count
   * Returns the top N users who sent the most messages in the selected time period
   * Uses database aggregation for optimal performance
   */
  async getTopUsersByMessages(filters: AnalyticsFilters, limit: number = 10): Promise<{ userId: string; userName: string; messageCount: number }[]> {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };
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
    const dateCondition = typeof dateFilter === 'object' && 'gte' in dateFilter
      ? dateFilter
      : { gte: dateFilter };

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
    const bucketData = new Map<string, number>();

    // Initialize buckets
    timeBuckets.forEach(bucket => {
      bucketData.set(bucket, 0);
    });

    // Group attachments by time buckets
    attachments.forEach(attachment => {
      const bucketKey = this.getBucketKey(attachment.createdAt, groupBy);
      if (bucketData.has(bucketKey)) {
        bucketData.set(bucketKey, bucketData.get(bucketKey)! + 1);
      }
    });

    // Convert to array format
    return timeBuckets.map(bucketKey => ({
      date: bucketKey,
      value: bucketData.get(bucketKey) || 0
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

}
