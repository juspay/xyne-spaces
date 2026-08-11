/**
 * Routes for ambient intent suggestions.
 *
 *  - `handleIntentSuggest`  — user-authenticated, called by the dashboard when the
 *    on-device classifier clears its threshold.
 *  - `handleIntentCallback` — S2S, called by claw-auth with the agent's answer.
 *
 * See services/intentSuggestionService.ts and apps/dashboard/docs/ON_DEVICE_INTENT.md
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import {
  dispatchIntentSuggestion,
  handleIntentAgentResult,
} from '@/services/intentSuggestionService';

const suggestBodySchema = z.object({
  messageId: z.string().min(1),
  intentId: z.string().min(1),
  /** Advisory only — recorded for correlation, never used as a gate. */
  score: z.number().min(0).max(1),
});

export async function handleIntentSuggest(req: Request, res: Response): Promise<void> {
  const parsed = suggestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, workspaceId: true, orgMemberId: true, name: true, email: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const outcome = await dispatchIntentSuggestion({
      messageId: parsed.data.messageId,
      intentId: parsed.data.intentId,
      score: parsed.data.score,
      user,
    });

    // A declined suggestion is a normal outcome, not an error — the client did
    // nothing wrong and must not surface anything to the user.
    res.json({ ok: true, ...outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[intent] suggest failed', {
      messageId: parsed.data.messageId,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Still 200: this path is fire-and-forget and ambient. A 500 would show up as
    // a console error on every send for something the user never asked for.
    //
    // Outside production the message rides along, because the backend logs only to
    // console and this endpoint is the one place a developer can actually see why
    // an ambient suggestion died. Never in production — it can carry query and
    // connection detail.
    res.json({
      ok: false,
      dispatched: false,
      reason: 'internal-error',
      ...(process.env['NODE_ENV'] !== 'production' && { detail: message.slice(0, 300) }),
    });
  }
}

export async function handleIntentCallback(
  req: Request<{ messageId: string; intentId: string }>,
  res: Response,
): Promise<void> {
  const { messageId, intentId } = req.params;
  const payload = (req.body ?? {}) as {
    sessionId?: string;
    status?: string;
    result?: string;
    error?: string;
  };

  logger.info('[intent] callback received', {
    messageId,
    intentId,
    sessionId: payload.sessionId,
    status: payload.status,
    resultLen: payload.result?.length ?? 0,
  });

  // Ack first-class: claw retries on non-2xx, and a retry cannot help a run that
  // failed or returned nothing useful.
  if (payload.status !== 'completed' || !payload.result?.trim()) {
    logger.warn('[intent] callback skipped', {
      messageId,
      status: payload.status,
      error: payload.error,
    });
    res.json({ ok: true, posted: false, reason: 'run-not-completed' });
    return;
  }

  try {
    const outcome = await handleIntentAgentResult({
      messageId,
      intentId,
      rawResult: payload.result,
    });
    res.json({ ok: true, ...outcome });
  } catch (err) {
    logger.error('[intent] callback failed', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Internal error' });
  }
}
