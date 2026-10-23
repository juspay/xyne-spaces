import { SDLC_WIKI_WORKFLOW_RELATION, SDLC_WORKFLOW_RELATION } from '@xyne/shared';
import type { AgentRunInput } from '@xyne/workflow-sdk/agents/host';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { runS2SClawAgent } from '@/services/clawAgentService';
import { sdlcAgentContext } from '@/sdlc/SdlcAgentContextService';
import { buildCallbackUrl, buildTask } from './claw-provider';
import type { XyneResourceAttrs } from '../types';
import { SDLC_STARTED_BY_KEY } from '../constants';

/** Not `attributes.createdByUserId`: the router consumes that at create and never persists it. */
export const SDLC_AUTHOR_METADATA_KEY = 'sdlcAuthorUserId';

export function sdlcAuthorOf(metadata: string | null | undefined): string | undefined {
  try {
    const author = (JSON.parse(metadata ?? '{}') as Record<string, unknown>)[SDLC_AUTHOR_METADATA_KEY];
    return typeof author === 'string' && author ? author : undefined;
  } catch {
    return undefined;
  }
}

export function sdlcStarterOf(trigger: unknown): string | undefined {
  const starter = trigger && typeof trigger === 'object' ? (trigger as Record<string, unknown>)[SDLC_STARTED_BY_KEY] : undefined;
  return typeof starter === 'string' && starter ? starter : undefined;
}

/** The user an SDLC run's agent steps act as: whoever started it, else the workflow author. */
export async function sdlcActorOfExecution(
  executionId: string,
  workflowMetadata: string | null,
  client: Pick<typeof db, 'workflowExecutionState'> = db
): Promise<string | undefined> {
  const state = await client.workflowExecutionState.findFirst({ where: { workflowExecutionId: executionId }, select: { context: true } });
  let trigger: unknown;
  try {
    trigger = (JSON.parse(state?.context ?? '{}') as { trigger?: unknown }).trigger;
  } catch {
    trigger = undefined;
  }
  return sdlcStarterOf(trigger) ?? sdlcAuthorOf(workflowMetadata);
}

function safeClawId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128);
}

/** The hub a seeded workflow belongs to: the CHANNEL -> WORKFLOW link written when it was seeded. */
export async function workflowHubId(ctx: StepExecutionContext): Promise<string> {
  const workflowId = ctx.workflow.workflow.id;
  const link = await db.sdlcEntityLink.findFirst({
    where: {
      targetType: 'WORKFLOW',
      targetId: workflowId,
      relationType: { in: [SDLC_WORKFLOW_RELATION, SDLC_WIKI_WORKFLOW_RELATION] },
    },
    select: { channelId: true },
  });
  if (!link) throw new Error(`[workflows] workflow ${workflowId} is not linked to an SDLC hub`);
  return link.channelId;
}

export async function dispatchSdlcAgent(input: {
  ctx: StepExecutionContext;
  run: AgentRunInput;
  agentSlug: string;
  channelId: string;
  task: string;
  generationCommit?: string;
}): Promise<{ externalRef: string }> {
  const { ctx, run } = input;
  const attrs = ctx.runtime.attributes as XyneResourceAttrs;
  const authorId = ctx.runtime.metadata[SDLC_AUTHOR_METADATA_KEY];
  const actorUserId = sdlcStarterOf(ctx.workflow.trigger)
    ?? (typeof authorId === 'string' && authorId ? authorId : attrs.createdByUserId);
  if (!actorUserId) {
    throw new Error(
      `[workflows] SDLC step has no author to act as. Reset the hub's workflows to stamp "${SDLC_AUTHOR_METADATA_KEY}".`
    );
  }
  const user = await db.user.findFirst({
    where: { id: actorUserId, workspaceId: attrs.workspaceId },
    select: { id: true, name: true, email: true },
  });
  if (!user?.email) throw new Error(`[workflows] workflow author ${actorUserId} is unavailable`);

  const attempt = run.repair?.attempt ?? 0;
  const sessionId = safeClawId(
    `wf-${ctx.runtime.executionId}-${ctx.runtime.stepName}${attempt > 0 ? `-retry-${String(attempt)}` : ''}`
  );
  const actor = { userId: user.id, workspaceId: attrs.workspaceId };
  // The grant is bound to the conversation, and claw reads it back, so both use sessionId.
  const contextInput = {
    channelId: input.channelId,
    conversationId: sessionId,
    ...(input.generationCommit ? { generationCommit: input.generationCommit } : {}),
  };
  const agentContext = await sdlcAgentContext.buildForHub(actor, input.channelId, contextInput);

  logger.info(
    `[workflows] dispatching SDLC agent execution=${ctx.runtime.executionId} node=${ctx.runtime.stepName} `
      + `agent=${input.agentSlug} channel=${input.channelId} session=${sessionId}`
  );
  let response: Awaited<ReturnType<typeof runS2SClawAgent>>;
  try {
    response = await runS2SClawAgent({
      sessionId,
      agentSlug: input.agentSlug,
      task: buildTask({ ...run, task: input.task }),
      workspaceId: attrs.workspaceId,
      userId: user.id,
      userName: user.name || user.email,
      userEmail: user.email,
      channelId: input.channelId,
      conversationId: sessionId,
      callbackUrl: buildCallbackUrl(ctx.runtime.executionId, ctx.runtime.stepName, attempt),
      executionProfile: 'sdlc',
      sdlcContext: agentContext as unknown as Record<string, unknown>,
      allowWriteInReadOnlyJob: true,
    });
  } catch (error) {
    // A timed-out dispatch may still start in claw: park on the session so its callback, a cancel or the sweeper settles it.
    if ((error as { cause?: { name?: string } }).cause?.name !== 'TimeoutError') throw error;
    logger.warn(`[workflows] SDLC dispatch timed out, parking on session=${sessionId} in case claw started it`);
    return { externalRef: sessionId };
  }
  if (!response.success) {
    throw new Error(`[workflows] claw rejected the SDLC run: ${response.error ?? 'unknown error'}`);
  }
  return { externalRef: sessionId };
}
