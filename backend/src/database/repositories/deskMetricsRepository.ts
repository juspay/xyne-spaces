import { Prisma, TicketStatusV2 } from '@prisma/client';
import { DatabaseClient, readReplicaDb } from '../client';
import { DeskMetricsResponse, DeskMetricsTicketRow } from '@xyne/shared';
import { logger } from '@/utils/logger';

/**
 * Desk metrics — computed from ticket_activities (scoped by the denormalized
 * channelId + timestamp index). Tickets are only PK-joined for display
 * attributes (xyneId, title, current stage) and the stageCounts snapshot.
 *
 * Forward-only by design: TICKET_CREATED / EMAIL_SENT / CSAT_RECEIVED exist
 * since the desk-metrics deploy, so older ranges report partial data.
 *
 * Stage-change activities exist in two shapes and both must be matched:
 *  - manual UI moves:   activityType STATUS,     value {field:'stageName', oldValue, newValue}
 *  - server-side moves: activityType STAGE_NAME, value {field:'stageName', oldValue, newValue, source}
 *
 * FRT stop is controlled by frtStageNames (string[]). Use the sentinel
 * "__emailReply" in the array to include email-reply arm (default when empty).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export class DeskMetricsRepository {
  private getDbInstance() {
    const replica = readReplicaDb;
    if (replica) {
      logger.info('[DeskMetrics] Using read replica database');
      return replica;
    }
    return DatabaseClient.getInstance();
  }

  /**
   * Extends the shared analytics presets ('today'/'7d'/'30d'/'90d'/custom)
   * with the ranges the reused dashboard TimeRangePicker emits
   * ('1h'/'24h'/'1y'/'all').
   */
  private resolveRange(timeRange: string | undefined): { gte: Date; lte: Date } {
    const now = new Date();
    const parts = timeRange?.split('_');
    if (parts?.length === 2) {
      const fromMs = Number(parts[0]);
      const toMs = Number(parts[1]);
      if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
        return { gte: new Date(fromMs), lte: new Date(toMs) };
      }
    }
    return { gte: new Date(now.getTime() - 7 * DAY_MS), lte: now };
  }

  async getMetrics(params: {
    channelId: string;
    timeRange?: string;
    frtStageNames: string[];
    assigneeId?: string | null;
    customFieldFilter?: { keys: string[]; perKeyFilters?: Record<string, { values?: string[]; textTerms?: string[] }> };
  }): Promise<DeskMetricsResponse> {
    const { channelId, frtStageNames, assigneeId, customFieldFilter } = params;
    const db = this.getDbInstance();
    const { gte, lte } = this.resolveRange(params.timeRange);

    // "__emailReply" sentinel: include email-reply arm in FRT stop.
    // When frtStageNames is empty (legacy), treat as email-only (backward compat).
    const includeEmailReply =
      frtStageNames.length === 0 || frtStageNames.includes('__emailReply');
    const stageNames = frtStageNames.filter(n => n !== '__emailReply');

    const stageEntryPredicate = (names: string[]): Prisma.Sql =>
      Prisma.sql`(
        ((ta."activityType" = 'STATUS' AND ta.value->>'field' = 'stageName') OR ta."activityType" = 'STAGE_NAME')
        AND ta.value->>'newValue' IN (${Prisma.join(names)})
      )`;

    const frtStopSql = (): Prisma.Sql => {
      const emailArm = Prisma.sql`
        (SELECT MIN(ta."timestamp") FROM "public"."ticket_activities" ta
          WHERE ta."ticketId" = c."ticketId" AND ta."activityType" = 'EMAIL_SENT'
            AND ta."timestamp" > c.created_at)`;
      if (!includeEmailReply && stageNames.length === 0) return Prisma.sql`NULL::timestamptz`;
      if (!includeEmailReply) {
        return Prisma.sql`
          (SELECT MIN(ta."timestamp") FROM "public"."ticket_activities" ta
            WHERE ta."ticketId" = c."ticketId" AND ${stageEntryPredicate(stageNames)}
              AND ta."timestamp" > c.created_at)`;
      }
      if (stageNames.length === 0) return emailArm;
      return Prisma.sql`LEAST(${emailArm},
        (SELECT MIN(ta."timestamp") FROM "public"."ticket_activities" ta
          WHERE ta."ticketId" = c."ticketId" AND ${stageEntryPredicate(stageNames)}
            AND ta."timestamp" > c.created_at))`;
    };

    const resolvedStageNames = await this.resolvedStageNamesForChannel(channelId);
    const resolvedPredicate = ((): Prisma.Sql => {
      const statusArm = Prisma.sql`(ta."activityType" = 'STATUS' AND ta.value->>'field' = 'statusV2' AND ta.value->>'newValue' = ${TicketStatusV2.COMPLETED})`;
      if (resolvedStageNames.length === 0) return statusArm;
      return Prisma.sql`(${statusArm} OR ${stageEntryPredicate(resolvedStageNames)})`;
    })();

    const resolvedAtSql = Prisma.sql`
      (SELECT MAX(ta."timestamp") FROM "public"."ticket_activities" ta
        WHERE ta."ticketId" = c."ticketId" AND ${resolvedPredicate})`;

    // Cohort: tickets created in range. Optionally filtered by assignee and/or custom field.
    const assigneeJoin = assigneeId
      ? Prisma.sql`JOIN "public"."tickets" tf ON tf.id = ta."ticketId" AND tf."assignedTo" = ${assigneeId}`
      : Prisma.sql``;

    let customFieldExists: Prisma.Sql = Prisma.sql``;
    if (customFieldFilter && customFieldFilter.keys.length > 0) {
      // Value conditions — OR across keys that have values/terms selected
      const valueConditions: Prisma.Sql[] = [];
      for (const key of customFieldFilter.keys) {
        const kf = customFieldFilter.perKeyFilters?.[key];
        const hasValues = kf?.values && kf.values.length > 0;
        const hasTerms = kf?.textTerms && kf.textTerms.length > 0;
        if (!hasValues && !hasTerms) continue;
        const fieldNameMatch = Prisma.sql`COALESCE(gf."fieldName", ff."fieldName") = ${key}`;
        const fieldCol = Prisma.sql`COALESCE(fev."actualFieldValue"#>>'{}', NULLIF(fev."fieldValue", ''))`;
        let valueCondition: Prisma.Sql;
        if (hasTerms) {
          // OR across all text terms within this field
          valueCondition = kf!.textTerms!
            .map(t => Prisma.sql`${fieldCol} ILIKE ${'%' + t + '%'}`)
            .reduce((or, c, i) => i === 0 ? c : Prisma.sql`${or} OR ${c}`);
        } else {
          valueCondition = Prisma.sql`${fieldCol} IN (${Prisma.join(kf!.values!)})`;
        }
        valueConditions.push(Prisma.sql`(${fieldNameMatch} AND (${valueCondition}))`);
      }
      // Single EXISTS: field-level pre-filter (fieldName IN keys) + optional value-level AND
      const valueClause = valueConditions.length > 0
        ? Prisma.sql`AND (${valueConditions.reduce((or, c, i) => i === 0 ? c : Prisma.sql`${or} OR ${c}`)})`
        : Prisma.sql``;
      customFieldExists = Prisma.sql`AND EXISTS (
          SELECT 1 FROM "public"."form_entity_values" fev
          LEFT JOIN "public"."global_fields" gf ON gf.id = fev."fieldId"
          LEFT JOIN "public"."form_fields" ff ON ff.id = fev."fieldId"
          WHERE fev."entityId" = ta."ticketId"
            AND fev."entityType" = 'TICKET'
            AND COALESCE(gf."fieldName", ff."fieldName") IN (${Prisma.join(customFieldFilter.keys)})
            ${valueClause}
        )`;
    }

    const cohortCte = Prisma.sql`
      cohort AS (
        SELECT ta."ticketId", ta."timestamp" AS created_at
        FROM "public"."ticket_activities" ta
        ${assigneeJoin}
        WHERE ta."channelId" = ${channelId}
          AND ta."activityType" = 'TICKET_CREATED'
          AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
          ${customFieldExists}
      )`;

    const frtStop = frtStopSql();
    const [aggregates, tickets, emailRepliesInRange, stageCounts, priority, csat, trend] =
      await Promise.all([
        this.frtRtAggregates(db, cohortCte, frtStop, resolvedAtSql),
        this.ticketRows(db, cohortCte, frtStop, resolvedAtSql),
        this.emailRepliesCount(db, channelId, gte, lte, assigneeId, customFieldExists),
        this.stageCounts(db, cohortCte),
        this.priorityBreakdown(db, cohortCte),
        this.csatStats(db, channelId, gte, lte, assigneeId, customFieldExists),
        this.trendByDay(db, channelId, gte, lte, resolvedPredicate, assigneeId, customFieldExists),
      ]);

    return {
      range: { from: gte.toISOString(), to: lte.toISOString() },
      frt: { avgSeconds: aggregates.avgFrt, respondedTickets: aggregates.responded },
      rt: { avgSeconds: aggregates.avgRt, resolvedTickets: aggregates.resolved },
      csat,
      counts: {
        openedInRange: aggregates.opened,
        emailRepliesInRange,
        stageCounts,
      },
      priority,
      trend,
      tickets,
    };
  }

  private async resolvedStageNamesForChannel(channelId: string): Promise<string[]> {
    const db = this.getDbInstance();
    const boardId = await this.boardIdForChannel(channelId);
    if (!boardId) return [];
    const stages = await db.stage.findMany({
      where: { boardId, defaultTicketStatusV2: TicketStatusV2.COMPLETED },
      select: { name: true },
    });
    return stages.map(s => s.name);
  }

  private async boardIdForChannel(channelId: string): Promise<string | null> {
    const db = this.getDbInstance();
    const pref = await db.emailChannelPreference.findUnique({
      where: { channelId },
      select: { boardId: true },
    });
    if (pref?.boardId) return pref.boardId;
    const ticket = await db.ticket.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
      select: { boardId: true },
    });
    return ticket?.boardId ?? null;
  }

  private async frtRtAggregates(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql,
    frtStopSql: Prisma.Sql,
    resolvedAtSql: Prisma.Sql,
  ): Promise<{
    opened: number;
    avgFrt: number | null;
    responded: number;
    avgRt: number | null;
    resolved: number;
  }> {
    const rows = await db.$queryRaw<
      Array<{
        opened: number;
        avg_frt: number | null;
        responded: number;
        avg_rt: number | null;
        resolved: number;
      }>
    >(
      Prisma.sql`
        WITH ${cohortCte},
        per_ticket AS (
          SELECT c.created_at, ${frtStopSql} AS stop_at, ${resolvedAtSql} AS resolved_at
          FROM cohort c
        )
        SELECT
          COUNT(*)::int AS opened,
          AVG(EXTRACT(EPOCH FROM (stop_at - created_at)))
            FILTER (WHERE stop_at IS NOT NULL AND stop_at >= created_at)::float AS avg_frt,
          COUNT(*) FILTER (WHERE stop_at IS NOT NULL AND stop_at >= created_at)::int AS responded,
          AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))
            FILTER (WHERE resolved_at IS NOT NULL AND resolved_at >= created_at)::float AS avg_rt,
          COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at >= created_at)::int AS resolved
        FROM per_ticket
      `,
    );
    const r = rows[0];
    return {
      opened: r?.opened ?? 0,
      avgFrt: r?.avg_frt ?? null,
      responded: r?.responded ?? 0,
      avgRt: r?.avg_rt ?? null,
      resolved: r?.resolved ?? 0,
    };
  }

  private async ticketRows(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql,
    frtStopSql: Prisma.Sql,
    resolvedAtSql: Prisma.Sql,
  ): Promise<DeskMetricsTicketRow[]> {
    const rows = await db.$queryRaw<
      Array<{
        ticket_id: string;
        xyne_id: string | null;
        title: string | null;
        created_at: Date;
        priority: string;
        stage_name: string | null;
        status_v2: string;
        assignee_id: string | null;
        assignee_name: string | null;
        frt_seconds: number | null;
        rt_seconds: number | null;
        csat_value: { rating?: string; score?: number | string | null } | null;
        custom_fields: Record<string, string> | null;
      }>
    >(
      Prisma.sql`
        WITH ${cohortCte},
        deduped_fev AS (
          SELECT DISTINCT ON (fev."entityId", COALESCE(gf."fieldName", ff."fieldName"))
            fev."entityId" AS ticket_id,
            COALESCE(gf."fieldName", ff."fieldName") AS field_name,
            COALESCE(fev."actualFieldValue"#>>'{}', NULLIF(fev."fieldValue", '')) AS field_value
          FROM "public"."form_entity_values" fev
          LEFT JOIN "public"."global_fields" gf ON gf.id = fev."fieldId"
          LEFT JOIN "public"."form_fields" ff ON ff.id = fev."fieldId"
          WHERE fev."entityId" IN (SELECT "ticketId" FROM cohort)
            AND fev."entityType" = 'TICKET'
          ORDER BY fev."entityId", COALESCE(gf."fieldName", ff."fieldName"), fev."updatedAt" DESC, fev.id DESC
        ),
        form_vals AS (
          SELECT
            ticket_id,
            jsonb_object_agg(field_name, field_value)
              FILTER (WHERE field_name IS NOT NULL AND field_value IS NOT NULL) AS custom_fields
          FROM deduped_fev
          GROUP BY ticket_id
        )
        SELECT
          c."ticketId" AS ticket_id,
          t."xyneId" AS xyne_id,
          t.title,
          c.created_at,
          t.priority::text AS priority,
          t."stageName" AS stage_name,
          t."statusV2"::text AS status_v2,
          t."assignedTo" AS assignee_id,
          COALESCE(u."displayName", u.name) AS assignee_name,
          EXTRACT(EPOCH FROM (${frtStopSql} - c.created_at))::float AS frt_seconds,
          EXTRACT(EPOCH FROM (${resolvedAtSql} - c.created_at))::float AS rt_seconds,
          (SELECT ta.value FROM "public"."ticket_activities" ta
            WHERE ta."ticketId" = c."ticketId" AND ta."activityType" = 'CSAT_RECEIVED'
            ORDER BY ta."timestamp" DESC LIMIT 1) AS csat_value,
          fv.custom_fields
        FROM cohort c
        JOIN "public"."tickets" t ON t.id = c."ticketId"
        LEFT JOIN "public"."users" u ON u.id = t."assignedTo"
        LEFT JOIN form_vals fv ON fv.ticket_id = c."ticketId"
        ORDER BY c.created_at DESC
      `,
    );
    return rows.map(r => {
      const rawScore = r.csat_value?.score;
      const score = typeof rawScore === 'string' ? Number(rawScore) : rawScore;
      return {
        ticketId: r.ticket_id,
        xyneId: r.xyne_id,
        title: r.title,
        createdAt: r.created_at.getTime(),
        priority: r.priority,
        stageName: r.stage_name,
        statusV2: r.status_v2,
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_name,
        frtSeconds: r.frt_seconds !== null && r.frt_seconds >= 0 ? r.frt_seconds : null,
        rtSeconds: r.rt_seconds !== null && r.rt_seconds >= 0 ? r.rt_seconds : null,
        csatScore: typeof score === 'number' && Number.isFinite(score) ? score : null,
        csatRating: r.csat_value?.rating ?? null,
        customFields: r.custom_fields ?? null,
      };
    });
  }

  /** Count email replies sent in range, optionally scoped to tickets assigned to assigneeId and/or matching a custom field. */
  private async emailRepliesCount(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    channelId: string,
    gte: Date,
    lte: Date,
    assigneeId?: string | null,
    customFieldExists: Prisma.Sql = Prisma.sql``,
  ): Promise<number> {
    const assigneeFilter = assigneeId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "public"."tickets" t WHERE t.id = ta."ticketId" AND t."assignedTo" = ${assigneeId})`
      : Prisma.sql``;
    const rows = await db.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "public"."ticket_activities" ta
        WHERE ta."channelId" = ${channelId}
          AND ta."activityType" = 'EMAIL_SENT'
          AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
          ${assigneeFilter}
          ${customFieldExists}
      `,
    );
    return rows[0]?.count ?? 0;
  }

  /** Cohort-scoped: current stage of tickets created in the selected range. */
  private async stageCounts(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql,
  ): Promise<Array<{ stageName: string; count: number }>> {
    const rows = await db.$queryRaw<Array<{ stage_name: string; count: number }>>(
      Prisma.sql`
        WITH ${cohortCte}
        SELECT COALESCE(t."stageName", 'Unassigned') AS stage_name, COUNT(*)::int AS count
        FROM cohort c
        JOIN "public"."tickets" t ON t.id = c."ticketId"
        WHERE t."isArchived" = false
        GROUP BY t."stageName"
        ORDER BY count DESC
      `,
    );
    return rows.map(r => ({ stageName: r.stage_name, count: r.count }));
  }

  private async priorityBreakdown(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql,
  ): Promise<Array<{ priority: string; count: number }>> {
    const rows = await db.$queryRaw<Array<{ priority: string; count: number }>>(
      Prisma.sql`
        WITH ${cohortCte}
        SELECT t.priority::text AS priority, COUNT(*)::int AS count
        FROM cohort c
        JOIN "public"."tickets" t ON t.id = c."ticketId"
        GROUP BY t.priority
        ORDER BY count DESC
      `,
    );
    return rows;
  }

  private async csatStats(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    channelId: string,
    gte: Date,
    lte: Date,
    assigneeId?: string | null,
    customFieldExists: Prisma.Sql = Prisma.sql``,
  ): Promise<{ avgScore: number | null; good: number; bad: number }> {
    const assigneeFilter = assigneeId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "public"."tickets" t WHERE t.id = ta."ticketId" AND t."assignedTo" = ${assigneeId})`
      : Prisma.sql``;
    const rows = await db.$queryRaw<
      Array<{ avg_score: number | null; good: number; bad: number }>
    >(
      Prisma.sql`
        SELECT
          AVG(NULLIF(ta.value->>'score', '')::numeric)::float AS avg_score,
          COUNT(*) FILTER (WHERE ta.value->>'rating' = 'GOOD')::int AS good,
          COUNT(*) FILTER (WHERE ta.value->>'rating' = 'BAD')::int AS bad
        FROM "public"."ticket_activities" ta
        WHERE ta."channelId" = ${channelId}
          AND ta."activityType" = 'CSAT_RECEIVED'
          AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
          ${assigneeFilter}
          ${customFieldExists}
      `,
    );
    return {
      avgScore: rows[0]?.avg_score ?? null,
      good: rows[0]?.good ?? 0,
      bad: rows[0]?.bad ?? 0,
    };
  }

  private async trendByDay(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    channelId: string,
    gte: Date,
    lte: Date,
    resolvedPredicate: Prisma.Sql,
    assigneeId?: string | null,
    customFieldExists: Prisma.Sql = Prisma.sql``,
  ): Promise<Array<{ date: string; opened: number; closed: number }>> {
    const rangeDays = (lte.getTime() - gte.getTime()) / DAY_MS;
    const hourly = rangeDays <= 1;
    const bucketFn = hourly
      ? Prisma.sql`to_char(date_trunc('hour', (ta."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD HH24:00')`
      : Prisma.sql`to_char(date_trunc('day',  (ta."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;
    const bucketFnR = hourly
      ? Prisma.sql`to_char(date_trunc('hour', (r.first_resolved AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD HH24:00')`
      : Prisma.sql`to_char(date_trunc('day',  (r.first_resolved AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;

    const assigneeFilter = assigneeId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "public"."tickets" t WHERE t.id = ta."ticketId" AND t."assignedTo" = ${assigneeId})`
      : Prisma.sql``;

    const [openedRows, closedRows] = await Promise.all([
      db.$queryRaw<Array<{ day: string; count: number }>>(
        Prisma.sql`
          SELECT ${bucketFn} AS day, COUNT(*)::int AS count
          FROM "public"."ticket_activities" ta
          WHERE ta."channelId" = ${channelId}
            AND ta."activityType" = 'TICKET_CREATED'
            AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
            ${assigneeFilter}
            ${customFieldExists}
          GROUP BY 1
        `,
      ),
      db.$queryRaw<Array<{ day: string; count: number }>>(
        Prisma.sql`
          SELECT ${bucketFnR} AS day, COUNT(*)::int AS count
          FROM (
            SELECT ta."ticketId", MAX(ta."timestamp") AS first_resolved
            FROM "public"."ticket_activities" ta
            WHERE ta."channelId" = ${channelId} AND ${resolvedPredicate}
              ${assigneeFilter}
              ${customFieldExists}
            GROUP BY ta."ticketId"
          ) r
          WHERE r.first_resolved >= ${gte} AND r.first_resolved <= ${lte}
          GROUP BY 1
        `,
      ),
    ]);

    const opened = new Map(openedRows.map(r => [r.day, r.count]));
    const closed = new Map(closedRows.map(r => [r.day, r.count]));

    // Fill all buckets so the chart has no gaps
    const buckets: string[] = [];
    const HOUR_MS = 60 * 60 * 1000;
    const IST_TZ = 'Asia/Kolkata';
    const toISTDateStr = (ms: number): string =>
      new Date(ms).toLocaleDateString('en-CA', { timeZone: IST_TZ }); // → 'YYYY-MM-DD'
    const toISTHourStr = (ms: number): string => {
      const d = new Date(ms);
      const date = d.toLocaleDateString('en-CA', { timeZone: IST_TZ });
      const hour = d.toLocaleTimeString('en-GB', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit' }).slice(0, 2);
      return `${date} ${hour}:00`;
    };
    const floorToISTDay = (ms: number): number =>
      new Date(`${toISTDateStr(ms)}T00:00:00+05:30`).getTime();
    const floorToISTHour = (ms: number): number => {
      const d = new Date(ms);
      const date = d.toLocaleDateString('en-CA', { timeZone: IST_TZ });
      const hour = d.toLocaleTimeString('en-GB', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit' }).slice(0, 2);
      return new Date(`${date}T${hour}:00:00+05:30`).getTime();
    };

    if (hourly) {
      const startHour = floorToISTHour(gte.getTime());
      const endHour   = floorToISTHour(lte.getTime());
      for (let t = startHour; t <= endHour; t += HOUR_MS) {
        buckets.push(toISTHourStr(t));
      }
    } else {
      const startDay = floorToISTDay(gte.getTime());
      const endDay   = floorToISTDay(lte.getTime());
      for (let t = startDay; t <= endDay; t += DAY_MS) {
        buckets.push(toISTDateStr(t));
      }
    }

    return buckets.map(date => ({
      date,
      opened: opened.get(date) ?? 0,
      closed: closed.get(date) ?? 0,
    }));
  }
}

export const deskMetricsRepository = new DeskMetricsRepository();