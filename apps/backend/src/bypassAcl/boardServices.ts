import { asService } from './base';
import { db } from '@/database/client';
import type { BoardConfigCopyWorker } from '@/workers/boardConfigCopyWorker';
import type { BoardConfigCopyJobData, BoardConfigCopySummary } from '@/queues/boardConfigCopyQueue';

/**
 * Relocated from workers/boardConfigCopyWorker.ts's queue processor. Bull job → no ambient
 * tenant context (see acl-extension.ts's no-context fallback); opens one bound to the job's own
 * workspace/actor so the board/stage/form copy writes get workspaceId stamped.
 */
export async function copyBoardConfig(
  worker: BoardConfigCopyWorker,
  data: BoardConfigCopyJobData,
): Promise<BoardConfigCopySummary> {
  const board = await db.board.findUnique({ where: { id: data.targetBoardId }, select: { workspaceId: true } });
  if (!board || board.workspaceId !== data.workspaceId) {
    throw new Error(`board config copy: board ${data.targetBoardId} is not in workspace ${data.workspaceId}`);
  }
  const actor = await db.user.findFirst({
    where: { id: data.actorUserId, workspaceId: data.workspaceId },
    select: { id: true },
  });
  if (!actor) {
    throw new Error(`board config copy: actor ${data.actorUserId} is not in workspace ${data.workspaceId}`);
  }
  return asService(
    [
      'Board',
      'Stage',
      'StageTransition',
      'StageApprovers',
      'StagePRStatusMapping',
      'Form',
      'FormContextMapping',
      'FormEntityValues',
      'Ticket',
    ],
    'board config copy: Bull job has no ambient tenant context, writes stamped from the job\'s own workspace/actor',
    data.actorUserId,
    data.workspaceId,
    () => worker.processJob(data),
  );
}
