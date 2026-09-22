import { SDLC_AGENT_SLUG } from '@xyne/shared';
import type { AgentRunInput } from '@xyne/workflow-sdk/agents/host';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { runS2SClawAgent } from '@/services/clawAgentService';
import { sdlcAgentContext } from '@/sdlc/SdlcAgentContextService';
import { buildCallbackUrl, buildTask } from './claw-provider';
import type { XyneResourceAttrs } from '../types';

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

function safeClawId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128);
}

export async function dispatchSdlcAgent(input: {
  ctx: StepExecutionContext;
  run: AgentRunInput;
  channelId: string;
  task: string;
  repoId?: string;
  generationCommit?: string;
}): Promise<{ externalRef: string }> {
  const { ctx, run } = input;
  const attrs = ctx.runtime.attributes as XyneResourceAttrs;
  const authorId = ctx.runtime.metadata[SDLC_AUTHOR_METADATA_KEY];
  const actorUserId = typeof authorId === 'string' && authorId ? authorId : attrs.createdByUserId;
  if (!actorUserId) {
    throw new Error(
      `[workflows] SDLC step has no author to act as. Reset the hub's workflows to stamp "${SDLC_AUTHOR_METADATA_KEY}".`
    );
  }
  const user = await db.user.findUnique({
    where: { id: actorUserId },
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
  const agentContext = input.repoId
    ? await sdlcAgentContext.build(actor, input.repoId, contextInput)
    : await sdlcAgentContext.buildForHub(actor, input.channelId, contextInput);

  logger.info(
    `[workflows] dispatching SDLC agent execution=${ctx.runtime.executionId} node=${ctx.runtime.stepName} `
      + `channel=${input.channelId} repo=${input.repoId ?? '-'} session=${sessionId}`
  );
  const response = await runS2SClawAgent({
    sessionId,
    // Pinned, not step config: another slug loses the SDLC tools.
    agentSlug: SDLC_AGENT_SLUG,
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
  if (!response.success) {
    throw new Error(`[workflows] claw rejected the SDLC run: ${response.error ?? 'unknown error'}`);
  }
  return { externalRef: sessionId };
}
