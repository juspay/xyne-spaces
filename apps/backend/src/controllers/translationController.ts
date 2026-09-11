import { Request, Response } from 'express';
import { messageTranslationQueue } from '@/queues/translationQueue';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export class TranslationController {
  /**
   * A viewer clicked "Translate" on a message.
   *
   * Enqueues the on-demand translation job and returns immediately (202) — the
   * actual translated text arrives via the client's live Zero query once the
   * worker (already holding the model warm) finishes the job, same reactive path
   * every other message field updates through. No polling, no waiting here.
   *
   * POST /api/messages/:messageId/translate
   */
  async requestTranslation(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      const { targetLang } = req.body as { targetLang?: string };

      if (!messageId || !targetLang) {
        res.status(400).json({ error: 'messageId and targetLang are required' });
        return;
      }

      const message = await db.message.findUnique({
        where: { messageId },
        select: { messageId: true },
      });
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      await messageTranslationQueue.enqueueOnDemandTranslation(messageId, targetLang);
      res.status(202).json({ status: 'queued' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to request translation', details: String(error) });
    }
  }

  /**
   * A viewer thumbs-up/down'd a cached translation. `message_translations` is a
   * shared cache keyed by (messageId, targetLang) — not per-viewer — so this feedback
   * is last-write-wins across everyone who sees that cached translation, same as the
   * translation itself.
   *
   * POST /api/messages/:messageId/translation-feedback
   */
  async submitFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      const { targetLang, feedback } = req.body as {
        targetLang?: string;
        feedback?: 'up' | 'down' | null;
      };

      if (!messageId || !targetLang) {
        res.status(400).json({ error: 'messageId and targetLang are required' });
        return;
      }
      if (feedback !== 'up' && feedback !== 'down' && feedback !== null) {
        res.status(400).json({ error: "feedback must be 'up', 'down', or null" });
        return;
      }

      const translation = await db.messageTranslation.findUnique({
        where: { messageId_targetLang: { messageId, targetLang } },
        select: { workspaceId: true },
      });
      if (!translation || translation.workspaceId !== req.user?.workspaceId) {
        res.status(404).json({ error: 'Translation not found' });
        return;
      }

      await db.messageTranslation.update({
        where: { messageId_targetLang: { messageId, targetLang } },
        data: { feedback },
      });

      logger.info('[TranslationFeedback] Recorded', {
        messageId,
        targetLang,
        feedback,
        userId: req.user?.id,
      });
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to submit feedback', details: String(error) });
    }
  }
}
