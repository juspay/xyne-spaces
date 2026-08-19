import { Router, type Request, type Response } from 'express';
import { logger } from '@/utils/logger';
import {
  conversationLabelLifecycleService,
  ConversationLabelLifecycleError,
} from '@/automations/services/conversation-label-lifecycle.service';

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

function handleLifecycleError(res: Response, err: ConversationLabelLifecycleError): void {
  if (err.code === 'not-found') {
    res.status(404).json({ success: false, error: err.message });
    return;
  }
  if (err.code === 'forbidden') {
    res.status(403).json({ success: false, error: err.message });
    return;
  }
  res.status(409).json({
    success: false,
    error: err.message,
    code: 'label_in_use',
    data: err.impact,
  });
}

router.get('/:labelId/delete-impact', async (req: Request<{ labelId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const impact = await conversationLabelLifecycleService.getDeleteImpact(
      auth,
      req.params.labelId,
    );
    res.json({ success: true, data: impact, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ConversationLabelLifecycleError) {
      handleLifecycleError(res, err);
      return;
    }
    logger.error('[conversation-labels] delete-impact failed:', err);
    res.status(500).json({ success: false, error: 'Failed to calculate label delete impact' });
  }
});

router.delete('/:labelId', async (req: Request<{ labelId: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const result = await conversationLabelLifecycleService.deleteLabel(auth, req.params.labelId);
    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ConversationLabelLifecycleError) {
      handleLifecycleError(res, err);
      return;
    }
    logger.error('[conversation-labels] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete label' });
  }
});

export default router;
