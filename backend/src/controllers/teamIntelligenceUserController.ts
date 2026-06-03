import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { teamIntelligenceUserDashboardService } from '@/services/teamIntelligenceUserDashboardService';

// Validation schema for user dashboard queries
const UserDashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '"from" must be in YYYY-MM-DD format'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '"to" must be in YYYY-MM-DD format'),
  userEmail: z.string().email('Invalid email format for userEmail'),
  page: z.string().optional().transform(val => val ? parseInt(val, 10) : 1),
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 10),
});

const MettleExtendedEmployeeQuerySchema = z.object({
  email: z.string().email('Invalid email format for email'),
});

export class TeamIntelligenceUserController {
  /**
   * GET /api/team-intelligence-dashboard/user/mettle-extended-info?email=user@example.com
   */
  getUserMettleExtendedInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = MettleExtendedEmployeeQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parseResult.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }

      if (!config.mettleApiBaseUrl) {
        logger.error('[TeamIntelligenceUser] METTLE_API_BASE_URL not configured');
        res.status(500).json({ error: 'Mettle API base URL not configured' });
        return;
      }

      if (!config.mettleToken) {
        logger.error('[TeamIntelligenceUser] METTLE_TOKEN not configured');
        res.status(500).json({ error: 'Mettle token not configured' });
        return;
      }

      const encodedEmail = encodeURIComponent(parseResult.data.email.trim());
      const upstreamUrl = `${config.mettleApiBaseUrl}/api/external/employees/info/extended?email=${encodedEmail}`;

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          mettleToken: config.mettleToken,
        },
      });

      const responseBody = await upstreamResponse.text();
      const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';

      if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
        logger.warn('[TeamIntelligenceUser] Mettle upstream authorization failed', {
          status: upstreamResponse.status,
          email: parseResult.data.email,
        });
        res.status(500).json({ error: 'Bad gateway: Mettle authorization failed' });
        return;
      }

      res.status(upstreamResponse.status);
      res.setHeader('content-type', contentType);
      res.send(responseBody);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserMettleExtendedInfo error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/user/details?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com&page=1&limit=20
   */
  getUserDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = UserDashboardQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parseResult.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }

      const { from, to, userEmail, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const clampedPage = Math.max(1, page);
      const clampedLimit = Math.min(200, Math.max(1, limit));

      const result = await teamIntelligenceUserDashboardService.getUserDetails({
        from: fromDate,
        to: toDate,
        userEmail,
        page: clampedPage,
        limit: clampedLimit,
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
      const parseResult = UserDashboardQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parseResult.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }

      const { from, to, userEmail, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const clampedPage = Math.max(1, page);
      const clampedLimit = Math.min(200, Math.max(1, limit));

      const result = await teamIntelligenceUserDashboardService.getUserPullRequests({
        from: fromDate,
        to: toDate,
        userEmail,
        page: clampedPage,
        limit: clampedLimit,
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
      const OverviewSchema = UserDashboardQuerySchema.omit({ page: true, limit: true });
      const parseResult = OverviewSchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parseResult.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }

      const { from, to, userEmail } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const result = await teamIntelligenceUserDashboardService.getUserOverview({
        from: fromDate,
        to: toDate,
        userEmail,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserOverview error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/user/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com&page=1&limit=10
   */
  getUserChannelRecaps = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = UserDashboardQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parseResult.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
        });
        return;
      }

      const { from, to, userEmail, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (fromDate > toDate) {
        res.status(400).json({ error: '"from" must be before or equal to "to"' });
        return;
      }

      const clampedPage = Math.max(1, page);
      const clampedLimit = Math.min(200, Math.max(1, limit));

      const result = await teamIntelligenceUserDashboardService.getUserChannelRecaps({
        from: fromDate,
        to: toDate,
        userEmail,
        page: clampedPage,
        limit: clampedLimit,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserChannelRecaps error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const teamIntelligenceUserController = new TeamIntelligenceUserController();
