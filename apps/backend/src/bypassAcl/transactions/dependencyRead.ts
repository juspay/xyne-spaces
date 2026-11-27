import { createHmac } from 'node:crypto';
import { config } from '@/config/env';
import { projectDependencyEdges } from '@/services/dependencies/projection';
import type { Prisma, PrismaClient } from '@prisma/client';
import { dependencyPolicy, deriveDependencyState } from '@xyne/shared';
import { ACLFactory } from '@/database/acl';
import { db } from '@/database/client';
import { transaction } from '../base';
import { loadDependencyContext, loadDependencyGraph } from '../dependencyGraph';
import { withWorkspaceRole, type SubTicketLinkActor } from '@/services/subTicketLinkService';

/**
 * Zero row permissions cannot mask columns. BLOCKS is excluded from raw sync; this batch
 * transport never returns a hidden ticket id (including ids in paths, stage refs or errors).
 */
export function readDependencies(requestActor: SubTicketLinkActor, requestedIds: readonly string[]) {
  return transaction(
    ['Ticket', 'TicketReferenceMapping', 'TicketSubTicketMapping', 'SubTicket', 'Stage', 'StageTransition', 'Board', 'TicketStageEta', 'User'],
    'privacy-safe dependency batch: privileged graph calculation followed by endpoint redaction', db,
    async tx => {
      const actor = await withWorkspaceRole(tx, requestActor);
      const acl = ACLFactory.getACL('ticket', {
        userId: actor.userId, workspaceId: actor.workspaceId, role: actor.role,
      }, tx as unknown as PrismaClient);
      const where = await acl.getWhereClause() as Prisma.TicketWhereInput | null;
      if (!where) return { edges: [], tickets: [], boards: [], stages: [], states: {} };
      const ownTickets = await tx.ticket.findMany({
        where: { AND: [{ workspaceId: actor.workspaceId, id: { in: [...requestedIds] } }, where] },
        select: { id: true },
      });
      const ids = ownTickets.map(ticket => ticket.id);
      const { edges } = await loadDependencyGraph(tx, actor.workspaceId, ids);
      const allIds = [...new Set([...ids, ...edges.flatMap(edge => [edge.blockerTicketId, edge.dependentTicketId])])];
      const tickets = await tx.ticket.findMany({
        where: { AND: [{ workspaceId: actor.workspaceId, id: { in: allIds } }, where] },
        select: { id: true, title: true, xyneId: true, boardId: true, stageName: true, assignedTo: true, eta: true },
      });
      const visible = new Set(tickets.map(ticket => ticket.id));
      const context = await loadDependencyContext(tx, actor.workspaceId, allIds);
      const safeEdges = projectDependencyEdges(edges, visible, id =>
        createHmac('sha256', config.jwt.secret).update(JSON.stringify([actor.workspaceId, actor.userId, id])).digest('hex'),
      );
      const publicIds = new Map(edges.map((edge, index) => [edge.id, safeEdges[index]!.id]));
      const states = Object.fromEntries(ids.map(id => {
        const ticket = context.ticketsById.get(id);
        const state = ticket && deriveDependencyState(ticket, edges, context, Date.now());
        return [id, state ? {
          primary: state.primary,
          blockedBy: state.blockedBy.map(edge => publicIds.get(edge.id)!),
          blocking: state.blocking.map(edge => publicIds.get(edge.id)!),
          ...(state.atRiskDays == null ? {} : { atRiskDays: state.atRiskDays }),
        } : null];
      }));
      const visibleBoards = new Set(tickets.map(ticket => ticket.boardId));
      return {
        edges: safeEdges, tickets, states,
        boards: [...context.boardsById.values()].filter(board => visibleBoards.has(board.id)).map(board => ({
          id: board.id, boardType: board.boardType, metadata: { dependencyPolicy: dependencyPolicy(board.metadata) },
        })),
        stages: [...context.stagesByBoard].filter(([boardId]) => visibleBoards.has(boardId)).flatMap(([, stages]) => stages.map(stage => ({
          id: stage.id, boardId: stage.boardId, name: stage.name, sequenceNumber: stage.sequenceNumber,
          defaultTicketStatusV2: stage.defaultTicketStatusV2, eta: stage.eta,
        }))),
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 15_000 },
  );
}
