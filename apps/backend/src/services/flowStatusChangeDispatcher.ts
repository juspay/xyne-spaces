import type { TicketStatusV2 } from '@prisma/client';
import { logger } from '@/utils/logger';

export interface CommittedTicketStatusChange {
  ticketId: string;
  newStatus: TicketStatusV2;
  actorUserId: string;
}

/**
 * Runs FLOW progression after a ticket status update has committed.
 *
 * Dynamic import avoids a repository -> flow cascade -> repository module cycle.
 * The cascade service performs the FLOW-board check and is idempotent for an
 * already-instantiated plan step.
 */
export async function dispatchCommittedTicketStatusChange(
  change: CommittedTicketStatusChange,
): Promise<void> {
  try {
    const { onFlowTicketStatusChanged } = await import('@/services/flowCascadeService');
    await onFlowTicketStatusChanged(change);
  } catch (error) {
    logger.error('[flowStatusChangeDispatcher] failed to dispatch committed status change', {
      ...change,
      error,
    });
  }
}
