import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { teamIntelligenceUserDashboardService } from '@/services/teamIntelligenceUserDashboardService';

export class TeamIntelligenceUserController {
  /**
   * GET /api/team-intelligence-dashboard/user/details?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com&page=1&limit=20
   */
  getUserDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, userEmail, page: pageRaw, limit: limitRaw } = req.query as {
        from?: string;
        to?: string;
        userEmail?: string;
        page?: string;
        limit?: string;
      };

      if (!from || !to || !userEmail) {
        res.status(400).json({ error: '"from", "to", and "userEmail" query parameters are required' });
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

      const trimmedEmail = userEmail.trim();
      if (!trimmedEmail) {
        res.status(400).json({ error: '"userEmail" must not be empty' });
        return;
      }

      const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '20', 10) || 20));

      const result = await teamIntelligenceUserDashboardService.getUserDetails({
        from: fromDate,
        to: toDate,
        userEmail: trimmedEmail,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserDetails error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/user/pull-requests?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com&page=1&limit=20
   */
  getUserPullRequests = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, userEmail, page: pageRaw, limit: limitRaw } = req.query as {
        from?: string;
        to?: string;
        userEmail?: string;
        page?: string;
        limit?: string;
      };

      if (!from || !to || !userEmail) {
        res.status(400).json({ error: '"from", "to", and "userEmail" query parameters are required' });
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

      const trimmedEmail = userEmail.trim();
      if (!trimmedEmail) {
        res.status(400).json({ error: '"userEmail" must not be empty' });
        return;
      }

      const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, Number.parseInt(limitRaw ?? '20', 10) || 20));

      const result = await teamIntelligenceUserDashboardService.getUserPullRequests({
        from: fromDate,
        to: toDate,
        userEmail: trimmedEmail,
        page,
        limit,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserPullRequests error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/user/overview?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com
   */
  getUserOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, userEmail } = req.query as {
        from?: string;
        to?: string;
        userEmail?: string;
      };

      if (!from || !to || !userEmail) {
        res.status(400).json({ error: '"from", "to", and "userEmail" query parameters are required' });
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

      const trimmedEmail = userEmail.trim();
      if (!trimmedEmail) {
        res.status(400).json({ error: '"userEmail" must not be empty' });
        return;
      }

      const result = await teamIntelligenceUserDashboardService.getUserOverview({
        from: fromDate,
        to: toDate,
        userEmail: trimmedEmail,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserOverview error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const teamIntelligenceUserController = new TeamIntelligenceUserController();
