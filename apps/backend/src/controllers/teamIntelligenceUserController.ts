import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { teamIntelligenceUserDashboardService } from '@/services/teamIntelligenceUserDashboardService';
import {
  leadershipSectionNames,
  paginateLeadershipSection,
} from '@/utils/teamIntelligenceLeadershipSections';

// Validation schema for user dashboard queries
const UserDashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '"from" must be in YYYY-MM-DD format'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '"to" must be in YYYY-MM-DD format'),
  userEmail: z.string().email('Invalid email format for userEmail'),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 10)),
});

const MettleExtendedEmployeeQuerySchema = z.object({
  email: z.string().email('Invalid email format for email'),
});

export class TeamIntelligenceUserController {
  /** Returns one independently paginated section from the newest user snapshot. */
  getUserLeadershipSection = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = UserDashboardQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({ error: 'Validation error', details: parseResult.error.errors });
        return;
      }
      const section = req.params.section;
      if (!section || !leadershipSectionNames('user').includes(section)) {
        res.status(400).json({
          error: 'Unknown user leadership section',
          sections: leadershipSectionNames('user'),
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
      const orgId = await this.assertEmailInWorkspace(userEmail, req, res);
      if (orgId === false) return;

      const result = await teamIntelligenceUserDashboardService.getUserLeadershipSnapshots({
        from: fromDate,
        to: toDate,
        userEmail,
        orgId,
      });
      const snapshot = result.snapshots[0];
      if (!snapshot) {
        res.status(404).json({ error: 'No user leadership snapshot found' });
        return;
      }

      res.status(200).json({
        snapshotId: snapshot.id,
        ...paginateLeadershipSection({
          scope: 'user',
          section,
          summary: snapshot.summary,
          page: Math.max(1, page),
          limit: Math.min(100, Math.max(1, limit)),
        }),
      });
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserLeadershipSection error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  /**
   * Ensures the requested email belongs to a user in the caller's workspace.
   * Returns the caller's orgId on success, or false (and writes a 403) on
   * failure. The orgId is used to scope all Team Intelligence data queries
   * so users only see data ingested for their own organisation.
   */
  private assertEmailInWorkspace = async (
    email: string,
    req: Request,
    res: Response
  ): Promise<string | false> => {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(403).json({ error: 'Access denied' });
      return false;
    }

    const target = await db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, workspaceId },
      select: { id: true },
    });

    if (!target) {
      res.status(403).json({ error: 'Access denied' });
      return false;
    }

    const mapping = await db.workspaceOrganization.findFirst({
      where: { workspaceId },
      select: { orgId: true },
    });

    return mapping?.orgId ?? false;
  };

  /**
   * GET /api/team-intelligence-dashboard/user/mettle-extended-info?email=user@example.com
   */
  getUserMettleExtendedInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = MettleExtendedEmployeeQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parseResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }

      if ((await this.assertEmailInWorkspace(parseResult.data.email, req, res)) === false) {
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
          details: parseResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
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

      const orgId = await this.assertEmailInWorkspace(userEmail, req, res);
      if (orgId === false) {
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
        orgId,
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
          details: parseResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
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

      const orgId = await this.assertEmailInWorkspace(userEmail, req, res);
      if (orgId === false) {
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
        orgId,
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
          details: parseResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
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

      const orgId = await this.assertEmailInWorkspace(userEmail, req, res);
      if (orgId === false) {
        return;
      }

      const result = await teamIntelligenceUserDashboardService.getUserOverview({
        from: fromDate,
        to: toDate,
        userEmail,
        orgId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserOverview error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/user/leadership-snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD&userEmail=user@example.com
   */
  getUserLeadershipSnapshots = async (req: Request, res: Response): Promise<void> => {
    try {
      const LeadershipSnapshotSchema = UserDashboardQuerySchema.omit({ page: true, limit: true });
      const parseResult = LeadershipSnapshotSchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: parseResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
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

      const orgId = await this.assertEmailInWorkspace(userEmail, req, res);
      if (orgId === false) {
        return;
      }

      const result = await teamIntelligenceUserDashboardService.getUserLeadershipSnapshots({
        from: fromDate,
        to: toDate,
        userEmail,
        orgId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserLeadershipSnapshots error', { err });
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
          details: parseResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
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

      const orgId = await this.assertEmailInWorkspace(userEmail, req, res);
      if (orgId === false) {
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
        orgId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceUser] getUserChannelRecaps error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const teamIntelligenceUserController = new TeamIntelligenceUserController();
