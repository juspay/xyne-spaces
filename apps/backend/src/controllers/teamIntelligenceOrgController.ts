import { Request, Response } from 'express';
import { teamIntelligenceOrgRepository } from '@/database/repositories/teamIntelligenceOrgRepository';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import {
  leadershipSectionNames,
  paginateLeadershipSection,
} from '@/utils/teamIntelligenceLeadershipSections';
import { teamIntelligenceGoalGroupingService } from '@/services/teamIntelligenceGoalGroupingService';
import {
  formatTeamIntelligenceQueryErrors,
  OrgBulletsQuerySchema,
  OrgChannelRecapsQuerySchema,
  OrgDateRangeQuerySchema,
  OrgLeadershipSectionQuerySchema,
} from '@/validation/teamIntelligenceDashboardQuerySchemas';

export class TeamIntelligenceOrgController {
  private async resolveCallerOrgId(req: Request): Promise<string | null> {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      logger.warn('[TeamIntelligenceOrg] resolveCallerOrgId: no workspaceId on request');
      return null;
    }
    const mapping = await db.workspaceOrganization.findFirst({
      where: { workspaceId },
      select: { orgId: true },
    });
    if (!mapping?.orgId) {
      logger.warn('[TeamIntelligenceOrg] resolveCallerOrgId: no org mapping found for caller workspace');
      return null;
    }
    logger.info('[TeamIntelligenceOrg] resolveCallerOrgId: org context resolved for caller, applying org filter');
    return mapping.orgId;
  }

  /** Groups teams by their highest active goal track and all available evidence. */
  getTeamGoalGroups = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const result = await teamIntelligenceGoalGroupingService.getTeamGoalGroups(orgId);
      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getTeamGoalGroups error', { err });
      res.status(500).json({ error: 'Failed to group teams by goals' });
    }
  };

  /** Returns one independently paginated section from the newest snapshot in the range. */
  getOrgLeadershipSection = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = OrgLeadershipSectionQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }
      const section = req.params.section;
      if (!section || !leadershipSectionNames('org').includes(section)) {
        res.status(400).json({
          error: 'Unknown organization leadership section',
          sections: leadershipSectionNames('org'),
        });
        return;
      }

      const { from, to, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const result = await teamIntelligenceOrgRepository.getOrgLeadershipSnapshotsByDate({
        orgId,
        from: fromDate,
        to: toDate,
      });
      const snapshot = result.snapshots[0];
      if (!snapshot) {
        logger.warn('[TeamIntelligenceOrg] No org leadership snapshot found for caller org', {
          endpoint: 'getOrgLeadershipSection',
          section,
          from,
          to,
        });
        res.status(404).json({ error: 'No organization leadership snapshot found' });
        return;
      }

      res.status(200).json({
        snapshotId: snapshot.id,
        ...paginateLeadershipSection({
          scope: 'org',
          section,
          summary: snapshot.summary,
          page,
          limit,
        }),
      });
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getOrgLeadershipSection error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/org/leadership-snapshots
   *
   * Returns the strict, evidence-backed organization leadership JSON generated
   * from compact team summaries. Existing summary and bullet endpoints remain
   * available for legacy clients.
   */
  getOrgLeadershipSnapshots = async (req: Request, res: Response): Promise<void> => {
    try {
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const parseResult = OrgDateRangeQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);

      const result = await teamIntelligenceOrgRepository.getOrgLeadershipSnapshotsByDate({
        orgId,
        from: fromDate,
        to: toDate,
      });
      if (result.snapshots.length === 0) {
        logger.warn('[TeamIntelligenceOrg] No org leadership snapshots found for caller org', {
          endpoint: 'getOrgLeadershipSnapshots',
          from,
          to,
        });
      }
      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getOrgLeadershipSnapshots error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/org/summary
   *
   * Query params:
   *   from  - ISO date string (required)  e.g. 2026-05-01
   *   to    - ISO date string (required)  e.g. 2026-05-20
   *
   * Response:
   *   orgSummary - flattened list of org summary text lines (string[])
   *   prTotal    - list of PR summaries/titles in the selected range (string[])
   *   aiUsages   - summed token/spend fields across all users in that range
   */
  getOrgSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = OrgDateRangeQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const result = await teamIntelligenceOrgRepository.getDashboardSummary({
        from: fromDate,
        to: toDate,
        orgId,
      });
      if (!result || (Array.isArray(result.orgSummary) && result.orgSummary.length === 0)) {
        logger.warn('[TeamIntelligenceOrg] No org summary data found for caller org', {
          endpoint: 'getOrgSummary',
          from,
          to,
        });
      }
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
      const parseResult = OrgBulletsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const result = await teamIntelligenceOrgRepository.getOrgBulletsByDate({
        from: fromDate,
        to: toDate,
        page,
        limit,
        orgId,
      });
      if (result.total === 0) {
        logger.warn('[TeamIntelligenceOrg] No org bullets found for caller org', {
          endpoint: 'getOrgBullets',
          from,
          to,
          page,
          limit,
        });
      }
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
      const parseResult = OrgDateRangeQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const orgId = await this.resolveCallerOrgId(req);
      if (!orgId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const result = await teamIntelligenceOrgRepository.getOrgTeamsByDate({
        from: fromDate,
        to: toDate,
        orgId,
      });
      if (!result.teams || result.teams.length === 0) {
        logger.warn('[TeamIntelligenceOrg] No org teams found for caller org', {
          endpoint: 'getOrgTeams',
          from,
          to,
        });
      }
      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getOrgTeams error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/team-intelligence-dashboard/org/channel-recaps?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=10
   *
   * Response:
   *   from, to, page, limit, total, totalPages,
   *   recaps[] - paginated channel recaps across all channels,
   *   ticketMetrics - counts only (totalCount, solvedCount, todoCount, startedCount, pausedCount, cancelledCount, overdueCount)
   */
  getOrgChannelRecaps = async (req: Request, res: Response): Promise<void> => {
    try {
      const parseResult = OrgChannelRecapsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: formatTeamIntelligenceQueryErrors(parseResult.error),
        });
        return;
      }

      const { from, to, page, limit } = parseResult.data;
      const fromDate = new Date(from);
      const toDate = new Date(to);
      const workspaceId = req.user?.workspaceId;
      if (!workspaceId) {
        res.status(403).json({ error: 'Workspace context is required' });
        return;
      }

      const result = await teamIntelligenceOrgRepository.getOrgChannelRecaps({
        from: fromDate,
        to: toDate,
        page,
        limit,
        workspaceId,
      });

      res.status(200).json(result);
    } catch (err) {
      logger.error('[TeamIntelligenceOrg] getOrgChannelRecaps error', { err });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const teamIntelligenceOrgController = new TeamIntelligenceOrgController();
