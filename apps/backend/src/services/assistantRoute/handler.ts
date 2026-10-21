import { Request, Response } from 'express';
import { routeAssistantMessage, type AssistantRouteAction, type AssistantRouteMode } from './index';

// Always 200 once validated: a Jev failure is `{ route: 'unavailable' }`, never a 5xx.
export const assistantRouteHandler = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  if (!workspaceId) {
    res.status(403).json({ success: false, error: 'Forbidden: workspace context required' });
    return;
  }

  const abandoned = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abandoned.abort();
  });

  const { text, actions, mode } = req.body as {
    text: string;
    actions: AssistantRouteAction[];
    mode?: AssistantRouteMode;
  };
  const result = await routeAssistantMessage(
    text,
    actions,
    { userId, workspaceId },
    abandoned.signal,
    mode
  );
  if (abandoned.signal.aborted) return;
  res.json(result);
};
