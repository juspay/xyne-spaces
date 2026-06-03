import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { emailService } from '@/services/emailService';

export async function handleAutoDraftCallback(
  req: Request<{ conversationId: string; channelId: string }>,
  res: Response,
): Promise<void> {
  const { conversationId, channelId } = req.params;
  const payload = (req.body ?? {}) as {
    sessionId?: string;
    status?: string;
    result?: string;
    error?: string;
  };

  const { sessionId, status, result, error } = payload;

  logger.info('[AutoDraft] callback received', {
    mode: 'autodraft',
    conversationId,
    channelId,
    sessionId,
    status,
    resultLen: result?.length ?? 0,
  });

  try {
    if (status !== 'completed' || !result || !result.trim()) {
      logger.warn('[AutoDraft] callback skip: non-success or empty result', {
        mode: 'autodraft',
        conversationId,
        channelId,
        sessionId,
        status,
        error,
      });
      res.json({ success: true, persisted: false });
      return;
    }

    await emailService.persistAutoDraft({
      conversationId,
      channelId,
      summary: result,
      sessionId,
    });

    res.json({ success: true, persisted: true });
  } catch (err) {
    logger.error('[AutoDraft] callback failed', {
      mode: 'autodraft',
      conversationId,
      channelId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ success: false, error: 'failed to persist auto-draft' });
  }
}
