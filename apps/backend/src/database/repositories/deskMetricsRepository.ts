import { Prisma } from '@prisma/client';
import { DatabaseClient, readReplicaDb } from '../client';
import {
  DeskMetricKey,
  DeskMetricsAgentRow,
  DeskMetricsAiCategoryCount,
  DeskMetricsAiSubCategoryCount,
  DeskMetricsCustomFieldBreakdown,
  DeskMetricsCustomFieldSummary,
  DeskMetricsDeskSummary,
  DeskMetricsPartial,
  DeskMetricsResponse,
  DeskMetricsTicketRow,
  TicketPriority,
  TicketStatusV2,
  UNCLASSIFIED_AI_CATEGORY,
} from '@xyne/shared';
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
const MAX_BREAKDOWN_VALUES_PER_FIELD = 25;

const activeTicketFilter = (assigneeIds: string[] = []): Prisma.Sql => {
  const assigneeCondition =
    assigneeIds.length > 0
      ? Prisma.sql`AND t."assignedTo" IN (${Prisma.join(assigneeIds)})`
      : Prisma.sql``;

  return Prisma.sql`AND EXISTS (
    SELECT 1
    FROM "public"."tickets" t
    WHERE t.id = ta."ticketId"
      AND t."isArchived" = false
      ${assigneeCondition}
  )`;
};

/** Everything both entry points need to describe one metrics run. */
export interface DeskMetricsQueryParams {
  channelId: string;
  timeRange?: string;
  frtStageNames: string[];
  assigneeIds: string[];
  stageNames: string[];
  priorities: TicketPriority[];
  userGroupIds: string[];
  tagValues: string[];
  aiCategories?: string[];
  aiSubCategories?: string[];
  customFieldFilter?: {
    keys: string[];
    perKeyFilters?: Record<string, { values?: string[]; textTerms?: string[] }>;
  };
}

/** Compiled SQL fragments for one run, produced once by buildContext. */
interface MetricsContext {
  db: ReturnType<DeskMetricsRepository['getDbInstance']>;
  channelId: string;
  gte: Date;
  lte: Date;
  assigneeIds: string[];
  cohortCte: Prisma.Sql;
  frtStop: Prisma.Sql;
  resolvedAtSql: Prisma.Sql;
  resolvedPredicate: Prisma.Sql;
  reopenedSql: Prisma.Sql;
  ticketScopeExists: Prisma.Sql;
}

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
   * Extends the shared analytics presets ('today'/'7d'/'30d'/custom)
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

  private async buildContext(params: DeskMetricsQueryParams): Promise<MetricsContext> {
    const {
      channelId,
      frtStageNames,
      assigneeIds,
      stageNames,
      priorities,
      userGroupIds,
      tagValues,
      customFieldFilter,
    } = params;
    const aiCategories = params.aiCategories ?? [];
    const aiSubCategories = params.aiSubCategories ?? [];
    const db = this.getDbInstance();
    const { gte, lte } = this.resolveRange(params.timeRange);

    // "__emailReply" sentinel: include email-reply arm in FRT stop.
    // When frtStageNames is empty (legacy), treat as email-only (backward compat).
    const includeEmailReply = frtStageNames.length === 0 || frtStageNames.includes('__emailReply');
    const frtStopStageNames = frtStageNames.filter((name) => name !== '__emailReply');

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
      if (!includeEmailReply && frtStopStageNames.length === 0)
        return Prisma.sql`NULL::timestamptz`;
      if (!includeEmailReply) {
        return Prisma.sql`
          (SELECT MIN(ta."timestamp") FROM "public"."ticket_activities" ta
            WHERE ta."ticketId" = c."ticketId" AND ${stageEntryPredicate(frtStopStageNames)}
              AND ta."timestamp" > c.created_at)`;
      }
      if (frtStopStageNames.length === 0) return emailArm;
      return Prisma.sql`LEAST(${emailArm},
        (SELECT MIN(ta."timestamp") FROM "public"."ticket_activities" ta
          WHERE ta."ticketId" = c."ticketId" AND ${stageEntryPredicate(frtStopStageNames)}
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

    const reopenedPredicate = Prisma.sql`(
      ta."activityType" = 'STATUS'
      AND ta.value->>'field' = 'statusV2'
      AND ta.value->>'oldValue' = ${TicketStatusV2.COMPLETED}
      AND ta.value->>'newValue' IN (${Prisma.join([
        TicketStatusV2.TODO,
        TicketStatusV2.STARTED,
        TicketStatusV2.PAUSED,
      ])})
    )`;
    const reopenedSql = Prisma.sql`EXISTS (
      SELECT 1
      FROM "public"."ticket_activities" ta
      WHERE ta."ticketId" = c."ticketId"
        AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
        AND ${reopenedPredicate}
    )`;

    // Cohort: active tickets created in range, optionally scoped by the selected filters.
    let customFieldExists: Prisma.Sql = Prisma.sql``;
    if (customFieldFilter && customFieldFilter.keys.length > 0) {
      // One EXISTS per field, AND'd together — values within a field are OR'd, different fields are AND'd
      const perKeyExists: Prisma.Sql[] = [];
      for (const key of customFieldFilter.keys) {
        const kf = customFieldFilter.perKeyFilters?.[key];
        const hasValues = kf?.values && kf.values.length > 0;
        const hasTerms = kf?.textTerms && kf.textTerms.length > 0;
        const fieldNameMatch = Prisma.sql`COALESCE(gf."fieldName", ff."fieldName") = ${key}`;
        const fieldCol = Prisma.sql`COALESCE(fev."actualFieldValue"#>>'{}', NULLIF(fev."fieldValue", ''))`;
        let valueCondition: Prisma.Sql | undefined;
        if (hasTerms) {
          valueCondition = kf!
            .textTerms!.map((t) => Prisma.sql`${fieldCol} ILIKE ${'%' + t + '%'}`)
            .reduce((or, c, i) => (i === 0 ? c : Prisma.sql`${or} OR ${c}`));
        } else if (hasValues) {
          valueCondition = Prisma.sql`(
            ${fieldCol} IN (${Prisma.join(kf!.values!)})
            OR (
              jsonb_typeof(fev."actualFieldValue") = 'array'
              AND jsonb_exists_any(
                fev."actualFieldValue",
                ARRAY[${Prisma.join(kf!.values!)}]::text[]
              )
            )
          )`;
        }
        perKeyExists.push(Prisma.sql`AND EXISTS (
          SELECT 1 FROM "public"."form_entity_values" fev
          LEFT JOIN "public"."global_fields" gf ON gf.id = fev."fieldId"
          LEFT JOIN "public"."form_fields" ff ON ff.id = fev."fieldId"
          WHERE fev."entityId" = ta."ticketId"
            AND fev."entityType" = 'TICKET'
            AND ${fieldNameMatch}
            ${valueCondition !== undefined ? Prisma.sql`AND (${valueCondition})` : Prisma.sql``}
        )`);
      }
      if (perKeyExists.length > 0) {
        customFieldExists = perKeyExists.reduce((acc, c) => Prisma.sql`${acc} ${c}`);
      }
    }

    // Tag filter: parse "category:tag" composite values (format used by GeneratedTagsSubmenu)
    const tagPairs = tagValues
      .map(v => { const i = v.indexOf(':'); return i === -1 ? null : { cat: v.slice(0, i), tag: v.slice(i + 1) }; })
      .filter((p): p is { cat: string; tag: string } => p !== null);

    // Shared fragment: resolves the latest email for a ticket's conversation.
    // Uses ORDER BY createdAt DESC, id DESC (clock-independent) so it works for
    // both inbound and outbound emails without depending on lastEmailAt equality.
    // Tags are read from the ticket's LATEST email only (matches Vespa mapper).
    const latestEmailId = (conversationIdCol: string) => Prisma.sql`(
      SELECT e2.id FROM "public"."emails" e2
      WHERE e2."conversationId" = ${Prisma.raw(conversationIdCol)}
      ORDER BY e2."createdAt" DESC, e2.id DESC
      LIMIT 1
    )`;

    const tagExists: Prisma.Sql =
      tagPairs.length > 0
        ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM "public"."tickets" ft
            JOIN "public"."emails" e ON e.id = ${latestEmailId('ft."conversationId"')}
            JOIN non_zero.tags tg
              ON tg."sourceId" = e.id AND tg."sourceType" = 'desk-email' AND tg."isDeleted" = false
              AND (${tagPairs
                .map(p => Prisma.sql`(tg."tagCategory" = ${p.cat} AND tg.tag = ${p.tag})`)
                .reduce((acc, cur) => Prisma.sql`${acc} OR ${cur}`)})
            WHERE ft.id = ta."ticketId"
          )`
        : Prisma.sql``;

    const ticketAttributeConditions: Prisma.Sql[] = [];
    if (stageNames.length > 0) {
      ticketAttributeConditions.push(
        Prisma.sql`filter_ticket."stageName" IN (${Prisma.join(stageNames)})`
      );
    }
    if (priorities.length > 0) {
      ticketAttributeConditions.push(
        Prisma.sql`filter_ticket.priority IN (${Prisma.join(priorities)})`
      );
    }
    if (userGroupIds.length > 0) {
      ticketAttributeConditions.push(
        Prisma.sql`filter_ticket."userGroupId" IN (${Prisma.join(userGroupIds)})`
      );
    }
    if (aiCategories.length > 0) {
      ticketAttributeConditions.push(
        Prisma.sql`filter_ticket."aiCategory" IN (${Prisma.join(aiCategories)})`
      );
    }
    if (aiSubCategories.length > 0) {
      ticketAttributeConditions.push(
        Prisma.sql`filter_ticket."aiSubCategory" IN (${Prisma.join(aiSubCategories)})`
      );
    }
    const ticketAttributeExists =
      ticketAttributeConditions.length > 0
        ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM "public"."tickets" filter_ticket
            WHERE filter_ticket.id = ta."ticketId"
              AND ${ticketAttributeConditions.reduce(
                (condition, next) => Prisma.sql`${condition} AND ${next}`
              )}
          )`
        : Prisma.sql``;
    const ticketScopeExists = Prisma.sql`${activeTicketFilter(
      assigneeIds
    )} ${ticketAttributeExists} ${customFieldExists} ${tagExists}`;

    const cohortCte = Prisma.sql`
      cohort AS (
        SELECT ta."ticketId", ta."timestamp" AS created_at
        FROM "public"."ticket_activities" ta
        WHERE ta."channelId" = ${channelId}
          AND ta."activityType" = 'TICKET_CREATED'
          AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
          ${ticketScopeExists}
      )`;


    return {
      db,
      channelId,
      gte,
      lte,
      assigneeIds,
      cohortCte,
      frtStop: frtStopSql(),
      resolvedAtSql,
      resolvedPredicate,
      reopenedSql,
      ticketScopeExists,
    };
  }

  /**
   * Dashboard payload — every metric, every cohort ticket row.
   */
  async getMetrics(params: DeskMetricsQueryParams): Promise<DeskMetricsResponse> {
    const ctx = await this.buildContext(params);
    const {
      db,
      channelId,
      gte,
      lte,
      assigneeIds,
      cohortCte,
      frtStop,
      resolvedAtSql,
      resolvedPredicate,
      reopenedSql,
      ticketScopeExists,
    } = ctx;

    const [
      aggregates,
      tickets,
      emailRepliesInRange,
      stageCounts,
      priority,
      csat,
      trend,
      agents,
      tagCategories,
      tagBreakdown,
    ] = await Promise.all([
      this.frtRtAggregates(db, cohortCte, frtStop, resolvedAtSql),
      this.ticketRows(db, cohortCte, frtStop, resolvedAtSql),
      this.emailRepliesCount(db, channelId, gte, lte, ticketScopeExists),
      this.stageCounts(db, cohortCte),
      this.priorityBreakdown(db, cohortCte),
      this.csatStats(db, channelId, gte, lte, ticketScopeExists),
      this.trendByDay(db, channelId, gte, lte, resolvedPredicate, ticketScopeExists),
      this.agentPerformance(
        db,
        cohortCte,
        frtStop,
        resolvedAtSql,
        reopenedSql,
        channelId,
        gte,
        lte,
        assigneeIds,
        ticketScopeExists
      ),
      this.tagCategoryBreakdown(db, cohortCte),
      this.tagBreakdown(db, cohortCte),
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
      tagCategories,
      tagBreakdown,
      tickets,
      agents,
    };
  }

  /**
   * Agent-facing run: computes only the requested metrics and only as many
   * ticket rows as were asked for. Everything else is identical to getMetrics
   */
  async queryMetrics(
    params: DeskMetricsQueryParams & {
      metrics: DeskMetricKey[];
      includeTickets?: number;
      customFieldBreakdown?: string[];
    }
  ): Promise<DeskMetricsPartial> {
    const ctx = await this.buildContext(params);
    const {
      db,
      channelId,
      gte,
      lte,
      assigneeIds,
      cohortCte,
      frtStop,
      resolvedAtSql,
      resolvedPredicate,
      reopenedSql,
      ticketScopeExists,
    } = ctx;

    const wanted = new Set(params.metrics);
    const needsAggregate = wanted.has('frt') || wanted.has('rt') || wanted.has('counts');
    const needsCounts = wanted.has('counts');
    // Fetch one extra row so the caller can tell a full page from a truncated one.
    const ticketLimit =
      wanted.has('tickets') && params.includeTickets && params.includeTickets > 0
        ? params.includeTickets
        : null;
    // A named breakdown implies the field work even if 'customFields' wasn't asked for.
    const breakdownFields = params.customFieldBreakdown ?? [];

    const [
      aggregates,
      tickets,
      emailRepliesInRange,
      stageCounts,
      priority,
      csat,
      trend,
      agents,
      tagCategories,
      tagBreakdown,
      customFields,
      customFieldBreakdown,
      aiCategoryCountRows,
      aiSubCategoryCountRows,
    ] = await Promise.all([
      needsAggregate ? this.frtRtAggregates(db, cohortCte, frtStop, resolvedAtSql) : null,
      ticketLimit ? this.ticketRows(db, cohortCte, frtStop, resolvedAtSql, ticketLimit + 1) : null,
      needsCounts ? this.emailRepliesCount(db, channelId, gte, lte, ticketScopeExists) : null,
      needsCounts ? this.stageCounts(db, cohortCte) : null,
      wanted.has('priority') ? this.priorityBreakdown(db, cohortCte) : null,
      wanted.has('csat') ? this.csatStats(db, channelId, gte, lte, ticketScopeExists) : null,
      wanted.has('trend')
        ? this.trendByDay(db, channelId, gte, lte, resolvedPredicate, ticketScopeExists)
        : null,
      wanted.has('agents')
        ? this.agentPerformance(
            db,
            cohortCte,
            frtStop,
            resolvedAtSql,
            reopenedSql,
            channelId,
            gte,
            lte,
            assigneeIds,
            ticketScopeExists
          )
        : null,
      wanted.has('tags') ? this.tagCategoryBreakdown(db, cohortCte) : null,
      wanted.has('tags') ? this.tagBreakdown(db, cohortCte) : null,
      wanted.has('customFields') ? this.customFieldSummary(db, cohortCte) : null,
      breakdownFields.length > 0 ? this.customFieldBreakdown(db, cohortCte, breakdownFields) : null,
      wanted.has('aiCategories') ? this.aiCategoryCounts(db, cohortCte) : null,
      wanted.has('aiCategories') ? this.aiSubCategoryCounts(db, cohortCte) : null,
    ]);

    const result: DeskMetricsPartial = {
      range: { from: gte.toISOString(), to: lte.toISOString() },
    };

    if (aggregates) {
      if (wanted.has('frt')) {
        result.frt = { avgSeconds: aggregates.avgFrt, respondedTickets: aggregates.responded };
      }
      if (wanted.has('rt')) {
        result.rt = { avgSeconds: aggregates.avgRt, resolvedTickets: aggregates.resolved };
      }
      if (wanted.has('counts')) {
        result.counts = {
          openedInRange: aggregates.opened,
          emailRepliesInRange: emailRepliesInRange ?? 0,
          stageCounts: stageCounts ?? [],
        };
      }
    }
    if (csat) result.csat = csat;
    if (priority) result.priority = priority;
    if (trend) result.trend = trend;
    if (agents) result.agents = agents;
    if (tagCategories) result.tagCategories = tagCategories;
    if (tagBreakdown) result.tagBreakdown = tagBreakdown;
    if (customFields) result.customFields = customFields;
    if (customFieldBreakdown) result.customFieldBreakdown = customFieldBreakdown;
    if (aiCategoryCountRows) result.aiCategoryCounts = aiCategoryCountRows;
    if (aiSubCategoryCountRows) result.aiSubCategoryCounts = aiSubCategoryCountRows;
    if (tickets && ticketLimit) {
      result.ticketsTruncated = tickets.length > ticketLimit;
      result.tickets = tickets.slice(0, ticketLimit);
    }

    return result;
  }


  /**
   * Every desk in the caller's workspace that the caller participates in.
   */
  async listAccessibleDesks(
    workspaceId: string,
    userId: string
  ): Promise<DeskMetricsDeskSummary[]> {
    const db = this.getDbInstance();

    const preferences = await db.emailChannelPreference.findMany({
      where: { workspaceId },
      select: { channelId: true, deskType: true, metricsEnabled: true },
    });
    if (preferences.length === 0) return [];

    const channelIds = preferences.map(p => p.channelId);
    // Membership is the same gate the per-desk endpoints apply, checked in bulk
    // here so listing 50 desks is one query rather than 50.
    const memberships = await db.channelParticipant.findMany({
      where: { userId, channelId: { in: channelIds } },
      select: { channelId: true },
    });
    const allowed = new Set(memberships.map(m => m.channelId));
    if (allowed.size === 0) return [];

    const channels = await db.channel.findMany({
      where: { id: { in: [...allowed] }, workspaceId },
      select: { id: true, name: true },
    });
    const nameById = new Map(channels.map(c => [c.id, c.name]));

    return preferences
      .filter(p => allowed.has(p.channelId) && nameById.has(p.channelId))
      .map(p => ({
        channelId: p.channelId,
        channelName: nameById.get(p.channelId) ?? null,
        deskType: p.deskType,
        metricsEnabled: p.metricsEnabled === true,
      }))
      .sort((a, b) => (a.channelName ?? '').localeCompare(b.channelName ?? ''));
  }

  /**
   * Ticket counts per AI category over the cohort.
   */
  private async aiCategoryCounts(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql
  ): Promise<DeskMetricsAiCategoryCount[]> {
    const rows = await db.$queryRaw<Array<{ ai_category: string; count: number }>>(
      Prisma.sql`
        WITH ${cohortCte}
        SELECT COALESCE(t."aiCategory", ${UNCLASSIFIED_AI_CATEGORY}) AS ai_category,
               COUNT(*)::int AS count
        FROM cohort c
        JOIN "public"."tickets" t ON t.id = c."ticketId"
        GROUP BY 1
        ORDER BY count DESC, ai_category ASC
      `
    );
    return rows.map(r => ({ aiCategory: r.ai_category, count: r.count }));
  }

  private async aiSubCategoryCounts(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql
  ): Promise<DeskMetricsAiSubCategoryCount[]> {
    const rows = await db.$queryRaw<
      Array<{ ai_category: string; ai_sub_category: string; count: number }>
    >(
      Prisma.sql`
        WITH ${cohortCte}
        SELECT COALESCE(t."aiCategory", ${UNCLASSIFIED_AI_CATEGORY}) AS ai_category,
               COALESCE(t."aiSubCategory", ${UNCLASSIFIED_AI_CATEGORY}) AS ai_sub_category,
               COUNT(*)::int AS count
        FROM cohort c
        JOIN "public"."tickets" t ON t.id = c."ticketId"
        GROUP BY 1, 2
        ORDER BY count DESC, ai_category ASC, ai_sub_category ASC
      `
    );
    return rows.map(r => ({
      aiCategory: r.ai_category,
      aiSubCategory: r.ai_sub_category,
      count: r.count,
    }));
  }

  /**
   * Text form of a custom field value.
   */
  private customFieldValueSql(): Prisma.Sql {
    return Prisma.sql`(
      CASE WHEN jsonb_typeof(fev."actualFieldValue") = 'array'
        THEN (
          SELECT string_agg(av.value, ', ' ORDER BY av.ord)
          FROM jsonb_array_elements_text(fev."actualFieldValue")
            WITH ORDINALITY AS av(value, ord)
        )
        ELSE COALESCE(fev."actualFieldValue"#>>'{}', NULLIF(fev."fieldValue", ''))
      END
    )`;
  }

  /**
   * One row per (ticket, field), newest wins. form_entity_values is unique on
   * (entityId, entityType, fieldId, contextId, version), so a ticket can carry
   * several rows for the same field across stage context and version — without
   * this dedup a breakdown would double-count them.
   */
  private dedupedFieldValuesCte(): Prisma.Sql {
    return Prisma.sql`
      deduped_cf AS (
        SELECT DISTINCT ON (fev."entityId", COALESCE(gf."fieldName", ff."fieldName"))
          fev."entityId" AS ticket_id,
          COALESCE(gf."fieldName", ff."fieldName") AS field_name,
          fev."actualFieldValue" AS raw_value,
          ${this.customFieldValueSql()} AS field_value
        FROM "public"."form_entity_values" fev
        LEFT JOIN "public"."global_fields" gf ON gf.id = fev."fieldId"
        LEFT JOIN "public"."form_fields" ff ON ff.id = fev."fieldId"
        WHERE fev."entityId" IN (SELECT "ticketId" FROM cohort)
          AND fev."entityType" = 'TICKET'
        ORDER BY fev."entityId", COALESCE(gf."fieldName", ff."fieldName"),
                 fev."updatedAt" DESC, fev.id DESC
      )`;
  }

  /**
   * deduped_cf with array fields expanded element-by-element, so "Issues"
   * yields Cab/Auto/Other rather than one row per literal combination. Shared
   * by discovery and breakdown so their value counts can never disagree.
   */
  private expandedFieldValuesCte(): Prisma.Sql {
    return Prisma.sql`
      expanded_cf AS (
        SELECT
          d.ticket_id,
          d.field_name,
          jsonb_typeof(d.raw_value) = 'array' AS multi_value,
          CASE WHEN jsonb_typeof(d.raw_value) = 'array' THEN el.value ELSE d.field_value END
            AS value
        FROM deduped_cf d
        -- Coerce non-arrays to '[]' so the set-returning function is never
        -- handed a scalar; the LEFT JOIN then yields one NULL row and the CASE
        -- above falls back to the plain value.
        LEFT JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(d.raw_value) = 'array' THEN d.raw_value ELSE '[]'::jsonb END
        ) AS el(value) ON true
      )`;
  }

  /** Which custom fields the cohort's tickets actually carry. */
  private async customFieldSummary(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql
  ): Promise<DeskMetricsCustomFieldSummary[]> {
    const rows = await db.$queryRaw<
      Array<{
        field_name: string;
        multi_value: boolean;
        tickets_with_value: number;
        distinct_values: number;
      }>
    >(
      Prisma.sql`
        WITH ${cohortCte},
        ${this.dedupedFieldValuesCte()},
        ${this.expandedFieldValuesCte()}
        SELECT
          field_name,
          bool_or(multi_value) AS multi_value,
          COUNT(DISTINCT ticket_id) FILTER (WHERE value IS NOT NULL AND value <> '')::int
            AS tickets_with_value,
          COUNT(DISTINCT value)::int AS distinct_values
        FROM expanded_cf
        WHERE field_name IS NOT NULL
        GROUP BY field_name
        ORDER BY tickets_with_value DESC, field_name ASC
      `
    );
    return rows.map((r): DeskMetricsCustomFieldSummary => ({
      field: r.field_name,
      multiValue: r.multi_value,
      ticketsWithValue: r.tickets_with_value,
      distinctValues: r.distinct_values,
    }));
  }

  /**
   * Value distribution for the named custom fields.
   */
  private async customFieldBreakdown(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql,
    fields: string[]
  ): Promise<DeskMetricsCustomFieldBreakdown[]> {
    if (fields.length === 0) return [];
    const rows = await db.$queryRaw<
      Array<{ field_name: string; multi_value: boolean; value: string; tickets: number }>
    >(
      Prisma.sql`
        WITH ${cohortCte},
        ${this.dedupedFieldValuesCte()},
        ${this.expandedFieldValuesCte()}
        SELECT field_name, multi_value, value, tickets
        FROM (
          SELECT field_name, bool_or(multi_value) AS multi_value, value,
                 COUNT(DISTINCT ticket_id)::int AS tickets,
                 ROW_NUMBER() OVER (
                   PARTITION BY field_name
                   ORDER BY COUNT(DISTINCT ticket_id) DESC, value ASC
                 ) AS rn
          FROM expanded_cf
          WHERE field_name IN (${Prisma.join(fields)})
            AND value IS NOT NULL AND value <> ''
          GROUP BY field_name, value
        ) ranked
        WHERE rn <= ${MAX_BREAKDOWN_VALUES_PER_FIELD + 1}
        ORDER BY field_name ASC, tickets DESC, value ASC
      `
    );

    const byField = new Map<string, DeskMetricsCustomFieldBreakdown>();
    for (const r of rows) {
      const entry: DeskMetricsCustomFieldBreakdown = byField.get(r.field_name) ?? {
        field: r.field_name,
        multiValue: r.multi_value,
        values: [],
      };
      entry.multiValue = entry.multiValue || r.multi_value;
      entry.values.push({ value: r.value, tickets: r.tickets });
      byField.set(r.field_name, entry);
    }
    return [...byField.values()].map(entry =>
      entry.values.length > MAX_BREAKDOWN_VALUES_PER_FIELD
        ? {
            ...entry,
            values: entry.values.slice(0, MAX_BREAKDOWN_VALUES_PER_FIELD),
            truncated: true,
          }
        : entry,
    );
  }

  private async resolvedStageNamesForChannel(channelId: string): Promise<string[]> {
    const db = this.getDbInstance();
    const boardId = await this.boardIdForChannel(channelId);
    if (!boardId) return [];
    const stages = await db.stage.findMany({
      where: { boardId, defaultTicketStatusV2: TicketStatusV2.COMPLETED },
      select: { name: true },
    });
    return stages.map((s) => s.name);
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
    resolvedAtSql: Prisma.Sql
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
      `
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
    limit?: number
  ): Promise<DeskMetricsTicketRow[]> {
    // The dashboard takes every cohort row; the agent surface caps it, because
    // each row carries custom fields and tags and would swamp a context window.
    const limitSql = limit ? Prisma.sql` LIMIT ${limit}` : Prisma.sql``;
    const rows = await db.$queryRaw<
      Array<{
        ticket_id: string;
        xyne_id: string | null;
        channel_id: string;
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
        ticket_tags: Array<{ tagCategory: string; tag: string }> | null;
      }>
    >(
      Prisma.sql`
        WITH ${cohortCte},
        deduped_fev AS (
          SELECT DISTINCT ON (fev."entityId", COALESCE(gf."fieldName", ff."fieldName"))
            fev."entityId" AS ticket_id,
            COALESCE(gf."fieldName", ff."fieldName") AS field_name,
            ${this.customFieldValueSql()} AS field_value
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
        ),
        ticket_tags_agg AS (
          SELECT deduped."ticketId" AS ticket_id,
            jsonb_agg(jsonb_build_object('tagCategory', deduped.tag_category, 'tag', deduped.tag)) AS tags
          FROM (
            SELECT DISTINCT c."ticketId", tg."tagCategory" AS tag_category, tg.tag
            FROM cohort c
            JOIN "public"."tickets" t ON t.id = c."ticketId"
            JOIN "public"."emails" e ON e.id = (
              SELECT e2.id FROM "public"."emails" e2
              WHERE e2."conversationId" = t."conversationId"
              ORDER BY e2."createdAt" DESC, e2.id DESC
              LIMIT 1
            )
            JOIN non_zero.tags tg
              ON tg."sourceId" = e.id AND tg."sourceType" = 'desk-email' AND tg."isDeleted" = false
          ) deduped
          GROUP BY deduped."ticketId"
        )
        SELECT
          c."ticketId" AS ticket_id,
          t."xyneId" AS xyne_id,
          t."channelId" AS channel_id,
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
          fv.custom_fields,
          tta.tags AS ticket_tags
        FROM cohort c
        JOIN "public"."tickets" t ON t.id = c."ticketId"
        LEFT JOIN "public"."users" u ON u.id = t."assignedTo"
        LEFT JOIN form_vals fv ON fv.ticket_id = c."ticketId"
        LEFT JOIN ticket_tags_agg tta ON tta.ticket_id = c."ticketId"
        ORDER BY c.created_at DESC${limitSql}
      `
    );
    return rows.map((r) => {
      const rawScore = r.csat_value?.score;
      const score = typeof rawScore === 'string' ? Number(rawScore) : rawScore;
      return {
        ticketId: r.ticket_id,
        xyneId: r.xyne_id,
        channelId: r.channel_id,
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
        tags: r.ticket_tags ?? null,
      };
    });
  }

  private async tagCategoryBreakdown(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql
  ): Promise<Array<{ tagCategory: string; count: number }>> {
    const rows = await db.$queryRaw<Array<{ tag_category: string; count: number }>>(
      Prisma.sql`
        WITH ${cohortCte},
        latest_tag_rows AS (
          SELECT DISTINCT c."ticketId", tg."tagCategory" AS tag_category
          FROM cohort c
          JOIN "public"."tickets" t ON t.id = c."ticketId"
          JOIN "public"."emails" e ON e.id = (
            SELECT e2.id FROM "public"."emails" e2
            WHERE e2."conversationId" = t."conversationId"
            ORDER BY e2."createdAt" DESC, e2.id DESC
            LIMIT 1
          )
          JOIN non_zero.tags tg
            ON tg."sourceId" = e.id AND tg."sourceType" = 'desk-email' AND tg."isDeleted" = false
        )
        SELECT tag_category, COUNT(DISTINCT "ticketId")::int AS count
        FROM latest_tag_rows
        GROUP BY tag_category
        ORDER BY count DESC
      `
    );
    return rows.map(r => ({ tagCategory: r.tag_category, count: r.count }));
  }

  private async tagBreakdown(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql
  ): Promise<Array<{ tag: string; tagCategory: string; count: number }>> {
    const rows = await db.$queryRaw<Array<{ tag: string; tag_category: string; count: number }>>(
      Prisma.sql`
        WITH ${cohortCte},
        latest_tag_rows AS (
          SELECT DISTINCT c."ticketId", tg."tagCategory" AS tag_category, tg.tag
          FROM cohort c
          JOIN "public"."tickets" t ON t.id = c."ticketId"
          JOIN "public"."emails" e ON e.id = (
            SELECT e2.id FROM "public"."emails" e2
            WHERE e2."conversationId" = t."conversationId"
            ORDER BY e2."createdAt" DESC, e2.id DESC
            LIMIT 1
          )
          JOIN non_zero.tags tg
            ON tg."sourceId" = e.id AND tg."sourceType" = 'desk-email' AND tg."isDeleted" = false
        )
        SELECT tag_category, tag, COUNT(DISTINCT "ticketId")::int AS count
        FROM latest_tag_rows
        GROUP BY tag_category, tag
        ORDER BY count DESC
      `
    );
    return rows.map(r => ({ tag: r.tag, tagCategory: r.tag_category, count: r.count }));
  }

  private async agentPerformance(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql,
    frtStopSql: Prisma.Sql,
    resolvedAtSql: Prisma.Sql,
    reopenedSql: Prisma.Sql,
    channelId: string,
    gte: Date,
    lte: Date,
    assigneeIds: string[],
    customFieldExists: Prisma.Sql = Prisma.sql``
  ): Promise<DeskMetricsAgentRow[]> {
    const replyActorFilter =
      assigneeIds.length > 0
        ? Prisma.sql`AND ta."updatedBy" IN (${Prisma.join(assigneeIds)})`
        : Prisma.sql``;
    const [ownershipRows, replyRows, stageRows] = await Promise.all([
      db.$queryRaw<
        Array<{
          assignee_id: string | null;
          assignee_name: string | null;
          assigned: number;
          responded: number;
          avg_frt: number | null;
          resolved: number;
          reopened: number;
          avg_rt: number | null;
          csat_avg: number | null;
          csat_scored: number;
          csat_good: number;
          csat_bad: number;
        }>
      >(
        Prisma.sql`
          WITH ${cohortCte},
          latest_csat AS (
            SELECT DISTINCT ON (ta."ticketId")
              ta."ticketId" AS ticket_id,
              NULLIF(ta.value->>'score', '')::numeric AS score,
              ta.value->>'rating' AS rating
            FROM "public"."ticket_activities" ta
            WHERE ta."ticketId" IN (SELECT "ticketId" FROM cohort)
              AND ta."activityType" = 'CSAT_RECEIVED'
            ORDER BY ta."ticketId", ta."timestamp" DESC
          ),
          per_ticket AS (
            SELECT
              t."assignedTo" AS assignee_id,
              COALESCE(u."displayName", u.name) AS assignee_name,
              c.created_at,
              ${frtStopSql} AS stop_at,
              ${resolvedAtSql} AS resolved_at,
              ${reopenedSql} AS reopened,
              lc.score AS csat_score,
              lc.rating AS csat_rating
            FROM cohort c
            JOIN "public"."tickets" t ON t.id = c."ticketId"
            LEFT JOIN "public"."users" u ON u.id = t."assignedTo"
            LEFT JOIN latest_csat lc ON lc.ticket_id = c."ticketId"
          )
          SELECT
            assignee_id,
            assignee_name,
            COUNT(*)::int AS assigned,
            COUNT(*) FILTER (WHERE stop_at IS NOT NULL AND stop_at >= created_at)::int AS responded,
            AVG(EXTRACT(EPOCH FROM (stop_at - created_at)))
              FILTER (WHERE stop_at IS NOT NULL AND stop_at >= created_at)::float AS avg_frt,
            COUNT(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at >= created_at)::int AS resolved,
            COUNT(*) FILTER (WHERE reopened)::int AS reopened,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))
              FILTER (WHERE resolved_at IS NOT NULL AND resolved_at >= created_at)::float AS avg_rt,
            AVG(csat_score)::float AS csat_avg,
            COUNT(csat_score)::int AS csat_scored,
            COUNT(*) FILTER (WHERE csat_rating = 'GOOD')::int AS csat_good,
            COUNT(*) FILTER (WHERE csat_rating = 'BAD')::int AS csat_bad
          FROM per_ticket
          GROUP BY assignee_id, assignee_name
        `
      ),
      db.$queryRaw<Array<{ user_id: string; user_name: string | null; replies: number }>>(
        Prisma.sql`
          SELECT
            ta."updatedBy" AS user_id,
            COALESCE(u."displayName", u.name) AS user_name,
            COUNT(*)::int AS replies
          FROM "public"."ticket_activities" ta
          LEFT JOIN "public"."users" u ON u.id = ta."updatedBy"
          WHERE ta."channelId" = ${channelId}
            AND ta."activityType" = 'EMAIL_SENT'
            AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
            ${replyActorFilter}
            ${customFieldExists}
          GROUP BY ta."updatedBy", COALESCE(u."displayName", u.name)
        `
      ),
      db.$queryRaw<Array<{ assignee_id: string | null; stage_name: string; count: number }>>(
        Prisma.sql`
          WITH ${cohortCte}
          SELECT
            t."assignedTo" AS assignee_id,
            COALESCE(t."stageName", 'Unassigned') AS stage_name,
            COUNT(*)::int AS count
          FROM cohort c
          JOIN "public"."tickets" t ON t.id = c."ticketId"
          WHERE t."isArchived" = false
          GROUP BY t."assignedTo", t."stageName"
        `
      ),
    ]);

    const UNASSIGNED = '__unassigned__';
    const stageCountsByAgent = new Map<string, Array<{ stageName: string; count: number }>>();
    for (const row of stageRows) {
      const key = row.assignee_id ?? UNASSIGNED;
      const counts = stageCountsByAgent.get(key) ?? [];
      counts.push({ stageName: row.stage_name, count: row.count });
      stageCountsByAgent.set(key, counts);
    }
    for (const counts of stageCountsByAgent.values()) {
      counts.sort((a, b) => b.count - a.count || a.stageName.localeCompare(b.stageName));
    }

    const byAgent = new Map<string, DeskMetricsAgentRow>();
    for (const r of ownershipRows) {
      const key = r.assignee_id ?? UNASSIGNED;
      byAgent.set(key, {
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_name,
        assigned: r.assigned,
        stageCounts: stageCountsByAgent.get(key) ?? [],
        responded: r.responded,
        resolved: r.resolved,
        reopened: r.reopened,
        avgFrtSeconds: r.avg_frt,
        avgRtSeconds: r.avg_rt,
        csatAvgScore: r.csat_avg,
        csatScoredResponses: r.csat_scored,
        csatGood: r.csat_good,
        csatBad: r.csat_bad,
        emailReplies: 0,
      });
    }
    for (const r of replyRows) {
      const existing = byAgent.get(r.user_id);
      if (existing) {
        existing.emailReplies = r.replies;
        continue;
      }
      byAgent.set(r.user_id, {
        assigneeId: r.user_id,
        assigneeName: r.user_name,
        assigned: 0,
        stageCounts: [],
        responded: 0,
        resolved: 0,
        reopened: 0,
        avgFrtSeconds: null,
        avgRtSeconds: null,
        csatAvgScore: null,
        csatScoredResponses: 0,
        csatGood: 0,
        csatBad: 0,
        emailReplies: r.replies,
      });
    }

    const rows = [...byAgent.values()].filter(
      (agent) => assigneeIds.length === 0 || assigneeIds.includes(agent.assigneeId ?? '')
    );
    rows.sort(
      (a, b) =>
        b.assigned - a.assigned ||
        b.resolved - a.resolved ||
        b.emailReplies - a.emailReplies ||
        (a.assigneeName ?? '').localeCompare(b.assigneeName ?? '')
    );
    return rows;
  }

  /** Count email replies sent in range, optionally scoped by assignee and/or ticket filters. */
  private async emailRepliesCount(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    channelId: string,
    gte: Date,
    lte: Date,
    customFieldExists: Prisma.Sql = Prisma.sql``
  ): Promise<number> {
    const rows = await db.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM "public"."ticket_activities" ta
        WHERE ta."channelId" = ${channelId}
          AND ta."activityType" = 'EMAIL_SENT'
          AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
          ${customFieldExists}
      `
    );
    return rows[0]?.count ?? 0;
  }

  /** Cohort-scoped: current stage of tickets created in the selected range. */
  private async stageCounts(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql
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
      `
    );
    return rows.map((r) => ({ stageName: r.stage_name, count: r.count }));
  }

  private async priorityBreakdown(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    cohortCte: Prisma.Sql
  ): Promise<Array<{ priority: string; count: number }>> {
    const rows = await db.$queryRaw<Array<{ priority: string; count: number }>>(
      Prisma.sql`
        WITH ${cohortCte}
        SELECT t.priority::text AS priority, COUNT(*)::int AS count
        FROM cohort c
        JOIN "public"."tickets" t ON t.id = c."ticketId"
        GROUP BY t.priority
        ORDER BY count DESC
      `
    );
    return rows;
  }

  private async csatStats(
    db: ReturnType<DeskMetricsRepository['getDbInstance']>,
    channelId: string,
    gte: Date,
    lte: Date,
    customFieldExists: Prisma.Sql = Prisma.sql``
  ): Promise<{ avgScore: number | null; scoredResponses: number; good: number; bad: number }> {
    const rows = await db.$queryRaw<
      Array<{ avg_score: number | null; scored_responses: number; good: number; bad: number }>
    >(
      Prisma.sql`
        SELECT
          AVG(NULLIF(ta.value->>'score', '')::numeric)::float AS avg_score,
          COUNT(NULLIF(ta.value->>'score', ''))::int AS scored_responses,
          COUNT(*) FILTER (WHERE ta.value->>'rating' = 'GOOD')::int AS good,
          COUNT(*) FILTER (WHERE ta.value->>'rating' = 'BAD')::int AS bad
        FROM "public"."ticket_activities" ta
        WHERE ta."channelId" = ${channelId}
          AND ta."activityType" = 'CSAT_RECEIVED'
          AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
          ${customFieldExists}
      `
    );
    return {
      avgScore: rows[0]?.avg_score ?? null,
      scoredResponses: rows[0]?.scored_responses ?? 0,
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
    customFieldExists: Prisma.Sql = Prisma.sql``
  ): Promise<Array<{ date: string; opened: number; closed: number }>> {
    const rangeDays = (lte.getTime() - gte.getTime()) / DAY_MS;
    const hourly = rangeDays <= 1;
    const bucketFn = hourly
      ? Prisma.sql`to_char(date_trunc('hour', (ta."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD HH24:00')`
      : Prisma.sql`to_char(date_trunc('day',  (ta."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;
    const bucketFnR = hourly
      ? Prisma.sql`to_char(date_trunc('hour', (r.first_resolved AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD HH24:00')`
      : Prisma.sql`to_char(date_trunc('day',  (r.first_resolved AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;

    const [openedRows, closedRows] = await Promise.all([
      db.$queryRaw<Array<{ day: string; count: number }>>(
        Prisma.sql`
          SELECT ${bucketFn} AS day, COUNT(*)::int AS count
          FROM "public"."ticket_activities" ta
          WHERE ta."channelId" = ${channelId}
            AND ta."activityType" = 'TICKET_CREATED'
            AND ta."timestamp" >= ${gte} AND ta."timestamp" <= ${lte}
            ${customFieldExists}
          GROUP BY 1
        `
      ),
      db.$queryRaw<Array<{ day: string; count: number }>>(
        Prisma.sql`
          SELECT ${bucketFnR} AS day, COUNT(*)::int AS count
          FROM (
            SELECT ta."ticketId", MAX(ta."timestamp") AS first_resolved
            FROM "public"."ticket_activities" ta
            WHERE ta."channelId" = ${channelId} AND ${resolvedPredicate}
              ${customFieldExists}
            GROUP BY ta."ticketId"
          ) r
          WHERE r.first_resolved >= ${gte} AND r.first_resolved <= ${lte}
          GROUP BY 1
        `
      ),
    ]);

    const opened = new Map(openedRows.map((r) => [r.day, r.count]));
    const closed = new Map(closedRows.map((r) => [r.day, r.count]));

    // Fill all buckets so the chart has no gaps
    const buckets: string[] = [];
    const HOUR_MS = 60 * 60 * 1000;
    const IST_TZ = 'Asia/Kolkata';
    const toISTDateStr = (ms: number): string =>
      new Date(ms).toLocaleDateString('en-CA', { timeZone: IST_TZ }); // → 'YYYY-MM-DD'
    const toISTHourStr = (ms: number): string => {
      const d = new Date(ms);
      const date = d.toLocaleDateString('en-CA', { timeZone: IST_TZ });
      const hour = d
        .toLocaleTimeString('en-GB', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit' })
        .slice(0, 2);
      return `${date} ${hour}:00`;
    };
    const floorToISTDay = (ms: number): number =>
      new Date(`${toISTDateStr(ms)}T00:00:00+05:30`).getTime();
    const floorToISTHour = (ms: number): number => {
      const d = new Date(ms);
      const date = d.toLocaleDateString('en-CA', { timeZone: IST_TZ });
      const hour = d
        .toLocaleTimeString('en-GB', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit' })
        .slice(0, 2);
      return new Date(`${date}T${hour}:00:00+05:30`).getTime();
    };

    if (hourly) {
      const startHour = floorToISTHour(gte.getTime());
      const endHour = floorToISTHour(lte.getTime());
      for (let t = startHour; t <= endHour; t += HOUR_MS) {
        buckets.push(toISTHourStr(t));
      }
    } else {
      const startDay = floorToISTDay(gte.getTime());
      const endDay = floorToISTDay(lte.getTime());
      for (let t = startDay; t <= endDay; t += DAY_MS) {
        buckets.push(toISTDateStr(t));
      }
    }

    return buckets.map((date) => ({
      date,
      opened: opened.get(date) ?? 0,
      closed: closed.get(date) ?? 0,
    }));
  }
}

export const deskMetricsRepository = new DeskMetricsRepository();
