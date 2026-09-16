import type { Transaction } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { parseTicketEtaManagement, type TicketEtaManagement } from '@xyne/shared';
import { zql } from '@/zero/queries';
import { resolveStepEstimate } from './estimateResolution';
import type { ActiveVisitContext } from './index';
import type { StageLike, TransitionLike } from './types';

export interface LoadedZeroEtaContext {
  stages: Array<Pick<StageLike, 'id' | 'sequenceNumber' | 'eta'>>;
  transitions: TransitionLike[];
  currentTicketEtaManagement: TicketEtaManagement;
  /**
   * Derived from the ticket's persisted open `ticket_stage_eta` row for the
   * given stage. Callers whose deadline isn't persisted yet (a transition
   * computing it in-flight, or a manual edit) override `deadline`/
   * `estimateSource` on the returned object.
   */
  activeVisit: ActiveVisitContext;
}

/**
 * Zero counterpart to `loadBoardEtaContext` - loads what `evaluateEta`'s
 * pure functions need through the caller's own transaction, so the read is
 * consistent with whatever that mutator is about to write.
 *
 * `stages` may be passed in when the caller already fetched them (several
 * mutators need the ordered list for their own logic first).
 */
export async function loadZeroEtaContext(
  tx: Transaction<Schema>,
  input: {
    ticketId: string;
    boardId: string;
    ticketMetadata: unknown;
    stage: { id: string; eta: number | null | undefined };
    transition?: TransitionLike | null;
    stages?: Array<Pick<StageLike, 'id' | 'sequenceNumber' | 'eta'>>;
  },
): Promise<LoadedZeroEtaContext> {
  const stages = input.stages ?? (await tx.run(zql.stages.where('boardId', input.boardId)));
  const transitions = await tx.run(zql.stage_transitions.where('boardId', input.boardId));

  const visits = await tx.run(
    zql.ticket_stage_eta.where('ticketId', input.ticketId).where('stageId', input.stage.id),
  );
  const activeVisitRow = visits.find(v => v.stageLeftAt === null) ?? null;
  const estimate = resolveStepEstimate(
    { id: input.stage.id, eta: input.stage.eta },
    input.transition ?? null,
    { requireExplicitTransition: false },
  );

  return {
    stages,
    transitions,
    currentTicketEtaManagement: parseTicketEtaManagement(input.ticketMetadata),
    activeVisit: {
      stageVisitId: activeVisitRow?.id ?? null,
      transitionId: input.transition?.id ?? null,
      deadline: activeVisitRow ? new Date(activeVisitRow.stageEta) : null,
      // stageEta === stageEnteredAt is the no-SLA placeholder, not a real deadline.
      deadlineTracked: activeVisitRow
        ? activeVisitRow.stageEta !== activeVisitRow.stageEnteredAt
        : false,
      estimateSource: estimate.source,
      estimateHours: estimate.incomplete ? null : estimate.hours,
    },
  };
}
