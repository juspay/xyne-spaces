/**
 * Desk Metrics Controller
 * Hardcoded per-desk-channel metrics (FRT, RT, CSAT, counts, priority,
 * activity), computed from ticket_activities. The dashboard endpoints are
 * gated on the per-desk metricsEnabled preference so desks that never opted in
 * cost nothing; the agent-facing query endpoint is not (see queryMetrics).
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { deskMetricsRepository } from '../database/repositories/deskMetricsRepository.js';
import { EmailChannelPreferenceRepository } from '../database/repositories/emailChannelPreferenceRepository.js';
import { ChannelRepository } from '../database/repositories/channelRepository.js';
import { assertChannelMembership } from '@/utils/channelMembership';
import {
  aggregateDeskMetrics,
  fillDeskMetrics,
  mergeAiCategorySlices,
  mergeCustomFieldSlices,
  prunePerDesk,
  type DeskMetricsContribution,
} from '../services/deskMetricsAggregator.js';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_DESK_METRIC_KEYS,
  DESK_METRIC_KEYS,
  DESK_METRICS_MAX_AGGREGATE_DESKS,
  TicketPriority,
} from '@xyne/shared';
import type {
  DeskMetricKey,
  DeskMetricsAggregateResponse,
  DeskMetricsCustomFieldBreakdown,
  DeskMetricsDeskListResponse,
  DeskMetricsDeskSummary,
  DeskMetricsPartial,
  DeskMetricsQueryResponse,
  DeskMetricsResponse,
  DeskMetricsSkippedDesk,
} from '@xyne/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
// Keep in sync with MAX_CUSTOM_DAYS in the dashboard's DeskMetricsDateRangePicker.
const MAX_CUSTOM_RANGE_DAYS = 90;
// +1 day of slack: the UI sends whole days (00:00 → 23:59:59.999), so a
// 90-day selection spans a hair under 90 * DAY_MS + the trailing day.
const MAX_CUSTOM_RANGE_MS = (MAX_CUSTOM_RANGE_DAYS + 1) * DAY_MS;

/** Cap on cohort rows the agent surface will return in one call. */
const MAX_TICKET_ROWS = 50;

/** Each requested field is a GROUP BY over the cohort's form values. */
const MAX_BREAKDOWN_FIELDS = 5;

const queryBodySchema = z
  .object({
    channelIds: z.array(z.string().min(1)).min(1).max(DESK_METRICS_MAX_AGGREGATE_DESKS),
    timeRange: z.string().min(1).optional(),
    lastDays: z.number().int().positive().max(MAX_CUSTOM_RANGE_DAYS).optional(),
    metrics: z.array(z.enum(DESK_METRIC_KEYS)).min(1).optional(),
    includeTickets: z.number().int().nonnegative().max(MAX_TICKET_ROWS).optional(),
    customFieldBreakdown: z.array(z.string().min(1)).max(MAX_BREAKDOWN_FIELDS).optional(),
    assigneeIds: z.array(z.string().min(1)).optional(),
    stageNames: z.array(z.string().min(1)).optional(),
    priorities: z.array(z.nativeEnum(TicketPriority)).optional(),
    userGroupIds: z.array(z.string().min(1)).optional(),
    tagValues: z.array(z.string().min(1)).optional(),
    aiCategories: z.array(z.string().min(1)).optional(),
    aiSubCategories: z.array(z.string().min(1)).optional(),
    customFieldFilter: z
      .object({
        keys: z.array(z.string().min(1)).min(1),
        perKeyFilters: z
          .record(
            z.object({
              values: z.array(z.string()).optional(),
              textTerms: z.array(z.string().min(1)).optional(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .strict();

type CustomFieldFilterArg = {
  keys: string[];
  perKeyFilters?: Record<string, { values?: string[]; textTerms?: string[] }>;
};

const getStringQueryParam = (req: Request, name: string): string | undefined => {
  const value = req.query[name];
  return typeof value === 'string' ? value : undefined;
};

export class DeskMetricsController {
  private channelRepo = new ChannelRepository();
  private preferenceRepo = new EmailChannelPreferenceRepository();

  private async assertChannelAccess(
    req: Request,
    channelId: string,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const access = await assertChannelMembership(req, channelId);
    return access.ok ? { ok: true } : access;
  }

  private parseMetricsQuery(
    req: Request,
  ):
    | {
        ok: true;
        timeRange: string;
        assigneeIds: string[];
        stageNames: string[];
        priorities: TicketPriority[];
        userGroupIds: string[];
        tagValues: string[];
        aiCategories: string[];
        customFieldFilter?: CustomFieldFilterArg;
      }
    | { ok: false; error: string } {
      const defaultEndMs = Date.now();
      const rawTimeRange =
        getStringQueryParam(req, 'timeRange') ?? `${defaultEndMs - 7 * DAY_MS}_${defaultEndMs}`;
      const parts = rawTimeRange.split('_');
      if (parts.length !== 2) {
        return { ok: false, error: 'Invalid timeRange. Use startMs_endMs' };
      }
      const fromMs = Number(parts[0]);
      const toMs = Number(parts[1]);
      const from = new Date(fromMs);
      const to = new Date(toMs);
      if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
        return { ok: false, error: 'Invalid time range' };
      }
      if (toMs - fromMs > MAX_CUSTOM_RANGE_MS) {
        return {
          ok: false,
          error: `Custom time range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`,
        };
      }
      const timeRange = rawTimeRange;

      const parseJsonStringArray = (raw?: string): string[] => {
        if (!raw) return [];

        try {
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed)) return [];
          return parsed.filter((v): v is string => typeof v === 'string');
        } catch {
          return [];
        }
      };

      const rawAssigneeIds = getStringQueryParam(req, 'assigneeIds');
      const legacyAssigneeId = getStringQueryParam(req, 'assigneeId');
      const assigneeIds = rawAssigneeIds
        ? parseJsonStringArray(rawAssigneeIds)
        : legacyAssigneeId
          ? [legacyAssigneeId]
          : [];
      const stageNames = parseJsonStringArray(getStringQueryParam(req, 'stageNames'));
      const validPriorities = new Set<string>(Object.values(TicketPriority));
      const priorities = parseJsonStringArray(getStringQueryParam(req, 'priorities')).filter(
        (priority): priority is TicketPriority => validPriorities.has(priority),
      );
      const userGroupIds = parseJsonStringArray(getStringQueryParam(req, 'userGroupIds'));
      const tagValues = parseJsonStringArray(getStringQueryParam(req, 'tagValues'));
      const aiCategories = [
        ...new Set(
          parseJsonStringArray(getStringQueryParam(req, 'aiCategories'))
            .map(v => v.trim())
            .filter(v => v.length > 0),
        ),
      ];
      const customFieldKeys = parseJsonStringArray(getStringQueryParam(req, 'customFieldKeys'));

      const parsePerKeyFilters = (
        raw?: string,
      ): Record<string, { values?: string[]; textTerms?: string[] }> => {
        try {
          const parsed = JSON.parse(raw ?? '') as Record<string, unknown>;
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
          const result: Record<string, { values?: string[]; textTerms?: string[] }> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v !== 'object' || v === null) continue;
            const entry: { values?: string[]; textTerms?: string[] } = {};
            const vals = (v as Record<string, unknown>)['values'];
            const textTerms = (v as Record<string, unknown>)['textTerms'];
            if (Array.isArray(vals) && vals.every(x => typeof x === 'string')) entry.values = vals as string[];
            if (Array.isArray(textTerms)) {
              const terms = textTerms.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim());
              if (terms.length > 0) entry.textTerms = terms;
            }
            result[k] = entry;
          }
          return result;
        } catch {
          return {};
        }
      };

      const perKeyFilters = parsePerKeyFilters(
        getStringQueryParam(req, 'customFieldPerKeyFilters'),
      );
      const customFieldFilter =
        customFieldKeys.length > 0
          ? { keys: customFieldKeys, ...(Object.keys(perKeyFilters).length > 0 ? { perKeyFilters } : {}) }
          : undefined;

      return {
        ok: true,
        timeRange,
        assigneeIds,
        stageNames,
        priorities,
        userGroupIds,
        tagValues,
        aiCategories,
        ...(customFieldFilter ? { customFieldFilter } : {}),
      };
  }

  private async metricsForChannel(
    channelId: string,
    preference: { frtStageNames?: string | null },
    query: {
      timeRange: string;
      assigneeIds: string[];
      stageNames: string[];
      priorities: TicketPriority[];
      userGroupIds: string[];
      tagValues: string[];
      aiCategories: string[];
      customFieldFilter?: CustomFieldFilterArg;
    },
  ): Promise<DeskMetricsResponse> {
    return deskMetricsRepository.getMetrics({
      channelId,
      timeRange: query.timeRange,
      frtStageNames: this.parseFrtStageNames(preference),
      assigneeIds: query.assigneeIds,
      stageNames: query.stageNames,
      priorities: query.priorities,
      userGroupIds: query.userGroupIds,
      tagValues: query.tagValues,
      aiCategories: query.aiCategories,
      customFieldFilter: query.customFieldFilter,
    });
  }

  getMetrics = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;

    try {
      const access = await this.assertChannelAccess(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const preference = await this.preferenceRepo.findByChannelId(channelId);
      if (!preference?.metricsEnabled) {
        res.status(403).json({ error: 'Metrics are not enabled for this desk' });
        return;
      }

      const query = this.parseMetricsQuery(req);
      if (!query.ok) {
        res.status(400).json({ error: query.error });
        return;
      }

      const metrics = await this.metricsForChannel(channelId, preference, query);
      res.json(metrics);
    } catch (error) {
      logger.error('[DeskMetrics] Failed to compute metrics', { channelId, error });
      res.status(500).json({ error: 'Failed to compute desk metrics' });
    }
  };

  /**
   * GET /desk-metrics/desks
   */
  listDesks = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      const workspaceId = req.user?.workspaceId;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const desks = await deskMetricsRepository.listAccessibleDesks(workspaceId, userId);
      res.json({ desks } satisfies DeskMetricsDeskListResponse);
    } catch (error) {
      logger.error('[DeskMetrics] Failed to list desks', { error });
      res.status(500).json({ error: 'Failed to list desks' });
    }
  };

  /**
   * POST /desk-metrics/claw/query
   */
  queryMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = queryBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: `Invalid request: ${parsed.error.issues
            .map(i => `${i.path.join('.') || 'body'}: ${i.message}`)
            .slice(0, 3)
            .join('; ')}`,
        });
        return;
      }
      const body = parsed.data;

      if (body.timeRange && body.lastDays !== undefined) {
        res.status(400).json({ error: 'Provide either timeRange or lastDays, not both.' });
        return;
      }

      const channelIds = [...new Set(body.channelIds)];
      const now = Date.now();
      const timeRange =
        body.timeRange ?? `${now - (body.lastDays ?? 7) * DAY_MS}_${now}`;
      const rangeParts = timeRange.split('_');
      const fromMs = Number(rangeParts[0]);
      const toMs = Number(rangeParts[1]);
      if (
        rangeParts.length !== 2 ||
        !Number.isFinite(fromMs) ||
        !Number.isFinite(toMs) ||
        fromMs > toMs
      ) {
        res.status(400).json({ error: 'Invalid timeRange. Use startMs_endMs' });
        return;
      }
      if (toMs - fromMs > MAX_CUSTOM_RANGE_MS) {
        res.status(400).json({ error: `Time range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days` });
        return;
      }

      const includeTickets = body.includeTickets ?? 0;
      const metricsDefaulted = body.metrics === undefined;
      const metrics: DeskMetricKey[] = body.metrics ?? [...DEFAULT_DESK_METRIC_KEYS];
      if (includeTickets > 0 && !metrics.includes('tickets')) metrics.push('tickets');
      const wanted = new Set(metrics);
      const filters = {
        assigneeIds: body.assigneeIds ?? [],
        stageNames: body.stageNames ?? [],
        priorities: body.priorities ?? [],
        userGroupIds: body.userGroupIds ?? [],
        tagValues: body.tagValues ?? [],
        aiCategories: body.aiCategories ?? [],
        aiSubCategories: body.aiSubCategories ?? [],
        ...(body.customFieldFilter ? { customFieldFilter: body.customFieldFilter } : {}),
      };

      const contributions: DeskMetricsContribution[] = [];
      const partials: DeskMetricsPartial[] = [];
      const desks: DeskMetricsDeskSummary[] = [];
      const skipped: DeskMetricsSkippedDesk[] = [];
      let anyDeskTruncated = false;
      let desksWithoutFrtStages = 0;

      // Sequential, matching getAggregateMetrics — bounds peak DB connections.
      for (const channelId of channelIds) {
        try {
          const access = await this.assertChannelAccess(req, channelId);
          if (!access.ok) {
            skipped.push({ channelId, reason: access.status === 404 ? 'not_found' : 'forbidden' });
            continue;
          }

          // Deliberately no metricsEnabled gate here — that flag gates the
          // dashboard tab, not access to the numbers, and membership above is
          // the real boundary. Consequence: this path never emits the
          // 'metrics_disabled' skip reason; unconfigured desks are computed and
          // called out in `notes` instead. The dashboard endpoints still gate.
          const preference = await this.preferenceRepo.findByChannelId(channelId);
          if (!preference) {
            skipped.push({ channelId, reason: 'not_found' });
            continue;
          }

          const channel = await this.channelRepo.findById(channelId);
          const frtStageNames = this.parseFrtStageNames(preference);
          if (frtStageNames.length === 0) desksWithoutFrtStages += 1;
          const partial = await deskMetricsRepository.queryMetrics({
            channelId,
            timeRange,
            frtStageNames,
            metrics,
            includeTickets,
            ...(body.customFieldBreakdown
              ? { customFieldBreakdown: body.customFieldBreakdown }
              : {}),
            ...filters,
          });
          partials.push(partial);

          if (partial.ticketsTruncated) anyDeskTruncated = true;
          desks.push({
            channelId,
            channelName: channel?.name ?? null,
            deskType: preference.deskType,
            metricsEnabled: preference.metricsEnabled === true,
          });
          contributions.push({
            channelId,
            channelName: channel?.name ?? null,
            metrics: fillDeskMetrics(partial),
          });
        } catch (error) {
          logger.error('[DeskMetrics] Query: desk failed, skipping', { channelId, error });
          skipped.push({ channelId, reason: 'error' });
        }
      }

      if (contributions.length === 0) {
        const hasError = skipped.some(desk => desk.reason === 'error');
        const hasForbidden = skipped.some(desk => desk.reason === 'forbidden');
        const status = hasError ? 500 : hasForbidden ? 403 : 404;
        res.status(status).json({
          error: hasError
            ? 'Failed to compute desk metrics'
            : hasForbidden
              ? 'You are not a member of the requested desk(s)'
              : 'No such desk. Check the channelId, or list the available desks first.',
          skipped,
        });
        return;
      }

      // Aggregate even for a single desk so the merge path is exercised
      // identically; the zero-filled slices are stripped right after.
      const merged = aggregateDeskMetrics(contributions);
      const result: DeskMetricsPartial = { range: merged.range };
      if (wanted.has('frt')) result.frt = merged.frt;
      if (wanted.has('rt')) result.rt = merged.rt;
      if (wanted.has('csat')) result.csat = merged.csat;
      if (wanted.has('counts')) result.counts = merged.counts;
      if (wanted.has('priority')) result.priority = merged.priority;
      if (wanted.has('trend')) result.trend = merged.trend;
      if (wanted.has('agents')) result.agents = merged.agents;
      if (wanted.has('tags')) {
        result.tagCategories = merged.tagCategories;
        result.tagBreakdown = merged.tagBreakdown;
      }
      Object.assign(result, mergeCustomFieldSlices(partials));
      Object.assign(result, mergeAiCategorySlices(partials));
      if (wanted.has('tickets') && includeTickets > 0) {
        result.tickets = merged.tickets.slice(0, includeTickets);
        result.ticketsTruncated = anyDeskTruncated || merged.tickets.length > includeTickets;
      }

      const response: DeskMetricsQueryResponse = {
        ...result,
        desks,
        skipped,
        ...(contributions.length > 1 ? { perDesk: prunePerDesk(merged.perDesk, wanted) } : {}),
        notes: this.buildNotes(
          wanted,
          contributions.length,
          result.ticketsTruncated === true,
          desksWithoutFrtStages,
          result.customFieldBreakdown ?? [],
          result.tickets !== undefined,
          metricsDefaulted,
        ),
      };

      res.json(response);
    } catch (error) {
      logger.error('[DeskMetrics] Failed to run metrics query', { error });
      res.status(500).json({ error: 'Failed to compute desk metrics' });
    }
  };

  private parseFrtStageNames(preference: { frtStageNames?: string | null }): string[] {
    try {
      const parsed: unknown = JSON.parse(preference.frtStageNames ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }

  private buildNotes(
    wanted: Set<DeskMetricKey>,
    deskCount: number,
    ticketsTruncated: boolean,
    desksWithoutFrtStages: number,
    customFieldBreakdown: DeskMetricsCustomFieldBreakdown[],
    ticketsReturned: boolean,
    metricsDefaulted: boolean,
  ): string[] {
    const notes: string[] = [];

    const cohortKeys = ['frt', 'rt', 'counts', 'priority', 'agents', 'tags', 'tickets'].filter(
      k => wanted.has(k as DeskMetricKey) && (k !== 'tickets' || ticketsReturned),
    );
    if (cohortKeys.length > 0) {
      notes.push(
        `Cohort-scoped (${cohortKeys.join(', ')}): these describe tickets CREATED inside the range, ` +
          'not activity that happened inside it. A ticket created before the range is excluded even ' +
          'if it was answered or resolved during it.',
      );
    }
    if (wanted.has('csat') || wanted.has('counts')) {
      notes.push(
        'Activity-scoped (csat, counts.emailRepliesInRange): these count events that happened inside ' +
          'the range regardless of when their ticket was created — deliberately different from the ' +
          'cohort-scoped metrics above.',
      );
    }
    if (wanted.has('frt')) {
      notes.push(
        'frt.avgSeconds is creation to first response, where "response" is the first outbound email ' +
          'and/or first entry into the stages this desk configured as its FRT stop. respondedTickets ' +
          'is how many cohort tickets have one at all.',
      );
    }
    if (wanted.has('rt')) {
      notes.push(
        'rt.avgSeconds is creation to the LAST resolution event (so a reopened-then-reclosed ticket ' +
          'measures to the final close). Tickets still open are excluded entirely, so a low average ' +
          'over a small resolvedTickets count is survivorship bias, not good performance.',
      );
    }
    if (wanted.has('trend')) {
      notes.push(
        'trend.opened and trend.closed are NOT counted the same way. opened counts tickets CREATED ' +
          'in that bucket; closed counts every ticket resolved in it whatever its age, including ' +
          'ones opened long before the range. On a backlog-clearing day closed can far exceed ' +
          'opened. Never divide one by the other for a resolution rate, a percentage, or a backlog ' +
          'trajectory — read them as two independent series.',
      );
    }
    if (wanted.has('agents')) {
      notes.push(
        'agents[] attributes ticket metrics to the CURRENT assignee, not whoever handled the ticket ' +
          'at the time; emailReplies is attributed to the actual sender. assigneeId null is the ' +
          'Unassigned bucket.',
      );
    }
    if (deskCount > 1) {
      notes.push(
        `Merged across ${deskCount} desks. Averages are weighted by their denominators (FRT by ` +
          'respondedTickets, RT by resolvedTickets, CSAT by scoredResponses) — do not re-average ' +
          'the perDesk rows yourself. See perDesk for the split.',
      );
    }
    notes.push(
      'Data is forward-only: it derives from ticket activity records that only exist since desk ' +
        'metrics was deployed. Ranges reaching further back report partial data, not zero activity.',
    );
    if (ticketsTruncated) {
      notes.push('Ticket rows were truncated by includeTickets — this is not the full cohort.');
    }
    if (wanted.has('aiCategories')) {
      notes.push(
        'aiCategoryCounts / aiSubCategoryCounts bucket tickets the classifier never labelled under ' +
          '"Unclassified" instead of dropping them, so the counts sum to the cohort. A desk with AI ' +
          'classification switched off therefore reads as entirely Unclassified — report that as ' +
          '"not classified", never as a real category.',
      );
    }
    if (metricsDefaulted) {
      const omitted = DESK_METRIC_KEYS.filter(k => !wanted.has(k));
      notes.push(
        `No \`metrics\` were requested, so this is the default set (${[...wanted].join(', ')}). ` +
          `NOT computed: ${omitted.join(', ')} — they are available, just ask for them by name. ` +
          'Do not tell the user this desk has no tag, category, agent or custom-field data on the ' +
          'strength of this response.',
      );
    }
    const truncatedFields = customFieldBreakdown.filter(b => b.truncated).map(b => b.field);
    if (truncatedFields.length > 0) {
      notes.push(
        `customFieldBreakdown for ${truncatedFields.join(', ')} was TRUNCATED to the top values by ` +
          'ticket count — the field has more distinct values than were returned, so this is not a ' +
          'complete distribution and the counts shown do not add up to the cohort. A field like ' +
          'this (an id or free text) is usually not worth breaking down at all.',
      );
    }
    const multiValueFields = customFieldBreakdown.filter(b => b.multiValue).map(b => b.field);
    if (multiValueFields.length > 0) {
      notes.push(
        `customFieldBreakdown for ${multiValueFields.join(', ')} is MULTI-VALUE: a ticket can carry ` +
          'several values and is counted once under each, so those counts deliberately do not sum ' +
          'to the ticket total. Read them as "tickets mentioning X", never as a split of the whole.',
      );
    }
    if (desksWithoutFrtStages > 0 && wanted.has('frt')) {
      notes.push(
        `${desksWithoutFrtStages} desk(s) here have no configured first-response stop stages, so ` +
          'for them frt falls back to the time of the first OUTBOUND EMAIL. That is a real ' +
          'measurement, not a missing one — report the number, and mention only that the desk has ' +
          'not chosen its own stop condition. Do not call it unconfigured and do not omit the desk ' +
          'from a comparison.',
      );
    }
    return notes;
  }

  getAggregateMetrics = async (req: Request, res: Response): Promise<void> => {
    const rawIds = getStringQueryParam(req, 'channelIds') ?? '';
    const channelIds = [
      ...new Set(
        rawIds
          .split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0),
      ),
    ];

    if (channelIds.length === 0) {
      res.status(400).json({ error: 'channelIds is required (comma-separated)' });
      return;
    }
    if (channelIds.length > DESK_METRICS_MAX_AGGREGATE_DESKS) {
      res
        .status(400)
        .json({
          error: `Cannot aggregate more than ${DESK_METRICS_MAX_AGGREGATE_DESKS} desks at once`,
        });
      return;
    }

    try {
      const query = this.parseMetricsQuery(req);
      if (!query.ok) {
        res.status(400).json({ error: query.error });
        return;
      }

      const contributions: DeskMetricsContribution[] = [];
      const skipped: DeskMetricsSkippedDesk[] = [];

      // Keep per-desk fan-out sequential to bound peak DB connections.
      for (const channelId of channelIds) {
        try {
          const access = await this.assertChannelAccess(req, channelId);
          if (!access.ok) {
            skipped.push({
              channelId,
              reason: access.status === 404 ? 'not_found' : 'forbidden',
            });
            continue;
          }

          const preference = await this.preferenceRepo.findByChannelId(channelId);
          if (!preference?.metricsEnabled) {
            skipped.push({ channelId, reason: 'metrics_disabled' });
            continue;
          }

          const channel = await this.channelRepo.findById(channelId);
          const metrics = await this.metricsForChannel(channelId, preference, query);
          contributions.push({ channelId, channelName: channel?.name ?? null, metrics });
        } catch (error) {
          logger.error('[DeskMetrics] Aggregate: desk failed, skipping', { channelId, error });
          skipped.push({ channelId, reason: 'error' });
        }
      }

      if (contributions.length === 0) {
        if (skipped.some(desk => desk.reason === 'error')) {
          res.status(500).json({
            error: 'Failed to compute desk metrics',
            skipped,
          });
          return;
        }

        res.status(403).json({
          error: 'None of the selected desks have metrics available',
          skipped,
        });
        return;
      }

      const aggregate = aggregateDeskMetrics(contributions);
      res.json({ ...aggregate, skipped } satisfies DeskMetricsAggregateResponse);
    } catch (error) {
      logger.error('[DeskMetrics] Failed to compute aggregate metrics', { channelIds, error });
      res.status(500).json({ error: 'Failed to compute desk metrics' });
    }
  };
}

export const deskMetricsController = new DeskMetricsController();
