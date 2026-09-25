import { asService } from './base';
import type { BoardConfigCopyWorker } from '@/workers/boardConfigCopyWorker';
import type { BoardConfigCopyJobData, BoardConfigCopySummary } from '@/queues/boardConfigCopyQueue';

/**
 * Relocated from workers/boardConfigCopyWorker.ts's queue processor. Bull job → no ambient
 * tenant context (see acl-extension.ts's no-context fallback); opens one bound to the job's own
 * workspace/actor so the board/stage/form copy writes get workspaceId stamped.
 */
export function copyBoardConfig(
  worker: BoardConfigCopyWorker,
  data: BoardConfigCopyJobData,
): Promise<BoardConfigCopySummary> {
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
