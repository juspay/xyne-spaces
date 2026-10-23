/**
 * v2 `POST /claw/runs`: start an agent run as the caller, and return at once.
 *
 * v1 dispatches through the agent's Spaces app (a signed webhook), so an agent
 * without one — any agent just created — cannot run there. v2 calls claw-auth's
 * own `POST /run` instead, as the caller's session (see `session.ts`): any agent
 * the caller can see runs, attributed to them, exactly as from the Claw UI.
 * `detached: true` makes claw-auth answer as soon as the run is queued; the
 * result lands on the run record, which `GET /claw/runs/:sessionId` reads.
 *
 * Same path, body and answer as v1, so a client does not change.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getClawBaseUrl } from '@/services/clawAgentService';
import { SdkApiError } from '../errors';
import { handle } from '../handler';
import { upstreamError } from './proxy';
import { clawSession } from './session';

const runBody = z.object({
  agent: z.string().min(1),
  task: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  /** Also post the agent's reply into this Spaces channel. */
  channelId: z.string().min(1).optional(),
  context: z.string().optional(),
});

async function startRun(req: Request, res: Response): Promise<void> {
  req.sdkCall = { op: 'POST /claw/runs', kind: 'direct' };
  const input = runBody.parse(req.body);
  const session = clawSession(req);

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${getClawBaseUrl()}/claw/api/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        cookie: session.cookie,
        'x-workspace-id': session.workspaceId,
        ...(req.apiRequestId ? { 'x-request-id': req.apiRequestId } : {}),
      },
      body: JSON.stringify({
        agentSlug: input.agent,
        task: input.task,
        detached: true,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.context ? { context: input.context } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new SdkApiError('internal', 'Claw is unreachable.', { cause: err });
  }
  if (upstream.status >= 400) throw await upstreamError(upstream, '/run');

  const body = (await upstream.json().catch(() => ({}))) as { sessionId?: unknown };
  if (typeof body.sessionId !== 'string' || !body.sessionId) {
    throw new SdkApiError('internal', 'Claw accepted the run but returned no session id.');
  }
  res.status(200).json({ sessionId: body.sessionId });
}

export function createClawRunsRouter(): Router {
  const router = Router();
  router.post('/claw/runs', handle(startRun));
  return router;
}
