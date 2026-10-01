import { Request, Response } from 'express';
import { answerCmdkQuery, type CmdkAnswerEvent } from './index';

export const cmdkAnswerHandler = async (req: Request, res: Response): Promise<void> => {
  const user = req.user;
  const userId = user?.id;
  const workspaceId = user?.workspaceId;
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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Content-Encoding', 'none');
  res.socket?.setNoDelay(true);
  res.flushHeaders();

  const emit = (event: CmdkAnswerEvent): void => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    (res as Response & { flush?: () => void }).flush?.();
  };

  const auth = {
    userId,
    workspaceId,
    ...(user?.role ? { role: user.role } : {}),
    ...(user?.orgRole ? { orgRole: user.orgRole } : {}),
    ...(user?.memberId ? { memberId: user.memberId } : {}),
  };
  await answerCmdkQuery((req.body as { q: string }).q, { auth }, emit, abandoned.signal);
  if (!res.writableEnded) res.end();
};
