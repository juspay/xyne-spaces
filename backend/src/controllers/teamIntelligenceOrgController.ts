import { Request, Response } from 'express';
import { teamIntelligenceOrgRepository } from '@/database/repositories/teamIntelligenceOrgRepository';
import { logger } from '@/utils/logger';

export class TeamIntelligenceOrgController {
  /**
   * GET /api/team-intelligence-dashboard/org/summary
   *
   * Query params:
   *   from  - ISO date string (required)  e.g. 2026-05-01
   *   to    - ISO date string (required)  e.g. 2026-05-20
   *
  * Response:
  *   orgSummary - flattened list of org summary text lines (string[])
  *   prMerged   - list of merged PR summaries/titles (string[])
  *   aiUsages   - summed token/spend fields across all users in that range
   */
  getOrgSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };

      if (!from || !to) {
        res.status(400).json({ error: 'Both "from" and "to" query parameters are required' });
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

      const result = await teamIntelligenceOrgRepository.getDashboardSummary({
        from: fromDate,
        to: toDate,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getOrgSummary error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/org/bullets
   *
   * Query params:
   *   from  - ISO date string (required) e.g. 2026-05-19
   *   to    - ISO date string (required) e.g. 2026-05-20
   *   page  - page number (optional, default 1)
   *   limit - page size (optional, default 20, max 200)
   *
   * Response:
  *   from, to, page, limit, total, totalPages,
  *   bullets[] where each bullet includes bulletTitle, bulletText, bulletCat and provenance fields
   */
  getOrgBullets = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, page: pageRaw, limit: limitRaw } = req.query as {
        from?: string;
        to?: string;
        page?: string;
        limit?: string;
      };

      if (!from || !to) {
        res.status(400).json({ error: 'Both "from" and "to" query parameters are required' });
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

      const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '20', 10) || 20));

      const result = await teamIntelligenceOrgRepository.getOrgBulletsByDate({
        from: fromDate,
        to: toDate,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getOrgBullets error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/org/teams
   *
   * Query params:
   *   from  - ISO date string (required) e.g. 2026-05-18
   *   to    - ISO date string (required) e.g. 2026-05-20
   *
   * Response:
   *   from, to, teams[] where each team includes summaryText[], prCount, and commitCount
   */
  getOrgTeams = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };

      if (!from || !to) {
        res.status(400).json({ error: 'Both "from" and "to" query parameters are required' });
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

      const result = await teamIntelligenceOrgRepository.getOrgTeamsByDate({
        from: fromDate,
        to: toDate,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getOrgTeams error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const teamIntelligenceOrgController = new TeamIntelligenceOrgController();
