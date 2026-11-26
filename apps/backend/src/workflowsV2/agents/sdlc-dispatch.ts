import { SDLC_AGENT_SLUG } from '@xyne/shared';
import type { AgentRunInput } from '@xyne/workflow-sdk/agents/host';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { runScopedClawAgent } from '@/services/clawAgentService';
import { sdlcAgentContext } from '@/sdlc/SdlcAgentContextService';
import { buildCallbackUrl, buildTask, clawRunIds, dispatchWithBusyRetry } from './claw-provider';
import { SDLC_AUTHOR_METADATA_KEY } from './identity';
import type { XyneResourceAttrs } from '../types';

/** The bot runs SDLC steps for whoever started the run, else the author: Spaces checks that person's hub rights. */
export async function sdlcRunActorId(ctx: StepExecutionContext): Promise<string> {
  const starter = await db.workflowExecution.findUnique({
    where: { id: ctx.runtime.executionId },
    select: { createdBy: true },
  });
  // The router stamps the author on every config write: whoever last changed the steps.
  const author = ctx.runtime.metadata[SDLC_AUTHOR_METADATA_KEY];
  const actorUserId =
    starter?.createdBy ??
    (typeof author === 'string' && author ? author : undefined) ??
    (ctx.runtime.attributes as XyneResourceAttrs).createdByUserId;
  if (!actorUserId) {
    throw new Error(
      `[workflows] SDLC step has no starter or author to act for. Reset the hub's workflows to stamp "${SDLC_AUTHOR_METADATA_KEY}".`
    );
  }
  return actorUserId;
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
  const actorUserId = await sdlcRunActorId(ctx);
  const user = await db.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, name: true, email: true },
  });
  if (!user?.email) throw new Error(`[workflows] SDLC run actor ${actorUserId} is unavailable`);

  const ids = clawRunIds(ctx, run, attrs.workspaceId, SDLC_AGENT_SLUG);
  const { attempt, sessionId } = ids;
  // The grant is bound to the conversation and claw reads it back, so both use one id that holds across turns.
  const conversationId = ids.conversationId ?? sessionId;
  const actor = { userId: user.id, workspaceId: attrs.workspaceId };
  const contextInput = {
    channelId: input.channelId,
    conversationId,
    ...(input.generationCommit ? { generationCommit: input.generationCommit } : {}),
  };
  const agentContext = input.repoId
    ? await sdlcAgentContext.build(actor, input.repoId, contextInput)
    : await sdlcAgentContext.buildForHub(actor, input.channelId, contextInput);

  logger.info(
    `[workflows] dispatching SDLC agent execution=${ctx.runtime.executionId} node=${ctx.runtime.stepName} `
      + `channel=${input.channelId} repo=${input.repoId ?? '-'} session=${sessionId}`
  );
  // Slugs are unique per org only: scoping stops another org's "sdlc-agent" from getting the hub's grant.
  const workspace = await db.workspace.findUnique({ where: { id: attrs.workspaceId }, select: { orgId: true } });
  if (!workspace?.orgId) throw new Error(`[workflows] workspace ${attrs.workspaceId} has no organization`);
  const identity = { userId: user.id, workspaceId: attrs.workspaceId, orgId: workspace.orgId };
  const response = await dispatchWithBusyRetry(Boolean(ids.conversationId), () => runScopedClawAgent({
    identity,
    sessionId,
    // Pinned, not step config: another slug loses the SDLC tools.
    agentSlug: SDLC_AGENT_SLUG,
    task: buildTask({ ...run, task: input.task }),
    workspaceId: attrs.workspaceId,
    userId: user.id,
    userName: user.name || user.email,
    userEmail: user.email,
    channelId: input.channelId,
    conversationId,
    callbackUrl: buildCallbackUrl(ctx.runtime.executionId, ctx.runtime.stepName, attempt, run.conversation?.turn),
    executionProfile: 'sdlc',
    sdlcContext: agentContext as unknown as Record<string, unknown>,
    allowWriteInReadOnlyJob: true,
  }));
  if (!response.success) {
    throw new Error(`[workflows] claw rejected the SDLC run: ${response.error ?? 'unknown error'}`);
  }
  return { externalRef: sessionId };
}
