import { DatabaseClient, readReplicaDb } from '../client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { Prisma } from '@prisma/client';
import { IST_OFFSET_MS, HOUR_MS } from '@/utils/dateUtils';
import {logger} from '@/utils/logger';
import { AttachmentEntityType, CallType, ChannelScopeType, UserType } from '@xyne/shared';

export interface AnalyticsFilters {
  timeRange?: string; // 'today', '7d', '30d', '90d', 'custom'
  workspaceId?: string; // Current workspace scope for analytics queries
  startDate?: string; // ISO date string for custom range start
  endDate?: string; // ISO date string for custom range end
}

// Calls and recordings are the same table, split by callType (HEADLESS = recording)
interface CallsBreakdown {
  calls: number;      // Regular calls (every callType except HEADLESS)
  recordings: number; // Recordings (HEADLESS)
}

interface CallsTimeSeriesPoint {
  date: string;
  calls: number;      // Call count for the bucket (recordings excluded)
  recordings: number; // Recording count for the bucket
}

const MINUTE_MS = 60 * 1000;
/** Calls shorter than this many seconds are ignored across all call analytics. */
const MIN_CALL_DURATION_SECONDS = 60;
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
function getDateFilter(filters: AnalyticsFilters): Date | { gte: Date; lte?: Date } {
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
   * Excluded channel IDs for analytics filtering
   * These channels are excluded from all analytics message queries
   */
  private static readonly EXCLUDED_CHANNEL_IDS = [
    'cmkl0nsjp01vq5n0sczlf058f', 'cmkmh8ksj00fbxkaq0u5u207c',
    'cmkmir9ys03ntskfrt63lrfex', 'cmkmiz3wb03o7skfr6cos6t3b',
    'cmkn23y86008b10br13ngegoq', 'cmkn2ohyc009vjja5vbw9qrg7',
    'cmlpgdr0a09rj11uzf3xql7ad', 'cmkmhn5c803k3skfrc836863n','cmlv7gc0a00mrka9fol3ccjrk'
  ];

  private toIsoBounds(dateCondition: { gte?: Date; lte?: Date }): { gte: string | null; lte: string | null } {
    return {
      gte: dateCondition.gte ? dateCondition.gte.toISOString() : null,
      lte: dateCondition.lte ? dateCondition.lte.toISOString() : null,
    };
  }

  /**
   * Shared FROM/WHERE fragment that defines the "valid message" set (real USER
   * messages, workspace-scoped, excluding system channels, pre-import external
   * source rows and EMAIL parent rows). Exposed as a single Prisma.Sql fragment
   * so scalar aggregates (COUNT / COUNT DISTINCT / GROUP BY) can run in Postgres
   * instead of shipping every matching row back to Node.
   */
  private validMessagesFrom(gte: string | null, lte: string | null, scopedWorkspaceId: string): Prisma.Sql {
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

    return Prisma.sql`
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
    `;
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

  private getCallWorkspaceFilter(workspaceId: string, userIds: string[]): Prisma.CallWhereInput {
    return {
      OR: [
        { workspaceId, channelId: { not: null } },
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
   * IST bucket ordinal computed in Postgres. Mirrors getBucketKey's integer
   * math: shift the row's UTC epoch into IST, then floor to the hour/day unit.
   * extract(epoch ...) yields the UTC epoch regardless of the createdAt column's
   * storage type, and bucketKeyFromOrdinal turns the ordinal back into the exact
   * same key string getBucketKey / generate*TimeBuckets produce, so SQL-side
   * grouping stays byte-identical to the old Node bucketing.
   */
  private bucketOrdinalSql(groupBy: 'day' | 'hour', column: Prisma.Sql = Prisma.sql`m."createdAt"`): Prisma.Sql {
    const unitMs = groupBy === 'hour' ? HOUR_MS : HOUR_MS * 24;
    return Prisma.sql`floor((floor(extract(epoch from ${column}) * 1000) + ${IST_OFFSET_MS}) / ${unitMs})::bigint`;
  }

  /**
   * Inverse of bucketOrdinalSql: reconstruct the canonical bucket key string
   * from a SQL bucket ordinal, byte-identical to getBucketKey so the zero-fill
   * join against generate*TimeBuckets lines up.
   */
  private bucketKeyFromOrdinal(ordinal: number, groupBy: 'day' | 'hour'): string {
    const unitMs = groupBy === 'hour' ? HOUR_MS : HOUR_MS * 24;
    const shiftedStartMs = ordinal * unitMs;
    return groupBy === 'hour'
      ? new Date(shiftedStartMs - IST_OFFSET_MS).toISOString()
      : new Date(shiftedStartMs).toISOString().split('T')[0];
  }

  /**
   * Run a per-bucket aggregate over the valid-message set entirely in Postgres.
   * `aggregates` supplies the SELECT columns after the bucket ordinal; only
   * non-empty buckets come back, so callers zero-fill against their generated
   * bucket list. Keeps the whole time series off the Node heap - no message row
   * is materialized just to be counted.
   */
  private async bucketedOverValidMessages<R>(
    gte: string | null,
    lte: string | null,
    workspaceId: string,
    groupBy: 'day' | 'hour',
    aggregates: Prisma.Sql,
  ): Promise<R[]> {
    return this.prisma.$queryRaw<R[]>(Prisma.sql`
      SELECT ${this.bucketOrdinalSql(groupBy)} AS bucket, ${aggregates}
      ${this.validMessagesFrom(gte, lte, workspaceId)}
      GROUP BY 1
    `);
  }

  /**
   * Zero-fill a single-value bucketed aggregate into the ordered bucket list,
   * reconstructing each row's key from its ordinal and sorting by date - the
   * same shape the old bucketCounts and distinct-user passes returned.
   */
  private zeroFillSingle(
    rows: { bucket: bigint; value: number }[],
    timeBuckets: string[],
    groupBy: 'day' | 'hour',
  ): { date: string; value: number }[] {
    const byKey = new Map<string, number>();
    for (const row of rows) {
      byKey.set(this.bucketKeyFromOrdinal(Number(row.bucket), groupBy), row.value);
    }
    return timeBuckets
      .map(date => ({ date, value: byKey.get(date) ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
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
   * Normalize a date filter (single Date or a {gte,lte} range) into a Prisma date condition.
   */
  private toDateCondition(dateFilter: Date | { gte: Date; lte?: Date }): { gte: Date; lte?: Date } {
    return typeof dateFilter === 'object' && 'gte' in dateFilter ? dateFilter : { gte: dateFilter };
  }

  private getDateRange(dateCondition: { gte: Date; lte?: Date }): { startDate: Date; endDate: Date } {
    return { startDate: dateCondition.gte, endDate: dateCondition.lte ?? new Date() };
  }

  /**
   * Resolve the common analytics scope for a request in one place: the required
   * workspace id, the normalized date condition, its [startDate, endDate] range,
   * and the ISO [gte, lte] string bounds. Replaces the per-method prelude that
   * recomputed these from getDateFilter / requireWorkspaceId / toDateCondition.
   */
  private resolveScope(filters: AnalyticsFilters): {
    workspaceId: string;
    dateCondition: { gte: Date; lte?: Date };
    startDate: Date;
    endDate: Date;
    gte: string | null;
    lte: string | null;
  } {
    const dateFilter = getDateFilter(filters);
    const workspaceId = this.requireWorkspaceId(filters.workspaceId);
    const dateCondition = this.toDateCondition(dateFilter);
    const { startDate, endDate } = this.getDateRange(dateCondition);
    const { gte, lte } = this.toIsoBounds(dateCondition);
    return { workspaceId, dateCondition, startDate, endDate, gte, lte };
  }

  /**
   * Get workflow metrics bucketed by workflowType and status
   */
  async getWorkflowMetrics(filters: AnalyticsFilters) {
    const { workspaceId, dateCondition } = this.resolveScope(filters);

    const groupedData = await this.prisma.workflow.groupBy({
      by: ['workflowType', 'status'],
      where: {
        createdAt: dateCondition,
        NOT: { workflowType: 'Automations' },
        workspaceId
      },
      _count: {
        id: true
      }
    });

    return groupedData;
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
        workspaceId: scopedWorkspaceId
      },
      _count: {
        status: true,
      },
    });

    // Get total user count
    const totalUsers = await this.prisma.userPresence.count({
      where: {
        workspaceId: scopedWorkspaceId
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
    const { workspaceId, gte, lte } = this.resolveScope(filters);

    // Aggregate entirely in Postgres: the valid-message set is a CTE that the
    // attachment count JOINs against, so no message-id list is round-tripped
    // through Node.
    const [{ count }] = await this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      WITH valid_messages AS (
        SELECT m."messageId"
        ${this.validMessagesFrom(gte, lte, workspaceId)}
      )
      SELECT COUNT(*)::int AS count
      ${this.chatAttachmentsJoin(workspaceId)}
    `);

    return count;
  }

  /**
   * FROM/WHERE fragment for chat file attachments belonging to the caller's
   * `valid_messages` CTE. Callers MUST define a `valid_messages` CTE exposing a
   * `"messageId"` column. Replaces the old `entityId = ANY($ids)` round-trip
   * with a JOIN so the message set never leaves Postgres.
   */
  private chatAttachmentsJoin(workspaceId: string): Prisma.Sql {
    return Prisma.sql`
      FROM "public"."message_attachments" a
      INNER JOIN valid_messages vm ON vm."messageId" = a."entityId"
      WHERE a."entityType" = ${AttachmentEntityType.CHAT}
        AND a."workspaceId" = ${workspaceId}
        AND a."createdBy" NOT IN ('Unified Alerts', 'system')
    `;
  }

  /**
   * Get messages exchanged time-series data using optimized Prisma ORM aggregation
   * Fetches all messages within date range and processes aggregation in application memory
   */
  async getMessagesExchanged(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number; channelMessages: number; dmMessages: number; groupDmMessages: number }[]> {
    const { workspaceId, startDate, endDate, gte, lte } = this.resolveScope(filters);

    // Per-bucket total plus per-scope breakdown, aggregated in Postgres. Rows in
    // scopes other than the three tracked ones still count toward `value`
    // (COUNT(*)) but not the breakdown, matching the old Node reduction exactly.
    const rows = await this.bucketedOverValidMessages<{
      bucket: bigint; value: number; channel: number; dm: number; groupdm: number;
    }>(
      gte, lte, workspaceId, groupBy,
      Prisma.sql`
        COUNT(*)::int AS value,
        COUNT(*) FILTER (WHERE ch."scopeType" = ${ChannelScopeType.DEFAULT})::int AS channel,
        COUNT(*) FILTER (WHERE ch."scopeType" = ${ChannelScopeType.DM})::int AS dm,
        COUNT(*) FILTER (WHERE ch."scopeType" = ${ChannelScopeType.GROUP_DM})::int AS groupdm
      `,
    );

    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);

    const byKey = new Map<string, { value: number; channel: number; dm: number; groupDm: number }>();
    for (const row of rows) {
      byKey.set(this.bucketKeyFromOrdinal(Number(row.bucket), groupBy), {
        value: row.value, channel: row.channel, dm: row.dm, groupDm: row.groupdm,
      });
    }

    return timeBuckets
      .map(date => {
        const bucket = byKey.get(date);
        return {
          date,
          value: bucket?.value ?? 0,
          channelMessages: bucket?.channel ?? 0,
          dmMessages: bucket?.dm ?? 0,
          groupDmMessages: bucket?.groupDm ?? 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
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
   * Pick the hourly or daily bucket generator for the requested granularity.
   */
  private generateTimeBuckets(groupBy: 'day' | 'hour', startDate: Date, endDate: Date): string[] {
    return groupBy === 'hour'
      ? this.generateHourlyTimeBuckets(startDate, endDate)
      : this.generateDailyTimeBuckets(startDate, endDate);
  }

  /**
   * Get active users with both aggregate and time-series data in single call
   */
  async getActiveUsersWithChart(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{
    uniqueUsers: number;
    timeSeries: { date: string; value: number }[];
  }> {
    const { workspaceId, startDate, endDate, gte, lte } = this.resolveScope(filters);

    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);

    // One scan serves both the per-bucket distinct-user series AND the period
    // total. Every activity source (messages, reactions, attachments, tickets,
    // ticket activities, canvases, canvas participants) is UNION ALL'd into a
    // single (user_id, bucket) set; GROUP BY ROLLUP(bucket) then returns one
    // COUNT(DISTINCT user_id) row per bucket plus a grand-total row (flagged by
    // GROUPING(bucket) = 1). This replaces 7 unbounded findMany calls that
    // materialized every activity row in Node plus two in-memory passes - a
    // per-bucket Set map and a whole-period Set (#9, #10).
    const rows = await this.prisma.$queryRaw<{ is_total: number; bucket: bigint | null; value: number }[]>(
      this.activeUsersActivitySql(gte, lte, workspaceId, groupBy),
    );

    const perBucket: { bucket: bigint; value: number }[] = [];
    let uniqueUsers = 0;
    for (const row of rows) {
      if (row.is_total === 1) {
        uniqueUsers = Number(row.value);
      } else if (row.bucket !== null) {
        perBucket.push({ bucket: row.bucket, value: Number(row.value) });
      }
    }

    return {
      uniqueUsers,
      timeSeries: this.zeroFillSingle(perBucket, timeBuckets, groupBy),
    };
  }

  /**
   * Inclusive date bounds for an arbitrary timestamp column, emitted as plain
   * sargable comparisons - the same shape validMessagesFrom uses for messages.
   * A missing bound emits no clause, matching the old Prisma `createdAt: {}`
   * ("all time") behaviour for the non-message activity sources.
   */
  private dateBoundsSql(column: Prisma.Sql, gte: string | null, lte: string | null): Prisma.Sql {
    const gteClause = gte ? Prisma.sql`AND ${column} >= ${gte}::timestamp` : Prisma.empty;
    const lteClause = lte ? Prisma.sql`AND ${column} <= ${lte}::timestamp` : Prisma.empty;
    return Prisma.sql`${gteClause} ${lteClause}`;
  }

  /**
   * The active-users activity set as a single UNION ALL over every source that
   * counts as "activity", aggregated to distinct users per bucket (plus the
   * grand total via ROLLUP) entirely in Postgres. Each member reproduces the
   * exact tenant scoping the old per-source findMany calls used:
   *   - messages           : validMessagesFrom (workspace + valid-message rules)
   *   - reactions          : workspaceId + userId IN (workspace USER members)
   *   - message attachments: workspaceId
   *   - tickets            : workspaceId
   *   - ticket activities  : workspaceId (denormalized tenant key)
   *   - canvases           : createdBy IN (workspace USER members)
   *   - canvas participants: workspaceId + userId IN (workspace USER members)
   * COUNT(DISTINCT) ignores NULL user ids, matching the old null-id skip.
   */
  private activeUsersActivitySql(
    gte: string | null,
    lte: string | null,
    workspaceId: string,
    groupBy: 'day' | 'hour',
  ): Prisma.Sql {
    // USER-type members of the workspace; mirrors getUsersId()'s `userId IN (...)`.
    const workspaceUsers = Prisma.sql`
      SELECT u."id" FROM "public"."users" u
      WHERE u."userType" = 'USER' AND u."workspaceId" = ${workspaceId}
    `;
    const bucketOf = (column: Prisma.Sql) => this.bucketOrdinalSql(groupBy, column);

    return Prisma.sql`
      WITH activity AS (
        SELECT m."senderId" AS user_id, ${bucketOf(Prisma.sql`m."createdAt"`)} AS bucket
        ${this.validMessagesFrom(gte, lte, workspaceId)}

        UNION ALL
        SELECT r."userId", ${bucketOf(Prisma.sql`r."createdAt"`)}
        FROM "public"."reactions" r
        WHERE r."workspaceId" = ${workspaceId}
          AND r."userId" IN (${workspaceUsers})
          ${this.dateBoundsSql(Prisma.sql`r."createdAt"`, gte, lte)}

        UNION ALL
        SELECT a."createdBy", ${bucketOf(Prisma.sql`a."createdAt"`)}
        FROM "public"."message_attachments" a
        WHERE a."workspaceId" = ${workspaceId}
          ${this.dateBoundsSql(Prisma.sql`a."createdAt"`, gte, lte)}

        UNION ALL
        SELECT t."createdBy", ${bucketOf(Prisma.sql`t."createdAt"`)}
        FROM "public"."tickets" t
        WHERE t."workspaceId" = ${workspaceId}
          ${this.dateBoundsSql(Prisma.sql`t."createdAt"`, gte, lte)}

        UNION ALL
        SELECT ta."updatedBy", ${bucketOf(Prisma.sql`ta."timestamp"`)}
        FROM "public"."ticket_activities" ta
        WHERE ta."workspaceId" = ${workspaceId}
          ${this.dateBoundsSql(Prisma.sql`ta."timestamp"`, gte, lte)}

        UNION ALL
        SELECT cv."createdBy", ${bucketOf(Prisma.sql`cv."createdAt"`)}
        FROM "public"."canvases" cv
        WHERE cv."workspaceId" = ${workspaceId}
          AND cv."createdBy" IN (${workspaceUsers})
          ${this.dateBoundsSql(Prisma.sql`cv."createdAt"`, gte, lte)}

        UNION ALL
        SELECT cp."userId", ${bucketOf(Prisma.sql`cp."updatedAt"`)}
        FROM "public"."canvas_participants" cp
        WHERE cp."workspaceId" = ${workspaceId}
          AND cp."userId" IN (${workspaceUsers})
          ${this.dateBoundsSql(Prisma.sql`cp."updatedAt"`, gte, lte)}
      )
      SELECT
        GROUPING(bucket) AS is_total,
        bucket,
        COUNT(DISTINCT user_id)::int AS value
      FROM activity
      WHERE user_id IS NOT NULL
      GROUP BY ROLLUP(bucket)
    `;
  }

  /**
   * Get active channels aggregate count (efficient database query)
   * Returns unique channels that had activity based on messages over the entire period
   * Uses the same logic as the time-series to ensure consistency
   */
  async getActiveChannels(filters: AnalyticsFilters): Promise<number> {
    const { workspaceId, gte, lte } = this.resolveScope(filters);

    // Count the distinct DEFAULT-scope channels the valid messages belong to
    // directly in Postgres (COUNT DISTINCT) instead of building a Set in Node.
    const [{ count }] = await this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT c."channelId")::int AS count
      ${this.validMessagesFrom(gte, lte, workspaceId)}
        AND ch."scopeType" = ${ChannelScopeType.DEFAULT}
    `);

    return count;
  }

  /**
   * Get active channels time-series data
   */
  async getActiveChannelsTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const { workspaceId, startDate, endDate, gte, lte } = this.resolveScope(filters);

    // Distinct DEFAULT-scope channels active per bucket, counted in Postgres
    // (COUNT(DISTINCT ...) FILTER) instead of building a per-bucket Set in Node.
    const rows = await this.bucketedOverValidMessages<{ bucket: bigint; value: number }>(
      gte, lte, workspaceId, groupBy,
      Prisma.sql`COUNT(DISTINCT c."channelId") FILTER (WHERE ch."scopeType" = ${ChannelScopeType.DEFAULT})::int AS value`,
    );

    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);
    return this.zeroFillSingle(rows, timeBuckets, groupBy);
  }

  /**
   * Get users onboarded count
   * Counts the number of users who were onboarded (created in user_presence table) in the selected time period
   */
  async getUsersOnboarded(filters: AnalyticsFilters): Promise<number> {
    const { workspaceId, dateCondition } = this.resolveScope(filters);

    // Count users onboarded in the selected time period
    const usersOnboardedCount = await this.prisma.userPresence.count({
      where: {
        createdAt: dateCondition,
        workspaceId
      }
    });

    return usersOnboardedCount;
  }

  /**
   * Get users onboarded time-series data
   */
  async getUsersOnboardedTimeSeries(filters: AnalyticsFilters): Promise<{ date: string; value: number }[]> {
    const { workspaceId, dateCondition, startDate, endDate } = this.resolveScope(filters);

    // Get user presence records
    const userPresenceRecords = await this.prisma.userPresence.findMany({
      where: { createdAt: dateCondition, workspaceId },
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
    const { gte, lte } = this.toIsoBounds({ gte: startOfTodayUTC, lte: now });

    // Count today's valid messages in Postgres instead of shipping every row to
    // Node just to read `.length`.
    const [{ count }] = await this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      ${this.validMessagesFrom(gte, lte, scopedWorkspaceId)}
    `);

    return count;
  }

  /**
   * Get messages today time-series data (hourly breakdown for today)
   */
  async getMessagesTodayTimeSeries(workspaceId?: string): Promise<{ date: string; value: number }[]> {
    const scopedWorkspaceId = this.requireWorkspaceId(workspaceId);
    const { startOfTodayUTC, now } = this.getIstDayBounds();
    const { gte, lte } = this.toIsoBounds({ gte: startOfTodayUTC, lte: now });

    // Hourly counts bucketed in Postgres; only non-empty hours come back.
    const rows = await this.bucketedOverValidMessages<{ bucket: bigint; value: number }>(
      gte, lte, scopedWorkspaceId, 'hour', Prisma.sql`COUNT(*)::int AS value`,
    );

    const timeBuckets = this.generateHourlyTimeBuckets(startOfTodayUTC, now);
    return this.zeroFillSingle(rows, timeBuckets, 'hour');
  }

  /**
   * Get number of tickets created
   * Counts the number of tickets created in the selected time period
   * Only counts tickets created by (userType: 'USER')
   */
  async getNumberOfTickets(filters: AnalyticsFilters): Promise<number> {
    const { workspaceId, dateCondition } = this.resolveScope(filters);

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
    const { workspaceId, dateCondition, startDate, endDate } = this.resolveScope(filters);

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
    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);

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
    const { workspaceId, dateCondition } = this.resolveScope(filters);

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
    const { workspaceId, dateCondition, startDate, endDate } = this.resolveScope(filters);

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
    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);

    return this.bucketCounts(
      canvases,
      timeBuckets,
      canvas => canvas.lastEditedAt ? this.getBucketKey(canvas.lastEditedAt, groupBy) : null,
    );
  }

  /**
   * Duration in seconds of a call that qualifies for analytics - it has an end
   * time and lasted longer than MIN_CALL_DURATION_SECONDS - or null when the
   * call does not qualify. The single place the 60s rule and the
   * (endedAt - startedAt) arithmetic live; every call metric goes through it.
   */
  private qualifyingDurationSeconds(call: { startedAt: Date; endedAt: Date | null }): number | null {
    if (!call.endedAt) return null;
    const durationSeconds = (call.endedAt.getTime() - call.startedAt.getTime()) / 1000;
    return durationSeconds > MIN_CALL_DURATION_SECONDS ? durationSeconds : null;
  }

  /**
   * Single fetch + qualify path for every call metric. Loads the calls in the
   * date range once, keeps only those lasting more than 60 seconds, and carries
   * each qualifying call's duration and recording flag so callers never re-run
   * the query or recompute the threshold.
   * Calls and recordings live in the same table - HEADLESS calls are note taker
   * recordings, every other call type is a regular call.
   */
  private async getValidCalls(filters: AnalyticsFilters): Promise<{
    validCalls: { startedAt: Date; durationSeconds: number; isRecording: boolean }[];
    dateCondition: { gte: Date; lte?: Date };
  }> {
    const { workspaceId, dateCondition } = this.resolveScope(filters);
    const userIds = await this.getUsersId(workspaceId);

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

    // Keep only calls longer than 60s, carrying the qualifying duration so no
    // caller recomputes (endedAt - startedAt) or re-applies the threshold.
    const validCalls = calls.flatMap(call => {
      const durationSeconds = this.qualifyingDurationSeconds(call);
      if (durationSeconds === null) return [];
      return [{
        startedAt: call.startedAt,
        durationSeconds,
        isRecording: call.callType === CallType.HEADLESS,
      }];
    });

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
    const { startDate, endDate } = this.getDateRange(dateCondition);

    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);

    // Bucket regular calls and recordings separately through the shared
    // bucketCounts helper, then zip the two series together by date. Both series
    // are built from the same timeBuckets, so their dates line up 1:1.
    const bucketByStart = (call: { startedAt: Date }) => this.getBucketKey(call.startedAt, groupBy);
    const callSeries = this.bucketCounts(validCalls.filter(call => !call.isRecording), timeBuckets, bucketByStart);
    const recordingSeries = this.bucketCounts(validCalls.filter(call => call.isRecording), timeBuckets, bucketByStart);

    const recordingsByDate = new Map(recordingSeries.map(point => [point.date, point.value]));
    return callSeries.map(point => ({
      date: point.date,
      calls: point.value,
      recordings: recordingsByDate.get(point.date) ?? 0,
    }));
  }

  /**
   * Get total duration of calls in the selected time period (in minutes)
   * Only counts calls that lasted more than 60 seconds
   */
  async getTotalCallsDuration(filters: AnalyticsFilters): Promise<number> {
    const { validCalls } = await this.getValidCalls(filters);

    // Sum the qualifying durations (already filtered to >60s) and return the
    // total in minutes, rounded to 1 decimal place.
    const totalDurationSeconds = validCalls.reduce((sum, call) => sum + call.durationSeconds, 0);

    return Math.round((totalDurationSeconds / 60) * 10) / 10;
  }

  /**
   * Get total duration of calls time-series data (in minutes per day)
   * Only counts calls that lasted more than 60 seconds
   */
  async getTotalCallsDurationTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const { validCalls, dateCondition } = await this.getValidCalls(filters);
    const { startDate, endDate } = this.getDateRange(dateCondition);

    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);

    // Sum qualifying call durations (seconds) per bucket, then convert to minutes
    const durationSecondsSeries = this.bucketCounts(
      validCalls,
      timeBuckets,
      call => this.getBucketKey(call.startedAt, groupBy),
      call => call.durationSeconds,
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
    const { workspaceId, gte, lte } = this.resolveScope(filters);

    // Group + rank + limit in Postgres. Joining `users` with userType = 'USER'
    // preserves the "real users only, excludes bots" semantics the previous
    // in-memory version enforced via getUsersId(). A stable id tiebreaker keeps
    // the ranking deterministic across equal message counts.
    return this.prisma.$queryRaw<{ userId: string; userName: string; messageCount: number }[]>(Prisma.sql`
      WITH valid_messages AS (
        SELECT m."senderId"
        ${this.validMessagesFrom(gte, lte, workspaceId)}
      )
      SELECT
        u."id" AS "userId",
        u."name" AS "userName",
        COUNT(*)::int AS "messageCount"
      FROM valid_messages vm
      INNER JOIN "public"."users" u
        ON u."id" = vm."senderId"
        AND u."userType" = ${UserType.USER}
        AND u."workspaceId" = ${workspaceId}
      GROUP BY u."id", u."name"
      ORDER BY "messageCount" DESC, u."id" ASC
      LIMIT ${limit}
    `);
  }

  /**
   * Get files shared time-series data
   */
  async getFilesSharedTimeSeries(filters: AnalyticsFilters, groupBy: 'day' | 'hour'): Promise<{ date: string; value: number }[]> {
    const { workspaceId, startDate, endDate, gte, lte } = this.resolveScope(filters);

    // Get file attachments for valid (non-migrated) messages only, joining the
    // valid-message set as a CTE instead of round-tripping message ids.
    const attachments = await this.prisma.$queryRaw<{ createdAt: Date }[]>(Prisma.sql`
      WITH valid_messages AS (
        SELECT m."messageId"
        ${this.validMessagesFrom(gte, lte, workspaceId)}
      )
      SELECT a."createdAt"
      ${this.chatAttachmentsJoin(workspaceId)}
    `);

    // Generate time buckets based on groupBy
    const timeBuckets = this.generateTimeBuckets(groupBy, startDate, endDate);

    return this.bucketCounts(
      attachments,
      timeBuckets,
      attachment => this.getBucketKey(attachment.createdAt, groupBy),
    );
  }

}
