/**
 * `POST /claw/runs/stream`: run an agent and stream its turn as it happens.
 *
 * The same path Ask AI v2 takes (`runClawAgentStream` → claw-auth
 * `/run/stream`), so an SDK caller receives exactly the frames the dashboard
 * does, minus the debugger's. It is a typed route rather than a proxied one
 * because claw-auth's `/run/stream` needs the caller's name, email, workspace
 * and provider, which the server knows and the SDK should not have to send.
 *
 * Frames are `data: {"type": ...}` lines:
 *   start            { sessionId: conversation id, traceId: run session id }
 *   delta            { content, partId? }
 *   reasoning_delta  { reasoningDelta, partId? }
 *   tool_invocation  { toolInvocation }
 *   plan             { todos, title? }
 *   attachment       { attachment }
 *   ui_flow          { flow }
 *   complete         { sessionId, content, status, messageId?, userMessageId?, attachments?, ... }
 *   follow_ups       { followUpSuggestions, messageId? }
 *   error            { error }
 *   ping             every 20 s, to keep proxies from closing an idle stream
 *   end              always last
 *
 * `POST /claw/runs/stream/cancel { sessionId }` stops a run; `sessionId` is the
 * `traceId` from `start`.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  cancelClawAgentRun,
  runClawAgentStream,
  type ClawRunRequest,
} from '@/services/clawAgentService';
import { logger } from '@/utils/logger';
import { buildAuthData } from '../direct';
import { SdkApiError } from '../errors';
import { handle } from '../handler';
import { clawSession } from './session';

const PING_INTERVAL_MS = 20_000;

const runStreamBody = z.object({
  /** Agent slug. */
  agent: z.string().min(1),
  task: z.string().min(1),
  /** Continue an earlier conversation: the `sessionId` from its `start` frame. */
  conversationId: z.string().min(1).optional(),
  /** A Spaces channel the run is about; the agent reads it as context. */
  channelId: z.string().min(1).optional(),
  provider: z.enum(['spaces', 'copilot', 'claude', 'codex']).optional(),
  canvasIds: z.array(z.string()).optional(),
  ticketIds: z.array(z.string()).optional(),
  callIds: z.array(z.string()).optional(),
  /** Items the agent should read first, e.g. `{ type: 'ticket', id, title }`. */
  attachedContext: z
    .array(
      z.object({
        type: z.string().min(1),
        id: z.string().min(1),
        title: z.string(),
        threadId: z.string().optional(),
      }),
    )
    .optional(),
  thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
  webSearchEnabled: z.boolean().optional(),
  deepResearchEnabled: z.boolean().optional(),
  generateFollowUpSuggestions: z.boolean().optional(),
  // Branching inside a conversation.
  parentAssistantMessageId: z.string().min(1).optional(),
  isRegenerate: z.boolean().optional(),
  parentMessageId: z.string().min(1).optional(),
  isEditUserMessage: z.boolean().optional(),
  editedUserMessageId: z.string().min(1).optional(),
});

const cancelBody = z.object({ sessionId: z.string().min(1) });

function writeFrame(res: Response, frame: Record<string, unknown>): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(frame)}\n\n`);
  const flush = (res as unknown as { flush?: () => void }).flush;
  if (typeof flush === 'function') flush.call(res);
}

async function runStream(req: Request, res: Response): Promise<void> {
  req.sdkCall = { op: 'POST /claw/runs/stream', kind: 'direct' };
  const input = runStreamBody.parse(req.body);
  const authData = await buildAuthData(req);
  const session = clawSession(req);

  const runReq: ClawRunRequest = {
    userId: authData.sub,
    spacesWorkspaceId: authData.workspaceId,
    userName: authData.displayName || authData.name || authData.email,
    userEmail: authData.email,
    query: input.task,
    agentSlug: input.agent,
    provider: input.provider ?? 'spaces',
    conversationId: '',
    channelId: input.channelId ?? '',
    canvasIds: input.canvasIds ?? [],
    ticketIds: input.ticketIds ?? [],
    callIds: input.callIds ?? [],
    attachedContext: input.attachedContext ?? [],
    webSearchEnabled: input.webSearchEnabled ?? false,
    deepResearchEnabled: input.deepResearchEnabled ?? false,
    createCanvasEnabled: false,
    generateFollowUpSuggestions: input.generateFollowUpSuggestions ?? false,
    ...(input.conversationId ? { sessionId: input.conversationId } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.isRegenerate ? { isRegenerate: true } : {}),
    ...(input.isEditUserMessage ? { isEditUserMessage: true } : {}),
    ...(input.parentMessageId ? { parentMessageId: input.parentMessageId } : {}),
    ...(input.parentAssistantMessageId
      ? { parentAssistantMessageId: input.parentAssistantMessageId }
      : {}),
    ...(input.editedUserMessageId ? { editedUserMessageId: input.editedUserMessageId } : {}),
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Content-Encoding', 'none');
  res.socket?.setNoDelay(true);
  res.status(200);
  res.flushHeaders();

  const ping = setInterval(() => writeFrame(res, { type: 'ping' }), PING_INTERVAL_MS);
  // A caller that hangs up stops the upstream fetch; the run itself is stopped
  // only by an explicit cancel, as in the dashboard.
  const upstreamAbort = new AbortController();
  const onClose = (): void => {
    if (!upstreamAbort.signal.aborted) upstreamAbort.abort();
  };
  res.on('close', onClose);

  try {
    const result = await runClawAgentStream({ headers: { cookie: session.cookie } }, res, runReq, {
      signal: upstreamAbort.signal,
      includeDebug: false,
    });
    if (result.error && result.error !== 'aborted') writeFrame(res, { type: 'error', error: result.error });
  } catch (err) {
    logger.error('[sdk] claw run stream failed', { requestId: req.apiRequestId, userId: authData.sub, err });
    writeFrame(res, { type: 'error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    res.off('close', onClose);
    clearInterval(ping);
  }

  writeFrame(res, { type: 'end' });
  if (!res.writableEnded) res.end();
}

async function cancelRunStream(req: Request, res: Response): Promise<void> {
  req.sdkCall = { op: 'POST /claw/runs/stream/cancel', kind: 'direct' };
  const { sessionId } = cancelBody.parse(req.body);
  const authData = await buildAuthData(req);
  const session = clawSession(req);
  const result = await cancelClawAgentRun(
    { headers: { cookie: session.cookie } },
    authData.sub,
    sessionId,
    session.workspaceId,
  );
  if (!result.success) {
    // claw-auth answers someone else's run, or no run, with "Run not found".
    if (result.error && /not found/i.test(result.error)) throw SdkApiError.notFound('Claw run');
    throw new SdkApiError('internal', result.error ?? 'Cancel failed.');
  }
  res.status(200).json({ sessionId, status: result.status });
}

export function createClawRunStreamRouter(): Router {
  const router = Router();
  router.post('/claw/runs/stream', handle(runStream));
  router.post('/claw/runs/stream/cancel', handle(cancelRunStream));
  return router;
}
