import { Request, Response } from 'express';
import { classifyQueryIntent } from './index';

/** GET /api/vespaSearch/intent?q= → `{ success, data: QueryIntent | null }` */
export const queryIntentHandler = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.id;
  const workspaceId = (req as any).user?.workspaceId;
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  if (!workspaceId) {
    res.status(403).json({ success: false, error: 'Forbidden: workspace context required' });
    return;
  }

  const intent = await classifyQueryIntent(req.query.q as string, { userId, workspaceId });
  res.json({ success: true, data: intent });
};
