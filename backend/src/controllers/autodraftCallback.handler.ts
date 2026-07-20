import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { emailService } from '@/services/emailService';
import { db } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';

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
    // Webhook callback → no HTTP tenant scope. Resolve the channel's workspace and run the writes
    // (email_drafts create in persistAutoDraft) inside a tenant context so workspaceId is stamped.
    // The channel MUST exist for this callback to be meaningful — fail loud (alertable error log +
    // throw, caught below as 500) rather than silently persist an untenanted draft.
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true },
    });
    if (!channel?.workspaceId) {
      logger.error('[AutoDraft] callback: channel not found or missing workspaceId — cannot scope draft write', {
        mode: 'autodraft',
        conversationId,
        channelId,
        sessionId,
        channelFound: !!channel,
      });
      throw new Error(`AutoDraft callback: channel ${channelId} not found or has no workspaceId`);
    }
    const runScoped = <T>(fn: () => Promise<T>): Promise<T> =>
      runWithContext({ userId: 'autodraft-callback', workspaceId: channel.workspaceId }, fn);

    if (status !== 'completed' || !result || !result.trim()) {
      logger.warn('[AutoDraft] callback skip: non-success or empty result', {
        mode: 'autodraft',
        conversationId,
        channelId,
        sessionId,
        status,
        error,
      });
      await runScoped(() => emailService.clearAutoDraftGenerating(conversationId));
      res.json({ success: true, persisted: false });
      return;
    }

    await runScoped(() =>
      emailService.persistAutoDraft({
        conversationId,
        channelId,
        summary: result,
        sessionId,
      }),
    );

    res.json({ success: true, persisted: true });
  } catch (err) {
    logger.error('[AutoDraft] callback failed', {
      mode: 'autodraft',
      conversationId,
      channelId,
      sessionId,
      error: err,
    });
    res.status(500).json({ success: false, error: 'failed to persist auto-draft' });
  }
}
