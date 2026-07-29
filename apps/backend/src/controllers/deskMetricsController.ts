/**
 * Desk Metrics Controller
 * Hardcoded per-desk-channel metrics (FRT, RT, CSAT, counts, priority,
 * activity), computed from ticket_activities. Gated on the per-desk
 * metricsEnabled preference so desks that never opted in cost nothing.
 */

import { Request, Response } from 'express';
import { deskMetricsRepository } from '../database/repositories/deskMetricsRepository.js';
import { EmailChannelPreferenceRepository } from '../database/repositories/emailChannelPreferenceRepository.js';
import { ChannelParticipantRepository } from '../database/repositories/channelParticipantRepository.js';
import { ChannelRepository } from '../database/repositories/channelRepository.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_RANGE_MS = 31 * DAY_MS;

export class DeskMetricsController {
  private channelRepo = new ChannelRepository();
  private channelParticipantRepo = new ChannelParticipantRepository();
  private preferenceRepo = new EmailChannelPreferenceRepository();

  private async assertChannelAccess(
    req: Request,
    channelId: string,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;

    if (!userId || !workspaceId) {
      return { ok: false, status: 401, error: 'Authentication required' };
    }

    const channel = await this.channelRepo.findById(channelId);
    if (!channel || channel.workspaceId !== workspaceId) {
      return { ok: false, status: 404, error: 'Channel not found' };
    }

    const isParticipant = await this.channelParticipantRepo.isParticipant(channelId, userId);
    if (!isParticipant) {
      return { ok: false, status: 403, error: 'Not a member of this channel' };
    }

    return { ok: true };
  }

  /**
   * GET /channels/:channelId/metrics?timeRange=startMs_endMs
   */
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

      const defaultEndMs = Date.now();
      const rawTimeRange =
        typeof req.query.timeRange === 'string'
          ? req.query.timeRange
          : `${defaultEndMs - 7 * DAY_MS}_${defaultEndMs}`;
      const parts = rawTimeRange.split('_');
      if (parts.length !== 2) {
        res.status(400).json({ error: 'Invalid timeRange. Use startMs_endMs' });
        return;
      }
      const fromMs = Number(parts[0]);
      const toMs = Number(parts[1]);
      const from = new Date(fromMs);
      const to = new Date(toMs);
      if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
        res.status(400).json({ error: 'Invalid time range' });
        return;
      }
      if (toMs - fromMs > MAX_CUSTOM_RANGE_MS) {
        res.status(400).json({ error: 'Custom time range cannot exceed 31 days' });
        return;
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

      const frtStageNames: string[] = (() => {
        try {
          const parsed: unknown = JSON.parse(preference.frtStageNames ?? '[]');
          return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
        } catch {
          return [];
        }
      })();

      const metrics = await deskMetricsRepository.getMetrics({
        channelId,
        timeRange,
        frtStageNames,
        assigneeId,
        customFieldFilter,
      });

      res.json(metrics);
    } catch (error) {
      logger.error('[DeskMetrics] Failed to compute metrics', { channelId, error });
      res.status(500).json({ error: 'Failed to compute desk metrics' });
    }
  };
}

export const deskMetricsController = new DeskMetricsController();