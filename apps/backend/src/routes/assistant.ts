import { Router, type Request, type Response } from 'express';
import { performance } from 'node:perf_hooks';
import { turnRequestSchema, type TurnResponse } from '@xyne/shared/assistant';
import {
  assistantServices,
  handleTurn,
  isAssistantOn,
  jevConnection,
  type AssistantRequestDiagnostics,
} from '@/services/assistant';
import {
  getAssistantTurnDuration,
  getAssistantTurnsTotal,
  type AssistantTurnAttributes,
} from '@/services/otel/assistantMetrics';
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
  if (!(await isAssistantOn(user.workspaceId, user.id))) {
    res.status(503).json({ error: 'The assistant is turned off right now.' });
    return;
  }
  const parsed = turnRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'This request is not a valid assistant turn.' });
    return;
  }

  const { sessionId, requestId, input, context } = parsed.data;
  const startedAt = performance.now();
  const diagnostics: AssistantRequestDiagnostics = { jevMs: [] };
  const services = assistantServices(
    {
      workspaceId: user.workspaceId,
      userId: user.id,
      role: user.role,
    },
    diagnostics
  );
  try {
    const response = await handleTurn(
      input,
      { workspaceId: user.workspaceId, userId: user.id, sessionId },
      services,
      context
    );
    const durationMs = elapsed(startedAt);
    const outcome = outcomeOf(response);
    record({ input: input.kind, outcome }, durationMs);
    if (services.debug) {
      response.debug = {
        ...(response.debug ?? {}),
        timings: { backendMs: durationMs, jevMs: diagnostics.jevMs },
      };
    }
    // Metadata only: what the user said stays out of the logs.
    logger.info('[assistant] turn', {
      requestId,
      input: input.kind,
      outcome,
      durationMs,
      jevMs: diagnostics.jevMs,
    });
    res.json(response);
  } catch (error) {
    const durationMs = elapsed(startedAt);
    record({ input: input.kind, outcome: 'failed' }, durationMs);
    logger.error('[assistant] turn failed', {
      requestId,
      input: input.kind,
      durationMs,
      jevMs: diagnostics.jevMs,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof UnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

function outcomeOf(response: TurnResponse): string {
  if (response.run) return 'plan';
  if (response.tone === 'error') return 'error';
  return response.expectsReply ? 'question' : 'reply';
}

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function record(attributes: AssistantTurnAttributes, durationMs: number): void {
  getAssistantTurnsTotal().add(1, attributes);
  getAssistantTurnDuration().record(durationMs, attributes);
}

export default router;
