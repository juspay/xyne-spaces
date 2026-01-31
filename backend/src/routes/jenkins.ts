import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { jenkinsService } from '../services/jenkinsService';
import { logger } from '@/utils/logger';

const router = Router();

const triggerBuildSchema = z.object({
  branch: z.string().min(1).regex(/^[a-zA-Z0-9\-_\/]+$/, 'Invalid branch name'),
  parameters: z.record(z.string()).optional(),
});

router.post('/trigger', async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = triggerBuildSchema.parse(req.body);
    const { branch, parameters } = validatedData;

    const result = await jenkinsService.triggerBuild(branch, parameters);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message || 'Build triggered successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to trigger build',
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid input',
        details: error.errors.map((e) => e.message),
      });
      return;
    }
    logger.error('Error in POST /api/jenkins/trigger', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

router.get('/builds/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const branch = req.query.branch as string | undefined;

    if (!branch) {
      res.status(400).json({
        success: false,
        error: 'Branch is required',
      });
      return;
    }

    const build = await jenkinsService.getLatestBuild(branch);

    if (build) {
      res.status(200).json({
        success: true,
        build,
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'No builds found',
      });
    }
  } catch (error) {
    logger.error('Error in GET /api/jenkins/builds/latest', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

router.get('/builds/:buildNumber/stages', async (req: Request, res: Response): Promise<void> => {
  try {
    const buildNumber = parseInt(req.params.buildNumber, 10);
    const branch = req.query.branch as string | undefined;

    if (isNaN(buildNumber)) {
      res.status(400).json({
        success: false,
        error: 'Invalid build number',
      });
      return;
    }

    if (!branch) {
      res.status(400).json({
        success: false,
        error: 'Branch is required',
      });
      return;
    }

    const stages = await jenkinsService.getBuildStages(buildNumber, branch);

    res.status(200).json({
      success: true,
      stages,
      count: stages.length,
    });
  } catch (error) {
    logger.error('Error in GET /api/jenkins/builds/:buildNumber/stages', {
      error: error instanceof Error ? error.message : 'Unknown error',
      buildNumber: req.params.buildNumber,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
