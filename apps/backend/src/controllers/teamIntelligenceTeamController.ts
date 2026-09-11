import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { teamIntelligenceTeamDashboardService } from '@/services/teamIntelligenceTeamDashboardService';
import {
  leadershipSectionNames,
  paginateLeadershipSection,
} from '@/utils/teamIntelligenceLeadershipSections';
import {
  formatTeamIntelligenceQueryErrors,
  TeamBulletsQuerySchema,
  TeamChannelQuerySchema,
  TeamDateRangeQuerySchema,
  TeamLeadershipSectionQuerySchema,
  TeamPrQuerySchema,
} from '@/validation/teamIntelligenceDashboardQuerySchemas';

export class TeamIntelligenceTeamController {
  private async resolveCallerOrgId(req: Request): Promise<string | null> {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      logger.warn('[TeamIntelligenceTeam] resolveCallerOrgId: no workspaceId on request');
      return null;
    }
    const mapping = await db.workspaceOrganization.findFirst({
      where: { workspaceId },
      select: { orgId: true },
    });
    if (!mapping?.orgId) {
      logger.warn('[TeamIntelligenceTeam] resolveCallerOrgId: no org mapping found for caller workspace');
      return null;
    }
    logger.info('[TeamIntelligenceTeam] resolveCallerOrgId: org context resolved for caller, applying org filter');
    return mapping.orgId;
  }

  /** Returns one independently paginated section from the newest team snapshot. */
  getTeamLeadershipSection = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = TeamLeadershipSectionQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }
      const section = req.params.section;
      if (!section || !leadershipSectionNames('team').includes(section)) {
        res.status(400).json({
          error: 'Unknown team leadership section',
          sections: leadershipSectionNames('team'),
        });
        return;
      }

      const { from, to, teamId, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const result = await teamIntelligenceTeamDashboardService.getTeamLeadershipSnapshots({
        from: fromDate,
        to: toDate,
        teamId,
        orgId,
      });
      const snapshot = result.snapshots[0];
      if (!snapshot?.summary) {
        logger.warn('[TeamIntelligenceTeam] No team leadership snapshot found for caller org', {
          endpoint: 'getTeamLeadershipSection',
          section,
          teamId,
          from,
          to,
        });
        res.status(404).json({ error: 'No team leadership snapshot found' });
        return;
      }

      res.status(200).json({
        snapshotId: snapshot.id,
        ...paginateLeadershipSection({
          scope: 'team',
          section,
          summary: snapshot.summary,
          page,
          limit,
        }),
      });
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamLeadershipSection error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/bullets?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123&page=1&limit=20
   */
  getTeamBullets = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = TeamBulletsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, teamId, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const result = await teamIntelligenceTeamDashboardService.getTeamBullets({
        from: fromDate,
        to: toDate,
        teamId,
        orgId,
        page,
        limit,
      });
      if (result.total === 0) {
        logger.warn('[TeamIntelligenceTeam] No team bullets found for caller org', {
          endpoint: 'getTeamBullets',
          teamId,
          from,
          to,
          page,
          limit,
        });
      }
      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamBullets error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/leadership-snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123
   */
  getTeamLeadershipSnapshots = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = TeamDateRangeQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, teamId } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const result = await teamIntelligenceTeamDashboardService.getTeamLeadershipSnapshots({
        from: fromDate,
        to: toDate,
        teamId,
        orgId,
      });
      if (!result.snapshots || result.snapshots.length === 0) {
        logger.warn('[TeamIntelligenceTeam] No team leadership snapshots found for caller org', {
          endpoint: 'getTeamLeadershipSnapshots',
          teamId,
          from,
          to,
        });
      }
      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamLeadershipSnapshots error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/pr?from=YYYY-MM-DD&to=YYYY-MM-DD&prId=3110
   */
  getPrByDate = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = TeamPrQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, prId } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const result = await teamIntelligenceTeamDashboardService.getPrByDate({
        from: fromDate,
        to: toDate,
        prId,
        orgId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getPrByDate error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123
   */
  getTeamUsageSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = TeamDateRangeQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, teamId } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const result = await teamIntelligenceTeamDashboardService.getTeamUsageSummary({
        from: fromDate,
        to: toDate,
        teamId,
        orgId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamUsageSummary error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123&page=1&limit=10
   */
  getTeamChannelRecaps = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = TeamChannelQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, teamId, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const result = await teamIntelligenceTeamDashboardService.getTeamChannelRecaps({
        from: fromDate,
        to: toDate,
        teamId,
        page,
        limit,
        workspaceId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamChannelRecaps error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/team/channel-tickets?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=team-123&page=1&limit=10
   */
  getTeamChannelTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = TeamChannelQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, teamId, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const result = await teamIntelligenceTeamDashboardService.getTeamChannelTickets({
        from: fromDate,
        to: toDate,
        teamId,
        page,
        limit,
        workspaceId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceTeam] getTeamChannelTickets error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const teamIntelligenceTeamController = new TeamIntelligenceTeamController();
