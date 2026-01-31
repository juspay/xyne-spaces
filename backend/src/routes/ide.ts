import { Router, Request, Response } from 'express';
import { workspaceService, heartbeatService } from '@/services/ide';
import { logger } from '@/utils/logger';
import '@/types/express'; // Import the Express type extensions

const router = Router();

/**
 * POST /api/ide/open-workspace
 * Create a new workspace by cloning a repo and checking out a branch
 */
router.post('/open-workspace', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let { repoUrl, branch } = req.body;

    branch = "main"

    if (!repoUrl || !branch) {
      res.status(400).json({ 
        error: 'Missing required fields',
        message: 'repoUrl and branch are required'
      });
      return;
    }

    logger.info(`[IDE] Opening workspace for user ${userId}`, { repoUrl, branch });

    const result = await workspaceService.createWorkspace({
      repoUrl,
      branch,
      userId,
    });

    res.status(201).json({
      success: true,
      workspaceId: result.workspaceId,
      codeServerUrl: result.codeServerUrl,
      workspace: result.workspace,
    });
  } catch (error) {
    logger.error('[IDE] Failed to open workspace:', error);
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = message.includes('Maximum workspace limit') ? 429 : 500;

    res.status(statusCode).json({
      error: 'Failed to open workspace',
      message,
    });
  }
});

/**
 * GET /api/ide/workspaces
 * List all active workspaces for the current user
 */
router.get('/workspaces', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const workspaces = await workspaceService.getUserWorkspaces(userId);

    res.status(200).json({
      success: true,
      workspaces,
      count: workspaces.length,
    });
  } catch (error) {
    logger.error('[IDE] Failed to list workspaces:', error);
    res.status(500).json({
      error: 'Failed to list workspaces',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/ide/workspaces/:id
 * Get details for a specific workspace
 */
router.get('/workspaces/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const workspace = await workspaceService.getWorkspace(id);

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Verify ownership
    if (workspace.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.status(200).json({
      success: true,
      workspace,
    });
  } catch (error) {
    logger.error('[IDE] Failed to get workspace:', error);
    res.status(500).json({
      error: 'Failed to get workspace',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/ide/workspaces/:id
 * Delete a workspace and clean up files
 */
router.delete('/workspaces/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const workspace = await workspaceService.getWorkspace(id);

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Verify ownership
    if (workspace.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await workspaceService.deleteWorkspace(id);

    res.status(200).json({
      success: true,
      message: 'Workspace deleted successfully',
    });
  } catch (error) {
    logger.error('[IDE] Failed to delete workspace:', error);
    res.status(500).json({
      error: 'Failed to delete workspace',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/ide/workspaces/:id/heartbeat
 * Update heartbeat for a workspace (HTTP fallback if WebSocket unavailable)
 */
router.post('/workspaces/:id/heartbeat', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const workspace = await workspaceService.getWorkspace(id);

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (workspace.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const success = await workspaceService.updateHeartbeat(id);

    res.status(200).json({
      success,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error('[IDE] Failed to update heartbeat:', error);
    res.status(500).json({
      error: 'Failed to update heartbeat',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/ide/stats
 * Get IDE service statistics (admin/debug endpoint)
 */
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const heartbeatStats = heartbeatService.getStats();

    res.status(200).json({
      success: true,
      heartbeat: heartbeatStats,
    });
  } catch (error) {
    logger.error('[IDE] Failed to get stats:', error);
    res.status(500).json({
      error: 'Failed to get stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
