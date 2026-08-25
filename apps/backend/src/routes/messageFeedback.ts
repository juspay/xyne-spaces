import { Router, type Request, type Response } from 'express';
import { UserType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

/**
 * Agent-response feedback (no-DB, telemetry-only).
 *
 * A workspace member clicks 👍 / 👎 on an agent's reply. We do NOT persist the
 * feedback — instead we emit a single structured log line that lands in
 * VictoriaLogs, groupable by `agentName`. The agent name is resolved
 * server-side from the message's sender so it cannot be spoofed by the client.
 *
 * Mounted at /api/messages (behind authMiddleware.authenticate), so the full
 * path is: POST /api/messages/:messageId/feedback  body: { value: 'like' | 'unlike' }
 */
const router = Router();
const prisma = DatabaseClient.getInstance();

type FeedbackValue = 'like' | 'unlike';

router.post('/:messageId/feedback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { messageId } = req.params;
    const { value } = req.body as { value?: string };
    const feedbackByUserId = req.user!.id;

    if (!messageId) {
      res.status(400).json({ error: 'messageId is required' });
      return;
    }
    if (value !== 'like' && value !== 'unlike') {
      res.status(400).json({ error: "value must be 'like' or 'unlike'" });
      return;
    }
    const feedbackValue = value as FeedbackValue;

    // Resolve the message and its sender server-side. This keeps the logged
    // agentName authoritative (client cannot inject an arbitrary name) and lets
    // us reject feedback on non-agent messages.
    const message = await prisma.message.findUnique({
      where: { messageId },
      select: {
        messageId: true,
        senderId: true,
        conversationId: true,
        workspaceId: true,
        msgType: true,
      },
    });
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const sender = await prisma.user.findUnique({
      where: { id: message.senderId },
      select: { id: true, name: true, userType: true },
    });

    // Only agent-authored messages can receive agent feedback. Agents post
    // either as a BOT message type or as a BOT/APP user.
    const isAgentMessage =
      message.msgType === 'BOT' ||
      sender?.userType === UserType.BOT ||
      sender?.userType === UserType.APP;
    if (!isAgentMessage) {
      res.status(400).json({ error: 'Feedback is only supported on agent messages' });
      return;
    }

    logger.info('agent_feedback', {
      event: 'agent_feedback',
      value: feedbackValue,
      messageId: message.messageId,
      conversationId: message.conversationId,
      workspaceId: message.workspaceId,
      agentName: sender?.name ?? 'unknown',
      agentUserId: message.senderId,
      feedbackByUserId,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Error recording agent feedback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
