import { db } from '@/database/client';
import { cancelS2SClawRun } from '@/services/clawAgentService';
import { logger } from '@/utils/logger';
import { readAgentDispatch } from './claw-provider';
import { resolveClawRunIdentity } from './identity';
import { sdlcActorOfExecution } from './sdlc-dispatch';

export interface ParkedAgentStep {
  executionId: string;
  stepName: string;
  data: string | null;
  workspaceId: string;
  createdBy: string | null;
  workflowMetadata: string | null;
}

/** The user a step's claw run was dispatched as: claw accepts a cancel only from them. */
export async function clawRunOwner(step: ParkedAgentStep): Promise<string | undefined> {
  const actor = await sdlcActorOfExecution(step.executionId, step.workflowMetadata);
  if (actor) return actor;
  let agentSlug: unknown;
  try {
    agentSlug = (JSON.parse(step.data ?? '{}') as { input?: { agentSlug?: unknown } }).input?.agentSlug;
  } catch {
    return step.createdBy ?? undefined;
  }
  if (typeof agentSlug !== 'string') return step.createdBy ?? undefined;
  return (await resolveClawRunIdentity(agentSlug, step.workspaceId)).userId;
}

/** Best effort: a run that keeps going only delivers a result the callback ignores. */
export async function cancelClawRun(step: ParkedAgentStep): Promise<void> {
  const dispatch = readAgentDispatch(step.data);
  if (!dispatch) return;
  try {
    const owner = await clawRunOwner(step);
    const outcome = owner ? await cancelS2SClawRun(dispatch.externalRef, owner) : null;
    if (outcome && !outcome.success) logger.warn(`[workflows] claw cancel ${dispatch.externalRef}: ${outcome.error ?? outcome.status}`);
  } catch (error) {
    logger.warn(`[workflows] could not cancel claw run ${dispatch.externalRef}`, error);
  }
}

/** Stops the claw runs a cancelled execution was still waiting on. Runs in the caller's workspace scope. */
export async function cancelParkedClawRuns(executionId: string): Promise<void> {
  const execution = await db.workflowExecution.findUnique({
    where: { id: executionId },
    select: {
      workspaceId: true,
      createdBy: true,
      workflow: { select: { metadata: true } },
      workflowSteps: { where: { status: 'EXTERNAL_WAIT' }, select: { stepName: true, data: true } },
    },
  });
  if (!execution) return;
  for (const step of execution.workflowSteps) {
    await cancelClawRun({
      executionId,
      stepName: step.stepName ?? '',
      data: step.data,
      workspaceId: execution.workspaceId,
      createdBy: execution.createdBy,
      workflowMetadata: execution.workflow.metadata,
    });
  }
}
