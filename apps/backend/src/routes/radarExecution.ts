import { Router, type Request, type Response } from 'express';
import { logger } from '@/utils/logger';
import { RadarActionError, radarManualActions } from '@/services/radar/radarManualActions';
import { radarFeedService } from '@/services/radar/radarFeedService';
import { radarTeamService } from '@/services/radar/radarTeamService';

const router = Router();

function getAuthContext(req: Request): { userId: string; workspaceId: string } | null {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

function handleActionError(res: Response, err: RadarActionError): void {
  res
    .status(err.code === 'not-found' ? 404 : 400)
    .json({ success: false, error: err.message });
}

router.post('/items/:itemId/resolve', async (req: Request<{ itemId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const result = await radarManualActions.resolveItem(auth, req.params.itemId);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof RadarActionError) {
      handleActionError(res, err);
      return;
    }
    logger.error('[radar-execution] resolve failed:', err);
    res.status(500).json({ success: false, error: 'Failed to resolve execution item' });
  }
});

router.post(
  '/threads/:conversationId/resolve-all',
  async (req: Request<{ conversationId: string }>, res: Response) => {
    try {
      const auth = getAuthContext(req);
      if (!auth) {
        sendUnauthorized(res);
        return;
      }
      const result = await radarManualActions.resolveAllInThread(auth, req.params.conversationId);
      res.json({ success: true, data: result });
    } catch (err) {
      if (err instanceof RadarActionError) {
        handleActionError(res, err);
        return;
      }
      logger.error('[radar-execution] resolve-all failed:', err);
      res.status(500).json({ success: false, error: 'Failed to resolve thread items' });
    }
  },
);

router.get('/feed/pending-me', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const threads = await radarFeedService.pendingMe(auth);
    res.json({ success: true, data: { threads } });
  } catch (err) {
    logger.error('[radar-execution] pending-me feed failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load feed' });
  }
});

router.get('/teams', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    res.json({ success: true, data: { teams: await radarTeamService.listTeams(auth) } });
  } catch (err) {
    logger.error('[radar-execution] list teams failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list teams' });
  }
});

router.post('/teams', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const { name, memberIds } = req.body as { name?: unknown; memberIds?: unknown };
    if (typeof name !== 'string' || !Array.isArray(memberIds) || memberIds.some(id => typeof id !== 'string')) {
      res.status(400).json({ success: false, error: 'name and memberIds[] are required' });
      return;
    }
    const team = await radarTeamService.createTeam(auth, name, memberIds);
    res.json({ success: true, data: team });
  } catch (err) {
    if (err instanceof RadarActionError) {
      handleActionError(res, err);
      return;
    }
    logger.error('[radar-execution] create team failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create team' });
  }
});

router.patch('/teams/:teamId', async (req: Request<{ teamId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const { name, memberIds } = req.body as { name?: unknown; memberIds?: unknown };
    if (typeof name !== 'string' || !Array.isArray(memberIds) || memberIds.some(id => typeof id !== 'string')) {
      res.status(400).json({ success: false, error: 'name and memberIds[] are required' });
      return;
    }
    const team = await radarTeamService.updateTeam(auth, req.params.teamId, name, memberIds);
    res.json({ success: true, data: team });
  } catch (err) {
    if (err instanceof RadarActionError) {
      handleActionError(res, err);
      return;
    }
    logger.error('[radar-execution] update team failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update team' });
  }
});

router.delete('/teams/:teamId', async (req: Request<{ teamId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    await radarTeamService.deleteTeam(auth, req.params.teamId);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof RadarActionError) {
      handleActionError(res, err);
      return;
    }
    logger.error('[radar-execution] delete team failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete team' });
  }
});

router.get('/feed/team/:teamId', async (req: Request<{ teamId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const items = await radarTeamService.teamFeed(auth, req.params.teamId);
    res.json({ success: true, data: { items } });
  } catch (err) {
    if (err instanceof RadarActionError) {
      handleActionError(res, err);
      return;
    }
    logger.error('[radar-execution] team feed failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load team feed' });
  }
});

router.get('/debug/items/:itemId', async (req: Request<{ itemId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const trail = await radarFeedService.debugItemTrail(auth, req.params.itemId);
    if (!trail) {
      res.status(404).json({ success: false, error: 'Execution item not found' });
      return;
    }
    res.json({ success: true, data: trail });
  } catch (err) {
    logger.error('[radar-execution] debug item trail failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load item trail' });
  }
});

router.get('/debug/runs', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const conversationId =
      typeof req.query.conversationId === 'string' ? req.query.conversationId.trim() : '';
    if (!conversationId) {
      // Debug is per-thread by design — there is no workspace-wide listing.
      res.status(400).json({ success: false, error: 'conversationId is required' });
      return;
    }
    const result = await radarFeedService.debugRuns(auth, conversationId);
    if (!result) {
      res.status(404).json({ success: false, error: 'Thread not found' });
      return;
    }
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('[radar-execution] debug runs failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load debug runs' });
  }
});

router.get('/feed/waiting-on', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const threads = await radarFeedService.waitingOn(auth);
    res.json({ success: true, data: { threads } });
  } catch (err) {
    logger.error('[radar-execution] waiting-on feed failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load feed' });
  }
});

export default router;
