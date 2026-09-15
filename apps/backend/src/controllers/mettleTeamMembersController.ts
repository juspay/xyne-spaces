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
      const { teamId, page: pageRaw, limit: limitRaw } = req.query;

      if (!teamId || typeof teamId !== 'string' || teamId.trim().length === 0) {
        res.status(400).json({
          error: 'teamId query parameter is required and must be a non-empty string',
        });
        return;
      }

      const trimmedTeamId = teamId.trim();

      logger.info(`Fetching team members for teamId: ${trimmedTeamId}`);

      const teamMembers = await mettleTeamMembersService.fetchTeamMembersFromMettle(trimmedTeamId);
      const page = Math.max(1, Number.parseInt(String(pageRaw ?? '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(String(limitRaw ?? '12'), 10) || 12));
      const allMembers = teamMembers.employee_list ?? [];
      const total = allMembers.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
      const start = (safePage - 1) * limit;

      res.status(200).json({
        ...teamMembers,
        employee_list: allMembers.slice(start, start + limit),
        pagination: { page: safePage, limit, total, totalPages },
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const upstreamStatus = error.response?.status;
        const data = error.response?.data ?? {
          error: 'Failed to fetch team members from Mettle',
        };

        logger.error('[MettleTeamMembersController] Axios error while fetching team members', {
          upstreamStatus,
          data,
        });

        res.status(502).json({
          error: 'Failed to fetch team members from Mettle',
          upstreamStatus,
          message: data,
        });
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
