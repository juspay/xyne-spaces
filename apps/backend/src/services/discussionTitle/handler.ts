import { Request, Response } from 'express';
import { checkDiscussionTitle } from './index';

export const discussionTitleHandler = async (req: Request, res: Response): Promise<void> => {
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

  const { text } = req.body as { text: string };
  const data = await checkDiscussionTitle(text, { userId, workspaceId }, abandoned.signal);
  if (abandoned.signal.aborted) return;
  res.json({ success: true, data });
};
