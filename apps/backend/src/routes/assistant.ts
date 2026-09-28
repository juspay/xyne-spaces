import { Router, type Request, type Response } from 'express';
import { turnRequestSchema } from '@xyne/shared/assistant';
import { assistantServices, handleTurn, jevConnection } from '@/services/assistant';
import { UnavailableError } from '@/services/assistant/records';
import { logger } from '@/utils/logger';

/**
 * The voice and text assistant. One endpoint: the dashboard sends each turn here and gets
 * back what to say, show, or run. Mounted behind `authMiddleware.authenticate`, so lookups
 * run with the user's own permissions.
 */
const router = Router();

router.post('/turn', async (req: Request, res: Response) => {
  const user = req.user;
  if (!user?.id || !user.workspaceId) {
    res.status(401).json({ error: 'Sign in to use the assistant.' });
    return;
  }
  if (!jevConnection()) {
    res.status(503).json({ error: 'The assistant is not set up on this server.' });
    return;
  }
  const parsed = turnRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'This request is not a valid assistant turn.' });
    return;
  }

  const { sessionId, requestId, input, context } = parsed.data;
  const startedAt = Date.now();
  try {
    const response = await handleTurn(
      input,
      { workspaceId: user.workspaceId, userId: user.id, sessionId },
      assistantServices(user.id),
      context
    );
    // Metadata only: what the user said stays out of the logs.
    logger.info('[assistant] turn', {
      requestId,
      input: input.kind,
      ranPlan: Boolean(response.run),
      durationMs: Date.now() - startedAt,
    });
    res.json(response);
  } catch (error) {
    logger.error('[assistant] turn failed', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof UnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
