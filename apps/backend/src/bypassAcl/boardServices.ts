import { asService } from './base';

/**
 * Relocated from workers/boardConfigCopyWorker.ts's queue processor. Bull job → no ambient
 * tenant context (see acl-extension.ts's no-context fallback); opens one bound to the job's own
 * workspace/actor so the board/stage/form copy writes get workspaceId stamped.
 */
export function copyBoardConfigAsServiceActor<T>(
  actorUserId: string,
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
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
    actorUserId,
    workspaceId,
    fn,
  );
}
