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
   * GET /channels/:channelId/metrics?timeRange=today|7d|30d|90d|YYYY-MM-DD_YYYY-MM-DD
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

      const ALLOWED_TIME_RANGES = ['24h', '7d'] as const;
      type AllowedTimeRange = typeof ALLOWED_TIME_RANGES[number];
      const rawTimeRange = typeof req.query.timeRange === 'string' ? req.query.timeRange : '7d';
      if (!ALLOWED_TIME_RANGES.includes(rawTimeRange as AllowedTimeRange)) {
        res.status(400).json({ error: `Invalid timeRange. Allowed values: ${ALLOWED_TIME_RANGES.join(', ')}` });
        return;
      }
      const timeRange = rawTimeRange;
      const assigneeId = typeof req.query.assigneeId === 'string' ? req.query.assigneeId : null;

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
      });

      res.json(metrics);
    } catch (error) {
      logger.error('[DeskMetrics] Failed to compute metrics', { channelId, error });
      res.status(500).json({ error: 'Failed to compute desk metrics' });
    }
  };
}

export const deskMetricsController = new DeskMetricsController();
