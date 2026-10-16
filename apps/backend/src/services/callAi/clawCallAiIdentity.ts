import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import type { CallAiTask, ClawCallAiIdentity } from './types';

/**
 * The Spaces user a Claw run acts as: always the creator of the task's call.
 * Claw requires a real user: it maps the Spaces id to a Claw identity and runs
 * the agent's Spaces app installed in their workspace. Tasks without a real call — summary templates, desk
 * recordings — return null and run on the legacy engine.
 */
export async function resolveClawCallAiIdentity(
  task: Pick<CallAiTask, 'callId' | 'operation'>,
): Promise<ClawCallAiIdentity | null> {
  if (!task.callId) return null;

  const call = await repositories.calls.findByExternalId(task.callId);
  if (!call?.createdByUserId) return null;

  const user = await db.user.findUnique({
    where: { id: call.createdByUserId },
    select: { id: true, workspaceId: true },
  });
  if (!user) {
    logger.warn(`[${task.callId}] ${task.operation}_claw_call_creator_not_found`, {
      user_id: call.createdByUserId,
    });
    return null;
  }

  return { userId: user.id, workspaceId: user.workspaceId };
}
