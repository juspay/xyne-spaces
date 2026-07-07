import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { teamIntelligenceTeamDashboardService } from '@/services/teamIntelligenceTeamDashboardService';

export class TeamIntelligenceTeamController {
  private parseTeamId(req: Request): { teamId?: string; error?: string } {
    const { teamId } = req.query as { teamId?: string };
    const trimmedTeamId = teamId?.trim();
    if (trimmedTeamId) {
      return { teamId: trimmedTeamId };
    }

    return { error: '"teamId" query parameter is required' };
  }

  /**
   * GET /api/team-intelligence-dashboard/team/bullets?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123&page=1&limit=20
   *
   * Response:
   *   from, to, teamId, teamName, page, limit, total, totalPages,
   *   bullets[] where bullets are flattened provenance bullets for the team.
   */
  getTeamBullets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, page: pageRaw, limit: limitRaw } = req.query as {
        from?: string;
        to?: string;
        page?: string;
        limit?: string;
      };

      if (!from || !to) {
        res.status(400).json({ error: '"from" and "to" query parameters are required' });
        return;
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        res.status(400).json({ error: '"from" and "to" must be valid ISO date strings' });
        return;
      }

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const teamQuery = this.parseTeamId(req);
      if (teamQuery.error || !teamQuery.teamId) {
        res.status(400).json({ error: '"teamId" query parameter is required' });
        return;
      }

      const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '20', 10) || 20));

      const result = await teamIntelligenceTeamDashboardService.getTeamBullets({
        from: fromDate,
        to: toDate,
        teamId: teamQuery.teamId,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamBullets error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/pr?from=YYYY-MM-DD&to=YYYY-MM-DD&prId=3110
   *
   * Response:
   *   from, to, prId, total, matches[] where each match includes full pullRequest object.
   */
  getPrByDate = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, prId: prIdRaw } = req.query as {
        from?: string;
        to?: string;
        prId?: string;
      };

      if (!from || !to || !prIdRaw) {
        res.status(400).json({ error: '"from", "to", and "prId" query parameters are required' });
        return;
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        res.status(400).json({ error: '"from" and "to" must be valid ISO date strings' });
        return;
      }

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const prId = Number.parseInt(prIdRaw, 10);
      if (!Number.isFinite(prId)) {
        res.status(400).json({ error: '"prId" must be a valid integer' });
        return;
      }

      const result = await teamIntelligenceTeamDashboardService.getPrByDate({
        from: fromDate,
        to: toDate,
        prId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getPrByDate error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
  * GET /api/team-intelligence-dashboard/team/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123
   *
   * Response:
   *   from, to, teamId, teamName, totalPrCount, totalCommitCount, aiUsages
   */
  getTeamUsageSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to } = req.query as {
        from?: string;
        to?: string;
      };

      if (!from || !to) {
        res.status(400).json({ error: '"from" and "to" query parameters are required' });
        return;
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        res.status(400).json({ error: '"from" and "to" must be valid ISO date strings' });
        return;
      }

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const teamQuery = this.parseTeamId(req);
      if (teamQuery.error || !teamQuery.teamId) {
        res.status(400).json({ error: '"teamId" query parameter is required' });
        return;
      }

      const result = await teamIntelligenceTeamDashboardService.getTeamUsageSummary({
        from: fromDate,
        to: toDate,
        teamId: teamQuery.teamId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamUsageSummary error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=10
   * Provide `teamId` as a query parameter.
   */
  getTeamChannelRecaps = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, page: pageRaw, limit: limitRaw } = req.query as {
        from?: string;
        to?: string;
        page?: string;
        limit?: string;
      };

      if (!from || !to) {
        res.status(400).json({ error: '"from" and "to" query parameters are required' });
        return;
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        res.status(400).json({ error: '"from" and "to" must be valid ISO date strings' });
        return;
      }

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const teamQuery = this.parseTeamId(req);
      if (teamQuery.error || !teamQuery.teamId) {
        res.status(400).json({ error: '"teamId" query parameter is required' });
        return;
      }

      const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '10', 10) || 10));

      const result = await teamIntelligenceTeamDashboardService.getTeamChannelRecaps({
        from: fromDate,
        to: toDate,
        teamId: teamQuery.teamId,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamChannelRecaps error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/channel-tickets?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=10
   * Provide `teamId` as a query parameter.
   */
  getTeamChannelTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, page: pageRaw, limit: limitRaw } = req.query as {
        from?: string;
        to?: string;
        page?: string;
        limit?: string;
      };

      if (!from || !to) {
        res.status(400).json({ error: '"from" and "to" query parameters are required' });
        return;
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        res.status(400).json({ error: '"from" and "to" must be valid ISO date strings' });
        return;
      }

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const teamQuery = this.parseTeamId(req);
      if (teamQuery.error || !teamQuery.teamId) {
        res.status(400).json({ error: '"teamId" query parameter is required' });
        return;
      }

      const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '10', 10) || 10));

      const result = await teamIntelligenceTeamDashboardService.getTeamChannelTickets({
        from: fromDate,
        to: toDate,
        teamId: teamQuery.teamId,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamChannelTickets error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const teamIntelligenceTeamController = new TeamIntelligenceTeamController();
