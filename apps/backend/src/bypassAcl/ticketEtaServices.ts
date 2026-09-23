import { asService } from './base';

/**
 * Relocated from workers/stageEtaDeadlineWorker.ts's evaluateTicket. Re-checks the persisted
 * planning-risk fingerprint under a row lock and writes in the same transaction, so an
 * overlapping run or a retry cannot pass the check and then both write. Cron worker → no
 * request context, workspace comes from the ticket being evaluated.
 */
export function commitStageEtaDecision<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['Ticket', 'TicketActivity'],
    'stage eta deadline worker: row-locked fingerprint re-check and write, cron job has no request context',
    'stage-eta-deadline-worker',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from workers/stageEtaDeadlineWorker.ts's evaluateTicket. Post-commit notification
 * dispatch, same tenant scope as the commit above — only the run that won the lock reaches here.
 */
export function dispatchStageEtaNotifications<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['Ticket', 'TicketActivity'],
    'stage eta deadline worker: post-commit notification dispatch for the run that won the lock',
    'stage-eta-deadline-worker',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from workers/etaDeadlineWorker.ts's checkBreaches. Multi-workspace cron → open a
 * per-ticket tenant context so the system message's workspaceId gets stamped from this ticket's
 * workspace.
 */
export function createEtaBreachSystemMessage<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['Message', 'Ticket'],
    'eta deadline worker: multi-workspace cron, system message stamped from this ticket\'s own workspace',
    'eta-deadline-worker',
    workspaceId,
    fn,
  );
}
