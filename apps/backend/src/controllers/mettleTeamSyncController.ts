import { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { mettleTeamSyncService } from '@/services/mettleTeamSyncService';

export class MettleTeamSyncController {
  /**
   * GET /api/team-intelligence-dashboard/org/mettle-teams
   * Fetch list of teams from Mettle API
   */
  getTeamsFromMettle = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await mettleTeamSyncService.fetchTeamsFromMettle();

      res.status(200).json({
        success: true,
        data: result.teams,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[MettleTeamSync] getTeamsFromMettle error', { error });

      if (error instanceof Error && error.message.includes('METTLE_TOKEN')) {
        res.status(500).json({
          success: false,
          error: 'Mettle API token is not configured',
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'Failed to fetch teams from Mettle',
      });
    }
  };
}

export const mettleTeamSyncController = new MettleTeamSyncController();
