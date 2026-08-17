/**
 * Desk Metrics Controller
 * Hardcoded per-desk-channel metrics (FRT, RT, CSAT, counts, priority,
 * activity), computed from ticket_activities. Gated on the per-desk
 * metricsEnabled preference so desks that never opted in cost nothing.
 */

import { Request, Response } from 'express';
import { deskMetricsRepository } from '../database/repositories/deskMetricsRepository.js';
import { EmailChannelPreferenceRepository } from '../database/repositories/emailChannelPreferenceRepository.js';
import { ChannelRepository } from '../database/repositories/channelRepository.js';
import { assertChannelMembership } from '@/utils/channelMembership';
import {
  aggregateDeskMetrics,
  type DeskMetricsContribution,
} from '../services/deskMetricsAggregator.js';
import { logger } from '../utils/logger.js';
import { DESK_METRICS_MAX_AGGREGATE_DESKS } from '@xyne/shared';
import type {
  DeskMetricsAggregateResponse,
  DeskMetricsResponse,
  DeskMetricsSkippedDesk,
} from '@xyne/shared';

const DAY_MS = 24 * 60 * 60 * 1000;
// Keep in sync with MAX_CUSTOM_DAYS in the dashboard's DeskMetricsDateRangePicker.
const MAX_CUSTOM_RANGE_DAYS = 90;
// +1 day of slack: the UI sends whole days (00:00 → 23:59:59.999), so a
// 90-day selection spans a hair under 90 * DAY_MS + the trailing day.
const MAX_CUSTOM_RANGE_MS = (MAX_CUSTOM_RANGE_DAYS + 1) * DAY_MS;

type CustomFieldFilterArg = {
  keys: string[];
  perKeyFilters?: Record<string, { values?: string[]; textTerms?: string[] }>;
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
    | { ok: true; timeRange: string; assigneeId: string | null; customFieldFilter?: CustomFieldFilterArg }
    | { ok: false; error: string } {
      const defaultEndMs = Date.now();
      const rawTimeRange =
        typeof req.query.timeRange === 'string'
          ? req.query.timeRange
          : `${defaultEndMs - 7 * DAY_MS}_${defaultEndMs}`;
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
      const assigneeId = typeof req.query.assigneeId === 'string' ? req.query.assigneeId : null;

      const parseJsonStringArray = (raw: string): string[] => {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed)) return [];
          return parsed.filter((v): v is string => typeof v === 'string');
        } catch {
          return [];
        }
      };
      const rawKeys = typeof req.query.customFieldKeys === 'string' ? req.query.customFieldKeys : '';
      const customFieldKeys = parseJsonStringArray(rawKeys);

      const parsePerKeyFilters = (raw: string): Record<string, { values?: string[]; textTerms?: string[] }> => {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
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
        } catch { return {}; }
      };

      const rawPerKey = typeof req.query.customFieldPerKeyFilters === 'string' ? req.query.customFieldPerKeyFilters : '';
      const perKeyFilters = rawPerKey ? parsePerKeyFilters(rawPerKey) : {};
      const customFieldFilter =
        customFieldKeys.length > 0
          ? { keys: customFieldKeys, ...(Object.keys(perKeyFilters).length > 0 ? { perKeyFilters } : {}) }
          : undefined;

      return {
        ok: true,
        timeRange,
        assigneeId,
        ...(customFieldFilter ? { customFieldFilter } : {}),
      };
  }

  private async metricsForChannel(
    channelId: string,
    preference: { frtStageNames?: string | null },
    query: { timeRange: string; assigneeId: string | null; customFieldFilter?: CustomFieldFilterArg },
  ): Promise<DeskMetricsResponse> {
    const frtStageNames: string[] = (() => {
      try {
        const parsed: unknown = JSON.parse(preference.frtStageNames ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
      } catch {
        return [];
      }
    })();

    return deskMetricsRepository.getMetrics({
      channelId,
      timeRange: query.timeRange,
      frtStageNames,
      assigneeId: query.assigneeId,
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

  getAggregateMetrics = async (req: Request, res: Response): Promise<void> => {
    const rawIds = typeof req.query.channelIds === 'string' ? req.query.channelIds : '';
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
