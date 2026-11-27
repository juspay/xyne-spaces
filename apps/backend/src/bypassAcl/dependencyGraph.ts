import type { Prisma } from '@prisma/client';
import { findCycle, toEdges, type DependencyContext, type DependencyEdge } from '@xyne/shared';
import { DependencyError } from '@/services/dependencies/types';

/** Internal graph: privileged ids MUST NOT be serialized to clients or copied to activities. */
export async function loadDependencyGraph(tx: Prisma.TransactionClient, workspaceId: string, ticketIds?: readonly string[]) {
  const [references, mappings] = await Promise.all([
    tx.ticketReferenceMapping.findMany({ where: { workspaceId, relationType: 'BLOCKS', ...(ticketIds ? { OR: [
      { sourceTicketId: { in: [...ticketIds] } }, { targetTicketId: { in: [...ticketIds] } },
    ] } : {}) } }),
    tx.ticketSubTicketMapping.findMany({ where: { workspaceId, ...(ticketIds ? { OR: [
      { ticketId: { in: [...ticketIds] } }, { subTicket: { mappedTicketId: { in: [...ticketIds] } } },
    ] } : {}) } }),
  ]);
  const subTickets = mappings.length ? await tx.subTicket.findMany({
    where: { workspaceId, id: { in: mappings.map(row => row.subTicketId) } },
    select: { id: true, mappedTicketId: true },
  }) : [];
  return { edges: toEdges(references, mappings, subTickets), references, mappings };
}

export async function loadDependencyContext(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  ticketIds: readonly string[],
): Promise<DependencyContext> {
  const tickets = await tx.ticket.findMany({
    where: { workspaceId, id: { in: [...new Set(ticketIds)] } },
    select: { id: true, boardId: true, stageName: true, statusV2: true, eta: true },
  });
  const boardIds = [...new Set(tickets.map(ticket => ticket.boardId))];
  const [boards, stages, transitions, visits] = await Promise.all([
    tx.board.findMany({ where: { workspaceId, id: { in: boardIds } }, select: { id: true, boardType: true, metadata: true } }),
    tx.stage.findMany({ where: { workspaceId, boardId: { in: boardIds } } }),
    tx.stageTransition.findMany({ where: { workspaceId, boardId: { in: boardIds } } }),
    tx.ticketStageEta.findMany({
      where: { workspaceId, ticketId: { in: tickets.map(ticket => ticket.id) }, stageLeftAt: null },
      orderBy: [{ stageEnteredAt: 'desc' }, { id: 'desc' }],
    }),
  ]);
  // Index once: cycle checks can cover a whole workspace and must not scan all
  // stages, visits and transitions separately for every ticket.
  const key = (left: string, right: string) => JSON.stringify([left, right]);
  const stagesByBoard = new Map<string, typeof stages>();
  const stageByName = new Map(stages.map(stage => [key(stage.boardId, stage.name), stage]));
  for (const stage of stages) {
    const boardStages = stagesByBoard.get(stage.boardId) ?? [];
    boardStages.push(stage);
    stagesByBoard.set(stage.boardId, boardStages);
  }
  const outgoing = new Map<string, string[]>();
  for (const transition of transitions) {
    const transitionKey = key(transition.boardId, transition.fromStageId ?? '*');
    const targets = outgoing.get(transitionKey) ?? [];
    targets.push(transition.toStageId);
    outgoing.set(transitionKey, targets);
  }
  const activeEta = new Map<string, Date>();
  for (const visit of visits) {
    const visitKey = key(visit.ticketId, visit.stageId);
    if (!activeEta.has(visitKey)) activeEta.set(visitKey, visit.stageEta);
  }
  const nextStageIdsByTicket = new Map(tickets.map(ticket => {
    const stage = stageByName.get(key(ticket.boardId, ticket.stageName));
    return [ticket.id, [...new Set([
      ...(stage ? outgoing.get(key(ticket.boardId, stage.id)) ?? [] : []),
      ...(outgoing.get(key(ticket.boardId, '*')) ?? []),
    ])]];
  }));
  return {
    ticketsById: new Map(tickets.map(ticket => {
      const stage = stageByName.get(key(ticket.boardId, ticket.stageName));
      return [ticket.id, {
        ...ticket,
        activeStageEta: stage ? activeEta.get(key(ticket.id, stage.id)) ?? null : null,
      }];
    })),
    boardsById: new Map(boards.map(board => [board.id, board])),
    stagesByBoard,
    nextStageIdsByTicket,
  };
}

/** The caller must already hold link-subticket:ws:<workspaceId>. */
export async function assertNoDependencyCycle(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  candidate: DependencyEdge,
): Promise<void> {
  const { edges } = await loadDependencyGraph(tx, workspaceId);
  const ids = [candidate, ...edges].flatMap(edge => [edge.blockerTicketId, edge.dependentTicketId]);
  const context = await loadDependencyContext(tx, workspaceId, ids);
  // Edges whose ticket was deleted or moved out of this workspace are not trustworthy.
  if (ids.some(id => !context.ticketsById.has(id))) {
    throw new DependencyError('DEPENDENCY_INVALID_GRAPH', 'Dependency graph requires repair');
  }
  if (findCycle(edges, candidate, context)) {
    // Naming tickets here would disclose an intermediate, unreadable ticket in a mixed loop.
    throw new DependencyError('DEPENDENCY_CYCLE', 'This dependency would create a cycle');
  }
}
