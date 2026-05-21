import { Request, Response } from 'express';
import axios from 'axios';
import { logger } from '@/utils/logger';
import { mettleTeamMembersService } from '@/services/mettleTeamMembersService';

export class MettleTeamMembersController {
  private static instance: MettleTeamMembersController;

  private constructor() {}

  public static getInstance(): MettleTeamMembersController {
    if (!MettleTeamMembersController.instance) {
      MettleTeamMembersController.instance = new MettleTeamMembersController();
    }
    return MettleTeamMembersController.instance;
  }

  getTeamMembers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { teamName } = req.query;

      if (!teamName || typeof teamName !== 'string' || teamName.trim().length === 0) {
        res.status(400).json({
          error: 'teamName query parameter is required and must be a non-empty string',
        });
        return;
      }

      const trimmedTeamName = teamName.trim();

      logger.info(`Fetching team members for teamName: ${trimmedTeamName}`);

      const teamMembers = await mettleTeamMembersService.fetchTeamMembersFromMettle(trimmedTeamName);

      res.status(200).json(teamMembers);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 500;
        const data = error.response?.data ?? {
          error: 'Failed to fetch team members from Mettle',
        };

        logger.error('[MettleTeamMembersController] Axios error while fetching team members', {
          status,
          data,
        });

        res.status(status).json(data);
        return;
      }

      if (error instanceof Error) {
        logger.error(`[MettleTeamMembersController] Error: ${error.message}`);
        res.status(500).json({
          error: 'Failed to fetch team members',
          message: error.message,
        });
        return;
      }

      logger.error('[MettleTeamMembersController] Unknown error while fetching team members');
      res.status(500).json({
        error: 'Failed to fetch team members',
      });
    }
  };
}

export const mettleTeamMembersController = MettleTeamMembersController.getInstance();
