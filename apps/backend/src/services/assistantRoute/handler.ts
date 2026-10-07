import { Request, Response } from 'express';
import {
  routeAssistantMessage,
  type AssistantRouteAction,
  type AssistantRoutePending,
} from './index';

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

  const startedAt = performance.now();
  const result = await routeAssistantMessage(
    req.body as { text: string; actions: AssistantRouteAction[]; pending?: AssistantRoutePending },
    { userId, workspaceId },
    abandoned.signal
  );
  if (abandoned.signal.aborted) return;
  // Lets the client tell this time from the network, auth and proxy time around it.
  res.setHeader('Server-Timing', `route;dur=${Math.round(performance.now() - startedAt)}`);
  res.json(result);
};
