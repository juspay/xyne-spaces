import { Request, Response } from 'express';
import { applicationBackfillService } from '@/services/release/applicationBackfillService';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';

export class ApplicationBackfillController {
  /**
   * Backfill applications for a project
   * POST /api/admin/applications/backfill
   * 
   * Body:
   * {
   *   "channelId": "ch_123abc",
   *   "mainReleaseBoardId": "board_parent_123",
   *   "applications": [
   *     {
   *       "name": "backend",
   *       "regex": "^backend/",
   *       "repoUrl": "https://github.com/org/repo",
   *       "deployedCommit": "#main",
   *       "ownerTeam": "backend-team"
   *     }
   *   ]
   * }
   */
  async backfillApplications(req: Request, res: Response): Promise<void> {
    try {
      const { channelId, mainReleaseBoardId, applications } = req.body;

      if (!channelId) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'channelId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!applications || !Array.isArray(applications) || applications.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'applications array is required and must not be empty',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!mainReleaseBoardId) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'mainReleaseBoardId is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Validate each application object
      for (const app of applications) {
        if (!app.name || !app.regex || !app.repoUrl || !app.deployedCommit || !app.ownerTeam) {
          res.status(400).json({
            success: false,
            error: 'Validation error',
            message: 'Each application must have: name, regex, repoUrl, deployedCommit, and ownerTeam',
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }

      logger.info('Backfill applications request received', {
        channelId,
        applicationsCount: applications.length,
        userId: req.user?.id,
      });

      const result = await applicationBackfillService.backfillApplications(
        applications,
        channelId,
        mainReleaseBoardId,
        req.user!.id
      );

      res.status(200).json({
        success: true,
        message: 'Application backfill completed successfully',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Application backfill failed:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      res.status(500).json({
        success: false,
        error: 'Application backfill failed',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all applications for a project
   * GET /api/admin/applications?projectName=xyne-spaces
   */
  async getApplications(req: Request, res: Response): Promise<void> {
    const { projectName = 'xyne-spaces' } = req.query;

    logger.info('Get applications request received', {
      projectName,
      userId: req.user?.id,
    });

    try {
      const project = await db.project.findFirst({
        where: { name: projectName as string },
      });

      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
          message: `Project "${projectName}" not found`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const applications = await db.application.findMany({
        where: { projectId: project.id },
        orderBy: { name: 'asc' },
      });

      res.status(200).json({
        success: true,
        data: {
          projectId: project.id,
          projectName: project.name,
          applications,
          count: applications.length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Get applications failed:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      res.status(500).json({
        success: false,
        error: 'Failed to get applications',
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export const applicationBackfillController = new ApplicationBackfillController();
